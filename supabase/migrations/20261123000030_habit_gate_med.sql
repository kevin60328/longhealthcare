-- 習慣卡初審（habit_gate）補上資料庫檢查（2026/11/23 使用者決定）：
-- 原型的規則（rules/core.js habitState、habitGate）：習慣卡審核完成後，如果已確認的醫療資料（過敏、管路、吞嚥）改變了，
-- 狀態變成「資料已變更，需重新確認」，不能開始收治評估。原本只有畫面檢查，直接呼叫 RPC 可以略過，這裡補上。
--
-- 1. confirmed_field(案件, 欄位)：與 rules/core.js confirmedField 相同——依文件順序，每份文件取「最新一個護理核對完成且有內容」的版本，
--    第一個有這個欄位值的就是已確認資料（新版本尚未核對前沿用舊的已確認內容）。tests/rls/assessment.test.js 逐筆比對兩邊結果。
-- 2. habit_gate：最新一次正式提交已審核完成，而且審核當時保存的醫療資料快照與現在相同。
--    （家屬資料的變更一定伴隨新的正式提交，由「版本相同」檢查；與 habitChanges 的家屬部分相同）
-- 3. review_habit：審核完成時的醫療資料快照改由資料庫計算（不再採用畫面傳來的 p_med，參數保留只是為了相容）。

create or replace function public.confirmed_field(p_case uuid, p_k text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare d record; vv int; val text;
begin
  for d in select id from public.documents where case_id = p_case and deleted_at is null order by sort, id loop
    select x.v into vv from public.document_versions x
      where x.document_id = d.id and x.nurse_ok and exists (select 1 from public.medical_facts f where f.document_id = x.document_id and f.version_v = x.v)
      order by x.v desc limit 1;
    if vv is not null then
      select f.value into val from public.medical_facts f where f.document_id = d.id and f.version_v = vv and f.field = p_k;
      if coalesce(val, '') <> '' then return val; end if;
    end if;
  end loop;
  return '';
end $$;

-- 審核時的醫療資料快照（原型 medSnap）
create or replace function public.med_snapshot(p_case uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('allergy', public.confirmed_field(p_case, 'allergy'), 'tube', public.confirmed_field(p_case, 'tube'), 'swallow', public.confirmed_field(p_case, 'swallow'))
$$;

create or replace function public.habit_gate(p_case uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select h.state = '審核完成'
      and h.rev = (select max(rev) from public.habit_submissions where case_id = p_case)
      and coalesce(h.med_snapshot->>'allergy', '') = public.confirmed_field(p_case, 'allergy')
      and coalesce(h.med_snapshot->>'tube', '') = public.confirmed_field(p_case, 'tube')
      and coalesce(h.med_snapshot->>'swallow', '') = public.confirmed_field(p_case, 'swallow')
    from public.habit_reviews h where h.case_id = p_case and h.state <> '護理已閱' order by h.reviewed_at desc, h.id desc limit 1), false)
$$;

create or replace function public.review_habit(p_case uuid, p_state text, p_note text, p_rev int, p_diff_res jsonb, p_med jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.nurse_case_for_update(p_case); note text := btrim(coalesce(p_note, '')); latest int; sub jsonb; st text;
begin
  if not public.case_can_process(c) then raise exception '資料授權無效或案件已結案' using errcode = 'P0001'; end if;
  if p_state not in ('審核完成','有疑義','護理已閱') then raise exception '請選擇審核結果' using errcode = '22023'; end if;
  select max(rev) into latest from public.habit_submissions where case_id = c.id;
  if latest is null then raise exception '家屬尚未正式提交習慣卡' using errcode = 'P0001'; end if;
  if latest <> p_rev then raise exception '家屬剛重新提交了習慣卡，請重新查看後再審核' using errcode = 'P0001'; end if;
  if p_state = '有疑義' and note = '' then raise exception '請說明疑義內容' using errcode = '22023'; end if;
  if p_state = '審核完成' then
    if exists (select 1 from jsonb_array_elements(coalesce(p_diff_res, '[]')) r where btrim(coalesce(r->>'res', '')) = '') then
      raise exception '還有與已確認醫療資料不一致的項目沒有處理說明，不能完成審核' using errcode = '22023'; end if;
    select h.state into st from public.habit_reviews h where h.case_id = c.id and h.state <> '護理已閱' order by h.reviewed_at desc, h.id desc limit 1;
    if st = '有疑義／待確認' and note = '' then raise exception '目前標示有疑義，請說明疑義如何處理後再完成審核' using errcode = '22023'; end if;
    select data into sub from public.habit_submissions where case_id = c.id and rev = latest;
  end if;
  insert into public.habit_reviews (case_id, rev, state, diff_res, note, med_snapshot, snap, reviewed_by)
    values (c.id, latest, case when p_state = '有疑義' then '有疑義／待確認' else p_state end,
      case when p_state = '審核完成' then coalesce(p_diff_res, '[]') end, nullif(note, ''),
      case when p_state = '審核完成' then public.med_snapshot(c.id) end, case when p_state = '審核完成' then sub end, auth.uid());
  perform public.log_action(c.id, case when p_state = '審核完成' then '習慣卡審核完成（家屬第 ' || latest || ' 次修改）' || coalesce('（' || nullif(note, '') || '）', '')
    when p_state = '有疑義' then '習慣卡標示有疑義／待確認：' || note else '習慣卡護理已閱（閱讀紀錄）' || coalesce('：' || nullif(note, ''), '') end);
end $$;

revoke execute on function public.confirmed_field(uuid, text), public.med_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.confirmed_field(uuid, text) to service_role;
