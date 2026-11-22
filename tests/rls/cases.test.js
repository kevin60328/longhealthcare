/* 階段 5：個案管理的寫入函式（RPC），直接呼叫資料庫測試，不經過畫面。
 * 每個測試用暫時家屬提出新申請；結束時案件結案、暫時帳號停用（有操作紀錄的資料依規則不能刪）。 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { as, service, URL, ANON } from './helpers.js';

const PW = 'Temp-pass-0001';
const made = [], users = [];
let seq = 0;
const newNid = () => 'Y1' + String(Date.now() * 10 + (++seq)).slice(-8);

async function tempUser(role, { phone = '0912000444', name } = {}){
  const svc = service(), email = `e2e-case-${role}-${Date.now()}-${++seq}@example.com`;
  const { data, error } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { name: name || '測試' + role + seq, phone, want: 'family' }, app_metadata: { role } });
  if (error) throw error;
  users.push(data.user.id);
  if (role !== 'family') await svc.from('profiles').update({ role, status: '啟用', want: role }).eq('id', data.user.id);
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const r = await c.auth.signInWithPassword({ email, password: PW }); if (r.error) throw r.error;
  return { db: c, id: data.user.id };
}
/* 家屬提出申請；opts.confirm：行政確認；opts.consent：家屬簽同意書（本人或其他身分） */
async function newCase(fam, { confirm = true, consent = '本人', flow } = {}){
  const { data, error } = await fam.db.rpc('create_application', { p_token: 'tok5-' + Date.now() + '-' + (++seq), p_name: '案件測試住民', p_nid: newNid(), p_birth: '1941-02-03', p_relation: '兒子', p_hospital: '', p_admit: '2026-12-30' });
  if (error) throw error;
  made.push(data.case_id);
  if (flow) await service().from('cases').update({ flow_mode: flow }).eq('id', data.case_id);
  if (confirm){ const r = await staff.rpc('confirm_case', { p_case: data.case_id, p_called: true, p_chart: '', p_admit: '2026-12-30' }); if (r.error) throw r.error; }
  if (confirm && consent){ const r = await fam.db.rpc('sign_consent', { p_case: data.case_id, p_signer: consent, p_signer_name: '王測試', p_agree: true, p_photo: false, p_emergency: false }); if (r.error) throw r.error; }
  return data.case_id;
}
const caseRow = id => service().from('cases').select('*').eq('id', id).single().then(r => r.data);
const notices = id => service().from('notices').select('text').eq('case_id', id).order('at').then(r => r.data.map(x => x.text));
const addAssessment = (id, result, by) => service().from('assessments').insert({ case_id: id, mode: '收治評估', result, by, reason: '測試' });

let staff, nurse, nurse2, fam, ID = {};
beforeAll(async () => {
  [staff, nurse, nurse2] = await Promise.all([as('staff@example.com'), as('nurse@example.com'), as('nurse2@example.com')]);
  for (const p of (await service().from('profiles').select('id, email')).data) ID[p.email.split('@')[0]] = p.id;
  fam = await tempUser('family');
});
afterAll(async () => {
  const svc = service();
  for (const id of made) await svc.from('cases').update({ closed_at: new Date().toISOString(), closed_title: '測試結束', closed_reason: '自動測試建立的案件' }).eq('id', id).is('closed_at', null);
  for (const id of users) await svc.from('profiles').update({ status: '停用' }).eq('id', id);
});

