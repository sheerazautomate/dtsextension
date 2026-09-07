function doGet(e) {
  // Admin panel status polling — new, additive. Only fires on ?action=getStatus,
  // so opening the web app URL normally still shows the existing Dashboard.
  if (e && e.parameter && e.parameter.action === 'getStatus') {
    return AdminPanel_handleGet_(e);
  }
  return HtmlService.createHtmlOutputFromFile('Dashboard')
      .setWidth(900)
      .setHeight(600);
}

// WHATSAPP_SHARED_SECRET and DRIVE_* folder IDs are Script properties.
// See backend/SCRIPT_PROPERTIES.example. Webhook URL is read dynamically
// via getWhatsAppWebhookUrl() from waUrlRegistry.js.

function openDashboard() {
  var html = HtmlService.createHtmlOutputFromFile('Dashboard')
      .setWidth(800)
      .setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, 'Anti-Dengue Report Generator');
}

function runAllTehsilScripts() {
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getActiveSheet();
  sheet.getRange("H1").setValue("1");
  ChaubaraMale();
  Utilities.sleep(5000); // Wait 10 Seconds
  
  sheet.getRange("H1").setValue("2");
  ChaubaraFemale();
  Utilities.sleep(5000); // Wait 5 Seconds

  sheet.getRange("H1").setValue("3");
  KarorMale();
  Utilities.sleep(5000); // Wait 5 Seconds

  sheet.getRange("H1").setValue("4");
  KarorFemale();
  Utilities.sleep(5000); // Wait 5 Seconds

  sheet.getRange("H1").setValue("5");
  LayyahMale();
  Utilities.sleep(5000); // Wait 5 Seconds

  sheet.getRange("H1").setValue("6");
  LayyahFemale();
  Utilities.sleep(5000); // Wait 5 Seconds

  sheet.getRange("H1").setValue("7");
  SecondaryWing();
  Utilities.sleep(5000); // Wait 5 seconds
  
  sheet.getRange("H1").setValue("");
  exportSummaryToPDF();
  sheet.getRange("G1").setValue(false);
}

// ==== ADD THIS HELPER FUNCTION ====
function sendPdfToWhatsApp(pdfFile) {
  try {
    var webhookUrl = getWhatsAppWebhookUrl(); // dynamic lookup, defined in whatsapp-url-registry.gs

    var bytes = pdfFile.getBlob().getBytes();
    var base64 = Utilities.base64Encode(bytes);

    var payload = {
      secret: requireScriptProp_('WHATSAPP_SHARED_SECRET'),
      filename: pdfFile.getName(),
      base64: base64,
      caption: pdfFile.getName().replace('.pdf', '')
    };

    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(webhookUrl, options);
    Logger.log('WhatsApp send response: ' + response.getContentText());
  } catch (err) {
    Logger.log('WhatsApp send failed for ' + pdfFile.getName() + ': ' + err.message);
    // Don't throw — a WhatsApp failure shouldn't break the PDF generation flow
  }
}

// ==== IN EACH GENERATOR FUNCTION, ADD ONE LINE AFTER pdfFile IS CREATED ====
// Example for ChaubaraMale() — same pattern applies to ChaubaraFemale, KarorMale,
// KarorFemale, LayyahMale, LayyahFemale, SecondaryWing, and exportSummaryToPDF:
//
//   var pdfFile = folder.createFile(pdfBlob);
//   Logger.log('PDF File URL: ' + pdfFile.getUrl());
//   sendPdfToWhatsApp(pdfFile);   // <-- ADD THIS LINE

