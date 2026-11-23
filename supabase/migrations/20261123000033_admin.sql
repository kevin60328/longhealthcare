-- 階段 9：系統管理（settings.html）
-- HANDOFF 5（管理員）、6.1、8.4（close_case、archive_case）、8.5（admin-users）、10.10（保存規則、測試資料只在測試環境）
--
-- 內容：
--   1. system_env：這個資料庫是不是測試環境（測試資料功能只在測試環境）。migration 一律寫「否」，只有對測試專案執行 npm run db:seed（scripts/seed-test-data.mjs）時改成「是」
--   2. 帳號：核准、退回、停用／啟用、變更角色、案件分配權限（全部只限啟用中的管理員，記操作紀錄）。重設臨時密碼要用 Auth Admin API，在 Edge Function admin-users
--   3. 機構設定：update_org_settings（版本號防止兩位管理員同時修改；合作醫院清單一起更新）
--   4. 結案與封存：延長保存 add_retention_hold；封存的檔案刪除在 Edge Function admin-archive（Storage API），資料庫部分在 archive_case_as
--   5. 寄送異常：admin_mail_issues（寄送失敗、寄送中逾時、待寄送太久、補件存在但沒有通知工作）
--   6. 測試資料：reset_test_cases（只在測試環境、只限種子測試案件 T-A～T-D；操作紀錄的保護在這個函式執行期間對這 4 筆放行）

-- ===================== 1. 環境 =====================
create table public.system_env (
  id int primary key default 1 check (id = 1),
  is_test boolean not null default false
);
insert into public.system_env (id, is_test) values (1, false) on conflict (id) do nothing;
alter table public.system_env enable row level security;
grant select on public.system_env to authenticated;
grant all on public.system_env to service_role;
create policy system_env_read on public.system_env for select to authenticated using (true);
create or replace function public.is_test_env() returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce((select is_test from public.system_env where id = 1), false) $$;

-- ===================== 2. 帳號 =====================
create or replace function public.admin_guard() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.auth_role() is distinct from 'admin' then raise exception '只有系統管理員可以操作' using errcode = '42501'; end if;
end $$;
create or replace function public.role_word(r text) returns text
language sql immutable set search_path = '' as $$
  select case r when 'family' then '家屬／申請人' when 'staff' then '行政／社工' when 'nurse' then '護理人員' when 'care' then '照顧服務員' when 'admin' then '系統管理員' else coalesce(r, '') end
$$;
-- 鎖定要修改的帳號；不能修改自己（避免把自己停用或降級後沒有管理員）
create or replace function public.account_for_update(p_id uuid) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare a public.profiles;
begin
  perform public.admin_guard();
  if p_id = auth.uid() then raise exception '不能修改自己的帳號' using errcode = 'P0001'; end if;
  select * into a from public.profiles where id = p_id for update;
  if not found then raise exception '找不到這個帳號' using errcode = 'P0002'; end if;
  return a;
end $$;

