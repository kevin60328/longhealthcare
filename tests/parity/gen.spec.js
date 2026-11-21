/* 產生「原型 vs 新版規則」對照資料（fixture）。
 * 做法：在 Playwright 打開原型 v18（注入 seed.json 與 mock_db.js），用原型自己的 seedTestCase 建立 4 筆測試案件，
 *       加上 seed 的 2 筆案件，再對每一筆做隨機變化（同意、評估、簽約、習慣卡、摘要卡、文件狀態、補件…），
 *       用「原型的函式」算出 phase、status、tasks 等結果，連同輸入資料存成 tests/unit/fixtures/parity.json.gz（gzip 壓縮）。
 * tests/unit/parity.test.js 再把同一份輸入丟給新版 js/modules/rules/core.js，結果必須完全相同。
 *
 * 執行：npx playwright test --config playwright.parity.config.js
 * 隨機變化用固定種子，重跑結果相同；改了變化規則才需要重新產生。 */
import { test } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROTO_URL = pathToFileURL(resolve('reference/prototype_v18.html')).href;
const INIT = 'window.__SEED=' + readFileSync('reference/seed.json', 'utf8') + ';' + readFileSync('reference/mock_db.js', 'utf8');
/* 每筆基礎案件的變化數：資料完整的 4 筆測試案件多做一些，seed 的 2 筆（剛送出申請）少做一些 */
const VARIANTS = { rich: 70, seed: 15 };

