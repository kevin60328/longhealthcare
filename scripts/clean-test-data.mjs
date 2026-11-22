/* 清除自動測試留下的資料：自動測試帳號（e2e-…／rls-…@example.com）建立的案件、操作紀錄，以及這些帳號本身。
 * 種子帳號（family@example.com 等）、C-0001／C-0002、T-A～T-D 不受影響。
 * 用法：npm run db:clean-tests（npm run test:e2e、test:rls 結束時也會自動執行）
 * 只限本機或標示為測試專案（SEED_ALLOW_REMOTE=1）的 Supabase。 */
import { createClient } from '@supabase/supabase-js';
import { loadEnv, assertTestTarget } from './load-env.mjs';

export async function cleanTestData({ quiet = false } = {}){
  const env = loadEnv();
  assertTestTarget(env);
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.rpc('purge_test_data');
  if (error) throw new Error('清除測試資料失敗：' + error.message);
  /* 帳號：逐頁列出，刪除自動測試帳號 */
  let users = 0;
  for (let page = 1; ; page++){
    const { data: u, error: e } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (e) throw e;
    for (const x of u.users) if (/^(e2e|rls)-[^@]*@example\.com$/.test(x.email || '')){
      const r = await db.auth.admin.deleteUser(x.id);
      if (!r.error) users++;
    }
    if (u.users.length < 1000) break;
  }
  if (!quiet) console.log(`已清除測試資料：案件 ${data.cases} 件、操作紀錄 ${data.logs} 筆、住民 ${data.residents} 位、待確認紀錄 ${data.conflicts} 筆、測試帳號 ${users} 個`);
  return { ...data, users };
}

if (process.argv[1] && process.argv[1].endsWith('clean-test-data.mjs')) await cleanTestData();
