/* 「操作畫面截圖（完成版）」：照展示說明第 5 節的場景順序，在網站上實際操作並截圖。
 * 設定與執行方式見 playwright.shots.config.js。結果：demo-shots/NN.png ＋ demo-shots/manifest.json（場景、標題、說明）。
 *
 * 資料：用暫時帳號（e2e-…@example.com，跑完自動清除）建立同名的示範案件「張秀英」「陳金水」「劉春梅」，
 *       線上真正的 C-0001、C-0002 與測試案件 T-A～T-D 不會被改動。截圖中的案件編號因此和展示時不同。
 * 只截圖、不檢查功能（功能由 tests/e2e 驗收）；沒有要截圖的重複步驟（例如其他文件的收件、核對）直接呼叫資料庫函式完成，
 * 做法與 tests/e2e/writes 相同。 */
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { login, service, env } from '../e2e/helpers.js';

const OUT = 'demo-shots', PW = 'Temp-pass-0001', DOCS = 'reference/sample_docs/';
mkdirSync(OUT, { recursive: true });
const manifest = [];
let seq = 0, scene = '';
const setScene = s => { scene = s; };
/* 截圖：整頁（較長的頁面在產生 Word 時再分段）。sel 只截某個區塊 */
async function shot(page, title, caption, { sel, full = true } = {}){
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
  /* 整頁截圖前捲回頂端並移開焦點，避免固定的頁首出現在圖片中段 */
  if (!sel && full) await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); window.scrollTo(0, 0); });
  const file = `${String(++seq).padStart(2, '0')}.png`;
  if (sel) await page.locator(sel).first().screenshot({ path: `${OUT}/${file}` });
  else await page.screenshot({ path: `${OUT}/${file}`, fullPage: full });
  manifest.push({ n: seq, scene, title, caption, file });
  writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
}
/* 展開個案資料夾（系統會記住展開狀態，已展開就不要再點） */
const openFolder = async folder => { await folder.waitFor(); if (await folder.getAttribute('open') === null) await folder.locator(':scope > summary').click(); };
const logout = page => page.getByRole('button', { name: '登出' }).click();
/* 只為了截圖的畫面操作：失敗時記錄下來並繼續（缺的截圖在最後列出），不影響後面的流程 */
const missed = [];
async function soft(fn){ try { await fn(); } catch (e){ missed.push(scene + '：' + String(e.message).split('\n')[0]); console.warn('截圖略過：' + missed[missed.length - 1]); } }
/* 護理在住民資料頁完成習慣卡初審（已是最新審核完成時不做事）。之後核對的文件改到已確認的過敏、管路、吞嚥時，初審會失效，要重新審核（000030） */
async function habitUI(page, caseId){
  await page.goto(`/assessment.html?case=${caseId}`);
  const btn = page.getByRole('button', { name: '確認習慣卡審核完成' });
  await expect(page.locator('#habitReview')).toBeVisible();
  if (!(await btn.count())) return;
  for (const inp of await page.locator('[id^="hrRes-"]').all()) if (!(await inp.inputValue())) await inp.fill('已電話確認，海鮮是食物過敏；藥物過敏以醫院資料為準');
  await btn.click();
  await page.waitForTimeout(3000);
  const st = await page.locator('#habitReview').innerText(), err = await page.locator('#hrErr').innerText().catch(() => ''), toast = await page.locator('.toast').innerText().catch(() => '');
  if (err || !/已完成習慣卡審核/.test(toast)) throw new Error('習慣卡重新審核沒有成功：' + JSON.stringify({ err, toast, st: st.slice(0, 300) }));
}
/* 護理逐欄核對（人工輸入）：每欄按「確認」；空白欄位用畫面上的快速選項（例如「無」「文件未記載」），沒有快速選項就填「文件未記載」。
 * title 有值時，在按「完成核對」前截圖 */
async function reviewUI(page, docId, title, caption){
  await page.goto(`/assessment.html?view=review&item=${docId}&from=home`);
  await expect(page.locator('[data-act="review-done"]')).toBeVisible();
  /* 先把空白的文字欄位填上「文件未記載」（日期欄位除外），再逐欄確認 */
  for (const el of await page.locator('.field input[type=text], .field textarea').all()) if (!(await el.inputValue()) && await el.isEditable()) await el.fill('文件未記載');
  for (let i = 0; i < 60; i++){
    const b = page.locator('[data-act="f-ok"]').first();
    if (!(await b.count())) break;
    const box = b.locator('xpath=ancestor::div[contains(@class,"field")][1]');
    const before = await page.locator('[data-act="f-ok"]').count();
    await b.click();
    if (await page.locator('[data-act="f-ok"]').count() < before) continue;
    const q = box.locator('[data-act="f-quick"]');
    if (await q.count()) await q.first().click();
    else { await box.locator('input, textarea').first().fill('文件未記載'); await box.locator('[data-act="f-ok"]').click(); }
  }
  if (title) await shot(page, title, caption);
  await page.locator('[data-act="review-done"]').click();
  await page.waitForURL(/dashboard\.html/, { timeout: 30000 });
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const client = () => createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, opts);
const must = async (p, what) => { const r = await p; if (r.error) throw new Error(what + '：' + r.error.message); return r.data; };

