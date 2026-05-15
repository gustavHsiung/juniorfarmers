// =============================================
// 農產品登記表單 — Google Apps Script
// 貼到「延伸功能 → Apps Script」後部署為「網路應用程式」
// =============================================

var SHEET_NAME = '農場菜單';  // 工作表名稱，預設為 Sheet1，可改成你的工作表名

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
        '時間戳記', '登記人', '農場', '週次', '品名', '數量', '單位', '基本進貨價', '批價', '批價門檻', '末端建議售價', '品項備注', '本批備註'
      ]);
      // 格式化標題
      var headerRange = sheet.getRange(1, 1, 1, 15);
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

    // 逐行寫入
    rows.forEach(function(row) {
      Logger.log( row);
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

// 支援 GET 測試（瀏覽器直接開這個網址會看到此訊息）
function doGet(e) {
  return jsonResponse({ status: 'ok', message: '農產品登記 API 正常運作中 ✅' });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}