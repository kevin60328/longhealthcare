/* 階段 6：文件與補件的資料庫寫入（RPC）、Storage 權限、補件 Email（Edge Function send-mail）、OCR 權限。
 * 直接以各角色登入呼叫資料庫與 Edge Function，不經過畫面（HANDOFF 14：只測畫面不算數）。
 * 每個測試檔用暫時家屬（e2e-…@example.com）提出新申請；測試全部跑完後由 tests/vitest-cleanup.js 清除（含上傳的檔案）。
 * 前提：已 npm run db:push、npm run functions:deploy。
 * AI 辨識實際呼叫 Claude 會產生費用：只在環境變數 RUN_OCR_LIVE=1 時才跑那一個測試。 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { as, service, URL as SB_URL, ANON } from './helpers.js';
import { assembleModel, todayTW } from '../../js/modules/services/model-build.js';
import { createRules } from '../../js/modules/rules/core.js';

const PW = 'Temp-pass-0001';
const PNG = readFileSync(new URL('../../reference/sample_docs/01_身分證影本_張秀英.png', import.meta.url));
const EXAM = readFileSync(new URL('../../reference/sample_docs/08_體檢報告_張秀英.png', import.meta.url));
let seq = 0;
const newNid = () => 'X1' + String(Date.now() * 10 + (++seq)).slice(-8);
const made = [], users = [];

async function tempUser(role){
  const svc = service(), email = `e2e-doc-${role}-${Date.now()}-${++seq}@example.com`;
  const { data, error } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { name: '文件測試' + role + seq, phone: '0912000' + String(100 + seq).slice(-3), want: 'family' }, app_metadata: { role } });
  if (error) throw error;
  users.push(data.user.id);
  const c = createClient(SB_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const r = await c.auth.signInWithPassword({ email, password: PW }); if (r.error) throw r.error;
  return { db: c, id: data.user.id, email };
}
async function newCase(fam){
  const { data, error } = await fam.db.rpc('create_application', { p_token: 'tok6-' + Date.now() + '-' + (++seq), p_name: '文件測試住民', p_nid: newNid(), p_birth: '1942-03-15', p_relation: '兒子', p_hospital: '仁心醫院', p_admit: '2026-12-30' });
  if (error) throw error;
  made.push(data.case_id);
  let r = await staff.rpc('confirm_case', { p_case: data.case_id, p_called: true, p_chart: '', p_admit: '2026-12-30' }); if (r.error) throw r.error;
  r = await fam.db.rpc('sign_consent', { p_case: data.case_id, p_signer: '本人', p_signer_name: '王測試', p_agree: true, p_photo: false, p_emergency: false }); if (r.error) throw r.error;
  return data.case_id;
}
const docsOf = async id => Object.fromEntries((await service().from('documents').select('id, key, name').eq('case_id', id)).data.map(d => [d.key, d.id]));
const status = id => service().rpc('doc_status', { p_doc: id }).then(r => r.data);
const reqs = id => service().from('document_requests').select('*').eq('document_id', id).order('created_at').then(r => r.data);
const job = id => service().from('mail_jobs').select('*').eq('id', id).maybeSingle().then(r => r.data);
const attempts = id => service().from('mail_attempts').select('result, error').eq('job_id', id).order('id').then(r => r.data);
const notices = id => service().from('notices').select('text').eq('case_id', id).order('at').then(r => r.data.map(x => x.text));
const logs = id => service().from('audit_logs').select('action').eq('case_id', id).order('id').then(r => r.data.map(x => x.action));
/* 上傳檔案到 Storage（不建立版本）；回傳位置與錯誤 */
async function put(db, caseId, key, v, buf = PNG, type = 'image/png'){
  const path = `${caseId}/${key}/v${v}-${crypto.randomUUID()}.png`;
  const { error } = await db.storage.from('case-files').upload(path, buf, { contentType: type, upsert: false });
  return { path, error };
}
/* 家屬上傳＋建立版本 */
async function submit(fam, caseId, key, docId, v, userDate = null, buf = PNG){
  const u = await put(fam.db, caseId, key, v, buf); if (u.error) throw u.error;
  const r = await fam.db.rpc('submit_version', { p_doc: docId, p_path: u.path, p_file_name: key + '.png', p_user_date: userDate });
  if (r.error) throw r.error;
  return u.path;
}
const mail = async (db, body) => { const r = await db.functions.invoke('send-mail', { body }); return r.error ? { error: r.error } : r.data; };

