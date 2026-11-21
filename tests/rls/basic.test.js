/* 階段 1：資料隔離（HANDOFF 8.3）。以每種角色的 JWT 直接查詢，不經過畫面。
 * 預期結果用 service role（不受 RLS 限制）查出「這個人應該看到哪些案件」再比對，所以新增測試案件（npm run db:seed-cases）也不用改這裡。 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { as, anon, service } from './helpers.js';

const nos = async (c, table = 'cases') => { const { data, error } = await c.from(table).select('no'); expect(error).toBeNull(); return data.map(r => r.no).sort(); };
/* 筆數用 count 查詢（不讀出資料列，也不受每次最多回傳 1000 列的限制） */
const count = async (c, table) => { const { count: n, error } = await c.from(table).select('id', { count: 'exact', head: true }); expect(error).toBeNull(); return n; };

/* 建立暫時案件（測完呼叫 remove() 刪除，案件相關資料一併刪除）。nurse：指定承辦護理師（透過分配紀錄） */
let tmpN = 0;
async function tempCase({ docs = [], nurse = null, family = 'family3' } = {}){
  const svc = service(), no = `TMP-${Date.now()}-${++tmpN}`;
  const nid = 'Z1' + String(Date.now() * 10 + tmpN).slice(-8);
  const { data: r, error: e1 } = await svc.from('residents').insert({ nid, name: '暫時住民' }).select('id').single(); if (e1) throw e1;
  const { data: c, error: e2 } = await svc.from('cases').insert({ no, family_id: ID[family], resident_id: r.id, flow_mode: '先審後簽', link_status: '已確認' }).select('id').single(); if (e2) throw e2;
  if (docs.length){
    const { data: cat } = await svc.from('doc_catalog').select('*').in('key', docs);
    const { error } = await svc.from('documents').insert(cat.map(k => ({ case_id: c.id, key: k.key, catalog_key: k.key, cat: k.cat, name: k.name, fam_name: k.fam_name, stage: k.stage, need: k.need, medical: k.medical, sort: k.sort })));
    if (error) throw error;
  }
  if (nurse){ const { error } = await svc.from('case_assignments').insert({ case_id: c.id, nurse_id: ID[nurse], by: ID.nurse, at: new Date().toISOString() }); if (error) throw error; }
  return { id: c.id, no, residentId: r.id, remove: async () => { await svc.from('cases').delete().eq('id', c.id); await svc.from('residents').delete().eq('id', r.id); } };
}

const U = {}, ALL = {}, ID = {};
/* 應該看到的案件編號（service role 查詢）：家屬＝自己提出的；護理＝自己承辦的；行政、管理員＝全部 */
const expectNos = filter => Object.values(ALL).filter(filter).map(c => c.no).sort();
beforeAll(async () => {
  for (const e of ['family', 'family2', 'family3', 'staff', 'nurse', 'nurse2', 'care', 'admin', 'jiaying']) U[e] = await as(`${e}@example.com`);
  const svc = service();
  for (const p of (await svc.from('profiles').select('id, email')).data) ID[p.email.split('@')[0]] = p.id;
  for (const c of (await svc.from('cases').select('id, no, family_id, nurse_id, link_status, resident_id')).data) ALL[c.id] = c;
});

