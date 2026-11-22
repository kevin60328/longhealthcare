-- 階段 5：cases.html 的資料表調整與寫入函式（RPC）。規則依原型第 (18) 版：
--   applyConfirm、apply-reject、assign-nurse、proofDecide、signed、case-cancel、coord、visit-edit、admit-save、need-edit（行政）、need-ask。
-- 每個 RPC 在一個交易內：鎖定案件 → 檢查身分、權限與狀態 → 寫入 → 通知家屬 → 記錄操作紀錄。
-- 使用者決定（2026/11/22）：多位行政共用工作清單；兩人同時處理同一件事時，後到的人由狀態檢查擋下。

-- ===================== 資料表調整 =====================
-- 行政不受理申請（原型 linkStatus＝已拒絕）
alter table public.cases drop constraint cases_link_status_check;
alter table public.cases add constraint cases_link_status_check check (link_status in ('待確認','已確認','已拒絕'));
-- 轉交護理部門：目前與確認同時發生，但是不同的事件（處理歷程分開顯示），所以獨立記錄
alter table public.cases add column handover_at timestamptz, add column handover_by uuid references public.profiles(id);
-- 結案時給家屬看的白話說明（原型 closed.text）
alter table public.cases add column closed_text text;

-- 參訪與保證金：每個案件一筆「目前狀態」，修改經過記在操作紀錄（只記錄，不阻擋流程，不處理付款）
drop table public.visits;
create table public.case_visits (
  case_id uuid primary key references public.cases(id) on delete cascade,
  needed text not null default '未確認' check (needed in ('未確認','需要','不需要')),
  status text not null default '未安排' check (status in ('未安排','已預約','已完成','已取消')),
  visit_date date, visit_time time,
  done_at timestamptz,
  note text,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint visit_booked_date check (status <> '已預約' or visit_date is not null),
  constraint visit_done_at check ((status = '已完成') = (done_at is not null))
);
create table public.case_deposits (
  case_id uuid primary key references public.cases(id) on delete cascade,
  applicable text not null default '未確認' check (applicable in ('未確認','適用','不適用')),
  status text not null default '未確認' check (status in ('未確認','待繳納','已登錄繳納紀錄','不適用')),
  note text,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint deposit_consistent check (not (applicable = '不適用' and status in ('待繳納','已登錄繳納紀錄')))
);
alter table public.case_visits enable row level security;
alter table public.case_deposits enable row level security;
grant select on public.case_visits, public.case_deposits to authenticated;
grant all on public.case_visits, public.case_deposits to service_role;
create policy case_visits_read on public.case_visits for select to authenticated using (public.auth_role() = 'staff' or public.is_family_of(case_id));
create policy case_deposits_read on public.case_deposits for select to authenticated using (public.auth_role() = 'staff' or public.is_family_of(case_id));

-- ===================== 共用小函式 =====================
create or replace function public.today_tw() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Taipei')::date $$;

