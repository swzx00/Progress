# 自動填入（本日總結 → 別人的試算表）

使用者決定，2026-10-13。每個工作日把當天的本日總結，填進另一份**別人的**試算表（主管彙整全組每日工作進度用的那份），取代每天手動複製貼上。後端在獨立的 `apps-script/AutoFill.gs`（跟 `Code.gs` 同一個 Apps Script 專案、共用全域，沿用 `Code.gs` 的讀寫工具；`Code.gs` 的 `doPost` 驗證登入、拿鎖後把相關 action 轉過來），前端入口在本日總結 Modal（見 [ui/dialogs.md](ui/dialogs.md)）。

## 設定

存在自己這份 Sheet 的「選項清單」分頁「自動填入設定」欄（見 [sheet-schema.md](sheet-schema.md)），**不存瀏覽器**；換裝置、觸發器執行時都從後端讀。

| 項目 | 規則 |
|---|---|
| 啟用 | `TRUE`／`FALSE`。停用時網址、姓名保留原本的值，觸發器不寫入、「填入」按鈕 disabled |
| 試算表網址 | 啟用時必填，格式 `https://docs.google.com/spreadsheets/d/{ID}…`（`AUTO_FILL_URL_PATTERN`）；停用時可空白，有填照樣檢查格式 |
| 姓名 | 啟用時必填，最多 20 個字（`AUTO_FILL_NAME_MAX`），用來找自己那一列 |
| 儲存時檢查 | 啟用時先開一次對方試算表、在這個月的分頁（還沒建就用第一個分頁）找姓名，打不開或找不到就回錯誤、不存（`checkAutoFillTarget_`）。沒辦法事先確認有沒有**編輯**權限，寫入失敗時才知道 |
| 讀取 | 只能登入後用 `doPost` 的 `getAutoFillSetting` 讀；**不放進公開的 `doGet type=options`**，對方試算表的網址不會外流 |

驗證規則與訊息：`AutoFill.gs` 的 `validateAutoFill_` ↔ 前端 `validateAutoFillSetting`（手動同步）。

## 對方試算表的結構

依 2026-10 拿到的版本整理（同事的資料不進 repo，測試用自己編的假資料）：

- 一個月一個分頁，名稱寫法不固定（使用者決定，2026-10-13）：`202610`、`2026/10`、`2026-10`、`2026.10`、`2026年10月` 都算，月份補不補零都可以（`20269`、`202609`、`2026/9`、`2026/09`…），名稱前後的空白忽略。比對的是分頁名稱裡的年、月數字（`findAutoFillSheet_`，`AUTO_FILL_SHEET_NAME_PATTERN`），`202611` 是 11 月、不會被當成 1 月；不是月份的分頁名稱略過。找不到時錯誤訊息是「找不到 2026 年 10 月的分頁（例如…）」
- 注意：下載成 .xlsx 時分頁名稱的「/」會被拿掉（Excel 的分頁名稱不能有 /），`2026/10` 會變成 `202610`，不能照下載的檔案判斷實際名稱
- 新格式（`20269` 之後）：第 2 列 E 欄起是日期（只列工作日）、第 3 列表頭「序／姓名／職稱／座位／每日工作進度」、第 4 列起一人一列、一天一格（多行文字）
- 舊分頁的表頭位置不一樣（`20255` 凍結在 E6），所以**不寫死列號欄號**：日期在前 `AUTO_FILL_SCAN_ROWS`（10）列裡找儲存格是日期、而且用對方試算表時區格式化後等於那天的欄（`findAutoFillDateColumn_`）；姓名在前 `AUTO_FILL_SCAN_COLUMNS`（4）欄裡找完全相同（去頭尾空白）的列（`findAutoFillNameRow_`）。對方插入、刪除人員或日期都不會寫錯格

## 填入的內容（`buildAutoFillText_`）

- 本日總結：規則同前端 `buildDaySummary`（`AutoFill.gs` 的 `buildDaySummary_` 手動同步）——排除請假與「會議討論」、照項次重新從 1 編號、第一行 `N.Repo 單號`（沒有 Repo 用專案名稱，再沒有用工作目標）、下面每行 `- 處理內容`
- 只有請假（本日總結是空的）→ `請假`
- 有工作也有請假 → 本日總結最後空一行，加 `HH:MM 請假`：下班時間往前扣請假時數，跨過午休要跳過（`leaveStartTime_`，跟前端 `hoursToRange(每日工時 − 請假, 請假).start` 相同）。沒有工時設定、請假時數不小於每日工時時只寫 `請假`

## 自動執行（觸發器）

`installAutoFillTrigger()` 在 Apps Script 編輯器手動執行一次，建立每天 16 點（`Asia/Taipei`）那一小時內執行的時間觸發器（Google 會在那一小時內挑時間跑，沒辦法指定到分鐘）。重複執行會先刪掉舊的，不會重複觸發。觸發器跑的是**指令碼最新存檔的版本**，不是網頁應用程式部署的版本。

`runAutoFill()` 先拿跟 `doPost` 同一把指令碼鎖（不會跟「填入」按鈕同時寫同一格），再執行 `runAutoFill_(now)`，依序判斷：

