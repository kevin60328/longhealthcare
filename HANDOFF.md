# HANDOFF：長照入住前收件系統（8 頁 HTML＋Supabase 正式版）

> 給 Claude Code 的交接文件（第 2 版，2026/11/21）。
> 依據：原型第 (18) 版單一 HTML、11/08–11/17 的需求討論，以及客戶本週確認的《8 個 HTML 功能模組分工規劃書（Supabase 統一儲存版本）》（`reference/client_plan_8_html.pdf`）。
> **本版取代第 1 版 HANDOFF**。兩版的主要差異：
> - 資料統一存在 Supabase，HAPI FHIR 不再當資料庫；
> - 前端改成 8 個 HTML 頁面，不用 Next.js；
> - 加入客戶的驗收要求。

---

## 0. 先讀這段（給 Claude Code）

1. **目標**：把原型第 (18) 版（單一 HTML，資料存在 Claude 測試資料庫）拆成 **8 個 HTML 頁面**，所有資料改存 **Supabase**，功能與原型一致。
2. **原型只是功能對照基準**：`reference/prototype_v18.html` 用的是 `claude.use('db')`，在 VS Code 不能直接執行，也**不能保留任何對 Claude 測試資料庫的依賴**。行為有疑問時，到原型裡搜尋第 9、10 節列出的函式名稱。
3. **逐模組移轉，不要一次大改**：照第 13 節的順序，每完成一個模組就跑該模組的測試，回報後再做下一個。
4. **第 3 節的限制不能違反**。不確定的地方（特別是第 15 節的待確認事項）先停下來問使用者，不要自己補規則。
5. **回報測試時要誠實**：分開寫「實際執行並通過」「靜態檢查」「需人工驗收」「無法測試」。沒跑過的測試不能寫成通過。
6. **只能在測試環境開發與驗收**：本機 Supabase 或另一個測試專案。不要連到正式專案，也不要覆蓋任何既有線上資料。

---

## 1. 專案背景

- 台灣住宿式長照機構（示範名稱「康和長照中心」）的**入住前收件系統**，是專題組作品，要交給客戶（機構）。
- 處理的工作：家屬入住前要交 20 多份文件，機構要收件、核對身分與醫療內容、評估是否收治、簽約；入住第一天照服員需要一張照顧摘要卡（中文、印尼文、越南文）。
- 原型的住民、家屬、醫院、文件都是**虛構**的。正式版在客戶提供真實資料前，也只能使用測試資料。

---

## 2. 架構決議（客戶 11/21 確認）

| 項目 | 決議 |
|---|---|
| 前端 | **8 個 HTML**，依業務功能分頁（不是依角色）。共用 CSS、JavaScript、登入驗證、權限檢查、Supabase 存取模組 |
| 帳號驗證 | Supabase **Auth**（不自己存密碼，不使用原型的 PBKDF2 帳號表） |
| 結構化資料 | Supabase **PostgreSQL**：人員與權限、住民與案件、醫療／照護結構化資料、文件索引、簽約與代理權核實、補件、核對草稿、OCR 結果、評估、習慣卡、摘要卡、通知、稽核紀錄 |
| 檔案 | Supabase **Storage 私有 bucket**：身分與代理權證明、病歷 PDF、影像、處方箋、檢驗報告、已簽署文件。資料表只記檔案路徑、版本、關聯 |
| 權限 | **RLS＋後端 API**：依角色與個案授權驗證讀寫，不能只靠前端隱藏 |
| 後端處理 | Supabase **Edge Functions**／Postgres 函式：OCR、實際 Email 寄送、跨資料表寫入、敏感操作 |
| HAPI FHIR | **不當第二套資料庫**。是否保留 FHIR 交換介接，要等客戶另外確認（第 15 節） |

客戶補充說明：
- 取消 HAPI FHIR 儲存，不代表系統會自動取得院外病歷。如果 FHIR API 介接也取消，跨院自動調閱或標準交換的功能就要取消，或改用明確授權的其他資料來源。
- 原型**沒有**自動調閱院外病歷的功能，文件都由家屬上傳、再由 AI 辨識並人工確認，所以目前沒有需要取消的功能。原型的護理核對頁有一欄「預計對應的 FHIR R4 資源」（`FHIR_MAP`），只是規劃說明。這欄在正式版要不要保留，跟著 FHIR 介接的決定。

---

## 3. 不可違反的限制

### 3.1 範圍
- 不改五種角色（family / staff / nurse / care / admin）、F0–F12 功能架構、兩種入住流程（先審後簽、先簽後審）。
- 拆頁**不能改變**這些流程：行政確認與轉交、案件分配、家屬授權、文件上傳、收件與護理核對、補件追蹤、護理評估、摘要卡開放與版本歷程。
- 不新增「文件規則版本」功能，不重新設計整套流程。

### 3.2 安全
- Supabase `service_role` key、Claude API key、Email 服務 key 都**只能放在 Edge Functions 的環境變數**。前端只能有 Supabase URL 和 anon key（anon key 本身是公開的，要靠 RLS 保護資料）。
- 不能把帳號密碼或私人憑證寫在程式、HTML 或版本控制裡。`.env` 要加進 `.gitignore`。
- 前端隱藏按鈕不等於權限控制。所有讀寫都要在 RLS 或 Postgres 函式／Edge Function 裡再檢查一次。
- Storage bucket 必須是**私有**。看檔案用短時效的 signed URL。

### 3.3 誠實與法律
- 不能把示範資料說成真實資料；不能編造 FHIR profile 或醫院 API。
- 個人資料同意書 ≠ 入住契約 ≠ DNR ≠ 預立醫療決定，不能混在一起。
- 登入密碼、輸入姓名、勾選同意、手寫圖片，都不能單獨宣稱為符合法律要求的數位簽章。畫面要寫「電子同意流程示範，正式簽署及法律效力仍須確認」。
- 沒有接上的服務（Email、電子簽章、金流、FHIR 交換）不能假裝已完成。Email 沒接正式服務前一律標示「模擬」。
- 不承諾固定的電話聯絡或審核時限。
- Email 內容不能有病歷、診斷、檢驗數值、身分證字號等敏感資料。

