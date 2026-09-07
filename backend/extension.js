/**
 * Deploy this as a Web App:
 *   Deploy > New deployment > type: Web app
 *   Execute as: Me
 *   Who has access: Anyone
 * Copy the resulting /exec URL into the Firefox extension popup.
 *
 * Set SHEET_ID and SHEET_NAME below, and pick your own SHARED_SECRET
 * (any random string) — the extension must send the same value.
 */

const SHEET_ID = '1-U1Mw4HJ0reauq4Xe_iDxyFsqN8xZmxqChFrXE7gfiA';
const SHEET_NAME = 'dts'; // tab name to write into
const STAMP_SHEET_NAME = 'Schoolwise';
const STAMP_CELL = 'E1';
const SHARED_SECRET = 'blahblah';
const NTFY_TOPIC = 'dts'; // e.g. 'sheeraz-dengue-sync-x7f2' — pick something hard to guess

function handleDtsCsvUpload(e) {
  try {
    const params = e.parameter || {};
    if (params.secret !== SHARED_SECRET) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    }

    const csvText = e.postData && e.postData.contents ? e.postData.contents : '';
    if (!csvText) {
      return jsonResponse({ ok: false, error: 'No CSV content received' }, 400);
    }

    const rows = Utilities.parseCsv(csvText);

    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
    }

    // Clear only the data region (columns B onward), leaving column A untouched.
    const lastRow = sheet.getMaxRows();
    const lastCol = sheet.getMaxColumns();
    if (lastCol > 1) {
      sheet.getRange(1, 2, lastRow, lastCol - 1).clearContent();
    }

    if (rows.length > 0) {
      sheet
        .getRange(1, 2, rows.length, rows[0].length) // start at column B (col index 2)
        .setValues(rows);
    }

    // Optional: stamp when this data was last refreshed, on a different tab (leaves the data tab clean).
    const stampSheet = ss.getSheetByName(STAMP_SHEET_NAME);
    if (stampSheet) {
      stampSheet.getRange(STAMP_CELL).setValue('Last updated: ' + new Date());
    }

    // Trigger the existing macro that refreshes downstream tehsil-wise sheets,
    // capturing whatever it writes via Logger.log() during its run.
    let macroError = null;
    let macroLog = '';
    const logBefore = Logger.getLog().length;
    try {
      if (typeof runAllTehsilScripts === 'function') {
        runAllTehsilScripts();
        macroLog = Logger.getLog().substring(logBefore);
      } else {
        macroError = 'runAllTehsilScripts function not found in this project';
      }
    } catch (macroErr) {
      macroError = String(macroErr);
      macroLog = Logger.getLog().substring(logBefore);
    }

    notify(
      '✅ Dormancy sync done',
      `${rows.length} rows written` + (macroError ? `\nMacro warning: ${macroError}` : '\nMacro ran OK'),
      'default'
    );

    return jsonResponse({ ok: true, rows: rows.length, macroError: macroError, macroLog: macroLog });
  } catch (err) {
    notify('❌ Dormancy sync failed', String(err), 'high');
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
}

function notify(title, message, priority) {
  if (!NTFY_TOPIC || NTFY_TOPIC.indexOf('PASTE_') === 0) return; // not configured yet
  try {
    UrlFetchApp.fetch('https://ntfy.sh/' + NTFY_TOPIC, {
      method: 'post',
      contentType: 'text/plain; charset=utf-8',
      payload: message,
      headers: {
        Title: title,
        Priority: priority || 'default',
        Tags: priority === 'high' ? 'x' : 'white_check_mark'
      },
      muteHttpExceptions: true
    });
  } catch (e) {
    // Don't let a notification failure break the main response.
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}