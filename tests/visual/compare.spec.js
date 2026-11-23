/* 原型 vs 新版 畫面對照截圖（不是驗收測試，只產生截圖給人看）。
 * 原型：用 file:// 打開 reference/prototype_v18.html，先注入 seed.json 與 mock_db.js 模擬資料庫（HANDOFF 第 4 節的做法）。
 *       原型模擬資料的測試密碼是 Test1234（只存在原型的 seed.json 雜湊裡，與正式版無關）。
 * 新版：開發伺服器＋雲端測試專案，用 .env.secrets 的 SEED_PASSWORD 登入。
 * 執行：npx playwright test --config playwright.visual.config.js
 * 結果：visual-compare/<畫面>-<proto|new>.png，以及並排的 visual-compare/index.html */
import { test } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { login, service } from '../e2e/helpers.js';

/* 新版的案件網址要用資料庫的 uuid：依案件編號查詢 */
const caseIdOf = async no => (await service().from('cases').select('id').eq('no', no).single()).data.id;
/* 文件的 uuid：依案件編號與文件 key 查詢 */
const docIdOf = async (no, key) => (await service().from('documents').select('id').eq('case_id', await caseIdOf(no)).eq('key', key).single()).data.id;
const DRAFT = { pname: '王美玉', nid: 'A223456789', birth: '1940-03-15', relation: '女兒', hospital: '仁心醫院', admit: '2026-12-20', token: 'compare' };

/* 不放在 test-results：Playwright 每次執行會清空 test-results，只跑部分畫面時其他截圖會不見 */
const OUT = resolve('visual-compare');
mkdirSync(OUT, { recursive: true });
const PROTO_URL = pathToFileURL(resolve('reference/prototype_v18.html')).href;
const INIT = 'window.__SEED=' + readFileSync('reference/seed.json', 'utf8') + ';' + readFileSync('reference/mock_db.js', 'utf8');

