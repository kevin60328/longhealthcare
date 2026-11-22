# 資料庫設計說明

> 給組員與接手的人看的：資料表之間的關聯、正規化做到哪裡、哪些地方是刻意保留的例外、資料庫本身會擋下哪些錯誤。
> 實際定義以 `supabase/migrations/` 為準（依檔名順序套用）。最後更新：2026/11/22（000019，階段 5）。

## 1. 正規化原則

- **至少第三正規化（3NF）**：每個欄位只描述所在那張表的主體；同一個事實只存一個地方。
- **資料之間一律用外鍵關聯**，包含「某文件第幾版」「第幾次提交」這類複合關聯；指向其他資料的 id 不放在 JSON 裡。
- **一個欄位只放一個值**：歷程、清單一律拆成獨立資料表，一筆一列。
- 2026/11/21 依使用者要求調整（`000007_normalize.sql`），既有資料已轉換。

## 2. 資料表與關聯

箭頭表示外鍵（子表 → 母表）。

### 人員與設定
| 資料表 | 內容 | 關聯 |
|---|---|---|
| `profiles` | 帳號、角色、狀態、手機 | → `auth.users`（Supabase 登入帳號） |
| `org_settings` | 機構設定（只有一列） | |
| `partner_hospitals` | 合作醫院，一院一列 | |
| `doc_catalog` | 內建文件清單（24 項）＋只在需要時加入的代理權證明（`on_demand`：監護／輔助宣告裁定書、代理權授權證明） | |
| `doc_catalog_parts` | 文件的核對項目（例如體檢的 CBC、肝功能） | → `doc_catalog` |

### 住民與案件
| 資料表 | 內容 | 關聯 |
|---|---|---|
| `residents` | 住民：身分證字號（唯一）、姓名、生日、病歷號 | |
| `resident_conflicts` | 送出申請時身分證字號已有不同的住民資料（申請未建立），待行政確認 | → `residents`、`profiles`（申請人、處理者） |
| `cases` | 入住申請案件 | → `residents`、`profiles`（家屬、確認者、承辦護理、簽約者、結案者） |
| `case_assignments` | 承辦護理分配歷程 | → `cases`、`profiles` |
| `contacts` | 緊急聯絡人 | → `cases` |
| `consents` | 個資同意（每次簽署一列） | → `cases`、`profiles`、`documents`（代理權證明） |
| `case_visits` | 參訪：每案一筆目前狀態（修改經過記在操作紀錄） | → `cases`、`profiles` |
| `case_deposits` | 保證金：每案一筆目前狀態（只記錄，不處理付款） | → `cases`、`profiles` |
| `retention_holds` | 延長保存 | → `cases`、`profiles` |

### 文件
| 資料表 | 內容 | 關聯 |
|---|---|---|
| `documents` | 案件的每一份文件 | → `cases`、`doc_catalog`（個案新增的 `custom_`／`extra_` 文件除外） |
| `document_parts` | 這份文件的核對項目 | → `documents` |
| `document_versions` | 每次上傳一個版本 | → `documents`、`profiles`（上傳、身分核對、日期確認、護理核對）、`document_versions`（沿用其他文件的檔案） |
| `document_need_changes` | 文件需求判斷歷程（需要／不需要） | → `documents`、`profiles` |
| `document_need_asks` | 行政請護理重新判斷 | → `documents`、`profiles` |
| `document_reminders` | 一般提醒（不是補件），一次一列 | → `documents`、`profiles` |
| `document_returns` | 退回 | → `document_versions`（文件＋版本）、`profiles` |
| `document_requests` | 正式補件，一次一列 | → `documents`、`profiles`（提出、關閉）、`document_requests`（被下一次補件取代：`superseded_by`） |
| `document_views` | 行政打開醫療類文件的紀錄（每人每版本一列；Storage 讀取權限也依此放行） | → `document_versions`、`profiles` |
| `review_drafts` | 護理核對草稿 | → `document_versions` |
| `ocr_runs` | AI 辨識結果 | → `document_versions` |
| `medical_facts` | 護理逐欄確認的醫療資料，一欄一列 | → `document_versions`、`profiles` |
| `assessment_items` | 收治評估「需補充」時指定的文件（階段 7） | → `assessments`、`documents` |

