/* assessment.html：護理核對與評估（HANDOFF 6.1、6.2；原型第 (18) 版 nurseResidents、nurseResident、nurseNeedCard（need-edit）、
 * nurseReview（逐欄核對、診斷逐筆核對、核對草稿、AI 辨識）、dxCard（dx-edit／import／resync）、habitReviewBox（habit-review）、nurseSupp、nurseAssess）。
 * 畫面與文字沿用原型。只有承辦護理師可以使用（資料庫的 RPC 會再檢查一次）。
 *
 * 網址：
 *   assessment.html[?view=residents]        負責住民
 *   assessment.html?case=<id>               住民資料：案件資訊、進度、已確認的資料、習慣卡初審、診斷清單、照護文件需求確認、文件
 *   assessment.html?view=review&item=<id>   醫療內容逐欄核對（文件＋版本各自保存草稿）
 *   assessment.html?view=supp&item=<id>     護理補充評估（醫院沒有提供獨立紀錄時）
 *   assessment.html?view=assess&case=<id>   收治評估／入住前護理確認
 *   from=home：從工作清單進來（返回連結與導覽列分頁回到工作清單）
 *
 * 寫入一律呼叫資料庫 RPC（migrations/…000028_assessment.sql）：一個交易內檢查承辦身分與狀態、寫入、通知家屬、記錄操作紀錄。
 * 核對頁的輸入保存在記憶體，每次確認或按「儲存草稿」都寫入資料庫草稿；寫入成功才顯示「草稿已儲存」，失敗保留輸入與未儲存狀態（原型相同）。
 * 補件（退回、需求判斷需要、評估需補充）建立後，呼叫 send-mail 補寄 Email 通知（模擬）。 */
import { bootPage } from '../page.js';
import { supabase } from '../api/supabase.js';
import { loadModel, invalidateModel, toStamp } from './services/model.js';
import { openFile, OCR_TYPES } from './services/files.js';
import { syncReqMails } from './mail-ui.js';
import { esc, pill, toast, modal, purpose, errText, setFlash } from '../ui.js';
import { timelineCard } from './family-ui.js';
import { TONE, PHASE_TONE, ASSIGN_TONE, NEED_TONE, CATS, HABIT_LABEL, RESULTS, PASS, slash, uiT, isDate } from './rules/core.js';
import { fieldDefs } from './rules/fields.js';
import { ABSENT_VALS, parseLabRows, dxActive, dxRecalc, dxSplit, dxKey, dxDup, fActive, fieldSrc, overallSrc, ICD_RE } from './rules/review.js';

