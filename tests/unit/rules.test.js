/* 單元測試：原型對照資料（parity）沒有涵蓋到的情境，個別檢查。
 * 預期值依原型第 (18) 版的程式邏輯（rules/core.js 各函式旁註明的原型同名函式）。 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createRules } from '../../js/modules/rules/core.js';

const F = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/parity.json.gz', import.meta.url))));
/* 原型測試案件 D（吳月娥，摘要卡已開放）的原始資料當起點 */
const baseD = () => JSON.parse(JSON.stringify(F.scenarios.find(s => s.input.c.id === 'TEST-D').input));
const rules = (s, me = null) => createRules({ cases: { [s.c.id]: s.c }, items: s.items, accounts: F.accounts, settings: F.settings, docKeys: F.docKeys }, { me, today: F.today });

describe('摘要卡已停用', () => {
  it('摘要卡已開放的案件停用後，階段為「摘要卡已停用」，家屬進度條顯示需重新處理', () => {
    const s = baseD();
    expect(rules(s).phase(s.c)).toBe('摘要卡已開放');
    s.c.card.status = '已停用';
    const R = rules(s);
    expect(R.phase(s.c)).toBe('摘要卡已停用');
    expect(R.stepsInfo(s.c)[4]).toEqual({ name: '入住準備', state: '需重新處理', date: '', note: '照顧摘要暫停使用' });
  });
});

describe('診斷同步未完成', () => {
  it('病摘逐筆診斷已確認但診斷清單沒有同步：承辦護理出現「診斷同步未完成」待辦，取代「審核照顧摘要卡」', () => {
    const s = JSON.parse(JSON.stringify(F.scenarios.find(x => x.input.c.id === 'TEST-C').input));
    const sum = s.items['TEST-C_summary'], v = sum.versions[sum.versions.length - 1];
    v.nurseOk = true; v.dxRows = { rows: [{ n: 1, state: '已確認', raw: '高血壓' }] };
    s.c.diagnoses = [];
    const R = rules(s, F.accounts['nurse@example.com']);
    expect(R.dxPending(s.c)).not.toBeNull();
    const tags = R.tasks().map(t => t.tag);
    expect(tags).toContain('診斷');
    expect(R.tasks().find(t => t.tag === '診斷').what).toBe('診斷同步未完成：張榮發');
    /* 同步完成後就不再出現 */
    s.c.diagnoses = [{ state: '已確認', raw: '高血壓', src: { itemId: 'TEST-C_summary', v: v.v, row: 1 } }];
    expect(rules(s, F.accounts['nurse@example.com']).dxPending(s.c)).toBeNull();
  });
});

describe('文件效期：系統初步日期的來源（HANDOFF 10.2、F6）', () => {
  const s = () => { const x = baseD(); const it = x.items['TEST-D_stool']; const v = it.versions[0]; delete v.dateConfirmed; v.phase = 'checked'; return { x, it, v }; };
  it('AI 辨識的日期優先於家屬填寫的日期', () => {
    const { x, it, v } = s();
    v.userDate = '2026-01-01'; v.aiDate = x.c.plannedAdmit;     // 家屬填的已過期，AI 讀到的在期限內
    const R = rules(x);
    expect(R.prelimSrc(it, v)).toBe('AI 辨識');
    expect(R.status(it, x.c)).toBe('初步符合');
  });
  it('沒有 AI 日期時用家屬填寫的日期，只作初步判斷（行政確認前不會是確認符合）', () => {
    const { x, it, v } = s();
    v.userDate = '2026-01-01'; v.aiDate = '';
    const R = rules(x);
    expect(R.prelimSrc(it, v)).toBe('家屬填寫');
    expect(R.status(it, x.c)).toBe('疑似過期');
  });
});

describe('舊版提醒不是補件（HANDOFF 10.3）', () => {
  it('原因只有狀態文字、沒有來源的 req 不算正式補件；有來源才算', () => {
    const x = baseD(), it = x.items['TEST-D_nhi'], R = rules(x);
    it.req = { reason: '未上傳', at: '2026/11/20 10:00', ts: 1 };
    expect(R.formalReq(it)).toBe(false);
    expect(R.reqState(it, x.c)).toBeNull();
    it.req = { source: '行政', reason: '影本不清楚', at: '2026/11/20 10:00', ts: 2 };
    expect(R.formalReq(it)).toBe(true);
  });
});
