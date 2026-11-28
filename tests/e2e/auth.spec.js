/* 階段 2：login.html、登入分流、頁面守門、導覽列（HANDOFF 13 階段 2 完成條件、14 驗收）。
 * 連的是雲端測試專案；會改密碼或帳號狀態的測試都用暫時帳號（helpers.tempUser），不動 seed 帳號。 */
import { test, expect } from '@playwright/test';
import { login, currentTab, tempUser, cleanupUsers, service, autoConfirm, PASSWORD } from './helpers.js';

test.afterAll(cleanupUsers);

/* ---------- 五種角色登入後到正確首頁，導覽列只有一個選取分頁 ---------- */
const ROLES = [
  { email: 'family@example.com', url: /dashboard\.html$/, name: '張家豪', role: '家屬／申請人', tabs: ['home', 'notices'], cur: 'home' },
  { email: 'staff@example.com', url: /dashboard\.html$/, name: '陳社工', role: '行政／社工', tabs: ['home', 'cases'], cur: 'home' },
  { email: 'nurse@example.com', url: /dashboard\.html$/, name: '黃護理師', role: '護理人員', tabs: ['home', 'residents', 'assign'], cur: 'home' },
  { email: 'nurse2@example.com', url: /dashboard\.html$/, name: '吳護理師', role: '護理人員', tabs: ['home', 'residents'], cur: 'home' },
  { email: 'care@example.com', url: /dashboard\.html$/, name: '阿妮（Ani）', role: '照顧服務員', tabs: ['home'], cur: 'home' },
  { email: 'admin@example.com', url: /settings\.html\?view=accounts$/, name: '林主任', role: '系統管理員', tabs: ['accounts', 'org', 'archive', 'logs', 'mail-errors', 'testdata'], cur: 'accounts' }
];
for (const r of ROLES){
  test(`${r.email} 登入後到首頁，分頁正確且只有一個選取`, async ({ page }) => {
    await login(page, r.email);
    await expect(page).toHaveURL(r.url);
    await expect(page.locator('.who')).toContainText(r.name);
    await expect(page.locator('.who')).toContainText(r.role);
    await expect(page.locator('nav.subnav a')).toHaveCount(r.tabs.length);
    expect(await page.locator('nav.subnav a').evaluateAll(as => as.map(a => a.dataset.tab))).toEqual(r.tabs);
    expect(await currentTab(page)).toBe(r.cur);
  });
}

test('有分配權限的護理師在案件分配頁：只有「案件分配」被選取（原型 v18 修過的 bug）', async ({ page }) => {
  await login(page, 'nurse@example.com');
  await page.getByRole('link', { name: /案件分配/ }).click();
  await expect(page).toHaveURL(/cases\.html\?view=assign$/);
  expect(await currentTab(page)).toBe('assign');
  await page.getByRole('link', { name: /負責住民/ }).click();
  expect(await currentTab(page)).toBe('residents');
});

test('沒有分配權限的護理師打開案件分配：沒有權限', async ({ page }) => {
  await login(page, 'nurse2@example.com');
  await page.goto('/cases.html?view=assign');
  await expect(page.getByRole('heading', { name: '沒有權限' })).toBeVisible();
});

/* 與原型相同：收件核對、核對日期、補件追蹤在「工作清單」下；看文件在「案件」下；從案件頁進來（from=case）一律歸「案件」 */
test('詳細頁歸到所屬分頁：收件核對歸「工作清單」、看文件歸「案件」，from=case／from=home 依來源', async ({ page }) => {
  await login(page, 'staff@example.com');
  await page.goto('/documents.html?view=receipt');
  expect(await currentTab(page)).toBe('home');
  await page.goto('/documents.html?view=receipt&from=case');
  expect(await currentTab(page)).toBe('cases');
  await page.goto('/documents.html?view=doc');
  expect(await currentTab(page)).toBe('cases');
  await page.goto('/documents.html?view=doc&from=home');
  expect(await currentTab(page)).toBe('home');
});

