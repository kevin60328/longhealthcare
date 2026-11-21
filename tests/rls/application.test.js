/* 階段 4：入住申請與授權的寫入函式（RPC），直接呼叫資料庫測試，不經過畫面。
 * 用暫時的家屬帳號；測試建立的案件在結束時「結案」（不刪除：有操作紀錄的案件依規則不能刪），
 * 結案的案件沒有待辦，不影響工作清單與徽章。 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { as, service, URL, ANON } from './helpers.js';

const PW = 'Temp-pass-0001';
const made = [];          // 測試建立的案件 id（結束時結案）
const users = [];         // 暫時帳號 id（結束時停用）

async function tempFamily(tag){
  const svc = service(), email = `e2e-app-${tag}-${Date.now()}@example.com`;
  const { data, error } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { name: '測試家屬' + tag, phone: '0912000222', want: 'family' } });
  if (error) throw error;
  users.push(data.user.id);
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const r = await c.auth.signInWithPassword({ email, password: PW }); if (r.error) throw r.error;
  return { db: c, id: data.user.id, email };
}
/* 產生一個沒用過的有效身分證字號（Z1 開頭＋8 碼） */
let seq = 0;
const newNid = () => 'Z2' + String(Date.now() * 10 + (++seq)).slice(-8);
const apply = (db, over = {}) => db.rpc('create_application', { p_token: 'tok-' + Date.now() + '-' + (++seq), p_name: '測試住民', p_nid: newNid(), p_birth: '1940-01-02',
  p_relation: '兒子', p_hospital: '測試醫院', p_admit: '2026-12-20', ...over });

let A, B;
beforeAll(async () => { A = await tempFamily('a'); B = await tempFamily('b'); });
afterAll(async () => {
  const svc = service();
  for (const id of made) await svc.from('cases').update({ closed_at: new Date().toISOString(), closed_title: '測試結束', closed_reason: '自動測試建立的案件' }).eq('id', id);
  for (const id of users) await svc.from('profiles').update({ status: '停用' }).eq('id', id);
});

describe('提出入住申請（create_application）', () => {
  it('建立案件、24 份文件與核對項目、申請確認通知（未寄出）、操作紀錄', async () => {
    const { data, error } = await apply(A.db);
    expect(error).toBeNull();
    expect(data).toMatchObject({ status: 'ok', repeat: false });
    expect(data.no).toMatch(/^C-\d{4}$/);
    made.push(data.case_id);
    const svc = service();
    const { data: c } = await svc.from('cases').select('link_status, family_id, flow_mode').eq('id', data.case_id).single();
    expect(c).toMatchObject({ link_status: '待確認', family_id: A.id });
    const { count: docs } = await svc.from('documents').select('id', { count: 'exact', head: true }).eq('case_id', data.case_id);
    expect(docs).toBe(24);
    const { data: exam } = await svc.from('documents').select('id').eq('case_id', data.case_id).eq('key', 'exam').single();
    const { count: parts } = await svc.from('document_parts').select('k', { count: 'exact', head: true }).eq('document_id', exam.id);
    expect(parts).toBe(8);
    const { data: mail } = await svc.from('mail_jobs').select('kind, status, to_email').eq('id', 'apply_' + data.case_id).single();
    expect(mail).toMatchObject({ kind: '申請確認', to_email: A.email });
    const { data: att } = await svc.from('mail_attempts').select('result').eq('job_id', 'apply_' + data.case_id);
    expect(att.map(a => a.result)).toEqual(['未寄出：測試環境尚未介接郵件服務']);
    const { data: logs } = await svc.from('audit_logs').select('action, family_visible').eq('case_id', data.case_id).order('id');
    expect(logs.map(l => l.action)).toEqual(['測試家屬a 提出 測試住民 的入住申請', '建立入住文件清單（24 份）']);
  });

  it('同一份申請重新送出（同一個識別碼）不會建立第二筆', async () => {
    const tok = 'tok-repeat-' + Date.now(), nid = newNid();
    const r1 = await apply(A.db, { p_token: tok, p_nid: nid });
    const r2 = await apply(A.db, { p_token: tok, p_nid: nid });
    made.push(r1.data.case_id);
    expect(r2.data).toMatchObject({ status: 'ok', case_id: r1.data.case_id, repeat: true });
    const { count } = await service().from('cases').select('id', { count: 'exact', head: true }).eq('apply_token', tok);
    expect(count).toBe(1);
  });

  it('同一身分證字號、姓名生日相同：沿用同一位住民', async () => {
    const nid = newNid();
    const r1 = await apply(A.db, { p_nid: nid }); made.push(r1.data.case_id);
    const r2 = await apply(B.db, { p_nid: nid }); made.push(r2.data.case_id);
    expect(r2.data.status).toBe('ok');
    const { data } = await service().from('cases').select('resident_id').in('id', [r1.data.case_id, r2.data.case_id]);
    expect(new Set(data.map(x => x.resident_id)).size).toBe(1);
  });

  it('同一身分證字號、姓名不同：不建立申請，留下待行政確認的紀錄；行政填說明後標示已處理', async () => {
    const nid = newNid();
    const r1 = await apply(A.db, { p_nid: nid }); made.push(r1.data.case_id);
    const tok = 'tok-conflict-' + Date.now();
    const r2 = await apply(B.db, { p_nid: nid, p_name: '不同的名字', p_token: tok });
    expect(r2.error).toBeNull();
    expect(r2.data).toEqual({ status: 'resident_conflict' });
    const { count } = await service().from('cases').select('id', { count: 'exact', head: true }).eq('apply_token', tok);
    expect(count).toBe(0);
    /* 家屬只看得到自己的紀錄，看不到既有住民的資料 */
    const mine = await B.db.from('resident_conflicts').select('id, submitted_name').eq('apply_token', tok);
    expect(mine.data).toHaveLength(1);
    const res = await B.db.from('residents').select('name').eq('nid', nid);
    expect(res.data).toEqual([]);
    /* 行政看得到並處理；家屬不能處理；沒有說明不能處理 */
    const staff = await as('staff@example.com');
    const { data: list } = await staff.from('resident_conflicts').select('id, residents(name)').eq('apply_token', tok);
    expect(list[0].residents.name).toBe('測試住民');
    expect((await B.db.rpc('resolve_resident_conflict', { p_id: list[0].id, p_resolution: 'x' })).error?.message).toMatch(/只有行政/);
    expect((await staff.rpc('resolve_resident_conflict', { p_id: list[0].id, p_resolution: '' })).error?.message).toMatch(/請填寫處理說明/);
    expect((await staff.rpc('resolve_resident_conflict', { p_id: list[0].id, p_resolution: '已電話確認，請申請人更正姓名後重新送出' })).error).toBeNull();
    expect((await staff.rpc('resolve_resident_conflict', { p_id: list[0].id, p_resolution: '再一次' })).error?.message).toMatch(/已經處理過/);
  });

  it('格式錯誤會被資料庫擋下（不只靠畫面檢查）', async () => {
    expect((await apply(A.db, { p_nid: 'A12345' })).error?.message).toMatch(/身分證字號格式不正確/);
    expect((await apply(A.db, { p_name: '  ' })).error?.message).toMatch(/請填寫預計入住者姓名/);
    expect((await apply(A.db, { p_relation: '鄰居' })).error?.message).toMatch(/請選擇與預計入住者的關係/);
    expect((await apply(A.db, { p_birth: '2099-01-01' })).error?.message).toMatch(/出生日期/);
  });

  it('機構工作帳號不能提出入住申請', async () => {
    const staff = await as('staff@example.com');
    expect((await apply(staff)).error?.message).toMatch(/只有一般申請人帳號/);
  });
});

