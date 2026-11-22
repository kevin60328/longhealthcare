/* 階段 6：收件核對規則（rules/receipt.js）與原型第 (18) 版的同名函式逐一比對。
 * 原型函式直接從 reference/prototype_v18.html 取出原始碼執行（不是手抄的期望值），確保移轉後結果相同。
 * 另外比對護理核對欄位定義（rules/fields.js）與原型 fieldDefs 產生的欄位 key 與名稱。 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as N from '../../js/modules/rules/receipt.js';
import { fieldDefs, FIELD_DEFS } from '../../js/modules/rules/fields.js';
import { NEED_WORD } from '../../js/modules/rules/core.js';

const lines = readFileSync(new URL('../../reference/prototype_v18.html', import.meta.url), 'utf8').split('\n');
const grab = (from, to) => { const a = lines.findIndex(l => l.startsWith(from)), b = lines.findIndex((l, i) => i > a && l.startsWith(to)); return lines.slice(a, b).join('\n'); };
/* 原型的收件核對函式（ID_ROWS … BIRTH_TONE）與欄位定義（LAB_PH、FIELD_DEFS、examDefs、fieldDefs） */
const O = new Function('NEED_WORD', `
  const pad = n => String(n).padStart(2, '0');
  const isDate = s => /^\\d{4}-\\d{2}-\\d{2}$/.test(s || '');
  ${lines.find(l => l.startsWith('const LAB_PH'))}
  ${grab('const ID_ROWS', 'function birthCmpHtml')}
  ${grab('const FIELD_DEFS = {', '/* 體檢報告')}
  ${grab('function examDefs(it){', '/* 效期項目')}
  ${lines.find(l => l.startsWith('const fieldDefs ='))}
  return { idProfile, normBirth, birthCompare, birthSlash, MANUAL_HOW, ID_ROWS, ID_LABEL, BIRTH_TONE, fieldDefs, FIELD_DEFS };
`)(NEED_WORD);

const RAWS = ['', '  ', '民國31年3月15日', '民國 31 年 03 月 15 日', '民31.3.15', 'ROC31/03/15', '1942/03/15', '1942-3-15', '西元1942年3月15日', '19420315',
  '31.03.15', '031-3-15', '82歲', '年齡：82', '民國31年2月30日', '1942/13/01', '1870/01/01', '2999/01/01', '民國31年3月', 'abc', '民國 31 年 3 月 15 日（82 歲）', '１９４２／０３／１５'];

describe('出生日期：民國／西元換算（normBirth）', () => {
  for (const r of RAWS) it(JSON.stringify(r), () => expect(N.normBirth(r)).toEqual(O.normBirth(r)));
});

describe('出生日期比對（birthCompare）：登記日期 × 原始值 × 來源', () => {
  const regs = ['1942-03-15', '1942-03-16', '', 'bad'], srcs = ['AI 辨識', '人工輸入', '文件文字'];
  for (const reg of regs) for (const src of srcs) it(`${reg || '（未登記）'}｜${src}`, () => {
    for (const r of RAWS) expect(N.birthCompare(reg, r, src, '體檢報告')).toEqual(O.birthCompare(reg, r, src, '體檢報告'));
  });
  it('birthSlash', () => { for (const s of ['1942-03-15', '', 'x']) expect(N.birthSlash(s)).toBe(O.birthSlash(s)); });
});

describe('各類文件要核對的欄位（idProfile）與人工核實方式', () => {
  const keys = ['idcopy', 'nhi', 'relProof', 'signerId', 'emergency', 'contract', 'authOther', 'fee', 'payReceipt', 'deposit', 'exam', 'summary', 'meds', 'custom_x'];
  for (const k of keys) it(k, () => expect(N.idProfile({ key: k })).toEqual(O.idProfile({ key: k })));
  it('常數相同', () => { expect(N.MANUAL_HOW).toEqual(O.MANUAL_HOW); expect(N.ID_ROWS).toEqual(O.ID_ROWS); expect(N.ID_LABEL).toEqual(O.ID_LABEL); expect(N.BIRTH_TONE).toEqual(O.BIRTH_TONE); });
});

describe('護理核對欄位定義（fieldDefs）', () => {
  const parts = [{ k: 'cbc', name: '血液常規', need: '必備' }, { k: 'liver', name: '肝功能', need: '選填' }, { k: 'x', name: '不適用項', need: '不適用' }];
  for (const k of Object.keys(O.FIELD_DEFS).concat(['custom_x'])) it(k, () => expect(fieldDefs({ key: k })).toEqual(O.fieldDefs({ key: k })));
  it('體檢報告（依包含項目產生）', () => expect(fieldDefs({ key: 'exam', parts })).toEqual(O.fieldDefs({ key: 'exam', parts })));
  it('FIELD_DEFS 的文件種類相同', () => expect(Object.keys(FIELD_DEFS)).toEqual(Object.keys(O.FIELD_DEFS)));
});