test('瀏覽器上一頁：切換分頁後按上一頁，選取分頁跟著回來', async ({ page }) => {
  await login(page, 'admin@example.com');
  await page.getByRole('link', { name: '機構設定' }).click();
  expect(await currentTab(page)).toBe('org');
  await page.getByRole('link', { name: '操作紀錄' }).click();
  expect(await currentTab(page)).toBe('logs');
  await page.goBack();
  await expect(page).toHaveURL(/view=org$/);
  expect(await currentTab(page)).toBe('org');
  await page.goBack();
  await expect(page).toHaveURL(/view=accounts$/);
  expect(await currentTab(page)).toBe('accounts');
});

test('管理員「帳號管理」徽章＝待審核帳號數，切換分頁不改變', async ({ page }) => {
  const { count } = await service().from('profiles').select('id', { count: 'exact', head: true }).eq('status', '待審核');
  expect(count).toBeGreaterThanOrEqual(2);         // seed：林佳穎、陳志豪
  await login(page, 'admin@example.com');
  const badge = page.locator('nav.subnav [data-tab="accounts"] .badge');
  await expect(badge).toHaveText(String(count));
  await page.getByRole('link', { name: '操作紀錄' }).click();
  await expect(badge).toHaveText(String(count));
});

/* ---------- 入口與錯誤 ---------- */
test('密碼錯誤：顯示錯誤，不登入', async ({ page }) => {
  await login(page, 'family@example.com', { password: 'wrong-pass-1' });
  await expect(page.locator('#loginErr')).toHaveText('電子郵件或密碼不正確');
  await expect(page).toHaveURL(/view=login/);
});

test('工作帳號從一般申請人入口登入：擋下並說明，且沒有留下登入狀態', async ({ page }) => {
  await login(page, 'staff@example.com', { portal: 'applicant' });
  await expect(page.locator('#loginErr')).toContainText('這是機構工作人員帳號');
  await page.goto('/dashboard.html');
  await expect(page).toHaveURL(/login\.html\?next=/);
});

test('家屬帳號從機構工作人員入口登入：擋下並說明', async ({ page }) => {
  await login(page, 'family@example.com', { portal: 'staff' });
  await expect(page.locator('#loginErr')).toContainText('這是一般申請人帳號');
});

test('必填欄位有紅色星號', async ({ page }) => {
  await page.goto('/login.html?view=login&portal=applicant');
  await expect(page.locator('#loginForm .req.auto')).toHaveCount(2);
  await expect(page.locator('#loginForm .req-note')).toContainText('為必填欄位');
});

