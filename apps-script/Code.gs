/**
 * 「工作進度」Apps Script 後端。
 *
 * 部署前要做的事（見 CLAUDE.md「需要使用者事先準備的東西」）：
 *   1. 「專案設定」→「指令碼屬性」新增 SHEET_ID（這份試算表的 ID）
 *   2. 「專案設定」→「指令碼屬性」新增 GOOGLE_CLIENT_ID（前端 .env 那組，用來驗證 ID Token 的 aud；沒設定時所有寫入都會被拒絕）
 *   3. 部署為網頁應用程式（執行身分：我；存取權限：所有人）
 * 第 3 步第一次執行會跳出 Google 授權畫面，屬於正常流程。
 * 從月份分頁改版成單一分頁時，另外要執行一次 mergeMonthSheets()（見該函式說明）。
 */

// ===== 常數 =====

var OWNER_EMAIL = 'swzx00@gmail.com';
var OPTIONS_SHEET_NAME = '選項清單';
// 所有工作紀錄（含請假）都存在這一個分頁（使用者決定，原本是每月一個 YYYY-MM 分頁），
// 照「工作日期 → 項次」排序，讀取時只先讀「工作日期」一欄找出那天的列，不讀整張分頁
var DATA_SHEET_NAME = '工作紀錄';
// 刪除的紀錄整列搬到這個分頁封存（工作紀錄分頁只留有效資料，方便直接把 Sheet 給別人看），
// 欄位是工作紀錄分頁的欄位去掉「已刪除」、最後多一欄「刪除時間」
var DELETED_SHEET_NAME = '已刪除紀錄';
var DELETED_AT_HEADER = '刪除時間';
var OPTION_CATEGORIES = ['交辦單位', '交辦人員', '專案名稱', '專案Repo'];
var DATA_SHEET_HEADERS = [
  'ID',
  '工作日期',
  '項次',
  '交辦單位',
  '交辦人員',
  '專案名稱',
  '專案Repo',
  '工作目標',
  '處理內容',
  '今日工時',
  '預計期限',
  '完成度',
  '狀態',
  '已刪除',
];
var NUMBER_FIELDS = ['今日工時', '完成度'];
var ARRAY_FIELDS = ['專案Repo'];
var BOOLEAN_FIELDS = ['已刪除'];
var DATE_FIELDS = ['工作日期', '預計期限'];
// 使用者自由輸入的文字欄位，寫入前設成純文字格式（見 applyTextFormat_）
var TEXT_FIELDS = ['交辦單位', '交辦人員', '專案名稱', '專案Repo', '工作目標', '處理內容'];
// Sheet 表頭是大寫「ID」，API／前端的物件鍵名是小寫「id」，讀寫時在這裡互轉
var ID_HEADER = 'ID';
var ID_KEY = 'id';

// 欄位驗證規則：手動同步自 shared/validation-schema.json（前後端共用的唯一事實來源，
// npm run build:gs 自動轉檔尚未實作），改那份 JSON 時這裡要一起改
var VALIDATION_RULES = {
  工作日期: { label: '工作日期', kind: 'date', required: true, minYear: 2020, maxYear: 2099 },
  交辦單位: { label: '交辦單位', kind: 'select', required: true, maxLength: 50 },
  交辦人員: { label: '交辦人員', kind: 'select', required: true, maxLength: 50 },
  專案名稱: { label: '專案名稱', kind: 'select', required: true, maxLength: 50 },
  專案Repo: {
    label: '專案 Repo',
    kind: 'tags',
    required: false,
    maxLength: 50,
    maxItems: 10,
    forbiddenChars: ',',
  },
  工作目標: { label: '工作目標', kind: 'text', required: true, maxLength: 500 },
  處理內容: { label: '處理內容', kind: 'text', required: false, maxLength: 2000 },
  今日工時: { label: '今日工時', kind: 'number', required: false, default: 0, min: 0, max: 24, step: 0.25 },
  完成度: { label: '完成度', kind: 'number', required: false, default: 0, min: 0, max: 100, step: 0.25 },
  預計期限: { label: '預計期限', kind: 'date', required: false, minYear: 2020, maxYear: 2099 },
  狀態: { label: '狀態', kind: 'status', required: true, default: '待辦' },
};

// 手動同步自 src/types/work-item.ts 的 STATUS_OPTIONS
var STATUS_OPTIONS = ['進行中', '前端完成', '返修', '待辦', '確認上線', '暫緩'];

// 請假紀錄規則：手動同步自 shared/validation-schema.json 的 leave。
// 請假跟工作紀錄寫在同一個分頁，用「狀態」等於 LEAVE_RULES.status 區分；
// fixed 的欄位一律由這裡覆蓋（前端送什麼都不算數），而且不寫回「選項清單」。
// 假別存在「工作目標」、備註存在「處理內容」、請假時數存在「今日工時」。
var LEAVE_RULES = {
  status: '休假',
  fixed: {
    交辦單位: '人事室',
    交辦人員: '--',
    專案名稱: '休假',
    專案Repo: [],
    預計期限: '',
    完成度: 100,
  },
  types: ['特休', '事假', '病假', '其他'],
  fields: {
    工作日期: { label: '請假日期', kind: 'date', required: true, minYear: 2020, maxYear: 2099 },
    工作目標: { label: '假別', kind: 'leaveType', required: true },
    處理內容: { label: '備註', kind: 'text', required: false, maxLength: 2000 },
    今日工時: { label: '請假時數', kind: 'number', required: true, default: 8, min: 0.25, max: 8, step: 0.25 },
  },
};

// 同一工作日期所有未刪除紀錄（工作＋請假）的今日工時合計上限，超過就不能存。
// 手動同步自 shared/validation-schema.json 的 dailyHours.max
var DAILY_HOURS_MAX = 24;

// 工時設定（上班、下班、午休）：存在「選項清單」分頁的「工時設定」欄，第 2～5 列依序是
// 上班時間、下班時間、午休開始、午休結束（午休沒填留空），儲存格純文字格式。
// 這欄不屬於 OPTION_CATEGORIES，不會出現在管理選項清單或下拉選單。
// 每日工時（下班 − 上班 − 午休）必須剛好 WORK_HOURS_DAILY_STANDARD 小時，
// 手動同步自 shared/validation-schema.json 的 workHours.dailyStandard
var WORK_HOURS_HEADER = '工時設定';
var WORK_HOURS_FIELDS = ['start', 'end', 'breakStart', 'breakEnd'];
var WORK_HOURS_DAILY_STANDARD = 8;
var TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

// ===== Sheet 共用工具 =====

function getSheetId_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('尚未設定指令碼屬性 SHEET_ID');
  return id;
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(getSheetId_());
}

// 「工作日期」「預計期限」欄位套用 yyyy/mm/dd 儲存格顯示格式，讓 Sheet 打開來看
// 跟 API 回傳的 YYYY/MM/DD 字串格式一致。套到整欄（含尚未寫入資料的列），
// 之後新增的列不用另外補設定（ensureRows_ 插入的列會沿用上一列的格式）。
function applyDateColumnFormat_(sheet, colMap) {
  DATE_FIELDS.forEach(function (field) {
    var col = colMap[field];
    if (!col) return;
    sheet.getRange(2, col, sheet.getMaxRows() - 1, 1).setNumberFormat('yyyy/mm/dd');
  });
}

