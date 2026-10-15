/**
 * 「工作進度」自動填入：每個工作日把當天的本日總結填進別人的試算表（規則見 docs/auto-fill.md）。
 *
 * 跟 Code.gs 放在同一個 Apps Script 專案（共用全域）：這裡用到 Code.gs 的讀寫工具（getSpreadsheet_、readDay_、
 * getWorkHours_、isLeaveItem_…）與常數（OWNER_EMAIL、WORK_HOURS_DAILY_STANDARD、LOCK_WAIT_MS…）；
 * Code.gs 的 doPost 驗證登入、拿鎖後，把 getAutoFillSetting／saveAutoFillSetting／autoFillNow 轉到這裡。
 *
 * 部署：
 *   1. 專案新增指令碼檔案 AutoFill.gs，貼上這份內容（Code.gs 也要是同一版），部署新版本；
 *      用到寄信（MailApp）、管理觸發器（ScriptApp），會要求重新授權
 *   2. 編輯器執行一次 installAutoFillTrigger()，建立每天 16 點那一小時內執行的觸發器
 *   3. 啟用與否看前端「本日總結」裡的設定；觸發器跑的是指令碼最新存檔的版本（不是網頁應用程式部署的版本）
 *   4. 通知用 LINE（Messaging API）：「專案設定」→「指令碼屬性」新增 LINE_CHANNEL_ACCESS_TOKEN（long-lived 的
 *      Channel access token，是密鑰，不要寫進程式碼或 Sheet）與 LINE_USER_ID（LINE Developers「Basic settings」的
 *      Your user ID），手機 LINE 要先把官方帳號加為好友；編輯器執行 testAutoFillNotify() 確認收得到。
 *      沒設定或推播失敗時改寄信給 OWNER_EMAIL
 */

// ===== 常數 =====

