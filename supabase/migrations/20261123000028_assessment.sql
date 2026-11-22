-- 階段 7：護理核對與評估（assessment.html）
-- HANDOFF 6.1、8.4（set_care_need、nurse_confirm_document、submit/review_habit、save_assessment）、10.5（習慣卡）、10.6（醫療內容核對與診斷清單）
--
-- 內容：
--   1. 資料表補欄位：
--      document_versions：review（逐欄核對紀錄）、review_src（整份來源說明）、labs（檢驗數值結構化）、dx_rows（病摘逐筆診斷）——都是「核對完成當時的快照」
--      diagnoses：std（標準化名稱）、source_row（病摘第幾筆）、superseded_at（被新版取代）、confirmed_by／at、added_by／at
--      assessments：dnr_state、dnr_src（DNR／預立醫療決定另行確認）；需補充時指定的文件另存 assessment_items（外鍵到文件）
--   2. 共用判斷：docs_ready()（原型 docsReady）、habit_gate()（原型 habitGate 的資料庫可檢查部分）
--   3. 寫入 RPC（全部只限承辦護理師）：
--      set_nurse_need（管路／傷口／吞嚥是否需要；需要時自動建立補件，改判不需要時關閉未完成的補件）
--      save_review_draft、complete_review、return_document（醫療內容逐欄核對、完成、退回補件）
--      save_supp（護理補充評估：醫院沒有提供獨立紀錄時）
--      dx_import、dx_save、dx_resync（診斷清單）
--      review_habit（習慣卡初審）
--      save_assessment（收治評估／入住前護理確認；每次送出前重新檢查前置條件）
--   4. 文件狀態改變後（after_doc_change）：先簽約且文件齊全時記錄「入住前文件確認完成」（原型 ensureCard 的前半段；摘要卡在階段 8）
--   5. get_case_models 回傳診斷的完整欄位與評估指定的補充文件

-- ===================== 1. 資料表 =====================
alter table public.document_versions
  add column review jsonb,          -- 每欄：原始值、確認值、來源（AI／人工）、確認人與時間、歷程（原型 v.review）
  add column review_src text,       -- 整份來源：AI 辨識＋人工核對、人工輸入＋人工核對…（原型 v.reviewSrc）
  add column labs jsonb,            -- 檢驗數值：項目、數值、單位、參考區間、異常（原型 v.labs，日後轉 FHIR Observation）
  add column dx_rows jsonb;         -- 病摘主要診斷逐筆核對結果 {raw, absent, rows}（原型 v.dxRows；診斷清單同步依據）
comment on column public.document_versions.review is '護理核對完成當時的逐欄紀錄（快照，不再修改）';

alter table public.diagnoses
  add column std text,                                        -- 標準化診斷名稱（照護摘要使用；沒有時用原始文字）
  add column source_row int,                                  -- 來自病摘第幾筆
  add column superseded_at timestamptz,                       -- 同一份病摘有新版本核對完成後，舊版本帶入的診斷標示「已由新版取代」（不刪除）
  add column confirmed_by uuid references public.profiles(id), add column confirmed_at timestamptz,
  add column added_by uuid references public.profiles(id), add column added_at timestamptz not null default now();
alter table public.diagnoses add constraint diagnoses_confirmed check ((confirmed_by is null) = (confirmed_at is null));
alter table public.diagnoses add constraint diagnoses_icd_format check (icd_code is null or icd_code ~ '^[A-TV-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$');
comment on column public.diagnoses.text is '原始診斷文字（來自文件時不能修改）';

alter table public.assessments add column dnr_state text, add column dnr_src text;
alter table public.assessments add constraint assessments_dnr check (dnr_state is null or dnr_state in ('尚未另行確認','已確認：有簽署文件','已確認：未簽署'));
alter table public.assessments add constraint assessments_dnr_src check (dnr_state is null or dnr_state = '尚未另行確認' or coalesce(btrim(dnr_src), '') <> '');
create table public.assessment_items (           -- 評估「需補充」時指定的文件
  assessment_id bigint not null references public.assessments(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  primary key (assessment_id, document_id)
);
alter table public.assessment_items enable row level security;
grant select on public.assessment_items to authenticated;
grant all on public.assessment_items to service_role;
create policy assessment_items_read on public.assessment_items for select to authenticated using (
  exists (select 1 from public.assessments a where a.id = assessment_id and (public.is_family_of(a.case_id) or public.auth_role() = 'staff' or public.is_case_nurse(a.case_id))));

-- ===================== 2. 共用判斷 =====================
-- 承辦護理師、啟用中；鎖定案件（同一案件的寫入依序進行）
create or replace function public.nurse_case_for_update(p_case uuid) returns public.cases
language plpgsql security definer set search_path = '' as $$
declare c public.cases;
begin
  if public.auth_role() is distinct from 'nurse' then raise exception '只有承辦護理師可以執行這項專業工作' using errcode = '42501'; end if;
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception '找不到這個案件' using errcode = 'P0002'; end if;
  if c.nurse_id is distinct from auth.uid() then raise exception '您不是這位住民的負責護理師' using errcode = '42501'; end if;
  return c;
end $$;

-- 文件已齊全（原型 docsReady）：目前階段要追蹤的文件（契約除外）全部完成，而且沒有尚未判斷的條件式文件
create or replace function public.docs_ready(p_case uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.documents d join public.cases c on c.id = d.case_id
    where d.case_id = p_case and d.deleted_at is null and d.key <> 'contract'
      and public.doc_stage_active(d, c) and not public.doc_na(d)
      and (public.doc_needed(d) or (d.need = '條件式必備' and d.cond_met is null) or exists (select 1 from public.document_versions v where v.document_id = d.id))
      and (not public.doc_done(d.id) or (d.need = '條件式必備' and d.cond_met is null and not d.not_applicable)))
$$;

-- 習慣卡初審通過（原型 habitGate 中資料庫可以檢查的部分）：最新一次正式提交已「審核完成」。
-- 「審核完成後已確認醫療資料改變，需重新確認」由畫面依同一套規則判斷（rules/core.js habitState），這裡不重複
create or replace function public.habit_gate(p_case uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select h.state = '審核完成' and h.rev = (select max(rev) from public.habit_submissions where case_id = p_case)
    from public.habit_reviews h where h.case_id = p_case and h.state <> '護理已閱' order by h.reviewed_at desc, h.id desc limit 1), false)
