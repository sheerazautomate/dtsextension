// No background work needed currently; content script handles everything.
// Kept as a stub in case future features (e.g. notifications, alarms) are added.
browser.runtime.onInstalled.addListener(() => {
  console.log('DTS Auto-Login extension installed.');
});
