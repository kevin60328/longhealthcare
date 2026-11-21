# 開發進度（PROGRESS）

> 每個階段結束時更新。開新對話時先讀 HANDOFF.md，再讀這份。
> 最後更新：2026/11/21（階段 3 完成；資料庫正規化）

---

## 1. 階段狀態（HANDOFF 第 13 節）

| 階段 | 內容 | 狀態 |
|---|---|---|
| 0 | 專案骨架：Vite 多頁、8 個 HTML、共用 CSS、`supabase init` | ✅ 完成 |
| 1 | 資料表、RLS 輔助函式與讀取 policy、文件清單與測試資料 seed | ✅ 完成 |
| 2 | login.html、auth／permissions／navigation、頁面守門、導覽列 | ✅ 完成 |
| 3 | dashboard.html：家屬首頁、我的申請、通知；行政／護理個案資料夾；照服員我的住民；待辦徽章 | ✅ 完成 |
| 4 | application.html | ⏭ 下一步 |
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
| `npm run db:seed` | 建立測試帳號與 C-0001、C-0002（可重複執行） |
| `npm run db:seed-cases` | 建立原型的 4 筆測試案件 T-A～T-D（刪除後重建＝回到起始狀態；E2E 與 RLS 模型測試需要） |
| `npm run parity:gen` | 用原型 v18 重新產生規則對照資料 `tests/unit/fixtures/parity.json.gz`（只有改了 tests/parity 的變化規則才需要） |
| `npm run test:unit` | 單元測試 |
| `npm run test:rls` | RLS 權限測試＋資料庫→規則對照（會暫時改案件資料，**不要兩個人同時跑**） |
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
- 徽章：家屬未讀通知、可分配護理師的待分配案件、管理員待審核帳號（工作清單待辦數在階段 3 加上）。
- 與原型畫面對照 20 組（桌機＋手機），差異已修正。

### 階段 3
- **業務規則** `js/modules/rules/core.js`：原型的 phase、status、tasks、stepsInfo、caseTimeline、waitingOthers、habitState／habitGate、cardChanged、reqState、mailReqEvent、followupRows… 逐行移轉，函式名稱與原型相同。
- **原型對照測試**：`tests/parity/gen.spec.js` 在瀏覽器跑原型，用原型的 seedTestCase 建 4 筆測試案件＋seed 2 筆，做 316 個隨機變化，記下原型算出的結果；`tests/unit/parity.test.js` 確認新版規則對每個情境的結果完全相同（對照時抓到並修正 2 處移轉錯字）。
- **讀取函式** `…000006_case_models.sql`：`get_case_models`（資料庫內檢查權限後回傳規則需要的案件資料；護理看不到內容的文件只回傳狀態欄位）、`my_care_residents`、`mark_notices_read`、`set_notify_email`（profiles 加 notify_email）。
- **資料轉換** `js/modules/services/model.js`：資料庫格式 → 原型的資料形狀（時間轉台灣時間字串、文件 id＝案件id_key）；同一頁只讀一次（徽章與內容共用）。
- **dashboard.html**：家屬個人首頁／我的申請紀錄／通知（打開即已讀）／帳號與通知設定；行政「今天要處理的事」磚塊＋個案資料夾；護理「我的工作清單」；待處理／已完成；搜尋、排序；資料夾預設收合、展開記在 localStorage；照服員我的住民。待辦按鈕連到 HANDOFF 6.2 的新網址（那些頁面在之後階段完成）。
- **徽章**：工作清單＝tasks() 數量（與原型相同）。
- `scripts/seed-test-cases.mjs`：把原型的 T-A～T-D 寫進測試專案。
- 與原型畫面對照 11 組（行政／護理工作清單與資料夾、已完成、家屬首頁／申請紀錄／通知、照服員），差異已修正（資料夾、磚塊、排序、按鈕位置都一致）。

### 資料庫正規化（階段 3 之後、階段 4 之前，使用者要求）
- 使用者要求至少第三正規化、資料要有關聯。`…000007_normalize.sql`、`…000008_case_models_v2.sql`、`…000009_fix_catalog_check.sql`、`…000010_same_case.sql`（跨案件一致性），既有資料已轉換。
- 新增 `residents`（住民獨立）、`partner_hospitals`、`doc_catalog_parts`／`document_parts`、`document_need_changes`、`document_need_asks`、`document_reminders`、`diagnosis_changes`、`mail_attempts`、`retention_holds`；`medical_facts` 改成一欄一列並綁文件版本。
- 補上所有外鍵（含「文件第幾版」「第幾次提交」等複合外鍵）；JSON 裡的人員 id、文件 id 改成欄位。
- 使用者決定：住民獨立成表；文件保留建立當時的快照並加外鍵到文件清單；`cases.nurse_id` 保留但只能由分配紀錄改變（觸發器保證一致）。
- 設計說明與刻意保留的例外：**`docs/DATABASE.md`**。
- 測試抓到並修正：「非 G 類文件必須連到文件清單」的檢查遇到空值會放行（SQL 的 null 判斷），000009 修正。

---

## 4. 測試狀態（2026/11/21 實際執行）

