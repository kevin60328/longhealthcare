/* 八頁共用的頁首與頁尾（HANDOFF 6.3）：機構名、使用者姓名與角色、字級切換、修改密碼、登出、角色分頁與徽章。
 *
 * 分頁選取規則：
 * - 同一時間只有一個分頁是選取狀態（aria-current="page"，藍色底線只由它決定）。
 * - 由目前的頁面與 view 決定；詳細頁歸到所屬分頁；不屬於任何分頁的畫面歸第一個分頁。
 * - 判斷用「畫面實際顯示的分頁清單」計算。原型第 (18) 版修過的 bug：另外加上的「案件分配」沒算進清單，
 *   在案件分配頁時兩個分頁同時被選取。 */
import { CONFIG, isTestEnv } from './config.js';
import { esc, toast } from './ui.js';
import { ROLE_NAME } from './modules/rules/account.js';

/* 各角色的分頁：key、名稱、網址（名稱沿用原型） */
const NAV = {
  family: [['home', '我的申請', 'dashboard.html'], ['notices', '通知', 'dashboard.html?view=notices']],
  staff: [['home', '工作清單', 'dashboard.html'], ['cases', '案件', 'cases.html']],
  nurse: [['home', '工作清單', 'dashboard.html'], ['residents', '負責住民', 'assessment.html?view=residents']],
  care: [['home', '我的住民', 'dashboard.html']],
  admin: [['accounts', '帳號管理', 'settings.html?view=accounts'], ['org', '機構設定', 'settings.html?view=org'],
    ['archive', '結案與封存', 'settings.html?view=archive'], ['logs', '操作紀錄', 'settings.html?view=logs'],
    ['mail-errors', '寄送異常', 'settings.html?view=mail-errors'], ['testdata', '測試資料', 'settings.html?view=testdata']]
};

/* 畫面實際顯示的分頁：基本分頁＋有分配權限的護理師才有的「案件分配」；測試資料只在測試環境 */
export function navTabs(me){
  let tabs = NAV[me.role] || [];
  if (me.role === 'nurse' && me.can_assign_nurse) tabs = tabs.concat([['assign', '案件分配', 'cases.html?view=assign']]);
  if (me.role === 'admin' && !isTestEnv()) tabs = tabs.filter(t => t[0] !== 'testdata');
  return tabs;
}

/* 目前頁面歸屬的分頁 key（還沒對照顯示中的分頁）。
 * from=home：從工作清單點進詳細頁時，網址帶 from=home，讓分頁維持在工作清單。 */
function parentTab(role, page, view, from){
  if (from === 'home') return 'home';
  if (role === 'family') return page === 'dashboard' && view === 'notices' ? 'notices' : 'home';
  /* 確認新申請屬於工作清單（原型 staffApply 在「工作清單」分頁下） */
  if (role === 'staff'){
    if (page === 'cases' && view === 'confirm') return 'home';
    /* documents.html：從案件頁進來（from=case）歸「案件」；沒有來源時依畫面，與原型相同——
     * 收件核對、核對日期、補件追蹤屬於「工作清單」（原型返回工作清單），看文件、要求補件等屬於「案件」 */
    if (page === 'documents') return from === 'case' ? 'cases' : ['receipt', 'date', 'followup'].includes(view) ? 'home' : 'cases';
    return ['cases', 'application'].includes(page) ? 'cases' : 'home';
  }
  if (role === 'nurse'){
    if (page === 'cases' && view === 'assign') return 'assign';
    if (['assessment', 'care-summary', 'documents'].includes(page)) return 'residents';
    return 'home';
  }
  if (role === 'admin') return page === 'settings' ? (view || 'accounts') : 'accounts';
  return 'home';
}

/* 整個導覽列只算出一個選取分頁 */
export function navCurrent(me, page, view, from){
  const tabs = navTabs(me);
  if (!tabs.length) return null;
  const k = parentTab(me.role, page, view, from);
  return tabs.some(t => t[0] === k) ? k : tabs[0][0];
}