describe('個資同意、聯絡人、習慣卡', () => {
  let cid;
  beforeAll(async () => {
    const { data } = await apply(A.db); cid = data.case_id; made.push(cid);
    await service().from('cases').update({ link_status: '已確認', confirmed_at: new Date().toISOString() }).eq('id', cid);
  });

  it('別人的家屬不能操作這筆申請', async () => {
    for (const [fn, args] of [['sign_consent', { p_signer: '本人', p_signer_name: '王小明', p_agree: true, p_photo: false, p_emergency: false }], ['save_contacts', { p_contacts: [{ name: 'x', phone: '0912345678' }] }], ['decline_consent', {}], ['submit_habit', {}]]){
      const { error } = await B.db.rpc(fn, { p_case: cid, ...args });
      expect(error?.message, fn).toMatch(/找不到這筆申請/);
    }
  });

  it('授權前不能填習慣卡', async () => {
    expect((await A.db.rpc('save_habit_section', { p_case: cid, p_sec: 'A', p_vals: { call: '王媽媽' } })).error?.message).toMatch(/授權已撤回|已結案/);
  });

  it('同意書：沒勾必要同意、姓名太短都擋下；本人簽署立即生效，不能重複簽', async () => {
    const base = { p_case: cid, p_signer: '本人', p_signer_name: '王小明', p_agree: true, p_photo: true, p_emergency: false };
    expect((await A.db.rpc('sign_consent', { ...base, p_agree: false })).error?.message).toMatch(/必要的同意事項/);
    expect((await A.db.rpc('sign_consent', { ...base, p_signer_name: '王' })).error?.message).toMatch(/真實姓名/);
    const ok = await A.db.rpc('sign_consent', base);
    expect(ok.data).toBe('有效');
    expect((await A.db.rpc('sign_consent', base)).error?.message).toMatch(/不需要重複簽署/);
    expect((await A.db.rpc('decline_consent', { p_case: cid })).error?.message).toMatch(/案件狀態已改變/);
  });

  it('緊急聯絡人：主要聯絡人必填、電話格式檢查；第二位選填', async () => {
    expect((await A.db.rpc('save_contacts', { p_case: cid, p_contacts: [{ name: '', phone: '' }] })).error?.message).toMatch(/主要聯絡人/);
    expect((await A.db.rpc('save_contacts', { p_case: cid, p_contacts: [{ name: '王小明', phone: 'abc' }] })).error?.message).toMatch(/電話號碼格式/);
    expect((await A.db.rpc('save_contacts', { p_case: cid, p_contacts: [{ name: '王小明', rel: '兒子', phone: '0912-345-678' }, { name: '王小華', rel: '女兒', phone: '0922-333-444' }] })).error).toBeNull();
    const { data } = await service().from('contacts').select('name, sort').eq('case_id', cid).order('sort');
    expect(data).toEqual([{ name: '王小明', sort: 0 }, { name: '王小華', sort: 1 }]);
  });

  it('習慣卡：只接受該區的欄位；必填沒填不能提交；提交後內容相同不重複提交；修改後再提交是第 2 次', async () => {
    expect((await A.db.rpc('save_habit_section', { p_case: cid, p_sec: 'A', p_vals: { famAllergy: '無' } })).error?.message).toMatch(/欄位不正確/);
    expect((await A.db.rpc('save_habit_section', { p_case: cid, p_sec: 'A', p_vals: { call: '王媽媽', lang: ['台語'], hearing: '聽力正常' } })).data).toBe(1);
    const miss = await A.db.rpc('submit_habit', { p_case: cid });
    expect(miss.error?.message).toMatch(/還有必填欄位未填：過敏、日常活動：行走/);
    await A.db.rpc('save_habit_section', { p_case: cid, p_sec: 'B', p_vals: { famAllergy: '無' } });
    await A.db.rpc('save_habit_section', { p_case: cid, p_sec: 'C', p_vals: Object.fromEntries(['walk', 'transfer', 'toilet', 'bath', 'eat', 'swallow'].map(k => ['adl_' + k, '不清楚'])) });
    expect((await A.db.rpc('submit_habit', { p_case: cid })).data).toBe(1);
    expect((await A.db.rpc('submit_habit', { p_case: cid })).error?.message).toMatch(/內容和上次提交相同/);
    await A.db.rpc('save_habit_section', { p_case: cid, p_sec: 'E', p_vals: { likeFood: '稀飯' } });
    expect((await A.db.rpc('submit_habit', { p_case: cid })).data).toBe(2);
    const { data } = await service().from('habit_submissions').select('rev, n').eq('case_id', cid).order('rev');
    expect(data.map(x => x.n)).toEqual([1, 2]);
    expect(data[1].rev).toBeGreaterThan(data[0].rev);
    /* 草稿機構看不到；正式提交看得到 */
    const staff = await as('staff@example.com');
    expect((await staff.from('habit_cards').select('case_id').eq('case_id', cid)).data).toEqual([]);
    expect((await staff.from('habit_submissions').select('n').eq('case_id', cid)).data).toHaveLength(2);
  });

  it('撤回同意：案件結案，之後不能再改習慣卡', async () => {
    expect((await A.db.rpc('withdraw_consent', { p_case: cid })).error).toBeNull();
    const { data } = await service().from('cases').select('closed_at, closed_type').eq('id', cid).single();
    expect(data.closed_type).toBe('撤回');
    expect(data.closed_at).not.toBeNull();
    expect((await A.db.rpc('save_habit_section', { p_case: cid, p_sec: 'A', p_vals: { call: 'x' } })).error).not.toBeNull();
    expect((await A.db.rpc('withdraw_consent', { p_case: cid })).error?.message).toMatch(/不是有效狀態/);
  });
});

