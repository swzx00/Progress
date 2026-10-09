# 測試

## 工具與指令

- **Vitest**（測試執行器，沿用 `vite.config.ts` 的設定與 `@/` 別名）＋ **Vue Test Utils**、**happy-dom**（元件測試）
- `npm run test`：watch 模式，改檔案自動重跑
- `npm run test:run`：跑一次全部（CI、commit 前用）

## 測試放哪裡、測什麼

| 位置 | 內容 |
|---|---|
| `src/utils/*.spec.ts`、`src/types/*.spec.ts` | 純函式單元測試：日期、工時換算、搜尋比對與標示、本日總結、近期推薦與預填、複製、匯出範圍與檔名、日出日落 |
| `src/validation/*.spec.ts` | 表單驗證：`shared/validation-schema.json` 的每條規則、請假規則、每日工時合計訊息 |
| `tests/apps-script/*.spec.ts` | 前後端一致性：在 Node 載入 `apps-script/Code.gs`，跟前端用同一組案例比對（見下方） |
| `src/components/*.spec.ts` | 元件測試：`WorkItemForm`（項次、送出、24 小時檢查、請假、複製、未儲存確認、預填、工作時段）、`ConfirmDialog`、`HighlightText` |
| `src/testing/fixtures.ts` | 測試用的假資料（`makeItem`／`makeRecent`），只覆寫測試在意的欄位 |

測試檔放在被測檔案旁邊（`work-hours.ts` ↔ `work-hours.spec.ts`），`describe`／`it` 用中文寫規則本身（例如「跨過整段午休，扣掉 1.5 小時」），跑測試的輸出就是一份規則清單。

## 慣例

- **改規則時 spec 一起改**：CLAUDE.md 裡「使用者決定」的規則，對應的測試案例就是那條規則的定義；規則改了測試會失敗，照新規則改測試，不要只改到測試通過
- **時區固定台灣**：`vitest.global-setup.ts` 把 `TZ` 設成 `Asia/Taipei`，日期相關的測試在 Windows 本機、UTC 的 CI 結果都一樣
- **元件測試只測元件自己的行為**：欄位連動、什麼時候查詢、送出的內容、確認對話框；換算、驗證的數字對不對交給單元測試。API（`useOptions`、`fetchDaySummary`）用 `vi.mock` 換成假的，`NSelect` 換成空殼，需要選值的情境改用「編輯既有紀錄」帶入
- 元件測試檔開頭加 `// @vitest-environment happy-dom`，其他測試跑在 Node，比較快

## 前後端一致性測試

`Code.gs` 有幾套規則是從前端手動同步過去的。`tests/apps-script/consistency.spec.ts` 用 `node:vm` 載入 `Code.gs`（頂層只有 `var` 與 `function`，不會呼叫 Apps Script 服務），比對：

- 常數：`VALIDATION_RULES` ↔ `shared/validation-schema.json`、`LEAVE_RULES`、`STATUS_OPTIONS`、每日工時上限、工時設定標準、近期紀錄天數、匯出天數上限、搜尋欄位與上限
- 函式（同一組案例跑兩邊，結果要相同）：`validateItem_` ↔ `validateWorkItem`／`validateLeave`、`dailyHoursError_` ↔ `dailyHoursMessage`、`validateWorkHours_` ↔ `validateWorkHoursSetting`、`matchesSearch_` ↔ `matchesSearch`

改 `Code.gs` 或前端任一邊，這裡失敗就代表另一邊忘了改。碰到 Sheet 的函式（讀寫、排序、項次寫入）測不到，部署後用實機測試清單手動驗證。

## 沒有自動測試的部分

- 真的 Apps Script 後端（會寫進真的 Sheet）：部署後手動驗證
- 版面、RWD、深色模式、實際截斷（`ClampText` 需要真的排版，happy-dom 量不到高度）：之後要做再評估 Playwright
