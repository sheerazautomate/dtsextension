// index.js — Minimal entry point.
// The production bot runs via server.js (which includes the webhook, scheduler,
// heartbeats, etc.). This file is kept for backwards compatibility and for
// quick local testing without the full Express server.
//
// For production use: node server.js (or pm2 start server.js)
// For quick test:     node index.js (just connects to WhatsApp, no webhooks)

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');

const RECONNECT_BASE_DELAY_MS = 3000;
const RECONNECT_MAX_DELAY_MS = 60000;
let reconnectAttempts = 0;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) qrcode.generate(qr, { small: true });

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed, reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        reconnectAttempts++;
        const delay = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts - 1), RECONNECT_MAX_DELAY_MS);
        console.log(`Reconnect attempt ${reconnectAttempts} — waiting ${Math.round(delay / 1000)}s`);
        setTimeout(startBot, delay);
      }
    } else if (connection === 'open') {
      reconnectAttempts = 0;
      console.log('✅ Connected to WhatsApp');
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

startBot();