| 測試 | 結果 |
|---|---|
| 單元（`tests/unit`）：帳號格式、導覽列唯一選取、頁面權限（577）＋**原型規則對照 316 個情境**＋個別規則（5） | 898 通過 |
| RLS（`tests/rls`）：案件／文件隔離、護理只看 B/C/D、分配權限、預設拒絕寫入、操作紀錄不可改、註冊不能取得角色、bucket 私有、**正規化後的關聯與約束 13 項**、**跨案件一致性 3 項**、住民資料隔離（38）＋**資料庫→get_case_models→轉換→規則，4 筆測試案件 × 4 種身分與原型相同**（24） | 62 通過 |
| E2E（`tests/e2e`）：階段 2 的 45 條＋dashboard 12 條（家屬首頁／紀錄／通知已讀／通知 Email、行政與護理待辦數與原型相同、資料夾收合與記住、搜尋排序、已完成、照服員） | 57 通過 |
| 原型畫面對照（`tests/visual`） | 31 組截圖，人工比對後已修正差異 |

**需人工驗收**：用真實 Email 走一次「忘記密碼」，確認信中連結回到「設定新密碼」畫面（轉址設定無法自動測）。

---

## 5. 還沒做／已知限制
- application、cases、documents、assessment、care-summary、settings 的內容還是「建置中」（階段 4～9）；工作清單的待辦按鈕會連到這些頁面。
- 所有寫入 RPC（建立申請、收件、補件、評估…）尚未建立；目前前端只能讀。
- Storage policy 尚未建立（階段 6）。
- 護理「已完成工作」：原型會列出**已移交給別人**的案件的處理摘要；正式版護理讀不到已移交的案件，所以目前不顯示。需要時可加一個只回傳摘要的 RPC。
- 診斷清單的「標準化名稱」（原型 d.std）資料表還沒有欄位，階段 7 一併加入。
- reference 的 Python 舊測試未移植（Python 未安裝；改寫成 JS 版 Playwright，逐階段移植）。

## 6. 與 HANDOFF 不同或補充的決定
- 帳號狀態多一個「已退回」（原型有，HANDOFF 表格沒列）。
- 操作紀錄 `actor` 不設外鍵（見 000005）。
- 登出只登出目前瀏覽器（Supabase 預設是所有裝置）。
- 忘記密碼：使用者選「完整流程，測試時不實際寄信」（自動測試用管理端產生連結）。
- seed.json 沒有 C-0003 劉春梅的案件（只有 family3 帳號），目前只建 C-0001、C-0002；另外用 db:seed-cases 建了原型的 T-A～T-D（家屬是 family3、family、family2）。
- **案件階段只在前端用 rules/core.js 計算，沒有另外寫 Postgres 版本**（HANDOFF 9.3 建議寫一份同邏輯的 SQL 供列表查詢）。理由：規則只有一份才不會兩邊不一致，而且有原型對照測試保證；資料量小，列表直接用 get_case_models 讀全部再計算。之後若案件數變多或需要在資料庫端用階段篩選，再補 SQL 版並用同一份對照資料測試。
- get_case_models 會回傳診斷的文字與狀態給行政與家屬（只為了計算摘要卡依據是否變更），diagnoses 表本身仍只有承辦護理能直接讀。
- 家屬「帳號與通知設定」的 Email 標籤一律顯示「測試環境尚未介接」（原型對 seed 帳號顯示「尚未驗證」、對新註冊帳號顯示「測試環境尚未介接」）。

## 7. 待確認事項
1. 頁尾文字（HANDOFF 15-1）：目前暫定「目前為測試環境：資料存放於 Supabase 測試專案，非正式服務。（頁尾文字待確認）」，在 `.env` 的 `VITE_ENV_NOTE`。
2. FHIR 交換介接是否保留（15-2）。
3. 正式 Email 服務（15-3）。
4. F1、F3、F4、F12 定義（15-5）。
5. C-0003 劉春梅：等階段 4 用正常流程建立，還是另有資料？
6. 部署方式與網域（15-8）；部署時要把正式網址加進 Supabase Redirect URLs。
7. 測試專案的 secret key 與資料庫密碼曾出現在對話中，放真實資料前要更換。
8. 是否需要 Postgres 版的案件階段函式（見第 6 節）。
9. 同一位住民（同身分證字號）由不同家屬申請、或兩次申請填的姓名生日不同時怎麼處理（住民資料共用一份）：階段 4 建立申請時要決定，建議先擋下並請行政確認。

---

## 8. 下一步：階段 4（application.html）
- 家屬：入住申請（RPC create_application，防重複送出，建立 24 份文件與申請確認通知）、申請預覽、已送出。
- 案件詳情（原型 familyHome）：目前要做的事、進度條（stepsInfo）、補件進度摘要、處理歷程（caseTimeline；需要把處理人員姓名加進 get_case_models）。
- 個資同意與代理權（sign_consent、withdraw_consent；非本人簽署進入待代理權核實）、緊急聯絡人、習慣卡草稿與正式提交（submit_habit，必填 HABIT_REQ、rev 遞增）。
- 每個寫入都要確認成功才更新畫面，失敗可重試；寫完呼叫 invalidateModel()。
- 完成後跑 visual:compare 對照原型的申請、同意書、聯絡人、習慣卡畫面。
