-- 階段 6：文件與補件（documents.html）、檔案（Storage）、補件 Email、AI 辨識（OCR）
-- HANDOFF 8.2（Storage）、8.3（RLS）、8.4（RPC）、8.5（Edge Functions）、10.2（文件狀態）、10.3（正式補件與一般提醒）、10.4（補件 Email）
--
-- 內容：
--   1. 資料表補欄位：身分待確認說明、補件被新補件取代（superseded_by）與關閉者、個案新增文件的說明、OCR 模式與次數、
--      行政查看醫療文件的紀錄（document_views）、Email 認領人改成外鍵、寄送紀錄的寄件人
--   2. 文件狀態函式 doc_status()：與 js/modules/rules/core.js 的 status(it, c) 同一套判斷順序（RPC 檢查狀態用；
--      tests/rls/documents.test.js 逐筆比對兩邊結果一致）
--   3. 寫入 RPC：上傳新版本、沿用其他文件檔案、機構文件上傳、收件核對、身分待確認、確認日期、要求補件、一般提醒、
--      新增個案文件、補寫補件關閉紀錄、打開檔案（行政打開醫療文件記錄一次）
--   4. Email 通知工作的建立、認領、取消、回寫（只給 Edge Function send-mail 用 service role 呼叫）
--   5. OCR 紀錄的開始與結束（只給 Edge Function ocr 用）
--   6. Storage 私有 bucket case-files 的讀取／上傳 policy（與資料表同一套存取判斷）
--   7. get_case_models 加入補件 Email 狀態；清除測試資料時回傳要刪的檔案資料夾
--
-- 全部寫入都在一個交易內：鎖定案件、檢查權限與狀態、寫入、通知家屬、記錄操作紀錄。
-- 兩位行政同時核對同一份文件時，後到的人會看到「已經核對過了」（多位行政共用工作清單，見 PROGRESS 第 6 節）。

-- ===================== 1. 資料表 =====================
alter table public.document_versions add column id_note text;            -- 行政標示「身分待確認」的說明
comment on column public.document_versions.id_note is '行政標示身分待確認時填寫的不符說明（原型 v.idNote）';

-- 正式補件：同一份文件提出新的補件時，舊的那筆被「取代」（不是結案；原型 setReq 把舊的移到 reqHistory）。
-- 被取代的補件，Email 通知顯示「已有下一次補件，這筆舊通知不再寄送」（原型 mailReqEvent 的 replaced）。
alter table public.document_requests
  add column superseded_by uuid references public.document_requests(id),
  add column closed_by uuid references public.profiles(id),
  add column closed_reason text;
alter table public.document_requests add constraint request_not_both check (closed_at is null or superseded_by is null);
drop index public.document_requests_one_open;
create unique index document_requests_one_open on public.document_requests (document_id) where closed_at is null and superseded_by is null;

-- 個案新增的文件（不在文件清單內）：自己的「為什麼需要／去哪裡拿」；清單內的文件從 doc_catalog 讀，不重複存
alter table public.documents add column custom_why text, add column custom_where text;
alter table public.documents drop constraint documents_catalog_key;
alter table public.documents add constraint documents_catalog_key check (
  (catalog_key = key and custom_why is null and custom_where is null)
  or (catalog_key is null and key ~ '^(custom|extra)_[a-z0-9]+$'));

-- OCR：哪一種辨識（日期／出生日期／護理核對）、這個版本的第幾次
alter table public.ocr_runs add column mode text not null default 'review' check (mode in ('date','birth','review')),
  add column run int not null default 1;
alter table public.ocr_runs alter column mode drop default;

-- 行政打開醫療類文件（B、C、D 類）：每人每個版本記一次（HANDOFF 5），同時寫操作紀錄。Storage 讀取 policy 也用這張表：
-- 行政要先經過 open_document_file()（會記錄）才能取得醫療文件的檔案
create table public.document_views (
  document_id uuid not null,
  version_v int not null,
  viewer uuid not null references public.profiles(id),
  at timestamptz not null default now(),
  primary key (document_id, version_v, viewer),
  foreign key (document_id, version_v) references public.document_versions(document_id, v) on delete cascade
);
alter table public.document_views enable row level security;
grant select on public.document_views to authenticated;
grant all on public.document_views to service_role;
create policy document_views_read on public.document_views for select to authenticated using (viewer = auth.uid() or public.auth_role() = 'admin');

-- Email：認領人改成帳號外鍵；寄送紀錄記下操作人與收件地址；補件刪除（測試資料清除）時一併刪除通知工作
alter table public.mail_jobs alter column claim_by type uuid using nullif(claim_by, '')::uuid;
alter table public.mail_jobs add constraint mail_jobs_claim_by_fk foreign key (claim_by) references public.profiles(id);
alter table public.mail_jobs drop constraint mail_jobs_request_id_fkey;
alter table public.mail_jobs add constraint mail_jobs_request_id_fkey foreign key (request_id) references public.document_requests(id) on delete cascade;
alter table public.mail_attempts add column by uuid references public.profiles(id), add column to_email text;

-- OCR 紀錄：行政（日期、出生日期）與承辦護理（內容核對）都要看得到自己能看的文件的辨識紀錄
drop policy ocr_runs_read on public.ocr_runs;
create policy ocr_runs_read on public.ocr_runs for select to authenticated using (
  public.auth_role() in ('staff','nurse') and public.can_read_document(document_id));

-- ===================== 2. 共用判斷（與 rules/core.js 相同） =====================
-- 月/日（通知文字用，原型 md()）
create or replace function public.md_tw(d date) returns text
language sql immutable set search_path = '' as $$ select case when d is null then '' else extract(month from d)::int || '/' || extract(day from d)::int end $$;
-- 家屬端文件名稱（原型 famName；舊文字「長輩」顯示成「住民」）
create or replace function public.fam_doc_name(d public.documents) returns text
language sql immutable set search_path = '' as $$ select replace(coalesce(nullif(d.fam_name, ''), d.name), '長輩', '住民') $$;
-- 補件期限天數（機構設定）
create or replace function public.req_days() returns int
language sql stable security definer set search_path = '' as $$ select coalesce((select request_days from public.org_settings where id = 1), 7) $$;

-- 案件可以依授權處理（原型 canProcess）：未結案、未封存、已確認、資料授權有效
create or replace function public.case_can_process(c public.cases) returns boolean
language sql stable security definer set search_path = '' as $$
  select c.closed_at is null and c.archived_at is null and c.link_status = '已確認' and public.consent_state(c.id) = '有效'
$$;
-- 代理權待核實時，只能處理代理權證明文件（原型 proofOnly／canProcessItem）
create or replace function public.doc_can_process(d public.documents, c public.cases) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.case_can_process(c) or (c.closed_at is null and c.archived_at is null and c.link_status = '已確認'
    and public.consent_state(c.id) = '待代理權核實'
    and exists (select 1 from public.consents k where k.case_id = c.id and k.proof_document_id = d.id
      and k.ver = (select max(ver) from public.consents where case_id = c.id)))
