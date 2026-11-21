/* 階段 1：資料隔離（HANDOFF 8.3）。以每種角色的 JWT 直接查詢，不經過畫面。 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { as, anon, service } from './helpers.js';

const nos = async (c, table = 'cases') => { const { data, error } = await c.from(table).select('no'); expect(error).toBeNull(); return data.map(r => r.no).sort(); };
const count = async (c, table) => { const { data, error } = await c.from(table).select('id'); expect(error).toBeNull(); return data.length; };

const U = {};
beforeAll(async () => {
  for (const e of ['family', 'family2', 'family3', 'staff', 'nurse', 'nurse2', 'care', 'admin', 'jiaying']) U[e] = await as(`${e}@example.com`);
});

describe('案件隔離', () => {
  it('家屬 A 只看到自己的案件', async () => { expect(await nos(U.family)).toEqual(['C-0001']); });
  it('家屬 B 看不到家屬 A 的案件', async () => { expect(await nos(U.family2)).toEqual(['C-0002']); });
  it('沒有案件的家屬看不到任何案件', async () => { expect(await nos(U.family3)).toEqual([]); });
  it('家屬指定別人的案件編號也拿不到', async () => {
    const { data } = await U.family.from('cases').select('id').eq('no', 'C-0002');
    expect(data).toEqual([]);
  });
  it('行政看得到所有案件', async () => { expect(await nos(U.staff)).toEqual(['C-0001', 'C-0002']); });
  it('護理師看不到未承辦、未確認的案件', async () => {
    expect(await nos(U.nurse)).toEqual([]);
    expect(await nos(U.nurse2)).toEqual([]);
  });
  it('照服員看不到案件與文件', async () => {
    expect(await nos(U.care)).toEqual([]);
    expect(await count(U.care, 'documents')).toBe(0);
  });
  it('待審核的員工看不到任何案件', async () => { expect(await nos(U.jiaying)).toEqual([]); });
  it('未登入（anon）看不到案件，但看得到機構名稱', async () => {
    const a = anon();
    const { data } = await a.from('cases').select('no');
    expect(data ?? []).toEqual([]);
    const { data: org } = await a.from('org_settings').select('name').single();
    expect(org.name).toBe('康和長照中心');
  });
});

describe('文件隔離', () => {
  it('家屬只看到自己案件的 24 份文件', async () => { expect(await count(U.family, 'documents')).toBe(24); });
  it('行政看到兩案共 48 份文件', async () => { expect(await count(U.staff, 'documents')).toBe(48); });
  it('管理員看得到案件（封存用）但看不到文件', async () => {
    expect(await nos(U.admin)).toEqual(['C-0001', 'C-0002']);
    expect(await count(U.admin, 'documents')).toBe(0);
  });
});

describe('承辦護理只看 B、C、D 類', () => {
  let caseId;
  beforeAll(async () => {
    const svc = service();
    const { data } = await svc.from('cases').select('id').eq('no', 'C-0002').single(); caseId = data.id;
    const { data: n2 } = await svc.from('profiles').select('id').eq('email', 'nurse2@example.com').single();
    await svc.from('cases').update({ link_status: '已確認', nurse_id: n2.id }).eq('id', caseId);
  });
  afterAll(async () => { await service().from('cases').update({ link_status: '待確認', nurse_id: null }).eq('id', caseId); });

  it('吳護理師承辦 C-0002 後看得到該案，但只有 B、C、D 類文件', async () => {
    expect(await nos(U.nurse2)).toEqual(['C-0002']);
    const { data } = await U.nurse2.from('documents').select('cat');
    expect(data.length).toBeGreaterThan(0);
    expect([...new Set(data.map(r => r.cat))].sort()).toEqual(['B', 'C', 'D']);
  });
  it('黃護理師（有分配權限）看不到已分配給別人的案件', async () => { expect(await nos(U.nurse)).toEqual([]); });
});

describe('有分配權限的護理師看得到待分配案件', () => {
  let caseId;
  beforeAll(async () => {
    const svc = service();
    const { data } = await svc.from('cases').select('id').eq('no', 'C-0001').single(); caseId = data.id;
    await svc.from('cases').update({ link_status: '已確認' }).eq('id', caseId);
  });
  afterAll(async () => { await service().from('cases').update({ link_status: '待確認' }).eq('id', caseId); });

  it('黃護理師看得到已確認、未分配的 C-0001，但看不到文件', async () => {
    expect(await nos(U.nurse)).toEqual(['C-0001']);
    expect(await count(U.nurse, 'documents')).toBe(0);
  });
  it('一般護理師（吳）看不到待分配案件', async () => { expect(await nos(U.nurse2)).toEqual([]); });
});

describe('預設拒絕直接寫入', () => {
  it('家屬不能直接新增案件', async () => {
    const { data: me } = await U.family.auth.getUser();
    const { error } = await U.family.from('cases').insert({ no: 'C-9999', family_id: me.user.id, patient_name: 'x', flow_mode: '先審後簽' });
    expect(error).not.toBeNull();
  });
  it('家屬不能把自己改成管理員', async () => {
    const { data: me } = await U.family.auth.getUser();
    await U.family.from('profiles').update({ role: 'admin' }).eq('id', me.user.id);
    const { data } = await service().from('profiles').select('role').eq('id', me.user.id).single();
    expect(data.role).toBe('family');
  });
  it('行政不能直接修改文件', async () => {
    const { error, data } = await U.staff.from('documents').update({ cond_met: true }).eq('key', 'tubeCare').select();
    expect(error !== null || data.length === 0).toBe(true);
  });
  it('不能直接新增操作紀錄', async () => {
    const { error } = await U.staff.from('audit_logs').insert({ action: '偽造' });
    expect(error).not.toBeNull();
  });
  it('操作紀錄連 service role 也不能修改或刪除', async () => {
    const svc = service();
    const { data } = await svc.from('audit_logs').select('id').limit(1).single();
    const up = await svc.from('audit_logs').update({ action: '改' }).eq('id', data.id);
    expect(up.error?.message).toMatch(/只能新增/);
    const del = await svc.from('audit_logs').delete().eq('id', data.id);
    expect(del.error?.message).toMatch(/只能新增/);
  });
});

describe('自行註冊不能取得角色', () => {
  /* 註冊時使用者能控制的只有 user_metadata。這裡用 Admin API 建立「只帶 user_metadata」的帳號，
   * 跟前端 signUp 進入同一個 profiles 觸發器，但不會從雲端專案寄出驗證信（HANDOFF 15-4）。 */
  const made = [];
  afterAll(async () => { const svc = service(); for (const id of made) await svc.auth.admin.deleteUser(id); });
  const signup = async (want, tag) => {
    const email = `rls-${tag}-${Date.now()}@example.com`;
    const { data, error } = await service().auth.admin.createUser({ email, password: 'Rls-test-0001', email_confirm: true, user_metadata: { name: 'RLS 測試', phone: '0912-000-000', want } });
    expect(error).toBeNull(); made.push(data.user.id);
    const { data: p } = await service().from('profiles').select('role,status,want').eq('id', data.user.id).single();
    return p;
  };
  it('員工註冊為待審核，沒有角色', async () => { expect(await signup('nurse', 'n')).toEqual({ role: null, status: '待審核', want: 'nurse' }); });
  it('註冊時要求 admin 會被當成家屬', async () => { expect(await signup('admin', 'a')).toEqual({ role: 'family', status: '啟用', want: 'family' }); });
});

describe('Storage', () => {
  it('case-files bucket 是私有的', async () => {
    const { data } = await service().storage.getBucket('case-files');
    expect(data.public).toBe(false);
  });
});