$$;

-- 文件狀態改變後：沿用階段 6 的處理（確認過期 → 系統補件；確認符合 → 關閉補件），另外記錄入住前文件確認完成
create or replace function public.after_doc_change(p_doc uuid) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare d public.documents; c public.cases; st text := public.doc_status(p_doc); due date; rid uuid; q public.document_requests;
begin
  select * into d from public.documents where id = p_doc;
  select * into c from public.cases where id = d.case_id;
  if st = '確認過期' then
    due := public.today_tw() + public.req_days();
    rid := public.new_request(d.id, '系統', '日期超過期限', null, due);
    perform public.notify_family(c.id, '「' || public.fam_doc_name(d) || '」日期已超過期限，請做 ' || public.md_tw(c.planned_admit - d.valid_days) || ' 以後的檢查，並在 ' || public.md_tw(due) || ' 前重新上傳。');
    return array[rid];
  end if;
  if st in ('確認符合','即將到期','不需要','已登錄簽約') then
    q := public.open_request(d.id);
    if q.id is not null then
      update public.document_requests set closed_at = now(), closed_by = auth.uid(), closed_reason = '文件已確認符合' where id = q.id;
      perform public.log_action(c.id, d.name || ' 補件請求已關閉（文件已確認符合）', false);
    end if;
  end if;
  /* 原型 ensureCard：已簽約、文件齊全時記錄一次「入住前文件確認完成」（處理歷程使用） */
  if c.signed_at is not null and c.pre_docs_done_at is null and public.case_can_process(c) and public.docs_ready(c.id) then
    update public.cases set pre_docs_done_at = now() where id = c.id;
    perform public.log_action(c.id, '入住前文件確認完成');
  end if;
  return '{}';
end $$;

