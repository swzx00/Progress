# WorkItemForm（新增／編輯表單）

> 從 CLAUDE.md 拆出的細節。跨元件的規則（色彩 token、RWD、日期格式、手動同步清單）仍以 CLAUDE.md 為準。

- **表單（`WorkItemForm.vue`）的項次欄**：跟「工作日期」放在同一行（項次是右側窄欄），只負責顯示。**刻意不用 `<input>`**，改用外觀模仿停用輸入框的 `<div class="work-item-form__readonly">`（灰底灰框），不是表單控制項，使用者無從輸入（使用者決定）；沒有值時顯示淡灰色的「項次」當 placeholder。就算用開發者工具改了畫面上的數字也影響不到 Sheet：送出的資料不含項次，後端也會忽略前端送來的值
  - 編輯且工作日期沒改：顯示這筆紀錄目前的項次
  - 新增，或編輯時把工作日期改到別天：顯示那天的預計項次（`fetchDaySummary`，同一次查詢也算出當天其他紀錄的工時合計，沿用 `doGet` 的 `date` 查詢自己算，不另開 API、不影響表格的 `items`）；查詢中或失敗時留空（顯示 placeholder），不擋存檔。連續改日期只採用最後一次查詢的結果
  - 預計項次只是參考值，實際項次由後端寫入當下決定（中間若有其他新增，號碼可能較大）