$$;
-- 文件要求（原型 needOf／isNeeded／notApplicable；not_applicable 視同「不適用」）
create or replace function public.doc_na(d public.documents) returns boolean
language sql immutable set search_path = '' as $$ select d.not_applicable or d.need = '不適用' or (d.need = '條件式必備' and d.cond_met is false) $$;
create or replace function public.doc_needed(d public.documents) returns boolean
language sql immutable set search_path = '' as $$ select not d.not_applicable and (d.need = '必備' or (d.need = '條件式必備' and d.cond_met is true)) $$;
create or replace function public.doc_inst(d public.documents) returns boolean
language sql immutable set search_path = '' as $$ select d.key in ('contract','fee','payReceipt','deposit') $$;
-- 這份文件目前是否已經要求繳交（原型 activeStages：先審後簽在簽約後才要求入住前文件）
create or replace function public.doc_stage_active(d public.documents, c public.cases) returns boolean
language sql immutable set search_path = '' as $$ select d.stage = '評估前' or c.flow_mode = '先簽後審' or c.signed_at is not null $$;
-- 原型 inValid：檢查日期到預計入住日的天數在 0～有效天數之間
create or replace function public.date_in_valid(p_days int, p_admit date, p_date date) returns boolean
language sql immutable set search_path = '' as $$ select p_date is not null and p_admit is not null and p_admit - p_date between 0 and p_days $$;

-- 目前版本（最新一版）
create or replace function public.doc_cur(p_doc uuid) returns public.document_versions
language sql stable security definer set search_path = '' as $$
  select * from public.document_versions where document_id = p_doc order by v desc limit 1
$$;

-- 文件狀態：與 rules/core.js 的 status(it, c) 判斷順序完全相同（HANDOFF 10.2）
create or replace function public.doc_status(p_doc uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare d public.documents; c public.cases; v public.document_versions; ret int;
begin
  select * into d from public.documents where id = p_doc;
  if not found then return null; end if;
  select * into c from public.cases where id = d.case_id;
  if public.doc_na(d) then return '不需要'; end if;
  v := public.doc_cur(d.id);
  if v.id is null then
    return case when d.key = 'contract' then case when c.signed_at is not null then '已登錄簽約' else '待簽約' end
                when public.doc_inst(d) then '機構尚未提供' else '未上傳' end;
  end if;
  /* 最近一次退回是這個版本 → 需補件（原型 it.returned.v === v.v） */
  select version_v into ret from public.document_returns where document_id = d.id order by at desc, id desc limit 1;
  if ret = v.v then return '需補件'; end if;
  if v.phase = 'received' then return '待收件'; end if;
  if v.phase = 'idPending' then return '身分待確認'; end if;
  if d.valid_days is not null and d.valid_days <> 0 then
    /* 行政尚未確認日期：系統初步判斷（AI 日期優先，其次家屬填寫的日期） */
    if v.date_confirmed is null then
      return case when public.date_in_valid(d.valid_days, c.planned_admit, coalesce(v.date_prelim, v.user_date)) then '初步符合' else '疑似過期' end;
    end if;
    if not public.date_in_valid(d.valid_days, c.planned_admit, v.date_confirmed) then return '確認過期'; end if;
  end if;
  if d.medical and not coalesce(v.nurse_ok, false) then return '待護理核對'; end if;
  if not d.medical and not coalesce(v.admin_ok, false) then return '待收件'; end if;
  /* 上傳契約檔案不等於完成簽約：以行政的簽約紀錄為準 */
  if d.key = 'contract' and c.signed_at is null then return '待登錄簽約'; end if;
  if d.valid_days is not null and d.valid_days <> 0 then
    return case when d.valid_days - (c.planned_admit - v.date_confirmed) <= 7 then '即將到期' else '確認符合' end;
  end if;
  return '確認符合';
end $$;
-- 完成狀態（原型 DONE）
create or replace function public.doc_done(p_doc uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.doc_status(p_doc) in ('確認符合','即將到期','不需要','已登錄簽約')
$$;

-- 開啟中的正式補件（沒有關閉、也沒有被新補件取代）
create or replace function public.open_request(p_doc uuid) returns public.document_requests
language sql stable security definer set search_path = '' as $$
  select * from public.document_requests where document_id = p_doc and closed_at is null and superseded_by is null order by created_at desc limit 1
$$;

-- 繳交期限（原型 dueOf：最近一筆補件的期限 > 最近一次提醒的期限 > 案件的文件繳交期限）
create or replace function public.doc_due_date(d public.documents, c public.cases) returns date
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select q.due from public.document_requests q where q.document_id = d.id order by q.created_at desc limit 1),
    (select r.due from public.document_reminders r where r.document_id = d.id order by r.at desc, r.id desc limit 1),
    case when d.stage = '入住前' then coalesce(c.pre_due, (c.signed_at at time zone 'Asia/Taipei')::date + public.req_days())
         else coalesce(c.doc_due, (c.confirmed_at at time zone 'Asia/Taipei')::date + public.req_days()) end)
$$;
-- 等家屬動作（原型 familyTodo）：需要繳交而未上傳，或已上傳後被要求補件、過期
create or replace function public.doc_family_todo(d public.documents) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.doc_status(d.id) in ('未上傳','確認過期','需補件') and (public.doc_needed(d) or exists (select 1 from public.document_versions where document_id = d.id))
$$;

-- 鎖定文件所屬的案件（同一案件的寫入依序進行），回傳案件；文件由呼叫端在鎖定後讀取
create or replace function public.doc_case_for_update(p_doc uuid) returns public.cases
language plpgsql security definer set search_path = '' as $$
declare r public.cases;
begin
  select x.* into r from public.cases x join public.documents y on y.case_id = x.id where y.id = p_doc and y.deleted_at is null for update of x;
  if not found then raise exception '找不到這份文件' using errcode = 'P0002'; end if;
  return r;
end $$;

