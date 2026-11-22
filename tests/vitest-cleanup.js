/* Vitest 的 globalSetup：測試全部跑完後（teardown）清除自動測試帳號建立的資料。
 * 注意：Vitest 會把 default export 當成「開始前」執行，所以這裡不能有 default export（Playwright 用 tests/global-cleanup.js）。 */
import { cleanTestData } from '../scripts/clean-test-data.mjs';

export function setup(){}
export async function teardown(){
  try { await cleanTestData(); } catch (e){ console.warn('清除測試資料失敗（不影響測試結果）：' + e.message); }
}
