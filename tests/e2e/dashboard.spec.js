/* 階段 3：dashboard.html（HANDOFF 13 階段 3 完成條件：待辦數與原型一致；資料夾預設收合並記住）。
 * 前提：npm run db:seed 與 npm run db:seed-cases（6 筆案件：C-0001、C-0002、T-A～T-D）。
 * 「與原型一致」的答案來自 tests/unit/fixtures/parity.json.gz（原型對同樣 6 筆案件算出的待辦）。 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { login, currentTab, service } from './helpers.js';

const F = JSON.parse(gunzipSync(readFileSync('tests/unit/fixtures/parity.json.gz')));
/* 6 筆案件在原型裡的原始狀態（每筆的第一個情境）與原型算出的待辦 */
const BASES = [];
for (const s of F.scenarios){ if (!BASES.some(b => b.input.c.id === s.input.c.id)) BASES.push(s); }
const protoTasks = email => BASES.flatMap(b => (b.out.roles[email] || { tasks: [] }).tasks);
const phaseOf = no => BASES.find(b => b.input.c.no === no).out.case;

test.describe('家屬', () => {
  test('個人首頁：列出自己的申請與原型相同的狀態；入口連到申請頁與申請紀錄', async ({ page }) => {
    await login(page, 'family3@example.com');
    await expect(page.getByRole('heading', { name: '個人首頁' })).toBeVisible();
    const rows = page.locator('#myCaseList .todo');
    await expect(rows).toHaveCount(2);
    for (const no of ['T-A', 'T-B']){
      const row = rows.filter({ hasText: no });
      await expect(row.locator('.pill')).toHaveText(phaseOf(no).famPhase);
      await expect(row.getByRole('link', { name: '查看進度' })).toHaveAttribute('href', /^application\.html\?case=[0-9a-f-]{36}$/);
    }
    await expect(page.getByRole('link', { name: '開始入住申請' })).toHaveAttribute('href', 'application.html?view=apply');
    await page.getByRole('link', { name: /我的申請紀錄/ }).click();
    await expect(page).toHaveURL(/view=mycases$/);
    await expect(page.locator('#myCaseRows tr')).toHaveCount(2);
    expect(await currentTab(page)).toBe('home');
  });

  test('沒有申請的家屬：顯示「目前尚無入住申請」', async ({ page }) => {
    const svc = service();
    const email = `e2e-fam-${Date.now()}@example.com`;
    const { data } = await svc.auth.admin.createUser({ email, password: 'Temp-pass-0001', email_confirm: true, user_metadata: { name: 'E2E 家屬', phone: '0912000111', want: 'family' } });
    try {
      await login(page, email, { portal: 'applicant', password: 'Temp-pass-0001' });
      await expect(page.locator('#noCase')).toContainText('目前尚無入住申請');
    } finally { await svc.auth.admin.deleteUser(data.user.id); }
  });

  test('通知：未讀徽章 → 打開通知頁標為已讀、徽章消失；可前往案件', async ({ page }) => {
    const svc = service();
    const { data: fam } = await svc.from('profiles').select('id').eq('email', 'family3@example.com').single();
    const { data: c } = await svc.from('cases').select('id').eq('no', 'T-A').single();
    const { data: n } = await svc.from('notices').insert({ case_id: c.id, to: fam.id, text: 'E2E 測試通知：請補件' }).select('id').single();
    try {
      await login(page, 'family3@example.com');
      await expect(page.locator('nav.subnav [data-tab="notices"] .badge')).toHaveText('1');
      await page.getByRole('link', { name: /通知/ }).click();
      const row = page.locator('#noticeList .todo').filter({ hasText: 'E2E 測試通知' });
      await expect(row.locator('.pill')).toHaveText('未讀');           // 打開當下先顯示原本的未讀
      await expect(row).toContainText('劉文雄（T-A）');
      await expect(page.locator('nav.subnav [data-tab="notices"] .badge')).toHaveCount(0);   // 寫入已讀後徽章消失
      expect(await currentTab(page)).toBe('notices');
      await page.reload();
      await expect(page.locator('#noticeList .todo').filter({ hasText: 'E2E 測試通知' }).locator('.pill')).toHaveText('已讀');
      const { data: after } = await svc.from('notices').select('read_at').eq('id', n.id).single();
      expect(after.read_at).not.toBeNull();
      await expect(row.getByRole('link', { name: '前往案件' })).toHaveAttribute('href', `application.html?case=${c.id}`);
    } finally { await svc.from('notices').delete().eq('id', n.id); }
  });

  test('通知用 Email：格式錯誤擋下；正確才儲存', async ({ page }) => {
    const svc = service();
    try {
      await login(page, 'family3@example.com');
      await page.locator('#accountCard summary').click();
      await page.locator('#notifyForm input[name=notifyEmail]').fill('bad@');
      await page.getByRole('button', { name: '儲存通知 Email' }).click();
      await expect(page.locator('#nfErr')).toContainText('電子郵件格式不正確');
      await page.locator('#notifyForm input[name=notifyEmail]').fill('notify-e2e@example.com');
      await page.getByRole('button', { name: '儲存通知 Email' }).click();
      await expect(page.locator('.toast')).toHaveText('通知 Email 已儲存');
      const { data } = await svc.from('profiles').select('notify_email').eq('email', 'family3@example.com').single();
      expect(data.notify_email).toBe('notify-e2e@example.com');
    } finally { await svc.from('profiles').update({ notify_email: null }).eq('email', 'family3@example.com'); }
  });
});

