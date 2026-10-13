# 開發工具鏈

> 從 CLAUDE.md 拆出的細節。跨元件的規則（色彩 token、RWD、日期格式、手動同步清單）仍以 CLAUDE.md 為準。

**開發工具鏈**：
- **ESLint**（flat config，`eslint.config.js`）：`eslint-plugin-vue` + `@vue/eslint-config-typescript`，`npm run lint` 檢查程式碼品質（未使用變數、type 錯誤等）
- **Prettier**（`.prettierrc.json`）：有分號、單引號、printWidth 100，`endOfLine: auto`（維持檔案原本的換行字元：Windows 上 `core.autocrlf=true`，工作目錄是 CRLF、repo 是 LF，不設的話 Prettier 預設要求 LF，整個專案都會被報格式錯誤），`npm run format` 格式化；透過 `@vue/eslint-config-prettier` 關掉與 ESLint 衝突的樣式規則，兩者分工不重疊
- **Stylelint**（`stylelint.config.js`）：檢查 `.css`／`.scss`／`.vue` 的 `<style>`，`npm run lint:style` 檢查並自動修復。設定組合：
  - `stylelint-config-standard-scss`：SCSS 通用規則（顏色函式寫法、空行、重複屬性等）
  - `stylelint-config-recommended-vue/scss`（搭配 `postcss-html`）：讓 Stylelint 讀得懂 `.vue` 裡的 `<style>`
  - `stylelint-config-recess-order`：**屬性排序**，依「定位 → 盒模型 → 文字 → 外觀」分組排列，可自動修正
  - 自訂覆寫：`selector-class-pattern` 改成允許 **BEM**（`block__element--modifier`，各段 kebab-case），這是專案既有的 class 命名慣例；`media-feature-range-notation: 'prefix'` 維持 `@media (min-width: 768px)` 寫法（預設會改成 `(width >= 768px)`），跟下方「RWD 斷點」的慣例一致
  - Stylelint 16 起已移除所有排版類規則，排版全交給 Prettier，兩者不會互相打架
- **VS Code 存檔自動整理**（`.vscode/settings.json`，有進版控；`.vscode/extensions.json` 推薦安裝 Prettier、Stylelint 擴充套件）：存檔時先跑 Stylelint 自動修復（含屬性重排，`source.fixAll.stylelint`），再用 Prettier 排版（`editor.formatOnSave`）。關掉 VS Code 內建的 CSS/SCSS 檢查，避免跟 Stylelint 重複報錯；Markdown 不在存檔時自動排版（避免 CLAUDE.md 這類文件被大量重排）
- **`.editorconfig`**：管編輯器層級的基本排版（縮排、換行符、結尾換行等）
- **建置拆檔**：`vite.config.ts` 的 `build.rolldownOptions.output.codeSplitting.groups` 把第三方套件拆成 `vendor-vue`／`vendor-naive-ui`／`vendor-naive-ui-deps`／`vendor-sortable`／`vendor-exceljs`，避免單一檔案超過 500 kB 的建置警告，套件沒升級時檔名不變、瀏覽器可沿用快取。Vite 8 底層是 Rolldown，`manualChunks` 已棄用，要用 `codeSplitting`；群組預設會把相依一起收進去，所以用 `priority` 讓 Vue、Naive UI 的相依套件先被各自的群組認領。新增大型套件時記得看 build 輸出的檔案大小
  - `vendor-exceljs`（ExcelJS，匯出 Excel 用）約 930 kB，是套件本身預先打包好的單一檔案，拆不開，所以 build 仍會出現超過 500 kB 的警告；它只在按「匯出」時用動態 `import()` 載入，不在 `index.html` 的預載清單裡，一般瀏覽不會下載
- **`npm audit`**：剩下的 high 都是開發工具（Stylelint、ESLint 的 TypeScript 設定）間接用到的 `braces`（GHSA-vfj7-8cjw-p6xm），目前最新版 3.0.3 仍在受影響範圍、沒有修正版，`npm audit fix --force` 只會把工具鏈降版，不要執行；只影響本機開發工具，不會打包進正式站。有修正版之後再跑 `npm audit fix`
- **固定埠號**（使用者決定，2026-10-13）：`npm run dev` 固定用 **5310**（`vite.config.ts` 的 `server.port`＋`strictPort: true`），e2e（`playwright.config.ts`）用 **5320**。Google 登入的「已授權的 JavaScript 來源」要協定、網域、埠號完全一樣、不支援萬用字元；Vite 預設 5173 被別的專案佔用時會自動換成 5174、5175…，登入就會出現「已封鎖存取權：授權錯誤」。所以每個專案固定一個埠號，在 Google Cloud Console（API 和服務 → 憑證 → OAuth 用戶端 → 已授權的 JavaScript 來源）登記一次 `http://localhost:5310`；`strictPort` 讓埠號被佔用時直接報錯，不會偷偷換掉。選號避開常見工具的預設埠號（3000、4173、4200、5000／7000（Mac AirPlay）、5173～5179（Vite）、6006、8000、8080 等）；其他專案可以照這個方式各挑一個（例如 5330、5340）
- **路徑別名**：`@/` 對應 `src/`（`vite.config.ts` 的 `resolve.alias` + `tsconfig.app.json` 的 `paths` 都要同步設定），避免元件一多之後出現 `../../../components/xxx` 這種難維護的相對路徑
- **Node 版本**：鎖定 `>=24.1.0`（`.nvmrc`、`package.json` 的 `engines`），並用 `.npmrc` 的 `engine-strict=true` 讓版本不符時直接擋下 `npm install`，避免換機器開發版本不一致
- **套件管理工具**：僅使用 npm（`package.json` 的 `packageManager` 欄位已鎖定），不要混用 yarn/pnpm，避免 lockfile 衝突
- **樣式語言**：採用 **SCSS**，元件的 `<style>` 一律加 `lang="scss"`（`<style scoped lang="scss">`），需要安裝 `sass` 作為 devDependency
- **UI 元件庫**：以自訂元件為主，僅在「可搜尋下拉選單／多選標籤／日期選擇」這類自己刻成本高的互動元件才用 **Naive UI**（目前用到 `NSelect`、`NDatePicker`、`NTooltip`（文字刪節的全文提示）、`NDropdown`（右上角「工具」下拉選單））。主題色透過 `App.vue` 的 `<n-config-provider :theme-overrides>` 對齊 `tokens.scss` 的色階（見 CLAUDE.md 的「色彩 token」）；同一個 `n-config-provider` 也帶入 `zhTW`/`dateZhTW` 兩個 locale（`:locale`/`:date-locale`），讓 Naive UI 元件顯示繁體中文。`NDatePicker` 的 `:first-day-of-week="6"` 讓月曆以星期日為一週第一天——這個 prop 的數值語意不直觀，**不是** date-fns 的 `getDay()`（星期日＝0）對應值：實測 naive-ui 內部排陣列的演算法後，`firstDayOfWeek=6` 才會排出「日一二三四五六」，`zhTW` locale 預設的 `firstDayOfWeek: 0` 反而是「一二三四五六日」（星期一開頭），所以這裡要明確覆寫、不能依賴 locale 預設值。其餘元件維持手刻 + CSS token，不整套套用 Naive UI 的視覺風格
- **拖曳排序**：用 `vue-draggable-plus`（SortableJS 的 Vue 3 包裝）做表格資料列的拖曳，只用在「項次調整」，見 [work-item-table.md](ui/work-item-table.md)