describe('案件隔離', () => {
  it('每位家屬只看到自己提出的案件', async () => {
    for (const f of ['family', 'family2', 'family3']){
      const want = expectNos(c => c.family_id === ID[f]);
      expect(want.length).toBeGreaterThan(0);
      expect(await nos(U[f])).toEqual(want);
    }
  });
  it('家屬指定別人的案件編號也拿不到', async () => {
    const { data } = await U.family.from('cases').select('id').eq('no', 'C-0002');
    expect(data).toEqual([]);
  });
  it('行政看得到所有案件', async () => { expect(await nos(U.staff)).toEqual(expectNos(() => true)); });
  it('護理師只看到自己承辦的案件（看不到未承辦、未確認的案件）', async () => {
    expect(await nos(U.nurse)).toEqual(expectNos(c => c.nurse_id === ID.nurse));
    expect(await nos(U.nurse2)).toEqual(expectNos(c => c.nurse_id === ID.nurse2));
    expect(await nos(U.nurse)).not.toContain('C-0001');
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
  /* 預期筆數用 service role 查（非本人簽署的案件會多一份代理權證明，所以不是固定 24 份） */
  const docsOf = async filter => { const ids = Object.values(ALL).filter(filter).map(c => c.id); const { count: n } = await service().from('documents').select('id', { count: 'exact', head: true }).in('case_id', ids); return n; };
  it('家屬只看到自己案件的文件', async () => { expect(await count(U.family, 'documents')).toBe(await docsOf(c => c.family_id === ID.family)); });
  it('行政看到所有案件的文件', async () => { expect(await count(U.staff, 'documents')).toBe(await docsOf(() => true)); });
  it('管理員看得到案件（封存用）但看不到文件', async () => {
    expect(await nos(U.admin)).toEqual(expectNos(() => true));
    expect(await count(U.admin, 'documents')).toBe(0);
  });
});

describe('承辦護理只看 B、C、D 類', () => {
  /* 用暫時案件測試：承辦護理師只能由分配紀錄設定（資料庫觸發器），測完刪除暫時案件 */
  let tmp;
  beforeAll(async () => { tmp = await tempCase({ docs: ['idcopy', 'summary', 'exam', 'tubeCare', 'contract'], nurse: 'nurse2' }); });
  afterAll(async () => { await tmp.remove(); });

  it('吳護理師承辦暫時案件後看得到該案，但只有 B、C、D 類文件', async () => {
    expect(await nos(U.nurse2)).toContain(tmp.no);
    const { data } = await U.nurse2.from('documents').select('cat').eq('case_id', tmp.id);
    expect([...new Set(data.map(r => r.cat))].sort()).toEqual(['B', 'C', 'D']);
  });
  it('黃護理師（有分配權限）看不到已分配給別人的案件', async () => { expect(await nos(U.nurse)).not.toContain(tmp.no); });
});

describe('有分配權限的護理師看得到待分配案件', () => {
  let caseId;
  beforeAll(async () => {
    const svc = service();
    const { data } = await svc.from('cases').select('id').eq('no', 'C-0001').single(); caseId = data.id;
    await svc.from('cases').update({ link_status: '已確認' }).eq('id', caseId);
  });
  afterAll(async () => { await service().from('cases').update({ link_status: '待確認' }).eq('id', caseId); });

  it('黃護理師看得到已確認、未分配的 C-0001，但看不到它的文件', async () => {
    expect(await nos(U.nurse)).toContain('C-0001');
    const { data } = await U.nurse.from('documents').select('id').eq('case_id', caseId);
    expect(data).toEqual([]);
  });
  it('一般護理師（吳）看不到待分配案件', async () => { expect(await nos(U.nurse2)).not.toContain('C-0001'); });
});

describe('預設拒絕直接寫入', () => {
  it('家屬不能直接新增案件', async () => {
    const { data: me } = await U.family.auth.getUser();
    const { error } = await U.family.from('cases').insert({ no: 'C-9999', family_id: me.user.id, resident_id: Object.values(ALL)[0].resident_id, flow_mode: '先審後簽' });
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

describe('正規化後的資料關聯（資料庫強制）', () => {
  let tmp;
  beforeAll(async () => { tmp = await tempCase({ docs: ['summary', 'relProof'] }); });
  afterAll(async () => { await tmp.remove(); });
  const svc = () => service();

  it('承辦護理師不能直接修改，連 service role 也不行', async () => {
    const { error } = await svc().from('cases').update({ nurse_id: ID.nurse }).eq('id', tmp.id);
    expect(error?.message).toMatch(/只能透過分配功能/);
  });
  it('新案件不能直接指定承辦護理師', async () => {
    const { error } = await svc().from('cases').insert({ no: 'TMP-X-' + Date.now(), family_id: ID.family3, resident_id: tmp.residentId, flow_mode: '先審後簽', nurse_id: ID.nurse });
    expect(error?.message).toMatch(/新案件不能直接指定/);
  });
  it('新增分配紀錄後，案件的承辦護理師自動同步為最新一筆', async () => {
    await svc().from('case_assignments').insert({ case_id: tmp.id, nurse_id: ID.nurse, by: ID.nurse, at: new Date().toISOString() });
    await svc().from('case_assignments').insert({ case_id: tmp.id, nurse_id: ID.nurse2, from_nurse_id: ID.nurse, by: ID.nurse, at: new Date().toISOString(), reason: '測試更換' });
    const { data } = await svc().from('cases').select('nurse_id').eq('id', tmp.id).single();
    expect(data.nurse_id).toBe(ID.nurse2);
  });
  it('分配給非護理人員會被擋下', async () => {
    const { error } = await svc().from('case_assignments').insert({ case_id: tmp.id, nurse_id: ID.staff, by: ID.nurse, at: new Date().toISOString() });
    expect(error?.message).toMatch(/必須是啟用中的護理人員/);
  });
  it('更換承辦人沒有填原因會被擋下', async () => {
    const { error } = await svc().from('case_assignments').insert({ case_id: tmp.id, nurse_id: ID.nurse, from_nurse_id: ID.nurse2, by: ID.nurse, at: new Date().toISOString() });
    expect(error).not.toBeNull();
  });
  it('護理確認欄位必須指向存在的文件版本', async () => {
    const { data: d } = await svc().from('documents').select('id').eq('case_id', tmp.id).eq('key', 'summary').single();
    const { error } = await svc().from('medical_facts').insert({ document_id: d.id, version_v: 99, field: 'dx', value: 'x', confirmed_by: ID.nurse });
    expect(error?.code).toBe('23503');   // foreign_key_violation
  });
  it('代理權證明必須指向存在的文件', async () => {
    const { error } = await svc().from('consents').insert({ case_id: tmp.id, ver: 1, signer_type: '監護人', signer_name: 'x', signed_by: ID.family3, state: '待代理權核實', proof_document_id: '00000000-0000-0000-0000-000000000000' });
    expect(error?.code).toBe('23503');
  });
  it('習慣卡初審必須對應存在的提交版本', async () => {
    const { error } = await svc().from('habit_reviews').insert({ case_id: tmp.id, rev: 5, state: '審核完成', reviewed_by: ID.nurse });
    expect(error?.code).toBe('23503');
  });
  it('案件文件必須連到文件清單（G 類除外）', async () => {
    const bad = await svc().from('documents').insert({ case_id: tmp.id, key: 'notInCatalog', catalog_key: null, cat: 'A', name: 'x', stage: '評估前', need: '選填', medical: false });
    expect(bad.error).not.toBeNull();
    const ok = await svc().from('documents').insert({ case_id: tmp.id, key: 'g_extra', catalog_key: null, cat: 'G', name: '其他補充文件', stage: '評估前', need: '選填', medical: false });
    expect(ok.error).toBeNull();
  });
  it('摘要卡只能開放給照顧服務員', async () => {
    const { data: k } = await svc().from('care_cards').insert({ case_id: tmp.id, v: 1, status: '草稿' }).select('id').single();
    const bad = await svc().from('care_card_caregivers').insert({ card_id: k.id, caregiver_id: ID.staff });
    expect(bad.error?.message).toMatch(/只能開放給照顧服務員/);
    const good = await svc().from('care_card_caregivers').insert({ card_id: k.id, caregiver_id: ID.care });
    expect(good.error).toBeNull();
  });
  it('Email 工作只能指向案件或補件其中之一', async () => {
    const { error } = await svc().from('mail_jobs').insert({ id: 'tmp-' + Date.now(), kind: '申請確認', to_email: 'a@example.com' });
    expect(error).not.toBeNull();
  });
  it('同一個身分證字號只會有一位住民', async () => {
    const { data: r } = await svc().from('residents').select('nid').eq('id', tmp.residentId).single();
    const { error } = await svc().from('residents').insert({ nid: r.nid, name: '另一個名字' });
    expect(error?.code).toBe('23505');   // unique_violation
  });
  it('家屬只看得到自己案件的住民資料', async () => {
    const want = [...new Set(Object.values(ALL).filter(c => c.family_id === ID.family).map(c => c.resident_id))].sort();
    const { data } = await U.family.from('residents').select('id');
    expect(data.map(x => x.id).sort()).toEqual(want);
  });
});

describe('跨案件的關聯一致性（資料庫強制）', () => {
  /* 兩個暫時案件：故意讓 A 案件的資料指向 B 案件的文件，資料庫要擋下 */
  let A, B, docB, docA;
  beforeAll(async () => {
    A = await tempCase({ docs: ['summary', 'exam', 'xray'] });
    B = await tempCase({ docs: ['summary', 'exam', 'relProof'] });
    const svc = service();
    docA = Object.fromEntries((await svc.from('documents').select('id, key').eq('case_id', A.id)).data.map(d => [d.key, d.id]));
    docB = Object.fromEntries((await svc.from('documents').select('id, key').eq('case_id', B.id)).data.map(d => [d.key, d.id]));
    await svc.from('document_versions').insert({ document_id: docB.exam, v: 1, uploaded_by: ID.family3, phase: 'received' });
    await svc.from('document_versions').insert({ document_id: docB.summary, v: 1, uploaded_by: ID.family3, phase: 'received' });
  });
  afterAll(async () => { await A.remove(); await B.remove(); });

  it('代理權證明不能指向別的案件的文件', async () => {
    const { error } = await service().from('consents').insert({ case_id: A.id, ver: 1, signer_type: '監護人', signer_name: 'x', signed_by: ID.family3, state: '待代理權核實', proof_document_id: docB.relProof });
    expect(error?.code).toBe('23503');
  });
  it('診斷的來源文件不能是別的案件的文件', async () => {
    const { error } = await service().from('diagnoses').insert({ case_id: A.id, text: '高血壓', source_document: docB.summary, source_version: 1 });
    expect(error?.code).toBe('23503');
  });
  it('文件版本不能沿用別的案件的檔案；同一案件可以', async () => {
    const bad = await service().from('document_versions').insert({ document_id: docA.xray, v: 1, uploaded_by: ID.family3, phase: 'received', from_document_id: docB.exam, from_version: 1 });
    expect(bad.error?.message).toMatch(/只能沿用同一案件/);
    await service().from('document_versions').insert({ document_id: docA.exam, v: 1, uploaded_by: ID.family3, phase: 'received' });
    const ok = await service().from('document_versions').insert({ document_id: docA.xray, v: 1, uploaded_by: ID.family3, phase: 'received', from_document_id: docA.exam, from_version: 1 });
    expect(ok.error).toBeNull();
  });
});
