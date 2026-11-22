/* 階段 5：cases.html 只讀的檢查（案件列表、搜尋、篩選、權限）。會寫入資料的流程在 writes/cases.spec.js。 */
import { test, expect } from '@playwright/test';
import { login, currentTab } from './helpers.js';

test('行政案件列表：搜尋、狀態篩選；待確認的申請連到確認頁，其他連到案件詳情', async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('e2e')){ sessionStorage.clear(); sessionStorage.setItem('e2e', '1'); } });
  await login(page, 'staff@example.com');
  await page.getByRole('link', { name: '案件' }).click();
  await expect(page).toHaveURL(/cases\.html$/);
  expect(await currentTab(page)).toBe('cases');
  await expect(page.getByRole('heading', { name: '案件' })).toBeVisible();
  await page.getByLabel('搜尋').fill('T-B');
  await expect(page.locator('#caseRows tr')).toHaveCount(1);
  await expect(page.locator('#caseRows tr')).toContainText('林玉蘭');
  await expect(page.locator('#caseRows tr').getByRole('link', { name: '查看' })).toHaveAttribute('href', /^cases\.html\?case=[0-9a-f-]{36}$/);
  await page.getByLabel('搜尋').fill('C-0001');
  await expect(page.locator('#caseRows tr').getByRole('link', { name: '查看' })).toHaveAttribute('href', /^cases\.html\?view=confirm&case=/);
  await page.getByLabel('搜尋').fill('');
  await page.getByLabel('狀態').selectOption('評估中');
  await expect(page.locator('#caseRows tr').first()).toContainText('評估中');
  for (const t of await page.locator('#caseRows .pill').allInnerTexts()) if (!/^(吳|黃)/.test(t)) expect(t).toBe('評估中');
});

test('案件詳情（T-D）：基本資料、文件表格、處理歷程、處理紀錄', async ({ page }) => {
  await login(page, 'staff@example.com');
  await page.goto('/cases.html');
  await page.getByLabel('搜尋').fill('T-D');
  await page.locator('#caseRows').getByRole('link', { name: '查看' }).click();
  await expect(page.getByRole('heading', { name: '吳月娥' })).toBeVisible();
  await expect(page.locator('.lead')).toContainText('摘要卡已開放');
  await expect(page.locator('#assignInfo')).toContainText('舊流程已有承辦護理師，原始分配時間未記錄');
  await expect(page.locator('#docTable tr.cat')).toHaveCount(6);
  await expect(page.locator('#timeline summary')).toContainText('處理歷程');
  expect(await currentTab(page)).toBe('cases');
});

test('有分配權限的護理師：案件分配頁列出待分配與已分配案件', async ({ page }) => {
  await login(page, 'nurse@example.com');
  await page.goto('/cases.html?view=assign');
  await expect(page.getByRole('heading', { name: '案件分配' })).toBeVisible();
  await expect(page.locator('#assignDone tbody tr').filter({ hasText: 'T-A' })).toContainText('黃護理師');
  /* 案件階段由伺服器端（Edge Function case-phases）計算，與原型相同 */
  await expect(page.locator('#assignDone tbody tr').filter({ hasText: 'T-B' })).toContainText('評估中');
  await expect(page.locator('#assignDone tbody tr').filter({ hasText: 'T-D' })).toContainText('摘要卡已開放');
  await expect(page.locator('#phaseErr')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('無法取得');
  expect(await currentTab(page)).toBe('assign');
});

test('護理師打開案件詳情、管理員打開 cases.html：沒有權限或轉到系統管理', async ({ page }) => {
  await login(page, 'nurse@example.com');
  await page.goto('/cases.html');
  await expect(page.getByRole('heading', { name: '沒有權限' })).toBeVisible();
  await page.getByRole('button', { name: '登出' }).click();
  await login(page, 'admin@example.com');
  await page.goto('/cases.html');
  await expect(page).toHaveURL(/settings\.html\?view=archive$/);
});