### 3.4 資料
- 每項儲存都要**確認寫入成功後**才更新畫面上的完成狀態。失敗要清楚提示，並提供重試。
- 保留版本、錯誤提示、重試與稽核紀錄。不覆蓋歷史紀錄或已發出的通知。
- 舊資料規則要保留（例如舊版提醒不是補件、舊版習慣卡視為已提交），即使正式版從新資料開始。
- 原型的文件 key（`idcopy`、`meds` 等）、角色代碼、狀態文字沿用，不要改名。

---

## 4. 交接檔案（reference/）

| 檔案 | 內容 |
|---|---|
| `client_plan_8_html.pdf` | 客戶確認的 8 頁分工規劃書（3 頁） |
| `prototype_v18.html` | 原型第 (18) 版（備份與功能對照）。SHA-256：`8931b6b33fd4fb7389436bcd4929c45e47972c11ad43407b1c75cb775e54e51e` |
| `doclist.json` | 內建 24 項文件清單（七大類、繳交類型、時機、有效天數）。`fam` 欄位是舊文字「長輩」，畫面要顯示「住民」 |
| `seed.json` | 原型測試資料：帳號、張秀英／陳金水／劉春梅三個案件、文件。用來寫正式版的 seed script（不要匯入密碼雜湊） |
| `mock_db.js` | 原型的模擬資料庫（只用來在本機跑原型對照） |
| `tests/run_*.py` | 原型的 Playwright 驗收腳本（Python，共 775 條）。每個 `check('編號','情境','預期',條件)` 都是一條驗收條件，移植時改成新架構的測試 |
| `sample_docs/*.png` | 23 張模擬文件圖片（印有「模擬文件，非真實病歷」），E2E 測試上傳用 |

在本機跑原型對照：用 Playwright 開 `prototype_v18.html`，先注入 `window.__SEED = <seed.json>` 再注入 `mock_db.js`（做法見 `tests/run_s.py` 開頭）。腳本內的路徑寫死為 `/home/claude/simp/...`，要改成 `reference/` 的實際路徑。AI 辨識在本機不能用。

---

## 5. 角色與權限

| 角色 | 代碼 | 可以看 | 可以做 |
|---|---|---|---|
| 家屬／申請人 | `family` | 自己提出的申請 | 提出入住申請；簽署或撤回個資同意書；上傳與補件；緊急聯絡人；填寫並正式提交習慣卡；看處理歷程與通知 |
| 行政／社工 | `staff` | 所有案件與所有文件檔案（收件需要）。**行政每次打開醫療類文件（B、C、D 類）都寫入操作紀錄**（同一版本只記一次）；醫療內容的逐欄核對由護理負責 | 確認申請並轉交護理部門（不指定護理師）；核實代理權；收件核對身分；確認檢查日期；要求補件；請護理重新判斷；記錄簽約；上傳機構文件；參訪與保證金；協調與結案；補件 Email 重試 |
| 護理人員 | `nurse` | 自己承辦的案件；只看 B、C、D 類（健康檢查、醫療、照護）文件。身分、授權、契約、費用類（A、E、F）由行政處理，護理端不顯示 | 判斷照護文件是否需要；AI 辨識後逐欄核對醫療內容；診斷清單；習慣卡初審；收治評估；入住前護理確認；審核並開放照顧摘要卡 |
| 護理＋案件分配權限 | `nurse` 且 `can_assign_nurse` | 另外可看待分配案件 | 指定或更換承辦護理師（更換要填原因，保留歷程）。這是帳號設定，**不是新角色** |
| 照顧服務員 | `care` | 只有開放給自己、而且已開放的摘要卡 | 只能看。看不到原始文件、證件、契約、費用 |
| 系統管理員 | `admin` | 帳號、設定、紀錄 | 核准員工帳號與角色、開關案件分配權限、重設密碼、機構設定、保存規則、寄送異常、操作紀錄、結案封存、測試資料（只在測試環境） |

- 入口只有兩個：「一般申請人」「機構工作人員」。入口只決定登入畫面，權限依帳號角色。工作帳號不能提出入住申請。
- 員工註冊後狀態為「待審核」，管理員核准後才能用。家屬註冊後即可使用。

---

## 6. 八個 HTML 頁面

### 6.1 頁面與功能（客戶規劃）
| # | HTML | 模組 | 主要功能 | 使用者 |
|---|---|---|---|---|
| 1 | `login.html` | 登入與帳號 | 入口選擇、登入、註冊、忘記密碼／重設、首次登入改密碼、登入分流 | 所有角色 |
| 2 | `dashboard.html` | 首頁與工作清單 | 依權限顯示個人首頁、待處理／已完成工作、通知、待辦數量 | 所有角色 |
| 3 | `application.html` | 入住申請與授權 | 家屬申請、住民基本資料、個資同意、代理權資料、緊急聯絡人、習慣卡（草稿／提交） | 家屬、授權行政 |
| 4 | `cases.html` | 個案管理 | 案件查詢與確認、轉交、承辦護理師分配、簽約紀錄、案件狀態、處理歷程、參訪與保證金、協調與結案 | 行政、授權護理、管理員 |
| 5 | `documents.html` | 文件與補件管理 | 文件上傳與版本、收件與身分核對、日期效期、OCR、缺漏／補件、補件 Email 追蹤 | 家屬、行政、護理（依權限） |
| 6 | `assessment.html` | 護理核對與評估 | 負責住民、照護文件需求判斷、醫療內容逐項核對、診斷清單、習慣卡審核、收治評估、入住前護理確認 | 護理 |
| 7 | `care-summary.html` | 照顧摘要卡 | 已確認資料摘要、審核、開放、版本與重新審核；照服員限閱 | 護理（編審）、照服員 |
| 8 | `settings.html` | 系統管理 | 帳號審核、角色與分配權限、機構設定、文件清單設定、保存規則與封存、寄送異常、操作紀錄、測試資料 | 管理員 |

### 6.2 原型畫面對應（`route.page` → 新頁面）
用網址參數區分頁面內的畫面，例如 `documents.html?view=receipt&item=<id>`。拆頁後瀏覽器的「上一頁」要能正常使用（原型做不到，正式版要做到）。