-- ===================== 3-1 照護文件需求判斷（管路、傷口、吞嚥；原型 need-edit＋syncNurseNeedReq） =====================
-- p_met：true 本案需要／false 本案不需要／null 尚待確認
create or replace function public.set_nurse_need(p_doc uuid, p_met boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.documents; c public.cases; n text := btrim(coalesce(p_note, '')); before text; after text; v public.document_versions;
  q public.document_requests; due date; reqs uuid[] := '{}'; msg text := ''; accepted boolean; ask_open boolean; why text; wh text;
begin
  select x.* into d from public.documents x where x.id = p_doc and x.deleted_at is null;
  if not found then raise exception '找不到這份文件' using errcode = 'P0002'; end if;
  c := public.nurse_case_for_update(d.case_id);
  select * into d from public.documents where id = p_doc for update;
  if not public.case_can_process(c) then raise exception '資料授權無效或案件已結案' using errcode = 'P0001'; end if;
  if not d.nurse_decides or d.need <> '條件式必備' then raise exception '這份文件不是由護理判斷的「視情況繳交」文件' using errcode = 'P0001'; end if;
  if p_met is false and n = '' then raise exception '選「本案不需要」時請寫簡短原因' using errcode = '22023'; end if;
  before := case when d.cond_met is true then '護理已確認：需要' when d.cond_met is false then '護理已確認：不需要' else '待護理確認' end;
  after := case when p_met is true then '護理已確認：需要' when p_met is false then '護理已確認：不需要' else '待護理確認' end;
  ask_open := exists (select 1 from public.document_need_asks where document_id = d.id and done_at is null);
  if d.cond_met is not distinct from p_met and (n = '' or n = coalesce((select note from public.document_need_changes where document_id = d.id order by at desc, id desc limit 1), '')) then
    raise exception '%', case when ask_open then '判斷沒有變更：要維持原判斷，請在備註寫下回覆行政的原因' else '判斷沒有變更' end using errcode = 'P0001';
  end if;
  update public.documents set cond_met = p_met where id = d.id;
  insert into public.document_need_changes (document_id, from_text, to_text, by, role, note) values (d.id, before, after, auth.uid(), 'nurse', n);
  update public.document_need_asks set done_at = now(), done_by = auth.uid() where document_id = d.id and done_at is null;
  perform public.log_action(c.id, d.name || '：' || before || ' → ' || after || coalesce('（' || nullif(n, '') || '）', ''));
  select * into d from public.documents where id = d.id;
  v := public.doc_cur(d.id);
  accepted := v.id is not null and public.doc_status(d.id) not in ('需補件','確認過期');
  q := public.open_request(d.id);
  if public.doc_needed(d) and public.doc_stage_active(d, c) and not accepted then
    /* 判斷需要、目前階段、家屬還沒有可用的文件 → 自動建立正式補件（已有開啟中的就不重複） */
    if q.id is null then
      due := public.today_tw() + public.req_days();
      reqs := array[public.new_request(d.id, '護理判斷', '護理師確認需要提供', null, due, true)];
      wh := coalesce(nullif((select "where" from public.doc_catalog where key = d.catalog_key), ''), d.custom_where, '請洽本中心');
      perform public.notify_family(c.id, '護理師確認需要提供「' || public.fam_doc_name(d) || '」，請在 ' || public.md_tw(due) || ' 前上傳。準備方式：' || replace(wh, '長輩', '住民'));
      perform public.log_action(c.id, '系統依護理判斷自動建立補件要求：' || d.name || '（期限 ' || to_char(due, 'YYYY/MM/DD') || '），已通知家屬');
      msg := '系統已自動建立補件要求並通知家屬';
    end if;
  elsif not public.doc_needed(d) and q.id is not null and v.id is null then
    /* 改判不需要或尚待確認：關閉尚未完成的補件 */
    why := case when public.doc_na(d) then '護理改判為本案不需要' else '護理改為尚待確認' end;
    update public.document_requests set closed_at = now(), closed_by = auth.uid(), closed_reason = why where id = q.id;
    perform public.notify_family(c.id, case when public.doc_na(d) then '「' || public.fam_doc_name(d) || '」經護理師確認目前不需要提供，您不用再上傳。'
      else '「' || public.fam_doc_name(d) || '」護理師還在確認是否需要，目前先不用上傳，確認後會再通知您。' end);
    perform public.log_action(c.id, d.name || '：' || why || '，關閉尚未完成的補件要求並通知家屬');
    msg := '已關閉尚未完成的補件要求並通知家屬';
  end if;
  perform public.after_doc_change(d.id);
  return jsonb_build_object('requests', to_jsonb(reqs), 'message', msg);
end $$;

-- ===================== 3-2 醫療內容逐欄核對 =====================
-- 核對草稿：依「文件＋版本」分開保存，換版本不沿用（HANDOFF 10.6）
create or replace function public.save_review_draft(p_doc uuid, p_v int, p_data jsonb) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare d public.documents; c public.cases; v public.document_versions; t timestamptz;
begin
  select x.* into d from public.documents x where x.id = p_doc and x.deleted_at is null;
  if not found then raise exception '找不到這份文件' using errcode = 'P0002'; end if;
  c := public.nurse_case_for_update(d.case_id);
  if not public.case_can_process(c) then raise exception '資料授權無效或案件已結案' using errcode = 'P0001'; end if;
  v := public.doc_cur(d.id);
  if v.id is null or v.v <> p_v then raise exception '文件已有新版本或已被移除，請重新開啟' using errcode = 'P0001'; end if;
  if coalesce(v.nurse_ok, false) then raise exception '這個版本已完成核對' using errcode = 'P0001'; end if;
  insert into public.review_drafts (document_id, version_v, data, updated_by) values (d.id, p_v, coalesce(p_data, '{}'), auth.uid())
    on conflict (document_id, version_v) do update set data = excluded.data, updated_by = excluded.updated_by, updated_at = now()
    returning updated_at into t;
  return t;
end $$;

-- 病摘逐筆診斷同步到診斷清單（原型 syncDiagnoses）：同一文件舊版本帶入的診斷標示「已由新版取代」（不刪除），本版本已確認的逐筆加入
create or replace function public.sync_diagnoses(p_doc uuid, p_v int) returns int
language plpgsql security definer set search_path = '' as $$
declare d public.documents; v public.document_versions; r jsonb; n int := 0; nid uuid;
begin
  select * into d from public.documents where id = p_doc;
  select * into v from public.document_versions where document_id = p_doc and document_versions.v = p_v;
  if v.dx_rows is null or coalesce((v.dx_rows->>'absent')::boolean, false) then return 0; end if;
  update public.diagnoses set superseded_at = now(), updated_at = now() where source_document = d.id and source_version <> p_v and superseded_at is null;
  for r in select * from jsonb_array_elements(coalesce(v.dx_rows->'rows', '[]')) loop
    if r->>'state' = '已確認' and not exists (select 1 from public.diagnoses where source_document = d.id and source_version = p_v and source_row = (r->>'n')::int) then
      insert into public.diagnoses (case_id, text, std, status, source_document, source_version, source_row, confirmed_by, confirmed_at, added_by, synced_at)
        values (d.case_id, coalesce(nullif(r->>'raw', ''), r->>'text'), r->>'text', '已確認', d.id, p_v, (r->>'n')::int, auth.uid(), now(), auth.uid(), now())
        returning id into nid;
      insert into public.diagnosis_changes (diagnosis_id, to_status, text_after, reason, by) values (nid, '已確認', r->>'text', '由病摘逐筆核對帶入（已確認）', auth.uid());
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- 完成核對（原型 review-done）：逐欄確認的內容寫入 medical_facts（每欄一列），版本標示護理核對完成並保存核對紀錄；
-- 病摘的逐筆診斷在同一個交易內同步到診斷清單；完成後才刪除草稿。
--   p_fields：{欄位 key: 確認值}；p_review：逐欄核對紀錄；p_labs：檢驗數值；p_dx：{raw, absent, rows}
create or replace function public.complete_review(p_doc uuid, p_v int, p_fields jsonb, p_review jsonb, p_review_src text, p_labs jsonb, p_dx jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.documents; c public.cases; v public.document_versions; k text; val text; n int := 0; reqs uuid[];
begin
  select x.* into d from public.documents x where x.id = p_doc and x.deleted_at is null;
  if not found then raise exception '找不到這份文件' using errcode = 'P0002'; end if;
  c := public.nurse_case_for_update(d.case_id);
  select * into d from public.documents where id = p_doc for update;
  if not public.case_can_process(c) then raise exception '授權無效或案件已結案，不能完成核對' using errcode = 'P0001'; end if;
  v := public.doc_cur(d.id);
  if v.id is null or v.v <> p_v or public.doc_status(d.id) <> '待護理核對' then raise exception '文件狀態已改變（可能有新版本），請重新開啟' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_fields) <> 'object' or p_fields = '{}'::jsonb then raise exception '沒有核對內容' using errcode = '22023'; end if;
  if p_dx is not null and not coalesce((p_dx->>'absent')::boolean, false)
     and exists (select 1 from jsonb_array_elements(coalesce(p_dx->'rows', '[]')) r where r->>'state' not in ('已確認','不採用')) then
    raise exception '還有診斷尚未確認' using errcode = 'P0001';
  end if;
  for k, val in select key, value from jsonb_each_text(p_fields) loop
    insert into public.medical_facts (document_id, version_v, field, value, confirmed_by) values (d.id, p_v, k, coalesce(val, ''), auth.uid());
    n := n + 1;
  end loop;
  update public.document_versions set nurse_ok = true, nurse_by = auth.uid(), nurse_at = now(),
    review = p_review, review_src = nullif(btrim(coalesce(p_review_src, '')), ''), labs = nullif(p_labs, '{}'::jsonb), dx_rows = p_dx
    where id = v.id;
  perform public.sync_diagnoses(d.id, p_v);
  delete from public.review_drafts where document_id = d.id and version_v = p_v;
  perform public.log_action(c.id, d.name || ' 第 ' || p_v || ' 版護理核對完成（' || coalesce(nullif(btrim(p_review_src), ''), '人工核對') || '）');
  reqs := public.after_doc_change(d.id);
  return jsonb_build_object('status', public.doc_status(d.id), 'facts', n, 'requests', to_jsonb(reqs));
end $$;

-- 文件有問題，退回請家屬補件（原型 review-return）
create or replace function public.return_document(p_doc uuid, p_v int, p_reason text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.documents; c public.cases; v public.document_versions; due date; rid uuid; note text := btrim(coalesce(p_note, ''));
begin
  select x.* into d from public.documents x where x.id = p_doc and x.deleted_at is null;
  if not found then raise exception '找不到這份文件' using errcode = 'P0002'; end if;
  c := public.nurse_case_for_update(d.case_id);
  select * into d from public.documents where id = p_doc for update;
  if not public.case_can_process(c) then raise exception '授權無效或案件已結案' using errcode = 'P0001'; end if;
  if p_reason not in ('文件模糊，看不清楚','缺少頁面','內容前後矛盾','疑似不是本人的資料') then raise exception '請選擇原因' using errcode = '22023'; end if;
  v := public.doc_cur(d.id);
  if v.id is null or v.v <> p_v or public.doc_status(d.id) <> '待護理核對' then raise exception '文件狀態已改變' using errcode = 'P0001'; end if;
  due := public.today_tw() + public.req_days();
  insert into public.document_returns (document_id, version_v, by, reason, note_for_family) values (d.id, v.v, auth.uid(), p_reason, nullif(note, ''));
  rid := public.new_request(d.id, '護理', p_reason, note, due);
  delete from public.review_drafts where document_id = d.id and version_v = p_v;
  perform public.log_action(c.id, d.name || ' 退回補件：' || p_reason || '（期限 ' || to_char(due, 'YYYY/MM/DD') || '）');
  perform public.notify_family(c.id, '請在 ' || public.md_tw(due) || ' 前重新上傳「' || public.fam_doc_name(d) || '」：' || p_reason);
  return jsonb_build_object('due', due, 'requests', to_jsonb(array[rid]));
end $$;

-- ===================== 3-3 護理補充評估（原型 suppForm） =====================
-- 醫院沒有提供獨立紀錄時：護理依其他來源核實或評估，記錄來源與確認人；標示「護理補充評估」，不當成醫院文件
create or replace function public.save_supp(p_doc uuid, p_src text, p_note text, p_fields jsonb, p_review jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.documents; c public.cases; nv int; k text; val text; note text := btrim(coalesce(p_note, '')); reqs uuid[];
begin
  select x.* into d from public.documents x where x.id = p_doc and x.deleted_at is null;
  if not found then raise exception '找不到這份文件' using errcode = 'P0002'; end if;
  c := public.nurse_case_for_update(d.case_id);
  select * into d from public.documents where id = p_doc for update;
  if not public.case_can_process(c) or d.cat <> 'D' or not public.doc_needed(d) or public.doc_status(d.id) not in ('未上傳','需補件') then
    raise exception '這份文件目前不能做護理補充評估（只限需要繳交、尚未上傳或需補件的照護紀錄）' using errcode = 'P0001';
  end if;
  if p_src not in ('電話詢問來源醫院護理站','入住前訪視或評估','與家屬會談','其他已上傳文件內容（請註明）') then raise exception '請選擇資料來源' using errcode = '22023'; end if;
  if note = '' then raise exception '請寫下來源說明（例如聯絡的單位與人員、參考的文件）' using errcode = '22023'; end if;
  if jsonb_typeof(p_fields) <> 'object' or p_fields = '{}'::jsonb or exists (select 1 from jsonb_each_text(p_fields) e where btrim(coalesce(e.value, '')) = '') then
    raise exception '每個欄位都要填寫；沒有資料請寫「未提供」或「未知」' using errcode = '22023';
  end if;
  nv := coalesce((select max(v) from public.document_versions where document_id = d.id), 0) + 1;
  insert into public.document_versions (document_id, v, uploaded_by, phase, id_checked_by, id_checked_at, id_check_how, supp_src, supp_note, nurse_ok, nurse_by, nurse_at, review, review_src)
    values (d.id, nv, auth.uid(), 'checked', auth.uid(), now(), '護理補充評估（沒有獨立文件，不需身分比對）', p_src, note, true, auth.uid(), now(), p_review, '護理補充評估（' || p_src || '）');
  for k, val in select key, value from jsonb_each_text(p_fields) loop
    insert into public.medical_facts (document_id, version_v, field, value, confirmed_by) values (d.id, nv, k, btrim(val), auth.uid());
  end loop;
  perform public.log_action(c.id, d.name || ' 第 ' || nv || ' 版：護理補充評估（' || p_src || '；' || note || '）');
  reqs := public.after_doc_change(d.id);
  return jsonb_build_object('v', nv, 'status', public.doc_status(d.id));
end $$;

-- ===================== 3-4 診斷清單（原型 dx-import、dx-edit、dx-resync） =====================
-- 從已確認的病摘帶入原始診斷（待確認）；p_parts 由畫面依標點拆好，只加入還沒有的
create or replace function public.dx_import(p_case uuid, p_doc uuid, p_v int, p_parts text[]) returns int
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.nurse_case_for_update(p_case); p text; n int := 0; nid uuid;
begin
  if not public.case_can_process(c) then raise exception '資料授權無效或案件已結案' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.document_versions v join public.documents d on d.id = v.document_id where d.id = p_doc and d.case_id = c.id and v.v = p_v and v.nurse_ok) then
    raise exception '沒有已確認的病摘診斷可以帶入' using errcode = 'P0001'; end if;
  foreach p in array coalesce(p_parts, '{}') loop
    p := btrim(p);
    if p <> '' and not exists (select 1 from public.diagnoses where case_id = c.id and text = p) then
      insert into public.diagnoses (case_id, text, status, source_document, source_version, added_by) values (c.id, p, '待確認', p_doc, p_v, auth.uid()) returning id into nid;
      insert into public.diagnosis_changes (diagnosis_id, to_status, text_after, reason, by) values (nid, '待確認', p, '由病摘帶入', auth.uid());
      n := n + 1;
    end if;
  end loop;
  if n = 0 then raise exception '這些診斷已經帶入過了' using errcode = 'P0001'; end if;
  perform public.log_action(c.id, '由病摘帶入原始診斷 ' || n || ' 筆（待確認）', false);
  return n;
end $$;

-- 新增或編輯一筆診斷：ICD-10-CM 只檢查格式（系統沒有碼表、不自動產生代碼）；p_expect_text 防止同時修改
create or replace function public.dx_save(p_case uuid, p_id uuid, p_expect_text text, p_raw text, p_std text, p_icd text, p_icd_name text, p_ok boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.nurse_case_for_update(p_case); g public.diagnoses; raw text := btrim(coalesce(p_raw, '')); icd text := nullif(upper(btrim(coalesce(p_icd, ''))), ''); nid uuid;
begin
  if not public.case_can_process(c) then raise exception '您不是承辦護理師或案件已結案' using errcode = 'P0001'; end if;
  if icd is not null and icd !~ '^[A-TV-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$' then raise exception 'ICD-10-CM 代碼格式不正確（例：I69.354、E11.9）' using errcode = '22023'; end if;
  if icd is not null and btrim(coalesce(p_icd_name, '')) = '' then raise exception '填寫代碼時請一併填寫 ICD-10-CM 名稱，方便核對' using errcode = '22023'; end if;
  if p_id is null then
    if raw = '' then raise exception '請填寫原始診斷文字' using errcode = '22023'; end if;
    insert into public.diagnoses (case_id, text, std, icd_code, icd_name, status, confirmed_by, confirmed_at, added_by)
      values (c.id, raw, nullif(btrim(coalesce(p_std, '')), ''), icd, nullif(btrim(coalesce(p_icd_name, '')), ''), case when p_ok then '已確認' else '待確認' end,
        case when p_ok then auth.uid() end, case when p_ok then now() end, auth.uid()) returning id into nid;
    insert into public.diagnosis_changes (diagnosis_id, to_status, text_after, reason, by) values (nid, case when p_ok then '已確認' else '待確認' end, raw, '人工新增', auth.uid());
  else
    select * into g from public.diagnoses where id = p_id and case_id = c.id for update;
    if not found or g.text is distinct from p_expect_text then raise exception '診斷清單已被修改，請重新整理' using errcode = 'P0001'; end if;
    update public.diagnoses set text = case when g.source_document is null and raw <> '' then raw else g.text end,
      std = nullif(btrim(coalesce(p_std, '')), ''), icd_code = icd, icd_name = nullif(btrim(coalesce(p_icd_name, '')), ''),
      status = case when p_ok then '已確認' else '待確認' end, confirmed_by = case when p_ok then auth.uid() end, confirmed_at = case when p_ok then now() end, updated_at = now()
      where id = g.id;
    insert into public.diagnosis_changes (diagnosis_id, from_status, to_status, text_before, text_after, reason, by)
      values (g.id, g.status, case when p_ok then '已確認' else '待確認' end, coalesce(g.std, g.text), coalesce(nullif(btrim(coalesce(p_std, '')), ''), g.text), case when p_ok then '人工確認' else '修改（待確認）' end, auth.uid());
    nid := g.id;
  end if;
  perform public.log_action(c.id, '診斷' || case when p_id is null then '新增' else '更新' end || '：' || coalesce(nullif(raw, ''), (select text from public.diagnoses where id = nid))
    || coalesce('（' || icd || '）', '') || '，' || case when p_ok then '已確認' else '待確認' end, false);
  return nid;
end $$;

-- 重試同步診斷（原型 dx-resync）：最近一次完成核對的病摘，逐筆診斷沒有完整進入診斷清單時
create or replace function public.dx_resync(p_case uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.nurse_case_for_update(p_case); v public.document_versions; n int;
begin
  if not public.case_can_process(c) then raise exception '資料授權無效或案件已結案' using errcode = 'P0001'; end if;
  select x.* into v from public.document_versions x join public.documents d on d.id = x.document_id
    where d.case_id = c.id and d.key = 'summary' and x.nurse_ok order by x.v desc limit 1;
  if v.id is null then raise exception '沒有需要同步的病摘診斷' using errcode = 'P0001'; end if;
  n := public.sync_diagnoses(v.document_id, v.v);
  perform public.log_action(c.id, '診斷清單同步完成（補入 ' || n || ' 筆）', false);
  return n;
end $$;

-- ===================== 3-5 習慣卡初審（原型 habit-review） =====================
-- p_state：審核完成／有疑義／護理已閱。p_rev：畫面看到的提交版本（家屬剛重新提交就擋下）。
-- 審核完成時保存當時的習慣卡內容（以資料庫的正式提交為準）與相關已確認醫療資料（p_med，畫面依規則整理），之後只需確認變更項目。
-- p_diff_res：與已確認醫療資料不一致的項目與處理說明（已確認資料不會被覆蓋），審核完成時每項都要有說明
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
      case when p_state = '審核完成' then p_med end, case when p_state = '審核完成' then sub end, auth.uid());
  perform public.log_action(c.id, case when p_state = '審核完成' then '習慣卡審核完成（家屬第 ' || latest || ' 次修改）' || coalesce('（' || nullif(note, '') || '）', '')
    when p_state = '有疑義' then '習慣卡標示有疑義／待確認：' || note else '習慣卡護理已閱（閱讀紀錄）' || coalesce('：' || nullif(note, ''), '') end);
end $$;

-- ===================== 3-6 收治評估／入住前護理確認（原型 assessForm、assessGuard） =====================
-- 每次送出前重新檢查前置條件（HANDOFF 8.4）：承辦護理、授權有效、沒有利益衝突、文件齊全、習慣卡初審通過、先簽後審已簽約、目前在評估階段。
-- 需補充：指定文件退回或建立補件（全部在同一個交易內）；不收治：結案並通知家屬
create or replace function public.save_assessment(p_case uuid, p_result text, p_move text, p_behav text, p_iso text, p_dnr_state text, p_dnr_src text,
  p_reason text, p_docs uuid[], p_other text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.nurse_case_for_update(p_case); a public.assessments := public.current_assessment(p_case); cf text := public.self_conflict(p_case, auth.uid());
  reason text := btrim(coalesce(p_reason, '')); other text := btrim(coalesce(p_other, '')); pass text; mode text; aid bigint; d public.documents; v public.document_versions;
  due date; reqs uuid[] := '{}'; nid uuid; before text; names text[] := '{}';
begin
  if not public.case_can_process(c) then raise exception '資料授權無效或案件已結案，不能評估' using errcode = 'P0001'; end if;
  if cf <> '' then raise exception '請由其他護理師評估：%。%', cf, public.conflict_note() using errcode = '42501'; end if;
  pass := case when c.flow_mode = '先審後簽' then '收治' else '可入住' end;
  mode := case when c.flow_mode = '先審後簽' then '收治評估' else '入住前確認' end;
  if (c.flow_mode = '先審後簽' and p_result not in ('收治','需補充','待協調','不收治'))
     or (c.flow_mode = '先簽後審' and p_result not in ('可入住','需補充','待協調','不符合收治條件')) then
    raise exception '「%」流程不能選「%」', c.flow_mode, coalesce(p_result, '') using errcode = '22023'; end if;
  if not public.docs_ready(c.id) then raise exception '必要文件尚未全部確認符合，不能評估' using errcode = 'P0001'; end if;
  if a.id is null and not public.habit_gate(c.id) then raise exception '生活與照護習慣卡尚未完成必要初審（家屬正式提交、護理初審完成），不能開始收治評估' using errcode = 'P0001'; end if;
  if c.flow_mode = '先簽後審' and c.signed_at is null then raise exception '先簽後審的案件尚未記錄入住契約，不能做入住前確認' using errcode = 'P0001'; end if;
  if a.id is not null and a.result <> '需補充' then raise exception '案件目前不在評估階段（已有評估結果：%）', a.result using errcode = 'P0001'; end if;
  if p_result <> pass and reason = '' then raise exception '請填寫說明' using errcode = '22023'; end if;
  if p_dnr_state like '已確認%' and btrim(coalesce(p_dnr_src, '')) = '' then raise exception '選擇 DNR「已確認」時，請填寫確認來源' using errcode = '22023'; end if;
  if p_result = '需補充' and coalesce(array_length(p_docs, 1), 0) = 0 and other = '' then raise exception '請勾選要補充的文件，或填寫其他資料名稱' using errcode = '22023'; end if;
  if p_result = '需補充' and exists (select 1 from unnest(p_docs) x where not exists (select 1 from public.documents y where y.id = x and y.case_id = c.id and y.cat in ('B','C','D') and y.deleted_at is null)) then
    raise exception '只能指定這位住民的健康檢查、醫療或照護文件' using errcode = 'P0001'; end if;

  insert into public.assessments (case_id, mode, result, move, behav, iso, reason, dnr_state, dnr_src, by)
    values (c.id, mode, p_result, p_move, p_behav, p_iso, nullif(reason, ''), coalesce(p_dnr_state, '尚未另行確認'), nullif(btrim(coalesce(p_dnr_src, '')), ''), auth.uid())
    returning id into aid;
  if p_result = '需補充' then
    due := public.today_tw() + public.req_days();
    for d in select * from public.documents where id = any(p_docs) order by sort for update loop
      v := public.doc_cur(d.id);
      if v.id is not null then insert into public.document_returns (document_id, version_v, by, reason, note_for_family) values (d.id, v.v, auth.uid(), '護理師需要補充資料', reason); end if;
      reqs := reqs || public.new_request(d.id, '護理', '護理師需要補充資料', reason, due);
      if d.nurse_decides and d.need = '條件式必備' and d.cond_met is not true then
        before := case when d.cond_met is false then '護理已確認：不需要' else '待護理確認' end;
        update public.documents set cond_met = true where id = d.id;
        insert into public.document_need_changes (document_id, from_text, to_text, by, role, note) values (d.id, before, '護理已確認：需要', auth.uid(), 'nurse', '收治評估要求補充：' || reason);
      end if;
      insert into public.assessment_items (assessment_id, document_id) values (aid, d.id);
      names := names || d.name;
    end loop;
    if other <> '' then
      insert into public.documents (case_id, key, cat, name, fam_name, stage, need, medical, sort, custom_why, custom_where)
        values (c.id, 'extra_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10), 'G', other, other, '評估前', '必備', true,
          50 + (select count(*) from public.documents where case_id = c.id), '護理師評估時需要這份資料：' || reason, '請向住民就醫的醫院或診所索取')
        returning id into nid;
      reqs := reqs || public.new_request(nid, '護理', '護理師需要補充資料', reason, due);
      insert into public.assessment_items (assessment_id, document_id) values (aid, nid);
      names := names || other;
    end if;
  end if;
  if p_result = '不收治' then
    update public.cases set closed_at = now(), closed_by = auth.uid(), closed_title = '很抱歉，本中心目前無法提供合適的照顧',
      closed_text = '原因：' || reason || '。承辦人會協助您了解其他長照資源，也可以撥打長照專線 1966。', closed_reason = '不收治：' || reason, closed_type = '不收治', updated_at = now()
      where id = c.id;
  end if;
  perform public.log_action(c.id, '評估結果：' || p_result || coalesce('（' || nullif(reason, '') || '）', '') || case when p_result = '需補充' then '，指定補件：' || array_to_string(names, '、') else '' end);
  perform public.notify_family(c.id, case p_result
    when '收治' then '好消息：住民已通過評估，請來電預約參訪與簽約'
    when '不收治' then '機構已完成評估，請登入查看結果'
    when '需補充' then '護理師需要補充資料，請在 ' || public.md_tw(due) || ' 前登入上傳'
    when '可入住' then '入住前確認完成，照顧團隊正在準備'
    else '機構需要和您討論入住安排，承辦人會與您聯絡' end);
  return jsonb_build_object('id', aid, 'requests', to_jsonb(reqs));
end $$;

-- ===================== 4. 讀取：診斷完整欄位、評估指定的補充文件 =====================
create or replace function public.get_case_models(p_case uuid default null, p_include_closed boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r text := coalesce(public.auth_role(), case when auth.role() = 'service_role' then 'staff' end);
  out jsonb;
begin
  if r is null or r = 'care' then raise exception '沒有權限' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(m order by m->'case'->>'created_at', m->'case'->>'id'), '[]'::jsonb) into out from (
    select jsonb_build_object(
      'full', v.is_full,
      'case', to_jsonb(c),
      'resident', to_jsonb(rs),
      'assignments', (select coalesce(jsonb_agg(to_jsonb(a) order by a.at nulls first, a.id), '[]') from public.case_assignments a where a.case_id = c.id),
      'consents', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(k) order by k.ver), '[]') from public.consents k where k.case_id = c.id) else '[]' end,
      'documents', case when v.is_full then (select coalesce(jsonb_agg(
          to_jsonb(d) || jsonb_build_object(
            'visible', dv.vis,
            'parts', (select coalesce(jsonb_agg(to_jsonb(p) order by p.sort), '[]') from public.document_parts p where p.document_id = d.id),
            'versions', (select coalesce(jsonb_agg(public.version_json(x, dv.vis) order by x.v), '[]') from public.document_versions x where x.document_id = d.id),
            'returns', (select coalesce(jsonb_agg(to_jsonb(t) order by t.at, t.id), '[]') from public.document_returns t where t.document_id = d.id),
            'requests', (select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at), '[]') from public.document_requests q where q.document_id = d.id),
            'need_changes', (select coalesce(jsonb_agg(to_jsonb(n) order by n.at, n.id), '[]') from public.document_need_changes n where n.document_id = d.id),
            'need_asks', (select coalesce(jsonb_agg(to_jsonb(n) order by n.asked_at, n.id), '[]') from public.document_need_asks n where n.document_id = d.id),
            'reminders', (select coalesce(jsonb_agg(to_jsonb(n) order by n.at, n.id), '[]') from public.document_reminders n where n.document_id = d.id)
          ) order by d.sort), '[]') from public.documents d cross join lateral (select case when r = 'nurse' then d.cat in ('B','C','D') else true end as vis) dv where d.case_id = c.id and d.deleted_at is null) else '[]' end,
      'visit', case when r = 'staff' or public.is_family_of(c.id) then (select to_jsonb(x) from public.case_visits x where x.case_id = c.id) end,
      'deposit', case when r = 'staff' then (select to_jsonb(x) from public.case_deposits x where x.case_id = c.id) end,
      'contacts', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(t) order by t.sort), '[]') from public.contacts t where t.case_id = c.id) else '[]' end,
      'habit_draft', case when public.is_family_of(c.id) then (select to_jsonb(h) from public.habit_cards h where h.case_id = c.id) end,
      'habit_sections', case when public.is_family_of(c.id) then (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from public.habit_card_sections s where s.case_id = c.id) else '[]' end,
      'apply_mail', case when v.is_full then (select jsonb_build_object('status', j.status, 'to_email', j.to_email, 'created_at', j.created_at,
          'attempts', (select count(*) from public.mail_attempts x where x.job_id = j.id)) from public.mail_jobs j where j.id = 'apply_' || c.id) end,
      'req_mails', case when v.is_full then public.req_mails_json(c.id) else '[]' end,
      'habit_submissions', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(s) order by s.rev), '[]') from public.habit_submissions s where s.case_id = c.id) else '[]' end,
      'habit_reviews', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(h) order by h.reviewed_at, h.id), '[]') from public.habit_reviews h where h.case_id = c.id) else '[]' end,
      'assessments', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object('items', (select coalesce(jsonb_agg(i.document_id), '[]') from public.assessment_items i where i.assessment_id = a.id)) order by a.at, a.id), '[]') from public.assessments a where a.case_id = c.id) else '[]' end,
      'cards', case when v.is_full then (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'v', k.v, 'status', k.status, 'basis', k.basis, 'opened_by', k.opened_by, 'opened_at', k.opened_at,
          'end_at', k.end_at, 'end_note', k.end_note, 'call', k.content->>'call',
          'caregivers', (select coalesce(jsonb_agg(g.caregiver_id), '[]') from public.care_card_caregivers g where g.card_id = k.id)) order by k.v), '[]')
        from public.care_cards k where k.case_id = c.id) else '[]' end,
      -- 診斷清單：行政與家屬只需要狀態與文字（計算摘要卡依據是否變更）；承辦護理另外拿到 ICD 與確認者
      'diagnoses', case when v.is_full then (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'status', g.status, 'text', g.text, 'std', g.std,
          'source_document', g.source_document, 'source_version', g.source_version, 'source_row', g.source_row, 'superseded_at', g.superseded_at,
          'icd_code', case when r = 'nurse' then g.icd_code end, 'icd_name', case when r = 'nurse' then g.icd_name end,
          'confirmed_by', g.confirmed_by, 'confirmed_at', g.confirmed_at, 'reason', g.reason) order by g.added_at, g.id), '[]')
        from public.diagnoses g where g.case_id = c.id) else '[]' end
    ) as m
    from public.cases c
    join public.residents rs on rs.id = c.resident_id
    cross join lateral (select (r = 'staff' or public.is_family_of(c.id) or public.is_case_nurse(c.id)) as is_full) v
    where (p_case is null or c.id = p_case)
      and (p_case is not null or p_include_closed or (c.closed_at is null and c.archived_at is null))
      and (public.can_read_case(c.id) or r = 'admin' or auth.role() = 'service_role')
  ) q;
  return out;
