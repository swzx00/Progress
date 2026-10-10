# 專案簡介

> 最後更新：2026-10-10

「工作進度」列管系統。取代目前手動維護的 Google Sheet 表單，改用前端頁面輸入/檢視資料，資料實際存放位置仍是 Google Sheet。

- 專案類型：**純前端專案**，沒有自建後端主機。Google Apps Script Web App 扮演「後端 API」的角色，前端（Vue 3 + TS）部署在 GitHub Pages 為靜態站
- 資料來源：[Google Sheet](https://docs.google.com/spreadsheets/d/1_1MxTiuMg9ALdr-6o77-c2qCWqYuktSFPM6lGYVg8n0/edit?gid=0#gid=0)（全新建立的工作用試算表，跟最初參考欄位命名的舊表是不同份；實際欄位結構以 [docs/sheet-schema.md](docs/sheet-schema.md) 為準）
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


# 文件索引

細節拆在 `docs/`，改到相關功能時先讀對應的檔案。本檔只留跨元件、容易踩雷的規則。

| 檔案 | 內容 |
|---|---|
| [docs/sheet-schema.md](docs/sheet-schema.md) | Google Sheet 各分頁與欄位的完整說明、請假固定值、已刪除紀錄分頁、自動排序、選項清單分頁（含工時設定欄）、日期儲存格格式 |
| [docs/api.md](docs/api.md) | Apps Script `doGet`／`doPost` 各 type／action 的參數、回應與驗證、前端登入、本機 CORS proxy |
| [docs/dev-tooling.md](docs/dev-tooling.md) | ESLint／Prettier／Stylelint、VS Code 設定、建置拆檔、npm audit、Node／npm 版本 |
| [docs/ui/theme.md](docs/ui/theme.md) | 色階選色理由、放假色、字體、深色模式 |
| [docs/ui/date-nav.md](docs/ui/date-nav.md) | DateNav 版面與按鈕、今天標示、日期選擇器、台灣國定假日 |
| [docs/ui/work-item-table.md](docs/ui/work-item-table.md) | 表格合併欄、今天／斑馬紋底色、狀態顏色、文字刪節與展開、操作欄、項次調整（拖曳） |
| [docs/ui/work-item-form.md](docs/ui/work-item-form.md) | 表單欄位規格、驗證、推薦與預填、項次欄、每日工時上限、未儲存確認、送出中、儲存失敗處理 |
| [docs/ui/dialogs.md](docs/ui/dialogs.md) | ConfirmDialog、選項清單管理、工具下拉選單、本日總結 |
| [docs/ui/copy.md](docs/ui/copy.md) | 單項複製、複製本日 |
| [docs/ui/search.md](docs/ui/search.md) | 搜尋欄、推薦、結果呈現、標示符合的字 |
| [docs/ui/export-excel.md](docs/ui/export-excel.md) | 匯出 Excel |
| [docs/ui/work-hours.md](docs/ui/work-hours.md) | 工時設定、表單工作時段、換算規則 |

# 資料模型摘要

完整說明見 [docs/sheet-schema.md](docs/sheet-schema.md)。

- **工作紀錄**分頁（`DATA_SHEET_NAME`）放所有紀錄（含請假），照「工作日期 → 項次」自動排序。表頭：ID、工作日期、項次、交辦單位、交辦人員、專案名稱、專案Repo（逗號串）、工作目標、處理內容、今日工時、預計期限、完成度、狀態、已刪除。Apps Script 一律用表頭名稱找欄位、用 ID 定位列
- **項次**每天從 1 開始，新增時由後端決定（最大項次＋1）
- **請假**：同一分頁，狀態＝`休假`，固定欄位由後端覆蓋（`leave.fixed`），不寫回選項清單，`休假` 不在 `STATUS_OPTIONS` 裡
- **刪除**：整列搬到「已刪除紀錄」分頁封存（多一欄刪除時間）
- **選項清單**分頁：交辦單位／交辦人員／專案名稱／專案Repo 的可選值（每欄連續、值當文字比對），另有「工時設定」欄
- 每日工時合計（含請假）不可超過 24 小時，前後端都擋；超過 8 小時只在畫面標紅
- 資料模式是日誌式：同一專案每天新增一列，不覆寫舊資料

# Apps Script API 摘要

完整說明見 [docs/api.md](docs/api.md)。

- `doGet`（公開，不需登入）：`date=YYYY/MM/DD`（單日）、`type=options`（選項清單＋近期紀錄＋工時設定）、`type=range&from&to`（匯出用，最多 366 天）、`type=search&q[&field]`（最多 200 筆）
- `doPost`（要 Google ID Token，email 必須是擁有者）：`create`／`update`／`delete`／`batchCreate`（可帶 `replace`）／`reorder`／`addOption`／`renameOption`／`deleteOption`／`saveWorkHours`
- 後端一定重複驗證前端的規則（`validateItem_`），API 網址是公開的
- Apps Script Web App 網址、OAuth Client ID 可公開；Sheet ID 與 `GOOGLE_CLIENT_ID` 放在指令碼屬性。部署步驟在 `Code.gs` 開頭註解

# 關鍵慣例（容易踩雷）

- **回應一律 HTTP 200**（Apps Script 平台限制），成功／失敗只看回應有沒有 `error`，不能用 `res.ok`。要分辨錯誤類型看 `code`（目前只有 `UNAUTHORIZED`），用 `e instanceof ApiError && e.code === 'UNAUTHORIZED'`，**不比對 `error` 文字**。新增錯誤代碼時 `Code.gs`、`src/mocks/handlers.ts`、`useWorkItems.ts` 的 `ApiErrorCode` 一起改。MSW 也一律回 200
- **日期格式**：Sheet 與 API 是 `YYYY/MM/DD`；前端內部是 `YYYY-MM-DD`（原生 `<input type="date">` 只吃這個）。兩者轉換**只在 `useWorkItems.ts`**（`toApiDate`／`fromApiDate`／`toApiItem`）。前端日期字串一律用 `src/utils/date.ts`（`toLocalDateString`／`todayString`／`parseLocalDate`／`addDays`），**不要用 `toISOString()`**（台灣凌晨會變前一天，`NDatePicker` 的時間戳會少一天），也不要用 `new Date('YYYY-MM-DD')`（當成 UTC）。例外：`ExportModal` 自己用本地年月日、`export-excel.ts` 刻意用 UTC 建 Excel 日期
- **前端登入只是體驗層**：`useGoogleAuth.ts` 的允許清單決定要不要渲染管理功能，真正把關在後端 `doPost`
- **手動同步清單**（改一處要一起改）：

  | 規則 | 位置 |
  |---|---|
  | 欄位驗證 | `shared/validation-schema.json`（唯一事實來源，前端直接 import）↔ `Code.gs` 的 `VALIDATION_RULES`、`LEAVE_RULES`、`DAILY_HOURS_MAX`、`WORK_HOURS_DAILY_STANDARD` |
  | 狀態選項 | `src/types/work-item.ts` 的 `STATUS_OPTIONS`（要 `as const`，不放 JSON）↔ `Code.gs` 的 `STATUS_OPTIONS` |
  | 每日項次規則 | `Code.gs` 的 `getNextDailyIndex_` ↔ `useWorkItems.ts` 的 `fetchDaySummary` ↔ MSW |
  | 工時超過訊息 | 前端 `dailyHoursMessage` ↔ `Code.gs` 的 `dailyHoursError_` ↔ MSW |
  | 搜尋比對 | `src/utils/search-work-items.ts` 的 `matchesSearch` ↔ `Code.gs` 的 `matchesSearch_` |
  | 工時設定驗證 | `src/utils/work-hours.ts` 的 `validateWorkHoursSetting` ↔ `Code.gs` 的 `validateWorkHours_` |
  | 近期紀錄 | 前端 `RECENT_DAYS`／`filterRecentItems` ↔ `Code.gs` 的 `getRecentItems_` |
  | MSW 假後端 | `src/mocks/handlers.ts` 整體跟 `Code.gs` 同規則 |
  | 字體、行高 | `src/style.scss` 的 `body` ↔ `App.vue` 的 `themeOverrides.common`（`fontFamily`、`lineHeight`） |
  | 色值 hex | `tokens.scss` ↔ `App.vue` 的 Naive UI overrides ↔ `export-excel.ts` 的 ARGB |
  | 放假色判斷 | `DateNav` 的 `--today` 修飾符 ↔ `WorkItemTable` 的 `--holiday`＋`--viewing-today` |
  | 搜尋欄寬度 | `DateNav` 的 `--switcher-width` ↔ 日期切換按鈕與日期選擇器寬度 |

  `npm run build:gs`（把 JSON 轉成 `schema.gs`）與 clasp 都還沒做，`Code.gs` 目前手動貼到 Apps Script 編輯器部署
- **不要用 `v-html`** 顯示使用者輸入的內容


# 前端架構（Vue 3 + TypeScript，部署於 GitHub Pages）

```
src/
  main.ts                  # 掛載前先 initTheme()；DEV 且沒關 MSW 時先啟動 MSW
  router/
    index.ts               # 只有一個路由（/ → HomeView），createWebHistory(BASE_URL)
  types/
    work-item.ts           # WorkItem 型別、STATUS_OPTIONS／STATUS_KEYS／LEAVE_STATUS、isOverdue
  mocks/
    handlers.ts            # MSW 假後端（npm run dev 預設啟用），規則跟 Code.gs 手動同步
    browser.ts
  pages/
    HomeView.vue           # 單一路由（/），依登入狀態切換管理／檢視畫面：isAuthorized 顯示新增/編輯/刪除，否則顯示唯讀畫面
  components/
    WorkItemTable.vue     # 表格排版（管理／檢視畫面共用，:editable 控制是否顯示操作欄，:viewing-today 控制表頭/卡片的今天樣式）
    WorkItemSearch.vue    # 搜尋欄：輸入框＋推薦選擇下拉＋搜尋按鈕，放在 DateNav 的 search slot
    WorkItemForm.vue      # 新增/編輯表單（Drawer 呈現），項次欄唯讀顯示目前／預計項次
    OptionsManagerModal.vue # 管理選項清單（新增/重新命名/刪除），獨立 Modal，只有 isAuthorized 看得到入口
    ConfirmDialog.vue     # 通用確認對話框（刪除工作紀錄、刪除選項清單的值、表單放棄變更都用這個），按鈕配置照 Apple HIG
    HighlightText.vue     # 搜尋結果標示符合的字：把切好的片段逐段渲染（不用 v-html）
    ClampText.vue         # 文字刪節：收合時截斷（手機 3 行、平板桌面 2 行），判斷是否真的被截斷，有滑鼠的裝置用 NTooltip 顯示全文；展開狀態由使用端控制
    OptionsDropdownState.vue # 可搜尋下拉選單（交辦單位、交辦人員、專案名稱、專案 Repo）放在 NSelect empty slot 的狀態畫面：載入中（AppLoading＋「選項載入中」）／載入失敗（「選項清單載入失敗」＋「重新載入」）
    AppLoading.vue        # 共用載入中（轉圈＋文字，prop label 預設「載入中…」），只負責內容本身，外層排版由使用端決定；HomeView 讀取資料、WorkItemForm 送出遮罩都用它
    CopyDayDialog.vue     # 「複製本日」選目標日期的對話框（預設下一個工作日），只負責畫面，工時檢查與寫入在 HomeView
    DaySummaryModal.vue   # 本日總結：把選到那天的工作紀錄整理成文字放進 Textarea（可修改、不存檔）＋複製按鈕
    ExportModal.vue       # 匯出 Excel：選匯出方式（年份／季度／月份／指定天數）與範圍，讀資料、產生 .xlsx 下載
    WorkHoursSettingModal.vue # 工時設定：上班、下班、午休時間
    AppToast.vue          # Toast（錯誤為主，另有 success 樣式），畫面上方置中，搭配 useToast.ts
    DateNav.vue           # ⏮ 上一個工作日 / ◀ 上一天 / 日期選擇器 / 下一天 ▶ / 下一個工作日 ⏭ / 回到今天（今天時改顯示「今天」狀態標示），顯示星期，放假日顯示徽章，日期選擇器今天時用 :deep() 改邊框/文字色，按鈕沒用途時 disabled
  composables/
    useGoogleAuth.ts      # 登入狀態、ID Token 管理
    useWorkItems.ts        # 讀寫 API 呼叫、狀態管理
    useTaiwanHolidays.ts   # 台灣國定假日查詢
    useToast.ts            # Toast 共用狀態（模組層級），showToast(message, type = 'error')／hideToast()
    useTheme.ts            # 深色模式：自動（依日出日落）／淺色／深色，套用 <html data-theme>
  directives/
    auto-resize.ts         # v-auto-resize：textarea 高度隨內容自動調整（表單的工作目標、處理內容／請假備註）
  utils/
    copy-work-item.ts      # buildCopyPayload：複製規則（單項複製、複製本日共用）
    day-summary.ts         # buildDaySummary／extractTaskCode：本日總結的文字規則
    export-excel.ts        # 匯出 Excel 的規則：範圍（yearPeriod／quarterPeriod／monthPeriod／rangePeriod）、檔名、分頁分組、欄位、樣式（buildExportWorkbook，動態載入 ExcelJS）
    work-hours.ts          # 工時設定：時段與小時互換（rangeToHours／hoursToRange／roundToQuarter）、設定驗證（validateWorkHoursSetting，Code.gs 手動同步）
    search-work-items.ts   # 搜尋欄：比對規則（matchesSearch，Code.gs 手動同步）、推薦選擇（buildSuggestions）
    date.ts                # 本地時間的 YYYY-MM-DD 日期字串（toLocalDateString／todayString／parseLocalDate／addDays），前端產生日期字串一律用這裡，不要用 toISOString
    sun-times.ts           # 日出日落時間（台北，天文公式計算），深色模式「自動」用
    recent-history.ts      # 近期紀錄：下拉推薦（recentUnit／recentAssignee／recentProject／recentRepos／withRecentFirst）、工作目標預填（targetKey／recentByTarget）、存檔後更新（upsertRecentItems）
  validation/
    work-item.ts           # 表單欄位驗證（validateWorkItem），規則來自 shared/validation-schema.json
  styles/
    tokens.scss            # 色彩變數（統一色階 --color-<色系>-<階>，例如 --color-blue-500 / --color-black-100，色值取自公司設計系統），[data-theme='dark'] 底下是深色模式的值，元件一律吃變數不寫死 hex
shared/
  validation-schema.json   # 前後端共用的驗證規則來源（唯一事實來源）
apps-script/                # Apps Script 原始碼版控（clasp 尚未設定，目前手動貼到編輯器）
  Code.gs
  LegacyImport.gs           # 一次性匯入舊版「工作進度-2026H1／H2」試算表，用法見檔案開頭註解，匯入完可從 Apps Script 專案刪掉
  build/schema.gs           # （規劃中，尚未實作）由 shared/validation-schema.json 產生
```

## 開發工具鏈摘要

細節見 [docs/dev-tooling.md](docs/dev-tooling.md)。

- ESLint（flat config）＋ Prettier（有分號、單引號、printWidth 100、`endOfLine: auto`）＋ Stylelint（BEM class 命名、屬性排序、`@media (min-width: …)` 寫法）；VS Code 存檔時自動修正
- 樣式一律 SCSS（`<style scoped lang="scss">`）
- 路徑別名 `@/` → `src/`（`vite.config.ts` 與 `tsconfig.app.json` 都要設）
- Node `>=24.1.0`（`engine-strict`），只用 npm，不混用 yarn／pnpm
- 拖曳排序用 `vue-draggable-plus`；匯出 Excel 用 ExcelJS（動態載入）
- 新增大型套件時看 build 輸出大小，必要時加進 `vite.config.ts` 的 `codeSplitting.groups`
- `npm audit` 剩下的 high（`braces`）沒有修正版，**不要跑 `npm audit fix --force`**


## 命名慣例

- 元件檔名：PascalCase（例如 `WorkItemTable.vue`）
- 資料夾／非元件檔名：kebab-case
- Composables：`use` 前綴（例如 `useGoogleAuth.ts`）

# UI/UX 原則

細節見 `docs/ui/` 各檔案。

- 排版：A 版商務簡潔風（白底、細邊框表格、藍色點綴）；逾期用左側紅色標線＋「逾期」標籤，只做視覺標示、不主動通知
- 單一路由 `/`（`HomeView.vue`），依 `isAuthorized` 切換管理／唯讀畫面；以**日期**為單位檢視
- 按鈕沒有用途時要 disabled，不能點了沒反應
- 新增／編輯用 Drawer；設定類操作用置中 Modal（手機滿版）；刪除與破壞性動作一律先跳 `ConfirmDialog`（按鈕配置照 Apple HIG）
- 錯誤一律用 `AppToast`；登入錯誤（`UNAUTHORIZED`）關閉表單並登出，其他錯誤保留畫面讓使用者重試
- 圖示用行內 SVG 的 Lucide（ISC 授權）
- **UI 元件庫**：以手刻元件＋CSS token 為主，只有自己刻成本高的才用 Naive UI（`NSelect`、`NDatePicker`、`NTooltip`、`NDropdown`）。主題色、locale（`zhTW`／`dateZhTW`）在 `App.vue` 的 `n-config-provider` 設定。`NDatePicker` 要設 `:first-day-of-week="6"` 才是星期日開頭（數值語意不直觀，不能依賴 locale 預設）

## 色彩 token

- `src/styles/tokens.scss` 只有一種 token：`--color-<色系>-<階>`（例如 `--color-blue-500`），元件的文字、背景、邊框都直接挑色階，**不寫死 hex，也不定義 text／surface／border 這類用途 token**（使用者決定）
- 色值來自公司設計系統的 primitive 色階（`D:\cheng\Documents\Project\recruitNew\recruitwebvue\assets\scss\_color.scss`，另一個專案）：`Candidate-Blue` → `blue`、`1111-Black` → `black`、`1111-Rose` → `red`、`1111-Teal`／`Green`／`Yellow`／`Orange` → 同名。不自己配色，新顏色先從這份挑；用到新色系時整組色階（`000`～`1000`）一起複製。例外：`purple` 是推算的
- 設計系統的品牌紅 `Candidate-Red` 跟 `red` 是不同色階，真的要用時另外取名（例如 `--color-brand-red-*`）
- 常用對照：主文字 `black-800`、次要文字 `black-500`、白底 `black-000`、淺灰底 `black-050`、細邊框 `black-100`、主色 `blue-500`、深藍文字 `blue-700`、危險色 `red-600`
- 小字在淺底上要對比 ≥ 4.5:1（WCAG AA）
- 深色模式：`:root[data-theme='dark']` 把同一組 token 的階數上下對調，元件不用改；例外與細節見 [docs/ui/theme.md](docs/ui/theme.md)

## RWD 斷點


- **手機**：`< 768px`（桌面版表格改卡片式列表，方便隨手填寫「處理內容」）
- **平板**：`768px – 1023px`（`WorkItemTable` 用表格版面，但完成度／今日工時／預計期限合併成一欄，見 [docs/ui/work-item-table.md](docs/ui/work-item-table.md)）
- **桌面**：`≥ 1024px`

採 **mobile-first** 寫法：預設先寫手機版樣式，再用 `min-width` 往上疊加平板／桌面的覆寫，避免每個斷點重複宣告同樣屬性。

**`@media` 一律巢狀寫在該 class 區塊內**，不在檔案最外層另開一個集中所有 class 的 `@media` 區塊，讓同一個元素的手機版／桌面版樣式寫在一起，改元件時不會漏改另一個斷點。寫法規則：
- `@media` 放在該 class 區塊的**最後面**（所有手機版修飾符 `&--xxx` 之後），該 class 修飾符的桌面版覆寫也一起寫在這個 `@media` 裡面（`@media (min-width: 768px) { ...; &--xxx { ... } }`），不要拆回各修飾符自己的區塊內。原因是 CSS 同權重時後寫的贏：桌面版常有「通用重置」（例如 `WorkItemTable` 的 `.work-item-table__cell` 桌面版把所有欄位的 `order` 歸 0、`font-size` 統一），必須排在所有手機版修飾符之後才蓋得過它們，而各修飾符的桌面版覆寫（例如 `&--index` 的 `text-align: end`）又必須排在通用重置之後。照這個寫法，編譯出來的順序固定是「手機基礎 → 手機修飾符 → 桌面通用 → 桌面修飾符」
- 多個斷點依序由小到大排（768 在前、1024 在後），大斷點才蓋得過小斷點
- 從其他元件狀態往下選的規則（例如 `.work-item-table--editable .work-item-table__row`），寫在被選元素的區塊內，用 `.work-item-table--editable & { @media (...) { ... } }` 的形式
- Stylelint 沒有現成規則能自動檢查這件事，靠這份文件跟 code review 維持

斷點數值選 `768`/`1024` 是業界慣用值（對應 iPad 直向寬度與多數筆電最小寬度，同 Tailwind 的 `md`/`lg`），方便之後接手的人不用重新理解一套自訂數字。

> 技術限制：CSS 目前不支援在 `@media` 條件裡引用 custom property，所以斷點數值無法像色彩那樣定義成 `tokens.scss` 的變數強制共用，只能維持寫死的數字並靠這份文件記錄的慣用值保持一致，新增／修改斷點時務必同步回來更新這裡。

# 開發階段拆分

> 1～4 已完成，5 尚未開始（計畫見專案檔案 `plans/2026-10-09-production-deploy-plan.md`）。

1. Google Sheet 準備：建立「選項清單」分頁、確認分頁欄位含工作日期／ID／已刪除、Apps Script 專案初始化
2. Apps Script 後端：doGet／doPost、自動建分頁邏輯、ID Token 驗證、共用 schema 驗證、選項清單讀寫
3. 前端基礎建設：Vite + Vue 3 + TS 專案、ESLint/Prettier/.editorconfig、CSS token 架構、GIS 登入串接
4. 管理／檢視畫面（`HomeView.vue`，單一路由依登入狀態切換）：表格（A 版排版）、新增/編輯 Drawer、單日切換、自動完成/下拉選單、刪除確認、唯讀模式
5. 部署：GitHub Actions 建置流程 → GitHub Pages

# 分支策略與部署

Trunk-based，單人開發，不開 `release`/長期分支：

> 目前（2026-10-10）遠端只有 `dev` 與各功能分支，`main`、`gh-pages`、`.github/workflows/` 都還沒建立，下面是規劃。

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

**scope**：對應改動範圍，目前用過的有 `manage-view`（主畫面，`HomeView` 與其元件）、`search`、`theme`、`auth`、`apps-script`；之後可能用到 `sheet`、`deploy`。原本規劃的 `public-view` 已不適用（管理／檢視頁已合併成 `HomeView`）

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
npm run lint:style # Stylelint 檢查並自動修復（含 CSS 屬性排序）
npm run format     # Prettier 格式化 src/
```

**環境變數**：`.env` 不進版控（見 `.gitignore`），第一次拉專案要自己複製 `.env.example` 成 `.env` 並填入真實值（`VITE_APPS_SCRIPT_URL`、`VITE_GOOGLE_CLIENT_ID`）。這兩個值本身都設計成可公開（見上方「Apps Script API 摘要」），不進版控是為了避免以後有人在同一個檔案裡加了真正的密鑰卻忘記它會被 commit，是預防性的習慣，不是因為這兩個值現在需要保密。

`npm run dev` 預設會啟動 MSW 攔截 API 請求（打假資料，方便切版/開發不用等真後端）。選填的 `VITE_ENABLE_MSW=false` 可以在 dev 模式下關掉 MSW，改讓請求真的打到 `VITE_APPS_SCRIPT_URL` 指到的 Apps Script。沒設這個變數時維持原本行為（照樣打假資料）。

**本機測真後端**：`VITE_ENABLE_MSW=false` 時前端改打同源的 `/apps-script-proxy`，由 `vite.config.ts` 的 `appsScriptDevProxyPlugin` 在 Node 端轉發（Apps Script 對 `localhost` 的 CORS 有缺陷；不能用 Vite 內建 `server.proxy`，它不會跟著 302 轉址）。只在本機開發有效，細節見 [docs/api.md](docs/api.md)。

## Claude 協作指引

當協助此專案開發時，請注意：

1. **保持現有架構**：本文件記錄的技術選型、資料模型、分支策略都是已定案的決策，異動前先跟使用者確認，不要自行更換方案
2. **commit 前先確認**：實作完成後先列出要提交的內容與訊息，等使用者明確同意才執行 `git commit`
3. **型別安全**：所有新增程式碼需有完整 TypeScript 型別，`shared/validation-schema.json` 是前後端共用驗證規則的唯一事實來源
4. **錯誤處理**：所有呼叫 Apps Script API 的地方都要處理 loading／成功／失敗狀態，不能假設網路請求一定成功
5. **語言**：介面文字與程式碼註解使用繁體中文（台灣用語），回覆使用者也一律用繁體中文
6. **色彩管理**：樣式一律吃 `src/styles/tokens.scss` 的 CSS 變數，不要在元件裡寫死 hex 色碼；一律用 `--color-<色系>-<階>` 色階，色值取自公司設計系統，規則見上方「色彩 token」