| 原型畫面（函式） | 新頁面 | 建議網址 |
|---|---|---|
| login、register、forgot、password（改密碼）、入口選擇 | login.html | `?view=login|register|forgot|password` |
| familyPersonal（家屬個人首頁）、familyMyCases、familyNotices | dashboard.html | `?view=home|mycases|notices` |
| staffHome（個案資料夾）、nurseHome（個案資料夾）、care 首頁（我的住民清單） | dashboard.html | `?view=home` |
| familyHome（案件詳情：目前要做的事、進度條、補件進度摘要、處理歷程） | application.html | `?case=<id>` |
| familyApply、familyApplyPreview、familyApplied | application.html | `?view=apply|preview|applied` |
| familyConsent、familyContacts、familyLife（習慣卡） | application.html | `?view=consent|contacts|habit&case=<id>` |
| staffCases、staffCase、staffApply（確認申請） | cases.html | `?view=list`、`?case=<id>`、`?view=confirm&case=<id>` |
| nurseAssignPage（案件分配） | cases.html | `?view=assign` |
| familyGuide（完整文件清單）、familyUpload、familyUploaded | documents.html | `?view=list|upload|uploaded&case=<id>&item=<id>` |
| staffReceipt（收件核對）、staffDate（日期確認）、staffFollowup（補件追蹤）、docPage（看文件） | documents.html | `?view=receipt|date|followup|doc&item=<id>` |
| 補件 Email 通知區塊（reqMailCard） | documents.html（行政案件頁也嵌入同一個元件） | `?view=mail&case=<id>` |
| nurseResidents、nurseResident | assessment.html | `?view=residents`、`?case=<id>` |
| nurseSupp（照護文件需求判斷）、nurseReview（醫療內容核對）、習慣卡初審、nurseAssess | assessment.html | `?view=need|review|habit|assess&...` |
| nurseCard（摘要卡編審）、careCard（照服員看摘要卡） | care-summary.html | `?case=<id>` |
| adminAccounts、adminSettings、adminArchive、adminLogs、adminTestData | settings.html | `?view=accounts|org|archive|logs|testdata` |
| 寄送異常（**新增**：列出寄送失敗、待建立、寄送中逾時的通知工作） | settings.html | `?view=mail-errors` |

### 6.3 導覽列（八頁共用 `js/navigation.js`）
沿用原型的分頁名稱：

| 角色 | 分頁 → 頁面 |
|---|---|
| family | 我的申請 → dashboard.html；通知 → dashboard.html?view=notices |
| staff | 工作清單 → dashboard.html；案件 → cases.html |
| nurse | 工作清單 → dashboard.html；負責住民 → assessment.html?view=residents；案件分配 → cases.html?view=assign（有分配權限才顯示） |
| care | 我的住民 → dashboard.html |
| admin | 帳號管理、機構設定、結案與封存、操作紀錄、（寄送異常）、測試資料 → settings.html 各 view |

規則：
- **同一時間只有一個分頁是選取狀態**（`aria-current="page"`，藍色底線只由它決定）。目前的頁面和 view 決定選取哪個分頁；詳細頁歸到所屬分頁（例如 assessment.html?case= 歸「負責住民」，documents.html 從行政案件進入時歸「案件」）。不屬於任何分頁的畫面歸第一個分頁。
- 選取判斷要用**畫面實際顯示的分頁清單**計算。原型第 (18) 版修過的 bug 就是另外加上的「案件分配」沒算進清單，導致兩個分頁同時被選取（參考原型 `navTabs()`、`navCurrent()`）。
- 工作清單的紅色徽章 = 待辦數量，切換分頁不影響。
- 頁首有字級切換（標準／大／特大，記在 localStorage）、使用者名稱與角色、登出。頁尾固定顯示環境說明文字（文字待確認，見第 15 節）。

### 6.4 每頁共用的開頭流程
1. `auth.js`：取得 Supabase session。沒有登入就導向 `login.html?next=<目前網址>`。
2. 讀取自己的 `profiles`。狀態不是「啟用」就登出並提示；需要改密碼就導向改密碼畫面。
3. `permissions.js`：檢查這個角色能不能進這一頁或 view，不能就顯示「沒有權限」並提供回首頁。這只是畫面判斷，真正的保護在 RLS。
4. `navigation.js`：畫出導覽列與徽章。
5. 載入對應的 `js/modules/<頁面>.js` 畫出內容。

---

## 7. 程式資料夾配置（依客戶規劃）

```
/
├─ login.html  dashboard.html  application.html  cases.html
├─ documents.html  assessment.html  care-summary.html  settings.html
├─ css/
│  ├─ common.css         # 顏色變數、字級、版面、頁首頁尾、導覽列（選取樣式只認 aria-current）
│  └─ components.css     # 卡片、表格、標籤、按鈕、表單、必填紅星、對話框、toast、進度條、資料夾
├─ js/
│  ├─ api/supabase.js    # 建立 Supabase client（URL、anon key 由 config 帶入）
│  ├─ config.js          # 環境設定（由 .env 產生；不放任何秘密）
│  ├─ auth.js            # session、登入、登出、註冊、忘記密碼、頁面守門
│  ├─ permissions.js     # 角色與個案授權的畫面判斷（與 RLS 規則一致）
│  ├─ navigation.js      # NAV 設定、目前分頁判斷、徽章、字級
│  ├─ ui.js              # toast、對話框、表單錯誤、儲存中／失敗重試、日期與民國年轉換
│  └─ modules/
│     ├─ rules/          # 純函式（不碰資料庫，可單元測試）：phase、docStatus、formalReq、
│     │                  #   habitState／habitGate、stepsInfo、reqState、mailEvent、cardChanged
│     ├─ login.js  dashboard.js  application.js  cases.js
│     ├─ documents.js  assessment.js  care-summary.js  settings.js
│     └─ services/       # 資料存取（呼叫 Supabase 表或 RPC）：cases、documents、requests、mail、
│                        #   habit、consent、assessment、careCard、notices、timeline、audit、ocr
├─ assets/               # 圖片與圖示
├─ supabase/
│  ├─ migrations/        # 資料表、RLS、Postgres 函式（SQL）
│  ├─ functions/         # Edge Functions：ocr、send-mail、admin-users
│  └─ seed.sql           # 測試資料（只用於本機／測試專案）
├─ tests/
│  ├─ unit/              # rules/ 的單元測試
│  ├─ e2e/               # Playwright：兩種流程、各角色跨頁權限
│  └─ rls/               # 以不同身分直接查詢資料庫，確認隔離
└─ reference/            # 本交接資料（原型、文件清單、規劃書、舊測試、模擬文件）
```

