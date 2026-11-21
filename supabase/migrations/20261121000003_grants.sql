-- 明確授權（新建的 Supabase 專案不再自動把 public schema 的表授權給 API 角色）
-- service_role：只在後端（Edge Functions、本機 seed 腳本）使用，會略過 RLS，需要完整權限。
-- authenticated：只讀（實際能看到哪些列由 RLS 決定）；寫入在後續階段以 RPC 提供。
-- RLS policy 會呼叫輔助函式，所以登入者要有執行權限。

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

grant select on all tables in schema public to authenticated;
grant select on public.org_settings to anon;

grant execute on function public.auth_role(), public.can_assign(), public.is_family_of(uuid), public.is_case_nurse(uuid),
  public.is_assignable_case(uuid), public.can_read_case(uuid), public.can_read_document(uuid), public.is_caregiver_of(uuid)
  to authenticated;
