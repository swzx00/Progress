/**
 * 一次性匯入：把舊版「工作進度-2026H1」「工作進度-2026H2」兩份試算表（每天一個分頁）的資料，
 * 轉換後覆蓋寫入本專案的「工作紀錄」與「選項清單」分頁，最後清空「已刪除紀錄」分頁。
 *
 * 使用方式（Apps Script 編輯器）：
 *   1. 新增指令碼檔案 LegacyImport.gs，貼上這份內容（跟 Code.gs 同一個專案，共用 Code.gs 的工具函式）
 *   2. 「執行」選單執行 previewLegacyImport()：只寫「匯入預覽」「匯入紀錄」兩個分頁，不動現有資料
 *   3. 確認預覽沒問題後，在 Drive 先建一份試算表副本，再執行 runLegacyImport() 正式匯入
 *   4. 匯入完成後可以把這個檔案刪掉
 * 本機測試：tests/apps-script/legacy-import.spec.ts（跟 Code.gs 一起載入，舊表換成假的試算表）
 * 函式名稱刻意不加結尾底線，才會出現在「執行」選單裡。
 *
 * 轉換規則（使用者決定）：
 *   - 工作日期：分頁名稱，H1 表算 2026 年 1–6 月、H2 表算 7–12 月；解析不出日期的分頁略過
 *   - 項次：原分頁的項次（空白時接在當天最大項次後面）；兩份表同一天都有分頁時，
 *     後讀到的分頁照原項次順序接在前一個分頁後面重新編號，不會出現重複的項次
 *   - 交辦單位＝單位、交辦人員＝交辦人員、專案名稱＝專案名稱、工作目標＝工作內容
 *   - 專案Repo：今日處理情形第一行只有英數字與 - _ / . 才算 Repo（有中文就不算），
 *     處理內容＝今日處理情形去掉這一行
 *   - 今日工時＝今日工時、完成度＝完成%、預計期限＝預計完成期限（不是日期就留空）
 *   - 狀態＝完成回報，依 LEGACY_STATUS_MAP 對應，對不上的填「待辦」
 *   - 工作內容提到請假／休假／特休／病假／事假：照請假規則寫入。只有今日處理情形提到的
 *     （例如「同事請假，代為處理」）仍當工作紀錄匯入，記在匯入紀錄裡給使用者確認，
 *     免得交辦單位、專案名稱這些欄位被請假的固定值蓋掉
 *   - 「項目欄」「待辦事項」分頁、沒有「工作內容」欄的分頁都略過
 *   - 選項清單只放實際用到的值（請假列不算），依使用次數多到少排列
 */

var LEGACY_SOURCES = [
  { id: '1dQuDzgtedByP8nsl-wUI_YP_VkV2Pa71t-UCrNAy3Pk', label: '2026H1', year: 2026, months: [1, 6] },
  { id: '1hGZx7uESs-aT0ldZdfOEr9tfZ11HbOcWmP1LM81FEDg', label: '2026H2', year: 2026, months: [7, 12] },
];
var LEGACY_IGNORED_SHEETS = ['項目欄', '待辦事項'];
var LEGACY_STATUS_MAP = {
  進行中: '進行中',
  完成: '前端完成',
  修改: '返修',
  待辦: '待辦',
  結案: '確認上線',
  暫緩: '暫緩',
};
var LEGACY_LEAVE_PATTERN = /請假|休假|特休|病假|事假/;
var LEGACY_REPO_LINE = /^[A-Za-z0-9_\-\/.]+$/;
var LEGACY_PREVIEW_SHEET = '匯入預覽';
var LEGACY_LOG_SHEET = '匯入紀錄';

function previewLegacyImport() {
  var result = buildLegacyImport_();
  var ss = getSpreadsheet_();
  var headers = DATA_SHEET_HEADERS.concat(['來源']);
  var colMap = {};
  headers.forEach(function (h, i) {
    colMap[h] = i + 1;
  });
  var rows = result.items.map(function (entry) {
    var row = itemToRow_(colMap, headers.length, entry.item);
    row[headers.length - 1] = entry.source;
    return row;
  });
  writeSheet_(ss, LEGACY_PREVIEW_SHEET, [headers].concat(rows), colMap);
  writeLegacyLog_(ss, result);
  Logger.log(result.summary.join('\n'));
}

