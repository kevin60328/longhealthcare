/* dashboard.html：依角色的首頁與工作清單（HANDOFF 6.1、6.2、10.9）。畫面與文字沿用原型第 (18) 版。
 *
 * 網址：
 *   家屬   dashboard.html                個人首頁（familyPersonal）
 *          dashboard.html?view=mycases   我的申請紀錄（familyMyCases）
 *          dashboard.html?view=notices   通知（familyNotices；打開即標為已讀）
 *   行政   dashboard.html[?tab=done]     今天要處理的事＋個案資料夾（staffHome）；tab=done 已完成工作
 *   護理   dashboard.html[?tab=done]     我的工作清單＋個案資料夾（nurseHome）
 *   照服員 dashboard.html                我的住民（viewCare）
 *
 * 規則全部在 rules/core.js（與原型逐行對照並有對照測試）；這裡只負責畫面。
 * 待辦按鈕會連到其他頁面（documents.html 等），那些頁面在之後的階段完成。
 * 個案資料夾預設收合，展開狀態記在 localStorage（HANDOFF 10.9）；搜尋與排序記在 sessionStorage。 */
import { bootPage } from '../page.js';
import { supabase } from '../api/supabase.js';
import { loadModel } from './services/model.js';
import { openConflicts } from './services/conflicts.js';
import { badgeCounts } from './services/badges.js';
import { esc, pill, helpLine, modal, toast, errText } from '../ui.js';
import { accountCard, bindAccountCard } from './family-ui.js';
import { TONE, PHASE_TONE, slash } from './rules/core.js';

const P = (t, tone) => pill(t, tone || TONE[t] || 'mute');
const store = {
  get(k, d){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 無法保存就只在這次有效 */ } },
  sget(k, d){ try { return sessionStorage.getItem(k) ?? d; } catch { return d; } },
  sset(k, v){ try { sessionStorage.setItem(k, v); } catch { /* ignore */ } }
};

bootPage('dashboard', async ({ main, me, view, params, shell, org }) => {
  if (me.role === 'care') return careHome(main);
  const { D, R, me: M } = await loadModel(me);
  const ctx = { D, R, M, org, main, shell, params };
  if (me.role === 'family'){
    if (view === 'notices') return familyNotices(ctx);
    if (view === 'mycases') return familyMyCases(ctx);
    return familyPersonal(ctx);
  }
  if (me.role === 'staff' || me.role === 'nurse'){
    if (me.role === 'staff') ctx.conflicts = await openConflicts();
    return workHome(ctx);
  }
});

/* ---------- 原型畫面代號 → 新版網址（HANDOFF 6.2）；從工作清單點進去帶 from=home，導覽列維持在「工作清單」 ---------- */
function goUrl(go, D, fromHome = true){
  const [page, arg] = go, it = D.items[arg], f = fromHome ? '&from=home' : '';
  switch (page){
    case 'apply': return `cases.html?view=confirm&case=${arg}${f}`;
    case 'case': return `cases.html?case=${arg}${f}`;
    case 'receipt': return `documents.html?view=receipt&item=${it ? it.dbId : ''}${f}`;
    case 'date': return `documents.html?view=date&item=${it ? it.dbId : ''}${f}`;
    case 'followup': return `documents.html?view=followup${f}`;
    case 'resident': return `assessment.html?case=${arg}${f}`;
    case 'review': return `assessment.html?view=review&item=${it ? it.dbId : ''}${f}`;
    case 'assess': return `assessment.html?view=assess&case=${arg}${f}`;
    case 'card': return `care-summary.html?case=${arg}${f}`;
    default: return 'dashboard.html';
  }
}