**建置工具建議**：用 Vite 的多頁設定（`build.rollupOptions.input` 列出 8 個 HTML），以 ES module 引入 `@supabase/supabase-js`，並用 `.env` 帶入 URL 與 anon key。檔案配置照上面不變。如果使用者不想用建置工具，可以改用 CDN 的 ESM 版本，但要先問。

---

## 8. Supabase 資料設計

### 8.1 資料表（PostgreSQL，`public` schema）
欄位名稱可以由 Claude Code 定稿，但每一列的意義要保留。原型的集合對照放在括號裡。

| 資料表 | 用途（原型對照） | 重點欄位 |
|---|---|---|
| `profiles` | 使用者資料（accounts） | id = auth.users.id、email、name、role、status（啟用／待審核／停用）、phone（必填，檢查格式）、can_assign_nurse、must_change_password |
| `org_settings` | 機構設定（settings/org） | 名稱、電話、合作醫院清單、補件期限天數、預設入住流程、retention_days（預設 365） |
| `doc_catalog` | 文件清單（doclist.json） | key、cat、name、fam_name、need（必備／選填／條件式）、cond、stage（評估前／入住前）、valid_days、medical、inst |
| `cases` | 案件 | no（C-0001…）、family_id、relation、patient_name、patient_nid、patient_birth、chart_no、flow_mode（建立時決定）、hospital、planned_admit、link_status、confirmed_at/by、nurse_id、doc_due、pre_due、signed_at/by、closed_at/by/reason、archived_at |
| `case_assignments` | 承辦分配歷程 | case_id、nurse_id、by、at、reason（更換時必填） |
| `contacts` | 緊急聯絡人 | case_id、name、rel、phone |
| `consents` | 個資同意（consent／consentHistory） | case_id、ver、signer_type（本人／監護人／代理人／受輔助宣告）、signer_name、signed_by、signed_at、state（有效／待代理權核實／代理權未通過）、proof_item_id、verified_by/at、withdrawn_at、emergency、photo |
| `documents` | 案件的每一份文件（items） | case_id、key、name、stage、need、valid_days、medical、cond_met、need_set_by/at/note、not_applicable、remind_n、remind_at、remind_due |
| `document_versions` | 每次上傳（versions） | document_id、v、storage_path、file_name、mime、uploaded_by/at、phase、id_check（行政身分核對結果）、date_prelim、date_confirmed、admin_ok、nurse_ok、from_item（沿用其他文件檔案，例如 X 光沿用體檢報告） |
| `document_returns` | 退回（returned） | document_id、version_v、by、at、reason、note_for_family |
| `document_requests` | **正式補件**（req／reqHistory），每次一列，id 就是補件事件 ID | document_id、case_id、source（護理／行政／系統／護理判斷）、reason、note、due、created_at/by、uploaded_at、closed_at、closed_fix_by、auto |
| `review_drafts` | 護理核對草稿（reviewDrafts） | document_id、version_v、data jsonb、updated_by/at（換版本不沿用） |
| `ocr_runs` | AI 辨識結果（ocrRuns） | document_id、version_v、model、result jsonb、status、error、created_at |
| `medical_facts` | 護理確認的結構化醫療資料 | case_id、document_id、version_v、field、value、confirmed_by/at |
| `diagnoses` | 診斷清單（逐筆） | case_id、text、icd_code、icd_name、status（待確認／已確認／OCR 錯誤／不採用）、reason、source_document、source_version、history jsonb |
| `habit_cards` | 習慣卡草稿（habit.data） | case_id、draft jsonb、draft_updated_at/by |
| `habit_submissions` | 正式提交（habit.sub／subHist） | case_id、rev、data jsonb、submitted_by/at、n |
| `habit_reviews` | 護理初審（habitReview） | case_id、rev、state、diff_res jsonb、note、med_snapshot jsonb、reviewed_by/at |
| `assessments` | 收治評估 | case_id、mode、result、move、behav、iso、reason、by、at（可多次，最新一筆有效） |
| `care_cards` | 摘要卡（版本化：card／cardHistory） | case_id、v、status（草稿／已開放／已停用／已取代）、content jsonb（中文＋印尼文＋越南文）、basis jsonb、review jsonb、opened_by/at、end_at、end_note |
| `care_card_caregivers` | 摘要卡開放給哪些照服員 | card_id、caregiver_id |
| `visits` | 參訪與保證金（只記錄） | case_id、kind、at、note、by |
| `notices` | 給家屬的通知 | case_id、to、text、at、read_at |
| `mail_jobs` | Email 通知工作（mailQueue） | id（補件通知＝`req_<request_id>`）、kind（申請確認／補件通知）、case_id、request_id、to_email、status（待寄送／寄送中／模擬已寄送／已寄送／寄送失敗）、claim_by、claim_at、send_key、attempts jsonb、last_error |
| `audit_logs` | 操作紀錄（logs） | case_id、actor、role、action、detail、at（只能新增，不能改或刪） |

### 8.2 Storage
- bucket `case-files`（private）。路徑：`<case_id>/<document_key>/v<版本>-<uuid>.<副檔名>`。
- Storage policy 與資料表 RLS 使用同一套「能不能存取這個案件、這類文件」的函式。
- 封存時刪除原始檔案，保留 `document_versions` 列，並標示 `file_removed`（原型畫面：「原始檔案已依保存規則刪除，僅保留處理紀錄」）。

### 8.3 RLS 原則
建立 `security definer` 輔助函式，例如 `auth_role()`、`is_family_of(case_id)`、`is_case_nurse(case_id)`、`can_assign()`、`is_caregiver_of(card_id)`。
- family：只能讀寫自己的案件；文件只能新增版本，不能改核對結果。
- staff：可讀所有案件與文件檔案；打開 B、C、D 類檔案時要寫入 `audit_logs`（建議由取得 signed URL 的 RPC 或 Edge Function 一併記錄）。不能修改護理判斷、核對結果與 `medical_facts`。
- nurse：只能存取 `nurse_id = 自己` 的案件，而且只限 B、C、D 類文件（Storage 路徑也要擋）。有分配權限的護理師另外可以讀待分配案件，並更新 `nurse_id`（透過 RPC）。
- care：只能讀開放給自己、而且狀態為「已開放」的 `care_cards`，其他資料表都不行。
- admin：帳號、設定、紀錄；案件只在封存與測試資料功能需要時存取。
- `audit_logs` 只能透過函式新增。

