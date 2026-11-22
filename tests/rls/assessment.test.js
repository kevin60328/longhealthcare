/* 階段 7：護理核對與評估的資料庫寫入（RPC），直接以各角色登入呼叫，不經過畫面。
 * 一個暫時家屬（e2e-…@example.com）提出申請、指派給 nurse@example.com；測試全部跑完後由 tests/vitest-cleanup.js 清除。
 * 涵蓋：照護文件需求判斷（自動補件與關閉）、核對草稿、完成核對（醫療資料、逐筆診斷同步、舊版取代）、退回補件、
 *       護理補充評估、診斷清單、習慣卡初審、收治評估前置條件與需補充；docs_ready 與規則逐筆比對。 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { as, service, URL as SB_URL, ANON } from './helpers.js';
import { assembleModel, todayTW } from '../../js/modules/services/model-build.js';
import { createRules } from '../../js/modules/rules/core.js';

const PW = 'Temp-pass-0001';
const PNG = readFileSync(new URL('../../reference/sample_docs/03_出院病歷摘要_張秀英.png', import.meta.url));
let seq = 0;
const made = [], users = [];
async function tempFamily(){
  const email = `e2e-as7-${Date.now()}-${++seq}@example.com`;
  const { data, error } = await service().auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { name: '評估家屬' + seq, phone: '0912000' + String(300 + seq), want: 'family' } });
  if (error) throw error;
  users.push(data.user.id);
  const db = createClient(SB_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  await db.auth.signInWithPassword({ email, password: PW });
  return { db, id: data.user.id };
}
const docsOf = async id => Object.fromEntries((await service().from('documents').select('id, key').eq('case_id', id)).data.map(d => [d.key, d.id]));
const status = id => service().rpc('doc_status', { p_doc: id }).then(r => r.data);
const reqs = id => service().from('document_requests').select('*').eq('document_id', id).order('created_at').then(r => r.data);
const notices = id => service().from('notices').select('text').eq('case_id', id).order('at').then(r => r.data.map(x => x.text));
/* 家屬上傳＋行政收件核對（醫療文件收件後進入「待護理核對」） */
async function uploadChecked(fam, caseId, key, docId){
  const { data: vs } = await service().from('document_versions').select('v').eq('document_id', docId);
  const v = (vs || []).length + 1, path = `${caseId}/${key}/v${v}-${crypto.randomUUID()}.png`;
  let r = await fam.db.storage.from('case-files').upload(path, PNG, { contentType: 'image/png' }); if (r.error) throw r.error;
  r = await fam.db.rpc('submit_version', { p_doc: docId, p_path: path, p_file_name: key + '.png', p_user_date: null }); if (r.error) throw r.error;
  r = await staff.rpc('staff_receipt', { p_doc: docId, p_v: v, p_how: '必要欄位全部相符', p_detail: {} }); if (r.error) throw r.error;
  return v;
}
const dxRows = (...texts) => ({ raw: texts.join('、'), absent: false, rows: texts.map((t, n) => ({ n: n + 1, raw: t, text: t, state: '已確認', by: 'x', at: '2026/11/23 10:00' })) });

let staff, nurse, nurse2, fam, C, D, ID = {};
beforeAll(async () => {
  [staff, nurse, nurse2] = await Promise.all([as('staff@example.com'), as('nurse@example.com'), as('nurse2@example.com')]);
  for (const p of (await service().from('profiles').select('id, email')).data) ID[p.email.split('@')[0]] = p.id;
  fam = await tempFamily();
  const r = await fam.db.rpc('create_application', { p_token: 'tok7-' + Date.now(), p_name: '評估測試住民', p_nid: 'X2' + String(Date.now()).slice(-8), p_birth: '1940-06-12', p_relation: '女兒', p_hospital: '', p_admit: '2026-12-30' });
  if (r.error) throw r.error;
  C = r.data.case_id; made.push(C);
  let x = await staff.rpc('confirm_case', { p_case: C, p_called: true, p_chart: '', p_admit: '2026-12-30' }); if (x.error) throw x.error;
  x = await fam.db.rpc('sign_consent', { p_case: C, p_signer: '本人', p_signer_name: '評估家屬', p_agree: true, p_photo: false, p_emergency: false }); if (x.error) throw x.error;
  x = await service().from('case_assignments').insert({ case_id: C, nurse_id: ID.nurse, by: ID.staff, at: new Date().toISOString() }); if (x.error) throw x.error;
  D = await docsOf(C);
}, 90000);
afterAll(async () => {
  const svc = service();
  for (const id of made) await svc.from('cases').update({ closed_at: new Date().toISOString(), closed_title: '測試結束', closed_reason: '自動測試建立的案件' }).eq('id', id).is('closed_at', null);
  for (const id of users) await svc.from('profiles').update({ status: '停用' }).eq('id', id);
});

