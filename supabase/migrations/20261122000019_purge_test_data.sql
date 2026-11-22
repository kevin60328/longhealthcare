-- 清除自動測試留下的資料（2026/11/22 使用者決定：只開放清除測試帳號的資料）
--
-- 背景：操作紀錄只能新增、不能修改或刪除（HANDOFF），所以有紀錄的案件刪不掉。自動測試每次都會建立案件，
--       累積到測試專案有 9 成以上是測試留下的資料，畫面與權限檢查都變慢、測試逾時。
-- 做法：purge_test_data() 只刪「自動測試帳號」建立的案件與這些帳號的操作紀錄。
--   自動測試帳號＝電子郵件 e2e-…@example.com 或 rls-…@example.com（example.com 是保留給範例用的網域，真實使用者不會有）。
--   只有 service role（後端金鑰，只在本機腳本與測試使用）能執行；一般使用者、管理員都不能呼叫。
--   操作紀錄的保護觸發器只在這個函式執行期間、而且只對測試案件與測試帳號的紀錄放行；其他紀錄仍然不能改、不能刪。
-- 帳號本身（auth.users）由腳本 scripts/clean-test-data.mjs 用 Auth Admin API 刪除。

create or replace function public.is_test_email(e text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(e, '') ~ '^(e2e|rls)-[^@]*@example\.com$'
$$;

-- 操作紀錄：除了清除測試資料（且只限測試案件或測試帳號的紀錄）之外，一律不能修改或刪除
create or replace function public.audit_logs_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.purge_tests', true), '') = 'on' and (
       exists (select 1 from public.cases c join public.profiles p on p.id = c.family_id where c.id = old.case_id and public.is_test_email(p.email))
       or (old.case_id is null and exists (select 1 from public.profiles p where p.id = old.actor and public.is_test_email(p.email)))) then
    return old;
  end if;
  raise exception '操作紀錄只能新增，不能修改或刪除';
end $$;

create or replace function public.purge_test_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n_cases int; n_logs int; n_res int; n_conf int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception '只有後端程式可以清除測試資料' using errcode = '42501'; end if;
  perform set_config('app.purge_tests', 'on', true);
  create temp table purge_cases on commit drop as
    select c.id from public.cases c join public.profiles p on p.id = c.family_id where public.is_test_email(p.email);
  delete from public.audit_logs where case_id in (select id from purge_cases)
    or (case_id is null and actor in (select id from public.profiles where public.is_test_email(email)));
  get diagnostics n_logs = row_count;
  delete from public.resident_conflicts where family_id in (select id from public.profiles where public.is_test_email(email));
  get diagnostics n_conf = row_count;
  delete from public.cases where id in (select id from purge_cases);
  get diagnostics n_cases = row_count;
  /* 已經沒有任何案件、也沒有待確認紀錄的住民（測試建立的） */
  delete from public.residents r where not exists (select 1 from public.cases c where c.resident_id = r.id)
    and not exists (select 1 from public.resident_conflicts x where x.resident_id = r.id);
  get diagnostics n_res = row_count;
  perform set_config('app.purge_tests', 'off', true);
  return jsonb_build_object('cases', n_cases, 'logs', n_logs, 'residents', n_res, 'conflicts', n_conf);
end $$;

revoke execute on function public.purge_test_data() from public, anon, authenticated;
grant execute on function public.purge_test_data() to service_role;
revoke execute on function public.is_test_email(text) from public, anon, authenticated;
