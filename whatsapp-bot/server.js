require('dotenv').config();
const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const initScheduler = require('./scheduler'); // ADDED
const { fetchMepcoBill, formatBillMessage } = require('./mepco'); // ADDED
const { renderBillPdf, cleanupOldPdfs } = require('./mepco-pdf'); // ADDED

function requiredEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(
      `Missing required environment variable ${name}. Copy whatsapp-bot/.env.example to .env and fill it in.`
    );
  }
  return String(v).trim();
}

// ==== CONFIG (no secrets in source — see .env.example / SECURITY.md) ====
const PORT = process.env.PORT || 3000;
const TEST_GROUP_JID = requiredEnv('WHATSAPP_GROUP_JID');
const SHARED_SECRET = requiredEnv('WHATSAPP_SHARED_SECRET');
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
const APPS_SCRIPT_SECRET = process.env.APPS_SCRIPT_SECRET || '';
const HEARTBEAT_INTERVAL_MS = 15000;
const EVENT_BUFFER_SIZE = 50;
const RECONNECT_BASE_DELAY_MS = 3000;   // initial reconnect delay
const RECONNECT_MAX_DELAY_MS = 60000;   // cap at 1 minute
const MEPCO_PDF_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // ADDED — sweep old PDFs every 6h
const MEPCO_PDF_MAX_AGE_HOURS = 24; // ADDED
// ================

let sock;
let attachContactListeners = () => {}; // ADDED — replaced once initScheduler() runs below
let reconnectAttempts = 0;             // tracks consecutive failed reconnects for backoff
const startedAt = Date.now();
const stats = {
  connected: false,
  reconnectCount: 0,
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  lastDisconnectReason: null,
  lastError: null,
  sendCount: 0,
  sendFailCount: 0,
  lastSendAt: null,
  lastSendResult: null
};
const eventBuffer = []; // local ring buffer, independent of Apps Script's log

function pushEvent(type, message) {
  eventBuffer.push({ timestamp: new Date().toISOString(), type, message });
  if (eventBuffer.length > EVENT_BUFFER_SIZE) eventBuffer.shift();
  console.log(`[${type}] ${message}`);
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrcode.generate(qr, { small: true });
      pushEvent('qr', 'New QR code printed to terminal — scan to (re)link the device');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      stats.connected = false;
      stats.lastDisconnectedAt = new Date().toISOString();
      stats.lastDisconnectReason = statusCode || 'unknown';
      pushEvent('connection', `Closed (code ${statusCode}). Reconnecting: ${shouldReconnect}`);
      if (shouldReconnect) {
        stats.reconnectCount++;
        reconnectAttempts++;
        // Exponential backoff: 3s, 6s, 12s, 24s, 48s, 60s, 60s, ...
        const delay = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts - 1), RECONNECT_MAX_DELAY_MS);
        pushEvent('reconnect', `Attempt ${reconnectAttempts} — waiting ${Math.round(delay / 1000)}s before reconnect`);
        setTimeout(startBot, delay);
      } else {
        stats.lastError = 'logged out — re-pair required (scan QR again)';
        pushEvent('error', stats.lastError);
      }
    } else if (connection === 'open') {
      stats.connected = true;
      stats.lastConnectedAt = new Date().toISOString();
      reconnectAttempts = 0; // reset backoff on successful connection
      pushEvent('connection', '✅ Connected to WhatsApp');
      attachContactListeners(); // ADDED — re-hook contact sync on this (possibly new) sock
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ==== ADDED: MEPCO bill lookup — DMs only, never responds in groups ====
  // "bill <14 digits>"        -> text summary (unchanged behaviour)
  // "bill <14 digits> pdf"    -> renders and sends the authentic bill PDF
  // "<14 digits>"             -> text summary (unchanged behaviour)
  // "<14 digits> pdf"         -> renders and sends the authentic bill PDF
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg || msg.key.fromMe || m.type !== 'notify') return;

    // DM-only guard: ignore anything sent from/in a group chat.
    if (msg.key.remoteJid?.endsWith('@g.us')) return;

    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      '';

    const billMatch =
      text.match(/^bill\s+(\d{14})\s*(pdf)?\s*$/i) ||
      text.match(/^(\d{14})\s*(pdf)?\s*$/i);
    if (!billMatch) return;

    const refNo = billMatch[1];
    const wantsPdf = Boolean(billMatch[2]);
    const jid = msg.key.remoteJid;
    pushEvent('mepco', `Bill lookup requested: ${refNo}${wantsPdf ? ' (pdf)' : ''}`);

    if (wantsPdf) {
      try {
        await sock.sendMessage(jid, { text: `🔎 Generating MEPCO bill PDF for ${refNo}...` });
        const { pdfPath, bill } = await renderBillPdf(refNo);
        const buffer = await require('fs/promises').readFile(pdfPath);
        await sock.sendMessage(jid, {
          document: buffer,
          fileName: `mepco_${refNo}.pdf`,
          mimetype: 'application/pdf',
          caption: formatBillMessage(bill)
        });
        pushEvent('mepco_pdf', `PDF sent: ${refNo}`);
      } catch (err) {
        pushEvent('mepco_pdf_error', `${refNo}: ${err.message}`);
        await sock.sendMessage(jid, {
          text: `⚠️ Could not generate the bill PDF right now (${err.message}). Try "bill ${refNo}" for the text summary instead.`
        });
      }
      return;
    }

    try {
      await sock.sendMessage(jid, { text: `🔎 Checking MEPCO bill for ${refNo}...` });
      const bill = await fetchMepcoBill(refNo);
      if (bill) {
        await sock.sendMessage(jid, { text: formatBillMessage(bill) });
        pushEvent('mepco', `Bill lookup ok: ${refNo}`);
      } else {
        await sock.sendMessage(jid, {
          text: `❌ No bill found for reference number ${refNo}. Double-check the 14-digit reference number.`
        });
        pushEvent('mepco', `Bill lookup not found: ${refNo}`);
      }
    } catch (err) {
      pushEvent('mepco_error', `${refNo}: ${err.message}`);
      await sock.sendMessage(jid, {
        text: '⚠️ Could not fetch the bill right now — MEPCO may be down/slow, or (less likely, since this runs locally in Pakistan) a network issue. Try again shortly.'
      });
    }
  });
  // ================
}

