/* 把原型 v18 的 4 筆測試案件（HANDOFF 12：A 待護理核對、B 待收治評估、C 摘要卡待審核、D 摘要卡已開放）寫進測試專案。
 *
 * 資料來源：tests/unit/fixtures/parity.json.gz 裡「原型 seedTestCase 實際建立」的案件（沒有隨機變化的那一份）。
 * 用途：讓工作清單等畫面有完整狀態的資料可看，並讓 tests/rls/model.test.js 驗證
 *       「資料庫 → get_case_models → 資料轉換 → 業務規則」的結果與原型相同。
 * 正式的「測試資料」功能在 settings.html（階段 9）；這個腳本只給開發與自動測試用。
 *
 * 用法：npm run db:seed-cases（先跑過 npm run db:seed 建立帳號）
 * 可重複執行：同編號的測試案件會先刪除再重建（回到起始狀態）。只限本機或標示為測試專案的 Supabase。 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createClient } from '@supabase/supabase-js';
import { loadEnv, assertTestTarget } from './load-env.mjs';

const env = loadEnv();
assertTestTarget(env);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const must = (res, what) => { if (res.error) throw new Error(`${what}：${res.error.message}`); return res.data; };

const F = JSON.parse(gunzipSync(readFileSync('tests/unit/fixtures/parity.json.gz')));
/* 每個測試案件的第一個情境就是原型建立時的原始狀態 */
const bases = [];
for (const s of F.scenarios){ if (s.input.c.id.startsWith('TEST-') && !bases.some(b => b.c.id === s.input.c.id)) bases.push(s.input); }