### 8.4 跨資料表寫入要用 Postgres 函式（RPC，一個交易）
原型的 Claude DB 沒有交易，所以只能降低衝突機率。正式版要把下面這些動作寫成 Postgres 函式，在同一個交易裡檢查權限、檢查狀態、寫入、記稽核紀錄：

| RPC | 內容 |
|---|---|
| `create_application` | 建立案件、依 doc_catalog 建立 24 筆 documents、建立申請確認通知；防止重複送出 |
| `confirm_case`、`assign_nurse` | 行政確認轉交；指定或更換承辦（更換要原因） |
| `sign_consent`、`verify_proxy`、`withdraw_consent` | 同意書 |
| `submit_version`、`staff_receipt`、`confirm_date`、`nurse_confirm_document` | 上傳與核對；確認符合時同時關閉開啟中的正式補件 |
| `create_request`、`close_request`、`fix_request_close`、`remind_document` | 補件與一般提醒 |
| `set_care_need` | 照護文件需求判斷；判斷需要時自動建立正式補件 |
| `submit_habit`、`review_habit` | 習慣卡 |
| `save_assessment` | 每次送出前重新檢查前置條件 |
| `record_signing` | 行政記錄簽約 |
| `save_care_card`、`open_care_card`、`disable_care_card` | 摘要卡 |
| `claim_mail_job`、`finish_mail_job` | Email 認領與回寫（條件更新，見第 10.4 節） |
| `close_case`、`archive_case` | 結案與封存 |

### 8.5 Edge Functions
| Function | 內容 |
|---|---|
| `ocr` | 用 service role 讀取 Storage 檔案，呼叫 Claude API 辨識，結果寫入 `ocr_runs`。失敗要回報原因，畫面改成人工輸入。API key 只放在這裡 |
| `send-mail` | 讀取 `mail_jobs`，claim → 確認補件事件仍開啟 → 送出（帶 idempotencyKey）→ 回寫。目前 adapter 是**模擬**（不寄出，狀態記「模擬已寄送（測試環境未實際寄出）」）；正式服務等使用者決定再換 |
| `admin-users` | 管理員核准員工、改角色、停用、重設臨時密碼（需要 service role 的 Auth Admin API） |

---

## 9. 流程與案件狀態（與原型相同，不能改）

### 9.1 先審後簽
1. 家屬註冊或登入 → 個人首頁 →「我要申請入住」→ 確認申請資料 → 送出。系統建立 24 項文件清單。狀態：**待機構確認**
2. 行政電話確認身分，按「確認申請並轉交護理部門」。
3. 有分配權限的護理人員指定承辦護理師（保留歷程）。
4. 家屬簽署個資同意書（輸入簽署人真實姓名）。本人簽署立即生效；監護人、代理人、受輔助宣告者簽署時進入**待代理權核實**，行政核實證明文件後才生效。之後家屬填寫並**正式提交**習慣卡。
5. 承辦護理判斷管路、傷口、吞嚥資料「本案需要／不需要／尚待確認」。判斷需要時，系統自動建立正式補件並通知家屬。
6. 家屬上傳評估前文件。
7. 行政收件、核對身分（比對姓名、身分證字號、出生日期；民國日期自動轉西元）。資料不足時選人工核實方式並留紀錄。
8. 護理核對醫療內容（AI 帶入後逐欄確認；主要診斷逐筆確認並同步到診斷清單）、初審習慣卡；有問題就退回補件。
9. 護理收治評估：收治／需補充／待協調／不收治。DNR 另行確認。
10. 行政記錄「家屬已簽約」（以這個紀錄為完成，不需要上傳契約檔案），並上傳收費明細等機構文件。
11. 家屬上傳入住前文件 → 行政收件、確認檢查日期 → 護理核對。
12. 護理審核照顧摘要卡，開放給指定照服員。
13. 照服員查看摘要卡（中文／印尼文／越南文）。

### 9.2 先簽後審
- 一開始就要求全部文件（分成評估前、入住前兩組）。
- 文件齊全後家屬先簽約，再由護理做入住前確認。
- 評估結果：可入住／需補充／待協調／不符合收治條件。
- 流程在案件建立時決定；改機構設定只影響之後新建的申請。

### 9.3 `phase(case)`（放在 `js/modules/rules/`，另外在 Postgres 寫一份同邏輯的 view 或函式供列表查詢）
狀態值：已結案、待機構確認、待同意、待代理權核實、待補件、評估待補件、文件審查中、評估中、待協調、已收治待簽約、入住前文件審查、待簽約、入住前確認中、摘要卡審核中、摘要卡已停用、摘要卡待重新審核、摘要卡已開放。

```
已結案 → linkStatus≠已確認：待機構確認 → 同意未簽或代理權未通過：待同意 → 已撤回：已結案 → 待代理權核實
先審後簽：未評估或需補充 → (文件齊全 且 habitGate) ? 評估中 : 評估待補件／待補件／文件審查中
          待協調類 → 待協調；不收治 → 已結案；未簽約 → 已收治待簽約；入住前文件未齊 → 待補件／入住前文件審查
先簽後審：(文件未齊 或 (未評估 且 !habitGate)) → 評估待補件／待補件／文件審查中；未簽約 → 待簽約；
          未評估或需補充 → 入住前確認中；待協調類 → 待協調；結果≠可入住 → 入住前確認中
之後：沒有摘要卡或草稿 → 摘要卡審核中；已停用；cardChanged 有變更 → 摘要卡待重新審核；否則 摘要卡已開放
```
- `COORD_RESULTS = ['待協調','不符合收治條件']` 一律顯示「待協調」。
- 家屬端進度條（`stepsInfo`）每一步顯示**實際完成日期**。日期來自已存的事件時間；沒有紀錄就顯示「日期未記錄」，不能補假日期。

---

## 10. 業務規則（原型逐版修正過，全部要保留）

