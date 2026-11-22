/* 階段 8：照顧摘要卡規則（rules/card.js）與原型第 (18) 版的同名函式逐一比對。
 * 原型函式直接從 reference/prototype_v18.html 取出原始碼執行；兩邊都用同一組「案件規則」替身（confirmedField 等），只比對摘要卡本身的組合邏輯。 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as N from '../../js/modules/rules/card.js';

const lines = readFileSync(new URL('../../reference/prototype_v18.html', import.meta.url), 'utf8').split('\n');
const idx = p => lines.findIndex(l => l.startsWith(p));
const one = p => lines[idx(p)];
const until = (p, end) => { const a = idx(p); let b = a; while (!lines[b].startsWith(end)) b++; return lines.slice(a, b + 1).join('\n'); };
const O = new Function('confirmedField', 'dxText', 'habitLines', 'cardDiffs', `
  ${one('const CARD_A = ')}
  ${one('const CARD_B = ')}
  ${one('const SRC_TAG = ')}
  ${until('const HINT_RULES = [', '];')}
  ${until('const LANG = {', '};')}
  ${one('function hintOptions(c){')}
  ${until('function cardFromData(c){', '}')}
  ${until('function buildCard(c){', '}')}
  return { CARD_A, CARD_B, SRC_TAG, HINT_RULES, LANG, hintOptions, cardFromData, buildCard };
`);

/* 三種情境的案件規則替身 */
const SCEN = [
  { f: { meds: 'Aspirin 100mg QD\nMetformin 500mg BID', tube: '鼻胃管', tubeCare: '每月更換', allergy: '盤尼西林', wound: '', woundCare: '', swallow: '', mobility: '需一人協助' }, dx: '高血壓、糖尿病', hl: { call: '阿嬤', comm: '台語' }, diffs: [{ k: 'allergy', label: '過敏', fam: '無', conf: '盤尼西林' }], c: { assessment: { move: '一人協助' }, habit: { rev: 2 } } },
  { f: { meds: 'Warfarin 3mg\nAmlodipine 5mg', tube: '無', swallow: '需軟質或剁碎', allergy: '無已知過敏' }, dx: '', hl: {}, diffs: [], c: { card: { v: 2 } } },
  { f: {}, dx: '', hl: { call: '' }, diffs: [], c: {} }
];
const R = s => ({ confirmedField: (c, k) => s.f[k] || '', dxText: () => s.dx, habitLines: () => ({ ...s.hl }), cardDiffs: () => s.diffs.map(x => ({ ...x })) });

describe('照顧摘要卡規則', () => {
  it('常數（欄位、來源標籤、用藥提示規則、三種語言的欄位標題）相同', () => {
    const o = O(() => '', () => '', () => ({}), () => []);
    expect(N.CARD_A).toEqual(o.CARD_A); expect(N.CARD_B).toEqual(o.CARD_B); expect(N.SRC_TAG).toEqual(o.SRC_TAG); expect(N.LANG).toEqual(o.LANG);
    expect(N.HINT_RULES.map(([re, t]) => [String(re), t])).toEqual(o.HINT_RULES.map(([re, t]) => [String(re), t]));
  });
  SCEN.forEach((s, n) => it('情境 ' + (n + 1) + '：hintOptions、cardFromData、buildCard', () => {
    const r = R(s), mine = N.cardRules(r), o = O(r.confirmedField, r.dxText, r.habitLines, r.cardDiffs);
    expect(mine.hintOptions(s.c)).toEqual(o.hintOptions(s.c));
    expect(mine.cardFromData(s.c)).toEqual(o.cardFromData(s.c));
    expect(mine.buildCard(s.c)).toEqual(o.buildCard(s.c));
  }));
});
