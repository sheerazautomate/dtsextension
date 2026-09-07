/**
 * AdminPanel.js — additive only. Does NOT define doGet or doPost (those
 * already exist in Code.js and router.js) — it's called FROM them via a
 * couple of small edits in each. See ADMIN_PANEL_SETUP.md for exactly what
 * changed and why.
 *
 * ADMIN_PANEL_SECRET is a Script property (see config.js / SCRIPT_PROPERTIES.example).
 * The property name is different from SHARED_SECRET / WHATSAPP_SHARED_SECRET /
 * URL_UPDATE_SECRET so Apps Script's shared global scope cannot collide.
 */

function AdminPanel_secret_() {
  return scriptProp_('ADMIN_PANEL_SECRET');
}

var ADMIN_EVENT_LOG_SHEET = 'AdminEventLog';
var ADMIN_MAX_EVENTS = 100;

// ===================== Entry points called from doGet / doPost =====================

function AdminPanel_handleGet_(e) {
  if (!secretsMatch_(AdminPanel_secret_(), e.parameter.secret)) {
    return AdminPanel_json_({ ok: false, error: 'unauthorized' });
  }
  return AdminPanel_json_(AdminPanel_getStatus_());
}

function AdminPanel_handlePost_(e, action) {
  var body = {};
  try {
    body = JSON.parse(e.postData.contents || '{}');
  } catch (err) {
    return AdminPanel_json_({ ok: false, error: 'invalid JSON body' });
  }

  if (!secretsMatch_(AdminPanel_secret_(), body.secret)) {
    return AdminPanel_json_({ ok: false, error: 'unauthorized' });
  }

  try {
    switch (action) {
      case 'botHeartbeat':
        return AdminPanel_json_(AdminPanel_handleHeartbeat_('bot', body));
      case 'extensionHeartbeat':
        return AdminPanel_json_(AdminPanel_handleHeartbeat_('extension', body));
      case 'queueCommand':
        return AdminPanel_json_(AdminPanel_handleQueueCommand_(body));
      case 'ackCommand':
        return AdminPanel_json_(AdminPanel_handleAckCommand_(body));
      default:
        return AdminPanel_json_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    AdminPanel_logEvent_('adminpanel', 'error', action + ': ' + String(err));
    return AdminPanel_json_({ ok: false, error: String(err) });
  }
}

// ===================== Heartbeats =====================

function AdminPanel_handleHeartbeat_(source, body) {
  var props = PropertiesService.getScriptProperties();
  var data = {};
  for (var k in body) if (k !== 'secret') data[k] = body[k];
  data.receivedAt = new Date().toISOString();
  props.setProperty('adminpanel_heartbeat_' + source, JSON.stringify(data));

  var command = AdminPanel_getPendingCommand_(source);
  return { ok: true, command: command };
}

// ===================== Command queue =====================

function AdminPanel_handleQueueCommand_(body) {
  var target = body.target;
  if (!target || ['bot', 'tunnel', 'extension'].indexOf(target) === -1) {
    return { ok: false, error: 'invalid target' };
  }
  var props = PropertiesService.getScriptProperties();
  var command = {
    id: Utilities.getUuid(),
    command: body.command,
    params: body.params || {},
    queuedAt: new Date().toISOString()
  };
  props.setProperty('adminpanel_command_' + target, JSON.stringify(command));
  AdminPanel_logEvent_(target, 'command_queued', body.command);
  return { ok: true, id: command.id };
}

function AdminPanel_getPendingCommand_(target) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('adminpanel_command_' + target);
  return raw ? JSON.parse(raw) : null;
}

function AdminPanel_handleAckCommand_(body) {
  var target = body.target;
  var props = PropertiesService.getScriptProperties();
  var current = AdminPanel_getPendingCommand_(target);
  if (current && current.id === body.id) {
    props.deleteProperty('adminpanel_command_' + target);
    AdminPanel_logEvent_(target, 'command_acked', JSON.stringify({
      command: current.command,
      result: body.result || null
    }));
  }
  return { ok: true };
}

// ===================== Event log (ring buffer via Sheet) =====================
// Called from here AND from router.js (for the two legacy doPost paths) and
// from Code.js's doGet edit — see ADMIN_PANEL_SETUP.md.

function AdminPanel_logEvent_(source, type, message) {
  var sheet = AdminPanel_getOrCreateSheet_(ADMIN_EVENT_LOG_SHEET, ['Timestamp', 'Source', 'Type', 'Message']);
  sheet.appendRow([new Date().toISOString(), source, type, String(message).slice(0, 500)]);
  var lastRow = sheet.getLastRow();
  if (lastRow > ADMIN_MAX_EVENTS + 1) {
    sheet.deleteRows(2, lastRow - ADMIN_MAX_EVENTS - 1);
  }
}

function AdminPanel_getRecentEvents_() {
  var sheet = AdminPanel_getOrCreateSheet_(ADMIN_EVENT_LOG_SHEET, ['Timestamp', 'Source', 'Type', 'Message']);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var numRows = Math.min(ADMIN_MAX_EVENTS, lastRow - 1);
  var startRow = lastRow - numRows + 1;
  var values = sheet.getRange(startRow, 1, numRows, 4).getValues();
  return values.reverse().map(function (r) {
    return { timestamp: r[0], source: r[1], type: r[2], message: r[3] };
  });
}

// ===================== Combined status for the admin panel =====================

function AdminPanel_getStatus_() {
  var props = PropertiesService.getScriptProperties();

  // Reuses the SAME property waUrlRegistry.js already writes to
  // (WHATSAPP_TUNNEL_URL) — do not rename that key, getWhatsAppWebhookUrl()
  // in waUrlRegistry.js depends on it directly.
  var tunnelUrl = props.getProperty('WHATSAPP_TUNNEL_URL');
  var tunnelUpdatedAt = props.getProperty('WHATSAPP_TUNNEL_URL_UPDATED_AT');

  return {
    ok: true,
    serverTime: new Date().toISOString(),
    tunnel: tunnelUrl ? { url: tunnelUrl, updatedAt: tunnelUpdatedAt || null } : null,
    bot: AdminPanel_safeParse_(props.getProperty('adminpanel_heartbeat_bot')),
    extension: AdminPanel_safeParse_(props.getProperty('adminpanel_heartbeat_extension')),
    pendingCommands: {
      bot: AdminPanel_getPendingCommand_('bot'),
      tunnel: AdminPanel_getPendingCommand_('tunnel'),
      extension: AdminPanel_getPendingCommand_('extension')
    },
    recentEvents: AdminPanel_getRecentEvents_()
  };
}

// ===================== Helpers =====================

function AdminPanel_getOrCreateSheet_(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(header);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function AdminPanel_safeParse_(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function AdminPanel_json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