let staff, nurse, nurse2, fam, fam2, A, D, ID = {};
beforeAll(async () => {
  [staff, nurse, nurse2] = await Promise.all([as('staff@example.com'), as('nurse@example.com'), as('nurse2@example.com')]);
  for (const p of (await service().from('profiles').select('id, email')).data) ID[p.email.split('@')[0]] = p.id;
  [fam, fam2] = await Promise.all([tempUser('family'), tempUser('family')]);
  A = await newCase(fam);
  D = await docsOf(A);
  /* 指派承辦護理師（分配紀錄；觸發器同步 cases.nurse_id） */
  const r = await service().from('case_assignments').insert({ case_id: A, nurse_id: ID.nurse, by: ID.staff, at: new Date().toISOString() }); if (r.error) throw r.error;
}, 60000);
afterAll(async () => {
  const svc = service();
  for (const id of made) await svc.from('cases').update({ closed_at: new Date().toISOString(), closed_title: '測試結束', closed_reason: '自動測試建立的案件' }).eq('id', id).is('closed_at', null);
  for (const id of users) await svc.from('profiles').update({ status: '停用' }).eq('id', id);
});

describe('上傳新版本（submit_version）與 Storage 權限', () => {
  it('家屬上傳自己案件的文件：建立第 1 版、待收件；重複上傳擋下；操作紀錄', async () => {
    await submit(fam, A, 'idcopy', D.idcopy, 1);
    expect(await status(D.idcopy)).toBe('待收件');
    const v = (await service().from('document_versions').select('*').eq('document_id', D.idcopy).single()).data;
    expect(v).toMatchObject({ v: 1, phase: 'received', mime: 'image/png', file_size: PNG.length, uploaded_by: fam.id });
    const u = await put(fam.db, A, 'idcopy', 2);
    expect((await fam.db.rpc('submit_version', { p_doc: D.idcopy, p_path: u.path, p_file_name: 'x.png', p_user_date: null })).error?.message).toMatch(/正在確認中/);
    expect(await logs(A)).toContain('上傳 住民身分證明文件（第 1 版）');
  });
  it('檔案位置和版本不符、沒有上傳檔案：擋下', async () => {
    const u = await put(fam.db, A, 'nhi', 9);
    expect(u.error).toBeNull();
    expect((await fam.db.rpc('submit_version', { p_doc: D.nhi, p_path: u.path, p_file_name: 'x.png', p_user_date: null })).error?.message).toMatch(/版本不符/);
    expect((await fam.db.rpc('submit_version', { p_doc: D.nhi, p_path: `${A}/nhi/v1-${crypto.randomUUID()}.png`, p_file_name: 'x.png', p_user_date: null })).error?.message).toMatch(/找不到上傳的檔案/);
  });
  it('別的家屬：不能上傳到這個案件、也不能讀檔案；機構文件家屬不能上傳；檔名格式不對擋下', async () => {
    expect((await put(fam2.db, A, 'meds', 1)).error).not.toBeNull();
    const path = (await service().from('document_versions').select('storage_path').eq('document_id', D.idcopy).single()).data.storage_path;
    expect((await fam2.db.storage.from('case-files').download(path)).error).not.toBeNull();
    expect((await fam.db.storage.from('case-files').download(path)).error).toBeNull();
    expect((await put(fam.db, A, 'fee', 1)).error).not.toBeNull();
    expect((await fam.db.storage.from('case-files').upload(`${A}/meds/hello.png`, PNG, { contentType: 'image/png' })).error).not.toBeNull();
  });
  it('護理：只能讀承辦案件的 B、C、D 類檔案；行政讀醫療類檔案前要先開啟（記錄一次）', async () => {
    const examPath = await submit(fam, A, 'exam', D.exam, 1, '2026-11-10', EXAM);
    const idPath = (await service().from('document_versions').select('storage_path').eq('document_id', D.idcopy).single()).data.storage_path;
    expect((await nurse.storage.from('case-files').download(idPath)).error).not.toBeNull();
    expect((await nurse.storage.from('case-files').download(examPath)).error).toBeNull();
    expect((await nurse2.storage.from('case-files').download(examPath)).error).not.toBeNull();
    /* 行政：身分文件直接可讀；體檢報告（B 類）要先 open_document_file */
    expect((await staff.storage.from('case-files').download(idPath)).error).toBeNull();
    expect((await staff.storage.from('case-files').download(examPath)).error).not.toBeNull();
    const o = await staff.rpc('open_document_file', { p_doc: D.exam, p_v: 1 });
    expect(o.error).toBeNull(); expect(o.data.path).toBe(examPath);
    expect((await staff.storage.from('case-files').download(examPath)).error).toBeNull();
    await staff.rpc('open_document_file', { p_doc: D.exam, p_v: 1 });
    expect((await logs(A)).filter(x => x.startsWith('行政查看醫療文件：入住前健康檢查報告（第 1 版'))).toHaveLength(1);
    expect((await nurse2.rpc('open_document_file', { p_doc: D.exam, p_v: 1 })).error?.message).toMatch(/沒有權限/);
  });
});

