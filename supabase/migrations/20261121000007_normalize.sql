-- 資料庫正規化（使用者要求：至少第三正規化，資料之間要有關聯，2026/11/21）
--
-- 使用者決定：
--   1. 住民基本資料獨立成 residents（以身分證字號區分同一個人），案件只存 resident_id
--   2. 案件文件保留「建立當時」的名稱、類別、有效天數等副本（刻意的歷史快照：管理員之後改文件清單，只影響新的申請），
--      並加外鍵 catalog_key 連到 doc_catalog
--   3. cases.nurse_id 保留（權限檢查用），只能由新增分配紀錄改變，觸發器保證它永遠等於分配歷程的最新一筆
--
-- 本檔修正：
--   A. 補上外鍵：代理權證明文件、各種「文件第幾版」、習慣卡第幾次提交、診斷來源版本、沿用其他文件的檔案
--   B. JSON 裡的人員 id、文件 id 改成獨立欄位並加外鍵（身分核對人、沿用的文件）
--   C. 一個欄位放多筆資料（第一正規化）改成獨立資料表：合作醫院、文件核對項目、需求判斷歷程、請護理重新判斷、
--      一般提醒、診斷變更歷程、Email 寄送紀錄、延長保存
--   D. 重複存放的資料（第三正規化）移除：補件與醫療資料的 case_id（由文件推得）、文件的「最後判斷者」（由歷程推得）、
--      一般提醒次數（由提醒紀錄筆數推得）、Email 最後錯誤（由寄送紀錄推得）、版本上的護理確認欄位（改存 medical_facts）
--
-- 刻意保留為 jsonb 的欄位（內容是「當時的整份快照或表單內容」，不含指向其他資料的 id，也不會被拆開查詢）：
--   習慣卡內容（habit_cards.draft、habit_submissions.data）、習慣卡審核快照（habit_reviews.snap、med_snapshot、diff_res）、
--   摘要卡內容與依據（care_cards.content、basis、review）、身分核對明細（document_versions.id_check_detail）、
--   核對草稿（review_drafts.data）、AI 辨識原始結果（ocr_runs.result）
--   操作紀錄的 actor_name 也是刻意保留的「當時姓名」快照（帳號改名或刪除後紀錄不變）。
--
-- 既有資料一併轉換到新結構（只有測試資料，但轉換方式寫清楚，日後有資料時也適用）。

-- 原型時間字串「YYYY/MM/DD HH:MM」（台灣時間）或 ISO → timestamptz（只在本檔轉換舊資料時使用）
create or replace function public.parse_stamp(t text) returns timestamptz
language sql stable set search_path = '' as $$
  select case when t is null or t = '' then null
    when t ~ '^\d{4}/\d{2}/\d{2} \d{2}:\d{2}' then (to_timestamp(substr(t, 1, 16), 'YYYY/MM/DD HH24:MI')::timestamp at time zone 'Asia/Taipei')
    else t::timestamptz end
$$;