describe('非本人簽署：待代理權核實並加入證明文件', () => {
  it('監護人簽署 → 待代理權核實，加入「監護宣告裁定書」並連到同意紀錄；代理人 → 代理權授權證明', async () => {
    for (const [signer, key, name] of [['監護人', 'guardian', '監護宣告裁定書'], ['代理人', 'agentProof', '代理權授權證明'], ['受輔助宣告', 'guardian', '輔助宣告裁定書']]){
      const { data } = await apply(A.db); made.push(data.case_id);
      const r = await A.db.rpc('sign_consent', { p_case: data.case_id, p_signer: signer, p_signer_name: '王大明', p_agree: true, p_photo: false, p_emergency: true });
      expect(r.data, signer).toBe('待代理權核實');
      const svc = service();
      const { data: d } = await svc.from('documents').select('id, name, cat, catalog_key').eq('case_id', data.case_id).eq('key', key).single();
      expect(d).toMatchObject({ name, cat: 'A', catalog_key: key });
      const { data: k } = await svc.from('consents').select('state, proof_document_id').eq('case_id', data.case_id).single();
      expect(k).toEqual({ state: '待代理權核實', proof_document_id: d.id });
    }
  });
});

describe('機構人員名冊', () => {
  it('家屬看得到機構人員的姓名與角色（處理歷程用），看不到 Email 與電話', async () => {
    const { data, error } = await A.db.rpc('staff_directory');
    expect(error).toBeNull();
    const s = data.find(x => x.name === '陳社工');
    expect(s).toEqual({ id: s.id, name: '陳社工', role: 'staff' });
    expect(data.some(x => x.role === 'family')).toBe(false);
  });
});
