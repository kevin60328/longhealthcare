/* 階段 6：documents.html 寫入流程（畫面操作）。
 *   1. 家屬上傳身分證明 → 行政從工作清單收件核對（出生日期民國年換算）→ 行政要求補件 → 補件 Email 模擬寄送 → 家屬看到補件進度與 Email 狀態
 *   2. 家屬上傳體檢報告並填日期 → 行政收件核對 → 核對日期（確認過期）→ 補件追蹤列出、再次提醒
 * 用暫時家屬帳號（e2e-…@example.com）提出申請；上傳 reference/sample_docs 的模擬文件圖片。測試結束後自動清除（含檔案）。 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { login, service, env } from '../helpers.js';

const PW = 'Temp-pass-0001';
const ID_IMG = 'reference/sample_docs/01_身分證影本_張秀英.png', EXAM_IMG = 'reference/sample_docs/08_體檢報告_張秀英.png';
test.describe.configure({ mode: 'serial' });
let n = 0;
/* 暫時家屬提出申請、行政確認、家屬簽同意書（這些畫面在階段 4、5 已測過，這裡直接呼叫 RPC） */
async function readyCase(){
  const email = `e2e-c6-${Date.now()}-${++n}@example.com`, opts = { auth: { persistSession: false } };
  const { error: ue } = await service().auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { name: '文件家屬' + n, phone: '0912000' + String(700 + n), want: 'family' } });
  if (ue) throw ue;
  const fam = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, opts), staff = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, opts);
  await fam.auth.signInWithPassword({ email, password: PW });
  await staff.auth.signInWithPassword({ email: 'staff@example.com', password: env.SEED_PASSWORD });
  const r = await fam.rpc('create_application', { p_token: 'e2e6-' + Date.now() + n, p_name: '文件住民' + n, p_nid: 'Y8' + String(Date.now() * 10 + n).slice(-8), p_birth: '1939-09-09', p_relation: '女兒', p_hospital: '仁心醫院', p_admit: '2026-12-29' });
  if (r.error) throw r.error;
  const c1 = await staff.rpc('confirm_case', { p_case: r.data.case_id, p_called: true, p_chart: '', p_admit: '2026-12-29' }); if (c1.error) throw c1.error;
  const c2 = await fam.rpc('sign_consent', { p_case: r.data.case_id, p_signer: '本人', p_signer_name: '文件住民' + n, p_agree: true, p_photo: false, p_emergency: false }); if (c2.error) throw c2.error;
  const docs = Object.fromEntries((await service().from('documents').select('id, key').eq('case_id', r.data.case_id)).data.map(d => [d.key, d.id]));
  return { email, caseId: r.data.case_id, no: r.data.no, name: '文件住民' + n, docs };
}