/* ========== 家屬 ========== */
const famApplyMain = () => `<section class="card hero stack" id="applyMain" aria-labelledby="applyMainH"><h2 id="applyMainH" style="margin:0">我要申請入住</h2><p style="margin:0">為自己或家人建立新的入住申請。</p><div><a class="btn primary big" href="application.html?view=apply">開始入住申請</a></div></section>`;
const famSecondary = cur0 => `<nav class="fam-sec" id="famSecondary" aria-label="其他功能">${[['mycases', '我的申請紀錄', '查看所有申請的狀態與進度', 'dashboard.html?view=mycases'], ['guide', '申請流程說明', '流程、完整文件清單與後續準備項目', 'documents.html?view=list']].filter(([p]) => p !== cur0).map(([, t, d, href]) => `<a class="fam-sec-btn" href="${href}"><strong>${t}</strong><span class="small muted">${d}</span></a>`).join('')}</nav>`;
const backHome = () => '<a class="back" href="dashboard.html">← 回到首頁</a>';

function familyPersonal({ R, M, org, main }){
  const list = R.myFamilyCases();
  const cases = list.length ? `<div class="card" id="myCaseList"><h2>我的入住申請（${list.length}）</h2>${list.map(c => `<div class="todo"><div class="t-main"><div class="t-name">${esc(c.patient.name)}　<span class="small muted mono">${esc(c.no)}</span></div><div class="t-why">送出：${esc(c.createdAt || '—')}　預計入住：${slash(c.plannedAdmit)}</div></div>${pill(R.famPhase(c), PHASE_TONE[R.phase(c)])}<a class="btn sm primary" href="application.html?case=${c.id}">查看進度</a></div>`).join('')}</div>` : '<div class="card hero" id="noCase"><h2>目前尚無入住申請</h2><p>需要時請按「我要申請入住」填寫預計入住者的資料。註冊帳號不代表已經提出申請。</p></div>';
  main.innerHTML = `<div class="narrow" id="personalHome"><p class="muted small" style="margin:0">您好，${esc(M.name)}</p><h1>個人首頁</h1>
    ${famApplyMain()}${famSecondary('')}${cases}${accountCard(M)}${helpLine(org)}</div>`;
  bindAccountCard(main, M);
}

function familyMyCases({ R, M, org, main }){
  const list = R.myFamilyCases();
  main.innerHTML = `<div class="narrow">${backHome()}<h1>我的申請紀錄</h1>${famSecondary('mycases')}
    <div class="card tbl-wrap"><table><thead><tr><th>申請編號</th><th>預計入住者</th><th>關係</th><th>送出時間</th><th>目前狀態</th><th></th></tr></thead><tbody id="myCaseRows">
    ${list.map(c => `<tr><td class="mono">${esc(c.no)}</td><td>${esc(c.patient.name)}</td><td>${esc(c.relation)}</td><td class="small">${esc(c.createdAt || '—')}</td><td>${pill(R.famPhase(c), PHASE_TONE[R.phase(c)])}</td><td><a class="btn sm" href="application.html?case=${c.id}">查看進度</a></td></tr>`).join('') || '<tr><td colspan="6" class="empty">目前尚無入住申請</td></tr>'}
    </tbody></table></div>${accountCard(M)}${helpLine(org)}</div>`;
  bindAccountCard(main, M);
}

/* 通知：列出全部（新到舊），打開即把未讀標為已讀；畫面先顯示原本的已讀／未讀，寫入成功後才更新徽章 */
async function familyNotices({ D, M, main, shell }){
  const { data, error } = await supabase().from('notices').select('id, case_id, text, at, read_at').eq('to', M.id).order('at', { ascending: false });
  if (error) throw error;
  const caseOf = id => D.cases[id];
  main.innerHTML = `<div class="narrow">${backHome()}<h1>通知</h1>
  <div class="card" id="noticeList">${data.length ? data.map(n => { const c = caseOf(n.case_id);
    return `<div class="todo" data-notice="1"><div class="t-main"><div>${n.read_at ? pill('已讀', 'mute') : pill('未讀', 'bad')} ${esc(n.text)}</div><div class="t-why">${esc(fmtAt(n.at))}　${esc(c ? c.patient.name : '')}${c ? '（' + esc(c.no) + '）' : ''}</div></div>${c ? `<a class="btn sm" href="application.html?case=${c.id}">前往案件</a>` : ''}</div>`; }).join('') : '<div class="empty">目前沒有通知。</div>'}</div></div>`;
  if (data.some(n => !n.read_at)){
    const r = await supabase().rpc('mark_notices_read');
    if (r.error) console.warn('通知沒有標為已讀', r.error);
    else shell.setBadges(await badgeCounts({ role: 'family', id: M.id }));
  }
}
const fmtAt = iso => { const d = new Date(iso); return isNaN(d) ? '' : new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d); };