/* ---------- 頁面守門 ---------- */
test('未登入打開受保護頁面 → 登入後回到原本網址', async ({ page }) => {
  await page.goto('/cases.html?view=list');
  await expect(page).toHaveURL(/login\.html\?next=/);
  await page.getByRole('link', { name: /機構工作人員/ }).click();
  await page.getByLabel('電子郵件').fill('staff@example.com');
  await page.getByRole('textbox', { name: '密碼', exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page).toHaveURL(/cases\.html\?view=list$/);
});

test('next 不能把人導到外部網站', async ({ page }) => {
  await login(page, 'staff@example.com', { next: 'https://evil.example.com/' });
  await expect(page).toHaveURL(/\/dashboard\.html$/);
});

test('家屬打開系統管理頁：沒有權限，可回首頁', async ({ page }) => {
  await login(page, 'family@example.com');
  await page.goto('/settings.html?view=accounts');
  await expect(page.getByRole('heading', { name: '沒有權限' })).toBeVisible();
  await page.getByRole('link', { name: '回到首頁' }).click();
  await expect(page).toHaveURL(/dashboard\.html$/);
});

test('照服員打開文件頁、評估頁：沒有權限', async ({ page }) => {
  await login(page, 'care@example.com');
  for (const p of ['documents.html', 'assessment.html', 'cases.html', 'application.html']){
    await page.goto('/' + p);
    await expect(page.getByRole('heading', { name: '沒有權限' })).toBeVisible();
  }
});

test('重新整理後仍是登入狀態', async ({ page }) => {
  await login(page, 'staff@example.com');
  await expect(page).toHaveURL(/dashboard\.html$/);
  await page.reload();
  await expect(page.locator('.who')).toContainText('陳社工');
});

test('已登入打開登入頁：直接回首頁', async ({ page }) => {
  await login(page, 'family@example.com');
  await expect(page).toHaveURL(/dashboard\.html$/);
  await page.goto('/login.html');
  await expect(page).toHaveURL(/dashboard\.html$/);
});

test('登出後：按上一頁不能回到受保護頁面', async ({ page }) => {
  await login(page, 'staff@example.com');
  await page.getByRole('link', { name: '案件' }).click();
  await expect(page).toHaveURL(/cases\.html$/);
  await page.getByRole('button', { name: '登出' }).click();
  await expect(page).toHaveURL(/login\.html$/);
  await page.goBack();
  await expect(page).toHaveURL(/login\.html/);
  await expect(page.locator('.who')).toHaveCount(0);
  await page.goto('/cases.html');
  await expect(page).toHaveURL(/login\.html\?next=/);
});

test('另一個分頁登出，這個分頁也回到登入頁', async ({ page, context }) => {
  await login(page, 'staff@example.com');
  await expect(page).toHaveURL(/dashboard\.html$/);
  const other = await context.newPage();
  await other.goto('/cases.html');
  await expect(other.locator('.who')).toContainText('陳社工');
  await other.getByRole('button', { name: '登出' }).click();
  await expect(page).toHaveURL(/login\.html/, { timeout: 15000 });
});

/* ---------- 帳號狀態 ---------- */
test('待審核的員工登入：顯示帳號審核中，不能進工作畫面', async ({ page }) => {
  await login(page, 'jiaying@example.com');
  await expect(page).toHaveURL(/view=pending/);
  await expect(page.getByRole('heading', { name: '帳號審核中' })).toBeVisible();
  await expect(page.getByText('您申請「護理人員」的帳號')).toBeVisible();
  await page.goto('/dashboard.html');
  await expect(page).toHaveURL(/view=pending/);
});

test('已停用的帳號：顯示無法使用', async ({ page }) => {
  const u = await tempUser({ role: 'staff', status: '停用' });
  await login(page, u.email, { portal: 'staff', password: u.password });
  await expect(page.getByRole('heading', { name: '無法使用' })).toBeVisible();
  await expect(page.getByText('您的帳號已停用')).toBeVisible();
});

test('臨時密碼：強制改密碼，改完清除旗標並進首頁', async ({ page }) => {
  const u = await tempUser({ role: 'family', must_change_password: true });
  await login(page, u.email, { password: u.password });
  await expect(page).toHaveURL(/view=password/);
  await expect(page.getByRole('heading', { name: '請設定新密碼' })).toBeVisible();
  await page.goto('/dashboard.html');                       // 沒改密碼不能進其他頁
  await expect(page).toHaveURL(/view=password/);
  await page.locator('input[name=pw]').fill('short');
  await page.locator('input[name=pw2]').fill('short');
  await page.getByRole('button', { name: '儲存新密碼' }).click();
  await expect(page.locator('#pwErr')).toContainText('至少 8 碼');
  await page.locator('input[name=pw]').fill('New-pass-2026');
  await page.locator('input[name=pw2]').fill('New-pass-2026');
  await page.getByRole('button', { name: '儲存新密碼' }).click();
  await expect(page).toHaveURL(/dashboard\.html$/);
  await expect(page.locator('.toast')).toHaveText('密碼已更新');
  const { data } = await service().from('profiles').select('must_change_password').eq('id', u.id).single();
  expect(data.must_change_password).toBe(false);
  /* 改密碼的時間記在操作紀錄（profiles.password_changed_at 已移除，見 migrations/…000035） */
  const { data: lg } = await service().from('audit_logs').select('action').eq('actor', u.id).order('id', { ascending: false }).limit(1).single();
  expect(lg.action).toMatch(/密碼/);
});

test('修改密碼：目前的密碼錯誤會擋下；正確才更新，新密碼可登入', async ({ page }) => {
  const u = await tempUser({ role: 'family' });
  await login(page, u.email, { password: u.password });
  await page.getByRole('link', { name: '修改密碼' }).click();
  await page.locator('input[name=old]').fill('wrong-pass-9');
  await page.locator('input[name=pw]').fill('Changed-2026');
  await page.locator('input[name=pw2]').fill('Changed-2026');
  await page.getByRole('button', { name: '儲存新密碼' }).click();
  await expect(page.locator('#pwErr')).toHaveText('目前的密碼不正確');
  await page.locator('input[name=old]').fill(u.password);
  await page.getByRole('button', { name: '儲存新密碼' }).click();
  await expect(page).toHaveURL(/dashboard\.html$/);
  await page.getByRole('button', { name: '登出' }).click();
  await login(page, u.email, { password: 'Changed-2026' });
  await expect(page).toHaveURL(/dashboard\.html$/);
});

test('忘記密碼：重設連結（管理端產生，不寄信）→ 設定新密碼 → 新密碼可登入', async ({ page }) => {
  const u = await tempUser({ role: 'family' });
  const { data, error } = await service().auth.admin.generateLink({ type: 'recovery', email: u.email });
  expect(error).toBeNull();
  await page.goto('/login.html?view=reset&token_hash=' + data.properties.hashed_token);
  await expect(page.getByRole('heading', { name: '設定新密碼' })).toBeVisible();
  await expect(page.getByText(u.email)).toBeVisible();
  await page.locator('input[name=pw]').fill('Reset-pass-2026');
  await page.locator('input[name=pw2]').fill('Reset-pass-2026');
  await page.getByRole('button', { name: '儲存新密碼' }).click();
  await expect(page).toHaveURL(/dashboard\.html$/);
  await page.getByRole('button', { name: '登出' }).click();
  await login(page, u.email, { password: 'Reset-pass-2026' });
  await expect(page).toHaveURL(/dashboard\.html$/);
});

test('忘記密碼：連結用過或過期 → 說明並可重新申請', async ({ page }) => {
  await page.goto('/login.html?view=reset#error=access_denied&error_code=otp_expired&error_description=expired');
  await expect(page.getByRole('heading', { name: '無法重設密碼' })).toBeVisible();
  await expect(page.getByText('已經過期或已經用過')).toBeVisible();
  await expect(page.getByRole('link', { name: '重新申請' })).toBeVisible();
});

test('忘記密碼畫面：電子郵件格式錯誤時擋下（不寄信）', async ({ page }) => {
  await page.goto('/login.html?view=forgot&portal=applicant');
  await page.getByLabel('電子郵件').fill('not-an-email');
  await page.getByRole('button', { name: '寄出重設密碼信' }).click();
  await expect(page.locator('#forgotErr')).toHaveText('電子郵件格式不正確');
});

test('缺手機號碼的舊帳號：顯示補填提示；格式錯誤擋下；正確後儲存並消失', async ({ page }) => {
  const u = await tempUser({ role: 'family', phone: '' });
  await login(page, u.email, { password: u.password });
  await expect(page.getByRole('heading', { name: '請補填手機號碼' })).toBeVisible();
  await page.locator('#phoneForm input[name=phone]').fill('12345');
  await page.getByRole('button', { name: '儲存手機號碼' }).click();
  await expect(page.locator('#pfErr')).toContainText('請輸入正確的手機號碼');
  await page.locator('#phoneForm input[name=phone]').fill('0912 345 678');
  await page.getByRole('button', { name: '儲存手機號碼' }).click();
  await expect(page.locator('#phoneFill')).toHaveCount(0);
  const { data } = await service().from('profiles').select('phone').eq('id', u.id).single();
  expect(data.phone).toBe('0912-345-678');
});

/* ---------- 註冊（會呼叫 Supabase signUp；專案開著「Confirm email」時會真的寄信，所以跳過） ---------- */
test.describe('註冊', () => {
  test.beforeEach(async () => {
    test.skip(!(await autoConfirm()), '測試專案仍開啟「Confirm email」，註冊會寄出真的驗證信，先不執行');
  });

  test('家屬註冊後直接進個人首頁', async ({ page }) => {
    const email = `e2e-reg-${Date.now()}@example.com`;
    await page.goto('/login.html?view=register&portal=applicant');
    await page.getByLabel('姓名').fill('註冊測試');
    await page.getByLabel('電子郵件').fill(email);
    await page.getByLabel('手機號碼').fill('0912345678');
    await page.locator('input[name=pw]').fill('Reg-pass-2026');
    await page.getByLabel('確認密碼').fill('Reg-pass-2026');
    await page.getByRole('button', { name: '註冊' }).click();
    await expect(page).toHaveURL(/dashboard\.html$/);
    const { data } = await service().from('profiles').select('id, role, status, phone').eq('email', email).single();
    expect(data).toMatchObject({ role: 'family', status: '啟用', phone: '0912-345-678' });
    await service().auth.admin.deleteUser(data.id);
  });

  test('後台密碼規則：繞過畫面直接註冊，太短或沒有數字的密碼也會被 Supabase 擋下', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { env } = await import('./helpers.js');
    const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    for (const pw of ['abc1234', 'abcdefgh']){
      const { data, error } = await anon.auth.signUp({ email: `e2e-pw-${Date.now()}@example.com`, password: pw, options: { data: { name: '密碼規則測試', phone: '0912000000' } } });
      if (data?.user) await service().auth.admin.deleteUser(data.user.id);     // 萬一沒擋下，也不要留下帳號
      expect(error, `密碼「${pw}」應該被擋下`).not.toBeNull();
      expect(error.code).toBe('weak_password');
    }
  });

  test('新進人員申請：待審核，不能進工作畫面', async ({ page }) => {
    const email = `e2e-reg-${Date.now()}@example.com`;
    await page.goto('/login.html?view=register&portal=staff');
    await page.getByLabel('申請的角色').selectOption('nurse');
    await page.getByLabel('姓名').fill('註冊測試');
    await page.getByLabel('電子郵件').fill(email);
    await page.getByLabel('手機號碼').fill('0912345678');
    await page.locator('input[name=pw]').fill('Reg-pass-2026');
    await page.getByLabel('確認密碼').fill('Reg-pass-2026');
    await page.getByRole('button', { name: '送出申請' }).click();
    await expect(page).toHaveURL(/view=pending/);
    const { data } = await service().from('profiles').select('id, role, status, want').eq('email', email).single();
    expect(data).toMatchObject({ role: null, status: '待審核', want: 'nurse' });
    await service().auth.admin.deleteUser(data.id);
  });
});

test('註冊表單：欄位錯誤逐欄顯示，不清空已填內容（不送出，不寄信）', async ({ page }) => {
  await page.goto('/login.html?view=register&portal=applicant');
  await page.getByLabel('姓名').fill('王小明');
  await page.getByLabel('電子郵件').fill('bad@');
  await page.getByLabel('手機號碼').fill('123');
  await page.locator('input[name=pw]').fill('abcdefgh');
  await page.getByLabel('確認密碼').fill('abcdefgx');
  await page.getByRole('button', { name: '註冊' }).click();
  await expect(page.locator('#regErr')).toContainText('共 4 項');
  await expect(page.locator('.ferr')).toHaveCount(4);
  await expect(page.getByLabel('姓名')).toHaveValue('王小明');
});