### 10.1 文件清單（`doclist.json`，24 項，七大類 A–G）
| 類 | key | 名稱（家屬端名稱） | 繳交 | 時機 | 有效天數 | 核對者 |
|---|---|---|---|---|---|---|
| A | idcopy | 住民身分證明文件 | 必備 | 評估前 | — | 行政 |
| A | nhi | 健保卡 | 必備 | 評估前 | — | 行政 |
| A | signerId | 簽約者身分證明文件 | 必備 | 入住前 | — | 行政 |
| A | relProof | 戶籍資料或代理權限證明 | 條件式（簽約者不是住民本人，或由代理人處理；行政判斷） | 入住前 | — | 行政 |
| B | exam | 入住前健康檢查報告 | 必備 | 入住前 | 90 | 護理 |
| B | xray | 胸部 X 光報告（可沿用體檢報告檔案） | 必備 | 入住前 | 90 | 護理 |
| B | stool | 糞便檢驗報告 | 必備 | 入住前 | 14 | 護理 |
| B | otherExam | 其他指定檢查報告 | 選填 | 入住前 | — | 護理 |
| C | summary | 出院病歷摘要／近期就醫摘要 | 必備 | 評估前 | — | 護理 |
| C | meds | 目前用藥清單或處方資料 | 必備 | 評估前 | — | 護理 |
| C | diag／labs／followup | 診斷證明書／近期檢驗及影像報告／回診預約資料 | 選填 | 評估前 | — | 護理 |
| D | tubeCare | 管路留置與照護紀錄（管路照護資料） | 條件式（護理判斷） | 評估前 | — | 護理 |
| D | woundCare | 傷口評估與照護紀錄（傷口照護資料） | 條件式（護理判斷） | 評估前 | — | 護理 |
| D | swallow | 吞嚥功能評估與飲食建議（吞嚥與飲食資料） | 條件式（護理判斷） | 評估前 | — | 護理 |
| D | rehab／elim | 復健及行動能力紀錄／排泄與睡眠照護紀錄 | 選填 | 評估前 | — | 護理 |
| E | emergency | 緊急事故處理同意書（機構文件） | 必備 | 入住前 | — | 行政 |
| E | authOther | 其他機構指定之授權文件 | 選填 | 入住前 | — | 行政 |
| F | contract | 住宿式長照服務契約（**以行政簽約紀錄為完成**） | 必備，機構提供 | 入住前 | — | 行政 |
| F | fee／payReceipt／deposit | 服務收費明細／繳費收據／保證金紀錄 | 機構提供，家屬只查看 | 入住前 | — | 行政 |

- 不在清單內的項目：個資同意書（線上簽署）、緊急聯絡人（表單）、G 類由行政依個案新增。
- 有效天數與檢查項目是**示範機構的參考設定**，不是全國規定。
- 條件式文件尚未判斷前不算齊全，也不算家屬缺件。

### 10.2 文件狀態（`docStatus`）
不需要、未上傳、待簽約、已登錄簽約、機構尚未提供、需補件、待收件、身分待確認、初步符合、疑似過期、確認過期、待護理核對、待登錄簽約、即將到期（離期限 ≤7 天）、確認符合。判斷順序照原型的 `status(it, c)`。
- 上傳 ≠ 審核完成。家屬端顯示「已上傳，等待本中心審核」。
- 效期文件：系統初步判斷 → 行政確認文件上的日期 → 護理核對內容。
- 只上傳契約檔案、沒有簽約紀錄 → 「待登錄簽約」。
- 每次上傳是新版本，核對都綁定版本。

### 10.3 正式補件與一般提醒
```js
const formalReqObj    = r => !!r && (!!r.source || (!!r.reason && !['未上傳','需補件','確認過期','待收件','尚未上傳'].includes(r.reason)));
const reqClosed       = (doc, c) => !!doc.req && (!!doc.req.closedAt || isDone(doc, c));   // isDone：確認符合等完成狀態
const openFormalReq   = (doc, c) => formalReqObj(doc.req) && !reqClosed(doc, c);
const reqCloseMissing = (doc, c) => formalReqObj(doc.req) && !doc.req.closedAt && isDone(doc, c); // 資料待修復
```
- 正式補件的來源：護理退回、行政要求、護理判斷需要、文件過期。首次繳交**不是**補件。
- 一般提醒只記提醒次數與期限，不建立補件。原型舊資料中由提醒留下的 req（原因是狀態字、沒有來源）不是補件：家屬端不能顯示「機構要求」，行政端顯示「已提醒 n 次（一般提醒，不是補件）」。
- 判斷補件是否結束，**所有頁面、Email、狀態都用同一套規則**。正式版用 `document_requests` 每次一列，關閉以 `closed_at` 為準；`isDone` 但 `closed_at` 為空就是待修復狀態。
- 家屬「補件進度」只列正式補件：原因、提出者、要求時間、期限、開啟中／已逾期／已關閉、是否重新上傳、審核結果、Email 通知狀態。補傳不等於完成，確認符合才關閉。
- 行政不能修改護理判斷，只能「請護理重新判斷」。護理判定不需要的文件，行政的「要求補件」不能勾選。

### 10.4 補件 Email
- 每個正式補件一筆 `mail_jobs`（唯一鍵綁補件事件）。狀態：待寄送、寄送中、模擬已寄送（測試環境未實際寄出）、寄送失敗；正式服務接上後另有「已寄送」。如果補件存在但通知工作不存在，畫面顯示「待建立／建立失敗」。
- **建立失敗的恢復**：行政或承辦護理按「建立並寄送」，只建立通知，**不能**新建補件或新增補件歷程。
- **寄送要能重複執行而不重複寄出**：
  1. 寄送前重讀資料，確認同一個補件事件仍開啟（已結案、已有下一次補件、文件已刪除都不寄）。
  2. `claim_mail_job`：`UPDATE mail_jobs SET status='寄送中', claim_by, claim_at, send_key WHERE id=$1 AND (status IN ('待寄送','寄送失敗') OR (status='寄送中' AND claim_at < now()-interval '2 minutes')) RETURNING *`。沒有回傳列就表示別人正在寄或已寄出。
  3. 送出前再確認一次事件仍開啟；已結案就取消、還原狀態並記錄。
  4. 寄送時帶 `idempotencyKey = mail_jobs.id`。
  5. `finish_mail_job` 只在 send_key 相符時寫回結果。寫回失敗時狀態維持「寄送中」，逾時後才能重新認領，並記錄「前次結果不明」。
- 補件結案後，舊通知不再提供重試，失敗紀錄保留。
- Email 只寫住民姓名、需要補的文件名稱、期限、登入連結，**不含醫療內容**。

