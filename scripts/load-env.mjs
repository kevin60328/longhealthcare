/* 本機腳本與測試共用的設定讀取：依序讀 .env（公開值）與 .env.secrets（秘密，只在本機）。
 * 已經在系統環境變數設定的值優先，不會被檔案覆蓋。
 * 回傳 { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL, SEED_PASSWORD, SEED_ALLOW_REMOTE, … } */
import { existsSync, readFileSync } from 'node:fs';

function parse(file){
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
    .map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean)
    .map(([, k, v]) => [k, v.replace(/^(['"])(.*)\1$/, '$2')]));
}

export function loadEnv(){
  const merged = { ...parse('.env'), ...parse('.env.secrets') };
  const keys = new Set([...Object.keys(merged), 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL', 'SEED_PASSWORD', 'SEED_ALLOW_REMOTE']);
  for (const k of keys) if (process.env[k]) merged[k] = process.env[k];
  return {
    ...merged,
    SUPABASE_URL: merged.VITE_SUPABASE_URL,
    SUPABASE_ANON_KEY: merged.VITE_SUPABASE_ANON_KEY
  };
}

/* 只允許本機，或明確標示為測試專案（SEED_ALLOW_REMOTE=1）的遠端 */
export function assertTestTarget(env){
  const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(env.SUPABASE_URL || '');
  if (!local && env.SEED_ALLOW_REMOTE !== '1') throw new Error(`拒絕寫入 ${env.SUPABASE_URL}：確定是測試專案時，才在 .env.secrets 設定 SEED_ALLOW_REMOTE=1`);
}