-- ===================== 1. 住民 =====================
create table public.residents (
  id uuid primary key default gen_random_uuid(),
  nid text not null unique check (nid ~ '^[A-Z][12A-D89]\d{8}$'),   -- 身分證字號／居留證號（與原型 nidOk 相同）
  name text not null,
  birth date,
  chart_no text not null default '',                                -- 機構病歷號
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.residents (nid, name, birth, chart_no, created_at)
  select distinct on (patient_nid) patient_nid, patient_name, patient_birth, chart_no, created_at
  from public.cases order by patient_nid, created_at;
alter table public.cases add column resident_id uuid references public.residents(id);
update public.cases c set resident_id = r.id from public.residents r where r.nid = c.patient_nid;
alter table public.cases alter column resident_id set not null;
create index on public.cases (resident_id);
alter table public.cases drop column patient_name, drop column patient_nid, drop column patient_birth, drop column chart_no;

-- ===================== 2. 合作醫院 =====================
create table public.partner_hospitals (
  id bigint generated always as identity primary key,
  name text not null unique,
  sort int not null default 0,
  active boolean not null default true
);
insert into public.partner_hospitals (name, sort)
  select h, ord::int from public.org_settings, unnest(hospitals) with ordinality as u(h, ord);
alter table public.org_settings drop column hospitals;

-- ===================== 3. 文件清單與核對項目 =====================
create table public.doc_catalog_parts (
  catalog_key text not null references public.doc_catalog(key) on delete cascade,
  k text not null,
  name text not null,
  need text not null check (need in ('必備','條件式必備','選填','不適用')),
  sort int not null,
  primary key (catalog_key, k)
);
insert into public.doc_catalog_parts (catalog_key, k, name, need, sort)
  select d.key, p->>'k', p->>'name', p->>'need', (ord - 1)::int
  from public.doc_catalog d, jsonb_array_elements(d.parts) with ordinality as e(p, ord) where d.parts is not null;
alter table public.doc_catalog drop column parts;

-- 案件文件：連到文件清單（G 類由行政依個案新增，不在清單內）
alter table public.documents add column catalog_key text references public.doc_catalog(key);
update public.documents set catalog_key = key where key in (select key from public.doc_catalog);
alter table public.documents add constraint documents_catalog_key check (catalog_key = key or (catalog_key is null and cat = 'G'));
comment on column public.documents.name is '建立當時的文件名稱（歷史快照；管理員之後修改文件清單不影響進行中的案件）';

-- 案件文件的核對項目（建立當時的快照）
create table public.document_parts (
  document_id uuid not null references public.documents(id) on delete cascade,
  k text not null,
  name text not null,
  need text not null check (need in ('必備','條件式必備','選填','不適用')),
  sort int not null,
  primary key (document_id, k)
);
insert into public.document_parts (document_id, k, name, need, sort)
  select d.id, p->>'k', p->>'name', p->>'need', (ord - 1)::int
  from public.documents d, jsonb_array_elements(d.parts) with ordinality as e(p, ord) where d.parts is not null;
alter table public.documents drop column parts;

-- ===================== 4. 文件需求判斷歷程、請護理重新判斷、一般提醒 =====================
create table public.document_need_changes (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  from_text text not null default '',
  to_text text not null,
  by uuid references public.profiles(id),
  role text check (role in ('staff','nurse')),
  note text,
  at timestamptz not null default now()
);
insert into public.document_need_changes (document_id, from_text, to_text, by, role, note, at)
  select d.id, coalesce(h->>'from', ''), coalesce(h->>'to', ''), nullif(h->>'by', '')::uuid, nullif(h->>'role', ''), h->>'note', coalesce(public.parse_stamp(h->>'at'), now())
  from public.documents d, jsonb_array_elements(d.need_history) h;
-- 有判斷者但沒有歷程的舊資料：補一筆（不推測時間以外的內容）
insert into public.document_need_changes (document_id, to_text, by, note, at)
  select d.id, case when d.cond_met then '需要' when d.cond_met = false then '不需要' else '尚未確認' end, d.need_set_by, d.need_note, coalesce(d.need_set_at, now())
  from public.documents d
  where d.need_set_by is not null and not exists (select 1 from public.document_need_changes x where x.document_id = d.id);
alter table public.documents drop column need_set_by, drop column need_set_at, drop column need_note, drop column need_history;

create table public.document_need_asks (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  asked_by uuid not null references public.profiles(id),
  asked_at timestamptz not null default now(),
  note text not null,
  done_at timestamptz,
  done_by uuid references public.profiles(id),
  constraint need_ask_done check ((done_at is null) = (done_by is null))
);
insert into public.document_need_asks (document_id, asked_by, asked_at, note, done_at, done_by)
  select id, (need_ask->>'by')::uuid, coalesce(public.parse_stamp(need_ask->>'at'), now()), coalesce(need_ask->>'note', ''),
    public.parse_stamp(need_ask->>'doneAt'), nullif(need_ask->>'doneBy', '')::uuid
  from public.documents where need_ask is not null and need_ask ? 'by';
alter table public.documents drop column need_ask;

-- 一般提醒（不是補件）：每提醒一次一列，次數＝筆數
create table public.document_reminders (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  by uuid references public.profiles(id),
  at timestamptz not null default now(),
  due date
);
insert into public.document_reminders (document_id, at, due)
  select d.id, d.remind_at, d.remind_due from public.documents d, generate_series(1, d.remind_n) where d.remind_n > 0 and d.remind_at is not null;
alter table public.documents drop column remind_n, drop column remind_at, drop column remind_due;

-- ===================== 5. 文件版本：JSON 裡的 id 改成欄位，護理確認欄位改存 medical_facts =====================
alter table public.document_versions
  add column id_checked_by uuid references public.profiles(id),
  add column id_checked_at timestamptz,
  add column id_check_how text,
  add column id_check_detail jsonb,          -- 核對明細（逐欄比對結果、出生日期換算），不含任何 id
  add column from_document_id uuid,
  add column from_version int,
  add column supp_src text,                  -- 護理補充評估（沒有獨立文件）：資料來源
  add column supp_note text;
update public.document_versions set
  id_checked_by = nullif(id_check->>'by', '')::uuid,
  id_checked_at = public.parse_stamp(id_check->>'at'),
  id_check_how = id_check->>'how',
  id_check_detail = nullif(id_check - 'by' - 'at' - 'how' - 'ts', '{}'::jsonb)
  where id_check is not null;
update public.document_versions set from_document_id = nullif(from_item->>'document_id', '')::uuid, from_version = (from_item->>'v')::int where from_item is not null;
update public.document_versions set supp_src = coalesce(supp->>'src', ''), supp_note = supp->>'note' where supp is not null;
alter table public.document_versions
  add constraint version_id_check check ((id_checked_by is null) = (id_checked_at is null)),
  add constraint version_from check ((from_document_id is null) = (from_version is null)),
  add constraint version_from_fk foreign key (from_document_id, from_version) references public.document_versions(document_id, v);

-- 護理逐欄確認的醫療資料：每個欄位一列，綁定文件版本
drop table public.medical_facts;
create table public.medical_facts (
  document_id uuid not null,
  version_v int not null,
  field text not null,
  value text not null default '',
  confirmed_by uuid not null references public.profiles(id),
  confirmed_at timestamptz not null default now(),
  primary key (document_id, version_v, field),
  foreign key (document_id, version_v) references public.document_versions(document_id, v) on delete cascade
);
insert into public.medical_facts (document_id, version_v, field, value, confirmed_by, confirmed_at)
  select v.document_id, v.v, f.key, f.value, coalesce(v.nurse_by, v.uploaded_by), coalesce(v.nurse_at, v.uploaded_at)
  from public.document_versions v, jsonb_each_text(v.fields) f where v.fields is not null;
alter table public.document_versions drop column id_check, drop column from_item, drop column supp, drop column fields;

-- ===================== 6. 指向「文件第幾版」「第幾次提交」的外鍵 =====================
alter table public.document_returns add constraint document_returns_version_fk foreign key (document_id, version_v) references public.document_versions(document_id, v) on delete cascade;
alter table public.review_drafts add constraint review_drafts_version_fk foreign key (document_id, version_v) references public.document_versions(document_id, v) on delete cascade;
alter table public.ocr_runs add constraint ocr_runs_version_fk foreign key (document_id, version_v) references public.document_versions(document_id, v) on delete cascade;
alter table public.diagnoses
  add constraint diagnoses_source check ((source_document is null) = (source_version is null)),
  add constraint diagnoses_source_fk foreign key (source_document, source_version) references public.document_versions(document_id, v);
alter table public.habit_reviews add constraint habit_reviews_rev_fk foreign key (case_id, rev) references public.habit_submissions(case_id, rev);
alter table public.consents add constraint consents_proof_fk foreign key (proof_document_id) references public.documents(id);

-- ===================== 7. 補件：case_id 由文件推得，移除 =====================
alter table public.document_requests drop column case_id;

-- ===================== 8. 診斷變更歷程 =====================
create table public.diagnosis_changes (
  id bigint generated always as identity primary key,
  diagnosis_id uuid not null references public.diagnoses(id) on delete cascade,
  from_status text,
  to_status text not null,
  text_before text,
  text_after text,
  reason text,
  by uuid references public.profiles(id),
  at timestamptz not null default now()
);
insert into public.diagnosis_changes (diagnosis_id, from_status, to_status, text_before, text_after, reason, by, at)
  select g.id, h->>'from', coalesce(h->>'to', g.status), h->>'before', h->>'after', h->>'reason', nullif(h->>'by', '')::uuid, coalesce(public.parse_stamp(h->>'at'), now())
  from public.diagnoses g, jsonb_array_elements(g.history) h;
alter table public.diagnoses drop column history;

-- ===================== 9. Email：寄送紀錄獨立；case_id 只給「申請確認」（補件通知由補件推得） =====================
create table public.mail_attempts (
  id bigint generated always as identity primary key,
  job_id text not null references public.mail_jobs(id) on delete cascade,
  at timestamptz not null default now(),
  send_key text,
  result text not null,          -- 例：模擬已寄送（測試環境未實際寄出）、寄送失敗、前次結果不明
  error text
);
insert into public.mail_attempts (job_id, at, send_key, result, error)
  select m.id, coalesce(public.parse_stamp(a->>'at'), now()), a->>'sendKey', coalesce(a->>'result', a->>'status', ''), a->>'error'
  from public.mail_jobs m, jsonb_array_elements(m.attempts) a;
alter table public.mail_jobs drop column attempts, drop column last_error;
alter table public.mail_jobs alter column case_id drop not null;
update public.mail_jobs set case_id = null where request_id is not null;
alter table public.mail_jobs add constraint mail_jobs_target check ((request_id is null) <> (case_id is null));

-- ===================== 10. 收治評估的協調紀錄、延長保存 =====================
alter table public.assessments
  add column coord_note text, add column coord_by uuid references public.profiles(id), add column coord_at timestamptz, add column coord_from text;
update public.assessments set coord_note = coord->>'note', coord_by = nullif(coord->>'by', '')::uuid, coord_at = public.parse_stamp(coord->>'at'), coord_from = coord->>'from' where coord is not null;
alter table public.assessments drop column coord;

create table public.retention_holds (
  id bigint generated always as identity primary key,
  case_id uuid not null references public.cases(id) on delete cascade,
  until date not null,
  type text not null,            -- 法定保存義務、爭議、調查…
  note text,
  by uuid not null references public.profiles(id),
  at timestamptz not null default now()
);
insert into public.retention_holds (case_id, until, type, note, by, at)
  select id, (retain_hold->>'until')::date, coalesce(retain_hold->>'type', ''), retain_hold->>'note', (retain_hold->>'by')::uuid, coalesce(public.parse_stamp(retain_hold->>'at'), now())
  from public.cases where retain_hold is not null and retain_hold ? 'by';
alter table public.cases drop column retain_hold;

-- ===================== 11. 承辦護理師：cases.nurse_id 只能由分配紀錄改變 =====================
-- 舊資料：原型有「已有承辦護理師、但沒有分配時間」的案件，分配人與時間允許空白（畫面顯示「原始分配時間未記錄」）
alter table public.case_assignments alter column by drop not null, alter column at drop not null, alter column at drop default;
alter table public.case_assignments alter column at set default now();
alter table public.case_assignments add constraint assignment_legacy check ((by is null) = (at is null));
insert into public.case_assignments (case_id, nurse_id, by, at, reason)
  select c.id, c.nurse_id, null, null, '舊資料：分配時間未記錄' from public.cases c
  where c.nurse_id is not null and not exists (select 1 from public.case_assignments a where a.case_id = c.id);

create or replace function public.case_assignment_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = new.nurse_id and role = 'nurse' and status = '啟用') then
    raise exception '承辦人必須是啟用中的護理人員' using errcode = 'check_violation';
  end if;
  perform set_config('app.assign_sync', 'on', true);
  update public.cases set nurse_id = new.nurse_id where id = new.case_id and nurse_id is distinct from new.nurse_id;
  perform set_config('app.assign_sync', 'off', true);
  return new;
