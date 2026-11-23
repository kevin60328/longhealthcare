/* 階段 9：系統管理的 RPC 與 Edge Function（帳號、機構設定、延長保存與封存、寄送異常、測試資料），直接以各角色呼叫，不經過畫面。
 * 用暫時帳號（e2e-…@example.com）；機構設定改完會改回原值；測試資料會恢復 T-B（回到起始狀態）。
 * 前提：已 npm run db:push、npm run db:seed（標示測試環境）、npm run functions:deploy。 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { as, service, anon, URL as SB_URL, ANON } from './helpers.js';

const PW = 'Temp-pass-0001', PNG = readFileSync(new URL('../../reference/sample_docs/01_身分證影本_張秀英.png', import.meta.url));
let seq = 0;
const users = [];
async function tempUser(want, meta = {}){
  const email = `e2e-adm-${want}-${Date.now()}-${++seq}@example.com`;
  const { data, error } = await service().auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { name: '管理測試' + want + seq, phone: '0912000' + String(500 + seq), want }, ...meta });
  if (error) throw error;
  users.push(data.user.id);
  const db = createClient(SB_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  return { id: data.user.id, email, db, login: () => db.auth.signInWithPassword({ email, password: PW }) };
}
const prof = id => service().from('profiles').select('*').eq('id', id).single().then(r => r.data);
const fn = (db, name, body) => db.functions.invoke(name, { body }).then(async r => r.error ? { status: r.error.context?.status, error: await r.error.context.json().catch(() => ({})) } : r.data);

let admin, staff, nurse, ID = {};
beforeAll(async () => {
  [admin, staff, nurse] = await Promise.all([as('admin@example.com'), as('staff@example.com'), as('nurse@example.com')]);
  for (const p of (await service().from('profiles').select('id, email')).data) ID[p.email.split('@')[0]] = p.id;
}, 60000);
afterAll(async () => { for (const id of users) await service().from('profiles').update({ status: '停用' }).eq('id', id); });

describe('帳號管理', () => {
  it('員工註冊後待審核；只有管理員能核准；核准後角色＝申請的角色；第二次核准擋下；退回', async () => {
    const a = await tempUser('nurse'), b = await tempUser('care');
    expect(await prof(a.id)).toMatchObject({ status: '待審核', role: null, want: 'nurse' });
    expect((await staff.rpc('approve_account', { p_id: a.id })).error?.message).toMatch(/系統管理員/);
    expect((await admin.rpc('approve_account', { p_id: a.id })).error).toBeNull();
    expect(await prof(a.id)).toMatchObject({ status: '啟用', role: 'nurse' });
    expect((await admin.rpc('approve_account', { p_id: a.id })).error?.message).toMatch(/處理過/);
    expect((await admin.rpc('reject_account', { p_id: b.id })).error).toBeNull();
    expect((await prof(b.id)).status).toBe('已退回');
  });
  it('停用／啟用、變更角色、案件分配權限；不能修改自己', async () => {
    const a = await tempUser('staff');
    await admin.rpc('approve_account', { p_id: a.id });
    expect((await admin.rpc('set_account_status', { p_id: ID.admin, p_status: '停用' })).error?.message).toMatch(/自己/);
    expect((await admin.rpc('set_assign_permission', { p_id: a.id, p_on: true })).error?.message).toMatch(/護理人員/);
    expect((await admin.rpc('set_account_role', { p_id: a.id, p_role: 'nurse' })).data).toBe(0);
    expect((await admin.rpc('set_assign_permission', { p_id: a.id, p_on: true })).error).toBeNull();
    expect(await prof(a.id)).toMatchObject({ role: 'nurse', can_assign_nurse: true });
    expect((await admin.rpc('set_account_role', { p_id: a.id, p_role: 'staff' })).error).toBeNull();
    expect((await prof(a.id)).can_assign_nurse).toBe(false);      // 離開護理角色，分配權限一併取消
    expect((await admin.rpc('set_account_status', { p_id: a.id, p_status: '停用' })).error).toBeNull();
    /* 停用後：登入可以通過 Auth，但資料庫不認這個角色（auth_role 只認啟用中的帳號） */
    await a.login();
    expect((await a.db.from('cases').select('id')).data).toEqual([]);
    expect((await admin.rpc('set_account_status', { p_id: a.id, p_status: '啟用' })).error).toBeNull();
    expect((await prof(a.id)).status).toBe('啟用');
  });
  it('重設臨時密碼（Edge Function admin-users）：只有管理員；新密碼可以登入，首次登入要改密碼', async () => {
    const a = await tempUser('family');
    expect((await fn(staff, 'admin-users', { action: 'reset', user_id: a.id })).status).toBe(403);
    const r = await fn(admin, 'admin-users', { action: 'reset', user_id: a.id });
    expect(r.ok).toBe(true); expect(r.password).toMatch(/^Tmp[a-z]{6}\d{2}$/);
    const c = anon(); expect((await c.auth.signInWithPassword({ email: a.email, password: r.password })).error).toBeNull();
    expect((await prof(a.id)).must_change_password).toBe(true);
    expect((await service().from('audit_logs').select('action').eq('actor', ID.admin).order('id', { ascending: false }).limit(1).single()).data.action).toMatch(/重設密碼/);
  });
});

