# 工作進度

「工作進度」列管系統：用網頁輸入、檢視每天的工作紀錄，資料存在 Google Sheet。

- 前端：Vue 3 + TypeScript + Vite，部署為 GitHub Pages 靜態站（部署流程尚未建立）
- 後端：Google Apps Script 網頁應用程式（`apps-script/Code.gs`），讀寫 Google Sheet
- 登入：Google 帳號登入，只有擁有者能新增／編輯／刪除，其他人是唯讀畫面

## 開始開發

需要 Node `>=24.1.0`（見 `.nvmrc`），只用 npm。

```bash
npm install
cp .env.example .env   # 填入 VITE_APPS_SCRIPT_URL、VITE_GOOGLE_CLIENT_ID
npm run dev            # 預設用 MSW 假資料；.env 設 VITE_ENABLE_MSW=false 改打真後端
```

其他指令：`npm run build`、`npm run lint`、`npm run lint:style`、`npm run format`。

架構、資料結構、UI 規格與開發慣例都寫在 [CLAUDE.md](./CLAUDE.md)。
