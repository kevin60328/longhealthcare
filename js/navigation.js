/* 八頁共用的頁首（機構名、字級切換）與頁尾。
 * 導覽分頁、目前分頁判斷（aria-current，同時只有一個）與徽章在階段 2 接上 auth／permissions 後加入。 */
import { CONFIG } from './config.js';
import { esc } from './ui.js';

const FS = [['m','標準'],['l','大'],['xl','特大']];
const FS_KEY = 'fontSize';

function readFont(){ try { return localStorage.getItem(FS_KEY) || 'm'; } catch { return 'm'; } }
function saveFont(k){ try { localStorage.setItem(FS_KEY, k); } catch { /* 無痕模式等情況不記憶 */ } }

export function applyFont(k){
  const size = FS.some(x => x[0] === k) ? k : 'm';
  const h = document.documentElement; h.classList.remove('fs-l', 'fs-xl');
  if (size !== 'm') h.classList.add('fs-' + size);
  return size;
}

let fontSize = applyFont(readFont());
let fsOpen = false;

function topBar(orgName){
  const cur = FS.find(x => x[0] === fontSize)[1];
  return `<div class="top-in"><div class="brand"><span class="brand-mark" aria-hidden="true"></span>${esc(orgName)}</div>
    <span class="fs-wrap"><button type="button" class="btn-ghost" data-act="fs-menu" aria-haspopup="true" aria-expanded="${fsOpen}" aria-label="字級設定，目前：${cur}"><span class="fs-ico" aria-hidden="true">A<small>A</small></span>字級設定</button>${fsOpen ? `<div class="fs-menu" role="menu" aria-label="字級">${FS.map(([k, n]) => `<button type="button" role="menuitemradio" aria-checked="${k === fontSize}" data-act="fs" data-fs="${k}">${k === fontSize ? '✓ ' : '　'}${n}</button>`).join('')}</div>` : ''}</span></div>`;
}

/* 畫出頁首與頁尾；回傳 main 元素給各頁模組填內容 */
export function mountShell({ orgName = CONFIG.orgNameFallback } = {}){
  const top = document.getElementById('top');
  const draw = () => { top.innerHTML = topBar(orgName); };
  draw();
  top.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    /* 重畫後被點的按鈕已脫離文件，不讓下面「點外面關閉選單」的處理收到這次點擊 */
    e.stopPropagation();
    if (b.dataset.act === 'fs-menu'){ fsOpen = !fsOpen; draw(); }
    if (b.dataset.act === 'fs'){ fontSize = applyFont(b.dataset.fs); saveFont(fontSize); fsOpen = false; draw(); }
  });
  document.addEventListener('click', e => { if (fsOpen && !top.contains(e.target)){ fsOpen = false; draw(); } });
  const foot = document.getElementById('siteFoot');
  if (foot) foot.textContent = CONFIG.envNote;
  return document.getElementById('main');
}
