-- 階段 1：RLS 輔助函式與基本讀取 policy（HANDOFF 第 8.3 節）
-- 原則：預設拒絕寫入。前端只有 anon key，所有新增／修改在後續階段以 RPC（security definer，一個交易內檢查權限與狀態）提供，
-- 或在確定需要時才逐表開放。這裡只開放讀取，並依角色與個案授權過濾。

-- ---------- 新帳號 → profiles ----------
-- role／status 只能由 service role 透過 app_metadata 指定（管理員建立、seed）；
-- 自行註冊時 user_metadata 只能決定姓名、電話與「想申請的角色」：家屬直接啟用，員工待審核且 role 為空。
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  app_role text := new.raw_app_meta_data->>'role';
  want text := coalesce(new.raw_user_meta_data->>'want', 'family');
begin
  if want not in ('family','staff','nurse','care') then want := 'family'; end if;
  insert into public.profiles (id, email, name, phone, role, want, status, can_assign_nurse, must_change_password)
  values (
    new.id, coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    case when app_role in ('family','staff','nurse','care','admin') then app_role when want = 'family' then 'family' end,
    coalesce(app_role, want),
    case when app_role is not null then coalesce(new.raw_app_meta_data->>'status', '啟用')
         when want = 'family' then '啟用' else '待審核' end,
    coalesce((new.raw_app_meta_data->>'can_assign_nurse')::boolean, false),
    coalesce((new.raw_app_meta_data->>'must_change_password')::boolean, false)
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 輔助函式（security definer：查 profiles／cases 時不受 RLS 遞迴影響） ----------
create or replace function public.auth_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and status = '啟用'
$$;

create or replace function public.can_assign() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = '啟用' and role = 'nurse' and can_assign_nurse)
$$;

