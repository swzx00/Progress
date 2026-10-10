# 搜尋欄

> 從 CLAUDE.md 拆出的細節。跨元件的規則（色彩 token、RWD、日期格式、手動同步清單）仍以 CLAUDE.md 為準。

- **搜尋欄**（使用者決定，`WorkItemSearch.vue`，規則集中在 `src/utils/search-work-items.ts`）：搜尋**全部資料**（跨日期），登入與唯讀畫面都有
  - **位置**：放在 `DateNav` 的 `search` slot，跟動作按鈕包在同一個 `date-nav__toolbar`。桌面、平板在動作按鈕左邊同一列，最大寬度跟日期切換（`date-nav__switcher`）一樣寬（`--switcher-width`：4 顆 32px 按鈕＋170px 日期選擇器＋4 個 8px 間距，改這幾個寬度時要一起改）；手機在動作按鈕和日期切換中間自成一列
  - **推薦選擇**（打字時）：只用瀏覽器裡已經有的小資料，不打 API——選項清單（交辦單位、交辦人員、專案名稱、專案 Repo）＋近期紀錄（`useOptions` 的 `recentItems`，近 30 天）的工作目標，第一次聚焦時呼叫 `fetchOptions`。包含關鍵字的值（不分大小寫），開頭就符合的排前面，最多 8 筆（`buildSuggestions`），每筆左邊標分類、符合的那段 `blue-700` 粗體；清單第一項固定是「全部欄位｜搜尋「關鍵字」」。上下鍵移動、Enter 送出（沒選推薦就是搜尋全部欄位）、Esc 先關推薦，推薦已關時清除搜尋
  - **搜尋結果**（按 Enter、搜尋按鈕或點推薦才查）：打後端 `doGet type=search`（`useWorkItems.ts` 的 `searchItems`），每次大約 1–2 秒
    - 一般搜尋：交辦單位、交辦人員、專案名稱、專案 Repo（`#AAA` 或 `AAA` 都找得到）、工作目標、處理內容、狀態；不分大小寫，空白隔開的每個關鍵字都要出現（AND）
    - 點推薦只搜那個欄位：交辦單位／交辦人員／專案名稱完全相同；專案 Repo 包含那一個；工作目標包含那段文字（同一件工作的目標常會多寫幾個字）
  - **結果呈現**（`HomeView` 的 `searchQuery`／`searchResult`）：表格換成搜尋結果，上方一行「搜尋結果：專案名稱「官網改版」，共 N 筆」＋「結束搜尋」；超過 200 筆加註「只顯示最新的 200 筆」。`WorkItemTable` 的 `search-mode`：照傳進來的順序（工作日期新的在前）、項次欄換成工作日期（`--index-col` 從 32px 加寬成 84px；手機卡片在最上面一行），點日期 emit `goToDate` 跳到那天並結束搜尋；不顯示拖曳把手與上移／下移，編輯、複製、刪除照常（存檔、刪除、複製本日後重新搜尋一次，`refreshAfterChange`）；不套今天／放假的底色
  - **標示符合的字**（使用者決定，只在 `search-mode`）：`WorkItemTable` 收 `search-keyword`／`search-field`，每個欄位的文字用 `utils/search-work-items.ts` 的 `highlightTerms`＋`splitHighlight`（Repo 標籤用 `splitRepoHighlight`）切成片段，由 `HighlightText.vue` 逐段渲染，符合的包在 `<mark class="highlight-text__match">`：底色 `yellow-100`（purple 的相對色系）＋粗體 `purple-900` 文字，不加底線（使用者決定），請假、逾期列也一樣，深色模式跟著 token 換色。選階：紫字對黃底兩種模式都要 ≥ 4.5:1；`yellow-050` 在深色模式是 black（B 版例外）看不出底色，所以最淺用 `yellow-100`，配它只有 `purple-900` 兩種模式都過（淺色 13.12:1、深色 4.88:1）。搜尋摘要列（`home-view__search-summary`）裡的關鍵字也是粗體。**不用 `v-html`**（使用者輸入的內容不能當 HTML），保留換行，不影響 `ClampText` 的截斷判斷與「…展開」排版；tooltip 全文不標示
    - 一般搜尋：所有被搜尋的欄位（交辦單位、交辦人員、專案名稱、專案 Repo 標籤、工作目標、處理內容、狀態）標出每個關鍵字（空白隔開、不分大小寫，重疊的範圍合併）；Repo 用畫面上的 `#AAA` 比對，搜「#AAA」連 # 一起標、搜「AAA」只標名稱
    - 點推薦（單一欄位）：只標示那個欄位，整段關鍵字當一個詞；Repo 是完全相同，只標那一個標籤，名稱只是部分相同的其他標籤不標
  - **狀態**：搜尋中 `AppLoading`「搜尋中…」；錯誤顯示訊息＋「重新載入」（用同一組條件再搜尋一次）；沒有符合時表格空狀態「找不到符合「關鍵字」的紀錄」。連續搜尋只採用最後一次的結果
  - **色系：purple**（使用者決定），階數比照今天：表頭 `purple-100`、斑馬紋 `purple-050`／`purple-000`、邊框 `purple-200`、工作日期連結與「展開／收合」`purple-700`（滑過 `purple-800`）、展開列底 `purple-100`／框 `purple-300`；搜尋摘要列 `purple-700` 字、不加底色（使用者決定）；空狀態 `purple-700` 字＋`purple-000` 底。請假、逾期的列照常用自己的 teal／red。`purple` 不是設計系統原有的色階：色相取舊版 `--Purple`（薰衣草），每一階的深淺（OKLab 明度）對齊 `1111-Purple` 同一階推算出來（使用者決定），見 `tokens.scss` 的註解
  - 顯示搜尋結果時（`DateNav` 的 `searching` prop），`DateNav` 只留搜尋欄：日期切換、放假徽章／工時合計／今天、動作按鈕都不顯示（使用者決定，搜尋結果跨日期，跟選到的那天無關）
  - 清空搜尋欄（✕、Esc 或自己刪光）、按「結束搜尋」、點工作日期都會回到單日表格