end $$;

-- ===================== 權限 =====================
revoke execute on function public.nurse_case_for_update(uuid), public.docs_ready(uuid), public.habit_gate(uuid), public.sync_diagnoses(uuid, int) from public, anon, authenticated;
grant execute on function public.docs_ready(uuid), public.habit_gate(uuid) to service_role;
revoke execute on function public.set_nurse_need(uuid, boolean, text), public.save_review_draft(uuid, int, jsonb), public.complete_review(uuid, int, jsonb, jsonb, text, jsonb, jsonb),
  public.return_document(uuid, int, text, text), public.save_supp(uuid, text, text, jsonb, jsonb), public.dx_import(uuid, uuid, int, text[]),
  public.dx_save(uuid, uuid, text, text, text, text, text, boolean), public.dx_resync(uuid), public.review_habit(uuid, text, text, int, jsonb, jsonb),
  public.save_assessment(uuid, text, text, text, text, text, text, text, uuid[], text) from public, anon;
grant execute on function public.set_nurse_need(uuid, boolean, text), public.save_review_draft(uuid, int, jsonb), public.complete_review(uuid, int, jsonb, jsonb, text, jsonb, jsonb),
  public.return_document(uuid, int, text, text), public.save_supp(uuid, text, text, jsonb, jsonb), public.dx_import(uuid, uuid, int, text[]),
  public.dx_save(uuid, uuid, text, text, text, text, text, boolean), public.dx_resync(uuid), public.review_habit(uuid, text, text, int, jsonb, jsonb),
  public.save_assessment(uuid, text, text, text, text, text, text, text, uuid[], text) to authenticated;