test.describe('行政工作清單', () => {
  test('待辦數（徽章與「待處理」）與原型相同；各類磚塊數量正確', async ({ page }) => {
    const want = protoTasks('staff@example.com');
    await login(page, 'staff@example.com');
    await expect(page.getByRole('heading', { name: '今天要處理的事' })).toBeVisible();
    await expect(page.locator('nav.subnav [data-tab="home"] .badge')).toHaveText(String(want.length));
    await expect(page.getByRole('link', { name: `待處理（${want.length}）` })).toBeVisible();
    const tile = label => page.locator('.tile').filter({ hasText: label }).locator('.n');
    await expect(tile('件新申請待確認')).toHaveText(String(want.filter(t => t.tag === '新申請').length));
    await expect(tile('件收件待核對')).toHaveText(String(want.filter(t => ['收件', '身分'].includes(t.tag)).length));
  });

  test('個案資料夾：每案一個、預設收合；展開後重新整理仍記得；待辦按鈕連到對應頁面', async ({ page }) => {
    await page.addInitScript(() => { if (!sessionStorage.getItem('e2eInit')){ localStorage.removeItem('wbOpen'); sessionStorage.clear(); sessionStorage.setItem('e2eInit', '1'); } });
    await login(page, 'staff@example.com');
    const folders = page.locator('details.folder');
    const groups = new Set(protoTasks('staff@example.com').map(t => t.cid));
    await expect(folders).toHaveCount(groups.size);
    for (const d of await folders.all()) expect(await d.getAttribute('open')).toBeNull();
    const a = folders.filter({ hasText: 'C-0002' });
    await a.locator(':scope > summary').click();
    await expect(a).toHaveAttribute('open', '');
    await expect(a.getByRole('heading', { name: /本階段必要待辦/ })).toBeVisible();
    await page.reload();
    await expect(page.locator('details.folder').filter({ hasText: 'C-0002' })).toHaveAttribute('open', '');
    await expect(page.locator('details.folder').filter({ hasText: 'C-0001' })).not.toHaveAttribute('open', '');
    /* C-0001 的資料夾仍是收合的，按鈕在無障礙樹裡被隱藏，所以用元素查詢 */
    const btn = page.locator('details.folder').filter({ hasText: 'C-0001' }).locator('a.btn', { hasText: '確認申請' });
    await expect(btn).toHaveAttribute('href', /^cases\.html\?view=confirm&case=[0-9a-f-]{36}&from=home$/);
  });

  test('搜尋姓名或案件編號；排序切換', async ({ page }) => {
    await login(page, 'staff@example.com');
    /* 行政的資料夾只列有待辦的案件（原型相同）；用原型答案找一個有行政待辦的測試案件來搜尋 */
    const cids = new Set(protoTasks('staff@example.com').map(t => t.cid));
    const one = BASES.find(b => cids.has(b.input.c.id)).input.c;
    await page.getByLabel('搜尋住民姓名或案件編號').fill(one.patient.name);
    await expect(page.locator('details.folder')).toHaveCount(1);
    await expect(page.locator('details.folder')).toContainText(one.no);
    await page.getByLabel('搜尋住民姓名或案件編號').fill('C-000');
    await expect(page.locator('details.folder')).toHaveCount(2);
    await page.getByLabel('搜尋住民姓名或案件編號').fill('不存在的人');
    await expect(page.locator('#folders')).toContainText('找不到符合的案件。');
    await page.getByLabel('搜尋住民姓名或案件編號').fill('');
    await page.getByLabel('排序').selectOption('count');
    const counts = await page.locator('details.folder summary .pill').filter({ hasText: '必要待辦' }).allInnerTexts();
    const n = counts.map(t => Number(t.replace(/\D/g, '')));
    expect(n).toEqual([...n].sort((x, y) => y - x));
  });

  test('已完成工作：依案件列出行政做過的工作', async ({ page }) => {
    await login(page, 'staff@example.com');
    await page.getByRole('link', { name: '已完成' }).click();
    await expect(page).toHaveURL(/tab=done$/);
    expect(await currentTab(page)).toBe('home');
    const d = page.locator('#doneList details.folder').filter({ hasText: 'T-A' });
    await expect(d).toBeVisible();
    await d.locator(':scope > summary').click();
    await expect(d.locator('tbody tr').first()).toContainText('行政收件已確認');
  });
});

