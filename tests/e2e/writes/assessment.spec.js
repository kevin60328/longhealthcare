/* 階段 7：assessment.html 寫入流程（畫面操作）。
 *   護理從工作清單進入住民資料 → 照護文件需求判斷（需要 → 系統自動補件）→ 出院摘要逐欄核對（快捷鍵確認、診斷依標點拆分逐筆確認、
 *   一筆標示不採用、儲存草稿後重新整理仍保留）→ 完成核對 → 診斷清單出現逐筆診斷 → 習慣卡初審 → 評估頁前置條件說明
 * 用暫時家屬帳號（e2e-…@example.com）提出申請；檔案上傳、行政收件用 RPC（階段 6 已測過畫面）。 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { login, service, env } from '../helpers.js';

const PW = 'Temp-pass-0001';
const IMG = readFileSync('reference/sample_docs/03_出院病歷摘要_張秀英.png');
test.describe.configure({ mode: 'serial' });

async function readyCase(){
  const email = `e2e-c7-${Date.now()}@example.com`, opts = { auth: { persistSession: false } };
  const { data: u, error: ue } = await service().auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { name: '核對家屬', phone: '0912000888', want: 'family' } });
  if (ue) throw ue;
  const fam = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, opts), staff = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, opts);
  await fam.auth.signInWithPassword({ email, password: PW });
  await staff.auth.signInWithPassword({ email: 'staff@example.com', password: env.SEED_PASSWORD });
  const r = await fam.rpc('create_application', { p_token: 'e2e7-' + Date.now(), p_name: '核對住民', p_nid: 'Y9' + String(Date.now()).slice(-8), p_birth: '1940-06-12', p_relation: '女兒', p_hospital: '', p_admit: '2026-12-29' });
  if (r.error) throw r.error;
  const caseId = r.data.case_id;
  for (const x of [await staff.rpc('confirm_case', { p_case: caseId, p_called: true, p_chart: '', p_admit: '2026-12-29' }),
    await fam.rpc('sign_consent', { p_case: caseId, p_signer: '本人', p_signer_name: '核對家屬', p_agree: true, p_photo: false, p_emergency: false })]) if (x.error) throw x.error;
  const { data: nurse } = await service().from('profiles').select('id').eq('email', 'nurse@example.com').single();
  const { data: st } = await service().from('profiles').select('id').eq('email', 'staff@example.com').single();
  await service().from('case_assignments').insert({ case_id: caseId, nurse_id: nurse.id, by: st.id, at: new Date().toISOString() });
  const docs = Object.fromEntries((await service().from('documents').select('id, key').eq('case_id', caseId)).data.map(d => [d.key, d.id]));
  /* 家屬上傳出院摘要、行政收件 → 待護理核對 */
  const path = `${caseId}/summary/v1-${crypto.randomUUID()}.png`;
  let x = await fam.storage.from('case-files').upload(path, IMG, { contentType: 'image/png' }); if (x.error) throw x.error;
  x = await fam.rpc('submit_version', { p_doc: docs.summary, p_path: path, p_file_name: '出院摘要.png', p_user_date: null }); if (x.error) throw x.error;
  x = await staff.rpc('staff_receipt', { p_doc: docs.summary, p_v: 1, p_how: '必要欄位全部相符', p_detail: {} }); if (x.error) throw x.error;
  /* 家屬正式提交習慣卡（習慣卡畫面在階段 4 已測過） */
  x = await service().from('habit_submissions').insert({ case_id: caseId, rev: 1, n: 1, data: { call: '阿嬤', lang: ['台語'], hearing: '聽力正常', famAllergy: '無' }, submitted_by: u.user.id }); if (x.error) throw x.error;
  return { caseId, docs, no: r.data.no };
}