-- 核准員工的角色申請（原型 acc-approve）：狀態改為啟用，角色＝申請的角色
create or replace function public.approve_account(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.profiles := public.account_for_update(p_id);
begin
  if a.status <> '待審核' then raise exception '這個申請已經處理過了' using errcode = 'P0001'; end if;
  if a.want not in ('staff','nurse','care','admin') then raise exception '申請的角色不正確' using errcode = 'P0001'; end if;
  update public.profiles set status = '啟用', role = a.want where id = a.id;
  perform public.log_action(null, '核准 ' || a.name || ' 為 ' || public.role_word(a.want), false);
end $$;

create or replace function public.reject_account(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.profiles := public.account_for_update(p_id);
begin
  if a.status <> '待審核' then raise exception '這個申請已經處理過了' using errcode = 'P0001'; end if;
  update public.profiles set status = '已退回' where id = a.id;
  perform public.log_action(null, '退回 ' || a.name || ' 的角色申請', false);
end $$;

-- 停用／重新啟用（停用後無法使用系統：每一頁都會檢查帳號狀態，資料庫權限也只認啟用中的帳號）
create or replace function public.set_account_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.profiles := public.account_for_update(p_id);
begin
  if p_status = '停用' and a.status <> '啟用' then raise exception '帳號目前不是啟用狀態' using errcode = 'P0001'; end if;
  if p_status = '啟用' and a.status <> '停用' then raise exception '帳號目前不是停用狀態' using errcode = 'P0001'; end if;
  if p_status not in ('啟用','停用') then raise exception '狀態不正確' using errcode = '22023'; end if;
  update public.profiles set status = p_status where id = a.id;
  perform public.log_action(null, case when p_status = '停用' then '停用 ' || a.name || ' 的帳號' else '重新啟用 ' || a.name || ' 的帳號' end, false);
end $$;

-- 變更職務角色（原型 acc-role）：回傳這位原本承辦、還沒結案的案件數（需要由有分配權限的護理人員改派）
create or replace function public.set_account_role(p_id uuid, p_role text) returns int
language plpgsql security definer set search_path = '' as $$
declare a public.profiles := public.account_for_update(p_id); n int;
begin
  if a.status <> '啟用' then raise exception '帳號目前不是啟用狀態' using errcode = 'P0001'; end if;
  if a.role is null or a.role = 'family' then raise exception '家屬帳號不能變更為機構角色' using errcode = 'P0001'; end if;
  if p_role not in ('staff','nurse','care','admin') then raise exception '請選擇角色' using errcode = '22023'; end if;
  if p_role = a.role then return 0; end if;
  update public.profiles set role = p_role, want = p_role, can_assign_nurse = case when p_role = 'nurse' then can_assign_nurse else false end where id = a.id;
  perform public.log_action(null, a.name || ' 角色由 ' || public.role_word(a.role) || ' 變更為 ' || public.role_word(p_role), false);
  select count(*) into n from public.cases where nurse_id = a.id and closed_at is null and archived_at is null;
  return case when a.role = 'nurse' then n else 0 end;
end $$;

-- 案件分配權限（是帳號設定，不是新角色；HANDOFF 5）
create or replace function public.set_assign_permission(p_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.profiles := public.account_for_update(p_id);
begin
  if a.role <> 'nurse' or a.status <> '啟用' then raise exception '只有啟用中的護理人員可以設定' using errcode = 'P0001'; end if;
  update public.profiles set can_assign_nurse = coalesce(p_on, false) where id = a.id;
  perform public.log_action(null, case when p_on then '開啟 ' else '取消 ' end || a.name || ' 的案件分配權限', false);
end $$;

-- 重設臨時密碼後由 Edge Function admin-users 呼叫：標示首次登入要改密碼、記操作紀錄（service role）
create or replace function public.mark_password_reset(p_id uuid, p_by uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.profiles;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception '只有後端程式可以執行' using errcode = '42501'; end if;
  update public.profiles set must_change_password = true where id = p_id returning * into a;
  insert into public.audit_logs (actor, actor_name, role, action, family_visible)
    values (p_by, coalesce((select name from public.profiles where id = p_by), ''), 'admin', '為 ' || a.name || ' 重設密碼（臨時密碼）', false);
end $$;

-- ===================== 3. 機構設定（原型 settingsForm） =====================
create or replace function public.update_org_settings(p_rev int, p_name text, p_phone text, p_hours text, p_request_days int, p_retention_days int,
  p_flow_mode text, p_partners text[]) returns int
language plpgsql security definer set search_path = '' as $$
declare o public.org_settings; n int := 0; h text;
begin
  perform public.admin_guard();
  select * into o from public.org_settings where id = 1 for update;
  if o.rev <> p_rev then raise exception '其他管理員剛更新過設定，請重新開啟後再修改' using errcode = 'P0001'; end if;
  if p_flow_mode not in ('先審後簽','先簽後審') then raise exception '請選擇入住流程順序' using errcode = '22023'; end if;
  if coalesce(p_request_days, 0) not between 1 and 60 then raise exception '補件期限請填 1～60 天' using errcode = '22023'; end if;
  if coalesce(p_retention_days, 0) < 30 then raise exception '結案資料保存天數至少 30 天' using errcode = '22023'; end if;
  update public.org_settings set name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), o.name), phone = btrim(coalesce(p_phone, '')), hours = btrim(coalesce(p_hours, '')),
    request_days = p_request_days, retention_days = p_retention_days, flow_mode = p_flow_mode, rev = o.rev + 1, updated_at = now(), updated_by = auth.uid() where id = 1;
  /* 合作醫院：清單上的依順序啟用（新的就新增），不在清單上的停用（保留紀錄，舊案件的醫院名稱不受影響） */
  update public.partner_hospitals set active = false;
  foreach h in array coalesce(p_partners, '{}') loop
    h := btrim(h);
    if h <> '' then
      insert into public.partner_hospitals (name, sort, active) values (h, n, true) on conflict (name) do update set sort = excluded.sort, active = true;
      n := n + 1;
    end if;
  end loop;
  perform public.log_action(null, '機構設定已更新' || case when o.flow_mode <> p_flow_mode then '（入住流程：' || o.flow_mode || ' → ' || p_flow_mode || '，只影響之後新建的申請）' else '' end, false);
  return o.rev + 1;
end $$;

-- ===================== 4. 結案與封存 =====================
create or replace function public.admin_archive_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_guard();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'no', c.no, 'name', rs.name, 'closed_at', c.closed_at, 'closed_title', c.closed_title, 'closed_reason', c.closed_reason,
      'archived_at', c.archived_at, 'archive_status', c.archive_status,
      'hold', (select jsonb_build_object('until', h.until, 'type', h.type, 'note', h.note) from public.retention_holds h where h.case_id = c.id order by h.at desc, h.id desc limit 1))
    order by c.closed_at), '[]')
    from public.cases c join public.residents rs on rs.id = c.resident_id where c.closed_at is not null);