describe('收件核對、身分待確認、確認日期', () => {
  it('收件核對：只有行政；非醫療文件核對後完成；第二次擋下', async () => {
    expect((await nurse.rpc('staff_receipt', { p_doc: D.idcopy, p_v: 1, p_how: '必要欄位全部相符', p_detail: {} })).error?.message).toMatch(/只有行政/);
    expect((await staff.rpc('staff_receipt', { p_doc: D.idcopy, p_v: 2, p_how: '必要欄位全部相符', p_detail: {} })).error?.message).toMatch(/新版本/);
    const r = await staff.rpc('staff_receipt', { p_doc: D.idcopy, p_v: 1, p_how: '必要欄位全部相符', p_detail: { level: '相符', rows: { name: { result: '相符' } } } });
    expect(r.error).toBeNull(); expect(r.data.status).toBe('確認符合');
    const v = (await service().from('document_versions').select('*').eq('document_id', D.idcopy).single()).data;
    expect(v).toMatchObject({ phase: 'checked', admin_ok: true, id_checked_by: ID.staff, id_check_how: '必要欄位全部相符' });
    expect(v.id_check_detail.level).toBe('相符');
    expect((await staff.rpc('staff_receipt', { p_doc: D.idcopy, p_v: 1, p_how: 'x', p_detail: {} })).error?.message).toMatch(/已經被核對過/);
  });
  it('身分待確認：要填說明；標示後狀態「身分待確認」，之後仍可收件核對', async () => {
    await submit(fam, A, 'nhi', D.nhi, 1);
    expect((await staff.rpc('mark_id_pending', { p_doc: D.nhi, p_v: 1, p_note: ' ' })).error?.message).toMatch(/說明/);
    expect((await staff.rpc('mark_id_pending', { p_doc: D.nhi, p_v: 1, p_note: '姓名與登記不同' })).error).toBeNull();
    expect(await status(D.nhi)).toBe('身分待確認');
    expect((await service().from('document_versions').select('id_note').eq('document_id', D.nhi).single()).data.id_note).toBe('姓名與登記不同');
  });
  it('醫療效期文件：收件後待確認日期；日期晚於今天擋下；確認過期 → 系統補件、通知家屬；家屬可重新上傳', async () => {
    expect((await staff.rpc('staff_receipt', { p_doc: D.exam, p_v: 1, p_how: '人工例外核對', p_detail: {} })).data.status).toBe('初步符合');
    expect((await staff.rpc('confirm_doc_date', { p_doc: D.exam, p_v: 1, p_date: '2099-01-01' })).error?.message).toMatch(/晚於今天/);
    const r = await staff.rpc('confirm_doc_date', { p_doc: D.exam, p_v: 1, p_date: '2026-09-01' });
    expect(r.error).toBeNull(); expect(r.data.status).toBe('確認過期'); expect(r.data.requests).toHaveLength(1);
    const q = await reqs(D.exam);
    expect(q).toHaveLength(1); expect(q[0]).toMatchObject({ source: '系統', reason: '日期超過期限', closed_at: null });
    expect((await notices(A)).some(t => /^「入住前健康檢查報告」日期已超過期限，請做 10\/1 以後的檢查，並在 \d+\/\d+ 前重新上傳。$/.test(t))).toBe(true);
    await submit(fam, A, 'exam', D.exam, 2, '2026-11-15', EXAM);
    expect((await reqs(D.exam))[0].uploaded_at).not.toBeNull();
    expect((await reqs(D.exam))[0].closed_at).toBeNull();   // 補傳不等於完成
  });
  it('糞便檢驗（14 天）：家屬沒填日期 → 疑似過期；行政確認的日期在期限前 → 確認過期（家屬尚未重新上傳）', async () => {
    await submit(fam, A, 'stool', D.stool, 1);
    expect((await staff.rpc('staff_receipt', { p_doc: D.stool, p_v: 1, p_how: '人工例外核對', p_detail: {} })).data.status).toBe('疑似過期');
    expect((await staff.rpc('confirm_doc_date', { p_doc: D.stool, p_v: 1, p_date: '2026-11-01' })).data.status).toBe('確認過期');
  });
});

