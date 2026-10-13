# Apps Script API

> 從 CLAUDE.md 拆出的細節。跨元件的規則（色彩 token、RWD、日期格式、手動同步清單）仍以 CLAUDE.md 為準。

**doGet(e)**
- 接受 `date` 參數（`YYYY/MM/DD`，例如 `2026/09/17`，見上方「日期欄位格式」），後端從工作紀錄分頁讀出當天且「已刪除≠TRUE」的列
- 額外支援 `type=options` 讀取「選項清單」分頁，回應 `{ options, recentItems, workHours }`：`recentItems` 是近 30 天的近期紀錄（`getRecentItems_`），給表單的下拉推薦與預填用，見 [work-item-form.md](ui/work-item-form.md) 的「表單的推薦與預填」；`workHours` 是工時設定（`getWorkHours_`，`{ start, end, breakStart?, breakEnd? }`，沒設定或設定不合法時 `null`），見 [work-hours.md](ui/work-hours.md)
- 額外支援 `type=range&from=YYYY/MM/DD&to=YYYY/MM/DD`（`handleRange_`），讀出 from～to（含頭尾）的未刪除紀錄（含請假），回應 `{ items }`，給前端「匯出 Excel」用。沿用 `readRowsByDate_`，傳入範圍判斷函式（`YYYY/MM/DD` 補零固定長度，字串可直接比大小），一樣只先讀工作日期一欄。檢查日期格式（含 2/30 這類不存在的日期）、from ≤ to、跨度上限 366 天（`RANGE_MAX_DAYS`），不合格回 `{ error }`。公開讀取、不需登入，同上
- 額外支援 `type=search&q=關鍵字[&field=欄位]`（`handleSearch_`），讀整張工作紀錄分頁找出符合的未刪除紀錄（含請假），給前端搜尋欄用，回應 `{ items, total }`：照「工作日期新的在前、同一天照項次」排序，最多回傳 `SEARCH_MAX_RESULTS`（200）筆，`total` 是全部符合的筆數。比對規則（`matchesSearch_`）跟前端 `src/utils/search-work-items.ts` 的 `matchesSearch` 手動同步，見 [search.md](ui/search.md)。關鍵字不可空白、上限 `SEARCH_KEYWORD_MAX`（100）字，`field` 只接受 `SEARCH_FIELDS`，不合格回 `{ error }`。公開讀取、不需登入
- 開放給所有人呼叫（不需登入），供公開檢視頁使用；11 個業務欄位公開檢視頁全部顯示，沒有欄位白名單問題（機敏疑慮是「帳密/token 不能出現在 repo」層級，不是欄位層級——這點已用 Google 登入驗證解決）

**前端登入實作**：`useGoogleAuth.ts` 串接 Google Identity Services（GIS）——動態載入 GIS 腳本、`google.accounts.id.renderButton` 顯示官方登入按鈕。前端額外維護一份**允許清單陣列**（目前只有 `swzx00@gmail.com`，之後要加人直接改陣列），`isAuthorized` = 有登入 && email 在清單裡；未登入或不在清單裡都只能看唯讀畫面，管理功能（新增/編輯/刪除）整個不會渲染出來。這是前端體驗層的把關，**不能取代後端驗證**——後端還是要照下面 `doPost` 的規則再驗一次，因為前端程式碼是公開的，理論上可以被繞過。