test('家屬上傳 → 行政收件核對 → 要求補件 → Email 模擬寄送 → 家屬看到補件進度', async ({ page }) => {
  const f = await readyCase();
  /* 家屬：從案件首頁「目前要做的事」上傳住民身分證明文件 */
  await login(page, f.email, { password: PW });
  await page.goto('/application.html?case=' + f.caseId);
  await page.locator('#todoHero .todo').filter({ hasText: '住民身分證明文件' }).getByRole('link', { name: '上傳' }).click();
  await expect(page.getByRole('heading', { name: '上傳：住民身分證明文件' })).toBeVisible();
  await page.getByRole('button', { name: '送出' }).click();
  await expect(page.locator('#upErr')).toHaveText('請先選擇照片或 PDF');
  await page.locator('#file').setInputFiles(ID_IMG);
  await expect(page.locator('#picked')).toContainText('01_身分證影本_張秀英.png');
  await page.getByRole('button', { name: '送出' }).click();
  await expect(page.getByRole('heading', { name: '已上傳「住民身分證明文件」，等待本中心審核' })).toBeVisible();
  await page.getByRole('link', { name: '回到首頁' }).click();
  await expect(page.locator('#grpWait')).toContainText('住民身分證明文件');

  /* 行政：工作清單 → 收件核對；看得到原始圖片；出生日期用民國年輸入，系統換算後比對一致 */
  await page.getByRole('button', { name: '登出' }).click();
  await login(page, 'staff@example.com');
  const folder = page.locator('details.folder').filter({ hasText: f.no });
  await folder.locator(':scope > summary').click();
  await folder.locator('.task').filter({ hasText: '收件核對' }).filter({ hasText: '住民身分證明文件' }).getByRole('link').click();
  await expect(page.getByRole('heading', { name: `收件核對：${f.name}｜住民身分證明文件` })).toBeVisible();
  await expect(page.locator('.doc img')).toBeVisible();
  expect(await page.locator('nav.subnav [aria-current="page"]').getAttribute('data-tab')).toBe('home');
  await page.getByLabel('姓名比對結果').selectOption('相符');
  await page.getByLabel('身分證字號比對結果').selectOption('相符');
  await page.locator('#birthRaw').fill('民國 28 年 9 月 9 日');
  await expect(page.locator('#birthCmp')).toContainText('出生日期：1939/09/09');
  await expect(page.locator('#birthCmp .pill')).toHaveText('一致');
  await page.getByRole('button', { name: `確認是${f.name}的資料` }).click();
  await expect(page.locator('#rcErr')).toHaveText('請確認影本清楚、內容完整');
  await page.locator('input[name=content]').check();
  await page.getByRole('button', { name: `確認是${f.name}的資料` }).click();
  await expect(page).toHaveURL(/dashboard\.html$/);
  await expect(page.locator('.toast')).toHaveText('已確認，文件完成');

  /* 行政：案件頁 → 要求補件（住民身分證明文件、清單外的其他資料）→ 補件 Email 模擬寄送 */
  await page.goto('/cases.html?case=' + f.caseId);
  await expect(page.locator('#docTable tr').filter({ hasText: '住民身分證明文件' })).toContainText('確認符合');
  await page.getByRole('link', { name: '要求補件' }).click();
  await expect(page.getByRole('heading', { name: `要求家屬補件：${f.name}` })).toBeVisible();
  await expect(page.locator('label.choice').filter({ hasText: '管路留置' }).locator('input')).toBeDisabled();
  await page.locator('label.choice').filter({ hasText: '住民身分證明文件' }).locator('input').check();
  await page.locator('#srOther').fill('疫苗接種紀錄');
  await page.locator('#srReason').selectOption('影本不清楚');
  await page.locator('#srNote').fill('請拍清楚一點');
  await page.getByRole('button', { name: '送出補件要求' }).click();
  await expect(page).toHaveURL(new RegExp(`cases\\.html\\?case=${f.caseId}$`));
  await expect(page.locator('.toast')).toHaveText('已送出補件要求');
  const card = page.locator('#reqMailCard');
  await expect(card).toBeVisible();
  await expect(card.locator('tr[data-mail]')).toHaveCount(2);
  for (const t of await card.locator('tr[data-mail] .pill').allInnerTexts()) expect(t).toBe('模擬已寄送（測試環境未實際寄出）');
  await expect(page.locator('#docTable tr').filter({ hasText: '住民身分證明文件' })).toContainText('需補件');
  await expect(page.locator('#docTable tr').filter({ hasText: '疫苗接種紀錄' })).toContainText('個案新增');

  /* 家屬：補件進度列出正式補件與 Email 狀態；身分證明文件要重新上傳 */
  await page.getByRole('button', { name: '登出' }).click();
  await login(page, f.email, { password: PW });
  await page.goto('/application.html?case=' + f.caseId);
  const rq = page.locator('#reqCard .todo').filter({ hasText: '住民身分證明文件' });
  await expect(rq).toContainText('原因：影本不清楚（請拍清楚一點）');
  await expect(rq).toContainText('Email 通知：模擬已寄送（測試環境未實際寄出）');
  await expect(page.locator('#todoHero .todo').filter({ hasText: '住民身分證明文件' })).toContainText('需要重新上傳：影本不清楚（請拍清楚一點）');
});