// 自動填入（使用者決定）：每個工作日 16:00～17:00 之間，把當天的工作紀錄照「本日總結」的規則整理成文字，
// 填進別人的試算表（每月一個「年＋月」分頁、第 2 列是日期、B 欄是姓名、一人一天一格）。
// 設定存在「選項清單」分頁的「自動填入設定」欄，第 2～4 列依序是啟用（TRUE／FALSE）、試算表網址、姓名，純文字格式。
// 網址是別人的試算表，不從公開的 doGet 回傳，只能登入後用 doPost 的 getAutoFillSetting 讀。
// 驗證規則手動同步自前端 src/utils/auto-fill.ts 的 validateAutoFillSetting
var AUTO_FILL_HEADER = '自動填入設定';
var AUTO_FILL_ROWS = 3;
var AUTO_FILL_NAME_MAX = 20;
var AUTO_FILL_URL_PATTERN = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:[/?#]|$)/;
// 觸發器（installAutoFillTrigger 建立）呼叫的函式名稱與時段（台灣時間 16 點那一個小時內）
var AUTO_FILL_TRIGGER_HANDLER = 'runAutoFill';
var AUTO_FILL_HOUR = 16;
var AUTO_FILL_TIME_ZONE = 'Asia/Taipei';
// 工程部日報表：日期列在前幾列裡找、姓名在前幾欄裡找（舊分頁的表頭位置不一樣，不寫死列號欄號）
var AUTO_FILL_SCAN_ROWS = 10;
var AUTO_FILL_SCAN_COLUMNS = 4;
// 本日總結不列的專案名稱，手動同步自前端 src/utils/day-summary.ts 的 EXCLUDED_PROJECTS
var DAY_SUMMARY_EXCLUDED_PROJECTS = ['會議討論'];
// 工作目標開頭的單號，手動同步自前端 src/utils/day-summary.ts 的 TASK_CODE_PATTERN
var TASK_CODE_PATTERN = /^(#\d{4,5}|T\d{4,5})(?!\d)/;
// 台灣辦公日曆（跟前端 src/composables/useTaiwanHolidays.ts 同一份資料），判斷今天要不要填
var HOLIDAY_DATA_URL = 'https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/';

// ===== 本日總結與填入內容 =====

// 本日總結文字，規則跟前端 src/utils/day-summary.ts 的 buildDaySummary 相同，改一邊要一起改：
// 排除請假與「會議討論」，照項次排序後從 1 重新編號；第一行「N.標題」，下面每行處理內容前面加「- 」
function extractTaskCode_(target) {
  var match = TASK_CODE_PATTERN.exec(String(target || '').trim());
  return match ? match[1] : '';
}

function buildDaySummaryHeading_(item) {
  var repos = (item.專案Repo || []).join(',');
  if (repos) {
    return [repos, extractTaskCode_(item.工作目標)]
      .filter(function (s) {
        return s;
      })
      .join(' ');
  }
  return String(item.專案名稱 || '').trim() || String(item.工作目標 || '').trim();
}

function buildDaySummary_(items) {
  return items
    .filter(function (item) {
      return (
        !isLeaveItem_(item) &&
        DAY_SUMMARY_EXCLUDED_PROJECTS.indexOf(String(item.專案名稱 || '').trim()) === -1
      );
    })
    .slice()
    .sort(function (a, b) {
      return a.項次 - b.項次;
    })
    .map(function (item, index) {
      var lines = [index + 1 + '.' + buildDaySummaryHeading_(item)];
      String(item.處理內容 || '')
        .split('\n')
        .forEach(function (line) {
          var trimmed = line.trim();
          if (trimmed) lines.push(trimmed.charAt(0) === '-' ? trimmed : '- ' + trimmed);
        });
      return lines.join('\n');
    })
    .join('\n');
}

function formatMinutes_(minutes) {
  var pad = function (n) {
    return (n < 10 ? '0' : '') + n;
  };
  return pad(Math.floor(minutes / 60)) + ':' + pad(minutes % 60);
}

/**
 * 請假從幾點開始：上班時間往後累計「每日工時 − 請假時數」（跨過午休就跳過，剛好落在午休開始移到午休結束），
 * 等於下班時間往前扣請假時數。跟前端 src/utils/work-hours.ts 的 hoursToRange(總工時 − 請假, 請假).start 相同。
 * 沒有工時設定、請假時數不小於每日工時（整天請假）回 null
 */
function leaveStartTime_(leaveHours, workHours) {
  if (!workHours) return null;
  var start = parseTime_(workHours.start);
  var end = parseTime_(workHours.end);
  var breakStart = parseTime_(workHours.breakStart);
  var breakEnd = parseTime_(workHours.breakEnd);
  var hasBreak = breakStart !== null && breakEnd !== null && breakStart < breakEnd;
  var breakMinutes = hasBreak ? breakEnd - breakStart : 0;
  var workMinutes = end - start - breakMinutes - Math.round(leaveHours * 60);
  if (start === null || end === null || !(leaveHours > 0) || workMinutes <= 0) return null;

  var at = start + workMinutes;
  if (hasBreak && start < breakStart && at > breakStart) at += breakMinutes;
  if (hasBreak && at >= breakStart && at < breakEnd) at = breakEnd;
  return formatMinutes_(at);
}

/**
 * 要填進工程部日報表的文字（使用者決定）：
 * - 只有請假（本日總結是空的）→「請假」
 * - 有工作也有請假 → 本日總結最後空一行，加「HH:MM 請假」（時間見 leaveStartTime_，算不出來就只寫「請假」）
 * - 沒有請假 → 本日總結
 */
function buildAutoFillText_(items, workHours) {
  var summary = buildDaySummary_(items);
  var leaveHours = 0;
  var hasLeave = false;
  items.forEach(function (item) {
    if (!isLeaveItem_(item)) return;
    hasLeave = true;
    leaveHours += Number(item.今日工時) || 0;
  });
  if (!hasLeave) return summary;
  if (!summary) return '請假';
  var start = leaveStartTime_(roundHours_(leaveHours), workHours);
  return summary + '\n\n' + (start ? start + ' 請假' : '請假');
}

// 驗證規則與訊息跟前端 src/utils/auto-fill.ts 的 validateAutoFillSetting 相同，改一邊要一起改。
// 停用時網址、姓名可以留空（欄位保留原本的值），有填就照樣檢查格式
function validateAutoFill_(setting) {
  if (!setting || typeof setting !== 'object' || typeof setting.enabled !== 'boolean') {
    return '自動填入設定格式不正確';
  }
  var url = String(setting.url === undefined || setting.url === null ? '' : setting.url).trim();
  var name = String(setting.name === undefined || setting.name === null ? '' : setting.name).trim();
  if (setting.enabled && !url) return '請填寫試算表網址';
  if (url && !AUTO_FILL_URL_PATTERN.test(url)) return '試算表網址格式不正確，請貼上 Google 試算表的網址';
  if (setting.enabled && !name) return '請填寫姓名';
  if (name.length > AUTO_FILL_NAME_MAX) return '姓名不可超過 ' + AUTO_FILL_NAME_MAX + ' 個字';
  return null;
}

// 讀取自動填入設定，沒有設定（分頁或欄位不存在）時回傳停用、空白
function getAutoFill_() {
  var result = { enabled: false, url: '', name: '' };
  var sheet = getSpreadsheet_().getSheetByName(OPTIONS_SHEET_NAME);
  if (!sheet) return result;
  var col = getColumnMap_(sheet)[AUTO_FILL_HEADER];
  if (!col) return result;
  var values = sheet.getRange(2, col, AUTO_FILL_ROWS, 1).getValues();
  var text = function (raw) {
    return raw === undefined || raw === null ? '' : String(raw).trim();
  };
  result.enabled = values[0][0] === true || text(values[0][0]).toUpperCase() === 'TRUE';
  result.url = text(values[1][0]);
  result.name = text(values[2][0]);
  return result;
}

// 工程部日報表的月份分頁名稱寫法不固定（使用者決定）：202610、2026/10、2026-10、2026.10、2026年10月 都算，
// 月份補不補零都可以，名稱前後的空白忽略。下載成 .xlsx 時「/」會被拿掉（Excel 的分頁名稱不能有 /），
// 所以不能照下載的檔案寫死一種
var AUTO_FILL_SHEET_NAME_PATTERN = /^(\d{4})\s*(?:[/.-]|年)?\s*(\d{1,2})\s*月?$/;

// 找 date（YYYY/MM/DD）那個月的分頁：比對分頁名稱的年、月數字，找不到回 null
function findAutoFillSheet_(book, date) {
  var parts = date.split('/');
  var year = Number(parts[0]);
  var month = Number(parts[1]);
  var sheets = book.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var match = AUTO_FILL_SHEET_NAME_PATTERN.exec(String(sheets[i].getName()).trim());
    if (match && Number(match[1]) === year && Number(match[2]) === month) return sheets[i];
  }
  return null;
}

// 錯誤訊息用的月份（例如「2026 年 10 月」）
function autoFillMonthLabel_(date) {
  var parts = date.split('/');
  return parts[0] + ' 年 ' + Number(parts[1]) + ' 月';
}

// 在對方分頁的前 AUTO_FILL_SCAN_COLUMNS 欄找姓名，回傳列號（1-based），找不到回 -1
function findAutoFillNameRow_(sheet, name) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return -1;
  var cols = Math.min(AUTO_FILL_SCAN_COLUMNS, Math.max(sheet.getLastColumn(), 1));
  var values = sheet.getRange(1, 1, lastRow, cols).getValues();
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      if (String(values[r][c]).trim() === name) return r + 1;
    }
  }
  return -1;
}

