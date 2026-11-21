/* documents.html：文件上傳與版本、收件與身分核對、日期效期、OCR、缺漏／補件、補件 Email 追蹤（HANDOFF 6.1；於開發階段 6 實作） */
import { bootPage } from '../page.js';

/* 登入檢查、權限、導覽列由 bootPage 處理（js/page.js）；這裡只畫頁面內容 */
bootPage('documents', ({ main, view }) => {
  main.innerHTML = `<div class="card stack"><h1>文件與補件</h1><p class="muted">此頁面尚在建置中（開發階段 6）。${view ? '目前畫面：' + view : ''}</p></div>`;
});
