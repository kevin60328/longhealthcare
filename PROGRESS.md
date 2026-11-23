# 開發進度（PROGRESS）

> 每個階段結束時更新。開新對話時先讀 HANDOFF.md，再讀這份。
> 最後更新：2026/11/23（階段 9 完成）

---

## 1. 階段狀態（HANDOFF 第 13 節）

| 階段 | 內容 | 狀態 |
|---|---|---|
| 0 | 專案骨架：Vite 多頁、8 個 HTML、共用 CSS、`supabase init` | ✅ 完成 |
| 1 | 資料表、RLS 輔助函式與讀取 policy、文件清單與測試資料 seed | ✅ 完成 |
| 2 | login.html、auth／permissions／navigation、頁面守門、導覽列 | ✅ 完成 |
| 3 | dashboard.html：家屬首頁、我的申請、通知；行政／護理個案資料夾；照服員我的住民；待辦徽章 | ✅ 完成 |
| 4 | application.html：申請、案件詳情、同意書與代理權、緊急聯絡人、習慣卡 | ✅ 完成 |
| 5 | cases.html：案件列表與詳情、確認轉交、分配、代理權核實、簽約、協調與結案、參訪與保證金 | ✅ 完成 |
| 6 | documents.html＋Storage＋Email 模擬＋OCR | ✅ 完成 |
| 7 | assessment.html | ✅ 完成 |
| 8 | care-summary.html | ✅ 完成 |
| 9 | settings.html | ✅ 完成 |
| 10 | 全面驗收與部署到測試專案 | 🔄 進行中（已部署到 Netlify） |

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
| `npm run visual:compare` | 原型 v18 與新版截圖對照 → `visual-compare/index.html` |
| `npm run db:clean-tests` | 清除自動測試帳號（e2e-／rls-…@example.com）建立的案件、紀錄與帳號（測試跑完會自動執行） |
| `npm run functions:sync` | 把共用規則複製到 `supabase/functions/_shared/`（改了 rules/core.js 或 model-build.js 後要執行） |
| `npm run functions:deploy` | 同步後部署 Edge Functions（需要 .env.secrets 的 SUPABASE_ACCESS_TOKEN） |

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

### 階段 4（application.html）
- **RPC**（`…000011_application.sql`、`…000013_resident_conflicts.sql`）：create_application（一個交易內建立住民、案件、24 份文件與核對項目、申請確認通知、操作紀錄；同一申請識別碼不重複）、sign_consent／withdraw_consent／decline_consent、save_contacts、save_habit_section、submit_habit、resend_apply_mail、staff_directory、resolve_resident_conflict。
- **使用者決定**：同一身分證字號已有住民資料但姓名或生日不同 → 不建立申請，畫面顯示「這個身分證字號已有資料且內容不同，請聯絡機構確認」，寫入 `resident_conflicts`；行政工作清單出現「住民資料待確認」卡片，填處理說明後標示已處理（計入工作清單徽章；原型沒有這個功能）。
- **畫面**（`js/modules/application.js`、共用 `js/modules/family-ui.js`）：申請表（草稿存 sessionStorage，上一頁不遺失）、確認申請資料、已送出、案件詳情（目前要做的事、進度條、補件進度、文件進度分組、處理歷程、撤回同意、切換申請）、同意書（本人／監護人／代理人／受輔助宣告；不同意）、緊急聯絡人、習慣卡七區（分區儲存草稿、正式提交）。表單有未儲存修改時離開會提醒。
- **代理權證明文件**：非本人簽署時加入「監護宣告裁定書／輔助宣告裁定書／代理權授權證明」（`doc_catalog.on_demand`）。
- 與原型畫面對照 7 組（申請表、確認、待行政確認、文件審查中、同意書、聯絡人、習慣卡），差異已修正（必填星號位置、舊資料不顯示通知列）。對照截圖改存 `visual-compare/`（Playwright 每次會清空 test-results）。
- 上傳文件、完整文件清單頁在 documents.html（階段 6）；案件詳情裡的上傳按鈕已連到那裡。

