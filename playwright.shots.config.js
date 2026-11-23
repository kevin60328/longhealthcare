/* 「操作畫面截圖」文件用的 Playwright 設定（不屬於一般 E2E 驗收）。
 * 照展示腳本（展示說明第 5 節）在網站上實際操作並截圖，結果放在 demo-shots/（不進 git）。
 * 用暫時帳號（e2e-…@example.com）建立同名的示範案件，跑完由 globalTeardown 清除；線上的 C-0001、C-0002、T-A～T-D 不會被改動。
 * 執行：npx playwright test --config playwright.shots.config.js
 *       測線上網站：E2E_BASE_URL=https://longhealthcare.netlify.app npx playwright test --config playwright.shots.config.js
 * 注意：護理核對的「自動辨識」會實際呼叫 Claude API（會產生少量費用）。 */
import { defineConfig } from '@playwright/test';

const REMOTE = process.env.E2E_BASE_URL;
export default defineConfig({
  testDir: 'tests/demo-shots',
  globalTeardown: './tests/global-cleanup.js',
  workers: 1,
  timeout: 20 * 60000,
  expect: { timeout: 20000 },
  use: { baseURL: REMOTE || 'http://127.0.0.1:5173', viewport: { width: 1280, height: 860 }, actionTimeout: 15000, navigationTimeout: 30000, locale: 'zh-TW', timezoneId: 'Asia/Taipei' },
  webServer: REMOTE ? undefined : { command: 'npx vite --port 5173 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:5173/login.html', reuseExistingServer: true }
});
