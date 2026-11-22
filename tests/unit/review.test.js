/* 階段 7：護理逐欄核對的純規則（rules/review.js）與原型第 (18) 版的同名函式逐一比對。
 * 原型函式直接從 reference/prototype_v18.html 取出原始碼執行（不是手抄的期望值）。 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as N from '../../js/modules/rules/review.js';

const lines = readFileSync(new URL('../../reference/prototype_v18.html', import.meta.url), 'utf8').split('\n');
const one = p => lines.find(l => l.startsWith(p));
const fn = p => { const a = lines.findIndex(l => l.startsWith(p)); let b = a; while (lines[b] !== '}') b++; return lines.slice(a, b + 1).join('\n'); };
const O = new Function(`
  ${one('const ABSENT_VALS')}
  ${one('const LAB_FLAGS')}
  ${fn('function parseLabRows(text){')}
  ${one('const dxActive = f =>')}
  ${fn('function dxRecalc(f){')}
  ${one('const dxSplit = raw =>')}
  ${one('const dxKey = x =>')}
  ${one('const dxDup = (f, p) =>')}
  ${one('const fActive = (F, f) =>')}
  ${fn('function fieldSrc(f){')}
  ${fn('function overallSrc(fields){')}
  ${one('const ICD_RE =')}
  return { ABSENT_VALS, LAB_FLAGS, parseLabRows, dxActive, dxRecalc, dxSplit, dxKey, dxDup, fActive, fieldSrc, overallSrc, ICD_RE };
`)();

const LABS = ['Hb｜11.2｜g/dL｜12–16｜L', 'WBC|6800|/uL|4000-10000', '文字判讀：心肺無明顯異常', '文件未記載', 'Hb｜11.2', 'Na｜140｜mmol/L｜135-145｜X', 'Cr｜1.1｜mg/dL｜0.6-1.2｜無\nK｜5.6｜mmol/L｜3.5-5.1｜H', '', '  \n  '];
const DX = ['腦中風後遺症（右側上肢無力）、高血壓、第二型糖尿病', '1. 高血壓 2. 糖尿病', '高血壓\n糖尿病；失智症,骨折', '文件未記載', '', '單一診斷'];

describe('檢驗數值格式（parseLabRows）', () => { for (const t of LABS) it(JSON.stringify(t), () => expect(N.parseLabRows(t)).toEqual(O.parseLabRows(t))); });
describe('診斷依標點拆分（dxSplit）與重複判斷（dxKey）', () => {
  for (const t of DX) it(JSON.stringify(t), () => { expect(N.dxSplit(t)).toEqual(O.dxSplit(t)); expect(N.dxKey(t)).toBe(O.dxKey(t)); });
});
describe('診斷欄位重新計算（dxRecalc）、重複列（dxDup）', () => {
  const rows = (...st) => st.map((s, n) => ({ n: n + 1, raw: '診斷' + n, text: '診斷' + n + (s === '改' ? '改' : ''), state: s === '改' ? '已確認' : s, src: n === 0 ? 'AI 辨識（第 1 次，整段）' : '人工新增', by: 'u1', at: `2026/11/2${n} 10:00` }));
  const cases = [{ rows: [] }, { rows: rows('待確認') }, { rows: rows('已確認', '已確認') }, { rows: rows('已確認', '不採用') }, { rows: rows('改', '已確認') }, { rows: rows('不採用') }, { absent: true, absentVal: '文件未記載', rows: [] }];
  cases.forEach((c, n) => it('情境 ' + (n + 1), () => {
    const a = N.dxRecalc({ type: 'dxlist', rawOrig: '原文', ...JSON.parse(JSON.stringify(c)) }), b = O.dxRecalc({ type: 'dxlist', rawOrig: '原文', ...JSON.parse(JSON.stringify(c)) });
    expect(a).toEqual(b);
    expect(N.dxActive(a)).toEqual(O.dxActive(b));
    for (const p of ['診斷0', '診斷1改', '其他']) expect(N.dxDup(a, p)).toEqual(O.dxDup(b, p));
  }));
});
describe('欄位來源說明（fieldSrc、overallSrc）與依條件顯示（fActive）', () => {
  const F = [{ k: 'a', val: 'x', orig: 'x', auto: true, run: 1 }, { k: 'b', val: 'y', orig: 'x', auto: true, run: 2 }, { k: 'c', val: '人工', auto: false }, { k: 'd', val: '', auto: false },
    { k: 'dx', type: 'dxlist', run: 1, rows: [{ src: 'AI 辨識（第 1 次，整段）', raw: 'a', text: 'a' }] }, { k: 'dx2', type: 'dxlist', rows: [{ src: '人工新增', raw: '', text: 'b' }] }, { k: 'dx3', type: 'dxlist', absent: true, val: '文件未記載' }];
  for (const f of F) it('fieldSrc ' + f.k, () => expect(N.fieldSrc(f)).toBe(O.fieldSrc(f)));
  for (const pick of [[0], [0, 1], [2], [0, 2], [3], [0, 1, 2, 3], []]) it('overallSrc ' + pick.join(','), () => { const fs = pick.map(i => F[i]); expect(N.overallSrc(fs)).toBe(O.overallSrc(fs)); });
  it('fActive', () => { const FF = [{ k: 'stype', val: '住院出院摘要' }, { k: 'dc', when: { k: 'stype', in: ['住院出院摘要'] } }, { k: 'x', when: { k: 'stype', in: ['門診'] } }]; for (const f of FF) expect(N.fActive(FF, f)).toBe(O.fActive(FF, f)); });
  it('ICD-10-CM 格式', () => { for (const s of ['I69.354', 'E11.9', 'U07.1', 'i69', 'I6', 'Z99.89', 'A00.12345']) expect(N.ICD_RE.test(s)).toBe(O.ICD_RE.test(s)); });
  it('常數相同', () => { expect(N.ABSENT_VALS).toEqual(O.ABSENT_VALS); expect(N.LAB_FLAGS).toEqual(O.LAB_FLAGS); });
});
