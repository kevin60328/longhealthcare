-- 階段 1：資料表（HANDOFF 第 8.1 節）
-- 欄位對照原型第 (18) 版的集合；狀態文字、文件 key、角色代碼沿用原型，不改名。
-- 跨資料表寫入一律走 Postgres 函式（RPC，第 8.4 節），在後續階段加入。

create extension if not exists pgcrypto;

-- ---------- 人員與設定 ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  -- 待審核的員工帳號 role 為空，want 記錄申請的角色；管理員核准後才寫入 role
  role text check (role in ('family','staff','nurse','care','admin')),
  want text check (want in ('family','staff','nurse','care','admin')),
  status text not null default '待審核' check (status in ('啟用','待審核','停用')),
  phone text not null default '',
  can_assign_nurse boolean not null default false,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  constraint can_assign_only_nurse check (not can_assign_nurse or role = 'nurse')
);

create table public.org_settings (
  id int primary key default 1 check (id = 1),           -- 只有一列
  name text not null,
  phone text not null default '',
  hours text not null default '',
  hospitals text[] not null default '{}',                 -- 合作醫院清單
  request_days int not null default 7 check (request_days between 1 and 90),   -- 補件期限天數
  flow_mode text not null default '先審後簽' check (flow_mode in ('先審後簽','先簽後審')),
  retention_days int not null default 365 check (retention_days > 0),
  rev int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create table public.doc_catalog (
  key text primary key,
  cat text not null check (cat in ('A','B','C','D','E','F','G')),
  name text not null,
  fam_name text not null,            -- 家屬端名稱；原型舊文字「長輩」只在顯示時轉成「住民」
  need text not null check (need in ('必備','條件式必備','選填','不適用')),
  cond text not null default '',
  stage text not null check (stage in ('評估前','入住前')),
  valid_days int,
  medical boolean not null,
  inst boolean not null default false,     -- 機構提供
  nurse_decides boolean not null default false,  -- 條件式由護理判斷（原型 nurse 欄位）
  why text not null default '',
  "where" text not null default '',
  parts jsonb,                              -- 核對項目（例如體檢報告的 CBC、肝功能…）
  sort int not null
);

-- ---------- 案件 ----------
create table public.cases (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,                  -- C-0001…
  family_id uuid not null references public.profiles(id),
  relation text not null default '',
  patient_name text not null,
  patient_nid text not null default '',
  patient_birth date,
  chart_no text not null default '',
  flow_mode text not null check (flow_mode in ('先審後簽','先簽後審')),  -- 建立時決定，之後不隨設定改變
  hospital text not null default '',
  planned_admit date,
  link_status text not null default '待確認' check (link_status in ('待確認','已確認')),
  confirmed_at timestamptz, confirmed_by uuid references public.profiles(id),
  nurse_id uuid references public.profiles(id),
  doc_due date, pre_due date,
  pre_docs_done_at timestamptz,
  signed_at timestamptz, signed_by uuid references public.profiles(id),
  closed_at timestamptz, closed_by uuid references public.profiles(id), closed_reason text, closed_title text,
  archived_at timestamptz, archived_by uuid references public.profiles(id), archive_status text,
  retain_hold jsonb,                        -- 延長保存 {until, type, note, by, at}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.cases (family_id);
create index on public.cases (nurse_id);

create table public.case_assignments (
  id bigint generated always as identity primary key,
  case_id uuid not null references public.cases(id) on delete cascade,
  nurse_id uuid not null references public.profiles(id),
  from_nurse_id uuid references public.profiles(id),
  by uuid not null references public.profiles(id),
  at timestamptz not null default now(),
  reason text,
  constraint change_needs_reason check (from_nurse_id is null or coalesce(btrim(reason), '') <> '')
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  name text not null, rel text not null default '', phone text not null,
  sort int not null default 0,
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id)
);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  ver int not null,
  signer_type text not null check (signer_type in ('本人','監護人','代理人','受輔助宣告')),
  signer_name text not null,
  signed_by uuid not null references public.profiles(id),
  signed_at timestamptz not null default now(),
  state text not null check (state in ('有效','待代理權核實','代理權未通過','已撤回','已取代')),
  proof_document_id uuid,                   -- 代理權證明（relProof 文件）
  verified_by uuid references public.profiles(id), verified_at timestamptz, verify_note text,
  withdrawn_at timestamptz, withdrawn_by uuid references public.profiles(id),
  emergency boolean not null default false,
  photo boolean not null default false,
  unique (case_id, ver)
);

