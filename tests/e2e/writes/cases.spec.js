/* 階段 5：cases.html 寫入流程（行政確認轉交 → 護理分配 → 參訪 → 協調 → 簽約 → 結案）。
 * 用暫時家屬帳號提出申請；結束時案件結案、帳號停用。 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { login, service, env } from '../helpers.js';

const PW = 'Temp-pass-0001';
const users = [];
test.describe.configure({ mode: 'serial' });
test.afterAll(async () => {
  const svc = service();
  for (const id of users){
    await svc.from('cases').update({ closed_at: new Date().toISOString(), closed_title: '測試結束', closed_reason: '自動測試建立的案件' }).eq('family_id', id).is('closed_at', null);
    await svc.from('profiles').update({ status: '停用' }).eq('id', id);
  }
});
let n = 0;
/* 暫時家屬直接呼叫 RPC 提出申請（申請畫面在階段 4 已測過） */
async function familyCase({ phone = '0912000666', name } = {}){
  const email = `e2e-c5-${Date.now()}-${++n}@example.com`;
  const { data, error } = await service().auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { name: name || '流程家屬' + n, phone, want: 'family' } });
  if (error) throw error;
  users.push(data.user.id);
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await db.auth.signInWithPassword({ email, password: PW });
  const r = await db.rpc('create_application', { p_token: 'e2e5-' + Date.now() + n, p_name: '流程住民' + n, p_nid: 'Y2' + String(Date.now() * 10 + n).slice(-8), p_birth: '1939-09-09', p_relation: '女兒', p_hospital: '', p_admit: '2026-12-29' });
  if (r.error) throw r.error;
  return { db, email, caseId: r.data.case_id, no: r.data.no, name: '流程住民' + n };
}

test('行政從工作清單確認申請 → 護理分配 → 行政登錄參訪 → 家屬看到參訪預約', async ({ page }) => {
  const f = await familyCase();
  await login(page, 'staff@example.com');
  const folder = page.locator('details.folder').filter({ hasText: f.no });
  await folder.locator(':scope > summary').click();
  await folder.getByRole('link', { name: '確認申請' }).click();
  await expect(page).toHaveURL(new RegExp(`view=confirm&case=${f.caseId}`));
  await expect(page.getByRole('heading', { name: `確認新申請：${f.name}` })).toBeVisible();
  expect(await page.locator('nav.subnav [aria-current="page"]').getAttribute('data-tab')).toBe('home');
  await page.getByRole('button', { name: '確認申請並轉交護理部門' }).click();
  await expect(page.locator('#acErr')).toHaveText('請先電話確認申請人身分與關係');
  await page.locator('input[name=called]').check();
  await page.locator('input[name=chart]').fill('H-777');
  await page.getByRole('button', { name: '確認申請並轉交護理部門' }).click();
  await expect(page).toHaveURL(/dashboard\.html$/);
  await expect(page.locator('.toast')).toHaveText('已確認並轉交護理部門，家屬會收到系統通知');

  /* 護理分配 */
  await page.getByRole('button', { name: '登出' }).click();
  await login(page, 'nurse@example.com');
  await expect(page.locator('.notice.warn').filter({ hasText: '等待分配承辦護理師' })).toBeVisible();
  await page.goto('/cases.html?view=assign');
  const row = page.locator('#assignWait tr').filter({ hasText: f.no });
  await row.getByRole('button', { name: '指定承辦' }).click();
  await page.locator('#asNurse').selectOption({ label: '吳護理師' });
  await page.getByRole('button', { name: '指定', exact: true }).click();
  await expect(page.locator('.toast')).toHaveText('已指定承辦護理師');
  const done = page.locator('#assignDone tr').filter({ hasText: f.no });
  await expect(done).toContainText('吳護理師');
  await done.getByRole('button', { name: '更換承辦' }).click();
  await page.locator('#asNurse').selectOption({ label: '黃護理師' });
  await page.getByRole('button', { name: '更換', exact: true }).click();
  await expect(page.locator('#merr')).toHaveText('請填寫更換原因');
  await page.locator('#asReason').fill('吳護理師請假');
  await page.getByRole('button', { name: '更換', exact: true }).click();
  await expect(page.locator('.toast')).toHaveText('已更換承辦護理師');
  await expect(page.locator('#assignDone tr').filter({ hasText: f.no }).locator('details')).toContainText('吳護理師請假');

  /* 行政：案件頁看到分配歷程，登錄參訪 */
  await page.getByRole('button', { name: '登出' }).click();
  await login(page, 'staff@example.com');
  await page.goto(`/cases.html?case=${f.caseId}`);
  await expect(page.locator('#assignInfo')).toContainText('已分配');
  await expect(page.locator('#assignInfo')).toContainText('黃護理師');
  await page.getByRole('button', { name: '編輯' }).click();
  await page.locator('#vSt').selectOption('已預約');
  await page.getByRole('button', { name: '儲存' }).click();
  await expect(page.locator('#merr')).toHaveText('已預約時請填寫預定日期');
  await page.locator('#vDate').fill('2026-12-05');
  await page.locator('#vTime').fill('10:30');
  await page.getByRole('button', { name: '儲存' }).click();
  await expect(page.locator('#visitCard')).toContainText('2026/12/05 10:30');
  await expect(page.locator('#timeline')).toContainText('護理案件已分配');

  /* 家屬看到參訪預約 */
  await page.getByRole('button', { name: '登出' }).click();
  await login(page, f.email, { portal: 'applicant', password: PW });
  await page.goto(`/application.html?case=${f.caseId}`);
  await expect(page.locator('main')).toContainText('參訪預約：2026/12/05 10:30（已預約）');
});