/* ========== 行政／護理：工作清單 ========== */
function workHome(ctx){
  const { D, R, M, main, params } = ctx;
  const nurse = M.role === 'nurse', tab = params.get('tab') === 'done' ? 'done' : 'todo';
  const t = R.tasks();
  const tabs = `<div class="seg" role="group" aria-label="工作清單" style="margin-bottom:12px"><a class="seg-a" href="dashboard.html" aria-pressed="${tab !== 'done'}">待處理（${t.filter(x => !x.opt).length}）</a><a class="seg-a" href="dashboard.html?tab=done" aria-pressed="${tab === 'done'}">已完成</a></div>`;
  if (tab === 'done'){
    main.innerHTML = `<h1>${nurse ? '我的工作清單' : '工作清單'}</h1>${tabs}${doneFolders(ctx)}`;
    return bindFolders(ctx, () => workHome(ctx));
  }
  let head;
  if (nurse){
    const waitN = M.canAssignNurse ? Object.values(D.cases).filter(c => R.assignState(c) === '待分配').length : 0;
    head = `<h1>我的工作清單</h1><p class="lead">只列出指派給您的住民。</p>${tabs}${waitN ? `<div class="notice warn row between" style="margin-bottom:12px"><span>有 ${waitN} 件案件等待分配承辦護理師</span><a class="btn sm primary" href="cases.html?view=assign">前往案件分配</a></div>` : ''}`;
  } else {
    const cnt = tag => t.filter(x => x.tag === tag).length, fu = R.followupRows(), famOd = fu.filter(r => r.od).length;
    head = `<h1>今天要處理的事</h1><p class="lead">依個案分組（以案件編號區分，同名也不會合併）。展開個案即可看到本階段待辦、等待其他角色的事項與已完成工作。</p>${tabs}
    <div class="tiles">
      <div class="tile ${cnt('新申請') ? 'alert' : ''}"><div class="n">${cnt('新申請')}</div>件新申請待確認</div>
      <div class="tile ${cnt('收件') + cnt('身分') ? 'alert' : ''}"><div class="n">${cnt('收件') + cnt('身分')}</div>件收件待核對</div>
      <div class="tile ${cnt('日期') ? 'alert' : ''}"><div class="n">${cnt('日期')}</div>件日期待核對</div>
      <div class="tile ${cnt('要求') ? 'alert' : ''}"><div class="n">${cnt('要求')}</div>項條件式文件待確認</div>
      <a class="tile ${famOd ? 'alert' : ''}" href="documents.html?view=followup&from=home"><div class="n">${fu.length}</div>項等家屬補件${famOd ? `（${famOd} 項逾期）` : ''} →</a>
    </div>`;
  }
  main.innerHTML = head + conflictsCard(ctx.conflicts) + caseFolders(ctx, t);
  bindFolders(ctx, () => workHome(ctx));
  bindConflicts(ctx);
}

