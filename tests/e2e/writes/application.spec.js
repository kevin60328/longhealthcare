/* 階段 4：application.html 端到端（會寫入資料，排在其他 E2E 之後執行，見 playwright.config.js 的 writes 專案）。
 * 用暫時家屬帳號；建立的案件在結束時結案、帳號停用（有操作紀錄的案件依規則不能刪除）。 */
import { test, expect } from '@playwright/test';
import { login, service } from '../helpers.js';

const PW = 'Temp-pass-0001';
const users = [];
test.describe.configure({ mode: 'serial' });

async function tempFamily(tag){
  const email = `e2e-ui-${tag}-${Date.now()}@example.com`;
  const { data, error } = await service().auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { name: '介面測試' + tag, phone: '0912000333', want: 'family' } });
  if (error) throw error;
  users.push(data.user.id);
  return { id: data.user.id, email };
}
test.afterAll(async () => {
  const svc = service();
  for (const id of users){
    await svc.from('cases').update({ closed_at: new Date().toISOString(), closed_title: '測試結束', closed_reason: '自動測試建立的案件' }).eq('family_id', id).is('closed_at', null);
    await svc.from('profiles').update({ status: '停用' }).eq('id', id);
  }
});
let n = 0;
const nid = () => 'Z2' + String(Date.now() * 10 + (++n)).slice(-8);
async function fillApply(page, v){
  await page.getByLabel('預計入住者姓名').fill(v.name);
  await page.getByLabel('預計入住者身分證字號').fill(v.nid);
  await page.getByLabel('預計入住者出生日期').fill(v.birth || '1938-05-06');
  await page.getByLabel('申請人與預計入住者的關係').selectOption(v.relation || '女兒');
  await page.getByLabel('預計入住日期').fill(v.admit || '2026-12-28');
}

