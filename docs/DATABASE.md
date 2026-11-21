# 資料庫設計說明

> 給組員與接手的人看的：資料表之間的關聯、正規化做到哪裡、哪些地方是刻意保留的例外、資料庫本身會擋下哪些錯誤。
> 實際定義以 `supabase/migrations/` 為準（依檔名順序套用）。最後更新：2026/11/21（000013，階段 4）。

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
| `visits` | 參訪與保證金紀錄 | → `cases`、`profiles` |
| `retention_holds` | 延長保存 | → `cases`、`profiles` |

### 文件
| 資料表 | 內容 | 關聯 |
|---|---|---|
| `documents` | 案件的每一份文件 | → `cases`、`doc_catalog`（G 類除外） |
| `document_parts` | 這份文件的核對項目 | → `documents` |
| `document_versions` | 每次上傳一個版本 | → `documents`、`profiles`（上傳、身分核對、日期確認、護理核對）、`document_versions`（沿用其他文件的檔案） |
| `document_need_changes` | 文件需求判斷歷程（需要／不需要） | → `documents`、`profiles` |
| `document_need_asks` | 行政請護理重新判斷 | → `documents`、`profiles` |
| `document_reminders` | 一般提醒（不是補件），一次一列 | → `documents`、`profiles` |
| `document_returns` | 退回 | → `document_versions`（文件＋版本）、`profiles` |
| `document_requests` | 正式補件，一次一列 | → `documents`、`profiles` |
| `review_drafts` | 護理核對草稿 | → `document_versions` |
| `ocr_runs` | AI 辨識結果 | → `document_versions` |
| `medical_facts` | 護理逐欄確認的醫療資料，一欄一列 | → `document_versions`、`profiles` |

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
| `mail_attempts` | 每次寄送嘗試 | → `mail_jobs` |
| `audit_logs` | 操作紀錄（只能新增） | → `cases` |

## 3. 刻意保留的例外（有理由，不是遺漏）

| 位置 | 為什麼保留 |
|---|---|
| `documents` 的名稱、類別、有效天數等 | **建立當時的快照**。管理員之後修改文件清單，只影響新的申請，進行中案件的規則不會被改掉（與原型、HANDOFF 9.2「改設定只影響之後新建的申請」一致）。另有外鍵 `catalog_key` 連回文件清單。 |
| `document_parts` | 同上，核對項目的快照。 |
| `cases.nurse_id` | 等於 `case_assignments` 最新一筆。保留是因為每次權限檢查都要用；**只能由新增分配紀錄改變**，觸發器保證永遠一致，直接修改會被擋下。 |
| `documents.cond_met` | 文件「目前」是否需要，是案件狀態本身；變更過程另記在 `document_need_changes`。 |
| `mail_jobs.status`、`claim_*` | Email 工作目前的狀態與認領資訊（狀態機），不是由寄送紀錄推得。 |
| `audit_logs.actor_name` | 操作當時的姓名快照，帳號改名或刪除後紀錄不變；因此 `actor` 不設外鍵。 |
| jsonb 欄位：習慣卡內容、習慣卡審核快照、摘要卡內容與依據、身分核對明細、核對草稿、AI 原始結果 | 內容是「當時的整份表單或快照」，不含指向其他資料的 id，也不會被拆開查詢。 |

## 4. 資料庫本身會擋下的錯誤

畫面以外（直接呼叫 API、寫錯程式）也擋得住，`tests/rls/basic.test.js` 逐項測試：

- 指向不存在的資料（所有外鍵，包含「文件第幾版」「第幾次提交」）
- 同一身分證字號建立第二位住民；同一案件同一種文件建立兩次；同一文件同時有兩筆開啟中的補件
- 直接修改 `cases.nurse_id`、新案件直接指定承辦護理師
- 分配給非護理人員、更換承辦人沒有填原因
- 摘要卡開放給照服員以外的人
- 非 G 類文件沒有連到文件清單
- Email 工作同時指向案件與補件，或兩者都沒有
- 修改或刪除操作紀錄（連 service role 也不行）
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

每個 RPC 都會先檢查身分與案件狀態，失敗就整筆不寫入。

## 6. 實際檢查結果（2026/11/21，直接查詢雲端測試專案）

- 35 張資料表、81 個外鍵；陣列欄位 0 個。
- 編號類欄位沒有外鍵的只有：`audit_logs.actor`（刻意，見第 3 節）、`care_cards.v`、`document_versions.v`（版本號本身）、`org_settings.rev`（設定修改次數）、`mail_jobs.claim_by`（寄信程序識別碼，不是使用者）。
- jsonb 欄位 11 個，全部是第 3 節列出的快照或表單內容。

## 7. 讀取方式

前端只能讀，資料列由 RLS 依角色過濾（`000002_rls.sql`、`000007` 的新表）。案件與文件的完整判斷資料由 `get_case_models()` 一次回傳（`000008`），函式內檢查權限，並對沒有權限看內容的文件只回傳狀態欄位。寫入一律走各階段的 RPC（一個交易內檢查權限、狀態並記錄操作紀錄）。
