function getDownloadLinks() {
  // Folder ID from the provided URL
  var folderId = requireScriptProp_('DRIVE_PDF_FOLDER_ID');
  
  // Access the folder
  var folder = DriveApp.getFolderById(folderId);
  
  // Get all files in the folder with mimeType PDF
  var files = folder.getFilesByType(MimeType.PDF);
  
  // Array to store download links
  var downloadLinks = [];
  
  // Iterate through files
  while (files.hasNext()) {
    var file = files.next();
    var fileId = file.getId();
    var fileName = file.getName();
    var downloadUrl = 'https://drive.usercontent.google.com/download?id=' + fileId + '&export=download';
    downloadLinks.push({name: fileName, url: downloadUrl});
  }
  
  // Log the download links
  Logger.log('Download Links for PDF files:');
  for (var i = 0; i < downloadLinks.length; i++) {
    Logger.log('File: ' + downloadLinks[i].name + ' | URL: ' + downloadLinks[i].url);
  }
  
  // Optionally, return the links for further use
  return downloadLinks;
}