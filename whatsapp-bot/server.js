const express = require('express');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');

const PORT = Number(process.env.PORT || 3000);
const TEST_GROUP_JID = process.env.TEST_GROUP_JID || '120363412435970342@g.us';
const SHARED_SECRET = process.env.SHARED_SECRET || 'blahblah';
const ADMIN_SECRET = process.env.ADMIN_SECRET || SHARED_SECRET;
const LOCAL_PORT = Number(process.env.LOCAL_PORT || PORT);
const TUNNEL_FILE = process.env.TUNNEL_FILE || path.join(__dirname, 'cloudflare');

let sock = null;
let whatsappConnected = false;
let botStarting = false;
let lastWhatsAppEvent = null;
let reconnects = 0;

function run(command, timeout = 10000) {
  return new Promise((resolve, reject) => {
    exec(command, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(Object.assign(error, { stdout, stderr }));
      resolve(stdout.trim());
    });
  });
}
function humanUptime(seconds) {
  const d = Math.floor(seconds / 86400); seconds %= 86400;
  const h = Math.floor(seconds / 3600); seconds %= 3600;
  const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}
function memoryText() { return `${((1 - os.freemem() / os.totalmem()) * 100).toFixed(0)}% used`; }
async function diskText() { try { return (await run("df -h / | tail -1 | awk '{print $5}'")) || 'unknown'; } catch { return 'unknown'; } }
function readTunnelUrl() {
  try {
    const value = fs.readFileSync(TUNNEL_FILE, 'utf8').trim();
    return /^https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com\/?$/.test(value) ? value.replace(/\/$/, '') : value;
  } catch { return ''; }
}
async function pm2List() { try { return JSON.parse(await run('pm2 jlist')); } catch { return []; } }
async function findTunnelProcess() {
  const list = await pm2List();
  return list.find(p => /tunnel|cloudflared/i.test(`${p.name} ${p.pm2_env?.pm_exec_path || ''} ${p.pm2_env?.pm_cwd || ''}`));
}

async function startBot() {
  if (botStarting) return;
  botStarting = true;
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    sock = makeWASocket({ auth: state, printQRInTerminal: false });
    whatsappConnected = false;
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      lastWhatsAppEvent = new Date().toISOString();
      if (qr) qrcode.generate(qr, { small: true });
      if (connection === 'close') {
        whatsappConnected = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = code !== DisconnectReason.loggedOut;
        console.log('Connection closed, reconnecting:', shouldReconnect);
        if (shouldReconnect) {
          reconnects++;
          setTimeout(() => startBot(), Math.min(30000, 2000 * reconnects));
        }
      } else if (connection === 'open') {
        whatsappConnected = true;
        reconnects = 0;
        console.log('✅ Connected to WhatsApp');
      }
    });
    sock.ev.on('creds.update', saveCreds);
  } catch (err) {
    whatsappConnected = false;
    console.error('Baileys start error:', err);
    setTimeout(() => startBot(), 5000);
  } finally { botStarting = false; }
}
startBot();

const app = express();
app.use(express.json({ limit: '25mb' }));