### 階段 5（cases.html）
- **RPC**（`…000014_cases.sql`、修正 `000016`）：confirm_case、reject_application、assign_nurse（帶「畫面看到的承辦人」防止同時分配互相覆蓋；更換要原因）、verify_proxy（證明文件完成收件核對才能確認）、record_signing、close_case、coordinate（可入住／重評／延期／取消）、update_admit、save_visit、set_document_need（行政判斷的視情況繳交文件）、ask_nurse_need、case_conflicts（利益衝突）。都在一個交易內鎖定案件、檢查狀態、通知家屬、記錄操作紀錄；兩位行政同時操作時後到的人被擋下。
- **資料表**：cases 加 已拒絕、handover_at／by、closed_text；visits 改成 `case_visits`、`case_deposits`（每案一筆目前狀態）。
- **畫面**（`js/modules/cases.js`）：案件列表（搜尋、篩選）、案件詳情（簽約、協調、代理權核實、基本資料、文件與要求、參訪與保證金、處理歷程、處理紀錄）、確認新申請／不受理、案件分配。文件的收件、補件、上傳按鈕連到 documents.html（階段 6）。家屬案件頁加上參訪預約提示。
- **使用者決定（2026/11/22）**：
  - 多位行政共用工作清單（不加承辦行政）。
  - 案件分配頁的案件階段在伺服器端計算：Edge Function `supabase/functions/case-phases` 用同一份規則（`_shared/` 是 `npm run functions:sync` 複製的副本，`tests/unit/functions-sync.test.js` 檢查一致）。已部署（`npm run functions:deploy`，token 放在 .env.secrets）。分配頁先畫出整頁、階段欄「讀取中」，算好再填上；取不到時顯示「無法取得」並說明。
  - 修正（測試抓到）：`000020`、`000021` 讓 service role 能讀到案件與完整文件內容，否則伺服器算出的階段與原型不同。
  - 測試資料清除：`purge_test_data()`（`000019`）只有後端金鑰能執行、只刪自動測試帳號的資料；其他操作紀錄仍不能刪改（有測試）。Playwright 與 Vitest 跑完自動清除。
- **權限調整**（`000018`）：有分配權限的護理師看得到所有「已確認、進行中」案件的基本資料（才能更換承辦），文件仍看不到。
- **效能**：`000017` get_case_models 預設只讀進行中的案件（「已完成工作」與案件列表的已結案篩選才讀全部）；`000022` 每份文件只檢查一次可見性（約快 3 成）。
- **測試設定**：Playwright 同時 4 個、等待 10 秒（寫入類 15 秒、單條 3 分鐘），因為連雲端偶爾較慢；`tests/rls/functions.test.js` 檢查 Edge Function 權限與算出的階段與原型相同。
- **拆檔**：`js/modules/services/model-build.js`（純轉換，瀏覽器與 Edge Function 共用）＋ `model.js`（讀資料庫）。
- 與原型畫面對照 4 組（案件列表、案件詳情、確認新申請、案件分配），版面一致；確認新申請改歸「工作清單」分頁（與原型相同）；測試案件匯入補上緊急聯絡人與建立紀錄。

### 階段 6（documents.html、Storage、補件 Email、OCR）
- **資料庫**（`000023_documents.sql`，修正 `000024`～`000027`）：
  - 文件狀態函式 `doc_status()`、`doc_done()`、補件事件 `req_event()`：與 rules/core.js 的 status、isDone、mailReqEvent 同一套判斷（RPC 檢查狀態、send-mail 判斷要不要寄用），**測試逐筆比對兩邊一致**。
  - 寫入 RPC：submit_version（家屬上傳；檔案位置要和版本相符、檔案要已在 Storage）、reuse_file（X 光沿用體檢報告、照護紀錄沿用 C／D 類檔案）、submit_inst_version（機構文件）、staff_receipt、mark_id_pending、confirm_doc_date、request_documents（全部檢查通過才寫入；選填改必備；清單外資料建 G 類文件）、remind_document（一般提醒，不是補件）、add_case_document、close_request_fix、open_document_file。狀態改變後自動處理補件：確認過期→系統補件並通知家屬；確認符合→關閉補件（家屬補傳不關閉）。
  - 同一文件再提出補件時，舊的標成「被取代」（superseded_by，不是結案），與原型 reqHistory 相同；同時只有一筆開啟中。
  - Storage 私有 bucket `case-files`：讀取／上傳 policy 與資料表同一套判斷；行政讀醫療類檔案前必須經過 open_document_file（每人每版本記一次操作紀錄，新表 `document_views`）。檔案只新增、不覆蓋。
  - 修正（測試抓到）：`000024` open_document_file 變數撞名；`000025` 文件清單約束遇到空值會被當成通過；`000027` get_case_models 每份文件不再個別呼叫 can_read_document（結果相同，資料庫內約 0.1 秒）。
