/**
 * 「工作進度」Apps Script 後端。
 *
 * 部署前要做的事（見 CLAUDE.md「需要使用者事先準備的東西」）：
 *   1. 「專案設定」→「指令碼屬性」新增 SHEET_ID（這份試算表的 ID）
 *   2. 「專案設定」→「指令碼屬性」新增 GOOGLE_CLIENT_ID（前端 .env 那組，用來驗證 ID Token 的 aud）
 *   3. 部署為網頁應用程式（執行身分：我；存取權限：所有人）
 *   4. 執行一次 installTrigger()，安裝每月 1 號自動建立分頁的觸發器
 * 第 3、4 步第一次執行都會跳出 Google 授權畫面，屬於正常流程。
 */

// ===== 常數 =====

var OWNER_EMAIL = 'swzx00@gmail.com';
var OPTIONS_SHEET_NAME = '選項清單';
var OPTION_CATEGORIES = ['交辦單位', '交辦人員', '專案名稱', '專案Repo'];
var MONTH_SHEET_HEADERS = [
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
// 請假跟工作紀錄寫在同一個月份分頁，用「狀態」等於 LEAVE_RULES.status 區分；
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

// ===== Sheet 共用工具 =====

function getSheetId_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('尚未設定指令碼屬性 SHEET_ID');
  return id;
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(getSheetId_());
}

// 分頁命名慣例固定是 dash 的 YYYY-MM（跟日期欄位對前端的 YYYY/MM/DD 格式無關），
// 這裡先把斜線正規化成 dash 再切，才能正確從 YYYY/MM/DD 的工作日期字串換算出分頁名稱。
function getMonthKey_(dateStr) {
  return String(dateStr).replace(/\//g, '-').slice(0, 7); // YYYY-MM
}

// 「工作日期」「預計期限」欄位套用 yyyy/mm/dd 儲存格顯示格式，讓 Sheet 打開來看
// 跟 API 回傳的 YYYY/MM/DD 字串格式一致。套到整欄（含尚未寫入資料的列），
// 之後新增的列不用另外補設定。
function applyDateColumnFormat_(sheet, colMap) {
  DATE_FIELDS.forEach(function (field) {
    var col = colMap[field];
    if (!col) return;
    sheet.getRange(2, col, sheet.getMaxRows() - 1, 1).setNumberFormat('yyyy/mm/dd');
  });
}

function getOrCreateMonthSheet_(monthKey) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(monthKey);
  if (!sheet) {
    sheet = ss.insertSheet(monthKey);
    sheet.getRange(1, 1, 1, MONTH_SHEET_HEADERS.length).setValues([MONTH_SHEET_HEADERS]);
    sheet.setFrozenRows(1);
    applyDateColumnFormat_(sheet, getColumnMap_(sheet));
  }
  return sheet;
}

// 一次性遷移用：把已經存在的各月份分頁補上 applyDateColumnFormat_（新分頁走
// getOrCreateMonthSheet_ 會自動套用，但這支改動之前就已建立的分頁不會自動補上）。
// 用法同 installTrigger()：在 Apps Script 編輯器手動執行一次即可，之後不用再跑。
// 名稱不加結尾底線，理由同 renumberDailyIndexes()（私有函式不會出現在「執行」選單）。
function fixExistingMonthSheetDateFormats() {
  var ss = getSpreadsheet_();
  ss.getSheets().forEach(function (sheet) {
    if (!/^\d{4}-\d{2}$/.test(sheet.getName())) return;
    applyDateColumnFormat_(sheet, getColumnMap_(sheet));
  });
}