test('家屬完整流程：申請 → 確認送出 → 已送出 → 行政確認 → 簽同意書 → 緊急聯絡人 → 習慣卡正式提交', async ({ page }) => {
  const fam = await tempFamily('flow'), id = nid();
  await login(page, fam.email, { portal: 'applicant', password: PW });
  await page.getByRole('link', { name: '開始入住申請' }).click();
  await expect(page).toHaveURL(/view=apply$/);

  /* 申請表：格式錯誤擋下，已填內容保留 */
  await fillApply(page, { name: '測試阿嬤', nid: 'A12' });
  await page.getByRole('button', { name: '下一步：確認申請資料' }).click();
  await expect(page.locator('#applyErr')).toContainText('身分證字號格式不正確');
  await expect(page.getByLabel('預計入住者姓名')).toHaveValue('測試阿嬤');
  await page.getByLabel('預計入住者身分證字號').fill(id);
  await page.getByRole('button', { name: '下一步：確認申請資料' }).click();
  await expect(page).toHaveURL(/view=preview$/);
  await expect(page.locator('#applyPreview')).toContainText(id);

  /* 上一頁回到申請表，資料還在 */
  await page.goBack();
  await expect(page.getByLabel('預計入住者身分證字號')).toHaveValue(id);
  await page.goForward();
  await expect(page.locator('#applyPreviewForm')).toBeVisible();

  /* 確認送出：連續送出兩次也只建立一筆（畫面擋重複送出；資料庫另有同一識別碼不重複建立，見 tests/rls/application.test.js） */
  await page.evaluate(() => { const f = document.getElementById('applyPreviewForm'); f.requestSubmit(); f.requestSubmit(); });
  await expect(page).toHaveURL(/view=applied&case=/);
  await expect(page.getByRole('heading', { name: '入住申請已成功送出' })).toBeVisible();
  await expect(page.locator('#appliedPage')).toContainText('待行政確認');
  await expect(page.locator('#mailLine')).toContainText('測試環境尚未介接郵件服務，信件不會實際寄出');
  const { data: cs } = await service().from('cases').select('id, no').eq('family_id', fam.id);
  expect(cs).toHaveLength(1);
  const caseId = cs[0].id;

  /* 申請確認通知「重新寄送」：一分鐘內不重複（建立時算一次，與原型相同）；之後只記錄，不會實際寄出 */
  await page.getByRole('button', { name: '重新寄送' }).click();
  await expect(page.locator('.toast')).toContainText(/一分鐘後再試|信件不會實際寄出/);

  await page.getByRole('link', { name: '查看申請進度' }).click();
  await expect(page.locator('.hero h2')).toHaveText('待行政確認');

  /* 行政確認（階段 5 才有畫面，這裡直接改資料庫模擬） */
  await service().from('cases').update({ link_status: '已確認', confirmed_at: new Date().toISOString() }).eq('id', caseId);
  await page.reload();
  await expect(page.locator('.hero h2')).toHaveText('第一步：請先簽署同意書');
  await expect(page.locator('#stepsBar li').first()).toHaveAttribute('data-state', '進行中');

  /* 同意書：沒選簽署身分擋下；本人簽署立即生效 */
  await page.getByRole('link', { name: '閱讀並簽署同意書' }).click();
  await page.getByRole('button', { name: '確認同意' }).click();
  await expect(page.locator('#signerErr')).toHaveText('請選擇簽署身分');
  await page.locator('input[name=signer][value="本人"]').check();
  await page.locator('input[name=agree]').check();
  await page.getByLabel('簽署人真實姓名').fill('測試阿嬤');
  await page.getByRole('button', { name: '確認同意' }).click();
  await expect(page).toHaveURL(new RegExp(`application\\.html\\?case=${caseId}$`));
  await expect(page.locator('.toast')).toHaveText('資料授權完成');
  await expect(page.locator('#consentLine')).toContainText('已授權');
  await expect(page.locator('#todoHero')).toContainText('您還需要上傳');
  await expect(page.locator('#habitTodo')).toBeVisible();
  await expect(page.locator('#stepsBar li').first()).toHaveAttribute('data-state', '已完成');

  /* 緊急聯絡人：預設帶入申請人 */
  await page.goto(`/application.html?view=contacts&case=${caseId}`);
  await expect(page.locator('input[name=name0]')).toHaveValue('介面測試flow');
  await page.locator('input[name=phone1]').fill('0922-111-222');
  await page.locator('input[name=name1]').fill('');
  await page.getByRole('button', { name: '儲存' }).click();
  await expect(page.locator('#ctErr')).toHaveText('');
  await expect(page).toHaveURL(new RegExp(`case=${caseId}$`));
  await expect(page.locator('.toast')).toHaveText('已儲存');

  /* 習慣卡：分區填寫、必填沒填不能提交、補齊後正式提交 */
  await page.locator('#habitTodo').getByRole('link').click();
  await expect(page).toHaveURL(/view=habit/);
  await expect(page.locator('#habitSubmitBox')).toContainText('待填寫／未提交');
  await page.getByLabel('住民希望被怎麼稱呼？').fill('阿嬤');
  await page.locator('input[name=lang][value="台語"]').check();
  await page.getByLabel('聽力狀況').selectOption('聽力正常');
  await page.getByRole('button', { name: '儲存並到下一區' }).click();
  await expect(page).toHaveURL(/sec=1$/);
  await expect(page.locator('.toast')).toContainText('已儲存草稿「基本稱呼與溝通」（尚未正式提交）');
  await page.getByRole('button', { name: '正式提交習慣卡' }).click();
  await expect(page.locator('#hsErr')).toContainText('還有必填欄位未填：過敏');
  await page.getByLabel(/您所知道的過敏/).fill('無');
  await page.getByRole('button', { name: '儲存並到下一區' }).click();
  for (const k of ['walk', 'transfer', 'toilet', 'bath', 'eat', 'swallow']) await page.locator(`input[name=adl_${k}][value="不清楚"]`).check();
  await page.getByRole('button', { name: '儲存草稿' }).click();
  await expect(page.locator('#habitSubmitBox')).toContainText('必填欄位都已填寫，可以正式提交');
  await page.getByRole('button', { name: '正式提交習慣卡' }).click();
  await expect(page).toHaveURL(new RegExp(`case=${caseId}$`));
  await expect(page.locator('.toast')).toContainText('已正式提交（第 1 次），待護理初審');
  await expect(page.locator('#habitTodo')).toHaveCount(0);
  await expect(page.locator('#habitRow')).toContainText('已提交，待護理初審');
  await expect(page.locator('#timeline')).toContainText('資料授權已完成');
});

test('同一身分證字號已有不同的住民資料：擋下並說明；行政在工作清單看到並處理', async ({ page }) => {
  const svc = service();
  const { data: ta } = await svc.from('cases').select('residents(nid, name)').eq('no', 'T-A').single();
  const fam = await tempFamily('conflict');
  await login(page, fam.email, { portal: 'applicant', password: PW });
  await page.goto('/application.html?view=apply');
  await fillApply(page, { name: '別的名字', nid: ta.residents.nid });
  await page.getByRole('button', { name: '下一步：確認申請資料' }).click();
  await page.getByRole('button', { name: '確認送出' }).click();
  await expect(page.locator('#apErr')).toContainText('這個身分證字號已有資料且內容不同，請聯絡機構確認');
  await expect(page.locator('#apErr')).toContainText('(07) 123-4567');
  await expect(page).toHaveURL(/view=preview$/);
  const { count } = await svc.from('cases').select('id', { count: 'exact', head: true }).eq('family_id', fam.id);
  expect(count).toBe(0);

  await page.getByRole('button', { name: '登出' }).click();
  await login(page, 'staff@example.com');
  const row = page.locator('#conflictCard tr').filter({ hasText: '別的名字' });
  await expect(row).toContainText(ta.residents.name);
  await expect(row).toContainText('介面測試conflict');
  await row.getByRole('button', { name: '標示已處理' }).click();
  await page.locator('#cfNote').fill('已電話確認，申請人輸入錯誤');
  await page.getByRole('button', { name: '儲存' }).click();
  await expect(page.locator('#conflictCard tr').filter({ hasText: '別的名字' })).toHaveCount(0);
});

