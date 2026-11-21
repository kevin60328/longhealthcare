-- get_case_models 配合正規化後的資料表（20261121000007_normalize.sql）重寫。
-- 回傳的內容與權限規則不變（見 000006 的說明），只是資料改從正規化後的各表組合：
--   住民（residents）、文件核對項目（document_parts）、需求判斷歷程（document_need_changes）、
--   請護理重新判斷（document_need_asks）、一般提醒（document_reminders）、護理確認欄位（medical_facts）。

-- 文件版本：可看內容時回傳全部欄位與護理確認欄位；不能看時只回傳判斷狀態用的欄位
create or replace function public.version_json(v public.document_versions, show_all boolean) returns jsonb
language sql stable set search_path = '' as $$
  select case when show_all then
      to_jsonb(v) || jsonb_build_object('facts', (select jsonb_object_agg(f.field, f.value) from public.medical_facts f where f.document_id = v.document_id and f.version_v = v.v))
    else jsonb_build_object('v', v.v, 'uploaded_by', v.uploaded_by, 'uploaded_at', v.uploaded_at, 'phase', v.phase, 'provider', v.provider,
      'id_checked_by', v.id_checked_by, 'id_checked_at', v.id_checked_at,
      'date_prelim', v.date_prelim, 'user_date', v.user_date, 'date_confirmed', v.date_confirmed, 'date_by', v.date_by, 'date_at', v.date_at,
      'admin_ok', v.admin_ok, 'nurse_ok', v.nurse_ok, 'nurse_by', v.nurse_by, 'nurse_at', v.nurse_at,
      'supp_src', case when v.supp_src is null then null else '' end, 'from_document_id', v.from_document_id, 'from_version', v.from_version, 'file_removed', v.file_removed)
  end
$$;

create or replace function public.get_case_models(p_case uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r text := public.auth_role();
  out jsonb;
begin
  if r is null or r = 'care' then raise exception '沒有權限' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(m order by m->'case'->>'created_at', m->'case'->>'id'), '[]'::jsonb) into out from (
    select jsonb_build_object(
      'full', v.is_full,
      'case', to_jsonb(c),
      'resident', to_jsonb(rs),
      'assignments', (select coalesce(jsonb_agg(to_jsonb(a) order by a.at nulls first, a.id), '[]') from public.case_assignments a where a.case_id = c.id),
      'consents', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(k) order by k.ver), '[]') from public.consents k where k.case_id = c.id) else '[]' end,
      'documents', case when v.is_full then (select coalesce(jsonb_agg(
          to_jsonb(d) || jsonb_build_object(
            'visible', public.can_read_document(d.id),
            'parts', (select coalesce(jsonb_agg(to_jsonb(p) order by p.sort), '[]') from public.document_parts p where p.document_id = d.id),
            'versions', (select coalesce(jsonb_agg(public.version_json(x, public.can_read_document(d.id)) order by x.v), '[]') from public.document_versions x where x.document_id = d.id),
            'returns', (select coalesce(jsonb_agg(to_jsonb(t) order by t.at), '[]') from public.document_returns t where t.document_id = d.id),
            'requests', (select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at), '[]') from public.document_requests q where q.document_id = d.id),
            'need_changes', (select coalesce(jsonb_agg(to_jsonb(n) order by n.at, n.id), '[]') from public.document_need_changes n where n.document_id = d.id),
            'need_asks', (select coalesce(jsonb_agg(to_jsonb(n) order by n.asked_at, n.id), '[]') from public.document_need_asks n where n.document_id = d.id),
            'reminders', (select coalesce(jsonb_agg(to_jsonb(n) order by n.at, n.id), '[]') from public.document_reminders n where n.document_id = d.id)
          ) order by d.sort), '[]') from public.documents d where d.case_id = c.id and d.deleted_at is null) else '[]' end,
      'habit_draft', case when public.is_family_of(c.id) then (select to_jsonb(h) from public.habit_cards h where h.case_id = c.id) end,
      'habit_submissions', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(s) order by s.rev), '[]') from public.habit_submissions s where s.case_id = c.id) else '[]' end,
      'habit_reviews', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(h) order by h.reviewed_at, h.id), '[]') from public.habit_reviews h where h.case_id = c.id) else '[]' end,
      'assessments', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(a) order by a.at, a.id), '[]') from public.assessments a where a.case_id = c.id) else '[]' end,
      'cards', case when v.is_full then (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'v', k.v, 'status', k.status, 'basis', k.basis, 'opened_by', k.opened_by, 'opened_at', k.opened_at,
          'end_at', k.end_at, 'end_note', k.end_note, 'call', k.content->>'call',
          'caregivers', (select coalesce(jsonb_agg(g.caregiver_id), '[]') from public.care_card_caregivers g where g.card_id = k.id)) order by k.v), '[]')
        from public.care_cards k where k.case_id = c.id) else '[]' end,
      'diagnoses', case when v.is_full then (select coalesce(jsonb_agg(jsonb_build_object('status', g.status, 'text', g.text, 'source_document', g.source_document, 'source_version', g.source_version) order by g.updated_at), '[]')
        from public.diagnoses g where g.case_id = c.id) else '[]' end
    ) as m
    from public.cases c
    join public.residents rs on rs.id = c.resident_id
    cross join lateral (select (r = 'staff' or public.is_family_of(c.id) or public.is_case_nurse(c.id)) as is_full) v
    where (p_case is null or c.id = p_case)
      and (public.can_read_case(c.id) or r = 'admin')
  ) q;
  return out;
end $$;

-- 照服員「我的住民」：住民姓名改從 residents 讀
create or replace function public.my_care_residents() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('case_id', c.id, 'patient_name', rs.name, 'planned_admit', c.planned_admit,
      'card_v', k.v, 'card_status', k.status, 'call', k.content->>'call') order by c.planned_admit), '[]'::jsonb)
  from public.care_cards k
  join public.care_card_caregivers g on g.card_id = k.id and g.caregiver_id = auth.uid()
  join public.cases c on c.id = k.case_id and c.closed_at is null
  join public.residents rs on rs.id = c.resident_id
  where public.auth_role() = 'care' and k.status in ('已開放', '已停用')
    and k.v = (select max(k2.v) from public.care_cards k2 where k2.case_id = k.case_id and k2.status in ('已開放', '已停用'))
$$;

revoke execute on function public.version_json(public.document_versions, boolean) from public, anon;