describe('要求補件、一般提醒、補件關閉', () => {
  it('管路照護（護理判斷）尚未確認需要：不能要求；非行政不能要求；沒選文件擋下', async () => {
    expect((await staff.rpc('request_documents', { p_case: A, p_docs: [D.tubeCare], p_other: '', p_other_medical: false, p_reason: '影本不清楚', p_note: '' })).error?.message).toMatch(/負責護理師判斷.*沒有送出任何補件/);
    expect((await nurse.rpc('request_documents', { p_case: A, p_docs: [D.meds], p_other: '', p_other_medical: false, p_reason: '影本不清楚', p_note: '' })).error?.message).toMatch(/只有行政/);
    expect((await staff.rpc('request_documents', { p_case: A, p_docs: [], p_other: '', p_other_medical: false, p_reason: '影本不清楚', p_note: '' })).error?.message).toMatch(/至少選一份/);
  });
  it('要求補件：已上傳的文件退回（需補件）；清單外資料建立 G 類文件；選填改為必備；通知家屬', async () => {
    const r = await staff.rpc('request_documents', { p_case: A, p_docs: [D.idcopy, D.labs], p_other: '疫苗接種紀錄', p_other_medical: true, p_reason: '影本不清楚', p_note: '請拍清楚一點' });
    expect(r.error).toBeNull(); expect(r.data.requests).toHaveLength(3);
    expect(await status(D.idcopy)).toBe('需補件');
    const ret = (await service().from('document_returns').select('*').eq('document_id', D.idcopy)).data;
    expect(ret).toHaveLength(1); expect(ret[0]).toMatchObject({ version_v: 1, reason: '影本不清楚', note_for_family: '請拍清楚一點' });
    const labs = (await service().from('documents').select('need, cond_met').eq('id', D.labs).single()).data;
    expect(labs.need).toBe('必備');
    const g = (await service().from('documents').select('*').eq('case_id', A).eq('name', '疫苗接種紀錄').single()).data;
    expect(g).toMatchObject({ cat: 'G', need: '必備', medical: true, catalog_key: null, custom_why: '機構需要這份資料：請拍清楚一點', custom_where: '請洽機構承辦人' });
    expect(g.key).toMatch(/^extra_[a-z0-9]+$/);
    expect((await notices(A)).slice(-1)[0]).toMatch(/^請在 \d+\/\d+ 前補件：住民身分證明文件、近期檢驗及影像報告、疫苗接種紀錄$/);
  });
  it('同一份文件再要求一次：舊補件被取代（不是結案），同時只有一筆開啟中', async () => {
    await staff.rpc('request_documents', { p_case: A, p_docs: [D.labs], p_other: '', p_other_medical: false, p_reason: '文件不完整或缺頁', p_note: '' });
    const q = await reqs(D.labs);
    expect(q).toHaveLength(2);
    expect(q[0].superseded_by).toBe(q[1].id); expect(q[0].closed_at).toBeNull();
    expect(q[1].superseded_by).toBeNull();
  });
  it('一般提醒：只記次數與期限，不建立補件；家屬已上傳時擋下', async () => {
    const before = (await reqs(D.meds)).length;
    expect((await staff.rpc('remind_document', { p_doc: D.meds })).error).toBeNull();
    expect((await staff.rpc('remind_document', { p_doc: D.meds })).error).toBeNull();
    expect((await service().from('document_reminders').select('id').eq('document_id', D.meds)).data).toHaveLength(2);
    expect((await reqs(D.meds)).length).toBe(before);
    expect((await notices(A)).slice(-1)[0]).toMatch(/^提醒：請在 \d+\/\d+ 前上傳「目前用藥清單或處方資料」。有困難請來電/);
    expect((await staff.rpc('remind_document', { p_doc: D.nhi })).error?.message).toMatch(/不需要再提醒/);
  });
  it('補傳後確認符合：補件自動關閉（關閉者、原因）', async () => {
    await submit(fam, A, 'idcopy', D.idcopy, 2);
    expect((await staff.rpc('staff_receipt', { p_doc: D.idcopy, p_v: 2, p_how: '必要欄位全部相符', p_detail: {} })).data.status).toBe('確認符合');
    const q = (await reqs(D.idcopy)).slice(-1)[0];
    expect(q.closed_at).not.toBeNull(); expect(q).toMatchObject({ closed_by: ID.staff, closed_reason: '文件已確認符合' });
  });
  it('家屬先上傳的選填文件被要求補件：需補件，等家屬重新上傳', async () => {
    await submit(fam, A, 'rehab', D.rehab, 1);
    expect((await staff.rpc('request_documents', { p_case: A, p_docs: [D.rehab], p_other: '', p_other_medical: false, p_reason: '文件不完整或缺頁', p_note: '' })).error).toBeNull();
    expect(await status(D.rehab)).toBe('需補件');
  });
});