/* 要對照的畫面：proto 在原型裡怎麼到達，neu 在新版怎麼到達 */
const SCREENS = [
  { key: '01-入口選擇', proto: async p => {}, neu: async p => { await p.goto('/login.html'); } },
  { key: '02-一般申請人登入', proto: async p => { await p.evaluate("go('login','applicant')"); }, neu: async p => { await p.goto('/login.html?view=login&portal=applicant'); } },
  { key: '03-機構工作人員登入', proto: async p => { await p.evaluate("go('login','staff')"); }, neu: async p => { await p.goto('/login.html?view=login&portal=staff'); } },
  { key: '04-註冊一般申請人', proto: async p => { await p.evaluate("go('register','applicant')"); }, neu: async p => { await p.goto('/login.html?view=register&portal=applicant'); } },
  { key: '05-新進人員申請', proto: async p => { await p.evaluate("go('register','staff')"); }, neu: async p => { await p.goto('/login.html?view=register&portal=staff'); } },
  { key: '06-忘記密碼', proto: async p => { await p.evaluate("go('forgot','applicant')"); }, neu: async p => { await p.goto('/login.html?view=forgot&portal=applicant'); } },
  { key: '07-登入錯誤', proto: async p => { await p.evaluate("go('login','staff')"); await protoFill(p, 'staff@example.com', 'wrong1234'); },
    neu: async p => { await login(p, 'staff@example.com', { password: 'wrong1234' }); } },
  { key: '08-帳號審核中', proto: async p => { await protoLogin(p, 'jiaying@example.com'); }, neu: async p => { await login(p, 'jiaying@example.com'); await p.waitForURL(/pending/); } },
  { key: '09-行政頁首', proto: async p => { await protoLogin(p, 'staff@example.com'); }, neu: async p => { await login(p, 'staff@example.com'); await p.waitForURL(/dashboard/); }, header: true },
  { key: '10-護理頁首（可分配）', proto: async p => { await protoLogin(p, 'nurse@example.com'); }, neu: async p => { await login(p, 'nurse@example.com'); await p.waitForURL(/dashboard/); }, header: true },
  { key: '11-家屬頁首', proto: async p => { await protoLogin(p, 'family@example.com'); }, neu: async p => { await login(p, 'family@example.com'); await p.waitForURL(/dashboard/); }, header: true },
  { key: '12-管理員頁首', proto: async p => { await protoLogin(p, 'admin@example.com'); }, neu: async p => { await login(p, 'admin@example.com'); await p.waitForURL(/settings/); }, header: true },
  /* 階段 3：dashboard（原型先用 seedTestCase 建立同樣的 4 筆測試案件，兩邊資料相同） */
  { key: '20-行政工作清單', seed: true, proto: async p => { await protoLogin(p, 'staff@example.com'); }, neu: async p => { await login(p, 'staff@example.com'); } },
  { key: '21-行政資料夾展開', seed: true, proto: async p => { await protoLogin(p, 'staff@example.com'); await p.locator('details.folder', { hasText: 'C-0002' }).locator(':scope > summary').click(); },
    neu: async p => { await p.addInitScript(() => localStorage.removeItem('wbOpen')); await login(p, 'staff@example.com'); await p.locator('details.folder', { hasText: 'C-0002' }).locator(':scope > summary').click(); } },
  { key: '22-行政已完成', seed: true, proto: async p => { await protoLogin(p, 'staff@example.com'); await p.evaluate("workTab = 'done'; render(true)"); }, neu: async p => { await login(p, 'staff@example.com'); await p.goto('/dashboard.html?tab=done'); } },
  { key: '23-護理工作清單', seed: true, proto: async p => { await protoLogin(p, 'nurse@example.com'); }, neu: async p => { await login(p, 'nurse@example.com'); } },
  { key: '24-護理資料夾展開', seed: true, proto: async p => { await protoLogin(p, 'nurse@example.com'); await p.locator('details.folder', { hasText: 'T-A' }).locator(':scope > summary').click(); },
    neu: async p => { await p.addInitScript(() => localStorage.removeItem('wbOpen')); await login(p, 'nurse@example.com'); await p.locator('details.folder', { hasText: 'T-A' }).locator(':scope > summary').click(); } },
  { key: '25-家屬個人首頁', seed: true, proto: async p => { await protoLogin(p, 'family3@example.com'); }, neu: async p => { await login(p, 'family3@example.com'); } },
  { key: '26-家屬申請紀錄', seed: true, proto: async p => { await protoLogin(p, 'family3@example.com'); await p.evaluate("go('mycases')"); }, neu: async p => { await login(p, 'family3@example.com'); await p.goto('/dashboard.html?view=mycases'); } },
  { key: '27-家屬通知', seed: true, proto: async p => { await protoLogin(p, 'family3@example.com'); await p.evaluate("go('notices')"); }, neu: async p => { await login(p, 'family3@example.com'); await p.goto('/dashboard.html?view=notices'); } },
  { key: '28-照服員我的住民', seed: true, proto: async p => { await protoLogin(p, 'care@example.com'); }, neu: async p => { await login(p, 'care@example.com'); } },
  /* 階段 4：application.html */
  { key: '30-入住申請表', seed: true, proto: async p => { await protoLogin(p, 'family3@example.com'); await p.evaluate("go('apply')"); }, neu: async p => { await login(p, 'family3@example.com'); await p.goto('/application.html?view=apply'); } },
  { key: '31-確認申請資料', seed: true, proto: async p => { await protoLogin(p, 'family3@example.com'); await p.evaluate(d => { applyDraft = d; go('applyPreview'); }, DRAFT); },
    neu: async p => { await login(p, 'family3@example.com'); await p.evaluate(d => sessionStorage.setItem('applyDraft', JSON.stringify(d)), DRAFT); await p.goto('/application.html?view=preview'); } },
  { key: '32-案件詳情（待行政確認）', seed: true, proto: async p => { await protoLogin(p, 'family@example.com'); await p.evaluate("go('home', 'C-0001-p4t8')"); }, neu: async p => { await login(p, 'family@example.com'); await p.goto('/application.html?case=' + await caseIdOf('C-0001')); } },
  { key: '33-案件詳情（文件審查中）', seed: true, proto: async p => { await protoLogin(p, 'family3@example.com'); await p.evaluate("go('home', 'TEST-A')"); }, neu: async p => { await login(p, 'family3@example.com'); await p.goto('/application.html?case=' + await caseIdOf('T-A')); } },
  { key: '34-同意書', seed: true, proto: async p => { await protoLogin(p, 'family@example.com'); await p.evaluate("go('consent', 'C-0001-p4t8')"); }, neu: async p => { await login(p, 'family@example.com'); await p.goto('/application.html?view=consent&case=' + await caseIdOf('C-0001')); } },
  { key: '35-緊急聯絡人', seed: true, proto: async p => { await protoLogin(p, 'family3@example.com'); await p.evaluate("go('contacts', 'TEST-A')"); }, neu: async p => { await login(p, 'family3@example.com'); await p.goto('/application.html?view=contacts&case=' + await caseIdOf('T-A')); } },
  { key: '36-習慣卡', seed: true, proto: async p => { await protoLogin(p, 'family3@example.com'); await p.evaluate("go('life', 'TEST-A')"); }, neu: async p => { await login(p, 'family3@example.com'); await p.goto('/application.html?view=habit&case=' + await caseIdOf('T-A')); } },
  /* 階段 5：cases.html */
  { key: '40-行政案件列表', seed: true, proto: async p => { await protoLogin(p, 'staff@example.com'); await p.evaluate("go('cases')"); }, neu: async p => { await p.addInitScript(() => sessionStorage.removeItem('caseQ')); await login(p, 'staff@example.com'); await p.goto('/cases.html'); } },
  { key: '41-案件詳情（評估中）', seed: true, proto: async p => { await protoLogin(p, 'staff@example.com'); await p.evaluate("go('case', 'TEST-B')"); }, neu: async p => { await login(p, 'staff@example.com'); await p.goto('/cases.html?case=' + await caseIdOf('T-B')); } },
  { key: '42-確認新申請', seed: true, proto: async p => { await protoLogin(p, 'staff@example.com'); await p.evaluate("go('apply', 'C-0001-p4t8')"); }, neu: async p => { await login(p, 'staff@example.com'); await p.goto('/cases.html?view=confirm&case=' + await caseIdOf('C-0001')); } },
  { key: '43-案件分配', seed: true, proto: async p => { await protoLogin(p, 'nurse@example.com'); await p.evaluate("go('assign')"); }, neu: async p => { await login(p, 'nurse@example.com'); await p.goto('/cases.html?view=assign'); } },
  /* 階段 6：documents.html（原型的「要求補件」是案件頁上的對話框，新版改成獨立頁） */
  { key: '50-申請流程說明', seed: true, proto: async p => { await protoLogin(p, 'family3@example.com'); await p.evaluate("go('guide', 'TEST-A')"); }, neu: async p => { await login(p, 'family3@example.com'); await p.goto('/documents.html?view=list&case=' + await caseIdOf('T-A')); } },
  { key: '51-上傳文件', seed: true, proto: async p => { await protoLogin(p, 'family3@example.com'); await p.evaluate("route.page = 'upload'; route.arg = 'TEST-A'; route.arg2 = 'TEST-A_exam'; render(true)"); }, neu: async p => { await login(p, 'family3@example.com'); await p.goto('/documents.html?view=upload&case=' + await caseIdOf('T-A') + '&item=' + await docIdOf('T-A', 'exam')); } },
  { key: '52-收件核對', seed: true, proto: async p => { await protoLogin(p, 'staff@example.com'); await p.evaluate("go('receipt', 'TEST-A_idcopy')"); }, neu: async p => { await login(p, 'staff@example.com'); await p.goto('/documents.html?view=receipt&item=' + await docIdOf('T-A', 'idcopy')); } },
  { key: '53-核對日期', seed: true, proto: async p => { await protoLogin(p, 'staff@example.com'); await p.evaluate("go('date', 'TEST-D_stool')"); }, neu: async p => { await login(p, 'staff@example.com'); await p.goto('/documents.html?view=date&item=' + await docIdOf('T-D', 'stool')); } },
  { key: '54-補件追蹤', seed: true, proto: async p => { await protoLogin(p, 'staff@example.com'); await p.evaluate("go('followup')"); }, neu: async p => { await login(p, 'staff@example.com'); await p.goto('/documents.html?view=followup&from=home'); } },
  { key: '55-看文件', seed: true, proto: async p => { await protoLogin(p, 'staff@example.com'); await p.evaluate("go('doc', 'TEST-D_summary')"); }, neu: async p => { await login(p, 'staff@example.com'); await p.goto('/documents.html?view=doc&from=case&item=' + await docIdOf('T-D', 'summary')); } },
  { key: '56-要求補件', seed: true, proto: async p => { await protoLogin(p, 'staff@example.com'); await p.evaluate("go('case', 'TEST-B')"); await p.locator('[data-act="staff-request"]').click(); }, neu: async p => { await login(p, 'staff@example.com'); await p.goto('/documents.html?view=request&from=case&case=' + await caseIdOf('T-B')); } },
  /* 階段 7：assessment.html */
  { key: '60-負責住民', seed: true, proto: async p => { await protoLogin(p, 'nurse@example.com'); await p.evaluate("go('residents')"); }, neu: async p => { await login(p, 'nurse@example.com'); await p.goto('/assessment.html'); } },
  { key: '61-住民資料', seed: true, proto: async p => { await protoLogin(p, 'nurse@example.com'); await p.evaluate("go('resident', 'TEST-A')"); }, neu: async p => { await login(p, 'nurse@example.com'); await p.goto('/assessment.html?case=' + await caseIdOf('T-A')); } },
  { key: '62-醫療內容核對', seed: true, proto: async p => { await protoLogin(p, 'nurse@example.com'); await p.evaluate("go('review', 'TEST-A_summary')"); }, neu: async p => { await login(p, 'nurse@example.com'); await p.goto('/assessment.html?view=review&item=' + await docIdOf('T-A', 'summary')); } },
  { key: '63-收治評估', seed: true, proto: async p => { await protoLogin(p, 'nurse@example.com'); await p.evaluate("go('assess', 'TEST-B')"); }, neu: async p => { await login(p, 'nurse@example.com'); await p.goto('/assessment.html?view=assess&case=' + await caseIdOf('T-B')); } },
  /* 階段 8：care-summary.html */
  { key: '70-審核照顧摘要卡', seed: true, proto: async p => { await protoLogin(p, 'nurse@example.com'); await p.evaluate("go('card', 'TEST-C')"); }, neu: async p => { await login(p, 'nurse@example.com'); await p.goto('/care-summary.html?from=home&case=' + await caseIdOf('T-C')); } },
  { key: '71-照服員看摘要卡', seed: true, proto: async p => { await protoLogin(p, 'care@example.com'); await p.evaluate("go('card', 'TEST-D')"); }, neu: async p => { await login(p, 'care@example.com'); await p.goto('/care-summary.html?case=' + await caseIdOf('T-D')); } },
  /* 階段 9：settings.html */
  { key: '80-帳號管理', seed: true, proto: async p => { await protoLogin(p, 'admin@example.com'); }, neu: async p => { await login(p, 'admin@example.com'); await p.waitForURL(/settings/); } },
  { key: '81-機構設定', seed: true, proto: async p => { await protoLogin(p, 'admin@example.com'); await p.evaluate("go('settings')"); }, neu: async p => { await login(p, 'admin@example.com'); await p.goto('/settings.html?view=org'); } },
  { key: '82-結案與封存', seed: true, proto: async p => { await protoLogin(p, 'admin@example.com'); await p.evaluate("go('archive')"); }, neu: async p => { await login(p, 'admin@example.com'); await p.goto('/settings.html?view=archive'); } },
  { key: '83-測試資料', seed: true, proto: async p => { await protoLogin(p, 'admin@example.com'); await p.evaluate("go('testdata')"); }, neu: async p => { await login(p, 'admin@example.com'); await p.goto('/settings.html?view=testdata'); } },
  { key: '13-修改密碼', proto: async p => { await protoLogin(p, 'family@example.com'); await p.evaluate("go('password')"); },
    neu: async p => { await login(p, 'family@example.com'); await p.waitForURL(/dashboard/); await p.goto('/login.html?view=password'); } }
];

