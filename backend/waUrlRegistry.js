// ==== URL REGISTRY: receives tunnel URL updates from the Linux box ====
// URL_UPDATE_SECRET is a Script property — see backend/SCRIPT_PROPERTIES.example.

function handleUrlRegistryUpdate(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    if (!secretsMatch_(scriptProp_('URL_UPDATE_SECRET'), body.secret)) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'Unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (!body.url) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'url required' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    PropertiesService.getScriptProperties().setProperty('WHATSAPP_TUNNEL_URL', body.url);

    Logger.log('Tunnel URL updated to: ' + body.url);
    return ContentService.createTextOutput(JSON.stringify({ status: 'updated', url: body.url }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Helper to fetch the currently stored tunnel URL
function getWhatsAppWebhookUrl() {
  var base = PropertiesService.getScriptProperties().getProperty('WHATSAPP_TUNNEL_URL');
  if (!base) {
    throw new Error('No tunnel URL set yet. Run the updater script on the Linux box first.');
  }
  return base + '/send-file';
}