# 專案簡介

> 最後更新：2026-09-30

「工作進度」列管系統。取代目前手動維護的 Google Sheet 表單，改用前端頁面輸入/檢視資料，資料實際存放位置仍是 Google Sheet。

- 專案類型：**純前端專案**，沒有自建後端主機。Google Apps Script Web App 扮演「後端 API」的角色，前端（Vue 3 + TS）部署在 GitHub Pages 為靜態站
- 資料來源：[Google Sheet](https://docs.google.com/spreadsheets/d/1_1MxTiuMg9ALdr-6o77-c2qCWqYuktSFPM6lGYVg8n0/edit?gid=0#gid=0)（全新建立的工作用試算表，跟最初參考欄位命名的舊表是不同份；實際欄位結構以本文件「Google Sheet 結構設計」章節為準）
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

原始 11 個業務欄位（已改名對齊目前用語）+ 新增「工作日期」「專案Repo」+ 系統欄位。**實際 Sheet 表頭順序**如下（跟前端畫面顯示順序不同，Apps Script 讀寫一律用表頭名稱查欄位位置，不寫死欄位順序，順序調整不影響程式邏輯）：

| 欄位 | 說明 |
|---|---|
| **ID**（系統） | UUID，寫入時自動產生，編輯/刪除用來精準定位列 |
| **工作日期**（新增） | 這筆紀錄所屬的那一天，預設今天可手動改（補登用）。前台以此欄位做「單日檢視」。Sheet 儲存格與 API 傳輸格式都是 `YYYY/MM/DD`（例如 `2026/09/23`），細節見下方「日期欄位格式」 |
| 項次 | 系統自動編號，**每天從 1 開始**：同一工作日期、未刪除紀錄的最大項次＋1（用最大值不用筆數，刪掉中間某筆後新增才不會撞號；已刪除的不佔號，所以刪掉當天最後一號再新增會拿回同一號）。一律由後端決定，使用者不能自訂，前端送來的值會被忽略。規則寫在 `Code.gs` 的 `getNextDailyIndex_`，前端 `useWorkItems.ts` 的 `fetchDaySummary`（表單顯示預計項次用）跟 MSW 用同一套規則，改一處要三處一起改。原本是「當月新增順序」，已改成每天編號（使用者決定），舊資料用 `renumberDailyIndexes()` 一次性重新編號 |
| 交辦單位 | 可搜尋下拉選單（來自「選項清單」分頁，可輸入清單沒有的新值直接當作答案送出）（原欄名「單位」） |
| 交辦人員 | 可搜尋下拉選單（來自「選項清單」分頁，同上可自訂新值） |
| 專案名稱 | 可搜尋下拉選單（來自「選項清單」分頁，同上可自訂新值） |
| **專案Repo**（新增） | 選填，可搜尋的**多選**下拉選單（來自「選項清單」分頁，同上可自訂新值），可填多個 repo 名稱（例如 `AAA`、`BBBB`）。Sheet 儲存格存成逗號分隔的字串（如 `AAA,BBBB`），前端拆開後以 `#AAA` `#BBBB` 標籤呈現；沒有值就不顯示 |
| 工作目標 | 文字，必填（原欄名「工作內容」） |
| 處理內容 | 文字，選填，語意＝工作日期當天的處理情形（原欄名「今日處理情形」） |
| 今日工時 | 數字，選填（預設 0），0–24、以 0.25 小時為單位（語意＝工作日期當天的工時）。同一工作日期所有未刪除紀錄（工作＋請假）的合計不可超過 24 小時，前後端都擋（`shared/validation-schema.json` 的 `dailyHours.max`、`Code.gs` 的 `getDayHoursExcluding_`／`DAILY_HOURS_MAX`） |
| 預計期限 | 日期，選填（原欄名「預計完成期限」）。格式同「工作日期」，見下方「日期欄位格式」。沒填不算逾期 |
| 完成度 | 數字，選填（預設 0），0–100 的整數（原欄名「完成%」，改名後鍵名不含特殊字元，程式裡可直接用 `item.完成度` 不用中括號） |
| 狀態 | 簡單下拉選單（不用搜尋），必填，預設 `待辦`，固定選項：`進行中`／`前端完成`／`返修`／`待辦`／`確認上線`／`暫緩`（原欄名「完成回報」）。舊資料可能是空的，編輯時表單預設帶 `待辦` |
| **已刪除**（系統） | TRUE/FALSE，軟刪除標記，不做真刪除 |

**欄位驗證規則**（必填、字數、數值範圍等）完整定義在 `shared/validation-schema.json`，見下方「共用驗證 schema 同步方式」與「UI/UX 定案」的表單驗證段落。

**表格顯示的合併欄位**（僅畫面呈現合併，資料仍是各自獨立欄位，表頭文字也標明合併了哪些欄位）：
- **交辦單位 + 交辦人員**：共用一欄，表頭寫「交辦單位/人員」。手機卡片版面較寬，呈現單行「某某某（OO部門）」；桌面表格的這欄是固定窄欄（110px），單行塞不下，改呈現兩行堆疊「OO部門」換行「某某某」
- **專案名稱 + 專案Repo**：共用一欄，表頭寫「專案名稱/Repo」。專案名稱在上，有填 Repo 才在下方多一行 `#AAA` `#BBBB` 標籤，沒填就不多顯示

**請假紀錄**（使用者決定）：跟工作紀錄寫在**同一個月份分頁**，計入當天「今日工時合計」，用「狀態」＝`休假` 區分。規則在 `shared/validation-schema.json` 的 `leave`（`Code.gs` 的 `LEAVE_RULES` 手動同步）：
- 固定值（`leave.fixed`，後端一律覆蓋，前端送什麼都不算數）：交辦單位 `人事室`、交辦人員 `--`、專案名稱 `休假`、專案Repo 空白、預計期限 空白、完成度 `100`
- 使用者填的欄位：工作日期、假別（存在「工作目標」，選項 `leave.types`：特休／事假／病假／其他）、請假時數（存在「今日工時」，必填，0.25–8、預設 8）、備註（存在「處理內容」，選填）
- 項次照每日編號規則，跟工作紀錄一起編
- **跟一般工作紀錄分開**：`休假` 不在 `STATUS_OPTIONS` 裡（`types/work-item.ts` 另外定義 `LEAVE_STATUS`），工作紀錄表單選不到、後端 `validateItem_` 也會擋；固定值不寫回「選項清單」（`Code.gs` 的 `syncOptionsFromItem_`、MSW 的 `syncOptions` 都會略過請假列），不會出現在工作紀錄的下拉選單
- 前端：`DateNav` 右側「咖啡杯圖示＋請假」按鈕（圖示是行內 SVG 的 Lucide `coffee`，ISC 授權；白底＋`teal-700` 文字與框線，次要入口，色系跟表格請假列一致，14px 文字在白底要 4.5:1 對比所以不用 teal-500／600；表單「工作項目 ｜ 請假」切換選到請假時也是 `teal-700`；「＋ 新增」基底也留同色 1px 框線，兩顆按鈕才一樣高）開 `WorkItemForm` 的請假模式（`leave` prop；編輯時看紀錄本身的狀態），只顯示工作日期／假別／請假時數／備註。**新增時**表單上方有「工作項目 ｜ 請假」兩段式切換（`WorkItemForm` 的 `creatingLeave`，初始值看從哪個按鈕開啟；編輯既有紀錄、單項複製都不能切換，也不顯示切換按鈕）：切換後保留工作日期、其他欄位重設成該模式的預設值（請假固定值送出時才補，切回工作項目時狀態回到待辦、工時預設回到 0，所以不會殘留），除了日期以外有填內容才跳 `ConfirmDialog` 確認（使用者決定）；表格的請假列（`work-item-table__row--leave`）整列文字 `teal-800`、進度條 `teal-100` 底／`teal-500` 條、狀態膠囊 `--leave` 也是 teal；請假列左側跟逾期一樣有標線（`box-shadow` inset），色系用 `teal-600`（請假沒有預計期限，不會跟逾期同時出現）；手機卡片上原本的次要灰字（交辦單位、處理內容、工時、預計期限）在請假列改成 `teal-700`；請假列的交辦欄只顯示交辦單位、不顯示交辦人員（使用者決定）

**附件欄位**：已從系統範圍移除（圖片需經 Google Drive 中轉才能顯示，複雜度高，暫不做上傳功能）。Sheet 上保留原欄位，有需要時使用者自行手動貼連結。

**選項清單分頁**（新增，命名「選項清單」）：存放「交辦單位」「交辦人員」「專案名稱」「專案Repo」的可選值，供前端可搜尋下拉選單讀取；使用者輸入清單沒有的新值時，`doPost` 的 `create` 動作會同步把新值寫回此分頁。

**資料模式**：情境 A（日誌式）——同一專案每天新增一列新紀錄，不覆寫舊資料，歷史紀錄自然依時間往下疊。

**日期欄位格式**：「工作日期」「預計期限」在 Google Sheet 儲存格顯示、以及 Apps Script API（`doGet`/`doPost`）傳輸的字串格式都是 `YYYY/MM/DD`（例如 `2026/09/23`），Sheet 端這兩欄也套用對應的 `yyyy/mm/dd` 儲存格數值格式（`Code.gs` 的 `applyDateColumnFormat_`，新建月份分頁時自動套用；改動當下已存在的分頁需手動在 Apps Script 編輯器執行一次 `fixExistingMonthSheetDateFormats()` 補上，用法同 `installTrigger()`，一次性）。

前端**內部狀態**（`WorkItemForm.vue` 的表單欄位、`DateNav.vue`、`HomeView.vue` 的 `selectedDate`、`isOverdue` 比較、`useTaiwanHolidays.ts`）維持 ISO 的 `YYYY-MM-DD`，不是為了跟後端不一致，而是瀏覽器原生 `<input type="date">` 規格規定只能吃這個格式，沒有替代選項；JS `Date`／`toISOString()` 的日期運算也天生是 ISO。兩種格式的轉換**只集中在 `useWorkItems.ts` 一個邊界**（`toApiDate`/`fromApiDate`/`toApiItem`）：送出 `fetchByDate` 的 `date` 查詢參數、`createItem`/`updateItem` 的 `item.工作日期`/`item.預計期限`、`updateItem`/`deleteItem` 的 `originalDate` 之前轉成 `YYYY/MM/DD`；`fetchByDate` 收到的回應則把每筆 `工作日期`/`預計期限` 轉回 ISO 才存進 `items.value`。除了這個邊界，程式碼其他地方完全不用知道 API 實際傳輸格式是什麼。MSW mock（`src/mocks/handlers.ts`）的假資料日期也同步用 `YYYY/MM/DD` 產生，貼近真後端行為。

# Apps Script Web App 設計

**doGet(e)**
- 接受 `date` 參數（`YYYY/MM/DD`，例如 `2026/09/17`，見上方「日期欄位格式」），後端自動換算對應月份分頁，只回傳當天且「已刪除≠TRUE」的列
- 額外支援 `type=options` 讀取「選項清單」分頁
- 開放給所有人呼叫（不需登入），供公開檢視頁使用；11 個業務欄位公開檢視頁全部顯示，沒有欄位白名單問題（機敏疑慮是「帳密/token 不能出現在 repo」層級，不是欄位層級——這點已用 Google 登入驗證解決）

**前端登入實作**：`useGoogleAuth.ts` 已改成真的串接 Google Identity Services（不是 stub）——動態載入 GIS 腳本、`google.accounts.id.renderButton` 顯示官方登入按鈕、登入後拿到的 ID Token 存 `sessionStorage`。前端額外維護一份**允許清單陣列**（目前只有 `swzx00@gmail.com`，之後要加人直接改陣列），`isAuthorized` = 有登入 && email 在清單裡；未登入或不在清單裡都只能看唯讀畫面（跟公開檢視頁同一套邏輯），管理功能（新增/編輯/刪除）整個不會渲染出來。這是前端體驗層的把關，**不能取代後端驗證**——後端還是要照下面 `doPost` 的規則再驗一次，因為前端程式碼是公開的，理論上可以被繞過。

**doPost(e)**
- body 帶入 Google ID Token，後端呼叫 `https://oauth2.googleapis.com/tokeninfo` 驗證有效性，取出 email 並比對是否為 swzx00@gmail.com，不符合直接拒絕
- 依 `action` 分派：
  - `create`：判斷/建立當月分頁，產生 UUID 當 ID，項次用 `getNextDailyIndex_` 依工作日期計算（**每天**從 1 開始，見上方「項次」欄位說明），寫入新列；若帶了新的交辦單位/交辦人員/專案名稱/專案Repo，同步寫回「選項清單」分頁
  - `update`：payload 額外帶 `originalDate`（這筆紀錄修改前的工作日期），換算出**原本**月份分頁去定位 `ID`。若 `item.工作日期` 跟 `originalDate` 換算出的月份不同（使用者把工作日期改到別的月份），先從原分頁刪除該列、在新月份分頁新增一列，維持每筆紀錄只存在一個分頁。項次：工作日期沒改就沿用原本的項次（忽略前端送來的值）；工作日期改到別天（不論同月或跨月），在新的那天用 `getNextDailyIndex_` 重新編號
  - `delete`：payload 帶 `originalDate`，換算月份分頁定位 `ID`，將「已刪除」設為 TRUE
  - `batchCreate`：payload 帶 `items` 陣列，一次新增多筆（前端「複製本日」用，`handleBatchCreate_`）。全部先驗證，任何一筆不合格（錯誤訊息標出第幾筆）、或任何一天的工時合計（既有紀錄＋這批）超過 24 小時，就**整批退回、不寫入任何一筆**；通過後項次依陣列順序照每日編號規則接續，同一月份分頁的列一次 `setValues` 寫入，新值同步寫回「選項清單」（請假列一樣略過）。回應 `{ items: [...] }`
  - `addOption`／`renameOption`／`deleteOption`：直接管理「選項清單」分頁本身（不透過新增/編輯工作紀錄的副作用），給前端「管理選項清單」Modal 用，細節見下方「選項清單管理」
- 後端必須重複驗證前端已做過的規則（`Code.gs` 的 `validateItem_`，規則同 `shared/validation-schema.json`：必填、字數上限、今日工時 0–24／0.25、完成度 0–100 整數、狀態在固定選項內、日期格式與年份、Repo 不可含逗號等），因為 API 網址公開，理論上可被繞過前端直接呼叫

**重要限制：Apps Script 網頁應用程式的回應沒辦法自訂 HTTP status code，一律是 200**（平台限制）。所以 `doGet`／`doPost` 的成功/失敗**一律靠回應內容裡有沒有 `error` 欄位判斷**，前端（`useWorkItems.ts`）已經配合改成檢查 `data.error`，不能用 `res.ok`／HTTP 狀態碼判斷；MSW mock 也同步改成一律回 200、錯誤放在 `error` 欄位裡，貼近真實行為。之後如果重寫前端呼叫邏輯，要記得延續這個慣例。

**錯誤代碼 `code`**：需要讓前端分辨錯誤類型的情況，`doPost` 回應除了 `error`（給人看的訊息）再多帶一個 `code` 欄位。目前只有登入驗證失敗會帶 `code: 'UNAUTHORIZED'`（含 token 過期），其他錯誤沒有 `code`。前端 `useWorkItems.ts` 的 `postAction` 會丟出帶 `code` 的 `ApiError`，呼叫端用 `e instanceof ApiError && e.code === 'UNAUTHORIZED'` 判斷，**不要比對 `error` 文字**（文字可能改、MSW 跟真後端也曾經不一致）。新增錯誤代碼時，`Code.gs`、`src/mocks/handlers.ts`、`useWorkItems.ts` 的 `ApiErrorCode` 型別要一起改。

**選項清單管理**：`OptionsManagerModal.vue`（獨立 Modal，非 Drawer——這是特意的選擇，因為這是「設定」性質的操作，跟日常填寫工作紀錄的 Drawer 表單在使用情境上不同，用不同呈現方式做區隔；ARIA 標記仍用 `role="dialog"` + `aria-modal="true"`，這是 Modal 在 ARIA 規範裡正確的技術寫法，ARIA 沒有 `role="modal"` 這個角色，跟元件命名是兩回事），`HomeView.vue` 已登入區塊的「選項清單」按鈕觸發，`isAuthorized` 才看得到入口。手機（< 768px）滿版全螢幕，跟 `WorkItemForm` 的 Drawer 手機行為一致；桌面置中卡片。開關動畫：手機從畫面下方滑入/滑出，桌面淡入＋輕微縮放（`Transition name="options-manager"`，套用在 `HomeView.vue` 的 `<OptionsManagerModal>` 外層）；元件內部第一層（選母項）↔ 第二層（調整內容）切換也有動畫，不是瞬間跳畫面（`Transition name="options-manager-layer" mode="out-in"`，寫在元件自己的樣板內，淡入淡出＋輕微左右位移，模擬「鑽進去/退出來」的導覽感）
- 第二層的值清單改成仿表格樣式：整份清單一個外框＋表頭列（「值」/「操作」）、列跟列之間用底線分隔，不是每個值各自一張獨立卡片（跟第一層選母項的卡片式大按鈕刻意做區隔，第一層是導覽入口用卡片按鈕合理，第二層是資料列表用表格排版比較符合資料呈現的慣例）
- **兩層式導覽，同一個 Modal 元件內切換兩種畫面**（不是兩支獨立元件）：第一層列出交辦單位／交辦人員／專案名稱／專案Repo 四個母項讓使用者先選一個（`selectedCategory` 為 `null`），選了之後同一個 Modal 換成第二層畫面只顯示該母項的內容（新增/重新命名/刪除），上方有「‹ 返回」回到第一層。這樣設計是因為一次把四個分類全部攤開會需要滾動很多次（曾經試過 2×2 網格＋每欄自己的內部捲軸，還是不夠好），改成一次只處理一個母項，畫面內容量固定、不會隨選項變多而需要一直滾動
- 支援新增／重新命名／刪除，重新命名/刪除都會先跳 `ConfirmDialog`（重新命名走行內編輯，刪除才跳確認對話框）
- **重要限制，UI 上有明顯提示**：重新命名/刪除只改「選項清單」分頁本身，**不會**回頭更新各月份分頁裡已經寫入的歷史紀錄——交辦單位/人員/專案名稱/專案Repo 存在每筆工作紀錄上是純文字，不是跟這份清單做關聯查詢（ID 對應）的欄位，這是既有的資料模型設計（見上方「Google Sheet 結構設計」），管理選項清單不會改變這件事
- Apps Script 端：`handleAddOption_`／`handleRenameOption_`／`handleDeleteOption_`，重新命名/刪除都是直接對「選項清單」分頁該分類欄位的儲存格操作（`clearContent()` 清空儲存格，不整列刪除／不搬移其他列，因為同一列不同分類欄位彼此獨立、允許中間留空，`getOptions_` 讀取時本來就會略過空白儲存格）
- 前端 `useOptions.ts` 新增 `addOption`／`renameOption`／`deleteOption`，三個 action 的回應都帶回最新完整 `options`，直接覆寫本地快取，不用再多打一次 `fetchOptions()`

**月份分頁建立機制**：雙保險，兩個都要做，不互斥
- **主要：每月 1 號定時觸發器**——`ScriptApp` 的 installable time-driven trigger，`onMonthDay(1)`，跑 `ensureMonthlySheet()` 主動建立當月分頁＋複製表頭格式。程式碼裡寫了 trigger 設定不會自動生效，需要**手動執行一次安裝函式**（或在 Apps Script 編輯器的「觸發條件」頁面手動加），這是一次性設定，之後照排程自動跑
- **備援：`doPost` 的 `create` 動作懶惰建立**——寫入當下若當月分頁不存在就順手建立，當觸發器萬一沒跑成功時的保險，確保只要有人真的寫入資料，分頁一定會被建出來

**可公開的識別碼**：Apps Script Web App 網址、Google OAuth Client ID 都可以放心寫在前端程式碼裡公開，這是 Google 官方設計上允許的，真正把關的是後端的登入驗證，不是網址保密。Google Sheet ID 建議存在 Apps Script 的 `PropertiesService`（指令碼屬性），不寫死在程式碼裡。

# 前端架構（Vue 3 + TypeScript，部署於 GitHub Pages）

```
src/
  pages/
    HomeView.vue           # 單一路由（/），依登入狀態切換管理／檢視畫面：isAuthorized 顯示新增/編輯/刪除，否則顯示唯讀畫面
  components/
    WorkItemTable.vue     # 表格排版（管理／檢視畫面共用，:editable 控制是否顯示操作欄，:viewing-today 控制表頭/卡片的今天樣式）
    WorkItemForm.vue      # 新增/編輯表單（Drawer 呈現），項次欄唯讀顯示目前／預計項次，見「UI/UX 定案」
    OptionsManagerModal.vue # 管理選項清單（新增/重新命名/刪除），獨立 Modal，只有 isAuthorized 看得到入口
    ConfirmDialog.vue     # 通用確認對話框（刪除工作紀錄、刪除選項清單的值、表單放棄變更都用這個），按鈕配置照 Apple HIG，見「UI/UX 定案」
    AppLoading.vue        # 共用載入中（轉圈＋文字，prop label 預設「載入中…」），只負責內容本身，外層排版由使用端決定；HomeView 讀取資料、WorkItemForm 送出遮罩都用它
    CopyDayDialog.vue     # 「複製本日」選目標日期的對話框（預設下一個工作日），只負責畫面，工時檢查與寫入在 HomeView
    AppToast.vue          # Toast（錯誤為主，另有 success 樣式），畫面上方置中，搭配 useToast.ts，見下方「UI/UX 定案」的儲存失敗處理
    DateNav.vue           # ⏮ 上一個工作日 / ◀ 上一天 / 日期選擇器 / 下一天 ▶ / 下一個工作日 ⏭ / 回到今天（今天時改顯示「今天」狀態標示），顯示星期，放假日顯示徽章，日期選擇器今天時用 :deep() 改邊框/文字色，按鈕沒用途時 disabled
    ProjectAutocomplete.vue
  composables/
    useGoogleAuth.ts      # 登入狀態、ID Token 管理
    useWorkItems.ts        # 讀寫 API 呼叫、狀態管理
    useTaiwanHolidays.ts   # 台灣國定假日查詢，見下方「台灣國定假日顯示」
    useToast.ts            # Toast 共用狀態（模組層級），showToast(message, type = 'error')／hideToast()
  utils/
    copy-work-item.ts      # buildCopyPayload：複製規則（單項複製、複製本日共用）
  validation/
    work-item.ts           # 表單欄位驗證（validateWorkItem），規則來自 shared/validation-schema.json
  styles/
    tokens.scss            # 色彩變數（統一色階 --color-<色系>-<階>，例如 --color-blue-500 / --color-black-100，色值取自公司設計系統），預留深色模式擴充，元件一律吃變數不寫死 hex
shared/
  validation-schema.json   # 前後端共用的驗證規則來源（唯一事實來源）
apps-script/                # clasp 專案（Apps Script 原始碼版控）
  Code.gs
  build/schema.gs           # （規劃中，尚未實作）由 shared/validation-schema.json 產生
```

**共用驗證 schema 同步方式**：`shared/validation-schema.json` 是唯一事實來源，前端 `src/validation/work-item.ts` 直接 import。**目前 `Code.gs` 的 `VALIDATION_RULES` 是手動同步的**——原本規劃的 build script（`npm run build:gs`，把 JSON 轉成 Apps Script 可讀的 `schema.gs`）還沒實作，`apps-script/` 也還沒設定 clasp（目前是手動把 `Code.gs` 貼到 Apps Script 編輯器部署）。改 JSON 時 `Code.gs` 要一起改。

- 狀態的可選值不在 JSON 裡，放在 `src/types/work-item.ts` 的 `STATUS_OPTIONS`（TypeScript 需要 `as const` 字面值型別才能推導 `Status` 型別），`Code.gs` 的 `STATUS_OPTIONS` 也是手動同步
- 日期的年份範圍用 `minYear`／`maxYear` 表示，不寫完整日期字串，前端（`YYYY-MM-DD`）與 API（`YYYY/MM/DD`）格式不同也能共用同一份規則

**開發工具鏈**：
- **ESLint**（flat config，`eslint.config.js`）：`eslint-plugin-vue` + `@vue/eslint-config-typescript`，`npm run lint` 檢查程式碼品質（未使用變數、type 錯誤等）
- **Prettier**（`.prettierrc.json`）：有分號、單引號、printWidth 100，`npm run format` 格式化；透過 `@vue/eslint-config-prettier` 關掉與 ESLint 衝突的樣式規則，兩者分工不重疊
- **Stylelint**（`stylelint.config.js`）：檢查 `.css`／`.scss`／`.vue` 的 `<style>`，`npm run lint:style` 檢查並自動修復。設定組合：
  - `stylelint-config-standard-scss`：SCSS 通用規則（顏色函式寫法、空行、重複屬性等）
  - `stylelint-config-recommended-vue/scss`（搭配 `postcss-html`）：讓 Stylelint 讀得懂 `.vue` 裡的 `<style>`
  - `stylelint-config-recess-order`：**屬性排序**，依「定位 → 盒模型 → 文字 → 外觀」分組排列，可自動修正
  - 自訂覆寫：`selector-class-pattern` 改成允許 **BEM**（`block__element--modifier`，各段 kebab-case），這是專案既有的 class 命名慣例；`media-feature-range-notation: 'prefix'` 維持 `@media (min-width: 768px)` 寫法（預設會改成 `(width >= 768px)`），跟下方「RWD 斷點」的慣例一致
  - Stylelint 16 起已移除所有排版類規則，排版全交給 Prettier，兩者不會互相打架
- **VS Code 存檔自動整理**（`.vscode/settings.json`，有進版控；`.vscode/extensions.json` 推薦安裝 Prettier、Stylelint 擴充套件）：存檔時先跑 Stylelint 自動修復（含屬性重排，`source.fixAll.stylelint`），再用 Prettier 排版（`editor.formatOnSave`）。關掉 VS Code 內建的 CSS/SCSS 檢查，避免跟 Stylelint 重複報錯；Markdown 不在存檔時自動排版（避免 CLAUDE.md 這類文件被大量重排）
- **`.editorconfig`**：管編輯器層級的基本排版（縮排、換行符、結尾換行等）
- **路徑別名**：`@/` 對應 `src/`（`vite.config.ts` 的 `resolve.alias` + `tsconfig.app.json` 的 `paths` 都要同步設定），避免元件一多之後出現 `../../../components/xxx` 這種難維護的相對路徑
- **Node 版本**：鎖定 `>=24.1.0`（`.nvmrc`、`package.json` 的 `engines`），並用 `.npmrc` 的 `engine-strict=true` 讓版本不符時直接擋下 `npm install`，避免換機器開發版本不一致
- **套件管理工具**：僅使用 npm（`package.json` 的 `packageManager` 欄位已鎖定），不要混用 yarn/pnpm，避免 lockfile 衝突
- **樣式語言**：採用 **SCSS**，元件的 `<style>` 一律加 `lang="scss"`（`<style scoped lang="scss">`），需要安裝 `sass` 作為 devDependency
- **UI 元件庫**：以自訂元件為主，僅在「可搜尋下拉選單／多選標籤／日期選擇」這類自己刻成本高的互動元件才用 **Naive UI**（目前用到 `NSelect`、`NDatePicker`）。主題色透過 `App.vue` 的 `<n-config-provider :theme-overrides>` 對齊 `tokens.scss` 的色階（見下方「色彩 token：統一用色階，不分用途」）；同一個 `n-config-provider` 也帶入 `zhTW`/`dateZhTW` 兩個 locale（`:locale`/`:date-locale`），讓 Naive UI 元件顯示繁體中文。`NDatePicker` 的 `:first-day-of-week="6"` 讓月曆以星期日為一週第一天——這個 prop 的數值語意不直觀，**不是** date-fns 的 `getDay()`（星期日＝0）對應值：實測 naive-ui 內部排陣列的演算法後，`firstDayOfWeek=6` 才會排出「日一二三四五六」，`zhTW` locale 預設的 `firstDayOfWeek: 0` 反而是「一二三四五六日」（星期一開頭），所以這裡要明確覆寫、不能依賴 locale 預設值。其餘元件維持手刻 + CSS token，不整套套用 Naive UI 的視覺風格
- **`DateNav` 的日期選擇器**：曾經改用 `NPopover` 包 `NCalendar`，換取「月曆彈窗裡每一格都能標假日顏色」（`NDatePicker` 沒有 cell slot、格子沒暴露完整日期資料，做不到這件事），但 `NCalendar` 是整月網格＋沒有年份快速跳選，手機寬度下的 popover 版面調校成本明顯偏高，實際體驗評估後改回 `NDatePicker`，放棄「月曆格子內逐格標色」，改成 `format="yyyy/MM/dd (EEEEE)"`（date-fns 格式字串，`EEEEE` 是最短星期字樣，例如「五」）搭配旁邊一個獨立的假日名稱徽章（顏色見下方「UI/UX 定案」的「放假色」）
  - **`.date-nav__picker--today` 直接用 `:deep()` 改內部邊框/文字顏色**：原本刻意只用 `outline` 避免碰 Naive UI 內部 class，但後來確認「今天」狀態需要連文字顏色都變色，而 `NInput` 實際顯示文字/畫邊框的都是內部元素（不是我們拿到 class 的外層根節點），Naive UI 直接在那些內部元素自己身上設顏色（不是繼承外層），外層 class 單寫 `color`/`border-color` 沒有用，只能穿透進去改。既然文字非改內部不可，邊框也一併改成 `:deep()` 直接改 `border-color`，不再用 outline 這個「不用碰內部但視覺上是外圈另一條線」的折衷做法，兩者統一：
    - 邊框：`:deep(.n-input__border)`（`NInput` 用兩個疊在一起的空 div 畫邊框，`.n-input__border` 是預設常駐的那個，`.n-input__state-border` 是 hover/focus 才淡入的狀態邊框，要蓋掉平常看到的顏色要改前者，不是後者）
    - 文字：`:deep(.n-input__input-el)`（實際的 `<input>` 元素）
    - 這是目前唯一一處對 `NDatePicker`／`NInput` 用 `:deep()` 的地方，套件升級如果改了這幾個內部 class 名稱，這段「今天」標色會失效，但不影響日期選擇功能本身

## 命名慣例

- 元件檔名：PascalCase（例如 `WorkItemTable.vue`）
- 資料夾／非元件檔名：kebab-case
- Composables：`use` 前綴（例如 `useGoogleAuth.ts`）

# UI/UX 定案

- 排版方向：A 版（商務簡潔風）——白底、細邊框表格，藍色系點綴，逾期用左側紅色標線＋小紅標籤提示
- 色彩管理：一律用 CSS 變數（design token），不寫死 hex，符合開閉原則；初期只做白色系，右上角先放一個不可點擊的深色模式圖示（滑鼠移上顯示「即將推出」）當伏筆
- **色彩 token：統一用色階，不分用途**：`src/styles/tokens.scss` 只有一種 token，命名一律是 `--color-<色系>-<階>`（例如 `--color-blue-000`、`--color-black-100`、`--color-red-050`）。元件裡的文字、背景、邊框都直接挑色階使用，**不另外定義 text／surface／border 這類依用途命名的 token**（使用者決定：同一套色階好記、好挑，不想維護兩層命名）
  - **色值來源**：公司共用設計系統的 primitive 色階，完整檔案在 `D:\cheng\Documents\Project\recruitNew\recruitwebvue\assets\scss\_color.scss`（另一個專案的檔案，不在本 repo 內）。色系名稱對應：`Candidate-Blue` → `blue`、`1111-Black` → `black`（中性灰階）、`1111-Rose` → `red`（危險／錯誤）、`1111-Teal`／`1111-Green`／`1111-Yellow`／`1111-Orange` → `teal`／`green`／`yellow`／`orange`。不自己配色，需要新顏色時先從這份檔案的色階挑
  - 設計系統另有一組品牌紅 `Candidate-Red`（`#cf2323` 系列），跟上面對應成 `red` 的 `1111-Rose` 是不同色階；專案目前沒用到，之後真的需要時不能也叫 `red`，要另外取名（例如 `--color-brand-red-*`）
  - `tokens.scss` 放的是用到的色系的**完整色階**（`000`／`050`／`100`～`1000`），換深淺直接改階數，不用回來加 token；用到新色系（例如 Orange、Purple）時，整組色階從設計系統檔複製進來
  - 常用對照：主文字 `--color-black-800`、次要文字 `--color-black-500`、白底 `--color-black-000`、淺灰底 `--color-black-050`、細邊框 `--color-black-100`、主色 `--color-blue-500`、深藍文字 `--color-blue-700`、危險色 `--color-red-600`
  - 選色考量（沿用早期參考 Figma Design Token 時的判斷）：
    - 細邊框用 `black-100` `#e9ecef`，不用 `black-200` `#ced4da`：後者是設計系統裡「大部分元件邊框的預設狀態」，套進來會比目前的細邊框風格明顯深/顯眼
    - 放在淺底上的藍色小字用 `blue-700` `#0f47b8`（對比 8.03:1），不用 `blue-400` `#4d88ff`（對比只有 3.34:1，不符合 WCAG AA 4.5:1）
  - **放假色：預設 orange，今天剛好放假時改 yellow**（使用者決定）。選到的日期是非工作日時，`DateNav` 的放假徽章與 `WorkItemTable`（資料列、表頭、邊框、空狀態）都換成放假色：
    - 預設（非今天）：徽章 `--color-orange-800`；表格表頭 `orange-100`、資料列斑馬紋 `orange-050`／`orange-000`、邊框 `orange-200`、文字 `orange-1000`
    - 今天剛好放假：同樣的階數換成 yellow（徽章 `--color-yellow-800`，表格 `yellow-100`／`050`／`000`／`200`／`1000`）
    - 判斷條件：`DateNav` 用 `isToday` 切 `date-nav__holiday-badge--today` 修飾符；`WorkItemTable` 用 `--holiday` + `--viewing-today` 兩個修飾符的組合。**兩處邏輯要一致**，改其中一處時另一處要跟著改
    - 演變紀錄：最早是自訂的 `#b45309`，後來統一成 `--color-yellow-800`（跟「暫緩」同色），現在再拆成 orange／yellow 兩種
  - Naive UI（`App.vue` 的 `themeOverrides`）會在 JS 裡運算顏色，吃不了 CSS 變數，只能寫 hex，每個值旁邊用註解標出對應色階：主色 `blue-500`、hover `blue-600`、pressed `blue-700`；錯誤色 `red-600`、hover `red-700`、pressed `red-800`；邊框 `black-100`。改 `tokens.scss` 的色值時這裡要手動同步
  - 設計系統原檔有個小瑕疵：`--1111-Black-100` 被定義兩次（Icon-Neutral 區塊裡寫成 `#fff`，後面 1111/Black 色階又寫成 `#e9ecef`，後者生效），本專案的 `--color-black-100` 用 `#e9ecef`
- **字體**：中文預設 **Noto Sans TC**，英文／數字預設 **Roboto**，都從 Google Fonts 載入
  - 載入方式：`index.html` 的 `<link rel="stylesheet">`（字重 400／500／600／700，`display=swap`），搭配 `preconnect` 到 `fonts.googleapis.com`／`fonts.gstatic.com` 提早建立連線。不用 SCSS 的 `@import url(...)`，因為那樣要等 CSS 下載完才開始抓字體，會比較慢
  - `font-family: Roboto, 'Noto Sans TC', 'PingFang TC', 'Heiti TC', 'Microsoft JhengHei', Arial, sans-serif`（`src/style.scss` 的 `body`）。瀏覽器是**逐字**往後找第一個有該字形的字體：
    - Roboto 排第一但沒有中文字形，遇到中文會自動往下用 Noto Sans TC，一條規則就做到「中文 Noto Sans TC、英數 Roboto」，不用額外設 `unicode-range`
    - Google Fonts 載入失敗時的備援：蘋果系統用 PingFang TC（較舊的 macOS 用 Heiti TC），Windows 用 Microsoft JhengHei；這幾個系統字體本身也有英數字形，所以這時英數也會跟著用它們
    - Arial、`sans-serif` 是最後備援，上面的字體都沒有時（例如部分 Linux）才會用到
    - 單一單字的字體名稱（`Roboto`、`Arial`）不加引號，這是 Stylelint `font-family-name-quotes` 的規則，加了存檔時也會被自動拿掉；有空格的名稱才加引號
  - `button`／`input`／`textarea`／`select` 另外設 `font-family: inherit`，瀏覽器預設不讓表單元件繼承字體，不設的話這些元件仍是系統字
  - Naive UI 元件（`NSelect`、`NDatePicker`）用自己的字體設定，不吃 `body` 的 `font-family`，所以 `App.vue` 的 `themeOverrides.common.fontFamily` 也設同一組字體；**改字體時兩處要一起改**
  - **預設字級／字重／行高**（`src/style.scss` 的 `body`）：`font-size: 16px`、`font-weight: 400`、`line-height: 1.5`，參考 Apple 的設計：
    - 字重：Apple HIG 的 Body 是 Regular，對應 400
    - 行高：iOS HIG Body 是 17pt／22pt（約 1.29），但那是配 SF Pro 這類拉丁字體訂的；中文是方塊字、字面幾乎填滿 em box，Noto Sans TC 上下緣也較高，照 1.29 會太擠。改參考 apple.com 網頁內文的 1.47，進位成 1.5（也落在中文排版慣用的 1.5–1.75 區間）。寫成無單位數字，讓子元素依自己的字級等比例計算
    - 字級：不照 Apple 的 17px，用瀏覽器預設 16px——是 `rem` 的基準，也避免 iOS Safari 聚焦字級 < 16px 的輸入框時自動放大畫面；元件內各自指定的字級（12–15px 為主）不受影響
    - `App.vue` 的 `themeOverrides.common.lineHeight` 也設 `'1.5'`（Naive UI 預設是 `1.6`），**改行高時兩處要一起改**；`fontSize` 刻意不同步，下拉選單／日期選擇器這類控制項維持 Naive UI 預設的 14px
  - Noto Sans TC 字檔很大，但 Google Fonts 會依 `unicode-range` 切成許多小檔，瀏覽器只下載頁面實際用到的字，實際載入量不大。代價是執行期間要連到 Google 的伺服器；如果之後不想依賴外部服務，可以改用 `@fontsource` 把字體打包進專案
- 管理頁／檢視頁合併成單一元件（`HomeView.vue`）、單一路由（`/`），不再區分 `/manage`：`isAuthorized` 為 true 顯示新增/編輯/刪除操作與登入資訊，否則顯示唯讀畫面（含「唯讀模式」標籤），未登入時仍保留登入按鈕入口
- 前台改成**以日期為單位**呈現（非月份）：「⏮ 上一個工作日 / ◀ 上一天 / 日期選擇器 / 下一天 ▶ / 下一個工作日 ⏭」＋「回到今天」做單日切換，跨月切換對使用者無感，由 Apps Script 依日期自動換算月份分頁；「上一個工作日／下一個工作日」會跳過連續的假日／週末（含補班日例外），細節見下方「台灣國定假日顯示」
- 按鈕沒有實際用途時要 disabled，不能點了沒反應卻看起來可以點：「上一個工作日／下一個工作日」若緊鄰那一天本來就是工作日（按下去效果等同「上一天／下一天」，沒有額外用途）就停用
- **「回到今天」與「今天」放在同一個位置、互相切換**：不是今天時顯示「回到今天」`<button>`（可點擊，`--color-black-100` 一般樣式）；已經是今天時改顯示「今天」`<span>`（主色 `--color-blue-500` 膠囊樣式），純粹當狀態標示。用 `<span>` 而不是 disabled 按鈕，是因為這時它沒有任何可操作的意義，不需要保留按鈕的語意
- **今天／非今天要有視覺區別**：
  1. `DateNav` 的日期選擇器：選到今天時整個輸入框（文字＋邊框）換成深藍 `--color-blue-700`，實作細節（為什麼要用 `:deep()`、改哪幾個內部 class）見上方「`DateNav` 的日期選擇器」段落
  2. **「回到今天」按鈕／「今天」標示**：不是今天時顯示「回到今天」按鈕可點擊；是今天時換成「今天」`<span>` 狀態標示，透明底＋主色 `--color-blue-500` 邊框/文字的膠囊樣式
  3. `WorkItemTable`（桌面表格與手機卡片**共用同一套 CSS**，改一次兩邊都套用，不用分別寫）：表頭跟資料列（不含表頭）各自固定一個底色，今天／非今天各自一組：
     - 非今天：表頭 `--color-black-100`，資料列單雙數交錯用 `--color-black-050`／`--color-black-000`
     - 今天：表頭 `--color-blue-100`，資料列單雙數交錯用 `--color-blue-050`／`--color-blue-000`
     - 表頭在 DOM 順序上是 `.work-item-table` 底下第一個 child，資料列因此整體被往後推一格，所以「第 1 筆資料」對應的 CSS 其實是 `:nth-child(even)`，不是看起來更直覺的 `:nth-child(odd)`，程式碼裡有寫註解記錄這件事
     - 手機表頭雖然 `display:none` 看不到，但還是在 DOM 裡，`nth-child` 計數不受影響，桌面/手機算出來的單雙數一致，不用另外寫一份手機專用規則
     - 逾期維持原本的紅色 inset 標線在列自己身上，不受今天/非今天狀態影響，兩種語意的提醒（今天＝藍、逾期＝紅）刻意不疊在同一個地方比顏色，避免互搶注意力
  4. **色階怎麼選色**：今天／非今天用的底色不是隨便挑的中間值，是直接拿 `blue`／`black` 色階上對應深淺位置的既有色階（`-000`／`-050`／`-100`），見上方「色彩 token：統一用色階，不分用途」
- **`WorkItemTable` 桌面（≥768px）版面：留白責任從「容器」移到「列」**——`.work-item-table` 本身不留左右 padding，列的背景／底線因此橫向撐滿到 `.home-view` 的邊緣（跟 `DateNav` 一樣是無側邊留白的全寬區塊，不會被關進一個縮排的框裡），改成 `.work-item-table__row` 自己吃 `padding: 0 32px`，讓儲存格內容的起始位置對齊 `DateNav` 的 32px 內距。這是取捨過的結果：容器留白會讓表格看起來卡在一個框裡、跟滿版的 `DateNav` 不協調；容器和 `DateNav` 一起不留白，`DateNav` 的按鈕又會貼到畫面邊緣，兩種都試過、都不好看，所以拆成「列背景滿版、列內容對齊」。手機（< 768px）維持原本容器留白＋卡片式列表（各自有 border/border-radius/margin），這條只套用在桌面的表格版面
- **桌面表格資料列（不含表頭）用斑馬紋**：單數列（第 1、3、5…筆）底色比雙數列略深，方便橫向對齊閱讀；今天／非今天各自用一組色階（見上方「今天／非今天要有視覺區別」第 3 點）。**實作上的坑**：表頭在 DOM 上是 `.work-item-table` 底下第一個 child，資料列因此整體被往後推一格，所以「第 1 筆資料」對應的 CSS selector 其實是 `:nth-child(even)`，不是看起來更直覺的 `:nth-child(odd)`，程式碼裡有寫註解記錄這件事。只在桌面套用（手機卡片各自有留白間隔，斑馬紋在卡片版面上沒有意義）
- **每日工時上限**：`DateNav` 的「今日工時合計：Xhr」文字不變，合計**超過** 8 小時（`shared/validation-schema.json` 的 `dailyHours.warn`，`DateNav.vue` 透過 `DAILY_HOURS_WARN` 讀取，剛好 8 不算）才加上 `date-nav__total--over`：只把文字換成紅色 `--color-red-700`，不加粗、不用膠囊框（使用者決定）。合計**超過** 24 小時（`dailyHours.max`）不能存：`WorkItemForm` 用 `fetchDaySummary` 查當天其他紀錄（編輯時排除自己）的工時合計 `otherHours`，加上本筆超過就在今日工時（請假時數）欄位顯示錯誤「當天工時合計不可超過 24 小時（其他紀錄已 X 小時，已超出Y小時）」（使用者決定；前端 `dailyHoursMessage`、`Code.gs` 的 `dailyHoursError_`、MSW 三處格式相同，數字四捨五入到小數兩位避免浮點誤差）。送出前前端一定先算出當天合計再決定是否放行：`otherHours` 還沒查到（查詢中或先前失敗）就在 `onSubmit` 當場再查一次（期間「儲存」按鈕顯示「檢查中…」並停用，用表單自己的 `checkingDayHours`，不動父層的 `saving`），查不到就擋下並在今日工時欄位提示「無法確認當天工時合計，請稍後再試」；剛好 24 可以存。後端也檢查（`Code.gs` 的 `handleCreate_`／`handleUpdate_` 寫入前也檢查，跨月編輯在刪舊列之前就檢查）
- 完成度用進度條呈現；預計期限已過但完成度 < 100 的列，用顏色標示逾期，並排在前面。預計期限是選填，沒填不算逾期（`types/work-item.ts` 的 `isOverdue` 要先排除空字串：空字串在字串比較上永遠小於任何日期）
- **「狀態」欄位的樣式**：桌面表格維持純文字（顏色沿用儲存格原本的文字色）；手機卡片是**透明底＋邊框的膠囊**（`.work-item-table__status`），邊框用 `currentcolor`，每個狀態只要設一次 `color`，邊框自動同色。桌面版的還原寫在 `&__status` 區塊最後的 `@media` 裡（`color: inherit`、去掉框線與內距），依照「RWD 斷點」的巢狀寫法規定，必須排在所有狀態修飾符之後才蓋得過
  - 顏色對應（寫在 `WorkItemTable.vue` 的 `&__status--*` 修飾符）：待辦 `--color-black-600` `#495057`／進行中 `--color-blue-700` `#0f47b8`／前端完成 `--color-teal-800` `#005c75`／返修 `--color-red-700` `#a51028`／確認上線 `--color-green-800` `#3a6c14`／暫緩 `--color-yellow-800` `#8f590d`
  - 選階原則：卡片底色有白、灰（`--color-black-050`）、今天的淡藍（`--color-blue-050`）三種，每個色系挑「在淡藍底上對比度仍 ≥ 4.5:1（WCAG AA 小字標準）」的**最淺**一階。所以主色 `blue-500`／`red-600`（淡藍底 4.0／4.5）不用、改用 700；`teal-700`（4.59）太貼近下限改用 800；`green-700`（3.53）不夠改用 800；`yellow-800`（4.90）剛好夠。暫緩選 Yellow 不選 Orange，是為了跟返修的紅色拉開距離（曾試過改成 `orange-700`，但跟返修 `red-700` 色相太接近，非今天放假日的淡橘色列上也會跟背景融在一起，所以維持 yellow）
  - 暫緩和「今天剛好放假」都是 `--color-yellow-800`，兩者語意不同但同色；非今天的放假日是 orange，不會跟暫緩撞色。之後如果要區分，改其中一處用的色階即可，不用新增自訂 token
  - class modifier 需要英文 key，對應表是 `types/work-item.ts` 的 `STATUS_KEYS`（型別綁 `STATUS_OPTIONS`，新增狀態漏寫對應會直接型別錯誤）；Sheet 的狀態是純文字，可能出現清單外的值，`getStatusKey()` 查不到回傳 `undefined`，這時只套基本樣式（深灰膠囊），不會壞掉；狀態為空則不顯示膠囊
- 新增/編輯用 Drawer 呈現，不整頁跳轉；刪除即使是軟刪除，也要跳確認對話框
- **複製**（使用者決定）：欄位規則集中在 `src/utils/copy-work-item.ts` 的 `buildCopyPayload`，單項複製跟複製本日共用，改一處兩邊一起生效；項次一律由後端照新日期的每日編號規則接續
- **單項複製**：操作欄「編輯／複製／刪除」（複製是中性灰按鈕），按「複製」用來源紀錄預填**新增**表單（`WorkItemForm` 的 `copySource` prop，標題「複製工作項目／複製請假」），存檔走 `create` 新增一筆，原紀錄不動；後端、MSW 不用另外處理
  - 工作日期用 `DateNav` 目前選到的那天（不是來源紀錄的日期），項次照新增規則顯示那天的預計項次
  - 工作項目帶入交辦單位、交辦人員、專案名稱、專案 Repo、工作目標、預計期限、狀態、完成度；處理內容、今日工時是「當天」的內容，維持預設值（空白、0）
  - 請假紀錄也能複製：維持請假模式，帶入假別、請假時數、備註（固定值一樣送出時才補）
  - 複製時紀錄類型跟來源一樣：複製工作紀錄只能是工作紀錄、複製請假只能是請假，表單不顯示「工作項目 ｜ 請假」切換（跟編輯一樣，使用者決定）
  - 未儲存確認的快照取預填後的狀態，打開沒改就關閉不跳確認
- **複製本日**（使用者決定）：`DateNav` 右側「複製本日」按鈕（中性灰次要按鈕，跟表格的「複製」同色），登入且當天有紀錄才顯示；開 `CopyDayDialog` 選目標日期，預設下一個工作日（`findNextWorkday`，跳過週末與國定假日、補班日算工作日）
  - 依原本項次順序複製當天全部紀錄（含請假），每筆照 `buildCopyPayload` 的規則，一次呼叫後端 `batchCreate`
  - 前端先用 `fetchDaySummary` 估算目標日工時合計（既有紀錄＋這批），超過 24 小時就在對話框顯示錯誤「當天工時合計不可超過 24 小時（其他紀錄已 X 小時，已超出Y小時）」、不送出；查不到也擋下並提示稍後再試。後端 `batchCreate` 也會整批檢查，超過就整批退回、不寫入任何一筆
  - 成功後關閉對話框、切到目標日期，用 success 樣式的 Toast 顯示「已複製 N 筆紀錄到 YYYY/MM/DD」；登入錯誤關閉對話框並登出，其他錯誤用 Toast 顯示、對話框維持開啟讓使用者換日期重試
  - MSW 的 `batchCreate` 跟 `Code.gs` 同一套規則（整批檢查請假時數上限與每日合計，通過才寫入）
- **表單關閉前的未儲存確認**：`WorkItemForm` 打開時存一份欄位快照，「✕」「取消」、點背景三個關閉入口都走 `requestClose()`，跟快照比對有差異才跳 `ConfirmDialog`（「要放棄變更嗎？」，按鈕「繼續編輯」／「放棄變更」），沒差異（含改了又改回原值）直接關閉。存檔成功、登入錯誤強制關閉是 `HomeView` 直接關，不經過這個確認
  - **關閉順序**：按「放棄變更」時先關確認對話框，等它的離場動畫播完（`Transition` 的 `@after-leave`）才 `emit('cancel')` 關表單；不能同時關，否則表單滑出時會把還沒消失的對話框一起帶走，順序看起來是反的（使用者要求）
- **表單送出中（`saving`）防止重複送出**（使用者要求）：兩層一起做，不互相取代
  - 滿版 Loading 遮罩：`saving` 時在 `WorkItemForm` 最上層蓋 `.work-item-form__loading-mask`（半透明白，中間 `<AppLoading label="儲存中…" />`），擋住所有點擊；Toast（`z-index: 200`）仍在遮罩上方，存檔失敗看得到訊息
  - 欄位與按鈕本身也停用：所有原生欄位、`NSelect`、「✕」「取消」「儲存」都綁 `:disabled="saving"`（遮罩擋不住鍵盤，停用才能擋 Tab／打字）；`onSubmit()`、`requestClose()` 開頭也檢查 `saving`，點背景關閉（`div` 無法 disabled）靠後者擋
  - 存檔失敗 `saving` 變回 false，遮罩消失、欄位恢復可編輯，已填內容保留
  - 狀態名稱維持 `saving` 不改成 `pending`（使用者確認）：表單只有「儲存」一種非同步操作，名稱越具體越好讀
- **確認對話框（`ConfirmDialog`）的按鈕配置照 Apple Human Interface Guidelines（Alerts）**（使用者決定，全站確認對話框統一）：
  - 取消在左、動作在右；按鈕文字用具體動詞（例如「刪除」「放棄變更」），不用「確定／是」
  - `danger`（破壞性動作）：動作按鈕用**紅色文字**（`--color-red-600`），不是紅色實心底；預設按鈕（粗體、開啟時取得焦點、按 Enter 觸發）是比較安全的「取消」，避免誤按就執行破壞性動作
  - 非 `danger`：動作按鈕是預設按鈕（主色實心底、取得焦點）
  - **開關動畫**：參照 `OptionsManagerModal` 桌面版的淡入＋輕微縮放（背景淡入、卡片 `scale(0.95)` → 1，0.2s）。`ConfirmDialog` 手機也是置中卡片，所以不分斷點都用這組，不套 `OptionsManagerModal` 手機的「由下滑入」。動畫 class 寫在 `ConfirmDialog` 自己的 scoped style，**使用端要用 `<Transition name="confirm-dialog">` 包住 `<ConfirmDialog v-if>`**（`HomeView`、`OptionsManagerModal`、`WorkItemForm` 三處都有包），新增使用的地方也要記得包；跟 `OptionsManagerModal` 一樣，根元素要宣告 `transition-duration`，Vue 才等得到離場動畫播完
- **表單（`WorkItemForm.vue`）的項次欄**：跟「工作日期」放在同一行（項次是右側窄欄），只負責顯示。**刻意不用 `<input>`**，改用外觀模仿停用輸入框的 `<div class="work-item-form__readonly">`（灰底灰框），不是表單控制項，使用者無從輸入（使用者決定）；沒有值時顯示淡灰色的「項次」當 placeholder。就算用開發者工具改了畫面上的數字也影響不到 Sheet：送出的資料不含項次，後端也會忽略前端送來的值
  - 編輯且工作日期沒改：顯示這筆紀錄目前的項次
  - 新增，或編輯時把工作日期改到別天：顯示那天的預計項次（`fetchDaySummary`，同一次查詢也算出當天其他紀錄的工時合計，沿用 `doGet` 的 `date` 查詢自己算，不另開 API、不影響表格的 `items`）；查詢中或失敗時留空（顯示 placeholder），不擋存檔。連續改日期只採用最後一次查詢的結果
  - 預計項次只是參考值，實際項次由後端寫入當下決定（中間若有其他新增，號碼可能較大）
- 表單欄位順序：工作日期／項次 → 交辦單位／交辦人員 → 專案名稱 → 專案 Repo → 工作目標 → 處理內容 → 今日工時 → 完成度 → 預計期限 → 狀態
- **表單欄位規格**（使用者定案；規則數值以 `shared/validation-schema.json` 為準）：

  | 欄位 | 必填 | 預設 | placeholder | 限制 |
  |---|---|---|---|---|
  | 工作日期 | ✅ | DateNav 選到的那天（`HomeView` 傳 `default-date`） | 請選擇工作日期 | 年份 2020–2099 |
  | 交辦單位／交辦人員／專案名稱 | ✅ | — | 請選擇交辦單位／交辦人員／專案名稱 | ≤ 50 字 |
  | 專案 Repo | 選填 | — | 請選擇專案 Repo (選填) | 每個 ≤ 50 字、最多 10 個、不可含逗號（Sheet 用逗號串成一格存） |
  | 工作目標 | ✅ | — | 請填寫工作目標 | ≤ 500 字（textarea） |
  | 處理內容 | 選填 | — | 請填寫處理內容 | ≤ 2000 字（textarea） |
  | 今日工時 | 選填 | 0 | 請填寫今日工時 | 0–24，`step` 0.25；清空送出時用 0；當天所有紀錄合計不可超過 24 小時（前後端都擋） |
  | 完成度 | 選填 | 0 | 請填寫完成度(%) | 0–100 整數；清空送出時用 0 |
  | 預計期限 | 選填 | — | 請選擇預計期限 | 年份 2020–2099 |
  | 狀態 | ✅ | 待辦（編輯舊資料狀態為空時也帶待辦） | 請選擇狀態 | 固定選項，不可清除 |

  - 日期欄維持原生 `<input type="date">`（使用者決定，手機用系統原生滾輪）：原生日期欄會忽略 `placeholder`，空白時顯示的是瀏覽器自己的「年／月／日」，所以「預計期限」的 placeholder 實際上看不到，屬已知限制
  - 送出時文字欄位去掉前後空白
  - **單選 `NSelect` 的 placeholder**：`NSelect` 只有值是 `null` 時才顯示 placeholder，空字串會被當成「選了一個空的值」而不顯示。表單內部（驗證、送出、快照比對）維持用空字串代表「沒選」，交辦單位／交辦人員／專案名稱／狀態綁定 `NSelect` 時經過 `selectModel()` 這層 computed 互轉（`'' ↔ null`）；多選的專案 Repo 是空陣列，本來就正常
  - 必填欄位的名稱後面加紅色「＊」（`--color-red-600`，`aria-hidden`），是否顯示由 `isRequired(field)` 讀 schema 的 `required` 決定，不寫死在 template；欄位名稱跟＊包在 `.work-item-form__label` 裡（label 是 flex column，不包的話＊會被擠到下一行）
- **表單驗證**（`src/validation/work-item.ts` 的 `validateWorkItem`）：`<form novalidate>` 關掉瀏覽器內建驗證，全部欄位統一走自訂驗證（交辦單位、狀態等是 `NSelect`，不是原生欄位，內建 `required` 檢查不到）
  - 第一次按「儲存」才開始顯示錯誤；之後每次修改即時重新驗證，修正後錯誤馬上消失
  - 錯誤呈現：欄位下方紅字（`--color-red-600`）＋欄位框變紅（原生欄位用 `.work-item-form__field--invalid`，`NSelect` 用 `status="error"`），並捲動到第一個錯誤欄位、聚焦其中的輸入框
  - textarea 另外設了 `maxlength`，打字時就擋在上限，不用等送出
- **儲存失敗的處理**（`HomeView.vue` 的 `onSave`／`handleSaveError`）：不在頁面上顯示錯誤文字，一律用 `AppToast` 顯示錯誤訊息
  - 登入錯誤（前端沒有 `idToken`，或後端回 `code: 'UNAUTHORIZED'`，例如 token 過期）：關閉 `WorkItemForm` Drawer 並執行 `signOut()`，畫面回到唯讀模式並顯示登入按鈕
  - 其他錯誤（欄位驗證失敗、找不到紀錄、網路錯誤等）：Drawer **維持開啟**、保留已填內容，維持登入狀態，讓使用者修正或等網路恢復後直接重送（使用者決定）
  - Toast 規格：畫面上方置中（不擋手機底部操作區），一次只顯示一則、新的取代舊的，4 秒自動消失，有關閉按鈕；`z-index: 200` 疊在 Drawer／Modal（`100`）之上；外層 `aria-live` 區域常駐、內容用 `role="alert"`（success 用 `role="status"`），螢幕閱讀器才唸得出來。`showToast(message, type)` 的 `type` 預設 `error`（紅色）；`success`（綠色 `green-800` 文字、`green-000` 底、`green-200` 框，圖示 ✓）目前只有「複製本日」完成時用。手刻元件，不用 Naive UI 的 message（照「UI 元件庫」原則，只有自己刻成本高的元件才用 Naive UI）
  - 目前只有「儲存」接 Toast；刪除失敗（`confirmDelete`）、選項清單管理的錯誤還沒改成 Toast
- 逾期只做視覺標示，不做主動通知（Email 提醒等）
- Google 登入狀態存在登入 session 內，不用每次操作重新登入
- `DateNav` 的 `NDatePicker` 顯示「`2026/09/25 (五)`」格式（日期＋星期），選到的日期若不是工作日（國定假日或純週末），旁邊多顯示一個「放假原因」徽章，文字與邊框用放假色（預設 orange、今天放假改 yellow，見上方「放假色」），跟「逾期」用的紅色（`--color-red-600`）做區隔，避免使用者混淆兩種不同性質的提醒。細節見下方「台灣國定假日顯示」
  - **不另外顯示放假提示列**：曾經在 `HomeView.vue` 的 `DateNav` 與表格之間放一條獨立提示列（左側標線＋淡色底），已移除。原因：同一件事已經有徽章、表格放假色調、空狀態「這天放假呦！」三處呈現，提示列是重複資訊；它是滿版 `DateNav` 與滿版表格之間唯一一塊有 margin／圓角的卡片，破壞版面節奏；左側標線跟「逾期」是同一種視覺語言，讓中性資訊看起來像警告；切換日期時忽隱忽現造成版面跳動

## 台灣國定假日顯示

- **資料來源**：[`ruyut/TaiwanCalendar`](https://github.com/ruyut/TaiwanCalendar)，整理自政府資料開放平台「中華民國政府行政機關辦公日曆表」，透過 jsdelivr CDN 發布 JSON（`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/{year}.json`），已實測回應帶 `access-control-allow-origin: *`，前端可直接 `fetch`，不會撞 CORS。通常每年 6 月會釋出下一年度資料
- **即時查詢，不寫死年份清單**：`useTaiwanHolidays.ts` 內部把「整筆原始資料」（含 `isHoliday`／`description`）存進模組層級共用快取（同一年度只抓一次），對外提供四個函式：
  - `getDayOffLabel(date)`：回傳「這天放假的原因」——國定假日回傳假日名稱（例如「中秋節」）；純週末沒有 `description`，回傳「週六」/「週日」這種通用標籤（不是只顯示國定假日，週末也算，畫面上要看得出來是放假）；一般工作日回傳 `null`
  - `isWorkday(date)`：是否為工作日，`DateNav` 的「上一個工作日／下一個工作日」按鈕算 disabled 狀態用
  - `ensureYearLoaded(year)`：確保某年度資料已載入，回傳 `Promise`
  - `findNextWorkday(fromDate, direction)`：往前/往後找下一個工作日，`DateNav` 的「上一個工作日／下一個工作日」按鈕用這個。**這裡刻意用原始 `isHoliday` 欄位判斷（不是 `getDay()` 猜週末）**，因為 `isHoliday` 才正確涵蓋補班日的例外情形（補班的週六 `isHoliday` 會是 `false`），用星期幾去猜會在補班日誤判成放假。日期解析要跟 `DateNav.vue` 的 `shift()` 用同一套慣例（`new Date(fromDate)` 純日期字串視為 UTC 午夜，搭配 `setDate`/`getDate` 本地時間方法，再用 `toISOString()` 轉回字串）——這套組合對台灣所在的正 UTC 偏移時區剛好互相抵銷、結果正確；混用 `` `${fromDate}T00:00:00` ``（本地午夜解析）卻仍用 `toISOString()` 轉字串會兩邊時區基準不一致，換算回來的日期少一天（實際踩過這個坑：9/24 按「下一個工作日」原本因為這個 bug 完全沒反應）
  - 查不到或請求失敗就靜默不顯示假日資訊／視為工作日，不影響其他功能，也不擋頁面
- **不在月曆彈窗格子內標色**：`NDatePicker` 沒有自訂格子樣式的介面，改用旁邊獨立的徽章表示，取捨紀錄見上方「UI 元件庫」段落
- **色彩 token**：放假色預設 orange、今天剛好放假時改 yellow（規則見上方「放假色」），跟逾期的紅色、一般強調的藍色區分
- 本專案在瀏覽器執行期間會打「Apps Script 以外的第三方網址」的地方只有兩處：這裡的 jsdelivr CDN，以及 Google Fonts 字體（見上方「UI/UX 定案」的字體段落），記錄於此避免之後忘記這些例外

## RWD 斷點

- **手機**：`< 768px`（桌面版表格改卡片式列表，方便隨手填寫「處理內容」）
- **平板**：`768px – 1023px`
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

1. Google Sheet 準備：建立「選項清單」分頁、確認分頁欄位含工作日期／ID／已刪除、Apps Script 專案初始化
2. Apps Script 後端：doGet／doPost、自動建分頁邏輯、ID Token 驗證、共用 schema 驗證、選項清單讀寫
3. 前端基礎建設：Vite + Vue 3 + TS 專案、ESLint/Prettier/.editorconfig、CSS token 架構、GIS 登入串接
4. 管理／檢視畫面（`HomeView.vue`，單一路由依登入狀態切換）：表格（A 版排版）、新增/編輯 Drawer、單日切換、自動完成/下拉選單、刪除確認、唯讀模式
5. 部署：GitHub Actions 建置流程 → GitHub Pages

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
npm run lint:style # Stylelint 檢查並自動修復（含 CSS 屬性排序）
npm run format     # Prettier 格式化 src/
```

**環境變數**：`.env` 不進版控（見 `.gitignore`），第一次拉專案要自己複製 `.env.example` 成 `.env` 並填入真實值（`VITE_APPS_SCRIPT_URL`、`VITE_GOOGLE_CLIENT_ID`）。這兩個值本身都設計成可公開（見上方「可公開的識別碼」），不進版控是為了避免以後有人在同一個檔案裡加了真正的密鑰卻忘記它會被 commit，是預防性的習慣，不是因為這兩個值現在需要保密。

`npm run dev` 預設會啟動 MSW 攔截 API 請求（打假資料，方便切版/開發不用等真後端）。選填的 `VITE_ENABLE_MSW=false` 可以在 dev 模式下關掉 MSW，改讓請求真的打到 `VITE_APPS_SCRIPT_URL` 指到的 Apps Script。沒設這個變數時維持原本行為（照樣打假資料）。

**本機測真後端會撞到的 CORS 問題與解法**：Apps Script 網頁應用程式對 `localhost` 這類來源的 CORS 支援是已知有缺陷的（社群長年回報、Google 沒正式修掉，換新部署也不會解決），瀏覽器會擋下 `fetch`，即使後端其實有正常執行（可以用 `curl` 直接打 `/exec` 網址驗證，繞過瀏覽器的 CORS 機制）。解法是 `vite.config.ts` 裡的 `appsScriptDevProxyPlugin`：`VITE_ENABLE_MSW=false` 時，前端改打同源的 `/apps-script-proxy`，由這個 middleware 在 **Node 端**把整個請求（含跟著 Apps Script 的 302 轉址）做完，只把最終 JSON 回給瀏覽器，瀏覽器全程只跟自己的 origin 講話，不會有跨網域請求。

- 這裡**不能用 Vite 內建的 `server.proxy`**（底層 `http-proxy`）：它不會自動跟著 redirect 走，只是把 Apps Script 回的 302 轉發給瀏覽器，瀏覽器自己再去跟轉址目標（`script.googleusercontent.com`）要資料時又是一次跨網域請求，等於繞了一圈還是撞到同一個問題
- 這個 proxy **只在本機開發有效**，正式部署到 GitHub Pages（純靜態站，沒有 server 可以轉發）不會有這層，屆時要靠 Apps Script 自己的 CORS 處理——社群回報通常從「真的 HTTPS 網域」打會比 `localhost` 穩定，實際部署後要再驗證一次
- `useWorkItems.ts`／`useOptions.ts` 都已經改成：`DEV` 且 `VITE_ENABLE_MSW=false` 時走 `/apps-script-proxy`，其餘情況維持打 `VITE_APPS_SCRIPT_URL`（讓 MSW 的 `*/exec` 攔截規則能正常比對）

# 需要使用者事先準備的東西

- ~~在 GCP 建立 OAuth 用戶端 ID~~（已完成，Client ID 在本機 `.env` 裡）
- ~~確認 Google Sheet 已依上述結構調整~~（已完成：`2026-09` 分頁表頭、「選項清單」分頁都已建好，見上方「Google Sheet 結構設計」的實際欄位順序）
- 部署這次的日期格式改動後，在 Apps Script 編輯器手動執行一次 `fixExistingMonthSheetDateFormats()`，把已存在的月份分頁（例如 `2026-09`）補上 `yyyy/mm/dd` 儲存格格式（新分頁會自動套用，不用做這件事；見上方「日期欄位格式」）
- ~~重新部署 `Code.gs`，`doPost` 登入失敗多回 `code: 'UNAUTHORIZED'`~~（已完成，第 5 版）
- 重新部署 `Code.gs`（項次改成每天編號）：貼到 Apps Script 編輯器後，「管理部署作業」編輯既有部署、版本選「新版本」，網址不變。部署後在編輯器的「執行」選單手動執行一次 `renumberDailyIndexes()`，把既有資料的項次重新編成每天 1、2、3（未刪除的照現有順序重編，已刪除的維持原號）
- 重新部署 `Code.gs`（修正 ID 欄位對不上：Sheet 表頭是大寫 `ID`，API／前端鍵名是小寫 `id`，原本新增時 UUID 沒寫進 Sheet、讀取時也回傳 `ID` 鍵，導致編輯/刪除一律「找不到這筆紀錄」；現在由 `rowToItem_`／`itemToRow_` 用 `ID_HEADER`／`ID_KEY` 互轉）。部署後在編輯器的「執行」選單手動執行一次 `fillMissingIds()`，把既有 ID 空白的紀錄補上 UUID（已有 ID 的不動），不補的話那些舊資料還是無法編輯/刪除
- 重新部署 `Code.gs`（新增請假紀錄：狀態 `休假`、固定欄位覆蓋、不寫回選項清單；也包含請假時數上限 8 小時與每日 24 小時合計檢查）。部署前真後端會把狀態 `休假` 當成不合法而退回
- 重新部署 `Code.gs`（新增 `batchCreate` action，「複製本日」用）。部署前真後端會回「未知的 action」
- 重新部署 `Code.gs`（欄位驗證規則改版：處理內容、預計期限改選填，狀態改必填，今日工時 0–24／0.25，字數上限等）。部署前真後端仍是舊規則，前端送出空的處理內容或預計期限會被後端退回

---

## Claude 協作指引

當協助此專案開發時，請注意：

1. **保持現有架構**：本文件記錄的技術選型、資料模型、分支策略都是已定案的決策，異動前先跟使用者確認，不要自行更換方案
2. **commit 前先確認**：實作完成後先列出要提交的內容與訊息，等使用者明確同意才執行 `git commit`
3. **型別安全**：所有新增程式碼需有完整 TypeScript 型別，`shared/validation-schema.json` 是前後端共用驗證規則的唯一事實來源
4. **錯誤處理**：所有呼叫 Apps Script API 的地方都要處理 loading／成功／失敗狀態，不能假設網路請求一定成功
5. **語言**：介面文字與程式碼註解使用繁體中文（台灣用語），回覆使用者也一律用繁體中文
6. **色彩管理**：樣式一律吃 `src/styles/tokens.scss` 的 CSS 變數，不要在元件裡寫死 hex 色碼；一律用 `--color-<色系>-<階>` 色階，色值取自公司設計系統，規則見「色彩 token：統一用色階，不分用途」