// 寫入前把這幾列的文字欄位設成純文字格式：Sheet 會把「0123」「12:30」「TRUE」「2026/10/01」
// 這類內容自動轉成數字、時間、布林、日期，讀回來就跟使用者輸入的不一樣。
// 每次寫入時設定（不是建分頁時整欄設定），既有分頁、手動插入的列也照樣有效
function applyTextFormat_(sheet, colMap, startRow, numRows) {
  TEXT_FIELDS.forEach(function (field) {
    var col = colMap[field];
    if (col) sheet.getRange(startRow, col, numRows, 1).setNumberFormat('@');
  });
}

// 工作紀錄分頁，還沒建立時回傳 null（讀取用，不建立分頁）
function getDataSheet_() {
  return getSpreadsheet_().getSheetByName(DATA_SHEET_NAME);
}

// 工作紀錄分頁不存在時自動建立並寫入表頭（寫入用）
function getOrCreateDataSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(DATA_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(DATA_SHEET_NAME);
    sheet.getRange(1, 1, 1, DATA_SHEET_HEADERS.length).setValues([DATA_SHEET_HEADERS]);
    sheet.setFrozenRows(1);
    applyDateColumnFormat_(sheet, getColumnMap_(sheet));
  }
  return sheet;
}

// 確保分頁至少有 lastRow 列：getRange 超出分頁現有列數會出錯（新分頁預設只有 1000 列，
// 單一分頁幾個月就會寫滿），不夠時在最後面補列，補的列沿用上一列的格式（日期格式也會跟著）
function ensureRows_(sheet, lastRow) {
  var maxRows = sheet.getMaxRows();
  if (lastRow > maxRows) sheet.insertRowsAfter(maxRows, lastRow - maxRows);
}

// 舊版的月份分頁（YYYY-MM），只有一次性遷移 mergeMonthSheets() 用得到
function isMonthSheet_(sheet) {
  return /^\d{4}-\d{2}$/.test(sheet.getName());
}

function getOrCreateDeletedSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(DELETED_SHEET_NAME);
  if (!sheet) {
    var headers = DATA_SHEET_HEADERS.filter(function (h) {
      return h !== '已刪除';
    }).concat([DELETED_AT_HEADER]);
    sheet = ss.insertSheet(DELETED_SHEET_NAME);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    var colMap = getColumnMap_(sheet);
    applyDateColumnFormat_(sheet, colMap);
    sheet
      .getRange(2, colMap[DELETED_AT_HEADER], sheet.getMaxRows() - 1, 1)
      .setNumberFormat('yyyy/mm/dd hh:mm:ss');
  }
  return sheet;
}

/**
 * 把工作紀錄分頁的幾列搬到「已刪除紀錄」分頁：依表頭名稱複製原始儲存格值（日期、數字維持原型別），
 * 「刪除時間」寫入 deletedAt（一次性搬移舊資料時不知道實際刪除時間，傳 null 留空），
 * 再從工作紀錄分頁刪掉這幾列（由下往上刪，前面的列號才不會跑掉）。回傳搬移筆數
 */
function moveRowsToDeletedSheet_(sheet, colMap, rowNumbers, deletedAt) {
  if (rowNumbers.length === 0) return 0;
  var lastCol = sheet.getLastColumn();
  var deletedSheet = getOrCreateDeletedSheet_();
  var deletedColMap = getColumnMap_(deletedSheet);
  var deletedLastCol = deletedSheet.getLastColumn();

  var rows = rowNumbers.map(function (rowNumber) {
    var source = sheet.getRange(rowNumber, 1, 1, lastCol).getValues()[0];
    var row = new Array(deletedLastCol).fill('');
    Object.keys(deletedColMap).forEach(function (header) {
      var target = deletedColMap[header] - 1;
      if (header === DELETED_AT_HEADER) {
        row[target] = deletedAt || '';
      } else if (colMap[header]) {
        row[target] = source[colMap[header] - 1];
      }
    });
    return row;
  });
  var startRow = deletedSheet.getLastRow() + 1;
  ensureRows_(deletedSheet, startRow + rows.length - 1);
  applyTextFormat_(deletedSheet, deletedColMap, startRow, rows.length);
  deletedSheet.getRange(startRow, 1, rows.length, deletedLastCol).setValues(rows);

  rowNumbers
    .slice()
    .sort(function (a, b) {
      return b - a;
    })
    .forEach(function (rowNumber) {
      sheet.deleteRow(rowNumber);
    });
  return rows.length;
}

// 工作紀錄分頁照「工作日期 → 項次」排序，直接打開 Sheet 看到的順序跟網頁一樣。
// 讀寫一律用 ID 與表頭名稱定位，不靠列的位置，所以排序不影響其他功能；每次寫入後呼叫
function sortDataSheet_(sheet, colMap) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 3 || !colMap.工作日期 || !colMap.項次) return;
  sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).sort([
    { column: colMap.工作日期, ascending: true },
    { column: colMap.項次, ascending: true },
  ]);
}

/**
 * 一次性遷移：把舊版所有月份分頁（YYYY-MM）的紀錄合併到「工作紀錄」分頁，並移除每月 1 號
 * 自動建立月份分頁的觸發器（ensureMonthlySheet 已經拿掉，觸發器留著每個月都會執行失敗）。
 * - 依表頭名稱對應欄位，複製原始儲存格值（日期、數字維持原型別）
 * - 「工作紀錄」分頁已經有的 ID 會略過，所以重複執行不會重複寫入；ID 空白的補上 UUID，
 *   也寫回原本的月份分頁，重複執行時才認得出來
 * - 月份分頁不會被刪除，確認「工作紀錄」分頁的資料正確後再手動刪掉
 * 在 Apps Script 編輯器的「執行」選單手動執行一次即可。函式名稱刻意不加結尾底線：
 * 結尾底線是 Apps Script 的私有函式，不會出現在「執行」選單裡，就沒辦法手動執行。
 */
