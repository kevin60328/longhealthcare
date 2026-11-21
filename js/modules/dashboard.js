/* dashboard.html：依權限顯示個人首頁、待處理／已完成工作、通知、待辦數量（HANDOFF 6.1；於開發階段 3 實作） */
import { bootPage } from '../page.js';

/* 登入檢查、權限、導覽列由 bootPage 處理（js/page.js）；這裡只畫頁面內容 */
bootPage('dashboard', ({ main, view }) => {
  main.innerHTML = `<div class="card stack"><h1>工作清單</h1><p class="muted">此頁面尚在建置中（開發階段 3）。${view ? '目前畫面：' + view : ''}</p></div>`;
});
