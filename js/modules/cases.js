/* cases.html：案件查詢與確認、轉交、承辦護理師分配、簽約紀錄、案件狀態、處理歷程、參訪與保證金、協調與結案（HANDOFF 6.1；於開發階段 5 實作） */
import { bootPage } from '../page.js';

/* 登入檢查、權限、導覽列由 bootPage 處理（js/page.js）；這裡只畫頁面內容 */
bootPage('cases', ({ main, view }) => {
  main.innerHTML = `<div class="card stack"><h1>個案管理</h1><p class="muted">此頁面尚在建置中（開發階段 5）。${view ? '目前畫面：' + view : ''}</p></div>`;
});