test('產生原型規則對照資料', async ({ page }) => {
  test.setTimeout(240000);
  await page.addInitScript(INIT);
  await page.goto(PROTO_URL);
  await page.waitForSelector('#portal, #loginForm');

  const out = await page.evaluate(async (VARIANTS) => {
    /* ---------- 1. 用原型自己的功能建立測試案件 ---------- */
    me = D.accounts['admin@example.com'];
    for (const s of testSpecs()){ const r = await seedTestCase(s.key); if (!r.ok) throw new Error('seedTestCase 失敗：' + r.fails.join('、')); }

    /* ---------- 2. 輸入資料：只留規則會用到的欄位（輸出也是用精簡後的資料算的） ---------- */
    const strip = it => {
      const x = clone(it); ['why', 'where', 'parts', '_dbName'].forEach(k => delete x[k]);
      x.versions = (x.versions || []).map((v, n) => {
        const y = clone(v); ['file', 'review', 'labs', 'fhir', 'reviewSrc', 'dateSrc', 'reviewDraft', 'ai', 'ocr', 'ocrLog', 'ocrCount'].forEach(k => delete y[k]);
        if (y.idCheck) y.idCheck = { at: y.idCheck.at, by: y.idCheck.by, ts: y.idCheck.ts, how: y.idCheck.how };
        y.aiDate = aiDate(it, it.versions[n]) || '';   // 原型從 OCR 讀；新版存在版本上
        return y;
      });
      return x;
    };
    const accounts = Object.fromEntries(Object.entries(D.accounts).map(([id, a]) => [id, { id, name: a.name, role: a.role, want: a.want, status: a.status, canAssignNurse: a.canAssignNurse === true }]));
    const bases = Object.values(D.cases).map(c => ({ c: clone(c), items: Object.fromEntries(caseItems(c.id).map(i => [i.id, strip(i)])) }));

    /* ---------- 3. 隨機變化（固定種子） ---------- */
    let seed = 20261121;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = a => a[Math.floor(rnd() * a.length)];
    const T = todayStr(), stampAt = (d, hm) => slash(addDays(T, d)) + ' ' + (hm || '10:00');
    const nurseIds = ['nurse@example.com', 'nurse2@example.com'];
    const MUT = [
      (c) => { c.consent = null; },
      (c) => { c.consent = { signer: '本人', at: stampAt(-5), ver: 1, by: c.familyId, needsProof: false }; },
      (c) => { c.consent = { signer: '監護人', at: stampAt(-5), ver: 1, by: c.familyId, needsProof: true, state: '待代理權核實', proofItem: c.id + '_relProof' }; },
      (c) => { c.consent = { signer: '代理人', at: stampAt(-5), ver: 1, by: c.familyId, needsProof: true, state: '代理權未通過' }; },
      (c) => { if (c.consent) c.consent.withdrawnAt = stampAt(-1); },
      (c) => { c.linkStatus = '待確認'; },
      (c) => { c.linkStatus = '已確認'; c.confirmedAt = stampAt(-6); c.consent = { signer: '本人', at: stampAt(-5), ver: 1, by: c.familyId, needsProof: false }; },
      (c) => { c.closed = { at: stampAt(-1), by: 'staff@example.com', title: '家屬取消申請', reason: '測試' }; },
      (c) => { c.archived = { at: stampAt(0) }; },
      (c) => { c.assessment = pick([null, { result: pick(RESULTS[c.flowMode]), at: stampAt(-1), by: c.nurseId || 'nurse@example.com', mode: c.flowMode, move: '一人協助' }]); },
      (c) => { c.assessment = { result: '需補充', at: stampAt(-2), by: 'nurse@example.com', mode: c.flowMode }; c.assessHistory = [{ result: '待協調', at: stampAt(-3), by: 'nurse@example.com' }]; },
      (c) => { c.signedAt = pick([null, stampAt(-2, '16:00'), '先簽後審，待補登']); c.signedBy = 'staff@example.com'; },
      (c) => { c.flowMode = c.flowMode === '先審後簽' ? '先簽後審' : '先審後簽'; },
      (c) => { c.nurseId = pick(['', ...nurseIds]); },
      (c) => { c.plannedAdmit = addDays(T, pick([-20, 0, 3, 10, 40, 100])); },
      (c) => { c.docList = pick([{ status: '未完成', lastError: { name: '健保卡' } }, { status: '完成' }, null]); },
      (c) => { delete c.habit; },
      (c) => { delete c.habitReview; },
      (c) => { if (c.habitReview) c.habitReview.state = pick(['有疑義', '待確認', '護理已閱', '審核完成']); },
      (c) => { if (c.habit && c.habit.sub){ c.habit.sub = clone(c.habit.sub); c.habit.sub.data = Object.assign({}, c.habit.sub.data, { call: '新稱呼' }); } },
      (c) => { if (c.habit && c.habit.sub){ c.habit.sub.rev = 2; c.habit.rev = 2; } },
      (c) => { if (c.habit){ c.habit.data = Object.assign({}, c.habit.data, { likeFood: '改過的草稿' }); } },
      (c) => { c.habit = { rev: 1, data: { call: '舊資料稱呼' }, updatedBy: c.familyId }; delete c.habitReview; },
      (c) => { c.card = pick([null, { status: '草稿', v: 1 }, { status: '已停用', v: 1, at: stampAt(-1), by: 'nurse@example.com', caregivers: ['care@example.com'] }]); },
      (c) => { if (c.card && c.card.basis){ c.card.basis = Object.assign({}, c.card.basis, { meds: '改過的用藥', move: '不同' }); } },
      (c) => { if (c.card) c.cardDraft = { v: (c.card.v || 1) + 1 }; },
      (c) => { c.cardNeedChange = [{ key: 'tubeCare', ts: Date.now() }]; },
      (c) => { c.diagnoses = pick([[], [{ state: '已確認', raw: '高血壓', std: '本態性高血壓' }], [{ state: 'OCR 錯誤', raw: 'xx' }]]); },
      (c) => { c.preDue = addDays(T, pick([-3, 5])); c.docDue = addDays(T, pick([-3, 5])); },
      (c) => { c.confirmedAt = stampAt(pick([-30, -2])); delete c.docDue; }
    ];
    const IMUT = [
      (i) => { i.versions = []; delete i.returned; },
      (i) => { const v = i.versions.slice(-1)[0]; if (v) v.phase = pick(['received', 'idPending', 'checked']); },
      (i) => { i.versions = (i.versions || []).concat([{ v: (i.versions.length || 0) + 1, at: stampAt(-1, '21:00'), by: 'family@example.com', phase: pick(['received', 'idPending', 'checked']), userDate: pick(['', addDays(T, -3), addDays(T, -400)]), aiDate: '', adminOk: rnd() < 0.5 }]); },
      (i) => { const v = i.versions.slice(-1)[0]; if (v) i.returned = { v: v.v, reason: '不清楚', note: '請重拍', by: 'staff@example.com', at: stampAt(-1) }; },
      (i) => { const v = i.versions.slice(-1)[0]; if (v && i.validDays) v.dateConfirmed = pick(['', addDays(T, -200), addDays(T, -10)]); },
      (i) => { const v = i.versions.slice(-1)[0]; if (v && i.validDays){ delete v.dateConfirmed; v.userDate = pick(['', addDays(T, -5), addDays(T, -300)]); v.aiDate = ''; } },
      (i) => { const v = i.versions.slice(-1)[0]; if (v){ v.nurseOk = !v.nurseOk; v.adminOk = !v.adminOk; } },
      (i) => { i.versions = (i.versions || []).concat([{ v: (i.versions.length || 0) + 1, at: stampAt(-1, '20:00'), by: 'family@example.com', phase: 'received', userDate: '' }]); },
      (i) => { if (i.need === '條件式必備'){ i.condMet = pick([true, false, null]); i.needSetBy = pick(['nurse@example.com', 'staff@example.com']); i.needRole = pick(['nurse', 'staff', undefined]); i.needNote = '測試'; } },
      (i) => { i.req = { source: pick(['護理', '行政', '系統', '護理判斷']), reason: '內容不清楚', at: stampAt(-3), ts: 1000 + Math.floor(rnd() * 1e6), by: 'nurse@example.com', due: addDays(T, pick([-2, 3])), closedAt: pick([null, null, stampAt(-1)]), auto: rnd() < 0.3 }; },
      (i) => { i.reqHistory = [{ source: '行政', reason: '舊的補件', at: stampAt(-9), ts: 5, closedAt: stampAt(-8), uploadedAt: stampAt(-8) }]; },
      (i) => { i.req = { reason: pick(['未上傳', '需補件', '確認過期']), at: stampAt(-2), ts: 7 }; },
      (i) => { i.remind = { n: 2, at: stampAt(-1), due: addDays(T, pick([-1, 4])) }; },
      (i) => { i.needAsk = { by: 'staff@example.com', at: stampAt(-1), note: '家屬說有傷口', doneAt: pick([null, stampAt(0)]) }; },
      (i) => { const v = i.versions.slice(-1)[0]; if (v && i.key === 'summary'){ v.nurseOk = true; v.dxRows = { rows: [{ n: 1, state: '已確認', raw: '糖尿病' }] }; } },
      (i, items) => { delete items[i.id]; }
    ];
    const scenarios = [];
    for (const b of bases){
      scenarios.push({ c: clone(b.c), items: clone(b.items) });
      const nv = b.c.linkStatus === '已確認' ? VARIANTS.rich : VARIANTS.seed;
      for (let n = 0; n < nv; n++){
        const c = clone(b.c), items = clone(b.items);
        const k = 1 + Math.floor(rnd() * 4);
        for (let m = 0; m < k; m++) pick(MUT)(c);
        const ik = Math.floor(rnd() * 6);
        for (let m = 0; m < ik; m++){ const ids = Object.keys(items); if (!ids.length) break; const it = items[pick(ids)]; if (it) pick(IMUT)(it, items); }
        scenarios.push({ c, items });
      }
    }

    /* ---------- 4. 用原型的函式計算結果 ---------- */
    const saveC = D.cases, saveI = D.items;
    const pickT = x => ({ kind: x.kind || null, cid: x.c ? x.c.id : null, tag: x.tag || null, tone: x.tone || null, what: x.what, why: x.why || null, btn: x.btn || null, go: x.go || null });
    const res = scenarios.map(s => {
      D.cases = { [s.c.id]: s.c }; D.items = s.items;
      const c = s.c, outp = { case: {}, items: {}, roles: {} };
      const nx = nextStage(c);
      Object.assign(outp.case, {
        phase: phase(c), famPhase: famPhase(c), familyStep: familyStep(c), stepsInfo: stepsInfo(c), assignState: assignState(c),
        consentState: consentState(c), habitState: habitState(c), habitGate: habitGate(c), habitFamState: habitFamState(c), habitFamLabel: habitFamLabel(c),
        cardChanged: cardChanged(c), docsReady: docsReady(c), listOk: listOk(c), nextStage: { text: nx.text, later: nx.later.map(i => i.id) },
        timeline: caseTimeline(c).map(e => ({ t: e.t, at: e.at, by: e.by, note: e.note, kind: e.kind })), lastAt: lastAt(c), dxPending: !!dxPending(c),
        cardDiffs: cardDiffs(c), habitStatus: habitStatus(c), canProcess: canProcess(c), contractSigned: contractSigned(c)
      });
      for (const i of Object.values(s.items)) outp.items[i.id] = {
        status: status(i, c), isDone: isDone(i, c), familyTodo: familyTodo(i, c), tracked: tracked(i), reqState: reqState(i, c), dueOf: dueOf(i, c),
        overdue: overdue(i, c), needText: needText(i), familyNeedText: familyNeedText(i), checks: checks(i, c), openFormalReq: openFormalReq(i, c), reqCloseMissing: reqCloseMissing(i, c)
      };
      for (const id of ['staff@example.com', 'nurse@example.com', 'nurse2@example.com', c.familyId]){
        me = D.accounts[id];
        outp.roles[id] = {
          tasks: tasks().map(pickT), waiting: waitingOthers(c), doneOf: doneOf(c).map(e => ({ t: e.t, at: e.at, kind: e.kind })),
          doneWork: doneWork().map(e => ({ cid: e.c.id, t: e.t, at: e.at, kind: e.kind })),
          followup: followupRows().map(r => ({ cid: r.c.id, iid: r.i.id, st: r.st, fam: r.fam, due: r.due, od: r.od })),
          myFamilyCases: me.role === 'family' ? myFamilyCases().map(x => x.id) : null
        };
      }
      return { input: s, out: outp };
    });
    D.cases = saveC; D.items = saveI;
    return { today: T, accounts, settings: D.settings, docKeys: DOC_LIST.map(r => r.key), scenarios: res };
  }, VARIANTS);

  mkdirSync('tests/unit/fixtures', { recursive: true });
  writeFileSync('tests/unit/fixtures/parity.json.gz', gzipSync(JSON.stringify(out)));
  console.log(`scenarios: ${out.scenarios.length}, today: ${out.today}, size: ${(JSON.stringify(out).length / 1e6).toFixed(2)} MB`);
});