- **Edge Functions**（已部署）：
  - `send-mail`：補件 Email 認領→送出前再確認→回寫（HANDOFF 10.4 全部步驟）。郵件服務是**模擬**（不寄出），狀態「模擬已寄送（測試環境未實際寄出）」；正式介接只要換 mailSend。
  - `ocr`：用 service role 讀檔案，呼叫 Claude（claude-opus-5-5，開啟 Anthropic 的 server-side fallback，避免醫療文件被安全分類器誤判拒絕），結果存 ocr_runs，日期模式寫入初步日期；失敗時說明原因、改人工。階段 6 只有「日期」「出生日期」兩種，護理逐欄核對在階段 7。
  - Claude API key 由使用者在 Supabase 後台 Edge Functions → Secrets 設定（目前 access token 沒有 secrets 寫入權限）；`npm run functions:secrets` 是有權限時用的腳本。已比對後台雜湊與 .env.secrets 相同。
- **畫面**（`js/modules/documents.js`）：家屬流程說明與完整文件清單、上傳（含沿用檔案）、已上傳；行政收件核對（簽約者另有畫面；出生日期民國／西元換算比對；可用 AI 讀出生日期）、核對日期（可用 AI 讀日期）、補件追蹤（再次提醒）、看文件、要求補件、新增其他文件、上傳機構文件、補件 Email。共用：`mail-ui.js`（案件頁也嵌入補件 Email 區塊）、`services/files.js`（上傳、10 分鐘有效的檔案網址；超過 4 MB 的照片先縮小）、`rules/receipt.js`、`rules/fields.js`（從原型逐字移轉）。家屬案件頁的補件進度顯示 Email 狀態。
- **與原型不同（說明理由）**：
  - 要求補件、新增其他文件、上傳機構文件：原型是案件頁的對話框，新版是 documents.html 的獨立頁（HANDOFF 6.2 的網址規劃；欄位與文字相同）。
  - 日期 OCR 只讀「檢查日期」一個欄位（原型同時讀護理欄位，那部分在階段 7）；OCR 也支援 PDF（原型只有圖片）。
  - 導覽列：收件核對、核對日期、補件追蹤歸「工作清單」，看文件、要求補件等歸「案件」，from=case／from=home 優先（對照原型修正階段 2 的規則與測試）。
- 與原型畫面對照 7 組（流程說明、上傳、收件核對、核對日期、補件追蹤、看文件、要求補件）：版面一致。差異：測試案件沒有實際檔案（左邊顯示「沒有檔案」，E2E 已確認真實上傳會顯示圖片）；看文件頁少了「核對紀錄」卡（每欄 AI 原值與歷程，屬於階段 7 的護理核對資料）。
- **測試設定**：E2E 同時 2 個瀏覽器（原本 4 個）。實測 4 個同時跑時，雲端免費方案資料庫偶爾超過 8 秒上限（statement timeout），造成隨機逾時；這是測試環境的限制。

### 階段 7（assessment.html）
- **資料庫**（`000028_assessment.sql`，修正 `000029` 診斷排序）：
  - 補欄位：document_versions 的核對紀錄快照（review、review_src、labs、dx_rows）；diagnoses 的標準化名稱、病摘第幾筆、已由新版取代、確認者；assessments 的 DNR 另行確認；新表 assessment_items（需補充指定的文件，外鍵）。
  - RPC（全部只限承辦護理師，鎖定案件）：set_nurse_need、save_review_draft、complete_review（醫療資料一欄一列寫入 medical_facts；病摘逐筆診斷在同一交易同步，舊版本帶入的診斷標示已取代、不刪除）、return_document、save_supp、dx_import、dx_save、dx_resync、review_habit、save_assessment。
  - 共用判斷：`docs_ready()`（文件齊全，與 rules/core.js docsReady 逐筆比對一致）、`habit_gate()`。文件狀態改變後，已簽約且文件齊全時記錄「入住前文件確認完成」。
