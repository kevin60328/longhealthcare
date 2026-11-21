/* application.html：家屬申請、住民基本資料、個資同意、代理權資料、緊急聯絡人、習慣卡（HANDOFF 6.1；於開發階段 4 實作） */
import { bootPage } from '../page.js';

/* 登入檢查、權限、導覽列由 bootPage 處理（js/page.js）；這裡只畫頁面內容 */
bootPage('application', ({ main, view }) => {
  main.innerHTML = `<div class="card stack"><h1>入住申請與授權</h1><p class="muted">此頁面尚在建置中（開發階段 4）。${view ? '目前畫面：' + view : ''}</p></div>`;
});
