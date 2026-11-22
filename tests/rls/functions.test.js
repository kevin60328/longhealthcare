/* Edge Function case-phases（伺服器端用同一份規則算出案件階段，給案件分配頁使用）。
 * 檢查：權限（只有行政與有分配權限的護理師）、算出的階段與原型對照資料相同。
 * 前提：已用 npm run functions:deploy 部署。 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { as, anon, service } from './helpers.js';

const F = JSON.parse(gunzipSync(readFileSync(new URL('../unit/fixtures/parity.json.gz', import.meta.url))));
/* 原型對 4 筆測試案件（原始狀態）算出的階段 */
const want = {};
for (const s of F.scenarios){ const c = s.input.c; if (c.id.startsWith('TEST-') && !(c.no in want)) want[c.no] = s.out.case.phase; }

describe('case-phases：伺服器端算出的案件階段', () => {
  it('有分配權限的護理師：T-A～T-D 的階段與原型相同', async () => {
    const { data: cs } = await service().from('cases').select('id, no').in('no', Object.keys(want));
    const { data, error } = await (await as('nurse@example.com')).functions.invoke('case-phases', { body: { case_ids: cs.map(c => c.id) } });
    expect(error).toBeNull();
    expect(Object.fromEntries(cs.map(c => [c.no, data.phases[c.id]]))).toEqual(want);
  });
  it('只回傳階段名稱，不含任何案件內容', async () => {
    const { data } = await (await as('staff@example.com')).functions.invoke('case-phases', { body: {} });
    expect(Object.keys(data)).toEqual(['phases']);
    for (const v of Object.values(data.phases)) expect(typeof v).toBe('string');
  });
  it('沒有分配權限的護理師、家屬、照服員：拒絕；未登入：拒絕', async () => {
    for (const e of ['nurse2@example.com', 'family@example.com', 'care@example.com']){
      const { data, error } = await (await as(e)).functions.invoke('case-phases', { body: {} });
      expect(data?.phases, e).toBeUndefined();
      expect(error, e).not.toBeNull();
    }
    const { error } = await anon().functions.invoke('case-phases', { body: {} });
    expect(error).not.toBeNull();
  });
});