function mergeMonthSheets() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'ensureMonthlySheet') ScriptApp.deleteTrigger(trigger);
  });

  var target = getOrCreateDataSheet_();
  var targetColMap = getColumnMap_(target);
  var targetLastCol = target.getLastColumn();
  var idCol = targetColMap[ID_HEADER];
  var existingIds = {};
  if (target.getLastRow() >= 2) {
    target
      .getRange(2, idCol, target.getLastRow() - 1, 1)
      .getValues()
      .forEach(function (row) {
        existingIds[String(row[0])] = true;
      });
  }

  var rows = [];
  getSpreadsheet_()
    .getSheets()
    .filter(isMonthSheet_)
    .sort(function (a, b) {
      return a.getName() < b.getName() ? -1 : 1;
    })
    .forEach(function (sheet) {
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return;
      var colMap = getColumnMap_(sheet);
      sheet
        .getRange(2, 1, lastRow - 1, sheet.getLastColumn())
        .getValues()
        .forEach(function (source, i) {
          var id = colMap[ID_HEADER] ? String(source[colMap[ID_HEADER] - 1]).trim() : '';
          if (id && existingIds[id]) return;
          if (!id) {
            id = Utilities.getUuid();
            if (colMap[ID_HEADER]) sheet.getRange(i + 2, colMap[ID_HEADER]).setValue(id);
          }
          var row = new Array(targetLastCol).fill('');
          Object.keys(targetColMap).forEach(function (header) {
            if (colMap[header]) row[targetColMap[header] - 1] = source[colMap[header] - 1];
          });
          row[idCol - 1] = id;
          existingIds[id] = true;
          rows.push(row);
        });
    });

  if (rows.length > 0) {
    var startRow = target.getLastRow() + 1;
    ensureRows_(target, startRow + rows.length - 1);
    target.getRange(startRow, 1, rows.length, targetLastCol).setValues(rows);
    applyDateColumnFormat_(target, targetColMap);
  }
  sortDataSheet_(target, targetColMap);
  Logger.log('合併 ' + rows.length + ' 筆紀錄到「' + DATA_SHEET_NAME + '」分頁');
}

// 讀表頭列，回傳 {欄位名稱: 1-based 欄位編號}，讀寫都靠這個對應表查位置，
// 不寫死欄位順序，之後 Sheet 欄位順序調整不會壞掉。
function getColumnMap_(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  headers.forEach(function (name, i) {
    if (name) map[name] = i + 1;
  });
  return map;
}

function formatDateCell_(raw) {
  if (raw instanceof Date) {
    return Utilities.formatDate(raw, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  }
  return raw ? String(raw) : '';
}

function rowToItem_(colMap, rowValues) {
  var item = {};
  Object.keys(colMap).forEach(function (key) {
    var raw = rowValues[colMap[key] - 1];
    if (key === ID_HEADER) {
      item[ID_KEY] = raw === undefined || raw === null ? '' : String(raw);
    } else if (ARRAY_FIELDS.indexOf(key) !== -1) {
      item[key] = raw
        ? String(raw)
            .split(',')
            .map(function (s) {
              return s.trim();
            })
            .filter(function (s) {
              return s.length > 0;
            })
        : [];
    } else if (NUMBER_FIELDS.indexOf(key) !== -1 || key === '項次') {
      item[key] = Number(raw) || 0;
    } else if (BOOLEAN_FIELDS.indexOf(key) !== -1) {
      item[key] = raw === true || String(raw).toUpperCase() === 'TRUE';
    } else if (DATE_FIELDS.indexOf(key) !== -1) {
      item[key] = formatDateCell_(raw);
    } else {
      item[key] = raw === undefined || raw === null ? '' : String(raw);
    }
  });
  return item;
}

function itemToRow_(colMap, headerCount, item) {
  var row = new Array(headerCount).fill('');
  Object.keys(colMap).forEach(function (key) {
    var itemKey = key === ID_HEADER ? ID_KEY : key;
    if (!(itemKey in item)) return;
    var col = colMap[key];
    var value = item[itemKey];
    if (ARRAY_FIELDS.indexOf(key) !== -1) {
      row[col - 1] = Array.isArray(value) ? value.join(',') : '';
    } else if (BOOLEAN_FIELDS.indexOf(key) !== -1) {
      row[col - 1] = value ? 'TRUE' : 'FALSE';
    } else {
      row[col - 1] = value === undefined || value === null ? '' : value;
    }
  });
  return row;
}

function findRowById_(sheet, colMap, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var idCol = colMap[ID_HEADER];
  var ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2; // 實際列號，1-based，跳過表頭
  }
  return -1;
}

/**
 * 讀出「工作日期」符合 matchDate 的未刪除紀錄，回傳 [{ rowNumber, item }]。
 * 只先讀「工作日期」一欄找出符合的列，再讀那段範圍（分頁照工作日期排序，同一天的列是連在一起的），
 * 不用每次都把整張分頁讀出來，資料變多也只多讀一欄
 */
function readRowsByDate_(sheet, colMap, matchDate) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2 || !colMap.工作日期) return [];
  var dates = sheet.getRange(2, colMap.工作日期, lastRow - 1, 1).getValues();
  var first = -1;
  var last = -1;
  dates.forEach(function (row, i) {
    if (!matchDate(formatDateCell_(row[0]))) return;
    if (first === -1) first = i;
    last = i;
  });
  if (first === -1) return [];

  var result = [];
  sheet
    .getRange(first + 2, 1, last - first + 1, sheet.getLastColumn())
    .getValues()
    .forEach(function (row, offset) {
      var item = rowToItem_(colMap, row);
      if (!matchDate(item.工作日期) || item.已刪除) return;
      result.push({ rowNumber: first + offset + 2, item: item });
    });
  return result;
}

function readDay_(sheet, colMap, date) {
  return readRowsByDate_(sheet, colMap, function (d) {
    return d === date;
  });
}

// 項次是「每天」從 1 開始的流水號：同一工作日期、未刪除紀錄的最大項次 + 1。
// 用最大值不用筆數，刪掉中間某筆（例如剩 1、3）後新增才不會撞號。
// dayRows 是 readDay_ 的結果（已排除已刪除的紀錄）。
// 前端 useWorkItems.ts 的 fetchDaySummary 用同一套規則算預計項次，改這裡要一起改。
function getNextDailyIndex_(dayRows) {
  var max = 0;
  dayRows.forEach(function (entry) {
    if (entry.item.項次 > max) max = entry.item.項次;
  });
  return max + 1;
}

// 某一天（dayRows 是 readDay_ 的結果）id 不等於 excludeId 的今日工時合計（編輯時排除自己）。
// 前端 useWorkItems.ts 的 fetchDaySummary 用同一套規則算 otherHours，改這裡要一起改。
function getDayHoursExcluding_(dayRows, excludeId) {
  var total = 0;
  dayRows.forEach(function (entry) {
    if (entry.item[ID_KEY] !== excludeId) total += Number(entry.item.今日工時) || 0;
  });
  return total;
}

// 時數都是 0.25 的倍數，四捨五入到小數兩位避免浮點誤差
function roundHours_(n) {
  return Math.round(n * 100) / 100;
}

// 訊息格式跟前端 src/validation/work-item.ts 的 dailyHoursMessage 相同，改一邊要一起改
function dailyHoursError_(otherHours, hours) {
  return (
    '當天工時合計不可超過 ' + DAILY_HOURS_MAX + ' 小時（其他紀錄已 ' + roundHours_(otherHours) +
    ' 小時，已超出' + roundHours_(otherHours + hours - DAILY_HOURS_MAX) + '小時）'
  );
}

// ===== ID Token 驗證 =====

// 回傳驗證通過的 email，驗證失敗回傳 null。前端「允許清單」判斷只是體驗層，
// 這裡才是真正把關：驗證 token 有效、aud 是自己的 Client ID、email 是擁有者本人。
function verifyIdToken_(idToken) {
  if (!idToken) return null;
  var res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true },
  );
  if (res.getResponseCode() !== 200) return null;

  var payload = JSON.parse(res.getContentText());
  var clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  // 沒設定 GOOGLE_CLIENT_ID 一律拒絕：不檢查 aud 的話，別的網站發給擁有者帳號的 token 也會通過
  if (!clientId || payload.aud !== clientId) return null;
  if (payload.email !== OWNER_EMAIL) return null;
  if (payload.email_verified !== 'true' && payload.email_verified !== true) return null;

  return payload.email;
}

