/* 產生「原型 vs 新版規則」對照資料用的 Playwright 設定（只打開原型的 file://，不需要開發伺服器）。
 * 執行：npm run parity:gen → tests/unit/fixtures/parity.json，之後 npm run test:unit 會用它比對。 */
import { defineConfig } from '@playwright/test';

export default defineConfig({ testDir: 'tests/parity', workers: 1, timeout: 300000 });
