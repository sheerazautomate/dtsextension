// settings.js — Settings page logic for the DTS Auto-Login extension.
// Reads/writes browser.storage.local and provides import/export.

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const DEFAULTS = {
  username: '',
  password: '',
  scriptUrl: '',
  secret: '',
  ntfyTopic: '',
  scheduleMode: 'simple',
  scheduleStart: '08:05',
  scheduleEnd: '16:05',
  scheduleInterval: 30,
  scheduleTimes: [
    '08:05',
    '08:35',
    '09:05',
    '09:35',
    '10:05',
    '10:35',
    '11:05',
    '11:35',
    '12:05',
    '12:35',
    '13:05',
    '13:35',
    '14:05',
    '14:35',
    '15:05',
    '15:35',
    '16:05'
  ]
};

// Keys we manage in browser.storage.local (excludes runtime state keys)
const SETTINGS_KEYS = [
  'username',
  'password',
  'scriptUrl',
  'secret',
  'ntfyTopic',
  'scheduleMode',
  'scheduleStart',
  'scheduleEnd',
  'scheduleInterval',
  'scheduleTimes'
];

// Keys exported/imported (same as SETTINGS_KEYS)
const EXPORT_KEYS = SETTINGS_KEYS;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const usernameEl = $('username');
const passwordEl = $('password');
const scriptUrlEl = $('scriptUrl');
const secretEl = $('secret');
const ntfyTopicEl = $('ntfyTopic');
const scheduleStartEl = $('scheduleStart');
const scheduleEndEl = $('scheduleEnd');
const scheduleIntervalEl = $('scheduleInterval');
const statusEl = $('status');
const timeSlotsListEl = $('timeSlotsList');
const schedulePreviewEl = $('schedulePreview');

// ---------------------------------------------------------------------------
// Schedule mode toggle
// ---------------------------------------------------------------------------
let currentMode = 'simple';

function setScheduleMode(mode) {
  currentMode = mode;
  $('modeSimple').className = mode === 'simple' ? 'active' : '';
  $('modeAdvanced').className = mode === 'advanced' ? 'active' : '';
  $('simpleSection').style.display = mode === 'simple' ? '' : 'none';
  $('advancedSection').style.display = mode === 'advanced' ? '' : 'none';
  updatePreview();
}
// Expose globally so onclick handlers in HTML work
window.setScheduleMode = setScheduleMode;

// ---------------------------------------------------------------------------
// Time slots list (advanced mode)
// ---------------------------------------------------------------------------
let customTimeSlots = [];

function renderTimeSlots() {
  timeSlotsListEl.innerHTML = '';
  customTimeSlots.forEach((time, idx) => {
    const row = document.createElement('div');
    row.className = 'time-slot-row';
    const input = document.createElement('input');
    input.type = 'time';
    input.value = time;
    input.setAttribute('aria-label', `Time slot ${idx + 1}`);
    input.addEventListener('input', () => onSlotChange(idx, input.value));
    const remove = document.createElement('button');
    remove.className = 'btn-remove';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', `Remove time slot ${idx + 1}`);
    remove.addEventListener('click', () => removeTimeSlot(idx));
    row.append(input, remove);
    timeSlotsListEl.appendChild(row);
  });
  updatePreview();
}

function onSlotChange(idx, value) {
  customTimeSlots[idx] = value;
  updatePreview();
}
window.onSlotChange = onSlotChange;

function addTimeSlot() {
  customTimeSlots.push('12:00');
  renderTimeSlots();
}
window.addTimeSlot = addTimeSlot;

function removeTimeSlot(idx) {
  customTimeSlots.splice(idx, 1);
  renderTimeSlots();
}
window.removeTimeSlot = removeTimeSlot;