describe('其他寫入：沿用檔案、機構文件、新增個案文件', () => {
  it('X 光沿用已上傳的體檢報告（同一個檔案、記錄來源版本）；不能沿用的文件擋下', async () => {
    const r = await fam.db.rpc('reuse_file', { p_doc: D.xray, p_from: D.exam });
    expect(r.error).toBeNull(); expect(r.data).toBe(1);
    const [x, e] = await Promise.all([service().from('document_versions').select('*').eq('document_id', D.xray).single(), service().from('document_versions').select('*').eq('document_id', D.exam).eq('v', 2).single()]);
    expect(x.data).toMatchObject({ storage_path: e.data.storage_path, from_document_id: D.exam, from_version: 2, phase: 'received' });
    expect((await fam.db.rpc('reuse_file', { p_doc: D.meds, p_from: D.exam })).error?.message).toMatch(/不能沿用/);
  });
  it('機構文件：只有行政可上傳；上傳後直接完成（不需身分核對）；家屬可讀', async () => {
    const u = await put(staff, A, 'fee', 1);
    expect(u.error).toBeNull();
    expect((await put(staff, A, 'meds', 1)).error).not.toBeNull();
    const r = await staff.rpc('submit_inst_version', { p_doc: D.fee, p_path: u.path, p_file_name: 'fee.png', p_note: '收費明細' });
    expect(r.error).toBeNull(); expect(r.data.status).toBe('確認符合');
    expect((await fam.db.storage.from('case-files').download(u.path)).error).toBeNull();
  });
  it('新增個案指定文件：要填名稱與原因；同名擋下；需要繳交時通知家屬', async () => {
    const args = { p_case: A, p_name: '疫苗卡', p_cat: 'C', p_need: '必備', p_medical: true, p_stage: '評估前', p_why: '確認疫苗接種情形', p_where: '' };
    expect((await staff.rpc('add_case_document', { ...args, p_why: '' })).error?.message).toMatch(/為什麼需要/);
    const r = await staff.rpc('add_case_document', args);
    expect(r.error).toBeNull();
    expect((await service().from('documents').select('cat, custom_where, key').eq('id', r.data).single()).data).toMatchObject({ cat: 'C', custom_where: '請洽機構承辦人' });
    expect((await staff.rpc('add_case_document', args)).error?.message).toMatch(/同名/);
    expect((await notices(A)).slice(-1)[0]).toBe('機構請您補充「疫苗卡」：確認疫苗接種情形');
  });
});