| 順序 | 條件 | 處理（回傳的 `status`） |
|---|---|---|
| 1 | 沒啟用 | 結束（`disabled`） |
| 2 | 不是工作日：查台灣辦公日曆（跟前端同一份 ruyut/TaiwanCalendar，含補班日），抓不到就只看週末（`isAutoFillWorkday_`） | 結束（`holiday`） |
| 3 | 當天沒有可填的內容 | 不寫入，**通知**（`empty`） |
| 4 | 工時合計（含請假）未滿 `WORK_HOURS_DAILY_STANDARD`（8）小時 | 不寫入，**通知**附目前時數與要填的內容（`insufficient`） |
| 5 | 打不開試算表，或找不到分頁、姓名、日期欄，或寫入失敗 | 不寫入，**通知**說明原因（`error`） |
| 6 | 格子已經有**不同的**內容 | **不覆蓋別人的紀錄**，通知附兩邊的內容（`conflict`） |
| 7 | 格子已經是一樣的內容（換行統一、去頭尾空白後比對） | 不動，通知「對方的試算表已經是一樣的內容」（`unchanged`） |
| 8 | 格子是空的 | 寫入，通知「已自動填入」附分頁名稱與內容（`written`） |

執行時丟出沒預期到的錯誤（含拿不到鎖）也通知。不是工作日、沒啟用不通知。

## 通知（LINE 為主、Email 備援）

使用者決定，2026-10-13：有問題、成功都通知（成功也通知可以順便確認觸發器每天都有在跑），走 `sendAutoFillNotice_`：

1. 先用 **LINE Messaging API** 的 push message（`https://api.line.me/v2/bot/message/push`）推一則文字訊息給自己。設定放在 Apps Script **指令碼屬性**：
   - `LINE_CHANNEL_ACCESS_TOKEN`：LINE Developers 該 channel「Messaging API」分頁發行的 long-lived Channel access token。**是密鑰**，拿到的人能用這個官方帳號發訊息：不寫進程式碼（repo 會公開）、不放 Sheet 或前端、不印在執行記錄或信裡；外流就在同一處 Reissue
   - `LINE_USER_ID`：同一個 channel「Basic settings」的 Your user ID（`U` 開頭）。手機 LINE 要先把官方帳號加為好友，不然推播會失敗
2. 沒設定、LINE 回非 200（例如 token 失效 401）、連線失敗：改寄信給 `OWNER_EMAIL`，信的最後註明 LINE 為什麼沒送出；原因也寫進執行記錄（`Logger.log`）
3. 訊息格式：第一行是標題（也是信的主旨），例如「【工作進度】2026/10/13 已自動填入」「【工作進度】2026/10/13 自動填入沒有完成：原因」，空一行後是內容。LINE 一則文字最多 5000 字（`LINE_TEXT_MAX`），超過就截斷並加「…（內容太長，後面省略）」，信不截斷
4. 費用：LINE Notify 已在 2025/3/31 停止服務，所以用 Messaging API；免費的「輕用量」方案每月 200 則主動推播，這裡每個工作日最多 1 則，用不完

`testAutoFillNotify()`：在編輯器手動執行，送一則「【工作進度】測試通知」，執行記錄寫出用了 LINE 還是改寄信。

## 手動「填入」（`doPost` 的 `autoFillNow`）

本日總結 Modal 的「填入」按鈕，payload 帶 `date`（`YYYY/MM/DD`）與 `text`（Textarea 目前的文字，可能手動改過）。跟自動執行共用找格子、比對、寫入的 `fillAutoFillCell_`，差別：

- 不檢查是不是工作日；工時合計未滿 8 小時時，前端先跳確認視窗，使用者按「填入」才送出（後端不擋，使用者決定）
- 內容去頭尾空白後不能是空的、最多 `AUTO_FILL_TEXT_MAX`（5000）字
- 沒啟用回錯誤；格子已經有不同的內容一樣**不覆蓋**，回錯誤；找不到格子回原因
- 結果直接回前端（`{ status: 'written' | 'unchanged' }` 或 `{ error }`），不通知

## 部署

1. 專案新增指令碼檔案 `AutoFill.gs`，跟新的 `Code.gs` 一起貼上、部署新版本；用到寄信（`MailApp`）、管理觸發器（`ScriptApp`），會要求重新授權
2. 編輯器執行一次 `installAutoFillTrigger()`
3. 自己的帳號要有對方試算表的**編輯**權限，寫入會以自己的名義記在對方的版本記錄裡
4. LINE 通知（一次性設定，見上方「通知」）：
   1. LINE Official Account Manager（manager.line.biz）建立官方帳號（免費的輕用量方案），「設定」→「Messaging API」啟用並選擇／建立 Provider，Webhook 不用填；建議「回應設定」關掉自動回應訊息
   2. LINE Developers Console（developers.line.biz/console）→ 該 channel：「Basic settings」複製 Your user ID；「Messaging API」發行 Channel access token（long-lived），並用手機掃 QR code 加好友
   3. Apps Script「專案設定」→「指令碼屬性」新增 `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_USER_ID`
   4. 編輯器執行 `testAutoFillNotify()`，手機收到測試訊息就完成；`UrlFetchApp` 原本就授權過，不用重新授權，觸發器也不用重建
