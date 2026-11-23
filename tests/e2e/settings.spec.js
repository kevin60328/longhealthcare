/* 階段 9：settings.html 只讀的檢查（管理員各畫面、其他角色不能進入）。會寫入資料的流程在 writes/settings.spec.js。 */
import { test, expect } from '@playwright/test';
import { login, currentTab } from './helpers.js';

test('管理員：帳號管理、機構設定（文件清單、資料存取說明）、結案與封存、操作紀錄（分頁）、寄送異常、測試資料', async ({ page }) => {
  await login(page, 'admin@example.com');
  await expect(page).toHaveURL(/settings\.html\?view=accounts/);
  await expect(page.getByRole('heading', { name: '帳號管理' })).toBeVisible();
  await expect(page.locator('#accRows tr[data-acc="staff@example.com"]')).toContainText('行政／社工');
  await expect(page.locator('#accRows tr[data-acc="admin@example.com"]')).toContainText('（您）');
  expect(await currentTab(page)).toBe('accounts');

  await page.getByRole('link', { name: '機構設定' }).click();
  await expect(page.getByRole('heading', { name: '機構設定' })).toBeVisible();
  await expect(page.locator('input[name="name"]')).toHaveValue('康和長照中心');
  await expect(page.locator('input[name="mode"][value="先審後簽"]')).toBeChecked();
  await page.locator('#docListRef summary').click();
  await expect(page.locator('#docListRef')).toContainText('示範機構的參考設定');
  await expect(page.locator('#accessCard')).toContainText('資料庫權限（RLS）');
  await expect(page.locator('#accessCard')).not.toContainText('尚未實作');
  expect(await currentTab(page)).toBe('org');

  await page.getByRole('link', { name: '結案與封存' }).click();
  await expect(page.getByRole('heading', { name: '結案與封存' })).toBeVisible();
  await expect(page.locator('.tiles .tile')).toHaveCount(3);

  await page.getByRole('link', { name: '操作紀錄' }).click();
  await expect(page.getByRole('heading', { name: '操作紀錄' })).toBeVisible();
  await expect(page.locator('#logRows tr')).toHaveCount(50);
  await page.getByRole('link', { name: '較舊的紀錄 →' }).click();
  await expect(page).toHaveURL(/view=logs&page=1/);
  await expect(page.locator('main')).toContainText('第 2／');
  expect(await currentTab(page)).toBe('logs');

  await page.getByRole('link', { name: '寄送異常' }).click();
  await expect(page.getByRole('heading', { name: '寄送異常' })).toBeVisible();

  await page.getByRole('link', { name: '測試資料' }).click();
  await expect(page.getByRole('heading', { name: '測試資料（僅供測試）' })).toBeVisible();
  await expect(page.locator('#testRows tr')).toHaveCount(4);
  await expect(page.locator('#testRows tr[data-no="T-D"]')).toContainText('摘要卡已開放');
});

test('管理員以外的角色不能進入系統管理', async ({ page }) => {
  for (const e of ['staff@example.com', 'nurse@example.com', 'family@example.com']){
    await login(page, e);
    await page.goto('/settings.html?view=accounts');
    await expect(page.getByRole('heading', { name: '沒有權限' })).toBeVisible();
    await page.getByRole('button', { name: '登出' }).click();
  }
});
