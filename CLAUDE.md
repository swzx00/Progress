# 專案簡介

> 最後更新：2026-09-17

「工作進度」列管系統。取代目前手動維護的 Google Sheet 表單，改用前端頁面輸入/檢視資料，資料實際存放位置仍是 Google Sheet。

- 專案類型：**純前端專案**，沒有自建後端主機。Google Apps Script Web App 扮演「後端 API」的角色，前端（Vue 3 + TS）部署在 GitHub Pages 為靜態站
- 原始資料來源：[Google Sheet](https://docs.google.com/spreadsheets/d/1hGZx7uESs-aT0ldZdfOEr9tfZ11HbOcWmP1LM81FEDg/edit?gid=1095228578#gid=1095228578)
- GitHub repo：https://github.com/swzx00/Progress（目前為 private，上線前暫時隱藏，正式部署 GitHub Pages 時需切回 public）
- 擁有者／唯一寫入者：swzx00@gmail.com

# 系統架構總覽

```
【身份驗證】使用者 → Google 帳號登入（Google Identity Services）→ 取得 ID Token
【寫入】前端管理頁 → Apps Script doPost（驗證 ID Token 的 email 是否為擁有者本人）→ Google Sheet
【讀取】前端（管理頁／檢視頁皆同）→ Apps Script doGet → Google Sheet
【部署】GitHub Pages（public repo，純靜態）＋ Google Apps Script Web App
```

沒有自建後端主機。之所以排除「自建後端 + Service Account」方案，是因為 GitHub Pages 無法安全存放 Service Account 金鑰；改以 Google 帳號登入 + Apps Script 驗證 ID Token 的方式確保只有本人能寫入，即使原始碼公開也不會外洩任何帳密。

# Google Sheet 結構設計

**資料分頁**：命名規則 `YYYY-MM`（例如 `2026-09`）。Apps Script 依「工作日期」判斷要寫入哪個月份分頁，該分頁不存在時自動建立並複製表頭格式。

原始 11 個業務欄位（已改名對齊目前用語）+ 新增「工作日期」「專案Repo」+ 系統欄位。其中原始欄位的「列管內容」系統不使用（Sheet 上可能還留著這欄，但前端/Apps Script 都不讀寫它）。欄位順序如下：

| 欄位 | 說明 |
|---|---|
| 項次 | 系統自動編號（依當月新增順序），非必要不手動輸入 |
| 交辦單位 | 可搜尋下拉選單（來自「選項清單」分頁，可輸入清單沒有的新值直接當作答案送出）（原欄名「單位」） |
| 交辦人員 | 可搜尋下拉選單（來自「選項清單」分頁，同上可自訂新值） |
| 專案名稱 | 可搜尋下拉選單（來自「選項清單」分頁，同上可自訂新值） |
| **專案Repo**（新增） | 選填，可搜尋的**多選**下拉選單（來自「選項清單」分頁，同上可自訂新值），可填多個 repo 名稱（例如 `AAA`、`BBBB`）。Sheet 儲存格存成逗號分隔的字串（如 `AAA,BBBB`），前端拆開後以 `#AAA` `#BBBB` 標籤呈現；沒有值就不顯示 |
| 工作目標 | 文字（原欄名「工作內容」） |
| **工作日期**（新增） | 這筆紀錄所屬的那一天，預設今天可手動改（補登用）。前台以此欄位做「單日檢視」 |
| 預計期限 | 日期（原欄名「預計完成期限」） |
| 處理內容 | 文字，語意＝工作日期當天的處理情形（原欄名「今日處理情形」） |
| 今日工時 | 數字（語意＝工作日期當天的工時），需為非負數 |
| 完成度 | 數字，限制 0–100（原欄名「完成%」，改名後鍵名不含特殊字元，程式裡可直接用 `item.完成度` 不用中括號） |
| 狀態 | 簡單下拉選單（不用搜尋），固定選項：`進行中`／`前端完成`／`返修`／`待辦`／`確認上線`／`暫緩`，可留空（原欄名「完成回報」） |
| **ID**（系統） | UUID，寫入時自動產生，編輯/刪除用來精準定位列 |
| **已刪除**（系統） | TRUE/FALSE，軟刪除標記，不做真刪除 |

**表格顯示的合併欄位**（僅畫面呈現合併，資料仍是各自獨立欄位，表頭文字也標明合併了哪些欄位）：
- **交辦單位 + 交辦人員**：共用一欄，表頭寫「交辦單位/人員」。手機卡片版面較寬，呈現單行「某某某（OO部門）」；桌面表格的這欄是固定窄欄（110px），單行塞不下，改呈現兩行堆疊「OO部門」換行「某某某」
- **專案名稱 + 專案Repo**：共用一欄，表頭寫「專案名稱/Repo」。專案名稱在上，有填 Repo 才在下方多一行 `#AAA` `#BBBB` 標籤，沒填就不多顯示

**附件欄位**：已從系統範圍移除（圖片需經 Google Drive 中轉才能顯示，複雜度高，暫不做上傳功能）。Sheet 上保留原欄位，有需要時使用者自行手動貼連結。

**選項清單分頁**（新增，命名「選項清單」）：存放「交辦單位」「交辦人員」「專案名稱」「專案Repo」的可選值，供前端可搜尋下拉選單讀取；使用者輸入清單沒有的新值時，`doPost` 的 `create` 動作會同步把新值寫回此分頁。

**資料模式**：情境 A（日誌式）——同一專案每天新增一列新紀錄，不覆寫舊資料，歷史紀錄自然依時間往下疊。

# Apps Script Web App 設計

**doGet(e)**
- 接受 `date` 參數（例如 `2026-09-17`），後端自動換算對應月份分頁，只回傳當天且「已刪除≠TRUE」的列
- 額外支援 `type=options` 讀取「選項清單」分頁
- 開放給所有人呼叫（不需登入），供公開檢視頁使用；11 個業務欄位公開檢視頁全部顯示，沒有欄位白名單問題（機敏疑慮是「帳密/token 不能出現在 repo」層級，不是欄位層級——這點已用 Google 登入驗證解決）

**doPost(e)**
- body 帶入 Google ID Token，後端呼叫 `https://oauth2.googleapis.com/tokeninfo` 驗證有效性，取出 email 並比對是否為 swzx00@gmail.com，不符合直接拒絕
- 依 `action` 分派：
  - `create`：判斷/建立當月分頁，產生 UUID 當 ID，寫入新列；若帶了新的交辦單位/交辦人員/專案名稱，同步寫回「選項清單」分頁
  - `update`：依 `month`（由工作日期換算）+ `ID` 定位列並覆寫內容
  - `delete`：依 `month` + `ID` 定位列，將「已刪除」設為 TRUE
- 後端必須重複驗證前端已做過的規則（完成度限制 0–100、今日工時非負數、必填欄位不可為空等），因為 API 網址公開，理論上可被繞過前端直接呼叫

**可公開的識別碼**：Apps Script Web App 網址、Google OAuth Client ID 都可以放心寫在前端程式碼裡公開，這是 Google 官方設計上允許的，真正把關的是後端的登入驗證，不是網址保密。Google Sheet ID 建議存在 Apps Script 的 `PropertiesService`（指令碼屬性），不寫死在程式碼裡。

# 前端架構（Vue 3 + TypeScript，部署於 GitHub Pages）

```
src/
  pages/
    ManageView.vue        # 管理頁：需 Google 登入，含新增/編輯/刪除，單日切換
    PublicView.vue        # 檢視頁：唯讀，任何人可看，單日切換
  components/
    WorkItemTable.vue     # 表格排版（複用於管理頁／檢視頁）
    WorkItemForm.vue      # 新增/編輯表單（Drawer 呈現）
    DateNav.vue           # ◀ 上一天 / 日期選擇器 / 下一天 ▶ / 回到今天
    ProjectAutocomplete.vue
  composables/
    useGoogleAuth.ts      # 登入狀態、ID Token 管理
    useWorkItems.ts        # 讀寫 API 呼叫、狀態管理
  styles/
    tokens.css             # 色彩變數（--color-bg / --color-accent...），預留深色模式擴充，元件一律吃變數不寫死 hex
shared/
  validation-schema.json   # 前後端共用的驗證規則來源（唯一事實來源）
apps-script/                # clasp 專案（Apps Script 原始碼版控）
  Code.gs
  build/schema.gs           # 由 shared/validation-schema.json 產生，build 時自動同步
```

**共用驗證 schema 同步方式**：`shared/validation-schema.json` 是唯一事實來源，前端直接 import；另有一支 build script（`npm run build:gs`）在建置階段把這份 JSON 轉成 Apps Script 可讀的 `schema.gs`，避免手動維護兩份規則。

**開發工具鏈**：
- **ESLint**（flat config，`eslint.config.js`）：`eslint-plugin-vue` + `@vue/eslint-config-typescript`，`npm run lint` 檢查程式碼品質（未使用變數、type 錯誤等）
- **Prettier**（`.prettierrc.json`）：無分號、單引號、printWidth 100，`npm run format` 格式化；透過 `@vue/eslint-config-prettier` 關掉與 ESLint 衝突的樣式規則，兩者分工不重疊
- **`.editorconfig`**：管編輯器層級的基本排版（縮排、換行符、結尾換行等）
- **路徑別名**：`@/` 對應 `src/`（`vite.config.ts` 的 `resolve.alias` + `tsconfig.app.json` 的 `paths` 都要同步設定），避免元件一多之後出現 `../../../components/xxx` 這種難維護的相對路徑
- **Node 版本**：鎖定 `>=24.1.0`（`.nvmrc`、`package.json` 的 `engines`），並用 `.npmrc` 的 `engine-strict=true` 讓版本不符時直接擋下 `npm install`，避免換機器開發版本不一致
- **套件管理工具**：僅使用 npm（`package.json` 的 `packageManager` 欄位已鎖定），不要混用 yarn/pnpm，避免 lockfile 衝突
- **樣式語言**：採用 **SCSS**，元件的 `<style>` 一律加 `lang="scss"`（`<style scoped lang="scss">`），需要安裝 `sass` 作為 devDependency；`src/styles/tokens.css` 與既有元件目前還是純 CSS，之後陸續遷移時一併改副檔名為 `.scss`
- **UI 元件庫**：以自訂元件為主，僅在「可搜尋下拉選單／多選標籤」這類自己刻成本高的互動元件才用 **Naive UI**（目前只用到 `NSelect`）。主題色透過 `App.vue` 的 `<n-config-provider :theme-overrides>` 對齊 `tokens.css` 的 `--color-accent`/`--color-danger`，其餘元件維持手刻 + CSS token，不整套套用 Naive UI 的視覺風格

## 命名慣例

- 元件檔名：PascalCase（例如 `WorkItemTable.vue`）
- 資料夾／非元件檔名：kebab-case
- Composables：`use` 前綴（例如 `useGoogleAuth.ts`）

# UI/UX 定案

- 排版方向：A 版（商務簡潔風）——白底、細邊框表格，藍色系點綴，逾期用左側紅色標線＋小紅標籤提示
- 色彩管理：一律用 CSS 變數（design token），不寫死 hex，符合開閉原則；初期只做白色系，右上角先放一個不可點擊的深色模式圖示（滑鼠移上顯示「即將推出」）當伏筆
- 管理頁／檢視頁共用同一套表格元件，差別只在是否顯示編輯/刪除操作與登入資訊
- 前台改成**以日期為單位**呈現（非月份）：「◀ 上一天 / 日期選擇器 / 下一天 ▶」＋「回到今天」做單日切換，跨月切換對使用者無感，由 Apps Script 依日期自動換算月份分頁
- 完成度用進度條呈現；預計期限已過但完成度 < 100 的列，用顏色標示逾期，並排在前面
- 新增/編輯用 Drawer 呈現，不整頁跳轉；刪除即使是軟刪除，也要跳確認對話框
- 逾期只做視覺標示，不做主動通知（Email 提醒等）
- 管理頁的 Google 登入狀態存在登入 session 內，不用每次操作重新登入

## RWD 斷點

- **手機**：`< 768px`（桌面版表格改卡片式列表，方便隨手填寫「處理內容」）
- **平板**：`768px – 1023px`
- **桌面**：`≥ 1024px`

採 **mobile-first** 寫法：預設先寫手機版樣式，再用 `min-width` 往上疊加平板／桌面的覆寫，避免每個斷點重複宣告同樣屬性。

斷點數值選 `768`/`1024` 是業界慣用值（對應 iPad 直向寬度與多數筆電最小寬度，同 Tailwind 的 `md`/`lg`），方便之後接手的人不用重新理解一套自訂數字。

> 技術限制：CSS 目前不支援在 `@media` 條件裡引用 custom property，所以斷點數值無法像色彩那樣定義成 `tokens.css` 的變數強制共用，只能維持寫死的數字並靠這份文件記錄的慣用值保持一致，新增／修改斷點時務必同步回來更新這裡。

# 開發階段拆分

1. Google Sheet 準備：建立「選項清單」分頁、確認分頁欄位含工作日期／ID／已刪除、Apps Script 專案初始化
2. Apps Script 後端：doGet／doPost、自動建分頁邏輯、ID Token 驗證、共用 schema 驗證、選項清單讀寫
3. 前端基礎建設：Vite + Vue 3 + TS 專案、ESLint/Prettier/.editorconfig、CSS token 架構、GIS 登入串接
4. 管理頁：表格（A 版排版）、新增/編輯 Drawer、單日切換、自動完成/下拉選單、刪除確認
5. 檢視頁：唯讀表格、單日切換
6. 部署：GitHub Actions 建置流程 → GitHub Pages

# 分支策略與部署

Trunk-based，單人開發，不開 `release`/長期分支：

- `main`：穩定分支，唯一的正式部署來源，對應正式站 GitHub Pages 網址（repo 根路徑）
- `dev`：日常開發測試分支，功能開發完先進這裡驗證
- `feat/xxx`：個別功能開發用，完成後合併回 `dev`，穩定後再合併回 `main`

**dev 分支的測試方式**：
- 日常開發用本地 `vite dev` / `vite preview`，Google OAuth Client ID 需額外授權 `http://localhost:5173` 這個來源，這樣才能在本機測登入流程
- 合併進 `main` 前，想驗證「接近正式環境」的行為（GitHub Pages 的 base path、路由 history 模式重新整理是否 404、HTTPS 環境下 Google 登入行為），用 GitHub Actions 把 `dev` 分支的 build 產物部署到一個獨立子路徑 **`/developer/`**（例如 `https://swzx00.github.io/Progress/developer/`），跟 `main` 部署的正式站分開，避免測試中的版本影響正式站
  - 實作方式：`dev` push 觸發的 workflow 用 `vite build --base=/Progress/developer/`，再用 `peaceiris/actions-gh-pages` 搭配 `destination_dir: developer` 部署到 `gh-pages` 分支下的 `developer/` 資料夾；`main` push 觸發的 workflow 照常部署到 `gh-pages` 分支根目錄

# Commit 規範

採用 **Conventional Commits**，格式與型別（type）維持英文（方便未來接 changelog 工具／commitlint），但 `subject` 說明用中文：

```
<type>(<scope>): <subject>
```

**type**：
- `feat`：新增功能
- `fix`：修正錯誤
- `docs`：文件異動（含 CLAUDE.md）
- `style`：純樣式調整，不影響邏輯
- `refactor`：重構，不新增功能也不修 bug
- `test`：測試相關
- `chore`：建置流程、依賴套件、雜項——**包含專案骨架建立、ESLint/Prettier 等工具鏈設定**這類沒有直接產生使用者可見功能的基礎建設
- `ci`：CI/CD 設定（GitHub Actions 等）

判斷 `feat` vs `chore` 的原則：這筆改動是「使用者用得到的新功能/畫面/行為」用 `feat`；是「讓開發更順、跟使用者功能無關」的工具鏈/建置/依賴，用 `chore`。

**scope**：對應改動範圍，例如 `manage-view`、`public-view`、`apps-script`、`sheet`、`auth`、`deploy`

**範例**：
```
feat(manage-view): 新增新增/編輯用的 Drawer 表單
fix(apps-script): 今日工時欄位禁止輸入負數
docs: 補充 CLAUDE.md 分支策略與部署規劃
ci(deploy): 新增 dev 分支部署到 /developer/ 子路徑的 workflow
chore: 建立專案骨架（Vite + Vue 3 + TS）
chore: 新增 ESLint、Prettier 與 .editorconfig
```

**執行規則**：每次 commit 前先列出要提交的內容（`git status`/`git diff` 摘要）與訊息，等使用者明確確認後才實際執行 `git commit`，不主動搶先提交。

# 常用指令

```bash
npm run dev        # 本地開發伺服器
npm run build      # 型別檢查（vue-tsc）+ 正式建置
npm run preview    # 預覽 build 產物
npm run lint       # ESLint 檢查並自動修復
npm run format     # Prettier 格式化 src/
```

# 需要使用者事先準備的東西

- 在 GCP 建立 OAuth 用戶端 ID（給 Google 登入按鈕用）
- 確認 Google Sheet 已依上述結構調整（新增工作日期／ID／已刪除欄位、選項清單分頁）

---

## Claude 協作指引

當協助此專案開發時，請注意：

1. **保持現有架構**：本文件記錄的技術選型、資料模型、分支策略都是已定案的決策，異動前先跟使用者確認，不要自行更換方案
2. **commit 前先確認**：實作完成後先列出要提交的內容與訊息，等使用者明確同意才執行 `git commit`
3. **型別安全**：所有新增程式碼需有完整 TypeScript 型別，`shared/validation-schema.json` 是前後端共用驗證規則的唯一事實來源
4. **錯誤處理**：所有呼叫 Apps Script API 的地方都要處理 loading／成功／失敗狀態，不能假設網路請求一定成功
5. **語言**：介面文字與程式碼註解使用繁體中文（台灣用語），回覆使用者也一律用繁體中文
6. **色彩管理**：樣式一律吃 `src/styles/tokens.css` 的 CSS 變數，不要在元件裡寫死 hex 色碼