// ===== 欄位驗證（跟前端 src/validation/work-item.ts 同一套規則，防止繞過前端直接打 API） =====

var API_DATE_PATTERN = /^\d{4}\/\d{2}\/\d{2}$/;

function isBlank_(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function validateTextField_(rule, value) {
  if (isBlank_(value)) {
    if (!rule.required) return null;
    return (rule.kind === 'select' ? '請選擇' : '請填寫') + rule.label;
  }
  if (rule.maxLength && String(value).trim().length > rule.maxLength) {
    return rule.label + '不可超過 ' + rule.maxLength + ' 字';
  }
  return null;
}

function validateTagsField_(rule, value) {
  var tags = (Array.isArray(value) ? value : [])
    .map(function (tag) {
      return String(tag).trim();
    })
    .filter(function (tag) {
      return tag.length > 0;
    });
  if (tags.length === 0) return rule.required ? '請選擇' + rule.label : null;
  if (rule.maxItems && tags.length > rule.maxItems) {
    return rule.label + ' 最多 ' + rule.maxItems + ' 個';
  }
  var tooLong = tags.some(function (tag) {
    return tag.length > rule.maxLength;
  });
  if (rule.maxLength && tooLong) return '每個' + rule.label + ' 不可超過 ' + rule.maxLength + ' 字';
  // Sheet 用逗號把多個 Repo 串成一格存，名稱本身含逗號讀回來會被拆開
  var forbidden = (rule.forbiddenChars || '').split('');
  var hasForbidden = tags.some(function (tag) {
    return forbidden.some(function (char) {
      return tag.indexOf(char) !== -1;
    });
  });
  if (hasForbidden) return rule.label + ' 不可包含「' + forbidden.join('') + '」';
  return null;
}

function validateNumberField_(rule, value) {
  // 選填數字欄位沒給值時用預設值，不算錯誤
  if (isBlank_(value)) return rule.required ? '請填寫' + rule.label : null;
  var num = Number(value);
  if (isNaN(num)) return rule.label + '需為數字';
  if (num < rule.min || num > rule.max) return rule.label + '需介於 ' + rule.min + '–' + rule.max;
  if (rule.step && Math.abs(num / rule.step - Math.round(num / rule.step)) > 1e-9) {
    return rule.step === 1 ? rule.label + '需為整數' : rule.label + '需為 ' + rule.step + ' 的倍數';
  }
  return null;
}

function validateDateField_(rule, value) {
  if (isBlank_(value)) return rule.required ? '請選擇' + rule.label : null;
  // 2/30、4/31、平年 2/29 這類不存在的日期也算格式不正確（apiDateToUtc_ 回 NaN），
  // 跟前端 src/validation/work-item.ts 的 isExistingDate 同一套規則
  if (isNaN(apiDateToUtc_(value))) return rule.label + '格式不正確';
  var year = Number(String(value).slice(0, 4));
  if (year < rule.minYear || year > rule.maxYear) {
    return rule.label + '的年份需介於 ' + rule.minYear + '–' + rule.maxYear;
  }
  return null;
}

function validateStatusField_(rule, value) {
  if (isBlank_(value)) return rule.required ? '請選擇' + rule.label : null;
  return STATUS_OPTIONS.indexOf(String(value)) === -1 ? '請選擇' + rule.label : null;
}

function isLeaveItem_(item) {
  return item && item.狀態 === LEAVE_RULES.status;
}

// 請假列：固定欄位一律覆蓋成 LEAVE_RULES.fixed，回傳新物件
function applyLeaveFixedValues_(item) {
  if (!isLeaveItem_(item)) return item;
  return Object.assign({}, item, LEAVE_RULES.fixed, { 專案Repo: [] });
}

// 請假列跟工作紀錄用不同的規則；工作紀錄的狀態不在 STATUS_OPTIONS 裡（包含「休假」）會被擋下，
// 所以一般工作紀錄沒辦法冒用請假的狀態
function validateItem_(item) {
  var leave = isLeaveItem_(item);
  var rules = leave ? LEAVE_RULES.fields : VALIDATION_RULES;
  var errors = [];
  Object.keys(rules).forEach(function (field) {
    var rule = rules[field];
    var value = item[field];
    var message;
    if (rule.kind === 'leaveType') {
      message = LEAVE_RULES.types.indexOf(String(value)) === -1 ? '請選擇' + rule.label : null;
    } else if (rule.kind === 'tags') message = validateTagsField_(rule, value);
    else if (rule.kind === 'number') message = validateNumberField_(rule, value);
    else if (rule.kind === 'date') message = validateDateField_(rule, value);
    else if (rule.kind === 'status') message = validateStatusField_(rule, value);
    else message = validateTextField_(rule, value);
    if (message) errors.push(message);
  });
  return errors;
}

// ===== 選項清單 =====

function getOptions_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(OPTIONS_SHEET_NAME);
  var result = {};
  OPTION_CATEGORIES.forEach(function (c) {
    result[c] = [];
  });
  if (!sheet) return result;

  var colMap = getColumnMap_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return result;
  var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  OPTION_CATEGORIES.forEach(function (category) {
    var col = colMap[category];
    if (!col) return;
    var seen = {};
    var list = [];
    values.forEach(function (row) {
      var v = row[col - 1];
      if (v && !seen[v]) {
        seen[v] = true;
        list.push(String(v));
      }
    });
    result[category] = list;
  });
  return result;
}

// 近期紀錄（前端表單的下拉推薦、填完工作目標後預填用，使用者決定）：近 RECENT_DAYS 天、排除請假的紀錄，
// 只回傳推薦／預填用得到的欄位。這裡只負責撈資料，「最近一筆」怎麼找、怎麼推薦都在前端
// src/utils/recent-history.ts；天數與排除請假的規則要跟那邊的 RECENT_DAYS／filterRecentItems 一致
var RECENT_DAYS = 30;
var RECENT_ITEM_FIELDS = [
  ID_KEY,
  '工作日期',
  '項次',
  '交辦單位',
  '交辦人員',
  '專案名稱',
  '專案Repo',
  '工作目標',
  '預計期限',
  '完成度',
  '狀態',
];

function getRecentItems_() {
  var tz = Session.getScriptTimeZone();
  var cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RECENT_DAYS);
  var cutoff = Utilities.formatDate(cutoffDate, tz, 'yyyy/MM/dd');

  var sheet = getDataSheet_();
  if (!sheet) return [];
  var result = readRowsByDate_(sheet, getColumnMap_(sheet), function (d) {
    return d >= cutoff;
  })
    .filter(function (entry) {
      return !isLeaveItem_(entry.item);
    })
    .map(function (entry) {
      var picked = {};
      RECENT_ITEM_FIELDS.forEach(function (field) {
        picked[field] = entry.item[field];
      });
      return picked;
    });
  return result;
}

