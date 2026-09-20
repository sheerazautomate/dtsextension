// popup.js — Control panel + live status for the DTS Auto-Login extension.
// All configuration (credentials, schedule, etc.) is handled in settings.html.

const statusEl = document.getElementById('status');
const netBadgeEl = document.getElementById('netBadge');
const flowStepTextEl = document.getElementById('flowStepText');
const nextRunTextEl = document.getElementById('nextRunText');
const lastSuccessTextEl = document.getElementById('lastSuccessText');
const lastErrorTextEl = document.getElementById('lastErrorText');

const LOGIN_URL = 'https://dashboard-tracking.punjab.gov.pk/';

// --- Start button ---
document.getElementById('start').addEventListener('click', async () => {
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
  setTimeout(() => {
    statusEl.textContent = '';
  }, 2500);
});

// --- Stop button ---
document.getElementById('stop').addEventListener('click', async () => {
  await browser.storage.local.set({
    flowStep: 'idle',
    nextRunAt: null
  });
  statusEl.textContent = 'Stopped.';
  setTimeout(() => {
    statusEl.textContent = '';
  }, 2500);
});

// --- Open Settings tab ---
document.getElementById('openSettings').addEventListener('click', () => {
  browser.tabs.create({ url: browser.runtime.getURL('settings.html') });
  window.close(); // close the popup since the user is going to the settings page
});

// --- Live status panel ---
function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
}

async function refreshStatus() {
  const data = await browser.storage.local.get([
    'flowStep',
    'isOnline',
    'nextRunAt',
    'lastSuccessAt',
    'lastError',
    'dayComplete'
  ]);

  // Network: prefer the flow tab's reported status, fall back to the popup's own connectivity.
  const online = data.isOnline !== undefined ? data.isOnline : navigator.onLine;
  netBadgeEl.textContent = online ? 'Online' : 'Offline';
  netBadgeEl.className = `badge ${online ? 'on' : 'off'}`;

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

refreshStatus();
setInterval(refreshStatus, 2000);
