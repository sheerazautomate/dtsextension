const usernameEl = document.getElementById('username');
const passwordEl = document.getElementById('password');
const scriptUrlEl = document.getElementById('scriptUrl');
const secretEl = document.getElementById('secret');
const ntfyTopicEl = document.getElementById('ntfyTopic');
const statusEl = document.getElementById('status');

const netBadgeEl = document.getElementById('netBadge');
const flowStepTextEl = document.getElementById('flowStepText');
const nextRunTextEl = document.getElementById('nextRunText');
const lastSuccessTextEl = document.getElementById('lastSuccessText');
const lastErrorTextEl = document.getElementById('lastErrorText');

async function load() {
  const data = await browser.storage.local.get([
    'username', 'password', 'scriptUrl', 'secret', 'ntfyTopic'
  ]);
  if (data.username) usernameEl.value = data.username;
  if (data.password) passwordEl.value = data.password;
  if (data.scriptUrl) scriptUrlEl.value = data.scriptUrl;
  if (data.secret) secretEl.value = data.secret;
  if (data.ntfyTopic) ntfyTopicEl.value = data.ntfyTopic;
}

async function saveAll() {
  await browser.storage.local.set({
    username: usernameEl.value,
    password: passwordEl.value,
    scriptUrl: scriptUrlEl.value,
    secret: secretEl.value,
    ntfyTopic: ntfyTopicEl.value
  });
}

document.getElementById('save').addEventListener('click', async () => {
  await saveAll();
  statusEl.textContent = 'Saved.';
  setTimeout(() => (statusEl.textContent = ''), 2500);
});

const LOGIN_URL = 'https://dashboard-tracking.punjab.gov.pk/';

document.getElementById('start').addEventListener('click', async () => {
  await saveAll();
  // 'waiting' with no nextRunAt tells content.js to compute the next
  // scheduled slot itself (today's schedule, or "reporting time is
  // over" if it's already past 04:05 PM).
  await browser.storage.local.set({
    flowStep: 'waiting',
    nextRunAt: null,
    loginAttempts: 0,
    lastError: null,
    dayComplete: false
  });
  await browser.tabs.create({ url: LOGIN_URL });
  statusEl.textContent = 'Started — watch the new tab.';
  setTimeout(() => (statusEl.textContent = ''), 2500);
});

document.getElementById('stop').addEventListener('click', async () => {
  await browser.storage.local.set({
    flowStep: 'idle',
    nextRunAt: null
  });
  statusEl.textContent = 'Stopped. Do your manual work, then click Start to resume the schedule.';
  setTimeout(() => (statusEl.textContent = ''), 4000);
});

// --- Live status panel ---
function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
}

async function refreshStatus() {
  const data = await browser.storage.local.get([
    'flowStep', 'isOnline', 'nextRunAt', 'lastSuccessAt', 'lastError', 'dayComplete'
  ]);

  // Network: prefer the flow tab's reported status, fall back to the popup's own connectivity.
  const online = data.isOnline !== undefined ? data.isOnline : navigator.onLine;
  netBadgeEl.textContent = online ? 'Online' : 'Offline';
  netBadgeEl.className = 'badge ' + (online ? 'on' : 'off');

  let stepText = data.flowStep || 'idle';
  if (data.dayComplete) stepText = 'done for today';
  flowStepTextEl.textContent = stepText;

  nextRunTextEl.textContent = data.dayComplete ? '—' : fmtTime(data.nextRunAt);
  lastSuccessTextEl.textContent = fmtTime(data.lastSuccessAt);
  lastErrorTextEl.textContent = data.lastError ? String(data.lastError) : 'none';
}

// The popup's own online/offline events, as a secondary signal in case
// the flow tab has been closed and storage.isOnline is stale.
window.addEventListener('online', refreshStatus);
window.addEventListener('offline', refreshStatus);

load();
refreshStatus();
setInterval(refreshStatus, 2000);
