/* 原型 vs 新版 畫面對照截圖（不是驗收測試，只產生截圖給人看）。
 * 原型：用 file:// 打開 reference/prototype_v18.html，先注入 seed.json 與 mock_db.js 模擬資料庫（HANDOFF 第 4 節的做法）。
 *       原型模擬資料的測試密碼是 Test1234（只存在原型的 seed.json 雜湊裡，與正式版無關）。
 * 新版：開發伺服器＋雲端測試專案，用 .env.secrets 的 SEED_PASSWORD 登入。
 * 執行：npx playwright test --config playwright.visual.config.js
 * 結果：test-results/compare/<畫面>-<proto|new>.png，以及並排的 test-results/compare/index.html */
import { test } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { login } from '../e2e/helpers.js';

const OUT = resolve('test-results/compare');
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
  if (vp.name === '手機' && s.header === undefined && !['01-入口選擇', '02-一般申請人登入', '04-註冊一般申請人'].includes(s.key)) continue;
  test(`${vp.name} ${s.key}`, async ({ browser }) => {
    const shot = async (which, fn) => {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, baseURL: 'http://127.0.0.1:5173' });
      const p = await ctx.newPage();
      if (which === 'proto'){
        await ctx.addInitScript(INIT);
        await p.goto(PROTO_URL); await p.waitForSelector('#portal, #loginForm');
      }
      await fn(p);
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
