function runAllTehsilScripts() {
  ChaubaraMale();   // Call the function for Chaubara Male
  Utilities.sleep(10000); // Wait 10 Seconds

  ChaubaraFemale(); // Call the function for Chaubara Female
  Utilities.sleep(10000); // Wait 10 Seconds

  KarorMale(); // Call the function for Karor Male
  Utilities.sleep(10000); // Wait 10 Seconds

  KarorFemale(); // Call the function for Karor Female
  Utilities.sleep(10000); // Wait 10 Seconds

  LayyahMale(); // Call the function for Layyah Male
  Utilities.sleep(10000); // Wait 10 Seconds

  LayyahFemale(); // Call the function for Layyah Female
  Utilities.sleep(10000); // Wait 10 Seconds

  SecondaryWing(); // Call the function for Secondary Wing
  Utilities.sleep(10000); // Wait 10 seconds
  
  exportSummaryToPDF();
}
function getSummaryData() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('Summary');
    if (!sheet) throw new Error('Summary sheet not found');
    const sheet1 = spreadsheet.getSheetByName('Schools');
    
    const dormantCount = sheet1.getRange('K1').getValue(); // M4 is top-left of merged M4:R4
    const reportTime = sheet.getRange('A2').getValue(); // A2 is top-left of merged A2:U2
    
    return {
      dormantCount: dormantCount.toString(),
      reportTime: reportTime.toString()
    };
  } catch (error) {
    throw new Error('Failed to fetch summary data: ' + error.message);
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
      sheet.getRange("H1").setValue("On The Way");
      runAllTehsilScripts();
      sheet.getRange("H1").setValue("DONE");
    } else if (activeValue === false) {
      sheet.getRange("H1").clearContent();
      sheet.getRange("L1").setValue(false);
    }
  }
}