function runLegacyImport() {
  var result = buildLegacyImport_();
  if (result.items.length === 0) throw new Error('沒有讀到任何紀錄，已取消匯入（現有資料沒有變動）');
  var ss = getSpreadsheet_();

  // 工作紀錄：清掉表頭以外的內容再寫入
  var sheet = getOrCreateDataSheet_();
  var colMap = getColumnMap_(sheet);
  var lastCol = sheet.getLastColumn();
  if (sheet.getLastRow() >= 2) sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).clearContent();
  var rows = result.items.map(function (entry) {
    return itemToRow_(colMap, lastCol, entry.item);
  });
  ensureRows_(sheet, rows.length + 1);
  applyTextFormat_(sheet, colMap, 2, rows.length);
  sheet.getRange(2, 1, rows.length, lastCol).setValues(rows);
  applyDateColumnFormat_(sheet, colMap);
  sortDataSheet_(sheet, colMap);

  // 選項清單：每個分類整欄改寫成這次用到的值
  var optSheet = getOrCreateOptionsSheet_();
  var optColMap = getColumnMap_(optSheet);
  OPTION_CATEGORIES.forEach(function (category) {
    var col = optColMap[category];
    if (!col) return;
    var current = readOptionColumn_(optSheet, col);
    writeOptionColumn_(optSheet, col, { list: result.options[category], height: current.height });
  });

  // 已刪除紀錄：清空表頭以外的內容
  var deleted = ss.getSheetByName(DELETED_SHEET_NAME);
  if (deleted && deleted.getLastRow() >= 2) {
    deleted.getRange(2, 1, deleted.getLastRow() - 1, deleted.getLastColumn()).clearContent();
  }

  var preview = ss.getSheetByName(LEGACY_PREVIEW_SHEET);
  if (preview) ss.deleteSheet(preview);
  writeLegacyLog_(ss, result);
  Logger.log('已匯入\n' + result.summary.join('\n'));
}

// 讀兩份舊表並轉換，不寫入任何東西
function buildLegacyImport_() {
  var entries = [];
  var log = [];
  var skippedSheets = [];
  var seenDates = {};

  LEGACY_SOURCES.forEach(function (source) {
    var book = SpreadsheetApp.openById(source.id);
    book.getSheets().forEach(function (sheet) {
      var name = sheet.getName();
      var where = source.label + '「' + name + '」';
      if (LEGACY_IGNORED_SHEETS.indexOf(name.trim()) !== -1) return;
      var values = sheet.getDataRange().getValues();
      if (values.length === 0 || values[0].indexOf('工作內容') === -1) {
        skippedSheets.push(where + '：沒有「工作內容」欄');
        return;
      }
      var date = parseLegacySheetDate_(name, source.year);
      if (!date) {
        skippedSheets.push(where + '：分頁名稱解析不出日期');
        return;
      }
      var month = Number(date.slice(5, 7));
      if (month < source.months[0] || month > source.months[1]) {
        log.push(where + '：日期 ' + date + ' 不在 ' + source.label + ' 的月份範圍內（仍照常匯入）');
      }
      var converted = convertLegacySheet_(values, date, where, book.getSpreadsheetTimeZone());
      if (seenDates[date]) {
        log.push(
          where + '：日期 ' + date + ' 跟 ' + seenDates[date] + ' 重複（兩邊都匯入，這個分頁的項次接在後面重新編號）',
        );
        renumberAfterExisting_(converted.entries);
      }
      seenDates[date] = where;
      entries = entries.concat(converted.entries);
      log = log.concat(converted.log);
    });
  });

  // 同一天項次空白的，接在當天最大項次後面
  var maxIndex = {};
  entries.forEach(function (e) {
    var d = e.item.工作日期;
    if (e.item.項次) maxIndex[d] = Math.max(maxIndex[d] || 0, e.item.項次);
  });
  entries.forEach(function (e) {
    if (!e.item.項次) {
      maxIndex[e.item.工作日期] = (maxIndex[e.item.工作日期] || 0) + 1;
      e.item.項次 = maxIndex[e.item.工作日期];
    }
    e.item.id = Utilities.getUuid();
  });
  entries.sort(function (a, b) {
    if (a.item.工作日期 !== b.item.工作日期) return a.item.工作日期 < b.item.工作日期 ? -1 : 1;
    return a.item.項次 - b.item.項次;
  });

  // 驗證：照新增紀錄的規則檢查，不擋匯入，只列在紀錄裡給使用者看
  var dayHours = {};
  entries.forEach(function (e) {
    var errors = validateItem_(e.item);
    if (errors.length > 0) log.push(e.source + '：' + errors.join('；'));
    dayHours[e.item.工作日期] = (dayHours[e.item.工作日期] || 0) + (Number(e.item.今日工時) || 0);
  });
  Object.keys(dayHours).forEach(function (d) {
    if (dayHours[d] > DAILY_HOURS_MAX) log.push(d + '：當天工時合計 ' + dayHours[d] + ' 小時，超過 24 小時');
  });

  var options = collectLegacyOptions_(entries);
  var leaveCount = entries.filter(function (e) {
    return isLeaveItem_(e.item);
  }).length;
  var summary = [
    '紀錄：' + entries.length + ' 筆（其中請假 ' + leaveCount + ' 筆），共 ' + Object.keys(dayHours).length + ' 天',
    '選項清單：' +
      OPTION_CATEGORIES.map(function (c) {
        return c + ' ' + options[c].length + ' 個';
      }).join('、'),
    '略過的分頁：' + skippedSheets.length + ' 個',
    '需要留意：' + log.length + ' 則',
  ];
  return { items: entries, options: options, summary: summary, skippedSheets: skippedSheets, log: log };
}

