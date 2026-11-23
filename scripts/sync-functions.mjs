/* 把瀏覽器與伺服器共用的程式複製到 supabase/functions/_shared/，給 Edge Function 使用。
 * 為什麼要複製：Supabase 部署 Edge Function 時只打包 supabase/functions 底下的檔案。
 * 規則只有一份（js/modules/rules/core.js、js/modules/services/model-build.js），這裡只是複製；
 * tests/unit/functions-sync.test.js 會檢查副本與原始檔一致，改了規則忘記同步時測試會失敗。
 * 用法：npm run functions:sync（npm run functions:deploy 會先自動執行） */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export const SHARED = [
  ['js/modules/rules/core.js', 'supabase/functions/_shared/core.js'],
  ['js/modules/services/model-build.js', 'supabase/functions/_shared/model-build.js'],
  ['js/modules/rules/fields.js', 'supabase/functions/_shared/fields.js'],   // 護理核對欄位定義（OCR 護理核對模式用）
  ['scripts/test-cases-core.mjs', 'supabase/functions/_shared/test-cases-core.js']   // 種子測試案件建立邏輯（admin-testdata 用）
];
export const HEAD = '/* 自動產生：由 npm run functions:sync 從原始檔複製，請勿直接修改（改原始檔後重新同步）。 */\n';

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('sync-functions.mjs')){
  mkdirSync('supabase/functions/_shared', { recursive: true });
  for (const [src, dst] of SHARED){
    writeFileSync(dst, HEAD + readFileSync(src, 'utf8').replace(/from '\.\.\/rules\/core\.js'/g, "from './core.js'"));
    console.log(`${src} → ${dst}`);
  }
  /* 種子測試案件的原始資料：從原型對照資料取出 4 筆起始狀態（與 npm run db:seed-cases 相同），給 admin-testdata 使用 */
  const F = JSON.parse(gunzipSync(readFileSync('tests/unit/fixtures/parity.json.gz')));
  const bases = [];
  for (const x of F.scenarios){ if (x.input.c.id.startsWith('TEST-') && !bases.some(b => b.c.id === x.input.c.id)) bases.push(x.input); }
  writeFileSync('supabase/functions/_shared/test-cases.json', JSON.stringify(bases));
  console.log('tests/unit/fixtures/parity.json.gz → supabase/functions/_shared/test-cases.json（' + bases.length + ' 筆）');
}