describe('機構設定', () => {
  it('只有管理員；版本號不符擋下；儲存後版本加一、合作醫院更新；改回原值', async () => {
    const o = (await service().from('org_settings').select('*').eq('id', 1).single()).data;
    const hs = (await service().from('partner_hospitals').select('name').eq('active', true).order('sort')).data.map(x => x.name);
    const args = { p_rev: o.rev, p_name: o.name, p_phone: o.phone, p_hours: o.hours, p_request_days: o.request_days, p_retention_days: o.retention_days, p_flow_mode: o.flow_mode, p_partners: hs };
    expect((await staff.rpc('update_org_settings', args)).error?.message).toMatch(/系統管理員/);
    expect((await admin.rpc('update_org_settings', { ...args, p_rev: o.rev - 1 })).error?.message).toMatch(/其他管理員/);
    expect((await admin.rpc('update_org_settings', { ...args, p_request_days: 0 })).error?.message).toMatch(/1～60/);
    const r = await admin.rpc('update_org_settings', { ...args, p_partners: [...hs, '測試新增醫院'] });
    expect(r.error).toBeNull(); expect(r.data).toBe(o.rev + 1);
    expect((await service().from('partner_hospitals').select('name').eq('active', true)).data.map(x => x.name)).toContain('測試新增醫院');
    expect((await admin.rpc('update_org_settings', { ...args, p_rev: o.rev + 1 })).error).toBeNull();
    expect((await service().from('partner_hospitals').select('name').eq('active', true).order('sort')).data.map(x => x.name)).toEqual(hs);
  });
});