function ChaubaraMale() {
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getActiveSheet();
  
  // Define filter criteria for Tehsil column (B) to show only "Chaubara" and blanks
  var tehsilCriteria = SpreadsheetApp.newFilterCriteria()
    .setHiddenValues([
      'KAROR M', 'LAYYAH F', 'LAYYAH M', 'KAROR F', 
      'CHAUBARA F', 'CHAUBARAS', 'KARORS', 
      'LAYYAHS', 'KARORS' // Hiding all unwanted values
    ])
    .build();
  
  // Define filter criteria for Status column (F) to hide "Active"
  var statusCriteria = SpreadsheetApp.newFilterCriteria()
    .setHiddenValues(['Active']) // Hide "Active"
    .build();

  // Apply filters
  var filter = sheet.getFilter();
  filter.setColumnFilterCriteria(2, tehsilCriteria); // Column B (Tehsil)
  filter.setColumnFilterCriteria(6, statusCriteria); // Column F (Status)

  // Get the sheet ID
  var sheetId = sheet.getSheetId();

  // Define the PDF export URL
  var url = 'https://docs.google.com/spreadsheets/d/' + spreadsheet.getId() + '/export?exportFormat=pdf&format=pdf' +
    '&gid=' + sheetId + // The sheet's ID
    '&size=A4' +        // Paper size
    '&portrait=true' +  // Orientation
    '&fitw=true' +      // Fit to width
    '&sheetnames=false&printtitle=false&pagenumbers=false' + // Other settings
    '&gridlines=false' + // Hide gridlines
    '&fzr=false' + // Do not repeat frozen rows
    '&range=A1:H' + // Define the range to export
    '&filter=true'; // Apply the filter

  // Make the request to generate the PDF
  var response = UrlFetchApp.fetch(url, {
    headers: {
      'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
    }
  });

  // Save the PDF to Drive
  var pdfBlob = response.getBlob().setName('Chaubara Male.pdf');
  var folder = DriveApp.getFolderById(requireScriptProp_('DRIVE_PDF_FOLDER_ID'));
  
  // Delete previous files with the same name
  var files = folder.getFilesByName('Chaubara Male.pdf');
  while (files.hasNext()) {
    var file = files.next();
    folder.removeFile(file); // Remove from folder
    DriveApp.getRootFolder().removeFile(file); // Remove from Drive
  }

  // Create the new PDF file
  var pdfFile = folder.createFile(pdfBlob);

  Logger.log('PDF File URL: ' + pdfFile.getUrl());
  sendPdfToWhatsApp(pdfFile);
}
 
function ChaubaraFemale() {
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getActiveSheet();
  
  // Define filter criteria for Tehsil column (B) to show only "Chaubara" and blanks
  var tehsilCriteria = SpreadsheetApp.newFilterCriteria()
    .setHiddenValues([
      'KAROR M', 'LAYYAH F', 'LAYYAH M', 'KAROR F', 
      'CHAUBARA M', 'CHAUBARAS', 'KARORS', 
      'LAYYAHS', 'KARORS' // Hiding all unwanted values
    ])
    .build();
  
  // Define filter criteria for Status column (F) to hide "Active"
  var statusCriteria = SpreadsheetApp.newFilterCriteria()
    .setHiddenValues(['Active']) // Hide "Active"
    .build();

  // Apply filters
  var filter = sheet.getFilter();
  filter.setColumnFilterCriteria(2, tehsilCriteria); // Column B (Tehsil)
  filter.setColumnFilterCriteria(6, statusCriteria); // Column F (Status)

  // Get the sheet ID
  var sheetId = sheet.getSheetId();

  // Define the PDF export URL
  var url = 'https://docs.google.com/spreadsheets/d/' + spreadsheet.getId() + '/export?exportFormat=pdf&format=pdf' +
    '&gid=' + sheetId + // The sheet's ID
    '&size=A4' +        // Paper size
    '&portrait=true' +  // Orientation
    '&fitw=true' +      // Fit to width
    '&sheetnames=false&printtitle=false&pagenumbers=false' + // Other settings
    '&gridlines=false' + // Hide gridlines
    '&fzr=false' + // Do not repeat frozen rows
    '&range=A1:H' + // Define the range to export
    '&filter=true'; // Apply the filter

  // Make the request to generate the PDF
  var response = UrlFetchApp.fetch(url, {
    headers: {
      'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
    }
  });

  // Save the PDF to Drive
  var pdfBlob = response.getBlob().setName('Chaubara Female.pdf');
  var folder = DriveApp.getFolderById(requireScriptProp_('DRIVE_PDF_FOLDER_ID'));
  
  // Delete previous files with the same name
  var files = folder.getFilesByName('Chaubara Female.pdf');
  while (files.hasNext()) {
    var file = files.next();
    folder.removeFile(file); // Remove from folder
    DriveApp.getRootFolder().removeFile(file); // Remove from Drive
  }

  // Create the new PDF file
  var pdfFile = folder.createFile(pdfBlob);

  Logger.log('PDF File URL: ' + pdfFile.getUrl());
  sendPdfToWhatsApp(pdfFile);
}

