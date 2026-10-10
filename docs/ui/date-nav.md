# DateNav（日期切換）與國定假日

> 從 CLAUDE.md 拆出的細節。跨元件的規則（色彩 token、RWD、日期格式、手動同步清單）仍以 CLAUDE.md 為準。

- 管理頁／檢視頁合併成單一元件（`HomeView.vue`）、單一路由（`/`），不再區分 `/manage`：`isAuthorized` 為 true 顯示新增/編輯/刪除操作與登入資訊，否則顯示唯讀畫面（含「唯讀模式」標籤），未登入時仍保留登入按鈕入口
- 前台改成**以日期為單位**呈現（非月份）：「⏮ 上一個工作日 / ◀ 上一天 / 日期選擇器 / 下一天 ▶ / 下一個工作日 ⏭」＋「回到今天」做單日切換，跨月切換對使用者無感，資料都在同一個分頁，Apps Script 依日期讀出那天的列；「上一個工作日／下一個工作日」會跳過連續的假日／週末（含補班日例外），細節見下方「台灣國定假日顯示」
- **網址帶日期**（使用者決定）：`/?date=YYYY-MM-DD` 開到那天，格式不對或日期不存在（例如 `2026-02-30`）就退回今天，並用 `router.replace` 把錯的 `date` 從網址拿掉（其他參數保留）。之後每次切換日期都用 `router.replace` 把 `date` 寫回網址（不用 `push`，切日期不塞瀏覽紀錄，按上一頁直接離開），重新整理、分享連結都停在同一天；一開始沒帶 `date` 時網址維持乾淨，切過日期才出現。實作在 `HomeView.vue`，日期檢查用 `src/utils/date.ts` 的 `isValidDateString`
- 按鈕沒有實際用途時要 disabled，不能點了沒反應卻看起來可以點：「上一個工作日／下一個工作日」若緊鄰那一天本來就是工作日（按下去效果等同「上一天／下一天」，沒有額外用途）就停用
- **「回到今天」與「今天」放在同一個位置、互相切換**：不是今天時顯示「回到今天」`<button>`（可點擊，`--color-black-100` 一般樣式）；已經是今天時改顯示「今天」`<span>`（主色 `--color-blue-500` 膠囊樣式），純粹當狀態標示。用 `<span>` 而不是 disabled 按鈕，是因為這時它沒有任何可操作的意義，不需要保留按鈕的語意
- **今天／非今天要有視覺區別**：
  1. `DateNav` 的日期選擇器：選到今天時整個輸入框（文字＋邊框）換成深藍 `--color-blue-700`，實作細節（為什麼要用 `:deep()`、改哪幾個內部 class）見下方「`DateNav` 的日期選擇器」
  2. **「回到今天」按鈕／「今天」標示**：不是今天時顯示「回到今天」按鈕可點擊；是今天時換成「今天」`<span>` 狀態標示，透明底＋主色 `--color-blue-500` 邊框/文字的膠囊樣式

- **`DateNav` 版面**（使用者決定）：
  - 桌面、平板（≥ 768px）兩列：第一列是動作按鈕（`actions` slot 包在 `date-nav__actions` 裡，`flex: 1 0 100%` 佔滿整列寬度）靠右；第二列左邊是日期切換（`date-nav__switcher`：⏮ ◀ 日期選擇器 ▶ ⏭），右邊是 `date-nav__status`（放假徽章／工時合計＋今天／回到今天），放不下時 `date-nav__status` 換到下一行並靠右
  - 手機（< 768px）三列：動作按鈕（三顆平均分配整列寬度）→ 日期切換（撐滿整列，⏮ 最左、⏭ 最右，日期選擇器填滿中間）→ 左邊放假徽章／工時合計、右邊今天／回到今天
  - 放假徽章跟工時合計同一個區塊（`date-nav__info`）：放假而且當天沒有紀錄時只顯示放假徽章、不顯示工時合計；放假但有紀錄（例如加班）時兩個都顯示。`DateNav` 用 `hasItems` prop 判斷（`HomeView` 傳 `items.length > 0`）
  - 沒傳 `actions` slot（未登入）時第一列不渲染
  - 動作按鈕（`HomeView.vue` 的 `home-view__add-btn`）所有寬度都是圖示＋文字：手機三顆平均分配整列寬度，平板、桌面寬度隨內容；按鈕另有 `aria-label`／`title`。「＋ 新增」的「＋」是行內 SVG 的 Lucide `plus` 圖示（ISC 授權），文字是「新增」
- **`DateNav` 右側動作按鈕的 hover**（使用者決定，`HomeView.vue` 的 `home-view__add-btn`）：實心底的「＋ 新增」滑過變深（`blue-500` → `blue-700`）；框線按鈕滑過改成淡色底＋深一階的文字與框線——請假 `teal-050` 底／`teal-800`，複製本日 `black-050` 底／`black-700`