create or replace function public.is_family_of(p_case uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.auth_role() = 'family' and exists (select 1 from public.cases where id = p_case and family_id = auth.uid())
$$;

create or replace function public.is_case_nurse(p_case uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.auth_role() = 'nurse' and exists (select 1 from public.cases where id = p_case and nurse_id = auth.uid())
$$;

-- 有分配權限的護理師另外可看「已確認、尚未分配」的案件（只看案件，不含文件）
create or replace function public.is_assignable_case(p_case uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_assign() and exists (
    select 1 from public.cases where id = p_case and link_status = '已確認' and nurse_id is null and closed_at is null)
$$;

create or replace function public.can_read_case(p_case uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case public.auth_role()
    when 'staff' then true
    when 'family' then public.is_family_of(p_case)
    when 'nurse' then public.is_case_nurse(p_case) or public.is_assignable_case(p_case)
    else false end
$$;

-- 文件：行政看全部；家屬看自己案件；承辦護理只看 B、C、D 類；照服員、管理員不行
create or replace function public.can_read_document(p_doc uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.documents d where d.id = p_doc and (
      public.auth_role() = 'staff'
      or public.is_family_of(d.case_id)
      or (public.is_case_nurse(d.case_id) and d.cat in ('B','C','D'))))
$$;

create or replace function public.is_caregiver_of(p_card uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.auth_role() = 'care' and exists (
    select 1 from public.care_cards k join public.care_card_caregivers g on g.card_id = k.id
    where k.id = p_card and k.status = '已開放' and g.caregiver_id = auth.uid())
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------- 預設拒絕寫入 ----------
-- Supabase 預設把 public schema 的表全部 grant 給 anon／authenticated；這裡收回，只留讀取，再靠 RLS 過濾列。
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant select on public.org_settings to anon;          -- 登入頁顯示機構名稱
alter default privileges in schema public revoke all on tables from anon, authenticated;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------- 讀取 policy ----------
-- profiles：自己；行政與管理員可看全部；護理看員工帳號與自己案件的家屬
create policy profiles_read on public.profiles for select to authenticated using (
  id = auth.uid()
  or public.auth_role() in ('staff','admin')
  or (public.auth_role() = 'nurse' and (
        role in ('staff','nurse','care','admin')
        or exists (select 1 from public.cases c where c.family_id = profiles.id and c.nurse_id = auth.uid()))));

create policy org_settings_read on public.org_settings for select to anon, authenticated using (true);
create policy doc_catalog_read on public.doc_catalog for select to authenticated using (true);

create policy cases_read on public.cases for select to authenticated using (
  public.can_read_case(id) or (public.auth_role() = 'admin'));   -- 管理員：封存、測試資料需要

create policy case_assignments_read on public.case_assignments for select to authenticated using (
  public.auth_role() in ('staff','admin') or public.is_case_nurse(case_id) or public.can_assign());

create policy contacts_read on public.contacts for select to authenticated using (public.can_read_case(case_id));
create policy consents_read on public.consents for select to authenticated using (public.can_read_case(case_id));

create policy documents_read on public.documents for select to authenticated using (public.can_read_document(id));
create policy document_versions_read on public.document_versions for select to authenticated using (public.can_read_document(document_id));
create policy document_returns_read on public.document_returns for select to authenticated using (public.can_read_document(document_id));
create policy document_requests_read on public.document_requests for select to authenticated using (public.can_read_document(document_id));

-- 核對草稿、OCR、醫療資料、診斷：只有承辦護理
create policy review_drafts_read on public.review_drafts for select to authenticated using (
  exists (select 1 from public.documents d where d.id = document_id and public.is_case_nurse(d.case_id) and d.cat in ('B','C','D')));
create policy ocr_runs_read on public.ocr_runs for select to authenticated using (
  exists (select 1 from public.documents d where d.id = document_id and public.is_case_nurse(d.case_id) and d.cat in ('B','C','D')));
create policy medical_facts_read on public.medical_facts for select to authenticated using (public.is_case_nurse(case_id));
create policy diagnoses_read on public.diagnoses for select to authenticated using (public.is_case_nurse(case_id));

-- 習慣卡草稿只給家屬；正式提交與初審：家屬、行政、承辦護理
create policy habit_cards_read on public.habit_cards for select to authenticated using (public.is_family_of(case_id));
create policy habit_submissions_read on public.habit_submissions for select to authenticated using (
  public.is_family_of(case_id) or public.auth_role() = 'staff' or public.is_case_nurse(case_id));
create policy habit_reviews_read on public.habit_reviews for select to authenticated using (
  public.is_family_of(case_id) or public.auth_role() = 'staff' or public.is_case_nurse(case_id));

create policy assessments_read on public.assessments for select to authenticated using (
  public.is_family_of(case_id) or public.auth_role() = 'staff' or public.is_case_nurse(case_id));

-- 摘要卡：承辦護理、行政（案件狀態需要）；照服員只看開放給自己且已開放的卡
create policy care_cards_read on public.care_cards for select to authenticated using (
  public.is_case_nurse(case_id) or public.auth_role() = 'staff' or public.is_caregiver_of(id));
create policy care_card_caregivers_read on public.care_card_caregivers for select to authenticated using (
  caregiver_id = auth.uid() and public.auth_role() = 'care'
  or exists (select 1 from public.care_cards k where k.id = card_id and (public.is_case_nurse(k.case_id) or public.auth_role() = 'staff')));

create policy visits_read on public.visits for select to authenticated using (
  public.auth_role() = 'staff' or public.is_family_of(case_id));

create policy notices_read on public.notices for select to authenticated using (
  "to" = auth.uid() or public.auth_role() = 'staff');

create policy mail_jobs_read on public.mail_jobs for select to authenticated using (
  public.can_read_case(case_id) or public.auth_role() = 'admin');

create policy audit_logs_read on public.audit_logs for select to authenticated using (
  public.auth_role() in ('staff','admin')
  or public.is_case_nurse(case_id)
  or (family_visible and public.is_family_of(case_id)));
