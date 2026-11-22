/* Playwright 設定：E2E 測試放在 tests/e2e。
 * 測試時自動啟動 Vite 開發伺服器（127.0.0.1:5173）；已經有開著的伺服器就直接沿用。
 * 兩個專案：
 *   main    只讀的測試（登入、守門、工作清單…），可以平行執行
 *   writes  會新增資料的測試（tests/e2e/writes），在 main 全部跑完後才執行，
 *           避免新增的案件影響 main 裡「待辦數與原型相同」等檢查
 * 全部跑完後自動清除自動測試帳號建立的資料（tests/global-cleanup.js）。
 * 執行：npm run test:e2e */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  globalTeardown: './tests/global-cleanup.js',
  /* 測試連的是雲端 Supabase：同時太多瀏覽器會讓每頁載入超過預設的 5 秒等待。限制同時 4 個、等待放寬到 10 秒 */
  workers: 4,
  timeout: 60000,
  expect: { timeout: 10000 },
  use: { baseURL: 'http://127.0.0.1:5173' },
  projects: [
    { name: 'main', testIgnore: /writes[\\/]/ },
    /* 寫入類每一步都要等資料庫寫入後重新載入頁面，連雲端較慢：等待畫面出現放寬到 15 秒，整條流程（申請到提交習慣卡等）最多 3 分鐘 */
    { name: 'writes', testMatch: /writes[\\/].*\.spec\.js/, dependencies: ['main'], timeout: 180000, expect: { timeout: 15000 } }
  ],
  webServer: { command: 'npx vite --port 5173 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:5173/login.html', reuseExistingServer: true }
});
