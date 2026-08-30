const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');

// ==== CONFIG ====
const PORT = 3000;
const TEST_GROUP_JID = '120363412435970342@g.us'; // "Test" group
const SHARED_SECRET = 'blahblah'; // simple auth so randoms can't hit your webhook
// ================

let sock;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) qrcode.generate(qr, { small: true });

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed, reconnecting:', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ Connected to WhatsApp');
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

startBot();

// ==== HTTP SERVER ====
const app = express();
app.use(express.json({ limit: '25mb' })); // PDFs are small (KB-2MB) but give headroom

app.post('/send-file', async (req, res) => {
  try {
    const { secret, filename, base64, caption } = req.body;

    if (secret !== SHARED_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!filename || !base64) {
      return res.status(400).json({ error: 'filename and base64 are required' });
    }
    if (!sock) {
      return res.status(503).json({ error: 'WhatsApp not connected yet' });
    }

    const buffer = Buffer.from(base64, 'base64');

    await sock.sendMessage(TEST_GROUP_JID, {
      document: buffer,
      fileName: filename,
      mimetype: 'application/pdf',
      caption: caption || ''
    });

    console.log(`Sent ${filename} to Test group`);
    res.json({ status: 'sent', filename });
  } catch (err) {
    console.error('Send error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', connected: !!sock }));

app.listen(PORT, () => console.log(`Webhook server listening on port ${PORT}`));