// 同一天的第二個分頁：照原項次排好（項次空白的維持在原本的位置之後），清掉項次，
// 讓下面「項次空白的接在當天最大項次後面」依序補號，就不會跟前一個分頁的項次重複
function renumberAfterExisting_(dayEntries) {
  dayEntries
    .map(function (e, i) {
      return { entry: e, order: i };
    })
    .sort(function (a, b) {
      var ia = a.entry.item.項次 || Infinity;
      var ib = b.entry.item.項次 || Infinity;
      return ia - ib || a.order - b.order;
    })
    .forEach(function (x, i) {
      x.entry.item.項次 = 0;
      dayEntries[i] = x.entry;
    });
}

// 轉換單一分頁（values 第一列是表頭），不呼叫任何 Apps Script API，方便在本機測試
function convertLegacySheet_(values, date, where, timeZone) {
  var header = values[0].map(function (h) {
    return String(h).trim();
  });
  var col = function (name) {
    return header.indexOf(name);
  };
  var get = function (row, name) {
    var i = col(name);
    if (i === -1) return '';
    var v = row[i];
    return v === null || v === undefined ? '' : v;
  };
  var text = function (row, name) {
    return String(get(row, name)).replace(/\r\n?/g, '\n').trim();
  };

  var entries = [];
  var log = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var target = text(row, '工作內容');
    if (!target) continue;
    var source = where + ' 第 ' + (r + 1) + ' 列';
    var notes = text(row, '今日處理情形');
    var index = Number(get(row, '項次')) || 0;
    var hours = toLegacyNumber_(get(row, '今日工時'));

    var item;
    if (LEGACY_LEAVE_PATTERN.test(target)) {
      var leaveHours = hours > 0 ? Math.min(roundToStep_(hours, 0.25), 8) : 8;
      item = Object.assign(
        {
          工作日期: date,
          項次: index,
          工作目標: legacyLeaveType_(target + '\n' + notes),
          處理內容: [target, notes].filter(Boolean).join('\n'),
          今日工時: leaveHours,
          狀態: LEAVE_RULES.status,
          已刪除: false,
        },
        LEAVE_RULES.fixed,
        { 專案Repo: [] },
      );
      log.push(source + '：判定為請假（' + item.工作目標 + ' ' + leaveHours + 'hr）：' + target);
    } else {
      var split = splitLegacyRepo_(notes);
      var rawStatus = text(row, '完成回報');
      var status = LEGACY_STATUS_MAP[rawStatus];
      if (!status) {
        status = '待辦';
        log.push(source + '：完成回報「' + rawStatus + '」對不上，改填待辦');
      }
      var deadlineRaw = get(row, '預計完成期限');
      var deadline = parseLegacyDeadline_(deadlineRaw, date, timeZone);
      if (!deadline && String(deadlineRaw).trim()) {
        log.push(source + '：預計完成期限「' + String(deadlineRaw).trim() + '」不是日期，留空');
      }
      if (LEGACY_LEAVE_PATTERN.test(notes)) {
        log.push(source + '：今日處理情形提到請假，仍當工作紀錄匯入，請確認：' + notes.split('\n')[0]);
      }
      item = {
        工作日期: date,
        項次: index,
        交辦單位: text(row, '單位'),
        交辦人員: text(row, '交辦人員'),
        專案名稱: text(row, '專案名稱'),
        專案Repo: split.repos,
        工作目標: target,
        處理內容: split.rest,
        今日工時: Math.min(Math.max(roundToStep_(hours, 0.25), 0), 24),
        預計期限: deadline,
        完成度: Math.min(Math.max(roundToStep_(toLegacyNumber_(get(row, '完成%')), 0.25), 0), 100),
        狀態: status,
        已刪除: false,
      };
    }
    entries.push({ item: item, source: source });
  }
  return { entries: entries, log: log };
}

