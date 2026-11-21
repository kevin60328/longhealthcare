-- 階段 3：工作清單與首頁需要的讀取函式
--
-- 1. get_case_models(p_case)：回傳「業務規則（js/modules/rules/core.js）需要的案件資料」。
--    為什麼不直接查表：原型的規則用整個案件的資料判斷階段（例如護理的工作清單也要知道身分文件是否已收件）。
--    若只用 RLS 讀得到的資料計算，護理看到的案件階段會和行政不同。所以由這個函式在資料庫內檢查權限後，
--    回傳同一份判斷用資料；呼叫者沒有權限看內容的文件（例如護理看 A／E／F 類），只回傳狀態欄位，
--    不回傳檔案路徑、檔名與內容欄位。
--    權限：行政＝全部案件；家屬＝自己的案件；承辦護理＝自己的案件；有分配權限的護理＝待分配案件（只有案件主檔）；
--          管理員＝案件主檔（封存用）；照服員＝不能呼叫。
-- 2. my_care_residents()：照服員「我的住民」清單（照服員不能讀案件表，只回傳清單需要的欄位）。
-- 3. mark_notices_read()：家屬打開通知頁時標為已讀。
-- 4. 通知用 Email（原型的 notifyEmail）：profiles.notify_email 與 set_notify_email()。

alter table public.profiles add column notify_email text;

-- 文件版本：可看內容時回傳全部欄位；不能看時只回傳判斷狀態用的欄位
create or replace function public.version_json(v public.document_versions, show_all boolean) returns jsonb
language sql stable set search_path = '' as $$
  select case when show_all then to_jsonb(v)
    else jsonb_build_object('v', v.v, 'uploaded_by', v.uploaded_by, 'uploaded_at', v.uploaded_at, 'phase', v.phase, 'provider', v.provider,
      'id_check', case when v.id_check is null then null else jsonb_build_object('at', v.id_check->'at', 'by', v.id_check->'by') end,
      'date_prelim', v.date_prelim, 'user_date', v.user_date, 'date_confirmed', v.date_confirmed, 'date_by', v.date_by, 'date_at', v.date_at,
      'admin_ok', v.admin_ok, 'nurse_ok', v.nurse_ok, 'nurse_by', v.nurse_by, 'nurse_at', v.nurse_at,
      'supp', case when v.supp is null then null else '{}'::jsonb end, 'from_item', v.from_item, 'file_removed', v.file_removed)
  end
$$;

