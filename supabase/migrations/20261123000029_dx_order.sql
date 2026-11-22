-- 修正：診斷清單排序。同一次核對帶入的多筆診斷寫入時間相同，原本再依 id（隨機）排序，順序會亂；
-- 改成同時間依病摘裡的第幾筆排序（與原型清單的加入順序相同）。其餘與 000028 相同。

create or replace function public.get_case_models(p_case uuid default null, p_include_closed boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r text := coalesce(public.auth_role(), case when auth.role() = 'service_role' then 'staff' end);
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
            'visible', dv.vis,
            'parts', (select coalesce(jsonb_agg(to_jsonb(p) order by p.sort), '[]') from public.document_parts p where p.document_id = d.id),
            'versions', (select coalesce(jsonb_agg(public.version_json(x, dv.vis) order by x.v), '[]') from public.document_versions x where x.document_id = d.id),
            'returns', (select coalesce(jsonb_agg(to_jsonb(t) order by t.at, t.id), '[]') from public.document_returns t where t.document_id = d.id),
            'requests', (select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at), '[]') from public.document_requests q where q.document_id = d.id),
            'need_changes', (select coalesce(jsonb_agg(to_jsonb(n) order by n.at, n.id), '[]') from public.document_need_changes n where n.document_id = d.id),
            'need_asks', (select coalesce(jsonb_agg(to_jsonb(n) order by n.asked_at, n.id), '[]') from public.document_need_asks n where n.document_id = d.id),
            'reminders', (select coalesce(jsonb_agg(to_jsonb(n) order by n.at, n.id), '[]') from public.document_reminders n where n.document_id = d.id)
          ) order by d.sort), '[]') from public.documents d cross join lateral (select case when r = 'nurse' then d.cat in ('B','C','D') else true end as vis) dv where d.case_id = c.id and d.deleted_at is null) else '[]' end,
      'visit', case when r = 'staff' or public.is_family_of(c.id) then (select to_jsonb(x) from public.case_visits x where x.case_id = c.id) end,
      'deposit', case when r = 'staff' then (select to_jsonb(x) from public.case_deposits x where x.case_id = c.id) end,
      'contacts', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(t) order by t.sort), '[]') from public.contacts t where t.case_id = c.id) else '[]' end,
      'habit_draft', case when public.is_family_of(c.id) then (select to_jsonb(h) from public.habit_cards h where h.case_id = c.id) end,
      'habit_sections', case when public.is_family_of(c.id) then (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from public.habit_card_sections s where s.case_id = c.id) else '[]' end,
      'apply_mail', case when v.is_full then (select jsonb_build_object('status', j.status, 'to_email', j.to_email, 'created_at', j.created_at,
          'attempts', (select count(*) from public.mail_attempts x where x.job_id = j.id)) from public.mail_jobs j where j.id = 'apply_' || c.id) end,
      'req_mails', case when v.is_full then public.req_mails_json(c.id) else '[]' end,
      'habit_submissions', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(s) order by s.rev), '[]') from public.habit_submissions s where s.case_id = c.id) else '[]' end,
      'habit_reviews', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(h) order by h.reviewed_at, h.id), '[]') from public.habit_reviews h where h.case_id = c.id) else '[]' end,
      'assessments', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object('items', (select coalesce(jsonb_agg(i.document_id), '[]') from public.assessment_items i where i.assessment_id = a.id)) order by a.at, a.id), '[]') from public.assessments a where a.case_id = c.id) else '[]' end,
      'cards', case when v.is_full then (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'v', k.v, 'status', k.status, 'basis', k.basis, 'opened_by', k.opened_by, 'opened_at', k.opened_at,
          'end_at', k.end_at, 'end_note', k.end_note, 'call', k.content->>'call',
          'caregivers', (select coalesce(jsonb_agg(g.caregiver_id), '[]') from public.care_card_caregivers g where g.card_id = k.id)) order by k.v), '[]')
        from public.care_cards k where k.case_id = c.id) else '[]' end,
      -- 診斷清單：行政與家屬只需要狀態與文字（計算摘要卡依據是否變更）；承辦護理另外拿到 ICD 與確認者
      'diagnoses', case when v.is_full then (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'status', g.status, 'text', g.text, 'std', g.std,
          'source_document', g.source_document, 'source_version', g.source_version, 'source_row', g.source_row, 'superseded_at', g.superseded_at,
          'icd_code', case when r = 'nurse' then g.icd_code end, 'icd_name', case when r = 'nurse' then g.icd_name end,
          'confirmed_by', g.confirmed_by, 'confirmed_at', g.confirmed_at, 'reason', g.reason) order by g.added_at, coalesce(g.source_row, 0), g.id), '[]')
        from public.diagnoses g where g.case_id = c.id) else '[]' end
    ) as m
    from public.cases c
    join public.residents rs on rs.id = c.resident_id
    cross join lateral (select (r = 'staff' or public.is_family_of(c.id) or public.is_case_nurse(c.id)) as is_full) v
    where (p_case is null or c.id = p_case)
      and (p_case is not null or p_include_closed or (c.closed_at is null and c.archived_at is null))
      and (public.can_read_case(c.id) or r = 'admin' or auth.role() = 'service_role')
  ) q;
  return out;
end $$;

