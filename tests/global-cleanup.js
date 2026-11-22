/* Playwright 的 globalTeardown：E2E 全部跑完後，清除自動測試帳號建立的資料（scripts/clean-test-data.mjs；使用者 2026/11/22 決定）。
 * Vitest 用 tests/vitest-cleanup.js（兩邊的 default export 意義不同）。
 * 不要同時跑兩組測試：一組結束時的清除，可能刪掉另一組正在用的暫時案件。 */
import { cleanTestData } from '../scripts/clean-test-data.mjs';

export default async function globalTeardown(){
  try { await cleanTestData(); } catch (e){ console.warn('清除測試資料失敗（不影響測試結果）：' + e.message); }
}
