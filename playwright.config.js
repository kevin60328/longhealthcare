/* Playwright 設定：E2E 測試放在 tests/e2e。
 * 測試時自動啟動 Vite 開發伺服器（127.0.0.1:5173）；已經有開著的伺服器就直接沿用。
 * 兩個專案：
 *   main    只讀的測試（登入、守門、工作清單…），可以平行執行
 *   writes  會新增資料的測試（tests/e2e/writes），在 main 全部跑完後才執行，
 *           避免新增的案件影響 main 裡「待辦數與原型相同」等檢查
 * 執行：npm run test:e2e */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://127.0.0.1:5173' },
  projects: [
    { name: 'main', testIgnore: /writes[\\/]/ },
    { name: 'writes', testMatch: /writes[\\/].*\.spec\.js/, dependencies: ['main'] }
  ],
  webServer: { command: 'npx vite --port 5173 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:5173/login.html', reuseExistingServer: true }
});