end $$;
create trigger case_assignment_sync after insert on public.case_assignments for each row execute function public.case_assignment_sync();

create or replace function public.case_nurse_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.nurse_id is not null then
    raise exception '新案件不能直接指定承辦護理師，請新增分配紀錄' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.nurse_id is distinct from old.nurse_id and coalesce(current_setting('app.assign_sync', true), 'off') <> 'on' then
    raise exception '承辦護理師只能透過分配功能變更（會留下分配歷程）' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger case_nurse_guard before insert or update of nurse_id on public.cases for each row execute function public.case_nurse_guard();

-- 摘要卡只能開放給照顧服務員
create or replace function public.caregiver_role_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = new.caregiver_id and role = 'care') then
    raise exception '摘要卡只能開放給照顧服務員' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger caregiver_role_guard before insert or update on public.care_card_caregivers for each row execute function public.caregiver_role_guard();

-- ===================== 12. 新表的權限（預設只讀；寫入由 RPC 處理） =====================
alter table public.residents enable row level security;
alter table public.partner_hospitals enable row level security;
alter table public.doc_catalog_parts enable row level security;
alter table public.document_parts enable row level security;
alter table public.document_need_changes enable row level security;
alter table public.document_need_asks enable row level security;
alter table public.document_reminders enable row level security;
alter table public.medical_facts enable row level security;
alter table public.diagnosis_changes enable row level security;
alter table public.mail_attempts enable row level security;
alter table public.retention_holds enable row level security;

