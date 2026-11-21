/* Playwright 設定：E2E 測試放在 tests/e2e。
 * 測試時自動啟動 Vite 開發伺服器（127.0.0.1:5173）；已經有開著的伺服器就直接沿用。
 * 執行：npm run test:e2e */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://127.0.0.1:5173' },
  webServer: { command: 'npx vite --port 5173 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:5173/login.html', reuseExistingServer: true }
});