### 護理、習慣卡、摘要卡
| 資料表 | 內容 | 關聯 |
|---|---|---|
| `diagnoses` | 診斷清單（逐筆） | → `cases`、`document_versions`（來源） |
| `diagnosis_changes` | 診斷變更歷程 | → `diagnoses`、`profiles` |
| `habit_cards` | 習慣卡草稿（`draft_rev`＝第幾次修改） | → `cases` |
| `habit_card_sections` | 習慣卡各區最後修改 | → `habit_cards`、`profiles` |
| `habit_submissions` | 習慣卡正式提交（rev 遞增） | → `cases`、`profiles` |
| `habit_reviews` | 護理初審 | → `habit_submissions`（案件＋rev）、`profiles` |
| `assessments` | 收治評估（含協調紀錄） | → `cases`、`profiles` |
| `care_cards` | 照顧摘要卡（版本化） | → `cases`、`profiles` |
| `care_card_caregivers` | 摘要卡開放給哪些照服員 | → `care_cards`、`profiles` |

### 通知與紀錄
| 資料表 | 內容 | 關聯 |
|---|---|---|
| `notices` | 給家屬的通知 | → `cases`、`profiles` |
| `mail_jobs` | Email 通知工作 | → `cases`（申請確認）**或** `document_requests`（補件通知），兩者擇一 |
| `mail_attempts` | 每次寄送嘗試 | → `mail_jobs`、`profiles`（操作人） |
| `audit_logs` | 操作紀錄（只能新增） | → `cases` |

## 3. 刻意保留的例外（有理由，不是遺漏）

| 位置 | 為什麼保留 |
|---|---|
| `documents.custom_why`、`custom_where` | 只有個案新增的文件（不在文件清單）才有，清單內的文件從 `doc_catalog` 讀，約束保證兩者不並存（000023、000025）。 |
| `documents` 的名稱、類別、有效天數等 | **建立當時的快照**。管理員之後修改文件清單，只影響新的申請，進行中案件的規則不會被改掉（與原型、HANDOFF 9.2「改設定只影響之後新建的申請」一致）。另有外鍵 `catalog_key` 連回文件清單。 |
| `document_parts` | 同上，核對項目的快照。 |
| `cases.nurse_id` | 等於 `case_assignments` 最新一筆。保留是因為每次權限檢查都要用；**只能由新增分配紀錄改變**，觸發器保證永遠一致，直接修改會被擋下。 |
| `documents.cond_met` | 文件「目前」是否需要，是案件狀態本身；變更過程另記在 `document_need_changes`。 |
| `mail_jobs.status`、`claim_*` | Email 工作目前的狀態與認領資訊（狀態機），不是由寄送紀錄推得。 |
| `audit_logs.actor_name` | 操作當時的姓名快照，帳號改名或刪除後紀錄不變；因此 `actor` 不設外鍵。 |
| `document_versions.review`、`labs`、`dx_rows`（階段 7） | 護理核對完成**當時**的逐欄紀錄（原始值、AI 第幾次、修改歷程）、檢驗數值、病摘逐筆診斷：核對完成後不再修改的快照。確認後的醫療資料本身仍一欄一列存在 `medical_facts`，診斷逐筆存在 `diagnoses`。 |
| jsonb 欄位：習慣卡內容、習慣卡審核快照、摘要卡內容與依據、身分核對明細、核對草稿、AI 原始結果 | 內容是「當時的整份表單或快照」，不含指向其他資料的 id，也不會被拆開查詢。 |

## 4. 資料庫本身會擋下的錯誤

畫面以外（直接呼叫 API、寫錯程式）也擋得住，`tests/rls/basic.test.js` 逐項測試：

