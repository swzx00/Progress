# 測試

## 工具與指令

- **Vitest**（測試執行器，沿用 `vite.config.ts` 的設定與 `@/` 別名）＋ **Vue Test Utils**、**happy-dom**（元件測試）
- `npm run test`：watch 模式，改檔案自動重跑
- `npm run test:run`：跑一次全部（CI、commit 前用）
- `npm run test:e2e`：Playwright 瀏覽器測試（見下方「瀏覽器測試」），第一次在本機跑要先 `npx playwright install chromium`

## 測試放哪裡、測什麼

| 位置 | 內容 |
|---|---|
| `src/utils/*.spec.ts`、`src/types/*.spec.ts` | 純函式單元測試：日期、工時換算、搜尋比對與標示、本日總結、近期推薦與預填、複製、匯出範圍與檔名、日出日落 |
| `src/validation/*.spec.ts` | 表單驗證：`shared/validation-schema.json` 的每條規則、請假規則、每日工時合計訊息 |
| `tests/apps-script/*.spec.ts` | 前後端一致性：在 Node 載入 `apps-script/Code.gs`，跟前端用同一組案例比對；`Code.gs` 接假的試算表跑後端共同規格與讀寫 Sheet 的細節（見下方） |
| `src/composables/*.spec.ts` | API 邊界（`useWorkItems`、`useOptions`）：日期格式只在這裡轉換、回應一律 200 只看 `error`、`UNAUTHORIZED` 的 `ApiError`、已刪除過濾、預計項次與工時合計；台灣假日（`useTaiwanHolidays`）：補班日、連假、跨年、資料抓不到時的備援 |
| `src/components/*.spec.ts` | 元件測試：`WorkItemForm`（項次、送出、24 小時檢查、請假、複製、未儲存確認、預填、工作時段）、`DateNav`（工作日按鈕停用、放假徽章與工時合計）、`WorkItemTable`（排序、上移下移、逾期與請假標示、搜尋結果模式、空狀態）、`OptionsManagerModal`、`WorkHoursSettingModal`、`ConfirmDialog`、`HighlightText` |
| `src/pages/HomeView.spec.ts` | 主畫面流程：存檔、刪除、複製本日、項次調整失敗時的處理（登入錯誤關閉畫面並登出，其他錯誤保留畫面）、複製本日的工時檢查與覆蓋確認 |
| `tests/backend/contract.ts` | 後端共同規格：MSW 與 `Code.gs` 跑同一組案例（見下方） |
| `tests/msw/*.spec.ts` | MSW 假後端跑後端共同規格 |
| `tests/export/*.spec.ts` | 匯出 Excel 的檔案內容：真的產生 .xlsx 再用 ExcelJS 讀回來，檢查分頁、欄位、日期儲存格、樣式，顏色跟 `tokens.scss` 淺色模式比對 |
| `e2e/*.e2e.ts` | Playwright 瀏覽器測試：RWD、深色模式、文字截斷（見下方） |
| `src/testing/` | 測試用的假資料：`fixtures.ts`（`makeItem`／`makeRecent`，只覆寫測試在意的欄位）、`taiwan-calendar.ts`（產生一整年的假行事曆，可指定國定假日與補班日） |

測試檔放在被測檔案旁邊（`work-hours.ts` ↔ `work-hours.spec.ts`），`describe`／`it` 用中文寫規則本身（例如「跨過整段午休，扣掉 1.5 小時」），跑測試的輸出就是一份規則清單。

## 慣例

- **改規則時 spec 一起改**：CLAUDE.md 裡「使用者決定」的規則，對應的測試案例就是那條規則的定義；規則改了測試會失敗，照新規則改測試，不要只改到測試通過
- **時區固定台灣**：`vitest.global-setup.ts` 把 `TZ` 設成 `Asia/Taipei`，日期相關的測試在 Windows 本機、UTC 的 CI 結果都一樣
- **元件測試只測元件自己的行為**：欄位連動、什麼時候查詢、送出的內容、確認對話框；換算、驗證的數字對不對交給單元測試。API（`useOptions`、`fetchDaySummary`）用 `vi.mock` 換成假的，`NSelect` 換成空殼，需要選值的情境改用「編輯既有紀錄」帶入
- 元件測試檔開頭加 `// @vitest-environment happy-dom`，其他測試跑在 Node，比較快（composable 用到 `window.location` 的也要加）
- **API 用 `vi.stubGlobal('fetch', …)` 換成假的**，不打真的 API；API 網址在模組載入時決定、`useOptions` 與假日資料有模組層級的快取，所以這些測試每個案例都 `vi.resetModules()` 再動態 `import`，網址用 `vi.stubEnv` 指定，不吃本機 `.env`
- `HomeView` 的子元件全部換成空殼，用 `findComponent(...).vm.$emit(...)` 模擬使用者在子元件裡的操作；`DateNav` 的空殼保留 slot，動作按鈕才點得到

## 前後端一致性測試

`Code.gs` 有幾套規則是從前端手動同步過去的。`tests/apps-script/consistency.spec.ts` 用 `node:vm` 載入 `Code.gs`（頂層只有 `var` 與 `function`，不會呼叫 Apps Script 服務），比對：