- 表單欄位順序：工作日期／項次 → 交辦單位／交辦人員 → 專案名稱 → 專案 Repo → 工作目標 → 處理內容 → 今日工時 → （工作時段，有工時設定才有）→ 完成度 → 預計期限 → 狀態；請假是 工作日期／項次 → 假別 → 請假時數 → （請假時段）→ 備註
- **表單欄位規格**（使用者定案；規則數值以 `shared/validation-schema.json` 為準）：

  | 欄位 | 必填 | 預設 | placeholder | 限制 |
  |---|---|---|---|---|
  | 工作日期 | ✅ | DateNav 選到的那天（`HomeView` 傳 `default-date`） | 請選擇工作日期 | 年份 2020–2099 |
  | 交辦單位／交辦人員／專案名稱 | ✅ | — | 請選擇交辦單位／交辦人員／專案名稱 | ≤ 50 字 |
  | 專案 Repo | 選填 | — | 請選擇專案 Repo (選填) | 每個 ≤ 50 字、最多 10 個、不可含逗號（Sheet 用逗號串成一格存） |
  | 工作目標 | ✅ | — | 請填寫工作目標 | ≤ 500 字（textarea） |
  | 處理內容 | 選填 | — | 請填寫處理內容 | ≤ 2000 字（textarea） |
  | 今日工時 | 選填 | 0 | 請填寫今日工時 | 0–24，`step` 0.25；清空送出時用 0；當天所有紀錄合計不可超過 24 小時（前後端都擋） |
  | 完成度 | 選填 | 0 | 請填寫完成度(%) | 0–100，`step` 0.25；清空送出時用 0 |
  | 預計期限 | 選填 | — | 請選擇預計期限 | 年份 2020–2099 |
  | 狀態 | ✅ | 待辦（編輯舊資料狀態為空時也帶待辦） | 請選擇狀態 | 固定選項，不可清除 |

  - 日期欄維持原生 `<input type="date">`（使用者決定，手機用系統原生滾輪）：原生日期欄會忽略 `placeholder`，空白時顯示的是瀏覽器自己的「年／月／日」，所以「預計期限」的 placeholder 實際上看不到，屬已知限制
  - 送出時文字欄位去掉前後空白
  - **選項清單載入中／失敗**（使用者決定）：交辦單位、交辦人員、專案名稱、專案 Repo 的選項是打開表單時才讀（`useOptions` 的 `fetchOptions`），真後端慢的時候清單會是空的。這四個 `NSelect` 在載入中時設 `loading`（欄位右側轉圈），打開下拉時 `empty` slot 放 `OptionsDropdownState`：轉圈（`AppLoading`）＋下方「選項載入中」；讀取失敗時顯示「選項清單載入失敗」＋「重新載入」（再呼叫一次 `fetchOptions`）。只在載入中或失敗時才放這個 slot，載入完成後沒有符合的選項時維持 Naive UI 原本的空狀態；可輸入新值（`tag`）的功能載入中照常可用
  - **表單的推薦與預填**（使用者決定，規則集中在 `src/utils/recent-history.ts`）
    - **資料來源：近期紀錄 `recentItems`**
      - 後端 `getRecentItems_` 撈近 `RECENT_DAYS`（30）天的紀錄：工作日期 ≥ 今天往前 30 天（同樣只先讀工作日期欄），排除請假與已刪除。只回傳推薦／預填用得到的欄位（id、工作日期、項次、交辦單位、交辦人員、專案名稱、專案 Repo、工作目標、預計期限、完成度、狀態），跟著 `doGet type=options` 一起回傳，不多打 API
      - 後端只負責撈資料，「最近一筆」怎麼找、怎麼推薦都在前端；天數與排除請假的規則前端 `RECENT_DAYS`／`filterRecentItems` 跟 `Code.gs` 要一致（手動同步），MSW 用 `filterRecentItems`
      - 前端 `useOptions` 的 `recentItems` 保存（工作日期、預計期限轉成 `YYYY-MM-DD`），跟選項清單一樣一個工作階段只讀一次
      - 存檔成功後 `HomeView` 呼叫 `rememberItems` 補上剛存的紀錄（`upsertRecentItems`）：編輯帶 id、取代原本那筆；新增、複製本日沒有 id，直接加入；請假略過。所以不用重新整理就能推薦／預填剛存的內容
      - 舊版後端沒有 `recentItems` 時視為空陣列：沒有推薦、不預填，表單照常可用
    - **「最近一筆」的定義**：工作日期新的優先，同一天項次大的優先；剛存檔、還沒有項次的視為當天最新
    - **下拉推薦**（交辦單位 ↔ 交辦人員、專案名稱 ↔ 專案 Repo）：已選了一邊，打開另一邊的下拉時，把最近一筆搭配的值排在最上面並 highlight，其餘照原本順序、不重複出現。只推薦、**不自動填入**
      - 已選交辦單位 → 交辦人員：交辦單位相同的最近一筆的交辦人員（`recentAssignee`）；反過來已選交辦人員 → 交辦單位（`recentUnit`）
      - 已選專案名稱 → 專案 Repo：專案名稱相同的最近一筆的 Repo，可能有多個，**全部**推薦（`recentRepos`）
      - 已選專案 Repo → 專案名稱：Repo 包含已選的**任一個**的最近一筆的專案名稱（`recentProject`）
      - 推薦的值必須還在選項清單裡才顯示（從選項清單刪掉的值不推薦）
      - 呈現：淡藍 `blue-050` 底＋右側 `blue-100` 底／`blue-700` 字的「最近」膠囊標籤。`WorkItemForm` 的四個 `*Options` computed 用 `withRecentFirst` 排序、`markRecent` 加 class 畫底色；標籤用 `NSelect` 的 `render-option` 在選項外包一層加上，**不用 `render-label`**（它也會套用到輸入框裡已選的值，選了推薦值時輸入框會跟著出現「最近」）。下拉選單 teleport 到 body，不吃 scoped 樣式，這幾個 class 用 `:global` 寫；底色畫在 Naive UI 選項自己的 `::before` 上，滑過、已選取時維持 Naive UI 原本的顏色
    - **填完工作目標後預填**（`WorkItemForm` 的 `prefillFromTarget`）
      - 只在**新增工作項目**時；編輯、單項複製、請假都不預填
      - 時機：工作目標輸入框離開焦點（blur），不是每打一個字就觸發
      - 找哪一筆：近期紀錄裡工作目標「相同」的最近一筆（`recentByTarget`）。相同的定義（`targetKey`）：工作目標開頭有單號（`#` 或 `T` 加 4–5 位數字，同本日總結的 `extractTaskCode`）就比單號，例如「#12345 登入頁」與「#12345 登入頁修正」算同一筆；沒有單號才比整段文字（去前後空白）。找不到就什麼都不做
      - 帶入規則（不會蓋掉使用者已經填的值）：
        - 預計期限：表單還是空白、來源有值才帶入
        - 完成度：表單還是 0（或清空）、來源不是 0 才帶入
        - 狀態：表單還是預設的「待辦」、來源不是待辦且在固定選項內才帶入
        - 交辦單位、交辦人員：兩個**都空**才一起帶入，填了其中一個就都不動
        - 專案名稱、專案 Repo：兩個**都空**才一起帶入，規則同上
      - 有帶入任何欄位，就在工作目標下方用 `blue-700` 小字提示「已依 YYYY/MM/DD 的紀錄帶入：預計期限、完成度…」（`work-item-form__hint`，`role="status"`）；表單重設時清掉。預填會讓表單跟打開時的快照不同，關閉時照常跳「要放棄變更嗎？」
      - 推薦與預填的關係：預填是直接寫入欄位；下拉推薦只排序、不寫入。預填後打開下拉，仍會依已填的值顯示推薦
  - **單選 `NSelect` 的 placeholder**：`NSelect` 只有值是 `null` 時才顯示 placeholder，空字串會被當成「選了一個空的值」而不顯示。表單內部（驗證、送出、快照比對）維持用空字串代表「沒選」，交辦單位／交辦人員／專案名稱／狀態綁定 `NSelect` 時經過 `selectModel()` 這層 computed 互轉（`'' ↔ null`）；多選的專案 Repo 是空陣列，本來就正常
  - 必填欄位的名稱後面加紅色「＊」（`--color-red-600`，`aria-hidden`），是否顯示由 `isRequired(field)` 讀 schema 的 `required` 決定，不寫死在 template；欄位名稱跟＊包在 `.work-item-form__label` 裡（label 是 flex column，不包的話＊會被擠到下一行）