// ---------------------------------------------------------------------------
// Schedule preview
// ---------------------------------------------------------------------------
function isValidTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validateSchedule(mode, start, end, interval, times) {
  if (!['simple', 'advanced'].includes(mode)) throw new Error('Invalid schedule mode.');
  if (!isValidTime(start) || !isValidTime(end) || start > end) {
    throw new Error('Enter valid start and end times, with start no later than end.');
  }
  if (!Number.isInteger(interval) || interval < 5 || interval > 120 || interval % 5 !== 0) {
    throw new Error('Interval must be a multiple of 5 between 5 and 120 minutes.');
  }
  if (mode === 'advanced' && (!Array.isArray(times) || !times.length || !times.every(isValidTime))) {
    throw new Error('Add at least one valid custom time slot.');
  }
}

function computeScheduleTimes() {
  if (currentMode === 'advanced') {
    return [...customTimeSlots].sort();
  }
  const start = scheduleStartEl.value;
  const end = scheduleEndEl.value;
  const interval = Number(scheduleIntervalEl.value);
  if (!isValidTime(start) || !isValidTime(end) || !Number.isInteger(interval) || interval < 5 || interval > 120 || interval % 5 !== 0 || start > end) return [];

  const times = [];
  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  let current = startH * 60 + startM;
  const endMin = endH * 60 + endM;

  while (current <= endMin) {
    const h = String(Math.floor(current / 60)).padStart(2, '0');
    const m = String(current % 60).padStart(2, '0');
    times.push(`${h}:${m}`);
    current += interval;
  }
  return times;
}

function updatePreview() {
  const times = computeScheduleTimes();
  schedulePreviewEl.textContent = times.length
    ? `Generated schedule (${times.length} runs):\n${times.join(', ')}`
    : 'No time slots configured.';
}

// Listen for changes to simple-mode inputs
['scheduleStart', 'scheduleEnd', 'scheduleInterval'].forEach((id) => {
  $(id).addEventListener('input', updatePreview);
});

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------
async function loadSettings() {
  const data = await browser.storage.local.get(SETTINGS_KEYS);

  usernameEl.value = data.username ?? DEFAULTS.username;
  passwordEl.value = data.password ?? DEFAULTS.password;
  scriptUrlEl.value = data.scriptUrl ?? DEFAULTS.scriptUrl;
  secretEl.value = data.secret ?? DEFAULTS.secret;
  ntfyTopicEl.value = data.ntfyTopic ?? DEFAULTS.ntfyTopic;

  // Schedule
  const mode = data.scheduleMode || DEFAULTS.scheduleMode;
  scheduleStartEl.value = data.scheduleStart || DEFAULTS.scheduleStart;
  scheduleEndEl.value = data.scheduleEnd || DEFAULTS.scheduleEnd;
  scheduleIntervalEl.value = data.scheduleInterval || DEFAULTS.scheduleInterval;
  customTimeSlots = Array.isArray(data.scheduleTimes) ? [...data.scheduleTimes] : [...DEFAULTS.scheduleTimes];

  setScheduleMode(mode);
  renderTimeSlots();
  updatePreview();
}

async function saveAll() {
  try {
  validateSchedule(currentMode, scheduleStartEl.value, scheduleEndEl.value, Number(scheduleIntervalEl.value), customTimeSlots);
  const patch = {
    username: usernameEl.value.trim(),
    password: passwordEl.value,
    scriptUrl: scriptUrlEl.value.trim(),
    secret: secretEl.value.trim(),
    ntfyTopic: ntfyTopicEl.value.trim(),
    scheduleMode: currentMode,
    scheduleStart: scheduleStartEl.value,
    scheduleEnd: scheduleEndEl.value,
    scheduleInterval: Number.parseInt(scheduleIntervalEl.value, 10) || DEFAULTS.scheduleInterval,
    scheduleTimes: currentMode === 'advanced' ? [...customTimeSlots].sort() : computeScheduleTimes()
  };

  await browser.storage.local.set(patch);
  showStatus('✅ All settings saved.');
  } catch (err) {
    showStatus(`❌ Save failed: ${err.message}`, true);
  }
}
window.saveAll = saveAll;

async function resetDefaults() {
  if (!confirm('Reset all settings to defaults? This will clear your credentials and custom schedule.')) return;
  try {
    await browser.storage.local.set(DEFAULTS);
    await loadSettings();
    showStatus('🔄 Settings reset to defaults.');
  } catch (err) { showStatus(`❌ Reset failed: ${err.message}`, true); }
}
window.resetDefaults = resetDefaults;

