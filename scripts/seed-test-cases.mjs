/* 把原型 v18 的 4 筆測試案件（HANDOFF 12：A 待護理核對、B 待收治評估、C 摘要卡待審核、D 摘要卡已開放）寫進測試專案。
 *
 * 資料來源：tests/unit/fixtures/parity.json.gz 裡「原型 seedTestCase 實際建立」的案件（沒有隨機變化的那一份）。
 * 用途：讓工作清單等畫面有完整狀態的資料可看，並讓 tests/rls/model.test.js 驗證
 *       「資料庫 → get_case_models → 資料轉換 → 業務規則」的結果與原型相同。
 * 正式的「測試資料」功能在 settings.html（階段 9）；這個腳本只給開發與自動測試用。
 *
 * 用法：npm run db:seed-cases（先跑過 npm run db:seed 建立帳號）
 * 可重複執行：同編號的測試案件會先刪除再重建（回到起始狀態）。只限本機或標示為測試專案的 Supabase（資料庫也會再檢查是測試環境）。
 * 建立邏輯在 scripts/test-cases-core.mjs（與系統管理「測試資料」頁共用）。 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createClient } from '@supabase/supabase-js';
import { loadEnv, assertTestTarget } from './load-env.mjs';
import { seedTestCases } from './test-cases-core.mjs';

const env = loadEnv();
assertTestTarget(env);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const F = JSON.parse(gunzipSync(readFileSync('tests/unit/fixtures/parity.json.gz')));
/* 每個測試案件的第一個情境就是原型建立時的原始狀態 */
const bases = [];
for (const s of F.scenarios){ if (s.input.c.id.startsWith('TEST-') && !bases.some(b => b.c.id === s.input.c.id)) bases.push(s.input); }

const { done, removed } = await seedTestCases(db, bases);
/* 舊案件上傳過的檔案（測試人員在 T-A～T-D 上傳的）一併刪除 */
for (const id of removed){
  const bucket = db.storage.from('case-files');
  const { data: dirs } = await bucket.list(id, { limit: 1000 });
  for (const d of dirs || []){ const { data: files } = await bucket.list(`${id}/${d.name}`, { limit: 1000 }); const paths = (files || []).filter(f => f.id).map(f => `${id}/${d.name}/${f.name}`); if (paths.length) await bucket.remove(paths); }
}
for (const x of done) console.log(`測試案件 ${x.no} ${x.name}（${x.flow}）：${x.docs} 份文件、${x.versions} 個版本`);
console.log('完成');