- `DateNav` 的 `NDatePicker` 顯示「`2026/09/25 (五)`」格式（日期＋星期），選到的日期若不是工作日（國定假日或純週末），旁邊多顯示一個「放假原因」徽章，文字與邊框用放假色（預設 orange、今天放假改 yellow，見 [theme.md](theme.md) 的「放假色」），跟「逾期」用的紅色（`--color-red-600`）做區隔，避免使用者混淆兩種不同性質的提醒。細節見下方「台灣國定假日顯示」
  - **不另外顯示放假提示列**（`DateNav` 與表格之間）：徽章、表格放假色調、空狀態「這天放假呦！」已經呈現同一件事；提示列會破壞版面節奏、看起來像逾期警告、切換日期時造成版面跳動

- **`DateNav` 的日期選擇器**：用 `NDatePicker`，不用 `NPopover`＋`NCalendar`（後者能在月曆格子標假日色，但沒有年份快速跳選、手機版面調校成本高）。`NDatePicker` 格子無法逐格標色，所以用 `format="yyyy/MM/dd (EEEEE)"`（date-fns 格式字串，`EEEEE` 是最短星期字樣，例如「五」）搭配旁邊一個獨立的假日名稱徽章（顏色見 [theme.md](theme.md) 的「放假色」）
  - **`.date-nav__picker--today` 直接用 `:deep()` 改內部邊框/文字顏色**：`NInput` 的文字與邊框顏色設在內部元素上、不繼承外層，外層 class 改不到，只能穿透：
    - 邊框：`:deep(.n-input__border)`（`NInput` 用兩個疊在一起的空 div 畫邊框，`.n-input__border` 是預設常駐的那個，`.n-input__state-border` 是 hover/focus 才淡入的狀態邊框，要蓋掉平常看到的顏色要改前者，不是後者）
    - 文字：`:deep(.n-input__input-el)`（實際的 `<input>` 元素）
    - 這是目前唯一一處對 `NDatePicker`／`NInput` 用 `:deep()` 的地方，套件升級如果改了這幾個內部 class 名稱，這段「今天」標色會失效，但不影響日期選擇功能本身


## 台灣國定假日顯示

- **資料來源**：[`ruyut/TaiwanCalendar`](https://github.com/ruyut/TaiwanCalendar)，整理自政府資料開放平台「中華民國政府行政機關辦公日曆表」，透過 jsdelivr CDN 發布 JSON（`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/{year}.json`），已實測回應帶 `access-control-allow-origin: *`，前端可直接 `fetch`，不會撞 CORS。通常每年 6 月會釋出下一年度資料
- **即時查詢，不寫死年份清單**：`useTaiwanHolidays.ts` 內部把「整筆原始資料」（含 `isHoliday`／`description`）存進模組層級共用快取（同一年度只抓一次），對外提供四個函式：
  - `getDayOffLabel(date)`：回傳「這天放假的原因」——國定假日回傳假日名稱（例如「中秋節」）；純週末沒有 `description`，回傳「週六」/「週日」這種通用標籤（不是只顯示國定假日，週末也算，畫面上要看得出來是放假）；一般工作日回傳 `null`
  - `isWorkday(date)`：是否為工作日，`DateNav` 的「上一個工作日／下一個工作日」按鈕算 disabled 狀態用
  - `ensureYearLoaded(year)`：確保某年度資料已載入，回傳 `Promise`
  - `findNextWorkday(fromDate, direction)`：往前/往後找下一個工作日，`DateNav` 的「上一個工作日／下一個工作日」按鈕用這個。**這裡刻意用原始 `isHoliday` 欄位判斷（不是 `getDay()` 猜週末）**，因為 `isHoliday` 才正確涵蓋補班日的例外情形（補班的週六 `isHoliday` 會是 `false`），用星期幾去猜會在補班日誤判成放假。日期加減跟 `DateNav.vue` 的 `shift()` 一樣用 `src/utils/date.ts` 的 `addDays`（本地時間解析＋本地格式化），不要混用 UTC 解析或 `toISOString()`，會差一天
  - 查不到或請求失敗就靜默不顯示假日資訊／視為工作日，不影響其他功能，也不擋頁面
- **不在月曆彈窗格子內標色**：`NDatePicker` 沒有自訂格子樣式的介面，改用旁邊獨立的徽章表示，取捨紀錄見上方「`DateNav` 的日期選擇器」
- **色彩 token**：放假色預設 orange、今天剛好放假時改 yellow（規則見 [theme.md](theme.md) 的「放假色」），跟逾期的紅色、一般強調的藍色區分
- 本專案在瀏覽器執行期間會打「Apps Script 以外的第三方網址」的地方只有兩處：這裡的 jsdelivr CDN，以及 Google Fonts 字體（見 [theme.md](theme.md) 的字體段落），記錄於此避免之後忘記這些例外