// ---------------------------------------------------------------------------
// Import / Export
// ---------------------------------------------------------------------------
async function exportSettings() {
  try {
  const data = await browser.storage.local.get(EXPORT_KEYS);
  // Include defaults for any missing keys so the export is always complete
  const exportData = {};
  for (const key of EXPORT_KEYS) {
    exportData[key] = data[key] !== undefined ? data[key] : DEFAULTS[key];
  }
  exportData._exportedAt = new Date().toISOString();
  exportData._version = browser.runtime.getManifest().version;

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = new Date().toISOString().slice(0, 10);
  a.download = `dts-extension-settings-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showStatus('📤 Saved settings exported.');
  } catch (err) { showStatus(`❌ Export failed: ${err.message}`, true); }
}
window.exportSettings = exportSettings;

async function importSettings(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error('Invalid file format.');
    }

    // Validate: only import known keys
    const patch = {};
    let importedCount = 0;
    for (const key of EXPORT_KEYS) {
      if (data[key] !== undefined) {
        patch[key] = data[key];
        importedCount++;
      }
    }

    if (importedCount === 0) {
      throw new Error('No recognizable settings found in the file.');
    }

    for (const key of ['username', 'password', 'scriptUrl', 'secret', 'ntfyTopic']) {
      if (key in patch && typeof patch[key] !== 'string') throw new Error(`Invalid ${key}.`);
    }
    const existing = await browser.storage.local.get(SETTINGS_KEYS);
    const merged = { ...DEFAULTS, ...existing, ...patch };
    validateSchedule(merged.scheduleMode, merged.scheduleStart, merged.scheduleEnd, merged.scheduleInterval, merged.scheduleTimes);
    if (merged.scheduleMode === 'simple' && ['scheduleMode', 'scheduleStart', 'scheduleEnd', 'scheduleInterval'].some(key => key in patch)) {
      const [h, m] = merged.scheduleStart.split(':').map(Number);
      const [eh, em] = merged.scheduleEnd.split(':').map(Number);
      patch.scheduleTimes = [];
      for (let minute = h * 60 + m; minute <= eh * 60 + em; minute += merged.scheduleInterval) {
        patch.scheduleTimes.push(`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);
      }
    } else if ('scheduleTimes' in patch) {
      if (!Array.isArray(patch.scheduleTimes) || !patch.scheduleTimes.length || !patch.scheduleTimes.every(isValidTime)) throw new Error('Invalid schedule times.');
      patch.scheduleTimes = [...patch.scheduleTimes].sort();
    }

    // Apply to storage
    await browser.storage.local.set(patch);
    // Reload the UI to reflect imported values
    await loadSettings();
    showStatus(`📥 Imported ${importedCount} setting(s).`);
  } catch (err) {
    showStatus(`❌ Import failed: ${err.message}`, true);
  }

  // Reset the file input so the same file can be re-imported if needed
  event.target.value = '';
}
window.importSettings = importSettings;

// ---------------------------------------------------------------------------
// Status message
// ---------------------------------------------------------------------------
let statusTimer;
function showStatus(text, isError) {
  clearTimeout(statusTimer);
  statusEl.textContent = text;
  statusEl.className = isError ? 'error' : '';
  if (!isError) {
    statusTimer = setTimeout(() => {
      statusEl.textContent = '';
    }, 3000);
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
$('modeSimple').addEventListener('click', () => setScheduleMode('simple'));
$('modeAdvanced').addEventListener('click', () => setScheduleMode('advanced'));
$('addTimeSlot').addEventListener('click', addTimeSlot);
$('saveAll').addEventListener('click', saveAll);
$('resetDefaults').addEventListener('click', resetDefaults);
$('exportSettings').addEventListener('click', exportSettings);
$('importSettings').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', importSettings);
loadSettings().catch(err => showStatus(`❌ Could not load settings: ${err.message}`, true));