/* 暫時家屬帳號（名稱與展示帳號相同，方便對照） */
async function tempFamily(name, phone){
  const email = `e2e-demo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { data, error } = await service().auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { name, phone, want: 'family' } });
  if (error) throw error;
  const db = client(); await db.auth.signInWithPassword({ email, password: PW });
  return { id: data.user.id, email, db, name };
}
const staffDb = async (email) => { const db = client(); await must(db.auth.signInWithPassword({ email, password: env.SEED_PASSWORD }), '登入 ' + email); return db; };
const nid = p => p + String(Date.now()).slice(-8);
const docsOf = async caseId => Object.fromEntries((await service().from('documents').select('id, key').eq('case_id', caseId)).data.map(d => [d.key, d.id]));
/* 家屬上傳一份模擬文件（Storage＋submit_version） */
async function upload(fam, caseId, docId, key, img, date = null, v = 1){
  const path = `${caseId}/${key}/v${v}-${crypto.randomUUID()}.png`;
  await must(fam.db.storage.from('case-files').upload(path, readFileSync(DOCS + img), { contentType: 'image/png' }), '上傳 ' + img);
  return must(fam.db.rpc('submit_version', { p_doc: docId, p_path: path, p_file_name: img, p_user_date: date }), '建立版本 ' + img);
}

test('展示腳本截圖', async ({ page }) => {
  /* ===== 場景 0：入口與系統管理員 ===== */
  setScene('場景 0：入口與系統管理員');
  await page.goto('/login.html');
  await shot(page, '入口選擇', '一般申請人與機構工作人員分開入口；入口只決定畫面，權限依帳號角色。頁尾固定顯示測試環境標示。');
  await page.getByRole('link', { name: /機構工作人員/ }).click();
  await shot(page, '機構工作人員登入', '工作帳號只能從這裡登入；新進人員可申請帳號，由管理員核准角色。');
  await login(page, 'admin@example.com');
  await page.goto('/settings.html?view=org');
  await expect(page.getByRole('heading', { name: '機構設定' })).toBeVisible();
  await shot(page, '機構設定', '機構資料、期限與保存、合作醫院、入住流程順序（先審後簽為建議，先簽後審收在「其他流程」）。下方是內建文件清單與資料存取說明。', { full: false });
  await page.locator('#docListRef summary').click();
  await shot(page, '內建入住文件清單（唯讀）', '七大類、繳交類型、提交時機與有效天數；標示為示範機構的參考設定。', { sel: '#docListRef' });
  await shot(page, '資料存取與權限', '五種角色可看與可做的事，以及資料庫權限（RLS）、檔案權限與操作紀錄的實際保護方式。', { sel: '#accessCard' });
  await page.goto('/settings.html?view=accounts');
  await expect(page.locator('#accRows')).toBeVisible();
  await shot(page, '帳號管理', '待審核的人員申請可核准或退回；黃護理師標示「案件分配權限」，可開啟或取消；每個帳號可停用、變更角色、重設臨時密碼。');
  await logout(page);

  /* ===== 場景 1：一般申請人提出入住申請（暫時帳號「劉建宏」） ===== */
  setScene('場景 1：一般申請人提出入住申請');
  const liu = await tempFamily('劉建宏', '0933500333');
  await login(page, liu.email, { password: PW });
  await shot(page, '個人首頁（尚無申請）', '註冊或登入後先到個人首頁：我要申請入住、我的申請紀錄、申請流程說明。');
  await page.getByRole('link', { name: '開始入住申請' }).click();
  await page.getByLabel('預計入住者姓名').fill('劉春梅');
  await page.getByLabel('預計入住者身分證字號').fill(nid('E2'));
  await page.getByLabel('預計入住者出生日期').fill('1938-03-15');
  await page.getByLabel('申請人與預計入住者的關係').selectOption('兒子');
  await page.getByLabel('預計入住日期').fill('2026-12-28');
  await shot(page, '入住申請表', '申請人為目前帳號；填寫預計入住者姓名、身分證、出生日期、關係、醫院（選填）與預計入住日期。');
  await page.getByRole('button', { name: '下一步：確認申請資料' }).click();
  await expect(page).toHaveURL(/view=preview$/);
  await shot(page, '確認申請資料', '送出前預覽，可返回修改；確認送出後才建立案件與文件清單。');
  await page.getByRole('button', { name: '確認送出' }).click();
  await expect(page.getByRole('heading', { name: '入住申請已成功送出' })).toBeVisible();
  await shot(page, '入住申請已成功送出', '案件編號、送出日期與時間、待行政確認、下一步；申請確認 Email 只建立通知工作，測試環境不會實際寄出。');
  await page.getByRole('link', { name: '查看申請進度' }).click();
  await expect(page.locator('.hero h2')).toHaveText('待行政確認');
  await shot(page, '案件詳情：文件清單', '送出後已建立完整入住文件清單；機構確認、簽署同意書前只能看。');
  await logout(page);

  /* ===== 主腳本的示範案件：張秀英（先審後簽，家屬張家豪）、陳金水（先簽後審，家屬陳淑芬） ===== */
  const zhang = await tempFamily('張家豪', '0912300111'), chen = await tempFamily('陳淑芬', '0922400222');
  const A = await must(zhang.db.rpc('create_application', { p_token: 'demo-a-' + Date.now(), p_name: '張秀英', p_nid: nid('F2'), p_birth: '1940-06-12', p_relation: '兒子', p_hospital: '仁心醫院', p_admit: '2026-11-28' }), '張秀英申請');
  const B = await must(chen.db.rpc('create_application', { p_token: 'demo-b-' + Date.now(), p_name: '陳金水', p_nid: nid('Q1'), p_birth: '1936-09-20', p_relation: '女兒', p_hospital: '港都醫院', p_admit: '2026-12-20' }), '陳金水申請');
  /* 陳金水是先簽後審（機構預設是先審後簽；展示資料 C-0002 也是建立時指定） */
  await must(service().from('cases').update({ flow_mode: '先簽後審' }).eq('id', B.case_id), '陳金水改先簽後審');
  const AD = await docsOf(A.case_id), BD = await docsOf(B.case_id);
  const staff = await staffDb('staff@example.com'), nurse = await staffDb('nurse@example.com');
  const NURSE = (await service().from('profiles').select('id').eq('email', 'nurse@example.com').single()).data.id;
  const NURSE2 = (await service().from('profiles').select('id').eq('email', 'nurse2@example.com').single()).data.id;

  /* ===== 場景 2：行政確認申請、護理部門分配承辦 ===== */
  setScene('場景 2：行政確認申請、護理部門分配承辦');
  await login(page, 'staff@example.com');
  const folderA = page.locator('details.folder').filter({ hasText: A.no });
  await openFolder(folderA);
  await shot(page, '行政工作清單：個案資料夾', '依案件編號分資料夾，預設收合：外層顯示住民姓名、案件編號、階段、必要待辦數；展開看本階段必要待辦、等待其他角色、下一階段預告、已完成工作。可搜尋、排序。');
  await folderA.getByRole('link', { name: '確認申請' }).click();
  await page.locator('input[name=called]').check();
  await shot(page, '確認新申請：張秀英', '電話確認身分與關係後按「確認申請並轉交護理部門」；行政不指定護理師。');
  await page.getByRole('button', { name: '確認申請並轉交護理部門' }).click();
  await expect(page).toHaveURL(/dashboard\.html$/);
  await must(staff.rpc('confirm_case', { p_case: B.case_id, p_called: true, p_chart: '', p_admit: '2026-12-20' }), '確認陳金水');
  await page.goto(`/cases.html?case=${A.case_id}`);
  await shot(page, '行政案件頁：護理分配', '顯示分配狀態；由具案件分配權限的護理人員安排，行政只能查看。', { sel: '.card:has(#assignInfo)' });
  await logout(page);
  await login(page, 'nurse@example.com');
  await page.goto('/cases.html?view=assign');
  await shot(page, '護理：案件分配', '具分配權限的護理人員看到待分配案件；上方導覽列只有「案件分配」顯示選取底線。');
  await page.locator('#assignWait tr').filter({ hasText: A.no }).getByRole('button', { name: '指定承辦' }).click();
  await page.locator('#asNurse').selectOption({ label: '黃護理師' });
  await shot(page, '指定承辦護理師', '選擇承辦護理師；更換承辦時必須填原因，分配歷程會保留。', { full: false });
  await page.getByRole('button', { name: '指定', exact: true }).click();
  await expect(page.locator('.toast')).toHaveText('已指定承辦護理師');
  await must(nurse.rpc('assign_nurse', { p_case: B.case_id, p_nurse: NURSE2, p_prev: null, p_reason: '' }), '陳金水分配吳護理師');
  await logout(page);

  /* ===== 場景 3：家屬簽署個人資料同意書 ===== */
  setScene('場景 3：家屬簽署個人資料同意書');
  await login(page, zhang.email, { password: PW });
  await shot(page, '個人首頁（已有申請）', '列出所有申請與狀態，按「查看進度」進入案件詳情。');
  await page.goto(`/application.html?case=${A.case_id}`);
  await shot(page, '案件詳情', '第一步提示先簽署同意書。');
  await page.getByRole('link', { name: '閱讀並簽署同意書' }).click();
  await page.locator('input[name=signer][value="本人"]').check();
  await page.locator('input[name=agree]').check();
  await page.getByLabel('簽署人真實姓名').fill('張秀英');
  await shot(page, '個人資料蒐集、處理及利用同意書', '閱讀 → 選擇簽署身分 → 勾選同意 → 輸入簽署人真實姓名 → 確認同意；不用登入密碼。提示「本功能為電子同意流程示範，正式簽署及法律效力仍須確認」。');
  await page.getByRole('button', { name: '確認同意' }).click();
  await expect(page.locator('.toast')).toHaveText('資料授權完成');
  await shot(page, '文件進度（依階段）', '目前階段 → 本階段要做的事 → 等待本中心判斷（護理判斷的文件標「待護理判斷」，不是家屬缺件）→ 下一階段預告（收合）→ 已完成。');
  await logout(page);
  await must(chen.db.rpc('sign_consent', { p_case: B.case_id, p_signer: '本人', p_signer_name: '陳金水', p_agree: true, p_photo: false, p_emergency: false }), '陳金水同意書');

  /* ===== 場景 4：護理確認照護文件需求（自動補件） ===== */
  setScene('場景 4：護理確認照護文件需求（自動補件）');
  await login(page, 'nurse@example.com');
  const nf = page.locator('details.folder').filter({ hasText: A.no });
  await openFolder(nf);
  await shot(page, '護理工作清單', '文件還沒上傳就出現「照護文件需求確認：張秀英」。');
  await page.goto(`/assessment.html?case=${A.case_id}`);
  await shot(page, '照護文件需求確認', '列出管路、傷口、吞嚥的判斷與文件狀態；說明這不是收治評估。', { sel: '#needCard' });
  const judge = async (name, choice, note, snap) => {
    await page.locator('#needCard tr').filter({ hasText: name }).getByRole('button', { name: '判斷' }).click();
    await page.locator('label.choice').filter({ hasText: choice }).locator('input').check();
    if (note) await page.locator('#needNote').fill(note);
    if (snap) await shot(page, '判斷：' + name, '本案需要／本案不需要／尚待確認，加上判斷依據；判定需要時系統自動建立補件要求並通知家屬。', { full: false });
    await page.getByRole('button', { name: '儲存' }).click();
    await expect(page.locator('.toast')).toBeVisible();
    await page.locator('.toast').waitFor({ state: 'hidden' }).catch(() => {});
  };
  await judge('管路留置與照護紀錄', '本案需要', '出院摘要記載鼻胃管', true);
  await judge('吞嚥功能評估與飲食建議', '本案需要', '鼻胃管灌食，需要吞嚥評估');
  await judge('傷口評估與照護紀錄', '本案不需要', '家屬表示目前沒有傷口');
  await logout(page);
  await login(page, 'staff@example.com');
  await page.goto(`/cases.html?case=${A.case_id}`);
  await shot(page, '行政案件頁：文件與要求', '顯示「護理已確認：需要／不需要」，行政不能修改；系統自動建立的補件要求也列在這裡。', { sel: '#docTable' });
  await page.getByRole('link', { name: '要求補件' }).click();
  await shot(page, '行政：要求家屬補件', '護理判定不需要（或尚待確認）的照護紀錄不能勾選，需請護理重新判斷。');
  await logout(page);

  /* ===== 場景 5：家屬上傳文件與習慣卡 ===== */
  setScene('場景 5：家屬上傳文件與習慣卡');
  await login(page, zhang.email, { password: PW });
  await page.goto(`/application.html?case=${A.case_id}`);
  await shot(page, '案件詳情：目前要做的事', '「目前需要處理」列出要上傳的文件與習慣卡；護理判斷需要的管路、吞嚥列在「補件進度」，並顯示 Email 通知狀態（模擬）。');
  await page.locator('#todoHero .todo').filter({ hasText: '目前用藥清單' }).getByRole('link', { name: '上傳' }).click();
  await page.locator('#file').setInputFiles(DOCS + '05_用藥清單_不清楚_張秀英.png');
  await shot(page, '上傳：目前用藥清單或處方資料', '說明用途與取得方式，選擇照片或 PDF 後送出（這次故意用模糊的版本，示範退回補件）。');
  await page.getByRole('button', { name: '送出' }).click();
  await expect(page.getByRole('heading', { name: /已上傳「目前用藥清單或處方資料」/ })).toBeVisible();
  await shot(page, '上傳完成', '「已上傳，等待本中心審核」；上傳不等於審核完成。');
  for (const [k, img] of [['idcopy', '01_身分證影本_張秀英.png'], ['nhi', '02_健保卡_張秀英.png'], ['summary', '03_出院病歷摘要_張秀英.png'], ['tubeCare', '06_管路照護指導_張秀英.png'], ['swallow', '07_吞嚥評估_張秀英.png']])
    await upload(zhang, A.case_id, AD[k], k, img);
  /* 習慣卡：A 區、B 區（過敏：海鮮）、C 區、F 區在畫面上填；其他區直接存 */
  await page.goto(`/application.html?view=habit&case=${A.case_id}&sec=0`);
  await page.getByLabel('住民希望被怎麼稱呼？').fill('秀英阿嬤');
  await page.locator('input[name=lang][value="台語"]').check();
  await page.getByLabel('聽力狀況').selectOption('有點重聽，說話要大聲、放慢');
  await shot(page, '習慣卡 A：基本稱呼與溝通', '資料授權有效後即可填寫；標示紅色星號的是必填，其他選填。可以先儲存草稿，草稿不會給機構看。');
  await page.getByRole('button', { name: '儲存並到下一區' }).click();
  await page.getByLabel(/您所知道的過敏/).fill('海鮮');
  await page.getByRole('button', { name: '儲存並到下一區' }).click();
  for (const k of ['walk', 'transfer', 'toilet', 'bath', 'eat', 'swallow']) await page.locator(`input[name=adl_${k}][value="需要部分協助"]`).check();
  await page.getByRole('button', { name: '儲存並到下一區' }).click();
  await must(zhang.db.rpc('save_habit_section', { p_case: A.case_id, p_sec: 'D', p_vals: { wake: '06:30', nap: '有午睡', bedtime: '睡前要喝溫水、留小夜燈' } }), '習慣卡 D');
  await must(zhang.db.rpc('save_habit_section', { p_case: A.case_id, p_sec: 'E', p_vals: { likeFood: '稀飯、蒸蛋', likeAct: '聽老歌、看歌仔戲', dislikeEnv: '怕冷' } }), '習慣卡 E');
  await page.goto(`/application.html?view=habit&case=${A.case_id}&sec=5`);
  await page.getByLabel('容易焦慮或躁動的情境').fill('傍晚、看不到家人時');
  await page.getByLabel('過去有效的安撫方式').fill('握著手說台語、放鄧麗君的歌');
  await shot(page, '習慣卡 F：情緒與安撫方式', '內容標示為「家屬提供」，不取代病歷。');
  await page.getByRole('button', { name: '儲存草稿' }).click();
  await expect(page.locator('#habitSubmitBox')).toContainText('可以正式提交');
  await shot(page, '正式提交習慣卡', '必填欄位都填好後按「正式提交習慣卡」；提交後才會給護理初審。之後再修改要重新提交，形成新版本。', { sel: '#habitSubmitBox' });
  await page.getByRole('button', { name: '正式提交習慣卡' }).click();
  await expect(page.locator('.toast')).toContainText('已正式提交');
  await shot(page, '提交後的案件詳情', '習慣卡移到「正在等待本中心審核」；上傳的文件也在等待審核。');
  await logout(page);

  /* 主要聯絡人（展示時家屬在同意書後填寫；這裡直接存） */
  await must(zhang.db.rpc('save_contacts', { p_case: A.case_id, p_contacts: [{ name: '張家豪', rel: '兒子', phone: '0912-300-111' }] }), '張秀英聯絡人');

  /* ===== 場景 6：行政收件與逐項比對 ===== */
  setScene('場景 6：行政收件與逐項比對');
  const recRpc = async (key, v = 1, how = '必要欄位全部相符') => {
    const { data: s } = await service().from('documents').select('id').eq('id', AD[key]).single();
    const r = await staff.rpc('staff_receipt', { p_doc: s.id, p_v: v, p_how: how, p_detail: {} });
    if (r.error && !/核對過|不是待收件/.test(r.error.message)) throw new Error('收件 ' + key + '：' + r.error.message);
  };
  const selIf = async (name, val) => { const l = page.locator(`select[name="${name}"]`); if (await l.count()) await l.selectOption(val); };
  await login(page, 'staff@example.com');
  const sf = page.locator('details.folder').filter({ hasText: A.no });
  await openFolder(sf);
  await shot(page, '行政工作清單：收件核對', '張秀英資料夾裡列出待收件核對的文件；展開還看得到等待其他角色、下一階段預告、已完成工作。');
  await page.goto(`/documents.html?view=receipt&item=${AD.idcopy}&from=home`);
  await expect(page.locator('.doc img')).toBeVisible();
  await selIf('m-name', '相符'); await selIf('m-nid', '相符');
  await page.locator('#birthRaw').fill('民國 29 年 6 月 12 日');
  await page.locator('input[name=content]').check().catch(() => {});
  await shot(page, '收件核對：住民身分證明文件', '出生日期輸入「民國 29 年 6 月 12 日」，系統轉成 1940/06/12 並顯示一致；行政只核對身分，不判斷醫療內容。');
  await page.getByRole('button', { name: '確認是張秀英的資料' }).click();
  await page.waitForURL(/dashboard\.html/, { timeout: 15000 }).catch(() => {});
  await page.goto(`/documents.html?view=receipt&item=${AD.tubeCare}&from=home`);
  await expect(page.locator('.doc img')).toBeVisible();
  await selIf('m-name', '相符'); await selIf('m-nid', '沒有'); await selIf('m-chart', '記錄'); await selIf('m-source', '相符');
  if (await page.locator('input[name=docChart]').count()) await page.locator('input[name=docChart]').fill('H-102938');
  if (await page.locator('input[name=docSrc]').count()) await page.locator('input[name=docSrc]').fill('仁心醫院');
  if (await page.locator('input[name=birthNone]').count()) await page.locator('input[name=birthNone]').check();
  await page.locator('input[name=how][value="已比對病歷號與來源機構"]').check().catch(() => {});
  await shot(page, '收件核對：醫院文件（沒有身分證字號）', '記錄病歷號與來源機構，人工核實方式選「已比對病歷號與來源機構」；資料不足時一定要選人工核實方式並留下紀錄。');
  await page.getByRole('button', { name: '確認是張秀英的資料' }).click();
  await page.waitForURL(/dashboard\.html/, { timeout: 15000 }).catch(() => {});
  await recRpc('idcopy'); await recRpc('tubeCare', 1, '人工例外核對：已比對病歷號與來源機構');
  for (const k of ['nhi', 'summary', 'meds', 'swallow']) await recRpc(k);
  await logout(page);

  /* ===== 場景 7：護理核對、診斷清單、習慣卡初審 ===== */
  setScene('場景 7：護理核對、診斷清單、習慣卡初審');
  await login(page, 'nurse@example.com');
  const nf2 = page.locator('details.folder').filter({ hasText: A.no });
  await openFolder(nf2);
  await shot(page, '護理工作清單：文件核對', '護理工作清單只列自己負責的住民；張秀英的醫療文件已由行政收件，等待護理核對。');
  await page.goto(`/assessment.html?view=review&item=${AD.summary}&from=home`);
  await expect(page.locator('#ocrBtn')).toBeVisible();
  await page.locator('[data-field="stype"]').getByRole('button', { name: '住院出院摘要' }).click().catch(() => {});
  await shot(page, '出院摘要核對：選摘要類型', '左邊是原始文件，右邊逐欄填寫；紅色邊框的欄位一定要逐項確認。可以先按「自動辨識」讓 AI 帶入。', { full: false });
  await page.locator('#ocrBtn').click();
  await expect(page.locator('#ocrBtn')).toHaveText('重新辨識', { timeout: 120000 });
  await shot(page, '自動辨識結果', 'AI 帶入的內容標示「AI 辨識」，尚未確認；主要診斷先成為待確認的原始文字。辨識結果只是建議。');
  /* 主要診斷：整段先加入一筆 → 標示拆分錯誤 → 依標點拆成多筆 → 逐筆確認 */
  const dx = page.locator('#dxField');
  if (await dx.locator('[data-act="dxr-fromraw"]').count()) await dx.locator('[data-act="dxr-fromraw"]').click();
  if (await page.locator('tr.dxr[data-state="待確認"]').count()){
    await page.locator('tr.dxr').first().locator('[data-act="dxr-reject"]').click();
    await page.locator('#dxRej').selectOption('拆分錯誤');
    await page.getByRole('button', { name: '標示不採用' }).click();
  }
  await dx.locator('[data-act="dxr-split"]').click();
  await shot(page, '主要診斷：依標點拆成多筆建議', '整段標示「拆分錯誤」後，依標點拆成多筆建議；每一筆都要對照原文修改、確認，或標示 OCR 錯誤／不採用。', { sel: '#dxField' });
  for (let i = 0; i < 10 && await page.locator('tr.dxr [data-act="dxr-ok"]').count(); i++) await page.locator('tr.dxr [data-act="dxr-ok"]').first().click();
  /* 其他欄位逐一確認；空白欄位用畫面上的快速選項（例如「無」「文件未記載」） */
  for (let i = 0; i < 40; i++){
    const b = page.locator('[data-act="f-ok"]').first();
    if (!(await b.count())) break;
    const fieldBox = b.locator('xpath=ancestor::div[contains(@class,"field")][1]');
    await b.click();
    if (await b.count() && await fieldBox.locator('.err').first().innerText().catch(() => '')){
      const q = fieldBox.locator('[data-act="f-quick"]').first();
      if (await q.count()) await q.click(); else { await fieldBox.locator('input, textarea').first().fill('文件未記載'); await fieldBox.locator('[data-act="f-ok"]').click(); }
    }
  }
  await shot(page, '核對完成前', '全部欄位都已確認後，「完成核對」才能按；核對草稿可以儲存，重新整理頁面也不會遺失。');
  await page.locator('[data-act="review-done"]').click();
  await page.waitForURL(/dashboard\.html/, { timeout: 30000 });
  /* 管路、吞嚥資料：人工輸入重點並確認（不截圖）。要在習慣卡初審之前：初審後已確認的管路、吞嚥改變，初審會失效（000030） */
  await reviewUI(page, AD.tubeCare); await reviewUI(page, AD.swallow);
  await page.goto(`/assessment.html?case=${A.case_id}`);
  await shot(page, '住民資料：診斷清單', '逐筆確認的診斷已同步到診斷清單，可補 ICD-10-CM 代碼（人工輸入，系統只檢查格式）。', { sel: '#sec-dx' });
  await shot(page, '習慣卡初審', '審核家屬最新提交的版本：家屬寫的過敏和醫院資料不同時，要填處理說明後再確認審核完成。', { sel: '#habitReview' });
  for (const inp of await page.locator('[id^="hrRes-"]').all()) await inp.fill('已電話確認，海鮮是食物過敏；藥物過敏以醫院資料為準');
  await page.getByRole('button', { name: '確認習慣卡審核完成' }).click();
  await expect(page.locator('#habitReview')).toContainText('審核完成');
  /* 用藥清單模糊：退回請家屬補件 */
  await page.goto(`/assessment.html?view=review&item=${AD.meds}&from=home`);
  await expect(page.locator('[data-act="review-return"]')).toBeVisible();
  await page.locator('[data-act="review-return"]').click();
  await shot(page, '文件有問題，退回請家屬補件', '用藥清單看不清楚：選擇原因後退回，系統建立正式補件並通知家屬（Email 模擬）。', { full: false });
  await page.getByRole('button', { name: '退回', exact: true }).click();
  await page.waitForURL(/dashboard\.html/, { timeout: 30000 });
  await logout(page);
  await login(page, 'staff@example.com');
  await page.goto(`/cases.html?case=${A.case_id}`);
  await shot(page, '補件 Email 通知（模擬）', '每個正式補件事件一筆通知工作；畫面標示「模擬已寄送（測試環境未實際寄出）」，信件不含病歷、診斷或身分證字號。', { sel: '#reqMailCard' });
  await logout(page);

  /* ===== 場景 8：家屬補件、收治評估 ===== */
  setScene('場景 8：家屬補件、收治評估');
  await login(page, zhang.email, { password: PW });
  await page.goto(`/application.html?case=${A.case_id}`);
  await shot(page, '家屬看到需要重新上傳', '案件詳情列出「需要重新上傳」與原因；「補件進度」列出正式補件的原因、期限、狀態與 Email 通知狀態。');
  await logout(page);
  await upload(zhang, A.case_id, AD.meds, 'meds', '04_用藥清單_張秀英.png', null, 2);
  await login(page, 'staff@example.com');
  await page.goto('/documents.html?view=followup&from=home');
  await shot(page, '行政：補件追蹤', '補傳後是「機構確認中」；行政收件、護理核對確認符合後，補件才關閉。');
  await recRpc('meds', 2);
  await logout(page);
  await login(page, 'nurse@example.com');
  await reviewUI(page, AD.meds);
  await habitUI(page, A.case_id);
  await page.goto(`/assessment.html?view=assess&case=${A.case_id}`);
  await page.locator('input[name=result][value="收治"]').check();
  await shot(page, '收治評估', '依已確認的資料判斷能不能照顧這位住民；系統只整理資料，不替護理判斷。DNR 另行確認，不依病歷摘要推定。');
  await page.getByRole('button', { name: '確認收治評估結果' }).click();
  await page.getByRole('button', { name: '確認送出' }).click();
  await page.waitForURL(/dashboard\.html/, { timeout: 30000 });
  await logout(page);

  /* ===== 場景 9：家屬看到結果、行政記錄簽約 ===== */
  setScene('場景 9：家屬看到結果、行政記錄簽約');
  await login(page, zhang.email, { password: PW });
  await page.goto(`/application.html?case=${A.case_id}`);
  await shot(page, '家屬看到評估結果', '案件詳情顯示已通過評估，下一步是到機構參訪與簽約。');
  await page.goto('/dashboard.html?view=notices');
  await shot(page, '通知', '機構通知集中在「通知」頁（已讀／未讀、住民與案件編號、前往案件）。');
  await logout(page);
  await login(page, 'staff@example.com');
  await page.goto(`/cases.html?case=${A.case_id}`);
  await shot(page, '行政：記錄簽約結果', '簽約在機構現場完成，按「家屬已簽約」記錄；契約以這個紀錄為完成，不需要上傳契約檔案。', { full: false });
  await page.getByRole('button', { name: '家屬已簽約' }).click();
  await expect(page.locator('.toast')).toContainText('已記錄');
  await must(staff.rpc('set_document_need', { p_doc: AD.relProof, p_met: true, p_note: '簽約者是兒子，不是住民本人' }), '戶籍證明需要');
  await page.reload();
  await soft(async () => { await page.locator('#visitCard').getByRole('button', { name: '編輯' }).click(); await page.locator('#vSt').selectOption('已完成');
    await shot(page, '參訪與保證金', '只記錄參訪與保證金狀態，不阻擋流程，系統不處理付款。', { full: false }); await page.getByRole('button', { name: '取消' }).last().click(); });
  await logout(page);

  /* ===== 場景 10：入住前文件 ===== */
  setScene('場景 10：入住前文件');
  await login(page, zhang.email, { password: PW });
  await page.goto(`/application.html?case=${A.case_id}`);
  await shot(page, '入住前文件變成目前需要準備', '簽約後，入住前文件變成「目前需要準備」；契約與費用文件標示「機構提供」，不算家屬缺件。');
  await page.goto(`/documents.html?view=upload&case=${A.case_id}&item=${AD.exam}`);
  await page.locator('#file').setInputFiles(DOCS + '08_體檢報告_張秀英.png');
  await page.locator('#examDate').fill('2026-11-10'); await page.locator('#examDate').dispatchEvent('change');
  await shot(page, '上傳：入住前健康檢查報告', '可以一次上傳整份報告，並填寫檢查日期；系統先初步判斷是否在有效期限內，由行政確認。');
  await page.getByRole('button', { name: '送出' }).click();
  await expect(page.getByRole('heading', { name: /已上傳「入住前健康檢查報告」/ })).toBeVisible();
  await page.goto(`/documents.html?view=upload&case=${A.case_id}&item=${AD.xray}`);
  await soft(async () => { await expect(page.getByRole('button', { name: /使用已上傳的體檢報告/ })).toBeVisible();
    await shot(page, '胸部 X 光報告：沿用體檢報告', '體檢報告已含 X 光時，按「使用已上傳的體檢報告」沿用同一份檔案，仍分別核對。');
    await page.getByRole('button', { name: /使用已上傳的體檢報告/ }).click(); await page.waitForTimeout(1500); });
  if (!(await service().from('document_versions').select('id').eq('document_id', AD.xray)).data.length)
    await must(zhang.db.rpc('reuse_file', { p_doc: AD.xray, p_from: AD.exam }), 'X 光沿用');
  await upload(zhang, A.case_id, AD.stool, 'stool', '09_糞便檢查_張秀英.png', '2026-11-20');
  for (const [k, img] of [['signerId', '10_簽約者身分證_張家豪.png'], ['relProof', '11_戶口名簿_張秀英.png'], ['emergency', '12_緊急事故處理同意書_張秀英.png']]) await upload(zhang, A.case_id, AD[k], k, img);
  await logout(page);
  await login(page, 'staff@example.com');
  await page.goto(`/documents.html?view=receipt&item=${AD.signerId}&from=case`);
  await soft(async () => { await expect(page.locator('.doc img')).toBeVisible();
    await shot(page, '收件核對：簽約者身分證明文件', '簽約者身分證只核對簽約者本人（張家豪），不是住民。'); });
  for (const k of ['exam', 'xray', 'stool', 'signerId', 'relProof', 'emergency']) await recRpc(k);
  await page.goto(`/documents.html?view=date&item=${AD.exam}&from=case`);
  await page.locator('#dateVal').fill('2026-11-10');
  await shot(page, '核對檢查日期', '系統只是初步判斷；行政對照文件上的日期確認。過期時系統自動建立補件並通知家屬。');
  await page.getByRole('button', { name: '確認日期' }).click();
  await page.waitForURL(/cases\.html/, { timeout: 30000 });
  for (const [k, d] of [['xray', '2026-11-10'], ['stool', '2026-11-20']]){
    const r = await staff.rpc('confirm_doc_date', { p_doc: AD[k], p_v: 1, p_date: d });
    if (r.error && !/已確認|不需要/.test(r.error.message)) throw new Error('確認日期 ' + k + '：' + r.error.message);
  }
  await logout(page);

  /* ===== 場景 11：體檢核對、照顧摘要卡、住民資料 ===== */
  setScene('場景 11：體檢核對、照顧摘要卡、住民資料');
  await login(page, 'nurse@example.com');
  await reviewUI(page, AD.exam, '入住前健康檢查報告核對', '逐項核對「是否包含」與檢查結果；同一份檔案提供的 X 光仍分別核對。');
  await reviewUI(page, AD.xray); await reviewUI(page, AD.stool);
  await habitUI(page, A.case_id);
  await page.goto(`/care-summary.html?case=${A.case_id}`);
  await expect(page.locator('input[name=cg]').first()).toBeVisible();
  await page.locator('label.choice').filter({ hasText: '阿妮' }).locator('input').check();
  await shot(page, '審核照顧摘要卡', 'A 健康與照護重點由已確認資料帶入（主要健康問題是逐筆確認的診斷）；B 生活與個人偏好沿用審核完成的習慣卡；選照服員後開放。');
  await page.getByRole('button', { name: '確認並開放給照服員' }).click();
  await page.waitForURL(/dashboard\.html/, { timeout: 30000 });
  await page.goto(`/assessment.html?case=${A.case_id}`);
  await shot(page, '住民資料', '案件資訊、進度、已確認資料、診斷、照護文件需求、文件、習慣卡、摘要卡狀態與處理歷程。');
  await page.goto('/dashboard.html');
  await soft(async () => { await page.getByRole('button', { name: '已完成' }).or(page.getByRole('link', { name: '已完成' })).first().click();
    await shot(page, '工作清單：已完成', '依個案分組列出自己做過的工作。'); });
  await logout(page);

  /* ===== 場景 12：照服員查看摘要卡 ===== */
  setScene('場景 12：照服員查看摘要卡');
  await login(page, 'care@example.com');
  await shot(page, '照服員：我的住民', '只列開放給自己的住民。');
  await page.goto(`/care-summary.html?case=${A.case_id}`);
  await expect(page.locator('.cblock').first()).toBeVisible();
  await shot(page, '照顧摘要卡', 'A 健康與照護重點、B 生活與個人偏好，每欄標示來源；照服員只能看，不能改，也看不到證件、契約或費用。');
  await page.locator('[data-lang="id"]').click();
  await shot(page, '照顧摘要卡（Bahasa）', '欄位標題可切換印尼文、越南文；翻譯未經母語人士確認，畫面有標示。', { full: false });
  await logout(page);

  /* ===== 場景 13：照護需求改變後重新確認 ===== */
  setScene('場景 13：照護需求改變後重新確認');
  await must(nurse.rpc('set_nurse_need', { p_doc: AD.woundCare, p_met: true, p_note: '家屬來電：薦骨出現壓傷' }), '傷口改為需要');
  await login(page, 'care@example.com');
  await page.goto(`/care-summary.html?case=${A.case_id}`);
  await shot(page, '摘要卡：資料已更新', '護理改判傷口「本案需要」後，照服員的摘要卡顯示資料已更新、需重新確認，受影響欄位顯示「請問護理站」。');
  await logout(page);

  /* ===== 場景 14：先簽後審、非本人簽署、處理歷程 ===== */
  setScene('場景 14：先簽後審、非本人簽署、處理歷程（補充）');
  await login(page, chen.email, { password: PW });
  await page.goto(`/application.html?case=${B.case_id}`);
  await shot(page, '先簽後審：案件詳情', '一開始就列出全部文件，分成「評估前文件」與「入住前文件（目前需要準備）」。');
  await logout(page);
  await login(page, 'staff@example.com');
  await page.goto(`/cases.html?case=${B.case_id}`);
  await shot(page, '先簽後審：行政案件頁', '流程顯示「先簽後審」，有「記錄入住契約」區塊；資料授權同意書不等於入住契約。', { full: false });
  const L = (await service().from('cases').select('id, no').eq('family_id', liu.id).single()).data;
  await must(staff.rpc('confirm_case', { p_case: L.id, p_called: true, p_chart: '', p_admit: '2026-12-28' }), '確認劉春梅');
  await must(nurse.rpc('assign_nurse', { p_case: L.id, p_nurse: NURSE, p_prev: null, p_reason: '' }), '劉春梅分配');
  await logout(page);
  await login(page, liu.email, { password: PW });
  await page.goto(`/application.html?view=consent&case=${L.id}`);
  await soft(async () => { await page.locator('input[name=signer][value="監護人"]').check();
    await shot(page, '非本人簽署', '選「法定代理人／監護人」等非本人身分並輸入姓名；核實前授權不生效。'); });
  await page.goto(`/application.html?case=${L.id}`);
  await logout(page);
  await must(liu.db.rpc('sign_consent', { p_case: L.id, p_signer: '監護人', p_signer_name: '劉建宏', p_agree: true, p_photo: false, p_emergency: false }).then(r => r.error && /已/.test(r.error.message) ? { data: null } : r), '劉春梅監護人簽署');
  await login(page, liu.email, { password: PW });
  await page.goto(`/application.html?case=${L.id}`);
  await shot(page, '待本中心核實代理權', '首頁顯示「待本中心核實代理權」，只能先上傳監護宣告裁定書。');
  await logout(page);
  await login(page, 'staff@example.com');
  await page.goto(`/cases.html?case=${L.id}`);
  await shot(page, '行政：代理權核實', '裁定書收件前「確認代理權」不能按；收件核對後填核實說明並確認，授權才生效。系統只記錄核實結果，不判斷代理權的法律效力。', { sel: '#proofCard' });
  await page.goto(`/cases.html?case=${A.case_id}`);
  await soft(async () => { await page.locator('#timeline summary').first().click().catch(() => {});
    await shot(page, '處理歷程', '依時間排列的事件、日期時間、操作角色與人員；家屬、行政、護理都看得到。', { sel: '#timeline' }); });
  await logout(page);

  /* ===== 場景 15：系統管理 ===== */
  setScene('場景 15：系統管理（測試資料、操作紀錄、寄送異常、帳號）');
  await login(page, 'admin@example.com');
  await page.goto('/settings.html?view=testdata');
  await expect(page.locator('#testRows tr')).toHaveCount(4);
  await shot(page, '測試資料', '四筆虛構測試案件與目前狀態，可建立或恢復起始狀態；只影響這四筆測試案件，正式環境不會出現。');
  await page.goto('/settings.html?view=logs');
  await shot(page, '操作紀錄', '列出每個動作；每頁 50 筆，可往前翻頁。紀錄只能新增，不能修改或刪除。', { full: false });
  await page.goto('/settings.html?view=mail-errors');
  await shot(page, '寄送異常', '列出寄送失敗、寄送中逾時、待寄送太久、補件沒有通知工作的項目（正常時是空的）。', { full: false });
  await page.goto('/settings.html?view=accounts');
  await soft(async () => { await page.locator(`#accRows tr[data-acc="${liu.email}"]`).getByRole('button', { name: '重設密碼' }).click();
    await shot(page, '重設臨時密碼', '產生臨時密碼交給本人；對方第一次登入必須改密碼。', { full: false }); await page.getByRole('button', { name: '取消' }).last().click(); });
  await page.locator('[data-act="fs-menu"]').click();
  await shot(page, '字級設定', '右上角「字級設定」可選標準、大、特大，記在這台裝置。', { full: false });
  await logout(page);
  writeFileSync(`${OUT}/missed.json`, JSON.stringify(missed, null, 1));
  if (missed.length) console.warn(`有 ${missed.length} 張截圖略過，見 ${OUT}/missed.json`);
});