test('協調（待協調 → 協調完成可以收治）→ 記錄簽約 → 結案', async ({ page }) => {
  const f = await familyCase();
  const { data: nurse } = await service().from('profiles').select('id').eq('email', 'nurse@example.com').single();
  await service().from('cases').update({ link_status: '已確認', confirmed_at: new Date().toISOString() }).eq('id', f.caseId);
  await f.db.rpc('sign_consent', { p_case: f.caseId, p_signer: '本人', p_signer_name: '流程住民', p_agree: true, p_photo: false, p_emergency: false });
  await service().from('assessments').insert({ case_id: f.caseId, mode: '收治評估', result: '待協調', reason: '需要氣墊床', by: nurse.id });
  await login(page, 'staff@example.com');
  await page.goto(`/cases.html?case=${f.caseId}`);
  await expect(page.locator('.hero.warn h2').first()).toHaveText('協調入住安排');
  await page.getByRole('button', { name: '協調完成，可以收治' }).click();
  await page.getByRole('button', { name: '確認', exact: true }).click();
  await expect(page.locator('#merr')).toHaveText('請填寫協調內容');
  await page.locator('#coNote').fill('家屬同意自費加裝氣墊床');
  await page.getByRole('button', { name: '確認', exact: true }).click();
  await expect(page.locator('.toast')).toHaveText('已記錄，等待家屬簽約');
  await expect(page.locator('.lead')).toContainText('已收治待簽約');
  await page.getByRole('button', { name: '家屬已簽約' }).click();
  await expect(page.locator('.toast')).toHaveText('已記錄入住契約');
  await expect(page.locator('main')).toContainText('已簽約（');
  await page.getByRole('button', { name: '結案（取消、轉介或撤回同意）' }).click();
  await page.locator('#ccType').selectOption('轉介其他機構');
  await page.locator('#ccNote').fill('家屬決定轉往鄰近機構');
  await page.getByRole('button', { name: '結案', exact: true }).click();
  await expect(page.locator('main')).toContainText('已結案：已協助轉介其他機構');
  const { data } = await service().from('notices').select('text').eq('case_id', f.caseId).order('at');
  expect(data.map(x => x.text)).toEqual(expect.arrayContaining(['好消息：協調完成，住民已通過評估，請來電預約參訪與簽約', '您的入住申請狀態已更新，請登入查看']));
});

test('利益衝突：申請人電話與行政相同 → 確認頁提示由其他同仁處理，不能確認', async ({ page }) => {
  const { data: sp } = await service().from('profiles').select('phone').eq('email', 'staff@example.com').single();
  const f = await familyCase({ phone: sp.phone });
  await login(page, 'staff@example.com');
  await page.goto(`/cases.html?view=confirm&case=${f.caseId}`);
  await expect(page.locator('.notice.bad')).toContainText('請由其他同仁處理：疑似利益衝突：申請人的電話與您的帳號電話相同');
  await page.locator('input[name=called]').check();
  await page.getByRole('button', { name: '確認申請並轉交護理部門' }).click();
  await expect(page.locator('#acErr')).toContainText('請由其他同仁處理');
});

test('不受理申請：家屬看到結案說明', async ({ page }) => {
  const f = await familyCase();
  await login(page, 'staff@example.com');
  await page.goto(`/cases.html?view=confirm&case=${f.caseId}`);
  await page.getByRole('button', { name: '無法確認身分或不受理' }).click();
  await page.locator('#rjNote').fill('多次電話聯絡不到申請人');
  await page.getByRole('button', { name: '不受理', exact: true }).click();
  await expect(page).toHaveURL(/dashboard\.html$/);
  await page.getByRole('button', { name: '登出' }).click();
  await login(page, f.email, { portal: 'applicant', password: PW });
  await page.goto(`/application.html?case=${f.caseId}`);
  await expect(page.locator('.hero.bad h2')).toHaveText('機構無法受理這次申請');
  await expect(page.locator('.hero.bad')).toContainText('多次電話聯絡不到申請人');
});
