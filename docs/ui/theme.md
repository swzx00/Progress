# 色彩、字體與深色模式

> 從 CLAUDE.md 拆出的細節。跨元件的規則（色彩 token、RWD、日期格式、手動同步清單）仍以 CLAUDE.md 為準。

- 排版方向：A 版（商務簡潔風）——白底、細邊框表格，藍色系點綴，逾期用左側紅色標線＋小紅標籤提示
- 色彩管理：一律用 CSS 變數（design token），不寫死 hex，符合開閉原則；淺色、深色兩種模式共用同一組 token，見下方「深色模式」
- **色彩 token：統一用色階，不分用途**：`src/styles/tokens.scss` 只有一種 token，命名一律是 `--color-<色系>-<階>`（例如 `--color-blue-000`、`--color-black-100`、`--color-red-050`）。元件裡的文字、背景、邊框都直接挑色階使用，**不另外定義 text／surface／border 這類依用途命名的 token**（使用者決定：同一套色階好記、好挑，不想維護兩層命名）
  - **色值來源**：公司共用設計系統的 primitive 色階，完整檔案在 `D:\cheng\Documents\Project\recruitNew\recruitwebvue\assets\scss\_color.scss`（另一個專案的檔案，不在本 repo 內）。色系名稱對應：`Candidate-Blue` → `blue`、`1111-Black` → `black`（中性灰階）、`1111-Rose` → `red`（危險／錯誤）、`1111-Teal`／`1111-Green`／`1111-Yellow`／`1111-Orange` → `teal`／`green`／`yellow`／`orange`。不自己配色，需要新顏色時先從這份檔案的色階挑
  - 例外：`purple` 是推算的色階，不在設計系統裡（搜尋結果用），見 [search.md](search.md)
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
  - Naive UI（`App.vue` 的 `lightOverrides`／`darkOverrides`）會在 JS 裡運算顏色，吃不了 CSS 變數，只能寫 hex，每個值旁邊用註解標出對應色階：主色 `blue-500`、hover `blue-600`、pressed `blue-700`；錯誤色 `red-600`、hover `red-700`、pressed `red-800`；邊框 `black-100`。深色模式用 Naive UI 的 `darkTheme`，同樣的色階取深色模式下的值。改 `tokens.scss` 的色值時這裡要手動同步
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

- **深色模式**（使用者決定）：
  - **切換**：「工具 → 樣式」子選單，或標題旁的月亮／太陽按鈕（未登入也能用，圖示是目前套用的主題，Lucide `moon`／`sun`，ISC 授權），三選一：自動（依日出日落，預設）／淺色／深色，目前的選項前面打勾。選擇用 `localStorage`（`theme-mode`）記住，讀寫失敗就當作自動。`main.ts` 掛載前呼叫 `initTheme()`，第一個畫面就是正確的主題
  - **自動**：依台北的日出日落時間切換，日落後到日出前是深色。`src/utils/sun-times.ts` 用天文公式在瀏覽器裡算（演算法參考 SunCalc，BSD-2 授權），不打 API、不要定位權限；台灣各地差幾分鐘，所以地點固定台北。`useTheme` 用 `setTimeout` 排到下一次日出／日落再切換，分頁切回前景（`visibilitychange`）時也重算一次（背景分頁的計時器會被瀏覽器延後）
  - **套用方式**：`<html data-theme="light|dark">`。`tokens.scss` 在 `:root[data-theme='dark']` 底下重新定義同一組 token，每個色系的階數上下對調（`000`↔`1000`、`050`↔`900`、`100`↔`800`、`200`↔`700`、`300`↔`600`、`400`↔`500`），元件不用改：淺色模式當背景的淺色階變成深色、當文字的深色階變成淺色。也設 `color-scheme`，原生日期欄、捲軸跟著變深色。Naive UI 換成 `darkTheme`（見上方 `themeOverrides`）
  - **例外（B 版，使用者決定）**：`blue`／`orange`／`yellow`／`purple` 的 `000`、`050` 不對調，改用 `black` 的深色值（`#000`／`#141618`）。表格的今天／放假／搜尋在深色模式只靠表頭（`100`，等於原本的 `800`）與邊框帶色系，斑馬紋維持中性黑灰；手機卡片沒有表頭，只靠卡片外框區分
  - 實心按鈕（「＋ 新增」、搜尋按鈕等）的文字是 `black-000`，深色模式下是淺藍底＋黑字，不另外開不對調的例外 token
  - 寫死的半透明顏色：表單送出中的遮罩用 `color-mix(in srgb, var(--color-black-000) 70%, transparent)`，跟著主題變色；Modal 背景遮罩、陰影維持原本的 `rgb()`
  - 不受影響：匯出的 Excel 維持淺色
  - Google 登入按鈕跟著實際套用的主題（含「自動」算出來的結果）切換：淺色 `outline`、深色 `filled_black`。`HomeView` 監看 `isDark`，切換時呼叫 `useGoogleAuth` 的 `renderSignInButton(el, dark)`，先清空容器再重新 `renderButton`，不會重新初始化 GIS，也不影響登入狀態
