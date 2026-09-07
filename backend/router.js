// ==== SINGLE ENTRY POINT — routes to the right handler by payload shape ====
// The DTS extension sends raw CSV as the body, with ?secret= in the query string.
// The URL registry updater sends JSON body with a "url" field.
// Only ONE doPost(e) is allowed per Apps Script project — this is it.
//
// Requires:
//   - handleDtsCsvUpload(e)      (renamed from doPost in extension.gs)
//   - handleUrlRegistryUpdate(e) (renamed from doPost in waUrlRegistry.gs)

function doPost(e) {
  // Admin panel actions (heartbeats, command queue) — new, additive.
  // Uses ?action=... so it can never collide with the two legacy paths below.
  var action = e.parameter.action;
  if (action) {
    return AdminPanel_handlePost_(e, action);
  }

  var contents = (e.postData && e.postData.contents) || '';
  var looksLikeJsonUrlUpdate = false;

  try {
    var parsed = JSON.parse(contents);
    if (parsed && typeof parsed.url === 'string') {
      looksLikeJsonUrlUpdate = true;
    }
  } catch (err) {
    // Not JSON — this is the raw CSV upload from the DTS extension.
  }

  if (looksLikeJsonUrlUpdate) {
    var urlUpdateResult = handleUrlRegistryUpdate(e);
    try {
      var parsedBody = JSON.parse(contents);
      PropertiesService.getScriptProperties().setProperty(
        'WHATSAPP_TUNNEL_URL_UPDATED_AT',
        new Date().toISOString()
      );
      AdminPanel_logEvent_('tunnel', 'url_updated', parsedBody.url);
    } catch (logErr) {
      // Never let admin-panel logging break the existing tunnel-update response.
    }
    return urlUpdateResult;
  }

  var csvResult = handleDtsCsvUpload(e);
  try {
    AdminPanel_logEvent_('appsscript', 'csv_upload', 'handleDtsCsvUpload ran');
  } catch (logErr) {
    // Never let admin-panel logging break the existing CSV-upload response.
  }
  return csvResult;
}