describe('確認申請並轉交（confirm_case）／不受理', () => {
  it('非行政不能確認；沒電話確認擋下；確認後轉交、設定繳交期限、通知家屬；第二次確認擋下', async () => {
    const id = await newCase(fam, { confirm: false });
    expect((await nurse.rpc('confirm_case', { p_case: id, p_called: true, p_chart: '', p_admit: '2026-12-30' })).error?.message).toMatch(/只有行政/);
    expect((await staff.rpc('confirm_case', { p_case: id, p_called: false, p_chart: '', p_admit: '2026-12-30' })).error?.message).toMatch(/電話確認/);
    const r = await staff.rpc('confirm_case', { p_case: id, p_called: true, p_chart: 'H-123', p_admit: '2026-12-31' });
    expect(r.error).toBeNull();
    const c = await caseRow(id);
    expect(c).toMatchObject({ link_status: '已確認', planned_admit: '2026-12-31', doc_due: r.data, confirmed_by: ID.staff, handover_by: ID.staff });
    expect((await service().from('residents').select('chart_no').eq('id', c.resident_id).single()).data.chart_no).toBe('H-123');
    expect((await notices(id))[0]).toMatch(/^本中心已確認您的申請，請登入簽署個人資料同意書，並在 \d+\/\d+ 前上傳文件$/);
    expect((await staff.rpc('confirm_case', { p_case: id, p_called: true, p_chart: '', p_admit: '2026-12-31' })).error?.message).toMatch(/已經處理過/);
  });

  it('兩位行政同時確認同一件申請：只有一位成功', async () => {
    const id = await newCase(fam, { confirm: false });
    const staff2 = await tempUser('staff', { phone: '0912000555' });
    const rs = await Promise.all([staff, staff2.db].map(db => db.rpc('confirm_case', { p_case: id, p_called: true, p_chart: '', p_admit: '2026-12-30' })));
    expect(rs.filter(r => !r.error)).toHaveLength(1);
    expect(rs.find(r => r.error).error.message).toMatch(/已經處理過/);
  });

  it('利益衝突：申請人電話與行政相同時不能確認', async () => {
    const { data: sp } = await service().from('profiles').select('phone').eq('id', ID.staff).single();
    const f2 = await tempUser('family', { phone: sp.phone });
    const id = await newCase(f2, { confirm: false });
    expect((await staff.rpc('confirm_case', { p_case: id, p_called: true, p_chart: '', p_admit: '2026-12-30' })).error?.message).toMatch(/請由其他同仁處理：疑似利益衝突/);
    const cf = (await staff.rpc('case_conflicts', { p_case: id })).data;
    expect(cf[ID.staff]).toMatch(/電話/);
  });

  it('不受理：要填說明；案件結案並通知家屬', async () => {
    const id = await newCase(fam, { confirm: false });
    expect((await staff.rpc('reject_application', { p_case: id, p_note: ' ' })).error?.message).toMatch(/請填寫說明/);
    expect((await staff.rpc('reject_application', { p_case: id, p_note: '無法確認申請人身分' })).error).toBeNull();
    expect(await caseRow(id)).toMatchObject({ link_status: '已拒絕', closed_type: '不受理', closed_text: '無法確認申請人身分' });
    expect(await notices(id)).toContain('機構已回覆您的入住申請，請登入查看');
  });
});