**不自動登出**（使用者決定，2026-10-12）：
- **ID Token 只放記憶體**，不存 `localStorage`／`sessionStorage`（存在瀏覽器儲存空間有被網頁程式讀走的風險，而且 `swzx00.github.io` 底下的其他網站共用同一份）。載入時會清掉舊版存在 `sessionStorage` 的 `google_id_token`／`google_id_token_skew`
- **長期記住登入交給 Google**：GIS 用 `auto_select: true`（Chrome 走 FedCM，`use_fedcm_for_prompt: true`）初始化，需要 token 時呼叫 `google.accounts.id.prompt()`，Google 看自己在 `accounts.google.com` 的 HttpOnly Cookie 確認是本人就直接給新 token，不用點
- **重新整理、重開分頁時自動登入**（`tryAutoLogin`，`HomeView` 掛載時呼叫）：只有 `localStorage` 有 `progress:auto-login` 標記（值 `'1'`，登入成功時寫入，**不是憑證**）才嘗試，沒有的話（路過看唯讀畫面的人、按過登出）不跳 Google 的登入提示
- **背景續期**（`refreshLogin`）：拿到 token 後排計時器，到期前 5 分鐘自動續期；分頁切回來（`visibilitychange`）時 token 快過期也續期（電腦睡眠喚醒後計時器可能沒觸發）。同時有多個續期只呼叫一次 `prompt()`；`isNotDisplayed`／`isSkippedMoment`／`isDismissedMoment` 或 15 秒沒回應都算失敗；GIS 腳本還沒載入直接算失敗，不卡畫面
- **開表單、對話框前**（`ensureFreshLogin`，非同步）：還沒過期直接通過；過期了（看 JWT 的 `exp`，提早 1 分鐘；本機時鐘不準時用 `iat` 算出時間差校正）先續期，拿到新 token 就照常開，拿不到才回到唯讀並提示「登入已過期，請重新登入」。沒有 `exp` 或解不開時交給後端判斷。調整順序是先在畫面套用新順序再檢查，續期失敗才還原
- **寫入被後端以 `UNAUTHORIZED` 退回**（`withLoginRetry`，新增、編輯、刪除、複製本日、調整順序、選項清單、工時設定、本日總結的自動填入設定與「填入」都包）：先續期，拿到新 token 就重送一次；後端是先驗證登入才寫入，被退回的請求一定還沒寫進去，重送不會重複寫入。續期失敗才照原本的方式關閉畫面、回到唯讀
- **兩種登出**：使用者按「登出」（`signOut`）清掉 token、拿掉 `progress:auto-login` 標記並 `disableAutoSelect()`，之後要自己點登入；登入失效（續期失敗、`UNAUTHORIZED`，`clearLogin`）只清掉 token，保留自動登入，下次重新整理還能自動登入回來
- **限制**（Google、瀏覽器的規定）：瀏覽器要登入著 Google 而且之前在這個網站同意過登入；FedCM 兩次自動登入至少隔 10 分鐘（10 分鐘內連續重新整理兩次，第二次要點登入）；無痕模式、關閉第三方登入或 FedCM 的瀏覽器自動登入會失敗，維持唯讀畫面、右上角照常有登入按鈕
- e2e 的假 GIS（`e2e/fixtures.ts`）：`prompt()` 有 `window.__e2eIdToken` 就交給 `initialize` 的 callback，模擬自動登入