end $$;

create or replace function public.add_retention_hold(p_case uuid, p_type text, p_note text, p_until date) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases;
begin
  perform public.admin_guard();
  select * into c from public.cases where id = p_case for update;
  if not found or c.closed_at is null or c.archived_at is not null then raise exception '案件狀態已改變' using errcode = 'P0001'; end if;
  if p_type not in ('法定保存義務','爭議處理中','主管機關調查','其他') then raise exception '請選擇保留原因' using errcode = '22023'; end if;
  if p_until is null or p_until < public.today_tw() then raise exception '請選擇保存期限' using errcode = '22023'; end if;
  insert into public.retention_holds (case_id, until, type, note, by) values (c.id, p_until, p_type, nullif(btrim(coalesce(p_note, '')), ''), auth.uid());
  perform public.log_action(c.id, '延長保存至 ' || to_char(p_until, 'YYYY/MM/DD') || '（' || p_type || '）', false);
end $$;

-- 封存前檢查並回傳要刪除的檔案位置（service role；由 Edge Function admin-archive 呼叫，確認管理員身分後）
create or replace function public.archive_targets(p_case uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare c public.cases;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception '只有後端程式可以執行' using errcode = '42501'; end if;
  select * into c from public.cases where id = p_case;
  if not found or c.closed_at is null then raise exception '只有已結案的案件可以封存' using errcode = 'P0001'; end if;
  if c.archived_at is not null then raise exception '案件已封存' using errcode = 'P0001'; end if;
  if exists (select 1 from public.retention_holds h where h.case_id = c.id and h.until >= public.today_tw()) then
    raise exception '此案件延長保存中，期限內不能封存' using errcode = 'P0001'; end if;
  return (select coalesce(array_agg(distinct v.storage_path), '{}') from public.document_versions v join public.documents d on d.id = v.document_id
    where d.case_id = c.id and v.storage_path is not null and not v.file_removed);
end $$;

-- 封存（原型 archive）：已刪除的檔案標示 file_removed（版本紀錄保留）；核對草稿與 AI 辨識暫存一併刪除；保留結案原因、文件清單與操作紀錄。
-- p_removed：Storage 已刪除的檔案；p_failed：刪除失敗的數量（狀態「處理未完成」，需管理員處理）
create or replace function public.archive_case_as(p_case uuid, p_by uuid, p_removed text[], p_failed int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.cases; nd int; no int; st text := case when coalesce(p_failed, 0) > 0 then '處理未完成' else '保存處理完成' end;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception '只有後端程式可以執行' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_by and role = 'admin' and status = '啟用') then raise exception '只有系統管理員可以封存' using errcode = '42501'; end if;
  select * into c from public.cases where id = p_case for update;
  if c.archived_at is not null then raise exception '案件已封存' using errcode = 'P0001'; end if;
  update public.document_versions v set file_removed = true from public.documents d
    where d.id = v.document_id and d.case_id = c.id and v.storage_path = any(coalesce(p_removed, '{}'));
  delete from public.review_drafts r using public.documents d where d.id = r.document_id and d.case_id = c.id;
  get diagnostics nd = row_count;
  delete from public.ocr_runs r using public.documents d where d.id = r.document_id and d.case_id = c.id;
  get diagnostics no = row_count;
  update public.cases set archived_at = now(), archived_by = p_by, archive_status = st, updated_at = now() where id = c.id;
  insert into public.audit_logs (case_id, actor, actor_name, role, action, family_visible)
    values (c.id, p_by, coalesce((select name from public.profiles where id = p_by), ''), 'admin',
      '封存案件：工作資料刪除 ' || (nd + no) || ' 筆、上傳檔案刪除 ' || coalesce(array_length(p_removed, 1), 0) || ' 份' || case when p_failed > 0 then '，' || p_failed || ' 份刪除失敗（需管理員處理）' else '' end, false);
  return jsonb_build_object('status', st, 'removed', coalesce(array_length(p_removed, 1), 0), 'work', nd + no);
end $$;

-- ===================== 5. 寄送異常 =====================
create or replace function public.admin_mail_issues() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_guard();
  return (select coalesce(jsonb_agg(x order by x->>'at' desc), '[]') from (
    select jsonb_build_object('kind', '通知工作', 'job_id', j.id, 'status', case when j.status = '寄送中' then '寄送中（逾時）' when j.status = '待寄送' then '待寄送（超過 10 分鐘）' else j.status end,
        'case_id', c.id, 'no', c.no, 'name', rs.name, 'doc', d.name, 'reason', q.reason, 'to_email', j.to_email, 'at', j.updated_at,
        'attempts', (select count(*) from public.mail_attempts a where a.job_id = j.id),
        'last_error', (select a.error from public.mail_attempts a where a.job_id = j.id order by a.at desc, a.id desc limit 1),
        'event', public.req_event(q.id)) as x
      from public.mail_jobs j join public.document_requests q on q.id = j.request_id join public.documents d on d.id = q.document_id
      join public.cases c on c.id = d.case_id join public.residents rs on rs.id = c.resident_id
      where j.status = '寄送失敗' or (j.status = '寄送中' and j.claim_at < now() - interval '2 minutes') or (j.status = '待寄送' and j.created_at < now() - interval '10 minutes')
    union all
    select jsonb_build_object('kind', '待建立', 'job_id', null, 'status', '待建立／建立失敗', 'case_id', c.id, 'no', c.no, 'name', rs.name, 'doc', d.name, 'reason', q.reason,
        'to_email', null, 'at', q.created_at, 'attempts', 0, 'last_error', null, 'event', 'open')
      from public.document_requests q join public.documents d on d.id = q.document_id join public.cases c on c.id = d.case_id join public.residents rs on rs.id = c.resident_id
      where q.closed_at is null and q.superseded_by is null and q.created_at < now() - interval '10 minutes'
        and not exists (select 1 from public.mail_jobs j where j.request_id = q.id) and public.req_event(q.id) = 'open'
  ) t);
end $$;

-- ===================== 6. 測試資料（只在測試環境） =====================
-- 操作紀錄保護：除了清除自動測試帳號的資料之外，測試環境「恢復種子測試案件」時也只對 T-A～T-D 的紀錄放行
create or replace function public.audit_logs_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.purge_tests', true), '') = 'on' and (
       exists (select 1 from public.cases c join public.profiles p on p.id = c.family_id where c.id = old.case_id and public.is_test_email(p.email))
       or (old.case_id is null and exists (select 1 from public.profiles p where p.id = old.actor and public.is_test_email(p.email)))
       or (public.is_test_env() and exists (select 1 from public.cases c where c.id = old.case_id and c.no in ('T-A','T-B','T-C','T-D')))) then
    return old;
  end if;
  raise exception '操作紀錄只能新增，不能修改或刪除';