### 10.5 習慣卡（七區塊 A–G）
- A 基本稱呼與溝通、B 健康與近期狀況（家屬補充）、C 日常活動協助、D 生活作息、E 個人喜好與禁忌、F 情緒與安撫方式、G 聯絡資訊。欄位定義照原型的 `HABIT_SECS`。
- 必填（`HABIT_REQ`）：call、lang（或 langOther）、hearing、famAllergy、ADL 六項（adl_walk、adl_transfer、adl_toilet、adl_bath、adl_eat、adl_swallow）。畫面用紅色星號標示。
- 草稿不給機構看；「正式提交」才產生新版本（rev 遞增）。
- 狀態：尚未提交、待審核、有疑義／待確認、審核完成、資料已變更，需重新確認。
- **habitGate**：最新提交版本（rev）審核完成，才能做收治評估。這個條件用在 phase、評估守門、摘要卡開放條件。
- 護理初審：家屬內容和已確認醫療資料不一致時（例如過敏），已確認資料**不會被覆蓋**，要填處理說明才能完成。「護理已閱」只是閱讀紀錄。重新提交後，只需確認變更的項目。初審完成**不會**開放摘要卡。
- 家屬端整頁只有一個習慣卡入口；內容標示「家屬提供」，不取代病歷。

### 10.6 醫療內容核對與診斷清單
- AI 辨識結果只是建議值，逐欄人工確認後才寫入 `medical_facts`。AI 不能用時清楚說明，改成人工輸入。
- 主要診斷：AI 結果整段先成為 1 筆「待確認」。可以「依標點拆成多筆」（重複拆分不會再加入）、逐筆確認或修改、標示 OCR 錯誤或不採用（要填理由，保留歷程，不刪除）。全部確認後才能完成核對。確認的診斷同步到診斷清單；同步失敗要標示並可重試，同步前摘要卡不能開放。
- 可以填 ICD-10-CM 代碼與名稱，但只檢查格式。系統**沒有碼表、不自動產生代碼**。
- 核對草稿依「文件＋版本」分開保存，換版本不沿用。

### 10.7 個資同意與代理權
- 簽署身分：預計入住者本人、法定代理人／監護人、其他經適當授權的代理人、本人（受輔助宣告，需確認輔助人同意）。
- 非本人簽署要先上傳證明，行政核對後才能「確認代理權」；也可以「無法核實」，請家屬重新簽署。核實前不能上傳醫療資料。系統只記錄核實結果，不判斷法律效力。
- 撤回同意 → 停止處理並結案。每次簽署都保留紀錄。

### 10.8 照顧摘要卡
- A 區「健康與照護重點」來自已確認資料（診斷、過敏、用藥、管路、傷口、吞嚥、移位、風險提示）；B 區「生活與個人偏好」來自審核完成的習慣卡。每個欄位標示來源。
- 開放條件：先審後簽＝已收治、已簽約、入住前文件符合；先簽後審＝已簽約、入住前確認通過；兩者都要診斷已同步、habitGate 通過。
- 護理正式審核後才開放給勾選的照服員。有版本；依據有實質變更就標示「待重新審核」與變更欄位（改回原值則解除），受影響欄位對照服員顯示「請問護理站」。
- 語言：中文、Bahasa Indonesia、Tiếng Việt。翻譯欄位標題**未經母語人士確認**，要標示。

### 10.9 工作清單（dashboard.html）
- 行政、護理的工作清單依案件編號分「個案資料夾」（同名不同案也分開），**預設收合**，展開狀態要記住。
- 外層：住民姓名、案件編號、階段、必要待辦數、最近更新。展開：本階段必要待辦、正在等待其他角色、下一階段預告（不計入待辦）、已完成工作。
- 可以搜尋姓名或編號，依最近更新或待辦數量排序。分「待處理／已完成」。

### 10.10 其他
- 處理歷程：家屬、行政、護理都看得到，列出事件、實際記錄時間、操作角色與人員。從 `audit_logs` 和各表的時間欄位組成。
- 通知集中在家屬的「通知」頁：已讀／未讀、住民姓名、案件編號、前往案件。案件首頁只顯示未讀數量。
- 所有畫面用「住民」。原型資料庫的舊文字「長輩」只在顯示時轉換。
- 手機號碼必填並檢查格式。
- 參訪與保證金只記錄，不阻擋流程，不處理付款。
- 保存規則：未入住案件結案後保存 `retention_days`（預設 365）天，到期由管理員手動封存（刪除原始檔案，保留結案原因與紀錄）；可以「延長保存」。自動刪除屬於第二階段。
- 測試資料功能（建立或恢復 4 筆測試案件）只在測試環境顯示，正式環境不能出現。

---

## 11. F 代號對照（依原型程式註記）

| 代號 | 內容 | 新頁面 |
|---|---|---|
| F0 | 案件狀態集中判斷；入住契約分開記錄 | 全部（rules） |
| F2 | 個資授權（簽署、撤回、代理權核實） | application.html、documents.html |
| F5 | AI 辨識（失敗時改人工） | documents.html（執行）、assessment.html（核對） |
| F6 | 文件效期 | documents.html |
| F7 | 補件與補件進度 | documents.html、application.html |
| F8 | 核對草稿與 OCR 結果分開存放 | assessment.html |
| F9 | 收治評估與前置條件 | assessment.html |
| F10 | 結果通知與摘要卡分開記錄時間 | assessment.html、care-summary.html |
| F11 | 照顧摘要卡依據與重新審核 | care-summary.html |
| F1、F3、F4、F12 | 原型沒有明確註記，**要向使用者確認** | — |

---

## 12. 測試帳號（只用於本機與測試專案）

由 `supabase/seed.sql`（或 seed script 呼叫 Auth Admin API）建立。**密碼不要寫在程式或版本控制裡**，由執行 seed 的人用環境變數設定。

| 角色 | 姓名 | 帳號 | 用途 |
|---|---|---|---|
| admin | 林主任 | admin@example.com | 管理員 |
| staff | 陳社工 | staff@example.com | 行政 |
| nurse（可分配） | 黃護理師 | nurse@example.com | 張秀英與測試案件的承辦 |
| nurse | 吳護理師 | nurse2@example.com | 陳金水的承辦 |
| care | 阿妮（Ani） | care@example.com | 照服員 |
| care | 黎氏蘭（Lan） | care2@example.com | 照服員 |
| family | 張家豪（兒子） | family@example.com | 張秀英 C-0001（先審後簽） |
| family | 陳淑芬（女兒） | family2@example.com | 陳金水 C-0002（先簽後審） |
| family | 劉建宏 | family3@example.com | 劉春梅 C-0003（非本人簽署示範） |
| 待審核員工 | 林佳穎、陳志豪 | jiaying@ / zhihao@example.com | 管理員核准帳號 |