- **Edge Function ocr** 加入護理核對模式（review）：欄位定義與畫面同一份（`rules/fields.js` 同步到 `_shared/`），提示文字逐字沿用原型；結果只存 ocr_runs，畫面併入草稿（已確認、人工修改的欄位不覆蓋）。已部署。
- **畫面**（`js/modules/assessment.js`）：負責住民、住民資料（案件資訊、進度、已確認資料、習慣卡初審、診斷清單、照護文件需求確認、文件、處理歷程）、逐欄核對（快捷鍵確認、診斷依標點拆分與逐筆確認／不採用、草稿儲存與重新整理保留、AI 辨識、完成、退回）、護理補充評估、收治評估／入住前確認。純規則移到 `rules/review.js`（從原型逐字移轉）。
- **與原型不同**：住民資料頁的照顧摘要卡只顯示狀態並連到 care-summary.html（修訂、停用在階段 8）；習慣卡區塊不顯示家屬草稿的最後修改時間（護理端只讀得到正式提交）；導覽列對照原型修正：文件核對、收治評估歸「工作清單」。
- 與原型畫面對照 4 組（負責住民、住民資料、醫療內容核對、收治評估）：版面一致；差異同上，以及測試案件沒有實際檔案。
- **使用者決定（2026/11/23）：習慣卡初審補上資料庫檢查**（`000030`）：`confirmed_field()`（與 confirmedField 相同）、`habit_gate()` 加上「審核完成後已確認的過敏、管路、吞嚥沒有改變」；審核時的醫療資料快照改由資料庫計算。同時修正前端資料轉換：「護理已閱」原本會讓狀態顯示回「待審核」，現在與原型相同只記在歷程。測試：醫療資料改變後評估被擋、重新審核後通過、資料庫與規則逐筆比對（docs_ready、habit_gate、confirmed_field）。

### 階段 8（care-summary.html）
- **資料庫**（`000031_care_cards.sql`）：open_care_card（第一次開放新增一張；修訂草稿開放時舊版標示「已取代」，同一交易）、revise_care_card、discard_care_card、stop_care_card、resume_care_card、case_cards（護理讀草稿與歷史內容）、my_care_card（照服員）。開放條件 `card_allowed`：授權有效、已簽約、評估通過、文件齊全、診斷已同步（`dx_synced`）、習慣卡初審通過；照服員必須是啟用中的照顧服務員。
- **Edge Function care-card**（已部署）：照服員依權限讀不到案件其他資料，伺服器端用同一份規則（cardChanged）算出依據已變更的欄位，只回傳摘要卡內容、版本、開放者姓名、住民姓名與預計入住日；停用的卡不回傳內容。
- **畫面**（`js/modules/care-summary.js`）：護理審核並開放（區塊 A 已確認資料、區塊 B 家屬提供、資料差異待確認、用藥安全提示、選照服員）、已開放後的管理（修訂、停用、重新開放、歷史版本）；照服員看卡（三種語言欄位標題、未經母語人士確認的標示、依據變更欄位顯示「請問護理站」、停用時只顯示已停用）。摘要卡規則移到 `rules/card.js`（從原型逐字移轉）。
- **與原型不同**：原型在收治評估通過時就把草稿存進資料庫（ensureCard），新版第一次開放前不存草稿，畫面依同一套規則即時產生（開放條件與畫面相同）；摘要卡「待重新審核」狀態不另外存，由規則即時判斷（cardChanged）。摘要卡開放後護理改變照護文件需求判斷（原型 cardNeedChange）改由需求判斷歷程推得，不另外存。護理的摘要卡管理（修訂、停用）從住民資料頁移到 care-summary.html，住民資料頁只顯示狀態與連結。
- 與原型畫面對照 2 組（審核照顧摘要卡、照服員看摘要卡）：版面一致（照服員名字排列順序不同）。
- **使用者決定（2026/11/23）：重新開放補上伺服器端檢查**（`000032`）：「停用期間依據資料改變就不能重新開放、要改用修訂」改由 Edge Function care-card（action: resume）用同一份規則 cardChanged 檢查，通過才以 service role 呼叫 `resume_care_card_as`（再檢查承辦身分與狀態、記錄實際操作的護理師）；前端不能再直接呼叫 `resume_care_card`。測試：直接呼叫被擋、非承辦護理與行政被擋、依據改變時拒絕且卡維持停用、恢復後可重新開放、操作紀錄記到護理師。

### 階段 9（settings.html）
- **資料庫**（`000033_admin.sql`、`000034_fix_org_settings.sql`）：
  - `system_env`（是不是測試環境；migration 寫「否」，`npm run db:seed` 對測試專案設成「是」）與 `is_test_env()`。
  - 帳號：核准／退回、停用／啟用、變更角色（回傳要改派的案件數；離開護理角色時取消案件分配權限）、案件分配權限（只限護理人員）。只限啟用中的管理員、不能改自己、處理過的申請不能再核准，都記操作紀錄。
  - 機構設定 `update_org_settings`：版本號防止兩位管理員同時修改、天數範圍檢查、合作醫院清單一起更新（000034 修正：Supabase 不接受沒有條件的 UPDATE）。
  - 結案與封存：結案清單、延長保存；封存的資料庫部分 `archive_case_as`（版本標示檔案已刪除、刪除核對草稿與 AI 結果、案件標示封存）只給後端。
  - 寄送異常 `admin_mail_issues`：寄送失敗、寄送中逾時、待寄送超過 10 分鐘、補件存在但沒有通知工作。
  - 測試資料 `reset_test_cases`：只在測試環境、只限 T-A～T-D、只給後端；操作紀錄保護只在執行期間對這 4 筆放行。
