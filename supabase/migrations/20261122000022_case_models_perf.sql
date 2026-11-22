-- 效能：get_case_models 每份文件只檢查一次「能不能看內容」（原本每份文件與每個版本各檢查一次）。結果不變。

create or replace function public.get_case_models(p_case uuid default null, p_include_closed boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  /* 伺服器端程式（Edge Function case-phases，用 service role）視同行政，可讀完整判斷資料；一般使用者依角色 */
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
            'returns', (select coalesce(jsonb_agg(to_jsonb(t) order by t.at), '[]') from public.document_returns t where t.document_id = d.id),
            'requests', (select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at), '[]') from public.document_requests q where q.document_id = d.id),
            'need_changes', (select coalesce(jsonb_agg(to_jsonb(n) order by n.at, n.id), '[]') from public.document_need_changes n where n.document_id = d.id),
            'need_asks', (select coalesce(jsonb_agg(to_jsonb(n) order by n.asked_at, n.id), '[]') from public.document_need_asks n where n.document_id = d.id),
            'reminders', (select coalesce(jsonb_agg(to_jsonb(n) order by n.at, n.id), '[]') from public.document_reminders n where n.document_id = d.id)
          ) order by d.sort), '[]') from public.documents d cross join lateral (select public.can_read_document(d.id) or auth.role() = 'service_role' as vis) dv where d.case_id = c.id and d.deleted_at is null) else '[]' end,
      -- 參訪與保證金：行政與家屬（家屬端顯示參訪預約；保證金只給行政）
      'visit', case when r = 'staff' or public.is_family_of(c.id) then (select to_jsonb(x) from public.case_visits x where x.case_id = c.id) end,
      'deposit', case when r = 'staff' then (select to_jsonb(x) from public.case_deposits x where x.case_id = c.id) end,
      'contacts', case when v.is_full then (select coalesce(jsonb_agg(to_jsonb(t) order by t.sort), '[]') from public.contacts t where t.case_id = c.id) else '[]' end,
      'habit_draft', case when public.is_family_of(c.id) then (select to_jsonb(h) from public.habit_cards h where h.case_id = c.id) end,
      'habit_sections', case when public.is_family_of(c.id) then (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from public.habit_card_sections s where s.case_id = c.id) else '[]' end,
      -- 申請確認 Email（家屬端顯示通知狀態；只回傳狀態、收件地址與嘗試次數，不含內容）
      'apply_mail', case when v.is_full then (select jsonb_build_object('status', j.status, 'to_email', j.to_email, 'created_at', j.created_at,
          'attempts', (select count(*) from public.mail_attempts x where x.job_id = j.id)) from public.mail_jobs j where j.id = 'apply_' || c.id) end,
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
      -- 沒指定案件時，預設只回傳進行中的案件（結案、封存的案件只在需要時讀取）
      and (p_case is not null or p_include_closed or (c.closed_at is null and c.archived_at is null))
      and (public.can_read_case(c.id) or r = 'admin' or auth.role() = 'service_role')
  ) q;
  return out;
end $$;