-- ---------- 文件 ----------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  key text not null,                        -- 沿用 doclist key；G 類由行政新增時另取 key
  cat text not null check (cat in ('A','B','C','D','E','F','G')),
  name text not null,
  fam_name text not null default '',
  stage text not null check (stage in ('評估前','入住前')),
  need text not null check (need in ('必備','條件式必備','選填','不適用')),
  cond text not null default '',
  valid_days int,
  medical boolean not null,
  inst boolean not null default false,
  nurse_decides boolean not null default false,
  parts jsonb,
  sort int not null default 0,
  cond_met boolean,                         -- 條件式：null＝尚未判斷
  need_set_by uuid references public.profiles(id), need_set_at timestamptz, need_note text,
  need_ask jsonb,                           -- 行政「請護理重新判斷」
  need_history jsonb not null default '[]',
  not_applicable boolean not null default false,
  remind_n int not null default 0, remind_at timestamptz, remind_due date,   -- 一般提醒（不是補件）
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (case_id, key)
);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  v int not null,
  storage_path text,                        -- 沒有檔案的版本（護理補充評估、機構登錄）為 null
  file_name text, mime text, file_size bigint,
  file_removed boolean not null default false,   -- 封存後原始檔案已刪除
  uploaded_by uuid not null references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  provider text,                            -- 例如「機構」
  note text,
  user_date date,                           -- 家屬填的檢查日期
  phase text not null default 'received',
  id_check jsonb,                           -- 行政身分核對 {by, at, how, …}
  date_prelim date, date_confirmed date, date_by uuid references public.profiles(id), date_at timestamptz,
  admin_ok boolean,
  nurse_ok boolean, nurse_by uuid references public.profiles(id), nurse_at timestamptz,
  fields jsonb,                             -- 護理逐欄確認結果
  supp jsonb,                               -- 護理補充評估（沒有獨立文件）
  from_item jsonb,                          -- 沿用其他文件的檔案 {document_id, v, name}
  unique (document_id, v)
);

create table public.document_returns (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  version_v int,
  by uuid not null references public.profiles(id),
  at timestamptz not null default now(),
  reason text not null,
  note_for_family text
);

-- 正式補件：每次一列，id 就是補件事件 ID；關閉以 closed_at 為準（HANDOFF 10.3）
create table public.document_requests (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  source text not null check (source in ('護理','行政','系統','護理判斷')),
  reason text not null,
  note text,
  due date,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  uploaded_at timestamptz,
  closed_at timestamptz,
  closed_fix_by uuid references public.profiles(id),   -- 由「資料待修復」補上 closed_at 的人
  auto boolean not null default false
);
create index on public.document_requests (document_id);
-- 同一份文件同時只能有一筆開啟中的正式補件
create unique index document_requests_one_open on public.document_requests (document_id) where closed_at is null;

create table public.review_drafts (
  document_id uuid not null references public.documents(id) on delete cascade,
  version_v int not null,
  data jsonb not null,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (document_id, version_v)      -- 換版本不沿用
);

create table public.ocr_runs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  version_v int not null,
  model text, result jsonb,
  status text not null check (status in ('執行中','完成','失敗')),
  error text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.medical_facts (
  id bigint generated always as identity primary key,
  case_id uuid not null references public.cases(id) on delete cascade,
  document_id uuid not null references public.documents(id),
  version_v int not null,
  field text not null, value text not null default '',
  confirmed_by uuid not null references public.profiles(id),
  confirmed_at timestamptz not null default now()
);