describe('補件 Email（send-mail：模擬寄送、冪等、建立失敗、同時重試、結案後不寄）', () => {
  it('家屬、非承辦護理不能呼叫', async () => {
    expect((await mail(fam.db, { case_id: A, mode: 'sync' })).error).toBeTruthy();
    expect((await mail(nurse2, { case_id: A, mode: 'sync' })).error).toBeTruthy();
  });
  it('補件存在但通知工作不存在：模型顯示待建立；「建立並寄送」只建立通知，不新增補件', async () => {
    const q = (await reqs(D.meds)).length ? null : await staff.rpc('request_documents', { p_case: A, p_docs: [D.meds], p_other: '', p_other_medical: false, p_reason: '需要補充其他文件', p_note: '' });
    const rq = (await reqs(D.meds)).slice(-1)[0];
    expect(await job('req_' + rq.id)).toBeNull();
    const before = (await reqs(D.meds)).length;
    const r = await mail(staff, { case_id: A, mode: 'create', request_id: rq.id });
    expect(r.results[0]).toMatchObject({ ok: true });
    expect((await job('req_' + rq.id)).status).toBe('模擬已寄送（測試環境未實際寄出）');
    expect(await attempts('req_' + rq.id)).toEqual([{ result: '模擬已寄送（測試環境未實際寄出）', error: null }]);
    expect((await reqs(D.meds)).length).toBe(before);
    /* 已寄出：再按一次不重複寄 */
    expect((await mail(staff, { case_id: A, mode: 'retry', job_id: 'req_' + rq.id })).error).toBeFalsy();
    expect(await attempts('req_' + rq.id)).toHaveLength(1);
    expect(q === null || !q.error).toBe(true);
  });
  it('sync：補齊所有開啟中補件的通知；再執行一次不會重複寄', async () => {
    const r1 = await mail(staff, { case_id: A, mode: 'sync' });
    expect(r1.results.length).toBeGreaterThan(0);
    expect(r1.results.every(x => x.ok)).toBe(true);
    const r2 = await mail(staff, { case_id: A, mode: 'sync' });
    expect(r2.results).toHaveLength(0);
  });
  it('寄送失敗 → 重試成功；寄送紀錄兩筆', async () => {
    const r = await staff.rpc('request_documents', { p_case: A, p_docs: [D.summary], p_other: '', p_other_medical: false, p_reason: '需要補充其他文件', p_note: '' });
    const id = 'req_' + r.data.requests[0];
    const f = await mail(staff, { case_id: A, mode: 'create', request_id: r.data.requests[0], simulate_failure: true });
    expect(f.results[0]).toMatchObject({ ok: false, reason: '模擬寄送失敗（郵件服務無回應）' });
    expect((await job(id)).status).toBe('寄送失敗');
    expect((await mail(staff, { case_id: A, mode: 'retry', job_id: id })).results[0].ok).toBe(true);
    expect((await attempts(id)).map(a => a.result)).toEqual(['寄送失敗', '模擬已寄送（測試環境未實際寄出）']);
  });
  it('兩個人同時重試：只有一個人寄出', async () => {
    const r = await staff.rpc('request_documents', { p_case: A, p_docs: [D.diag], p_other: '', p_other_medical: false, p_reason: '需要補充其他文件', p_note: '' });
    const id = 'req_' + r.data.requests[0];
    await service().rpc('ensure_req_mail', { p_request: r.data.requests[0] });
    const [a, b] = await Promise.all([mail(staff, { case_id: A, mode: 'retry', job_id: id }), mail(nurse, { case_id: A, mode: 'retry', job_id: id })]);
    const res = [a.results[0], b.results[0]];
    expect(res.filter(x => x.ok)).toHaveLength(1);
    expect(res.find(x => !x.ok).reason).toMatch(/正在寄送|已寄送過/);
    expect((await attempts(id)).filter(x => x.result.startsWith('模擬已寄送'))).toHaveLength(1);
  });
  it('認領後沒有回寫（逾時）：2 分鐘內不能重新認領；逾時後可以，並記錄「結果不明」', async () => {
    const r = await staff.rpc('request_documents', { p_case: A, p_docs: [D.followup], p_other: '', p_other_medical: false, p_reason: '需要補充其他文件', p_note: '' });
    const id = 'req_' + r.data.requests[0];
    await service().rpc('ensure_req_mail', { p_request: r.data.requests[0] });
    const c = await service().rpc('claim_mail_job', { p_job: id, p_by: ID.staff, p_send_key: 'lost' });
    expect(c.data.status).toBe('寄送中');
    expect((await mail(staff, { case_id: A, mode: 'retry', job_id: id })).results[0].reason).toMatch(/正在寄送/);
    await service().from('mail_jobs').update({ claim_at: new Date(Date.now() - 3 * 60000).toISOString() }).eq('id', id);
    expect((await mail(staff, { case_id: A, mode: 'retry', job_id: id })).results[0].ok).toBe(true);
    expect((await attempts(id)).map(a => a.result)).toEqual(['前一次寄送沒有回寫結果（逾時），結果不明，重新認領', '模擬已寄送（測試環境未實際寄出）']);
    /* 舊的 send_key 不能再寫入結果 */
    expect((await service().rpc('finish_mail_job', { p_job: id, p_send_key: 'lost', p_by: ID.staff, p_ok: false, p_error: 'x' })).data).toBe(false);
  });
  it('補件已結案、已被新補件取代：不再寄送，狀態與紀錄不變', async () => {
    /* 被取代：近期檢驗報告第一筆補件（前面的測試已提出第二筆） */
    const old = (await reqs(D.labs))[0];
    await service().rpc('ensure_req_mail', { p_request: old.id });
    await service().from('mail_jobs').update({ status: '寄送失敗' }).eq('id', 'req_' + old.id);
    const r1 = await mail(staff, { case_id: A, mode: 'retry', job_id: 'req_' + old.id });
    expect(r1.results[0]).toMatchObject({ ok: false, closed: true, reason: '已有下一次補件，這筆舊通知不再寄送' });
    expect(await attempts('req_' + old.id)).toHaveLength(0);
    /* 已結案：身分證明文件的補件（確認符合後已關閉） */
    const closed = (await reqs(D.idcopy)).slice(-1)[0];
    await service().rpc('ensure_req_mail', { p_request: closed.id });
    await service().from('mail_jobs').update({ status: '寄送失敗' }).eq('id', 'req_' + closed.id);
    const r2 = await mail(staff, { case_id: A, mode: 'retry', job_id: 'req_' + closed.id });
    expect(r2.results[0]).toMatchObject({ ok: false, closed: true, reason: '補件已結案，不再寄送' });
    expect((await job('req_' + closed.id)).status).toBe('寄送失敗');
  });
});