describe('照護文件需求判斷（set_nurse_need）', () => {
  it('只有承辦護理師；不需要要寫原因；判斷需要 → 自動建立補件（護理判斷）並通知家屬', async () => {
    expect((await staff.rpc('set_nurse_need', { p_doc: D.tubeCare, p_met: true, p_note: '' })).error?.message).toMatch(/承辦護理師/);
    expect((await nurse2.rpc('set_nurse_need', { p_doc: D.tubeCare, p_met: true, p_note: '' })).error?.message).toMatch(/負責護理師/);
    expect((await nurse.rpc('set_nurse_need', { p_doc: D.tubeCare, p_met: false, p_note: '' })).error?.message).toMatch(/原因/);
    const r = await nurse.rpc('set_nurse_need', { p_doc: D.tubeCare, p_met: true, p_note: '出院摘要記載有鼻胃管' });
    expect(r.error).toBeNull(); expect(r.data.requests).toHaveLength(1);
    expect((await reqs(D.tubeCare))[0]).toMatchObject({ source: '護理判斷', reason: '護理師確認需要提供', auto: true, closed_at: null });
    expect((await notices(C)).slice(-1)[0]).toMatch(/^護理師確認需要提供「管路照護資料」，請在 \d+\/\d+ 前上傳。準備方式：/);
    expect((await nurse.rpc('set_nurse_need', { p_doc: D.tubeCare, p_met: true, p_note: '出院摘要記載有鼻胃管' })).error?.message).toMatch(/沒有變更/);
  });
  it('改為尚待確認（家屬還沒上傳）→ 關閉未完成的補件並通知；行政的「請護理重新判斷」一併標示已回覆', async () => {
    expect((await staff.rpc('ask_nurse_need', { p_doc: D.tubeCare, p_note: '家屬說已拔管' })).error).toBeNull();
    const r = await nurse.rpc('set_nurse_need', { p_doc: D.tubeCare, p_met: null, p_note: '再確認' });
    expect(r.error).toBeNull(); expect(r.data.message).toMatch(/關閉/);
    expect((await reqs(D.tubeCare))[0]).toMatchObject({ closed_reason: '護理改為尚待確認' });
    expect((await service().from('document_need_asks').select('done_by').eq('document_id', D.tubeCare)).data[0].done_by).toBe(ID.nurse);
    expect((await notices(C)).slice(-1)[0]).toBe('「管路照護資料」護理師還在確認是否需要，目前先不用上傳，確認後會再通知您。');
  });
});