test('監護人簽署：待代理權核實，畫面提示先上傳監護宣告裁定書', async ({ page }) => {
  const fam = await tempFamily('proxy');
  await login(page, fam.email, { portal: 'applicant', password: PW });
  await page.goto('/application.html?view=apply');
  await fillApply(page, { name: '代理測試', nid: nid() });
  await page.getByRole('button', { name: '下一步：確認申請資料' }).click();
  await page.getByRole('button', { name: '確認送出' }).click();
  await expect(page).toHaveURL(/view=applied/);
  const caseId = new URL(page.url()).searchParams.get('case');
  await service().from('cases').update({ link_status: '已確認', confirmed_at: new Date().toISOString() }).eq('id', caseId);
  await page.goto(`/application.html?view=consent&case=${caseId}`);
  await page.locator('input[name=signer][value="監護人"]').check();
  await page.locator('input[name=agree]').check();
  await page.getByLabel('簽署人真實姓名').fill('王監護');
  await page.getByRole('button', { name: '確認同意' }).click();
  await expect(page.locator('.toast')).toHaveText('已提交同意，待本中心核實代理權後生效');
  await expect(page.locator('#proofHero')).toContainText('同意書已提交，待本中心核實代理權');
  await expect(page.locator('#proofHero')).toContainText('監護宣告裁定書');
  await expect(page.locator('#proofHero').getByRole('link', { name: '上傳監護宣告裁定書' })).toHaveAttribute('href', /documents\.html\?view=upload&case=.*&item=/);
});

test('撤回同意：密碼錯誤擋下；正確後案件結案', async ({ page }) => {
  const fam = await tempFamily('withdraw');
  await login(page, fam.email, { portal: 'applicant', password: PW });
  await page.goto('/application.html?view=apply');
  await fillApply(page, { name: '撤回測試', nid: nid() });
  await page.getByRole('button', { name: '下一步：確認申請資料' }).click();
  await page.getByRole('button', { name: '確認送出' }).click();
  await expect(page).toHaveURL(/view=applied/);
  const caseId = new URL(page.url()).searchParams.get('case');
  await service().from('cases').update({ link_status: '已確認', confirmed_at: new Date().toISOString() }).eq('id', caseId);
  await page.goto(`/application.html?view=consent&case=${caseId}`);
  await page.locator('input[name=signer][value="本人"]').check();
  await page.locator('input[name=agree]').check();
  await page.getByLabel('簽署人真實姓名').fill('撤回測試');
  await page.getByRole('button', { name: '確認同意' }).click();
  await expect(page.locator('#consentLine')).toContainText('已授權');
  await page.getByText('撤回資料授權同意').click();
  await page.getByRole('button', { name: '撤回同意' }).click();
  await page.locator('#wdPw').fill('wrong-pass-1');
  await page.getByRole('button', { name: '確定撤回' }).click();
  await expect(page.locator('#merr')).toHaveText('密碼不正確');
  await page.locator('#wdPw').fill(PW);
  await page.getByRole('button', { name: '確定撤回' }).click();
  await expect(page.locator('.hero.bad h2')).toHaveText('您已撤回資料授權同意');
  await expect(page.locator('.hero.bad')).toContainText('(07) 123-4567');
});

test('我不同意：案件結案並說明', async ({ page }) => {
  const fam = await tempFamily('decline');
  await login(page, fam.email, { portal: 'applicant', password: PW });
  await page.goto('/application.html?view=apply');
  await fillApply(page, { name: '不同意測試', nid: nid() });
  await page.getByRole('button', { name: '下一步：確認申請資料' }).click();
  await page.getByRole('button', { name: '確認送出' }).click();
  await expect(page).toHaveURL(/view=applied/);
  const caseId = new URL(page.url()).searchParams.get('case');
  await page.goto(`/application.html?view=consent&case=${caseId}`);
  await page.getByRole('button', { name: '我不同意' }).click();
  await page.getByRole('button', { name: '確定不同意' }).click();
  await expect(page.locator('.hero.bad h2')).toHaveText('您選擇了不同意');
});

test('不是自己的申請：顯示找不到，不洩漏內容', async ({ page }) => {
  const { data } = await service().from('cases').select('id').eq('no', 'T-A').single();
  await login(page, 'family2@example.com');
  await page.goto(`/application.html?case=${data.id}`);
  await expect(page.getByRole('heading', { name: '找不到這筆申請' })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('劉文雄');
});