// 在對方分頁的前 AUTO_FILL_SCAN_ROWS 列找日期等於 date（YYYY/MM/DD）的儲存格，回傳欄號，找不到回 -1。
// 日期用工程部日報表自己的時區格式化（Sheet 把日期存成 Date 時用的就是它）
function findAutoFillDateColumn_(sheet, date, timeZone) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return -1;
  var rows = Math.min(AUTO_FILL_SCAN_ROWS, Math.max(sheet.getLastRow(), 1));
  var values = sheet.getRange(1, 1, rows, lastCol).getValues();
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      var raw = values[r][c];
      if (raw instanceof Date && Utilities.formatDate(raw, timeZone, 'yyyy/MM/dd') === date) {
        return c + 1;
      }
    }
  }
  return -1;
}

function openAutoFillTarget_(url) {
  var match = AUTO_FILL_URL_PATTERN.exec(url);
  return SpreadsheetApp.openById(match[1]);
}

// 儲存前先確認打得開、找得到姓名（這個月的分頁還沒建時找第一個分頁），有問題直接回錯誤，不用等到觸發時才知道
function checkAutoFillTarget_(setting) {
  var book;
  try {
    book = openAutoFillTarget_(setting.url);
  } catch (err) {
    return '打不開這份試算表，請確認網址正確，而且你的帳號有編輯權限';
  }
  var today = Utilities.formatDate(new Date(), getSheetTimeZone_(), 'yyyy/MM/dd');
  var sheet = findAutoFillSheet_(book, today) || book.getSheets()[0];
  if (!sheet || findAutoFillNameRow_(sheet, setting.name) === -1) {
    return '在試算表裡找不到「' + setting.name + '」，請確認姓名跟試算表上的寫法一樣';
  }
  return null;
}