// 一次性遷移用：項次規則從「當月新增順序」改成「每天從 1 開始」，把既有資料重新編號。
// 每個月份分頁依工作日期分組，未刪除的紀錄照現有項次順序（同號再照列順序）重新編成 1、2、3；
// 已刪除的紀錄維持原號不動（畫面上看不到，新規則 getNextDailyIndex_ 也不會算進去）。
// 在 Apps Script 編輯器手動執行一次即可。函式名稱刻意不加結尾底線：結尾底線是
// Apps Script 的私有函式，不會出現在編輯器的「執行」選單裡，就沒辦法手動執行。
function renumberDailyIndexes() {
  var ss = getSpreadsheet_();
  ss.getSheets().forEach(function (sheet) {
    if (!/^\d{4}-\d{2}$/.test(sheet.getName())) return;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    var colMap = getColumnMap_(sheet);
    var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    var byDate = {};
    values.forEach(function (row, offset) {
      var item = rowToItem_(colMap, row);
      if (item.已刪除) return;
      if (!byDate[item.工作日期]) byDate[item.工作日期] = [];
      byDate[item.工作日期].push({ offset: offset, index: item.項次 });
    });

    // 整欄讀出來改完再一次寫回，避免逐格 setValue 太慢
    var indexColumn = values.map(function (row) {
      return [row[colMap.項次 - 1]];
    });
    Object.keys(byDate).forEach(function (date) {
      byDate[date]
        .sort(function (a, b) {
          return a.index - b.index || a.offset - b.offset;
        })
        .forEach(function (entry, n) {
          indexColumn[entry.offset][0] = n + 1;
        });
    });
    sheet.getRange(2, colMap.項次, indexColumn.length, 1).setValues(indexColumn);
  });
}

// 一次性遷移用：補上 ID 是空白的紀錄。修正前 handleCreate_ 產生的 UUID 放在 item.id，
// 但表頭是「ID」，對不上所以沒寫進 Sheet，那段期間新增的紀錄 ID 都是空的，編輯/刪除找不到列。
// 掃過所有月份分頁，只補空白的 ID，已有 ID 的不動。用法同 renumberDailyIndexes()，
// 在 Apps Script 編輯器手動執行一次即可（名稱不加結尾底線的理由也一樣）。
function fillMissingIds() {
  var ss = getSpreadsheet_();
  ss.getSheets().forEach(function (sheet) {
    if (!/^\d{4}-\d{2}$/.test(sheet.getName())) return;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    var idCol = getColumnMap_(sheet)[ID_HEADER];
    if (!idCol) return;
    var range = sheet.getRange(2, idCol, lastRow - 1, 1);
    var ids = range.getValues();
    var changed = false;
    ids.forEach(function (row) {
      if (!String(row[0]).trim()) {
        row[0] = Utilities.getUuid();
        changed = true;
      }
    });
    if (changed) range.setValues(ids);
  });
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

// 項次是「每天」從 1 開始的流水號：同一工作日期、未刪除紀錄的最大項次 + 1。
// 用最大值不用筆數，刪掉中間某筆（例如剩 1、3）後新增才不會撞號。
// 前端 useWorkItems.ts 的 fetchDaySummary 用同一套規則算預計項次，改這裡要一起改。
function getNextDailyIndex_(sheet, colMap, date) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;
  var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  var max = 0;
  values.forEach(function (row) {
    var item = rowToItem_(colMap, row);
    if (item.工作日期 === date && !item.已刪除 && item.項次 > max) max = item.項次;
  });
  return max + 1;
}