**doPost(e)**
- body 帶入 Google ID Token，後端呼叫 `https://oauth2.googleapis.com/tokeninfo` 驗證有效性（`verifyIdToken_`）：`aud` 要等於指令碼屬性 `GOOGLE_CLIENT_ID`（沒設這個屬性一律拒絕）、email 已驗證且是 swzx00@gmail.com，不符合直接拒絕
- 驗證通過後先拿 `LockService` 的指令碼鎖再執行（`handleAction_`），所有寫入排隊一個一個做：各動作都是「先找列號 → 再寫入 → 最後整張排序」，兩個請求同時進來時列號會被另一個請求打亂、寫到別筆紀錄上。等超過 `LOCK_WAIT_MS`（30 秒）拿不到鎖就回「目前有其他資料正在寫入，請稍後再試」，不動 Sheet。讀取（`doGet`）不加鎖
- 依 `action` 分派：
  - `create`：工作紀錄分頁不存在時建立，產生 UUID 當 ID，項次用 `getNextDailyIndex_` 依工作日期計算（**每天**從 1 開始，見 [sheet-schema.md](sheet-schema.md) 的「項次」），寫入新列；若帶了新的交辦單位/交辦人員/專案名稱/專案Repo，同步寫回「選項清單」分頁
  - `update`：用 `id` 在工作紀錄分頁定位那一列，原地改寫（工作日期改到別天、別的月份也一樣，不用搬分頁）。項次：工作日期沒改就沿用原本的項次（忽略前端送來的值）；工作日期改到別天，在新的那天用 `getNextDailyIndex_` 重新編號
  - `delete`：用 `id` 在工作紀錄分頁定位，把整列搬到「已刪除紀錄」分頁並記錄刪除時間（見上方「已刪除紀錄分頁」）
  - `batchCreate`：payload 帶 `items` 陣列，一次新增多筆（前端「複製本日」用，`handleBatchCreate_`）。全部先驗證，任何一筆不合格（錯誤訊息標出第幾筆）、或任何一天的工時合計（既有紀錄＋這批）超過 24 小時，就**整批退回、不寫入任何一筆**；通過後項次依陣列順序照每日編號規則接續，整批的列一次 `setValues` 寫入，新值同步寫回「選項清單」（請假列一樣略過）。回應 `{ items: [...], replaced }`。另可帶 `replace: true`（「複製本日」覆蓋目標日用）：工時合計只算這批，驗證全部通過後，先把這批涉及的工作日期原本的紀錄（含請假）**搬到「已刪除紀錄」分頁**（`moveDayRowsToDeleted_`），再寫入，新紀錄從 1 開始編號，`replaced` 是被搬走的筆數。驗證沒過時原本的紀錄完全不動
  - `reorder`：payload 帶 `date` 與那天所有未刪除紀錄（含請假）依新順序排列的 `ids`（`handleReorder_`）。`ids` 必須跟 Sheet 上那天未刪除的紀錄完全一致（不能多、不能少、不能重複、不能混到已刪除或別天的），不一致代表資料已被別處改過，回「紀錄已變更，請重新整理後再排序」、不動 Sheet；通過後項次依順序改成 1、2、3…，已刪除的紀錄不動
  - `addOption`／`renameOption`／`deleteOption`：直接管理「選項清單」分頁本身（不透過新增/編輯工作紀錄的副作用），給前端「管理選項清單」Modal 用，細節見 [dialogs.md](ui/dialogs.md) 的「選項清單管理」。新增與重新命名的值套用工作紀錄同一欄的字數上限與禁用字元（`validateOptionValue_`，前端 `validateOptionValue` 手動同步）
  - `saveWorkHours`：payload 帶 `workHours`（`{ start, end, breakStart?, breakEnd? }`，`null` 代表清除），寫入「選項清單」分頁的「工時設定」欄（`handleSaveWorkHours_`）。後端也驗證（`validateWorkHours_`，規則與訊息跟前端 `validateWorkHoursSetting` 手動同步）：格式 `HH:mm`、上班 < 午休開始 < 午休結束 < 下班、每日工時剛好 `WORK_HOURS_DAILY_STANDARD`（8）小時，不合格回 `{ error }`；回應帶回最新的 `{ workHours }`
  - `getAutoFillSetting`／`saveAutoFillSetting`／`autoFillNow`（2026-10-13）：自動填入（本日總結 → 別人的試算表）。`getAutoFillSetting` 回 `{ autoFill: { enabled, url, name } }`（沒設定是停用、空白）；`saveAutoFillSetting` 帶 `autoFill`，驗證（`validateAutoFill_`）後寫入「選項清單」分頁的「自動填入設定」欄，啟用時先確認打得開對方試算表、找得到姓名，回應帶回 `{ autoFill }`；`autoFillNow` 帶 `date`（`YYYY/MM/DD`）與 `text`，把文字填進對方試算表那天的格子，回 `{ status: 'written' | 'unchanged' }`，格子已經有不同的內容不覆蓋、回 `{ error }`。設定**不放進公開的 `doGet type=options`**（網址是別人的試算表）。實作在 `apps-script/AutoFill.gs`（`Code.gs` 只負責轉過去），另有時間觸發器 `runAutoFill`（每個工作日 16 點那一小時內），規則見 [auto-fill.md](auto-fill.md)
  - `saveThemeMode`（2026-10-12）：payload 帶 `themeMode`（`auto`／`light`／`dark`），寫入「選項清單」分頁的「樣式設定」欄第 2 列（`handleSaveThemeMode_`，純文字格式），讓不同裝置的樣式設定同步。值不在 `THEME_MODE_VALUES` 裡回 `{ error: '樣式設定只能是 auto、light 或 dark' }`；回應帶回 `{ themeMode }`。`doGet type=options` 的回應也多帶 `themeMode`（沒設定或值不合法是 `null`，`getThemeMode_`）。可用的值跟前端 `useTheme.ts` 的 `THEME_MODES` 手動同步（`tests/apps-script/consistency.spec.ts` 比對）
