# 對話框、Toast 與工具選單

> 從 CLAUDE.md 拆出的細節。跨元件的規則（色彩 token、RWD、日期格式、手動同步清單）仍以 CLAUDE.md 為準。

- **確認對話框（`ConfirmDialog`）的按鈕配置照 Apple Human Interface Guidelines（Alerts）**（使用者決定，全站確認對話框統一）：
  - 取消在左、動作在右；按鈕文字用具體動詞（例如「刪除」「放棄變更」），不用「確定／是」
  - `danger`（破壞性動作）：動作按鈕用**紅色文字**（`--color-red-600`），不是紅色實心底；預設按鈕（粗體、開啟時取得焦點、按 Enter 觸發）是比較安全的「取消」，避免誤按就執行破壞性動作
  - 非 `danger`：動作按鈕是預設按鈕（主色實心底、取得焦點）
  - **開關動畫**：參照 `OptionsManagerModal` 桌面版的淡入＋輕微縮放（背景淡入、卡片 `scale(0.95)` → 1，0.2s）。`ConfirmDialog` 手機也是置中卡片，所以不分斷點都用這組，不套 `OptionsManagerModal` 手機的「由下滑入」。動畫 class 寫在 `ConfirmDialog` 自己的 scoped style，**使用端要用 `<Transition name="confirm-dialog">` 包住 `<ConfirmDialog v-if>`**（`HomeView`、`OptionsManagerModal`、`WorkItemForm` 三處都有包），新增使用的地方也要記得包；跟 `OptionsManagerModal` 一樣，根元素要宣告 `transition-duration`，Vue 才等得到離場動畫播完

**選項清單管理**：`OptionsManagerModal.vue`（獨立 Modal，非 Drawer——這是特意的選擇，因為這是「設定」性質的操作，跟日常填寫工作紀錄的 Drawer 表單在使用情境上不同，用不同呈現方式做區隔；ARIA 標記仍用 `role="dialog"` + `aria-modal="true"`，這是 Modal 在 ARIA 規範裡正確的技術寫法，ARIA 沒有 `role="modal"` 這個角色，跟元件命名是兩回事），`HomeView.vue` 已登入區塊的「工具」下拉選單裡的「選項清單」觸發，`isAuthorized` 才看得到入口。手機（< 768px）滿版全螢幕，跟 `WorkItemForm` 的 Drawer 手機行為一致；桌面置中卡片。開關動畫：手機從畫面下方滑入/滑出，桌面淡入＋輕微縮放（`Transition name="options-manager"`，套用在 `HomeView.vue` 的 `<OptionsManagerModal>` 外層）；元件內部第一層（選母項）↔ 第二層（調整內容）切換也有動畫，不是瞬間跳畫面（`Transition name="options-manager-layer" mode="out-in"`，寫在元件自己的樣板內，淡入淡出＋輕微左右位移，模擬「鑽進去/退出來」的導覽感）
- 第二層的值清單改成仿表格樣式：整份清單一個外框＋表頭列（「值」/「操作」）、列跟列之間用底線分隔，不是每個值各自一張獨立卡片（跟第一層選母項的卡片式大按鈕刻意做區隔，第一層是導覽入口用卡片按鈕合理，第二層是資料列表用表格排版比較符合資料呈現的慣例）
- **兩層式導覽，同一個 Modal 元件內切換兩種畫面**（不是兩支獨立元件）：第一層列出交辦單位／交辦人員／專案名稱／專案Repo 四個母項讓使用者先選一個（`selectedCategory` 為 `null`），選了之後同一個 Modal 換成第二層畫面只顯示該母項的內容（新增/重新命名/刪除），上方有「‹ 返回」回到第一層。這樣設計是因為一次把四個分類全部攤開會需要滾動很多次，改成一次只處理一個母項，畫面內容量固定、不會隨選項變多而需要一直滾動
- 支援新增／重新命名／刪除，重新命名/刪除都會先跳 `ConfirmDialog`（重新命名走行內編輯，刪除才跳確認對話框）
- **重要限制，UI 上有明顯提示**：重新命名/刪除只改「選項清單」分頁本身，**不會**回頭更新工作紀錄分頁裡已經寫入的歷史紀錄——交辦單位/人員/專案名稱/專案Repo 存在每筆工作紀錄上是純文字，不是跟這份清單做關聯查詢（ID 對應）的欄位，這是既有的資料模型設計（見 [sheet-schema.md](../sheet-schema.md)），管理選項清單不會改變這件事
- Apps Script 端：`handleAddOption_`／`handleRenameOption_`／`handleDeleteOption_`，新增（含新增/編輯工作紀錄時的 `addOptionIfNew_`）、重新命名、刪除都只動「選項清單」分頁該分類那一欄：`readOptionColumn_` 讀出整欄（去空白、去重複、轉文字），改完用 `writeOptionColumn_` 從第 2 列起連續寫回、下面多出來的舊儲存格清空，所以每一欄都是從上往下連續、不留空白——新值接在該欄最後一個值下面（不是整張分頁的最後一列），刪除時下面的值往上補（使用者決定）。不整列刪除，同一列其他分類欄位的值不受影響
  - **值一律當文字比對**（`optionKey_`：轉字串＋去前後空白）：Google Sheet 會把「11111」這類純數字自動轉成數字，直接用 `===`／`indexOf` 比對會對不上，曾造成同一個值重複新增、純數字的值刪不掉也改不了（「找不到這個值」）。寫回時儲存格設成純文字格式（`@`），「0123」這類值也不會被轉成數字
  - 舊版留下的空白格與重複值，用一次性函式 `compactOptionsSheet()` 整理，重複執行沒有副作用