function KarorMale() {
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getActiveSheet();
  
  // Define filter criteria for Tehsil column (B) to show only "Chaubara" and blanks
  var tehsilCriteria = SpreadsheetApp.newFilterCriteria()
    .setHiddenValues([
      'Layyah M', 'LAYYAH F', 'Chaubara M', 'KAROR F', 
      'CHAUBARA F', 'CHAUBARAS', 'KARORS', 
      'LAYYAHS', 'KARORS' // Hiding all unwanted values
    ])
    .build();
  
  // Define filter criteria for Status column (F) to hide "Active"
  var statusCriteria = SpreadsheetApp.newFilterCriteria()
    .setHiddenValues(['Active']) // Hide "Active"
    .build();

  // Apply filters
  var filter = sheet.getFilter();
  filter.setColumnFilterCriteria(2, tehsilCriteria); // Column B (Tehsil)
  filter.setColumnFilterCriteria(6, statusCriteria); // Column F (Status)

  // Get the sheet ID
  var sheetId = sheet.getSheetId();

  // Define the PDF export URL
  var url = 'https://docs.google.com/spreadsheets/d/' + spreadsheet.getId() + '/export?exportFormat=pdf&format=pdf' +
    '&gid=' + sheetId + // The sheet's ID
    '&size=A4' +        // Paper size
    '&portrait=true' +  // Orientation
    '&fitw=true' +      // Fit to width
    '&sheetnames=false&printtitle=false&pagenumbers=false' + // Other settings
    '&gridlines=false' + // Hide gridlines
    '&fzr=false' + // Do not repeat frozen rows
    '&range=A1:H' + // Define the range to export
    '&filter=true'; // Apply the filter

  // Make the request to generate the PDF
  var response = UrlFetchApp.fetch(url, {
    headers: {
      'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
    }
  });

  // Save the PDF to Drive
  var pdfBlob = response.getBlob().setName('Karor Male.pdf');
  var folder = DriveApp.getFolderById(requireScriptProp_('DRIVE_PDF_FOLDER_ID'));
  
  // Delete previous files with the same name
  var files = folder.getFilesByName('Karor Male.pdf');
  while (files.hasNext()) {
    var file = files.next();
    folder.removeFile(file); // Remove from folder
    DriveApp.getRootFolder().removeFile(file); // Remove from Drive
  }

  // Create the new PDF file
  var pdfFile = folder.createFile(pdfBlob);

  Logger.log('PDF File URL: ' + pdfFile.getUrl());
  sendPdfToWhatsApp(pdfFile);
}


function KarorFemale() {
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getActiveSheet();
  
  // Define filter criteria for Tehsil column (B) to show only "Chaubara" and blanks
  var tehsilCriteria = SpreadsheetApp.newFilterCriteria()
    .setHiddenValues([
      'Layyah M', 'LAYYAH F', 'Chaubara M', 'KAROR M', 
      'CHAUBARA F', 'CHAUBARAS', 'KARORS', 
      'LAYYAHS', 'KARORS' // Hiding all unwanted values
    ])
    .build();
  
  // Define filter criteria for Status column (F) to hide "Active"
  var statusCriteria = SpreadsheetApp.newFilterCriteria()
    .setHiddenValues(['Active']) // Hide "Active"
    .build();

  // Apply filters
  var filter = sheet.getFilter();
  filter.setColumnFilterCriteria(2, tehsilCriteria); // Column B (Tehsil)
  filter.setColumnFilterCriteria(6, statusCriteria); // Column F (Status)

  // Get the sheet ID
  var sheetId = sheet.getSheetId();

  // Define the PDF export URL
  var url = 'https://docs.google.com/spreadsheets/d/' + spreadsheet.getId() + '/export?exportFormat=pdf&format=pdf' +
    '&gid=' + sheetId + // The sheet's ID
    '&size=A4' +        // Paper size
    '&portrait=true' +  // Orientation
    '&fitw=true' +      // Fit to width
    '&sheetnames=false&printtitle=false&pagenumbers=false' + // Other settings
    '&gridlines=false' + // Hide gridlines
    '&fzr=false' + // Do not repeat frozen rows
    '&range=A1:H' + // Define the range to export
    '&filter=true'; // Apply the filter

  // Make the request to generate the PDF
  var response = UrlFetchApp.fetch(url, {
    headers: {
      'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
    }
  });

  // Save the PDF to Drive
  var pdfBlob = response.getBlob().setName('Karor Female.pdf');
  var folder = DriveApp.getFolderById(requireScriptProp_('DRIVE_PDF_FOLDER_ID'));
  
  // Delete previous files with the same name
  var files = folder.getFilesByName('Karor Female.pdf');
  while (files.hasNext()) {
    var file = files.next();
    folder.removeFile(file); // Remove from folder
    DriveApp.getRootFolder().removeFile(file); // Remove from Drive
  }

  // Create the new PDF file
  var pdfFile = folder.createFile(pdfBlob);

  Logger.log('PDF File URL: ' + pdfFile.getUrl());
  sendPdfToWhatsApp(pdfFile);
}