const fullLink = (c, M) => M.role === 'staff' ? `<a class="btn sm" href="cases.html?case=${c.id}&from=home">完整個案資料</a>` : c.nurseId === M.id ? `<a class="btn sm" href="assessment.html?case=${c.id}&from=home">完整住民資料</a>` : '<span class="small muted">已移交，只保留處理摘要</span>';
const taskLi = (x, D) => `<li class="task">${P(x.tag, x.tone)}${x.opt ? ' ' + pill('選填', 'mute') : ''}<div><div class="what">${esc(x.what)}</div><div class="small muted">${esc(x.why)}</div></div><a class="btn primary" href="${goUrl(x.go, D)}">${esc(x.btn || '處理')}</a></li>`;

/* 個案資料夾（原型 caseFolders）：依案件編號分組、預設收合、記住展開狀態 */
function caseFolders({ D, R, M }, t){
  const groups = {}, other = [];
  t.forEach(x => { if (!x.c) return other.push(x); (groups[x.c.id] = groups[x.c.id] || { c: x.c, todo: [] }).todo.push(x); });
  /* 護理：負責中的住民即使目前沒有待辦也列出（收合），看得到在等誰 */
  if (M.role === 'nurse') Object.values(D.cases).filter(c => c.nurseId === M.id && !c.closed && !c.archived).forEach(c => { groups[c.id] = groups[c.id] || { c, todo: [] }; });
  const q = store.sget('wbQ', '').trim().toLowerCase(), sort = store.sget('wbSort', 'recent'), open = store.get('wbOpen', {});
  const list = Object.values(groups).filter(g => !q || String(g.c.patient.name).toLowerCase().includes(q) || String(g.c.no || '').toLowerCase().includes(q) || g.c.id.toLowerCase().includes(q));
  list.forEach(g => { g.last = R.lastAt(g.c); g.req = g.todo.filter(x => !x.opt); g.opt = g.todo.filter(x => x.opt); g.n = g.req.length; g.alert = g.req.filter(x => x.tone === 'bad').length; });
  list.sort(sort === 'count' ? (a, b) => (b.n - a.n) || (b.alert - a.alert) || b.last.localeCompare(a.last) : (a, b) => b.last.localeCompare(a.last) || (b.n - a.n));
  const folder = g => { const c = g.c, wait = R.waitingOthers(c), nx = R.nextStage(c), dn = R.doneOf(c), p = R.phase(c);
    return `<details class="folder" data-case="${esc(c.id)}" data-fk="${esc(c.id)}" ${open[c.id] === true ? 'open' : ''}><summary><span class="fname">${esc(c.patient.name)}</span><span class="small mono muted">${esc(c.no || c.id)}</span>${pill(p, PHASE_TONE[p])}${pill(`必要待辦 ${g.n}`, g.n ? 'warn' : 'mute')}${g.opt.length ? pill(`選填／提醒 ${g.opt.length}`, 'mute') : ''}${g.alert ? pill(`警示 ${g.alert}`, 'bad') : ''}<span class="small muted">最近更新 ${esc(g.last)}</span></summary>
    <div class="fbody">
      <h3>本階段必要待辦（${g.n}）</h3>${g.n ? `<ul class="tasks">${g.req.map(x => taskLi(x, D)).join('')}</ul>` : '<p class="small muted" style="margin:0">目前沒有必要待辦。</p>'}
      ${g.opt.length ? `<h3>選填／提醒（${g.opt.length}）<span class="small muted" style="font-weight:400">　不計入必要待辦，也不影響收治評估</span></h3><ul class="tasks">${g.opt.map(x => taskLi(x, D)).join('')}</ul>` : ''}
      <h3>正在等待其他角色處理</h3>${wait.length ? `<ul class="small" style="margin:0 0 0 18px">${wait.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '<p class="small muted" style="margin:0">沒有。</p>'}
      ${nx.text || nx.later.length ? `<details style="margin-top:10px"><summary class="small"><strong>下一階段預告</strong>（不列入待辦數）</summary><p class="small" style="margin:4px 0">${esc(nx.text)}</p>${nx.later.length ? `<p class="small muted" style="margin:0">後續要準備：${esc(nx.later.map(i => i.name).join('、'))}</p>` : ''}</details>` : ''}
      <details style="margin-top:10px"><summary class="small"><strong>已完成工作（${dn.length}）</strong></summary>${dn.length ? `<ul class="small" style="margin:4px 0 0 18px">${dn.slice(0, 30).map(e => `<li><span class="mono">${esc(e.at)}</span> ${esc(e.t)}${e.note ? '：' + esc(e.note) : ''}（${esc(R.accName(e.by))}${M.role === 'nurse' && c.nurseId !== M.id ? '，已移交' : ''}）</li>`).join('')}</ul>` : '<p class="small muted">尚無紀錄。</p>'}</details>
      <p style="margin:10px 0 0">${fullLink(c, M)}</p></div></details>`; };
  return `<div class="wb-tools"><label class="f small">搜尋住民姓名或案件編號<input type="search" id="wbQ" value="${esc(store.sget('wbQ', ''))}" placeholder="例：林春風、C-0008"></label><label class="f small">排序<select id="wbSort"><option value="recent" ${sort === 'recent' ? 'selected' : ''}>最近更新</option><option value="count" ${sort === 'count' ? 'selected' : ''}>待辦數量</option></select></label></div>
  <div id="folders">${list.map(folder).join('') || `<p class="empty">${q ? '找不到符合的案件。' : '目前沒有待處理的事。'}</p>`}${other.length ? `<div class="card"><h3>其他</h3><ul class="tasks">${other.map(x => taskLi(x, D)).join('')}</ul></div>` : ''}</div>`;
}

/* 已完成工作（原型 doneFolders）：從處理歷程整理，依案件分組 */
function doneFolders({ R, M }){
  const done = R.doneWork(), g = {}, open = store.get('wbOpen', {});
  done.forEach(e => { (g[e.c.id] = g[e.c.id] || { c: e.c, ev: [] }).ev.push(e); });
  const q = store.sget('wbQ', '').trim().toLowerCase();
  const list = Object.values(g).filter(x => !q || String(x.c.patient.name).toLowerCase().includes(q) || String(x.c.no || '').toLowerCase().includes(q));
  return `<div class="wb-tools"><label class="f small">搜尋住民姓名或案件編號<input type="search" id="wbQ" value="${esc(store.sget('wbQ', ''))}"></label></div><div id="doneList">${list.map(x => `<details class="folder" data-case="${esc(x.c.id)}" data-fk="d:${esc(x.c.id)}" ${open['d:' + x.c.id] === true ? 'open' : ''}><summary><span class="fname">${esc(x.c.patient.name)}</span><span class="small mono muted">${esc(x.c.no || x.c.id)}</span>${pill(`已完成 ${x.ev.length}`, 'ok')}${M.role === 'nurse' && x.c.nurseId !== M.id ? pill('已移交', 'mute') : ''}</summary><div class="fbody tbl-wrap"><table><thead><tr><th>日期時間</th><th>完成的工作</th><th>處理人員</th></tr></thead><tbody>${x.ev.map(e => `<tr><td class="small mono">${esc(e.at)}</td><td>${esc(e.t)}${e.note ? `<br><span class="small muted">${esc(e.note)}</span>` : ''}${M.role === 'nurse' && x.c.nurseId !== M.id ? ' ' + pill('已移交', 'mute') : ''}</td><td>${esc(R.accName(e.by))}</td></tr>`).join('')}</tbody></table><p style="margin:8px 0 0">${fullLink(x.c, M)}</p></div></details>`).join('') || '<p class="empty">尚無已完成的工作。</p>'}</div>`;
}

/* 資料夾展開狀態、搜尋、排序 */
function bindFolders({ main }, rerender){
  main.querySelectorAll('details.folder').forEach(d => d.addEventListener('toggle', () => {
    const open = store.get('wbOpen', {}); open[d.dataset.fk] = d.open; store.set('wbOpen', open);
  }));
  const q = main.querySelector('#wbQ');
  if (q) q.addEventListener('input', () => { store.sset('wbQ', q.value); const pos = q.selectionStart; rerender(); const n = main.querySelector('#wbQ'); n.focus(); n.setSelectionRange(pos, pos); });
  const s = main.querySelector('#wbSort');
  if (s) s.addEventListener('change', () => { store.sset('wbSort', s.value); rerender(); main.querySelector('#wbSort').focus(); });
}

/* ========== 照服員：我的住民 ========== */
async function careHome(main){
  const { data, error } = await supabase().rpc('my_care_residents');
  if (error) throw error;
  main.innerHTML = `<h1>我的住民</h1><p class="lead">只會列出護理師開放給您的住民。</p>
  <div class="card">${data.length ? `<ul class="tasks">${data.map(c => `<li class="task">${c.card_status === '已停用' ? pill('已停用', 'mute') : pill('第 ' + c.card_v + ' 版', 'info')}<div><div class="what">${esc(c.patient_name)}（${esc(c.call || '稱呼待確認')}）</div><div class="small muted">預計 ${slash(c.planned_admit || '')} 入住</div></div><a class="btn primary" href="care-summary.html?case=${c.case_id}">看摘要卡</a></li>`).join('')}</ul>` : '<div class="empty">目前沒有住民。護理師開放照顧摘要卡後，會出現在這裡。</div>'}</div>`;
}

/* ========== 行政：住民資料待確認（階段 4，使用者決定的流程；原型沒有） ==========
 * 家屬送出申請時，身分證字號已有住民資料但姓名或生日不同 → 申請沒有建立，留在這裡給行政電話確認。 */
function conflictsCard(list){
  if (!list || !list.length) return '';
  const fmt = iso => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  return `<div class="card hero warn stack" id="conflictCard" style="margin-bottom:12px"><h2 style="margin:0">住民資料待確認（${list.length}）</h2>
    <p class="small" style="margin:0">家屬送出入住申請時，身分證字號已有住民資料但姓名或生日不同，<strong>申請沒有建立</strong>。請電話聯絡申請人確認後，填寫處理說明。</p>
    <div class="tbl-wrap"><table><thead><tr><th>送出時間</th><th>申請人</th><th>申請時填寫</th><th>系統既有資料</th><th></th></tr></thead><tbody>${list.map(x => `<tr data-conflict="${x.id}">
      <td class="small mono">${esc(fmt(x.created_at))}</td>
      <td>${esc(x.family?.name || '')}<br><span class="small mono">${esc(x.family?.phone || '')}</span></td>
      <td>${esc(x.submitted_name)}<br><span class="small">生日 ${slash(x.submitted_birth || '')}</span></td>
      <td>${esc(x.residents?.name || '')}<br><span class="small">生日 ${slash(x.residents?.birth || '')}　<span class="mono">${esc(x.residents?.nid || '')}</span></span></td>
      <td><button type="button" class="btn sm" data-resolve="${x.id}">標示已處理</button></td></tr>`).join('')}</tbody></table></div></div>`;
}
function bindConflicts({ main }){
  main.querySelectorAll('[data-resolve]').forEach(b => b.addEventListener('click', () => modal({ title: '標示已處理', ok: '儲存',
    body: '<label class="f" data-req>處理說明<span class="hint">例：已電話確認，申請人身分證字號打錯，請他以正確資料重新送出</span><textarea id="cfNote"></textarea></label>',
    onOk: async host => {
      const { error } = await supabase().rpc('resolve_resident_conflict', { p_id: Number(b.dataset.resolve), p_resolution: host.querySelector('#cfNote').value });
      if (error) return '儲存失敗：' + errText(error);
      toast('已標示處理完成'); location.reload(); return '';
    } })));
}