// 新增/編輯工作紀錄時，把新的交辦單位/人員/專案名稱/Repo 寫回選項清單；
// 請假列的固定值（人事室、--、休假）不寫回，避免出現在一般工作紀錄的下拉選單
function syncOptionsFromItem_(item) {
  if (isLeaveItem_(item)) return;
  addOptionIfNew_('交辦單位', item.交辦單位);
  addOptionIfNew_('交辦人員', item.交辦人員);
  addOptionIfNew_('專案名稱', item.專案名稱);
  (item.專案Repo || []).forEach(function (repo) {
    addOptionIfNew_('專案Repo', repo);
  });
}

function addOptionIfNew_(category, value) {
  var key = optionKey_(value);
  if (!key) return;
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(OPTIONS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(OPTIONS_SHEET_NAME);
    sheet.getRange(1, 1, 1, OPTION_CATEGORIES.length).setValues([OPTION_CATEGORIES]);
  }
  var col = getColumnMap_(sheet)[category];
  if (!col) return;

  var column = readOptionColumn_(sheet, col);
  if (column.list.indexOf(key) !== -1) return;
  column.list.push(key);
  writeOptionColumn_(sheet, col, column);
}

// 選項值一律當文字比對：Google Sheet 會把「11111」這類純數字自動轉成數字，
// 直接用 === 或 indexOf 跟前端送來的字串比對會對不上（造成重複新增、刪不掉／改不了）
function optionKey_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

/**
 * 讀取選項清單某個分類欄位（第 2 列起），回傳去掉空白、去掉重複、轉成文字的清單，
 * 以及這一欄目前用到的列數（寫回時要把多出來的舊儲存格清掉）
 */
function readOptionColumn_(sheet, col) {
  var lastRow = sheet.getLastRow();
  var height = Math.max(lastRow - 1, 0);
  var list = [];
  if (height > 0) {
    sheet
      .getRange(2, col, height, 1)
      .getValues()
      .forEach(function (row) {
        var key = optionKey_(row[0]);
        if (key && list.indexOf(key) === -1) list.push(key);
      });
  }
  return { list: list, height: height };
}

/**
 * 把清單從第 2 列起連續寫回該分類欄位，下面多出來的舊儲存格清空，所以每一欄都是
 * 從上往下連續、中間不留空白（各分類欄位彼此獨立，只動這一欄，不影響其他欄）。
 * 儲存格設成純文字格式，避免「11111」「0123」這類值被 Google Sheet 轉成數字
 */
function writeOptionColumn_(sheet, col, column) {
  var height = Math.max(column.height, column.list.length);
  if (height === 0) return;
  var values = [];
  for (var i = 0; i < height; i++) {
    values.push([i < column.list.length ? column.list[i] : '']);
  }
  var range = sheet.getRange(2, col, height, 1);
  range.setNumberFormat('@');
  range.setValues(values);
}

// 一次性整理函式：在 Apps Script 編輯器手動執行一次，把「選項清單」每個分類欄位
// 往上補齊（去掉中間的空白格）、去掉重複值（例如被轉成數字後重複新增的「11111」），
// 原本的先後順序與表頭不變。整理過後新增／刪除都會維持連續，不需要再執行；重複執行也沒有副作用
function compactOptionsSheet() {
  var sheet = getSpreadsheet_().getSheetByName(OPTIONS_SHEET_NAME);
  if (!sheet) return;
  var colMap = getColumnMap_(sheet);
  OPTION_CATEGORIES.forEach(function (category) {
    var col = colMap[category];
    if (!col) return;
    writeOptionColumn_(sheet, col, readOptionColumn_(sheet, col));
  });
}

// ===== 工時設定（前端「工具 → 工時設定」，表單的工作時段換算用） =====

// HH:mm 轉成分鐘數，空白或格式不對回 null
function parseTime_(value) {
  var match = TIME_PATTERN.exec(value === undefined || value === null ? '' : String(value));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

// 儲存格轉回 HH:mm：正常是純文字；被 Sheet 轉成時間值時讀到的是 Date，
// 用試算表本身的時區格式化（Sheet 把時間轉成 Date 也是用這個時區）
function formatTimeCell_(raw, timeZone) {
  if (raw instanceof Date) return Utilities.formatDate(raw, timeZone, 'HH:mm');
  return raw === undefined || raw === null ? '' : String(raw).trim();
}

// 驗證規則與訊息跟前端 src/utils/work-hours.ts 的 validateWorkHoursSetting 相同，改一邊要一起改
function validateWorkHours_(setting) {
  if (!setting || typeof setting !== 'object') return '工時設定格式不正確';
  if (isBlank_(setting.start)) return '請填寫上班時間';
  if (isBlank_(setting.end)) return '請填寫下班時間';
  var start = parseTime_(setting.start);
  var end = parseTime_(setting.end);
  if (start === null) return '上班時間格式不正確';
  if (end === null) return '下班時間格式不正確';

  var hasBreakStart = !isBlank_(setting.breakStart);
  var hasBreakEnd = !isBlank_(setting.breakEnd);
  if (hasBreakStart !== hasBreakEnd) return '午休時間需填寫開始與結束';
  var breakMinutes = 0;
  if (hasBreakStart) {
    var breakStart = parseTime_(setting.breakStart);
    var breakEnd = parseTime_(setting.breakEnd);
    if (breakStart === null || breakEnd === null) return '午休時間格式不正確';
    if (!(start < breakStart && breakStart < breakEnd && breakEnd < end)) {
      return '時間順序需為：上班時間 → 午休開始 → 午休結束 → 下班時間';
    }
    breakMinutes = breakEnd - breakStart;
  } else if (end <= start) {
    return '下班時間需晚於上班時間';
  }

  var total = roundHours_((end - start - breakMinutes) / 60);
  if (total !== WORK_HOURS_DAILY_STANDARD) {
    return '每日工時需剛好 ' + WORK_HOURS_DAILY_STANDARD + ' 小時（目前 ' + total + ' 小時）';
  }
  return null;
}

// 讀取工時設定，沒有設定（分頁或欄位不存在、上下班空白）或設定不合法時回 null
function getWorkHours_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(OPTIONS_SHEET_NAME);
  if (!sheet) return null;
  var col = getColumnMap_(sheet)[WORK_HOURS_HEADER];
  if (!col) return null;

  var timeZone = ss.getSpreadsheetTimeZone();
  var values = sheet.getRange(2, col, WORK_HOURS_FIELDS.length, 1).getValues();
  var setting = {};
  WORK_HOURS_FIELDS.forEach(function (field, i) {
    var value = formatTimeCell_(values[i][0], timeZone);
    if (value) setting[field] = value;
  });
  if (!setting.start || !setting.end || validateWorkHours_(setting)) return null;
  return setting;
}