- **Edge Functions**（皆已部署）：`admin-users`（重設臨時密碼：Auth Admin API，首次登入要改密碼）、`admin-archive`（Storage 刪除原始檔案後封存；有檔案刪除失敗時狀態記「處理未完成」）、`admin-testdata`（狀態、恢復起始狀態、只建立缺少的；與 `npm run db:seed-cases` 共用 `scripts/test-cases-core.mjs`，由 functions:sync 複製到 `_shared/`）。
- **畫面**（`js/modules/settings.js`）：帳號管理、機構設定（含內建文件清單、資料存取與權限說明）、結案與封存、操作紀錄（每頁 50 筆，可往前翻頁）、寄送異常、測試資料。
- **與原型不同**：
  - 多一個「寄送異常」分頁（HANDOFF 要求，原型沒有）。
  - 「資料存取與權限」說明：原型寫「尚未實作資料庫端權限」，正式版已實作（RLS、Storage policy、RPC），改寫成實際情況。
  - 操作紀錄原型一次列出全部，正式版每頁 50 筆。
  - 內建文件清單與原型相同是唯讀參考（HANDOFF 提到的「文件清單設定」編輯功能，使用者決定現在先不做）。
  - 入住流程順序：「先審後簽」標示（建議），「先簽後審」收在「其他流程」並加說明（使用者決定，見待確認事項 13）。
- 與原型畫面對照 4 組（帳號管理、機構設定、結案與封存、測試資料）：版面一致；差異只有多出的「寄送異常」分頁與頁尾文字。

---

### 階段 10（進行中）
- **部署（2026/11/23）**：Netlify，網址 https://longhealthcare.netlify.app （公開；Deploy Preview 也公開，但只在開 Pull Request 時產生）。設定在 `netlify.toml`（建置指令、輸出 dist、安全標頭：禁止被嵌入、nosniff、Referrer-Policy、測試站不被搜尋引擎收錄；assets 長期快取）。Netlify 後台只填 4 個公開值（VITE_SUPABASE_URL、VITE_SUPABASE_ANON_KEY、VITE_APP_ENV=test、VITE_ENV_NOTE），沒有任何秘密。push 到 main 會自動重新部署。
- 部署前檢查：打包結果沒有秘密（`sb_secret_` 只出現在 Supabase 套件判斷金鑰格式的程式碼）；git 全部歷史沒有 commit 過秘密（repo 是公開的）。
- Supabase Auth 網址設定（使用者 2026/11/23 設定，截圖確認）：Site URL＝https://longhealthcare.netlify.app；Redirect URLs＝http://127.0.0.1:5173/**、http://localhost:5173/**、https://longhealthcare.netlify.app/**。
- **Netlify 免費方案用點數計算**：每次正式部署約 15 點，每月 300 點（約 20 次部署）。修改要集中後再 push。
- 測線上網站：`E2E_BASE_URL=https://longhealthcare.netlify.app npx playwright test`（playwright.config.js 新增）。測試的登入輔助函式改成被「登出後的轉址」打斷時重試（線上網站有網路延遲才會出現）。
- 線上網站實測：main 組 73 條（第一次 3 條因上述轉址相撞失敗，修正後重跑那 3 個檔案 42 條全過）、writes 組 15 條全過。

- **偶發載入太慢的處理（2026/11/23）**：資料庫統計 get_case_models 平均 840ms、最高 7.8 秒，但閒置時實測 120～350ms，是測試同時執行時雲端免費方案資源不足的尖峰。(1) 網站：讀取案件資料遇到暫時性錯誤（查詢逾時 57014、網路中斷、5xx）時等 1 秒自動再讀一次（只限讀取；`services/model.js` isTransient，單元測試 `tests/unit/retry.test.js`）。(2) 測試：Playwright 失敗自動重跑一次（retries: 1），重跑才過的會標成 flaky，回報時分開寫。
- **HANDOFF 第 3 節逐條檢查（靜態檢查）**：五種角色與兩種流程都在；秘密只在 Edge Functions（前端與 git 歷史掃描過）；Storage 私有、檔案用 10 分鐘 signed URL；電子同意示範字樣、Email 模擬標示、FHIR 標示「尚未介接」都有；沒有承諾電話或審核時限；補件 Email 不含病歷、診斷、身分證字號。提醒：補件原因是行政自由輸入，接正式郵件服務時要提醒行政不要在原因寫醫療內容（或另做檢查）。
- **交件 README.md**：網站連結、各角色測試帳號（密碼另外提供，不寫進 repo）、8 個頁面、程式碼與 SQL 檔位置、安全設計摘要、開發與測試指令。