async function protoFill(p, email, pw){
  await p.waitForSelector('#loginForm');
  await p.fill('#loginForm [name=email]', email); await p.fill('#loginForm [name=pw]', pw);
  await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(800);
}
async function protoLogin(p, email){
  await p.evaluate(`go('login', '${/^family/.test(email) ? 'applicant' : 'staff'}')`);
  await protoFill(p, email, 'Test1234');
  await p.waitForSelector('#top [data-act="logout"]', { timeout: 15000 });
}

const VIEWPORTS = [{ name: '桌機', width: 1280, height: 900 }, { name: '手機', width: 390, height: 844 }];

for (const vp of VIEWPORTS) for (const s of SCREENS){
  if (vp.name === '手機' && s.header === undefined && !['01-入口選擇', '02-一般申請人登入', '04-註冊一般申請人', '20-行政工作清單', '25-家屬個人首頁'].includes(s.key)) continue;
  test(`${vp.name} ${s.key}`, async ({ browser }) => {
    const shot = async (which, fn) => {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, baseURL: 'http://127.0.0.1:5173' });
      const p = await ctx.newPage();
      if (which === 'proto'){
        await ctx.addInitScript(INIT);
        await p.goto(PROTO_URL); await p.waitForSelector('#portal, #loginForm');
        /* 需要測試案件的畫面：以管理員身分用原型自己的 seedTestCase 建立，再回到未登入狀態 */
        if (s.seed) await p.evaluate(async () => { me = D.accounts['admin@example.com']; for (const t of testSpecs()) await seedTestCase(t.key); me = null; render(true); });
      }
      await fn(p);
      /* 等畫面真的畫好（不是「系統載入中…」），再多等一下讓字型與非同步內容穩定 */
      await p.waitForFunction(() => { const m = document.getElementById('main'); return m && !m.querySelector('.app-loading') && m.innerText.trim().length > 20; }, null, { timeout: 20000 });
      await p.waitForTimeout(1200);
      await p.evaluate(() => document.fonts.ready);
      const file = `${OUT}/${vp.name}-${s.key}-${which}.png`;
      if (s.header) await p.locator('#top').screenshot({ path: file });
      else await p.screenshot({ path: file, fullPage: true });
      await ctx.close();
    };
    await shot('proto', s.proto);
    await shot('new', s.neu);
  });
}

/* 全部截完後產生並排對照頁 */
test.afterAll(() => {
  const files = readdirSync(OUT).filter(f => f.endsWith('-proto.png')).sort();
  const rows = files.map(f => { const base = f.replace(/-proto\.png$/, '');
    return `<section><h2>${base}</h2><div class="pair"><figure><figcaption>原型 v18</figcaption><img src="${f}"></figure><figure><figcaption>新版</figcaption><img src="${base}-new.png"></figure></div></section>`; }).join('');
  writeFileSync(`${OUT}/index.html`, `<!doctype html><meta charset="utf-8"><title>原型與新版畫面對照</title><style>body{font-family:sans-serif;margin:16px;background:#eee}section{background:#fff;padding:12px;margin:0 0 16px;border-radius:8px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}img{max-width:100%;border:1px solid #ccc}figcaption{font-weight:700;margin-bottom:4px}</style><h1>原型 v18 vs 新版</h1>${rows}`);
});
