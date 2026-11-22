/* application.html：入住申請與授權（HANDOFF 6.1、6.2；原型第 (18) 版 familyApply、familyApplyPreview、familyApplied、
 * familyHome、familyConsent、familyContacts、familyLife）。畫面與文字沿用原型。
 *
 * 網址：
 *   application.html?view=apply                     入住申請表（草稿暫存在 sessionStorage，返回修改不會遺失）
 *   application.html?view=preview                   確認申請資料 → 確認送出（RPC create_application）
 *   application.html?view=applied&case=<id>         申請已送出
 *   application.html?case=<id>                      案件詳情：目前要做的事、進度條、補件進度、文件進度、處理歷程
 *   application.html?view=consent&case=<id>         個人資料同意書（sign_consent／decline_consent）
 *   application.html?view=contacts&case=<id>        緊急聯絡人（save_contacts）
 *   application.html?view=habit&case=<id>&sec=<n>   生活與照護習慣卡（save_habit_section／submit_habit）
 *
 * 寫入一律呼叫資料庫 RPC（一個交易內檢查權限與狀態並記錄操作紀錄），確認成功後才更新畫面；
 * 失敗時顯示原因，已填的內容保留在畫面上，可以再按一次。
 * 上傳文件、完整文件清單在 documents.html（階段 6）；參訪紀錄在 cases.html（階段 5）。 */
import { bootPage } from '../page.js';
import { supabase } from '../api/supabase.js';
import { loadModel, invalidateModel, todayTW } from './services/model.js';
import { esc, pill, helpLine, toast, modal, onSubmit, errText, purpose, setFlash, decorateRequired } from '../ui.js';
import { accountCard, bindAccountCard, stepsBar, timelineCard } from './family-ui.js';
import { reqMailWord } from './mail-ui.js';
import { TONE, PHASE_TONE, FAMILY_WORD, SIGNER_LABEL, CATS, HABIT_SECS, HABIT_REQ, HABIT_LABEL_FAM, ADL_OPTS, slash, md, uiT, stampDate } from './rules/core.js';

const P = (t, tone) => pill(t, tone || TONE[t] || 'mute');
const RELATIONS = ['本人', '兒子', '女兒', '配偶', '媳婦', '女婿', '孫子女', '其他親屬', '監護人或法定代理人'];
const nidOk = s => /^[A-Z][12A-D89]\d{8}$/.test(s || '');
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const back = (href, text) => `<a class="back" href="${href}">← ${esc(text)}</a>`;
const caseUrl = (c, view, extra = '') => `application.html?${view ? `view=${view}&` : ''}case=${c.id}${extra}`;

/* 申請草稿：只存在這個分頁（sessionStorage），送出成功後清除 */
const draft = {
  get(){ try { return JSON.parse(sessionStorage.getItem('applyDraft') || 'null'); } catch { return null; } },
  set(v){ try { sessionStorage.setItem('applyDraft', JSON.stringify(v)); } catch { /* 無法保存時只在這次有效 */ } },
  clear(){ try { sessionStorage.removeItem('applyDraft'); } catch { /* ignore */ } }
};

/* 表單有未儲存的修改時，離開頁面前提醒（原型 leaveGuard） */
let dirty = false;
window.addEventListener('beforeunload', e => { if (dirty){ e.preventDefault(); e.returnValue = ''; } });
const trackDirty = form => form && form.addEventListener('input', () => { dirty = true; });

bootPage('application', async ctx => {
  const { me, view, params, main } = ctx;
  /* 這一頁給家屬使用；行政從 cases.html 處理案件 */
  if (me.role !== 'family'){ location.replace(params.get('case') ? `cases.html?case=${params.get('case')}` : 'cases.html'); return; }
  if (view === 'apply') return applyForm(ctx);
  if (view === 'preview') return applyPreview(ctx);
  const model = await loadModel(me);
  const c = model.D.cases[params.get('case')];
  if (!c){ main.innerHTML = `<div class="narrow"><div class="card stack"><h1>找不到這筆申請</h1><p>這筆申請不存在，或不是您提出的申請。</p><a class="btn primary" href="dashboard.html">回到個人首頁</a></div></div>`; return; }
  /* M：模型格式的目前帳號（姓名、電話、通知 Email）；me：profiles 列（登入 Email 用） */
  const x = { ...ctx, D: model.D, R: model.R, M: model.me, c };
  if (view === 'applied') return applied(x);
  if (view === 'consent') return consentPage(x);
  if (view === 'contacts') return contactsPage(x);
  if (view === 'habit') return habitPage(x);
  return caseHome(x);
});

