/* 把 supabase/migrations 的資料表、RLS 與 supabase/seed.sql（文件清單、機構設定）套用到測試專案。
 * 用法：npm run db:push
 * 連線字串從 .env.secrets 的 SUPABASE_DB_URL 讀取，不會印在畫面上。
 * 只對本機或標示為測試專案（SEED_ALLOW_REMOTE=1）的 Supabase 執行。已套用過的 migration 不會重複執行。 */
import { spawnSync } from 'node:child_process';
import { loadEnv, assertTestTarget } from './load-env.mjs';

const env = loadEnv();
assertTestTarget(env);
if (!env.SUPABASE_DB_URL) throw new Error('請在 .env.secrets 設定 SUPABASE_DB_URL');

// Windows 的 npx 是 .cmd，必須經過 shell；連線字串加上引號，避免被 shell 拆開
const r = spawnSync('npx', ['supabase', 'db', 'push', '--include-seed', '--yes', `"--remote=${env.SUPABASE_DB_URL}"`],
  { stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
