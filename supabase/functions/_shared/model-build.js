/* 自動產生：由 npm run functions:sync 從原始檔複製，請勿直接修改（改原始檔後重新同步）。 */
/* 資料模型的「純轉換」部分（不連資料庫、不依賴瀏覽器）：把 get_case_models 等查詢結果轉成業務規則（rules/core.js）使用的格式。
 * 瀏覽器（services/model.js）與伺服器端 Edge Function（supabase/functions/case-phases）共用這一份，
 * 伺服器端的副本由 npm run functions:sync 複製到 supabase/functions/_shared/，請勿直接修改副本。
 * 轉換規則：
 *   - 時間（timestamptz）→ 台灣時間字串「YYYY/MM/DD HH:MM」＋毫秒 ts（原型的 at／ts）
 *   - 文件 id 一律為「案件id_文件key」（原型慣例）；資料庫的 uuid 放在 dbId，產生網址時使用
 *   - 欄位名稱 snake_case → 原型的 camelCase */

/* ---------- 時間 ---------- */
const TZ = 'Asia/Taipei';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const parts = d => Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
/* 資料庫時間 → 「YYYY/MM/DD HH:MM」（台灣時間）；沒有時間回傳 undefined（原型的「沒有記錄」） */
export function toStamp(iso){
  if (!iso) return undefined;
  if (/^\d{4}\/\d{2}\/\d{2}/.test(iso)) return iso;     // 已經是原型格式（例如 jsonb 裡保存的舊資料）
  const d = new Date(iso); if (isNaN(d)) return undefined;
  const p = parts(d); return `${p.year}/${p.month}/${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}
export const toTs = iso => { if (!iso) return undefined; const n = Date.parse(iso); return isNaN(n) ? undefined : n; };
/* 今天（台灣時間 YYYY-MM-DD） */
export function todayTW(){ const p = parts(new Date()); return `${p.year}-${p.month}-${p.day}`; }

/* ---------- 帳號 ---------- */
export const toAccount = p => ({ id: p.id, email: p.email, name: p.name, role: p.role || '', want: p.want || '', status: p.status, phone: p.phone,
  canAssignNurse: p.can_assign_nurse === true, mustChange: p.must_change_password === true, notifyEmail: p.notify_email || '' });

/* ---------- 單一案件 ---------- */
export function buildCase(m, accounts){
  const r = m.case, cid = r.id, rs = m.resident || {};
  const keyOf = Object.fromEntries((m.documents || []).map(d => [d.id, `${cid}_${d.key}`]));
  const nameOf = Object.fromEntries((m.documents || []).map(d => [d.id, d.name]));
  const c = {
    id: cid, no: r.no, familyId: r.family_id, relation: r.relation,
    /* 住民基本資料在 residents 表（正規化：同一個人多次申請只存一份） */
    residentId: r.resident_id, patient: { name: rs.name || '', nid: rs.nid || '', birth: rs.birth || '', chart: rs.chart_no || '' },
    hospital: r.hospital, plannedAdmit: r.planned_admit || '', flowMode: r.flow_mode, linkStatus: r.link_status,
    confirmedAt: toStamp(r.confirmed_at), confirmedTs: toTs(r.confirmed_at), confirmedBy: r.confirmed_by || undefined,
    nurseId: r.nurse_id || '', docDue: r.doc_due || undefined, preDue: r.pre_due || undefined, preDocsDoneAt: toStamp(r.pre_docs_done_at),
    signedAt: toStamp(r.signed_at) || null, signedTs: toTs(r.signed_at), signedBy: r.signed_by || undefined,
    closed: r.closed_at ? { at: toStamp(r.closed_at), by: r.closed_by || '', title: r.closed_title || r.closed_reason || '', text: r.closed_text || '', reason: r.closed_reason || '', type: r.closed_type || '' } : null,
    handoverAt: toStamp(r.handover_at), handoverTs: toTs(r.handover_at), handoverBy: r.handover_by || undefined,
    archived: r.archived_at ? { at: toStamp(r.archived_at), status: r.archive_status || '' } : null,
    closedType: r.closed_type || '', applyToken: r.apply_token || '',
    createdAt: toStamp(r.created_at), createdTs: toTs(r.created_at),
    /* 參訪與保證金（原型 visitOf／depOf 的預設值） */
    visit: Object.assign({ needed: '未確認', date: '', time: '', status: '未安排', doneAt: '', note: '' }, m.visit ? { needed: m.visit.needed, date: m.visit.visit_date || '', time: (m.visit.visit_time || '').slice(0, 5), status: m.visit.status, doneAt: toStamp(m.visit.done_at) || '', note: m.visit.note || '' } : {}),
    depositInfo: Object.assign({ applicable: '未確認', status: '未確認', note: '' }, m.deposit ? { applicable: m.deposit.applicable, status: m.deposit.status, note: m.deposit.note || '' } : {}),
    contacts: (m.contacts || []).map(t => ({ name: t.name, rel: t.rel || '', phone: t.phone })),
    applyMail: m.apply_mail ? { status: m.apply_mail.status, to: m.apply_mail.to_email, attempts: m.apply_mail.attempts, createdAt: toStamp(m.apply_mail.created_at) } : null,
    docList: { status: '完成' }, life: {}, full: m.full === true,
    /* 分配歷程：舊資料（分配人與時間未記錄）不列入，與原型「已有承辦護理師、沒有分配歷程」相同 */
    assignHist: (m.assignments || []).filter(a => a.at).map(a => ({ to: a.nurse_id, from: a.from_nurse_id || undefined, by: a.by, at: toStamp(a.at), ts: toTs(a.at), reason: a.reason || '' }))
  };

  /* 個資同意：最新一筆是目前的同意；每一筆的簽署、核實、撤回都列入歷程 */
  const ks = m.consents || [], k = ks.filter(x => x.state !== '已取代').slice(-1)[0];
  c.consent = k ? {
    signer: k.signer_type, signerName: k.signer_name, at: toStamp(k.signed_at), ts: toTs(k.signed_at), by: k.signed_by, ver: k.form_ver, seq: k.ver,
    state: ['有效', '待代理權核實', '代理權未通過'].includes(k.state) ? k.state : undefined,
    needsProof: k.signer_type !== '本人', proofItem: k.proof_document_id ? keyOf[k.proof_document_id] : undefined,
    withdrawnAt: toStamp(k.withdrawn_at),
    validAt: k.state === '有效' ? toStamp(k.verified_at || k.signed_at) : undefined,
    proofCheck: k.verified_at ? { at: toStamp(k.verified_at), by: k.verified_by, result: k.state === '代理權未通過' ? '代理權未通過' : '代理權已確認', note: k.verify_note || '' } : null,
    emergency: k.emergency, photo: k.photo
  } : null;
  if (ks.length){
    c.consentHistory = ks.flatMap(x => [
      { event: x.signer_type === '本人' ? '簽署' : '提交同意（待代理權核實）', ver: x.form_ver, signer: x.signer_type, signerName: x.signer_name, at: toStamp(x.signed_at), ts: toTs(x.signed_at), by: x.signed_by },
      ...(x.verified_at ? [{ event: x.state === '代理權未通過' ? '代理權無法核實' : '代理權確認，授權生效', ver: x.form_ver, signer: x.signer_type, at: toStamp(x.verified_at), ts: toTs(x.verified_at), by: x.verified_by }] : []),
      ...(x.withdrawn_at ? [{ event: '撤回', ver: x.form_ver, signer: x.signer_type, at: toStamp(x.withdrawn_at), ts: toTs(x.withdrawn_at), by: x.withdrawn_by }] : [])
    ]);
  }

  /* 收治評估：最新一筆有效；被「重新評估／延期」取代（outcome 有值）時目前沒有評估 */
  const as = (m.assessments || []).map(a => ({ result: a.result, mode: a.mode, move: a.move || '', behav: a.behav || '', iso: a.iso || '', reason: a.reason || '',
    coord: a.coord_at ? { note: a.coord_note || '', by: a.coord_by, at: toStamp(a.coord_at), from: a.coord_from || undefined } : undefined,
    outcome: a.outcome || undefined, by: a.by, at: toStamp(a.at), ts: toTs(a.at) }));
  const lastA = as[as.length - 1];
  c.assessment = lastA && !lastA.outcome ? lastA : null;
  c.assessHistory = c.assessment ? as.slice(0, -1) : as;

  /* 習慣卡：草稿只有家屬讀得到；機構端只看正式提交 */
  const subs = (m.habit_submissions || []).map(s => ({ data: s.data || {}, rev: s.rev, n: s.n, at: s.legacy ? null : toStamp(s.submitted_at), ts: toTs(s.submitted_at), by: s.submitted_by || '', legacy: s.legacy || undefined }));
  const sub = subs[subs.length - 1] || null, dr = m.habit_draft;
  /* rev：草稿第幾次修改（家屬看得到草稿時用草稿的次數，否則用最近一次提交的版本） */
  const secAt = Object.fromEntries((m.habit_sections || []).map(s => [s.sec, { at: toStamp(s.updated_at), by: s.updated_by }]));
  if (sub || dr) c.habit = { fmt: 2, data: (dr && dr.draft) || (sub ? sub.data : {}), rev: dr ? dr.draft_rev : (sub ? sub.rev : 0), updatedAt: toStamp(dr && dr.draft_updated_at), updatedBy: dr && dr.draft_updated_by,
    secAt, sub, subHist: subs.map(s => ({ n: s.n, rev: s.rev, at: s.at, ts: s.ts, by: s.by, legacy: s.legacy })) };
  /* 習慣卡初審：最新一筆是目前狀態；最近一次「審核完成」是 done。資料庫「有疑義／待確認」＝原型的「有疑義」 */
  const hrs = (m.habit_reviews || []).map(h => ({ state: h.state === '有疑義／待確認' ? '有疑義' : h.state, rev: h.rev, note: h.note || '', by: h.reviewed_by, at: toStamp(h.reviewed_at), ts: toTs(h.reviewed_at), diffRes: h.diff_res || [], snap: h.snap || {}, med: h.med_snapshot || {} }));
  if (hrs.length){
    const last = hrs[hrs.length - 1], done = hrs.filter(h => h.state === '審核完成').slice(-1)[0];
    c.habitReview = { state: last.state, rev: last.rev, by: last.by, at: last.at, note: last.note,
      done: done ? { rev: done.rev, by: done.by, at: done.at, ts: done.ts, note: done.note, snap: done.snap, med: done.med, diffRes: done.diffRes } : undefined,
      hist: hrs.map(h => ({ state: h.state, note: h.note, rev: h.rev, by: h.by, at: h.at, ts: h.ts, diffRes: h.diffRes })) };
  }

  /* 摘要卡：已開放的那張是目前的卡，比它新的草稿是修訂中；沒有開放的卡時，最新一張（草稿或已停用）是目前的卡 */
  const cards = (m.cards || []).map(x => ({ id: x.id, v: x.v, status: x.status, basis: x.basis, by: x.opened_by, at: toStamp(x.opened_at), ts: toTs(x.opened_at), endAt: toStamp(x.end_at), endNote: x.end_note || '', caregivers: x.caregivers || [], call: x.call || '' }));
  const open = cards.filter(x => x.status === '已開放').slice(-1)[0];
  const live = cards.filter(x => x.status !== '已取代');
  c.card = open || live[live.length - 1] || null;
  c.cardDraft = open ? (cards.filter(x => x.status === '草稿' && x.v > open.v).slice(-1)[0] || null) : null;
  c.cardHistory = cards.filter(x => x.status === '已取代');

  c.diagnoses = (m.diagnoses || []).map(d => ({ state: d.status, raw: d.text, std: '', src: d.source_document ? { itemId: keyOf[d.source_document], v: d.source_version } : null }));

  /* 文件 */
  const items = {};
  for (const d of m.documents || []){
    const id = `${cid}_${d.key}`;
    const returns = d.returns || [], reqs = (d.requests || []).map(q => ({ id: q.id, source: q.source, reason: q.reason, note: q.note || '', due: q.due || undefined,
      at: toStamp(q.created_at), ts: toTs(q.created_at), by: q.created_by, uploadedAt: toStamp(q.uploaded_at), closedAt: toStamp(q.closed_at), closedBy: q.closed_fix_by || undefined, auto: q.auto }));
    const lastRet = returns[returns.length - 1];
    /* 需求判斷：目前的判斷者＝歷程最新一筆（正規化後不另外存） */
    const needs = d.need_changes || [], lastNeed = needs[needs.length - 1];
    const ask = (d.need_asks || []).slice(-1)[0];
    /* 一般提醒：次數＝提醒紀錄筆數，時間與期限取最新一筆 */
    const rems = d.reminders || [], lastRem = rems[rems.length - 1];
    items[id] = {
      id, dbId: d.id, caseId: cid, key: d.key, catalogKey: d.catalog_key, cat: d.cat, name: d.name, famName: d.fam_name, need: d.not_applicable ? '不適用' : d.need, cond: d.cond || '',
      condMet: d.cond_met, required: true, stage: d.stage, medical: d.medical, validDays: d.valid_days, inst: d.inst, order: d.sort,
      parts: (d.parts || []).length ? d.parts.map(p => ({ k: p.k, name: p.name, need: p.need })) : null,
      needSetBy: lastNeed ? lastNeed.by || undefined : undefined, needSetAt: lastNeed ? toStamp(lastNeed.at) : undefined, needNote: lastNeed ? lastNeed.note || '' : '',
      needRole: lastNeed ? (lastNeed.role || (accounts[lastNeed.by] || {}).role || undefined) : undefined,
      needAsk: ask ? { by: ask.asked_by, at: toStamp(ask.asked_at), note: ask.note, doneAt: toStamp(ask.done_at), doneBy: ask.done_by || undefined } : undefined,
      needHist: needs.map(h => ({ from: h.from_text, to: h.to_text, at: toStamp(h.at), by: h.by || undefined, role: h.role || undefined, note: h.note || '' })),
      remind: rems.length ? { n: rems.length, at: toStamp(lastRem.at), due: lastRem.due || undefined } : null,
      returned: lastRet ? { v: lastRet.version_v, reason: lastRet.reason, note: lastRet.note_for_family || '', by: lastRet.by, at: toStamp(lastRet.at) } : null,
      req: reqs[reqs.length - 1] || null, reqHistory: reqs.slice(0, -1),
      visible: d.visible === true,
      versions: (d.versions || []).map(v => ({
        v: v.v, at: toStamp(v.uploaded_at), ts: toTs(v.uploaded_at), by: v.uploaded_by, phase: v.phase, provider: v.provider || undefined, note: v.note || '',
        userDate: v.user_date || '', aiDate: v.date_prelim || '',
        idCheck: v.id_checked_at ? { ...(v.id_check_detail || {}), by: v.id_checked_by, at: toStamp(v.id_checked_at), how: v.id_check_how || '' } : undefined,
        dateConfirmed: v.date_confirmed || undefined, dateAt: toStamp(v.date_at), dateBy: v.date_by || undefined,
        adminOk: v.admin_ok === true, nurseOk: v.nurse_ok === true, nurseBy: v.nurse_by || undefined, nurseAt: toStamp(v.nurse_at), nurseTs: toTs(v.nurse_at),
        /* 護理逐欄確認的內容存在 medical_facts（每欄一列），這裡組回原型的 fields 物件 */
        fields: v.facts || undefined,
        supp: v.supp_src != null ? { src: v.supp_src, note: v.supp_note || '', by: v.uploaded_by, at: toStamp(v.uploaded_at) } : undefined,
        fromItem: v.from_document_id ? { id: keyOf[v.from_document_id], v: v.from_version, name: nameOf[v.from_document_id] || '' } : undefined,
        file: v.file_name || v.file_removed ? { name: v.file_name || '', removed: v.file_removed === true } : null
      }))
    };
  }
  return { c, items };
}

/* 把查詢結果組成整個資料模型 D（形狀與原型相同）。
 * q：{ models, profiles, org, catalog, staff } 各查詢的 data；meProfile：目前登入者的 profiles 列（伺服器端可傳 null） */
export function assembleModel(q, meProfile){
  const { models, profiles, org, catalog, staff } = q;
  /* 機構人員名冊只有姓名與角色（家屬看處理歷程「角色｜姓名」用）；RLS 看得到的完整帳號資料優先 */
  const accounts = Object.fromEntries(staff.map(p => [p.id, { id: p.id, name: p.name, role: p.role, want: p.role, status: '啟用' }]));
  for (const p of profiles) accounts[p.id] = toAccount(p);
  const me = meProfile ? toAccount(meProfile) : null; if (me) accounts[me.id] = accounts[me.id] || me;
  const D = { cases: {}, items: {}, accounts, notices: {}, docKeys: catalog.filter(r => !r.on_demand).map(r => r.key),
    settings: org ? { name: org.name, phone: org.phone, hours: org.hours, flowMode: org.flow_mode, requestDays: org.request_days, retentionDays: org.retention_days } : null };
  /* 文件的準備說明（為什麼需要、去哪裡拿）在文件清單；依 catalog_key 補上 */
  const help = Object.fromEntries(catalog.map(r => [r.key, r]));
  for (const m of models){
    const { c, items } = buildCase(m, accounts); D.cases[c.id] = c;
    for (const it of Object.values(items)){ const h = help[it.catalogKey]; if (h){ it.why = h.why; it.where = h.where; } }
    Object.assign(D.items, items);
  }
  return { D, me };
}
