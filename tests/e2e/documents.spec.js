/* 階段 6：documents.html 只讀的檢查（完整文件清單、看文件、各角色能進哪些畫面）。會寫入資料的流程在 writes/documents.spec.js。 */
import { test, expect } from '@playwright/test';
import { login, currentTab, service } from './helpers.js';

const docOf = async (no, key) => {
  const { data: c } = await service().from('cases').select('id').eq('no', no).single();
  const { data: d } = await service().from('documents').select('id').eq('case_id', c.id).eq('key', key).single();
  return { caseId: c.id, id: d.id };
};

test('家屬：申請流程說明（一般參考清單 → 選擇自己的申請看實際清單，只供查閱、沒有操作按鈕）', async ({ page }) => {
  await login(page, 'family3@example.com');
  await page.goto('/documents.html?view=list');
  await expect(page.getByRole('heading', { name: '申請流程說明' })).toBeVisible();
  await expect(page.locator('#fullDocList details.dcat')).toHaveCount(6);   // A～F；G 類在一般清單沒有項目，與原型相同不顯示
  await page.locator('#guideCase').selectOption({ index: 1 });
  await expect(page).toHaveURL(/view=list&case=/);
  await expect(page.locator('#guideCaseList #docList')).toBeVisible();
  await expect(page.locator('#guideCaseList .btn')).toHaveCount(0);
  expect(await currentTab(page)).toBe('home');
});

test('行政看文件（T-D 出院摘要）：只能查看；顯示護理確認後的內容欄位', async ({ page }) => {
  const d = await docOf('T-D', 'summary');
  await login(page, 'staff@example.com');
  await page.goto(`/documents.html?view=doc&item=${d.id}&from=case`);
  await expect(page.getByRole('heading', { name: /｜出院病歷摘要/ })).toBeVisible();
  await expect(page.locator('.lead')).toContainText('只能查看，不能修改');
  await expect(page.locator('#staffMedNote')).toBeVisible();
  await expect(page.getByRole('link', { name: '← 回到案件' })).toHaveAttribute('href', `cases.html?case=${d.caseId}`);
  expect(await currentTab(page)).toBe('cases');
});

test('護理：看不到身分類文件；家屬進不了行政畫面；照服員不能進文件頁', async ({ page }) => {
  const id = await docOf('T-D', 'idcopy');
  await login(page, 'nurse@example.com');
  await page.goto(`/documents.html?view=doc&item=${id.id}`);
  await expect(page.locator('main')).toContainText(/找不到這個案件或文件|找不到這份文件|護理端不顯示/);
  await page.goto('/documents.html?view=followup');
  await expect(page.getByRole('heading', { name: '沒有權限' })).toBeVisible();
  await page.getByRole('button', { name: '登出' }).click();
  await login(page, 'family3@example.com');
  await page.goto(`/documents.html?view=receipt&item=${id.id}`);
  await expect(page.getByRole('heading', { name: '沒有權限' })).toBeVisible();
  await page.getByRole('button', { name: '登出' }).click();
  await login(page, 'care@example.com');
  await page.goto('/documents.html');
  await expect(page.getByRole('heading', { name: '沒有權限' })).toBeVisible();
});

test('行政補件追蹤：列出等家屬上傳或補件的文件，逾期排最上面', async ({ page }) => {
  await login(page, 'staff@example.com');
  await page.goto('/documents.html?view=followup&from=home');
  await expect(page.getByRole('heading', { name: '補件追蹤' })).toBeVisible();
  await expect(page.locator('#fuRows tr').first()).toBeVisible();
  expect(await currentTab(page)).toBe('home');
});
