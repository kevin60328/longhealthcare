/* cases.html：個案管理（HANDOFF 6.1、6.2；原型第 (18) 版 staffCases、staffCase、staffApply、nurseAssignPage）。畫面與文字沿用原型。
 *
 * 網址：
 *   cases.html[?view=list]               案件列表（行政）：搜尋、狀態篩選
 *   cases.html?case=<id>                 案件詳情（行政）：簽約、協調、代理權核實、基本資料、文件與要求、參訪與保證金、處理歷程、處理紀錄
 *   cases.html?view=confirm&case=<id>    確認新申請並轉交護理部門／不受理（行政）
 *   cases.html?view=assign               案件分配（有分配權限的護理師）
 *   管理員：案件封存在 settings.html?view=archive（階段 9），這裡直接轉過去。
 *
 * 寫入一律呼叫資料庫 RPC（migrations/…000014_cases.sql）：在一個交易內鎖定案件、檢查權限與狀態、寫入、通知家屬、記錄操作紀錄。
 * 兩位行政同時處理同一件事時，後到的人會看到「已經處理過了」之類的說明（使用者決定：多位行政共用工作清單）。
 * 文件的收件、日期核對、補件、上傳在 documents.html（階段 6）；這裡的相關按鈕連過去。 */
import { bootPage } from '../page.js';
import { supabase } from '../api/supabase.js';
import { loadModel, invalidateModel } from './services/model.js';
import { esc, pill, toast, modal, purpose, errText, setFlash } from '../ui.js';
import { timelineCard } from './family-ui.js';
import { TONE, PHASE_TONE, ASSIGN_TONE, NEED_TONE, CATS, SIGNER_LABEL, PASS, slash, md, uiT, stampDate } from './rules/core.js';

const P = (t, tone) => pill(t, tone || TONE[t] || 'mute');
const back = (href, text) => `<a class="back" href="${href}">← ${esc(text)}</a>`;
const caseUrl = id => `cases.html?case=${id}`;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
/* 寫入成功後：清掉快取、顯示提示並重新整理目前畫面 */
const done = (msg, url) => { invalidateModel(); setFlash(msg); if (url) location.assign(url); else location.reload(); };

bootPage('cases', async ctx => {
  const { me, view, params, main } = ctx;
  if (me.role === 'admin'){ location.replace('settings.html?view=archive'); return; }
  /* 單一案件：只讀那一件（結案的也看得到）；列表：先讀進行中的，篩選到已結案等狀態時再讀全部 */
  const caseId = params.get('case'), wantClosed = ['已結案', '已封存', '全部'].includes(sessionStorage.getItem('caseF'));
  const model = await loadModel(me, view === 'assign' ? {} : caseId ? { caseId } : { includeClosed: wantClosed });
  const x = { ...ctx, D: model.D, R: model.R, M: model.me };
  if (view === 'assign') return assignPage(x);
  const c = model.D.cases[caseId];
  if (params.get('case') && !c){ main.innerHTML = '<div class="card stack"><h1>找不到這個案件</h1><a class="btn primary" href="cases.html">回到案件列表</a></div>'; return; }
  if (c && view === 'confirm') return c.linkStatus === '待確認' && !c.closed ? confirmPage({ ...x, c }) : location.replace(caseUrl(c.id));
  if (c) return c.linkStatus === '待確認' && !c.closed ? location.replace(`cases.html?view=confirm&case=${c.id}`) : casePage({ ...x, c });
  return listPage(x);
});

/* 利益衝突（資料庫判斷，見 public.self_conflict）：{ 帳號 id: 原因 } */
async function conflictsOf(caseId){
  const { data, error } = await supabase().rpc('case_conflicts', { p_case: caseId });
  if (error) throw error;
  return data || {};
}

