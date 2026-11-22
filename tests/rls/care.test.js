/* 階段 8：照顧摘要卡的 RPC 與照服員限閱（HANDOFF 10.8；驗收「照服員只能看到已開放且有開放給自己的卡」）。
 * 用種子測試案件 T-C（摘要卡待審核，已符合開放條件）；測試結束刪除這次建立的摘要卡，T-C 回到原狀。
 * 前提：已 npm run db:push、npm run functions:deploy。 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { as, service } from './helpers.js';
import { assembleModel, todayTW } from '../../js/modules/services/model-build.js';
import { createRules } from '../../js/modules/rules/core.js';

let nurse, nurse2, staff, care, care2, C, ID = {};
const cards = () => service().from('care_cards').select('v, status, end_note').eq('case_id', C).order('v').then(r => r.data);
const cardFn = (db, body) => db.functions.invoke('care-card', { body }).then(async r => r.error ? { status: r.error.context?.status, error: r.error } : r.data);
const content = { dx: '高血壓', allergy: '無已知過敏', tube: '無', call: '張伯伯', hints: ['服用降血壓藥：扶起身時要慢，注意頭暈'], layout: 2, pending: [] };
let basis;   // 開放時的依據快照：用規則（rules/core.js cardBasis）依 T-C 目前資料算出，與畫面相同

beforeAll(async () => {
  [nurse, nurse2, staff, care, care2] = await Promise.all(['nurse', 'nurse2', 'staff', 'care', 'care2'].map(e => as(e + '@example.com')));
  for (const p of (await service().from('profiles').select('id, email')).data) ID[p.email.split('@')[0]] = p.id;
  C = (await service().from('cases').select('id').eq('no', 'T-C').single()).data.id;
  expect(await cards()).toEqual([]);   // 前提：T-C 還沒有摘要卡（npm run db:seed-cases 可恢復）
  const svc = service();
  const [m, profiles, org, catalog] = await Promise.all([svc.rpc('get_case_models', { p_case: C, p_include_closed: true }), svc.from('profiles').select('*'),
    svc.from('org_settings').select('*').eq('id', 1).maybeSingle(), svc.from('doc_catalog').select('key, why, "where", on_demand').order('sort')]);
  const { D } = assembleModel({ models: m.data, profiles: profiles.data, org: org.data, catalog: catalog.data, staff: [] }, null);
  basis = createRules(D, { me: null, today: todayTW() }).cardBasis(D.cases[C]);
}, 60000);
afterAll(async () => {
  const svc = service(), ids = (await svc.from('care_cards').select('id').eq('case_id', C)).data.map(x => x.id);
  if (ids.length){ await svc.from('care_card_caregivers').delete().in('card_id', ids); await svc.from('care_cards').delete().in('id', ids); }
});

describe('開放摘要卡（open_care_card）', () => {
  it('只有承辦護理師；至少一位照服員，而且必須是照服員', async () => {
    const args = { p_case: C, p_draft_v: null, p_content: content, p_basis: basis, p_caregivers: [ID.care] };
    expect((await staff.rpc('open_care_card', args)).error?.message).toMatch(/承辦護理師/);
    expect((await nurse2.rpc('open_care_card', args)).error?.message).toMatch(/負責護理師/);
    expect((await nurse.rpc('open_care_card', { ...args, p_caregivers: [] })).error?.message).toMatch(/至少選一位/);
    expect((await nurse.rpc('open_care_card', { ...args, p_caregivers: [ID.nurse2] })).error?.message).toMatch(/照顧服務員/);
  });
  it('第一次開放：第 1 版已開放；再按一次（畫面是舊的）擋下', async () => {
    const args = { p_case: C, p_draft_v: null, p_content: content, p_basis: basis, p_caregivers: [ID.care] };
    expect((await nurse.rpc('open_care_card', args)).data).toBe(1);
    expect(await cards()).toEqual([{ v: 1, status: '已開放', end_note: null }]);
    expect((await nurse.rpc('open_care_card', args)).error?.message).toMatch(/其他人修改/);
  });
});

describe('照服員限閱（Edge Function care-card、RLS）', () => {
  it('開放給自己的照服員看得到內容；沒開放給的照服員、護理、行政看不到', async () => {
    const r = await cardFn(care, { case_id: C });
    expect(r.card).toMatchObject({ v: 1, status: '已開放', patient_name: '張榮發' });
    expect(r.card.content.call).toBe('張伯伯');
    expect(Object.keys(r.card).sort()).toEqual(['card_id', 'content', 'end_at', 'end_note', 'opened_at', 'opened_by_name', 'patient_name', 'planned_admit', 'status', 'v']);
    expect((await cardFn(care2, { case_id: C })).status).toBe(404);
    expect((await cardFn(nurse, { case_id: C })).status).toBe(403);
    expect((await cardFn(staff, { case_id: C })).status).toBe(403);
    /* 照服員直接查資料表：只看得到開放給自己的卡，看不到案件與文件 */
    expect((await care.from('care_cards').select('v').eq('case_id', C)).data).toHaveLength(1);
    expect((await care2.from('care_cards').select('v').eq('case_id', C)).data).toHaveLength(0);
    expect((await care.from('cases').select('id').eq('id', C)).data).toHaveLength(0);
    expect((await care.from('documents').select('id').eq('case_id', C)).data).toHaveLength(0);
    expect((await care.rpc('get_case_models', { p_case: C })).error).not.toBeNull();
  });
  it('依據資料已變更：回傳變更項目（畫面受影響欄位改為「請問護理站」）', async () => {
    const svc = service(), { data: k } = await svc.from('care_cards').select('id, basis').eq('case_id', C).eq('v', 1).single();
    await svc.from('care_cards').update({ basis: { ...k.basis, tube: '鼻胃管（開放時的舊資料）' } }).eq('id', k.id);
    expect((await cardFn(care, { case_id: C })).changed).toContain('管路');
    await svc.from('care_cards').update({ basis: k.basis }).eq('id', k.id);
  });
});

