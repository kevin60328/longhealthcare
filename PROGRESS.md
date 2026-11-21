# 開發進度（PROGRESS）

> 每個階段結束時更新。開新對話時先讀 HANDOFF.md，再讀這份。
> 最後更新：2026/11/21（階段 2 完成）

---

## 1. 階段狀態（HANDOFF 第 13 節）

| 階段 | 內容 | 狀態 |
|---|---|---|
| 0 | 專案骨架：Vite 多頁、8 個 HTML、共用 CSS、`supabase init` | ✅ 完成 |
| 1 | 資料表、RLS 輔助函式與讀取 policy、文件清單與測試資料 seed | ✅ 完成 |
| 2 | login.html、auth／permissions／navigation、頁面守門、導覽列 | ✅ 完成 |
| 3 | dashboard.html：家屬首頁、我的申請、通知；行政／護理個案資料夾；照服員我的住民；待辦徽章 | ⏭ 下一步 |
| 4 | application.html | 未開始 |
| 5 | cases.html | 未開始 |
| 6 | documents.html＋Storage＋Email 模擬＋OCR | 未開始 |
| 7 | assessment.html | 未開始 |
| 8 | care-summary.html | 未開始 |
| 9 | settings.html | 未開始 |
| 10 | 全面驗收與部署到測試專案 | 未開始 |

---

## 2. 開發環境（新電腦或同事接手時）

```
npm install
npx playwright install chromium
```
- `.env`：前端用的公開值（Supabase URL、publishable key、頁尾文字）。範本：`.env.example`。
- `.env.secrets`：只給本機腳本與測試用的秘密（service role key、資料庫連線字串、測試帳號密碼 `SEED_PASSWORD`）。範本：`.env.secrets.example`。**不進 git**，向專案負責人取得或在 Supabase 後台自己複製。
- 資料庫：**Supabase 雲端測試專案**（不用 Docker；本機 C 槽空間不足時 Docker 曾崩潰，所以改用雲端）。

| 指令 | 用途 |
|---|---|
| `npm run dev` | 開發伺服器 http://127.0.0.1:5173/login.html |
| `npm run db:push` | 把 `supabase/migrations/` 與 `seed.sql` 套用到測試專案 |
| `npm run db:seed` | 建立測試帳號與案件（可重複執行） |
| `npm run test:unit` | 單元測試 |
| `npm run test:rls` | RLS 權限測試（會暫時改案件資料，**不要兩個人同時跑**） |
| `npm run test:e2e` | E2E（Playwright） |
| `npm run visual:compare` | 原型 v18 與新版截圖對照 → `test-results/compare/index.html` |

Supabase 後台已設定（2026/11/21）：Confirm email 關閉、密碼至少 8 碼且需英文字母與數字、Redirect URLs 加入 `http://127.0.0.1:5173/**` 與 `http://localhost:5173/**`、Site URL `http://localhost:5173/login.html`。

---

## 3. 已完成內容

### 階段 0
- 8 個 HTML＋`index.html`（轉到登入頁）；Vite 多頁設定。
- 原型 v18 的 CSS 拆成 `css/common.css`、`css/components.css`。

### 階段 1
- `supabase/migrations/20261121000001_schema.sql`：24 張資料表（HANDOFF 8.1）、`case-files` 私有 bucket、操作紀錄只能新增（觸發器擋修改／刪除）、同一文件只能有一筆開啟中的正式補件。
- `…000002_rls.sql`：RLS 輔助函式（`auth_role`、`is_family_of`、`is_case_nurse`、`can_assign`、`is_assignable_case`、`can_read_case`、`can_read_document`、`is_caregiver_of`）＋各表**讀取** policy。前端**一律不能直接寫入**，寫入在之後各階段以 RPC 提供。
- `…000003_grants.sql`：新版 Supabase 專案不會自動授權，明確 grant。
- `supabase/seed.sql`（由 `scripts/gen-seed-sql.mjs` 從 doclist.json 產生）：機構設定、24 項文件清單。
- `scripts/seed-test-data.mjs`：11 個測試帳號、C-0001 張秀英（先審後簽）、C-0002 陳金水（先簽後審），各 24 份文件。