create or replace function public.notify_family(p_case uuid, p_text text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notices (case_id, "to", text) select id, family_id, p_text from public.cases where id = p_case
$$;

-- 利益衝突（原型 selfConflict）：機構人員不能處理自己、同一電話或同名申請人提出的申請。
-- 只是測試環境的輔助判斷，不是正式身分驗證；判斷到時維持限制，由其他同仁處理。
create or replace function public.self_conflict(p_case uuid, p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when f.id = u.id then '這是您本人帳號提出的申請'
    when length(regexp_replace(coalesce(f.phone, ''), '\D', '', 'g')) >= 8
      and regexp_replace(coalesce(f.phone, ''), '\D', '', 'g') = regexp_replace(coalesce(u.phone, ''), '\D', '', 'g') then '疑似利益衝突：申請人的電話與您的帳號電話相同'
    when f.name <> '' and f.name = u.name then '疑似利益衝突：申請人姓名與您的姓名相同'
    else '' end
  from public.cases c join public.profiles f on f.id = c.family_id join public.profiles u on u.id = p_user
  where c.id = p_case
$$;
create or replace function public.conflict_note() returns text
language sql immutable set search_path = '' as $$
  select '此為測試環境依帳號、電話與姓名的輔助判斷，不代表正式身分驗證；同名或共用電話也可能不是同一人。請由其他授權人員或系統管理員確認後處理，系統不提供自行解除這項限制。'
$$;

-- 行政本人、啟用中；鎖定案件
create or replace function public.staff_case_for_update(p_case uuid) returns public.cases
language plpgsql security definer set search_path = '' as $$
declare c public.cases;
begin
  if public.auth_role() is distinct from 'staff' then raise exception '只有行政可以操作' using errcode = '42501'; end if;
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception '找不到這個案件' using errcode = 'P0002'; end if;
  return c;
end $$;

-- 目前有效的收治評估（最新一筆且沒有被重新評估、延期取代）
create or replace function public.current_assessment(p_case uuid) returns public.assessments
language sql stable security definer set search_path = '' as $$
  select a.* from public.assessments a where a.case_id = p_case and a.id = (select max(id) from public.assessments where case_id = p_case) and a.outcome is null
$$;

-- 已登錄簽約（原型 contractSigned）
create or replace function public.contract_signed(c public.cases) returns boolean
language sql immutable set search_path = '' as $$ select c.signed_at is not null $$;

-- 期限調整後「確認過期」的文件通知（文件由畫面依規則算出後傳入；這裡只接受本案件、有效期限的文件）
create or replace function public.notify_expired(p_case uuid, p_docs uuid[], p_admit date) returns int
language plpgsql security definer set search_path = '' as $$
declare d record; n int := 0;
begin
  for d in select fam_name, name, valid_days from public.documents where case_id = p_case and id = any(coalesce(p_docs, '{}')) and valid_days is not null order by sort loop
    perform public.notify_family(p_case, '入住日調整後，「' || coalesce(nullif(d.fam_name, ''), d.name) || '」需要重新檢查，請做 '
      || extract(month from p_admit - d.valid_days)::int || '/' || extract(day from p_admit - d.valid_days)::int || ' 以後的檢查。');
    n := n + 1;
  end loop;
  return n;
end $$;

-- ===================== 1. 確認申請並轉交護理部門／不受理 =====================
create or replace function public.confirm_case(p_case uuid, p_called boolean, p_chart text, p_admit date) returns date
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.staff_case_for_update(p_case); cf text := public.self_conflict(p_case, auth.uid()); due date;
begin
  if cf <> '' then raise exception '請由其他同仁處理：%。%', cf, public.conflict_note() using errcode = '42501'; end if;
  if c.link_status <> '待確認' or c.closed_at is not null then raise exception '這個申請已經處理過了' using errcode = 'P0001'; end if;
  if not coalesce(p_called, false) then raise exception '請先電話確認申請人身分與關係' using errcode = '22023'; end if;
  if p_admit is null then raise exception '請填寫預計入住日' using errcode = '22023'; end if;
  due := public.today_tw() + (select request_days from public.org_settings where id = 1);
  update public.cases set link_status = '已確認', planned_admit = p_admit, confirmed_at = now(), confirmed_by = auth.uid(),
    handover_at = now(), handover_by = auth.uid(), doc_due = due, updated_at = now() where id = c.id;
  /* 病歷號是住民的資料（residents）；有填才更新 */
  if coalesce(btrim(p_chart), '') <> '' then update public.residents set chart_no = btrim(p_chart), updated_at = now() where id = c.resident_id; end if;
  perform public.notify_family(c.id, '本中心已確認您的申請，請登入簽署個人資料同意書，並在 ' || extract(month from due)::int || '/' || extract(day from due)::int || ' 前上傳文件');
  perform public.log_action(c.id, '確認申請並轉交護理部門（待護理分配）');
  return due;
end $$;

create or replace function public.reject_application(p_case uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.staff_case_for_update(p_case); n text := btrim(coalesce(p_note, ''));
begin
  if n = '' then raise exception '請填寫說明' using errcode = '22023'; end if;
  if c.link_status <> '待確認' or c.closed_at is not null then raise exception '這個申請已經處理過了' using errcode = 'P0001'; end if;
  update public.cases set link_status = '已拒絕', closed_at = now(), closed_by = auth.uid(), closed_title = '機構無法受理這次申請', closed_text = n,
    closed_reason = '不受理', closed_type = '不受理', updated_at = now() where id = c.id;
  perform public.notify_family(c.id, '機構已回覆您的入住申請，請登入查看');
  perform public.log_action(c.id, '不受理申請：' || n);
end $$;

-- ===================== 2. 指定或更換承辦護理師 =====================
-- p_prev：畫面上看到的目前承辦人（防止兩人同時分配時互相覆蓋）
create or replace function public.assign_nurse(p_case uuid, p_nurse uuid, p_prev uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; c public.cases; t public.profiles; r text := btrim(coalesce(p_reason, '')); cf text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not (me.role = 'nurse' and me.status = '啟用' and me.can_assign_nurse) then raise exception '您沒有案件分配權限' using errcode = '42501'; end if;
  select * into c from public.cases where id = p_case for update;
  if not found or c.closed_at is not null or c.archived_at is not null or c.link_status <> '已確認' then raise exception '案件目前不能分配' using errcode = 'P0001'; end if;
  if c.nurse_id is distinct from p_prev then raise exception '承辦護理師已被其他人更改，請重新整理' using errcode = 'P0001'; end if;
  cf := public.self_conflict(c.id, me.id);
  if cf <> '' then raise exception '請由其他同仁分配：%。%', cf, public.conflict_note() using errcode = '42501'; end if;
  select * into t from public.profiles where id = p_nurse;
  if t.id is null or t.role <> 'nurse' or t.status <> '啟用' then raise exception '選擇的帳號不是啟用中的護理人員' using errcode = '22023'; end if;
  if t.id = c.nurse_id then raise exception '這位護理師已經是承辦人' using errcode = '22023'; end if;
  cf := public.self_conflict(c.id, t.id);
  if cf <> '' then raise exception '這位護理師不能承辦此案件：%', cf using errcode = '22023'; end if;
  if p_prev is not null and r = '' then raise exception '請填寫更換原因' using errcode = '22023'; end if;
  insert into public.case_assignments (case_id, nurse_id, from_nurse_id, by, at, reason) values (c.id, t.id, p_prev, me.id, now(), nullif(r, ''));
  perform public.log_action(c.id, case when p_prev is null then '指定承辦護理師：' || t.name || case when r <> '' then '（' || r || '）' else '' end
    else '承辦護理師由 ' || (select name from public.profiles where id = p_prev) || ' 更換為 ' || t.name || '（' || r || '）' end, false);
end $$;

-- ===================== 3. 代理權核實 =====================
-- 確認前，證明文件必須已完成收件核對（最新版本已核對身分、影本已確認、沒有被退回）
create or replace function public.verify_proxy(p_case uuid, p_ok boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.staff_case_for_update(p_case); k public.consents; n text := btrim(coalesce(p_note, '')); done boolean;
begin
  if n = '' then raise exception '請填寫核實說明' using errcode = '22023'; end if;
  if c.family_id = auth.uid() then raise exception '不能核實自己提出的案件' using errcode = '42501'; end if;
  select * into k from public.consents where case_id = c.id order by ver desc limit 1 for update;
  if k.id is null or k.state <> '待代理權核實' or k.withdrawn_at is not null then raise exception '同意狀態已變更，請重新整理' using errcode = 'P0001'; end if;
  if p_ok then
    select exists (select 1 from public.document_versions v where v.document_id = k.proof_document_id
        and v.v = (select max(v2.v) from public.document_versions v2 where v2.document_id = k.proof_document_id)
        and v.phase = 'checked' and v.admin_ok
        and not exists (select 1 from public.document_returns r where r.document_id = v.document_id and r.version_v = v.v)) into done;
    if not done then raise exception '請先完成證明文件收件核對' using errcode = 'P0001'; end if;
  end if;
  update public.consents set state = case when p_ok then '有效' else '代理權未通過' end, verified_at = now(), verified_by = auth.uid(), verify_note = n where id = k.id;
  perform public.log_action(c.id, case when p_ok then '代理權已確認，資料授權生效（' || n || '）' else '代理權無法核實，需要重新簽署（' || n || '）' end);
end $$;

-- ===================== 4. 記錄簽約 =====================
-- 先審後簽：護理評估「收治」後才能記錄；先簽後審：授權有效即可記錄。
-- p_later：簽約後需要家屬上傳的入住前文件（畫面依規則算出；這裡只接受本案件入住前階段的文件），用來通知家屬
create or replace function public.record_signing(p_case uuid, p_later uuid[]) returns date
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.staff_case_for_update(p_case); a public.assessments := public.current_assessment(p_case); due date; names text;
begin
  if c.signed_at is not null then raise exception '已經記錄過簽約' using errcode = 'P0001'; end if;
  if c.closed_at is not null or public.consent_state(c.id) <> '有效' then raise exception '案件已結案或資料授權無效' using errcode = 'P0001'; end if;
  if c.flow_mode = '先審後簽' and (a.id is null or a.result <> '收治') then raise exception '先審後簽：護理評估「收治」後才能記錄簽約' using errcode = 'P0001'; end if;
  due := public.today_tw() + (select request_days from public.org_settings where id = 1);
  update public.cases set signed_at = now(), signed_by = auth.uid(), pre_due = due, updated_at = now() where id = c.id;
  select string_agg(coalesce(nullif(fam_name, ''), name), '、' order by sort) into names from public.documents
    where case_id = c.id and stage = '入住前' and id = any(coalesce(p_later, '{}'));
  if names is not null then
    perform public.notify_family(c.id, '簽約完成。請在 ' || extract(month from due)::int || '/' || extract(day from due)::int || ' 前上傳入住前檢查：' || names || '。');
  end if;
  perform public.log_action(c.id, '記錄家屬已簽約');
  return due;
end $$;

-- ===================== 5. 結案（行政） =====================
create or replace function public.close_case(p_case uuid, p_type text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.staff_case_for_update(p_case); n text := btrim(coalesce(p_note, '')); ref boolean := p_type = '轉介其他機構'; phone text;
begin
  if p_type is null or p_type not in ('家屬放棄或逾期未簽','取消入住','轉介其他機構') then raise exception '請選擇結案原因' using errcode = '22023'; end if;
  if n = '' then raise exception '請填寫說明' using errcode = '22023'; end if;
  if c.closed_at is not null then raise exception '案件已經結案' using errcode = 'P0001'; end if;
  select org.phone into phone from public.org_settings org where id = 1;
  update public.cases set closed_at = now(), closed_by = auth.uid(), closed_title = case when ref then '已協助轉介其他機構' else '入住申請已結案' end,
    closed_text = case when ref then '' else '如需重新申請，請來電：' || coalesce(phone, '') end, closed_reason = p_type || '：' || n,
    closed_type = case when ref then '轉介' else '取消' end, updated_at = now() where id = c.id;
  perform public.notify_family(c.id, '您的入住申請狀態已更新，請登入查看');
  perform public.log_action(c.id, '結案（' || p_type || '）：' || n);
end $$;

-- ===================== 6. 協調（護理評估「待協調」或「不符合收治條件」之後） =====================
-- p_result：可入住／重評／延期／取消。延期要 p_date；取消要 p_close_type。p_expired：延期後確認過期的文件（畫面依規則算出）
create or replace function public.coordinate(p_case uuid, p_result text, p_note text, p_date date, p_close_type text, p_expired uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.staff_case_for_update(p_case); a public.assessments := public.current_assessment(p_case);
  n text := btrim(coalesce(p_note, '')); not_adm boolean; pass text; phone text; ref boolean;
begin
  if c.closed_at is not null or public.consent_state(c.id) <> '有效' or a.id is null or a.result not in ('待協調','不符合收治條件') then
    raise exception '案件目前不是待協調狀態' using errcode = 'P0001'; end if;
  not_adm := a.result = '不符合收治條件';
  pass := case c.flow_mode when '先審後簽' then '收治' else '可入住' end;
  if n = '' then raise exception '%', case when p_result = '取消' then '請填寫結果說明' when p_result = '延期' then '請填寫原因' else '請填寫協調內容' end using errcode = '22023'; end if;
  if p_result = '可入住' then
    if not_adm then raise exception '「不符合收治條件」需交回護理重新評估，行政不能直接改為可入住' using errcode = 'P0001'; end if;
    /* 新增一筆通過的評估（沿用原評估內容與評估人），原評估留在歷程 */
    insert into public.assessments (case_id, mode, result, move, behav, iso, reason, coord_from, coord_note, coord_by, coord_at, by, at)
      values (c.id, a.mode, pass, a.move, a.behav, a.iso, a.reason, '待協調', n, auth.uid(), now(), a.by, now());
    perform public.log_action(c.id, '協調完成，' || pass || '：' || n);
    perform public.notify_family(c.id, case when pass = '收治' then '好消息：協調完成，住民已通過評估，請來電預約參訪與簽約' else '入住安排已協調完成，照顧團隊正在準備' end);
  elsif p_result = '重評' then
    update public.assessments set outcome = '重新評估', coord_note = n, coord_by = auth.uid(), coord_at = now() where id = a.id;
    perform public.log_action(c.id, '協調結果：交回護理重新評估（' || n || '）');
  elsif p_result = '延期' then
    if p_date is null or p_date < public.today_tw() then raise exception '請選擇新的日期' using errcode = '22023'; end if;
    update public.cases set planned_admit = p_date, updated_at = now() where id = c.id;
    update public.assessments set outcome = '延期', coord_note = '延期：' || n, coord_by = auth.uid(), coord_at = now() where id = a.id;
    perform public.log_action(c.id, '協調結果：延後入住至 ' || to_char(p_date, 'YYYY/MM/DD') || '（' || n || '）');
    perform public.notify_family(c.id, '入住日已調整為 ' || to_char(p_date, 'YYYY/MM/DD') || '，請留意系統通知');
    perform public.notify_expired(c.id, p_expired, p_date);
  elsif p_result = '取消' then
    if p_close_type is null or p_close_type not in ('不符合收治條件，解除契約','轉介其他機構','取消入住') then raise exception '請選擇結果' using errcode = '22023'; end if;
    ref := p_close_type = '轉介其他機構';
    select org.phone into phone from public.org_settings org where id = 1;
    update public.cases set closed_at = now(), closed_by = auth.uid(),
      closed_title = case when ref then '已協助轉介其他機構' when not_adm then '經評估，本中心無法提供合適的照顧' else '入住申請已結案' end,
      closed_text = n || case when ref then '' else '　如有疑問請來電：' || coalesce(phone, '') end,
      closed_reason = p_close_type || '：' || n, closed_type = case when ref then '轉介' when not_adm then '不符合收治條件' else '取消' end, updated_at = now() where id = c.id;
    perform public.notify_family(c.id, '機構已通知您入住評估結果，請登入查看');
    perform public.log_action(c.id, '協調結果：' || p_close_type || '（' || n || '），已通知家屬並結案');
  else
    raise exception '協調結果不正確' using errcode = '22023';
  end if;
end $$;

-- ===================== 7. 預計入住日 =====================
create or replace function public.update_admit(p_case uuid, p_date date, p_expired uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.staff_case_for_update(p_case);
begin
  if p_date is null then raise exception '請輸入正確日期' using errcode = '22023'; end if;
  if c.closed_at is not null then raise exception '案件已結案' using errcode = 'P0001'; end if;
  update public.cases set planned_admit = p_date, updated_at = now() where id = c.id;
  perform public.log_action(c.id, '預計入住日改為 ' || to_char(p_date, 'YYYY/MM/DD') || '，重新檢查文件效期');
  perform public.notify_expired(c.id, p_expired, p_date);
end $$;

-- ===================== 8. 參訪與保證金（只記錄） =====================
create or replace function public.save_visit(p_case uuid, p_needed text, p_status text, p_date date, p_time time, p_note text,
  p_dep_app text, p_dep_status text, p_dep_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.staff_case_for_update(p_case); old public.case_visits;
begin
  if c.closed_at is not null or c.archived_at is not null then raise exception '案件已結案' using errcode = 'P0001'; end if;
  if p_status = '已預約' and p_date is null then raise exception '已預約時請填寫預定日期' using errcode = '22023'; end if;
  if p_dep_app = '不適用' and p_dep_status in ('待繳納','已登錄繳納紀錄') then raise exception '保證金不適用時，狀態請選「不適用」或「未確認」' using errcode = '22023'; end if;
  select * into old from public.case_visits where case_id = c.id;
  insert into public.case_visits (case_id, needed, status, visit_date, visit_time, done_at, note, updated_by, updated_at)
    values (c.id, p_needed, p_status, p_date, p_time,
      case when p_status = '已完成' then case when old.status = '已完成' then old.done_at else now() end end, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), now())
    on conflict (case_id) do update set needed = excluded.needed, status = excluded.status, visit_date = excluded.visit_date, visit_time = excluded.visit_time,
      done_at = excluded.done_at, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.case_deposits (case_id, applicable, status, note, updated_by, updated_at)
    values (c.id, p_dep_app, p_dep_status, nullif(btrim(coalesce(p_dep_note, '')), ''), auth.uid(), now())
    on conflict (case_id) do update set applicable = excluded.applicable, status = excluded.status, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform public.log_action(c.id, '更新參訪（' || p_needed || '，' || p_status || coalesce('，' || to_char(p_date, 'YYYY/MM/DD') || ' ' || coalesce(to_char(p_time, 'HH24:MI'), ''), '')
    || '）與保證金（' || p_dep_app || '，' || p_dep_status || '）', false);
end $$;

-- ===================== 9. 文件需求判斷（行政判斷的「視情況繳交」文件；管路、傷口、吞嚥由護理判斷，階段 7） =====================
-- 判斷文字與原型 needText 相同（行政判斷的文件）
create or replace function public.staff_need_text(m boolean) returns text
language sql immutable set search_path = '' as $$
  select case when m is true then '視情況：本案需要' when m is false then '視情況：本案不需要' else '視情況：尚未確認' end
$$;
-- p_met：true 需要／false 不需要／null 尚未確認
create or replace function public.set_document_need(p_doc uuid, p_met boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.documents; c public.cases; n text := btrim(coalesce(p_note, '')); before text; after text; active boolean;
begin
  if public.auth_role() is distinct from 'staff' then raise exception '只有行政可以判斷文件是否需要' using errcode = '42501'; end if;
  select * into d from public.documents where id = p_doc for update;
  if not found then raise exception '找不到這份文件' using errcode = 'P0002'; end if;
  select * into c from public.cases where id = d.case_id for update;
  if c.closed_at is not null or c.archived_at is not null or c.link_status <> '已確認' or public.consent_state(c.id) <> '有效' then raise exception '資料授權無效或案件已結案' using errcode = 'P0001'; end if;
  if d.nurse_decides then raise exception '管路、傷口、吞嚥資料是否需要，由負責護理師判斷' using errcode = '42501'; end if;
  if d.need <> '條件式必備' or d.not_applicable then raise exception '這份文件不是「視情況繳交」的文件' using errcode = 'P0001'; end if;
  if n = '' then raise exception '請填寫原因' using errcode = '22023'; end if;
  before := public.staff_need_text(d.cond_met); after := public.staff_need_text(p_met);
  if before = after then raise exception '判斷沒有變更' using errcode = 'P0001'; end if;
  update public.documents set cond_met = p_met where id = d.id;
  insert into public.document_need_changes (document_id, from_text, to_text, by, role, note) values (d.id, before, after, auth.uid(), 'staff', n);
  perform public.log_action(c.id, d.name || '：' || before || ' → ' || after || '（' || n || '）');
  /* 需要、還沒上傳、而且目前階段就要繳交：通知家屬準備 */
  active := d.stage = '評估前' or c.flow_mode = '先簽後審' or c.signed_at is not null;
  if p_met is true and active and not exists (select 1 from public.document_versions where document_id = d.id) then
    perform public.notify_family(c.id, '機構請您準備「' || coalesce(nullif(d.fam_name, ''), d.name) || '」：' || n);
  end if;
end $$;

-- 行政請護理重新判斷（管路、傷口、吞嚥）：只是提醒，不改變目前的判斷
create or replace function public.ask_nurse_need(p_doc uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.documents; c public.cases; n text := btrim(coalesce(p_note, ''));
begin
  if public.auth_role() is distinct from 'staff' then raise exception '只有行政可以對照護紀錄提出重新判斷請求' using errcode = '42501'; end if;
  select * into d from public.documents where id = p_doc for update;
  if not found or not d.nurse_decides or d.need <> '條件式必備' then raise exception '文件要求已改變，請重新整理' using errcode = 'P0001'; end if;
  select * into c from public.cases where id = d.case_id;
  if c.closed_at is not null or c.archived_at is not null or public.consent_state(c.id) <> '有效' then raise exception '資料授權無效或案件已結案' using errcode = 'P0001'; end if;
  if c.nurse_id is null then raise exception '案件尚未指派負責護理師' using errcode = 'P0001'; end if;
  if n = '' then raise exception '請填寫原因' using errcode = '22023'; end if;
  if exists (select 1 from public.document_need_asks where document_id = d.id and done_at is null) then raise exception '已經請護理重新判斷，尚未回覆' using errcode = 'P0001'; end if;
  insert into public.document_need_asks (document_id, asked_by, note) values (d.id, auth.uid(), n);
  perform public.log_action(c.id, '行政請護理重新判斷「' || d.name || '」：' || n, false);
end $$;

-- ===================== 權限 =====================
revoke execute on function public.today_tw(), public.notify_family(uuid, text), public.self_conflict(uuid, uuid), public.staff_case_for_update(uuid),
  public.current_assessment(uuid), public.contract_signed(public.cases), public.notify_expired(uuid, uuid[], date), public.staff_need_text(boolean) from public, anon, authenticated;
grant execute on function public.conflict_note() to authenticated;
revoke execute on function public.confirm_case(uuid, boolean, text, date), public.reject_application(uuid, text), public.assign_nurse(uuid, uuid, uuid, text),
  public.verify_proxy(uuid, boolean, text), public.record_signing(uuid, uuid[]), public.close_case(uuid, text, text),
  public.coordinate(uuid, text, text, date, text, uuid[]), public.update_admit(uuid, date, uuid[]),
  public.save_visit(uuid, text, text, date, time, text, text, text, text), public.set_document_need(uuid, boolean, text), public.ask_nurse_need(uuid, text) from public, anon;
grant execute on function public.confirm_case(uuid, boolean, text, date), public.reject_application(uuid, text), public.assign_nurse(uuid, uuid, uuid, text),
  public.verify_proxy(uuid, boolean, text), public.record_signing(uuid, uuid[]), public.close_case(uuid, text, text),
  public.coordinate(uuid, text, text, date, text, uuid[]), public.update_admit(uuid, date, uuid[]),
  public.save_visit(uuid, text, text, date, time, text, text, text, text), public.set_document_need(uuid, boolean, text), public.ask_nurse_need(uuid, text) to authenticated;

-- 畫面要顯示「哪位護理師因利益衝突不能承辦」：只有可分配的護理師、行政可以查詢
create or replace function public.case_conflicts(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if not (me.role = 'staff' or (me.role = 'nurse' and me.can_assign_nurse)) then raise exception '沒有權限' using errcode = '42501'; end if;
  return (select coalesce(jsonb_object_agg(p.id, public.self_conflict(p_case, p.id)), '{}'::jsonb) from public.profiles p
    where p.role in ('staff','nurse') and p.status = '啟用' and public.self_conflict(p_case, p.id) <> '');
end $$;
revoke execute on function public.case_conflicts(uuid) from public, anon;
grant execute on function public.case_conflicts(uuid) to authenticated;
