/* 階段 7：assessment.html 只讀的檢查（負責住民、住民資料、核對頁、各角色權限）。會寫入資料的流程在 writes/assessment.spec.js。 */
import { test, expect } from '@playwright/test';
import { login, currentTab, service } from './helpers.js';

const caseIdOf = async no => (await service().from('cases').select('id').eq('no', no).single()).data.id;
const docIdOf = async (no, key) => (await service().from('documents').select('id').eq('case_id', await caseIdOf(no)).eq('key', key).single()).data.id;

test('護理：負責住民列出承辦案件與待核對文件；住民資料各區塊', async ({ page }) => {
  await login(page, 'nurse@example.com');
  await page.getByRole('link', { name: '負責住民' }).click();
  await expect(page.getByRole('heading', { name: '負責住民' })).toBeVisible();
  expect(await currentTab(page)).toBe('residents');
  const row = page.locator('#resRows tr').filter({ hasText: '待核對' }).first();
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: '查看' }).click();
  await expect(page).toHaveURL(/assessment\.html\?case=/);
  for (const id of ['#sec-info', '#sec-med', '#sec-dx', '#sec-docs', '#sec-habit']) await expect(page.locator(id)).toBeVisible();
  await expect(page.locator('#sec-docs')).not.toContainText('住民身分證明文件');   // 身分類文件由行政處理，護理端不顯示
  expect(await currentTab(page)).toBe('residents');
});

test('護理核對頁（T-A 出院摘要，只查看不寫入）：欄位、必須逐項確認、完成核對在全部確認前不能按', async ({ page }) => {
  const item = await docIdOf('T-A', 'summary');
  await login(page, 'nurse@example.com');
  await page.goto(`/assessment.html?view=review&item=${item}&from=home`);
  await expect(page.getByRole('heading', { name: /^文件核對：.*｜出院病歷摘要/ })).toBeVisible();
  await expect(page.locator('#dxField')).toContainText('主要診斷（逐筆核對）');
  await expect(page.locator('[data-field="tube"]')).toContainText('必須逐項確認');
  await expect(page.locator('[data-act="review-done"]')).toBeDisabled();
  await expect(page.locator('#draftState')).toBeVisible();
  expect(await currentTab(page)).toBe('home');
});

test('權限：不是承辦護理師看不到住民資料；行政、家屬不能進入；評估頁說明前置條件', async ({ page }) => {
  const ta = await caseIdOf('T-A');
  await login(page, 'nurse2@example.com');
  await page.goto(`/assessment.html?case=${ta}`);
  await expect(page.getByRole('heading', { name: '找不到這位住民' })).toBeVisible();
  await page.getByRole('button', { name: '登出' }).click();
  await login(page, 'staff@example.com');
  await page.goto(`/assessment.html?case=${ta}`);
  await expect(page.getByRole('heading', { name: '沒有權限' })).toBeVisible();
  await page.getByRole('button', { name: '登出' }).click();
  await login(page, 'nurse@example.com');
  await page.goto(`/assessment.html?view=assess&case=${ta}`);
  await expect(page.getByRole('heading', { name: '目前不能評估' })).toBeVisible();
});