/* ========== 入住申請表 ========== */
async function applyForm({ main, me, org }){
  const v = draft.get() || {};
  const { data: hosp } = await supabase().from('partner_hospitals').select('name').eq('active', true).order('sort');
  const today = todayTW();
  main.innerHTML = `<div class="narrow">${back('dashboard.html', '回到首頁')}
  <h1>入住申請</h1>
  ${purpose('填寫預計入住者的基本資料。下一步會先讓您確認，<strong>按「確認送出」後才會建立正式申請</strong>。送出後，本中心承辦人會打電話給您確認身分與關係（聯絡時間依本中心作業安排）。')}
  <form class="card stack" id="applyForm" novalidate>
    <div class="f"><span>申請人</span><div><strong>${esc(me.name)}</strong>　<span class="small muted">${esc(me.email)}　${esc(me.phone || '')}</span></div><span class="hint">申請人是目前登入的帳號</span></div>
    <label class="f" data-req>預計入住者姓名<input type="text" name="pname" value="${esc(v.pname || '')}"></label>
    <label class="f" data-req>預計入住者身分證字號<span class="hint">英文字母請大寫，例：A223456789</span><input type="text" name="nid" maxlength="10" autocomplete="off" value="${esc(v.nid || '')}"></label>
    <label class="f" data-req>預計入住者出生日期<input type="date" name="birth" max="${today}" value="${esc(v.birth || '')}"></label>
    <label class="f" data-req>申請人與預計入住者的關係<span class="hint">預計入住者本人申請時請選「本人」</span><select name="relation">${RELATIONS.map(r => `<option ${(v.relation || '兒子') === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
    <label class="f">目前住院或就醫的醫院（選填）<span class="hint">可以從清單選，也可以直接輸入</span><input type="text" name="hospital" list="partnerList" value="${esc(v.hospital || '')}"><datalist id="partnerList">${(hosp || []).map(p => `<option value="${esc(p.name)}">`).join('')}</datalist></label>
    <label class="f" data-req>預計入住日期<span class="hint">之後還可以和本中心討論調整</span><input type="date" name="admit" min="${today}" value="${esc(v.admit || '')}"></label>
    <div class="err" id="applyErr" role="alert"></div>
    <button type="submit" class="btn primary big">下一步：確認申請資料</button>
  </form>${helpLine(org)}</div>`;
  const form = main.querySelector('#applyForm'), err = main.querySelector('#applyErr');
  trackDirty(form);
  onSubmit(form, async d => {
    const keep = { pname: String(d.get('pname') || '').trim(), nid: String(d.get('nid') || '').trim().toUpperCase(), birth: d.get('birth'), relation: d.get('relation'),
      hospital: String(d.get('hospital') || '').trim(), admit: d.get('admit') };
    const nv = Object.assign({}, v, keep);
    draft.set(nv);
    if (!keep.pname){ err.textContent = '請填寫預計入住者姓名'; return; }
    if (!nidOk(keep.nid)){ err.textContent = '身分證字號格式不正確，請確認（英文字母大寫＋9 位數字）'; return; }
    if (!isDate(keep.birth)){ err.textContent = '請填寫預計入住者出生日期'; return; }
    if (!isDate(keep.admit)){ err.textContent = '請填寫預計入住日期'; return; }
    /* 同一份申請只用一個識別碼：重新送出或網路重試都對應同一筆，不會建立兩筆案件 */
    if (!nv.token) nv.token = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    nv.lastError = '';
    draft.set(nv);
    dirty = false;
    location.assign('application.html?view=preview');
  });
}

/* ========== 確認申請資料 → 確認送出 ========== */
function applyPreview({ main, me, org }){
  const v = draft.get();
  if (!v || !v.token){ location.replace('application.html?view=apply'); return; }
  const row = (k, x) => `<tr><th scope="row">${k}</th><td>${x}</td></tr>`;
  main.innerHTML = `<div class="narrow" id="applyPreview"><h1>確認申請資料</h1>
  ${purpose('請確認以下資料。<strong>確認送出後，系統才會記錄正式申請時間</strong>；在這一頁還沒有建立申請。')}
  <div class="card"><table><tbody>
    ${row('申請人姓名', esc(me.name))}${row('申請人聯絡電話', esc(me.phone || '—'))}${row('申請人電子郵件', esc(me.notify_email || me.email))}
    ${row('預計入住者姓名', esc(v.pname))}${row('兩者關係', esc(v.relation))}${row('預計入住者出生日期', slash(v.birth))}${row('預計入住者身分證字號', `<span class="mono">${esc(v.nid)}</span>`)}
    ${row('目前就醫醫院', esc(v.hospital || '（未填）'))}${row('預計入住日期', slash(v.admit))}
  </tbody></table></div>
  <form class="card stack" id="applyPreviewForm" novalidate>
    <div class="err" id="apErr" role="alert">${v.lastError ? esc(v.lastError) : ''}</div>
    <div class="row"><a class="btn" href="application.html?view=apply">返回修改</a><button type="submit" class="btn primary big">確認送出</button></div>
  </form>${helpLine(org)}</div>`;
  const form = main.querySelector('#applyPreviewForm'), err = main.querySelector('#apErr');
  onSubmit(form, async () => {
    err.textContent = '送出中，請稍候…';
    const { data, error } = await supabase().rpc('create_application', { p_token: v.token, p_name: v.pname, p_nid: v.nid, p_birth: v.birth, p_relation: v.relation, p_hospital: v.hospital, p_admit: v.admit });
    if (error){ v.lastError = '送出失敗：' + errText(error) + '。申請尚未建立，您填的資料都還在，請再按一次「確認送出」。'; draft.set(v); err.textContent = v.lastError; return; }
    /* 使用者決定：同一身分證字號已有資料、內容不同時不建立申請，請聯絡機構，並通知行政處理 */
    if (data.status === 'resident_conflict'){
      v.lastError = '這個身分證字號已有資料且內容不同，請聯絡機構確認。申請尚未建立；本中心承辦人已收到通知，會與您聯絡。';
      draft.set(v); err.innerHTML = esc(v.lastError) + (org && org.phone ? `<br>聯絡電話：<strong>${esc(org.phone)}</strong>${org.hours ? `（${esc(org.hours)}）` : ''}` : '');
      return;
    }
    draft.clear(); invalidateModel();
    location.replace(`application.html?view=applied&case=${data.case_id}`);
  });
}

/* ========== 申請已送出 ========== */
/* 申請確認 Email：測試環境尚未介接郵件服務，只建立通知工作、標示未寄出，不顯示已寄出或已送達 */
function mailLine(c){
  const m = c.applyMail;
  /* 舊資料（沒有申請識別碼，原型 seed 的案件）：沒有通知任務也不顯示（與原型相同） */
  if (!m && !c.applyToken) return '';
  if (!m) return '<div class="notice warn small" id="mailLine">申請確認 Email：通知任務尚未建立。<strong>申請本身已成功送出，不受影響。</strong></div>';
  return `<div class="notice info small" id="mailLine">申請確認 Email：已建立通知任務（收件：${esc(m.to)}）。<strong>測試環境尚未介接郵件服務，信件不會實際寄出</strong>；郵件服務接受寄送、確認送達、使用者完成驗證三項都尚未發生。通知內容只有申請編號、申請時間、目前狀態與查詢方式，不含身分證字號或醫療資料。${m.attempts > 1 ? `　已重新寄送 ${m.attempts - 1} 次（皆未實際寄出）` : ''} <button type="button" class="btn sm" id="mailResend">重新寄送</button></div>`;
}
function bindMailLine(main, c, rerender){
  const b = main.querySelector('#mailResend'); if (!b) return;
  b.addEventListener('click', async () => {
    b.disabled = true;
    const { error } = await supabase().rpc('resend_apply_mail', { p_case: c.id });
    if (error){ toast('沒有重新寄送：' + errText(error)); b.disabled = false; return; }
    /* 成功後重新整理畫面（次數更新），提示在重新整理後顯示 */
    setFlash('已記錄重新寄送；測試環境尚未介接郵件服務，信件不會實際寄出'); rerender();
  });
}

function applied({ main, R, M, c, org }){
  const t = String(c.createdAt || '').split(' ')[1] || '';
  main.innerHTML = `<div class="narrow" id="appliedPage"><div class="card hero ok stack"><h1>入住申請已成功送出</h1>
    <table><tbody>
      <tr><th scope="row">案件編號</th><td class="mono">${esc(c.no)}</td></tr>
      <tr><th scope="row">申請人</th><td>${esc(M.name)}</td></tr>
      <tr><th scope="row">預計入住者</th><td>${esc(c.patient.name)}（${esc(c.relation)}）</td></tr>
      <tr><th scope="row">送出日期</th><td>${slash(stampDate(c.createdAt))}</td></tr>
      <tr><th scope="row">送出時間</th><td>${esc(t)}（台灣時間）</td></tr>
      <tr><th scope="row">目前狀態</th><td>${pill(R.famPhase(c), 'warn')}</td></tr>
    </tbody></table>
    <p><strong>下一步：</strong>本中心承辦人會打電話到 <strong>${esc(M.phone || '')}</strong>，確認您的身分與關係（聯絡時間依本中心作業安排，確認後系統會通知您）。確認後請登入簽署個人資料同意書，再依清單上傳文件。</p>
    ${mailLine(c)}
    <div class="row"><a class="btn primary" href="${caseUrl(c)}">查看申請進度</a><a class="btn" href="dashboard.html">返回個人首頁</a></div></div>${helpLine(org)}</div>`;
  bindMailLine(main, c, () => location.reload());
}

/* ========== 案件詳情（原型 familyHome） ========== */
/* 結案說明：行政結案時寫在 closed_text；家屬自己撤回或不同意時依類型顯示 */
const CLOSED_TEXT = (c, org) => c.closed.text ? c.closed.text : c.closedType === '撤回' ? '機構已停止使用住民的資料，並依保存規則處理。如需重新申請，請來電：' + (org?.phone || '')
  : c.closedType === '不同意' ? '機構無法進行評估。如果改變心意，請來電：' + (org?.phone || '') : (c.closed.reason || '');
const FAMILY_NEED_FN = R => it => it.key === 'contract' ? ['機構提供，簽約時完成', 'info'] : R.instDoc(it) ? ['機構提供', 'info'] : R.notApplicable(it) ? ['本案不需繳交', 'mute'] : R.needOf(it) === '選填' ? ['選填', 'info'] : R.condPending(it) ? [R.nurseCond(it) ? '待護理確認' : '視情況繳交', 'warn'] : R.nurseCond(it) ? ['本案需要繳交', 'bad'] : ['需要繳交', 'bad'];
const famName = i => uiT(i.famName || i.name);
const uploadUrl = (c, i) => `documents.html?view=upload&case=${c.id}&item=${i.dbId}`;

function familyTodoRow(R, i, c){
  const st = R.status(i, c);
  let why = uiT(i.why || '');
  if (st === '確認過期'){ const v = R.cur(i); why = `這份報告的日期是 ${slash(R.itemDate(i, v)) || '無法確認'}，入住時會超過 ${i.validDays} 天。請做 ${md(R.needBy(i, c))} 以後的檢查。`; }
  if (st === '需補件') why = `需要重新上傳：${i.returned.reason}${i.returned.note ? `（${i.returned.note}）` : ''}`;
  const due = R.dueOf(i, c), od = R.overdue(i, c);
  const dueLine = due ? `<div class="small" style="color:var(${od ? '--bad' : '--muted'})">${od ? `已超過期限（${md(due)}），請盡快上傳或來電告知` : `請在 ${md(due)} 前上傳`}</div>` : '';
  return `<div class="todo"><div class="t-main"><div class="t-name">${esc(famName(i))}</div><div class="t-why">${esc(why)}</div>${dueLine}</div><a class="btn primary" href="${uploadUrl(c, i)}">${st === '未上傳' ? '上傳' : '重新上傳'}</a></div>`;
}
const habitTodoRow = (R, c) => `<div class="todo" id="habitTodo"><div class="t-main"><div class="t-name">住民生活與照護習慣卡（必填）</div><div class="t-why">線上填寫，不需要上傳檔案；填好後按「正式提交」。${P(...R.habitFamLabel(c))}</div></div><a class="btn primary" href="${caseUrl(c, 'habit')}">${R.habitFamState(c) === '尚未填寫' ? '開始填寫' : '繼續填寫並提交'}</a></div>`;

/* 文件進度：本階段要做的事 → 等待本中心處理 → 下一階段預告 → 已完成（原型 familyDocGroups） */
function familyDocGroups(R, c, heroTodo){
  if (!R.listOk(c)) return '';
  const items = R.caseItems(c.id).filter(i => !R.notApplicable(i)), act = i => R.activeStages(c).includes(i.stage);
  const todo = items.filter(i => act(i) && R.canProcess(c) && R.familyTodo(i, c));
  const pend = items.filter(i => act(i) && R.condPending(i) && !R.cur(i));
  const wait = items.filter(i => act(i) && R.cur(i) && !R.familyTodo(i, c) && !R.isDone(i, c));
  const done = items.filter(i => act(i) && R.isDone(i, c) && (R.cur(i) || i.key === 'contract'));
  const later = items.filter(i => !act(i) && (R.isNeeded(i) || R.condPending(i)) && !R.instDoc(i));
  const two = c.flowMode === '先簽後審' || R.contractSigned(c);
  const row = (i, txt, tone, btn) => `<div class="todo"><div class="t-main"><div class="t-name">${esc(famName(i))}</div><div class="t-why">${txt}</div></div>${btn || ''}${tone ? pill(tone[0], tone[1]) : ''}</div>`;
  const byStage = (arr, f) => two ? ['評估前', '入住前'].map(st => { const a = arr.filter(i => i.stage === st); return a.length ? `<p class="small muted" style="margin:8px 0 0"><strong>${st === '評估前' ? '評估前文件' : '入住前文件（目前需要準備）'}</strong></p>` + a.map(f).join('') : ''; }).join('') : arr.map(f).join('');
  const sec = (id, title, arr, f, note) => arr.length ? `<div id="${id}"><h3 style="margin:12px 0 4px">${title}（${arr.length}）</h3>${note ? `<p class="small muted" style="margin:0">${note}</p>` : ''}${byStage(arr, f)}</div>` : '';
  const upBtn = i => `<a class="btn sm primary" href="${uploadUrl(c, i)}">${R.status(i, c) === '未上傳' ? '上傳' : '重新上傳'}</a>`;
  const hl = R.habitFamLabel(c), hst = R.habitState(c), habOn = R.consentOk(c) && !c.closed;
  const habBtn = R.habitFamState(c) === '已提交（有修改尚未提交）' ? '繼續修改並提交' : '查看狀態';
  const sub = R.habitSub(c);
  const habRow = `<div class="todo" data-habit="1" id="habitRow"><div class="t-main"><div class="t-name">住民生活與照護習慣卡（必填，線上填寫）</div><div class="t-why">${pill(hl[0], hl[1])}${sub && sub.at ? `　最近一次提交：${esc(sub.at)}` : ''}</div></div><a class="btn sm" href="${caseUrl(c, 'habit')}">${habBtn}</a></div>`;
  const habIn = g => !habOn ? false : g === 'todo' ? R.habitFamTodo(c) : g === 'wait' ? !!sub && hst !== '審核完成' : g === 'done' ? hst === '審核完成' : false;
  const p = R.phase(c);
  return `<div class="card" id="docGroups"><h2>文件進度</h2><p style="margin:0" id="grpPhase">目前階段：${pill(p, PHASE_TONE[p])}</p><p class="small muted" style="margin:4px 0 0">上傳後要等本中心審核，審核通過才算完成。依階段顯示：本階段要做的事 → 等待本中心處理 → 下一階段預告 → 已完成。</p>
    ${heroTodo || habIn('todo') ? `<div id="grpTodo"><h3 style="margin:12px 0 4px">目前需要處理（${todo.length + (habIn('todo') ? 1 : 0)}）</h3><p class="small muted" style="margin:0">請看上方「目前要做的事」。</p></div>` : sec('grpTodo', '目前需要處理', todo, i => row(i, esc(R.status(i, c) === '需補件' && i.returned ? '需要重新上傳：' + i.returned.reason : FAMILY_WORD[R.status(i, c)] || ''), null, upBtn(i)))}
    ${sec('grpPend', '等待本中心判斷是否需要', pend, i => row(i, esc(uiT(i.cond) || '依住民狀況') + '。這不是您的缺件；' + (R.nurseCond(i) ? '護理人員判斷需要時，系統會自動通知您' : '確認後會通知您') + '，現在也可以先上傳。', [R.nurseCond(i) ? '待護理判斷' : '待確認', 'warn'], R.canProcess(c) ? `<a class="btn sm" href="${uploadUrl(c, i)}">先上傳現有文件</a>` : ''))}
    ${wait.length || habIn('wait') ? `<div id="grpWait"><h3 style="margin:12px 0 4px">正在等待本中心審核（${wait.length + (habIn('wait') ? 1 : 0)}）</h3>${habIn('wait') ? habRow : ''}${byStage(wait, i => row(i, `${esc(FAMILY_WORD[R.status(i, c)] || R.status(i, c))}${R.cur(i) ? `（第 ${R.cur(i).v} 版，${esc(R.cur(i).at)} 上傳）` : ''}`, ['審核中', 'info']))}</div>` : ''}
    ${later.length ? `<details id="grpLater" style="margin-top:12px"><summary><strong>下一階段預告｜後續階段準備項目：入住前文件（簽約後再準備）（${later.length}）</strong></summary><p class="small muted" style="margin:4px 0 0">可以先看準備說明，現在不用上傳，也不會算成缺件或逾期。</p>${later.map(i => row(i, `簽約後再準備。${esc(uiT(i.where || ''))}`, ['後續階段', 'mute'])).join('')}</details>` : ''}
    ${done.length || habIn('done') ? `<details id="grpDone" style="margin-top:12px"><summary><strong>已完成（${done.length + (habIn('done') ? 1 : 0)}）</strong></summary>${habIn('done') ? habRow : ''}${byStage(done, i => row(i, esc(FAMILY_WORD[R.status(i, c)] || '已完成'), ['已完成', 'ok']))}</details>` : ''}
    ${!todo.length && !pend.length && !wait.length && !done.length && !later.length ? '<p class="empty">目前沒有文件。</p>' : ''}</div>`;
}

async function caseHome({ main, R, D, M, c, org, me }){
  const p = R.phase(c), list = R.myFamilyCases();
  const todo = R.activeItems(c).filter(i => R.familyTodo(i, c)), habTodo = R.habitFamTodo(c);
  const phone = esc(org?.phone || '');
  let hero = '';
  if (c.closed) hero = `<div class="card hero bad"><h2>${esc(c.closed.title)}</h2><p>${esc(CLOSED_TEXT(c, org))}</p></div>`;
  else if (p === '待機構確認') hero = `<div class="card hero warn"><h2>待行政確認</h2><p>本中心已收到您的申請。承辦人會打電話到 <strong>${esc(M.phone)}</strong>，確認您的身分和與預計入住者的關係。確認後就能開始上傳文件。</p>${mailLine(c)}</div>`;
  else if (p === '待代理權核實'){ const pi = R.proofItemOf(c); hero = `<div class="card hero warn" id="proofHero"><h2>同意書已提交，待本中心核實代理權</h2><p>簽署身分：${esc(SIGNER_LABEL[c.consent.signer] || c.consent.signer)}（${esc(c.consent.signerName || '')}）。本中心核實代理權或輔助人同意後，授權才會生效；在此之前還不能上傳醫療資料。</p>${pi ? `<p>請先上傳「${esc(famName(pi))}」：${P(FAMILY_WORD[R.status(pi, c)] || R.status(pi, c), TONE[R.status(pi, c)])}</p>${['未上傳', '需補件'].includes(R.status(pi, c)) ? `<a class="btn primary big" href="${uploadUrl(c, pi)}">上傳${esc(famName(pi))}</a>` : ''}` : ''}</div>`; }
  else if (p === '待同意') hero = `<div class="card hero"><h2>第一步：請先簽署同意書</h2><p>簽署後，本中心才能收下並查看預計入住者的醫療資料。大約需要 3 分鐘。</p><a class="btn primary big" href="${caseUrl(c, 'consent')}">閱讀並簽署同意書</a></div>`;
  else if (todo.length || habTodo) hero = `<div class="card hero ${todo.some(i => R.status(i, c) !== '未上傳') ? 'bad' : 'warn'}" id="todoHero"><p class="muted small">目前要做的事</p><h2>${todo.length ? `您還需要上傳 <span class="big-num">${todo.length}</span> 份文件` : '請完成必填資料'}${habTodo ? (todo.length ? '，並提交習慣卡' : '') : ''}</h2>${todo.map(i => familyTodoRow(R, i, c)).join('')}${habTodo ? habitTodoRow(R, c) : ''}</div>`;
  else if (p === '已收治待簽約') hero = `<div class="card hero ok"><h2>${esc(c.patient.name)}已通過評估</h2><p>本中心可以提供照顧。請來電預約參訪與簽約：<strong>${phone}</strong>。</p><p class="muted small">簽約後，系統會提醒您準備入住前的檢查報告。</p></div>`;
  else if (p === '待簽約') hero = `<div class="card hero ok"><h2>文件都已確認</h2><p>請來電預約參訪與簽約：<strong>${phone}</strong>。簽約後，護理師會為住民做入住前的照護準備。</p><p class="muted small">您簽的「資料授權同意書」只同意機構使用資料，<strong>不等於入住契約</strong>。</p></div>`;
  else if (p === '摘要卡審核中') hero = `<div class="card hero" id="cardStateHero"><h2>文件已確認，照顧團隊準備中</h2><p>入住前文件都已確認，護理師正在整理並審核給照顧團隊的照顧摘要。審核完成前，入住準備尚未完成。預計入住日：<strong>${slash(c.plannedAdmit)}</strong>。</p></div>`;
  else if (p === '摘要卡已開放') hero = `<div class="card hero ok" id="cardStateHero"><h2>入住準備完成</h2><p>所有文件都已確認，護理師已完成照顧摘要的審核並交給照顧團隊。預計入住日：<strong>${slash(c.plannedAdmit)}</strong>。</p></div>`;
  else if (p === '摘要卡待重新審核') hero = `<div class="card hero warn" id="cardStateHero"><h2>資料已更新，護理師重新確認中</h2><p>部分資料有更新（例如您修改了生活與照護習慣卡），護理師正在重新確認給照顧團隊的照顧摘要。目前不需要您做任何事。預計入住日：<strong>${slash(c.plannedAdmit)}</strong>。</p></div>`;
  else if (p === '摘要卡已停用') hero = `<div class="card hero warn" id="cardStateHero"><h2>照顧團隊資料暫停使用</h2><p>護理師暫停了給照顧團隊的照顧摘要，正在重新確認。如有疑問請來電：${phone}。</p></div>`;
  else if (p === '待協調') hero = '<div class="card hero warn"><h2>本中心正在和您協調入住安排</h2><p>承辦人會和您聯絡。</p></div>';
  else hero = '<div class="card hero ok"><h2>文件都收到了，目前不用做任何事</h2><p>本中心正在確認文件，有需要時會在系統通知您。審核所需時間依本中心作業安排，完成後會在這裡更新狀態。</p></div>';

  /* 完整通知集中在「通知」頁；案件頁只留未讀數量的簡短連結 */
  const { count: unread } = await supabase().from('notices').select('id', { count: 'exact', head: true }).eq('to', M.id).eq('case_id', c.id).is('read_at', null);
  const notices = unread ? `<p class="small" id="noticeLink" style="margin:0">這筆申請有 ${unread} 則未讀通知。<a class="link" href="dashboard.html?view=notices">到「通知」查看</a></p>` : '';
  const docList = !c.closed ? familyDocGroups(R, c, todo.length || habTodo) + `<p class="small" id="fullListLink" style="margin:0">需要看七大類全部文件與後續準備項目？<a class="link" href="documents.html?view=list&case=${c.id}">到「申請流程說明」查看完整文件清單</a></p>` : '';
  /* 補件進度：只列正式補件；補傳不等於完成，確認符合才關閉（HANDOFF 10.3） */
  const reqItems = R.caseItems(c.id).filter(i => R.formalReq(i) && !R.notApplicable(i));
  const reqCard = reqItems.length && !c.closed ? `<div class="card" id="reqCard"><h2>補件進度</h2><p class="small muted" style="margin:0">本中心正式提出的補件要求。重新上傳後，要等本中心確認問題已解決才會關閉。</p>${reqItems.map(i => { const rs = R.reqState(i, c), v = R.cur(i), after = !!v && (v.ts ? v.ts > (i.req.ts || 0) : String(v.at || '') > String(i.req.at || ''));
      return `<div class="todo" data-req="${esc(i.id)}"><div class="t-main"><div class="t-name">${esc(famName(i))}</div>
        <div class="t-why">原因：${esc(i.req.reason)}${i.req.note ? '（' + esc(i.req.note) + '）' : ''}　提出：${esc(i.req.source === '護理' ? '護理師' : i.req.source === '行政' ? '行政' : '系統')}${i.req.at ? '　要求時間：' + esc(i.req.at) : ''}${i.req.due ? '　期限：' + slash(i.req.due) : ''}</div>
        <div class="t-why">${after ? `已重新上傳（第 ${v.v} 版，${esc(v.at)}）` : '尚未重新上傳'}　審核結果：${esc(FAMILY_WORD[R.status(i, c)] || R.status(i, c))}　Email 通知：${esc(reqMailWord((D.mail || {})['req_' + i.req.id]))}</div></div>${pill(rs === '已關閉' ? '已關閉' : rs, rs === '已關閉' ? 'ok' : rs === '已逾期' ? 'bad' : 'warn')}</div>`; }).join('')}</div>` : '';
  const withdraw = c.consent && !c.closed && R.consentOk(c) ? `<details class="card"><summary class="small">撤回資料授權同意</summary><p class="small">撤回後，機構會停止使用住民的資料，入住申請也會結束。撤回前已處理的資料依法不受影響。</p><button type="button" class="btn danger sm" id="withdrawBtn">撤回同意</button></details>` : '';
  const switcher = list.length > 1 ? `<label class="f small" style="max-width:320px">切換申請<select id="caseSwitch">${list.map(x => `<option value="${esc(x.id)}" ${x.id === c.id ? 'selected' : ''}>${esc(x.patient.name)}（${esc(x.no)}）</option>`).join('')}</select></label>` : '';
  const cs = R.consentState(c);
  main.innerHTML = `<div class="narrow">
    ${back('dashboard.html', '回到個人首頁')}
    ${switcher}
    <h1>${esc(c.patient.name)}的入住申請</h1>
    <p class="lead">預計入住日：${slash(c.plannedAdmit)}　申請編號 <span class="mono">${esc(c.no)}</span>${c.createdAt ? `　送出：${esc(c.createdAt)}` : ''}</p>
    ${c.linkStatus === '已確認' ? `<p class="row" style="gap:8px;margin:-4px 0 12px" id="consentLine">資料授權：${pill(({ '未簽署': '未授權', '有效': '已授權', '已撤回': '已撤回' })[cs] || cs, ({ '未簽署': 'warn', '有效': 'ok', '已撤回': 'mute' })[cs] || 'warn')}　入住契約：${pill(R.contractSigned(c) ? '已簽約' : '尚未簽約', R.contractSigned(c) ? 'ok' : 'mute')}</p>` : ''}
    ${c.closed || p === '待機構確認' ? '' : `<h2 style="font-size:1rem;margin:0 0 8px">我的申請進度</h2>${stepsBar(R, c)}`}
    <div class="stack">${hero}${reqCard}${notices}${docList}${visitLine(c, org)}${timelineCard(R, c)}${withdraw}${accountCard(M)}</div>${helpLine(org)}</div>`;
  bindAccountCard(main, M);
  bindMailLine(main, c, () => location.reload());
  main.querySelector('#caseSwitch')?.addEventListener('change', e => location.assign(`application.html?case=${e.target.value}`));
  /* 撤回同意：輸入登入密碼確認（原型相同），成功後案件結案 */
  main.querySelector('#withdrawBtn')?.addEventListener('click', () => modal({ title: '撤回資料授權同意', danger: true, ok: '確定撤回',
    body: '<p>撤回後，機構會停止使用住民的資料，<strong>這次入住申請也會結束</strong>。之後若要重新申請，需要重新簽署。</p><label class="f">輸入您的登入密碼確認<input type="password" id="wdPw" autocomplete="current-password"></label>',
    onOk: async host => {
      const pw = host.querySelector('#wdPw').value;
      const chk = await supabase().auth.signInWithPassword({ email: me.email, password: pw });
      if (chk.error) return '密碼不正確';
      const { error } = await supabase().rpc('withdraw_consent', { p_case: c.id });
      if (error) return '撤回同意失敗：' + errText(error) + '。資料沒有變更，可以再試一次。';
      invalidateModel(); setFlash('已撤回同意'); location.assign(caseUrl(c)); return '';
    } }));
}

/* ========== 個人資料同意書 ========== */
function consentPage({ main, R, c, org }){
  const cats = [...new Set(R.caseItems(c.id).filter(i => !R.notApplicable(i)).map(R.catOf))];
  const name = esc(org?.name || '');
  main.innerHTML = `<div class="narrow">${back(caseUrl(c), '回到首頁')}
  <h1>個人資料蒐集、處理及利用同意書</h1>
  <p class="small notice warn">本功能為電子同意流程示範，正式簽署及法律效力仍須確認。輸入姓名或勾選同意不等於法律上的數位簽章；個人資料同意書也和入住契約、DNR、預立醫療決定是不同的文件。</p>
  ${purpose(`同意${name}收下並查看${esc(c.patient.name)}的醫療資料，用來評估能不能入住。`)}
  <div class="card stack"><h2>重點說明</h2>
    <ul>
      <li><strong>給誰：</strong>只給「${name}」，不會給其他單位。</li>
      <li><strong>哪些資料：</strong>${cats.map(k => esc(CATS[k])).join('、')}（各類別的文件明細在首頁「文件清單」）。</li>
      <li><strong>用來做什麼：</strong>評估能不能照顧住民，以及入住前的照顧準備。</li>
      <li><strong>保存多久：</strong>沒有入住的話，依機構規定的期限後刪除或封存。</li>
      <li><strong>可以反悔嗎：</strong>可以，隨時可以聯絡機構撤回同意。</li>
    </ul>
    <details><summary>閱讀同意書全文（第 1 版）</summary><p class="small">立同意書人同意${name}依個人資料保護法規定，為評估入住及入住前照護準備之目的，蒐集、處理及利用上述個人資料；資料僅提供本機構使用，不提供其他單位。立同意書人得隨時以書面或本系統撤回同意，撤回前已依法處理之資料不受影響。未入住者之資料，依本機構保存規則於期限屆滿後刪除或封存。</p></details>
  </div>
  ${R.consentState(c) === '代理權未通過' ? `<div class="notice bad">上次的簽署因代理權無法核實，未成為有效授權：${esc((c.consent && c.consent.proofCheck && c.consent.proofCheck.note) || '')}。請重新選擇簽署身分並簽署。</div>` : ''}
  <form class="card stack" id="consentForm" novalidate>
    <p class="small muted" style="margin:0">步驟：閱讀同意書 → 選擇簽署身分 → 勾選同意事項 → 輸入簽署人姓名 → 確認同意</p>
    <fieldset data-req><legend>簽署身分（實際簽署的人是誰？）</legend>
      <label class="choice"><input type="radio" name="signer" value="本人"><span><strong>預計入住者本人</strong><br><span class="small muted">本人意識清楚、可以自己決定時（由本人在這台裝置上確認）</span></span></label>
      <label class="choice"><input type="radio" name="signer" value="監護人"><span><strong>法定代理人／監護人</strong><br><span class="small muted">預計入住者已由法院宣告受監護。需提供裁定書，本中心核實後授權才生效</span></span></label>
      <label class="choice"><input type="radio" name="signer" value="代理人"><span><strong>其他經適當授權的代理人</strong><br><span class="small muted">需提供授權證明，本中心核實後授權才生效。一般家屬沒有代理權時不能代簽</span></span></label>
      <label class="choice"><input type="radio" name="signer" value="受輔助宣告"><span><strong>預計入住者本人（受輔助宣告）</strong><br><span class="small muted">仍由本人簽署；受輔助宣告的具體權限需另外確認，本中心確認是否需要輔助人同意後授權才生效</span></span></label>
    </fieldset>
    <p class="small muted" style="margin:0">申請人不一定是簽署人。代理或輔助的法律權限依個案確認，系統不會直接視為有效。</p>
    <div class="err" id="signerErr" role="alert"></div>
    <label class="choice" data-req><input type="checkbox" name="agree"><span><strong>（必要）</strong>我已閱讀並同意上述個人資料蒐集、處理及利用內容</span></label>
    <fieldset><legend>其他同意事項（選填，不影響入住評估）</legend>
      <label class="choice"><input type="checkbox" name="photo"><span><strong>肖像使用</strong><br><span class="small muted">入住後機構活動照片可用於機構內公告與家屬群組，不對外公開</span></span></label>
      <label class="choice"><input type="checkbox" name="emergency"><span><strong>緊急送醫</strong><br><span class="small muted">發生緊急狀況、聯絡不到家屬時，同意機構先行送醫</span></span></label>
    </fieldset>
    <label class="f" data-req>簽署人真實姓名<span class="hint">請填實際簽署的人（本人、監護人或代理人）的姓名，不是登入密碼</span><input type="text" name="signerName" autocomplete="name"></label>
    <div class="err" id="consentErr" role="alert"></div>
    <button type="submit" class="btn primary big">確認同意</button>
    <button type="button" class="btn" id="consentNo">我不同意</button>
  </form>${helpLine(org)}</div>`;
  const form = main.querySelector('#consentForm'), err = main.querySelector('#consentErr'), serr = main.querySelector('#signerErr');
  trackDirty(form);
  onSubmit(form, async d => {
    const signer = d.get('signer'), signerName = String(d.get('signerName') || '').trim();
    if (!SIGNER_LABEL[signer]){ serr.textContent = '請選擇簽署身分'; return; } serr.textContent = '';
    if (!d.get('agree')){ err.textContent = '請勾選必要的同意事項'; return; }
    if (signerName.length < 2){ err.textContent = '請輸入簽署人真實姓名'; return; }
    const { data, error } = await supabase().rpc('sign_consent', { p_case: c.id, p_signer: signer, p_signer_name: signerName, p_agree: true, p_photo: !!d.get('photo'), p_emergency: !!d.get('emergency') });
    if (error){ err.textContent = '送出失敗：' + errText(error) + '。尚未完成，請再試一次。'; return; }
    dirty = false; invalidateModel();
    setFlash(data === '待代理權核實' ? '已提交同意，待本中心核實代理權後生效' : '資料授權完成');
    location.assign(caseUrl(c));
  });
  main.querySelector('#consentNo').addEventListener('click', () => modal({ title: '確定不同意嗎？', danger: true, ok: '確定不同意',
    body: '<p>不同意的話，機構無法收下醫療資料，也無法評估入住。機構承辦人會打電話給您說明。</p>',
    onOk: async () => {
      const { error } = await supabase().rpc('decline_consent', { p_case: c.id });
      if (error) return '送出失敗：' + errText(error) + '。資料沒有變更，可以再試一次。';
      dirty = false; invalidateModel(); location.assign(caseUrl(c)); return '';
    } }));
}

/* ========== 緊急聯絡人 ========== */
function contactsPage({ main, c, M, org }){
  const ct = c.contacts || [];
  const row = (n, x = {}) => `<fieldset><legend>${n === 0 ? '主要聯絡人' : '第二聯絡人（選填）'}</legend>
    <label class="f"${n === 0 ? ' data-req' : ''}>姓名<input type="text" name="name${n}" value="${esc(x.name)}"></label>
    <div class="grid2"><label class="f">和住民的關係<input type="text" name="rel${n}" value="${esc(x.rel)}" placeholder="例：兒子"></label>
    <label class="f"${n === 0 ? ' data-req' : ''}>電話<input type="tel" name="phone${n}" value="${esc(x.phone)}" placeholder="0912-345-678"></label></div></fieldset>`;
  main.innerHTML = `<div class="narrow">${back(caseUrl(c), '回到首頁')}
  <h1>緊急聯絡人</h1>${purpose('住民發生緊急狀況時，機構會先打給主要聯絡人，聯絡不到再打給第二聯絡人。')}
  <form class="card stack" id="contactForm" novalidate>
    ${row(0, ct[0] || { name: M.name, rel: c.relation, phone: M.phone })}${row(1, ct[1])}
    <div class="err" id="ctErr" role="alert"></div>
    <button type="submit" class="btn primary big">儲存</button>
  </form>${helpLine(org)}</div>`;
  const form = main.querySelector('#contactForm'), err = main.querySelector('#ctErr');
  trackDirty(form);
  onSubmit(form, async d => {
    const list = [0, 1].map(n => ({ name: String(d.get('name' + n) || '').trim(), rel: String(d.get('rel' + n) || '').trim(), phone: String(d.get('phone' + n) || '').trim() }));
    if (!list[0].name || !list[0].phone){ err.textContent = '請填寫主要聯絡人的姓名和電話'; return; }
    for (const x of list) if (x.phone && !/^[\d\-+\s()#]{8,}$/.test(x.phone)){ err.textContent = '電話號碼格式不正確'; return; }
    if (list[1].name && !list[1].phone){ err.textContent = '請填寫第二聯絡人的電話'; return; }
    const { error } = await supabase().rpc('save_contacts', { p_case: c.id, p_contacts: list.filter(y => y.name) });
    if (error){ err.textContent = '儲存失敗：' + errText(error) + '。您填的內容還在，請再試一次。'; return; }
    dirty = false; invalidateModel(); setFlash('已儲存'); location.assign(caseUrl(c));
  });
}

/* ========== 生活與照護習慣卡（原型 familyLife） ========== */
function habitPage(x){
  const { main, R, c, org, params } = x;
  if (!R.consentOk(c) || c.closed){ location.replace(caseUrl(c)); return; }
  const n = Math.min(HABIT_SECS.length - 1, Math.max(0, Number(params.get('sec')) || 0)), sec = HABIT_SECS[n];
  const h = R.habitDraft(c), hs = R.habitStatus(c), fs = R.habitFamState(c), miss = R.habitReqMissing(h), ct = c.contacts || [];
  const secFilled = s => s.fields.some(f => filled(h[f.k]) || (f.type === 'adl' && filled(h[f.k.replace('adl_', 'adlN_')])));
  const fld = f => {
    const v = h[f.k], rq = HABIT_REQ.includes(f.k) ? ' data-req' : '';
    if (f.type === 'multi') return `<fieldset${rq}><legend>${esc(f.label)}</legend><div class="row">${f.opts.map(o => `<label class="choice" style="padding:6px 10px"><input type="checkbox" name="${f.k}" value="${esc(o)}" ${[].concat(v || []).includes(o) ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}</div></fieldset>`;
    if (f.type === 'select') return `<label class="f"${rq}>${esc(f.label)}<select name="${f.k}"><option value="">${rq ? '請選擇' : '（不填）'}</option>${f.opts.map(o => `<option ${v === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
    if (f.type === 'adl'){ const nk = f.k.replace('adl_', 'adlN_'); return `<fieldset class="field"${rq}><legend>${esc(f.label)}</legend><div class="row">${ADL_OPTS.map(o => `<label class="choice" style="padding:6px 10px"><input type="radio" name="${f.k}" value="${esc(o)}" ${v === o ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}</div><label class="f small">補充說明（選填）<input type="text" name="${nk}" value="${esc(h[nk] || '')}" maxlength="60"></label></fieldset>`; }
    if (f.type === 'time') return `<label class="f">${esc(f.label)}<input type="time" name="${f.k}" value="${esc(v || '')}" style="max-width:180px"></label>`;
    return `<label class="f"${rq}>${esc(f.label)}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}<input type="text" name="${f.k}" value="${esc(v || '')}" maxlength="120"></label>`;
  };
  const sub = R.habitSub(c), hst = R.habitState(c);
  const stateLabel = fs === '尚未填寫' ? '待填寫／未提交' : fs === '草稿' ? '草稿（未提交）' : fs === '已提交' ? (hst === '審核完成' ? '審核完成' : hst === '有疑義／待確認' ? '有疑義／待確認' : '已提交，待護理初審') : '有修改尚未提交';
  const stateTone = fs === '已提交' && hst === '審核完成' ? 'ok' : fs === '已提交' ? 'info' : 'warn';
  const contactsBox = sec.k === 'G' ? `<div class="card stack"><h3>正式緊急聯絡人（沿用案件資料）</h3>${ct.length ? ct.map((y, m) => `<p style="margin:0">${m ? '第二' : '主要'}聯絡人：<strong>${esc(y.name)}</strong>（${esc(y.rel)}）<span class="mono">${esc(y.phone)}</span></p>`).join('') : '<p class="small muted" style="margin:0">尚未填寫正式緊急聯絡人。</p>'}<p class="small muted" style="margin:0">要修改電話或聯絡人，請按下方按鈕，會<strong>更新案件的正式聯絡資料</strong>；這一頁只補充交接卡說明。</p><a class="btn sm" href="${caseUrl(c, 'contacts')}">修改正式聯絡資料</a></div>` : '';
  const secAt = c.habit && c.habit.secAt && c.habit.secAt[sec.k];
  main.innerHTML = `<div class="narrow">${back(caseUrl(c), '回到首頁')}
  <h1>住民生活與照護習慣卡（必填）</h1>${purpose('讓照顧服務員更快認識住民。這是<strong>第一階段必要資料</strong>：可以分次填、先儲存草稿，填好後按「正式提交」，護理師初審完成才算完成。標示 <span class="req">*</span> 的欄位必填，不確定可以選「不清楚」或填「無」；其他欄位選填。內容會標示為「家屬提供」，不會取代病歷或護理評估。')}
  <div class="card stack" id="habitSubmitBox"><div><strong>目前狀態：</strong>${pill(stateLabel, stateTone)}${sub ? `　最近一次提交：${esc(sub.at || '舊資料，時間未記錄')}` : ''}</div>
    ${fs === '已提交' ? '<p class="small muted" style="margin:0">修改後要再按一次「正式提交」，護理師才會看到新的內容。</p>' : `<p class="small" style="margin:0">${miss.length ? `還有必填欄位未填：${esc(miss.map(k => HABIT_LABEL_FAM[k]).join('、'))}` : '必填欄位都已填寫，可以正式提交。'}</p>
    <div class="err" id="hsErr" role="alert"></div><div><button type="button" class="btn primary" id="habitSubmit">正式提交習慣卡</button></div>`}</div>
  <p class="small muted">${hs.filled ? `已填寫 ${hs.filled}／${hs.total} 區，最後修改：${esc(hs.at)}（${esc(R.accName(hs.by))}）　資料來源：家屬提供` : '尚未填寫。'}</p>
  <nav class="row" aria-label="習慣卡分區" style="margin-bottom:12px">${HABIT_SECS.map((s, m) => `<a class="btn sm" href="${caseUrl(c, 'habit', '&sec=' + m)}" ${m === n ? 'aria-current="step" style="border-color:var(--accent);font-weight:700"' : ''}>${s.k}. ${esc(s.title)} ${secFilled(s) ? '✓' : ''}</a>`).join('')}</nav>
  <form class="card stack" id="habitForm" novalidate>
    <h2>${sec.k}. ${esc(sec.title)} ${pill(secFilled(sec) ? '已填寫' : '尚未填寫', secFilled(sec) ? 'ok' : 'mute')}</h2>
    ${sec.note ? `<p class="notice info small">${esc(sec.note)}</p>` : ''}
    ${sec.fields.map(fld).join('')}
    ${secAt ? `<p class="small muted">這一區最後修改：${esc(secAt.at)}（${esc(R.accName(secAt.by))}）</p>` : ''}
    <div class="err" id="hbErr" role="alert"></div>
    <div class="row"><button type="submit" class="btn primary" name="go" value="${n < HABIT_SECS.length - 1 ? 'next' : 'home'}">${n < HABIT_SECS.length - 1 ? '儲存並到下一區' : '儲存並完成'}</button><button type="submit" class="btn" name="go" value="stay">儲存草稿</button></div>
  </form>${contactsBox}${helpLine(org)}</div>`;
  decorateRequired(main);
  const form = main.querySelector('#habitForm'), err = main.querySelector('#hbErr');
  trackDirty(form);
  let goTo = 'stay';
  form.querySelectorAll('button[type=submit]').forEach(b => b.addEventListener('click', () => { goTo = b.value; }));
  onSubmit(form, async d => {
    /* 每次只送出目前這一區的欄位，資料庫合併進草稿 */
    const vals = {};
    sec.fields.forEach(f => {
      vals[f.k] = f.type === 'multi' ? d.getAll(f.k).map(String) : String(d.get(f.k) || '').trim();
      if (f.type === 'adl'){ const nk = f.k.replace('adl_', 'adlN_'); vals[nk] = String(d.get(nk) || '').trim(); }
    });
    const { error } = await supabase().rpc('save_habit_section', { p_case: c.id, p_sec: sec.k, p_vals: vals });
    if (error){ err.textContent = '儲存失敗：' + errText(error) + '。您填的內容還在畫面上，請再按一次儲存。'; return; }
    dirty = false; invalidateModel();
    setFlash('已儲存草稿「' + sec.title + '」' + (sub ? '' : '（尚未正式提交）'));
    location.assign(goTo === 'next' ? caseUrl(c, 'habit', '&sec=' + (n + 1)) : goTo === 'home' ? caseUrl(c) : caseUrl(c, 'habit', '&sec=' + n));
  });
  main.querySelector('#habitSubmit')?.addEventListener('click', async e => {
    const b = e.currentTarget, herr = main.querySelector('#hsErr');
    if (dirty){ herr.textContent = '這一區有尚未儲存的修改，請先按「儲存草稿」再正式提交。'; return; }
    b.disabled = true;
    const { data, error } = await supabase().rpc('submit_habit', { p_case: c.id });
    b.disabled = false;
    if (error){ herr.textContent = '提交失敗：' + errText(error) + (/必填|空白|相同/.test(error.message) ? '' : '。您填的內容還在，請再試一次。'); return; }
    invalidateModel(); setFlash(`已正式提交（第 ${data} 次），待護理初審`); location.assign(caseUrl(c));
  });
}
/* 參訪預約（行政在案件頁登錄；原型 visitLine） */
const visitLine = (c, org) => { const v = c.visit || {}; return v.date && !c.closed ? `<div class="notice info small">參訪預約：${slash(v.date)} ${esc(v.time)}（${esc(v.status)}）。如需改期請來電 ${esc(org?.phone || '')}。</div>` : ''; };
const filled = v => Array.isArray(v) ? v.length > 0 : String(v == null ? '' : v).trim() !== '';