startBot();

// ==== Send helper (shared by the webhook and the "send test message" command) ====
async function sendDocument({ filename, base64, caption }) {
  if (!sock) throw new Error('WhatsApp not connected yet');
  const buffer = Buffer.from(base64, 'base64');
  await sock.sendMessage(TEST_GROUP_JID, {
    document: buffer,
    fileName: filename,
    mimetype: 'application/pdf',
    caption: caption || ''
  });
}

async function sendText(text) {
  if (!sock) throw new Error('WhatsApp not connected yet');
  await sock.sendMessage(TEST_GROUP_JID, { text });
}

// ==== ADDED: scheduler-facing wrappers (any jid, not just TEST_GROUP_JID) ====
// These do NOT replace sendText/sendDocument above — /send-file and the
// admin "sendTestMessage" command keep using the originals untouched.
async function schedulerSendText(jid, text) {
  if (!sock) throw new Error('WhatsApp not connected yet');
  await sock.sendMessage(jid, { text });
}

async function schedulerSendDocument(jid, buffer, filename, caption) {
  if (!sock) throw new Error('WhatsApp not connected yet');
  await sock.sendMessage(jid, {
    document: buffer,
    fileName: filename,
    mimetype: 'application/pdf',
    caption: caption || ''
  });
}
// ================

// ==== Apps Script heartbeat + command polling ====
async function pushHeartbeat() {
  if (!APPS_SCRIPT_URL || !APPS_SCRIPT_SECRET) return; // not configured — skip silently

  const payload = {
    secret: APPS_SCRIPT_SECRET,
    connected: stats.connected,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    reconnectCount: stats.reconnectCount,
    lastConnectedAt: stats.lastConnectedAt,
    lastDisconnectedAt: stats.lastDisconnectedAt,
    lastDisconnectReason: stats.lastDisconnectReason,
    lastError: stats.lastError,
    sendCount: stats.sendCount,
    sendFailCount: stats.sendFailCount,
    lastSendAt: stats.lastSendAt,
    lastSendResult: stats.lastSendResult,
    groupJid: TEST_GROUP_JID,
    pid: process.pid,
    nodeVersion: process.version
  };

  try {
    const res = await fetch(APPS_SCRIPT_URL + '?action=botHeartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json().catch(() => null);
    if (result && result.command) {
      await handleRemoteCommand(result.command);
    }
  } catch (err) {
    // Heartbeat failures are non-fatal — log locally, don't crash the bot.
    pushEvent('heartbeat_error', String(err.message || err));
  }
}

async function ackCommand(id, result) {
  if (!APPS_SCRIPT_URL || !APPS_SCRIPT_SECRET) return;
  try {
    await fetch(APPS_SCRIPT_URL + '?action=ackCommand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: APPS_SCRIPT_SECRET, target: 'bot', id, result })
    });
  } catch (err) {
    pushEvent('ack_error', String(err.message || err));
  }
}