/* 原型時間「YYYY/MM/DD HH:MM」（台灣時間）→ ISO */
const iso = st => st && /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/.test(st) ? st.slice(0, 16).replace(/\//g, '-').replace(' ', 'T') + ':00+08:00' : null;
/* 原型帳號 id 是 email；正式版是 uuid */
const profiles = must(await db.from('profiles').select('id, email, name'), '讀取帳號');
const uid = e => { if (!e) return null; const p = profiles.find(x => x.email === e); if (!p) throw new Error(`找不到帳號 ${e}（請先執行 npm run db:seed）`); return p.id; };
const nameOf = e => (profiles.find(x => x.email === e) || {}).name || '';
const mapBy = o => o && typeof o === 'object' ? { ...o, ...(o.by ? { by: uid(o.by) } : {}) } : o;
const catalog = Object.fromEntries(must(await db.from('doc_catalog').select('*'), '讀取文件清單').map(r => [r.key, r]));
const parts = must(await db.from('doc_catalog_parts').select('*'), '讀取文件核對項目');

/* 建立時間：原型的測試案件都是同一分鐘送出，排序靠建立順序的毫秒差（後建立的排前面）；這裡每筆多加 1 秒，排序與原型相同 */
const createdIso = (c, n) => iso(c.createdAt).replace(':00+08:00', `:${String(n).padStart(2, '0')}+08:00`);

for (const [n, { c, items }] of bases.entries()){
  /* 1. 刪除舊的同編號測試案件（相關資料會一起刪除） */
  const old = must(await db.from('cases').select('id').eq('no', c.no), `查詢 ${c.no}`);
  for (const o of old) must(await db.from('cases').delete().eq('id', o.id), `刪除舊的 ${c.no}`);

  /* 2. 住民（以身分證字號區分同一個人；已存在就沿用）與案件主檔 */
  const resident = must(await db.from('residents').upsert({ nid: c.patient.nid, name: c.patient.name, birth: c.patient.birth || null, chart_no: c.patient.chart || '' },
    { onConflict: 'nid' }).select('id').single(), `住民 ${c.patient.name}`);
  const row = must(await db.from('cases').insert({
    no: c.no, family_id: uid(c.familyId), relation: c.relation, resident_id: resident.id,
    flow_mode: c.flowMode, hospital: c.hospital || '', planned_admit: c.plannedAdmit || null, link_status: c.linkStatus,
    confirmed_at: iso(c.confirmedAt), confirmed_by: uid(c.confirmedBy),
    doc_due: c.docDue || null, pre_due: c.preDue || null,
    signed_at: iso(c.signedAt), signed_by: c.signedAt ? uid(c.signedBy) : null,
    created_at: createdIso(c, n), updated_at: createdIso(c, n)
  }).select('id').single(), `建立 ${c.no}`);
  const cid = row.id;

  /* 承辦護理師：只能由分配紀錄設定（觸發器同步 cases.nurse_id）。
   * 原型的測試案件只有 nurseId、沒有分配歷程（畫面顯示「原始分配時間未記錄」），所以寫一筆分配人與時間空白的舊資料分配紀錄 */
  for (const h of c.assignHist || []) must(await db.from('case_assignments').insert({ case_id: cid, nurse_id: uid(h.to), from_nurse_id: uid(h.from), by: uid(h.by), at: iso(h.at), reason: h.reason || null }), '分配歷程');
  if (c.nurseId && !(c.assignHist || []).length) must(await db.from('case_assignments').insert({ case_id: cid, nurse_id: uid(c.nurseId), by: null, at: null, reason: '舊資料：分配時間未記錄' }), '承辦護理師');

  /* 3. 個資同意 */
  if (c.consent) must(await db.from('consents').insert({ case_id: cid, ver: c.consent.ver || 1, signer_type: c.consent.signer, signer_name: c.consent.signerName || nameOf(c.consent.by),
    signed_by: uid(c.consent.by), signed_at: iso(c.consent.at), state: '有效', emergency: !!c.consent.emergency, photo: !!c.consent.photo }), '個資同意');

  /* 4. 文件（建立當時的清單設定快照＋核對項目）、需求判斷歷程、版本、護理確認欄位 */
  const docRows = Object.values(items).map(i => { const k = catalog[i.key] || {};
    return { case_id: cid, key: i.key, catalog_key: catalog[i.key] ? i.key : null, cat: i.cat, name: i.name, fam_name: k.fam_name || i.name, stage: i.stage, need: i.need, cond: i.cond || '',
      valid_days: i.validDays || null, medical: !!i.medical, inst: !!k.inst, nurse_decides: !!k.nurse_decides, sort: i.order || 0, cond_met: i.condMet ?? null }; });
  const docs = must(await db.from('documents').insert(docRows).select('id, key'), '文件');
  const docId = Object.fromEntries(docs.map(d => [d.key, d.id]));
  const partRows = docs.flatMap(d => parts.filter(p => p.catalog_key === d.key).map(p => ({ document_id: d.id, k: p.k, name: p.name, need: p.need, sort: p.sort })));
  if (partRows.length) must(await db.from('document_parts').insert(partRows), '核對項目');
  const needRows = Object.values(items).flatMap(i => (i.needHist || []).map(h => ({ document_id: docId[i.key], from_text: h.from || '', to_text: h.to || '', by: uid(h.by), role: h.role || null, note: h.note || null, at: iso(h.at) })));
  if (needRows.length) must(await db.from('document_need_changes').insert(needRows), '需求判斷歷程');
  const vers = Object.values(items).flatMap(i => (i.versions || []).map(v => ({
    document_id: docId[i.key], v: v.v, uploaded_by: uid(v.by), uploaded_at: iso(v.at), phase: v.phase || 'received', provider: v.provider || null, note: v.note || null,
    file_name: `${i.name}（模擬文件）.jpg`, mime: 'image/jpeg', storage_path: null,
    user_date: v.userDate || null, date_prelim: v.aiDate || null,
    id_checked_by: v.idCheck ? uid(v.idCheck.by) : null, id_checked_at: v.idCheck ? iso(v.idCheck.at) : null, id_check_how: v.idCheck ? v.idCheck.how || null : null,
    date_confirmed: v.dateConfirmed || null, date_by: uid(v.dateBy), date_at: iso(v.dateAt),
    admin_ok: v.adminOk ?? null, nurse_ok: v.nurseOk ?? null, nurse_by: uid(v.nurseBy), nurse_at: iso(v.nurseAt),
    supp_src: v.supp ? v.supp.src || '' : null, supp_note: v.supp ? v.supp.note || null : null,
    from_document_id: v.fromItem ? docId[v.fromItem.id.split('_').pop()] : null, from_version: v.fromItem ? v.fromItem.v : null
  })));
  /* 沿用其他文件檔案的版本要在被沿用的版本之後寫入（外鍵） */
  const plain = vers.filter(x => !x.from_document_id), linked = vers.filter(x => x.from_document_id);
  if (plain.length) must(await db.from('document_versions').insert(plain), '文件版本');
  if (linked.length) must(await db.from('document_versions').insert(linked), '文件版本（沿用檔案）');
  /* 護理逐欄確認的內容：每欄一列（medical_facts） */
  const facts = Object.values(items).flatMap(i => (i.versions || []).filter(v => v.fields).flatMap(v => Object.entries(v.fields).map(([field, value]) => ({
    document_id: docId[i.key], version_v: v.v, field, value: String(value ?? ''), confirmed_by: uid(v.nurseBy || v.by), confirmed_at: iso(v.nurseAt || v.at) }))));
  if (facts.length) must(await db.from('medical_facts').insert(facts), '護理確認欄位');

  /* 5. 習慣卡：正式提交＋家屬草稿；護理初審歷程（審核完成那一筆附上當時的內容快照） */
  if (c.habit){
    must(await db.from('habit_cards').insert({ case_id: cid, draft: c.habit.data || {}, draft_rev: c.habit.rev || 0, draft_updated_at: iso(c.habit.updatedAt), draft_updated_by: uid(c.habit.updatedBy) }), '習慣卡草稿');
    /* 各區最後修改時間（原型 habit.secAt） */
    const secs = Object.entries(c.habit.secAt || {}).map(([sec, x]) => ({ case_id: cid, sec, updated_at: iso(x.at), updated_by: uid(x.by) }));
    if (secs.length) must(await db.from('habit_card_sections').insert(secs), '習慣卡各區修改時間');
    if (c.habit.sub) must(await db.from('habit_submissions').insert({ case_id: cid, rev: c.habit.sub.rev, n: c.habit.sub.n, data: c.habit.sub.data, submitted_by: uid(c.habit.sub.by), submitted_at: iso(c.habit.sub.at) }), '習慣卡提交');
  }
  if (c.habitReview){
    const done = c.habitReview.done;
    const rows = (c.habitReview.hist || [c.habitReview]).map(h => {
      const isDone = done && h.state === '審核完成' && h.rev === done.rev && h.at === done.at;
      return { case_id: cid, rev: h.rev, state: h.state, note: h.note || null, reviewed_by: uid(h.by), reviewed_at: iso(h.at), diff_res: h.diffRes || null,
        snap: isDone ? done.snap : null, med_snapshot: isDone ? done.med : null };
    });
    must(await db.from('habit_reviews').insert(rows), '習慣卡初審');
  }

  /* 6. 收治評估 */
  if (c.assessment){ const a = c.assessment;
    must(await db.from('assessments').insert({ case_id: cid, mode: a.mode || c.flowMode, result: a.result, move: a.move || null, behav: a.behav || null, iso: a.iso || null, reason: a.reason || null, by: uid(a.by), at: iso(a.at) }), '收治評估'); }

  /* 7. 照顧摘要卡與開放對象 */
  if (c.card){ const k = c.card;
    const content = Object.fromEntries(Object.entries(k).filter(([key]) => !['status', 'v', 'ts', 'caregivers', 'by', 'at', 'review', 'basis'].includes(key)));
    const card = must(await db.from('care_cards').insert({ case_id: cid, v: k.v || 1, status: k.status, content, basis: k.basis || {}, review: k.review ? mapBy(k.review) : null,
      opened_by: uid(k.by), opened_at: iso(k.at) }).select('id').single(), '摘要卡');
    if ((k.caregivers || []).length) must(await db.from('care_card_caregivers').insert(k.caregivers.map(e => ({ card_id: card.id, caregiver_id: uid(e) }))), '摘要卡開放對象');
  }
  console.log(`測試案件 ${c.no} ${c.patient.name}（${c.flowMode}）：${docs.length} 份文件、${vers.length} 個版本`);
}
console.log('完成');