## 4. 測試狀態（2026/11/23 實際執行）

| 測試 | 結果 |
|---|---|
| 單元（`tests/unit`）：帳號格式、導覽列唯一選取、頁面權限＋**原型規則對照 316 個情境**＋個別規則＋Edge Function 副本一致（2） | 900 通過 |
| 單元：階段 6 收件核對規則與核對欄位定義，**直接執行原型的同名函式逐一比對**（出生日期換算 22 種寫法、比對 12 種組合、各類文件核對欄位、fieldDefs）；導覽列規則更新 | 965 通過（含上一列） |
| 單元：**階段 8** 摘要卡規則（欄位、來源標籤、用藥提示、三種語言標題、cardFromData、buildCard）直接執行原型函式比對 4 項 | 全部 1010 通過 |
| 單元：**階段 7** 護理核對純規則（檢驗數值格式、診斷拆分與重複、欄位來源說明、依條件顯示、ICD 格式）直接執行原型同名函式比對 39 項；導覽列 | 全部 1006 通過 |
| RLS＋RPC（`tests/rls`）：階段 4 寫入函式 14 項（建立申請、重複送出、住民沿用與資料不一致、格式檢查、權限、同意書、聯絡人、習慣卡提交規則、撤回、非本人簽署、人員名冊）；案件／文件隔離、護理只看 B/C/D、分配權限、預設拒絕寫入、操作紀錄不可改、註冊不能取得角色、bucket 私有、**正規化後的關聯與約束 13 項**、**跨案件一致性 3 項**、住民資料隔離（38）＋**資料庫→get_case_models→轉換→規則，4 筆測試案件 × 4 種身分與原型相同**（24）＋**階段 5 寫入函式 18 項**（確認、兩位行政同時確認、利益衝突、不受理、分配權限與同時分配、代理權核實、簽約、結案、協調四種結果、參訪、入住日、需求判斷、請護理重新判斷）＋清除測試資料的界線（3）＋分配者可見範圍（2）＋Edge Function case-phases（3：權限、階段與原型相同、只回傳階段名稱） | 101 通過 |
| RLS：**階段 8**（`tests/rls/care.test.js`，用 T-C、測完復原）開放權限與照服員身分、重複開放擋下、照服員限閱（沒開放給自己的照服員、護理、行政看不到；直接查表看不到案件與文件）、依據變更回傳變更項目、修訂與取代、放棄草稿、停用與重新開放 | 7 通過（含重新開放的伺服器端檢查；全部 146 通過、1 個付費 OCR 實測預設跳過） |
| RLS：**階段 7**（`tests/rls/assessment.test.js`）需求判斷自動補件與關閉、核對草稿權限與版本、完成核對（醫療資料、診斷同步、新版取代）、退回補件、補充評估、診斷 ICD 格式與同時修改、習慣卡初審各情境、收治評估前置條件與需補充、**docs_ready 與規則逐筆比對** | 12 通過（全部 139 通過、1 個付費 OCR 實測預設跳過） |
| RLS：**階段 6**（`tests/rls/documents.test.js`）上傳與 Storage 權限（別的家屬不能上傳／讀、護理只讀承辦案件 B/C/D、行政讀醫療檔案要先開啟且只記一次）、收件核對、身分待確認、確認日期與過期補件、要求補件（護理判斷擋下、取代不結案）、一般提醒、補件自動關閉、沿用檔案、機構文件、新增文件、補件 Email 7 項（權限、建立失敗只建通知、sync 不重複、失敗重試、**兩人同時重試只寄一次**、**認領逾時與舊 send_key 不能寫回**、**結案與被取代不寄**）、OCR 權限、**doc_status 與 req_event 逐筆和規則比對** | 全部 127 通過（另 1 個是會產生費用的 OCR 實測，以 RUN_OCR_LIVE=1 單獨執行並通過：讀出樣本體檢報告日期 2026-11-05，與圖上相同） |
| E2E（`tests/e2e`）：階段 2 的 45 條＋dashboard 12 條＋**階段 5 的 8 條**（案件列表、詳情、分配頁、權限；確認→分配→更換→參訪→家屬看到預約、協調→簽約→結案、利益衝突、不受理）＋**階段 4 的 6 條**（家屬完整流程、住民資料不一致與行政處理、監護人簽署、撤回同意、不同意、看不到別人的申請；寫入類放在 `tests/e2e/writes`，其他 E2E 跑完才執行） | 71 通過 |
| E2E：**階段 6** 6 條（家屬上傳→行政從工作清單收件核對（民國年出生日期）→要求補件→Email 模擬寄送→家屬看到補件進度與 Email 狀態；體檢報告填日期→收件→核對日期確認過期→補件追蹤與再次提醒；流程說明清單、看文件、各角色權限、補件追蹤） | 全部 77 條，連續兩次全部通過（同時 2 個瀏覽器） |
| E2E：**階段 8** 4 條（照服員看卡與語言切換、沒開放給自己看不到、護理管理頁；護理從工作清單審核開放→照服員看到→停用→照服員只看到已停用，測完復原 T-C） | 全部 85 條通過（第一次有 2 條舊測試停在「系統載入中」超過 10 秒，重跑全過） |
| E2E：**階段 7** 4 條（護理從工作清單：需求判斷→逐欄核對（診斷拆分、不採用、草稿重新整理保留）→完成→診斷清單→習慣卡初審→評估前置條件；負責住民與住民資料、核對頁、權限） | 全部 81 條通過（第一次有 2 條舊測試因雲端載入超過 10 秒逾時，重跑全過） |
| 單元：**階段 9** 導覽列等更新 | 全部 1011 通過 |
| RLS：**階段 9**（`tests/rls/admin.test.js`，暫時帳號、機構設定改完改回、T-B 恢復起始狀態）帳號核准／退回／重複核准、停用後資料庫不認角色、變更角色與分配權限、不能改自己、重設臨時密碼（Edge Function）、機構設定版本號與範圍、延長保存中不能封存、封存刪除 Storage 檔案與標示、寄送異常權限、測試資料（Edge Function，恢復 T-B）、刪除測試案件只限 T-A～T-D 與後端 | 9 通過（全部 155 通過、1 個付費 OCR 實測預設跳過） |
| E2E：**階段 9** 3 條（管理員各分頁與操作紀錄翻頁、其他角色不能進入；核准員工→開啟分配權限→重設臨時密碼→對方登入要改密碼） | 全部 88 條：main 組 73 條（第一次 1 條舊測試停在「載入中」超過 10 秒，單獨重跑通過）、writes 組 15 條（資料庫閒置時單獨執行全部通過） |
| **階段 10 全面驗收（2026/11/23，本機，單元→RLS→E2E 依序連續執行）** | 單元 1013 通過；RLS 155 通過（1 個付費 OCR 實測跳過）；E2E main 組 73 條全過（沒有 flaky）、writes 組 9 過 2 失敗 4 未執行（重跑後仍停在載入中／上傳中超過 15 秒：連續跑二十多分鐘後雲端持續變慢）。資料庫閒置後單獨重跑 writes 組 15 條全過（沒有 flaky） |
| 階段 10 線上網站（Netlify） | main 組 73 條、writes 組 15 條通過（見上方階段 10） |
| 原型畫面對照（`tests/visual`） | 42＋7＋4＋2＋4 組截圖（階段 6～9 新增），人工比對後已修正或說明差異 |