describe('結案與封存', () => {
  let fam, C1, C2;
  beforeAll(async () => {
    fam = await tempUser('family'); await fam.login();
    const mk = async n => { const r = await fam.db.rpc('create_application', { p_token: 'tok9-' + Date.now() + n, p_name: '封存測試住民' + n, p_nid: 'X8' + String(Date.now() + n).slice(-8), p_birth: '1940-01-01', p_relation: '女兒', p_hospital: '', p_admit: '2026-12-30' }); if (r.error) throw r.error; return r.data.case_id; };
    [C1, C2] = [await mk(1), await mk(2)];
    for (const id of [C1, C2]){
      await staff.rpc('confirm_case', { p_case: id, p_called: true, p_chart: '', p_admit: '2026-12-30' });
      await fam.db.rpc('sign_consent', { p_case: id, p_signer: '本人', p_signer_name: '家屬', p_agree: true, p_photo: false, p_emergency: false });
    }
    /* C2 上傳一個檔案，之後封存時要被刪除 */
    const { data: d } = await service().from('documents').select('id').eq('case_id', C2).eq('key', 'idcopy').single();
    const path = `${C2}/idcopy/v1-${crypto.randomUUID()}.png`;
    await fam.db.storage.from('case-files').upload(path, PNG, { contentType: 'image/png' });
    await fam.db.rpc('submit_version', { p_doc: d.id, p_path: path, p_file_name: 'x.png', p_user_date: null });
    for (const id of [C1, C2]) await staff.rpc('close_case', { p_case: id, p_type: '家屬放棄或逾期未簽', p_note: '測試結案' });
  }, 90000);
  it('結案清單只有管理員能讀；延長保存中不能封存', async () => {
    expect((await staff.rpc('admin_archive_list')).error).not.toBeNull();
    expect((await admin.rpc('admin_archive_list')).data.some(x => x.id === C1)).toBe(true);
    expect((await admin.rpc('add_retention_hold', { p_case: C1, p_type: '爭議處理中', p_note: '', p_until: '2027-06-30' })).error).toBeNull();
    const r = await fn(admin, 'admin-archive', { case_id: C1 });
    expect(r).toMatchObject({ ok: false }); expect(r.reason).toMatch(/延長保存/);
  });
  it('封存（Edge Function admin-archive）：只有管理員；刪除 Storage 原始檔案、版本標示已刪除、案件已封存；不能再封存', async () => {
    expect((await fn(staff, 'admin-archive', { case_id: C2 })).status).toBe(403);
    const v = (await service().from('document_versions').select('storage_path, documents!inner(case_id)').eq('documents.case_id', C2).single()).data;
    const r = await fn(admin, 'admin-archive', { case_id: C2 });
    expect(r).toMatchObject({ ok: true, status: '保存處理完成', removed: 1, failed: 0 });
    expect((await service().storage.from('case-files').download(v.storage_path)).error).not.toBeNull();
    expect((await service().from('document_versions').select('file_removed, documents!inner(case_id)').eq('documents.case_id', C2).single()).data.file_removed).toBe(true);
    expect((await service().from('cases').select('archive_status, archived_by').eq('id', C2).single()).data).toEqual({ archive_status: '保存處理完成', archived_by: ID.admin });
    expect((await fn(admin, 'admin-archive', { case_id: C2 })).reason).toMatch(/已封存/);
  });
});

describe('寄送異常、測試資料、環境', () => {
  it('寄送異常清單只有管理員能讀', async () => {
    expect(Array.isArray((await admin.rpc('admin_mail_issues')).data)).toBe(true);
    expect((await staff.rpc('admin_mail_issues')).error).not.toBeNull();
  });
  it('測試資料（Edge Function admin-testdata）：只有管理員；狀態列出 T-A～T-D；恢復 T-B 起始狀態後仍是「評估中」', async () => {
    expect((await fn(staff, 'admin-testdata', { action: 'status' })).status).toBe(403);
    const s = await fn(admin, 'admin-testdata', { action: 'status' });
    expect(s.specs.map(x => x.no)).toEqual(['T-A', 'T-B', 'T-C', 'T-D']);
    const old = (await service().from('cases').select('id').eq('no', 'T-B').single()).data.id;
    const r = await fn(admin, 'admin-testdata', { action: 'seed', nos: ['T-B'] });
    expect(r.ok).toBe(true);
    const now = (await service().from('cases').select('id').eq('no', 'T-B').single()).data.id;
    expect(now).not.toBe(old);
    expect((await fn(admin, 'admin-testdata', { action: 'status' })).specs.find(x => x.no === 'T-B').phase).toBe('評估中');
  }, 120000);
  it('刪除測試案件只限 T-A～T-D、只限後端；其他案件的操作紀錄仍不能刪', async () => {
    expect((await service().rpc('reset_test_cases', { p_nos: ['C-0001'] })).error?.message).toMatch(/T-A～T-D/);
    expect((await admin.rpc('reset_test_cases', { p_nos: ['T-A'] })).error).not.toBeNull();
    expect((await service().from('audit_logs').delete().eq('action', '確認申請並轉交護理部門（待護理分配）')).error?.message).toMatch(/只能新增/);
    expect((await admin.from('system_env').select('is_test').single()).data.is_test).toBe(true);
  });
});