// 儲存自動填入設定：「自動填入設定」欄不存在就在最後面加一欄表頭，第 2～4 列寫入啟用、網址、姓名（純文字）
function handleSaveAutoFill_(setting) {
  var error = validateAutoFill_(setting);
  if (error) return jsonOutput_({ error: error });
  var url = String(setting.url || '').trim();
  var name = String(setting.name || '').trim();
  if (setting.enabled) {
    error = checkAutoFillTarget_({ url: url, name: name });
    if (error) return jsonOutput_({ error: error });
  }

  var sheet = getOrCreateOptionsSheet_();
  var col = getColumnMap_(sheet)[AUTO_FILL_HEADER];
  if (!col) {
    col = sheet.getLastColumn() + 1;
    if (col > sheet.getMaxColumns()) sheet.insertColumnAfter(sheet.getMaxColumns());
    sheet.getRange(1, col).setValue(AUTO_FILL_HEADER);
  }

  ensureRows_(sheet, AUTO_FILL_ROWS + 1);
  var range = sheet.getRange(2, col, AUTO_FILL_ROWS, 1);
  range.setNumberFormat('@');
  range.setValues([[setting.enabled ? 'TRUE' : 'FALSE'], [url], [name]]);
  return jsonOutput_({ autoFill: getAutoFill_() });
}

/**
 * 這天要不要上班：查台灣辦公日曆（含補班日），查不到（網路錯誤、那一年還沒有資料）就只看是不是週末。
 * date 是 YYYY/MM/DD
 */
function isAutoFillWorkday_(date) {
  var parts = date.split('/');
  var key = parts.join('');
  try {
    var res = UrlFetchApp.fetch(HOLIDAY_DATA_URL + parts[0] + '.json', { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      var entries = JSON.parse(res.getContentText());
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].date === key) return !entries[i].isHoliday;
      }
    }
  } catch (err) {
    // 查不到就退回只看週末
  }
  var day = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))).getUTCDay();
  return day !== 0 && day !== 6;
}

// ===== 通知（使用者決定：LINE 為主、Email 備援，成功也通知） =====

// LINE Messaging API 的 push message：推給自己（LINE_USER_ID），token 與 user ID 放在指令碼屬性
var LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
// 一則文字訊息的字數上限（LINE 的限制），超過就截斷
var LINE_TEXT_MAX = 5000;
var LINE_TRUNCATED_SUFFIX = '\n…（內容太長，後面省略）';
// 工作進度正式站（GitHub Pages），通知附上直接開到那一天的連結（?date=YYYY-MM-DD）
var APP_URL = 'https://swzx00.github.io/Progress/';
// 通知的第一行（LINE）＝信的主旨（使用者決定，2026-10-15）
var AUTO_FILL_NOTICE_TITLE = '⭐【Progress 工作進度】📢通知';
// 「填入的內容」最多列幾個字，超過截斷加「…」（使用者決定）
var AUTO_FILL_NOTICE_TEXT_MAX = 200;

/**
 * 通知最後附的連結（使用者決定）：工程部日報表（自動填入設定的網址）、工作進度正式站（有日期就開到那一天）。
 * 讀設定失敗或沒填網址就只附正式站
 */
