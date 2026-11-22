/* 階段 8：照顧摘要卡寫入流程（畫面操作），用種子案件 T-C（摘要卡待審核）。
 *   護理從工作清單「審核照顧摘要卡」→ 不選照服員擋下 → 選照服員開放 → 照服員看到 → 護理停用 → 照服員只看到「已停用」
 * 結束時刪除這次建立的摘要卡，T-C 回到原狀（其他測試與截圖對照需要）。 */
import { test, expect } from '@playwright/test';
import { login, service } from '../helpers.js';

test.describe.configure({ mode: 'serial' });
let C;
test.beforeAll(async () => { C = (await service().from('cases').select('id').eq('no', 'T-C').single()).data.id; });
test.afterAll(async () => {
  const svc = service(), ids = (await svc.from('care_cards').select('id').eq('case_id', C)).data.map(x => x.id);
  if (ids.length){ await svc.from('care_card_caregivers').delete().in('card_id', ids); await svc.from('care_cards').delete().in('id', ids); }
});

test('護理審核並開放 → 照服員看到 → 護理停用 → 照服員看到已停用', async ({ page }) => {
  await login(page, 'nurse@example.com');
  const folder = page.locator('details.folder').filter({ hasText: 'T-C' });
  if (await folder.getAttribute('open') === null) await folder.locator(':scope > summary').click();
  await folder.locator('.task').filter({ hasText: '審核照顧摘要卡' }).getByRole('link').click();
  await expect(page).toHaveURL(/care-summary\.html\?case=.*&from=home/);
  await expect(page.getByRole('heading', { name: '審核照顧摘要卡：張榮發' })).toBeVisible();
  expect(await page.locator('nav.subnav [aria-current="page"]').getAttribute('data-tab')).toBe('home');
  /* 區塊 A 由已確認資料帶入 */
  await expect(page.locator('textarea[name="dx"]')).not.toHaveValue('');
  await page.locator('textarea[name="risk"]').fill('夜間起身需陪同');
  await page.getByRole('button', { name: '確認並開放給照服員' }).click();
  await expect(page.locator('#cardErr')).toHaveText('請至少選一位照服員');
  const cgBox = page.locator('label.choice').filter({ has: page.locator('input[name=cg]') }).first();
  await cgBox.locator('input').check();
  const careName = (await cgBox.innerText()).trim();
  await page.getByRole('button', { name: '確認並開放給照服員' }).click();
  await expect(page).toHaveURL(/dashboard\.html$/);
  await expect(page.locator('.toast')).toHaveText('已開放給照服員');
  const { data: cg } = await service().from('profiles').select('email').eq('name', careName).single();

  /* 照服員看到摘要卡（含護理補充的照護提醒） */
  await page.getByRole('button', { name: '登出' }).click();
  await login(page, cg.email);
  await page.locator('.task').filter({ hasText: '張榮發' }).getByRole('link', { name: '看摘要卡' }).click();
  await expect(page.getByRole('heading', { name: '照顧摘要卡：張榮發' })).toBeVisible();
  await expect(page.locator('.cblock[data-k="risk"]')).toContainText('夜間起身需陪同');

  /* 護理停用 */
  await page.getByRole('button', { name: '登出' }).click();
  await login(page, 'nurse@example.com');
  await page.goto(`/care-summary.html?case=${C}`);
  await page.getByRole('button', { name: '停用摘要卡' }).click();
  await page.getByRole('button', { name: '停用', exact: true }).click();
  await expect(page.locator('#merr')).toHaveText('請填寫原因');
  await page.locator('#stNote').fill('住民轉院，內容需重新評估');
  await page.getByRole('button', { name: '停用', exact: true }).click();
  await expect(page.locator('.toast')).toHaveText('已停用');
  await expect(page.getByRole('button', { name: '重新開放' })).toBeVisible();

  await page.getByRole('button', { name: '登出' }).click();
  await login(page, cg.email);
  await page.goto(`/care-summary.html?case=${C}`);
  await expect(page.getByRole('heading', { name: '這張摘要卡已停用' })).toBeVisible();
  await expect(page.locator('main')).toContainText('住民轉院，內容需重新評估');
  await expect(page.locator('.cblock')).toHaveCount(0);
});
