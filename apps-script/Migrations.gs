/**
 * 一次性的資料整理函式，平常不需要放在 Apps Script 專案裡：要用時新增指令碼檔案 Migrations.gs、
 * 貼上這份內容（跟 Code.gs 同一個專案，共用 Code.gs 的工具函式），在「執行」選單手動執行，用完可以刪掉。
 * 函式名稱刻意不加結尾底線：結尾底線是 Apps Script 的私有函式，不會出現在「執行」選單裡。
 * 本機測試：tests/apps-script/sheet.spec.ts（loadCodeGsBackend 的 extraFiles 帶 'Migrations.gs'）
 */

// 舊版的月份分頁（YYYY-MM），只有 mergeMonthSheets() 用得到
function isMonthSheet_(sheet) {
  return /^\d{4}-\d{2}$/.test(sheet.getName());
}

/**
 * 一次性遷移：把舊版所有月份分頁（YYYY-MM）的紀錄合併到「工作紀錄」分頁，並移除每月 1 號
 * 自動建立月份分頁的觸發器（ensureMonthlySheet 已經拿掉，觸發器留著每個月都會執行失敗）。
 * - 依表頭名稱對應欄位，複製原始儲存格值（日期、數字維持原型別）
 * - 「工作紀錄」分頁已經有的 ID 會略過，所以重複執行不會重複寫入；ID 空白的補上 UUID，
 *   也寫回原本的月份分頁，重複執行時才認得出來
 * - 月份分頁不會被刪除，確認「工作紀錄」分頁的資料正確後再手動刪掉
 * 在 Apps Script 編輯器的「執行」選單手動執行一次即可。
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
