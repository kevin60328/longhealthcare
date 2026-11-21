-- 階段 2：登入與帳號（login.html）需要的資料庫變更
-- 1. 帳號狀態補上原型的「已退回」（管理員退回角色申請）
-- 2. 記錄最後登入時間
-- 3. 註冊時在資料庫端再檢查一次姓名與手機號碼，並寫入操作紀錄（前端檢查可以被繞過）
-- 4. 登入者只能透過下面三個 RPC 改自己的資料：記錄登入、補填手機號碼、改完密碼後清除「需要改密碼」

alter table public.profiles drop constraint profiles_status_check;
alter table public.profiles add constraint profiles_status_check check (status in ('啟用','待審核','已退回','停用'));
alter table public.profiles add column last_login_at timestamptz;
alter table public.profiles add column phone_updated_at timestamptz;
alter table public.profiles add column password_changed_at timestamptz;

-- 手機號碼（臺灣）：去掉空白、連字號、括號後須為 09 開頭 10 碼；儲存成 0912-345-678（與原型 phoneNorm 相同）
create or replace function public.phone_norm(p text) returns text
language sql immutable set search_path = '' as $$
  select case when regexp_replace(coalesce(p, ''), '[\s\-()]', '', 'g') ~ '^09\d{8}$'
    then substr(d, 1, 4) || '-' || substr(d, 5, 3) || '-' || substr(d, 8)
  end
  from (select regexp_replace(coalesce(p, ''), '[\s\-()]', '', 'g') as d) x
$$;

-- 角色中文名稱（操作紀錄用，與前端 ROLE_NAME 相同）
create or replace function public.role_name(r text) returns text
language sql immutable set search_path = '' as $$
  select case r when 'family' then '家屬／申請人' when 'staff' then '行政／社工' when 'nurse' then '護理人員'
    when 'care' then '照顧服務員' when 'admin' then '系統管理員' else coalesce(r, '') end
$$;

-- 新帳號 → profiles（取代階段 1 的版本）
-- 角色只能由 service role 指定（管理員建立帳號、seed 腳本直接寫 profiles）；
-- 自行註冊時使用者只能決定姓名、電話與「想申請的角色」：家屬直接啟用，員工待審核且 role 為空。
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  app_role text := new.raw_app_meta_data->>'role';
  want text := coalesce(new.raw_user_meta_data->>'want', 'family');
  nm text := btrim(coalesce(new.raw_user_meta_data->>'name', ''));
  ph text := public.phone_norm(new.raw_user_meta_data->>'phone');
begin
  if want not in ('family','staff','nurse','care') then want := 'family'; end if;
  -- 自行註冊（沒有 app_metadata 角色）必須有姓名與正確的手機號碼
  if app_role is null and (nm = '' or ph is null) then
    raise exception '註冊資料不完整：請填寫姓名與正確的手機號碼' using errcode = 'check_violation';
  end if;
  insert into public.profiles (id, email, name, phone, role, want, status, can_assign_nurse, must_change_password)
  values (
    new.id, coalesce(new.email, ''), nm, coalesce(ph, ''),
    case when app_role in ('family','staff','nurse','care','admin') then app_role when want = 'family' then 'family' end,
    coalesce(app_role, want),
    case when app_role is not null then coalesce(new.raw_app_meta_data->>'status', '啟用')
         when want = 'family' then '啟用' else '待審核' end,
    coalesce((new.raw_app_meta_data->>'can_assign_nurse')::boolean, false),
    coalesce((new.raw_app_meta_data->>'must_change_password')::boolean, false)
  );
  insert into public.audit_logs (actor, actor_name, role, action)
  values (new.id, nm, case when want = 'family' then 'family' end,
          nm || ' 註冊帳號（' || case when want = 'family' then '一般申請人' else '申請' || public.role_name(want) end || '）');
  return new;
end $$;

-- 記錄最後登入時間（只更新這個欄位，不覆蓋管理員剛做的停用或角色變更）
create or replace function public.record_login() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set last_login_at = now() where id = auth.uid() and status = '啟用';
$$;

-- 補填手機號碼：格式不對就拒絕，資料不變
create or replace function public.update_my_phone(p_phone text) returns text
language plpgsql security definer set search_path = '' as $$
declare ph text := public.phone_norm(p_phone); nm text;
begin
  if auth.uid() is null then raise exception '請先登入' using errcode = '28000'; end if;
  if ph is null then raise exception '請輸入正確的手機號碼，例如 0912-345-678' using errcode = 'check_violation'; end if;
  update public.profiles set phone = ph, phone_updated_at = now() where id = auth.uid() returning name into nm;
  insert into public.audit_logs (actor, actor_name, role, action) values (auth.uid(), nm, public.auth_role(), nm || ' 補填手機號碼');
  return ph;
end $$;

-- 改完密碼（前端已經用 Supabase Auth 更新密碼）後，清除「需要改密碼」並記錄
-- 只會影響自己的帳號；沒有真的改密碼就呼叫，結果只是跳過自己的強制改密碼，不會影響別人。
create or replace function public.password_changed() returns void
language plpgsql security definer set search_path = '' as $$
declare nm text;
begin
  if auth.uid() is null then raise exception '請先登入' using errcode = '28000'; end if;
  update public.profiles set must_change_password = false, password_changed_at = now() where id = auth.uid() returning name into nm;
  insert into public.audit_logs (actor, actor_name, role, action) values (auth.uid(), nm, public.auth_role(), nm || ' 修改密碼');
end $$;

revoke execute on function public.record_login(), public.update_my_phone(text), public.password_changed() from public, anon;
grant execute on function public.record_login(), public.update_my_phone(text), public.password_changed() to authenticated;
grant execute on function public.phone_norm(text), public.role_name(text) to authenticated, service_role;