// Existing Apps Script webhook — intentionally unchanged.
app.post('/send-file', async (req, res) => {
  try {
    const { secret, filename, base64, caption } = req.body;
    if (secret !== SHARED_SECRET) return res.status(401).json({ error: 'Unauthorized' });
    if (!filename || !base64) return res.status(400).json({ error: 'filename and base64 are required' });
    if (!sock || !whatsappConnected) return res.status(503).json({ error: 'WhatsApp not connected yet' });
    const buffer = Buffer.from(base64, 'base64');
    await sock.sendMessage(TEST_GROUP_JID, { document: buffer, fileName: filename, mimetype: 'application/pdf', caption: caption || '' });
    console.log(`Sent ${filename} to ${TEST_GROUP_JID}`);
    res.json({ status: 'sent', filename });
  } catch (err) {
    console.error('Send error:', err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/health', (req, res) => res.json({ status: 'ok', connected: whatsappConnected }));

function adminAuth(req, res, next) {
  const supplied = req.get('x-admin-secret') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!supplied || supplied !== ADMIN_SECRET) return res.status(401).json({ error: 'Admin authentication required' });
  next();
}
app.use('/admin/api', adminAuth);

app.get('/admin/api/status', async (req, res) => {
  const disk = await diskText();
  const tunnelUrl = readTunnelUrl();
  const tunnelProc = await findTunnelProcess();
  const pm2 = await pm2List();
  const checks = {
    'WhatsApp / Baileys': { ok: whatsappConnected },
    'Express API': { ok: true },
    'Tunnel URL': { ok: !!tunnelUrl, detail: tunnelUrl || 'not detected' },
    'Cloudflare process': { ok: !!tunnelProc, detail: tunnelProc?.name || 'not found' },
    'Auth session': { ok: fs.existsSync(path.join(__dirname, 'auth_info')) },
    'PM2': { ok: pm2.length > 0 }
  };
  const failed = Object.values(checks).filter(x => !x.ok).length;
  const overall = failed === 0 ? { ok: true, label: 'ALL SYSTEMS OPERATIONAL' } : { ok: false, warning: failed < 3, label: `${failed} CHECK${failed > 1 ? 'S' : ''} NEED ATTENTION` };
  res.json({ overall, whatsapp: { connected: whatsappConnected, status: whatsappConnected ? 'Connected' : 'Disconnected', socket: !!sock, auth: fs.existsSync(path.join(__dirname, 'auth_info')), lastEvent: lastWhatsAppEvent }, tunnel: { connected: !!tunnelProc && !!tunnelUrl, url: tunnelUrl, process: tunnelProc?.name || null }, system: { node: process.version, uptimeHuman: humanUptime(process.uptime()), memory: memoryText(), disk, hostname: os.hostname(), platform: os.platform() }, checks });
});

app.get('/admin/api/diagnostics', async (req, res) => {
  const checks = {};
  const pm2 = await pm2List();
  checks['Node.js'] = { ok: true, detail: process.version };
  checks['Express :3000'] = { ok: true, detail: `listening on ${PORT}` };
  checks['Baileys socket'] = { ok: whatsappConnected, detail: whatsappConnected ? 'connection=open' : 'not connected' };
  checks['Auth directory'] = { ok: fs.existsSync(path.join(__dirname, 'auth_info')), detail: 'auth_info' };
  checks['PM2 available'] = { ok: pm2.length > 0, detail: `${pm2.length} process(es)` };
  const tunnel = await findTunnelProcess();
  const tunnelUrl = readTunnelUrl();
  checks['Cloudflare process'] = { ok: !!tunnel, detail: tunnel?.name || 'not found' };
  checks['Tunnel URL file'] = { ok: !!tunnelUrl, detail: tunnelUrl || 'empty/missing' };
  checks['Internet / DNS'] = { ok: await run('getent hosts google.com').then(Boolean).catch(() => false), detail: 'google.com DNS lookup' };
  checks['Webhook health'] = { ok: true, detail: '/health is responding internally' };
  checks['Target group configured'] = { ok: /@g\.us$/.test(TEST_GROUP_JID), detail: TEST_GROUP_JID };
  checks['Apps Script configuration'] = { ok: !!process.env.APPS_SCRIPT_WEBAPP_URL || fs.existsSync(path.join(__dirname, 'tunnel.sh')), detail: process.env.APPS_SCRIPT_WEBAPP_URL ? 'environment variable' : 'tunnel.sh present' };
  const total = Object.keys(checks).length; const passed = Object.values(checks).filter(x => x.ok).length;
  res.json({ ok: passed === total, passed, total, checks });
});

app.get('/admin/api/pm2', async (req, res) => {
  const processes = (await pm2List()).map(p => ({ name: p.name, status: p.pm2_env?.status || 'unknown', restarts: p.pm2_env?.restart_time ?? 0, memory: `${Math.round((p.monit?.memory || 0) / 1024 / 1024)} MB`, cpu: p.monit?.cpu ?? 0, uptime: p.pm2_env?.pm_uptime || null }));
  res.json({ processes, machine: { hostname: os.hostname(), cpu: os.loadavg()[0].toFixed(2), memory: memoryText(), disk: await diskText() } });
});

app.post('/admin/api/pm2/restart', async (req, res) => {
  const name = String(req.body?.name || '');
  if (!name || !/^[a-zA-Z0-9_.:@-]+$/.test(name)) return res.status(400).json({ error: 'Invalid PM2 process name' });
  try { await run(`pm2 restart ${JSON.stringify(name)}`); res.json({ ok: true, message: `PM2 restart requested for ${name}` }); }
  catch (e) { res.status(500).json({ error: e.stderr || e.message }); }
});

app.post('/admin/api/bot/restart', async (req, res) => {
  const self = (await pm2List()).find(p => /whatsapp|server\.js/i.test(`${p.name} ${p.pm2_env?.pm_exec_path || ''}`));
  if (!self) return res.status(404).json({ error: 'Could not identify the WhatsApp bot PM2 process' });
  res.json({ ok: true, message: `Restarting ${self.name}` });
  setTimeout(() => run(`pm2 restart ${JSON.stringify(self.name)}`).catch(console.error), 150);
});

app.post('/admin/api/whatsapp/reconnect', async (req, res) => {
  try { if (sock) { try { sock.ws?.close(); } catch {} } sock = null; whatsappConnected = false; reconnects = 0; await startBot(); res.json({ ok: true, message: 'WhatsApp reconnect initiated' }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/api/groups', async (req, res) => {
  if (!sock || !whatsappConnected) return res.status(503).json({ error: 'WhatsApp is not connected' });
  try { const groups = await sock.groupFetchAllParticipating(); res.json({ groups: Object.entries(groups).map(([id, g]) => ({ id, name: g.subject || id })).sort((a,b) => a.name.localeCompare(b.name)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/api/test-message', async (req, res) => {
  if (!sock || !whatsappConnected) return res.status(503).json({ error: 'WhatsApp is not connected' });
  const jid = req.body?.jid || TEST_GROUP_JID;
  try { await sock.sendMessage(jid, { text: `🟢 SheeraZ Control Center test — ${new Date().toLocaleString()}` }); res.json({ ok: true, message: `Test message sent to ${jid}` }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/api/tunnel', async (req, res) => {
  const proc = await findTunnelProcess();
  res.json({ connected: !!proc && !!readTunnelUrl(), url: readTunnelUrl(), process: proc?.name || null, localTarget: `http://localhost:${LOCAL_PORT}` });
});
app.post('/admin/api/tunnel/restart', async (req, res) => {
  const proc = await findTunnelProcess();
  if (proc) { try { await run(`pm2 restart ${JSON.stringify(proc.name)}`); return res.json({ ok: true, message: `Tunnel process ${proc.name} restarted` }); } catch (e) { return res.status(500).json({ error: e.stderr || e.message }); } }
  try { const child = spawn('bash', [path.join(__dirname, 'tunnel.sh')], { cwd: __dirname, detached: true, stdio: 'ignore' }); child.unref(); res.json({ ok: true, message: 'Started tunnel.sh directly because no PM2 tunnel process was found' }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

async function reportTunnelUrl(url) {
  const endpoint = process.env.APPS_SCRIPT_WEBAPP_URL;
  const secret = process.env.URL_UPDATE_SECRET;
  if (!endpoint || !secret) throw new Error('Set APPS_SCRIPT_WEBAPP_URL and URL_UPDATE_SECRET in the bot PM2 environment for manual tunnel reporting');
  const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, url }) });
  if (!r.ok) throw new Error(`Apps Script returned HTTP ${r.status}`);
  return r.json().catch(() => ({}));
}
app.post('/admin/api/tunnel/report', async (req, res) => {
  try { const url = readTunnelUrl(); if (!url) throw new Error('No tunnel URL detected'); await reportTunnelUrl(url); res.json({ ok: true, message: `Reported ${url} to Apps Script` }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/admin/api/tunnel/manual-url', async (req, res) => {
  const url = String(req.body?.url || '').trim().replace(/\/$/, '');
  if (!/^https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com$/.test(url)) return res.status(400).json({ error: 'Enter a valid trycloudflare.com URL' });
  try { fs.writeFileSync(TUNNEL_FILE, url + '\n'); await reportTunnelUrl(url); res.json({ ok: true, message: `Manual URL saved and reported: ${url}` }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/api/logs', async (req, res) => {
  try { const pm2 = await pm2List(); const self = pm2.find(p => /whatsapp|server\.js/i.test(`${p.name} ${p.pm2_env?.pm_exec_path || ''}`)); if (!self) return res.json({ logs: 'No WhatsApp PM2 process identified.' }); const logs = await run(`pm2 logs ${JSON.stringify(self.name)} --lines 120 --nostream`, 15000); res.json({ logs }); }
  catch (e) { res.status(500).json({ error: e.stderr || e.message }); }
});

app.post('/admin/api/repair', async (req, res) => {
  const actions = [];
  try {
    if (!whatsappConnected) { await startBot(); actions.push('initiated WhatsApp reconnect'); }
    const tunnel = await findTunnelProcess();
    if (!tunnel && !readTunnelUrl()) { const child = spawn('bash', [path.join(__dirname, 'tunnel.sh')], { cwd: __dirname, detached: true, stdio: 'ignore' }); child.unref(); actions.push('started tunnel.sh'); }
    if (!actions.length) actions.push('no safe repair needed');
    res.json({ ok: true, message: actions.join('; ') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Serve only the two intended admin assets. Never expose auth_info, scripts or config files.
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/admin/admin.js', (req, res) => res.sendFile(path.join(__dirname, 'admin.js')));

app.listen(PORT, () => console.log(`Webhook + Admin server listening on port ${PORT}`));
