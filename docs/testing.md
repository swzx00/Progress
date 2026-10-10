# 測試

## 工具與指令

- **Vitest**（測試執行器，沿用 `vite.config.ts` 的設定與 `@/` 別名）＋ **Vue Test Utils**、**happy-dom**（元件測試）
- `npm run test`：watch 模式，改檔案自動重跑
- `npm run test:run`：跑一次全部（CI、commit 前用）
- `npm run test:coverage`：跑一次全部並產生覆蓋率報告（終端機摘要＋`coverage/index.html`），不設門檻，用來找沒測到的地方
- `npm run test:e2e`：Playwright 瀏覽器測試（見下方「瀏覽器測試」），第一次在本機跑要先 `npx playwright install chromium`
- `npm run test:e2e:safari`：同一套瀏覽器測試改用 WebKit（Safari 的核心）跑，第一次要先 `npx playwright install webkit`

## 測試放哪裡、測什麼

| 位置 | 內容 |
|---|---|
| `src/utils/*.spec.ts`、`src/types/*.spec.ts` | 純函式單元測試：日期、工時換算、搜尋比對與標示、本日總結、近期推薦與預填、複製、匯出範圍與檔名、日出日落 |
| `src/validation/*.spec.ts` | 表單驗證：`shared/validation-schema.json` 的每條規則、請假規則、每日工時合計訊息 |
| `tests/apps-script/*.spec.ts` | 前後端一致性：在 Node 載入 `apps-script/Code.gs`，跟前端用同一組案例比對；`Code.gs` 接假的試算表跑後端共同規格與讀寫 Sheet 的細節（見下方） |
| `src/composables/*.spec.ts` | API 邊界（`useWorkItems`、`useOptions`）：日期格式只在這裡轉換、回應一律 200 只看 `error`、`UNAUTHORIZED` 的 `ApiError`、已刪除過濾、預計項次與工時合計；台灣假日（`useTaiwanHolidays`）：補班日、連假、跨年、資料抓不到時的備援；登入（`useGoogleAuth`）：解析 ID Token、允許清單、登入按鈕、登出；Toast（`useToast`）：一次一則、新的取代舊的、4 秒自動消失 |
| `src/components/*.spec.ts` | 元件測試：`WorkItemForm`（項次、送出、24 小時檢查、請假、複製、未儲存確認、預填、工作時段）、`DateNav`（工作日按鈕停用、放假徽章與工時合計）、`WorkItemTable`（排序、上移下移、逾期與請假標示、搜尋結果模式、空狀態）、`WorkItemSearch`（推薦清單、鍵盤操作、清除）、`ExportModal`（匯出範圍換算、天數上限、沒有紀錄）、`CopyDayDialog`、`DaySummaryModal`、`OptionsManagerModal`、`WorkHoursSettingModal`、`ConfirmDialog`、`HighlightText`、`OptionsDropdownState`（選項載入中、載入失敗＋重新載入，`WorkItemForm` 裡四個下拉選單都會顯示）、`AppToast`（錯誤／成功樣式、關閉、一次一則） |
| `src/pages/HomeView.spec.ts` | 主畫面流程：存檔、刪除、複製本日、項次調整失敗時的處理（登入錯誤關閉畫面並登出，其他錯誤保留畫面）、複製本日的工時檢查與覆蓋確認 |
| `tests/backend/contract.ts` | 後端共同規格：MSW 與 `Code.gs` 跑同一組案例（見下方） |
| `tests/msw/*.spec.ts` | MSW 假後端跑後端共同規格 |
| `tests/property/*.spec.ts` | 隨機輸入測試（fast-check）：日期字串、工時換算在任意輸入下都要成立的性質，以及前後端手動同步的規則（欄位驗證、請假驗證、工時設定驗證、工時合計訊息、搜尋比對）用隨機輸入比對前端與 `Code.gs`（見下方） |
| `tests/export/*.spec.ts` | 匯出 Excel 的檔案內容：真的產生 .xlsx 再用 ExcelJS 讀回來，檢查分頁、欄位、日期儲存格、樣式，顏色跟 `tokens.scss` 淺色模式比對 |
| `e2e/*.e2e.ts` | Playwright 瀏覽器測試：RWD、深色模式、文字截斷、完整操作流程、無障礙（見下方） |
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

`tests/apps-script/fake-spreadsheet.ts` 只實作 `Code.gs` 用到的 `SpreadsheetApp` API，行為盡量貼近真的 Sheet：寫入時自動轉型（純數字字串 → 數字、`TRUE` → 布林、`YYYY/MM/DD` → 日期、`HH:mm` → 時間，儲存格是純文字格式 `@` 就維持字串）、`getRange` 超出分頁列數會丟錯（新分頁預設 1000 列）、`insertRowsAfter` 補的列沿用上一列的格式、排序時空白排最後、`getDataRange` 在空白分頁回傳 A1。`load-code-gs-backend.ts` 用 `node:vm` 執行 `Code.gs`，其他服務（指令碼屬性、UUID、日期格式化、tokeninfo 登入驗證）也換成假的；idToken `'token'` 是擁有者本人，JSON 字串的 idToken 直接當成 tokeninfo 的回應。試算表裡的日期是 vm 那邊的 `Date`，測試裡判斷日期要用 `Object.prototype.toString`，不能用 `instanceof`。

`tests/apps-script/sheet.spec.ts` 測共同規格看不到的 Sheet 細節：自動建分頁與表頭、儲存格型別、文字欄位不被轉型、每次寫入後排序、超過 1000 列自動補列、手動編輯過的分頁照樣讀得到、已刪除紀錄分頁、選項清單的數字值與連續、`compactOptionsSheet`（`Migrations.gs`，`beforeEach` 用 `extraFiles` 一起載入）、工時設定、登入驗證、近期紀錄、搜尋與匯出範圍、寫入加鎖（`lockCalls`；`lockAvailable: false` 模擬拿不到鎖）。假環境的指令碼時區刻意設成跟試算表不同，`Utilities.formatDate` 收到試算表以外的時區就丟錯，確保日期一律用試算表時區讀。