- 常數：`VALIDATION_RULES` ↔ `shared/validation-schema.json`、`LEAVE_RULES`、`STATUS_OPTIONS`、每日工時上限、工時設定標準、近期紀錄天數、匯出天數上限、搜尋欄位與上限
- 函式（同一組案例跑兩邊，結果要相同）：`validateItem_` ↔ `validateWorkItem`／`validateLeave`、`dailyHoursError_` ↔ `dailyHoursMessage`、`validateWorkHours_` ↔ `validateWorkHoursSetting`、`matchesSearch_` ↔ `matchesSearch`

改 `Code.gs` 或前端任一邊，這裡失敗就代表另一邊忘了改。

## 後端共同規格（MSW ↔ Code.gs）

`tests/backend/contract.ts` 的 `describeBackendContract` 是一組後端規格：每日項次、改到別天重新編號、`batchCreate` 整批退回與覆蓋、`reorder` 檢查、請假固定值、選項清單同步、匯出範圍與搜尋的參數檢查。錯誤訊息要跟 `Code.gs` 一樣（固定文字的訊息檢查 `Code.gs` 原始碼裡有沒有這句，組出來的訊息直接呼叫 `Code.gs` 的函式比對）。同一組案例跑兩次：

- `tests/msw/handlers.spec.ts`：用 `msw/node` 對 MSW handlers 發請求（`npm run dev` 預設打的假後端）
- `tests/apps-script/backend.spec.ts`：`Code.gs` 的 `doGet`／`doPost` 接假的試算表

兩邊行為不一樣，就會有一邊失敗。MSW 只模擬工時相關的欄位驗證，其他欄位驗證在一致性測試比對。

### 假的試算表

`tests/apps-script/fake-spreadsheet.ts` 只實作 `Code.gs` 用到的 `SpreadsheetApp` API，行為盡量貼近真的 Sheet：寫入時自動轉型（純數字字串 → 數字、`TRUE` → 布林、`YYYY/MM/DD` → 日期、`HH:mm` → 時間，儲存格是純文字格式 `@` 就維持字串）、`getRange` 超出分頁列數會丟錯（新分頁預設 1000 列）、`insertRowsAfter` 補的列沿用上一列的格式、排序時空白排最後。`load-code-gs-backend.ts` 用 `node:vm` 執行 `Code.gs`，其他服務（指令碼屬性、UUID、日期格式化、tokeninfo 登入驗證）也換成假的；idToken `'token'` 是擁有者本人，JSON 字串的 idToken 直接當成 tokeninfo 的回應。試算表裡的日期是 vm 那邊的 `Date`，測試裡判斷日期要用 `Object.prototype.toString`，不能用 `instanceof`。

`tests/apps-script/sheet.spec.ts` 測共同規格看不到的 Sheet 細節：自動建分頁與表頭、儲存格型別、文字欄位不被轉型、每次寫入後排序、超過 1000 列自動補列、手動編輯過的分頁照樣讀得到、已刪除紀錄分頁、選項清單的數字值與連續、`compactOptionsSheet`、工時設定、登入驗證、近期紀錄、搜尋與匯出範圍。

假的試算表終究不是真的 Sheet（例如科學記號、千分位、地區格式的自動轉型沒有模擬），部署後還是要照實機測試清單手動驗證一次。

## 瀏覽器測試（Playwright）

happy-dom 沒有真的排版，量不到高度與寬度，所以版面相關的行為用 Playwright 在真的 Chromium 裡測。`playwright.config.ts` 自己起 `vite`（port 5174，打 MSW 假後端，不吃本機 `.env`），每個測試跑三種寬度：`mobile`（Pixel 7）、`tablet`（820px）、`desktop`（1280px），對應 CLAUDE.md 的 RWD 斷點。

- `rwd.e2e.ts`：沒有橫向捲軸、手機卡片／平板合併欄／桌面完整欄位、逾期紅線（顏色跟 `tokens.scss` 比對）、國定假日的徽章與空狀態
- `theme.e2e.ts`：切深色後 `data-theme`、底色、文字色階對調，重新整理後維持；唯讀模式
- `clamp-text.e2e.ts`：長文字收合時手機 3 行、平板桌面 2 行，「<展開>」「<收合>」，有滑鼠的裝置才有全文 tooltip

`e2e/fixtures.ts` 的設定：

- 時間固定在 2026/10/07（三）上午 10 點（`page.clock.setFixedTime`），MSW 的預設資料與「今天」才固定
- 外部資源換成假的：Google 登入腳本（不連 Google，`renderButton` 放一顆假按鈕）、台灣行事曆（10/9、10/10 放假）、Google 字型（不下載）。要用 `context.route`，MSW 的 Service Worker 放行的請求從 Worker 發出，`page.route` 攔不到
- `test.use({ loggedIn: true })`：在 sessionStorage 放一個擁有者的假 ID Token，直接進管理畫面（MSW 不驗證 token）

已經有 Chromium、不想下載的環境（例如雲端容器）可以設 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定執行檔。部署（第 5 階段）時再加：GitHub Pages 的 base path、重新整理不會 404、真的 Google 登入。

## 沒有自動測試的部分

- 真的 Apps Script 後端接真的 Sheet、Google 登入：部署後手動驗證
- 部署後才有的行為（GitHub Pages 的 base path、重新整理路由、HTTPS 下的 Google 登入）：做部署時再加進 Playwright