test('體檢報告：家屬填檢查日期 → 行政收件 → 核對日期（確認過期）→ 補件追蹤與再次提醒', async ({ page }) => {
  const f = await readyCase();
  await login(page, f.email, { password: PW });
  await page.goto(`/documents.html?view=upload&case=${f.caseId}&item=${f.docs.exam}`);
  await expect(page.getByRole('heading', { name: '上傳：入住前健康檢查報告' })).toBeVisible();
  await page.locator('#file').setInputFiles(EXAM_IMG);
  await page.locator('#examDate').fill('2026-09-01');
  await page.locator('#examDate').dispatchEvent('change');
  await expect(page.locator('#dateHint')).toContainText('超過 90 天的規定');
  await page.getByRole('button', { name: '送出' }).click();
  await expect(page.getByRole('heading', { name: /已上傳「入住前健康檢查報告」/ })).toBeVisible();

  await page.getByRole('button', { name: '登出' }).click();
  await login(page, 'staff@example.com');
  await page.goto(`/documents.html?view=receipt&item=${f.docs.exam}&from=case`);
  await expect(page.getByRole('heading', { name: `收件核對：${f.name}｜入住前健康檢查報告` })).toBeVisible();
  expect(await page.locator('nav.subnav [aria-current="page"]').getAttribute('data-tab')).toBe('cases');
  await page.getByLabel('姓名比對結果').selectOption('相符');
  await page.getByLabel('身分證字號比對結果').selectOption('相符');
  await page.locator('#birthRaw').fill('1939/09/09');
  await page.getByRole('button', { name: `確認是${f.name}的資料` }).click();
  await expect(page).toHaveURL(new RegExp(`cases\\.html\\?case=${f.caseId}$`));
  await expect(page.locator('.toast')).toHaveText('已確認，文件已交給下一步處理');
  await expect(page.locator('#docTable tr').filter({ hasText: '入住前健康檢查報告' })).toContainText('疑似過期');

  /* 核對日期：系統只是初步判斷；日期在期限前 → 確認過期，系統建立補件並寄 Email */
  await page.goto(`/documents.html?view=date&item=${f.docs.exam}&from=case`);
  await expect(page.getByRole('heading', { name: `核對日期：${f.name}｜入住前健康檢查報告` })).toBeVisible();
  await expect(page.locator('main')).toContainText('家屬填寫的日期：2026/09/01');
  await expect(page.locator('#ocrBtn')).toBeVisible();      // 圖片可以用 AI 讀日期（這裡不實際呼叫，避免費用）
  await page.locator('#dateVal').fill('2026-09-01');
  await page.getByRole('button', { name: '確認日期' }).click();
  await expect(page).toHaveURL(new RegExp(`cases\\.html\\?case=${f.caseId}$`));
  await expect(page.locator('.toast')).toHaveText('已確認過期，系統已通知家屬');
  await expect(page.locator('#docTable tr').filter({ hasText: '入住前健康檢查報告' })).toContainText('確認過期');
  await expect(page.locator('#reqMailCard tr[data-mail]').filter({ hasText: '入住前健康檢查報告' })).toContainText('日期超過期限');

  /* 補件追蹤（與原型 followupRows 相同）：只列「目前階段」的文件。先審後簽尚未簽約，入住前的體檢報告不列入；
   * 評估前的身分證明文件尚未上傳 → 首次繳交，可以再次提醒（只是提醒，不是補件） */
  await page.goto('/documents.html?view=followup&from=home');
  const mine = page.locator('#fuRows tr').filter({ hasText: f.name });
  await expect(mine.filter({ hasText: '住民身分證明文件' })).toContainText('首次繳交');
  await expect(mine.filter({ hasText: '入住前健康檢查報告' })).toHaveCount(0);
  await mine.filter({ hasText: '住民身分證明文件' }).getByRole('button', { name: '再次提醒' }).click();
  await expect(page.locator('.toast')).toHaveText('已通知家屬');
  await expect(page.locator('#fuRows tr').filter({ hasText: f.name }).filter({ hasText: '住民身分證明文件' })).toContainText('1 次');
});
