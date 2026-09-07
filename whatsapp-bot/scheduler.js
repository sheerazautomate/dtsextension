// scheduler.js
//
// Message scheduler engine for the existing dts-whatsapp-bot process.
// This module is require()'d and run IN-PROCESS by server.js — it does not
// open its own Baileys connection. It expects server.js to pass it the live
// `sock` instance (or a getter for it) plus the existing sendText/sendDocument
// helpers and pushEvent logger, and it registers its own routes on the
// existing express `app`.
//
// Usage from server.js (see integration snippet at the bottom of this file
// for the exact wiring):
//
//   const initScheduler = require('./scheduler');
//   initScheduler({ app, getSock, sendText, sendDocument, pushEvent, WHATSAPP_SHARED_SECRET });
//
// Persistence: flat JSON file at whatsapp-bot/scheduled_messages.json.
// Attachments: written to disk at creation time under
//   whatsapp-bot/scheduled-attachments/<schedule-id>/<filename>
// Tick loop: setInterval every 30s, matching this project's existing polling
// cadence (15s heartbeats, 10s tunnel polling elsewhere in the codebase).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = __dirname;
const SCHEDULES_FILE = path.join(DATA_DIR, 'scheduled_messages.json');
const ATTACHMENTS_DIR = path.join(DATA_DIR, 'scheduled-attachments');
const MESSAGES_FILE = path.join(DATA_DIR, 'chat_history.json');
const TIMEZONE = 'Asia/Karachi'; // fixed operator timezone, stored explicitly per spec
const TICK_MS = 30 * 1000;
const SEND_SPACING_MS = 1500; // fallback stagger when a schedule has no jitter set
const DEFAULT_INTER_SCHEDULE_JITTER = { minSec: 5, maxSec: 20 }; // gap between different schedules firing in the same tick
const MAX_MESSAGES_PER_CHAT = 200; // rolling cap, oldest trimmed