describe('AI 辨識（Edge Function ocr）', () => {
  it('家屬、護理不能呼叫；文件不在辨識步驟時不執行', async () => {
    const body = { document_id: D.exam, v: 2, mode: 'date' };
    expect((await fam.db.functions.invoke('ocr', { body })).error).toBeTruthy();
    expect((await nurse.functions.invoke('ocr', { body })).error).toBeTruthy();
    const r = await staff.functions.invoke('ocr', { body: { document_id: D.idcopy, v: 2, mode: 'date' } });
    expect(r.data).toMatchObject({ ok: false, reason: '這份文件目前不在可辨識的步驟' });
  });
  it.runIf(process.env.RUN_OCR_LIVE === '1')('實際呼叫 Claude：讀取體檢報告的檢查日期，寫入初步日期與辨識紀錄', async () => {
    await staff.rpc('staff_receipt', { p_doc: D.exam, p_v: 2, p_how: '人工例外核對', p_detail: {} });
    const r = await staff.functions.invoke('ocr', { body: { document_id: D.exam, v: 2, mode: 'date' } });
    expect(r.error).toBeNull();
    console.log('OCR 結果：', JSON.stringify(r.data));
    expect(r.data.ok).toBe(true);
    expect(r.data.result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const v = (await service().from('document_versions').select('date_prelim').eq('document_id', D.exam).eq('v', 2).single()).data;
    expect(v.date_prelim).toBe(r.data.result.date);
    expect((await service().from('ocr_runs').select('status, mode, run').eq('document_id', D.exam).eq('version_v', 2)).data).toEqual([{ status: '完成', mode: 'date', run: 1 }]);
  }, 120000);
});

describe('文件狀態：資料庫 doc_status 與 rules/core.js 的 status 相同', () => {
  it('所有進行中案件的每一份文件（含本測試建立的各種狀態）', async () => {
    const svc = service();
    const [models, profiles, org, catalog] = await Promise.all([
      svc.rpc('get_case_models', { p_case: null, p_include_closed: false }), svc.from('profiles').select('*'),
      svc.from('org_settings').select('*').eq('id', 1).maybeSingle(), svc.from('doc_catalog').select('key, why, "where", on_demand').order('sort')]);
    const { D: M } = assembleModel({ models: models.data, profiles: profiles.data, org: org.data, catalog: catalog.data, staff: [] }, null);
    const R = createRules(M, { me: null, today: todayTW() });
    const items = Object.values(M.items).filter(i => M.cases[i.caseId].linkStatus === '已確認');
    expect(items.length).toBeGreaterThan(50);
    const seen = new Set(), diff = [];
    for (let k = 0; k < items.length; k += 20){
      const part = items.slice(k, k + 20);
      const got = await Promise.all(part.map(i => status(i.dbId)));
      part.forEach((i, n) => { const want = R.status(i, M.cases[i.caseId]); seen.add(want); if (got[n] !== want) diff.push(`${M.cases[i.caseId].no} ${i.key}：資料庫 ${got[n]}，規則 ${want}`); });
    }
    expect(diff).toEqual([]);
    /* 確認比對涵蓋多種狀態 */
    for (const s of ['未上傳', '待收件', '身分待確認', '確認過期', '需補件', '確認符合', '待護理核對']) expect(seen, s).toContain(s);

    /* 補件事件（send-mail 用資料庫 req_event 判斷）：與 rules/core.js 的 mailReqEvent 相同；missing 對應「closed 且關閉紀錄待補寫」 */
    const pairs = items.flatMap(i => [i.req, ...(i.reqHistory || [])].filter(Boolean).map(q => ({ i, q })));
    expect(pairs.length).toBeGreaterThan(5);
    const evDiff = [], evSeen = new Set();
    for (const { i, q } of pairs){
      const c = M.cases[i.caseId], js = R.mailReqEvent({ reqTs: q.ts }, i, c);
      const want = js === 'closed' && i.req === q && R.reqCloseMissing(i, c) ? 'missing' : js;
      const got = (await service().rpc('req_event', { p_request: q.id })).data;
      evSeen.add(want);
      if (got !== want) evDiff.push(`${c.no} ${i.key}：資料庫 ${got}，規則 ${want}`);
    }
    expect(evDiff).toEqual([]);
    for (const s of ['open', 'closed', 'replaced']) expect(evSeen, s).toContain(s);
  }, 180000);
});