// 某一工作日期、未刪除、id 不等於 excludeId 的今日工時合計（編輯時排除自己）。
// 前端 useWorkItems.ts 的 fetchDaySummary 用同一套規則算 otherHours，改這裡要一起改。
function getDayHoursExcluding_(sheet, colMap, date, excludeId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  var total = 0;
  values.forEach(function (row) {
    var item = rowToItem_(colMap, row);
    if (item.工作日期 === date && !item.已刪除 && item[ID_KEY] !== excludeId) {
      total += Number(item.今日工時) || 0;
    }
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
  if (clientId && payload.aud !== clientId) return null;
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
  if (!API_DATE_PATTERN.test(String(value))) return rule.label + '格式不正確';
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
  if (!value) return;
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(OPTIONS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(OPTIONS_SHEET_NAME);
    sheet.getRange(1, 1, 1, OPTION_CATEGORIES.length).setValues([OPTION_CATEGORIES]);
  }
  var colMap = getColumnMap_(sheet);
  var col = colMap[category];
  if (!col) return;

  var lastRow = sheet.getLastRow();
  var existing =
    lastRow >= 2
      ? sheet
          .getRange(2, col, lastRow - 1, 1)
          .getValues()
          .map(function (r) {
            return r[0];
          })
      : [];
  if (existing.indexOf(value) !== -1) return;

  sheet.getRange(lastRow + 1, col).setValue(value);
}

// ===== doGet =====

function doGet(e) {
  var params = (e && e.parameter) || {};
  try {
    if (params.type === 'options') {
      return jsonOutput_({ options: getOptions_() });
    }

    var date = params.date;
    if (!date) {
      return jsonOutput_({ error: '缺少 date 參數' });
    }

    var monthKey = getMonthKey_(date);
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(monthKey);
    if (!sheet) {
      return jsonOutput_({ items: [] });
    }

    var colMap = getColumnMap_(sheet);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return jsonOutput_({ items: [] });

    var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    var items = values
      .map(function (row) {
        return rowToItem_(colMap, row);
      })
      .filter(function (item) {
        return item.工作日期 === date && !item.已刪除;
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
    if (body.action === 'update') return handleUpdate_(body.id, body.originalDate, body.item);
    if (body.action === 'delete') return handleDelete_(body.id, body.originalDate);
    if (body.action === 'reorder') return handleReorder_(body.date, body.ids);
    if (body.action === 'addOption') return handleAddOption_(body.category, body.value);
    if (body.action === 'renameOption') {
      return handleRenameOption_(body.category, body.oldValue, body.newValue);
    }
    if (body.action === 'deleteOption') return handleDeleteOption_(body.category, body.value);

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

  var monthKey = getMonthKey_(item.工作日期);
  var sheet = getOrCreateMonthSheet_(monthKey);
  var colMap = getColumnMap_(sheet);
  var lastRow = sheet.getLastRow();

  var dayHours = getDayHoursExcluding_(sheet, colMap, item.工作日期, null);
  var itemHours = Number(item.今日工時) || 0;
  if (dayHours + itemHours > DAILY_HOURS_MAX) {
    return jsonOutput_({ error: dailyHoursError_(dayHours, itemHours) });
  }

  // 項次一律由後端決定，前端就算送了也會被這裡覆蓋
  var created = Object.assign({}, item, {
    id: Utilities.getUuid(),
    項次: getNextDailyIndex_(sheet, colMap, item.工作日期),
    已刪除: false,
  });

  var row = itemToRow_(colMap, sheet.getLastColumn(), created);
  sheet.getRange(lastRow + 1, 1, 1, row.length).setValues([row]);

  syncOptionsFromItem_(created);

  return jsonOutput_({ item: created });
}

// 一次新增多筆（前端「複製本日」用）：全部先驗證，任何一筆不合格、或任何一天的工時合計
// （既有紀錄＋這批）超過 DAILY_HOURS_MAX，就整批退回、不寫入任何一筆。
// 項次依陣列順序、照每日編號規則接續；新值同步寫回選項清單（請假列一樣略過）。
// replace 為 true 時（「複製本日」覆蓋目標日）：工時合計只算這批，驗證全部通過後，先把這批涉及的
// 工作日期原本未刪除的紀錄（含請假）軟刪除，再寫入；已刪除的不佔項次，所以新紀錄從 1 開始編號。
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

  // 依工作日期分組：每天各自檢查工時合計，月份分頁共用同一份 sheet/colMap，最後一次寫入
  var sheets = {}; // monthKey -> { sheet, colMap, rows }
  var days = {}; // 工作日期 -> { target, hours, nextIndex }
  prepared.forEach(function (item) {
    var date = item.工作日期;
    if (!days[date]) {
      var monthKey = getMonthKey_(date);
      if (!sheets[monthKey]) {
        var sheet = getOrCreateMonthSheet_(monthKey);
        sheets[monthKey] = { sheet: sheet, colMap: getColumnMap_(sheet), rows: [] };
      }
      days[date] = { target: sheets[monthKey], hours: 0, nextIndex: 0 };
    }
    days[date].hours += Number(item.今日工時) || 0;
  });

  var dates = Object.keys(days);
  for (var i = 0; i < dates.length; i++) {
    var day = days[dates[i]];
    var dayHours = replace
      ? 0
      : getDayHoursExcluding_(day.target.sheet, day.target.colMap, dates[i], null);
    if (dayHours + day.hours > DAILY_HOURS_MAX) {
      return jsonOutput_({ error: dailyHoursError_(dayHours, day.hours) });
    }
  }

  // 驗證全部通過才開始動 Sheet：覆蓋模式先軟刪除，再算項次
  var replacedCount = 0;
  dates.forEach(function (date) {
    var day = days[date];
    if (replace) replacedCount += softDeleteDayRows_(day.target.sheet, day.target.colMap, date);
    day.nextIndex = getNextDailyIndex_(day.target.sheet, day.target.colMap, date);
  });

  var created = prepared.map(function (item) {
    var day = days[item.工作日期];
    var createdItem = Object.assign({}, item, {
      id: Utilities.getUuid(),
      項次: day.nextIndex,
      已刪除: false,
    });
    day.nextIndex += 1;
    var target = day.target;
    target.rows.push(itemToRow_(target.colMap, target.sheet.getLastColumn(), createdItem));
    return createdItem;
  });

  Object.keys(sheets).forEach(function (monthKey) {
    var target = sheets[monthKey];
    if (target.rows.length === 0) return;
    var startRow = target.sheet.getLastRow() + 1;
    target.sheet
      .getRange(startRow, 1, target.rows.length, target.rows[0].length)
      .setValues(target.rows);
  });

  created.forEach(syncOptionsFromItem_);

  return jsonOutput_({ items: created, replaced: replacedCount });
}

// 把某一工作日期所有未刪除的紀錄（含請假）標成已刪除，回傳筆數
function softDeleteDayRows_(sheet, colMap, date) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  var count = 0;
  values.forEach(function (row, i) {
    var item = rowToItem_(colMap, row);
    if (item.工作日期 === date && !item.已刪除) {
      sheet.getRange(i + 2, colMap.已刪除).setValue('TRUE');
      count += 1;
    }
  });
  return count;
}

function handleUpdate_(id, originalDate, itemPatch) {
  if (!originalDate) {
    return jsonOutput_({ error: '缺少 originalDate' });
  }

  var oldMonthKey = getMonthKey_(originalDate);
  var ss = getSpreadsheet_();
  var oldSheet = ss.getSheetByName(oldMonthKey);
  if (!oldSheet) {
    return jsonOutput_({ error: '找不到原本的月份分頁' });
  }

  var oldColMap = getColumnMap_(oldSheet);
  var rowIndex = findRowById_(oldSheet, oldColMap, id);
  if (rowIndex === -1) {
    return jsonOutput_({ error: '找不到這筆紀錄' });
  }

  var oldRowValues = oldSheet.getRange(rowIndex, 1, 1, oldSheet.getLastColumn()).getValues()[0];
  var existing = rowToItem_(oldColMap, oldRowValues);
  // 項次一律由後端決定，忽略前端送來的值：工作日期沒改沿用原本的項次，改到別天下面再重新編號
  var merged = applyLeaveFixedValues_(
    Object.assign({}, existing, itemPatch, { id: id, 項次: existing.項次 }),
  );
  var dateChanged = merged.工作日期 !== existing.工作日期;

  var errors = validateItem_(merged);
  if (errors.length > 0) {
    return jsonOutput_({ error: errors.join('；') });
  }

  var newMonthKey = getMonthKey_(merged.工作日期);
  var sameMonth = newMonthKey === oldMonthKey;

  // 每日工時合計：用目標月份分頁算（跨月要在刪舊列之前檢查，超過就什麼都不動）
  var targetSheet = sameMonth ? oldSheet : getOrCreateMonthSheet_(newMonthKey);
  var targetColMap = sameMonth ? oldColMap : getColumnMap_(targetSheet);
  var dayHours = getDayHoursExcluding_(targetSheet, targetColMap, merged.工作日期, id);
  var mergedHours = Number(merged.今日工時) || 0;
  if (dayHours + mergedHours > DAILY_HOURS_MAX) {
    return jsonOutput_({ error: dailyHoursError_(dayHours, mergedHours) });
  }

  if (sameMonth) {
    // 同月份換天：這列自己還是舊日期，不會被算進新日期的最大項次
    if (dateChanged) merged.項次 = getNextDailyIndex_(oldSheet, oldColMap, merged.工作日期);
    var row = itemToRow_(oldColMap, oldSheet.getLastColumn(), merged);
    oldSheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  } else {
    // 工作日期被改到別的月份：舊分頁刪掉這列、新分頁新增一列，確保一筆紀錄只存在一個分頁
    oldSheet.deleteRow(rowIndex);
    var newSheet = targetSheet;
    var newColMap = targetColMap;
    merged.項次 = getNextDailyIndex_(newSheet, newColMap, merged.工作日期);
    var newLastRow = newSheet.getLastRow();
    var newRow = itemToRow_(newColMap, newSheet.getLastColumn(), merged);
    newSheet.getRange(newLastRow + 1, 1, 1, newRow.length).setValues([newRow]);
  }

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

  var sheet = getSpreadsheet_().getSheetByName(getMonthKey_(date));
  if (!sheet) {
    return jsonOutput_({ error: '找不到月份分頁' });
  }
  var colMap = getColumnMap_(sheet);
  var lastRow = sheet.getLastRow();
  var values = lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  var rowById = {}; // id -> 實際列號
  values.forEach(function (row, i) {
    var item = rowToItem_(colMap, row);
    if (item.工作日期 === date && !item.已刪除) rowById[item[ID_KEY]] = i + 2;
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
  return jsonOutput_({ ok: true });
}

function handleDelete_(id, originalDate) {
  if (!originalDate) {
    return jsonOutput_({ error: '缺少 originalDate' });
  }

  var monthKey = getMonthKey_(originalDate);
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(monthKey);
  if (!sheet) {
    return jsonOutput_({ error: '找不到月份分頁' });
  }

  var colMap = getColumnMap_(sheet);
  var rowIndex = findRowById_(sheet, colMap, id);
  if (rowIndex === -1) {
    return jsonOutput_({ error: '找不到這筆紀錄' });
  }

  sheet.getRange(rowIndex, colMap.已刪除).setValue('TRUE');
  return jsonOutput_({ ok: true });
}

// ===== 選項清單管理（新增/重新命名/刪除，前端「管理選項清單」對話框用） =====
//
// 重新命名/刪除只改「選項清單」分頁本身，不會回頭更新各月份分頁裡已經寫入的
// 歷史紀錄——交辦單位/人員/專案名稱/專案Repo 存在每筆工作紀錄上是純文字，
// 不是靠這份清單做關聯查詢，前端 UI 上也要明顯提示這件事，避免使用者誤會。

function isValidOptionCategory_(category) {
  return OPTION_CATEGORIES.indexOf(category) !== -1;
}

function findOptionRowIndex_(values, value) {
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === value) return i;
  }
  return -1;
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

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return jsonOutput_({ error: '找不到這個值' });
  }

  var values = sheet.getRange(2, col, lastRow - 1, 1).getValues();
  var rowIndex = findOptionRowIndex_(values, oldValue);
  if (rowIndex === -1) {
    return jsonOutput_({ error: '找不到這個值' });
  }
  if (findOptionRowIndex_(values, newValue) !== -1) {
    return jsonOutput_({ error: '這個名稱已經存在' });
  }

  sheet.getRange(2 + rowIndex, col).setValue(newValue);
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

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return jsonOutput_({ error: '找不到這個值' });
  }

  var values = sheet.getRange(2, col, lastRow - 1, 1).getValues();
  var rowIndex = findOptionRowIndex_(values, value);
  if (rowIndex === -1) {
    return jsonOutput_({ error: '找不到這個值' });
  }

  // 只清空該格，不整列刪除：同一列其他分類欄位可能還有各自的值（每個分類欄位
  // 各自獨立，中間留空是正常狀態，getOptions_ 讀取時本來就會略過空白）
  sheet.getRange(2 + rowIndex, col).clearContent();
  return jsonOutput_({ options: getOptions_() });
}

// ===== 月份分頁自動建立（定時觸發器，見檔案開頭的部署步驟） =====

function ensureMonthlySheet() {
  var now = new Date();
  var monthKey = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM');
  getOrCreateMonthSheet_(monthKey);
}

// 一次性安裝函式：在 Apps Script 編輯器手動執行這個函式一次即可，
// 之後每月 1 號 00:00 會自動跑 ensureMonthlySheet()。重複執行不會裝出重複的觸發器
// （會先清掉舊的同名觸發器再裝新的）。
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'ensureMonthlySheet') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('ensureMonthlySheet').timeBased().onMonthDay(1).atHour(0).create();
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
