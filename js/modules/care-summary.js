/* care-summary.html：已確認資料摘要、審核、開放、版本與重新審核；照服員限閱（HANDOFF 6.1；於開發階段 8 實作） */
import { bootPage } from '../page.js';

/* 登入檢查、權限、導覽列由 bootPage 處理（js/page.js）；這裡只畫頁面內容 */
bootPage('care-summary', ({ main, view }) => {
  main.innerHTML = `<div class="card stack"><h1>照顧摘要卡</h1><p class="muted">此頁面尚在建置中（開發階段 8）。${view ? '目前畫面：' + view : ''}</p></div>`;
});