describe('案件分配（assign_nurse）', () => {
  let id;
  beforeAll(async () => { id = await newCase(fam); });

  it('沒有分配權限的護理師、行政都不能分配（直接呼叫 RPC 也一樣）', async () => {
    expect((await nurse2.rpc('assign_nurse', { p_case: id, p_nurse: ID.nurse2, p_prev: null, p_reason: '' })).error?.message).toMatch(/沒有案件分配權限/);
    expect((await staff.rpc('assign_nurse', { p_case: id, p_nurse: ID.nurse2, p_prev: null, p_reason: '' })).error?.message).toMatch(/沒有案件分配權限/);
  });
  it('只能分配給啟用中的護理人員', async () => {
    expect((await nurse.rpc('assign_nurse', { p_case: id, p_nurse: ID.staff, p_prev: null, p_reason: '' })).error?.message).toMatch(/不是啟用中的護理人員/);
  });
  it('指定 → 案件承辦護理師同步；別人已改過（畫面看到的舊承辦人）會擋下；更換要原因，保留歷程', async () => {
    expect((await nurse.rpc('assign_nurse', { p_case: id, p_nurse: ID.nurse2, p_prev: null, p_reason: '' })).error).toBeNull();
    expect((await caseRow(id)).nurse_id).toBe(ID.nurse2);
    expect((await nurse.rpc('assign_nurse', { p_case: id, p_nurse: ID.nurse, p_prev: null, p_reason: 'x' })).error?.message).toMatch(/已被其他人更改/);
    expect((await nurse.rpc('assign_nurse', { p_case: id, p_nurse: ID.nurse, p_prev: ID.nurse2, p_reason: '' })).error?.message).toMatch(/請填寫更換原因/);
    expect((await nurse.rpc('assign_nurse', { p_case: id, p_nurse: ID.nurse, p_prev: ID.nurse2, p_reason: '吳護理師休假' })).error).toBeNull();
    const { data: h } = await service().from('case_assignments').select('nurse_id, from_nurse_id, reason').eq('case_id', id).order('id');
    expect(h).toEqual([{ nurse_id: ID.nurse2, from_nurse_id: null, reason: null }, { nurse_id: ID.nurse, from_nurse_id: ID.nurse2, reason: '吳護理師休假' }]);
  });
  it('尚未確認的申請不能分配', async () => {
    const id2 = await newCase(fam, { confirm: false });
    expect((await nurse.rpc('assign_nurse', { p_case: id2, p_nurse: ID.nurse2, p_prev: null, p_reason: '' })).error?.message).toMatch(/目前不能分配/);
  });
});

describe('代理權核實（verify_proxy）', () => {
  it('證明文件未收件核對不能確認；可以標示無法核實；收件核對完成後確認，授權生效', async () => {
    const id = await newCase(fam, { consent: '監護人' });
    expect((await staff.rpc('verify_proxy', { p_case: id, p_ok: true, p_note: '' })).error?.message).toMatch(/核實說明/);
    expect((await staff.rpc('verify_proxy', { p_case: id, p_ok: true, p_note: '已核對裁定書' })).error?.message).toMatch(/先完成證明文件收件核對/);
    expect((await staff.rpc('verify_proxy', { p_case: id, p_ok: false, p_note: '裁定書不清楚' })).error).toBeNull();
    expect((await service().from('consents').select('state').eq('case_id', id).single()).data.state).toBe('代理權未通過');
    /* 重新簽署 → 模擬證明文件已完成收件核對（收件功能在階段 6） → 確認 */
    await fam.db.rpc('sign_consent', { p_case: id, p_signer: '監護人', p_signer_name: '王測試', p_agree: true, p_photo: false, p_emergency: false });
    const { data: k } = await service().from('consents').select('proof_document_id').eq('case_id', id).eq('ver', 2).single();
    await service().from('document_versions').insert({ document_id: k.proof_document_id, v: 1, uploaded_by: fam.id, phase: 'checked', admin_ok: true, id_checked_by: ID.staff, id_checked_at: new Date().toISOString() });
    expect((await staff.rpc('verify_proxy', { p_case: id, p_ok: true, p_note: '已核對監護宣告裁定書正本' })).error).toBeNull();
    expect((await service().from('consents').select('state, verify_note').eq('case_id', id).eq('ver', 2).single()).data).toEqual({ state: '有效', verify_note: '已核對監護宣告裁定書正本' });
    expect((await staff.rpc('verify_proxy', { p_case: id, p_ok: true, p_note: 'x' })).error?.message).toMatch(/同意狀態已變更/);
  });
});

