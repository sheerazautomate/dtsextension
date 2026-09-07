function startBulkDeletion() {
  const targetFiles = [
    "Karor Male.pdf", "Karor Female.pdf", 
    "Layyah Male.pdf", "Layyah Female.pdf", 
    "Chaubara Male.pdf", "Chaubara Female.pdf", 
    "Secondary Wing.pdf", "Summary.pdf"
  ];

  const startTime = new Date().getTime();
  const scriptProperties = PropertiesService.getScriptProperties();

  let filesRemaining = JSON.parse(scriptProperties.getProperty('FILES_TO_DELETE'));

  if (!filesRemaining) {
    filesRemaining = findFileIds(targetFiles);
    scriptProperties.setProperty('TOTAL_FILES', filesRemaining.length);
  }

  let total = parseInt(scriptProperties.getProperty('TOTAL_FILES')) || filesRemaining.length;

  while (filesRemaining.length > 0) {
    const currentTime = new Date().getTime();

    if (currentTime - startTime > 300000) {
      scriptProperties.setProperty('FILES_TO_DELETE', JSON.stringify(filesRemaining));
      createDeletionTrigger();
      return `⏳ Paused: ${total - filesRemaining.length}/${total} deleted...`;
    }

    const fileId = filesRemaining.shift();

    try {
      DriveApp.getFileById(fileId).setTrashed(true);
    } catch (e) {}

    scriptProperties.setProperty('FILES_TO_DELETE', JSON.stringify(filesRemaining));
  }

  // Cleanup
  scriptProperties.deleteProperty('FILES_TO_DELETE');
  scriptProperties.deleteProperty('TOTAL_FILES');
  deleteTriggers();

  return `✅ Completed: ${total}/${total} files deleted`;
}

function getDeletionStatus() {
  const props = PropertiesService.getScriptProperties();

  const remaining = JSON.parse(props.getProperty('FILES_TO_DELETE') || "[]");
  const total = parseInt(props.getProperty('TOTAL_FILES')) || 0;

  if (!remaining || total === 0) {
    return { status: "idle", message: "No deletion running" };
  }

  return {
    status: "running",
    deleted: total - remaining.length,
    total: total,
    message: `Deleting: ${total - remaining.length}/${total}`
  };
}

function findFileIds(names) {
  const ids = [];

  names.forEach(name => {
    const files = DriveApp.getFilesByName(name);
    while (files.hasNext()) {
      ids.push(files.next().getId());
    }
  });

  return ids;
}

function deleteTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
}

function createDeletionTrigger() {
  deleteTriggers();
  ScriptApp.newTrigger('startBulkDeletion')
    .timeBased()
    .after(60 * 1000)
    .create();
}