`tests/apps-script/legacy-import.spec.ts` 測一次性匯入 `LegacyImport.gs`：`loadCodeGsBackend({}, { extraFiles: ['LegacyImport.gs'] })` 跟 `Code.gs` 一起載入（同一個 Apps Script 專案共用全域），兩份舊表用 `backend.newSpreadsheet()` 建、放進 `backend.books`（`openById` 用 ID 找）。測分頁名稱與期限的日期解析、Repo 拆行、狀態對應、請假判斷、略過的分頁、項次補號、選項清單排序、預覽不動資料，以及正式匯入後用 `doGet` 讀回來。

### 隨機輸入測試

`tests/property/` 用 [fast-check](https://fast-check.dev/) 產生大量隨機輸入，檢查「不管輸入什麼都要成立」的性質，補挑選案例想不到的組合。產生器在 `arbitraries.ts`，刻意混進邊界值與不合法的值（不存在的日期、非 0.25 倍數、字數上限 ±2、格式不對的時間）。失敗時會印出縮到最小的反例和 `seed`，把 seed 填進 `fc.assert(..., { seed })` 就能重現；反例確定是規則該處理的情況時，也加進對應的挑選案例（例如 `consistency.spec.ts`）。

產生器只產生前端真的會送出的值：前端日期不會有斜線、空白的搜尋關鍵字後端在比對前就回錯誤，這類情況用產生器或 `fc.pre` 排除，不算前後端不一致。

假的試算表終究不是真的 Sheet（例如科學記號、千分位、地區格式的自動轉型沒有模擬），部署後還是要照實機測試清單手動驗證一次。

## 瀏覽器測試（Playwright）

happy-dom 沒有真的排版，量不到高度與寬度，所以版面相關的行為用 Playwright 在真的 Chromium 裡測。`playwright.config.ts` 自己起 `vite`（port 5174，打 MSW 假後端，不吃本機 `.env`），每個測試跑三種寬度：`mobile`（Pixel 7）、`tablet`（820px）、`desktop`（1280px），對應 CLAUDE.md 的 RWD 斷點。

- `rwd.e2e.ts`：沒有橫向捲軸、手機卡片／平板合併欄／桌面完整欄位、逾期紅線（顏色跟 `tokens.scss` 比對）、國定假日的徽章與空狀態
- `theme.e2e.ts`：切深色後 `data-theme`、底色、文字色階對調，重新整理後維持；唯讀模式
- `clamp-text.e2e.ts`：長文字收合時手機 3 行、平板桌面 2 行，「<展開>」「<收合>」，有滑鼠的裝置才有全文 tooltip
- `flows.e2e.ts`（只在桌面跑）：新增（含必填、24 小時上限）、編輯（含未儲存確認）、刪除、請假、複製本日、上下移與拖曳排序、搜尋後跳到那天、匯出 Excel 下載、本日總結
- `a11y.e2e.ts`（只在桌面跑）：用 axe-core 掃 WCAG 2.1 A／AA，主畫面、新增表單、搜尋結果在淺色與深色模式各一次，加上唯讀模式；包含文字對比 ≥ 4.5:1

測試用的 Chromium 對中文的下載檔名一律回報成 `download`，所以匯出測試改記下連結的 `download` 屬性來比對檔名；實際瀏覽器下載的檔名要手動確認一次。

`e2e/fixtures.ts` 的設定：

- 時間固定在 2026/10/07（三）上午 10 點（`page.clock.setFixedTime`），MSW 的預設資料與「今天」才固定
- 外部資源換成假的：Google 登入腳本（不連 Google，`renderButton` 放一顆假按鈕）、台灣行事曆（10/9、10/10 放假）、Google 字型（不下載）。要用 `context.route`，MSW 的 Service Worker 放行的請求從 Worker 發出，`page.route` 攔不到
- `test.use({ loggedIn: true })`：在 sessionStorage 放一個擁有者的假 ID Token，直接進管理畫面（MSW 不驗證 token）

### Safari（WebKit）

`npm run test:e2e:safari` 用 WebKit 跑同一套測試：`iphone`（iPhone 14，只跑版面相關，同 `mobile`）、`desktop-safari`（1280px，全部都跑）。`npm run test:e2e` 不包含這兩個專案，沒裝 WebKit 的環境照樣能跑。Playwright 的 WebKit 很接近 Safari，但不是真的 iPhone，日期選擇器這類原生元件還是要在手機上實際點一次。

WebKit 的限制：Playwright 只有 Chromium 攔得到 Service Worker 發出的請求。MSW 的 Service Worker 會轉發 Google 登入腳本、台灣行事曆的請求，所以 `fixtures.ts` 的假資源在 WebKit 不會生效，會連到真的服務。依賴假資料的檢查（國定假日的名稱、假的登入按鈕）在 WebKit 跳過並註明原因，Chromium 照樣完整驗證。手機判斷一律用 `testInfo.project.use.isMobile`／`hasTouch`，不比對專案名稱。

已經有 Chromium、不想下載的環境（例如雲端容器）可以設 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定執行檔。部署（第 5 階段）時再加：GitHub Pages 的 base path、重新整理不會 404、真的 Google 登入。

## 沒有自動測試的部分

- 真的 Apps Script 後端接真的 Sheet、Google 登入：部署後手動驗證
- 部署後才有的行為（GitHub Pages 的 base path、重新整理路由、HTTPS 下的 Google 登入）：做部署時再加進 Playwright