**需人工驗收**：用真實 Email 走一次「忘記密碼」，確認信中連結回到「設定新密碼」畫面（轉址設定無法自動測）。

---

## 5. 還沒做／已知限制
- **全部測試不要一口氣連續跑**：RLS＋E2E 連續二十多分鐘後，雲端免費方案會持續變慢，最後幾條寫入流程測試會逾時（重跑也一樣）。驗收時各組分開跑、中間間隔幾分鐘。
- **E2E 偶發「系統載入中…」超過 10 秒或「statement timeout」**（階段 6～9 多次出現，每次不同測試，重跑就過）。階段 9 查到的線索：資料庫統計中 `get_case_models` 平均 840ms、最高 7.8 秒，但資料庫閒置時以各角色實測只要 120～350ms（目前 6 筆案件），所以是測試連續、同時執行時雲端免費方案資源不夠造成的尖峰，不是查詢本身慢。階段 10 決定處理方式（例如 writes 組改成 1 個瀏覽器、畫面讀取失敗自動重試一次、或升級方案）。
- 上傳後如果建立版本失敗，Storage 會留下沒有版本的檔案（重試會沿用同一個檔案）；目前沒有清理功能（管理員畫面沒有做，需要時再加）。
- 封存只能由管理員手動執行（與原型說明相同：到期自動刪除屬第二階段）。
- 護理「已完成工作」：原型會列出**已移交給別人**的案件的處理摘要；正式版護理讀不到已移交的案件，所以目前不顯示。需要時可加一個只回傳摘要的 RPC。
- 診斷清單的「標準化名稱」（原型 d.std）資料表還沒有欄位，階段 7 一併加入。
- **不要同時跑 Vitest 和 Playwright**：一組結束時的自動清除，可能刪掉另一組正在用的暫時案件。
- **Supabase access token 有效期限**（建立時選的天數）：過期後部署會失敗，要在後台重新產生並更新 .env.secrets。
- **Claude API key**（OCR 用，Claude Console 個人帳號，名稱 longhealthcare-ocr）：**2027/1/31 到期**；帳號設定每月支出上限 US$10。到期前要產生新 key，更新 .env.secrets 的 ANTHROPIC_API_KEY 並重新設定 Edge Function secret。
- 申請確認 Email 的「重新寄送」只記錄嘗試；補件 Email 由 send-mail 模擬寄送。正式郵件服務等使用者決定（待確認事項 3）。
- OCR 費用算在使用者個人的 Claude Console 帳號（上限 US$10／月）；交件給客戶審查時要留意。
- 行政用 application.html 會導到 cases.html（HANDOFF 寫「授權行政」也會用這頁，目前沒有原型對應畫面，有需要再確認）。
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