describe('修訂、停用、重新開放', () => {
  it('修訂：產生第 2 版草稿（照服員仍看第 1 版）；開放後第 1 版已取代、照服員名單更新', async () => {
    expect((await nurse.rpc('revise_care_card', { p_case: C, p_expect_v: 2, p_content: content })).error?.message).toMatch(/其他人修改/);
    expect((await nurse.rpc('revise_care_card', { p_case: C, p_expect_v: 1, p_content: { ...content, call: '張爺爺' } })).data).toBe(2);
    expect((await cardFn(care, { case_id: C })).card.v).toBe(1);
    expect((await nurse.rpc('open_care_card', { p_case: C, p_draft_v: 2, p_content: { ...content, call: '張爺爺' }, p_basis: basis, p_caregivers: [ID.care2] })).data).toBe(2);
    expect(await cards()).toEqual([{ v: 1, status: '已取代', end_note: '由第 2 版取代' }, { v: 2, status: '已開放', end_note: null }]);
    expect((await cardFn(care2, { case_id: C })).card.content.call).toBe('張爺爺');
    expect((await cardFn(care, { case_id: C })).status).toBe(404);
  });
  it('放棄修訂草稿', async () => {
    expect((await nurse.rpc('revise_care_card', { p_case: C, p_expect_v: 2, p_content: content })).data).toBe(3);
    expect((await nurse.rpc('discard_care_card', { p_case: C, p_v: 3 })).error).toBeNull();
    expect((await cards()).map(x => x.v)).toEqual([1, 2]);
  });
  it('停用：要原因；照服員只看到「已停用」不含內容；重新開放由伺服器端檢查依據是否變更', async () => {
    expect((await nurse.rpc('stop_care_card', { p_case: C, p_note: '' })).error?.message).toMatch(/原因/);
    expect((await nurse.rpc('stop_care_card', { p_case: C, p_note: '住民轉院' })).error).toBeNull();
    const r = await cardFn(care2, { case_id: C });
    expect(r.card).toMatchObject({ status: '已停用', end_note: '住民轉院', content: null });
    expect((await care2.from('care_cards').select('v').eq('case_id', C)).data).toHaveLength(0);   // RLS：停用的卡不能直接讀內容
    /* 前端不能直接呼叫舊的重新開放函式（會略過依據檢查） */
    expect((await nurse.rpc('resume_care_card', { p_case: C })).error).not.toBeNull();
    const resume = db => db.functions.invoke('care-card', { body: { action: 'resume', case_id: C } }).then(async r => r.error ? { status: r.error.context?.status } : r.data);
    expect((await resume(nurse2)).status).toBe(403);
    expect((await resume(staff)).status).toBe(403);
    /* 停用期間依據改變（以開放時的快照不同來模擬）→ 不能重新開放，要改用修訂 */
    const svc = service(), { data: k } = await svc.from('care_cards').select('id, basis').eq('case_id', C).eq('v', 2).single();
    await svc.from('care_cards').update({ basis: { ...k.basis, allergy: '開放時的舊過敏資料' } }).eq('id', k.id);
    const r1 = await resume(nurse);
    expect(r1).toMatchObject({ ok: false }); expect(r1.reason).toMatch(/藥物過敏.*修訂內容/);
    expect((await cards()).find(x => x.v === 2).status).toBe('已停用');
    await svc.from('care_cards').update({ basis: k.basis }).eq('id', k.id);
    expect(await resume(nurse)).toEqual({ ok: true, v: 2 });
    expect((await cardFn(care2, { case_id: C })).card.status).toBe('已開放');
    expect((await svc.from('audit_logs').select('actor').eq('case_id', C).eq('action', '重新開放照顧摘要卡第 2 版').order('id', { ascending: false }).limit(1).single()).data.actor).toBe(ID.nurse);
  });
});
