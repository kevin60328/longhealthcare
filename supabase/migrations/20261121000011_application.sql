-- 階段 4：application.html 的資料表調整與寫入函式（RPC）
-- 每個 RPC 都在一個交易內：檢查身分與權限 → 檢查狀態 → 寫入 → 記錄操作紀錄；任何一步失敗就全部不寫入。
-- 規則依原型第 (18) 版（applyForm／applyPreviewForm、consentForm、consent-withdraw、consent-no、contactForm、
-- habitForm、habit-submit、mail-resend）。
-- 使用者決定（2026/11/21）：同一身分證字號已有住民資料、但姓名或生日不同時，不建立申請，
-- 畫面說明「這個身分證字號已有資料且內容不同，請聯絡機構確認」，並留下待行政處理的紀錄（resident_conflicts）。

-- ===================== 資料表調整 =====================
-- 申請識別碼：同一份申請重新送出或網路重試，都對應同一筆案件，不會建立兩筆（原型 applyDraft.token）
alter table public.cases add column apply_token text;
alter table public.cases add constraint cases_apply_token unique (family_id, apply_token);
-- 撤回同意、不同意等結案的說明文字類型（畫面依類型顯示說明）
alter table public.cases add column closed_type text;

-- 案件編號 C-0001…：用序列產生，不會因同時送出而重複
create sequence public.case_no_seq;
select setval('public.case_no_seq', greatest(coalesce((select max(substring(no from '^C-(\d+)$')::int) from public.cases where no ~ '^C-\d+$'), 0), 1),
  exists (select 1 from public.cases where no ~ '^C-\d+$'));

-- 同一身分證字號、姓名或生日不同：待行政確認（不建立案件）
create table public.resident_conflicts (
  id bigint generated always as identity primary key,
  resident_id uuid not null references public.residents(id),
  family_id uuid not null references public.profiles(id),
  apply_token text not null,
  submitted_name text not null,
  submitted_birth date,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolution text,
  unique (family_id, apply_token),
  constraint resident_conflict_resolved check ((resolved_at is null) = (resolved_by is null))
);
alter table public.resident_conflicts enable row level security;
grant select on public.resident_conflicts to authenticated;
-- 行政、管理員看全部；家屬只看自己送出的（但看不到既有住民的資料，只知道被擋下）
create policy resident_conflicts_read on public.resident_conflicts for select to authenticated using (
  public.auth_role() in ('staff','admin') or family_id = auth.uid());

-- 代理權證明文件（監護宣告裁定書／輔助宣告裁定書／代理權授權證明）：只在非本人簽署時才加入案件
alter table public.doc_catalog add column on_demand boolean not null default false;
comment on column public.doc_catalog.on_demand is '只在需要時才加入案件的文件（不屬於每案都有的 24 項清單）';
insert into public.doc_catalog (key, cat, name, fam_name, need, cond, stage, valid_days, medical, inst, nurse_decides, why, "where", sort, on_demand) values
  ('guardian', 'A', '監護宣告裁定書', '監護宣告裁定書', '必備', '', '評估前', null, false, false, false,
   '確認簽署同意書的人是法院指定的監護人', '法院寄給您的民事裁定書（含確定證明書），拍照或掃描上傳', -1, true),
  ('agentProof', 'A', '代理權授權證明', '代理權授權證明', '必備', '', '評估前', null, false, false, false,
   '確認代替預計入住者簽署同意書的人，已經得到適當授權', '本人簽署的授權書或其他可證明代理權的文件', 3, true)
on conflict (key) do nothing;

-- 同意書版本（同意書文字的版本，原型 CONSENT_VER）；ver 是這個案件第幾次簽署
alter table public.consents add column form_ver int not null default 1;

-- 習慣卡：草稿修改次數（正式提交時記下是第幾次修改的內容）與各區最後修改
alter table public.habit_cards add column draft_rev int not null default 0;
create table public.habit_card_sections (
  case_id uuid not null references public.habit_cards(case_id) on delete cascade,
  sec text not null check (sec in ('A','B','C','D','E','F','G')),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id),
  primary key (case_id, sec)
);
alter table public.habit_card_sections enable row level security;
grant select on public.habit_card_sections to authenticated;
create policy habit_card_sections_read on public.habit_card_sections for select to authenticated using (public.is_family_of(case_id));
grant all on public.resident_conflicts, public.habit_card_sections to service_role;
grant usage, select on sequence public.case_no_seq to service_role;

