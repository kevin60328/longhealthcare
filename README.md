# 長照機構入住前收件系統（示範機構：康和長照中心）

家屬線上申請入住、上傳文件，機構行政收件核對、護理審核與評估，最後產生給照顧服務員看的照顧摘要卡。
由原型 v18 拆成 8 個網頁，資料存在 Supabase（登入、資料庫、檔案、後端函式）。

> **目前是測試環境**：所有資料都是虛構的示範資料。Email 通知是模擬寄送，沒有真的寄出；電子同意流程只是示範，正式簽署與法律效力還需要確認。

## 1. 網站

**https://longhealthcare.netlify.app**

入口頁分「一般申請人」（家屬）和「機構工作人員」兩個入口。

## 2. 測試帳號

所有測試帳號共用一組密碼，**密碼另外提供，不寫在這裡**（網站是公開的）。

| 角色 | 帳號 | 姓名 | 可以做什麼 |
|---|---|---|---|
| 系統管理員 | admin@example.com | 林主任 | 帳號審核、機構設定、結案與封存、操作紀錄、寄送異常、測試資料 |
| 行政／社工 | staff@example.com | 陳社工 | 確認申請、收件核對、要求補件、簽約、協調與結案 |
| 護理人員 | nurse@example.com | 黃護理師 | 醫療文件核對、診斷清單、習慣卡初審、收治評估、照顧摘要卡；有案件分配權限 |
| 護理人員 | nurse2@example.com | 吳護理師 | 同上（沒有案件分配權限） |
| 照顧服務員 | care@example.com | 阿妮（Ani） | 查看開放給自己的照顧摘要卡 |
| 照顧服務員 | care2@example.com | 黎氏蘭（Lan） | 同上 |
| 家屬 | family@example.com | 張家豪 | 申請入住、上傳文件、簽同意書、填習慣卡 |
| 家屬 | family2@example.com、family3@example.com | 陳淑芬、劉建宏 | 同上 |

另有兩個「待審核」的員工申請（jiaying@、zhihao@example.com），可以用管理員帳號練習核准或退回。

**固定測試案件 T-A～T-D**：讓各角色可以直接從某個階段開始操作（例如 T-B 已可做收治評估、T-D 已開放摘要卡）。用管理員登入 →「測試資料」分頁可以看說明，也可以把案件恢復到起始狀態。

## 3. 8 個頁面

| 頁面 | 用途 | 使用者 |
|---|---|---|
| login.html | 登入、註冊、忘記密碼、修改密碼 | 所有人 |
| dashboard.html | 首頁、工作清單、通知、我的住民 | 所有人（依角色不同） |
| application.html | 申請入住、同意書、緊急聯絡人、習慣卡 | 家屬 |
| cases.html | 案件列表與詳情、確認轉交、案件分配、簽約、協調與結案 | 行政、有分配權限的護理 |
| documents.html | 文件上傳、收件核對、補件追蹤、補件 Email（模擬）、AI 文字辨識 | 家屬、行政、護理 |
| assessment.html | 負責住民、醫療內容逐欄核對、診斷清單、習慣卡初審、收治評估 | 護理 |
| care-summary.html | 照顧摘要卡審核與開放、照服員看卡 | 護理、照服員 |
| settings.html | 系統管理 | 管理員 |

## 4. 程式碼與 SQL 在哪裡

| 位置 | 內容 |
|---|---|
| `*.html`、`css/` | 8 個頁面與共用樣式（沿用原型 v18） |
| `js/` | 前端程式。`js/modules/` 是各頁面，`js/modules/rules/` 是業務規則（從原型移轉，有對照測試保證一致） |
| **`supabase/migrations/`** | **資料庫 SQL**：資料表、外鍵、權限（RLS）、所有寫入函式。依檔名順序執行，共 34 個檔案 |
| `supabase/functions/` | 後端函式（Edge Functions）：補件 Email、AI 文字辨識、照服員看卡、帳號重設密碼、封存、測試資料 |
| `docs/DATABASE.md` | 資料庫設計說明：每張表的用途與關聯、正規化與刻意保留的例外、寫入函式清單 |
| `scripts/` | 部署資料庫、建立測試資料、清除測試資料的腳本 |
| `tests/` | 自動測試：單元（業務規則）、資料庫權限、瀏覽器端到端、與原型畫面對照 |
| `HANDOFF.md`、`PROGRESS.md` | 需求與限制、開發進度與待確認事項 |

## 5. 安全設計（摘要）

- 前端只有 Supabase 網址和公開的 anon key。管理金鑰、Claude API key 只放在 Supabase 後端函式的環境變數，不在程式碼或 git 裡。
- 每個角色能讀寫什麼由資料庫本身（RLS 與函式）檢查，不只是畫面隱藏按鈕。例如護理只看得到自己承辦的案件，照服員只看得到開放給自己的摘要卡。
- 檔案放在私有儲存空間，看檔案時產生 10 分鐘有效的連結；行政打開醫療文件會留下紀錄。
- 操作紀錄只能新增，不能修改或刪除。

## 6. 開發與測試（給技術人員）

需要 Node.js 22 以上。

```
npm install
npx playwright install chromium
```

把 `.env.example` 複製成 `.env`，`.env.secrets.example` 複製成 `.env.secrets`，填入自己的 Supabase 專案資料（`.env.secrets` 不能 commit）。

| 指令 | 用途 |
|---|---|
| `npm run dev` | 本機開啟網站 |
| `npm run db:push` | 把 `supabase/migrations/` 套用到 Supabase 專案 |
| `npm run db:seed`、`npm run db:seed-cases` | 建立測試帳號與測試案件（只用在測試專案） |
| `npm run functions:deploy` | 部署後端函式 |
| `npm run test:unit`、`npm run test:rls`、`npm run test:e2e` | 自動測試（不要同時執行，會互相清掉測試資料） |

部署：push 到 GitHub 的 main 後，Netlify 會自動建置並更新網站（設定在 `netlify.toml`）。

## 7. 尚未完成、需要決定的事

列在 `PROGRESS.md` 的「還沒做／已知限制」與「待確認事項」，主要有：正式 Email 服務、FHIR 介接、正式環境的網域與部署、AI 文字辨識的個資同意說明。