describe('記錄簽約、結案、協調', () => {
  it('先審後簽：評估收治前不能記錄簽約；收治後可以，並通知入住前文件；不能重複記錄', async () => {
    const id = await newCase(fam);
    expect((await staff.rpc('record_signing', { p_case: id, p_later: [] })).error?.message).toMatch(/評估「收治」後才能記錄/);
    await addAssessment(id, '收治', ID.nurse);
    const { data: docs } = await service().from('documents').select('id, key').eq('case_id', id).in('key', ['exam', 'xray', 'summary']);
    const r = await staff.rpc('record_signing', { p_case: id, p_later: docs.map(d => d.id) });
    expect(r.error).toBeNull();
    expect((await caseRow(id)).pre_due).toBe(r.data);
    /* 只接受入住前階段的文件（評估前的 summary 不會列進通知） */
    expect((await notices(id)).pop()).toMatch(/^簽約完成。請在 \d+\/\d+ 前上傳入住前檢查：入住前健康檢查報告、胸部 X 光報告。$/);
    expect((await staff.rpc('record_signing', { p_case: id, p_later: [] })).error?.message).toMatch(/已經記錄過簽約/);
  });
  it('先簽後審：授權有效就能記錄簽約', async () => {
    const id = await newCase(fam, { flow: '先簽後審' });
    expect((await staff.rpc('record_signing', { p_case: id, p_later: [] })).error).toBeNull();
  });
  it('授權尚未有效不能記錄簽約', async () => {
    const id = await newCase(fam, { consent: null, flow: '先簽後審' });
    expect((await staff.rpc('record_signing', { p_case: id, p_later: [] })).error?.message).toMatch(/資料授權無效/);
  });
  it('結案：要選原因與說明；轉介的說明文字；不能重複結案', async () => {
    const id = await newCase(fam);
    expect((await staff.rpc('close_case', { p_case: id, p_type: '亂寫', p_note: 'x' })).error?.message).toMatch(/結案原因/);
    expect((await staff.rpc('close_case', { p_case: id, p_type: '轉介其他機構', p_note: '轉介至鄰近機構' })).error).toBeNull();
    expect(await caseRow(id)).toMatchObject({ closed_title: '已協助轉介其他機構', closed_type: '轉介', closed_reason: '轉介其他機構：轉介至鄰近機構' });
    expect((await staff.rpc('close_case', { p_case: id, p_type: '取消入住', p_note: 'x' })).error?.message).toMatch(/已經結案/);
  });
  it('協調：不是待協調時擋下；交回重評、延期、協調完成、取消', async () => {
    const id = await newCase(fam);
    const co = (r, extra = {}) => staff.rpc('coordinate', { p_case: id, p_result: r, p_note: '家屬同意', p_date: null, p_close_type: null, p_expired: [], ...extra });
    expect((await co('重評')).error?.message).toMatch(/不是待協調/);
    await addAssessment(id, '待協調', ID.nurse);
    expect((await co('重評')).error).toBeNull();
    let { data: a } = await service().from('assessments').select('result, outcome').eq('case_id', id).order('id');
    expect(a).toEqual([{ result: '待協調', outcome: '重新評估' }]);
    await addAssessment(id, '待協調', ID.nurse);
    expect((await co('延期', { p_date: '2027-01-15' })).error).toBeNull();
    expect((await caseRow(id)).planned_admit).toBe('2027-01-15');
    await addAssessment(id, '待協調', ID.nurse);
    expect((await co('可入住')).error).toBeNull();
    ({ data: a } = await service().from('assessments').select('result, outcome, coord_from').eq('case_id', id).order('id'));
    expect(a.at(-1)).toEqual({ result: '收治', outcome: null, coord_from: '待協調' });
    expect((await notices(id)).pop()).toBe('好消息：協調完成，住民已通過評估，請來電預約參訪與簽約');
    await addAssessment(id, '不符合收治條件', ID.nurse);
    expect((await co('可入住')).error?.message).toMatch(/行政不能直接改為可入住/);
    expect((await co('取消', { p_close_type: '不符合收治條件，解除契約' })).error).toBeNull();
    expect(await caseRow(id)).toMatchObject({ closed_type: '不符合收治條件', closed_title: '經評估，本中心無法提供合適的照顧' });
  });
});

