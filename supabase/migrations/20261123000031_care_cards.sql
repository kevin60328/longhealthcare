-- 階段 8：照顧摘要卡（care-summary.html）
-- HANDOFF 8.4（save_care_card、open_care_card、disable_care_card）、10.8（照顧摘要卡）
--
-- 摘要卡一張一個版本（care_cards）：草稿（修訂中）→ 已開放 → 已停用／已取代。開放給哪些照服員在 care_card_caregivers。
-- 內容（content）與依據快照（basis）由畫面依規則（rules/core.js cardFromData、cardBasis）產生後送來；
-- 資料庫負責：只有承辦護理師、授權有效、開放條件、照服員身分、同時修改檢查、版本與取代、操作紀錄。
--
-- RPC：
--   open_care_card     確認並開放（第一次：新增一張；修訂：草稿轉為開放、舊的標示已取代，同一個交易）
--   revise_care_card   修訂內容：產生下一版草稿（開放前照服員仍看到目前的版本）
--   discard_care_card  放棄修訂草稿
--   stop_care_card     停用（照服員改看到「已停用，請問護理站」）
--   resume_care_card   重新開放已停用的卡
--   my_care_card       照服員讀取一張開放給自己的卡（給 Edge Function care-card 用 service role 呼叫；它另外依規則算出待重新審核的欄位）
--
-- 開放條件（原型 cardAllowed）：授權有效、已簽約、評估通過、文件齊全（docs_ready）、診斷已同步（dx_synced）、習慣卡初審通過（habit_gate）。

-- 診斷已同步（原型 dxPending 的相反）：最近一次完成核對的病摘，逐筆已確認的診斷都在診斷清單，舊版本帶入的都已標示取代
create or replace function public.dx_synced(p_case uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v public.document_versions;
begin
  select x.* into v from public.document_versions x join public.documents d on d.id = x.document_id
    where d.case_id = p_case and d.key = 'summary' and d.deleted_at is null and x.nurse_ok order by x.v desc limit 1;
  if v.id is null or v.dx_rows is null or coalesce((v.dx_rows->>'absent')::boolean, false) then return true; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(v.dx_rows->'rows', '[]')) r where r->>'state' = '已確認'
      and not exists (select 1 from public.diagnoses g where g.source_document = v.document_id and g.source_version = v.v and g.source_row = (r->>'n')::int)) then return false; end if;
  return not exists (select 1 from public.diagnoses g where g.source_document = v.document_id and g.source_version <> v.v and g.superseded_at is null);
end $$;

create or replace function public.card_allowed(c public.cases) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare a public.assessments := public.current_assessment(c.id);
begin
  return public.case_can_process(c) and c.signed_at is not null
    and a.id is not null and a.result = case when c.flow_mode = '先審後簽' then '收治' else '可入住' end
    and public.docs_ready(c.id) and public.dx_synced(c.id) and public.habit_gate(c.id);
end $$;

-- 照服員：至少一位，而且都是啟用中的照顧服務員
create or replace function public.check_caregivers(p_ids uuid[]) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception '請至少選一位照服員' using errcode = '22023'; end if;
  if exists (select 1 from unnest(p_ids) x where not exists (select 1 from public.profiles p where p.id = x and p.role = 'care' and p.status = '啟用')) then
    raise exception '只能開放給啟用中的照顧服務員' using errcode = '22023'; end if;
end $$;