function randomDelayMs(minSec, maxSec) {
  const lo = Math.max(0, Number(minSec) || 0);
  const hi = Math.max(lo, Number(maxSec) || lo);
  return Math.floor((lo + Math.random() * (hi - lo)) * 1000);
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function genId() {
  return crypto.randomBytes(6).toString('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDirs() {
  if (!fs.existsSync(ATTACHMENTS_DIR)) {
    fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
  }
}

// Get the current time as parts (hour, minute, weekday) in Asia/Karachi,
// without pulling in a date library — Karachi is a fixed UTC+5, no DST.
function karachiParts(date = new Date()) {
  const utcMs = date.getTime();
  const karachiMs = utcMs + 5 * 60 * 60 * 1000;
  const k = new Date(karachiMs);
  return {
    year: k.getUTCFullYear(),
    month: k.getUTCMonth(), // 0-indexed
    day: k.getUTCDate(),
    hour: k.getUTCHours(),
    minute: k.getUTCMinutes(),
    weekday: k.getUTCDay(), // 0 = Sunday
  };
}

// Build a UTC Date corresponding to a given Karachi wall-clock date+time.
function karachiWallClockToUtc({ year, month, day, hour, minute }) {
  // Treat the given y/m/d/h/m as Karachi local time (UTC+5), convert to UTC.
  const asIfUtcMs = Date.UTC(year, month, day, hour, minute, 0, 0);
  return new Date(asIfUtcMs - 5 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

let store = { schedules: [] };
let writeQueue = Promise.resolve();

function loadStore() {
  ensureDirs();
  if (fs.existsSync(SCHEDULES_FILE)) {
    try {
      const raw = fs.readFileSync(SCHEDULES_FILE, 'utf8');
      store = JSON.parse(raw);
      if (!Array.isArray(store.schedules)) store.schedules = [];
    } catch (err) {
      // Corrupt file: back it up rather than silently discarding data.
      const backupPath = SCHEDULES_FILE + '.corrupt-' + Date.now();
      try { fs.copyFileSync(SCHEDULES_FILE, backupPath); } catch (_) {}
      store = { schedules: [] };
    }
  } else {
    store = { schedules: [] };
    persist();
  }
}

// Serialize writes so concurrent create/edit/fire calls can't race and
// clobber each other's changes to the same file.
function persist() {
  writeQueue = writeQueue.then(() => new Promise((resolve, reject) => {
    const tmpPath = SCHEDULES_FILE + '.tmp';
    fs.writeFile(tmpPath, JSON.stringify(store, null, 2), (err) => {
      if (err) return reject(err);
      fs.rename(tmpPath, SCHEDULES_FILE, (err2) => {
        if (err2) return reject(err2);
        resolve();
      });
    });
  })).catch((err) => {
    // Swallow so the queue keeps flowing for the next write; caller-visible
    // logging happens via pushEvent at the call site.
    console.error('[scheduler] persist error:', err);
  });
  return writeQueue;
}

// ---------------------------------------------------------------------------
// Schedule model helpers
// ---------------------------------------------------------------------------

function computeNextRunAtOnce(schedule) {
  // schedule.runAt is an ISO string with explicit offset, e.g.
  // "2026-09-10T14:00:00+05:00" — Date() parses the offset correctly.
  return new Date(schedule.runAt).toISOString();
}

function computeNextRunAtRecurring(schedule, fromDate = new Date()) {
  const { frequency, time, daysOfWeek } = schedule.recurring;
  const [hh, mm] = time.split(':').map(Number);
  const kp = karachiParts(fromDate);

  if (frequency === 'daily') {
    let candidate = karachiWallClockToUtc({
      year: kp.year, month: kp.month, day: kp.day, hour: hh, minute: mm,
    });
    if (candidate.getTime() <= fromDate.getTime()) {
      // today's slot already passed — move to tomorrow (Karachi wall clock)
      const nextDay = karachiWallClockToUtc({
        year: kp.year, month: kp.month, day: kp.day + 1, hour: hh, minute: mm,
      });
      candidate = nextDay;
    }
    return candidate.toISOString();
  }

  if (frequency === 'weekly') {
    const days = [...daysOfWeek].sort((a, b) => a - b);
    for (let offset = 0; offset <= 7; offset++) {
      const checkDate = karachiWallClockToUtc({
        year: kp.year, month: kp.month, day: kp.day + offset, hour: hh, minute: mm,
      });
      const checkWeekday = karachiParts(checkDate).weekday;
      if (days.includes(checkWeekday) && checkDate.getTime() > fromDate.getTime()) {
        return checkDate.toISOString();
      }
    }
    // Fallback (shouldn't normally hit): one week out on the first configured day
    const fallback = karachiWallClockToUtc({
      year: kp.year, month: kp.month, day: kp.day + 7, hour: hh, minute: mm,
    });
    return fallback.toISOString();
  }

  throw new Error(`Unknown frequency: ${frequency}`);
}

function computeInitialNextRunAt(schedule) {
  if (schedule.type === 'once') {
    return computeNextRunAtOnce(schedule);
  }
  return computeNextRunAtRecurring(schedule, new Date());
}

function toPublicSchedule(s) {
  // Omit nothing sensitive currently lives in schedule records (no secrets
  // stored per-schedule), so this is mostly a pass-through, kept as a single
  // seam in case fields need hiding later.
  return s;
}

// ---------------------------------------------------------------------------
// Attachment handling
// ---------------------------------------------------------------------------

function saveAttachment(scheduleId, attachment) {
  // attachment: { filename, base64 }
  const dir = path.join(ATTACHMENTS_DIR, scheduleId);
  fs.mkdirSync(dir, { recursive: true });
  const safeName = path.basename(attachment.filename); // strip any path traversal
  const filePath = path.join(dir, safeName);
  fs.writeFileSync(filePath, Buffer.from(attachment.base64, 'base64'));
  return { filename: safeName, path: filePath };
}

function deleteAttachments(scheduleId) {
  const dir = path.join(ATTACHMENTS_DIR, scheduleId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Contact store (populated from Baileys contacts.upsert / contacts.update)
// ---------------------------------------------------------------------------

const CONTACTS_FILE = path.join(DATA_DIR, 'known_contacts.json');
let contactStore = {}; // jid -> { jid, name }

function loadContacts() {
  if (fs.existsSync(CONTACTS_FILE)) {
    try {
      contactStore = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
    } catch (_) {
      contactStore = {};
    }
  }
}

function persistContacts() {
  fs.writeFile(CONTACTS_FILE, JSON.stringify(contactStore, null, 2), () => {});
}

function isIndividualJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@s.whatsapp.net');
}

function upsertContacts(contacts) {
  // contacts: array of Baileys contact objects, each with .id and possibly
  // .name / .notify / .verifiedName
  let changed = false;
  for (const c of contacts) {
    if (!c || !c.id) continue;
    if (!isIndividualJid(c.id)) continue; // skip group ids etc, this store is individuals only
    const name = c.name || c.notify || c.verifiedName || contactStore[c.id]?.name || c.id;
    const existing = contactStore[c.id];
    if (!existing || existing.name !== name) {
      contactStore[c.id] = { jid: c.id, name };
      changed = true;
    }
  }
  if (changed) persistContacts();
}

// Fallback source: capture the sender of any message the bot sees (incoming
// or outgoing) as a known contact. This fills gaps for contacts that never
// arrive via contacts.upsert/contacts.update in a given session — very
// common on a fresh or partially-synced login.
function upsertContactFromMessage(msg) {
  if (!msg || !msg.key) return;
  const jid = msg.key.participant || msg.key.remoteJid; // participant set for group messages
  if (!isIndividualJid(jid)) return;
  const name = msg.pushName || contactStore[jid]?.name || jid;
  const existing = contactStore[jid];
  if (!existing || (msg.pushName && existing.name !== name)) {
    contactStore[jid] = { jid, name };
    persistContacts();
  }
}

// Fallback source: pull participants out of every group the bot is in.
// These are real, addressable individual JIDs even if WhatsApp never synced
// them as "contacts" to this session. Names are unknown until a message or
// contacts.upsert fills them in, so they're stored under their JID as a
// placeholder name and upgraded later automatically.
let lastHarvestAt = 0;
const HARVEST_MIN_INTERVAL_MS = 3 * 60 * 1000; // don't re-harvest more than once per 3 min, even across frequent reconnects
async function harvestContactsFromGroups(sock) {
  if (!sock) return;
  if (Date.now() - lastHarvestAt < HARVEST_MIN_INTERVAL_MS) return;
  lastHarvestAt = Date.now();
  try {
    const groups = await sock.groupFetchAllParticipating();
    let changed = false;
    for (const g of Object.values(groups)) {
      groupNameCache[g.id] = g.subject;
      for (const p of g.participants || []) {
        const jid = p.id;
        if (!isIndividualJid(jid)) continue;
        if (!contactStore[jid]) {
          contactStore[jid] = { jid, name: jid };
          changed = true;
        }
      }
    }
    if (changed) persistContacts();
  } catch (err) {
    console.error('[scheduler] harvestContactsFromGroups failed:', err.message);
  }
}

// Resolve raw phone numbers (with or without a leading +) to real WhatsApp
// JIDs via Baileys' onWhatsApp check, and add confirmed ones to the contact
// store. This is the reliable way to add someone who hasn't messaged yet and
// hasn't shown up via passive sync.
async function resolveNumbersToContacts(sock, numbers) {
  if (!sock) throw new Error('WhatsApp not connected yet');
  const cleaned = numbers.map((n) => String(n).replace(/[^\d]/g, ''));
  const results = await sock.onWhatsApp(...cleaned);
  const resolved = [];
  let changed = false;
  for (const r of results || []) {
    if (r && r.exists && r.jid) {
      const existing = contactStore[r.jid];
      if (!existing) {
        contactStore[r.jid] = { jid: r.jid, name: r.jid };
        changed = true;
      }
      resolved.push({ input: r.jid, exists: true, jid: r.jid, name: contactStore[r.jid].name });
    } else {
      resolved.push({ exists: false });
    }
  }
  if (changed) persistContacts();
  return resolved;
}

// ---------------------------------------------------------------------------
// Chat history store (populated from Baileys messages.upsert)
// ---------------------------------------------------------------------------
// Text-only history — attachments/media are noted by type+filename but their
// bytes are never stored here (keeps this file small and avoids duplicating
// WhatsApp's own media storage). Capped per chat via MAX_MESSAGES_PER_CHAT.

let chatStore = {}; // jid -> { jid, name, isGroup, lastMessage, messages: [...] }
let groupNameCache = {}; // jid -> name, refreshed whenever /groups or the group harvest runs

function loadChatHistory() {
  if (fs.existsSync(MESSAGES_FILE)) {
    try {
      chatStore = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    } catch (_) {
      chatStore = {};
    }
  }
}

let chatWriteQueue = Promise.resolve();
function persistChatHistory() {
  chatWriteQueue = chatWriteQueue.then(() => new Promise((resolve) => {
    fs.writeFile(MESSAGES_FILE, JSON.stringify(chatStore), (err) => {
      if (err) console.error('[scheduler] persistChatHistory error:', err);
      resolve();
    });
  }));
  return chatWriteQueue;
}

function extractMessageText(m) {
  const content = m.message;
  if (!content) return { text: '', type: 'unknown' };
  if (content.conversation) return { text: content.conversation, type: 'text' };
  if (content.extendedTextMessage) return { text: content.extendedTextMessage.text || '', type: 'text' };
  if (content.imageMessage) return { text: content.imageMessage.caption || '[image]', type: 'image' };
  if (content.videoMessage) return { text: content.videoMessage.caption || '[video]', type: 'video' };
  if (content.documentMessage) {
    return { text: content.documentMessage.caption || `[document: ${content.documentMessage.fileName || 'file'}]`, type: 'document' };
  }
  if (content.audioMessage) return { text: '[audio]', type: 'audio' };
  if (content.stickerMessage) return { text: '[sticker]', type: 'sticker' };
  return { text: '[unsupported message type]', type: 'other' };
}

function recordMessage(m) {
  if (!m || !m.key || !m.key.remoteJid) return;
  const jid = m.key.remoteJid;
  if (jid === 'status@broadcast') return; // skip WhatsApp status updates
  const isGroup = jid.endsWith('@g.us');
  const { text, type } = extractMessageText(m);
  const timestamp = m.messageTimestamp
    ? (typeof m.messageTimestamp === 'number' ? m.messageTimestamp * 1000 : Number(m.messageTimestamp) * 1000)
    : Date.now();

  const entry = {
    id: m.key.id,
    fromMe: !!m.key.fromMe,
    senderJid: isGroup ? (m.key.participant || null) : jid,
    senderName: m.pushName || null,
    text,
    type,
    timestamp,
  };

  if (!chatStore[jid]) {
    chatStore[jid] = {
      jid,
      name: isGroup ? (groupNameCache[jid] || jid) : (contactStore[jid]?.name || jid),
      isGroup,
      lastMessage: null,
      messages: [],
    };
  }
  const chat = chatStore[jid];
  chat.messages.push(entry);
  if (chat.messages.length > MAX_MESSAGES_PER_CHAT) {
    chat.messages.splice(0, chat.messages.length - MAX_MESSAGES_PER_CHAT);
  }
  chat.lastMessage = { text: entry.text, timestamp: entry.timestamp, fromMe: entry.fromMe };
  // Keep the display name fresh as contacts/group names resolve later.
  chat.name = isGroup ? (groupNameCache[jid] || chat.name) : (contactStore[jid]?.name || chat.name);

  persistChatHistory();
}



async function fireSchedule(schedule, deps) {
  const { sendText, sendDocument, pushEvent } = deps;
  const attempts = [];
  const attachment = schedule.message.attachment
    ? { filename: schedule.message.attachment.filename, path: schedule.message.attachment.path }
    : null;
  const jitter = schedule.jitter; // { minSec, maxSec } or undefined

  let first = true;
  for (const jid of schedule.recipients) {
    if (!first) {
      const delayMs = jitter ? randomDelayMs(jitter.minSec, jitter.maxSec) : SEND_SPACING_MS;
      await wait(delayMs);
    }
    first = false;

    const attempt = { attemptedAt: nowIso(), jid, ok: false };
    try {
      if (attachment) {
        const fileBuffer = fs.readFileSync(attachment.path);
        await sendDocument(jid, fileBuffer, attachment.filename, schedule.message.text || undefined);
      } else {
        await sendText(jid, schedule.message.text || '');
      }
      attempt.ok = true;
      pushEvent('scheduler_send_ok', `Schedule ${schedule.id} sent to ${jid}`);
      recordOutgoingMessage(jid, schedule.message.text, attachment ? attachment.filename : null);
    } catch (err) {
      attempt.ok = false;
      attempt.error = (err && err.message) ? err.message : String(err);
      pushEvent('scheduler_send_fail', `Schedule ${schedule.id} failed for ${jid}: ${attempt.error}`);
    }
    attempts.push(attempt);
  }

  return attempts;
}

// Mirrors an outgoing send into chatStore so it shows up in the Chats tab —
// Baileys' own messages.upsert for fromMe messages can lag or occasionally
// not fire for programmatic sends, so we record it directly here too.
function recordOutgoingMessage(jid, text, attachmentFilename) {
  const isGroup = jid.endsWith('@g.us');
  const entry = {
    id: 'local-' + crypto.randomBytes(4).toString('hex'),
    fromMe: true,
    senderJid: null,
    senderName: null,
    text: text || (attachmentFilename ? `[document: ${attachmentFilename}]` : ''),
    type: attachmentFilename ? 'document' : 'text',
    timestamp: Date.now(),
  };
  if (!chatStore[jid]) {
    chatStore[jid] = {
      jid,
      name: isGroup ? (groupNameCache[jid] || jid) : (contactStore[jid]?.name || jid),
      isGroup,
      lastMessage: null,
      messages: [],
    };
  }
  const chat = chatStore[jid];
  chat.messages.push(entry);
  if (chat.messages.length > MAX_MESSAGES_PER_CHAT) {
    chat.messages.splice(0, chat.messages.length - MAX_MESSAGES_PER_CHAT);
  }
  chat.lastMessage = { text: entry.text, timestamp: entry.timestamp, fromMe: true };
  persistChatHistory();
}

async function tick(deps) {
  const now = new Date();
  let dirty = false;

  const due = store.schedules.filter((s) => s.status === 'active' && s.nextRunAt && new Date(s.nextRunAt).getTime() <= now.getTime());

  let firstDue = true;
  for (const schedule of due) {
    if (!firstDue) {
      const gap = schedule.jitter || DEFAULT_INTER_SCHEDULE_JITTER;
      await wait(randomDelayMs(gap.minSec, gap.maxSec));
    }
    firstDue = false;

    dirty = true;
    const attempts = await fireSchedule(schedule, deps);
    schedule.history = schedule.history || [];
    schedule.history.push(...attempts);
    schedule.lastRunAt = nowIso();

    if (schedule.type === 'once') {
      schedule.status = 'completed';
      schedule.nextRunAt = null;
    } else {
      // Recurring: compute next occurrence strictly after "now" so a schedule
      // that was overdue fires exactly once on this tick, then resumes normal
      // cadence — it does not fire multiple times to catch up.
      schedule.nextRunAt = computeNextRunAtRecurring(schedule, now);
    }
  }

  if (dirty) await persist();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateScheduleBody(body, { partial = false } = {}) {
  const errors = [];
  if (!partial || body.recipients !== undefined) {
    if (!Array.isArray(body.recipients) || body.recipients.length === 0) {
      errors.push('recipients must be a non-empty array of JIDs');
    }
  }
  if (!partial || body.message !== undefined) {
    const m = body.message || {};
    if (!m.text && !m.attachment) {
      errors.push('message must include text and/or attachment');
    }
  }
  if (!partial || body.schedule !== undefined) {
    const s = body.schedule || {};
    if (s.type === 'once') {
      if (!s.runAt || isNaN(new Date(s.runAt).getTime())) {
        errors.push('schedule.runAt must be a valid ISO datetime for type "once"');
      }
    } else if (s.type === 'recurring') {
      if (!['daily', 'weekly'].includes(s.frequency)) {
        errors.push('schedule.frequency must be "daily" or "weekly"');
      }
      if (!/^\d{2}:\d{2}$/.test(s.time || '')) {
        errors.push('schedule.time must be "HH:mm"');
      }
      if (s.frequency === 'weekly') {
        if (!Array.isArray(s.daysOfWeek) || s.daysOfWeek.length === 0) {
          errors.push('schedule.daysOfWeek must be a non-empty array for weekly frequency');
        }
      }
    } else if (!partial) {
      errors.push('schedule.type must be "once" or "recurring"');
    }
    if (s.jitter) {
      const j = s.jitter;
      if (typeof j.minSec !== 'number' || typeof j.maxSec !== 'number' || j.minSec < 0 || j.maxSec < j.minSec) {
        errors.push('schedule.jitter must be { minSec, maxSec } with 0 <= minSec <= maxSec');
      }
    }
  }
  return errors;
}

// Cache groupFetchAllParticipating() results — this call hits WhatsApp's
// servers directly, and polling it every UI refresh (originally every 12s)
// is exactly what triggers "rate-overlimit" (429) errors from WhatsApp.
// Real group membership changes rarely enough that a few minutes of
// staleness is a non-issue.
let groupsCache = { data: null, fetchedAt: 0 };
const GROUPS_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

async function getGroupsCached(sock, forceRefresh) {
  const isStale = !groupsCache.data || (Date.now() - groupsCache.fetchedAt) > GROUPS_CACHE_TTL_MS;
  if (forceRefresh || isStale) {
    const groups = await sock.groupFetchAllParticipating();
    const list = Object.values(groups).map((g) => {
      groupNameCache[g.id] = g.subject;
      return { jid: g.id, name: g.subject };
    });
    groupsCache = { data: list, fetchedAt: Date.now() };
  }
  return groupsCache.data;
}

// ---------------------------------------------------------------------------
// HTTP wiring
// ---------------------------------------------------------------------------

function checkSecret(req, WHATSAPP_SHARED_SECRET) {
  const secret = req.method === 'GET' || req.method === 'DELETE'
    ? req.query.secret
    : req.body && req.body.secret;
  return secret && secret === WHATSAPP_SHARED_SECRET;
}

function initScheduler({ app, getSock, sendText, sendDocument, pushEvent, WHATSAPP_SHARED_SECRET }) {
  ensureDirs();
  loadStore();
  loadContacts();
  loadChatHistory();

  const deps = { sendText, sendDocument, pushEvent };

  // Hook contact sync events if a sock accessor was provided. Call this once
  // at startup and let server.js re-invoke initScheduler's returned
  // `attachContactListeners` again after a reconnect if its sock instance
  // is replaced (Baileys hands you a new `sock` object per session refresh).
  function attachContactListeners() {
    const sock = getSock && getSock();
    if (!sock || !sock.ev) return;
    sock.ev.on('contacts.upsert', (contacts) => upsertContacts(contacts));
    sock.ev.on('contacts.update', (contacts) => upsertContacts(contacts));
    // Baileys sends the initial bulk sync (on fresh/partial login) as a
    // separate event containing a contacts array alongside chats/messages.
    sock.ev.on('messaging-history.set', ({ contacts }) => {
      if (contacts && contacts.length) upsertContacts(contacts);
    });
    // Fallback: learn contacts from message traffic itself, and record chat history.
    sock.ev.on('messages.upsert', ({ messages }) => {
      for (const m of messages || []) {
        upsertContactFromMessage(m);
        recordMessage(m);
      }
    });
    // One-off backfill from current group membership each time we (re)connect.
    harvestContactsFromGroups(sock);
  }
  attachContactListeners();

  // ---- GET /groups ----
  // ?refresh=1 forces a live re-fetch from WhatsApp; otherwise served from
  // the shared cache (see getGroupsCached) to avoid rate-overlimit errors.
  app.get('/groups', async (req, res) => {
    if (!checkSecret(req, WHATSAPP_SHARED_SECRET)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    try {
      const sock = getSock();
      if (!sock) return res.status(503).json({ ok: false, error: 'bot not connected' });
      const list = await getGroupsCached(sock, req.query.refresh === '1');
      res.json({ ok: true, groups: list });
    } catch (err) {
      pushEvent('scheduler_error', `GET /groups failed: ${err.message}`);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ---- GET /chats ----
  // List of chat threads that have at least one message on record, sorted
  // by most recent activity — the WhatsApp-Web-style sidebar list.
  app.get('/chats', (req, res) => {
    if (!checkSecret(req, WHATSAPP_SHARED_SECRET)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const list = Object.values(chatStore)
      .map((c) => ({ jid: c.jid, name: c.name, isGroup: c.isGroup, lastMessage: c.lastMessage }))
      .sort((a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0));
    res.json({ ok: true, chats: list });
  });

  // ---- GET /chats/:jid/messages ----
  app.get('/chats/:jid/messages', (req, res) => {
    if (!checkSecret(req, WHATSAPP_SHARED_SECRET)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const jid = decodeURIComponent(req.params.jid);
    const chat = chatStore[jid];
    if (!chat) return res.json({ ok: true, messages: [] });
    const limit = Math.min(Number(req.query.limit) || 100, MAX_MESSAGES_PER_CHAT);
    res.json({ ok: true, messages: chat.messages.slice(-limit) });
  });
  // ---- GET /contacts ----
  app.get('/contacts', (req, res) => {
    if (!checkSecret(req, WHATSAPP_SHARED_SECRET)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const list = Object.values(contactStore);
    res.json({
      ok: true,
      contacts: list,
      note: 'Contact list may be incomplete, especially after a fresh login. ' +
            'Send a message to a contact once via WhatsApp to help it appear here.',
    });
  });

  // ---- POST /contacts/resolve ----
  // Body: { secret, numbers: ["923001234567", "+923001234567", ...] }
  // Validates each number against WhatsApp and adds confirmed ones to the
  // known-contacts store. Use this to add someone who hasn't messaged yet.
  app.post('/contacts/resolve', async (req, res) => {
    if (!checkSecret(req, WHATSAPP_SHARED_SECRET)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const numbers = (req.body && req.body.numbers) || [];
    if (!Array.isArray(numbers) || numbers.length === 0) {
      return res.status(400).json({ ok: false, error: 'numbers must be a non-empty array' });
    }
    try {
      const sock = getSock();
      const resolved = await resolveNumbersToContacts(sock, numbers);
      pushEvent('scheduler_resolve', `Resolved ${numbers.length} number(s): ${resolved.filter(r => r.exists).length} found`);
      res.json({ ok: true, resolved });
    } catch (err) {
      pushEvent('scheduler_error', `POST /contacts/resolve failed: ${err.message}`);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ---- POST /send-now ----
  // Body: { secret, recipients: [jid,...], message: { text?, attachment?: { filename, base64 } } }
  // Sends immediately, bypassing the schedule/tick system entirely — for
  // quick manual checks. Not persisted as a schedule; logged via pushEvent
  // only (visible in /diagnostics recentEvents).
  app.post('/send-now', async (req, res) => {
    if (!checkSecret(req, WHATSAPP_SHARED_SECRET)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const body = req.body || {};
    if (!Array.isArray(body.recipients) || body.recipients.length === 0) {
      return res.status(400).json({ ok: false, error: 'recipients must be a non-empty array' });
    }
    const message = body.message || {};
    if (!message.text && !message.attachment) {
      return res.status(400).json({ ok: false, error: 'message must include text and/or attachment' });
    }

    const results = [];
    let attachmentBuffer = null;
    if (message.attachment) {
      try {
        attachmentBuffer = Buffer.from(message.attachment.base64, 'base64');
      } catch (err) {
        return res.status(400).json({ ok: false, error: 'invalid attachment base64' });
      }
    }

    let first = true;
    for (const jid of body.recipients) {
      if (!first) {
        const delayMs = body.jitter ? randomDelayMs(body.jitter.minSec, body.jitter.maxSec) : SEND_SPACING_MS;
        await wait(delayMs);
      }
      first = false;
      const attempt = { jid, ok: false, attemptedAt: nowIso() };
      try {
        if (attachmentBuffer) {
          await sendDocument(jid, attachmentBuffer, message.attachment.filename, message.text || undefined);
        } else {
          await sendText(jid, message.text || '');
        }
        attempt.ok = true;
        pushEvent('scheduler_send_now_ok', `Instant send to ${jid}`);
        recordOutgoingMessage(jid, message.text, message.attachment ? message.attachment.filename : null);
      } catch (err) {
        attempt.error = err.message;
        pushEvent('scheduler_send_now_fail', `Instant send to ${jid} failed: ${err.message}`);
      }
      results.push(attempt);
    }

    res.json({ ok: true, results });
  });

  // ---- POST /schedules ----
  app.post('/schedules', (req, res) => {
    if (!checkSecret(req, WHATSAPP_SHARED_SECRET)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const body = req.body || {};
    const errors = validateScheduleBody(body);
    if (errors.length) {
      return res.status(400).json({ ok: false, error: errors.join('; ') });
    }

    const id = genId();
    let attachmentRecord = null;
    if (body.message.attachment) {
      try {
        attachmentRecord = saveAttachment(id, body.message.attachment);
      } catch (err) {
        return res.status(500).json({ ok: false, error: `failed to save attachment: ${err.message}` });
      }
    }

    const schedule = {
      id,
      status: 'active',
      recipients: body.recipients,
      message: {
        text: body.message.text || '',
        attachment: attachmentRecord, // { filename, path } or null
      },
      type: body.schedule.type,
      runAt: body.schedule.type === 'once' ? body.schedule.runAt : undefined,
      recurring: body.schedule.type === 'recurring' ? {
        frequency: body.schedule.frequency,
        time: body.schedule.time,
        daysOfWeek: body.schedule.daysOfWeek || [],
        timezone: TIMEZONE,
      } : undefined,
      jitter: body.schedule.jitter ? { minSec: body.schedule.jitter.minSec, maxSec: body.schedule.jitter.maxSec } : undefined,
      createdAt: nowIso(),
      lastRunAt: null,
      history: [],
    };
    schedule.nextRunAt = computeInitialNextRunAt(schedule);

    store.schedules.push(schedule);
    persist().then(() => {
      pushEvent('scheduler_create', `Schedule ${id} created, next run ${schedule.nextRunAt}`);
      res.json({ ok: true, id });
    });
  });

  // ---- GET /schedules ----
  app.get('/schedules', (req, res) => {
    if (!checkSecret(req, WHATSAPP_SHARED_SECRET)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    res.json({ ok: true, schedules: store.schedules.map(toPublicSchedule) });
  });

  // ---- GET /schedules/:id ----
  app.get('/schedules/:id', (req, res) => {
    if (!checkSecret(req, WHATSAPP_SHARED_SECRET)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const schedule = store.schedules.find((s) => s.id === req.params.id);
    if (!schedule) return res.status(404).json({ ok: false, error: 'not found' });
    res.json({ ok: true, schedule: toPublicSchedule(schedule) });
  });

  // ---- PATCH /schedules/:id ----
  app.patch('/schedules/:id', (req, res) => {
    if (!checkSecret(req, WHATSAPP_SHARED_SECRET)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const schedule = store.schedules.find((s) => s.id === req.params.id);
    if (!schedule) return res.status(404).json({ ok: false, error: 'not found' });
    if (schedule.status === 'completed') {
      return res.status(400).json({ ok: false, error: 'cannot edit a completed schedule' });
    }

    const body = req.body || {};
    const errors = validateScheduleBody(body, { partial: true });
    if (errors.length) {
      return res.status(400).json({ ok: false, error: errors.join('; ') });
    }

    if (body.recipients) schedule.recipients = body.recipients;

    if (body.message) {
      if (body.message.text !== undefined) schedule.message.text = body.message.text;
      if (body.message.attachment) {
        // Replace existing attachment on disk
        deleteAttachments(schedule.id);
        try {
          schedule.message.attachment = saveAttachment(schedule.id, body.message.attachment);
        } catch (err) {
          return res.status(500).json({ ok: false, error: `failed to save attachment: ${err.message}` });
        }
      }
    }

    if (body.schedule) {
      if (body.schedule.type) schedule.type = body.schedule.type;
      if (schedule.type === 'once') {
        if (body.schedule.runAt) schedule.runAt = body.schedule.runAt;
        schedule.recurring = undefined;
      } else if (schedule.type === 'recurring') {
        schedule.recurring = {
          frequency: body.schedule.frequency || schedule.recurring?.frequency,
          time: body.schedule.time || schedule.recurring?.time,
          daysOfWeek: body.schedule.daysOfWeek || schedule.recurring?.daysOfWeek || [],
          timezone: TIMEZONE,
        };
        schedule.runAt = undefined;
      }
      schedule.nextRunAt = computeInitialNextRunAt(schedule);
    }

    if (body.schedule && body.schedule.jitter !== undefined) {
      schedule.jitter = body.schedule.jitter
        ? { minSec: body.schedule.jitter.minSec, maxSec: body.schedule.jitter.maxSec }
        : undefined;
    }

    persist().then(() => {
      pushEvent('scheduler_edit', `Schedule ${schedule.id} updated`);
      res.json({ ok: true, id: schedule.id });
    });
  });

  // ---- DELETE /schedules/:id ----
  app.delete('/schedules/:id', (req, res) => {
    if (!checkSecret(req, WHATSAPP_SHARED_SECRET)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const idx = store.schedules.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'not found' });
    const [removed] = store.schedules.splice(idx, 1);
    deleteAttachments(removed.id);
    persist().then(() => {
      pushEvent('scheduler_delete', `Schedule ${removed.id} deleted`);
      res.json({ ok: true });
    });
  });

  // ---- GET /schedules/:id/history ----
  app.get('/schedules/:id/history', (req, res) => {
    if (!checkSecret(req, WHATSAPP_SHARED_SECRET)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const schedule = store.schedules.find((s) => s.id === req.params.id);
    if (!schedule) return res.status(404).json({ ok: false, error: 'not found' });
    res.json({ ok: true, history: schedule.history || [] });
  });

  // ---- Tick loop ----
  setInterval(() => {
    tick(deps).catch((err) => {
      console.error('[scheduler] tick error:', err);
      pushEvent('scheduler_error', `tick failed: ${err.message}`);
    });
  }, TICK_MS);

  pushEvent('scheduler_init', `Scheduler engine started, ${store.schedules.length} schedule(s) loaded`);

  return { attachContactListeners };
}

module.exports = initScheduler;

/* -----------------------------------------------------------------------
INTEGRATION SNIPPET — add to server.js (near where /send-file is defined,
after `app`, `sock`/socket-getter, sendText/sendDocument, and pushEvent all
exist):

    const initScheduler = require('./scheduler');

    // server.js must expose a getter for the live sock, since Baileys hands
    // you a new sock object on reconnect. If server.js already keeps `sock`
    // in a module-level `let sock`, this is just:
    const { attachContactListeners } = initScheduler({
      app,
      getSock: () => sock,
      sendText,       // existing helper: (jid, text) => Promise
      sendDocument,    // existing helper: (jid, buffer, filename, caption?) => Promise
      pushEvent,
      WHATSAPP_SHARED_SECRET: process.env.WHATSAPP_SHARED_SECRET,
    });

    // In your existing connection-update handler, after a reconnect creates
    // a new `sock`, call attachContactListeners() again so contacts.upsert /
    // contacts.update get hooked on the new socket too:
    //
    //   sock = makeWASocket(...);
    //   attachContactListeners();

If server.js's send helpers have different names/signatures than
sendText(jid, text) / sendDocument(jid, buffer, filename, caption), adjust
the calls inside fireSchedule() above to match, or pass thin wrapper
functions into initScheduler() with these exact signatures.
----------------------------------------------------------------------- */