- 後端必須重複驗證前端已做過的規則（`Code.gs` 的 `validateItem_`，規則同 `shared/validation-schema.json`：必填、字數上限、今日工時 0–24／0.25、完成度 0–100／0.25、狀態在固定選項內、日期格式與年份（2/30、4/31、平年 2/29 這類不存在的日期算格式不正確，前端 `validateDate` 同一套規則）、Repo 不可含逗號等），因為 API 網址公開，理論上可被繞過前端直接呼叫

**重要限制：Apps Script 網頁應用程式的回應沒辦法自訂 HTTP status code，一律是 200**（平台限制）。所以 `doGet`／`doPost` 的成功/失敗**一律靠回應內容裡有沒有 `error` 欄位判斷**，前端（`useWorkItems.ts`）已經配合改成檢查 `data.error`，不能用 `res.ok`／HTTP 狀態碼判斷；MSW mock 也同步改成一律回 200、錯誤放在 `error` 欄位裡，貼近真實行為。之後如果重寫前端呼叫邏輯，要記得延續這個慣例。

**`doPost` 一律用 `Content-Type: text/plain;charset=utf-8`**（body 仍是 JSON 字串）：`application/json` 不屬於瀏覽器的「簡單請求」，跨網域時會先送 `OPTIONS` 預檢，Apps Script 不回應預檢（沒有 `Access-Control-Allow-Origin`），正式站（`github.io`）的寫入會全部被 CORS 擋下，`fetch` 只會丟 `Failed to fetch`。後端 `doPost` 是 `JSON.parse(e.postData.contents)`，不看 `Content-Type`。本機 `npm run dev` 走 MSW 或同源的 `/apps-script-proxy`，不會跨網域，測不出這個問題，`tests/unit/composables/useWorkItems.spec.ts` 有測試鎖住。之後改前端呼叫邏輯要延續，也不要加自訂 header（一樣會觸發預檢）

**錯誤代碼 `code`**：需要讓前端分辨錯誤類型的情況，`doPost` 回應除了 `error`（給人看的訊息）再多帶一個 `code` 欄位。目前只有登入驗證失敗會帶 `code: 'UNAUTHORIZED'`（含 token 過期），其他錯誤沒有 `code`。前端 `useWorkItems.ts` 的 `postAction`、`useOptions.ts` 的 `postOptionAction` 都會丟出帶 `code` 的 `ApiError`，呼叫端用 `e instanceof ApiError && e.code === 'UNAUTHORIZED'` 判斷，**不要比對 `error` 文字**（文字可能改、MSW 跟真後端也曾經不一致）。新增錯誤代碼時，`Code.gs`、`src/mocks/handlers.ts`、`useWorkItems.ts` 的 `ApiErrorCode` 型別要一起改。