create or replace function public.get_case_models(p_case uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r text := public.auth_role();
  out jsonb;
begin
  if r is null or r = 'care' then raise exception '沒有權限' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(m order by m->'case'->>'created_at'), '[]'::jsonb) into out from (
    select jsonb_build_object(
      'full', v.is_full,
      'case', to_jsonb(c),
      'assignments', (select coalesce(jsonb_agg(to_jsonb(a) order by a.at), '[]') from public.case_assignments a where a.case_id = c.id),
      'consents', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(k) order by k.ver), '[]') from public.consents k where k.case_id = c.id) else '[]' end,
      'documents', case when v.is_full then (select coalesce(jsonb_agg(
          (to_jsonb(d) - 'parts') || jsonb_build_object(
            'visible', public.can_read_document(d.id),
            'versions', (select coalesce(jsonb_agg(public.version_json(x, public.can_read_document(d.id)) order by x.v), '[]') from public.document_versions x where x.document_id = d.id),
            'returns', (select coalesce(jsonb_agg(to_jsonb(t) order by t.at), '[]') from public.document_returns t where t.document_id = d.id),
            'requests', (select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at), '[]') from public.document_requests q where q.document_id = d.id)
          ) order by d.sort), '[]') from public.documents d where d.case_id = c.id and d.deleted_at is null) else '[]' end,
      'habit_draft', case when public.is_family_of(c.id) then (select to_jsonb(h) from public.habit_cards h where h.case_id = c.id) end,
      'habit_submissions', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(s) order by s.rev), '[]') from public.habit_submissions s where s.case_id = c.id) else '[]' end,
      'habit_reviews', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(h) order by h.reviewed_at, h.id), '[]') from public.habit_reviews h where h.case_id = c.id) else '[]' end,
      'assessments', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(a) order by a.at, a.id), '[]') from public.assessments a where a.case_id = c.id) else '[]' end,
      -- 摘要卡：判斷階段只需要狀態、版本、開放紀錄與依據（basis）；內容（content）在摘要卡頁另外讀
      'cards', case when v.is_full then (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'v', k.v, 'status', k.status, 'basis', k.basis, 'opened_by', k.opened_by, 'opened_at', k.opened_at,
          'end_at', k.end_at, 'end_note', k.end_note, 'call', k.content->>'call',
          'caregivers', (select coalesce(jsonb_agg(g.caregiver_id), '[]') from public.care_card_caregivers g where g.card_id = k.id)) order by k.v), '[]')
        from public.care_cards k where k.case_id = c.id) else '[]' end,
      -- 診斷：只回傳判斷摘要卡依據需要的欄位
      'diagnoses', case when v.is_full then (select coalesce(jsonb_agg(jsonb_build_object('status', g.status, 'text', g.text, 'source_document', g.source_document, 'source_version', g.source_version) order by g.updated_at), '[]')
        from public.diagnoses g where g.case_id = c.id) else '[]' end
    ) as m
    from public.cases c
    cross join lateral (select (r = 'staff' or public.is_family_of(c.id) or public.is_case_nurse(c.id)) as is_full) v
    where (p_case is null or c.id = p_case)
      and (public.can_read_case(c.id) or r = 'admin')
  ) q;
  return out;
end $$;

-- 照服員「我的住民」：開放給自己的摘要卡（已開放或已停用），以及案件的姓名與預計入住日
create or replace function public.my_care_residents() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('case_id', c.id, 'patient_name', c.patient_name, 'planned_admit', c.planned_admit,
      'card_v', k.v, 'card_status', k.status, 'call', k.content->>'call') order by c.planned_admit), '[]'::jsonb)
  from public.care_cards k
  join public.care_card_caregivers g on g.card_id = k.id and g.caregiver_id = auth.uid()
  join public.cases c on c.id = k.case_id and c.closed_at is null
  where public.auth_role() = 'care' and k.status in ('已開放', '已停用')
    -- 同一案件只列最新一張（停用後再開新版時不重複）
    and k.v = (select max(k2.v) from public.care_cards k2 where k2.case_id = k.case_id and k2.status in ('已開放', '已停用'))
$$;

-- 家屬打開通知頁：自己的未讀通知標為已讀，回傳標記的筆數
create or replace function public.mark_notices_read() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null then raise exception '請先登入' using errcode = '28000'; end if;
  update public.notices set read_at = now() where "to" = auth.uid() and read_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- 通知用 Email：空白表示沿用登入帳號；格式不對就拒絕
create or replace function public.set_notify_email(p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare e text := nullif(lower(btrim(coalesce(p_email, ''))), ''); nm text;
begin
  if auth.uid() is null then raise exception '請先登入' using errcode = '28000'; end if;
  if e is not null and e !~ '^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception '電子郵件格式不正確' using errcode = 'check_violation';
  end if;
  update public.profiles set notify_email = e where id = auth.uid() returning name into nm;
  insert into public.audit_logs (actor, actor_name, role, action) values (auth.uid(), nm, public.auth_role(), nm || ' 修改通知用電子郵件');
  return e;
end $$;

revoke execute on function public.get_case_models(uuid), public.my_care_residents(), public.mark_notices_read(), public.set_notify_email(text), public.version_json(public.document_versions, boolean) from public, anon;
grant execute on function public.get_case_models(uuid), public.my_care_residents(), public.mark_notices_read(), public.set_notify_email(text) to authenticated;