- 指向不存在的資料（所有外鍵，包含「文件第幾版」「第幾次提交」）
- 同一身分證字號建立第二位住民；同一案件同一種文件建立兩次；同一文件同時有兩筆開啟中的補件
- 直接修改 `cases.nurse_id`、新案件直接指定承辦護理師
- 分配給非護理人員、更換承辦人沒有填原因
- 摘要卡開放給照服員以外的人
- 不在文件清單的文件 key 不是 `custom_`／`extra_`；清單內的文件另存準備說明（000025 修正：空值比較原本會被當成通過）
- Email 工作同時指向案件與補件，或兩者都沒有
- 修改或刪除操作紀錄（連 service role 也不行；唯一例外是 `purge_test_data` 執行期間、而且只限自動測試帳號的紀錄）
- **跨案件的矛盾資料**（000010）：代理權證明、診斷來源文件、沿用的文件檔案，都必須屬於同一個案件（前兩者用「文件＋案件」複合外鍵，第三個用觸發器）

## 5. 寫入方式（RPC，一個交易內完成）

| 階段 | RPC | 內容 |
|---|---|---|
| 2 | `record_login`、`update_my_phone`、`password_changed` | 帳號 |
| 3 | `mark_notices_read`、`set_notify_email` | 通知 |
| 4 | `create_application` | 住民（同身分證字號不同資料 → 不建立，寫 `resident_conflicts`）＋案件＋文件＋核對項目＋申請確認通知＋操作紀錄；同一申請識別碼不重複建立 |
| 4 | `sign_consent`、`withdraw_consent`、`decline_consent` | 個資同意；非本人簽署時加入代理權證明文件 |
| 4 | `save_contacts`、`save_habit_section`、`submit_habit`、`resend_apply_mail` | 聯絡人、習慣卡、申請確認通知 |
| 4 | `resolve_resident_conflict` | 行政處理住民資料不一致 |
| 5 | `confirm_case`、`reject_application` | 確認並轉交護理（設定繳交期限、通知家屬）／不受理 |
| 5 | `assign_nurse` | 指定或更換承辦（帶畫面看到的舊承辦人，防止同時分配；更換要原因） |
| 5 | `verify_proxy`、`record_signing`、`close_case`、`coordinate`、`update_admit`、`save_visit` | 代理權核實、簽約、結案、協調、入住日、參訪與保證金 |
| 5 | `set_document_need`、`ask_nurse_need` | 行政判斷視情況繳交文件、請護理重新判斷 |
| 6 | `submit_version`、`reuse_file`、`submit_inst_version` | 家屬上傳新版本（檔案須已在 Storage、位置與版本相符）、沿用體檢報告或其他文件的檔案、行政上傳機構文件 |
| 6 | `staff_receipt`、`mark_id_pending`、`confirm_doc_date` | 收件核對、身分待確認、確認日期；狀態改變後自動處理補件（確認過期建立系統補件、確認符合關閉補件） |
| 6 | `request_documents`、`remind_document`、`add_case_document`、`close_request_fix` | 要求補件（全部檢查通過才寫入）、一般提醒、新增個案文件、補寫補件關閉紀錄 |
| 6 | `open_document_file` | 取得檔案位置；行政打開醫療類文件記錄一次 |
| 7 | `set_nurse_need` | 管路、傷口、吞嚥是否需要（只限承辦護理師）；判斷需要時自動建立補件，改判不需要時關閉未完成的補件，並回覆行政的重新判斷請求 |
| 7 | `save_review_draft`、`complete_review`、`return_document` | 逐欄核對草稿（文件＋版本）、完成核對（寫入醫療資料、核對紀錄，同一交易同步逐筆診斷）、退回補件 |
| 7 | `save_supp` | 護理補充評估（醫院沒有提供獨立紀錄時；記錄來源，不當成醫院文件） |
| 7 | `dx_import`、`dx_save`、`dx_resync` | 診斷清單（ICD-10-CM 只檢查格式；修改要帶畫面看到的原文，防止同時修改） |
| 7 | `review_habit` | 習慣卡初審（以資料庫的正式提交為快照；版本不符擋下） |
| 8 | `open_care_card`、`revise_care_card`、`discard_care_card`、`stop_care_card` | 照顧摘要卡：開放（第一次新增；修訂時草稿轉開放、舊版標示已取代，同一交易；檢查開放條件 `card_allowed` 與照服員身分）、修訂草稿、放棄、停用 |
| 8（後端） | `resume_care_card_as` | 重新開放：由 Edge Function care-card 先用規則 cardChanged 確認停用期間依據沒有改變，再以 service role 呼叫（000032；舊的 `resume_care_card` 已收回一般使用者權限） |
| 8 | `case_cards` | 承辦護理師讀取草稿與歷史版本內容 |
| 8（後端） | `my_care_card` | 照服員讀自己的卡（Edge Function care-card 以 service role 呼叫，另依規則算出依據變更的欄位） |
| 7 | `save_assessment` | 收治評估／入住前確認；每次送出前重新檢查承辦、利益衝突、文件齊全（`docs_ready`）、習慣卡初審（`habit_gate`）、簽約、目前沒有有效評估 |
| 6（後端） | `ensure_req_mail`、`claim_mail_job`、`release_mail_job`、`finish_mail_job`、`req_event`、`ocr_start`、`ocr_finish` | 只給 Edge Function（send-mail、ocr）以 service role 呼叫 |
| 測試 | `purge_test_data` | 只有後端金鑰能執行；只刪自動測試帳號（e2e-／rls-…@example.com）的案件與紀錄（回傳案件 id，檔案由腳本刪除） |