測試案件（settings.html 測試資料）：A 待護理核對（劉文雄）、B 待收治評估（林玉蘭）、C 摘要卡待審核（張榮發）、D 摘要卡已開放（吳月娥，先簽後審）。

---

## 13. 開發順序（逐模組移轉）

開始前：確認 `reference/prototype_v18.html` 已在版本控制中（這就是備份），然後建立 git repo 與 `.gitignore`。

| 階段 | 內容 | 完成條件 |
|---|---|---|
| 0 | 專案骨架：Vite 多頁、8 個空白 HTML、common.css／components.css、`supabase init`、本機 `supabase start` | 8 頁都能開啟，共用頁首頁尾 |
| 1 | 資料表 migration、RLS 輔助函式與基本 policy、`doc_catalog` 與測試資料 seed | `supabase db reset` 成功；RLS 測試：family 看不到別人的案件 |
| 2 | **login.html**＋`auth.js`／`permissions.js`／`navigation.js`：登入、註冊（員工待審核）、忘記密碼、改密碼、分流、導覽列 | 五種角色登入後到正確首頁；每頁只有一個選取分頁；未登入會被導回登入頁 |
| 3 | **dashboard.html**：家屬個人首頁、我的申請、通知；行政／護理個案資料夾；照服員我的住民；徽章 | 待辦數與原型一致；資料夾預設收合並記住 |
| 4 | **application.html**：申請（RPC，不重複建立）、案件詳情、同意書與代理權、緊急聯絡人、習慣卡草稿與提交 | 申請後產生 24 筆文件；代理權流程正確；習慣卡必填與版本正確 |
| 5 | **cases.html**：案件列表與詳情、確認轉交、分配（歷程）、簽約紀錄、參訪保證金、協調與結案、處理歷程 | 一般護理師直接呼叫 RPC 也不能分配 |
| 6 | **documents.html**＋Storage：上傳版本、收件身分核對、日期效期、文件狀態、補件與提醒、補件追蹤、Email 模擬（send-mail）、`ocr` function | 第 10.3、10.4 節全部情境通過，包含建立失敗、同時重試、結案後不寄 |
| 7 | **assessment.html**：負責住民、照護需求判斷（自動補件）、醫療逐欄核對、診斷清單、習慣卡初審、收治評估、入住前確認 | 兩種流程走到可開放摘要卡；habitGate 擋住評估 |
| 8 | **care-summary.html**：產生、審核、開放、版本、待重新審核、照服員限閱、三種語言 | 照服員只能看到已開放且有開放給自己的卡 |
| 9 | **settings.html**：帳號審核（admin-users function）、角色、分配權限、機構設定、文件清單、保存規則與封存、寄送異常、操作紀錄、測試資料（只限測試環境） | 管理員以外的角色無法存取 |
| 10 | 全面驗收（第 14 節）與部署到**測試專案** | 回報實際通過與未測項目 |

---

## 14. 驗收要求（客戶規劃書第七節＋原型測試）

客戶的驗收清單：
- [ ] 以第 (18) 版原型為功能對照基準；先備份，逐模組移轉，避免一次大改。
- [ ] 八頁共用登入狀態與導覽列；同一時間只有一個分頁是選取狀態，待辦徽章不受切換影響。
- [ ] 所有資料讀寫改走 Supabase；不能保留對 Claude 測試資料庫的依賴，也不能把 HAPI 當主要儲存。
- [ ] 每項儲存確認成功後才更新完成狀態；保留版本、錯誤提示、重試與稽核紀錄。
- [ ] 用五種角色測試跨頁權限、兩種流程、補件與摘要卡版本；另外測試重新整理、登出、跨使用者資料隔離。
- [ ] 第一次移轉與真實部署前，先在測試環境驗收，不能直接覆蓋既有線上資料。

測試分三層：
1. **單元測試（Vitest）**：`rules/` 的 phase、docStatus、formalReq、reqClosed、habitState、habitGate、stepsInfo、cardChanged、mailEvent。可以從原型函式直接對照輸入與輸出。
2. **RLS 測試**：用每種角色的 JWT 直接查詢與寫入資料表、RPC、Storage，確認不能越權。只測畫面不算數。
3. **E2E（Playwright）**：從 `reference/tests/` 移植，優先順序：
   - 兩種入住流程全程（`run_s.py`：S1–S15、N2–N10、P1–P5、Z1）；
   - 補件 Email 全部邊界（`run_17.py`：16-1～16-3、17-1～17-3）；
   - 舊版提醒不是補件（16-2）；
   - 習慣卡（`run_eight.py`、`run_seven.py`）；
   - 導覽列（`run_18.py`，再加上**瀏覽器上一頁**與跨頁切換）；
   - 重新整理後仍登入、登出後不能回到受保護頁面、A 家屬看不到 B 家屬的案件。

寫入失敗測試：在測試環境用 RLS 拒絕、斷網或 mock fetch 模擬失敗，確認畫面不顯示成功並可重試。

---

## 15. 待確認事項（請 Claude Code 遇到時先問使用者）

1. **頁尾文字**：原型固定為「目前為模擬環境：資料尚未正式介接 Supabase 與 HAPI FHIR。」改成 Supabase 後這句已經不正確，要請使用者確認新文字（例如測試環境用「目前為測試環境：資料存放於 Supabase 測試專案，非正式服務。」）。確認前先做成設定值，不要自己定案。
2. **FHIR 交換介接**：是否保留。不保留的話，原型核對頁的「預計對應的 FHIR R4 資源」欄要拿掉。保留的話，profile 要依台灣長照 FHIR 實作指引實際確認，不能自己編。
3. **正式 Email 服務**：選用哪一家、寄件網域。在決定前只做模擬 adapter。
4. **Supabase Auth 寄出的信**（註冊驗證、忘記密碼）是真的 Email：測試環境要用本機 Inbucket 或關閉驗證信，正式環境的寄件設定要由使用者決定。
5. **F1、F3、F4、F12** 的定義。
6. 線上原型的測試資料要不要搬到 Supabase 測試專案（預設**不搬**，用 seed 重建）。
7. 印尼文、越南文欄位標題需要母語人士確認；文件有效天數、同意書文字與法律效力由機構確認。
8. 部署方式（靜態網站放哪裡，例如 Supabase 以外的靜態主機）與網域。
