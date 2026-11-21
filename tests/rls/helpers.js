/* RLS 測試共用：從 .env、.env.secrets 讀取測試專案連線資訊，以各角色實際登入後直接查詢資料庫。
 * 只能對本機或標示為測試專案（SEED_ALLOW_REMOTE=1）的 Supabase 執行，因為測試會暫時改動案件資料。 */
import { createClient } from '@supabase/supabase-js';
import { loadEnv, assertTestTarget } from '../../scripts/load-env.mjs';

const env = loadEnv();
assertTestTarget(env);

export const URL = env.SUPABASE_URL;
export const ANON = env.SUPABASE_ANON_KEY;
export const PASSWORD = env.SEED_PASSWORD;
if (!URL || !ANON || !env.SUPABASE_SERVICE_ROLE_KEY || !PASSWORD) throw new Error('缺少連線設定：請確認 .env 與 .env.secrets 已填寫');

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
export const anon = () => createClient(URL, ANON, opts);
export const service = () => createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, opts);

/* 以某個帳號登入。同一次測試裡每個帳號只登入一次、重複使用：
 * Supabase Auth 對登入次數有頻率限制（短時間太多次會回「Request rate limit reached」）。 */
const sessions = new Map();
export function as(email){
  if (!sessions.has(email)) sessions.set(email, (async () => {
    const c = anon();
    const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
    if (error){ sessions.delete(email); throw new Error(`${email} 登入失敗：${error.message}`); }
    return c;
  })());
  return sessions.get(email);
}