test.describe('護理工作清單', () => {
  test('承辦護理：待辦數與原型相同；負責的住民即使沒有待辦也列出', async ({ page }) => {
    const want = protoTasks('nurse@example.com');
    await login(page, 'nurse@example.com');
    await expect(page.getByRole('heading', { name: '我的工作清單' })).toBeVisible();
    await expect(page.locator('nav.subnav [data-tab="home"] .badge')).toHaveText(String(want.length));
    for (const no of ['T-A', 'T-B', 'T-C', 'T-D']) await expect(page.locator('details.folder').filter({ hasText: no })).toHaveCount(1);
    await expect(page.locator('details.folder').filter({ hasText: 'C-0001' })).toHaveCount(0);   // 不是自己承辦的
    const b = page.locator('details.folder').filter({ hasText: 'T-B' });
    await b.locator(':scope > summary').click();
    await expect(b.getByRole('link', { name: '開始評估' })).toHaveAttribute('href', /^assessment\.html\?view=assess&case=[0-9a-f-]{36}&from=home$/);
  });

  test('沒有承辦案件的護理師：目前沒有待處理的事', async ({ page }) => {
    await login(page, 'nurse2@example.com');
    await expect(page.locator('#folders')).toContainText('目前沒有待處理的事。');
    await expect(page.locator('nav.subnav [data-tab="home"] .badge')).toHaveCount(0);
  });
});

test.describe('照服員', () => {
  test('我的住民：只列出開放給自己的摘要卡', async ({ page }) => {
    await login(page, 'care@example.com');
    await expect(page.getByRole('heading', { name: '我的住民' })).toBeVisible();
    const li = page.locator('ul.tasks li');
    await expect(li).toHaveCount(1);
    await expect(li).toContainText('吳月娥');
    await expect(li).toContainText('第 1 版');
    await expect(li.getByRole('link', { name: '看摘要卡' })).toHaveAttribute('href', /^care-summary\.html\?case=[0-9a-f-]{36}$/);
  });
  test('沒有開放給自己的照服員：目前沒有住民', async ({ page }) => {
    await login(page, 'care2@example.com');
    await expect(page.locator('main .empty')).toContainText('目前沒有住民');
  });
});
