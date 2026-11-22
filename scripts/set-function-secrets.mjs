/* 把 Edge Function 需要的秘密（目前只有 Claude API key）設定到測試專案的 Supabase Secrets。
 * 用法：npm run functions:secrets
 * 讀 .env.secrets 的 ANTHROPIC_API_KEY，寫成暫存檔交給 supabase secrets set --env-file，完成後立刻刪除暫存檔。
 * 值不會出現在畫面、指令參數或任何專案檔案裡（HANDOFF 3.2：Claude API key 只能放在 Edge Functions 的環境變數）。
 * 需要 .env.secrets 的 SUPABASE_ACCESS_TOKEN（權限要包含 Secrets 寫入）。只限本機或標示為測試專案的 Supabase。 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, assertTestTarget } from './load-env.mjs';

const env = loadEnv();
assertTestTarget(env);
if (!env.SUPABASE_ACCESS_TOKEN) throw new Error('請在 .env.secrets 設定 SUPABASE_ACCESS_TOKEN');
if (!/^sk-ant-/.test(env.ANTHROPIC_API_KEY || '')) throw new Error('請在 .env.secrets 設定 ANTHROPIC_API_KEY（Claude Console → API Keys）');
const ref = (env.SUPABASE_URL.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
if (!ref) throw new Error('無法從 VITE_SUPABASE_URL 取得專案代碼');

const dir = mkdtempSync(join(tmpdir(), 'lhc-secrets-'));
const file = join(dir, 'secrets.env');
try {
  writeFileSync(file, `ANTHROPIC_API_KEY=${env.ANTHROPIC_API_KEY}\n`, { mode: 0o600 });
  const r = spawnSync('npx', ['supabase', 'secrets', 'set', '--env-file', file, '--remote=' + ref, '--yes'],
    { stdio: 'inherit', shell: true, env: { ...process.env, SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN } });
  if (r.status !== 0) process.exitCode = r.status ?? 1;
  else console.log('已設定 Edge Function secret：ANTHROPIC_API_KEY（值未顯示）');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
