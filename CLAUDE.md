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
| 項次 | 系統自動編號（依當月新增順序），非必要不手動輸入 |
| 交辦單位 | 可搜尋下拉選單（來自「選項清單」分頁，可輸入清單沒有的新值直接當作答案送出）（原欄名「單位」） |
| 交辦人員 | 可搜尋下拉選單（來自「選項清單」分頁，同上可自訂新值） |
| 專案名稱 | 可搜尋下拉選單（來自「選項清單」分頁，同上可自訂新值） |
| **專案Repo**（新增） | 選填，可搜尋的**多選**下拉選單（來自「選項清單」分頁，同上可自訂新值），可填多個 repo 名稱（例如 `AAA`、`BBBB`）。Sheet 儲存格存成逗號分隔的字串（如 `AAA,BBBB`），前端拆開後以 `#AAA` `#BBBB` 標籤呈現；沒有值就不顯示 |
| 工作目標 | 文字（原欄名「工作內容」） |
| 處理內容 | 文字，語意＝工作日期當天的處理情形（原欄名「今日處理情形」） |
| 今日工時 | 數字（語意＝工作日期當天的工時），需為非負數 |
| 預計期限 | 日期（原欄名「預計完成期限」）。格式同「工作日期」，見下方「日期欄位格式」 |
| 完成度 | 數字，限制 0–100（原欄名「完成%」，改名後鍵名不含特殊字元，程式裡可直接用 `item.完成度` 不用中括號） |
| 狀態 | 簡單下拉選單（不用搜尋），固定選項：`進行中`／`前端完成`／`返修`／`待辦`／`確認上線`／`暫緩`，可留空（原欄名「完成回報」） |
| **已刪除**（系統） | TRUE/FALSE，軟刪除標記，不做真刪除 |

**表格顯示的合併欄位**（僅畫面呈現合併，資料仍是各自獨立欄位，表頭文字也標明合併了哪些欄位）：
- **交辦單位 + 交辦人員**：共用一欄，表頭寫「交辦單位/人員」。手機卡片版面較寬，呈現單行「某某某（OO部門）」；桌面表格的這欄是固定窄欄（110px），單行塞不下，改呈現兩行堆疊「OO部門」換行「某某某」
- **專案名稱 + 專案Repo**：共用一欄，表頭寫「專案名稱/Repo」。專案名稱在上，有填 Repo 才在下方多一行 `#AAA` `#BBBB` 標籤，沒填就不多顯示

**附件欄位**：已從系統範圍移除（圖片需經 Google Drive 中轉才能顯示，複雜度高，暫不做上傳功能）。Sheet 上保留原欄位，有需要時使用者自行手動貼連結。

**選項清單分頁**（新增，命名「選項清單」）：存放「交辦單位」「交辦人員」「專案名稱」「專案Repo」的可選值，供前端可搜尋下拉選單讀取；使用者輸入清單沒有的新值時，`doPost` 的 `create` 動作會同步把新值寫回此分頁。

**資料模式**：情境 A（日誌式）——同一專案每天新增一列新紀錄，不覆寫舊資料，歷史紀錄自然依時間往下疊。

**日期欄位格式**：「工作日期」「預計期限」在 Google Sheet 儲存格顯示、以及 Apps Script API（`doGet`/`doPost`）傳輸的字串格式都是 `YYYY/MM/DD`（例如 `2026/09/23`），Sheet 端這兩欄也套用對應的 `yyyy/mm/dd` 儲存格數值格式（`Code.gs` 的 `applyDateColumnFormat_`，新建月份分頁時自動套用；改動當下已存在的分頁需手動在 Apps Script 編輯器執行一次 `fixExistingMonthSheetDateFormats_()` 補上，用法同 `installTrigger()`，一次性）。

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
  - `create`：判斷/建立當月分頁，產生 UUID 當 ID，項次＝該月分頁目前列數＋1（**當月**新增順序，不是當天），寫入新列；若帶了新的交辦單位/交辦人員/專案名稱/專案Repo，同步寫回「選項清單」分頁
  - `update`：payload 額外帶 `originalDate`（這筆紀錄修改前的工作日期），換算出**原本**月份分頁去定位 `ID`。若 `item.工作日期` 跟 `originalDate` 換算出的月份不同（使用者把工作日期改到別的月份），先從原分頁刪除該列、在新月份分頁新增一列，維持每筆紀錄只存在一個分頁
  - `delete`：payload 帶 `originalDate`，換算月份分頁定位 `ID`，將「已刪除」設為 TRUE
  - `addOption`／`renameOption`／`deleteOption`：直接管理「選項清單」分頁本身（不透過新增/編輯工作紀錄的副作用），給前端「管理選項清單」Modal 用，細節見下方「選項清單管理」
- 後端必須重複驗證前端已做過的規則（完成度限制 0–100、今日工時非負數、必填欄位不可為空等），因為 API 網址公開，理論上可被繞過前端直接呼叫

