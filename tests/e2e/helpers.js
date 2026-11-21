/* E2E 共用：測試專案連線、登入、建立／刪除暫時帳號。
 * 會改密碼或改帳號狀態的測試一律用暫時帳號，不動 seed 的測試帳號。
 * 暫時帳號用 Admin API 建立（不寄信），測試結束後刪除。 */
import { createClient } from '@supabase/supabase-js';
import { expect } from '@playwright/test';
import { loadEnv, assertTestTarget } from '../../scripts/load-env.mjs';

export const env = loadEnv();
assertTestTarget(env);
export const PASSWORD = env.SEED_PASSWORD;

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
export const service = () => createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, opts);

/* 從指定入口登入（portal：applicant／staff） */
export async function login(page, email, { portal, password = PASSWORD, next } = {}){
  const q = new URLSearchParams({ view: 'login', portal: portal || (/^(family|e2e-)/.test(email) ? 'applicant' : 'staff') });
  if (next) q.set('next', next);
  await page.goto('/login.html?' + q);
  await page.getByLabel('電子郵件').fill(email);
  await page.getByRole('textbox', { name: '密碼', exact: true }).fill(password);
  await page.getByRole('button', { name: '登入' }).click();
  /* 等登入結果：離開登入畫面（成功導頁），或出現錯誤訊息。避免下一個 goto 跟登入後的導頁互相搶 */
  await Promise.race([
    page.waitForURL(u => !/view=login/.test(u.search), { timeout: 15000 }),
    page.locator('#loginErr:not(:empty)').waitFor({ timeout: 15000 })
  ]);
}

/* 導覽列：選取中的分頁必須剛好一個，回傳它的名稱 */
export async function currentTab(page){
  const cur = page.locator('nav.subnav [aria-current="page"]');
  await expect(cur).toHaveCount(1);
  return (await cur.getAttribute('data-tab'));
}

/* 暫時帳號：profile 欄位直接用 service role 設定（role、status、phone、must_change_password…） */
const made = [];
export async function tempUser(profile = {}, password = 'Temp-pass-0001'){
  const svc = service();
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { data, error } = await svc.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { name: 'E2E 測試', phone: '0912-000-111', want: profile.role || 'family' },
    app_metadata: { role: profile.role || 'family' }      // 有 app_metadata 角色時，觸發器不檢查電話（才能測缺電話的舊帳號）
  });
  if (error) throw error;
  made.push(data.user.id);
  const r = await svc.from('profiles').update({ role: 'family', status: '啟用', name: 'E2E 測試', ...profile }).eq('id', data.user.id);
  if (r.error) throw r.error;
  return { id: data.user.id, email, password };
}

export async function cleanupUsers(){
  const svc = service();
  while (made.length){
    const id = made.pop();
    await svc.auth.admin.deleteUser(id);
  }
}

/* 專案是否關閉了「Confirm email」（關閉時註冊會直接登入，不寄驗證信） */
export async function autoConfirm(){
  const r = await fetch(env.SUPABASE_URL + '/auth/v1/settings', { headers: { apikey: env.SUPABASE_ANON_KEY } });
  return (await r.json()).mailer_autoconfirm === true;
}