-- 確認並開放。p_draft_v：修訂草稿的版本（第一次開放時為 null）；p_content：摘要卡內容；p_basis：依據快照
create or replace function public.open_care_card(p_case uuid, p_draft_v int, p_content jsonb, p_basis jsonb, p_caregivers uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.nurse_case_for_update(p_case); dr public.care_cards; cur public.care_cards; nv int; cid uuid; names text;
begin
  if not public.card_allowed(c) then raise exception '案件尚未符合開放條件（需已簽約、評估通過、必要文件確認符合、診斷已同步、習慣卡初審完成，且授權有效）' using errcode = 'P0001'; end if;
  perform public.check_caregivers(p_caregivers);
  if jsonb_typeof(p_content) <> 'object' or jsonb_typeof(p_basis) <> 'object' then raise exception '摘要卡內容不完整' using errcode = '22023'; end if;
  select * into cur from public.care_cards where case_id = c.id and status in ('已開放','已停用') order by v desc limit 1;
  select * into dr from public.care_cards where case_id = c.id and status = '草稿' order by v desc limit 1;
  if p_draft_v is null then
    /* 第一次開放：不能已經有開放或停用中的卡（那要用修訂） */
    if cur.id is not null or dr.id is not null then raise exception '摘要卡已被其他人修改，請重新開啟' using errcode = 'P0001'; end if;
    nv := coalesce((select max(v) from public.care_cards where case_id = c.id), 0) + 1;
    insert into public.care_cards (case_id, v, status, content, basis, review, opened_by, opened_at, updated_by)
      values (c.id, nv, '已開放', p_content, p_basis, jsonb_build_object('state', '有效', 'fields', '[]'::jsonb), auth.uid(), now(), auth.uid()) returning id into cid;
  else
    if dr.id is null or dr.v <> p_draft_v then raise exception '摘要卡已被其他人修改，請重新開啟' using errcode = 'P0001'; end if;
    nv := dr.v;
    /* 新版開放與舊版取代在同一個交易內完成 */
    if cur.id is not null then
      update public.care_cards set status = '已取代', end_at = now(), end_note = '由第 ' || nv || ' 版取代', updated_by = auth.uid(), updated_at = now() where id = cur.id;
    end if;
    update public.care_cards set status = '已開放', content = p_content, basis = p_basis, review = jsonb_build_object('state', '有效', 'fields', '[]'::jsonb),
      opened_by = auth.uid(), opened_at = now(), updated_by = auth.uid(), updated_at = now() where id = dr.id;
    cid := dr.id;
    delete from public.care_card_caregivers where card_id = cid;
  end if;
  insert into public.care_card_caregivers (card_id, caregiver_id) select cid, x from unnest(p_caregivers) x;
  select string_agg(p.name, '、') into names from public.profiles p where p.id = any(p_caregivers);
  perform public.log_action(c.id, '照顧摘要卡第 ' || nv || ' 版開放給 ' || names, false);
  return nv;
end $$;

-- 修訂內容：產生下一版草稿（由已確認資料重新帶入的內容由畫面送來；開放對象沿用舊版，開放前仍須重新審核）
create or replace function public.revise_care_card(p_case uuid, p_expect_v int, p_content jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.nurse_case_for_update(p_case); cur public.care_cards; nv int; cid uuid;
begin
  if not public.case_can_process(c) then raise exception '目前不能建立新版本' using errcode = 'P0001'; end if;
  select * into cur from public.care_cards where case_id = c.id and status in ('已開放','已停用') order by v desc limit 1;
  if cur.id is null or cur.v <> p_expect_v or exists (select 1 from public.care_cards where case_id = c.id and status = '草稿') then
    raise exception '摘要卡已被其他人修改，請重新整理' using errcode = 'P0001'; end if;
  nv := cur.v + 1;
  insert into public.care_cards (case_id, v, status, content, basis, updated_by) values (c.id, nv, '草稿', coalesce(p_content, '{}'), '{}', auth.uid()) returning id into cid;
  insert into public.care_card_caregivers (card_id, caregiver_id) select cid, g.caregiver_id from public.care_card_caregivers g where g.card_id = cur.id;
  perform public.log_action(c.id, '建立照顧摘要卡第 ' || nv || ' 版草稿', false);
  return nv;
end $$;

create or replace function public.discard_care_card(p_case uuid, p_v int) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.nurse_case_for_update(p_case); n int;
begin
  delete from public.care_cards where case_id = c.id and status = '草稿' and v = p_v;
  get diagnostics n = row_count;
  if n = 0 then raise exception '沒有草稿可以放棄' using errcode = 'P0001'; end if;
  perform public.log_action(c.id, '放棄照顧摘要卡第 ' || p_v || ' 版草稿', false);
end $$;

create or replace function public.stop_care_card(p_case uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.nurse_case_for_update(p_case); n text := btrim(coalesce(p_note, '')); k public.care_cards;
begin
  if n = '' then raise exception '請填寫原因' using errcode = '22023'; end if;
  select * into k from public.care_cards where case_id = c.id and status = '已開放' for update;
  if k.id is null then raise exception '摘要卡目前不是開放狀態' using errcode = 'P0001'; end if;
  update public.care_cards set status = '已停用', end_at = now(), end_note = n, updated_by = auth.uid(), updated_at = now() where id = k.id;
  perform public.log_action(c.id, '停用照顧摘要卡第 ' || k.v || ' 版：' || n, false);
end $$;

-- 重新開放：依據資料已變更時，畫面會要求改用「修訂內容」（依規則 cardChanged 判斷）
create or replace function public.resume_care_card(p_case uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.nurse_case_for_update(p_case); k public.care_cards;
begin
  if not public.case_can_process(c) then raise exception '案件已結案或授權已撤回，不能開放' using errcode = 'P0001'; end if;
  select * into k from public.care_cards where case_id = c.id and status = '已停用' order by v desc limit 1 for update;
  if k.id is null then raise exception '摘要卡目前不是停用狀態' using errcode = 'P0001'; end if;
  update public.care_cards set status = '已開放', end_at = null, end_note = null, updated_by = auth.uid(), updated_at = now() where id = k.id;
  perform public.log_action(c.id, '重新開放照顧摘要卡第 ' || k.v || ' 版', false);
end $$;

-- 讀取：承辦護理師需要草稿與歷史版本的完整內容（get_case_models 只回傳摘要卡的狀態）
create or replace function public.case_cards(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_case_nurse(p_case) then raise exception '只有承辦護理師可以查看摘要卡內容' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'v', k.v, 'status', k.status, 'content', k.content, 'opened_by', k.opened_by, 'opened_at', k.opened_at,
      'end_at', k.end_at, 'end_note', k.end_note, 'caregivers', (select coalesce(jsonb_agg(g.caregiver_id), '[]') from public.care_card_caregivers g where g.card_id = k.id)) order by k.v), '[]')
    from public.care_cards k where k.case_id = p_case);
end $$;

-- 照服員：開放給自己的卡（已開放或已停用、案件未結案）。p_user 由 Edge Function 傳入（已確認登入者身分）
create or replace function public.my_care_card(p_user uuid, p_case uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('card_id', k.id, 'v', k.v, 'status', k.status, 'content', case when k.status = '已開放' then k.content end,
      'opened_at', k.opened_at, 'opened_by_name', (select name from public.profiles where id = k.opened_by), 'end_at', k.end_at, 'end_note', k.end_note,
      'patient_name', rs.name, 'planned_admit', c.planned_admit)
  from public.care_cards k join public.cases c on c.id = k.case_id join public.residents rs on rs.id = c.resident_id
  where k.case_id = p_case and k.status in ('已開放','已停用') and c.closed_at is null and c.archived_at is null
    and exists (select 1 from public.care_card_caregivers g where g.card_id = k.id and g.caregiver_id = p_user)
    and exists (select 1 from public.profiles p where p.id = p_user and p.role = 'care' and p.status = '啟用')
  order by k.v desc limit 1
$$;

revoke execute on function public.dx_synced(uuid), public.card_allowed(public.cases), public.check_caregivers(uuid[]), public.my_care_card(uuid, uuid) from public, anon, authenticated;
grant execute on function public.dx_synced(uuid), public.my_care_card(uuid, uuid) to service_role;
revoke execute on function public.open_care_card(uuid, int, jsonb, jsonb, uuid[]), public.revise_care_card(uuid, int, jsonb), public.discard_care_card(uuid, int),
  public.stop_care_card(uuid, text), public.resume_care_card(uuid), public.case_cards(uuid) from public, anon;
grant execute on function public.open_care_card(uuid, int, jsonb, jsonb, uuid[]), public.revise_care_card(uuid, int, jsonb), public.discard_care_card(uuid, int),
  public.stop_care_card(uuid, text), public.resume_care_card(uuid), public.case_cards(uuid) to authenticated;