- **多位行政（2026/11/22 使用者決定）**：維持原型的共用工作清單，不加「承辦行政」。所有行政看到同一份待辦與徽章；兩人同時處理同一件事時，由資料庫鎖定與狀態檢查擋下後到的人（之後各階段的寫入 RPC 都要照這個做法）；處理歷程記錄實際操作人。利益衝突案件（selfConflict）由其他行政處理。

## 7. 待確認事項
1. 頁尾文字（HANDOFF 15-1）：目前暫定「目前為測試環境：資料存放於 Supabase 測試專案，非正式服務。（頁尾文字待確認）」，在 `.env` 的 `VITE_ENV_NOTE`。
2. FHIR 交換介接是否保留（15-2）。
3. 正式 Email 服務（15-3）。
4. F1、F3、F4、F12 定義（15-5）。
5. C-0003 劉春梅：等階段 4 用正常流程建立，還是另有資料？
6. 部署方式與網域（15-8）：**使用者決定（2026/11/23）：Netlify**，先用 Netlify 免費網址（之後可換客戶網域）；設定在 netlify.toml。部署後要把網址加進 Supabase Site URL 與 Redirect URLs。
7. 測試專案的 secret key 與資料庫密碼曾出現在對話中，放真實資料前要更換。
8. ~~是否需要 Postgres 版的案件階段函式~~：分配頁改由 Edge Function 用同一份 JS 規則計算（2026/11/22）。
9. ~~同一身分證字號資料不同~~：已決定（擋下並通知行政處理），階段 4 完成。
10. **OCR 與個資同意（2026/11/22 提出）**：OCR 會把醫療文件影像傳給 Anthropic（Claude API）辨識。目前個資同意書寫「只提供給康和長照中心」，是否要在同意書補充「文件辨識委託外部服務處理」，需要客戶決定；放真實資料前要確認。
11. Supabase access token 曾出現在截圖中，要撤銷並重新產生。**使用者決定（2026/11/22）：全部階段完成後再換**；換的時候順便確認新 token 有 Edge Functions Write 與 Secrets 權限。
12. ~~文件清單設定~~：**使用者決定（2026/11/23）：現在先不做編輯**，維持原型的唯讀參考清單。
13. ~~先簽後審的顯示方式~~：**使用者決定（2026/11/23）**：機構設定頁「先審後簽」標示（建議），「先簽後審」收在「其他流程（少數機構使用）」並加說明；目前設定是先簽後審時自動展開。

---

## 8. 下一步：階段 10（全面驗收與部署到測試專案）
- 全面驗收：全部測試連續跑、HANDOFF 第 3 節限制逐條檢查、各角色人工走一次主要流程。
- 處理偶發「載入中／statement timeout」（第 5 節）。
- 部署靜態網站（主機與網域待使用者決定，待確認事項 6）；正式網址加進 Supabase Redirect URLs。
- 交件整理：網站連結、各角色測試帳號與密碼（密碼不寫進 repo，另外交付）、GitHub 共用給客戶、README 說明程式碼與 SQL 檔（`supabase/migrations/`）位置。
- 最後輪替曾外洩的 Supabase access token、secret key、資料庫密碼（待確認事項 7、11）。
