-- 資料庫清理（2026/11/28 使用者決定：移除沒有用到的欄位與多餘的外鍵，讓每個欄位都說得出用途）
-- 依據：逐欄比對網頁程式、Edge Functions、資料庫函式與權限規則（只讀檢查），結果與理由見 docs/DATABASE.md 第 10 節。
--
-- A. 從來沒有寫入過的欄位：
--    assessments.notified_at（原型記「評估結果已通知家屬」的時間；完成版在送出評估的同一交易寫通知，時間即通知的建立時間）
--    audit_logs.detail（操作內容一律寫在 action）
--    documents.deleted_at（系統沒有刪除文件的功能；不需要的文件用「本案不需要」處理。下面 16 個函式的「未刪除」條件一併移除）
-- B. 多餘的外鍵（已由「文件＋版本」的外鍵涵蓋）：ocr_runs、review_drafts、document_returns、diagnoses 單獨指向文件的外鍵。
--    document_returns 先規定版本必填；diagnoses 先規定「來源文件與版本同時有或同時沒有」（人工新增的診斷兩者皆無），再移除。
-- C. 只寫不讀、操作紀錄已記錄的欄位：profiles.phone_updated_at、profiles.password_changed_at、cases.archived_by、diagnoses.synced_at
--    （profiles.last_login_at 保留，改在帳號管理顯示「最後登入」；diagnosis_changes、resident_conflicts 的處理紀錄保留並在畫面顯示）
-- 函式內容取自線上目前的定義，只移除上述欄位，其他邏輯不變。CREATE OR REPLACE 會保留原本的執行權限。

-- doc_case_for_update：移除 1 處「文件未刪除」條件
CREATE OR REPLACE FUNCTION public.doc_case_for_update(p_doc uuid)
 RETURNS cases
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.cases;
begin
  select x.* into r from public.cases x join public.documents y on y.case_id = x.id where y.id = p_doc for update of x;
  if not found then raise exception '找不到這份文件' using errcode = 'P0002'; end if;
  return r;
end $function$;

-- get_case_models：移除 1 處「文件未刪除」條件
CREATE OR REPLACE FUNCTION public.get_case_models(p_case uuid DEFAULT NULL::uuid, p_include_closed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
          ) order by d.sort), '[]') from public.documents d cross join lateral (select case when r = 'nurse' then d.cat in ('B','C','D') else true end as vis) dv where d.case_id = c.id) else '[]' end,
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
end $function$;

-- file_document：移除 1 處「文件未刪除」條件
CREATE OR REPLACE FUNCTION public.file_document(p_name text)
 RETURNS documents
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select d.* from public.documents d where d.case_id::text = split_part(p_name, '/', 1) and d.key = split_part(p_name, '/', 2)
$function$;