**重要限制：Apps Script 網頁應用程式的回應沒辦法自訂 HTTP status code，一律是 200**（平台限制）。所以 `doGet`／`doPost` 的成功/失敗**一律靠回應內容裡有沒有 `error` 欄位判斷**，前端（`useWorkItems.ts`）已經配合改成檢查 `data.error`，不能用 `res.ok`／HTTP 狀態碼判斷；MSW mock 也同步改成一律回 200、錯誤放在 `error` 欄位裡，貼近真實行為。之後如果重寫前端呼叫邏輯，要記得延續這個慣例。

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
    WorkItemForm.vue      # 新增/編輯表單（Drawer 呈現）
    OptionsManagerModal.vue # 管理選項清單（新增/重新命名/刪除），獨立 Modal，只有 isAuthorized 看得到入口
    ConfirmDialog.vue     # 通用確認對話框（刪除工作紀錄、刪除選項清單的值都用這個）
    DateNav.vue           # ⏮ 上一個工作日 / ◀ 上一天 / 日期選擇器 / 下一天 ▶ / 下一個工作日 ⏭ / 回到今天（今天時改顯示「今天」狀態標示），顯示星期，放假日顯示徽章，日期選擇器今天時用 :deep() 改邊框/文字色，按鈕沒用途時 disabled
    ProjectAutocomplete.vue
  composables/
    useGoogleAuth.ts      # 登入狀態、ID Token 管理
    useWorkItems.ts        # 讀寫 API 呼叫、狀態管理
    useTaiwanHolidays.ts   # 台灣國定假日查詢，見下方「台灣國定假日顯示」
  styles/
    tokens.scss            # 色彩變數（統一色階 --color-<色系>-<階>，例如 --color-blue-500 / --color-black-100，色值取自公司設計系統），預留深色模式擴充，元件一律吃變數不寫死 hex
shared/
  validation-schema.json   # 前後端共用的驗證規則來源（唯一事實來源）
apps-script/                # clasp 專案（Apps Script 原始碼版控）
  Code.gs
  build/schema.gs           # 由 shared/validation-schema.json 產生，build 時自動同步
```

**共用驗證 schema 同步方式**：`shared/validation-schema.json` 是唯一事實來源，前端直接 import；另有一支 build script（`npm run build:gs`）在建置階段把這份 JSON 轉成 Apps Script 可讀的 `schema.gs`，避免手動維護兩份規則。

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
- 完成度用進度條呈現；預計期限已過但完成度 < 100 的列，用顏色標示逾期，並排在前面
- **「狀態」欄位的樣式**：桌面表格維持純文字（顏色沿用儲存格原本的文字色）；手機卡片是**透明底＋邊框的膠囊**（`.work-item-table__status`），邊框用 `currentcolor`，每個狀態只要設一次 `color`，邊框自動同色。桌面版的還原寫在 `&__status` 區塊最後的 `@media` 裡（`color: inherit`、去掉框線與內距），依照「RWD 斷點」的巢狀寫法規定，必須排在所有狀態修飾符之後才蓋得過
  - 顏色對應（寫在 `WorkItemTable.vue` 的 `&__status--*` 修飾符）：待辦 `--color-black-600` `#495057`／進行中 `--color-blue-700` `#0f47b8`／前端完成 `--color-teal-800` `#005c75`／返修 `--color-red-700` `#a51028`／確認上線 `--color-green-800` `#3a6c14`／暫緩 `--color-yellow-800` `#8f590d`
  - 選階原則：卡片底色有白、灰（`--color-black-050`）、今天的淡藍（`--color-blue-050`）三種，每個色系挑「在淡藍底上對比度仍 ≥ 4.5:1（WCAG AA 小字標準）」的**最淺**一階。所以主色 `blue-500`／`red-600`（淡藍底 4.0／4.5）不用、改用 700；`teal-700`（4.59）太貼近下限改用 800；`green-700`（3.53）不夠改用 800；`yellow-800`（4.90）剛好夠。暫緩選 Yellow 不選 Orange，是為了跟返修的紅色拉開距離（曾試過改成 `orange-700`，但跟返修 `red-700` 色相太接近，非今天放假日的淡橘色列上也會跟背景融在一起，所以維持 yellow）
  - 暫緩和「今天剛好放假」都是 `--color-yellow-800`，兩者語意不同但同色；非今天的放假日是 orange，不會跟暫緩撞色。之後如果要區分，改其中一處用的色階即可，不用新增自訂 token
  - class modifier 需要英文 key，對應表是 `types/work-item.ts` 的 `STATUS_KEYS`（型別綁 `STATUS_OPTIONS`，新增狀態漏寫對應會直接型別錯誤）；Sheet 的狀態是純文字，可能出現清單外的值，`getStatusKey()` 查不到回傳 `undefined`，這時只套基本樣式（深灰膠囊），不會壞掉；狀態為空則不顯示膠囊
- 新增/編輯用 Drawer 呈現，不整頁跳轉；刪除即使是軟刪除，也要跳確認對話框
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
- 部署這次的日期格式改動後，在 Apps Script 編輯器手動執行一次 `fixExistingMonthSheetDateFormats_()`，把已存在的月份分頁（例如 `2026-09`）補上 `yyyy/mm/dd` 儲存格格式（新分頁會自動套用，不用做這件事；見上方「日期欄位格式」）

---

## Claude 協作指引

當協助此專案開發時，請注意：

1. **保持現有架構**：本文件記錄的技術選型、資料模型、分支策略都是已定案的決策，異動前先跟使用者確認，不要自行更換方案
2. **commit 前先確認**：實作完成後先列出要提交的內容與訊息，等使用者明確同意才執行 `git commit`
3. **型別安全**：所有新增程式碼需有完整 TypeScript 型別，`shared/validation-schema.json` 是前後端共用驗證規則的唯一事實來源
4. **錯誤處理**：所有呼叫 Apps Script API 的地方都要處理 loading／成功／失敗狀態，不能假設網路請求一定成功
5. **語言**：介面文字與程式碼註解使用繁體中文（台灣用語），回覆使用者也一律用繁體中文
6. **色彩管理**：樣式一律吃 `src/styles/tokens.scss` 的 CSS 變數，不要在元件裡寫死 hex 色碼；一律用 `--color-<色系>-<階>` 色階，色值取自公司設計系統，規則見「色彩 token：統一用色階，不分用途」