-- 新的正式補件：同一份文件若有開啟中的補件，舊的標示為被取代（原型 setReq）。回傳補件 id
create or replace function public.new_request(p_doc uuid, p_source text, p_reason text, p_note text, p_due date, p_auto boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare old uuid; nid uuid;
begin
  select id into old from public.document_requests where document_id = p_doc and closed_at is null and superseded_by is null;
  /* 唯一索引（每份文件只能有一筆開啟中的補件）：先讓舊的離開「開啟中」。暫時指向自己（外鍵有效），新增後改成新補件的 id */
  if old is not null then update public.document_requests set superseded_by = old where id = old; end if;
  insert into public.document_requests (document_id, source, reason, note, due, created_by, auto) values (p_doc, p_source, p_reason, nullif(btrim(coalesce(p_note, '')), ''), p_due, auth.uid(), p_auto) returning id into nid;
  if old is not null then update public.document_requests set superseded_by = nid where id = old; end if;
  return nid;
end $$;

-- 文件狀態改變後（原型 afterItemChange）：
--   確認過期 → 系統建立正式補件並通知家屬重新檢查
--   已確認符合等完成狀態 → 關閉開啟中的補件（家屬補傳本身不關閉）
-- 回傳新建立的補件 id（畫面接著請 send-mail 寄補件通知）
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
  return '{}';
end $$;

-- ===================== 3. 寫入 RPC =====================
-- 檔案必須已上傳到 Storage、路徑屬於這份文件與版本、是本人上傳；回傳檔案資訊（類型與大小以 Storage 記錄為準）
create or replace function public.check_uploaded(d public.documents, p_v int, p_path text, out mime text, out size bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_path is null or p_path not like d.case_id::text || '/' || d.key || '/v' || p_v || '-%' then
    raise exception '檔案位置與文件版本不符，可能有人剛上傳了新版本，請重新整理後再試' using errcode = 'P0001';
  end if;
  select o.metadata->>'mimetype', (o.metadata->>'size')::bigint into mime, size from storage.objects o
    where o.bucket_id = 'case-files' and o.name = p_path and (o.owner_id = auth.uid()::text or o.owner = auth.uid());
  if not found then raise exception '找不到上傳的檔案，請重新選擇檔案再試一次' using errcode = 'P0001'; end if;
  if coalesce(mime, '') !~ '^(image/|application/pdf$)' then raise exception '只能上傳照片或 PDF' using errcode = '22023'; end if;
  if size > 20 * 1024 * 1024 then raise exception '檔案超過 20 MB，請改用拍照上傳' using errcode = '22023'; end if;
end $$;

-- 3-1 家屬上傳新版本（原型 uploadForm）：上傳不等於審核完成；開啟中的補件記錄「已重新上傳」，但不關閉
create or replace function public.submit_version(p_doc uuid, p_path text, p_file_name text, p_user_date date) returns int
language plpgsql security definer set search_path = '' as $$
declare d public.documents; c public.cases; st text; nv int; f record;
begin
  c := public.doc_case_for_update(p_doc); select * into d from public.documents where id = p_doc for update;
  if public.auth_role() is distinct from 'family' or c.family_id <> auth.uid() then raise exception '只有申請人可以上傳' using errcode = '42501'; end if;
  if not public.doc_can_process(d, c) then raise exception '資料授權無效或案件已結案，無法上傳' using errcode = 'P0001'; end if;
  if public.doc_na(d) then raise exception '這份文件不需要繳交' using errcode = 'P0001'; end if;
  if public.doc_inst(d) and d.key <> 'contract' then raise exception '這份文件由機構提供，不需要上傳' using errcode = 'P0001'; end if;
  st := public.doc_status(d.id);
  if st not in ('未上傳','確認過期','需補件') and not (d.key = 'contract' and st in ('待簽約','已登錄簽約','待登錄簽約')) then
    raise exception '這份文件機構正在確認中，不需要重複上傳' using errcode = 'P0001';
  end if;
  if p_user_date is not null and p_user_date > public.today_tw() then raise exception '檢查日期不能晚於今天' using errcode = '22023'; end if;
  nv := coalesce((select max(v) from public.document_versions where document_id = d.id), 0) + 1;
  select * into f from public.check_uploaded(d, nv, p_path);
  insert into public.document_versions (document_id, v, storage_path, file_name, mime, file_size, uploaded_by, user_date, phase)
    values (d.id, nv, p_path, left(coalesce(p_file_name, ''), 200), f.mime, f.size, auth.uid(), case when d.valid_days is not null then p_user_date end, 'received');
  update public.document_requests set uploaded_at = now() where id = (public.open_request(d.id)).id;
  perform public.log_action(c.id, '上傳 ' || d.name || '（第 ' || nv || ' 版）');
  return nv;
end $$;

-- 3-2 沿用其他文件的檔案（原型 use-exam／use-doc、shareSources）：
--   B 類（健康檢查）可沿用已上傳的體檢報告；D 類（照護紀錄）可沿用 C、D 類已上傳、非沿用、不是需補件的文件
create or replace function public.reuse_file(p_doc uuid, p_from uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare d public.documents; c public.cases; s public.documents; sv public.document_versions; st text; nv int; ok boolean;
begin
  c := public.doc_case_for_update(p_doc); select * into d from public.documents where id = p_doc for update;
  if public.auth_role() is distinct from 'family' or c.family_id <> auth.uid() then raise exception '只有申請人可以上傳' using errcode = '42501'; end if;
  if not public.case_can_process(c) then raise exception '資料授權無效或案件已結案，無法上傳' using errcode = 'P0001'; end if;
  select * into s from public.documents where id = p_from and case_id = c.id and deleted_at is null;
  sv := public.doc_cur(p_from);
  ok := s.id is not null and s.id <> d.id and sv.id is not null and sv.storage_path is not null and not sv.file_removed and (
    (d.cat = 'B' and s.key = 'exam')
    or (d.cat = 'D' and s.cat in ('C','D') and sv.from_document_id is null and public.doc_status(s.id) <> '需補件'));
  if not ok then raise exception '這份文件不能沿用' using errcode = 'P0001'; end if;
  if public.doc_na(d) then raise exception '這份文件不需要繳交' using errcode = 'P0001'; end if;
  st := public.doc_status(d.id);
  if st not in ('未上傳','確認過期','需補件') then raise exception '這份文件機構正在確認中，不需要重複上傳' using errcode = 'P0001'; end if;
  nv := coalesce((select max(v) from public.document_versions where document_id = d.id), 0) + 1;
  insert into public.document_versions (document_id, v, storage_path, file_name, mime, file_size, uploaded_by, user_date, phase, from_document_id, from_version)
    values (d.id, nv, sv.storage_path, sv.file_name, sv.mime, sv.file_size, auth.uid(), case when d.valid_days is not null then sv.user_date end, 'received', s.id, sv.v);
  update public.document_requests set uploaded_at = now() where id = (public.open_request(d.id)).id;
  perform public.log_action(c.id, '上傳 ' || d.name || '（第 ' || nv || ' 版，沿用「' || s.name || '」第 ' || sv.v || ' 版檔案）');
  return nv;
end $$;

-- 3-3 行政上傳機構提供的文件（原型 inst-up）：機構文件不需要身分核對，上傳即完成；契約仍以簽約紀錄為準
create or replace function public.submit_inst_version(p_doc uuid, p_path text, p_file_name text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.documents; c public.cases; nv int; f record; reqs uuid[];
begin
  c := public.doc_case_for_update(p_doc); select * into d from public.documents where id = p_doc for update;
  if public.auth_role() is distinct from 'staff' then raise exception '只有行政可以上傳機構提供的文件' using errcode = '42501'; end if;
  if not public.doc_inst(d) then raise exception '這份文件不是機構提供的文件' using errcode = 'P0001'; end if;
  if not public.case_can_process(c) then raise exception '資料授權無效或案件已結案' using errcode = 'P0001'; end if;
  nv := coalesce((select max(v) from public.document_versions where document_id = d.id), 0) + 1;
  select * into f from public.check_uploaded(d, nv, p_path);
  insert into public.document_versions (document_id, v, storage_path, file_name, mime, file_size, uploaded_by, phase, admin_ok, provider, note, id_checked_by, id_checked_at, id_check_how)
    values (d.id, nv, p_path, left(coalesce(p_file_name, ''), 200), f.mime, f.size, auth.uid(), 'checked', true, '機構', nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), now(), '機構提供文件（行政上傳）');
  perform public.log_action(c.id, d.name || ' 第 ' || nv || ' 版：行政上傳機構提供的文件' || coalesce('（' || nullif(btrim(coalesce(p_note, '')), '') || '）', ''));
  reqs := public.after_doc_change(d.id);
  return jsonb_build_object('v', nv, 'status', public.doc_status(d.id), 'requests', to_jsonb(reqs));
end $$;

-- 行政收件類動作的共同檢查：行政、授權有效（或代理權證明）、這個版本仍是最新版。回傳鎖定的案件
create or replace function public.staff_doc_case(p_doc uuid, p_v int) returns public.cases
language plpgsql security definer set search_path = '' as $$
declare c public.cases; d public.documents; v public.document_versions;
begin
  if public.auth_role() is distinct from 'staff' then raise exception '只有行政可以收件核對' using errcode = '42501'; end if;
  c := public.doc_case_for_update(p_doc);
  select * into d from public.documents where id = p_doc;
  if not public.doc_can_process(d, c) then raise exception '資料授權無效或案件已結案，不能收件' using errcode = 'P0001'; end if;
  v := public.doc_cur(d.id);
  if v.id is null or v.v <> p_v then raise exception '文件已有新版本，請重新開啟' using errcode = 'P0001'; end if;
  return c;
end $$;

-- 3-4 收件核對（原型 receiptForm／signerForm）：核對身分；非醫療文件同時確認影本（admin_ok）。
--   p_detail：逐欄比對結果與出生日期換算（畫面依原型 idProfile、birthCompare 規則產生，只存成紀錄）
create or replace function public.staff_receipt(p_doc uuid, p_v int, p_how text, p_detail jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.documents; c public.cases; v public.document_versions; how text := btrim(coalesce(p_how, '')); reqs uuid[];
begin
  c := public.staff_doc_case(p_doc, p_v); select * into d from public.documents where id = p_doc for update; v := public.doc_cur(d.id);
  if v.phase not in ('received','idPending') or public.doc_status(d.id) not in ('待收件','身分待確認') then raise exception '這份文件已經被核對過了' using errcode = 'P0001'; end if;
  if how = '' then raise exception '請完成核對' using errcode = '22023'; end if;
  update public.document_versions set phase = 'checked', id_checked_by = auth.uid(), id_checked_at = now(), id_check_how = how,
    id_check_detail = nullif(p_detail, '{}'::jsonb), admin_ok = case when d.medical then admin_ok else true end
    where id = v.id;
  perform public.log_action(c.id, d.name || ' 第 ' || v.v || ' 版' || case when d.key = 'signerId' then how else '身分確認（' || how || '）' end);
  reqs := public.after_doc_change(d.id);
  return jsonb_build_object('status', public.doc_status(d.id), 'requests', to_jsonb(reqs));
end $$;

-- 3-5 標示身分待確認（原型 id-pending）
create or replace function public.mark_id_pending(p_doc uuid, p_v int, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.documents; c public.cases; v public.document_versions; n text := btrim(coalesce(p_note, ''));
begin
  c := public.staff_doc_case(p_doc, p_v); select * into d from public.documents where id = p_doc for update; v := public.doc_cur(d.id);
  if n = '' then raise exception '請填寫說明' using errcode = '22023'; end if;
  if v.phase not in ('received','idPending') then raise exception '這份文件已經核對過了' using errcode = 'P0001'; end if;
  update public.document_versions set phase = 'idPending', id_note = n where id = v.id;
  perform public.log_action(c.id, d.name || ' 標示身分待確認：' || n, false);
end $$;

-- 3-6 行政確認文件上的日期（原型 date-confirm）：過期 → 系統補件並通知；在期限內 → 交給護理核對內容
create or replace function public.confirm_doc_date(p_doc uuid, p_v int, p_date date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.documents; c public.cases; v public.document_versions; prelim date; src text; reqs uuid[];
begin
  c := public.staff_doc_case(p_doc, p_v); select * into d from public.documents where id = p_doc for update; v := public.doc_cur(d.id);
  if not public.case_can_process(c) then raise exception '授權無效或案件已結案' using errcode = 'P0001'; end if;
  if p_date is null then raise exception '請輸入文件上的日期' using errcode = '22023'; end if;
  if p_date > public.today_tw() then raise exception '日期不能晚於今天' using errcode = '22023'; end if;
  if public.doc_status(d.id) not in ('初步符合','疑似過期') then raise exception '這份文件目前不在日期確認步驟（%）', public.doc_status(d.id) using errcode = 'P0001'; end if;
  prelim := coalesce(v.date_prelim, v.user_date);
  src := case when v.date_prelim is not null then 'AI 辨識' else '家屬填寫' end;
  update public.document_versions set date_confirmed = p_date, date_by = auth.uid(), date_at = now() where id = v.id;
  perform public.log_action(c.id, d.name || ' 第 ' || v.v || ' 版日期由行政確認為 ' || to_char(p_date, 'YYYY/MM/DD')
    || case when prelim is not null and prelim <> p_date then '（初步日期 ' || to_char(prelim, 'YYYY/MM/DD') || ' 來自' || src || '，已更正）' else '' end);
  reqs := public.after_doc_change(d.id);
  return jsonb_build_object('status', public.doc_status(d.id), 'requests', to_jsonb(reqs));
end $$;

-- 3-7 行政要求補件（原型 staff-request）：全部檢查通過才寫入（一個交易，不會只送出一部分）。
--   管路、傷口、吞嚥尚未經護理判斷需要時不能要求（請護理重新判斷）。選填或尚未確認的文件被要求後，本案改為必備。
--   p_other：清單外的其他資料（建立 G 類文件）；p_other_medical：其他資料由護理核對
create or replace function public.request_documents(p_case uuid, p_docs uuid[], p_other text, p_other_medical boolean, p_reason text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.staff_case_for_update(p_case); d public.documents; v public.document_versions; due date; names text[] := '{}'; blocked text;
  reqs uuid[] := '{}'; other text := btrim(coalesce(p_other, '')); note text := btrim(coalesce(p_note, '')); before text; nid uuid;
begin
  if not public.case_can_process(c) then raise exception '資料授權無效或案件已結案' using errcode = 'P0001'; end if;
  if p_reason not in ('文件不完整或缺頁','影本不清楚','資料與申請不符','需要補充其他文件') then raise exception '請選擇原因' using errcode = '22023'; end if;
  if coalesce(array_length(p_docs, 1), 0) = 0 and other = '' then raise exception '請至少選一份文件，或填寫其他資料' using errcode = '22023'; end if;
  if exists (select 1 from unnest(coalesce(p_docs, '{}')) x where not exists (select 1 from public.documents where id = x and case_id = c.id and deleted_at is null)) then
    raise exception '文件不屬於這個案件' using errcode = 'P0001'; end if;
  select string_agg(name, '、') into blocked from public.documents where id = any(p_docs) and nurse_decides and need = '條件式必備' and not public.doc_needed(documents);
  if blocked is not null then raise exception '%是否需要由負責護理師判斷，不能直接要求補件。請先按「請護理重新判斷」。沒有送出任何補件要求。', blocked using errcode = 'P0001'; end if;
  if exists (select 1 from public.documents where id = any(p_docs) and (not public.doc_stage_active(documents, c) or (public.doc_na(documents) and not nurse_decides))) then
    raise exception '有文件目前不需要繳交，不能要求補件' using errcode = 'P0001'; end if;
  due := public.today_tw() + public.req_days();
  for d in select * from public.documents where id = any(p_docs) order by sort for update loop
    v := public.doc_cur(d.id);
    if v.id is not null then insert into public.document_returns (document_id, version_v, by, reason, note_for_family) values (d.id, v.v, auth.uid(), p_reason, nullif(note, '')); end if;
    reqs := reqs || public.new_request(d.id, '行政', p_reason, note, due);
    if not public.doc_needed(d) then
      before := case when d.need = '選填' then '選填' else public.staff_need_text(d.cond_met) end;
      update public.documents set need = '必備', cond_met = null where id = d.id;
      insert into public.document_need_changes (document_id, from_text, to_text, by, role, note) values (d.id, before, '必備', auth.uid(), 'staff', '行政要求補件');
    end if;
    names := names || public.fam_doc_name(d);
  end loop;
  if other <> '' then
    if exists (select 1 from public.documents where case_id = c.id and name = other and deleted_at is null) then raise exception '這個案件已經有同名的文件' using errcode = 'P0001'; end if;
    insert into public.documents (case_id, key, cat, name, fam_name, stage, need, medical, sort, custom_why, custom_where)
      values (c.id, 'extra_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10), 'G', other, other, '評估前', '必備', coalesce(p_other_medical, false),
        50 + (select count(*) from public.documents where case_id = c.id), '機構需要這份資料：' || coalesce(nullif(note, ''), p_reason), '請洽機構承辦人')
      returning id into nid;
    reqs := reqs || public.new_request(nid, '行政', p_reason, note, due);
    names := names || other;
  end if;
  perform public.notify_family(c.id, '請在 ' || public.md_tw(due) || ' 前補件：' || array_to_string(names, '、'));
  perform public.log_action(c.id, '行政要求補件：' || array_to_string(names, '、') || '（' || p_reason || coalesce('：' || nullif(note, ''), '') || '，期限 ' || to_char(due, 'YYYY/MM/DD') || '）');
  return jsonb_build_object('due', due, 'requests', to_jsonb(reqs));
end $$;

-- 3-8 一般提醒（原型 remind）：只記提醒次數與期限，不是正式補件；已逾期時期限延長，開啟中的補件期限一併延長
create or replace function public.remind_document(p_doc uuid) returns date
language plpgsql security definer set search_path = '' as $$
declare d public.documents; c public.cases; due date; od boolean; new_due date; q public.document_requests;
begin
  if public.auth_role() is distinct from 'staff' then raise exception '只有行政可以提醒家屬' using errcode = '42501'; end if;
  c := public.doc_case_for_update(p_doc); select * into d from public.documents where id = p_doc for update;
  if not public.case_can_process(c) or not public.doc_family_todo(d) then raise exception '家屬已上傳，不需要再提醒' using errcode = 'P0001'; end if;
  due := public.doc_due_date(d, c);
  od := due is not null and due < public.today_tw();
  new_due := case when od then public.today_tw() + public.req_days() else due end;
  insert into public.document_reminders (document_id, by, due)
    values (d.id, auth.uid(), case when od then new_due else (select r.due from public.document_reminders r where r.document_id = d.id order by r.at desc, r.id desc limit 1) end);
  q := public.open_request(d.id);
  if od and q.id is not null then update public.document_requests set due = new_due where id = q.id; end if;
  perform public.notify_family(c.id, '提醒：請在 ' || public.md_tw(new_due) || ' 前上傳「' || public.fam_doc_name(d) || '」。有困難請來電 ' || coalesce((select phone from public.org_settings where id = 1), ''));
  perform public.log_action(c.id, '再次提醒家屬上傳 ' || d.name || case when od then '（已逾期，期限延至 ' || to_char(new_due, 'YYYY/MM/DD') || '）' else '' end, false);
  return new_due;
end $$;

-- 3-9 行政新增個案指定文件（原型 doc-add）
create or replace function public.add_case_document(p_case uuid, p_name text, p_cat text, p_need text, p_medical boolean, p_stage text, p_why text, p_where text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.staff_case_for_update(p_case); n text := btrim(coalesce(p_name, '')); why text := btrim(coalesce(p_why, '')); nid uuid; d public.documents;
begin
  if not public.case_can_process(c) then raise exception '資料授權無效或案件已結案' using errcode = 'P0001'; end if;
  if n = '' then raise exception '請填寫文件名稱' using errcode = '22023'; end if;
  if why = '' then raise exception '請填寫為什麼需要，家屬才知道要準備什麼' using errcode = '22023'; end if;
  if p_cat not in ('A','B','C','D','E','F','G') or p_need not in ('必備','選填') or p_stage not in ('評估前','入住前') then raise exception '請選擇類別、是否需要繳交與時機' using errcode = '22023'; end if;
  if exists (select 1 from public.documents where case_id = c.id and name = n and deleted_at is null) then raise exception '這個案件已經有同名的文件' using errcode = 'P0001'; end if;
  insert into public.documents (case_id, key, cat, name, fam_name, stage, need, medical, sort, custom_why, custom_where)
    values (c.id, 'custom_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10), p_cat, n, n, p_stage, p_need, coalesce(p_medical, false),
      60 + (select count(*) from public.documents where case_id = c.id), why, coalesce(nullif(btrim(coalesce(p_where, '')), ''), '請洽機構承辦人'))
    returning * into d;
  insert into public.document_need_changes (document_id, from_text, to_text, by, role, note) values (d.id, '', case when p_need = '必備' then '需要繳交' else '選填' end, auth.uid(), 'staff', '個案新增');
  perform public.log_action(c.id, '新增個案指定文件：' || n || '（' || case when p_need = '必備' then '需要繳交' else '選填' end || '，' || (select x from (values ('A','身分與聯絡資料'),('B','入住前健康檢查資料'),('C','醫療資料'),('D','特殊照護資料'),('E','授權與法律文件'),('F','契約與費用'),('G','其他補充文件')) t(k, x) where k = p_cat) || '）');
  if p_need = '必備' and public.doc_stage_active(d, c) then perform public.notify_family(c.id, '機構請您補充「' || n || '」：' || why); end if;
  return d.id;
end $$;

-- 3-10 補寫補件關閉紀錄（原型 req-close-fix）：文件已確認符合，但補件的關閉紀錄沒有寫入（資料待修復）
create or replace function public.close_request_fix(p_doc uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.documents; c public.cases; q public.document_requests;
begin
  c := public.doc_case_for_update(p_doc); select * into d from public.documents where id = p_doc for update;
  if not (public.auth_role() = 'staff' or public.is_case_nurse(c.id)) then raise exception '沒有權限' using errcode = '42501'; end if;
  q := public.open_request(d.id);
  if q.id is null then raise exception '補件請求已關閉' using errcode = 'P0001'; end if;
  if not public.doc_done(d.id) then raise exception '文件尚未確認符合' using errcode = 'P0001'; end if;
  update public.document_requests set closed_at = now(), closed_by = auth.uid(), closed_fix_by = auth.uid(), closed_reason = '文件已確認符合' where id = q.id;
  perform public.log_action(c.id, d.name || ' 補件請求已關閉（文件已確認符合）：補寫先前沒有寫入成功的關閉紀錄', false);
end $$;

-- 3-11 打開文件檔案：回傳檔案在 Storage 的位置（畫面再用它取得短時效的 signed URL）。
--   行政打開醫療類文件（B、C、D 類或醫療文件）：每人每個版本記一次操作紀錄（HANDOFF 5），Storage policy 也以這筆紀錄放行
create or replace function public.open_document_file(p_doc uuid, p_v int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.documents; c public.cases; v public.document_versions; n int;
begin
  if not public.can_read_document(p_doc) then raise exception '沒有權限查看這份文件' using errcode = '42501'; end if;
  select * into d from public.documents where id = p_doc;
  select * into c from public.cases where id = d.case_id;
  if public.consent_state(c.id) = '已撤回' then raise exception '家屬已撤回資料授權，不能再開啟文件' using errcode = 'P0001'; end if;
  select * into v from public.document_versions where document_id = d.id and v = p_v;
  if not found then raise exception '找不到這個版本' using errcode = 'P0002'; end if;
  if v.storage_path is null or v.file_removed then return jsonb_build_object('path', null, 'removed', v.file_removed); end if;
  if public.auth_role() = 'staff' and (d.cat in ('B','C','D') or d.medical) then
    insert into public.document_views (document_id, version_v, viewer) values (d.id, v.v, auth.uid()) on conflict do nothing;
    get diagnostics n = row_count;
    if n > 0 then perform public.log_action(c.id, '行政查看醫療文件：' || d.name || '（第 ' || v.v || ' 版，僅查看）', false); end if;
  end if;
  return jsonb_build_object('path', v.storage_path, 'name', v.file_name, 'mime', v.mime, 'removed', false);
end $$;

-- ===================== 4. 補件 Email（只給 Edge Function send-mail，以 service role 呼叫） =====================
-- 判斷補件事件是否仍開啟用 JS 的同一套規則（send-mail 讀 get_case_models 後以 rules/core.js 判斷），這裡只做條件更新
create or replace function public.ensure_req_mail(p_request uuid) returns public.mail_jobs
language plpgsql security definer set search_path = '' as $$
declare j public.mail_jobs; fam public.profiles;
begin
  select p.* into fam from public.document_requests q join public.documents d on d.id = q.document_id join public.cases c on c.id = d.case_id join public.profiles p on p.id = c.family_id where q.id = p_request;
  if fam.id is null then raise exception '找不到補件' using errcode = 'P0002'; end if;
  insert into public.mail_jobs (id, kind, request_id, to_email, status) values ('req_' || p_request, '補件通知', p_request, coalesce(nullif(fam.notify_email, ''), fam.email), '待寄送')
    on conflict (id) do nothing;
  select * into j from public.mail_jobs where id = 'req_' || p_request;
  return j;
end $$;

-- 認領（HANDOFF 10.4 第 2 步）：只有「待寄送／寄送失敗」或「寄送中但認領超過 2 分鐘」才能認領；沒有回傳就是別人正在寄或已寄出
create or replace function public.claim_mail_job(p_job text, p_by uuid, p_send_key text) returns public.mail_jobs
language plpgsql security definer set search_path = '' as $$
declare j public.mail_jobs;
begin
  select * into j from public.mail_jobs where id = p_job for update;
  if not found then return null; end if;
  if not (j.status in ('待寄送','寄送失敗') or (j.status = '寄送中' and j.claim_at < now() - interval '2 minutes')) then return null; end if;
  if j.status = '寄送中' then
    insert into public.mail_attempts (job_id, by, to_email, result) values (j.id, p_by, j.to_email, '前一次寄送沒有回寫結果（逾時），結果不明，重新認領');
  end if;
  update public.mail_jobs set status = '寄送中', claim_by = p_by, claim_at = now(), send_key = p_send_key, updated_at = now() where id = j.id returning * into j;
  return j;
end $$;

-- 認領後發現補件已結案：取消寄送，狀態還原（原本是逾時的「寄送中」就改成寄送失敗），保留紀錄
create or replace function public.release_mail_job(p_job text, p_send_key text, p_by uuid, p_reason text, p_restore text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare j public.mail_jobs;
begin
  select * into j from public.mail_jobs where id = p_job for update;
  if not found or j.send_key is distinct from p_send_key or j.status <> '寄送中' then return false; end if;
  insert into public.mail_attempts (job_id, by, to_email, send_key, result) values (j.id, p_by, j.to_email, p_send_key, '取消寄送：' || p_reason);
  update public.mail_jobs set status = case when p_restore in ('待寄送','寄送失敗') then p_restore else '寄送失敗' end, claim_by = null, claim_at = null, updated_at = now() where id = j.id;
  return true;
end $$;

-- 回寫結果（第 5 步）：只有持有同一個 send_key 的人可以寫入；不符合就不覆寫
create or replace function public.finish_mail_job(p_job text, p_send_key text, p_by uuid, p_ok boolean, p_error text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare j public.mail_jobs;
begin
  select * into j from public.mail_jobs where id = p_job for update;
  if not found or j.send_key is distinct from p_send_key or j.status <> '寄送中' then return false; end if;
  insert into public.mail_attempts (job_id, by, to_email, send_key, result, error)
    values (j.id, p_by, j.to_email, p_send_key, case when p_ok then '模擬已寄送（測試環境未實際寄出）' else '寄送失敗' end, case when p_ok then null else p_error end);
  update public.mail_jobs set status = case when p_ok then '模擬已寄送（測試環境未實際寄出）' else '寄送失敗' end, claim_by = null, claim_at = null, updated_at = now() where id = j.id;
  return true;
end $$;

-- ===================== 5. OCR 紀錄（只給 Edge Function ocr，以 service role 呼叫） =====================
create or replace function public.ocr_start(p_doc uuid, p_v int, p_mode text, p_by uuid, p_model text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n int; rid uuid;
begin
  perform 1 from public.document_versions where document_id = p_doc and v = p_v for update;
  if exists (select 1 from public.ocr_runs where document_id = p_doc and version_v = p_v and status = '執行中' and created_at > now() - interval '2 minutes') then
    raise exception '這個版本正在辨識中' using errcode = 'P0001'; end if;
  n := coalesce((select max(run) from public.ocr_runs where document_id = p_doc and version_v = p_v), 0) + 1;
  insert into public.ocr_runs (document_id, version_v, mode, run, model, status, created_by) values (p_doc, p_v, p_mode, n, p_model, '執行中', p_by) returning id into rid;
  return jsonb_build_object('id', rid, 'run', n);
end $$;

-- 結束：成功時存辨識結果（只是建議值）；日期模式且版本仍是最新版時，寫入初步日期（原型 aiDate），行政仍須確認
create or replace function public.ocr_finish(p_run uuid, p_ok boolean, p_result jsonb, p_error text, p_by uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.ocr_runs; d public.documents; dt date; latest boolean;
begin
  select * into r from public.ocr_runs where id = p_run for update;
  if not found or r.status <> '執行中' then raise exception '找不到辨識紀錄' using errcode = 'P0002'; end if;
  select * into d from public.documents where id = r.document_id;
  update public.ocr_runs set status = case when p_ok then '完成' else '失敗' end, result = p_result, error = p_error where id = r.id;
  latest := (public.doc_cur(d.id)).v = r.version_v;
  if p_ok and r.mode = 'date' and latest and coalesce(p_result->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$' then
    begin dt := (p_result->>'date')::date; exception when others then dt := null; end;
    if dt is not null then update public.document_versions set date_prelim = dt where document_id = d.id and v = r.version_v and date_confirmed is null; end if;
  end if;
  insert into public.audit_logs (case_id, actor, actor_name, role, action, family_visible)
    values (d.case_id, p_by, coalesce((select name from public.profiles where id = p_by), ''), (select role from public.profiles where id = p_by),
      d.name || ' 第 ' || r.version_v || ' 版第 ' || r.run || ' 次 AI 辨識' || case when p_ok then '成功（' || coalesce(p_result->>'summary', '尚未確認') || '）' else '失敗（' || coalesce(p_error, '') || '），可重新辨識或人工處理' end, false);
  return jsonb_build_object('latest', latest);
end $$;

-- ===================== 6. Storage（私有 bucket case-files） =====================
-- 檔案位置：<案件 id>/<文件 key>/v<版本>-<隨機 id>.<副檔名>（HANDOFF 8.2）
update storage.buckets set public = false, file_size_limit = 20 * 1024 * 1024,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','application/pdf'] where id = 'case-files';

create or replace function public.file_document(p_name text) returns public.documents
language sql stable security definer set search_path = '' as $$
  select d.* from public.documents d where d.case_id::text = split_part(p_name, '/', 1) and d.key = split_part(p_name, '/', 2) and d.deleted_at is null
$$;
-- 讀取：家屬看自己案件；承辦護理看 B、C、D 類；行政看全部，但醫療類文件要先經過 open_document_file（會記錄）
create or replace function public.can_read_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare d public.documents := public.file_document(p_name); r text := public.auth_role();
begin
  if d.id is null then return false; end if;
  if r = 'family' then return public.is_family_of(d.case_id); end if;
  if r = 'nurse' then return public.is_case_nurse(d.case_id) and d.cat in ('B','C','D'); end if;
  if r = 'staff' then
    return not (d.cat in ('B','C','D') or d.medical) or exists (select 1 from public.document_views w join public.document_versions v on v.document_id = w.document_id and v.v = w.version_v
      where w.viewer = auth.uid() and v.storage_path = p_name);
  end if;
  return false;
end $$;
-- 上傳：家屬上傳自己案件、目前可以處理的文件；行政上傳機構提供的文件。檔名格式固定
create or replace function public.can_upload_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare d public.documents := public.file_document(p_name); c public.cases; r text := public.auth_role();
begin
  if d.id is null or p_name !~ '^[0-9a-f-]{36}/[A-Za-z0-9_]+/v[0-9]+-[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif|heic|heif|pdf)$' then return false; end if;
  select * into c from public.cases where id = d.case_id;
  if r = 'family' then return c.family_id = auth.uid() and public.doc_can_process(d, c) and (not public.doc_inst(d) or d.key = 'contract'); end if;
  if r = 'staff' then return public.doc_inst(d) and public.case_can_process(c); end if;
  return false;
end $$;

drop policy if exists case_files_read on storage.objects;
drop policy if exists case_files_insert on storage.objects;
create policy case_files_read on storage.objects for select to authenticated using (bucket_id = 'case-files' and public.can_read_file(name));
create policy case_files_insert on storage.objects for insert to authenticated with check (bucket_id = 'case-files' and public.can_upload_file(name));
-- 不開放修改、刪除：每次上傳都是新版本，原始檔案不覆蓋（封存刪檔由管理員功能以後端執行，階段 9）

-- ===================== 7. 讀取：補件 Email 狀態加入 get_case_models =====================
create or replace function public.req_mails_json(p_case uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'request_id', j.request_id, 'status', j.status, 'to_email', j.to_email, 'created_at', j.created_at,
      'claim_at', j.claim_at, 'claim_by', j.claim_by,
      'attempts', (select count(*) from public.mail_attempts x where x.job_id = j.id),
      'last_error', (select x.error from public.mail_attempts x where x.job_id = j.id order by x.at desc, x.id desc limit 1)) order by j.created_at), '[]')
  from public.mail_jobs j join public.document_requests q on q.id = j.request_id join public.documents d on d.id = q.document_id
  where d.case_id = p_case
$$;

create or replace function public.get_case_models(p_case uuid default null, p_include_closed boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  /* 伺服器端程式（Edge Function，用 service role）視同行政，可讀完整判斷資料；一般使用者依角色 */
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
          ) order by d.sort), '[]') from public.documents d cross join lateral (select public.can_read_document(d.id) or auth.role() = 'service_role' as vis) dv where d.case_id = c.id and d.deleted_at is null) else '[]' end,
      'visit', case when r = 'staff' or public.is_family_of(c.id) then (select to_jsonb(x) from public.case_visits x where x.case_id = c.id) end,
      'deposit', case when r = 'staff' then (select to_jsonb(x) from public.case_deposits x where x.case_id = c.id) end,
      'contacts', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(t) order by t.sort), '[]') from public.contacts t where t.case_id = c.id) else '[]' end,
      'habit_draft', case when public.is_family_of(c.id) then (select to_jsonb(h) from public.habit_cards h where h.case_id = c.id) end,
      'habit_sections', case when public.is_family_of(c.id) then (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from public.habit_card_sections s where s.case_id = c.id) else '[]' end,
      'apply_mail', case when v.is_full then (select jsonb_build_object('status', j.status, 'to_email', j.to_email, 'created_at', j.created_at,
          'attempts', (select count(*) from public.mail_attempts x where x.job_id = j.id)) from public.mail_jobs j where j.id = 'apply_' || c.id) end,
      -- 補件 Email 通知（每個正式補件一筆）：狀態、收件地址、嘗試次數、最近錯誤（不含信件內容）
      'req_mails', case when v.is_full then public.req_mails_json(c.id) else '[]' end,
      'habit_submissions', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(s) order by s.rev), '[]') from public.habit_submissions s where s.case_id = c.id) else '[]' end,
      'habit_reviews', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(h) order by h.reviewed_at, h.id), '[]') from public.habit_reviews h where h.case_id = c.id) else '[]' end,
      'assessments', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(a) order by a.at, a.id), '[]') from public.assessments a where a.case_id = c.id) else '[]' end,
      'cards', case when v.is_full then (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'v', k.v, 'status', k.status, 'basis', k.basis, 'opened_by', k.opened_by, 'opened_at', k.opened_at,
          'end_at', k.end_at, 'end_note', k.end_note, 'call', k.content->>'call',
          'caregivers', (select coalesce(jsonb_agg(g.caregiver_id), '[]') from public.care_card_caregivers g where g.card_id = k.id)) order by k.v), '[]')
        from public.care_cards k where k.case_id = c.id) else '[]' end,
      'diagnoses', case when v.is_full then (select coalesce(jsonb_agg(jsonb_build_object('status', g.status, 'text', g.text, 'source_document', g.source_document, 'source_version', g.source_version) order by g.updated_at), '[]')
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

-- ===================== 8. 清除測試資料：一併回傳要刪除的檔案資料夾（案件 id），由腳本用 Storage API 刪檔 =====================
create or replace function public.purge_test_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n_cases int; n_logs int; n_res int; n_conf int; ids jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception '只有後端程式可以清除測試資料' using errcode = '42501'; end if;
  perform set_config('app.purge_tests', 'on', true);
  create temp table purge_cases on commit drop as
    select c.id from public.cases c join public.profiles p on p.id = c.family_id where public.is_test_email(p.email);
  select coalesce(jsonb_agg(id), '[]') into ids from purge_cases;
  delete from public.audit_logs where case_id in (select id from purge_cases)
    or (case_id is null and actor in (select id from public.profiles where public.is_test_email(email)));
  get diagnostics n_logs = row_count;
  delete from public.resident_conflicts where family_id in (select id from public.profiles where public.is_test_email(email));
  get diagnostics n_conf = row_count;
  delete from public.cases where id in (select id from purge_cases);
  get diagnostics n_cases = row_count;
  delete from public.residents r where not exists (select 1 from public.cases c where c.resident_id = r.id)
    and not exists (select 1 from public.resident_conflicts x where x.resident_id = r.id);
  get diagnostics n_res = row_count;
  perform set_config('app.purge_tests', 'off', true);
  return jsonb_build_object('cases', n_cases, 'logs', n_logs, 'residents', n_res, 'conflicts', n_conf, 'case_ids', ids);
end $$;

-- ===================== 權限 =====================
-- 內部用函式：一般使用者不能直接呼叫
revoke execute on function public.md_tw(date), public.fam_doc_name(public.documents), public.req_days(), public.case_can_process(public.cases),
  public.doc_can_process(public.documents, public.cases), public.doc_na(public.documents), public.doc_needed(public.documents), public.doc_inst(public.documents),
  public.doc_stage_active(public.documents, public.cases), public.date_in_valid(int, date, date), public.doc_cur(uuid), public.doc_status(uuid), public.doc_done(uuid),
  public.open_request(uuid), public.doc_due_date(public.documents, public.cases), public.doc_family_todo(public.documents), public.doc_case_for_update(uuid),
  public.new_request(uuid, text, text, text, date, boolean), public.after_doc_change(uuid), public.check_uploaded(public.documents, int, text),
  public.staff_doc_case(uuid, int), public.req_mails_json(uuid), public.file_document(text),
  public.ensure_req_mail(uuid), public.claim_mail_job(text, uuid, text), public.release_mail_job(text, text, uuid, text, text), public.finish_mail_job(text, text, uuid, boolean, text),
  public.ocr_start(uuid, int, text, uuid, text), public.ocr_finish(uuid, boolean, jsonb, text, uuid)
  from public, anon, authenticated;
-- Storage policy 會以登入者身分呼叫這兩個判斷
grant execute on function public.can_read_file(text), public.can_upload_file(text) to authenticated;
revoke execute on function public.can_read_file(text), public.can_upload_file(text) from public, anon;
-- 後端（Edge Function）用：Email 認領與回寫、OCR 紀錄；測試比對文件狀態用 doc_status
grant execute on function public.ensure_req_mail(uuid), public.claim_mail_job(text, uuid, text), public.release_mail_job(text, text, uuid, text, text),
  public.finish_mail_job(text, text, uuid, boolean, text), public.ocr_start(uuid, int, text, uuid, text), public.ocr_finish(uuid, boolean, jsonb, text, uuid),
  public.doc_status(uuid) to service_role;
-- 畫面呼叫的寫入 RPC
revoke execute on function public.submit_version(uuid, text, text, date), public.reuse_file(uuid, uuid), public.submit_inst_version(uuid, text, text, text),
  public.staff_receipt(uuid, int, text, jsonb), public.mark_id_pending(uuid, int, text), public.confirm_doc_date(uuid, int, date),
  public.request_documents(uuid, uuid[], text, boolean, text, text), public.remind_document(uuid), public.add_case_document(uuid, text, text, text, boolean, text, text, text),
  public.close_request_fix(uuid), public.open_document_file(uuid, int) from public, anon;
grant execute on function public.submit_version(uuid, text, text, date), public.reuse_file(uuid, uuid), public.submit_inst_version(uuid, text, text, text),
  public.staff_receipt(uuid, int, text, jsonb), public.mark_id_pending(uuid, int, text), public.confirm_doc_date(uuid, int, date),
  public.request_documents(uuid, uuid[], text, boolean, text, text), public.remind_document(uuid), public.add_case_document(uuid, text, text, text, boolean, text, text, text),
  public.close_request_fix(uuid), public.open_document_file(uuid, int) to authenticated;