-- reuse_file：移除 1 處「文件未刪除」條件
CREATE OR REPLACE FUNCTION public.reuse_file(p_doc uuid, p_from uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.documents; c public.cases; s public.documents; sv public.document_versions; st text; nv int; ok boolean;
begin
  c := public.doc_case_for_update(p_doc); select * into d from public.documents where id = p_doc for update;
  if public.auth_role() is distinct from 'family' or c.family_id <> auth.uid() then raise exception '只有申請人可以上傳' using errcode = '42501'; end if;
  if not public.case_can_process(c) then raise exception '資料授權無效或案件已結案，無法上傳' using errcode = 'P0001'; end if;
  select * into s from public.documents where id = p_from and case_id = c.id;
  sv := public.doc_cur(p_from);
  ok := s.id is not null and s.id <> d.id and sv.id is not null and sv.storage_path is not null and not sv.file_removed and (
    (d.cat = 'B' and s.key = 'exam')
    or (d.cat = 'D' and s.cat in ('C','D') and sv.from_document_id is null and public.doc_status(s.id) <> '需補件'));
  if not ok then raise exception '這份文件不能沿用' using errcode = 'P0001'; end if;
  if public.doc_na(d) then raise exception '這份文件不需要繳交' using errcode = 'P0001'; end if;
  st := public.doc_status(d.id);
  if st not in ('未上傳','確認過期','需補件') then raise exception '這份文件機構正在確認中，不需要重複上傳' using errcode = 'P0001'; end if;
  nv := coalesce((select max(v) from public.document_versions where document_id = d.id), 0) + 1;
  insert into public.document_versions (document_id, v, storage_path, file_name, mime, file_size, uploaded_by, user_date, phase, from_document_id, from_version)
    values (d.id, nv, sv.storage_path, sv.file_name, sv.mime, sv.file_size, auth.uid(), case when d.valid_days is not null then sv.user_date end, 'received', s.id, sv.v);
  update public.document_requests set uploaded_at = now() where id = (public.open_request(d.id)).id;
  perform public.log_action(c.id, '上傳 ' || d.name || '（第 ' || nv || ' 版，沿用「' || s.name || '」第 ' || sv.v || ' 版檔案）');
  return nv;
end $function$;

-- request_documents：移除 2 處「文件未刪除」條件
CREATE OR REPLACE FUNCTION public.request_documents(p_case uuid, p_docs uuid[], p_other text, p_other_medical boolean, p_reason text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.cases := public.staff_case_for_update(p_case); d public.documents; v public.document_versions; due date; names text[] := '{}'; blocked text;
  reqs uuid[] := '{}'; other text := btrim(coalesce(p_other, '')); note text := btrim(coalesce(p_note, '')); before text; nid uuid;
begin
  if not public.case_can_process(c) then raise exception '資料授權無效或案件已結案' using errcode = 'P0001'; end if;
  if p_reason not in ('文件不完整或缺頁','影本不清楚','資料與申請不符','需要補充其他文件') then raise exception '請選擇原因' using errcode = '22023'; end if;
  if coalesce(array_length(p_docs, 1), 0) = 0 and other = '' then raise exception '請至少選一份文件，或填寫其他資料' using errcode = '22023'; end if;
  if exists (select 1 from unnest(coalesce(p_docs, '{}')) x where not exists (select 1 from public.documents where id = x and case_id = c.id)) then
    raise exception '文件不屬於這個案件' using errcode = 'P0001'; end if;
  select string_agg(name, '、') into blocked from public.documents where id = any(p_docs) and nurse_decides and need = '條件式必備' and not public.doc_needed(documents);
  if blocked is not null then raise exception '%是否需要由負責護理師判斷，不能直接要求補件。請先按「請護理重新判斷」。沒有送出任何補件要求。', blocked using errcode = 'P0001'; end if;
  if exists (select 1 from public.documents where id = any(p_docs) and (not public.doc_stage_active(documents, c) or (public.doc_na(documents) and not nurse_decides))) then
    raise exception '有文件目前不需要繳交，不能要求補件' using errcode = 'P0001'; end if;
  due := public.today_tw() + public.req_days();
  for d in select * from public.documents where id = any(p_docs) order by sort for update loop
    v := public.doc_cur(d.id);
    if v.id is not null then insert into public.document_returns (document_id, version_v, by, reason, note_for_family) values (d.id, v.v, auth.uid(), p_reason, nullif(note, '')); end if;
    reqs := reqs || public.new_request(d.id, '行政', p_reason, note, due);
    if not public.doc_needed(d) then
      before := case when d.need = '選填' then '選填' else public.staff_need_text(d.cond_met) end;
      update public.documents set need = '必備', cond_met = null where id = d.id;
      insert into public.document_need_changes (document_id, from_text, to_text, by, role, note) values (d.id, before, '必備', auth.uid(), 'staff', '行政要求補件');
    end if;
    names := names || public.fam_doc_name(d);
  end loop;
  if other <> '' then
    if exists (select 1 from public.documents where case_id = c.id and name = other) then raise exception '這個案件已經有同名的文件' using errcode = 'P0001'; end if;
    insert into public.documents (case_id, key, cat, name, fam_name, stage, need, medical, sort, custom_why, custom_where)
      values (c.id, 'extra_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10), 'G', other, other, '評估前', '必備', coalesce(p_other_medical, false),
        50 + (select count(*) from public.documents where case_id = c.id), '機構需要這份資料：' || coalesce(nullif(note, ''), p_reason), '請洽機構承辦人')
      returning id into nid;
    reqs := reqs || public.new_request(nid, '行政', p_reason, note, due);
    names := names || other;
  end if;
  perform public.notify_family(c.id, '請在 ' || public.md_tw(due) || ' 前補件：' || array_to_string(names, '、'));
  perform public.log_action(c.id, '行政要求補件：' || array_to_string(names, '、') || '（' || p_reason || coalesce('：' || nullif(note, ''), '') || '，期限 ' || to_char(due, 'YYYY/MM/DD') || '）');
  return jsonb_build_object('due', due, 'requests', to_jsonb(reqs));
end $function$;

-- add_case_document：移除 1 處「文件未刪除」條件
CREATE OR REPLACE FUNCTION public.add_case_document(p_case uuid, p_name text, p_cat text, p_need text, p_medical boolean, p_stage text, p_why text, p_where text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.cases := public.staff_case_for_update(p_case); n text := btrim(coalesce(p_name, '')); why text := btrim(coalesce(p_why, '')); nid uuid; d public.documents;
begin
  if not public.case_can_process(c) then raise exception '資料授權無效或案件已結案' using errcode = 'P0001'; end if;
  if n = '' then raise exception '請填寫文件名稱' using errcode = '22023'; end if;
  if why = '' then raise exception '請填寫為什麼需要，家屬才知道要準備什麼' using errcode = '22023'; end if;
  if p_cat not in ('A','B','C','D','E','F','G') or p_need not in ('必備','選填') or p_stage not in ('評估前','入住前') then raise exception '請選擇類別、是否需要繳交與時機' using errcode = '22023'; end if;
  if exists (select 1 from public.documents where case_id = c.id and name = n) then raise exception '這個案件已經有同名的文件' using errcode = 'P0001'; end if;
  insert into public.documents (case_id, key, cat, name, fam_name, stage, need, medical, sort, custom_why, custom_where)
    values (c.id, 'custom_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10), p_cat, n, n, p_stage, p_need, coalesce(p_medical, false),
      60 + (select count(*) from public.documents where case_id = c.id), why, coalesce(nullif(btrim(coalesce(p_where, '')), ''), '請洽機構承辦人'))
    returning * into d;
  insert into public.document_need_changes (document_id, from_text, to_text, by, role, note) values (d.id, '', case when p_need = '必備' then '需要繳交' else '選填' end, auth.uid(), 'staff', '個案新增');
  perform public.log_action(c.id, '新增個案指定文件：' || n || '（' || case when p_need = '必備' then '需要繳交' else '選填' end || '，' || (select x from (values ('A','身分與聯絡資料'),('B','入住前健康檢查資料'),('C','醫療資料'),('D','特殊照護資料'),('E','授權與法律文件'),('F','契約與費用'),('G','其他補充文件')) t(k, x) where k = p_cat) || '）');
  if p_need = '必備' and public.doc_stage_active(d, c) then perform public.notify_family(c.id, '機構請您補充「' || n || '」：' || why); end if;
  return d.id;
end $function$;

-- req_event：移除 1 處「文件未刪除」條件
CREATE OR REPLACE FUNCTION public.req_event(p_request uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when q.id is null or d.id is null then 'gone'
    when q.superseded_by is not null then 'replaced'
    when q.closed_at is not null then 'closed'
    when public.doc_done(d.id) then 'missing'
    else 'open' end
  from (select 1) x
  left join public.document_requests q on q.id = p_request
  left join public.documents d on d.id = q.document_id
$function$;

-- set_nurse_need：移除 1 處「文件未刪除」條件
CREATE OR REPLACE FUNCTION public.set_nurse_need(p_doc uuid, p_met boolean, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.documents; c public.cases; n text := btrim(coalesce(p_note, '')); before text; after text; v public.document_versions;
  q public.document_requests; due date; reqs uuid[] := '{}'; msg text := ''; accepted boolean; ask_open boolean; why text; wh text;
begin
  select x.* into d from public.documents x where x.id = p_doc;
  if not found then raise exception '找不到這份文件' using errcode = 'P0002'; end if;
  c := public.nurse_case_for_update(d.case_id);
  select * into d from public.documents where id = p_doc for update;
  if not public.case_can_process(c) then raise exception '資料授權無效或案件已結案' using errcode = 'P0001'; end if;
  if not d.nurse_decides or d.need <> '條件式必備' then raise exception '這份文件不是由護理判斷的「視情況繳交」文件' using errcode = 'P0001'; end if;
  if p_met is false and n = '' then raise exception '選「本案不需要」時請寫簡短原因' using errcode = '22023'; end if;
  before := case when d.cond_met is true then '護理已確認：需要' when d.cond_met is false then '護理已確認：不需要' else '待護理確認' end;
  after := case when p_met is true then '護理已確認：需要' when p_met is false then '護理已確認：不需要' else '待護理確認' end;
  ask_open := exists (select 1 from public.document_need_asks where document_id = d.id and done_at is null);
  if d.cond_met is not distinct from p_met and (n = '' or n = coalesce((select note from public.document_need_changes where document_id = d.id order by at desc, id desc limit 1), '')) then
    raise exception '%', case when ask_open then '判斷沒有變更：要維持原判斷，請在備註寫下回覆行政的原因' else '判斷沒有變更' end using errcode = 'P0001';
  end if;
  update public.documents set cond_met = p_met where id = d.id;
  insert into public.document_need_changes (document_id, from_text, to_text, by, role, note) values (d.id, before, after, auth.uid(), 'nurse', n);
  update public.document_need_asks set done_at = now(), done_by = auth.uid() where document_id = d.id and done_at is null;
  perform public.log_action(c.id, d.name || '：' || before || ' → ' || after || coalesce('（' || nullif(n, '') || '）', ''));
  select * into d from public.documents where id = d.id;
  v := public.doc_cur(d.id);
  accepted := v.id is not null and public.doc_status(d.id) not in ('需補件','確認過期');
  q := public.open_request(d.id);
  if public.doc_needed(d) and public.doc_stage_active(d, c) and not accepted then
    /* 判斷需要、目前階段、家屬還沒有可用的文件 → 自動建立正式補件（已有開啟中的就不重複） */
    if q.id is null then
      due := public.today_tw() + public.req_days();
      reqs := array[public.new_request(d.id, '護理判斷', '護理師確認需要提供', null, due, true)];
      wh := coalesce(nullif((select "where" from public.doc_catalog where key = d.catalog_key), ''), d.custom_where, '請洽本中心');
      perform public.notify_family(c.id, '護理師確認需要提供「' || public.fam_doc_name(d) || '」，請在 ' || public.md_tw(due) || ' 前上傳。準備方式：' || replace(wh, '長輩', '住民'));
      perform public.log_action(c.id, '系統依護理判斷自動建立補件要求：' || d.name || '（期限 ' || to_char(due, 'YYYY/MM/DD') || '），已通知家屬');
      msg := '系統已自動建立補件要求並通知家屬';
    end if;
  elsif not public.doc_needed(d) and q.id is not null and v.id is null then
    /* 改判不需要或尚待確認：關閉尚未完成的補件 */
    why := case when public.doc_na(d) then '護理改判為本案不需要' else '護理改為尚待確認' end;
    update public.document_requests set closed_at = now(), closed_by = auth.uid(), closed_reason = why where id = q.id;
    perform public.notify_family(c.id, case when public.doc_na(d) then '「' || public.fam_doc_name(d) || '」經護理師確認目前不需要提供，您不用再上傳。'
      else '「' || public.fam_doc_name(d) || '」護理師還在確認是否需要，目前先不用上傳，確認後會再通知您。' end);
    perform public.log_action(c.id, d.name || '：' || why || '，關閉尚未完成的補件要求並通知家屬');
    msg := '已關閉尚未完成的補件要求並通知家屬';
  end if;
  perform public.after_doc_change(d.id);
  return jsonb_build_object('requests', to_jsonb(reqs), 'message', msg);
end $function$;

-- save_review_draft：移除 1 處「文件未刪除」條件
CREATE OR REPLACE FUNCTION public.save_review_draft(p_doc uuid, p_v integer, p_data jsonb)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.documents; c public.cases; v public.document_versions; t timestamptz;
begin
  select x.* into d from public.documents x where x.id = p_doc;
  if not found then raise exception '找不到這份文件' using errcode = 'P0002'; end if;
  c := public.nurse_case_for_update(d.case_id);
  if not public.case_can_process(c) then raise exception '資料授權無效或案件已結案' using errcode = 'P0001'; end if;
  v := public.doc_cur(d.id);
  if v.id is null or v.v <> p_v then raise exception '文件已有新版本或已被移除，請重新開啟' using errcode = 'P0001'; end if;
  if coalesce(v.nurse_ok, false) then raise exception '這個版本已完成核對' using errcode = 'P0001'; end if;
  insert into public.review_drafts (document_id, version_v, data, updated_by) values (d.id, p_v, coalesce(p_data, '{}'), auth.uid())
    on conflict (document_id, version_v) do update set data = excluded.data, updated_by = excluded.updated_by, updated_at = now()
    returning updated_at into t;
  return t;
end $function$;

-- complete_review：移除 1 處「文件未刪除」條件
CREATE OR REPLACE FUNCTION public.complete_review(p_doc uuid, p_v integer, p_fields jsonb, p_review jsonb, p_review_src text, p_labs jsonb, p_dx jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.documents; c public.cases; v public.document_versions; k text; val text; n int := 0; reqs uuid[];
begin
  select x.* into d from public.documents x where x.id = p_doc;
  if not found then raise exception '找不到這份文件' using errcode = 'P0002'; end if;
  c := public.nurse_case_for_update(d.case_id);
  select * into d from public.documents where id = p_doc for update;
  if not public.case_can_process(c) then raise exception '授權無效或案件已結案，不能完成核對' using errcode = 'P0001'; end if;
  v := public.doc_cur(d.id);
  if v.id is null or v.v <> p_v or public.doc_status(d.id) <> '待護理核對' then raise exception '文件狀態已改變（可能有新版本），請重新開啟' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_fields) <> 'object' or p_fields = '{}'::jsonb then raise exception '沒有核對內容' using errcode = '22023'; end if;
  if p_dx is not null and not coalesce((p_dx->>'absent')::boolean, false)
     and exists (select 1 from jsonb_array_elements(coalesce(p_dx->'rows', '[]')) r where r->>'state' not in ('已確認','不採用')) then
    raise exception '還有診斷尚未確認' using errcode = 'P0001';
  end if;
  for k, val in select key, value from jsonb_each_text(p_fields) loop
    insert into public.medical_facts (document_id, version_v, field, value, confirmed_by) values (d.id, p_v, k, coalesce(val, ''), auth.uid());
    n := n + 1;
  end loop;
  update public.document_versions set nurse_ok = true, nurse_by = auth.uid(), nurse_at = now(),
    review = p_review, review_src = nullif(btrim(coalesce(p_review_src, '')), ''), labs = nullif(p_labs, '{}'::jsonb), dx_rows = p_dx
    where id = v.id;
  perform public.sync_diagnoses(d.id, p_v);
  delete from public.review_drafts where document_id = d.id and version_v = p_v;
  perform public.log_action(c.id, d.name || ' 第 ' || p_v || ' 版護理核對完成（' || coalesce(nullif(btrim(p_review_src), ''), '人工核對') || '）');
  reqs := public.after_doc_change(d.id);
  return jsonb_build_object('status', public.doc_status(d.id), 'facts', n, 'requests', to_jsonb(reqs));
end $function$;

-- return_document：移除 1 處「文件未刪除」條件
CREATE OR REPLACE FUNCTION public.return_document(p_doc uuid, p_v integer, p_reason text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.documents; c public.cases; v public.document_versions; due date; rid uuid; note text := btrim(coalesce(p_note, ''));
begin
  select x.* into d from public.documents x where x.id = p_doc;
  if not found then raise exception '找不到這份文件' using errcode = 'P0002'; end if;
  c := public.nurse_case_for_update(d.case_id);
  select * into d from public.documents where id = p_doc for update;
  if not public.case_can_process(c) then raise exception '授權無效或案件已結案' using errcode = 'P0001'; end if;
  if p_reason not in ('文件模糊，看不清楚','缺少頁面','內容前後矛盾','疑似不是本人的資料') then raise exception '請選擇原因' using errcode = '22023'; end if;
  v := public.doc_cur(d.id);
  if v.id is null or v.v <> p_v or public.doc_status(d.id) <> '待護理核對' then raise exception '文件狀態已改變' using errcode = 'P0001'; end if;
  due := public.today_tw() + public.req_days();
  insert into public.document_returns (document_id, version_v, by, reason, note_for_family) values (d.id, v.v, auth.uid(), p_reason, nullif(note, ''));
  rid := public.new_request(d.id, '護理', p_reason, note, due);
  delete from public.review_drafts where document_id = d.id and version_v = p_v;
  perform public.log_action(c.id, d.name || ' 退回補件：' || p_reason || '（期限 ' || to_char(due, 'YYYY/MM/DD') || '）');
  perform public.notify_family(c.id, '請在 ' || public.md_tw(due) || ' 前重新上傳「' || public.fam_doc_name(d) || '」：' || p_reason);
  return jsonb_build_object('due', due, 'requests', to_jsonb(array[rid]));
end $function$;

-- save_supp：移除 1 處「文件未刪除」條件
CREATE OR REPLACE FUNCTION public.save_supp(p_doc uuid, p_src text, p_note text, p_fields jsonb, p_review jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.documents; c public.cases; nv int; k text; val text; note text := btrim(coalesce(p_note, '')); reqs uuid[];
begin
  select x.* into d from public.documents x where x.id = p_doc;
  if not found then raise exception '找不到這份文件' using errcode = 'P0002'; end if;
  c := public.nurse_case_for_update(d.case_id);
  select * into d from public.documents where id = p_doc for update;
  if not public.case_can_process(c) or d.cat <> 'D' or not public.doc_needed(d) or public.doc_status(d.id) not in ('未上傳','需補件') then
    raise exception '這份文件目前不能做護理補充評估（只限需要繳交、尚未上傳或需補件的照護紀錄）' using errcode = 'P0001';
  end if;
  if p_src not in ('電話詢問來源醫院護理站','入住前訪視或評估','與家屬會談','其他已上傳文件內容（請註明）') then raise exception '請選擇資料來源' using errcode = '22023'; end if;
  if note = '' then raise exception '請寫下來源說明（例如聯絡的單位與人員、參考的文件）' using errcode = '22023'; end if;
  if jsonb_typeof(p_fields) <> 'object' or p_fields = '{}'::jsonb or exists (select 1 from jsonb_each_text(p_fields) e where btrim(coalesce(e.value, '')) = '') then
    raise exception '每個欄位都要填寫；沒有資料請寫「未提供」或「未知」' using errcode = '22023';
  end if;
  nv := coalesce((select max(v) from public.document_versions where document_id = d.id), 0) + 1;
  insert into public.document_versions (document_id, v, uploaded_by, phase, id_checked_by, id_checked_at, id_check_how, supp_src, supp_note, nurse_ok, nurse_by, nurse_at, review, review_src)
    values (d.id, nv, auth.uid(), 'checked', auth.uid(), now(), '護理補充評估（沒有獨立文件，不需身分比對）', p_src, note, true, auth.uid(), now(), p_review, '護理補充評估（' || p_src || '）');
  for k, val in select key, value from jsonb_each_text(p_fields) loop
    insert into public.medical_facts (document_id, version_v, field, value, confirmed_by) values (d.id, nv, k, btrim(val), auth.uid());
  end loop;
  perform public.log_action(c.id, d.name || ' 第 ' || nv || ' 版：護理補充評估（' || p_src || '；' || note || '）');
  reqs := public.after_doc_change(d.id);
  return jsonb_build_object('v', nv, 'status', public.doc_status(d.id));
end $function$;

-- docs_ready：移除 1 處「文件未刪除」條件
CREATE OR REPLACE FUNCTION public.docs_ready(p_case uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select not exists (
    select 1 from public.documents d join public.cases c on c.id = d.case_id
    where d.case_id = p_case and d.key <> 'contract'
      and public.doc_stage_active(d, c) and not public.doc_na(d)
      and (public.doc_needed(d) or (d.need = '條件式必備' and d.cond_met is null) or exists (select 1 from public.document_versions v where v.document_id = d.id))
      and (not public.doc_done(d.id) or (d.need = '條件式必備' and d.cond_met is null and not d.not_applicable)))
$function$;

-- save_assessment：移除 1 處「文件未刪除」條件
CREATE OR REPLACE FUNCTION public.save_assessment(p_case uuid, p_result text, p_move text, p_behav text, p_iso text, p_dnr_state text, p_dnr_src text, p_reason text, p_docs uuid[], p_other text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.cases := public.nurse_case_for_update(p_case); a public.assessments := public.current_assessment(p_case); cf text := public.self_conflict(p_case, auth.uid());
  reason text := btrim(coalesce(p_reason, '')); other text := btrim(coalesce(p_other, '')); pass text; mode text; aid bigint; d public.documents; v public.document_versions;
  due date; reqs uuid[] := '{}'; nid uuid; before text; names text[] := '{}';
begin
  if not public.case_can_process(c) then raise exception '資料授權無效或案件已結案，不能評估' using errcode = 'P0001'; end if;
  if cf <> '' then raise exception '請由其他護理師評估：%。%', cf, public.conflict_note() using errcode = '42501'; end if;
  pass := case when c.flow_mode = '先審後簽' then '收治' else '可入住' end;
  mode := case when c.flow_mode = '先審後簽' then '收治評估' else '入住前確認' end;
  if (c.flow_mode = '先審後簽' and p_result not in ('收治','需補充','待協調','不收治'))
     or (c.flow_mode = '先簽後審' and p_result not in ('可入住','需補充','待協調','不符合收治條件')) then
    raise exception '「%」流程不能選「%」', c.flow_mode, coalesce(p_result, '') using errcode = '22023'; end if;
  if not public.docs_ready(c.id) then raise exception '必要文件尚未全部確認符合，不能評估' using errcode = 'P0001'; end if;
  if a.id is null and not public.habit_gate(c.id) then raise exception '生活與照護習慣卡尚未完成必要初審（家屬正式提交、護理初審完成），不能開始收治評估' using errcode = 'P0001'; end if;
  if c.flow_mode = '先簽後審' and c.signed_at is null then raise exception '先簽後審的案件尚未記錄入住契約，不能做入住前確認' using errcode = 'P0001'; end if;
  if a.id is not null and a.result <> '需補充' then raise exception '案件目前不在評估階段（已有評估結果：%）', a.result using errcode = 'P0001'; end if;
  if p_result <> pass and reason = '' then raise exception '請填寫說明' using errcode = '22023'; end if;
  if p_dnr_state like '已確認%' and btrim(coalesce(p_dnr_src, '')) = '' then raise exception '選擇 DNR「已確認」時，請填寫確認來源' using errcode = '22023'; end if;
  if p_result = '需補充' and coalesce(array_length(p_docs, 1), 0) = 0 and other = '' then raise exception '請勾選要補充的文件，或填寫其他資料名稱' using errcode = '22023'; end if;
  if p_result = '需補充' and exists (select 1 from unnest(p_docs) x where not exists (select 1 from public.documents y where y.id = x and y.case_id = c.id and y.cat in ('B','C','D'))) then
    raise exception '只能指定這位住民的健康檢查、醫療或照護文件' using errcode = 'P0001'; end if;

  insert into public.assessments (case_id, mode, result, move, behav, iso, reason, dnr_state, dnr_src, by)
    values (c.id, mode, p_result, p_move, p_behav, p_iso, nullif(reason, ''), coalesce(p_dnr_state, '尚未另行確認'), nullif(btrim(coalesce(p_dnr_src, '')), ''), auth.uid())
    returning id into aid;
  if p_result = '需補充' then
    due := public.today_tw() + public.req_days();
    for d in select * from public.documents where id = any(p_docs) order by sort for update loop
      v := public.doc_cur(d.id);
      if v.id is not null then insert into public.document_returns (document_id, version_v, by, reason, note_for_family) values (d.id, v.v, auth.uid(), '護理師需要補充資料', reason); end if;
      reqs := reqs || public.new_request(d.id, '護理', '護理師需要補充資料', reason, due);
      if d.nurse_decides and d.need = '條件式必備' and d.cond_met is not true then
        before := case when d.cond_met is false then '護理已確認：不需要' else '待護理確認' end;
        update public.documents set cond_met = true where id = d.id;
        insert into public.document_need_changes (document_id, from_text, to_text, by, role, note) values (d.id, before, '護理已確認：需要', auth.uid(), 'nurse', '收治評估要求補充：' || reason);
      end if;
      insert into public.assessment_items (assessment_id, document_id) values (aid, d.id);
      names := names || d.name;
    end loop;
    if other <> '' then
      insert into public.documents (case_id, key, cat, name, fam_name, stage, need, medical, sort, custom_why, custom_where)
        values (c.id, 'extra_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10), 'G', other, other, '評估前', '必備', true,
          50 + (select count(*) from public.documents where case_id = c.id), '護理師評估時需要這份資料：' || reason, '請向住民就醫的醫院或診所索取')
        returning id into nid;
      reqs := reqs || public.new_request(nid, '護理', '護理師需要補充資料', reason, due);
      insert into public.assessment_items (assessment_id, document_id) values (aid, nid);
      names := names || other;
    end if;
  end if;
  if p_result = '不收治' then
    update public.cases set closed_at = now(), closed_by = auth.uid(), closed_title = '很抱歉，本中心目前無法提供合適的照顧',
      closed_text = '原因：' || reason || '。承辦人會協助您了解其他長照資源，也可以撥打長照專線 1966。', closed_reason = '不收治：' || reason, closed_type = '不收治', updated_at = now()
      where id = c.id;
  end if;
  perform public.log_action(c.id, '評估結果：' || p_result || coalesce('（' || nullif(reason, '') || '）', '') || case when p_result = '需補充' then '，指定補件：' || array_to_string(names, '、') else '' end);
  perform public.notify_family(c.id, case p_result
    when '收治' then '好消息：住民已通過評估，請來電預約參訪與簽約'
    when '不收治' then '機構已完成評估，請登入查看結果'
    when '需補充' then '護理師需要補充資料，請在 ' || public.md_tw(due) || ' 前登入上傳'
    when '可入住' then '入住前確認完成，照顧團隊正在準備'
    else '機構需要和您討論入住安排，承辦人會與您聯絡' end);
  return jsonb_build_object('id', aid, 'requests', to_jsonb(reqs));
end $function$;

-- confirmed_field：移除 1 處「文件未刪除」條件
CREATE OR REPLACE FUNCTION public.confirmed_field(p_case uuid, p_k text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d record; vv int; val text;
begin
  for d in select id from public.documents where case_id = p_case order by sort, id loop
    select x.v into vv from public.document_versions x
      where x.document_id = d.id and x.nurse_ok and exists (select 1 from public.medical_facts f where f.document_id = x.document_id and f.version_v = x.v)
      order by x.v desc limit 1;
    if vv is not null then
      select f.value into val from public.medical_facts f where f.document_id = d.id and f.version_v = vv and f.field = p_k;
      if coalesce(val, '') <> '' then return val; end if;
    end if;
  end loop;
  return '';
end $function$;

-- dx_synced：移除 1 處「文件未刪除」條件
CREATE OR REPLACE FUNCTION public.dx_synced(p_case uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.document_versions;
begin
  select x.* into v from public.document_versions x join public.documents d on d.id = x.document_id
    where d.case_id = p_case and d.key = 'summary' and x.nurse_ok order by x.v desc limit 1;
  if v.id is null or v.dx_rows is null or coalesce((v.dx_rows->>'absent')::boolean, false) then return true; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(v.dx_rows->'rows', '[]')) r where r->>'state' = '已確認'
      and not exists (select 1 from public.diagnoses g where g.source_document = v.document_id and g.source_version = v.v and g.source_row = (r->>'n')::int)) then return false; end if;
  return not exists (select 1 from public.diagnoses g where g.source_document = v.document_id and g.source_version <> v.v and g.superseded_at is null);
end $function$;

-- update_my_phone：不再寫 phone_updated_at（操作紀錄已記錄）
CREATE OR REPLACE FUNCTION public.update_my_phone(p_phone text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ph text := public.phone_norm(p_phone); nm text;
begin
  if auth.uid() is null then raise exception '請先登入' using errcode = '28000'; end if;
  if ph is null then raise exception '請輸入正確的手機號碼，例如 0912-345-678' using errcode = 'check_violation'; end if;
  update public.profiles set phone = ph where id = auth.uid() returning name into nm;
  insert into public.audit_logs (actor, actor_name, role, action) values (auth.uid(), nm, public.auth_role(), nm || ' 補填手機號碼');
  return ph;
end $function$;

-- password_changed：不再寫 password_changed_at（操作紀錄已記錄）
CREATE OR REPLACE FUNCTION public.password_changed()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare nm text;
begin
  if auth.uid() is null then raise exception '請先登入' using errcode = '28000'; end if;
  update public.profiles set must_change_password = false where id = auth.uid() returning name into nm;
  insert into public.audit_logs (actor, actor_name, role, action) values (auth.uid(), nm, public.auth_role(), nm || ' 修改密碼');
end $function$;

-- archive_case_as：不再寫 archived_by（操作紀錄已記錄封存者）
CREATE OR REPLACE FUNCTION public.archive_case_as(p_case uuid, p_by uuid, p_removed text[], p_failed integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  update public.cases set archived_at = now(), archive_status = st, updated_at = now() where id = c.id;
  insert into public.audit_logs (case_id, actor, actor_name, role, action, family_visible)
    values (c.id, p_by, coalesce((select name from public.profiles where id = p_by), ''), 'admin',
      '封存案件：工作資料刪除 ' || (nd + no) || ' 筆、上傳檔案刪除 ' || coalesce(array_length(p_removed, 1), 0) || ' 份' || case when p_failed > 0 then '，' || p_failed || ' 份刪除失敗（需管理員處理）' else '' end, false);
  return jsonb_build_object('status', st, 'removed', coalesce(array_length(p_removed, 1), 0), 'work', nd + no);
end $function$;

-- sync_diagnoses：不再寫 synced_at
CREATE OR REPLACE FUNCTION public.sync_diagnoses(p_doc uuid, p_v integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.documents; v public.document_versions; r jsonb; n int := 0; nid uuid;
begin
  select * into d from public.documents where id = p_doc;
  select * into v from public.document_versions where document_id = p_doc and document_versions.v = p_v;
  if v.dx_rows is null or coalesce((v.dx_rows->>'absent')::boolean, false) then return 0; end if;
  update public.diagnoses set superseded_at = now(), updated_at = now() where source_document = d.id and source_version <> p_v and superseded_at is null;
  for r in select * from jsonb_array_elements(coalesce(v.dx_rows->'rows', '[]')) loop
    if r->>'state' = '已確認' and not exists (select 1 from public.diagnoses where source_document = d.id and source_version = p_v and source_row = (r->>'n')::int) then
      insert into public.diagnoses (case_id, text, std, status, source_document, source_version, source_row, confirmed_by, confirmed_at, added_by)
        values (d.case_id, coalesce(nullif(r->>'raw', ''), r->>'text'), r->>'text', '已確認', d.id, p_v, (r->>'n')::int, auth.uid(), now(), auth.uid())
        returning id into nid;
      insert into public.diagnosis_changes (diagnosis_id, to_status, text_after, reason, by) values (nid, '已確認', r->>'text', '由病摘逐筆核對帶入（已確認）', auth.uid());
      n := n + 1;
    end if;
  end loop;
  return n;
end $function$;

-- ===== 外鍵與規定 =====
alter table public.ocr_runs drop constraint ocr_runs_document_id_fkey;
alter table public.review_drafts drop constraint review_drafts_document_id_fkey;
alter table public.document_returns alter column version_v set not null;
alter table public.document_returns drop constraint document_returns_document_id_fkey;
alter table public.diagnoses add constraint diagnoses_source_pair check ((source_document is null) = (source_version is null));
alter table public.diagnoses drop constraint diagnoses_source_document_fkey;

-- ===== 刪除欄位（函式已先改好，不再用到） =====
alter table public.assessments drop column notified_at;
alter table public.audit_logs drop column detail;
alter table public.documents drop column deleted_at;
alter table public.profiles drop column phone_updated_at;
alter table public.profiles drop column password_changed_at;
alter table public.cases drop column archived_by;
alter table public.diagnoses drop column synced_at;
