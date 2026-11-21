/* assessment.html：負責住民、照護文件需求判斷、醫療內容逐項核對、診斷清單、習慣卡審核、收治評估、入住前護理確認（HANDOFF 6.1；於開發階段 7 實作） */
import { bootPage } from '../page.js';

/* 登入檢查、權限、導覽列由 bootPage 處理（js/page.js）；這裡只畫頁面內容 */
bootPage('assessment', ({ main, view }) => {
  main.innerHTML = `<div class="card stack"><h1>護理核對與評估</h1><p class="muted">此頁面尚在建置中（開發階段 7）。${view ? '目前畫面：' + view : ''}</p></div>`;
});