### 階段 2
- `login.html`（`js/modules/login.js`）：入口選擇、登入、註冊、忘記密碼（Supabase 寄重設信，完整流程）、從重設信設定新密碼、修改密碼／臨時密碼強制修改、帳號審核中。每個畫面都有網址，上一頁可用。
- `js/auth.js`（session、守門、登出只登出本機 `scope:'local'`、跨分頁登出、上一頁快取檢查）、`js/permissions.js`（頁面權限畫面判斷）、`js/navigation.js`（分頁、唯一選取、徽章、字級）、`js/page.js`（7 個受保護頁面共用的開頭流程、補填手機號碼提示）。
- `…000004_auth.sql`：狀態加「已退回」、`record_login`、`update_my_phone`、`password_changed` RPC；註冊時資料庫再檢查姓名與手機並寫操作紀錄。
- `…000005_audit_actor.sql`：操作紀錄不綁帳號外鍵（保留 actor_name），帳號才能刪除。
- 徽章：家屬未讀通知、可分配護理師的待分配案件、管理員待審核帳號。**工作清單待辦數尚未做（階段 3）**。
- 與原型畫面對照 20 組（桌機＋手機），差異已修正。

---

## 4. 測試狀態（2026/11/21 實際執行）

| 測試 | 結果 |
|---|---|
| 單元（`tests/unit`：帳號格式、導覽列唯一選取 × 所有角色／頁面／view、頁面權限） | 577 通過 |
| RLS（`tests/rls`：案件／文件隔離、護理只看 B/C/D、分配權限、預設拒絕寫入、操作紀錄不可改、註冊不能取得角色、bucket 私有） | 24 通過 |
| E2E（`tests/e2e`：8 頁開啟與守門、五種角色登入分流、唯一選取分頁、上一頁、徽章、入口不符、權限、重新整理、登出後上一頁、跨分頁登出、待審核／停用、強制改密碼、改密碼、重設密碼、補填手機、註冊、後台密碼規則） | 45 通過 |
| 原型畫面對照（`tests/visual`） | 20 組截圖，人工比對後已修正差異 |

**需人工驗收**：用真實 Email 走一次「忘記密碼」，確認信中連結回到「設定新密碼」畫面（轉址設定無法自動測）。

---

## 5. 還沒做／已知限制
- 7 個受保護頁面的內容都還是「建置中」（階段 3～9）。
- 所有寫入 RPC（建立申請、收件、補件、評估…）尚未建立；目前前端只能讀。
- Storage policy 尚未建立（階段 6）。
- `phase()` 等業務規則尚未移轉（階段 3 開始，放 `js/modules/rules/`，並在 Postgres 寫同邏輯版本）。
- reference 的 Python 舊測試未移植（Python 未安裝；改寫成 JS 版 Playwright，逐階段移植）。

## 6. 與 HANDOFF 不同或補充的決定
- 帳號狀態多一個「已退回」（原型有，HANDOFF 表格沒列）。
- 操作紀錄 `actor` 不設外鍵（見 000005）。
- 登出只登出目前瀏覽器（Supabase 預設是所有裝置）。
- 忘記密碼：使用者選「完整流程，測試時不實際寄信」（自動測試用管理端產生連結）。
- seed.json 沒有 C-0003 劉春梅的案件（只有 family3 帳號），目前只建 C-0001、C-0002。

## 7. 待確認事項
1. 頁尾文字（HANDOFF 15-1）：目前暫定「目前為測試環境：資料存放於 Supabase 測試專案，非正式服務。（頁尾文字待確認）」，在 `.env` 的 `VITE_ENV_NOTE`。
2. FHIR 交換介接是否保留（15-2）。
3. 正式 Email 服務（15-3）。
4. F1、F3、F4、F12 定義（15-5）。
5. C-0003 劉春梅：等階段 4 用正常流程建立，還是另有資料？
6. 部署方式與網域（15-8）；部署時要把正式網址加進 Supabase Redirect URLs。
7. 測試專案的 secret key 與資料庫密碼曾出現在對話中，放真實資料前要更換。

---

## 8. 下一步：階段 3（dashboard.html）
- 移轉原型的 `phase()`、`tasks()`、`assignState` 等到 `js/modules/rules/`（純函式＋Vitest 對照原型輸出），Postgres 寫同邏輯版本供列表查詢。
- 家屬：個人首頁、我的申請、通知（已讀／未讀）。
- 行政／護理：個案資料夾（依案件編號、預設收合、記住展開、搜尋、排序、待處理／已完成）。
- 照服員：我的住民。
- 「工作清單」徽章＝待辦數，與原型一致。
- 完成後跑 `npm run visual:compare` 對照原型首頁畫面。