**工作紀錄分頁建立機制**：`create`／`batchCreate` 寫入時分頁不存在就建立（`getOrCreateDataSheet_`），讀取時分頁不存在就回傳空的。不用觸發器預先建立分頁

**可公開的識別碼**：Apps Script Web App 網址、Google OAuth Client ID 都可以放心寫在前端程式碼裡公開，這是 Google 官方設計上允許的，真正把關的是後端的登入驗證，不是網址保密。Google Sheet ID 存在 Apps Script 的指令碼屬性 `SHEET_ID`（`PropertiesService`，`getSheetId_`），不寫死在程式碼裡；同一處另有 `GOOGLE_CLIENT_ID`（前端 `.env` 那組，驗證 ID Token 的 `aud` 用），以及自動填入通知用的 `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_USER_ID`（token 是密鑰，見 [auto-fill.md](auto-fill.md) 的「通知」）。部署步驟寫在 `Code.gs` 開頭的註解。

- Google 登入狀態由 Google 保管（自動登入），token 只放記憶體、到期前自動續期，不用每次操作重新登入

**共用驗證 schema 同步方式**：`shared/validation-schema.json` 是唯一事實來源，前端 `src/validation/work-item.ts` 直接 import。**目前 `Code.gs` 的 `VALIDATION_RULES` 是手動同步的**——原本規劃的 build script（`npm run build:gs`，把 JSON 轉成 Apps Script 可讀的 `schema.gs`）還沒實作，`apps-script/` 也還沒設定 clasp（目前是手動把 `Code.gs` 貼到 Apps Script 編輯器部署）。改 JSON 時 `Code.gs` 要一起改。

- 狀態的可選值不在 JSON 裡，放在 `src/types/work-item.ts` 的 `STATUS_OPTIONS`（TypeScript 需要 `as const` 字面值型別才能推導 `Status` 型別），`Code.gs` 的 `STATUS_OPTIONS` 也是手動同步
- 日期的年份範圍用 `minYear`／`maxYear` 表示，不寫完整日期字串，前端（`YYYY-MM-DD`）與 API（`YYYY/MM/DD`）格式不同也能共用同一份規則

**本機測真後端會撞到的 CORS 問題與解法**：Apps Script 網頁應用程式對 `localhost` 這類來源的 CORS 支援是已知有缺陷的（社群長年回報、Google 沒正式修掉，換新部署也不會解決），瀏覽器會擋下 `fetch`，即使後端其實有正常執行（可以用 `curl` 直接打 `/exec` 網址驗證，繞過瀏覽器的 CORS 機制）。解法是 `vite.config.ts` 裡的 `appsScriptDevProxyPlugin`：`VITE_ENABLE_MSW=false` 時，前端改打同源的 `/apps-script-proxy`，由這個 middleware 在 **Node 端**把整個請求（含跟著 Apps Script 的 302 轉址）做完，只把最終 JSON 回給瀏覽器，瀏覽器全程只跟自己的 origin 講話，不會有跨網域請求。

- 這裡**不能用 Vite 內建的 `server.proxy`**（底層 `http-proxy`）：它不會自動跟著 redirect 走，只是把 Apps Script 回的 302 轉發給瀏覽器，瀏覽器自己再去跟轉址目標（`script.googleusercontent.com`）要資料時又是一次跨網域請求，等於繞了一圈還是撞到同一個問題
- 這個 proxy **只在本機開發有效**，正式部署到 GitHub Pages（純靜態站，沒有 server 可以轉發）不會有這層，屆時要靠 Apps Script 自己的 CORS 處理——社群回報通常從「真的 HTTPS 網域」打會比 `localhost` 穩定，實際部署後要再驗證一次
- `useWorkItems.ts`／`useOptions.ts` 都已經改成：`DEV` 且 `VITE_ENABLE_MSW=false` 時走 `/apps-script-proxy`，其餘情況維持打 `VITE_APPS_SCRIPT_URL`（讓 MSW 的 `*/exec` 攔截規則能正常比對）
