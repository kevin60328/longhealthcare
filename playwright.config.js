/* Playwright 設定：E2E 測試放在 tests/e2e。
 * 測試時自動啟動 Vite 開發伺服器（127.0.0.1:5173）；已經有開著的伺服器就直接沿用。
 * 兩個專案：
 *   main    只讀的測試（登入、守門、工作清單…），可以平行執行
 *   writes  會新增資料的測試（tests/e2e/writes），在 main 全部跑完後才執行，
 *           避免新增的案件影響 main 裡「待辦數與原型相同」等檢查
 * 全部跑完後自動清除自動測試帳號建立的資料（tests/global-cleanup.js）。
 * 執行：npm run test:e2e
 * 測線上網站（階段 10，Netlify）：設定環境變數 E2E_BASE_URL=https://longhealthcare.netlify.app 再執行，不啟動本機伺服器。
 *   線上網站與本機連的是同一個 Supabase 測試專案，測試建立的資料一樣會在結束時清除。 */
import { defineConfig } from '@playwright/test';

const REMOTE = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'tests/e2e',
  globalTeardown: './tests/global-cleanup.js',
  /* 測試連的是雲端 Supabase 免費方案（小型共用 CPU）：同時太多瀏覽器時，資料庫查詢會從 0.1 秒拖到數秒，甚至超過 8 秒上限。
   * 階段 6 實測（2026/11/22）：4 個同時跑會偶發逾時，所以限制同時 2 個、等待放寬到 10 秒。這是測試環境的限制，不是功能問題 */
  workers: 2,
  /* 階段 10：失敗的測試自動重跑一次。雲端免費方案偶爾整體變慢（「系統載入中」超過 10 秒），重跑通常就過。
   * 重跑才通過的測試，報告會另外標成 flaky（不算在 passed 裡），回報時要分開寫；重跑仍失敗才是真的失敗 */
  retries: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  use: { baseURL: REMOTE || 'http://127.0.0.1:5173' },
  projects: [
    { name: 'main', testIgnore: /writes[\\/]/ },
    /* 寫入類每一步都要等資料庫寫入後重新載入頁面，連雲端較慢：等待畫面出現放寬到 15 秒，整條流程（申請到提交習慣卡等）最多 3 分鐘 */
    { name: 'writes', testMatch: /writes[\\/].*\.spec\.js/, dependencies: ['main'], timeout: 180000, expect: { timeout: 15000 } }
  ],
  webServer: REMOTE ? undefined : { command: 'npx vite --port 5173 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:5173/login.html', reuseExistingServer: true }
});
