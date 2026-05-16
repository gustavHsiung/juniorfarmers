// =============================================
// 農產品登記表單 — Google Apps Script
// 貼到「延伸功能 → Apps Script」後部署為「網路應用程式」
// =============================================

var SHEET_NAME = '農場菜單';  // 工作表名稱

function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);

    // 如果工作表不存在就建立
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
    }

    // 如果是空白表，自動建立標題列
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        '時間戳記', '登記人', '農場', '週次', '品名', '數量', '單位',
        '基本進貨價', '批價', '批價門檻', '末端建議售價', '品項備注', '本批備註'
      ]);
      var headerRange = sheet.getRange(1, 1, 1, 13);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#27500A');
      headerRange.setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }

    // 解析 JSON
    var data = JSON.parse(e.postData.contents);
    var rows = data.rows;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return jsonResponse({ status: 'error', message: '沒有資料' });
    }

    rows.forEach(function(row) {
      Logger.log(row);
      sheet.appendRow([
        row['時間戳記'] || new Date().toLocaleString('zh-TW'),
        row['登記人'] || '',
        row['農場'] || '',
        row['週次'] || '',
        row['品名'] || '',
        row['數量'] || '',
        row['單位'] || '',
        row['基本進貨價'] || '',
        row['批價'] || '',
        row['批價門檻'] || '',
        row['末端建議售價'] || '',
        row['品項備注'] || '',
        row['備註'] || ''
      ]);
    });

    return jsonResponse({ status: 'success', inserted: rows.length });

  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

// =============================================
// GET：瀏覽某週資料
// 用法：?week=2025-05-第3週
//       不帶 week 參數則回傳所有可用週次清單
// =============================================
function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet || sheet.getLastRow() <= 1) {
      return jsonResponse({ status: 'ok', rows: [], weeks: [] });
    }

    // 讀取所有資料（跳過第一列標題）
    var lastRow = sheet.getLastRow();
    var lastCol = 13;
    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    // 欄位順序對應
    var COLS = [
      '時間戳記','登記人','農場','週次','品名','數量','單位',
      '基本進貨價','批價','批價門檻','末端建議售價','品項備注','本批備註'
    ];

    var week = e && e.parameter && e.parameter.week ? e.parameter.week : '';

    if (!week) {
      // 回傳所有出現過的週次（去重、排序）
      var weekSet = {};
      data.forEach(function(row) {
        var w = String(row[3] || '').trim();
        if (w) weekSet[w] = true;
      });
      var weeks = Object.keys(weekSet).sort();
      return jsonResponse({ status: 'ok', weeks: weeks });
    }

    // 過濾指定週次
    var matched = [];
    data.forEach(function(row) {
      var rowWeek = String(row[3] || '').trim();
      if (rowWeek === week) {
        var obj = {};
        COLS.forEach(function(col, i) {
          obj[col] = row[i] !== undefined ? String(row[i]) : '';
        });
        matched.push(obj);
      }
    });

    return jsonResponse({ status: 'ok', week: week, rows: matched });

  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