- 前端 `useOptions.ts` 新增 `addOption`／`renameOption`／`deleteOption`，三個 action 的回應都帶回最新完整 `options`，直接覆寫本地快取，不用再多打一次 `fetchOptions()`
- 新增／重新命名／刪除失敗用 `AppToast` 顯示錯誤（不在 Modal 裡顯示紅字），Modal 維持原狀讓使用者重試；登入錯誤（`UNAUTHORIZED`）Modal emit `unauthorized`，`HomeView` 關閉 Modal 並登出。開啟時讀取選項清單失敗仍在 Modal 內顯示（使用者決定）


- **工具下拉選單**（使用者決定）：右上角已登入區塊原本的「選項清單」按鈕改成「工具」下拉按鈕（`NDropdown`，點擊開啟；按鈕旁的下拉箭頭是行內 SVG，圖形取自 Naive UI `NSelect` 內建的 ChevronDown，MIT 授權），裡面五項：
  - 「選項清單」：開 `OptionsManagerModal`（原本的功能）
  - 「本日總結」：開 `DaySummaryModal`，外觀、手機滿版、開關動畫比照 `OptionsManagerModal`（`Transition name="day-summary"`）。直接用畫面上那天已讀到的 `items`，不另外打 API。Textarea 可以先手動修改再複製，修改不存檔、不送後端，關掉重開恢復成產生的內容；Textarea 設 `overflow-wrap: anywhere`，很長、中間沒空白的英文或網址直接在字中間折行，不會整串被推到「- 」的下一行（只影響畫面折行，複製的文字不變）；「複製」用 `navigator.clipboard.writeText`，成功顯示 success Toast「已複製本日總結」，失敗顯示錯誤 Toast。整理後沒有任何紀錄時不顯示 Textarea，改顯示「這天沒有紀錄」
  - **本日總結文字規則**（`src/utils/day-summary.ts` 的 `buildDaySummary`，使用者決定）：
    - 排除請假（狀態 `休假`）與專案名稱「會議討論」（完全相同才排除）
    - 照項次排序後重新從 1 編號，每筆一段，段落之間不空行
    - 第一行「`N.標題`」（編號後面不空格）：有專案 Repo 就放 Repo（多個用逗號串，`AAA,BBBB`，同 Sheet 格式），工作目標**開頭**有單號就接在 Repo 後面（空一格）；沒有 Repo 放專案名稱，再沒有放工作目標（這兩種情況不加單號）。單號是「`#` 或 `T` 加 4–5 位數字」（`extractTaskCode`，例如 `#7902`、`T1234`，後面緊接著還有數字就不算）
    - 下面每一行是處理內容的一行，前面加「`- `」（略過空行；本身已經是「-」開頭的維持原樣）；沒有處理內容就只有第一行
    - 範例：`1.web-components-vue3/notify-message-recruit`／`- 即時通測試`／`2.release_source #7902`／`- 與 PM 確認工單內容`
  - 「匯出 Excel」：開 `ExportModal`，見 [export-excel.md](export-excel.md)
  - 「工時設定」：開 `WorkHoursSettingModal`，見 [work-hours.md](work-hours.md)
  - 「樣式」：子選單選 自動（依日出日落）／淺色／深色，見 [theme.md](theme.md)