describe('參訪與保證金、預計入住日、文件需求判斷', () => {
  let id, docs;
  beforeAll(async () => {
    id = await newCase(fam);
    docs = Object.fromEntries((await service().from('documents').select('id, key').eq('case_id', id)).data.map(d => [d.key, d.id]));
  });
  it('參訪：已預約要有日期；保證金不適用時不能是待繳納；完成時間第一次標示完成時記錄', async () => {
    const save = extra => staff.rpc('save_visit', { p_case: id, p_needed: '需要', p_status: '已預約', p_date: '2026-12-10', p_time: '14:00', p_note: '', p_dep_app: '適用', p_dep_status: '待繳納', p_dep_note: '', ...extra });
    expect((await save({ p_date: null })).error?.message).toMatch(/預定日期/);
    expect((await save({ p_dep_app: '不適用' })).error?.message).toMatch(/保證金不適用/);
    expect((await save()).error).toBeNull();
    expect((await save({ p_status: '已完成' })).error).toBeNull();
    const v1 = (await service().from('case_visits').select('done_at').eq('case_id', id).single()).data.done_at;
    expect(v1).not.toBeNull();
    await save({ p_status: '已完成', p_note: '改備註' });
    expect((await service().from('case_visits').select('done_at').eq('case_id', id).single()).data.done_at).toBe(v1);
    /* 家屬看得到參訪預約，行政以外不能寫 */
    expect((await fam.db.rpc('save_visit', { p_case: id, p_needed: '需要', p_status: '未安排', p_date: null, p_time: null, p_note: '', p_dep_app: '未確認', p_dep_status: '未確認', p_dep_note: '' })).error?.message).toMatch(/只有行政/);
  });
  it('預計入住日：只通知畫面傳入、而且有效期限的本案文件', async () => {
    expect((await staff.rpc('update_admit', { p_case: id, p_date: '2027-02-01', p_expired: [docs.stool, docs.summary] })).error).toBeNull();
    const n = await notices(id);
    expect(n.filter(t => t.startsWith('入住日調整後'))).toEqual(['入住日調整後，「糞便檢驗報告」需要重新檢查，請做 1/18 以後的檢查。']);
  });
  it('行政判斷視情況繳交文件：要原因、沒變更擋下；管路等由護理判斷的文件行政不能改', async () => {
    expect((await staff.rpc('set_document_need', { p_doc: docs.relProof, p_met: true, p_note: '' })).error?.message).toMatch(/請填寫原因/);
    expect((await staff.rpc('set_document_need', { p_doc: docs.relProof, p_met: true, p_note: '簽約者為長子' })).error).toBeNull();
    expect((await staff.rpc('set_document_need', { p_doc: docs.relProof, p_met: true, p_note: '再一次' })).error?.message).toMatch(/判斷沒有變更/);
    expect((await staff.rpc('set_document_need', { p_doc: docs.tubeCare, p_met: true, p_note: 'x' })).error?.message).toMatch(/由負責護理師判斷/);
    expect((await staff.rpc('set_document_need', { p_doc: docs.idcopy, p_met: true, p_note: 'x' })).error?.message).toMatch(/不是「視情況繳交」/);
    const { data: h } = await service().from('document_need_changes').select('from_text, to_text, role').eq('document_id', docs.relProof);
    expect(h).toEqual([{ from_text: '視情況：尚未確認', to_text: '視情況：本案需要', role: 'staff' }]);
  });
  it('請護理重新判斷：要先有承辦護理師；不能重複送出', async () => {
    expect((await staff.rpc('ask_nurse_need', { p_doc: docs.tubeCare, p_note: '家屬提到有尿管' })).error?.message).toMatch(/尚未指派負責護理師/);
    await nurse.rpc('assign_nurse', { p_case: id, p_nurse: ID.nurse2, p_prev: null, p_reason: '' });
    expect((await staff.rpc('ask_nurse_need', { p_doc: docs.tubeCare, p_note: '家屬提到有尿管' })).error).toBeNull();
    expect((await staff.rpc('ask_nurse_need', { p_doc: docs.tubeCare, p_note: '再一次' })).error?.message).toMatch(/尚未回覆/);
  });
});
