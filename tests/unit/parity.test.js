/* 原型 vs 新版規則：同一份輸入，結果必須完全相同。
 * 對照資料 fixtures/parity.json.gz 是用「原型 v18 的函式」實際算出來的（產生方式見 tests/parity/gen.spec.js）。
 * 這裡把同一份輸入交給新版 js/modules/rules/core.js，逐項比對：
 *   案件：phase、家屬進度條、分配狀態、同意狀態、習慣卡狀態與 habitGate、摘要卡變更、處理歷程…
 *   文件：status、是否完成、家屬待辦、補件狀態、期限、需求說明、核對層級…
 *   角色（行政、兩位護理師、家屬）：tasks、等待其他角色、已完成工作、補件追蹤 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createRules } from '../../js/modules/rules/core.js';

const F = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/parity.json.gz', import.meta.url))));
const pickT = x => ({ kind: x.kind || null, cid: x.c ? x.c.id : null, tag: x.tag || null, tone: x.tone || null, what: x.what, why: x.why || null, btn: x.btn || null, go: x.go || null });

/* 每個案件跑一次新版規則，回傳和原型相同格式的結果 */
function compute(s){
  const D = { cases: { [s.c.id]: s.c }, items: s.items, accounts: F.accounts, settings: F.settings, docKeys: F.docKeys };
  const R = createRules(D, { today: F.today }), c = s.c, nx = R.nextStage(c);
  const out = { case: {
    phase: R.phase(c), famPhase: R.famPhase(c), familyStep: R.familyStep(c), stepsInfo: R.stepsInfo(c), assignState: R.assignState(c),
    consentState: R.consentState(c), habitState: R.habitState(c), habitGate: R.habitGate(c), habitFamState: R.habitFamState(c), habitFamLabel: R.habitFamLabel(c),
    cardChanged: R.cardChanged(c), docsReady: R.docsReady(c), listOk: R.listOk(c), nextStage: { text: nx.text, later: nx.later.map(i => i.id) },
    timeline: R.caseTimeline(c).map(e => ({ t: e.t, at: e.at, by: e.by, note: e.note, kind: e.kind })), lastAt: R.lastAt(c), dxPending: !!R.dxPending(c),
    cardDiffs: R.cardDiffs(c), habitStatus: R.habitStatus(c), canProcess: R.canProcess(c), contractSigned: R.contractSigned(c)
  }, items: {}, roles: {} };
  for (const i of Object.values(s.items)) out.items[i.id] = {
    status: R.status(i, c), isDone: R.isDone(i, c), familyTodo: R.familyTodo(i, c), tracked: R.tracked(i), reqState: R.reqState(i, c), dueOf: R.dueOf(i, c),
    overdue: R.overdue(i, c), needText: R.needText(i), familyNeedText: R.familyNeedText(i), checks: R.checks(i, c), openFormalReq: R.openFormalReq(i, c), reqCloseMissing: R.reqCloseMissing(i, c)
  };
  for (const id of ['staff@example.com', 'nurse@example.com', 'nurse2@example.com', c.familyId]){
    const me = F.accounts[id], Rm = createRules(D, { me, today: F.today });
    out.roles[id] = {
      tasks: Rm.tasks().map(pickT), waiting: Rm.waitingOthers(c), doneOf: Rm.doneOf(c).map(e => ({ t: e.t, at: e.at, kind: e.kind })),
      doneWork: Rm.doneWork().map(e => ({ cid: e.c.id, t: e.t, at: e.at, kind: e.kind })),
      followup: Rm.followupRows().map(r => ({ cid: r.c.id, iid: r.i.id, st: r.st, fam: r.fam, due: r.due, od: r.od })),
      myFamilyCases: me.role === 'family' ? Rm.myFamilyCases().map(x => x.id) : null
    };
  }
  return out;
}

describe(`原型 v18 規則對照（${F.scenarios.length} 個情境，基準日 ${F.today}）`, () => {
  F.scenarios.forEach((s, n) => {
    it(`#${n} ${s.input.c.patient.name}（${s.out.case.phase}）`, () => {
      /* 規則可能改動輸入（原型也是），每次用一份新的複本 */
      const input = JSON.parse(JSON.stringify(s.input));
      expect(compute(input)).toEqual(s.out);
    });
  });
});
