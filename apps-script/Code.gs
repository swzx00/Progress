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
var REQUIRED_FIELDS = ['交辦單位', '交辦人員', '專案名稱', '工作目標', '處理內容', '工作日期', '預計期限'];

// ===== Sheet 共用工具 =====

function getSheetId_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('尚未設定指令碼屬性 SHEET_ID');
  return id;
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(getSheetId_());
}

function getMonthKey_(dateStr) {
  return String(dateStr).slice(0, 7); // YYYY-MM
}

function getOrCreateMonthSheet_(monthKey) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(monthKey);
  if (!sheet) {
    sheet = ss.insertSheet(monthKey);
    sheet.getRange(1, 1, 1, MONTH_SHEET_HEADERS.length).setValues([MONTH_SHEET_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
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
    return Utilities.formatDate(raw, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return raw ? String(raw) : '';
}

function rowToItem_(colMap, rowValues) {
  var item = {};
  Object.keys(colMap).forEach(function (key) {
    var raw = rowValues[colMap[key] - 1];
    if (ARRAY_FIELDS.indexOf(key) !== -1) {
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
    if (!(key in item)) return;
    var col = colMap[key];
    var value = item[key];
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
  var idCol = colMap.ID;
  var ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2; // 實際列號，1-based，跳過表頭
  }
  return -1;
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

// ===== 欄位驗證（跟前端 WorkItemForm 的規則對齊，防止繞過前端直接打 API） =====

function validateItem_(item) {
  var errors = [];
  REQUIRED_FIELDS.forEach(function (field) {
    if (!item[field]) errors.push(field + ' 不可為空');
  });
  var hours = Number(item.今日工時);
  if (isNaN(hours) || hours < 0) errors.push('今日工時需為非負數');
  var progress = Number(item.完成度);
  if (isNaN(progress) || progress < 0 || progress > 100) errors.push('完成度需介於 0–100');
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
      return jsonOutput_({ error: '未登入或無權限' });
    }

    if (body.action === 'create') return handleCreate_(body.item);
    if (body.action === 'update') return handleUpdate_(body.id, body.originalDate, body.item);
    if (body.action === 'delete') return handleDelete_(body.id, body.originalDate);

    return jsonOutput_({ error: '未知的 action' });
  } catch (err) {
    return jsonOutput_({ error: String(err) });
  }
}

function handleCreate_(item) {
  var errors = validateItem_(item);
  if (errors.length > 0) {
    return jsonOutput_({ error: errors.join('；') });
  }

  var monthKey = getMonthKey_(item.工作日期);
  var sheet = getOrCreateMonthSheet_(monthKey);
  var colMap = getColumnMap_(sheet);
  var lastRow = sheet.getLastRow();
  var sequence = lastRow; // 扣掉表頭後的既有資料列數 = lastRow - 1，項次 = 資料列數 + 1 = lastRow

  var created = Object.assign({}, item, {
    id: Utilities.getUuid(),
    項次: sequence,
    已刪除: false,
  });

  var row = itemToRow_(colMap, sheet.getLastColumn(), created);
  sheet.getRange(lastRow + 1, 1, 1, row.length).setValues([row]);

  addOptionIfNew_('交辦單位', created.交辦單位);
  addOptionIfNew_('交辦人員', created.交辦人員);
  addOptionIfNew_('專案名稱', created.專案名稱);
  (created.專案Repo || []).forEach(function (repo) {
    addOptionIfNew_('專案Repo', repo);
  });

  return jsonOutput_({ item: created });
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
  var merged = Object.assign({}, existing, itemPatch, { id: id });

  var errors = validateItem_(merged);
  if (errors.length > 0) {
    return jsonOutput_({ error: errors.join('；') });
  }

  var newMonthKey = getMonthKey_(merged.工作日期);

  if (newMonthKey === oldMonthKey) {
    var row = itemToRow_(oldColMap, oldSheet.getLastColumn(), merged);
    oldSheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  } else {
    // 工作日期被改到別的月份：舊分頁刪掉這列、新分頁新增一列，確保一筆紀錄只存在一個分頁
    oldSheet.deleteRow(rowIndex);
    var newSheet = getOrCreateMonthSheet_(newMonthKey);
    var newColMap = getColumnMap_(newSheet);
    var newLastRow = newSheet.getLastRow();
    var newRow = itemToRow_(newColMap, newSheet.getLastColumn(), merged);
    newSheet.getRange(newLastRow + 1, 1, 1, newRow.length).setValues([newRow]);
  }

  addOptionIfNew_('交辦單位', merged.交辦單位);
  addOptionIfNew_('交辦人員', merged.交辦人員);
  addOptionIfNew_('專案名稱', merged.專案名稱);
  (merged.專案Repo || []).forEach(function (repo) {
    addOptionIfNew_('專案Repo', repo);
  });

  return jsonOutput_({ item: merged });
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