const P = (t, tone) => pill(t, tone || TONE[t] || 'mute');
const backLink = (href, text) => `<a class="back" href="${href}">← ${esc(text)}</a>`;
const forNurse = uiT;
const HR_TONE = { '尚未提交': 'warn', '審核完成': 'ok', '待審核': 'warn', '有疑義／待確認': 'bad', '資料已變更，需重新確認': 'warn', '尚未填寫': 'mute' };
const CARD_B = [['call', '慣用稱呼'], ['comm', '語言與溝通'], ['routine', '生活作息'], ['adl', '日常活動協助需求'], ['prefs', '飲食及活動偏好'], ['soothe', '情緒安撫方式'], ['famNote', '其他家屬提供的注意事項']];
const SUPP_SRC = ['電話詢問來源醫院護理站', '入住前訪視或評估', '與家屬會談', '其他已上傳文件內容（請註明）'];
const FHIR_MAP = { stype: 'DocumentReference.type', dx: 'Condition', dc: 'Encounter.period.end', tube: 'DeviceUseStatement（管路）', allergy: 'AllergyIntolerance', wound: 'Condition（傷口／壓傷）', meds: 'MedicationStatement', note: 'MedicationStatement.dosage／note', res: 'Observation', dxCert: 'Condition', certDate: 'DocumentReference.date', labs: 'Observation／DiagnosticReport', nextVisit: 'Appointment' };
const fhirOf = k => FHIR_MAP[k] || (/^p_.*_r$/.test(k) ? 'Observation（檢驗數值）' : /^p_/.test(k) ? 'DiagnosticReport（是否包含此項檢查）' : '—');
const clone = x => JSON.parse(JSON.stringify(x));
/* 台灣時間「YYYY/MM/DD HH:MM」（原型 stamp） */
const stamp = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value])); return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`; };
const done = (msg, url) => { invalidateModel(); if (msg) setFlash(msg); if (url) location.assign(url); else location.reload(); };
const dnrText = c => { const d = c && c.assessment && c.assessment.dnr; return d && d.state ? d.state + (d.src ? '（' + d.src + '）' : '') : '尚未另行確認（病歷摘要沒有記載不代表未簽署）'; };

let ME = null, FROM = '';
const homeUrl = () => 'dashboard.html';
const residentUrl = c => `assessment.html?case=${c.id}${FROM === 'home' ? '&from=home' : ''}`;

bootPage('assessment', async ctx => {
  const { me, view, params, main } = ctx;
  FROM = params.get('from') || '';
  let caseId = params.get('case'); const itemDb = params.get('item');
  if (itemDb && !caseId){ const { data } = await supabase().from('documents').select('case_id').eq('id', itemDb).maybeSingle(); caseId = data?.case_id || null; }
  const model = await loadModel(me, caseId ? { caseId } : {});
  ME = model.me;
  const x = { ...ctx, D: model.D, R: model.R, M: model.me };
  if (!caseId) return residentsPage(x);
  const c = model.D.cases[caseId];
  if (!c || c.nurseId !== me.id){ main.innerHTML = `<div class="card stack"><h1>找不到這位住民</h1><p>您不是這位住民的負責護理師，或資料已不存在。</p><a class="btn primary" href="assessment.html">回到負責住民</a></div>`; return; }
  const it = itemDb ? Object.values(model.D.items).find(i => i.dbId === itemDb && i.caseId === c.id) : null;
  if (itemDb && !it){ main.innerHTML = '<div class="card stack"><h1>找不到這份文件</h1><a class="btn primary" href="assessment.html">回到負責住民</a></div>'; return; }
  const y = { ...x, c, it };
  if (view === 'review') return reviewPage(y);
  if (view === 'supp') return suppPage(y);
  if (view === 'assess') return assessPage(y);
  return residentPage(y);
});

/* 無法處理（原型 blocked） */
function blocked(R, c){
  const cs = R.consentState(c);
  const why = cs === '已撤回' ? `家屬已於 ${esc(c.consent.withdrawnAt || '')} 撤回資料授權` : c.archived ? '案件已封存' : c.closed ? '案件已結案' : cs === '未簽署' ? '家屬尚未完成資料授權' : '案件尚未確認';
  return `${backLink(homeUrl(), '回到工作清單')}<div class="card hero bad stack"><h1>無法處理這份資料</h1><p>${why}，系統已停止依原授權進行新的資料存取與處理。既有資料依結案與保存規則處理。</p></div>`;
}
const needPill = (R, it) => pill(R.needText(it), R.notApplicable(it) ? 'mute' : R.condPending(it) ? 'warn' : NEED_TONE[R.needOf(it)]);

/* ========== 負責住民（原型 nurseResidents） ========== */
function residentsPage({ main, D, R, me }){
  const list = Object.values(D.cases).filter(c => c.nurseId === me.id && !c.archived);
  main.innerHTML = `<h1>負責住民</h1><div class="card tbl-wrap"><table><thead><tr><th>住民</th><th>預計入住</th><th>狀態</th><th>文件</th><th></th></tr></thead><tbody id="resRows">
  ${list.map(c => { const its = R.caseItems(c.id).filter(i => R.nurseCanSee(i) && R.tracked(i)), dn = its.filter(i => R.isDone(i, c)).length, wait = its.filter(i => R.status(i, c) === '待護理核對'), p = R.phase(c);
    return `<tr><td>${esc(c.patient.name)}</td><td>${slash(c.plannedAdmit)}</td><td>${pill(p, PHASE_TONE[p])}</td><td class="small">${dn}／${its.length} 份已完成${wait.length ? `<br>待核對：${wait.map(i => esc(i.name)).join('、')}` : ''}</td><td><a class="btn sm" href="assessment.html?case=${c.id}">查看</a></td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">尚無指派的住民</td></tr>'}
  </tbody></table></div>`;
}

/* ========== 住民資料（原型 nurseResident） ========== */
function habitSubLabel(c, rev){
  const h = c.habit || {}, hit = (h.subHist || []).find(x => x.rev === rev);
  return hit ? `第 ${hit.n} 次提交，${hit.at || '舊資料，提交時間未記錄'}` : '舊資料，提交時間未記錄';
}
/* 習慣卡初審（原型 habitReviewBox） */
function habitReviewBox(R, c){
  const st = R.habitState(c);
  if (st === '尚未提交') return `<div class="notice warn small" id="habitReview"><strong>生活與照護習慣卡：</strong>${pill('家屬尚未正式提交', 'warn')}　這是第一階段必要資料；家屬提交後會出現在您的必要待辦。</div>`;
  const hr = c.habitReview || {}, can = c.nurseId === ME.id && R.canProcess(c);
  const diff = R.cardDiffs(c), ch = R.habitChanges(c), last = (hr.hist || []).slice(-1)[0];
  const lastRead = (hr.hist || []).filter(h => h.state === '護理已閱').slice(-1)[0];
  return `<div class="notice ${HR_TONE[st] === 'ok' ? 'ok' : 'info'} small stack" id="habitReview"><div><strong>習慣卡初審：</strong>${pill(st, HR_TONE[st])}${hr.done ? `　最近一次審核完成：${esc(R.accName(hr.done.by))}，${esc(hr.done.at)}（${habitSubLabel(c, hr.done.rev)}）` : ''}${hr.rev != null && R.habitVer(c) > hr.rev ? `<br><strong>家屬已重新提交習慣卡</strong>（${esc((R.habitSub(c) || {}).at || '')}），請重新查看。` : ''}${hr.state === '有疑義' && last ? `<br>疑義：${esc(last.note)}（${esc(R.accName(last.by))}，${esc(last.at)}）` : ''}${lastRead ? `<br><span class="muted">護理已閱（閱讀紀錄）：${esc(R.accName(lastRead.by))}，${esc(lastRead.at)}</span>` : ''}</div>
    ${ch.fam.length || ch.med.length ? `<div id="hrChanged"><strong>審核完成後有變更，只需要重新確認這些項目：</strong><ul style="margin:4px 0 0 18px">${ch.fam.concat(ch.med).map(x => `<li>${esc(x.label)}：「${esc(x.before || '（空白）')}」→「${esc(x.after || '（空白）')}」</li>`).join('')}</ul></div>` : ''}
    ${diff.length ? `<div id="hrDiffs"><strong>與已確認醫療資料不一致（已確認資料不會被覆蓋）：</strong>${diff.map((x, n) => `<div style="margin-top:4px">${esc(x.label)}：家屬「${esc(x.fam)}」／已確認「${esc(x.conf)}」${can ? `<label class="f">處理說明（審核完成前必填）<input type="text" id="hrRes-${n}" placeholder="例：已電話確認，以醫院資料為準" value="${esc(((hr.done && hr.done.diffRes) || []).find(r => r.k === x.k && r.fam === x.fam)?.res || '')}"></label>` : ''}</div>`).join('')}</div>` : ''}
    <span class="muted">第一階段必要資料：家屬正式提交、護理初審完成後，才算必要資料審核完成，才能開始收治評估。初審完成不會開放摘要卡；照服員只能在摘要卡最終審核開放後看到。</span>
    ${can ? `<label class="f">說明<span class="hint">標示有疑義時必填；審核完成可填備註</span><input type="text" id="hrNote"></label><div class="err" id="hrErr" role="alert"></div>
    <div class="row">${st !== '審核完成' ? '<button type="button" class="btn sm primary" data-hr="審核完成">確認習慣卡審核完成</button>' : ''}<button type="button" class="btn sm" data-hr="有疑義">標示有疑義／待確認</button><button type="button" class="btn sm" data-hr="護理已閱">護理已閱（只記錄閱讀）</button></div>` : ''}</div>`;
}
/* 照護文件需求確認（原型 nurseNeedCard） */
function nurseNeedCard(R, c){
  const its = R.caseItems(c.id).filter(R.nurseCond);
  if (!its.length) return '';
  if (!R.canProcess(c)) return '<div class="card" id="needCard"><h2>照護文件需求確認</h2><p class="muted small">家屬完成資料授權後才能判斷。</p></div>';
  const hb = R.habitOf(c), hl = R.habitLines(c);
  const ref = [hb.famHealth ? '家屬所知健康狀況：' + hb.famHealth : '', hl.adl ? '日常活動：' + hl.adl : '', (hb.recent || []).length ? '近期狀況：' + [].concat(hb.recent).join('、') + (hb.recentNote ? '（' + hb.recentNote + '）' : '') : ''].filter(Boolean);
  const conf = [['管路', R.confirmedField(c, 'tube')], ['傷口', R.confirmedField(c, 'wound')], ['吞嚥', R.confirmedField(c, 'swallow')]].filter(([, v]) => v);
  const ups = R.caseItems(c.id).filter(i => ['C', 'D'].includes(R.catOf(i)) && R.cur(i) && R.cur(i).file).map(i => i.name);
  return `<div class="card stack" id="needCard"><h2>照護文件需求確認</h2><p class="small muted">判斷是否需要請家屬提供這些照護資料。不用等文件齊全；資訊不足時請保留「尚待確認」。這不是收治評估。</p>
    <div class="notice info small"><strong>可參考的資料</strong>${ref.length ? '<br>' + ref.map(esc).join('<br>') : '<br>家屬尚未在習慣卡填寫健康與日常狀況'}${conf.length ? '<br>已確認的醫療資料：' + conf.map(([k, v]) => `${k}「${esc(v)}」`).join('、') : ''}<br>已上傳的醫療與照護文件：${ups.length ? esc(ups.join('、')) : '尚無'}</div>
    <div class="tbl-wrap"><table><tbody>${its.map(i => `<tr data-need-row="${esc(i.dbId)}"><th scope="row">${esc(i.name)}<br><span class="small muted">${esc(forNurse(i.cond || ''))}</span></th><td>${needPill(R, i)}${i.needSetBy ? `<br><span class="small muted">${esc(R.accName(i.needSetBy))}，${esc(i.needSetAt || '')}${i.needNote ? '：' + esc(i.needNote) : ''}</span>` : ''}${(i.needHist || []).length ? `<details class="small"><summary>修改歷程（${i.needHist.length}）</summary>${i.needHist.map(h => `<div>${esc(h.at)} ${esc(R.accName(h.by))}：${esc(h.from)} → ${esc(h.to)}${h.note ? '（' + esc(h.note) + '）' : ''}</div>`).join('')}</details>` : ''}<br><span class="small">文件：${P(R.status(i, c))}</span>${R.needAskOpen(i) ? `<div class="notice warn small">行政請您重新判斷（${esc(R.accName(i.needAsk.by))}，${esc(i.needAsk.at)}）：${esc(i.needAsk.note)}</div>` : ''}</td><td>${c.closed ? '' : `<button type="button" class="btn sm ${R.condPending(i) ? 'primary' : ''}" data-need="${esc(i.dbId)}">${R.condPending(i) ? '判斷' : '修改判斷'}</button>`}</td></tr>`).join('')}</tbody></table></div></div>`;
}
/* 診斷清單（原型 dxCard） */
function confirmedSrc(R, c, k){
  for (const it of R.caseItems(c.id)){ const vs = it.versions || []; for (let n = vs.length - 1; n >= 0; n--){ const v = vs[n]; if (v.nurseOk && v.fields){ if (v.fields[k]) return { it, v: v.v }; break; } } }
  return null;
}
function dxCard(R, c){
  const L = c.diagnoses || [], can = c.nurseId === ME.id && R.canProcess(c), src = confirmedSrc(R, c, 'dx'), pend = R.dxPending(c);
  return `<div class="card stack" id="sec-dx"><h2>診斷清單（ICD-10-CM）</h2>${pend ? `<div class="notice bad" id="dxSyncBox"><strong>診斷同步未完成</strong>：${esc(pend.it.name)} 第 ${pend.v.v} 版已逐筆確認 ${pend.v.dxRows.rows.filter(r => r.state === '已確認').length} 筆，診斷清單還缺 ${pend.missing.length} 筆${pend.stale.length ? `、舊版 ${pend.stale.length} 筆尚未標示取代` : ''}。文件核對結果已保存；同步完成前，摘要卡不能開放，也不會把這份清單當成最終內容。${can ? '<br><button type="button" class="btn sm primary" id="dxResync">重試同步診斷</button>' : ''}</div>` : ''}
    <p class="small muted" style="margin:0">一筆一個診斷，保留原始文字、來源文件與版本。<strong>本系統沒有內建 ICD-10-CM 碼表，不會自動產生或建議代碼</strong>；代碼請依院方文件或官方碼表人工輸入，系統只檢查格式。只有「已確認」的診斷會進入照護摘要；預計對應 FHIR Condition（尚未介接）。</p>
    ${L.length ? `<div class="tbl-wrap"><table><thead><tr><th>原始診斷文字</th><th>標準化名稱</th><th>ICD-10-CM</th><th>來源</th><th>狀態</th><th></th></tr></thead><tbody id="dxRows">${L.map((d, n) => `<tr><td>${esc(d.raw)}</td><td>${esc(d.std || '—')}</td><td class="mono">${esc(d.icd || '—')}${d.icdName ? `<br><span class="small">${esc(d.icdName)}</span>` : ''}</td><td class="small">${d.src ? esc(d.src.name) + `（第 ${esc(d.src.v)} 版）` : '人工新增'}</td><td>${d.superseded ? pill('已由新版取代', 'mute') : pill(d.state, d.state === '已確認' ? 'ok' : 'warn')}${d.by ? `<br><span class="small muted">${esc(R.accName(d.by))} ${esc(d.at || '')}</span>` : ''}</td><td>${can ? `<button type="button" class="btn sm" data-dx="${n}">編輯／確認</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <details class="small" id="dxHist"><summary>診斷修改歷程</summary><div id="dxHistBody" class="muted">打開時載入…</div></details>` : `<p class="small">${R.confirmedField(c, 'dx') ? `目前只有病摘核對時確認的診斷文字：「${esc(R.confirmedField(c, 'dx'))}」（舊格式，照護摘要沿用這段文字）。` : '尚無診斷資料。'}</p>`}
    ${can ? `<div class="row">${src ? '<button type="button" class="btn sm" id="dxImport">從已確認的病摘帶入原始診斷</button>' : ''}<button type="button" class="btn sm" data-dx="-1">新增一筆診斷</button></div>` : ''}</div>`;
}
const canSupp = (R, it, c) => c.nurseId === ME.id && R.canProcess(c) && R.listOk(c) && R.catOf(it) === 'D' && R.isNeeded(it) && ['未上傳', '需補件'].includes(R.status(it, c));
function residentPage({ main, R, c }){
  const p = R.phase(c), card = c.card;
  const facts = [['主要診斷', 'dx'], ['管路', 'tube'], ['管路照護', 'tubeCare'], ['傷口', 'wound'], ['傷口照護', 'woundCare'], ['吞嚥與飲食', 'swallow'], ['藥物過敏', 'allergy'], ['用藥', 'meds']].map(([k, f]) => [k, f === 'dx' ? R.dxText(c) : R.confirmedField(c, f)]).concat([['DNR', dnrText(c)]]).filter(([k, v], n) => n < 2 || v || ['藥物過敏', 'DNR', '用藥', '傷口'].includes(k));
  const nvis = R.caseItems(c.id).filter(i => R.nurseCanSee(i) && R.tracked(i)), ndone = nvis.filter(i => R.isDone(i, c)).length;
  const reqs = R.caseItems(c.id).filter(i => R.nurseCanSee(i) && R.openFormalReq(i, c));
  const a = c.assessment, hl = R.habitLines(c), hs = R.habitStatus(c), rows = CARD_B.filter(([k]) => hl[k]);
  const docUrl = i => `documents.html?view=doc&case=${c.id}&item=${i.dbId}`;
  /* 照顧摘要卡的修訂、停用在 care-summary.html（階段 8）；這裡只顯示狀態並連過去 */
  const cardBox = card && card.status !== '草稿' ? `<div class="card stack" id="cardBox"><h2>照顧摘要卡</h2><p>目前：第 ${card.v} 版　${pill(card.status, card.status === '已開放' ? 'ok' : 'mute')}${R.cardChanged(c).length ? ' ' + pill('待重新審核', 'warn') : ''}　審核：${esc(R.accName(card.by))}，${esc(card.at || '')}</p><p><a class="btn" href="care-summary.html?case=${c.id}">管理照顧摘要卡</a></p></div>` : '';
  main.innerHTML = `${backLink(FROM === 'home' ? homeUrl() : 'assessment.html', FROM === 'home' ? '回到工作清單' : '回到負責住民')}<h1>${esc(c.patient.name)}</h1>
  <p class="lead">預計入住 ${slash(c.plannedAdmit)}　${pill(p, PHASE_TONE[p])}</p>
  <nav class="row small" aria-label="個案總覽" style="margin-bottom:10px"><a href="#sec-info">基本資訊</a><a href="#sec-med">已確認醫療資訊</a><a href="#sec-dx">診斷</a><a href="#needCard">照護需求</a><a href="#sec-docs">文件與補件</a><a href="#sec-habit">生活習慣卡</a><a href="#timeline">處理歷程</a></nav>
  <div class="grid2" style="margin-bottom:14px">
    <div class="card" id="sec-info"><h2>案件資訊</h2><table><tbody>
      <tr><th scope="row">案件編號</th><td class="mono">${esc(c.no)}</td></tr><tr><th scope="row">預計入住者</th><td>${esc(c.patient.name)}（${slash(c.patient.birth)}）</td></tr>
      <tr><th scope="row">申請人</th><td>${esc(R.accName(c.familyId))}（${esc(c.relation)}）</td></tr><tr><th scope="row">流程</th><td>${esc(c.flowMode)}</td></tr>
      <tr><th scope="row">申請日期</th><td>${esc(c.createdAt || '—')}</td></tr><tr><th scope="row">護理分配</th><td>${pill(R.assignState(c), ASSIGN_TONE[R.assignState(c)])} ${esc(R.accName(c.nurseId))}</td></tr></tbody></table></div>
    <div class="card"><h2>進度</h2><table><tbody>
      <tr><th scope="row">醫療與照護文件</th><td>${ndone}／${nvis.length} 份已完成</td></tr>
      <tr><th scope="row">缺件與補件</th><td>${reqs.length ? reqs.map(i => `${esc(i.name)}：${esc(R.reqState(i, c))}（期限 ${slash(R.dueOf(i, c)) || '—'}）`).join('<br>') : '沒有開啟中的補件'}</td></tr>
      <tr><th scope="row">${c.flowMode === '先簽後審' ? '入住前確認' : '收治評估'}</th><td>${a ? `${esc(a.result)}（${esc(R.accName(a.by))}，${esc(a.at)}）` : '尚未評估'}<br><span class="small muted">DNR：${esc(dnrText(c))}</span></td></tr>
      <tr><th scope="row">入住契約</th><td>${R.contractSigned(c) ? '已簽約（' + esc(c.signedAt) + '）' : '尚未簽約'}</td></tr>
      <tr><th scope="row">生活習慣卡</th><td>${pill(R.habitState(c), HR_TONE[R.habitState(c)])}</td></tr></tbody></table></div>
  </div>
  <div class="grid2">
    <div class="stack"><div class="card" id="sec-med"><h2>已確認的資料</h2><table><tbody>${facts.map(([k, v]) => `<tr><th scope="row">${k}</th><td style="white-space:pre-line">${esc(v || '待確認')}</td></tr>`).join('')}</tbody></table></div>
      <div class="card" id="sec-habit"><h2>家屬提供之生活資訊</h2><p class="small muted">${hs.filled ? `已填 ${hs.filled}／${hs.total} 區，最後修改 ${esc(hs.at || '')}` : R.hasHabit(c) ? '家屬已正式提交生活與照護習慣卡' : '家屬尚未填寫生活與照護習慣卡'}。未經護理確認，不能取代病歷或評估。</p>${habitReviewBox(R, c)}${rows.length ? `<table><tbody>${rows.map(([k, l]) => `<tr><th scope="row">${l}</th><td>${esc(hl[k])}</td></tr>`).join('')}${R.habitOf(c).famAllergy ? `<tr><th scope="row">家屬所知過敏</th><td>${esc(R.habitOf(c).famAllergy)}${R.cardDiffs(c).length ? ' ' + pill('與已確認資料不同', 'bad') : ''}</td></tr>` : ''}</tbody></table>` : ''}</div>
      <div class="card"><h2>緊急聯絡人</h2>${(c.contacts || []).map((x, n) => `<p style="margin:4px 0">${n ? '第二' : '主要'}：${esc(x.name)}（${esc(x.rel)}）<span class="mono">${esc(x.phone)}</span></p>`).join('') || '<p class="muted">家屬尚未填寫</p>'}<p class="small muted">緊急送醫同意：${c.consent && c.consent.emergency ? '已同意' : '未同意'}</p></div></div>
    <div class="stack">${dxCard(R, c)}${nurseNeedCard(R, c)}<div class="card" id="sec-docs"><h2>健康檢查、醫療與照護文件</h2><div class="tbl-wrap"><table><tbody>${Object.keys(CATS).map(k => { const its = R.caseItems(c.id).filter(i => R.catOf(i) === k && R.nurseCanSee(i) && !R.notApplicable(i)); return its.length ? `<tr class="cat"><th colspan="3">${k}. ${esc(CATS[k])}</th></tr>` + its.map(i => `<tr><td>${esc(i.name)}<br>${needPill(R, i)}</td><td>${P(R.status(i, c))}</td><td>${R.cur(i) ? `<a class="btn sm" href="${docUrl(i)}">看文件</a>` : ''}${canSupp(R, i, c) ? ` <a class="btn sm" href="assessment.html?view=supp&case=${c.id}&item=${i.dbId}">護理補充評估</a>` : ''}</td></tr>`).join('') : ''; }).join('')}</tbody></table></div><p class="small muted">身分證件、契約與費用文件由行政處理，不在這裡顯示。</p></div>
    ${cardBox}</div>
  </div><div style="margin-top:14px">${timelineCard(R, c)}</div>`;
  bindResident(main, R, c);
}

function bindResident(main, R, c){
  /* 習慣卡初審 */
  main.querySelectorAll('[data-hr]').forEach(b => b.addEventListener('click', async () => {
    const st = b.dataset.hr, note = (main.querySelector('#hrNote')?.value || '').trim(), diff = R.cardDiffs(c), err = m => { main.querySelector('#hrErr').textContent = m; };
    if (st === '有疑義' && !note) return err('請說明疑義內容');
    let diffRes = [];
    if (st === '審核完成'){
      diffRes = diff.map((x, n) => ({ k: x.k, fam: x.fam, conf: x.conf, res: String(main.querySelector('#hrRes-' + n)?.value || '').trim() }));
      if (diffRes.some(r => !r.res)) return err('還有與已確認醫療資料不一致的項目沒有處理說明，不能完成審核');
      if (R.habitState(c) === '有疑義／待確認' && !note) return err('目前標示有疑義，請說明疑義如何處理後再完成審核');
    }
    b.disabled = true;
    const { error } = await supabase().rpc('review_habit', { p_case: c.id, p_state: st, p_note: note, p_rev: R.habitVer(c), p_diff_res: diffRes, p_med: R.medSnap(c) });
    if (error){ b.disabled = false; return err('儲存失敗：' + errText(error) + '。審核狀態沒有變更。'); }
    done(st === '審核完成' ? '已完成習慣卡審核' : st === '有疑義' ? '已標示有疑義' : '已記錄護理已閱');
  }));
  /* 照護文件需求判斷（原型 need-edit） */
  main.querySelectorAll('[data-need]').forEach(b => b.addEventListener('click', () => {
    const it = Object.values(R.caseItems(c.id)).find(i => i.dbId === b.dataset.need);
    const curVal = it.condMet === true ? 'yes' : it.condMet === false ? 'no' : '';
    const opts = [['yes', '本案需要', forNurse('住民符合條件：' + (it.cond || '—'))], ['no', '本案不需要', forNurse('住民不符合條件，家屬端顯示「本案不需繳交」')], ['null', '尚待確認', '資訊還不足以判斷；文件不算齊全，也不會列為家屬缺件']];
    modal({ title: `是否需要：${it.name}`, ok: '儲存',
      body: `<p class="small">條件：${esc(forNurse(it.cond || '依住民狀況'))}<br>目前：${needPill(R, it)}　狀態：${P(R.status(it, c))}</p>${R.condPending(it) ? '<p class="small notice warn">這份文件<strong>尚未確認</strong>是否需要，請依個案狀況選擇。</p>' : ''}${R.cur(it) ? '<p class="small muted">已上傳的檔案與審核紀錄都會保留。</p>' : ''}<fieldset data-req><legend>判斷結果</legend>${opts.map(([v, t, h]) => `<label class="choice"><input type="radio" name="needSel" value="${v}" ${v === curVal ? 'checked' : ''}><span><strong>${esc(t)}</strong><br><span class="small muted">${esc(h)}</span></span></label>`).join('')}</fieldset><label class="f">判斷依據／備註（選「本案不需要」時必填）<input type="text" id="needNote" placeholder="例：出院摘要記載有鼻胃管"></label><p class="small muted">可參考家屬提供的狀況、已上傳的病歷摘要與醫療資料、其他機構的護理紀錄或入住前評估。這只是決定要不要請家屬提供文件，不是收治評估。</p>`,
      onOk: async host => {
        const sel = host.querySelector('input[name=needSel]:checked')?.value, note = host.querySelector('#needNote').value.trim();
        if (!sel) return '請選擇本案需要、本案不需要或尚待確認';
        if (!note && sel === 'no') return '選「本案不需要」時請寫簡短原因';
        const { data, error } = await supabase().rpc('set_nurse_need', { p_doc: it.dbId, p_met: sel === 'yes' ? true : sel === 'no' ? false : null, p_note: note });
        if (error) return '儲存判斷失敗：' + errText(error) + '。資料沒有變更，可以再試一次。';
        const extra = (data.requests || []).length ? await syncReqMails(c.id) : '';
        done(['已更新', data.message, extra].filter(Boolean).join('；')); return '';
      } });
  }));
  /* 診斷清單 */
  /* 診斷修改歷程（diagnosis_changes：新增、確認、修改、不採用都有一筆；醫療資料的修改要能追溯，2026/11/28 資料庫清理時決定顯示）。
   * 打開時才讀，只有承辦護理師讀得到（RLS diagnosis_changes_read） */
  main.querySelector('#dxHist')?.addEventListener('toggle', async e => {
    const box = main.querySelector('#dxHistBody'); if (!e.currentTarget.open || box.dataset.loaded) return;
    const ids = (c.diagnoses || []).map(d => d.id), textOf = Object.fromEntries((c.diagnoses || []).map(d => [d.id, d.std || d.raw]));
    const { data, error } = await supabase().from('diagnosis_changes').select('diagnosis_id, from_status, to_status, text_before, text_after, reason, by, at').in('diagnosis_id', ids).order('at');
    if (error){ box.textContent = '讀取修改歷程失敗：' + errText(error) + '。請重新打開。'; return; }
    box.dataset.loaded = '1'; box.classList.remove('muted');
    box.innerHTML = !data.length ? '<p class="muted">沒有紀錄。</p>' : `<div class="tbl-wrap"><table><thead><tr><th>時間</th><th>人員</th><th>診斷</th><th>變更</th><th>說明</th></tr></thead><tbody>${data.map(h => `<tr><td>${esc(toStamp(h.at))}</td><td>${esc(R.accName(h.by))}</td><td>${esc(textOf[h.diagnosis_id] || '')}</td><td>${esc((h.from_status ? h.from_status + ' → ' : '') + h.to_status)}${h.text_before && h.text_before !== h.text_after ? `<br><span class="muted">「${esc(h.text_before)}」→「${esc(h.text_after || '')}」</span>` : ''}</td><td>${esc(h.reason || '')}</td></tr>`).join('')}</tbody></table></div>`;
  });
  main.querySelector('#dxResync')?.addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    const { error } = await supabase().rpc('dx_resync', { p_case: c.id });
    if (error){ e.currentTarget.disabled = false; return toast('同步仍失敗：' + errText(error) + '。資料沒有變更，可以再試一次。'); }
    done('診斷清單已同步');
  });
  main.querySelector('#dxImport')?.addEventListener('click', async e => {
    const text = R.confirmedField(c, 'dx'), src = confirmedSrc(R, c, 'dx');
    if (!text || !src) return toast('沒有已確認的病摘診斷可以帶入');
    if (ABSENT_VALS.includes(text.trim())) return toast('病摘診斷為「' + text + '」，沒有可帶入的內容');
    const parts = text.split(/[、，,；;\n]|\s*\d+[.．、)]\s*/).map(x => x.trim()).filter(Boolean);
    e.currentTarget.disabled = true;
    const { error } = await supabase().rpc('dx_import', { p_case: c.id, p_doc: src.it.dbId, p_v: src.v, p_parts: parts });
    if (error){ e.currentTarget.disabled = false; return toast('帶入診斷失敗：' + errText(error)); }
    done('已帶入，請逐筆確認');
  });
  main.querySelectorAll('[data-dx]').forEach(b => b.addEventListener('click', () => {
    const n = Number(b.dataset.dx), d = n >= 0 ? (c.diagnoses || [])[n] : null;
    modal({ title: d ? '編輯／確認診斷' : '新增診斷', ok: '儲存',
      body: `<label class="f">原始診斷文字${d && d.src ? '（來自文件，不能修改）' : ''}<input type="text" id="dxRaw" value="${esc(d ? d.raw : '')}" ${d && d.src ? 'readonly' : ''}></label>
      <label class="f">標準化診斷名稱<input type="text" id="dxStd" value="${esc(d ? d.std : '')}"></label>
      <div class="grid2"><label class="f">ICD-10-CM 代碼（選填）<span class="hint">例：I69.354。只檢查格式，不代表代碼存在</span><input type="text" id="dxIcd" value="${esc(d ? d.icd : '')}"></label><label class="f">ICD-10-CM 名稱（選填）<input type="text" id="dxIcdName" value="${esc(d ? d.icdName : '')}"></label></div>
      <label class="choice"><input type="checkbox" id="dxOk" ${d && d.state === '已確認' ? 'checked' : ''}><span>我已對照原始文件人工確認這筆診斷（確認後才會進入照護摘要）</span></label>`,
      onOk: async host => {
        const v = s => host.querySelector(s).value.trim(), raw = v('#dxRaw'), icd = v('#dxIcd').toUpperCase(), icdName = v('#dxIcdName');
        if (!raw) return '請填寫原始診斷文字';
        if (icd && !ICD_RE.test(icd)) return 'ICD-10-CM 代碼格式不正確（例：I69.354、E11.9）';
        if (icd && !icdName) return '填寫代碼時請一併填寫 ICD-10-CM 名稱，方便核對';
        const { error } = await supabase().rpc('dx_save', { p_case: c.id, p_id: d ? d.id : null, p_expect_text: d ? d.raw : null, p_raw: raw, p_std: v('#dxStd'), p_icd: icd, p_icd_name: icdName, p_ok: host.querySelector('#dxOk').checked });
        if (error) return '儲存診斷失敗：' + errText(error) + '。資料沒有變更，可以再試一次。';
        done('已儲存'); return '';
      } });
  }));
}

/* ========== 醫療內容逐欄核對（原型 nurseReview） ========== */
let S = null;          // 核對狀態（原型 reviewState）：{ id, v, fields, src, aiRun, editSeq, dirty, savedAt, saveError, newerAi }
let DRAFT = null;      // 資料庫裡這個版本的草稿 { data, updated_at }
let AI = null;         // 這個版本最近一次成功的 AI 辨識 { fields, run, at }
/* 診斷欄位初始化（原型 dxInit／dxNormalize） */
function dxInit(f, aiVal, run){
  const raw = aiVal == null ? '' : String(aiVal).trim();
  f.raw = raw; f.rawOrig = raw; f.absent = false; f.run = run || null;
  f.rows = raw && !ABSENT_VALS.includes(raw) ? [{ n: 1, raw, text: raw, state: '待確認', src: `AI 辨識（第 ${run || '?'} 次，整段）`, by: null, at: null, hist: [{ act: 'AI 帶入（整段，未確認）', val: raw, at: stamp() }] }] : [];
  return dxRecalc(f);
}
function dxNormalize(f){
  if (f.type !== 'dxlist' || Array.isArray(f.rows)) return dxRecalc(f);
  const old = String(f.val || '').trim();
  f.raw = f.raw != null ? f.raw : old; f.rawOrig = f.orig || old; f.rows = [];
  if (old && ABSENT_VALS.includes(old) && f.ok){ f.absent = true; f.absentVal = old; }
  else if (old) f.rows.push({ n: 1, raw: old, text: old, state: '待確認', src: f.auto ? `AI 辨識（第 ${f.run || '?'} 次，整段）` : '舊格式草稿（整段）', by: null, at: null, hist: [{ act: '舊格式草稿轉為一筆待確認' + (f.ok ? '（原本整段已確認，需逐筆重新確認）' : ''), val: old, at: stamp() }] });
  return dxRecalc(f);
}
const dxNewRow = (f, raw, text, src, act) => ({ n: (f.rows || []).reduce((m, r) => Math.max(m, r.n), 0) + 1, raw, text, state: '待確認', src, by: null, at: null, hist: [{ act, val: text, by: ME.id, at: stamp() }] });
/* 草稿內容（原型 draftFromState） */
function draftFromState(st, prev){
  const d = {};
  st.fields.forEach(f => {
    const hist = (f.hist || []).slice(), last = prev && prev.fields && prev.fields[f.k];
    if (last && !f.ok && String(last.val || '') !== String(f.val || '')) hist.push({ act: '人工修改（草稿）', val: f.val, by: ME.id, at: stamp() });
    d[f.k] = { val: f.val, orig: f.orig, auto: !!f.auto, ok: !!f.ok, aiNew: f.aiNew == null ? null : f.aiNew, run: f.run || null, okBy: f.ok ? f.okBy || null : null, okAt: f.ok ? f.okAt || null : null, hist };
    if (f.type === 'dxlist') Object.assign(d[f.k], { raw: f.raw || '', rawOrig: f.rawOrig || '', rows: clone(f.rows || []), absent: !!f.absent, absentVal: f.absentVal || null });
  });
  return { fields: d, src: st.src, aiRun: st.aiRun || null, savedAt: stamp(), by: ME.id, editSeq: st.editSeq || 0 };
}
/* 新的 AI 結果併入草稿：已確認、人工輸入、人工修改的欄位不覆蓋，只提示新結果（原型 mergeAiDraft） */
function mergeAiDraft(it, draft, fresh, run){
  const out = { fields: {}, src: 'AI 辨識', savedAt: stamp(), by: ME.id };
  fieldDefs(it).forEach(def => {
    const k = def.k, nv = fresh[k] == null ? '' : fresh[k], prev = draft && draft.fields && draft.fields[k];
    const hist = ((prev && prev.hist) || []).slice();
    if (def.type === 'dxlist'){
      const p = prev ? dxNormalize(Object.assign({}, def, prev)) : null;
      const touched = p && (p.absent || (p.rows || []).some(r => r.state !== '待確認' || r.edited || !/^AI/.test(r.src || '')));
      if (touched){ out.fields[k] = Object.assign({}, prev, { rows: p.rows, raw: p.raw, rawOrig: p.rawOrig, aiNew: nv && nv !== p.raw ? nv : null }); }
      else { const f = dxInit(Object.assign({}, def, { hist: hist.concat([{ act: nv ? 'AI 帶入（未確認）' : 'AI 未辨識', run, val: nv, at: stamp() }]) }), nv, run); out.fields[k] = { val: f.val, orig: f.orig, auto: f.auto, ok: false, aiNew: null, run, okBy: null, okAt: null, hist: f.hist, raw: f.raw, rawOrig: f.rawOrig, rows: f.rows, absent: false, absentVal: null }; }
      return;
    }
    if (prev && (prev.ok || (!prev.auto && prev.val) || (prev.auto && String(prev.val || '') !== String(prev.orig || '')))) out.fields[k] = Object.assign({}, prev, { aiNew: nv && nv !== prev.val ? nv : null });
    else { hist.push({ act: nv ? 'AI 帶入' : 'AI 未辨識', run, val: nv, at: stamp() }); out.fields[k] = { val: nv, orig: nv, auto: !!nv, ok: false, aiNew: null, run, okBy: null, okAt: null, hist }; }
  });
  return out;
}
/* 建立核對狀態：預填只來自本版本實際執行的 AI 辨識或本版本的核對草稿；沒有就是空白，由護理人工輸入 */
function initState(it, v){
  const defs = fieldDefs(it), dft = DRAFT && DRAFT.data, dr = dft && dft.fields, ex = AI ? AI.fields : {};
  const draftRun = dft ? (dft.aiRun || Math.max(0, ...Object.values(dr || {}).map(f => f.run || 0))) : 0;
  S = { id: it.id, v: v.v, src: AI ? 'AI 辨識' : '人工輸入', aiRun: dft ? draftRun : (AI ? AI.run : null), editSeq: (dft && dft.editSeq) || 0, savedAt: DRAFT ? DRAFT.at : null, fields: defs.map(d => {
    if (dr && dr[d.k]) return dxNormalize(Object.assign({}, d, dr[d.k]));
    if (d.type === 'dxlist') return dxInit(Object.assign({}, d, { ok: false, okBy: null, okAt: null, hist: AI ? [{ act: ex[d.k] ? 'AI 帶入（未確認）' : 'AI 未辨識', run: AI.run || null, val: ex[d.k] || '', at: AI.at }] : [] }), ex[d.k], AI ? AI.run : null);
    const val = ex[d.k] != null ? String(ex[d.k]) : ''; return { ...d, val, orig: val, auto: !!val, ok: false, run: AI ? AI.run || null : null, okBy: null, okAt: null, hist: AI ? [{ act: val ? 'AI 帶入' : 'AI 未辨識', run: AI.run || null, val, at: AI.at }] : [] }; }) };
  /* 草稿之後又有較新的辨識結果：重新開啟時併入，已確認與人工修改的欄位不覆蓋 */
  if (dft && AI && (AI.run || 0) > draftRun){
    const merged = mergeAiDraft(it, draftFromState(S), AI.fields, AI.run);
    S.fields.forEach(f => { const m = merged.fields[f.k]; if (m) Object.assign(f, m); });
    S.aiRun = AI.run; S.src = 'AI 辨識'; S.dirty = true; S.newerAi = AI.run;
  }
}
/* 畫面輸入同步到狀態（原型 syncReviewInputs） */
function syncInputs(main){
  if (!S) return;
  S.fields.forEach((f, i) => {
    const el = main.querySelector('#fv-' + i);
    if (f.type === 'dxlist'){
      if (el && el.value !== (el.dataset.orig || '')){ f.raw = el.value; el.dataset.orig = el.value; }
      (f.rows || []).forEach((r, n) => { const t = main.querySelector(`#dxt-${i}-${n}`); if (t && r.state === '待確認' && t.value !== r.text){ r.hist = (r.hist || []).concat([{ act: '修改（未確認）', val: t.value, by: ME.id, at: stamp() }]); r.text = t.value; r.edited = true; } });
      return;
    }
    if (el && !f.ok && el.value !== (el.dataset.orig || '')){ f.val = el.value; el.dataset.orig = el.value; }
  });
}
const reviewKey = st => JSON.stringify(st.fields.map(f => [f.k, String(f.val == null ? '' : f.val), !!f.ok, f.okBy || null, f.okAt || null]));
/* 儲存草稿：依序排隊；寫入成功才標示已儲存，儲存期間又有修改就維持「未儲存」（原型 saveReviewDraftNow） */
let chain = Promise.resolve();
function saveDraft(ctx){ const p = chain.then(() => saveDraftNow(ctx)); chain = p.catch(() => {}); return p; }
async function saveDraftNow({ main, it }){
  const st = S; if (!st) return { ok: false, reason: '目前沒有開啟核對中的文件' };
  syncInputs(main);
  const seq = st.editSeq || 0, key = reviewKey(st), histLen = Object.fromEntries(st.fields.map(f => [f.k, (f.hist || []).length]));
  const draft = draftFromState(st, DRAFT && DRAFT.data);
  const { data, error } = await supabase().rpc('save_review_draft', { p_doc: it.dbId, p_v: st.v, p_data: draft });
  if (error){ st.dirty = true; st.saveError = errText(error); showDraftState(main); return { ok: false, reason: st.saveError }; }
  DRAFT = { data: draft, at: draft.savedAt, updatedAt: data };
  st.fields.forEach(f => { const saved = draft.fields[f.k]; if (!saved) return; const added = saved.hist.slice(histLen[f.k]); if (added.length){ const h = (f.hist || []).slice(); h.splice(histLen[f.k], 0, ...added); f.hist = h; } });
  st.saveError = null; st.savedAt = draft.savedAt;
  syncInputs(main);
  st.dirty = (st.editSeq || 0) !== seq || reviewKey(st) !== key;
  showDraftState(main);
  return { ok: true, changedDuringSave: st.dirty };
}
function draftStateText(){
  if (S.dirty && S.saveError) return { t: `儲存失敗，內容尚未保存（${S.saveError}）`, c: '--bad' };
  if (S.dirty) return { t: S.savedAt ? `有尚未儲存的變更（上次儲存：${S.savedAt}）` : '有尚未儲存的變更', c: '--warn' };
  return S.savedAt ? { t: `草稿已儲存（${S.savedAt}），尚未完成核對`, c: '--muted' } : { t: '尚未儲存草稿', c: '--muted' };
}
function showDraftState(main){ const el = main.querySelector('#draftState'); if (!el || !S) return; const x = draftStateText(); el.textContent = x.t; el.style.color = `var(${x.c})`; }
window.addEventListener('beforeunload', e => { if (S && S.dirty){ e.preventDefault(); e.returnValue = ''; } });

function dxFieldHtml(f, idx){
  const act = dxActive(f), okN = act.filter(r => r.state === '已確認').length, can = !f.absent;
  const TT = { '待確認': 'warn', '已確認': 'ok', '不採用': 'mute' };
  return `<div class="field risk ${f.ok ? 'done' : ''}" id="dxField">
    <div class="row between"><strong>${esc(f.label)}（逐筆核對）</strong><span class="row">${pill('必須逐項確認', 'bad')}${f.absent ? pill('文件未記載', 'mute') : pill(`診斷已確認 ${okN}／${act.length} 項`, act.length && okN === act.length ? 'ok' : 'warn')}</span></div>
    <label class="f small">文件上的原始診斷文字<span class="hint">AI 辨識或人工輸入的原文。原文不會自動成為已確認診斷，請在下方逐筆確認</span><textarea id="fv-${idx}" data-orig="${esc(f.raw || '')}" rows="3" aria-label="原始診斷文字">${esc(f.raw || '')}</textarea></label>
    ${f.absent ? `<div class="row"><span class="small" style="color:var(--ok)">✓ 已確認：${esc(f.val)}（${esc(nameOf(f.okBy))}，${esc(f.okAt || '')}）</span><button type="button" class="btn sm" data-act="f-undo" data-i="${idx}">修改</button></div>` : `<div class="row">
      ${ABSENT_VALS.includes(String(f.raw || '').trim()) ? '' : `<button type="button" class="btn sm" data-act="dxr-fromraw" data-i="${idx}">原文整段加入為一筆</button>
      <button type="button" class="btn sm" data-act="dxr-split" data-i="${idx}">依標點拆成多筆建議</button>`}
      <button type="button" class="btn sm" data-act="dxr-add" data-i="${idx}">手動新增一筆</button>
      ${!act.length ? (f.quick || []).map(q => `<button type="button" class="btn sm" data-act="f-quick" data-i="${idx}" data-q="${esc(q)}">${esc(q)}</button>`).join('') : ''}</div>
    <p class="small muted" style="margin:0">「拆成多筆建議」只是依頓號、逗號、分號或換行切開，<strong>不保證正確</strong>（例如一個診斷名稱裡本來就有頓號）。每一筆都是待確認，請對照原文修改、確認，或標示 OCR 錯誤／不採用。</p>`}
    ${(f.rows || []).length ? `<div class="tbl-wrap"><table class="dxrows"><thead><tr><th>序號</th><th>原始診斷文字</th><th>核對後文字</th><th>狀態</th><th>確認者／時間</th><th></th></tr></thead><tbody>
      ${f.rows.map((r, n) => `<tr class="dxr" data-state="${esc(r.state)}"><td class="mono">${r.n}</td><td class="small">${esc(r.raw || '（人工新增）')}<br><span class="muted">${esc(r.src || '')}</span></td>
        <td>${r.state === '待確認' && can ? `<input type="text" id="dxt-${idx}-${n}" value="${esc(r.text)}" aria-label="第 ${r.n} 筆核對後文字">` : esc(r.text) || '—'}${r.state === '不採用' ? `<br><span class="small muted">理由：${esc(r.reason || '')}</span>` : ''}</td>
        <td>${pill(r.state, TT[r.state])}</td><td class="small">${r.by ? esc(nameOf(r.by)) + '<br>' + esc(r.at || '') : '—'}</td>
        <td>${!can ? '' : r.state === '待確認' ? `<button type="button" class="btn sm primary" data-act="dxr-ok" data-i="${idx}" data-r="${n}">確認</button> <button type="button" class="btn sm" data-act="dxr-reject" data-i="${idx}" data-r="${n}">OCR 錯誤／不採用</button>` : `<button type="button" class="btn sm" data-act="dxr-undo" data-i="${idx}" data-r="${n}">${r.state === '不採用' ? '恢復為待確認' : '改回待確認'}</button>`}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="err" id="fe-${idx}"></div></div>`;
}
let nameOf = id => id || '';

async function reviewPage(ctx){
  const { main, R, c, it } = ctx;
  nameOf = R.accName;
  const v = R.cur(it);
  if (!R.canProcess(c)) return void (main.innerHTML = blocked(R, c));
  if (R.status(it, c) !== '待護理核對') return void (main.innerHTML = `${backLink(homeUrl(), '回到工作清單')}<div class="card stack"><h1>${esc(it.name)}目前不能核對</h1><p>目前狀態：${P(R.status(it, c))}。${it.validDays && !v.dateConfirmed ? '行政尚未確認文件日期，確認後才會交給您。' : ''}</p></div>`);
  const [dq, oq] = await Promise.all([
    supabase().from('review_drafts').select('data, updated_at').eq('document_id', it.dbId).eq('version_v', v.v).maybeSingle(),
    supabase().from('ocr_runs').select('mode, run, status, result, error, created_at').eq('document_id', it.dbId).eq('version_v', v.v).order('created_at')
  ]);
  DRAFT = dq.data ? { data: dq.data.data, at: dq.data.data && dq.data.data.savedAt } : null;
  const runs = (oq.data || []).filter(r => r.mode === 'review'), ok = runs.filter(r => r.status === '完成').slice(-1)[0];
  AI = ok ? { fields: (ok.result || {}).fields || {}, run: ok.run, at: ok.created_at } : null;
  if (!S || S.id !== it.id || S.v !== v.v) initState(it, v);
  const ocrRuns = runs;

  const render = () => {
    const F = S.fields, FA = F.filter(f => fActive(F, f)), mustLeft = FA.filter(f => f.risk && !f.ok).length, left = FA.filter(f => !f.ok).length;
    const pct = Math.round((FA.length - left) / FA.length * 100), anyAuto = F.some(f => f.auto);
    const last = ocrRuns[ocrRuns.length - 1];
    const canAi = !!(v.file && v.file.path && !v.file.removed && OCR_TYPES.includes(v.file.type));
    const aiBox = !canAi ? `<div class="card small muted">${v.file && v.file.path ? '這份文件的格式無法自動辨識' : '這個版本沒有可以辨識的檔案'}，請依原始文件人工輸入。</div>`
      : `<div class="card stack"><div class="row between"><strong>${AI ? '已有 AI 辨識內容' : '用 AI 辨識文件內容'}</strong><button type="button" class="btn sm ${AI ? '' : 'primary'}" id="ocrBtn">${AI || (last && last.status === '失敗') ? '重新辨識' : '自動辨識'}</button></div><p class="small muted">會把這份文件交給 Claude（Anthropic 的 AI 服務）辨識。辨識結果只是建議，每一欄都要對照原始文件確認；辨識失敗時請直接人工處理。</p>${last ? (last.status === '失敗' ? `<p class="err" role="alert">第 ${last.run} 次辨識失敗：${esc(last.error || '')}。${AI ? `目前畫面上的 AI 內容來自先前第 ${AI.run} 次的辨識，<strong>不是這次的結果</strong>。` : '本次沒有任何辨識結果。'}可以按「重新辨識」再試，或直接依原始文件人工輸入。</p>` : `<p class="small muted">第 ${last.run} 次辨識：${esc(last.status)}${last.result && last.result.summary ? '：' + esc(last.result.summary) : ''}　（第 ${v.v} 版共辨識 ${ocrRuns.length} 次）</p>`) : ''}<div class="err" id="ocrErr" role="alert"></div></div>`;
    const dateInfo = it.validDays ? `<div class="card small">檢查日期：<strong>${slash(v.dateConfirmed)}</strong>（行政 ${esc(R.accName(v.dateBy))} 已確認，在期限內）。日期由行政負責，您只需核對醫療內容。</div>` : '';
    main.innerHTML = `${backLink(homeUrl(), '回到工作清單')}<h1>文件核對：${esc(c.patient.name)}｜${esc(it.name)}</h1>
    ${purpose(anyAuto ? '左邊是原始文件，右邊是 AI 辨識的內容（尚未確認）。逐項對照，正確就按「確認」，不對就直接修改後再確認。<strong>紅色邊框</strong>的欄位一定要逐項確認。' : '左邊是原始文件。請依文件內容在右邊填寫各欄位並逐項確認。<strong>紅色邊框</strong>的欄位一定要確認。')}
    <div class="split"><div class="doc" aria-label="原始文件">${v.file && v.file.path ? `<p class="small muted" data-file="${esc(it.dbId)}" data-v="${v.v}">載入檔案中…</p>` : '<p>沒有檔案</p>'}<p class="small muted" style="font-family:var(--font);margin-top:10px">檔名：${esc((v.file || {}).name || '')}　上傳：${esc(v.at || '')}</p></div>
    <div class="stack">${dateInfo}${aiBox}${S.newerAi ? `<div class="notice info">已帶入第 ${S.newerAi} 次辨識結果（在您上次儲存草稿之後完成）。已確認或您修改過的欄位沒有被覆蓋。請逐項確認後儲存草稿。</div>` : ''}
      <div class="card"><div class="row between"><strong>${mustLeft ? `還有 ${mustLeft} 項必須確認` : left ? `必確認項目已完成，還有 ${left} 項` : '全部欄位都已確認'}</strong><span class="small muted">${pct}%</span></div><div class="progress" aria-hidden="true"><span style="width:${pct}%"></span></div></div>
      ${F.map((f, idx) => f.type === 'dxlist' && fActive(F, f) ? dxFieldHtml(f, idx) : !fActive(F, f) ? `<div class="field"><div class="row between"><strong>${esc(f.label)}</strong>${pill('不適用', 'mute')}</div><p class="small muted" style="margin:0">依「${esc((F.find(x => x.k === f.when.k) || {}).label || '')}」${(F.find(x => x.k === f.when.k) || {}).val ? '為「' + esc((F.find(x => x.k === f.when.k) || {}).val) + '」' : '尚未選擇'}，這一欄不需要填寫。</p></div>` : `<div class="field ${f.risk ? 'risk' : ''} ${f.ok ? 'done' : ''}" data-field="${esc(f.k)}">
        <div class="row between"><strong>${esc(f.label)}</strong><span class="row">${f.risk ? pill('必須逐項確認', 'bad') : ''}${f.auto ? pill(f.run ? `AI 辨識（第 ${f.run} 次）` : 'AI 辨識', 'info') : f.val ? pill('人工輸入', 'mute') : AI ? pill('AI 未辨識，請人工輸入', 'warn') : ''}${f.auto && f.val !== f.orig ? pill('人工修改', 'warn') : ''}</span></div>
        ${f.ok ? `<div style="font-weight:700;white-space:pre-line">${esc(f.type === 'date' ? slash(f.val) : f.val)}</div>`
          : f.type === 'textarea' || f.type === 'labs' ? `<textarea id="fv-${idx}" data-orig="${esc(f.val)}" aria-label="${esc(f.label)}" ${f.ph ? `placeholder="${esc(f.ph)}" rows="4"` : ''}>${esc(f.val)}</textarea>`
          : `<input type="${f.type === 'date' ? 'date' : 'text'}" id="fv-${idx}" value="${esc(f.val)}" data-orig="${esc(f.val)}" aria-label="${esc(f.label)}">`}
        <div class="row">${f.ok ? `<span class="small" style="color:var(--ok)">✓ 已確認（${esc(R.accName(f.okBy))}，${esc(f.okAt || '')}）</span><button type="button" class="btn sm" data-act="f-undo" data-i="${idx}">修改</button>`
          : `<button type="button" class="btn sm primary" data-act="f-ok" data-i="${idx}">確認</button>${(f.quick || []).map(q => `<button type="button" class="btn sm" data-act="f-quick" data-i="${idx}" data-q="${esc(q)}">${esc(q)}</button>`).join('')}`}</div>
        ${f.aiNew ? `<p class="small" style="color:var(--warn);margin:0">第 ${AI ? AI.run : ''} 次辨識結果不同：「${esc(f.aiNew)}」。${f.ok ? '此欄已由您確認，系統沒有覆蓋；如需採用請按「修改」後自行更正。' : '此欄是您輸入的內容，系統沒有覆蓋。'}</p>` : ''}
        <div class="err" id="fe-${idx}"></div></div>`).join('')}
      <div class="card row between"><span class="small" id="draftState"></span><button type="button" class="btn sm" data-act="draft-save">儲存草稿</button></div>
      <button type="button" class="btn primary big" data-act="review-done" ${left ? 'disabled' : ''}>完成核對</button>
      <button type="button" class="btn danger" data-act="review-return">文件有問題，退回請家屬補件</button>
    </div></div>`;
    showDraftState(main);
    hydrate(main, it);
  };
  ctx.render = render;
  render();
  main.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) reviewAct(ctx, b); });
  main.querySelector('#ocrBtn');
  main.addEventListener('click', async e => {
    const b = e.target.closest('#ocrBtn'); if (!b) return;
    if (S.dirty){ const r = await saveDraft(ctx); if (!r.ok) return toast('請先儲存草稿：' + r.reason); }
    b.disabled = true; b.textContent = '辨識中，約 10–30 秒…';
    const { data, error } = await supabase().functions.invoke('ocr', { body: { document_id: it.dbId, v: v.v, mode: 'review' } });
    let res = data; if (error){ let m = error.message; try { m = (await error.context.json()).error || m; } catch { /* 沿用原訊息 */ } res = { ok: false, reason: m }; }
    if (!res.ok && !res.run){ b.disabled = false; b.textContent = '重新辨識'; main.querySelector('#ocrErr').textContent = '辨識沒有執行：' + res.reason; return; }
    if (res.ok){
      /* 以目前畫面內容合併（含辨識期間新增的輸入與確認），已確認與人工修改的欄位不覆蓋 */
      syncInputs(main);
      const merged = mergeAiDraft(it, draftFromState(S), res.result.fields, res.run);
      S.fields.forEach(f => { const m = merged.fields[f.k]; if (m) Object.assign(f, m); });
      S.src = 'AI 辨識'; S.aiRun = res.run; S.dirty = true; S.editSeq = (S.editSeq || 0) + 1;
      const sr = await saveDraft(ctx);
      done(sr.ok ? `第 ${res.run} 次辨識完成，請逐項對照原始文件確認` : '辨識結果已保存，但核對草稿儲存失敗：' + sr.reason);
    } else done('辨識失敗：' + res.reason);
  });
}
async function hydrate(main, it){
  for (const el of main.querySelectorAll('[data-file]')){
    try { const r = await openFile(el.dataset.file, Number(el.dataset.v)); el.outerHTML = !r.url ? '<p>沒有檔案</p>' : /^image\//.test(r.mime) && !/hei[cf]/.test(r.mime) ? `<img src="${esc(r.url)}" alt="${esc(it.name)}原始文件">` : `<p style="font-family:var(--font)">PDF 文件：<a href="${esc(r.url)}" target="_blank" rel="noopener">開啟檔案</a>（連結 10 分鐘內有效）</p>`; }
    catch (e){ el.textContent = '無法開啟檔案：' + errText(e); }
  }
}
/* 核對頁的按鈕動作（原型 f-ok、f-quick、f-undo、dxr-*、draft-save、review-done、review-return） */
async function reviewAct(ctx, b){
  const { main, R, c, it } = ctx, act = b.dataset.act, i = Number(b.dataset.i), setErr = (n, m) => { const el = main.querySelector('#fe-' + n); if (el) el.textContent = m; };
  const touch = async () => { S.dirty = true; S.editSeq = (S.editSeq || 0) + 1; ctx.render(); const r = await saveDraft(ctx); if (!r.ok) toast('確認狀態已更新在畫面上，但儲存失敗，內容尚未保存'); };
  const dxChange = async fn => { syncInputs(main); const f = S.fields[i]; const e = fn(f); if (e) return setErr(i, e); dxRecalc(f); await touch(); };
  syncInputs(main);
  const f = S.fields[i];
  switch (act){
    case 'f-ok': {
      if (f.type === 'dxlist') return setErr(i, '主要診斷請逐筆確認');
      if (!String(f.val).trim()) return setErr(i, '請先填寫內容；文件沒有寫請按「文件未記載」');
      if (f.type === 'date' && !isDate(f.val)) return setErr(i, '請輸入正確日期');
      if (f.choice && !(f.quick || []).includes(String(f.val).trim())) return setErr(i, '請從按鈕中選擇：' + f.quick.join('、'));
      if (f.type === 'labs'){ const pl = parseLabRows(f.val); if (pl.bad.length) return setErr(i, '格式不正確：' + pl.bad.join('；') + '。每行請寫「項目｜數值｜單位｜參考區間｜異常」，或「文字判讀：原文」'); }
      f.ok = true; f.okBy = ME.id; f.okAt = stamp(); f.hist = (f.hist || []).concat([{ act: '確認', val: f.val, src: fieldSrc(f), by: ME.id, at: f.okAt }]); return touch();
    }
    case 'f-quick': {
      if (f.type === 'dxlist'){ if (dxActive(f).length) return setErr(i, '還有診斷資料列；文件確實沒有記載時，請先把各列標示為不採用'); f.absent = true; f.absentVal = b.dataset.q; dxRecalc(f); f.okBy = ME.id; f.okAt = stamp(); f.hist = (f.hist || []).concat([{ act: '確認', val: f.val, by: ME.id, at: f.okAt, quick: true }]); return touch(); }
      f.val = b.dataset.q; f.ok = true; f.okBy = ME.id; f.okAt = stamp(); f.hist = (f.hist || []).concat([{ act: '確認', val: f.val, src: fieldSrc(f), by: ME.id, at: f.okAt, quick: true }]); return touch();
    }
    case 'f-undo': {
      /* 解除確認：回到未確認、清除目前有效的確認者與時間；先前的確認保留在歷程 */
      f.hist = (f.hist || []).concat([{ act: '解除確認', val: f.val, prevBy: f.okBy || null, prevAt: f.okAt || null, by: ME.id, at: stamp() }]); f.ok = false; f.okBy = null; f.okAt = null;
      if (f.type === 'dxlist'){ f.absent = false; f.absentVal = null; dxRecalc(f); }
      return touch();
    }
    case 'dxr-fromraw': return dxChange(f => { const raw = String(f.raw || '').trim(); if (!raw) return '請先輸入或辨識原始診斷文字'; if (ABSENT_VALS.includes(raw)) return '原文是「' + raw + '」，不是診斷；請按「文件未記載」'; const d0 = dxDup(f, raw); if (d0) return `原文整段已經在第 ${d0.n} 筆（${d0.state}）${d0.state === '不採用' ? '，如需採用請按「恢復為待確認」' : '，不重複加入'}`; f.rows = (f.rows || []).concat([dxNewRow(f, raw, raw, '原文整段（人工加入）', '原文整段加入（未確認）')]); });
    case 'dxr-split': return dxChange(f => { const parts = dxSplit(f.raw); if (!parts.length) return '請先輸入或辨識原始診斷文字'; if (ABSENT_VALS.includes(String(f.raw).trim())) return '原文不是診斷';
      const fresh = [], dup = []; parts.forEach(p => { const d0 = dxDup(f, p) || fresh.find(x => dxKey(x) === dxKey(p)); if (d0) dup.push(p); else fresh.push(p); });
      if (!fresh.length) return '拆分結果都已經在清單中（含已確認、待確認或不採用的列），沒有新增。需要時請直接修改或「恢復為待確認」。';
      fresh.forEach(p => { f.rows = (f.rows || []).concat([dxNewRow(f, p, p, '拆分建議（依標點，未確認）', '依標點拆分建議（未確認）')]); });
      if (dup.length) setTimeout(() => toast(`新增 ${fresh.length} 筆待確認；${dup.length} 筆已在清單中，未重複加入：${dup.join('、')}`), 0); });
    case 'dxr-add': return dxChange(f => { f.rows = (f.rows || []).concat([dxNewRow(f, '', '', '人工新增', '人工新增（未確認）')]); });
    case 'dxr-ok': return dxChange(f => { const r = f.rows[+b.dataset.r]; if (!r || r.state !== '待確認') return '這筆已經不是待確認'; if (!String(r.text || '').trim()) return `第 ${r.n} 筆核對後文字是空白，請填寫或標示不採用`; r.text = r.text.trim(); r.state = '已確認'; r.by = ME.id; r.at = stamp(); r.hist = (r.hist || []).concat([{ act: '確認', val: r.text, by: ME.id, at: r.at }]); });
    case 'dxr-undo': return dxChange(f => { const r = f.rows[+b.dataset.r]; if (!r) return '找不到這筆'; r.hist = (r.hist || []).concat([{ act: r.state === '不採用' ? '恢復為待確認' : '改回待確認', prevState: r.state, prevBy: r.by, prevAt: r.at, by: ME.id, at: stamp() }]); r.state = '待確認'; r.by = null; r.at = null; r.reason = ''; });
    case 'dxr-reject': {
      const rn = +b.dataset.r, r0 = f.rows[rn];
      return modal({ title: `第 ${r0.n} 筆標示不採用`, ok: '標示不採用', body: `<p>「${esc(r0.text || r0.raw)}」不會被刪除，會保留在紀錄中，但不列入已確認診斷。</p><label class="f">理由<select id="dxRej"><option>OCR 辨識錯誤</option><option>拆分錯誤</option><option>重複</option><option>不是診斷</option><option>其他</option></select></label><label class="f">說明（選「其他」時必填）<input type="text" id="dxRejNote"></label>`,
        onOk: async host => { const t = host.querySelector('#dxRej').value, nt = host.querySelector('#dxRejNote').value.trim(); if (t === '其他' && !nt) return '請填寫說明';
          setTimeout(() => dxChange(f2 => { const r = f2.rows[rn]; r.state = '不採用'; r.reason = t + (nt ? '：' + nt : ''); r.by = ME.id; r.at = stamp(); r.hist = (r.hist || []).concat([{ act: '不採用', reason: r.reason, by: ME.id, at: r.at }]); }), 0); return ''; } });
    }
    case 'draft-save': { const r = await saveDraft(ctx); toast(r.ok ? (r.changedDuringSave ? '儲存期間內容又有變更，最新的修改尚未儲存' : '草稿已儲存') : '儲存失敗，內容尚未保存（' + r.reason + '）'); return; }
    case 'review-done': return reviewDone(ctx);
    case 'review-return':
      return modal({ title: '退回請家屬補件', ok: '退回', danger: true, body: '<label class="f" data-req>原因<select id="retReason"><option>文件模糊，看不清楚</option><option>缺少頁面</option><option>內容前後矛盾</option><option>疑似不是本人的資料</option></select></label><label class="f">給家屬的說明（選填，請用白話）<textarea id="retNote" placeholder="例：請補上第 2 頁用藥清單"></textarea></label><p class="small muted">家屬會在系統收到「有待補件項目」通知，登入後看得到原因。</p>',
        onOk: async host => {
          const { data, error } = await supabase().rpc('return_document', { p_doc: it.dbId, p_v: S.v, p_reason: host.querySelector('#retReason').value, p_note: host.querySelector('#retNote').value.trim() });
          if (error) return '退回失敗：' + errText(error) + '。資料沒有變更，可以再試一次。';
          S = null; const extra = await syncReqMails(c.id);
          done('已退回並通知家屬' + (extra ? '。' + extra : ''), homeUrl()); return '';
        } });
  }
  void R;
}
/* 完成核對（原型 review-done）：全部欄位確認、必備檢查項目都有包含、診斷逐筆確認後，一次寫入 */
async function reviewDone(ctx){
  const { main, R, c, it } = ctx;
  await chain;
  syncInputs(main);
  const RF = S.fields;
  if (R.status(it, c) !== '待護理核對' || S.v !== R.cur(it).v) return toast('文件狀態已改變（可能有新版本），請重新開啟');
  if (RF.some(f => fActive(RF, f) && !f.ok)) return toast('還有欄位沒有確認');
  const missPart = RF.filter(f => f.partNeed === '必備' && /未包含/.test(String(f.val)));
  if (missPart.length) return toast(`必備的檢查項目未包含：${missPart.map(f => f.label).join('、')}。請按「文件有問題，退回請家屬補件」，或請行政調整要求。`);
  const fields = {}; RF.forEach(f => { fields[f.k] = fActive(RF, f) ? f.val : ''; });
  const labs = {}; RF.filter(f => f.type === 'labs' && fActive(RF, f)).forEach(f => { labs[f.k] = parseLabRows(f.val).rows; });
  const at = stamp();
  const review = RF.map(f => { if (!fActive(RF, f)) return { k: f.k, label: f.label, before: '', raw: '', after: '', auto: false, changed: false, edited: false, src: '依條件不適用', state: '不適用', fhir: fhirOf(f.k), by: ME.id, at };
    const changed = !!f.auto && String(f.orig || '') !== String(f.val);
    return { k: f.k, label: f.label, before: f.auto ? f.orig || '' : '', raw: f.auto ? f.orig || '' : f.val, after: f.val, auto: !!f.auto, changed, edited: changed || !f.auto, src: fieldSrc(f), state: '已確認', absent: ABSENT_VALS.includes(String(f.val).trim()) ? String(f.val).trim() : '', fhir: fhirOf(f.k), run: f.auto ? f.run || null : null, okBy: f.okBy, okAt: f.okAt, hist: f.hist || [], by: ME.id, at }; });
  const dxF = RF.find(f => f.type === 'dxlist' && fActive(RF, f));
  if (dxF && !dxF.absent && dxActive(dxF).some(r => r.state !== '已確認')) return toast('還有診斷尚未確認');
  review.forEach(x => { if (dxF && x.k === dxF.k){ x.raw = dxF.raw || ''; x.rows = clone(dxF.rows || []); } });
  const src = overallSrc(RF);
  const btn = main.querySelector('[data-act="review-done"]'); if (btn) btn.disabled = true;
  const { data, error } = await supabase().rpc('complete_review', { p_doc: it.dbId, p_v: S.v, p_fields: fields, p_review: review, p_review_src: src, p_labs: labs,
    p_dx: dxF ? { raw: dxF.raw || '', absent: !!dxF.absent, rows: clone(dxF.rows || []) } : null });
  /* 正式核對結果寫入失敗：不顯示完成、不跳頁；輸入與確認狀態都保留 */
  if (error){ if (btn) btn.disabled = false; return toast(`完成核對失敗：${errText(error)}。您的輸入與確認狀態都保留，可以再按一次「完成核對」。`); }
  S = null;
  const extra = (data.requests || []).length ? await syncReqMails(c.id) : '';
  /* 與原型相同：完成核對後回到工作清單 */
  done('核對完成，系統已重新檢查文件' + (extra ? '。' + extra : ''), homeUrl());
}

/* ========== 護理補充評估（原型 nurseSupp） ========== */
function suppPage({ main, R, c, it }){
  const back = backLink(residentUrl(c), '回到住民資料');
  if (!canSupp(R, it, c)) return void (main.innerHTML = `${back}<div class="card">這份文件目前不能做護理補充評估（只限需要繳交、尚未上傳或需補件的照護紀錄）。</div>`);
  const defs = fieldDefs(it);
  main.innerHTML = `${back}<h1>護理補充評估：${esc(c.patient.name)}｜${esc(it.name)}</h1>
  ${purpose('醫院沒有提供獨立紀錄時使用。請寫下您依哪個來源核實或評估的內容；系統會標示為「護理補充評估」，不會當成醫院文件。')}
  <form class="card stack" id="suppForm" novalidate>
    <fieldset data-req><legend>資料來源</legend>${SUPP_SRC.map(x => `<label class="choice"><input type="radio" name="src" value="${esc(x)}"><span>${esc(x)}</span></label>`).join('')}</fieldset>
    <label class="f" data-req>來源說明<input type="text" name="note" placeholder="例：電話聯絡康寧示範醫院 5B 護理站陳護理師"></label>
    ${defs.map(f => `<label class="f">${esc(f.label)}<textarea name="f-${esc(f.k)}" rows="3"></textarea></label>`).join('')}
    <label class="choice"><input type="checkbox" name="ok"><span>以上內容由我依所選來源核實或評估，並確認正確</span></label>
    <div class="err" id="spErr" role="alert"></div>
    <button type="submit" class="btn primary big">儲存補充評估</button>
  </form>`;
  const f = main.querySelector('#suppForm'), err = m => { main.querySelector('#spErr').textContent = m; };
  f.addEventListener('submit', async e => {
    e.preventDefault(); const d = new FormData(f), btn = f.querySelector('button[type=submit]'); if (btn.disabled) return;
    const src = d.get('src'), note = String(d.get('note') || '').trim();
    if (!src) return err('請選擇資料來源');
    if (!note) return err('請寫下來源說明（例如聯絡的單位與人員、參考的文件）');
    const fields = {};
    for (const f0 of defs){ const v0 = String(d.get('f-' + f0.k) || '').trim(); if (!v0) return err(`請填寫「${f0.label}」；沒有資料請寫「未提供」或「未知」`); fields[f0.k] = v0; }
    if (!d.get('ok')) return err('請勾選確認');
    const at = stamp(), how = '護理補充評估：' + src;
    const review = defs.map(f0 => ({ k: f0.k, label: f0.label, before: '', raw: fields[f0.k], after: fields[f0.k], auto: false, changed: false, edited: true, src: how, state: '已確認', absent: ABSENT_VALS.includes(fields[f0.k]) ? fields[f0.k] : '', fhir: fhirOf(f0.k), run: null, okBy: ME.id, okAt: at, hist: [{ act: '確認', val: fields[f0.k], src: how, by: ME.id, at }], by: ME.id, at }));
    btn.disabled = true;
    const { error } = await supabase().rpc('save_supp', { p_doc: it.dbId, p_src: src, p_note: note, p_fields: fields, p_review: review });
    if (error){ btn.disabled = false; return err('儲存失敗：' + errText(error) + '。內容還在，可以再試一次。'); }
    done('已儲存補充評估', residentUrl(c));
  });
}

/* ========== 收治評估／入住前護理確認（原型 nurseAssess、assessGuard） ========== */
function assessGuard(R, c, r){
  if (!c || !R.canProcess(c)) return '資料授權無效或案件已結案，不能評估';
  if (c.nurseId !== ME.id) return '只有負責護理師可以評估';
  if (!R.listOk(c)) return '文件清單尚未建立完成，請行政先在案件頁重新建立';
  if (!R.docsReady(c)) return '必要文件尚未全部確認符合，不能評估';
  if (!c.assessment && !R.habitGate(c)) return '生活與照護習慣卡尚未完成必要初審（家屬正式提交、護理初審完成），不能開始收治評估';
  if (c.flowMode === '先簽後審' && !R.contractSigned(c)) return '先簽後審的案件尚未記錄入住契約，不能做入住前確認';
  const p = R.phase(c);
  if (!['評估中', '入住前確認中'].includes(p)) return '案件目前不在評估階段（' + p + '）';
  if (r && !RESULTS[c.flowMode].includes(r)) return '「' + c.flowMode + '」流程不能選「' + r + '」';
  return true;
}
function assessPage({ main, D, R, c }){
  const pre = c.flowMode === '先簽後審', back = backLink(homeUrl(), '回到工作清單');
  if (!R.canProcess(c)) return void (main.innerHTML = blocked(R, c));
  const p = R.phase(c);
  if (!c.assessment && !R.habitGate(c)) return void (main.innerHTML = `${back}<div class="card stack" id="assessHabitBlock"><h1>目前不能評估</h1><p>生活與照護習慣卡是第一階段必要資料，尚未完成必要初審（目前：${pill(R.habitState(c), HR_TONE[R.habitState(c)])}）。${R.hasHabit(c) ? '請先到住民資料完成初審。' : '家屬尚未正式提交。'}</p>${R.hasHabit(c) ? `<p><a class="btn primary" href="${residentUrl(c)}">前往住民資料</a></p>` : ''}</div>`);
  if (!['評估中', '入住前確認中'].includes(p)) return void (main.innerHTML = `${back}<div class="card stack"><h1>目前不能評估</h1><p>案件狀態：${pill(p, PHASE_TONE[p])}。${pre && !R.contractSigned(c) ? '先簽後審的案件要等行政記錄入住契約後，才能做入住前確認。' : '必要文件全部確認符合後，才能進行評估。'}</p></div>`);
  const prev = (c.assessHistory || []).filter(a => a.result === '需補充').slice(-1)[0] || (c.assessment && c.assessment.result === '需補充' ? c.assessment : null);
  const pickItems = R.caseItems(c.id).filter(i => !R.notApplicable(i) && R.nurseCanSee(i) && R.activeStages(c).includes(i.stage));
  const facts = [['出院診斷', R.confirmedField(c, 'dx')], ['管路', R.confirmedField(c, 'tube')], ['傷口', R.confirmedField(c, 'wound')], ['藥物過敏', R.confirmedField(c, 'allergy')], ['DNR（另行確認）', dnrText(c)], ['用藥', R.confirmedField(c, 'meds')], ['給藥注意', R.confirmedField(c, 'note')]];
  const hl = R.habitLines(c);
  const opts = pre ? [['可入住', '可入住', '系統會產生照顧摘要卡草稿，審核後開放給照服員'], ['需補充', '需補充', '指定要補的文件，家屬補交並經行政、護理確認後再重新評估'], ['待協調', '待協調', '照護條件需要和家屬討論（例如設備、床位），暫停後續程序，由行政協調'], ['不符合收治條件', '不符合收治條件', '超出本中心照護能力。已簽約，會交行政協調並通知結果，不會直接結案']]
    : [['收治', '收治', '可以收治，通知家屬安排參訪與簽約'], ['需補充', '需補充', '指定要補的文件，家屬補交並經行政、護理確認後再重新評估'], ['待協調', '待協調', '照護條件需要和家屬討論，暫停後續程序，由行政協調'], ['不收治', '不收治', '無法收治。原因必填，會以白話通知家屬並結案']];
  main.innerHTML = `${back}<h1>${pre ? '入住前護理確認' : '收治評估'}：${esc(c.patient.name)}</h1>
  ${purpose(pre ? '家屬已簽約。請確認入住前要準備哪些照護資源，若超出照護能力，選「待協調」。' : '依已確認的資料判斷能不能照顧這位住民。系統只整理資料，<strong>不會替您判斷</strong>。')}
  <div class="grid2">
    <div class="card"><h2>已確認的資料</h2><table><tbody>${facts.map(([k, v]) => `<tr><th scope="row">${k}</th><td style="white-space:pre-line">${esc(v || '待確認')}</td></tr>`).join('')}</tbody></table>
      ${hl.call || hl.comm || hl.adl || hl.famNote ? `<div class="notice warn small" style="margin-top:8px"><strong>家屬提供（未經確認，僅供參考）</strong>${hl.call ? `<br>稱呼：${esc(hl.call)}` : ''}${hl.comm ? `<br>溝通：${esc(hl.comm)}` : ''}${hl.adl ? `<br>日常活動：${esc(hl.adl)}` : ''}${hl.famNote ? `<br>${esc(hl.famNote)}` : ''}${R.habitOf(c).famAllergy ? `<br>家屬所知過敏：${esc(R.habitOf(c).famAllergy)}` : ''}</div>` : ''}</div>
    ${prev ? `<div class="notice info" style="grid-column:1/-1">上次評估要求補充（${esc(prev.at)}）：${esc((prev.items || []).map(id => (D.items[id] || {}).name || '').filter(Boolean).join('、'))}。${esc(prev.reason || '')}　指定的資料已全部確認，請重新評估。</div>` : ''}
    <form class="card stack" id="assessForm" novalidate>
      <label class="f">移位方式<select name="move"><option>一人協助</option><option>二人協助</option><option>可自行移位</option><option>臥床</option></select></label>
      <label class="f">失智或行為照護需求<select name="behav"><option>無明顯行為問題</option><option>輕度，偶有夜間躁動</option><option>需專責照護</option></select></label>
      <label class="f">隔離需求<select name="iso"><option>不需要</option><option>需要</option></select></label>
      <label class="f">DNR／預立醫療決定（另行確認）<span class="hint">不要依病歷摘要有沒有寫來推定；有看到相關文件或查詢結果才選「已確認」</span><select name="dnr"><option>尚未另行確認</option><option>已確認：有簽署文件</option><option>已確認：未簽署</option></select></label>
      <label class="f">DNR 確認來源（選「已確認」時必填）<input type="text" name="dnrSrc" placeholder="例：家屬提供的 DNR 同意書影本"></label>
      <fieldset data-req><legend>${pre ? '入住前確認結果' : '評估結果'}</legend>
        ${opts.map(([v, t, h]) => `<label class="choice"><input type="radio" name="result" value="${v}"><span><strong>${t}</strong><br><span class="small muted">${h}</span></span></label>`).join('')}
      </fieldset>
      <fieldset id="moreBox" hidden><legend>要請家屬補充哪些資料？（至少選一項）</legend>
        ${pickItems.map(i => `<label class="choice"><input type="checkbox" name="moreItem" value="${esc(i.dbId)}"><span>${esc(i.name)}　${P(R.status(i, c))}</span></label>`).join('')}
        <label class="f">其他資料（不在清單上時填寫，例如：最近一次抽血報告）<input type="text" name="moreOther"></label>
      </fieldset>
      <label class="f" id="asReasonLbl">說明<span class="hint">選「收治」「可入住」以外的結果都必填；「不收治」「需補充」的說明會給家屬看，請用白話</span><textarea name="reason"></textarea></label>
      <div class="err" id="asErr" role="alert"></div>
      <button type="submit" class="btn primary big">${pre ? '確認入住前護理確認結果' : '確認收治評估結果'}</button>
    </form></div>`;
  const f = main.querySelector('#assessForm'), err = m => { main.querySelector('#asErr').textContent = m; };
  f.addEventListener('change', () => { main.querySelector('#moreBox').hidden = (new FormData(f)).get('result') !== '需補充'; });
  f.addEventListener('submit', e => {
    e.preventDefault(); const d = new FormData(f), r = d.get('result'), reason = String(d.get('reason') || '').trim();
    if (!r) return err('請選擇評估結果');
    const g = assessGuard(R, c, r); if (g !== true) return err(g);
    if (r !== PASS[c.flowMode] && !reason) return err('請填寫說明');
    const picks = r === '需補充' ? d.getAll('moreItem') : [], other = r === '需補充' ? String(d.get('moreOther') || '').trim() : '';
    if (r === '需補充' && !picks.length && !other) return err('請勾選要補充的文件，或填寫其他資料名稱');
    const dnr = d.get('dnr') || '尚未另行確認', dnrSrc = String(d.get('dnrSrc') || '').trim();
    if (/^已確認/.test(dnr) && !dnrSrc) return err('選擇 DNR「已確認」時，請填寫確認來源');
    const names = picks.map(id => (R.caseItems(c.id).find(i => i.dbId === id) || {}).name).concat(other ? [other] : []);
    modal({ title: pre ? '確認入住前護理確認結果' : '確認收治評估結果', ok: '確認送出', body: `<p>評估結果：<strong>${esc(r)}</strong>${r === '需補充' ? `<br>補充：${esc(names.join('、'))}` : ''}</p><p>送出後會鎖定，不能直接修改。確定送出嗎？</p>`,
      onOk: async () => {
        const { data, error } = await supabase().rpc('save_assessment', { p_case: c.id, p_result: r, p_move: d.get('move'), p_behav: d.get('behav'), p_iso: d.get('iso'), p_dnr_state: dnr, p_dnr_src: dnrSrc, p_reason: reason, p_docs: picks, p_other: other });
        if (error) return '評估送出失敗：' + errText(error) + '。資料沒有變更，可以再試一次。';
        const extra = (data.requests || []).length ? await syncReqMails(c.id) : '';
        done('評估已送出' + (extra ? '。' + extra : ''), homeUrl()); return '';
      } });
  });
}