function autoFillLinks_(date) {
  var lines = [];
  try {
    var url = getAutoFill_().url;
    if (url) lines.push('工程部日報表：' + url);
  } catch (err) {
    // 讀不到設定（例如 Sheet 打不開）也要能通知，只是少一個連結
  }
  lines.push('Progress 工作進度：' + APP_URL + (date ? '?date=' + date.replace(/\//g, '-') : ''));
  return lines.join('\n');
}

// LINE 的訊息：標題＋內容＋連結，超過 LINE_TEXT_MAX 只截內容，標題與連結一定保留
function buildLineText_(title, body, links) {
  var head = title + '\n\n';
  var tail = links ? '\n\n' + links : '';
  var room = LINE_TEXT_MAX - head.length - tail.length;
  if (body.length > room) body = body.slice(0, Math.max(room - LINE_TRUNCATED_SUFFIX.length, 0)) + LINE_TRUNCATED_SUFFIX;
  return head + body + tail;
}

// 推一則 LINE 文字訊息給自己，成功回 null，失敗回原因（不含 token）
function pushAutoFillLine_(text) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  var userId = props.getProperty('LINE_USER_ID');
  if (!token || !userId) return '沒有設定指令碼屬性 LINE_CHANNEL_ACCESS_TOKEN／LINE_USER_ID';
  try {
    var res = UrlFetchApp.fetch(LINE_PUSH_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ to: userId, messages: [{ type: 'text', text: text }] }),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    if (code === 200) return null;
    return 'LINE 回應 HTTP ' + code + '：' + String(res.getContentText()).slice(0, 300);
  } catch (err) {
    return 'LINE 連線失敗：' + String(err);
  }
}

/**
 * 通知擁有者：先推 LINE，沒設定或失敗就改寄信給 OWNER_EMAIL（信裡註明 LINE 為什麼沒送出），
 * 回傳實際用的管道 'line'／'email'。title 是第一行（信的主旨），body 是內容，最後附上 links（autoFillLinks_）
 */
function sendAutoFillNotice_(title, body, links) {
  var lineError = pushAutoFillLine_(buildLineText_(title, body, links));
  if (!lineError) return 'line';
  Logger.log('LINE 通知沒有送出，改寄信：' + lineError);
  MailApp.sendEmail(
    OWNER_EMAIL,
    title,
    body + (links ? '\n\n' + links : '') + '\n\n（LINE 通知沒有送出：' + lineError + '，改用 Email 通知）'
  );
  return 'email';
}

// 通知的內文（標題以下）：日期、狀態，「內容：」底下一行一段（使用者決定的格式）
function buildAutoFillNoticeBody_(date, status, contentLines) {
  return ['日期：' + date, '狀態：' + status, '內容：'].concat(contentLines).join('\n');
}

// 「填入的內容」超過 AUTO_FILL_NOTICE_TEXT_MAX 字就截斷
function truncateNoticeText_(text) {
  return text.length > AUTO_FILL_NOTICE_TEXT_MAX ? text.slice(0, AUTO_FILL_NOTICE_TEXT_MAX) + '…' : text;
}

// 沒有寫入（例外情況）
function notifyAutoFill_(date, reason, detail) {
  sendAutoFillNotice_(
    AUTO_FILL_NOTICE_TITLE,
    buildAutoFillNoticeBody_(date, '失敗', [
      '【Progress 工作進度】 ' + date + ' 自動填入沒有完成。',
      '原因:',
      reason + (detail ? '\n\n' + detail : ''),
    ]),
    autoFillLinks_(date)
  );
}

// 已寫入，或對方的格子已經是一樣的內容（使用者決定成功也通知，順便確認觸發器每天都有在跑）
function notifyAutoFillDone_(date, result, text) {
  var contentLines = result.status === 'written'
    ? [
        '【Progress 工作進度】 ' + date + ' 已自動填入。',
        '已填進工程部日報表的「' + result.sheetName + '」分頁。',
        '填入的內容:',
        truncateNoticeText_(text),
      ]
    : [
        '【Progress 工作進度】 ' + date + ' 工程部日報表已經是一樣的內容。',
        '格子裡已經是今天的總結（可能先用「填入」按鈕填過），這次沒有重複寫入。',
      ];
  sendAutoFillNotice_(AUTO_FILL_NOTICE_TITLE, buildAutoFillNoticeBody_(date, '已完成', contentLines), autoFillLinks_(date));
}

/**
 * 測試通知：在 Apps Script 編輯器手動執行，手機 LINE 應該收到一則測試訊息（日期用今天）；
 * 沒收到看「執行記錄」，LINE 推播失敗的原因會印在那裡（並改寄一封測試信）
 */
function testAutoFillNotify() {
  var date = Utilities.formatDate(new Date(), AUTO_FILL_TIME_ZONE, 'yyyy/MM/dd');
  var channel = sendAutoFillNotice_(
    AUTO_FILL_NOTICE_TITLE,
    buildAutoFillNoticeBody_(date, '測試通知', [
      '【Progress 工作進度】 ' + date + ' 測試通知。',
      '收到這則訊息，代表自動填入的通知設定正確。',
    ]),
    autoFillLinks_(date)
  );
  Logger.log(channel === 'line' ? '已用 LINE 送出' : 'LINE 沒有送出，已改寄信到 ' + OWNER_EMAIL);
}

function sameCellText_(a, b) {
  var normalize = function (value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/\r\n?/g, '\n')
      .trim();
  };
  return normalize(a) === normalize(b);
}