// 儲存工時設定（workHours 為 null 代表清除）：「工時設定」欄不存在就在最後面加一欄表頭，
// 第 2～5 列寫入上班、下班、午休開始、午休結束，儲存格設成純文字，避免 08:30 被轉成時間值
function handleSaveWorkHours_(workHours) {
  if (workHours !== null) {
    var error = validateWorkHours_(workHours);
    if (error) return jsonOutput_({ error: error });
  }

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(OPTIONS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(OPTIONS_SHEET_NAME);
    sheet.getRange(1, 1, 1, OPTION_CATEGORIES.length).setValues([OPTION_CATEGORIES]);
  }
  var col = getColumnMap_(sheet)[WORK_HOURS_HEADER];
  if (!col) {
    col = sheet.getLastColumn() + 1;
    if (col > sheet.getMaxColumns()) sheet.insertColumnAfter(sheet.getMaxColumns());
    sheet.getRange(1, col).setValue(WORK_HOURS_HEADER);
  }

  ensureRows_(sheet, WORK_HOURS_FIELDS.length + 1);
  var values = WORK_HOURS_FIELDS.map(function (field) {
    var value = workHours ? workHours[field] : '';
    return [isBlank_(value) ? '' : String(value).trim()];
  });
  var range = sheet.getRange(2, col, WORK_HOURS_FIELDS.length, 1);
  range.setNumberFormat('@');
  range.setValues(values);
  return jsonOutput_({ workHours: getWorkHours_() });
}

// ===== doGet =====

// 匯出 Excel（type=range）一次最多可讀的天數（含頭尾），閏年整年 366 天剛好放得下
var RANGE_MAX_DAYS = 366;

// YYYY/MM/DD 轉成 UTC 午夜的毫秒數，只用來算兩個日期差幾天；格式或日期本身不合法回 NaN
function apiDateToUtc_(value) {
  if (!API_DATE_PATTERN.test(String(value))) return NaN;
  var parts = String(value).split('/').map(Number);
  var time = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  var check = new Date(time);
  // 2026/02/30 這類不存在的日期，Date.UTC 會自動進位成 3 月，比對回去對不上就是不合法
  if (check.getUTCMonth() !== parts[1] - 1 || check.getUTCDate() !== parts[2]) return NaN;
  return time;
}

// 讀出 from～to（含頭尾）的未刪除紀錄（含請假），給前端「匯出 Excel」用
function handleRange_(from, to) {
  var fromTime = apiDateToUtc_(from);
  var toTime = apiDateToUtc_(to);
  if (isNaN(fromTime) || isNaN(toTime)) {
    return jsonOutput_({ error: 'from／to 日期格式不正確' });
  }
  if (fromTime > toTime) {
    return jsonOutput_({ error: '開始日期不能晚於結束日期' });
  }
  var days = Math.round((toTime - fromTime) / 86400000) + 1;
  if (days > RANGE_MAX_DAYS) {
    return jsonOutput_({ error: '日期範圍不可超過 ' + RANGE_MAX_DAYS + ' 天' });
  }

  var sheet = getDataSheet_();
  if (!sheet) return jsonOutput_({ items: [] });

  // YYYY/MM/DD 補零固定長度，字串可以直接比大小
  var items = readRowsByDate_(sheet, getColumnMap_(sheet), function (d) {
    return d >= from && d <= to;
  }).map(function (entry) {
    return entry.item;
  });
  return jsonOutput_({ items: items });
}

// ===== 搜尋（type=search）=====
// 前端搜尋欄按下搜尋（Enter、搜尋按鈕、點推薦）時查全部資料（使用者決定）。比對規則跟前端
// src/utils/search-work-items.ts 的 matchesSearch 一致（手動同步），改一處要一起改：
// - 沒帶 field：交辦單位、交辦人員、專案名稱、專案Repo（#AAA）、工作目標、處理內容、狀態，
//   用空白隔開的每個關鍵字都要出現（AND），不分大小寫
// - 帶 field（點推薦）：交辦單位／交辦人員／專案名稱完全相同；專案Repo 包含那一個；工作目標包含那段文字
// 結果照「工作日期新的在前、同一天照項次」排序，最多回傳 SEARCH_MAX_RESULTS 筆，total 是全部符合的筆數
var SEARCH_FIELDS = ['交辦單位', '交辦人員', '專案名稱', '專案Repo', '工作目標'];
var SEARCH_KEYWORD_MAX = 100;
var SEARCH_MAX_RESULTS = 200;

function normalizeSearch_(value) {
  return String(value === undefined || value === null ? '' : value)
    .trim()
    .toLowerCase();
}

function matchesSearch_(item, keyword, field) {
  if (field === '交辦單位' || field === '交辦人員' || field === '專案名稱') {
    return normalizeSearch_(item[field]) === keyword;
  }
  if (field === '專案Repo') {
    return (item.專案Repo || []).some(function (repo) {
      return normalizeSearch_(repo) === keyword;
    });
  }
  if (field === '工作目標') {
    return normalizeSearch_(item.工作目標).indexOf(keyword) !== -1;
  }
  var text = [item.交辦單位, item.交辦人員, item.專案名稱]
    .concat(
      (item.專案Repo || []).map(function (repo) {
        return '#' + repo;
      }),
    )
    .concat([item.工作目標, item.處理內容, item.狀態])
    .join('\n')
    .toLowerCase();
  return keyword
    .split(/\s+/)
    .filter(function (word) {
      return word.length > 0;
    })
    .every(function (word) {
      return text.indexOf(word) !== -1;
    });
}

function handleSearch_(q, field) {
  var keyword = normalizeSearch_(q);
  if (!keyword) return jsonOutput_({ error: '請輸入搜尋關鍵字' });
  if (keyword.length > SEARCH_KEYWORD_MAX) {
    return jsonOutput_({ error: '搜尋關鍵字不可超過 ' + SEARCH_KEYWORD_MAX + ' 字' });
  }
  if (field && SEARCH_FIELDS.indexOf(field) === -1) {
    return jsonOutput_({ error: '不支援的搜尋欄位' });
  }

  var sheet = getDataSheet_();
  if (!sheet || sheet.getLastRow() < 2) return jsonOutput_({ items: [], total: 0 });

  var colMap = getColumnMap_(sheet);
  var matched = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
    .getValues()
    .map(function (row) {
      return rowToItem_(colMap, row);
    })
    .filter(function (item) {
      return !item.已刪除 && matchesSearch_(item, keyword, field);
    })
    .sort(function (a, b) {
      // YYYY/MM/DD 補零固定長度，字串可以直接比大小
      if (a.工作日期 !== b.工作日期) return a.工作日期 < b.工作日期 ? 1 : -1;
      return a.項次 - b.項次;
    });
  return jsonOutput_({ items: matched.slice(0, SEARCH_MAX_RESULTS), total: matched.length });
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  try {
    if (params.type === 'options') {
      return jsonOutput_({
        options: getOptions_(),
        recentItems: getRecentItems_(),
        workHours: getWorkHours_(),
      });
    }

    if (params.type === 'range') {
      return handleRange_(params.from, params.to);
    }

    if (params.type === 'search') {
      return handleSearch_(params.q, params.field);
    }

    var date = params.date;
    if (!date) {
      return jsonOutput_({ error: '缺少 date 參數' });
    }

    var sheet = getDataSheet_();
    if (!sheet) return jsonOutput_({ items: [] });

    var items = readDay_(sheet, getColumnMap_(sheet), date).map(function (entry) {
      return entry.item;
    });

    return jsonOutput_({ items: items });
  } catch (err) {
    return jsonOutput_({ error: String(err) });
  }
}