grant select on public.residents, public.partner_hospitals, public.doc_catalog_parts, public.document_parts, public.document_need_changes,
  public.document_need_asks, public.document_reminders, public.medical_facts, public.diagnosis_changes, public.mail_attempts, public.retention_holds to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- 住民：看得到他的任一案件才看得到
create policy residents_read on public.residents for select to authenticated using (
  public.auth_role() = 'admin' or exists (select 1 from public.cases c where c.resident_id = residents.id and public.can_read_case(c.id)));
create policy partner_hospitals_read on public.partner_hospitals for select to authenticated using (true);
create policy doc_catalog_parts_read on public.doc_catalog_parts for select to authenticated using (true);
create policy document_parts_read on public.document_parts for select to authenticated using (public.can_read_document(document_id));
create policy document_need_changes_read on public.document_need_changes for select to authenticated using (public.can_read_document(document_id));
create policy document_need_asks_read on public.document_need_asks for select to authenticated using (public.can_read_document(document_id));
create policy document_reminders_read on public.document_reminders for select to authenticated using (public.can_read_document(document_id));
-- 醫療資料：只有承辦護理（與原本相同），改由文件判斷所屬案件
create policy medical_facts_read on public.medical_facts for select to authenticated using (
  exists (select 1 from public.documents d where d.id = document_id and public.is_case_nurse(d.case_id) and d.cat in ('B','C','D')));
create policy diagnosis_changes_read on public.diagnosis_changes for select to authenticated using (
  exists (select 1 from public.diagnoses g where g.id = diagnosis_id and public.is_case_nurse(g.case_id)));
create policy mail_attempts_read on public.mail_attempts for select to authenticated using (public.auth_role() in ('staff','admin'));
create policy retention_holds_read on public.retention_holds for select to authenticated using (public.auth_role() in ('staff','admin'));

-- Email 工作：補件通知沒有 case_id，改由補件 → 文件推得所屬案件
drop policy mail_jobs_read on public.mail_jobs;
create policy mail_jobs_read on public.mail_jobs for select to authenticated using (
  public.auth_role() = 'admin'
  or public.can_read_case(coalesce(case_id, (select d.case_id from public.document_requests q join public.documents d on d.id = q.document_id where q.id = request_id))));

revoke execute on function public.parse_stamp(text), public.case_assignment_sync(), public.case_nurse_guard(), public.caregiver_role_guard() from public, anon, authenticated;