test('護理：需求判斷 → 出院摘要逐欄核對（診斷逐筆）→ 完成 → 診斷清單 → 習慣卡初審 → 評估前置條件', async ({ page }) => {
  const f = await readyCase();
  await login(page, 'nurse@example.com');
  const folder = page.locator('details.folder').filter({ hasText: f.no });
  await folder.locator(':scope > summary').click();
  await folder.locator('.task').filter({ hasText: '照護文件需求確認' }).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`assessment\\.html\\?case=${f.caseId}&from=home`));
  await expect(page.getByRole('heading', { name: '核對住民' })).toBeVisible();
  expect(await page.locator('nav.subnav [aria-current="page"]').getAttribute('data-tab')).toBe('home');

  /* 照護文件需求確認：管路照護資料 → 本案需要 → 系統自動建立補件 */
  await page.locator('#needCard tr').filter({ hasText: '管路留置與照護紀錄' }).getByRole('button', { name: '判斷' }).click();
  await page.locator('label.choice').filter({ hasText: '本案需要' }).locator('input').check();
  await page.locator('#needNote').fill('出院摘要記載有鼻胃管');
  await page.getByRole('button', { name: '儲存' }).click();
  await expect(page.locator('.toast')).toContainText('系統已自動建立補件要求並通知家屬');
  await expect(page.locator('#needCard tr').filter({ hasText: '管路留置與照護紀錄' })).toContainText('護理已確認：需要');

  /* 出院摘要核對（與原型相同，從工作清單進入）：看得到原始圖片 */
  await page.goto('/dashboard.html');
  const fd = page.locator('details.folder').filter({ hasText: f.no });
  if (!(await fd.getAttribute('open') !== null)) await fd.locator(':scope > summary').click();
  await fd.locator('.task').filter({ hasText: '文件核對' }).filter({ hasText: '出院病歷摘要' }).getByRole('link').click();
  expect(await page.locator('nav.subnav [aria-current="page"]').getAttribute('data-tab')).toBe('home');
  await expect(page.getByRole('heading', { name: '文件核對：核對住民｜出院病歷摘要／近期就醫摘要' })).toBeVisible();
  await expect(page.locator('.doc img')).toBeVisible();
  await expect(page.locator('[data-act="review-done"]')).toBeDisabled();
  const fld = k => page.locator(`[data-field="${k}"]`);
  await fld('stype').getByRole('button', { name: '門診／近期醫療摘要' }).click();
  await expect(fld('stype')).toContainText('✓ 已確認');
  await expect(page.locator('.field').filter({ hasText: '出院日期' })).toContainText('不適用');
  /* 主要診斷：輸入原文 → 依標點拆成多筆 → 逐筆確認、一筆標示不採用 */
  await page.getByLabel('原始診斷文字').fill('高血壓、糖尿病、高血壓');
  await page.getByRole('button', { name: '依標點拆成多筆建議' }).click();
  await expect(page.locator('tr.dxr')).toHaveCount(2);         // 重複的「高血壓」不重複加入
  await page.getByRole('button', { name: '手動新增一筆' }).click();
  await expect(page.locator('tr.dxr')).toHaveCount(3);
  await page.locator('tr.dxr').nth(2).getByRole('button', { name: 'OCR 錯誤／不採用' }).click();
  await page.getByRole('button', { name: '標示不採用' }).click();
  await expect(page.locator('tr.dxr').nth(2)).toHaveAttribute('data-state', '不採用');
  await page.locator('tr.dxr').nth(0).getByRole('button', { name: '確認' }).click();
  await expect(page.locator('tr.dxr').nth(0)).toHaveAttribute('data-state', '已確認');
  /* 儲存草稿後重新整理：輸入與確認狀態都還在 */
  await page.getByRole('button', { name: '儲存草稿' }).click();
  await expect(page.locator('#draftState')).toContainText('草稿已儲存');
  await page.reload();
  await expect(page.locator('tr.dxr').nth(0)).toHaveAttribute('data-state', '已確認');
  await expect(fld('stype')).toContainText('✓ 已確認');
  await page.locator('tr.dxr').nth(1).getByRole('button', { name: '確認' }).click();
  await expect(page.locator('#dxField')).toContainText('診斷已確認 2／2 項');
  await fld('tube').getByRole('button', { name: '無', exact: true }).click();
  await fld('allergy').getByRole('button', { name: '無已知過敏' }).click();
  await fld('wound').getByRole('button', { name: '無', exact: true }).click();
  await expect(page.locator('[data-act="review-done"]')).toBeEnabled();
  await page.locator('[data-act="review-done"]').click();
  await expect(page).toHaveURL(/dashboard\.html$/);
  await expect(page.locator('.toast')).toContainText('核對完成');

  /* 住民資料：已確認的診斷、診斷清單逐筆 */
  await page.goto(`/assessment.html?case=${f.caseId}`);
  await expect(page.locator('#sec-med')).toContainText('高血壓、糖尿病');
  await expect(page.locator('#dxRows tr')).toHaveCount(2);
  await expect(page.locator('#dxRows')).toContainText('出院病歷摘要／近期就醫摘要（第 1 版）');
  expect(await page.locator('nav.subnav [aria-current="page"]').getAttribute('data-tab')).toBe('residents');

  /* 評估頁：習慣卡尚未初審 → 不能評估 */
  await page.goto(`/assessment.html?view=assess&case=${f.caseId}`);
  await expect(page.locator('#assessHabitBlock')).toContainText('尚未完成必要初審');

  /* 習慣卡初審：審核完成 */
  await page.goto(`/assessment.html?case=${f.caseId}`);
  await expect(page.locator('#habitReview')).toContainText('待審核');
  await page.getByRole('button', { name: '確認習慣卡審核完成' }).click();
  await expect(page.locator('.toast')).toHaveText('已完成習慣卡審核');
  await expect(page.locator('#habitReview')).toContainText('審核完成');

  /* 評估頁：習慣卡通過，但必要文件尚未齊全 → 說明原因 */
  await page.goto(`/assessment.html?view=assess&case=${f.caseId}`);
  await expect(page.locator('main')).toContainText('目前不能評估');
  await expect(page.locator('main')).toContainText('必要文件全部確認符合後，才能進行評估');
});