describe('醫療內容核對（草稿、完成、退回）', () => {
  it('核對草稿：只有承辦護理師；依文件＋版本保存；版本不符擋下', async () => {
    await uploadChecked(fam, C, 'summary', D.summary);
    expect(await status(D.summary)).toBe('待護理核對');
    expect((await nurse2.rpc('save_review_draft', { p_doc: D.summary, p_v: 1, p_data: {} })).error?.message).toMatch(/負責護理師/);
    expect((await nurse.rpc('save_review_draft', { p_doc: D.summary, p_v: 2, p_data: {} })).error?.message).toMatch(/新版本/);
    expect((await nurse.rpc('save_review_draft', { p_doc: D.summary, p_v: 1, p_data: { fields: { stype: { val: '住院出院摘要' } } } })).error).toBeNull();
    expect((await nurse.from('review_drafts').select('data').eq('document_id', D.summary).single()).data.data.fields.stype.val).toBe('住院出院摘要');
  });
  it('完成核對：診斷還有未確認擋下；完成後寫入醫療資料、核對紀錄、逐筆診斷同步到清單，草稿刪除', async () => {
    const pend = { raw: '高血壓', absent: false, rows: [{ n: 1, raw: '高血壓', text: '高血壓', state: '待確認' }] };
    const args = { p_doc: D.summary, p_v: 1, p_fields: { stype: '住院出院摘要', dx: '高血壓、糖尿病', tube: '無', allergy: '無已知過敏', wound: '無' }, p_review: [{ k: 'tube', after: '無' }], p_review_src: '人工輸入＋人工核對', p_labs: {} };
    expect((await nurse.rpc('complete_review', { ...args, p_dx: pend })).error?.message).toMatch(/診斷尚未確認/);
    expect((await staff.rpc('complete_review', { ...args, p_dx: dxRows('高血壓', '糖尿病') })).error?.message).toMatch(/承辦護理師/);
    const r = await nurse.rpc('complete_review', { ...args, p_dx: dxRows('高血壓', '糖尿病') });
    expect(r.error).toBeNull(); expect(r.data).toMatchObject({ status: '確認符合', facts: 5 });
    const v = (await service().from('document_versions').select('*').eq('document_id', D.summary).single()).data;
    expect(v).toMatchObject({ nurse_ok: true, nurse_by: ID.nurse, review_src: '人工輸入＋人工核對' });
    expect((await service().from('medical_facts').select('field, value').eq('document_id', D.summary)).data).toHaveLength(5);
    const g = (await service().from('diagnoses').select('*').eq('case_id', C).order('source_row')).data;
    expect(g.map(x => [x.std, x.status, x.source_version, x.source_row])).toEqual([['高血壓', '已確認', 1, 1], ['糖尿病', '已確認', 1, 2]]);
    expect((await service().from('review_drafts').select('document_id').eq('document_id', D.summary)).data).toHaveLength(0);
  });
  it('病摘新版本核對完成：舊版本帶入的診斷標示已由新版取代（不刪除）', async () => {
    /* 已確認符合的文件不能直接再上傳：先由行政要求補件，家屬補傳第 2 版 */
    expect((await staff.rpc('request_documents', { p_case: C, p_docs: [D.summary], p_other: '', p_other_medical: false, p_reason: '文件不完整或缺頁', p_note: '' })).error).toBeNull();
    await uploadChecked(fam, C, 'summary', D.summary);
    const r = await nurse.rpc('complete_review', { p_doc: D.summary, p_v: 2, p_fields: { stype: '住院出院摘要', dx: '高血壓' }, p_review: [], p_review_src: '人工輸入＋人工核對', p_labs: {}, p_dx: dxRows('高血壓') });
    expect(r.error).toBeNull();
    const g = (await service().from('diagnoses').select('source_version, superseded_at').eq('case_id', C).order('source_version')).data;
    expect(g.filter(x => x.source_version === 1).every(x => x.superseded_at)).toBe(true);
    expect(g.filter(x => x.source_version === 2)).toHaveLength(1);
  });
  it('退回補件：只能在待護理核對；需補件、正式補件（來源：護理）、通知家屬', async () => {
    await uploadChecked(fam, C, 'meds', D.meds);
    expect((await nurse.rpc('return_document', { p_doc: D.meds, p_v: 1, p_reason: '隨便', p_note: '' })).error?.message).toMatch(/原因/);
    const r = await nurse.rpc('return_document', { p_doc: D.meds, p_v: 1, p_reason: '缺少頁面', p_note: '請補第 2 頁' });
    expect(r.error).toBeNull(); expect(r.data.requests).toHaveLength(1);
    expect(await status(D.meds)).toBe('需補件');
    expect((await reqs(D.meds))[0]).toMatchObject({ source: '護理', reason: '缺少頁面', note: '請補第 2 頁' });
    expect((await notices(C)).slice(-1)[0]).toMatch(/^請在 \d+\/\d+ 前重新上傳「目前用藥清單或處方資料」：缺少頁面$/);
    expect((await nurse.rpc('return_document', { p_doc: D.meds, p_v: 1, p_reason: '缺少頁面', p_note: '' })).error?.message).toMatch(/狀態已改變/);
  });
});