每個 RPC 都會先檢查身分與案件狀態，失敗就整筆不寫入。

## 6. 實際檢查結果（2026/11/21，直接查詢雲端測試專案）

- 35 張資料表、81 個外鍵；陣列欄位 0 個。（階段 6 之後：多了 `document_views`；`mail_jobs.claim_by` 改成帳號外鍵；`document_requests` 加 `superseded_by`、`closed_by` 外鍵；`mail_attempts.by` 外鍵）
- 編號類欄位沒有外鍵的只有：`audit_logs.actor`（刻意，見第 3 節）、`care_cards.v`、`document_versions.v`（版本號本身）、`org_settings.rev`（設定修改次數）。
- jsonb 欄位 11 個，全部是第 3 節列出的快照或表單內容。

## 7. 與業務規則同一套判斷的資料庫函式（階段 6）

`doc_status()`（文件狀態）、`doc_done()`、`req_event()`（補件事件是否開啟）、`docs_ready()`（文件齊全，階段 7）是 `js/modules/rules/core.js` 的 `status`、`isDone`、`mailReqEvent`、`docsReady` 的資料庫版本，給 RPC 檢查狀態、給 send-mail 判斷要不要寄。
規則改了兩邊都要改；`tests/rls/documents.test.js`、`assessment.test.js` 會把所有進行中案件的每一份文件、每一筆補件、每一個案件拿兩邊逐筆比對，不一致就失敗。
`habit_gate()`（習慣卡初審通過）與 `confirmed_field()`（已確認醫療資料）對應 `habitGate`、`confirmedField`：最新一次正式提交已審核完成，而且審核當時的過敏、管路、吞嚥快照與現在相同（000030）。

## 8. 檔案（Storage）

私有 bucket `case-files`，路徑 `<案件 id>/<文件 key>/v<版本>-<隨機 id>.<副檔名>`。讀取與上傳的 policy 用 `can_read_file`、`can_upload_file`，判斷方式與資料表相同；不開放修改與刪除。
行政讀取醫療類（B、C、D 類）檔案前必須先經過 `open_document_file`（寫 `document_views` 與操作紀錄），否則 Storage 拒絕。
測試資料清除時由 `scripts/clean-test-data.mjs` 用 Storage API 刪除測試案件的檔案。

## 9. 讀取方式

前端只能讀，資料列由 RLS 依角色過濾（`000002_rls.sql`、`000007` 的新表）。案件與文件的完整判斷資料由 `get_case_models()` 一次回傳（`000008`），函式內檢查權限，並對沒有權限看內容的文件只回傳狀態欄位。寫入一律走各階段的 RPC（一個交易內檢查權限、狀態並記錄操作紀錄）。