// 分頁名稱 → YYYY/MM/DD；支援 1009、10/09、10-9、10.9、10月9日、2026/10/09、20261009、
// 民國 1151009，名稱後面括號裡的星期等文字會先拿掉
function parseLegacySheetDate_(name, year) {
  var s = String(name)
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\s/g, '');
  var y = year;
  var m;
  var d;
  var match;
  if ((match = s.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/))) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else if ((match = s.match(/^(\d{1,2})[\/\-.月](\d{1,2})日?$/))) {
    m = Number(match[1]);
    d = Number(match[2]);
  } else if ((match = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else if ((match = s.match(/^(\d{3})(\d{2})(\d{2})$/))) {
    y = Number(match[1]) + 1911;
    m = Number(match[2]);
    d = Number(match[3]);
  } else if ((match = s.match(/^(\d{1,2})(\d{2})$/))) {
    m = Number(match[1]);
    d = Number(match[2]);
  } else {
    return '';
  }
  return toLegacyDate_(y, m, d);
}

// 預計完成期限 → YYYY/MM/DD；不是日期就回傳空字串。只寫月日的用工作日期那年
function parseLegacyDeadline_(raw, workDate, timeZone) {
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return '';
    return Utilities.formatDate(raw, timeZone, 'yyyy/MM/dd');
  }
  var s = String(raw).replace(/[（(][^）)]*[）)]/g, '').trim();
  if (!s) return '';
  var year = Number(workDate.slice(0, 4));
  var match = s.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/);
  if (match) return toLegacyDate_(Number(match[1]), Number(match[2]), Number(match[3]));
  match = s.match(/^(\d{1,2})[\/\-.月](\d{1,2})日?$/);
  if (match) return toLegacyDate_(year, Number(match[1]), Number(match[2]));
  return '';
}

function toLegacyDate_(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
  var check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCMonth() !== m - 1) return '';
  if (y < 2020 || y > 2099) return '';
  return y + '/' + (m < 10 ? '0' : '') + m + '/' + (d < 10 ? '0' : '') + d;
}

// 今日處理情形第一行只有英數字與 - _ / .（例如 release_source）才算 Repo，其餘行是處理內容
function splitLegacyRepo_(notes) {
  if (!notes) return { repos: [], rest: '' };
  var lines = notes.split('\n');
  var first = lines[0].trim();
  if (!LEGACY_REPO_LINE.test(first) || !/[A-Za-z]/.test(first)) return { repos: [], rest: notes };
  return { repos: [first], rest: lines.slice(1).join('\n').trim() };
}

function legacyLeaveType_(textValue) {
  if (/特休/.test(textValue)) return '特休';
  if (/病假/.test(textValue)) return '病假';
  if (/事假/.test(textValue)) return '事假';
  return '其他';
}

function toLegacyNumber_(raw) {
  if (typeof raw === 'number') return raw;
  var n = parseFloat(String(raw).replace(/[%％\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function roundToStep_(n, step) {
  return Math.round(n / step) * step;
}

// 選項清單：各分類實際用到的值（請假列不算），依使用次數多到少，次數相同照第一次出現的順序
function collectLegacyOptions_(entries) {
  var options = {};
  OPTION_CATEGORIES.forEach(function (category) {
    var counts = {};
    var order = [];
    entries.forEach(function (e) {
      if (isLeaveItem_(e.item)) return;
      var values = category === '專案Repo' ? e.item.專案Repo : [e.item[category]];
      values.forEach(function (v) {
        var key = optionKey_(v);
        if (!key) return;
        if (!counts[key]) {
          counts[key] = 0;
          order.push(key);
        }
        counts[key]++;
      });
    });
    options[category] = order.slice().sort(function (a, b) {
      return counts[b] - counts[a] || order.indexOf(a) - order.indexOf(b);
    });
  });
  return options;
}

function writeLegacyLog_(ss, result) {
  var lines = [['摘要']]
    .concat(result.summary.map(function (s) {
      return [s];
    }))
    .concat([[''], ['略過的分頁']])
    .concat(result.skippedSheets.map(function (s) {
      return [s];
    }))
    .concat([[''], ['需要留意']])
    .concat(result.log.map(function (s) {
      return [s];
    }));
  writeSheet_(ss, LEGACY_LOG_SHEET, lines, null);
}

// 整張分頁改寫成 rows（分頁不存在就建立）。有 colMap 時第一列是表頭（凍結），
// 文字欄位先設成純文字格式，免得「0123」「2026/10/09」這類值被 Sheet 轉成數字或日期
function writeSheet_(ss, name, rows, colMap) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.clear();
  if (rows.length === 0) return;
  var width = rows[0].length;
  ensureRows_(sheet, rows.length);
  if (colMap && rows.length > 1) applyTextFormat_(sheet, colMap, 2, rows.length - 1);
  sheet.getRange(1, 1, rows.length, width).setValues(rows);
  if (colMap) sheet.setFrozenRows(1);
}