describe('護理補充評估、診斷清單', () => {
  it('補充評估：只限需要繳交、未上傳的照護紀錄；每欄必填；完成後即護理核對完成', async () => {
    expect((await nurse.rpc('save_supp', { p_doc: D.swallow, p_src: '與家屬會談', p_note: 'x', p_fields: { swallow: '可正常由口進食' }, p_review: [] })).error?.message).toMatch(/不能做護理補充評估/);
    await nurse.rpc('set_nurse_need', { p_doc: D.swallow, p_met: true, p_note: '吞嚥困難' });
    expect((await nurse.rpc('save_supp', { p_doc: D.swallow, p_src: '與家屬會談', p_note: '女兒說明', p_fields: { swallow: ' ' }, p_review: [] })).error?.message).toMatch(/每個欄位都要填寫/);
    const r = await nurse.rpc('save_supp', { p_doc: D.swallow, p_src: '與家屬會談', p_note: '女兒說明', p_fields: { swallow: '需軟質或剁碎' }, p_review: [] });
    expect(r.error).toBeNull(); expect(r.data.status).toBe('確認符合');
    const v = (await service().from('document_versions').select('*').eq('document_id', D.swallow).single()).data;
    expect(v).toMatchObject({ supp_src: '與家屬會談', supp_note: '女兒說明', storage_path: null, nurse_ok: true, review_src: '護理補充評估（與家屬會談）' });
    expect((await reqs(D.swallow)).slice(-1)[0].closed_at).not.toBeNull();   // 需求判斷建立的補件，確認符合後關閉
  });
  it('診斷：ICD-10-CM 只檢查格式、要填名稱；同時修改擋下；從病摘帶入不重複', async () => {
    const base = { p_case: C, p_id: null, p_expect_text: null, p_raw: '慢性腎臟病', p_std: '', p_icd_name: '', p_ok: false };
    expect((await nurse.rpc('dx_save', { ...base, p_icd: 'XX1' })).error?.message).toMatch(/格式不正確/);
    expect((await nurse.rpc('dx_save', { ...base, p_icd: 'N18.3' })).error?.message).toMatch(/名稱/);
    const id = (await nurse.rpc('dx_save', { ...base, p_icd: 'n18.3', p_icd_name: 'Chronic kidney disease, stage 3' })).data;
    expect((await service().from('diagnoses').select('icd_code, status').eq('id', id).single()).data).toEqual({ icd_code: 'N18.3', status: '待確認' });
    expect((await nurse.rpc('dx_save', { ...base, p_id: id, p_expect_text: '別的', p_icd: '' })).error?.message).toMatch(/已被修改/);
    expect((await nurse.rpc('dx_save', { ...base, p_id: id, p_expect_text: '慢性腎臟病', p_std: '慢性腎臟病第三期', p_icd: 'N18.3', p_icd_name: 'CKD 3', p_ok: true })).error).toBeNull();
    expect((await service().from('diagnosis_changes').select('to_status').eq('diagnosis_id', id).order('id')).data.map(x => x.to_status)).toEqual(['待確認', '已確認']);
    expect((await nurse.rpc('dx_import', { p_case: C, p_doc: D.summary, p_v: 2, p_parts: ['慢性腎臟病'] })).error?.message).toMatch(/已經帶入過/);
    expect((await staff.rpc('dx_save', { ...base, p_icd: '' })).error?.message).toMatch(/承辦護理師/);
  });
});