-- ===================== 共用小函式 =====================
create or replace function public.me_name() returns text
language sql stable security definer set search_path = '' as $$ select name from public.profiles where id = auth.uid() $$;

-- 記操作紀錄（只在 RPC 內使用）
create or replace function public.log_action(p_case uuid, p_action text, p_family_visible boolean default true) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_logs (case_id, actor, actor_name, role, action, family_visible)
  values (p_case, auth.uid(), public.me_name(), public.auth_role(), p_action, p_family_visible)
$$;

-- 家屬本人、啟用中、案件是自己的；回傳案件列（鎖定，避免同時修改）
create or replace function public.family_case_for_update(p_case uuid) returns public.cases
language plpgsql security definer set search_path = '' as $$
declare c public.cases;
begin
  if public.auth_role() is distinct from 'family' then raise exception '只有申請人可以操作' using errcode = '42501'; end if;
  select * into c from public.cases where id = p_case and family_id = auth.uid() for update;
  if not found then raise exception '找不到這筆申請' using errcode = 'P0002'; end if;
  return c;
end $$;

-- 目前的個資同意（最新一筆）與狀態（與原型 consentState 相同）
create or replace function public.consent_state(p_case uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when k.id is null then '未簽署' when k.withdrawn_at is not null then '已撤回' else k.state end
  from (select 1) x left join lateral (select * from public.consents where case_id = p_case order by ver desc limit 1) k on true
$$;

-- ===================== 1. 提出入住申請 =====================
create or replace function public.create_application(p_token text, p_name text, p_nid text, p_birth date, p_relation text, p_hospital text, p_admit date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles; c public.cases; rs public.residents; nm text := btrim(coalesce(p_name, '')); v_nid text := upper(btrim(coalesce(p_nid, ''))); v_no text; doc_count int;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.role is distinct from 'family' or me.status <> '啟用' then raise exception '只有一般申請人帳號可以提出入住申請' using errcode = '42501'; end if;
  if coalesce(btrim(p_token), '') = '' then raise exception '申請識別碼遺失，請重新填寫' using errcode = '22023'; end if;
  /* 同一份申請已送出過（重新送出、網路重試）：回傳原本那一筆 */
  select * into c from public.cases where family_id = me.id and apply_token = p_token;
  if found then return jsonb_build_object('status', 'ok', 'case_id', c.id, 'no', c.no, 'repeat', true); end if;
  if nm = '' then raise exception '請填寫預計入住者姓名' using errcode = '22023'; end if;
  if v_nid !~ '^[A-Z][12A-D89]\d{8}$' then raise exception '身分證字號格式不正確，請確認（英文字母大寫＋9 位數字）' using errcode = '22023'; end if;
  if p_birth is null or p_birth > current_date then raise exception '請填寫預計入住者出生日期' using errcode = '22023'; end if;
  if p_admit is null then raise exception '請填寫預計入住日期' using errcode = '22023'; end if;
  if p_relation is null or p_relation not in ('本人','兒子','女兒','配偶','媳婦','女婿','孫子女','其他親屬','監護人或法定代理人') then
    raise exception '請選擇與預計入住者的關係' using errcode = '22023'; end if;

  /* 住民：同一身分證字號已有資料時，姓名與生日都要相同才沿用；不同就擋下並留下待行政確認的紀錄 */
  select * into rs from public.residents where nid = v_nid for update;
  if found and (rs.name <> nm or rs.birth is distinct from p_birth) then
    insert into public.resident_conflicts (resident_id, family_id, apply_token, submitted_name, submitted_birth)
      values (rs.id, me.id, p_token, nm, p_birth) on conflict (family_id, apply_token) do nothing;
    perform public.log_action(null, me.name || ' 送出入住申請，但身分證字號已有不同的住民資料，申請未建立（待行政確認）', false);
    return jsonb_build_object('status', 'resident_conflict');
  end if;
  if not found then
    insert into public.residents (nid, name, birth) values (v_nid, nm, p_birth) returning * into rs;
  end if;

  v_no := 'C-' || lpad(nextval('public.case_no_seq')::text, 4, '0');
  insert into public.cases (no, family_id, relation, resident_id, flow_mode, hospital, planned_admit, link_status, apply_token)
    values (v_no, me.id, p_relation, rs.id, (select flow_mode from public.org_settings where id = 1), btrim(coalesce(p_hospital, '')), p_admit, '待確認', p_token)
    returning * into c;

  /* 內建文件清單（每案都有的項目，不含「需要時才加入」的代理權證明）＋核對項目，建立當時的快照 */
  insert into public.documents (case_id, key, catalog_key, cat, name, fam_name, stage, need, cond, valid_days, medical, inst, nurse_decides, sort)
    select c.id, k.key, k.key, k.cat, k.name, k.fam_name, k.stage, k.need, k.cond, k.valid_days, k.medical, k.inst, k.nurse_decides, k.sort
    from public.doc_catalog k where not k.on_demand;
  get diagnostics doc_count = row_count;
  insert into public.document_parts (document_id, k, name, need, sort)
    select d.id, p.k, p.name, p.need, p.sort from public.documents d join public.doc_catalog_parts p on p.catalog_key = d.catalog_key where d.case_id = c.id;

  /* 申請確認 Email：測試環境尚未介接郵件服務，只建立通知工作並記錄「未寄出」 */
  insert into public.mail_jobs (id, kind, case_id, to_email, status) values ('apply_' || c.id, '申請確認', c.id, coalesce(nullif(me.notify_email, ''), me.email), '待寄送');
  insert into public.mail_attempts (job_id, result) values ('apply_' || c.id, '未寄出：測試環境尚未介接郵件服務');

  perform public.log_action(c.id, me.name || ' 提出 ' || nm || ' 的入住申請');
  perform public.log_action(c.id, '建立入住文件清單（' || doc_count || ' 份）');
  return jsonb_build_object('status', 'ok', 'case_id', c.id, 'no', c.no, 'repeat', false);
end $$;

-- 申請確認 Email「重新寄送」：測試環境只記錄一次未寄出的嘗試（一分鐘內不重複）
create or replace function public.resend_apply_mail(p_case uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.family_case_for_update(p_case); last_at timestamptz; me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  select max(at) into last_at from public.mail_attempts where job_id = 'apply_' || c.id;
  if last_at is not null and now() - last_at < interval '1 minute' then raise exception '剛才已重新寄送，請一分鐘後再試' using errcode = 'P0001'; end if;
  update public.mail_jobs set to_email = coalesce(nullif(me.notify_email, ''), me.email), updated_at = now() where id = 'apply_' || c.id;
  if not found then raise exception '找不到申請確認通知工作' using errcode = 'P0002'; end if;
  insert into public.mail_attempts (job_id, result) values ('apply_' || c.id, '未寄出：測試環境尚未介接郵件服務');
  perform public.log_action(c.id, '申請確認通知：重新寄送（測試環境未實際寄出）');
end $$;

-- ===================== 2. 個資同意 =====================
create or replace function public.sign_consent(p_case uuid, p_signer text, p_signer_name text, p_agree boolean, p_photo boolean, p_emergency boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases := public.family_case_for_update(p_case); st text := public.consent_state(p_case);
  sname text := btrim(coalesce(p_signer_name, '')); needs boolean; pkey text; pdoc uuid; nver int; dname text;
  label text := case p_signer when '本人' then '預計入住者本人' when '監護人' then '法定代理人／監護人' when '代理人' then '其他經適當授權的代理人' when '受輔助宣告' then '預計入住者本人（受輔助宣告，需確認輔助人同意）' end;
begin
  if c.closed_at is not null or st not in ('未簽署', '代理權未通過') then
    raise exception '%', case st when '有效' then '已經完成授權，不需要重複簽署' when '待代理權核實' then '已提交同意，正在等本中心核實代理權' else '案件已結案或授權已撤回，需要重新申請才能再次授權' end using errcode = 'P0001';
  end if;
  if label is null then raise exception '請選擇簽署身分' using errcode = '22023'; end if;
  if not coalesce(p_agree, false) then raise exception '請勾選必要的同意事項' using errcode = '22023'; end if;
  if char_length(sname) < 2 then raise exception '請輸入簽署人真實姓名' using errcode = '22023'; end if;
  needs := p_signer <> '本人';
  /* 非本人簽署：加入代理權證明文件（已加入過就沿用） */
  if needs then
    pkey := case when p_signer = '代理人' then 'agentProof' else 'guardian' end;
    dname := case p_signer when '監護人' then '監護宣告裁定書' when '受輔助宣告' then '輔助宣告裁定書' else '代理權授權證明' end;
    select id into pdoc from public.documents where case_id = c.id and key = pkey;
    if pdoc is null then
      insert into public.documents (case_id, key, catalog_key, cat, name, fam_name, stage, need, cond, valid_days, medical, inst, nurse_decides, sort)
        select c.id, k.key, k.key, k.cat, dname, dname, k.stage, k.need, k.cond, k.valid_days, k.medical, k.inst, k.nurse_decides, k.sort
        from public.doc_catalog k where k.key = pkey returning id into pdoc;
    end if;
  end if;
  select coalesce(max(ver), 0) + 1 into nver from public.consents where case_id = c.id;
  insert into public.consents (case_id, ver, form_ver, signer_type, signer_name, signed_by, state, proof_document_id, emergency, photo)
    values (c.id, nver, 1, p_signer, sname, auth.uid(), case when needs then '待代理權核實' else '有效' end, pdoc, coalesce(p_emergency, false), coalesce(p_photo, false));
  perform public.log_action(c.id, (case when needs then '提交' else '簽署' end) || '個人資料同意書（簽署身分：' || label || '；簽署人：' || sname || '；肖像'
    || case when p_photo then '同意' else '未同意' end || '、緊急送醫' || case when p_emergency then '同意' else '未同意' end || '）' || case when needs then '，待代理權核實' else '' end);
  return case when needs then '待代理權核實' else '有效' end;
end $$;

-- 撤回同意：停止資料處理並結案（畫面另外要求輸入登入密碼確認）
create or replace function public.withdraw_consent(p_case uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.family_case_for_update(p_case); k public.consents;
begin
  select * into k from public.consents where case_id = c.id order by ver desc limit 1 for update;
  if c.closed_at is not null or k.id is null or k.withdrawn_at is not null or k.state <> '有效' then raise exception '授權已經不是有效狀態' using errcode = 'P0001'; end if;
  update public.consents set withdrawn_at = now(), withdrawn_by = auth.uid() where id = k.id;
  update public.cases set closed_at = now(), closed_by = auth.uid(), closed_title = '您已撤回資料授權同意', closed_reason = '家屬撤回同意', closed_type = '撤回', updated_at = now() where id = c.id;
  perform public.log_action(c.id, '家屬撤回資料授權同意（第 ' || k.form_ver || ' 版，' || k.signer_type || ' 於 ' || to_char(k.signed_at at time zone 'Asia/Taipei', 'YYYY/MM/DD HH24:MI') || ' 簽署），停止新的資料處理，案件結案交保存規則處理');
end $$;

-- 不同意：機構無法評估，案件結案
create or replace function public.decline_consent(p_case uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.family_case_for_update(p_case);
begin
  if c.closed_at is not null or exists (select 1 from public.consents where case_id = c.id) then raise exception '案件狀態已改變' using errcode = 'P0001'; end if;
  update public.cases set closed_at = now(), closed_by = auth.uid(), closed_title = '您選擇了不同意', closed_reason = '不同意', closed_type = '不同意', updated_at = now() where id = c.id;
  perform public.log_action(c.id, '家屬不同意轉介資料授權，案件結案');
end $$;

-- ===================== 3. 緊急聯絡人（最多兩位；第一位必填） =====================
create or replace function public.save_contacts(p_case uuid, p_contacts jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.family_case_for_update(p_case); x jsonb; n int := 0;
begin
  if c.closed_at is not null then raise exception '案件已結案' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_contacts) <> 'array' or jsonb_array_length(p_contacts) > 2 then raise exception '聯絡人資料格式不正確' using errcode = '22023'; end if;
  if coalesce(btrim(p_contacts->0->>'name'), '') = '' or coalesce(btrim(p_contacts->0->>'phone'), '') = '' then raise exception '請填寫主要聯絡人的姓名和電話' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_contacts) loop
    if coalesce(btrim(x->>'phone'), '') <> '' and btrim(x->>'phone') !~ '^[\d\-+\s()#]{8,}$' then raise exception '電話號碼格式不正確' using errcode = '22023'; end if;
    if coalesce(btrim(x->>'name'), '') <> '' and coalesce(btrim(x->>'phone'), '') = '' then raise exception '請填寫第二聯絡人的電話' using errcode = '22023'; end if;
  end loop;
  delete from public.contacts where case_id = c.id;
  for x in select * from jsonb_array_elements(p_contacts) loop
    if coalesce(btrim(x->>'name'), '') = '' then continue; end if;
    insert into public.contacts (case_id, name, rel, phone, sort, updated_by) values (c.id, btrim(x->>'name'), btrim(coalesce(x->>'rel', '')), btrim(x->>'phone'), n, auth.uid());
    n := n + 1;
  end loop;
  perform public.log_action(c.id, '家屬更新緊急聯絡人');
end $$;

-- ===================== 4. 習慣卡 =====================
-- 每一區允許的欄位（與原型 HABIT_SECS 相同）
create or replace function public.habit_sec_keys(p_sec text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_sec
    when 'A' then array['call','lang','langOther','hearing','commNote']
    when 'B' then array['famHealth','famAllergy','recent','recentNote','famWatch']
    when 'C' then array['adl_walk','adlN_walk','adl_transfer','adlN_transfer','adl_toilet','adlN_toilet','adl_bath','adlN_bath','adl_eat','adlN_eat','adl_swallow','adlN_swallow']
    when 'D' then array['wake','nap','napNote','bedtime','bowel','night','nightNote','routineNote']
    when 'E' then array['likeFood','dislikeFood','likeAct','dislikeEnv','dislikeTouch','otherPref']
    when 'F' then array['anxious','refuseWhy','soothe','interact']
    when 'G' then array['contactTime','contactNote'] end
$$;
-- 只留有填的內容（空字串、空陣列不算），用來比較兩份內容是否相同（原型 digestOf）
create or replace function public.habit_filled(d jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(coalesce(d, '{}'::jsonb))
  where not (value = '""'::jsonb or value = '[]'::jsonb or value = 'null'::jsonb or (jsonb_typeof(value) = 'string' and btrim(value #>> '{}') = ''))
$$;

-- 儲存一區草稿（草稿機構看不到；正式提交後才會被審核）
create or replace function public.save_habit_section(p_case uuid, p_sec text, p_vals jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.family_case_for_update(p_case); keys text[] := public.habit_sec_keys(p_sec); bad text; rev int;
  title text := case p_sec when 'A' then '基本稱呼與溝通' when 'B' then '健康與近期狀況（家屬補充）' when 'C' then '日常活動協助' when 'D' then '生活作息' when 'E' then '個人喜好與禁忌' when 'F' then '情緒與安撫方式' when 'G' then '聯絡資訊' end;
begin
  if c.closed_at is not null or public.consent_state(c.id) <> '有效' then raise exception '案件已結案或授權已撤回' using errcode = 'P0001'; end if;
  if keys is null then raise exception '習慣卡分區不正確' using errcode = '22023'; end if;
  select k into bad from jsonb_object_keys(p_vals) k where k <> all(keys) limit 1;
  if bad is not null then raise exception '習慣卡欄位不正確：%', bad using errcode = '22023'; end if;
  insert into public.habit_cards (case_id, draft, draft_rev, draft_updated_at, draft_updated_by) values (c.id, p_vals, 1, now(), auth.uid())
  on conflict (case_id) do update set draft = public.habit_cards.draft || excluded.draft, draft_rev = public.habit_cards.draft_rev + 1, draft_updated_at = now(), draft_updated_by = auth.uid()
  returning draft_rev into rev;
  insert into public.habit_card_sections (case_id, sec, updated_at, updated_by) values (c.id, p_sec, now(), auth.uid())
  on conflict (case_id, sec) do update set updated_at = now(), updated_by = auth.uid();
  perform public.log_action(c.id, '家屬更新生活與照護習慣卡：' || p_sec || '. ' || title || '（第 ' || rev || ' 次修改）');
  return rev;
end $$;

-- 正式提交：必填欄位都要有；內容和上次提交相同就不重複提交
create or replace function public.submit_habit(p_case uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.family_case_for_update(p_case); h public.habit_cards; d jsonb; prev public.habit_submissions; n int; miss text[];
begin
  if c.closed_at is not null or public.consent_state(c.id) <> '有效' then raise exception '資料授權無效或案件已結案' using errcode = 'P0001'; end if;
  select * into h from public.habit_cards where case_id = c.id for update;
  d := public.habit_filled(h.draft);
  if h.case_id is null or d = '{}'::jsonb then raise exception '習慣卡還是空白的，請先填寫再提交' using errcode = 'P0001'; end if;
  select array_agg(lbl) into miss from (values ('call','稱呼'), ('lang','慣用語言'), ('hearing','聽力狀況'), ('famAllergy','過敏'),
      ('adl_walk','日常活動：行走'), ('adl_transfer','日常活動：移位'), ('adl_toilet','日常活動：如廁'), ('adl_bath','日常活動：洗澡'), ('adl_eat','日常活動：進食'), ('adl_swallow','日常活動：吞嚥')) r(k, lbl)
    where not (d ? r.k or (r.k = 'lang' and d ? 'langOther'));
  if miss is not null then raise exception '還有必填欄位未填：%。不確定可以選「不清楚」或填「無」。', array_to_string(miss, '、') using errcode = 'P0001'; end if;
  select * into prev from public.habit_submissions where case_id = c.id order by rev desc limit 1;
  if prev.case_id is not null and public.habit_filled(prev.data) = d then raise exception '內容和上次提交相同，不需要重新提交' using errcode = 'P0001'; end if;
  n := coalesce(prev.n, 0) + 1;
  insert into public.habit_submissions (case_id, rev, n, data, submitted_by, submitted_at) values (c.id, h.draft_rev, n, h.draft, auth.uid(), now());
  perform public.log_action(c.id, '家屬正式提交生活與照護習慣卡（第 ' || n || ' 次提交）');
  return n;
end $$;

-- ===================== 5. 機構人員名冊（處理歷程顯示「角色｜姓名」用；只有姓名與角色） =====================
create or replace function public.staff_directory() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'role', role)), '[]'::jsonb)
  from public.profiles where role in ('staff','nurse','care','admin') and auth.uid() is not null
$$;

-- ===================== 權限 =====================
revoke execute on function public.me_name(), public.log_action(uuid, text, boolean), public.family_case_for_update(uuid), public.consent_state(uuid),
  public.habit_sec_keys(text), public.habit_filled(jsonb) from public, anon, authenticated;
revoke execute on function public.create_application(text, text, text, date, text, text, date), public.resend_apply_mail(uuid), public.sign_consent(uuid, text, text, boolean, boolean, boolean),
  public.withdraw_consent(uuid), public.decline_consent(uuid), public.save_contacts(uuid, jsonb), public.save_habit_section(uuid, text, jsonb), public.submit_habit(uuid), public.staff_directory() from public, anon;
grant execute on function public.create_application(text, text, text, date, text, text, date), public.resend_apply_mail(uuid), public.sign_consent(uuid, text, text, boolean, boolean, boolean),
  public.withdraw_consent(uuid), public.decline_consent(uuid), public.save_contacts(uuid, jsonb), public.save_habit_section(uuid, text, jsonb), public.submit_habit(uuid), public.staff_directory() to authenticated;