const handledCommandIds = new Set();

async function handleRemoteCommand(command) {
  if (!command || handledCommandIds.has(command.id)) return;
  handledCommandIds.add(command.id);
  pushEvent('command', `Received: ${command.command}`);

  if (command.command === 'restartBot') {
    await ackCommand(command.id, { ok: true, note: 'restarting now' });
    pushEvent('command', 'Restarting process (expects a process manager like pm2 to bring it back up)');
    setTimeout(() => process.exit(1), 500); // non-zero exit so pm2 restarts it
    return;
  }

  if (command.command === 'sendTestMessage') {
    try {
      const text = (command.params && command.params.text) || '🔧 Test message from the admin panel';
      await sendText(text);
      await ackCommand(command.id, { ok: true });
      pushEvent('command', 'Test message sent');
    } catch (err) {
      await ackCommand(command.id, { ok: false, error: String(err.message || err) });
      pushEvent('command_error', String(err.message || err));
    }
    return;
  }

  // Unknown command — ack so it doesn't stay queued forever.
  await ackCommand(command.id, { ok: false, error: 'unknown command' });
}

setInterval(pushHeartbeat, HEARTBEAT_INTERVAL_MS);
pushHeartbeat();

// ==== ADDED: periodic cleanup of rendered MEPCO bill PDFs ====
setInterval(() => {
  cleanupOldPdfs(MEPCO_PDF_MAX_AGE_HOURS)
    .then((n) => { if (n > 0) pushEvent('mepco_pdf_cleanup', `Removed ${n} PDF(s) older than ${MEPCO_PDF_MAX_AGE_HOURS}h`); })
    .catch((err) => pushEvent('mepco_pdf_cleanup_error', String(err.message || err)));
}, MEPCO_PDF_CLEANUP_INTERVAL_MS);
// ================

// ==== HTTP SERVER ====
const app = express();
app.use(express.json({ limit: '25mb' })); // PDFs are small (KB-2MB) but give headroom
app.use(express.static('public')); // ADDED — serves public/index.html (the scheduler UI)

app.post('/send-file', async (req, res) => {
  try {
    const { secret, filename, base64, caption } = req.body;

    if (secret !== SHARED_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!filename || !base64) {
      return res.status(400).json({ error: 'filename and base64 are required' });
    }

    await sendDocument({ filename, base64, caption });

    stats.sendCount++;
    stats.lastSendAt = new Date().toISOString();
    stats.lastSendResult = { ok: true, filename };
    pushEvent('send', `Sent ${filename} to group`);

    res.json({ status: 'sent', filename });
  } catch (err) {
    stats.sendFailCount++;
    stats.lastSendAt = new Date().toISOString();
    stats.lastSendResult = { ok: false, error: err.message };
    pushEvent('send_error', err.message);
    console.error('Send error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Minimal, unauthenticated — kept identical to the original contract.
app.get('/health', (req, res) => res.json({ status: 'ok', connected: !!sock && stats.connected }));

// Richer diagnostics — gated by the same shared secret as /send-file.
// Safe to expose through the public tunnel: no secrets are echoed back.
app.get('/diagnostics', (req, res) => {
  if (req.query.secret !== SHARED_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({
    connected: stats.connected,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    reconnectCount: stats.reconnectCount,
    lastConnectedAt: stats.lastConnectedAt,
    lastDisconnectedAt: stats.lastDisconnectedAt,
    lastDisconnectReason: stats.lastDisconnectReason,
    lastError: stats.lastError,
    sendCount: stats.sendCount,
    sendFailCount: stats.sendFailCount,
    lastSendAt: stats.lastSendAt,
    lastSendResult: stats.lastSendResult,
    groupJid: TEST_GROUP_JID,
    pid: process.pid,
    nodeVersion: process.version,
    recentEvents: eventBuffer.slice().reverse()
  });
});

// ==== ADDED: wire up the message scheduler (new /groups, /contacts, /schedules* routes) ====
({ attachContactListeners } = initScheduler({
  app,
  getSock: () => sock,
  sendText: schedulerSendText,
  sendDocument: schedulerSendDocument,
  pushEvent,
  WHATSAPP_SHARED_SECRET: SHARED_SECRET,
}));
// ================

app.listen(PORT, () => console.log(`Webhook server listening on port ${PORT}`));