describe('習慣卡初審（review_habit）與收治評估（save_assessment）', () => {
  it('習慣卡：沒有正式提交擋下；版本不符擋下；有疑義要說明；不一致項目要處理說明；完成後 habit_gate 通過', async () => {
    const hr = (p) => nurse.rpc('review_habit', { p_case: C, p_note: '', p_rev: 1, p_diff_res: [], p_med: {}, p_state: '審核完成', ...p });
    expect((await hr({})).error?.message).toMatch(/尚未正式提交/);
    const s = await service().from('habit_submissions').insert({ case_id: C, rev: 1, n: 1, data: { call: '阿嬤', famAllergy: '盤尼西林' }, submitted_by: fam.id }); if (s.error) throw s.error;
    expect((await hr({ p_rev: 2 })).error?.message).toMatch(/重新提交/);
    expect((await hr({ p_state: '有疑義' })).error?.message).toMatch(/疑義內容/);
    expect((await hr({ p_state: '有疑義', p_note: '過敏與醫院資料不同' })).error).toBeNull();
    expect((await hr({ p_diff_res: [{ k: 'allergy', fam: '盤尼西林', conf: '無已知過敏', res: '' }], p_note: '已確認' })).error?.message).toMatch(/處理說明/);
    expect((await hr({ p_note: '' })).error?.message).toMatch(/疑義如何處理/);
    expect((await service().rpc('habit_gate', { p_case: C })).data).toBe(false);
    expect((await hr({ p_diff_res: [{ k: 'allergy', fam: '盤尼西林', conf: '無已知過敏', res: '電話確認以醫院為準' }], p_note: '已電話確認', p_med: { allergy: '無已知過敏' } })).error).toBeNull();
    expect((await service().rpc('habit_gate', { p_case: C })).data).toBe(true);
    const row = (await service().from('habit_reviews').select('*').eq('case_id', C).order('id').limit(1).single()).data;
    expect(row.state).toBe('有疑義／待確認');
    const done = (await service().from('habit_reviews').select('snap, med_snapshot').eq('case_id', C).eq('state', '審核完成').single()).data;
    expect(done).toEqual({ snap: { call: '阿嬤', famAllergy: '盤尼西林' }, med_snapshot: { allergy: '無已知過敏' } });
  });
  it('評估：文件不齊擋下；文件齊全後：流程不符的結果、缺說明擋下；需補充 → 指定文件退回、建立補件、記錄指定文件；之後文件不齊再擋下', async () => {
    const a = p => nurse.rpc('save_assessment', { p_case: C, p_result: '收治', p_move: '一人協助', p_behav: '無明顯行為問題', p_iso: '不需要', p_dnr_state: '尚未另行確認', p_dnr_src: '', p_reason: '', p_docs: [], p_other: '', ...p });
    expect((await a({})).error?.message).toMatch(/必要文件尚未全部確認符合/);
    /* 讓評估前文件齊全：身分證明、健保卡收件；用藥重新上傳後核對；條件式（管路、傷口）判斷不需要 */
    await uploadChecked(fam, C, 'idcopy', D.idcopy); await uploadChecked(fam, C, 'nhi', D.nhi);
    const mv = await uploadChecked(fam, C, 'meds', D.meds);
    expect((await nurse.rpc('complete_review', { p_doc: D.meds, p_v: mv, p_fields: { meds: 'Amlodipine 5mg QD', note: '文件未記載' }, p_review: [], p_review_src: '人工輸入＋人工核對', p_labs: {}, p_dx: null })).error).toBeNull();
    await nurse.rpc('set_nurse_need', { p_doc: D.tubeCare, p_met: false, p_note: '已拔管' });
    await nurse.rpc('set_nurse_need', { p_doc: D.woundCare, p_met: false, p_note: '無傷口' });
    expect((await service().rpc('docs_ready', { p_case: C })).data).toBe(true);
    expect((await a({ p_result: '可入住' })).error?.message).toMatch(/流程不能選/);
    expect((await a({ p_result: '不收治' })).error?.message).toMatch(/請填寫說明/);
    expect((await a({ p_dnr_state: '已確認：有簽署文件' })).error?.message).toMatch(/DNR/);
    expect((await nurse2.rpc('save_assessment', { p_case: C, p_result: '收治', p_move: '', p_behav: '', p_iso: '', p_dnr_state: '尚未另行確認', p_dnr_src: '', p_reason: '', p_docs: [], p_other: '' })).error?.message).toMatch(/負責護理師/);
    const r = await a({ p_result: '需補充', p_reason: '請補最近的用藥', p_docs: [D.meds], p_other: '最近一次抽血報告' });
    expect(r.error).toBeNull(); expect(r.data.requests).toHaveLength(2);
    expect(await status(D.meds)).toBe('需補件');
    expect((await service().from('assessment_items').select('document_id').eq('assessment_id', r.data.id)).data).toHaveLength(2);
    expect((await service().from('documents').select('custom_where').eq('case_id', C).eq('name', '最近一次抽血報告').single()).data.custom_where).toBe('請向住民就醫的醫院或診所索取');
    expect((await notices(C)).slice(-1)[0]).toMatch(/^護理師需要補充資料，請在 \d+\/\d+ 前登入上傳$/);
    expect((await a({})).error?.message).toMatch(/必要文件尚未全部確認符合/);
  });
});

describe('docs_ready 與 rules/core.js 的 docsReady 相同', () => {
  it('所有進行中案件', async () => {
    const svc = service();
    const [models, profiles, org, catalog] = await Promise.all([svc.rpc('get_case_models', { p_case: null, p_include_closed: false }), svc.from('profiles').select('*'),
      svc.from('org_settings').select('*').eq('id', 1).maybeSingle(), svc.from('doc_catalog').select('key, why, "where", on_demand').order('sort')]);
    const { D: M } = assembleModel({ models: models.data, profiles: profiles.data, org: org.data, catalog: catalog.data, staff: [] }, null);
    const R = createRules(M, { me: null, today: todayTW() });
    const diff = [], seen = new Set();
    for (const c of Object.values(M.cases).filter(c => c.linkStatus === '已確認')){
      const got = (await svc.rpc('docs_ready', { p_case: c.id })).data, want = R.docsReady(c);
      seen.add(want); if (got !== want) diff.push(`${c.no}：資料庫 ${got}，規則 ${want}`);
    }
    expect(diff).toEqual([]);
    expect([...seen].sort()).toEqual([false, true]);
  }, 120000);
});