// ===== doPost =====

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var email = verifyIdToken_(body.idToken);
    if (!email) {
      // code 給前端判斷錯誤類型（登入錯誤要強制登出回唯讀模式），不要靠比對 error 文字
      return jsonOutput_({ error: '未登入或無權限', code: 'UNAUTHORIZED' });
    }

    if (body.action === 'create') return handleCreate_(body.item);
    if (body.action === 'batchCreate') return handleBatchCreate_(body.items, body.replace === true);
    if (body.action === 'update') return handleUpdate_(body.id, body.item);
    if (body.action === 'delete') return handleDelete_(body.id);
    if (body.action === 'reorder') return handleReorder_(body.date, body.ids);
    if (body.action === 'addOption') return handleAddOption_(body.category, body.value);
    if (body.action === 'renameOption') {
      return handleRenameOption_(body.category, body.oldValue, body.newValue);
    }
    if (body.action === 'deleteOption') return handleDeleteOption_(body.category, body.value);
    if (body.action === 'saveWorkHours') {
      return handleSaveWorkHours_(body.workHours === undefined ? null : body.workHours);
    }

    return jsonOutput_({ error: '未知的 action' });
  } catch (err) {
    return jsonOutput_({ error: String(err) });
  }
}

function handleCreate_(item) {
  item = applyLeaveFixedValues_(item);
  var errors = validateItem_(item);
  if (errors.length > 0) {
    return jsonOutput_({ error: errors.join('；') });
  }

  var sheet = getOrCreateDataSheet_();
  var colMap = getColumnMap_(sheet);
  var dayRows = readDay_(sheet, colMap, item.工作日期);

  var dayHours = getDayHoursExcluding_(dayRows, null);
  var itemHours = Number(item.今日工時) || 0;
  if (dayHours + itemHours > DAILY_HOURS_MAX) {
    return jsonOutput_({ error: dailyHoursError_(dayHours, itemHours) });
  }

  // 項次一律由後端決定，前端就算送了也會被這裡覆蓋
  var created = Object.assign({}, item, {
    id: Utilities.getUuid(),
    項次: getNextDailyIndex_(dayRows),
    已刪除: false,
  });

  var row = itemToRow_(colMap, sheet.getLastColumn(), created);
  var newRow = sheet.getLastRow() + 1;
  ensureRows_(sheet, newRow);
  applyTextFormat_(sheet, colMap, newRow, 1);
  sheet.getRange(newRow, 1, 1, row.length).setValues([row]);
  sortDataSheet_(sheet, colMap);

  syncOptionsFromItem_(created);

  return jsonOutput_({ item: created });
}

// 一次新增多筆（前端「複製本日」用）：全部先驗證，任何一筆不合格、或任何一天的工時合計
// （既有紀錄＋這批）超過 DAILY_HOURS_MAX，就整批退回、不寫入任何一筆。
// 項次依陣列順序、照每日編號規則接續；新值同步寫回選項清單（請假列一樣略過）。
// replace 為 true 時（「複製本日」覆蓋目標日）：工時合計只算這批，驗證全部通過後，先把這批涉及的
// 工作日期原本的紀錄（含請假）搬到「已刪除紀錄」分頁，再寫入，所以新紀錄從 1 開始編號。
function handleBatchCreate_(items, replace) {
  if (!Array.isArray(items) || items.length === 0) {
    return jsonOutput_({ error: '沒有要新增的紀錄' });
  }

  var prepared = items.map(function (item) {
    return applyLeaveFixedValues_(item);
  });
  var errors = [];
  prepared.forEach(function (item, i) {
    var itemErrors = validateItem_(item);
    if (itemErrors.length > 0) errors.push('第 ' + (i + 1) + ' 筆：' + itemErrors.join('、'));
  });
  if (errors.length > 0) {
    return jsonOutput_({ error: errors.join('；') });
  }

  var sheet = getOrCreateDataSheet_();
  var colMap = getColumnMap_(sheet);

  // 依工作日期分組，每天各自檢查工時合計
  var days = {}; // 工作日期 -> { hours, nextIndex }
  prepared.forEach(function (item) {
    var date = item.工作日期;
    if (!days[date]) days[date] = { hours: 0, nextIndex: 1 };
    days[date].hours += Number(item.今日工時) || 0;
  });

  var dates = Object.keys(days);
  for (var i = 0; i < dates.length; i++) {
    var day = days[dates[i]];
    // 覆蓋模式原本的紀錄會被搬走，工時只算這批、項次從 1 開始，不用讀既有紀錄
    if (replace) {
      if (day.hours > DAILY_HOURS_MAX) {
        return jsonOutput_({ error: dailyHoursError_(0, day.hours) });
      }
      continue;
    }
    var dayRows = readDay_(sheet, colMap, dates[i]);
    var dayHours = getDayHoursExcluding_(dayRows, null);
    if (dayHours + day.hours > DAILY_HOURS_MAX) {
      return jsonOutput_({ error: dailyHoursError_(dayHours, day.hours) });
    }
    day.nextIndex = getNextDailyIndex_(dayRows);
  }

  // 驗證全部通過才開始動 Sheet：覆蓋模式先把原本的紀錄搬走（每天重新讀，前一天搬走後列號會變）
  var replacedCount = 0;
  if (replace) {
    dates.forEach(function (date) {
      replacedCount += moveDayRowsToDeleted_(sheet, colMap, date);
    });
  }

  var rows = [];
  var created = prepared.map(function (item) {
    var day = days[item.工作日期];
    var createdItem = Object.assign({}, item, {
      id: Utilities.getUuid(),
      項次: day.nextIndex,
      已刪除: false,
    });
    day.nextIndex += 1;
    rows.push(itemToRow_(colMap, sheet.getLastColumn(), createdItem));
    return createdItem;
  });

  var startRow = sheet.getLastRow() + 1;
  ensureRows_(sheet, startRow + rows.length - 1);
  applyTextFormat_(sheet, colMap, startRow, rows.length);
  sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
  sortDataSheet_(sheet, colMap);

  created.forEach(syncOptionsFromItem_);

  return jsonOutput_({ items: created, replaced: replacedCount });
}

// 把某一工作日期所有未刪除的紀錄（含請假）搬到「已刪除紀錄」分頁，回傳筆數
function moveDayRowsToDeleted_(sheet, colMap, date) {
  var rowNumbers = readDay_(sheet, colMap, date).map(function (entry) {
    return entry.rowNumber;
  });
  return moveRowsToDeletedSheet_(sheet, colMap, rowNumbers, new Date());
}