/* ========== 案件列表（原型 staffCases） ========== */
function listPage({ main, D, R }){
  const store = { q: sessionStorage.getItem('caseQ') || '', f: sessionStorage.getItem('caseF') || '進行中' };
  const all = Object.values(D.cases);
  const matches = c => {
    const p = R.phase(c), f = store.f;
    if (f === '進行中' && (c.closed || c.archived)) return false;
    if (f === '已結案' && (!c.closed || c.archived)) return false;
    if (f === '已封存' && !c.archived) return false;
    if (!['進行中', '已結案', '已封存', '全部'].includes(f) && p !== f) return false;
    if (f !== '已封存' && f !== '全部' && c.archived) return false;
    const q = store.q.trim().toLowerCase();
    return !q || [c.no, c.patient.name, c.patient.chart, R.accName(c.familyId), c.hospital, c.nurseId ? R.accName(c.nurseId) : ''].some(s => String(s || '').toLowerCase().includes(q));
  };
  const rows = () => all.filter(matches).sort((a, b) => (b.createdTs || 0) - (a.createdTs || 0)).map(c => `<tr><td class="mono">${esc(c.no)}</td><td>${esc(c.patient.name)}</td><td>${esc(R.accName(c.familyId))}<br><span class="small muted">${esc(c.relation)}</span></td><td>${c.nurseId ? esc(R.accName(c.nurseId)) : pill(R.assignState(c), ASSIGN_TONE[R.assignState(c)])}</td><td>${slash(c.plannedAdmit)}</td><td>${c.archived ? pill('已封存', 'mute') : pill(R.phase(c), PHASE_TONE[R.phase(c)])}</td><td><a class="btn sm" href="${c.linkStatus === '待確認' && !c.closed ? `cases.html?view=confirm&case=${c.id}` : caseUrl(c.id)}">查看</a></td></tr>`).join('') || '<tr><td colspan="7" class="empty">沒有符合條件的案件</td></tr>';
  main.innerHTML = `<h1>案件</h1><p class="lead">共 ${all.filter(c => !c.archived).length} 件（不含已封存）。點案件可以查看文件狀態、護理分配狀態、記錄簽約。</p>
  <div class="filters" role="search">
    <label class="f">搜尋<input type="search" id="caseQ" value="${esc(store.q)}" placeholder="住民姓名、編號、申請人、醫院"></label>
    <label class="f">狀態<select id="caseF">${['進行中', '全部', '已結案', '已封存'].concat(Object.keys(PHASE_TONE).filter(p => p !== '已結案')).map(p => `<option ${store.f === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
  </div>
  <div class="card tbl-wrap"><table><thead><tr><th>編號</th><th>預計入住者</th><th>申請人</th><th>承辦護理師</th><th>預計入住</th><th>狀態</th><th></th></tr></thead><tbody id="caseRows">${rows()}</tbody></table></div>`;
  const q = main.querySelector('#caseQ'), f = main.querySelector('#caseF'), body = main.querySelector('#caseRows');
  q.addEventListener('input', () => { store.q = q.value; sessionStorage.setItem('caseQ', q.value); body.innerHTML = rows(); });
  f.addEventListener('change', () => {
    const need = ['已結案', '已封存', '全部'].includes(f.value) && !all.some(c => c.closed || c.archived);
    store.f = f.value; sessionStorage.setItem('caseF', f.value);
    /* 第一次切到需要結案案件的篩選：重新整理，改讀全部案件 */
    if (need){ location.reload(); return; }
    body.innerHTML = rows();
  });
}

/* ========== 確認新申請（原型 staffApply） ========== */
async function confirmPage({ main, R, c, me }){
  const fam = R.acct(c.familyId) || {}, cf = (await conflictsOf(c.id))[me.id] || '';
  const { data: note } = await supabase().rpc('conflict_note');
  main.innerHTML = `${back('dashboard.html', '回到工作清單')}<h1>確認新申請：${esc(c.patient.name)}</h1>
  ${purpose('請打電話給申請人，確認對方的身分和與預計入住者的關係。確認後轉交護理部門，由具案件分配權限的護理人員安排承辦護理師；家屬可以先簽署同意書和上傳文件。')}
  ${cf ? `<div class="notice bad" style="margin-bottom:12px"><strong>請由其他同仁處理：</strong>${esc(cf)}。為避免自行核准，您不能確認這份申請。<br><span class="small">${esc(note)}</span></div>` : ''}
  <div class="grid2">
    <div class="card"><h2>申請資料</h2><table><tbody>
      <tr><th scope="row">預計入住者</th><td>${esc(c.patient.name)}</td></tr><tr><th scope="row">身分證</th><td class="mono">${esc(c.patient.nid)}</td></tr><tr><th scope="row">出生日期</th><td>${slash(c.patient.birth)}</td></tr>
      <tr><th scope="row">申請人</th><td>${esc(fam.name)}（${esc(c.relation)}）</td></tr><tr><th scope="row">電話</th><td class="mono">${esc(fam.phone)}</td></tr><tr><th scope="row">電子郵件</th><td>${esc(fam.email)}</td></tr>
      <tr><th scope="row">醫院</th><td>${esc(c.hospital || '—')}</td></tr><tr><th scope="row">希望入住</th><td>${slash(c.plannedAdmit)}</td></tr><tr><th scope="row">申請時間</th><td>${esc(c.createdAt)}</td></tr>
    </tbody></table></div>
    <form class="card stack" id="applyConfirm" novalidate>
      <h2>確認結果</h2>
      <label class="choice" data-req><input type="checkbox" name="called"><span>已電話聯繫申請人，確認身分與關係無誤</span></label>
      <label class="f">病歷號（醫院病歷號，可之後補）<input type="text" name="chart" value="${esc(c.patient.chart || '')}"></label>
      <label class="f" data-req>預計入住日<input type="date" name="admit" value="${esc(c.plannedAdmit)}"></label>
      <p class="small muted" style="margin:0">承辦護理師由護理部門具案件分配權限的人員安排，行政不直接指派。</p>
      <div class="err" id="acErr" role="alert"></div>
      <button type="submit" class="btn primary big">確認申請並轉交護理部門</button>
      <button type="button" class="btn danger" id="applyReject">無法確認身分或不受理</button>
    </form></div>`;
  const form = main.querySelector('#applyConfirm'), err = main.querySelector('#acErr');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = new FormData(form), btn = form.querySelector('button[type=submit]');
    if (cf){ err.textContent = '請由其他同仁處理：' + cf + '。' + note; return; }
    if (!d.get('called')){ err.textContent = '請先電話確認申請人身分與關係'; return; }
    if (!isDate(d.get('admit'))){ err.textContent = '請填寫預計入住日'; return; }
    btn.disabled = true;
    const { error } = await supabase().rpc('confirm_case', { p_case: c.id, p_called: true, p_chart: String(d.get('chart') || ''), p_admit: d.get('admit') });
    btn.disabled = false;
    if (error){ err.textContent = '確認申請失敗：' + errText(error) + '。資料沒有變更，可以再試一次。'; return; }
    done('已確認並轉交護理部門，家屬會收到系統通知', 'dashboard.html');
  });
  main.querySelector('#applyReject').addEventListener('click', () => modal({ title: '不受理此申請', ok: '不受理', danger: true,
    body: '<label class="f" data-req>給申請人的說明（請用白話）<textarea id="rjNote"></textarea></label>',
    onOk: async host => {
      const n = host.querySelector('#rjNote').value.trim(); if (!n) return '請填寫說明';
      const { error } = await supabase().rpc('reject_application', { p_case: c.id, p_note: n });
      if (error) return '不受理失敗：' + errText(error) + '。資料沒有變更，可以再試一次。';
      done('已回覆申請人', 'dashboard.html'); return '';
    } }));
}

/* ========== 案件詳情（原型 staffCase） ========== */
const needPill = (R, it) => pill(R.needText(it), R.notApplicable(it) ? 'mute' : R.condPending(it) ? 'warn' : NEED_TONE[R.needOf(it)]);
const checksHtml = (R, it, c) => { const r = R.checks(it, c); if (!r) return ''; return `<span class="small muted">身分：${r.idOk ? '已核對' : '待核對'}${it.validDays ? `｜系統：${esc(r.sys)}` : ''}｜行政：${esc(r.admin)}${it.medical ? `｜護理：${esc(r.nurse)}` : ''}</span>`; };
const docUrl = (c, it, view) => `documents.html?view=${view}&case=${c.id}&item=${it.dbId}&from=case`;

function assignHtml(R, c){
  const st = R.assignState(c), h = c.assignHist || [], la = h[h.length - 1];
  return `${pill(st, ASSIGN_TONE[st])}　${c.nurseId ? esc(R.accName(c.nurseId)) + (la ? `（${esc(la.at)} 由 ${esc(R.accName(la.by))} 分配）` : '（舊流程已有承辦護理師，原始分配時間未記錄）') : ''}
    <br><span class="small muted">承辦護理師由具案件分配權限的護理人員安排，行政只能查看。${c.nurseId ? '' : '尚未分配時，家屬仍可授權、上傳文件，行政可照常收件；需要護理判斷的步驟等護理接手。'}</span>
    ${h.length ? `<details class="small"><summary>分配歷程（${h.length}）</summary>${h.map(y => `<div>${esc(y.at)}　${esc(R.accName(y.by))}：${y.from ? esc(R.accName(y.from)) + ' → ' : ''}${esc(R.accName(y.to))}${y.reason ? '（' + esc(y.reason) + '）' : ''}</div>`).join('')}</details>` : ''}`;
}

/* 待協調／不符合收治條件：行政協調後記錄結果（原型 coordHero） */
function coordHero(R, c){
  const a = c.assessment || {}, notAdm = a.result === '不符合收治條件', pass = PASS[c.flowMode];
  const btn = (r, t, cls) => `<button type="button" class="btn ${cls || ''}" data-coord="${r}">${t}</button>`;
  return `<div class="card stack hero warn"><h2>${notAdm ? '不符合收治條件：需要協調與結果通知' : '協調入住安排'}</h2>
    <p>護理評估（${esc(R.accName(a.by))}，${esc(a.at || '')}）：${P(a.result)} ${esc(a.reason || '')}</p>
    <p class="small muted">${notAdm ? '本案件已簽約，不能當成一般未簽約案件直接結案。請和家屬說明後，選擇交回護理重新評估（例如家屬可補足照護條件），或通知結果並結案（解約、退費在系統外依契約辦理）。' : '和家屬討論後記錄協調結果，系統會通知家屬。'}</p>
    <div class="row">${notAdm ? '' : btn('可入住', pass === '收治' ? '協調完成，可以收治' : '協調完成，可以入住', 'primary')}${btn('重評', '交回護理重新評估')}${btn('延期', '延後入住日')}${btn('取消', notAdm ? '通知結果並結案' : '取消或轉介其他機構', 'danger')}</div></div>`;
}

/* 代理權核實：證明文件完成收件核對後，行政確認才讓非本人簽署的同意生效（原型 proofCard） */
function proofCard(R, c){
  if (R.consentState(c) !== '待代理權核實') return '';
  const k = c.consent, pi = R.proofItemOf(c), st = pi ? R.status(pi, c) : '', ready = pi && R.isDone(pi, c);
  return `<div class="card stack hero warn" id="proofCard"><h2>代理權待核實</h2>
    <p>同意書已提交（簽署身分：${esc(SIGNER_LABEL[k.signer] || k.signer)}；簽署人：${esc(k.signerName || '（舊資料未記錄）')}；${esc(k.at)}）。<strong>核實前授權不生效</strong>，醫療資料上傳與查看仍受限制。</p>
    <p>證明文件：${pi ? `${esc(pi.name)} ${P(st)}${['待收件', '身分待確認'].includes(st) ? ` <a class="btn sm" href="${docUrl(c, pi, 'receipt')}">收件核對</a>` : ''}` : '（系統尚未建立證明文件項目）'}</p>
    <p class="small muted">系統只記錄行政人員的核實結果，不代表系統已判斷代理權的法律效力。受輔助宣告者是否需要輔助人同意，請依裁定內容確認。</p>
    <label class="f" data-req>核實說明<input type="text" id="proofNote" placeholder="例：已核對監護宣告裁定書正本，監護人為申請人"></label>
    <div class="err" id="proofErr" role="alert"></div>
    <div class="row"><button type="button" class="btn primary" data-proof="1" ${ready ? '' : 'disabled title="請先完成證明文件收件核對"'}>確認代理權，授權生效</button><button type="button" class="btn danger" data-proof="0">無法核實，需要重新簽署</button></div>
    ${ready ? '' : '<p class="small muted">證明文件完成收件核對後才能確認代理權。</p>'}</div>`;
}

function visitCard(c){
  const v = c.visit, dp = c.depositInfo;
  return `<div class="card" style="margin-top:14px" id="visitCard"><div class="row between"><h2>參訪與保證金（預留欄位）</h2>${!c.closed && !c.archived ? '<button type="button" class="btn sm" id="visitEdit">編輯</button>' : ''}</div>
    <table><tbody><tr><th scope="row">是否安排參訪</th><td>${esc(v.needed)}</td></tr><tr><th scope="row">參訪預定</th><td>${v.date ? slash(v.date) + ' ' + esc(v.time) : '—'}　${pill(v.status, v.status === '已完成' ? 'ok' : v.status === '已預約' ? 'info' : 'mute')}${v.doneAt ? `<br><span class="small muted">實際完成：${esc(v.doneAt)}</span>` : ''}</td></tr>
    <tr><th scope="row">保證金</th><td>${esc(dp.applicable)}　${pill(dp.status, dp.status === '已登錄繳納紀錄' ? 'ok' : 'mute')}${dp.note ? `<br><span class="small muted">${esc(dp.note)}</span>` : ''}</td></tr>${v.note ? `<tr><th scope="row">備註</th><td class="small">${esc(v.note)}</td></tr>` : ''}</tbody></table>
    <p class="small muted">只供記錄，<strong>不會阻擋入住流程</strong>。參訪是否必要依本中心規定，不是全國統一程序。保證金收據請在 F 類「保證金繳納紀錄／收據」上傳；系統不處理付款、退款或收費。</p></div>`;
}

async function casePage({ main, R, c }){
  const p = R.phase(c), canP = R.canProcess(c);
  const needContract = c.flowMode === '先簽後審' && !R.contractSigned(c) && R.consentOk(c) && !c.closed;
  const { data: logs } = await supabase().from('audit_logs').select('action, actor_name, at').eq('case_id', c.id).order('at', { ascending: false }).limit(12);
  const fmt = iso => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  const cs = R.consentState(c), k = c.consent;
  const items = R.caseItems(c.id);
  const docRow = i => `<tr><td>${esc(i.name)}${i.catalogKey ? '' : ' ' + pill('個案新增', 'info')}<br><span class="small muted">${esc(i.stage)}${R.activeStages(c).includes(i.stage) ? '' : '（尚未要求）'}${i.medical ? '・護理核對' : '・行政核對'}</span></td>
      <td>${needPill(R, i)}${i.cond ? `<br><span class="small muted">條件：${esc(uiT(i.cond))}</span>` : ''}${i.needSetBy ? `<br><span class="small muted">${esc(R.accName(i.needSetBy))} 判斷（${esc(i.needSetAt || '')}）${i.needNote ? '：' + esc(i.needNote) : ''}</span>` : ''}${(i.needHist || []).length > 1 ? `<details class="small"><summary>判斷歷程（${i.needHist.length}）</summary>${i.needHist.map(h => `<div>${esc(h.at)} ${esc(R.accName(h.by))}：${esc(h.from)} → ${esc(h.to)}${h.note ? '（' + esc(h.note) + '）' : ''}</div>`).join('')}</details>` : ''}${R.instDoc(i) && canP ? `<br><span class="small">機構提供${i.key === 'contract' ? '；簽約以「家屬已簽約」的紀錄為準' : '；家屬不需上傳'}</span><br><a class="btn sm" href="${docUrl(c, i, 'inst')}">${R.cur(i) ? '上傳新版本' : i.key === 'contract' ? '上傳已簽署契約' : '上傳／登錄'}</a>` : ''}${R.nurseCond(i) ? `<br><span class="small">由負責護理師判斷，行政不能修改</span>${R.needAskOpen(i) ? `<br>${pill('已請護理重新判斷', 'info')}<span class="small muted"> ${esc(i.needAsk.at)}：${esc(i.needAsk.note)}</span>` : canP && c.nurseId ? `<br><button type="button" class="btn sm" data-ask="${i.dbId}">請護理重新判斷</button>` : ''}` : ''}${canP && R.needOf(i) === '條件式必備' && !R.nurseCond(i) ? `<br><button type="button" class="btn sm ${R.condPending(i) ? 'primary' : ''}" data-need="${i.dbId}">${R.condPending(i) ? '確認是否需要' : '修改判斷'}</button>` : ''}</td>
      <td>${P(R.status(i, c))}<br>${checksHtml(R, i, c)}${R.formalReq(i) ? `<br><span class="small">補件請求：${esc(R.reqState(i, c))}${R.reqCloseMissing(i, c) ? '（關閉紀錄待補寫）' : ''}</span>` : i.remind ? `<br><span class="small muted">已提醒 ${i.remind.n} 次（一般提醒，不是補件）</span>` : ''}${R.familyTodo(i, c) && R.activeStages(c).includes(i.stage) && R.dueOf(i, c) ? `<br><span class="small ${R.overdue(i, c) ? '' : 'muted'}" ${R.overdue(i, c) ? 'style="color:var(--bad)"' : ''}>期限 ${md(R.dueOf(i, c))}</span>` : ''}</td>
      <td class="small">${R.cur(i) ? `第 ${R.cur(i).v} 版<br>${esc(R.cur(i).at)}${R.cur(i).fromItem ? `<br>沿用「${esc(R.cur(i).fromItem.name)}」檔案` : ''}` : '—'}</td><td>${R.cur(i) ? `<a class="btn sm" href="${docUrl(c, i, 'doc')}">看文件</a>` : ''}</td></tr>`;
  main.innerHTML = `${back('cases.html', '回到案件列表')}<h1>${esc(c.patient.name)}</h1>
  <p class="lead">申請編號 <span class="mono">${esc(c.no)}</span>　流程：${esc(c.flowMode)}　預計入住 ${slash(c.plannedAdmit)}　${pill(p, PHASE_TONE[p])}</p>
  ${p === '已收治待簽約' ? '<div class="card stack hero ok"><h2>記錄簽約結果</h2><p>簽約在機構現場完成。記錄後，系統會通知家屬準備入住前的檢查報告。</p><div class="row"><button type="button" class="btn primary" data-signed="1">家屬已簽約</button><button type="button" class="btn danger" data-cancel="1">家屬放棄或逾期未簽</button></div></div>' : ''}
  ${needContract ? '<div class="card stack hero warn"><h2>記錄入住契約</h2><p>本案件為「先簽後審」。家屬在機構完成參訪與簽約後，請在這裡記錄。<strong>資料授權同意書不等於入住契約</strong>，未記錄前護理不能做入住前確認。</p><div class="row"><button type="button" class="btn primary" data-signed="1">家屬已簽約</button><button type="button" class="btn danger" data-cancel="1">家屬放棄簽約</button></div></div>' : ''}
  ${p === '待協調' ? coordHero(R, c) : ''}
  ${proofCard(R, c)}
  ${c.archived ? `<div class="notice info">此案件已於 ${esc(c.archived.at)} 封存，原始檔案已刪除，只能查看處理紀錄。</div>` : ''}
  <div class="stack" style="margin-top:14px">
    <div class="card"><h2>基本資料</h2><div class="tbl-wrap"><table><tbody>
      <tr><th scope="row">申請人</th><td>${esc(R.accName(c.familyId))}（${esc(c.relation)}）<br><span class="small mono">${esc((R.acct(c.familyId) || {}).phone || '')}</span></td></tr>
      <tr><th scope="row">護理分配</th><td id="assignInfo">${assignHtml(R, c)}</td></tr>
      <tr><th scope="row">入住契約</th><td>${R.contractSigned(c) ? '已簽約（' + esc(c.signedAt) + '）' : '尚未簽約'}</td></tr>
      <tr><th scope="row">評估</th><td>${c.assessment ? `${esc(c.assessment.result)}（決定：${esc(c.assessment.at)}）${c.assessment.reason ? '<br><span class="small muted">' + esc(c.assessment.reason) + '</span>' : ''}` : '尚未評估'}${(c.assessHistory || []).length ? `<br><span class="small muted">先前評估 ${c.assessHistory.length} 次</span>` : ''}</td></tr>
      <tr><th scope="row">資料授權</th><td>${pill(cs === '有效' ? '授權有效' : cs, cs === '有效' ? 'ok' : cs === '待代理權核實' ? 'warn' : 'mute')}${k && k.signerName ? `<br><span class="small">${k.signer === '本人' ? '<strong>原型流程：</strong>本人簽署未做正式身分驗證，法律效力尚待確認。<br>' : ''}簽署人：${esc(k.signerName)}（${esc(SIGNER_LABEL[k.signer] || k.signer)}）；帳號 ${esc(R.accName(k.by))}；版本 ${esc(k.ver)}；${esc(k.at)}；代理權：${k.signer === '本人' ? '本人簽署，不需核實' : esc(k.proofCheck ? k.proofCheck.result + '（' + R.accName(k.proofCheck.by) + '，' + k.proofCheck.at + '）' : '尚未核實')}</span>` : ''}  ${k ? `${k.withdrawnAt ? '已撤回（' + esc(k.withdrawnAt) + '）' : '已簽署'}（${esc(k.signer)}，${esc(k.at)}）<br><span class="small muted">肖像使用：${k.photo ? '同意' : '未同意'}　緊急送醫：${k.emergency ? '同意' : '未同意'}</span>` : '尚未簽署'}</td></tr>
      <tr><th scope="row">緊急聯絡人</th><td>${(c.contacts || []).map(y => `${esc(y.name)}（${esc(y.rel)}）<span class="mono small">${esc(y.phone)}</span>`).join('<br>') || '<span class="muted">家屬尚未填寫</span>'}</td></tr>
      <tr><th scope="row">照顧摘要卡</th><td>${c.card ? `第 ${c.card.v} 版　${pill(c.card.status, c.card.status === '已開放' ? 'ok' : 'mute')}` : '—'}${(c.cardHistory || []).length ? `<br><span class="small muted">歷史版本 ${c.cardHistory.length} 個</span>` : ''}</td></tr>
      <tr><th scope="row">預計入住日</th><td><div class="row"><input type="date" id="admitEdit" value="${esc(c.plannedAdmit)}" style="max-width:180px" aria-label="預計入住日"><button type="button" class="btn sm" id="admitSave">更新</button></div><span class="small muted">更新後系統會重新檢查文件效期</span></td></tr>
    </tbody></table></div>
    ${!c.closed ? '<p style="margin-top:10px"><button type="button" class="btn sm danger" data-cancel="1">結案（取消、轉介或撤回同意）</button></p>' : `<p class="small muted" style="margin-top:10px">已結案：${esc(c.closed.title)}（決定：${esc(c.closed.at || '')}）</p>`}</div>
    <div class="card" id="docTable"><div class="row between"><h2>文件與要求</h2>${canP ? `<span class="row"><a class="btn sm" href="documents.html?view=add&case=${c.id}&from=case">新增其他文件</a><a class="btn sm" href="documents.html?view=request&case=${c.id}&from=case">要求補件</a></span>` : ''}</div>
    <p class="small muted">文件清單由系統內建。「視情況繳交」的文件請依住民狀況確認本案需要或不需要；尚未確認時不算齊全，也不算家屬缺件。選填文件上傳後一樣要審核。</p><div class="tbl-wrap"><table><thead><tr><th>文件</th><th>要求</th><th>狀態</th><th>版本</th><th></th></tr></thead><tbody>
    ${Object.keys(CATS).filter(key => items.some(i => R.catOf(i) === key)).map(key => `<tr class="cat"><th colspan="5">${key}. ${esc(CATS[key])}</th></tr>` + items.filter(i => R.catOf(i) === key).map(docRow).join('')).join('')}
    </tbody></table></div></div>
  </div>
  ${visitCard(c)}
  <div style="margin-top:14px">${timelineCard(R, c)}</div>
  <div class="card" style="margin-top:14px"><h2>處理紀錄</h2>${(logs || []).length ? `<ul class="tasks">${logs.map(l => `<li class="task"><span class="small muted">${esc(fmt(l.at))}</span><div>${esc(l.action)}</div><span class="small muted">${esc(l.actor_name || '')}</span></li>`).join('')}</ul>` : '<p class="muted">尚無紀錄</p>'}</div>`;
  bindCase(main, R, c);
}

/* 依新的預計入住日，算出會變成「確認過期」的文件（給資料庫通知家屬用） */
const expiredWith = (R, c, date) => R.caseItems(c.id).filter(i => R.status(i, { ...c, plannedAdmit: date }) === '確認過期').map(i => i.dbId);

function bindCase(main, R, c){
  const rpc = (fn, args) => supabase().rpc(fn, args);
  /* 記錄簽約：簽約後需要家屬上傳的入住前文件，交給資料庫通知家屬 */
  main.querySelectorAll('[data-signed]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    const signed = { ...c, signedAt: '0000/00/00 00:00' };
    const later = R.caseItems(c.id).filter(i => i.stage === '入住前' && R.familyTodo(i, signed)).map(i => i.dbId);
    const { error } = await rpc('record_signing', { p_case: c.id, p_later: later });
    b.disabled = false;
    if (error){ toast('記錄簽約失敗：' + errText(error) + '。資料沒有變更，可以再試一次。'); return; }
    done('已記錄入住契約');
  }));
  /* 結案 */
  main.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', () => modal({ title: '結案', ok: '結案', danger: true,
    body: '<label class="f">結案原因<select id="ccType"><option>家屬放棄或逾期未簽</option><option>取消入住</option><option>轉介其他機構</option></select><span class="hint">家屬撤回資料授權請由家屬在系統操作，或依書面撤回記錄</span></label><label class="f" data-req>說明<textarea id="ccNote"></textarea></label><p class="small muted">結案後資料依機構保存規則處理，不會立即刪除。</p>',
    onOk: async host => {
      const t = host.querySelector('#ccType').value, n = host.querySelector('#ccNote').value.trim(); if (!n) return '請填寫說明';
      const { error } = await rpc('close_case', { p_case: c.id, p_type: t, p_note: n });
      if (error) return '結案失敗：' + errText(error) + '。資料沒有變更，可以再試一次。';
      done('已結案，家屬會收到系統通知'); return '';
    } })));
  /* 預計入住日 */
  main.querySelector('#admitSave')?.addEventListener('click', async e => {
    const v = main.querySelector('#admitEdit').value; if (!isDate(v)){ toast('請輸入正確日期'); return; }
    e.currentTarget.disabled = true;
    const { error } = await rpc('update_admit', { p_case: c.id, p_date: v, p_expired: expiredWith(R, c, v) });
    e.currentTarget.disabled = false;
    if (error){ toast('更新預計入住日失敗：' + errText(error)); return; }
    done('已更新，文件效期已重新計算');
  });
  /* 代理權核實 */
  main.querySelectorAll('[data-proof]').forEach(b => b.addEventListener('click', async () => {
    const note = main.querySelector('#proofNote').value.trim(), err = main.querySelector('#proofErr'), ok = b.dataset.proof === '1';
    if (!note){ err.textContent = '請填寫核實說明'; return; }
    b.disabled = true;
    const { error } = await rpc('verify_proxy', { p_case: c.id, p_ok: ok, p_note: note });
    b.disabled = false;
    if (error){ err.textContent = '儲存失敗：' + errText(error) + '。狀態沒有變更。'; return; }
    done(ok ? '已確認代理權，授權生效' : '已標示無法核實');
  }));
  /* 協調 */
  main.querySelectorAll('[data-coord]').forEach(b => b.addEventListener('click', () => coordModal(R, c, b.dataset.coord)));
  /* 參訪與保證金 */
  main.querySelector('#visitEdit')?.addEventListener('click', () => visitModal(c));
  /* 文件需求判斷（行政判斷的視情況繳交文件） */
  main.querySelectorAll('[data-need]').forEach(b => b.addEventListener('click', () => needModal(R, c, Object.values(R.caseItems(c.id)).find(i => i.dbId === b.dataset.need))));
  main.querySelectorAll('[data-ask]').forEach(b => b.addEventListener('click', () => askModal(R, c, R.caseItems(c.id).find(i => i.dbId === b.dataset.ask))));
}

function coordModal(R, c, r){
  const a = c.assessment || {}, notAdm = a.result === '不符合收治條件', pass = PASS[c.flowMode];
  const call = async args => { const { error } = await supabase().rpc('coordinate', { p_case: c.id, p_result: r, p_note: '', p_date: null, p_close_type: null, p_expired: [], ...args }); return error; };
  if (r === '取消') return modal({ title: notAdm ? '通知結果並結案' : '取消或轉介', ok: '通知並結案', danger: true,
    body: `<label class="f">結果<select id="ccType">${notAdm ? '<option>不符合收治條件，解除契約</option><option>轉介其他機構</option>' : '<option>取消入住</option><option>轉介其他機構</option>'}</select></label><label class="f" data-req>給家屬的結果說明（請用白話，不要寫診斷細節）<textarea id="ccNote"></textarea></label>${notAdm ? '<p class="small muted">本案件已簽約。解約與退費在系統外依契約辦理，系統只記錄結果與通知時間。</p>' : ''}`,
    onOk: async host => { const n = host.querySelector('#ccNote').value.trim(); if (!n) return '請填寫結果說明';
      const e = await call({ p_note: n, p_close_type: host.querySelector('#ccType').value }); if (e) return '結案失敗：' + errText(e) + '。資料沒有變更，可以再試一次。';
      done('已通知家屬並結案'); return ''; } });
  if (r === '重評') return modal({ title: '交回護理重新評估', ok: '交回護理',
    body: '<label class="f" data-req>協調內容<textarea id="coNote" placeholder="例：家屬同意自費加裝氣墊床，請重新評估"></textarea></label>',
    onOk: async host => { const n = host.querySelector('#coNote').value.trim(); if (!n) return '請填寫協調內容';
      const e = await call({ p_note: n }); if (e) return '交回護理失敗：' + errText(e) + '。資料沒有變更，可以再試一次。';
      done('已交回護理重新評估'); return ''; } });
  if (r === '可入住'){
    if (notAdm){ toast('「不符合收治條件」需交回護理重新評估，行政不能直接改為可入住'); return; }
    return modal({ title: `協調完成：${pass === '收治' ? '可以收治' : '可以入住'}`, ok: '確認',
      body: '<label class="f" data-req>協調內容（會留存紀錄）<textarea id="coNote" placeholder="例：家屬同意自費加裝氣墊床"></textarea></label><p class="small muted">護理評估時已說明只要協調完成即可照顧；如需重新判斷照護能力，請改選「交回護理重新評估」。</p>',
      onOk: async host => { const n = host.querySelector('#coNote').value.trim(); if (!n) return '請填寫協調內容';
        const e = await call({ p_note: n }); if (e) return '記錄協調結果失敗：' + errText(e) + '。資料沒有變更，可以再試一次。';
        done(pass === '收治' ? '已記錄，等待家屬簽約' : '已記錄協調結果'); return ''; } });
  }
  return modal({ title: '延後入住日', ok: '延後',
    body: '<label class="f">新的預計入住日<input type="date" id="coDate"></label><label class="f" data-req>原因<textarea id="coNote"></textarea></label><p class="small muted">延後後，護理師需要重新評估；有效期限的文件會依新日期重新檢查。</p>',
    onOk: async host => { const d = host.querySelector('#coDate').value, n = host.querySelector('#coNote').value.trim();
      if (!isDate(d)) return '請選擇新的日期'; if (!n) return '請填寫原因';
      const e = await call({ p_note: n, p_date: d, p_expired: expiredWith(R, c, d) }); if (e) return '延後入住日失敗：' + errText(e) + '。資料沒有變更，可以再試一次。';
      done('已延後，已交回護理師重新評估'); return ''; } });
}

function visitModal(c){
  const v = c.visit, dp = c.depositInfo;
  const sel = (id, opts, val) => `<select id="${id}">${opts.map(o => `<option ${o === val ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  modal({ title: '參訪與保證金', ok: '儲存',
    body: `<div class="grid2"><label class="f">是否安排參訪${sel('vNeed', ['未確認', '需要', '不需要'], v.needed)}</label><label class="f">參訪狀態${sel('vSt', ['未安排', '已預約', '已完成', '已取消'], v.status)}</label></div>
      <div class="grid2"><label class="f">預定日期<input type="date" id="vDate" value="${esc(v.date)}"></label><label class="f">預定時間<input type="time" id="vTime" value="${esc(v.time)}"></label></div>
      <div class="grid2"><label class="f">保證金是否適用${sel('dApp', ['未確認', '適用', '不適用'], dp.applicable)}</label><label class="f">保證金狀態${sel('dSt', ['未確認', '待繳納', '已登錄繳納紀錄', '不適用'], dp.status)}</label></div>
      <label class="f">保證金備註<input type="text" id="dNote" value="${esc(dp.note)}"></label><label class="f">參訪備註<input type="text" id="vNote" value="${esc(v.note)}"></label>
      <p class="small muted">只記錄狀態，不會阻擋流程；系統不處理付款。「已登錄繳納紀錄」只表示行政已登錄，收據請在 F 類上傳。</p>`,
    onOk: async host => {
      const g = id => host.querySelector('#' + id).value;
      if (g('vSt') === '已預約' && !isDate(g('vDate'))) return '已預約時請填寫預定日期';
      if (g('dApp') === '不適用' && ['待繳納', '已登錄繳納紀錄'].includes(g('dSt'))) return '保證金不適用時，狀態請選「不適用」或「未確認」';
      const { error } = await supabase().rpc('save_visit', { p_case: c.id, p_needed: g('vNeed'), p_status: g('vSt'), p_date: g('vDate') || null, p_time: g('vTime') || null, p_note: g('vNote'),
        p_dep_app: g('dApp'), p_dep_status: g('dSt'), p_dep_note: g('dNote') });
      if (error) return '儲存失敗：' + errText(error) + '。資料沒有變更，可以再試一次。';
      done('已儲存'); return '';
    } });
}

function needModal(R, c, it){
  const curVal = it.condMet === true ? 'yes' : it.condMet === false ? 'no' : 'null';
  const opts = [['yes', '本案需要', '住民符合條件：' + uiT(it.cond || '—')], ['no', '本案不需要', '住民不符合條件，家屬端顯示「本案不需繳交」'], ['null', '尚未確認', '資訊還不足以判斷；文件不算齊全，也不會列為家屬缺件']];
  modal({ title: `是否需要：${it.name}`, ok: '儲存',
    body: `<p class="small">條件：${esc(uiT(it.cond || '依住民狀況'))}<br>目前：${needPill(R, it)}　狀態：${P(R.status(it, c))}</p>${R.condPending(it) ? '<p class="small notice warn">這份文件<strong>尚未確認</strong>是否需要，請依個案狀況選擇。</p>' : ''}${R.cur(it) ? '<p class="small muted">已上傳的檔案與審核紀錄都會保留。</p>' : ''}<fieldset data-req><legend>判斷結果</legend>${opts.map(([v, t, h]) => `<label class="choice"><input type="radio" name="needSel" value="${v}" ${v === curVal && it.condMet != null ? 'checked' : ''}><span><strong>${esc(t)}</strong><br><span class="small muted">${esc(h)}</span></span></label>`).join('')}</fieldset><label class="f" data-req>原因（會留在紀錄）<input type="text" id="needNote" placeholder="例：申請人電話中說明簽約者為長子"></label>`,
    onOk: async host => {
      const sel = (host.querySelector('input[name=needSel]:checked') || {}).value, note = host.querySelector('#needNote').value.trim();
      if (!sel) return '請選擇本案需要、本案不需要或尚未確認';
      if (!note) return '請填寫原因';
      const { error } = await supabase().rpc('set_document_need', { p_doc: it.dbId, p_met: sel === 'yes' ? true : sel === 'no' ? false : null, p_note: note });
      if (error) return '儲存判斷失敗：' + errText(error);
      done('已更新'); return '';
    } });
}

function askModal(R, c, it){
  modal({ title: `請護理重新判斷：${it.name}`, ok: '送出',
    body: `<p class="small">目前：${needPill(R, it)}${it.needSetBy ? `（${esc(R.accName(it.needSetBy))}，${esc(it.needSetAt || '')}${it.needNote ? '：' + esc(it.needNote) : ''}）` : ''}</p><p class="small muted">送出後會出現在負責護理師（${esc(R.accName(c.nurseId))}）的工作清單。判斷結果仍由護理決定，不會改變目前的需求判斷。</p><label class="f" data-req>原因<input type="text" id="askNote" placeholder="例：家屬電話中提到住民有尿管"></label>`,
    onOk: async host => {
      const note = host.querySelector('#askNote').value.trim(); if (!note) return '請填寫原因';
      const { error } = await supabase().rpc('ask_nurse_need', { p_doc: it.dbId, p_note: note });
      if (error) return '送出請求失敗：' + errText(error);
      done('已請護理重新判斷'); return '';
    } });
}

/* ========== 案件分配（原型 nurseAssignPage） ========== */
/* 分配者不是承辦人，讀不到算出階段所需的資料：階段由伺服器端 Edge Function（case-phases）用同一份規則計算後回傳。
 * 取不到時照實顯示「無法取得」，不用不完整的資料自己算（會算錯）。 */
async function serverPhases(ids){
  if (!ids.length) return { phases: {} };
  const { data, error } = await supabase().functions.invoke('case-phases', { body: { case_ids: ids } });
  if (error || !data || !data.phases) return { phases: {}, error: (data && data.error) || (error && error.message) || '伺服器沒有回應' };
  return data;
}

function assignPage({ main, D, R, M }){
  const open = Object.values(D.cases).filter(c => c.linkStatus === '已確認' && !c.closed && !c.archived);
  const wait = open.filter(c => !c.nurseId).sort((a, b) => (a.createdTs || 0) - (b.createdTs || 0)), had = open.filter(c => c.nurseId);
  /* 先畫出整頁（案件狀態顯示「讀取中」），伺服器算好後再填上，不讓整頁等 Edge Function */
  const phaseCell = c => `<span data-phase="${c.id}">${pill('讀取中', 'mute')}</span>`;
  const hist = c => (c.assignHist || []).length ? `<details class="small"><summary>分配歷程（${c.assignHist.length}）</summary>${c.assignHist.map(y => `<div>${esc(y.at)} ${esc(R.accName(y.by))}：${y.from ? esc(R.accName(y.from)) + ' → ' : ''}${esc(R.accName(y.to))}${y.reason ? '（' + esc(y.reason) + '）' : ''}</div>`).join('')}</details>` : '';
  const row = (c, btn) => `<tr><td class="mono">${esc(c.no)}</td><td>${esc(c.patient.name)}</td><td class="small">${esc(stampDate(c.createdAt) ? slash(stampDate(c.createdAt)) : '—')}</td><td>${slash(c.plannedAdmit)}</td><td>${phaseCell(c)}</td><td>${pill(R.assignState(c), ASSIGN_TONE[R.assignState(c)])}${c.nurseId ? '<br>' + esc(R.accName(c.nurseId)) : ''}${hist(c)}</td><td>${btn}</td></tr>`;
  const head = '<thead><tr><th>案件編號</th><th>預計入住者</th><th>申請日期</th><th>預計入住日期</th><th>案件狀態</th><th>護理分配狀態</th><th></th></tr></thead>';
  main.innerHTML = `<h1>案件分配</h1><div id="phaseErrBox"></div>${purpose('行政確認申請後會轉交護理部門。請為待分配案件指定承辦護理師，或更換已分配案件的承辦者。分配歷程會保留；更換承辦不會刪除文件、核對、補件、評估或摘要卡紀錄。')}
  <div class="card tbl-wrap" id="assignWait"><h2>待分配案件（${wait.length}）</h2><table>${head}<tbody>${wait.map(c => row(c, `<button type="button" class="btn sm primary" data-assign="${c.id}">指定承辦</button>`)).join('') || '<tr><td colspan="7" class="empty">目前沒有待分配的案件</td></tr>'}</tbody></table></div>
  <div class="card tbl-wrap" style="margin-top:14px" id="assignDone"><h2>已分配案件（${had.length}）</h2><table>${head}<tbody>${had.map(c => row(c, `<button type="button" class="btn sm" data-assign="${c.id}">更換承辦</button>`)).join('') || '<tr><td colspan="7" class="empty">—</td></tr>'}</tbody></table></div>
  <p class="small muted">分配權限由資料庫檢查（每次寫入時重新確認帳號設定）；一般護理師直接呼叫也不能分配。</p>`;
  serverPhases(open.map(c => c.id)).then(sp => {
    main.querySelectorAll('[data-phase]').forEach(el => { const p = sp.phases[el.dataset.phase]; el.innerHTML = p ? pill(p, PHASE_TONE[p]) : pill('無法取得', 'mute'); });
    if (sp.error) main.querySelector('#phaseErrBox').innerHTML = `<div class="notice warn small" id="phaseErr">案件狀態暫時無法取得（${esc(sp.error)}），分配功能不受影響。</div>`;
  });
  main.querySelectorAll('[data-assign]').forEach(b => b.addEventListener('click', async () => {
    const c = D.cases[b.dataset.assign], prev = c.nurseId || '';
    const cf = await conflictsOf(c.id).catch(() => ({}));
    if (cf[M.id]){ toast('請由其他同仁分配：' + cf[M.id]); return; }
    const nurses = Object.values(D.accounts).filter(a => a.role === 'nurse' && a.status === '啟用');
    const opts = nurses.map(n => `<option value="${esc(n.id)}" ${cf[n.id] || n.id === prev ? 'disabled' : ''}>${esc(n.name)}${n.id === prev ? '（目前承辦）' : ''}${cf[n.id] ? '（' + esc(cf[n.id]) + '，不能承辦）' : ''}</option>`).join('');
    const { data: note } = await supabase().rpc('conflict_note');
    modal({ title: `${prev ? '更換承辦護理師' : '指定承辦護理師'}：${c.patient.name}`, ok: prev ? '更換' : '指定',
      body: `${prev ? `<p class="small">目前承辦：${esc(R.accName(prev))}。更換後，原承辦者不能再處理這個案件；已完成的文件核對、草稿、補件、評估與摘要卡紀錄都會保留，由新承辦者接續。</p>` : ''}<label class="f" data-req>承辦護理師<select id="asNurse"><option value="">請選擇</option>${opts}</select></label>${nurses.some(n => cf[n.id]) ? `<p class="small notice warn">標示不能承辦的護理人員：${esc(note)}</p>` : ''}<label class="f"${prev ? ' data-req' : ''}>${prev ? '更換原因' : '備註（選填）'}<input type="text" id="asReason"></label>`,
      onOk: async host => {
        const to = host.querySelector('#asNurse').value, reason = host.querySelector('#asReason').value.trim();
        if (!to) return '請選擇承辦護理師';
        if (prev && !reason) return '請填寫更換原因';
        const { error } = await supabase().rpc('assign_nurse', { p_case: c.id, p_nurse: to, p_prev: prev || null, p_reason: reason });
        if (error) return (prev ? '更換承辦' : '指定承辦') + '失敗：' + errText(error);
        done(prev ? '已更換承辦護理師' : '已指定承辦護理師'); return '';
      } });
  }));
}
