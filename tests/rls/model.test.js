/* 資料庫 → get_case_models → 資料轉換（services/model.js）→ 業務規則，結果要與原型相同。
 *
 * 前提：npm run db:seed-cases 已把原型的 4 筆測試案件（T-A～T-D）寫進測試專案。
 * 對照答案：tests/unit/fixtures/parity.json.gz 裡，原型對同一份案件算出的結果。
 * 以行政、兩位護理師、家屬的身分實際登入（RLS 與 RPC 的權限都會生效），各自比對：
 *   案件階段、家屬進度條、分配狀態、習慣卡狀態、摘要卡變更、每份文件的狀態，以及該角色的待辦與等待事項。
 * 這也驗證了：護理只能讀 B／C／D 類文件內容，但算出來的案件階段與行政相同。 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { as } from './helpers.js';
import { _buildCase, toAccount } from '../../js/modules/services/model.js';
import { createRules } from '../../js/modules/rules/core.js';

const F = JSON.parse(gunzipSync(readFileSync(new URL('../unit/fixtures/parity.json.gz', import.meta.url))));
const BASES = [];
for (const s of F.scenarios){ if (s.input.c.id.startsWith('TEST-') && !BASES.some(b => b.input.c.id === s.input.c.id)) BASES.push(s); }

/* 以某個身分讀取並建立模型（同一身分只讀一次） */
const models = new Map();
const modelAs = email => { if (!models.has(email)) models.set(email, loadAs(email)); return models.get(email); };
async function loadAs(email){
  const db = await as(email);
  const [m, p, me] = await Promise.all([db.rpc('get_case_models', { p_case: null }), db.from('profiles').select('*'), db.auth.getUser()]);
  if (m.error) throw m.error; if (p.error) throw p.error;
  const accounts = Object.fromEntries(p.data.map(x => [x.id, toAccount(x)]));
  const D = { cases: {}, items: {}, accounts, settings: F.settings, docKeys: F.docKeys };
  for (const row of m.data){ const { c, items } = _buildCase(row, accounts); D.cases[c.id] = c; Object.assign(D.items, items); }
  const meAcc = accounts[me.data.user.id];
  return { D, R: createRules(D, { me: meAcc, today: F.today }), meAcc, accounts };
}

/* 原型答案裡的 email、案件 id、文件 id 轉成正式版的 uuid 形式 */
function translate(x, caseMap, emailToId){
  return JSON.parse(JSON.stringify(x), (k, v) => {
    if (typeof v !== 'string') return v;
    if (emailToId[v]) return emailToId[v];
    const m = v.match(/^(TEST-[A-D])(_\w+)?$/);
    return m && caseMap[m[1]] ? caseMap[m[1]] + (m[2] || '') : v;
  });
}

let staff;
beforeAll(async () => { staff = await modelAs('staff@example.com'); });

describe('資料庫讀回的測試案件，規則結果與原型相同', () => {
  for (const s of BASES){
    const c0 = s.input.c, exp = s.out;
    describe(`${c0.no} ${c0.patient.name}（原型：${exp.case.phase}）`, () => {
      const ctx = {};
      beforeAll(() => {
        const c = Object.values(staff.D.cases).find(x => x.no === c0.no);
        if (!c) throw new Error(`資料庫沒有 ${c0.no}，請先執行 npm run db:seed-cases`);
        ctx.caseMap = { [c0.id]: c.id };
        ctx.emailToId = Object.fromEntries(Object.values(staff.accounts).map(a => [a.email, a.id]));
        ctx.tr = x => translate(x, ctx.caseMap, ctx.emailToId);
        ctx.cid = c.id;
      });

      it('行政：案件階段、進度條、分配、習慣卡、摘要卡變更', () => {
        const R = staff.R, c = staff.D.cases[ctx.cid];
        expect({ phase: R.phase(c), famPhase: R.famPhase(c), familyStep: R.familyStep(c), stepsInfo: R.stepsInfo(c), assignState: R.assignState(c), consentState: R.consentState(c),
          habitState: R.habitState(c), habitGate: R.habitGate(c), cardChanged: R.cardChanged(c), docsReady: R.docsReady(c), listOk: R.listOk(c), canProcess: R.canProcess(c) })
          .toEqual({ phase: exp.case.phase, famPhase: exp.case.famPhase, familyStep: exp.case.familyStep, stepsInfo: exp.case.stepsInfo, assignState: exp.case.assignState, consentState: exp.case.consentState,
            habitState: exp.case.habitState, habitGate: exp.case.habitGate, cardChanged: exp.case.cardChanged, docsReady: exp.case.docsReady, listOk: exp.case.listOk, canProcess: exp.case.canProcess });
      });

      it('行政：每份文件的狀態、是否完成、家屬待辦、期限', () => {
        const R = staff.R, c = staff.D.cases[ctx.cid];
        const got = Object.fromEntries(R.caseItems(c.id).map(i => [i.id, { status: R.status(i, c), isDone: R.isDone(i, c), familyTodo: R.familyTodo(i, c), dueOf: R.dueOf(i, c), needText: R.needText(i) }]));
        /* 原型答案的 key 是「TEST-A_文件key」，換成正式版的「案件uuid_文件key」 */
        const want = Object.fromEntries(Object.entries(exp.items).map(([id, o]) => [id.replace(c0.id, ctx.cid), { status: o.status, isDone: o.isDone, familyTodo: o.familyTodo, dueOf: o.dueOf, needText: o.needText }]));
        expect(got).toEqual(want);
      });

      for (const who of ['staff@example.com', 'nurse@example.com', 'nurse2@example.com', c0.familyId]){
        it(`${who}：待辦、等待其他角色、補件追蹤`, async () => {
          const { D, R } = who === 'staff@example.com' ? staff : await modelAs(who);
          const c = D.cases[ctx.cid], e = ctx.tr(exp.roles[who]);
          const pickT = x => ({ kind: x.kind || null, cid: x.c ? x.c.id : null, tag: x.tag || null, tone: x.tone || null, what: x.what, why: x.why || null, btn: x.btn || null, go: x.go || null });
          const mine = R.tasks().map(pickT).filter(t => t.cid === ctx.cid);
          expect(mine).toEqual(e.tasks.filter(t => t.cid === ctx.cid));
          if (c){
            expect(R.waitingOthers(c)).toEqual(e.waiting);
            expect(R.phase(c)).toBe(exp.case.phase);     // 每個看得到這個案件的角色，算出來的階段都一樣
          } else {
            expect(e.tasks.filter(t => t.cid === ctx.cid)).toEqual([]);   // 看不到案件的角色，原型也沒有這個案件的待辦
          }
          expect(R.followupRows().filter(r => r.c.id === ctx.cid).map(r => ({ cid: r.c.id, iid: r.i.id, st: r.st, fam: r.fam, due: r.due, od: r.od })))
            .toEqual(c ? e.followup.filter(r => r.cid === ctx.cid) : []);
        });
      }
    });
  }
});