function handleUpdate_(id, itemPatch) {
  var sheet = getDataSheet_();
  if (!sheet) {
    return jsonOutput_({ error: '找不到這筆紀錄' });
  }

  var colMap = getColumnMap_(sheet);
  var rowIndex = findRowById_(sheet, colMap, id);
  if (rowIndex === -1) {
    return jsonOutput_({ error: '找不到這筆紀錄' });
  }

  var oldRowValues = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];
  var existing = rowToItem_(colMap, oldRowValues);
  // 項次一律由後端決定，忽略前端送來的值：工作日期沒改沿用原本的項次，改到別天下面再重新編號
  var merged = applyLeaveFixedValues_(
    Object.assign({}, existing, itemPatch, { id: id, 項次: existing.項次 }),
  );

  var errors = validateItem_(merged);
  if (errors.length > 0) {
    return jsonOutput_({ error: errors.join('；') });
  }

  // 每日工時合計用新的工作日期算（排除自己）；換天時這列還是舊日期，不會被算進新日期的最大項次
  var dayRows = readDay_(sheet, colMap, merged.工作日期);
  var dayHours = getDayHoursExcluding_(dayRows, id);
  var mergedHours = Number(merged.今日工時) || 0;
  if (dayHours + mergedHours > DAILY_HOURS_MAX) {
    return jsonOutput_({ error: dailyHoursError_(dayHours, mergedHours) });
  }
  if (merged.工作日期 !== existing.工作日期) merged.項次 = getNextDailyIndex_(dayRows);

  var row = itemToRow_(colMap, sheet.getLastColumn(), merged);
  applyTextFormat_(sheet, colMap, rowIndex, 1);
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  sortDataSheet_(sheet, colMap);

  syncOptionsFromItem_(merged);

  return jsonOutput_({ item: merged });
}

// 調整某一天的項次順序（前端上下移、拖曳用）：ids 是那天所有未刪除紀錄（含請假）依新順序排列的 id，
// 必須跟 Sheet 上那天未刪除的紀錄完全一致（不能多、不能少），不一致代表資料已被別處改過，整批退回、
// 不動 Sheet；通過後項次依順序改成 1、2、3…，已刪除的紀錄不動（已刪除的本來就不佔項次）
function handleReorder_(date, ids) {
  if (!date || !API_DATE_PATTERN.test(String(date))) {
    return jsonOutput_({ error: '工作日期格式不正確' });
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    return jsonOutput_({ error: '沒有要排序的紀錄' });
  }

  var sheet = getDataSheet_();
  if (!sheet) {
    return jsonOutput_({ error: '紀錄已變更，請重新整理後再排序' });
  }
  var colMap = getColumnMap_(sheet);

  var rowById = {}; // id -> 實際列號
  readDay_(sheet, colMap, date).forEach(function (entry) {
    rowById[entry.item[ID_KEY]] = entry.rowNumber;
  });

  var unique = {};
  var valid =
    ids.length === Object.keys(rowById).length &&
    ids.every(function (id) {
      if (unique[id] || !rowById[id]) return false;
      unique[id] = true;
      return true;
    });
  if (!valid) {
    return jsonOutput_({ error: '紀錄已變更，請重新整理後再排序' });
  }

  ids.forEach(function (id, i) {
    sheet.getRange(rowById[id], colMap.項次).setValue(i + 1);
  });
  sortDataSheet_(sheet, colMap);
  return jsonOutput_({ ok: true });
}

function handleDelete_(id) {
  var sheet = getDataSheet_();
  if (!sheet) {
    return jsonOutput_({ error: '找不到這筆紀錄' });
  }

  var colMap = getColumnMap_(sheet);
  var rowIndex = findRowById_(sheet, colMap, id);
  if (rowIndex === -1) {
    return jsonOutput_({ error: '找不到這筆紀錄' });
  }

  // 整列搬到「已刪除紀錄」分頁並記錄刪除時間；要復原時把那列搬回工作紀錄分頁即可
  moveRowsToDeletedSheet_(sheet, colMap, [rowIndex], new Date());
  return jsonOutput_({ ok: true });
}

// ===== 選項清單管理（新增/重新命名/刪除，前端「管理選項清單」對話框用） =====
//
// 重新命名/刪除只改「選項清單」分頁本身，不會回頭更新工作紀錄分頁裡已經寫入的
// 歷史紀錄——交辦單位/人員/專案名稱/專案Repo 存在每筆工作紀錄上是純文字，
// 不是靠這份清單做關聯查詢，前端 UI 上也要明顯提示這件事，避免使用者誤會。

function isValidOptionCategory_(category) {
  return OPTION_CATEGORIES.indexOf(category) !== -1;
}

function handleAddOption_(category, value) {
  if (!isValidOptionCategory_(category)) {
    return jsonOutput_({ error: '未知的選項分類' });
  }
  value = value ? String(value).trim() : '';
  if (!value) {
    return jsonOutput_({ error: '新增的值不可為空' });
  }
  addOptionIfNew_(category, value);
  return jsonOutput_({ options: getOptions_() });
}

function handleRenameOption_(category, oldValue, newValue) {
  if (!isValidOptionCategory_(category)) {
    return jsonOutput_({ error: '未知的選項分類' });
  }
  newValue = newValue ? String(newValue).trim() : '';
  if (!newValue) {
    return jsonOutput_({ error: '新名稱不可為空' });
  }

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(OPTIONS_SHEET_NAME);
  if (!sheet) {
    return jsonOutput_({ error: '選項清單尚未建立' });
  }

  var colMap = getColumnMap_(sheet);
  var col = colMap[category];
  if (!col) {
    return jsonOutput_({ error: '選項清單缺少這個分類欄位' });
  }

  var column = readOptionColumn_(sheet, col);
  var index = column.list.indexOf(optionKey_(oldValue));
  if (index === -1) {
    return jsonOutput_({ error: '找不到這個值' });
  }
  if (column.list.indexOf(newValue) !== -1) {
    return jsonOutput_({ error: '這個名稱已經存在' });
  }

  column.list[index] = newValue;
  writeOptionColumn_(sheet, col, column);
  return jsonOutput_({ options: getOptions_() });
}

function handleDeleteOption_(category, value) {
  if (!isValidOptionCategory_(category)) {
    return jsonOutput_({ error: '未知的選項分類' });
  }

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(OPTIONS_SHEET_NAME);
  if (!sheet) {
    return jsonOutput_({ error: '選項清單尚未建立' });
  }

  var colMap = getColumnMap_(sheet);
  var col = colMap[category];
  if (!col) {
    return jsonOutput_({ error: '選項清單缺少這個分類欄位' });
  }

  var column = readOptionColumn_(sheet, col);
  var index = column.list.indexOf(optionKey_(value));
  if (index === -1) {
    return jsonOutput_({ error: '找不到這個值' });
  }

  // 只動這個分類欄位：刪掉這個值，下面的值往上補（使用者決定），
  // 不整列刪除，同一列其他分類欄位的值不受影響
  column.list.splice(index, 1);
  writeOptionColumn_(sheet, col, column);
  return jsonOutput_({ options: getOptions_() });
}

// ===== 輸出工具 =====

// Apps Script 網頁應用程式的 doGet/doPost 回應沒辦法自訂 HTTP status code
// （平台限制，一律是 200），所以錯誤一律用回應內容裡的 error 欄位表達，
// 前端要檢查 body.error，不能只看 HTTP 狀態碼。
function jsonOutput_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