/**
 * 把 text 填進工程部日報表 date（YYYY/MM/DD）那天、自己那一列的格子，回傳 { status, reason?, existing? }：
 * written（已寫入）／unchanged（格子已經是一樣的內容），這兩種帶 sheetName／conflict（格子已經有不同的內容，不覆蓋別人的紀錄）／
 * error（打不開試算表、找不到分頁／姓名／日期、寫入失敗，reason 是原因）。
 * 自動執行（runAutoFill_）跟本日總結的「填入」按鈕（handleAutoFillNow_）共用
 */
function fillAutoFillCell_(setting, date, text) {
  var fail = function (reason) {
    return { status: 'error', reason: reason };
  };
  var book;
  try {
    book = openAutoFillTarget_(setting.url);
  } catch (err) {
    return fail('打不開工程部日報表，請確認網址正確，而且你的帳號有編輯權限');
  }
  var sheet = findAutoFillSheet_(book, date);
  if (!sheet) {
    return fail('找不到 ' + autoFillMonthLabel_(date) + '的分頁（例如「202610」「2026/10」「2026-10」）');
  }
  var sheetName = sheet.getName();
  var row = findAutoFillNameRow_(sheet, setting.name);
  if (row === -1) return fail('「' + sheetName + '」分頁裡找不到「' + setting.name + '」');
  var col = findAutoFillDateColumn_(sheet, date, book.getSpreadsheetTimeZone());
  if (col === -1) return fail('「' + sheetName + '」分頁裡找不到 ' + date + ' 這一欄');

  var cell = sheet.getRange(row, col);
  var existing = cell.getValues()[0][0];
  if (sameCellText_(existing, text)) return { status: 'unchanged', sheetName: sheetName };
  if (!sameCellText_(existing, '')) return { status: 'conflict', existing: String(existing) };
  try {
    cell.setValue(text);
  } catch (err) {
    return fail('寫入失敗，可能沒有編輯權限');
  }
  return { status: 'written', sheetName: sheetName };
}

/**
 * 自動填入一次（觸發器，now 是執行的時間），回傳 { status }：
 * disabled（沒啟用）／holiday（不用上班）不通知；written、unchanged 通知已完成；
 * empty（當天沒有可填的紀錄）、insufficient（工時合計未滿每日工時標準，不寫入）、conflict、error 通知沒有完成。
 * 通知走 sendAutoFillNotice_（LINE 為主、Email 備援）
 */
