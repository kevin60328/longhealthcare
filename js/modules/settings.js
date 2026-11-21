/* settings.html：帳號審核、角色與分配權限、機構設定、文件清單、保存規則與封存、寄送異常、操作紀錄、測試資料（HANDOFF 6.1；於開發階段 9 實作） */
import { bootPage } from '../page.js';

/* 登入檢查、權限、導覽列由 bootPage 處理（js/page.js）；這裡只畫頁面內容 */
bootPage('settings', ({ main, view }) => {
  main.innerHTML = `<div class="card stack"><h1>系統管理</h1><p class="muted">此頁面尚在建置中（開發階段 9）。${view ? '目前畫面：' + view : ''}</p></div>`;
});