- **每日工時上限**：`DateNav` 的「今日工時合計：Xhr」文字不變，合計**超過** 8 小時（`shared/validation-schema.json` 的 `dailyHours.warn`，`DateNav.vue` 透過 `DAILY_HOURS_WARN` 讀取，剛好 8 不算）才加上 `date-nav__total--over`：只把文字換成紅色 `--color-red-700`，不加粗、不用膠囊框（使用者決定）。合計**超過** 24 小時（`dailyHours.max`）不能存：`WorkItemForm` 用 `fetchDaySummary` 查當天其他紀錄（編輯時排除自己）的工時合計 `otherHours`，加上本筆超過就在今日工時（請假時數）欄位顯示錯誤「當天工時合計不可超過 24 小時（其他紀錄已 X 小時，已超出Y小時）」（使用者決定；前端 `dailyHoursMessage`、`Code.gs` 的 `dailyHoursError_`、MSW 三處格式相同，數字四捨五入到小數兩位避免浮點誤差）。送出前前端一定先算出當天合計再決定是否放行：`otherHours` 還沒查到（查詢中或先前失敗）就在 `onSubmit` 當場再查一次（期間「儲存」按鈕顯示「檢查中…」並停用，用表單自己的 `checkingDayHours`，不動父層的 `saving`），查不到就擋下並在今日工時欄位提示「無法確認當天工時合計，請稍後再試」；剛好 24 可以存。後端也檢查（`Code.gs` 的 `handleCreate_`／`handleUpdate_` 寫入前也檢查；編輯時用新的工作日期算、排除自己）

- **表單驗證**（`src/validation/work-item.ts` 的 `validateWorkItem`）：`<form novalidate>` 關掉瀏覽器內建驗證，全部欄位統一走自訂驗證（交辦單位、狀態等是 `NSelect`，不是原生欄位，內建 `required` 檢查不到）
  - 第一次按「儲存」才開始顯示錯誤；之後每次修改即時重新驗證，修正後錯誤馬上消失
  - 錯誤呈現：欄位下方紅字（`--color-red-600`）＋欄位框變紅（原生欄位用 `.work-item-form__field--invalid`，`NSelect` 用 `status="error"`），並捲動到第一個錯誤欄位、聚焦其中的輸入框
  - textarea 另外設了 `maxlength`，打字時就擋在上限，不用等送出
  - **textarea 高度自適應**（使用者決定）：工作目標、處理內容（含請假備註）用 `src/directives/auto-resize.ts` 的 `v-auto-resize`，高度跟著內容長高、縮回，最小維持 `rows="2"`，沒有上限（Drawer 本身會捲動），因此拿掉手動拉高（`resize: none`）。輸入、帶入資料（元件重新渲染）、寬度改變（`ResizeObserver`，只在寬度變時重算）都會重新計算