create table public.diagnoses (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  text text not null,
  icd_code text, icd_name text,             -- 只檢查格式；系統沒有碼表、不自動產生代碼
  status text not null default '待確認' check (status in ('待確認','已確認','OCR 錯誤','不採用')),
  reason text,
  source_document uuid references public.documents(id),
  source_version int,
  synced_at timestamptz,
  history jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

-- ---------- 習慣卡 ----------
create table public.habit_cards (               -- 草稿：機構看不到
  case_id uuid primary key references public.cases(id) on delete cascade,
  draft jsonb not null default '{}',
  draft_updated_at timestamptz, draft_updated_by uuid references public.profiles(id)
);

create table public.habit_submissions (         -- 正式提交，rev 遞增
  case_id uuid not null references public.cases(id) on delete cascade,
  rev int not null,
  n int not null,                                -- 第幾次提交（舊資料 legacy 為 0）
  data jsonb not null,
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz,                      -- 舊版視為已提交的資料可能沒有時間
  legacy boolean not null default false,
  primary key (case_id, rev)
);

create table public.habit_reviews (
  id bigint generated always as identity primary key,
  case_id uuid not null references public.cases(id) on delete cascade,
  rev int not null,
  state text not null check (state in ('待審核','有疑義／待確認','審核完成','資料已變更，需重新確認','護理已閱')),
  diff_res jsonb, note text, med_snapshot jsonb, snap jsonb,
  reviewed_by uuid not null references public.profiles(id),
  reviewed_at timestamptz not null default now()
);

-- ---------- 評估、摘要卡 ----------
create table public.assessments (               -- 可多次，最新一筆有效
  id bigint generated always as identity primary key,
  case_id uuid not null references public.cases(id) on delete cascade,
  mode text not null,                            -- 收治評估／入住前確認
  result text not null,
  move text, behav text, iso text, reason text,
  coord jsonb,                                   -- 待協調後的處理 {note, by, at, from}
  outcome text,                                  -- 被重新評估、延期等取代時的結果
  notified_at timestamptz,
  by uuid not null references public.profiles(id),
  at timestamptz not null default now()
);

create table public.care_cards (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  v int not null,
  status text not null check (status in ('草稿','已開放','已停用','已取代')),
  content jsonb not null default '{}',           -- 中文＋印尼文＋越南文
  basis jsonb not null default '{}',             -- 開放時的依據快照，用來判斷 cardChanged
  review jsonb,
  opened_by uuid references public.profiles(id), opened_at timestamptz,
  end_at timestamptz, end_note text,
  updated_by uuid references public.profiles(id), updated_at timestamptz not null default now(),
  unique (case_id, v)
);
create unique index care_cards_one_open on public.care_cards (case_id) where status = '已開放';

create table public.care_card_caregivers (
  card_id uuid not null references public.care_cards(id) on delete cascade,
  caregiver_id uuid not null references public.profiles(id),
  primary key (card_id, caregiver_id)
);

-- ---------- 其他 ----------
create table public.visits (                     -- 參訪與保證金：只記錄，不阻擋流程，不處理付款
  id bigint generated always as identity primary key,
  case_id uuid not null references public.cases(id) on delete cascade,
  kind text not null, at date, note text,
  by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.cases(id) on delete cascade,
  "to" uuid not null references public.profiles(id),
  text text not null,
  at timestamptz not null default now(),
  read_at timestamptz
);
create index on public.notices ("to");

create table public.mail_jobs (
  id text primary key,                           -- 補件通知＝'req_' || request_id
  kind text not null check (kind in ('申請確認','補件通知')),
  case_id uuid not null references public.cases(id) on delete cascade,
  request_id uuid unique references public.document_requests(id),
  to_email text not null,
  status text not null default '待寄送' check (status in ('待寄送','寄送中','模擬已寄送（測試環境未實際寄出）','已寄送','寄送失敗','已取消')),
  claim_by text, claim_at timestamptz, send_key text,
  attempts jsonb not null default '[]',
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (                 -- 只能新增，不能改或刪
  id bigint generated always as identity primary key,
  case_id uuid references public.cases(id),     -- 有紀錄的案件不能被刪除（封存只刪檔案，不刪案件）
  actor uuid references public.profiles(id),
  actor_name text not null default '',
  role text,
  action text not null,
  detail text not null default '',
  family_visible boolean not null default false, -- 處理歷程中家屬看得到的事件
  at timestamptz not null default now()
);
create index on public.audit_logs (case_id, at);

create or replace function public.audit_logs_immutable() returns trigger language plpgsql as $$
begin
  raise exception '操作紀錄只能新增，不能修改或刪除';
end $$;
create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();

-- 私有 bucket；policy 在階段 6 加入（與資料表使用同一套存取函式）
insert into storage.buckets (id, name, public) values ('case-files', 'case-files', false)
  on conflict (id) do update set public = false;