function LayyahMale() {
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getActiveSheet();
  
  // Define filter criteria for Tehsil column (B) to show only "Chaubara" and blanks
  var tehsilCriteria = SpreadsheetApp.newFilterCriteria()
    .setHiddenValues([
      'KAROR M', 'LAYYAH F', 'Chaubara M', 'KAROR F', 
      'CHAUBARA F', 'CHAUBARAS', 'KARORS', 
      'LAYYAHS', 'KARORS' // Hiding all unwanted values
    ])
    .build();
  
  // Define filter criteria for Status column (F) to hide "Active"
  var statusCriteria = SpreadsheetApp.newFilterCriteria()
    .setHiddenValues(['Active']) // Hide "Active"
    .build();

  // Apply filters
  var filter = sheet.getFilter();
  filter.setColumnFilterCriteria(2, tehsilCriteria); // Column B (Tehsil)
  filter.setColumnFilterCriteria(6, statusCriteria); // Column F (Status)

  // Get the sheet ID
  var sheetId = sheet.getSheetId();

  // Define the PDF export URL
  var url = 'https://docs.google.com/spreadsheets/d/' + spreadsheet.getId() + '/export?exportFormat=pdf&format=pdf' +
    '&gid=' + sheetId + // The sheet's ID
    '&size=A4' +        // Paper size
    '&portrait=true' +  // Orientation
    '&fitw=true' +      // Fit to width
    '&sheetnames=false&printtitle=false&pagenumbers=false' + // Other settings
    '&gridlines=false' + // Hide gridlines
    '&fzr=false' + // Do not repeat frozen rows
    '&range=A1:H' + // Define the range to export
    '&filter=true'; // Apply the filter

  // Make the request to generate the PDF
  var response = UrlFetchApp.fetch(url, {
    headers: {
      'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
    }
  });

  // Save the PDF to Drive
  var pdfBlob = response.getBlob().setName('Layyah Male.pdf');
  var folder = DriveApp.getFolderById(requireScriptProp_('DRIVE_PDF_FOLDER_ID'));
  
  // Delete previous files with the same name
  var files = folder.getFilesByName('Layyah Male.pdf');
  while (files.hasNext()) {
    var file = files.next();
    folder.removeFile(file); // Remove from folder
    DriveApp.getRootFolder().removeFile(file); // Remove from Drive
  }

  // Create the new PDF file
  var pdfFile = folder.createFile(pdfBlob);

  Logger.log('PDF File URL: ' + pdfFile.getUrl());
  sendPdfToWhatsApp(pdfFile);
}


