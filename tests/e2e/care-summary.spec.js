/* 階段 8：care-summary.html 只讀的檢查（照服員看 T-D 摘要卡、語言切換、沒開放給自己的看不到；護理的摘要卡管理頁）。
 * 會寫入資料的流程（開放、停用）在 writes/care-summary.spec.js。 */
import { test, expect } from '@playwright/test';
import { login, currentTab, service } from './helpers.js';

const caseIdOf = async no => (await service().from('cases').select('id').eq('no', no).single()).data.id;

test('照服員：住民清單 → 看 T-D 摘要卡（區塊 A、B、來源標籤）；切換印尼文、越南文欄位標題並標示未經母語人士確認', async ({ page }) => {
  await login(page, 'care@example.com');
  await page.locator('.task').filter({ hasText: '吳月娥' }).getByRole('link', { name: '看摘要卡' }).click();
  await expect(page).toHaveURL(/care-summary\.html\?case=/);
  await expect(page.getByRole('heading', { name: '照顧摘要卡：吳月娥' })).toBeVisible();
  await expect(page.locator('main')).toContainText('A. 健康與照護重點');
  await expect(page.locator('main')).toContainText('B. 生活與個人偏好（家屬提供之生活資訊）');
  await expect(page.locator('.cblock[data-k="call"]')).toContainText('月娥阿姨');
  await expect(page.locator('.src.fam').first()).toHaveText('家屬提供');
  await page.getByRole('button', { name: 'Bahasa' }).click();
  await expect(page.getByRole('heading', { name: 'Kartu ringkasan perawatan：吳月娥' })).toBeVisible();
  await expect(page.locator('#langNote')).toContainText('尚未經母語人士確認');
  await expect(page.locator('.cblock[data-k="allergy"] .cl small')).toHaveText('過敏');
  await page.getByRole('button', { name: 'Tiếng Việt' }).click();
  await expect(page.getByRole('heading', { name: 'Thẻ tóm tắt chăm sóc：吳月娥' })).toBeVisible();
  await expect(page.locator('main')).toContainText('內容只能查看，不能修改');
  await expect(page.locator('main textarea, main input')).toHaveCount(0);
  expect(await currentTab(page)).toBe('home');
});

test('沒有開放給自己的照服員看不到；行政、家屬不能進入摘要卡頁', async ({ page }) => {
  const td = await caseIdOf('T-D');
  await login(page, 'care2@example.com');
  await expect(page.locator('main')).not.toContainText('吳月娥');
  await page.goto(`/care-summary.html?case=${td}`);
  await expect(page.getByRole('heading', { name: '找不到這張摘要卡' })).toBeVisible();
  await page.getByRole('button', { name: '登出' }).click();
  await login(page, 'staff@example.com');
  await page.goto(`/care-summary.html?case=${td}`);
  await expect(page.getByRole('heading', { name: '沒有權限' })).toBeVisible();
});

test('護理：已開放的摘要卡管理頁（狀態、開放給誰、修訂與停用按鈕）', async ({ page }) => {
  await login(page, 'nurse@example.com');
  await page.goto(`/care-summary.html?case=${await caseIdOf('T-D')}`);
  await expect(page.getByRole('heading', { name: '照顧摘要卡：吳月娥' })).toBeVisible();
  await expect(page.locator('#cardBox')).toContainText('第 1 版');
  await expect(page.locator('#cardBox')).toContainText('已開放');
  await expect(page.getByRole('button', { name: '修訂內容（產生新版本）' })).toBeVisible();
  await expect(page.getByRole('button', { name: '停用摘要卡' })).toBeVisible();
  expect(await currentTab(page)).toBe('residents');
});
