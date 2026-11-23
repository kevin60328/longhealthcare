/* 階段 9：系統管理寫入流程（畫面操作）：員工註冊待審核 → 管理員核准 → 開啟案件分配權限 → 重設臨時密碼 → 用臨時密碼登入要改密碼。
 * 用暫時帳號（e2e-…@example.com），測試結束自動清除。 */
import { test, expect } from '@playwright/test';
import { login, service } from '../helpers.js';

const PW = 'Temp-pass-0001';
test.describe.configure({ mode: 'serial' });

test('管理員核准員工申請 → 開啟案件分配權限 → 重設臨時密碼 → 對方用臨時密碼登入後必須改密碼', async ({ page }) => {
  const email = `e2e-c9-${Date.now()}@example.com`;
  const { error } = await service().auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { name: '新進護理師', phone: '0912000999', want: 'nurse' } });
  if (error) throw error;

  await login(page, 'admin@example.com');
  const pend = page.locator('#pendingCard .task').filter({ hasText: '新進護理師' });
  await expect(pend).toContainText('申請「護理人員」');
  await pend.getByRole('button', { name: '核准' }).click();
  await page.getByRole('button', { name: '核准', exact: true }).last().click();
  await expect(page.locator('.toast')).toHaveText('已核准');
  const row = page.locator(`#accRows tr[data-acc="${email}"]`);
  await expect(row).toContainText('護理人員');
  await expect(row).toContainText('啟用');

  await row.getByRole('button', { name: '開啟案件分配權限' }).click();
  await page.getByRole('button', { name: '開啟', exact: true }).click();
  await expect(page.locator('.toast')).toHaveText('已更新');
  await expect(page.locator(`#accRows tr[data-acc="${email}"]`)).toContainText('案件分配權限');

  await page.locator(`#accRows tr[data-acc="${email}"]`).getByRole('button', { name: '重設密碼' }).click();
  await page.getByRole('button', { name: '產生臨時密碼' }).click();
  const tmp = (await page.locator('#tmpPw').innerText()).trim();
  expect(tmp).toMatch(/^Tmp[a-z]{6}\d{2}$/);
  await page.getByRole('button', { name: '完成' }).click();

  /* 對方用臨時密碼登入：導到修改密碼畫面 */
  await page.getByRole('button', { name: '登出' }).click();
  await login(page, email, { password: tmp, portal: 'staff' });
  await expect(page).toHaveURL(/login\.html\?view=password/);
});