function LayyahFemale() {
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getActiveSheet();
  
  // Define filter criteria for Tehsil column (B) to show only "Chaubara" and blanks
  var tehsilCriteria = SpreadsheetApp.newFilterCriteria()
    .setHiddenValues([
      'KAROR M', 'LAYYAH M', 'Chaubara M', 'KAROR F', 
      'CHAUBARA F', 'CHAUBARAS', 'KARORS', 
      'LAYYAHS', 'KARORS' // Hiding all unwanted values
    ])
    .build();
  
  // Define filter criteria for Status column (F) to hide "Active"
  var statusCriteria = SpreadsheetApp.newFilterCriteria()
    .setHiddenValues(['Active']) // Hide "Active"
    .build();

  // Apply filters
  var filter = sheet.getFilter();
  filter.setColumnFilterCriteria(2, tehsilCriteria); // Column B (Tehsil)
  filter.setColumnFilterCriteria(6, statusCriteria); // Column F (Status)

  // Get the sheet ID
  var sheetId = sheet.getSheetId();

  // Define the PDF export URL
  var url = 'https://docs.google.com/spreadsheets/d/' + spreadsheet.getId() + '/export?exportFormat=pdf&format=pdf' +
    '&gid=' + sheetId + // The sheet's ID
    '&size=A4' +        // Paper size
    '&portrait=true' +  // Orientation
    '&fitw=true' +      // Fit to width
    '&sheetnames=false&printtitle=false&pagenumbers=false' + // Other settings
    '&gridlines=false' + // Hide gridlines
    '&fzr=false' + // Do not repeat frozen rows
    '&range=A1:H' + // Define the range to export
    '&filter=true'; // Apply the filter

  // Make the request to generate the PDF
  var response = UrlFetchApp.fetch(url, {
    headers: {
      'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
    }
  });

  // Save the PDF to Drive
  var pdfBlob = response.getBlob().setName('Layyah Female.pdf');
  var folder = DriveApp.getFolderById(requireScriptProp_('DRIVE_PDF_FOLDER_ID'));
  
  // Delete previous files with the same name
  var files = folder.getFilesByName('Layyah Female.pdf');
  while (files.hasNext()) {
    var file = files.next();
    folder.removeFile(file); // Remove from folder
    DriveApp.getRootFolder().removeFile(file); // Remove from Drive
  }

  // Create the new PDF file
  var pdfFile = folder.createFile(pdfBlob);

  Logger.log('PDF File URL: ' + pdfFile.getUrl());
  sendPdfToWhatsApp(pdfFile);
}

function SecondaryWing() {
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getActiveSheet();
  
  // Define filter criteria for Tehsil column (B) to show only "Chaubara" and blanks
  var tehsilCriteria = SpreadsheetApp.newFilterCriteria()
    .setHiddenValues([
      'Layyah M', 'LAYYAH F', 'Chaubara M', 'KAROR M', 
      'CHAUBARA F','KAROR F' // Hiding all unwanted values
    ])
    .build();
  
  // Define filter criteria for Status column (F) to hide "Active"
  var statusCriteria = SpreadsheetApp.newFilterCriteria()
    .setHiddenValues(['Active']) // Hide "Active"
    .build();

  // Apply filters
  var filter = sheet.getFilter();
  filter.setColumnFilterCriteria(2, tehsilCriteria); // Column B (Tehsil)
  filter.setColumnFilterCriteria(6, statusCriteria); // Column F (Status)

  // Get the sheet ID
  var sheetId = sheet.getSheetId();

  // Define the PDF export URL
  var url = 'https://docs.google.com/spreadsheets/d/' + spreadsheet.getId() + '/export?exportFormat=pdf&format=pdf' +
    '&gid=' + sheetId + // The sheet's ID
    '&size=A4' +        // Paper size
    '&portrait=true' +  // Orientation
    '&fitw=true' +      // Fit to width
    '&sheetnames=false&printtitle=false&pagenumbers=false' + // Other settings
    '&gridlines=false' + // Hide gridlines
    '&fzr=false' + // Do not repeat frozen rows
    '&range=A1:H' + // Define the range to export
    '&filter=true'; // Apply the filter

  // Make the request to generate the PDF
  var response = UrlFetchApp.fetch(url, {
    headers: {
      'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
    }
  });

  // Save the PDF to Drive
  var pdfBlob = response.getBlob().setName('Secondary Wing.pdf');
  var folder = DriveApp.getFolderById(requireScriptProp_('DRIVE_PDF_FOLDER_ID'));
  
  // Delete previous files with the same name
  var files = folder.getFilesByName('Secondary Wing.pdf');
  while (files.hasNext()) {
    var file = files.next();
    folder.removeFile(file); // Remove from folder
    DriveApp.getRootFolder().removeFile(file); // Remove from Drive
  }

  // Create the new PDF file
  var pdfFile = folder.createFile(pdfBlob);

  Logger.log('PDF File URL: ' + pdfFile.getUrl());
  sendPdfToWhatsApp(pdfFile);
}


