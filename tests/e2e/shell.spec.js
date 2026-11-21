/* 階段 0、2：8 頁都能開啟、共用頁首頁尾與字級設定；未登入打開受保護頁面會被導回登入頁 */
import { test, expect } from '@playwright/test';

const PROTECTED = ['dashboard', 'application', 'cases', 'documents', 'assessment', 'care-summary', 'settings'];

test('login.html 能開啟，有機構名稱、兩個入口與頁尾', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/login.html');
  await expect(page.locator('#top .brand')).toHaveText('康和長照中心');
  await expect(page.getByRole('link', { name: /一般申請人/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /機構工作人員/ })).toBeVisible();
  await expect(page.locator('#siteFoot')).not.toBeEmpty();
  expect(errors).toEqual([]);
});

for (const p of PROTECTED){
  test(`未登入打開 ${p}.html 會導回登入頁並記住原本網址`, async ({ page }) => {
    await page.goto(`/${p}.html?view=x`);
    await expect(page).toHaveURL(new RegExp(`login\\.html\\?next=${p}\\.html%3Fview%3Dx$`));
    await expect(page.getByText('請選擇登入入口')).toBeVisible();
  });
}

test('字級設定記在 localStorage，換頁後保留', async ({ page }) => {
  await page.goto('/login.html');
  await page.getByRole('button', { name: /字級設定/ }).click();
  await page.getByRole('menuitemradio', { name: /特大/ }).click();
  await expect(page.locator('html')).toHaveClass(/fs-xl/);
  await expect(page.locator('.toast')).toHaveText('字級：特大');
  await page.goto('/login.html?view=login&portal=staff');
  await expect(page.locator('html')).toHaveClass(/fs-xl/);
});

test('index.html 轉到 login.html', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/login\.html$/);
});
