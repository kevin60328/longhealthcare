-- 重新開放已停用的摘要卡：補上伺服器端檢查（2026/11/23 使用者決定）。
-- 原型規則：摘要卡依據的資料（cardBasis）在停用期間改變了，就不能直接重新開放，要改用「修訂內容」產生新版本並審核。
-- 這個判斷（rules/core.js cardChanged）需要比對十幾項依據（習慣卡內容摘要、各文件版本…），用 SQL 重寫容易和畫面不一致，
-- 所以改由 Edge Function care-card 用同一份規則檢查，通過後以 service role 呼叫 resume_care_card_as。
-- 前端不能再直接呼叫 resume_care_card（收回權限），避免略過檢查。

create or replace function public.resume_care_card_as(p_case uuid, p_by uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare c public.cases; k public.care_cards;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception '只有後端程式可以執行' using errcode = '42501'; end if;
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception '找不到這個案件' using errcode = 'P0002'; end if;
  if c.nurse_id is distinct from p_by or not exists (select 1 from public.profiles where id = p_by and role = 'nurse' and status = '啟用') then
    raise exception '您不是這位住民的負責護理師' using errcode = '42501'; end if;
  if not public.case_can_process(c) then raise exception '案件已結案或授權已撤回，不能開放' using errcode = 'P0001'; end if;
  select * into k from public.care_cards where case_id = c.id and status = '已停用' order by v desc limit 1 for update;
  if k.id is null then raise exception '摘要卡目前不是停用狀態' using errcode = 'P0001'; end if;
  update public.care_cards set status = '已開放', end_at = null, end_note = null, updated_by = p_by, updated_at = now() where id = k.id;
  insert into public.audit_logs (case_id, actor, actor_name, role, action, family_visible)
    values (c.id, p_by, coalesce((select name from public.profiles where id = p_by), ''), 'nurse', '重新開放照顧摘要卡第 ' || k.v || ' 版', false);
  return k.v;
end $$;

revoke execute on function public.resume_care_card_as(uuid, uuid) from public, anon, authenticated;
grant execute on function public.resume_care_card_as(uuid, uuid) to service_role;
-- 舊的直接呼叫版本收回（保留函式本身，只是一般使用者不能再呼叫）
revoke execute on function public.resume_care_card(uuid) from public, anon, authenticated;
