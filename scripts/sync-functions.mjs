/* 把瀏覽器與伺服器共用的程式複製到 supabase/functions/_shared/，給 Edge Function 使用。
 * 為什麼要複製：Supabase 部署 Edge Function 時只打包 supabase/functions 底下的檔案。
 * 規則只有一份（js/modules/rules/core.js、js/modules/services/model-build.js），這裡只是複製；
 * tests/unit/functions-sync.test.js 會檢查副本與原始檔一致，改了規則忘記同步時測試會失敗。
 * 用法：npm run functions:sync（npm run functions:deploy 會先自動執行） */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

export const SHARED = [
  ['js/modules/rules/core.js', 'supabase/functions/_shared/core.js'],
  ['js/modules/services/model-build.js', 'supabase/functions/_shared/model-build.js']
];
export const HEAD = '/* 自動產生：由 npm run functions:sync 從原始檔複製，請勿直接修改（改原始檔後重新同步）。 */\n';

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('sync-functions.mjs')){
  mkdirSync('supabase/functions/_shared', { recursive: true });
  for (const [src, dst] of SHARED){
    writeFileSync(dst, HEAD + readFileSync(src, 'utf8').replace(/from '\.\.\/rules\/core\.js'/g, "from './core.js'"));
    console.log(`${src} → ${dst}`);
  }
}