- **儲存失敗的處理**（`HomeView.vue` 的 `onSave`／`handleSaveError`）：不在頁面上顯示錯誤文字，一律用 `AppToast` 顯示錯誤訊息
  - 登入錯誤（前端沒有 `idToken`，或後端回 `code: 'UNAUTHORIZED'`，例如 token 過期）：關閉 `WorkItemForm` Drawer 並執行 `signOut()`，畫面回到唯讀模式並顯示登入按鈕
  - 其他錯誤（欄位驗證失敗、找不到紀錄、網路錯誤等）：Drawer **維持開啟**、保留已填內容，維持登入狀態，讓使用者修正或等網路恢復後直接重送（使用者決定）
  - Toast 規格：畫面上方置中（不擋手機底部操作區），一次只顯示一則、新的取代舊的，4 秒自動消失，有關閉按鈕；`z-index: 200` 疊在 Drawer／Modal（`100`）之上；外層 `aria-live` 區域常駐、內容用 `role="alert"`（success 用 `role="status"`），螢幕閱讀器才唸得出來。`showToast(message, type)` 的 `type` 預設 `error`（紅色）；`success`（綠色 `green-800` 文字、`green-000` 底、`green-200` 框，圖示 ✓）用在「複製本日」完成、本日總結「複製」成功、匯出 Excel 完成、工時設定儲存／清除成功（使用者決定保留）。手刻元件，不用 Naive UI 的 message（照「UI 元件庫」原則，只有自己刻成本高的元件才用 Naive UI）
  - 刪除工作紀錄失敗（`HomeView` 的 `confirmDelete`）比照儲存：用 Toast 顯示錯誤；登入錯誤關閉確認對話框並登出，其他錯誤確認對話框維持開啟，可以直接重試或取消。選項清單管理的錯誤也用 Toast（見 [dialogs.md](dialogs.md) 的「選項清單管理」）

- **表單關閉前的未儲存確認**：`WorkItemForm` 打開時存一份欄位快照，「✕」「取消」、點背景三個關閉入口都走 `requestClose()`，跟快照比對有差異才跳 `ConfirmDialog`（「要放棄變更嗎？」，按鈕「繼續編輯」／「放棄變更」），沒差異（含改了又改回原值）直接關閉。存檔成功、登入錯誤強制關閉是 `HomeView` 直接關，不經過這個確認
  - **關閉順序**：按「放棄變更」時先關確認對話框，等它的離場動畫播完（`Transition` 的 `@after-leave`）才 `emit('cancel')` 關表單；不能同時關，否則表單滑出時會把還沒消失的對話框一起帶走，順序看起來是反的（使用者要求）
- **表單送出中（`saving`）防止重複送出**（使用者要求）：兩層一起做，不互相取代
  - 滿版 Loading 遮罩：`saving` 時在 `WorkItemForm` 最上層蓋 `.work-item-form__loading-mask`（半透明白，中間 `<AppLoading label="儲存中…" />`），擋住所有點擊；Toast（`z-index: 200`）仍在遮罩上方，存檔失敗看得到訊息
  - 欄位與按鈕本身也停用：所有原生欄位、`NSelect`、「✕」「取消」「儲存」都綁 `:disabled="saving"`（遮罩擋不住鍵盤，停用才能擋 Tab／打字）；`onSubmit()`、`requestClose()` 開頭也檢查 `saving`，點背景關閉（`div` 無法 disabled）靠後者擋
  - 存檔失敗 `saving` 變回 false，遮罩消失、欄位恢復可編輯，已填內容保留
  - 狀態名稱維持 `saving` 不改成 `pending`（使用者確認）：表單只有「儲存」一種非同步操作，名稱越具體越好讀
