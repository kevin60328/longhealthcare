/* 原型 vs 新版 畫面對照截圖用的 Playwright 設定（不屬於一般 E2E 驗收）。
 * 執行：npx playwright test --config playwright.visual.config.js
 * 結果：test-results/compare/index.html（並排對照） */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/visual',
  workers: 1,
  timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:5173' },
  webServer: { command: 'npx vite --port 5173 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:5173/login.html', reuseExistingServer: true }
});