/* ---------- 字級（標準／大／特大，記在 localStorage；與原型同一個 key） ---------- */
const FS = [['m', '標準'], ['l', '大'], ['xl', '特大']];
const FS_KEY = 'ltc-fs';
function readFont(){ try { return localStorage.getItem(FS_KEY) || 'm'; } catch { return 'm'; } }
function saveFont(k){ try { localStorage.setItem(FS_KEY, k); } catch { /* 無痕模式等情況只保留在這次開啟 */ } }
export function applyFont(k){
  const size = FS.some(x => x[0] === k) ? k : 'm';
  const h = document.documentElement; h.classList.remove('fs-l', 'fs-xl');
  if (size !== 'm') h.classList.add('fs-' + size);
  return size;
}
/* 在瀏覽器才套用字級（單元測試在 Node 執行，沒有 document） */
let fontSize = typeof document === 'undefined' ? 'm' : applyFont(readFont());
let fsOpen = false;

/* ---------- 頁首 ---------- */
function topBar({ orgName, me, page, view, from, badges }){
  const cur = FS.find(x => x[0] === fontSize)[1];
  const active = me && me.status === '啟用';
  /* login.html 只有「修改密碼」畫面顯示分頁（與原型相同）；其他登入畫面沒有 */
  const showNav = active && !me.must_change_password && (page !== 'login' || view === 'password');
  const current = showNav ? navCurrent(me, page, view, from) : null;
  return `<div class="top-in"><div class="brand"><span class="brand-mark" aria-hidden="true"></span>${esc(orgName)}</div>
    ${active ? `<span class="who"><strong>${esc(me.name)}</strong>　${esc(ROLE_NAME[me.role] || '')}</span>` : ''}
    <span class="fs-wrap"><button type="button" class="btn-ghost" data-act="fs-menu" aria-haspopup="true" aria-expanded="${fsOpen}" aria-label="字級設定，目前：${cur}"><span class="fs-ico" aria-hidden="true">A<small>A</small></span>字級設定</button>${fsOpen ? `<div class="fs-menu" role="menu" aria-label="字級">${FS.map(([k, n]) => `<button type="button" role="menuitemradio" aria-checked="${k === fontSize}" data-act="fs" data-fs="${k}">${k === fontSize ? '✓ ' : '　'}${n}</button>`).join('')}</div>` : ''}</span>
    ${me ? `${active && !me.must_change_password ? '<a class="btn-ghost" href="login.html?view=password">修改密碼</a>' : ''}<button type="button" class="btn-ghost" data-act="logout">登出</button>` : ''}</div>
    ${showNav ? `<nav class="subnav" aria-label="功能選單">${navTabs(me).map(([k, n, href]) => {
      const cnt = (badges || {})[k] || 0;
      return `<a href="${href}" data-tab="${k}" ${k === current ? 'aria-current="page"' : ''}>${esc(n)}${cnt ? `<span class="badge" aria-label="${cnt} 項">${cnt}</span>` : ''}</a>`;
    }).join('')}</nav>` : ''}`;
}

/* 畫出頁首與頁尾；回傳 { main, setBadges }。
 * opts：orgName、me（未登入為 null）、page、view、from、onLogout */
export function mountShell(opts = {}){
  const state = { orgName: CONFIG.orgNameFallback, me: null, page: '', view: '', from: '', badges: {}, ...opts };
  const top = document.getElementById('top');
  const draw = () => { top.innerHTML = topBar(state); };
  draw();
  top.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    /* 重畫後被點的按鈕已脫離文件，不讓下面「點外面關閉選單」的處理收到這次點擊 */
    e.stopPropagation();
    if (b.dataset.act === 'fs-menu'){ fsOpen = !fsOpen; draw(); }
    if (b.dataset.act === 'fs'){
      fontSize = applyFont(b.dataset.fs); saveFont(fontSize); fsOpen = false; draw();
      toast('字級：' + FS.find(x => x[0] === fontSize)[1]);
    }
    if (b.dataset.act === 'logout' && opts.onLogout) opts.onLogout();
  });
  document.addEventListener('click', e => { if (fsOpen && !top.contains(e.target)){ fsOpen = false; draw(); } });
  const foot = document.getElementById('siteFoot');
  if (foot) foot.textContent = CONFIG.envNote;
  return {
    main: document.getElementById('main'),
    setBadges(b){ state.badges = b || {}; draw(); },
    update(patch){ Object.assign(state, patch); draw(); }
  };
}