end $$;

-- 刪除指定的種子測試案件（之後由 Edge Function admin-testdata 或 npm run db:seed-cases 重建）。回傳被刪除的案件 id（檔案由呼叫端用 Storage API 刪除）
create or replace function public.reset_test_cases(p_nos text[]) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare ids uuid[];
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception '只有後端程式可以執行' using errcode = '42501'; end if;
  if not public.is_test_env() then raise exception '測試資料功能只在測試環境' using errcode = '42501'; end if;
  if exists (select 1 from unnest(p_nos) n where n not in ('T-A','T-B','T-C','T-D')) then raise exception '只能處理種子測試案件 T-A～T-D' using errcode = '22023'; end if;
  select coalesce(array_agg(id), '{}') into ids from public.cases where no = any(p_nos);
  perform set_config('app.purge_tests', 'on', true);
  delete from public.audit_logs where case_id = any(ids);
  /* 補件通知工作沒有直接連到案件：先刪（補件刪除時本來也會連帶刪除） */
  delete from public.cases where id = any(ids);
  perform set_config('app.purge_tests', 'off', true);
  return ids;
end $$;

-- ===================== 權限 =====================
revoke execute on function public.admin_guard(), public.account_for_update(uuid), public.role_word(text), public.mark_password_reset(uuid, uuid),
  public.archive_targets(uuid), public.archive_case_as(uuid, uuid, text[], int), public.reset_test_cases(text[]) from public, anon, authenticated;
grant execute on function public.mark_password_reset(uuid, uuid), public.archive_targets(uuid), public.archive_case_as(uuid, uuid, text[], int), public.reset_test_cases(text[]) to service_role;
grant execute on function public.is_test_env() to authenticated, service_role;
revoke execute on function public.approve_account(uuid), public.reject_account(uuid), public.set_account_status(uuid, text), public.set_account_role(uuid, text),
  public.set_assign_permission(uuid, boolean), public.update_org_settings(int, text, text, text, int, int, text, text[]), public.admin_archive_list(),
  public.add_retention_hold(uuid, text, text, date), public.admin_mail_issues() from public, anon;
grant execute on function public.approve_account(uuid), public.reject_account(uuid), public.set_account_status(uuid, text), public.set_account_role(uuid, text),
  public.set_assign_permission(uuid, boolean), public.update_org_settings(int, text, text, text, int, int, text, text[]), public.admin_archive_list(),
  public.add_retention_hold(uuid, text, text, date), public.admin_mail_issues() to authenticated;