function exportSummaryToPDF() {
  var spreadsheet = SpreadsheetApp.getActive();
  var summarySheet = spreadsheet.getSheetByName("Summary");

  // Get the sheet ID
  var summarySheetId = summarySheet.getSheetId();

  // Define the PDF export URL for the "Summary" sheet
  var summaryUrl = 'https://docs.google.com/spreadsheets/d/' + spreadsheet.getId() + '/export?exportFormat=pdf&format=pdf' +
    '&gid=' + summarySheetId + // The sheet's ID
    '&size=A4' +               // Paper size
    '&portrait=true' +         // Orientation
    '&fitw=true' +             // Fit to width
    '&sheetnames=false&printtitle=false&pagenumbers=false' + // Other settings
    '&gridlines=false' + // Hide gridlines
    '&fzr=false' + // Do not repeat frozen rows
    '&range=A1:U13'; // Define the range to export

  // Make the request to generate the PDF
  var summaryResponse = UrlFetchApp.fetch(summaryUrl, {
    headers: {
      'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
    }
  });

  // Save the PDF to Drive
  var summaryPdfBlob = summaryResponse.getBlob().setName('Summary.pdf');
  var folder = DriveApp.getFolderById(requireScriptProp_('DRIVE_PDF_FOLDER_ID'));
  
  // Delete previous files with the same name
  var summaryFiles = folder.getFilesByName('Summary.pdf');
  while (summaryFiles.hasNext()) {
    var summaryFile = summaryFiles.next();
    folder.removeFile(summaryFile); // Remove from folder
    DriveApp.getRootFolder().removeFile(summaryFile); // Remove from Drive
  }

  // Create the new PDF file for Summary
  var summaryPdfFile = folder.createFile(summaryPdfBlob);
  Logger.log('Summary PDF File URL: ' + summaryPdfFile.getUrl());
  sendPdfToWhatsApp(summaryPdfFile);
}

function uploadCSVToDrive(data) {
  const FOLDER_ID = requireScriptProp_('DRIVE_CSV_FOLDER_ID');

  try {
    if (!data || !data.base64) throw new Error('No file data received.');

    const folder = DriveApp.getFolderById(FOLDER_ID);

    const bytes = Utilities.base64Decode(data.base64);

    let mimeType = data.mimeType;

    // 🔧 Fix mobile MIME issues
  // Inside uploadCSVToDrive, replace the mimeType fix block:
if (!mimeType || mimeType === "" || mimeType === "application/octet-stream") {
  if (data.filename.match(/\.xlsx$/i)) {
    mimeType = MimeType.MICROSOFT_EXCEL;
  } else {
    // Treat .xls, .csv, and anything unknown as plain CSV
    // since your source system exports CSV with .xls extension
    mimeType = MimeType.CSV;
  }
}

    const blob = Utilities.newBlob(bytes, mimeType, data.filename);

    const file = folder.createFile(blob);

    return `Uploaded: ${file.getName()}`;

  } catch (err) {
    throw new Error(err.message);
  }
}

function onEdit() {
  let activeCell = SpreadsheetApp.getActiveSpreadsheet().getActiveCell();
  let reference = activeCell.getA1Notation();
  let sheetName = activeCell.getSheet().getName();
  let activeValue = activeCell.getValue();
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Schoolwise");

  if (reference == "I1" && sheetName == "Schoolwise") {
    if (activeValue === true) {
      sheet.getRange("L1").setValue(true);
      runAllTehsilScripts();
      Utilities.sleep(2000);
      sheet.getRange("H1").setValue("DONE");
    } else if (activeValue === false) {
      sheet.getRange("H1").clearContent();
      sheet.getRange("L1").setValue(false)
    }
  }
}
