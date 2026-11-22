/* 部署 supabase/functions 底下的 Edge Functions 到測試專案。
 * 用法：npm run functions:deploy（會先同步共用程式）
 * 需要 .env.secrets 的 SUPABASE_ACCESS_TOKEN（Supabase 後台 → 右上角頭像 → Account preferences → Access Tokens 產生）。
 * 用 --use-api 在 Supabase 雲端打包，不需要本機 Docker；--yes：執行這個腳本就代表要部署（CLI 在自動化環境需要明確確認）。token 不會印在畫面上。
 * 只部署到本機或標示為測試專案（SEED_ALLOW_REMOTE=1）的 Supabase。 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { loadEnv, assertTestTarget } from './load-env.mjs';

const env = loadEnv();
assertTestTarget(env);
if (!env.SUPABASE_ACCESS_TOKEN) throw new Error('請在 .env.secrets 設定 SUPABASE_ACCESS_TOKEN（Supabase 後台 → Account preferences → Access Tokens）');
const ref = (env.SUPABASE_URL.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
if (!ref) throw new Error('無法從 VITE_SUPABASE_URL 取得專案代碼');

const fns = readdirSync('supabase/functions').filter(n => !n.startsWith('_') && statSync('supabase/functions/' + n).isDirectory());
for (const fn of fns){
  console.log(`部署 ${fn} …`);
  const r = spawnSync('npx', ['supabase', 'functions', 'deploy', fn, '--remote=' + ref, '--use-api', '--yes'],
    { stdio: 'inherit', shell: true, env: { ...process.env, SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
