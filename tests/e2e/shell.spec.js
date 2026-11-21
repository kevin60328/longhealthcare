/* 階段 0：8 頁都能開啟，共用頁首頁尾與字級設定 */
import { test, expect } from '@playwright/test';

const PAGES = ['login', 'dashboard', 'application', 'cases', 'documents', 'assessment', 'care-summary', 'settings'];

for (const p of PAGES){
  test(`${p}.html 能開啟並有共用頁首頁尾`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`/${p}.html`);
    await expect(page.locator('#top .brand')).toHaveText('康和長照中心');
    await expect(page.locator('#main h1')).toBeVisible();
    await expect(page.locator('#siteFoot')).not.toBeEmpty();
    expect(errors.filter(e => !/fonts\.(googleapis|gstatic)/.test(e))).toEqual([]);
  });
}

test('字級設定記在 localStorage，換頁後保留', async ({ page }) => {
  await page.goto('/login.html');
  await page.getByRole('button', { name: /字級設定/ }).click();
  await page.getByRole('menuitemradio', { name: /特大/ }).click();
  await expect(page.locator('html')).toHaveClass(/fs-xl/);
  await page.goto('/cases.html');
  await expect(page.locator('html')).toHaveClass(/fs-xl/);
});

test('index.html 轉到 login.html', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/login\.html$/);
});