function runAutoFill_(now) {
  var setting = getAutoFill_();
  if (!setting.enabled) return { status: 'disabled' };
  var date = Utilities.formatDate(now, getSheetTimeZone_(), 'yyyy/MM/dd');
  if (!isAutoFillWorkday_(date)) return { status: 'holiday' };

  var dataSheet = getDataSheet_();
  var items = dataSheet
    ? readDay_(dataSheet, getColumnMap_(dataSheet), date).map(function (entry) {
        return entry.item;
      })
    : [];
  var text = buildAutoFillText_(items, getWorkHours_());
  if (!text) {
    notifyAutoFill_(date, '今天沒有可以填入的工作紀錄', '請先在工作進度補上今天的紀錄，再手動填到工程部日報表。');
    return { status: 'empty' };
  }
  // 工時合計（含請假）未滿每日工時標準，代表紀錄可能還沒填完，先不寫（使用者決定；手動「填入」不檢查）
  var totalHours = 0;
  items.forEach(function (item) {
    totalHours += Number(item.今日工時) || 0;
  });
  totalHours = roundHours_(totalHours);
  if (totalHours < WORK_HOURS_DAILY_STANDARD) {
    notifyAutoFill_(
      date,
      '今天的工時合計未滿 ' + WORK_HOURS_DAILY_STANDARD + ' 小時',
      '目前工時合計 ' + totalHours + ' 小時，請確認紀錄都填完了，再手動填入（本日總結的「填入」按鈕不檢查工時）。\n\n要填入的內容：\n' + text
    );
    return { status: 'insufficient' };
  }

  var result = fillAutoFillCell_(setting, date, text);
  if (result.status === 'written' || result.status === 'unchanged') {
    notifyAutoFillDone_(date, result, text);
  } else if (result.status === 'error') {
    notifyAutoFill_(date, result.reason, '要填入的內容：\n' + text);
  } else if (result.status === 'conflict') {
    notifyAutoFill_(
      date,
      '工程部日報表的格子已經有內容',
      '為了不覆蓋別人的紀錄，這次沒有寫入。\n\n格子目前的內容：\n' + result.existing +
        '\n\n這次要填入的內容：\n' + text
    );
  }
  return { status: result.status };
}

// 本日總結的「填入」按鈕：把畫面上（可能手動改過）的文字填進工程部日報表那一天的格子，結果直接回前端，不通知
var AUTO_FILL_TEXT_MAX = 5000;

function handleAutoFillNow_(date, text) {
  if (isNaN(apiDateToUtc_(date))) return jsonOutput_({ error: '日期格式不正確' });
  var value = String(text === undefined || text === null ? '' : text).trim();
  if (!value) return jsonOutput_({ error: '沒有可以填入的內容' });
  if (value.length > AUTO_FILL_TEXT_MAX) {
    return jsonOutput_({ error: '填入內容不可超過 ' + AUTO_FILL_TEXT_MAX + ' 個字' });
  }
  var setting = getAutoFill_();
  if (!setting.enabled) return jsonOutput_({ error: '自動填入沒有啟用' });

  var result = fillAutoFillCell_(setting, date, value);
  if (result.status === 'error') return jsonOutput_({ error: result.reason });
  if (result.status === 'conflict') {
    return jsonOutput_({ error: '工程部日報表的格子已經有內容，為了不覆蓋別人的紀錄，這次沒有寫入' });
  }
  return jsonOutput_({ status: result.status });
}

// 觸發器呼叫的函式（installAutoFillTrigger 建立），沒啟用就直接結束；沒預期到的錯誤也通知
function runAutoFill() {
  var now = new Date();
  // 跟 doPost 共用同一把鎖：讀工作紀錄時不會碰到寫到一半的排序，也不會跟「填入」按鈕同時寫同一格
  var lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(LOCK_WAIT_MS)) throw new Error('等不到其他資料寫入完成');
    try {
      runAutoFill_(now);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    notifyAutoFill_(Utilities.formatDate(now, AUTO_FILL_TIME_ZONE, 'yyyy/MM/dd'), '執行時發生錯誤', String(err));
  }
}

/**
 * 建立自動填入的時間觸發器：在 Apps Script 編輯器手動執行一次就好（重複執行會先刪掉舊的，不會重複觸發）。
 * 第一次執行會要求寄信、管理觸發器的授權。每天 16 點那一個小時內執行一次，
 * 是不是工作日、有沒有啟用都在 runAutoFill_ 裡判斷
 */
function installAutoFillTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === AUTO_FILL_TRIGGER_HANDLER) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger(AUTO_FILL_TRIGGER_HANDLER)
    .timeBased()
    .everyDays(1)
    .atHour(AUTO_FILL_HOUR)
    .inTimezone(AUTO_FILL_TIME_ZONE)
    .create();
}
