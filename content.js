(function () {
  const MAX_WAIT_MS = 10000;
  const POLL_MS = 250;
  const STEP_DELAY_MS = 5000;
  const MAX_LOGIN_RETRIES = 5;
  const RETRY_BACKOFF_MS = 5000;
  const MAX_RETRY_BACKOFF_MS = 30000;

  // Fixed daily schedule: 08:05 through 16:05, every 30 minutes.
  const SCHEDULE_TIMES = [
    '08:05', '08:35', '09:05', '09:35', '10:05', '10:35', '11:05', '11:35',
    '12:05', '12:35', '13:05', '13:35', '14:05', '14:35', '15:05', '15:35', '16:05'
  ];

  const LOGIN_URL = 'https://dashboard-tracking.punjab.gov.pk/';
  const REPORT_URL =
    'https://dashboard-tracking.punjab.gov.pk/user_wise_larva_report?department=67&parent_department=18&date_range=0&user_type=Anti+Dengue';
  const CSV_URL =
    'https://dashboard-tracking.punjab.gov.pk/user_wise_larva_report?department=67&parent_department=18&date_range=0&user_type=Anti Dengue&format=csv';
  const REPORT_BASE = 'https://dashboard-tracking.punjab.gov.pk/user_wise_larva_report';

  // ---------------------------------------------------------------------
  // Schedule helpers
  // ---------------------------------------------------------------------
  function getNextScheduledTime(fromDate) {
    for (const t of SCHEDULE_TIMES) {
      const [h, m] = t.split(':').map(Number);
      const candidate = new Date(
        fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate(), h, m, 0, 0
      );
      if (candidate.getTime() >= fromDate.getTime()) return candidate;
    }
    return null; // no more slots today
  }

  // ---------------------------------------------------------------------
  // Storage helpers
  // ---------------------------------------------------------------------
  async function getState() {
    return browser.storage.local.get([
      'flowStep', 'loginAttempts', 'nextRunAt', 'lastError', 'lastSuccessAt',
      'username', 'password', 'scriptUrl', 'secret', 'ntfyTopic', 'isOnline', 'dayComplete'
    ]);
  }
  async function setState(patch) {
    await browser.storage.local.set(patch);
  }

  // ---------------------------------------------------------------------
  // Overlay UI — big countdown + status + running log
  // ---------------------------------------------------------------------
  const OVERLAY_ID = 'pesrp-autologin-overlay';
  let logLines = [];

  function ensureOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;
    const el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
      background: #0f172a; color: #e2e8f0; font-family: system-ui, sans-serif;
      padding: 14px 20px; box-shadow: 0 2px 10px rgba(0,0,0,.4);
      display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
    `;
    el.innerHTML = `
      <div id="pal-countdown" style="font-size: 34px; font-weight: 800; min-width: 110px; letter-spacing: 1px;">--:--</div>
      <div style="flex: 1; min-width: 220px;">
        <div id="pal-status" style="font-size: 15px; font-weight: 600;">Starting…</div>
        <div id="pal-subtext" style="font-size: 12px; color: #94a3b8; margin-top: 2px;"></div>
      </div>
      <div id="pal-net" style="font-size: 12px; padding: 4px 8px; border-radius: 4px; background:#16a34a;">Online</div>
      <div id="pal-log" style="width: 100%; font-size: 11px; color: #94a3b8; max-height: 140px; overflow-y: auto; white-space: pre-line;"></div>
    `;
    document.documentElement.appendChild(el);
    window.addEventListener('online', () => { setNetBadge(true); setState({ isOnline: true }); });
    window.addEventListener('offline', () => { setNetBadge(false); setState({ isOnline: false }); });
    setNetBadge(navigator.onLine);
    setState({ isOnline: navigator.onLine });
  }

  function setNetBadge(online) {
    const badge = document.getElementById('pal-net');
    if (!badge) return;
    badge.textContent = online ? 'Online' : 'Offline';
    badge.style.background = online ? '#16a34a' : '#dc2626';
  }

  function setStatus(text, subtext) {
    ensureOverlay();
    const s = document.getElementById('pal-status');
    const sub = document.getElementById('pal-subtext');
    if (s) s.textContent = text;
    if (sub) sub.textContent = subtext || '';
    logLine(text + (subtext ? ' — ' + subtext : ''));
  }

  function logLine(line) {
    const ts = new Date().toLocaleTimeString();
    logLines.push(`[${ts}] ${line}`);
    logLines = logLines.slice(-30);
    const logEl = document.getElementById('pal-log');
    if (logEl) {
      logEl.textContent = logLines.join('\n');
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  function setCountdownText(text) {
    ensureOverlay();
    const c = document.getElementById('pal-countdown');
    if (c) c.textContent = text;
  }

  let countdownTimer = null;
  function stopCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }
  function startCountdown(targetTs, onDone) {
    stopCountdown();
    function tick() {
      const remaining = Math.max(0, targetTs - Date.now());
      const totalSec = Math.ceil(remaining / 1000);
      const hh = Math.floor(totalSec / 3600);
      const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
      const ss = String(totalSec % 60).padStart(2, '0');
      setCountdownText(hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`);
      if (remaining <= 0) {
        stopCountdown();
        onDone && onDone();
      }
    }
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  // ---------------------------------------------------------------------
  // Network-aware fetch: retries with backoff, waits out full offline
  // stretches, and alerts the phone if it drags on too long.
  // ---------------------------------------------------------------------
  async function fetchWithRetry(url, options, label) {
    let attempt = 0;
    let alerted = false;
    const startedAt = Date.now();
    while (true) {
      attempt++;
      if (!navigator.onLine) {
        setStatus('Waiting for network…', `${label} paused — no connection`);
        await waitForOnline();
        setStatus('Back online', `Resuming ${label}`);
      }
      try {
        const res = await fetch(url, options);
        return res;
      } catch (err) {
        const wait = Math.min(RETRY_BACKOFF_MS * attempt, MAX_RETRY_BACKOFF_MS);
        setStatus('Network error', `${label} failed (attempt ${attempt}) — retrying in ${Math.round(wait / 1000)}s`);
        if (!alerted && Date.now() - startedAt > 5 * 60 * 1000) {
          alerted = true;
          notifyPhone('⚠️ Dormancy sync stuck', `${label} has been retrying for 5+ minutes — check your PC/network.`);
        }
        await sleep(wait);
      }
    }
  }

  function waitForOnline() {
    if (navigator.onLine) return Promise.resolve();
    setState({ isOnline: false });
    return new Promise((resolve) => {
      function handler() {
        window.removeEventListener('online', handler);
        setState({ isOnline: true });
        resolve();
      }
      window.addEventListener('online', handler);
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function notifyPhone(title, message) {
    try {
      const stored = await getState();
      if (!stored.ntfyTopic) return;
      await fetch('https://ntfy.sh/' + stored.ntfyTopic, {
        method: 'POST',
        body: message,
        headers: { Title: title, Priority: 'high', Tags: 'x' }
      });
    } catch (e) {
      // best-effort only
    }
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.flowStep) return;
    if (changes.flowStep.newValue === 'idle') {
      stopCountdown();
      setCountdownText('⏸');
      setStatus('Stopped', 'Do your manual work, then click Start to resume the schedule.');
    }
  });

  // ---------------------------------------------------------------------
  // Login page handling
  // ---------------------------------------------------------------------
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function solveCaptchaText(text) {
    if (!text) return null;
    const match = text.match(/(-?\d+)\s*([+\-*x×/])\s*(-?\d+)/i);
    if (!match) return null;
    const a = parseFloat(match[1]);
    const opRaw = match[2].toLowerCase();
    const b = parseFloat(match[3]);
    let result;
    switch (opRaw) {
      case '+': result = a + b; break;
      case '-': result = a - b; break;
      case '*':
      case 'x':
      case '×': result = a * b; break;
      case '/': result = a / b; break;
      default: return null;
    }
    return String(result);
  }

  function findCaptchaPromptText(captchaInput) {
    const group = captchaInput.closest('.input-group');
    if (group) {
      const label = group.querySelector('.input-group-text');
      if (label && label.textContent) return label.textContent;
    }
    const labelFor = document.querySelector(`label[for="${captchaInput.id}"]`);
    if (labelFor && labelFor.textContent) return labelFor.textContent;
    const form = captchaInput.closest('form');
    return form ? form.textContent : document.body.textContent;
  }

  async function tryHandleLoginPage() {
    const usernameInput = document.getElementById('user_username');
    const passwordInput = document.getElementById('user_password');
    const captchaInput = document.getElementById('captcha');
    if (!usernameInput || !passwordInput || !captchaInput) return false;

    const stored = await getState();
    if (stored.username) setNativeValue(usernameInput, stored.username);
    if (stored.password) setNativeValue(passwordInput, stored.password);

    const promptText = findCaptchaPromptText(captchaInput);
    const answer = solveCaptchaText(promptText);
    if (answer !== null) {
      setNativeValue(captchaInput, answer);
    } else {
      setStatus('Captcha unreadable', 'Could not parse: ' + (promptText || '').slice(0, 60));
      return true;
    }

    setStatus('Signing in…', 'Credentials + captcha filled, submitting');
    const submitBtn =
      document.querySelector('form button[type="submit"]') ||
      document.querySelector('form button.btn-primary');
    if (submitBtn) submitBtn.click();
    return true;
  }

  function waitForLoginFormAndRun() {
    const start = Date.now();
    const interval = setInterval(async () => {
      const state = await getState();
      if ((state.flowStep || 'idle') === 'idle') {
        clearInterval(interval);
        return;
      }
      const done = await tryHandleLoginPage();
      if (done || Date.now() - start > MAX_WAIT_MS) {
        clearInterval(interval);
      }
    }, POLL_MS);
  }

  // ---------------------------------------------------------------------
  // CSV fetch + upload to Google Sheet
  // ---------------------------------------------------------------------
  async function sendCsvToSheet() {
    setStatus('Downloading CSV…', 'Fetching report data');
    const res = await fetchWithRetry(CSV_URL, { credentials: 'include' }, 'CSV download');
    const csvText = await res.text();

    const stored = await getState();
    if (!stored.scriptUrl) {
      setStatus('Skipped upload', 'No Apps Script URL configured');
      return { ok: false, error: 'no scriptUrl' };
    }

    const url = new URL(stored.scriptUrl);
    if (stored.secret) url.searchParams.set('secret', stored.secret);

    setStatus('Uploading to Google Sheet…', 'Sending CSV to Apps Script');
    const uploadRes = await fetchWithRetry(url.toString(), { method: 'POST', body: csvText }, 'Sheet upload');
    const result = await uploadRes.json().catch(() => null);

    if (result && result.ok) {
      setStatus('Sheet updated ✅', `${result.rows} rows written` + (result.macroError ? ` (macro warning: ${result.macroError})` : ''));
      if (result.macroLog) {
        result.macroLog
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .forEach((l) => logLine('[macro] ' + l));
      } else {
        logLine('[macro] runAllTehsilScripts produced no Logger.log output');
      }
      return { ok: true, result };
    } else {
      setStatus('Upload failed', result ? JSON.stringify(result) : 'Unknown response from Apps Script');
      return { ok: false, error: result };
    }
  }

  // ---------------------------------------------------------------------
  // End-of-day handling
  // ---------------------------------------------------------------------
  async function finishForToday(reasonSubtext) {
    stopCountdown();
    setCountdownText('✅');
    setStatus('Reporting time is over', reasonSubtext || 'All scheduled runs up to 04:05 PM are complete.');
    await setState({ flowStep: 'idle', nextRunAt: null, dayComplete: true, dayCompleteAt: Date.now() });
    notifyPhone('✅ Dormancy sync: done for today', reasonSubtext || 'All scheduled runs up to 04:05 PM are complete.');
  }

  function scheduleNextRun(nextRunAt) {
    const label = new Date(nextRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setStatus('Waiting for next scheduled run', `Next run at ${label}`);
    startCountdown(nextRunAt, async () => {
      await setState({ flowStep: 'login', loginAttempts: 0 });
      setStatus('Starting scheduled run…', '');
      window.location.href = LOGIN_URL;
    });
  }

  // ---------------------------------------------------------------------
  // Main flow
  // ---------------------------------------------------------------------
  async function runFlow() {
    ensureOverlay();
    const state = await getState();
    const step = state.flowStep || 'idle';

    if (step === 'idle') {
      if (state.dayComplete) {
        setCountdownText('✅');
        setStatus('Reporting time is over', 'All scheduled runs up to 04:05 PM are complete. Click Start tomorrow to run again.');
      }
      return;
    }

    const href = window.location.href;
    const hasCaptcha = !!document.getElementById('captcha');

    if (step === 'waiting') {
      let nextRunAt = state.nextRunAt;
      if (!nextRunAt) {
        const next = getNextScheduledTime(new Date());
        if (!next) {
          await finishForToday();
          return;
        }
        nextRunAt = next.getTime();
        await setState({ nextRunAt });
      }
      // If the scheduled time has already passed (e.g. tab was asleep/offline), run immediately.
      scheduleNextRun(Math.max(nextRunAt, Date.now()));
      return;
    }

    if (step === 'login') {
      if (hasCaptcha) {
        const attempts = (state.loginAttempts || 0) + 1;
        if (attempts > MAX_LOGIN_RETRIES) {
          setStatus('Login failing', `Gave up after ${MAX_LOGIN_RETRIES} attempts — check credentials/captcha`);
          await setState({ lastError: 'login failed repeatedly', flowStep: 'idle' });
          notifyPhone('❌ Dormancy sync: login failing', `Gave up after ${MAX_LOGIN_RETRIES} attempts — check credentials/captcha`);
          return;
        }
        await setState({ loginAttempts: attempts });
        setStatus('Logging in…', `Attempt ${attempts} of ${MAX_LOGIN_RETRIES}`);
        waitForLoginFormAndRun();
      } else {
        await setState({ loginAttempts: 0 });
        setStatus('Logged in ✅', 'Waiting before opening report');
        const target = Date.now() + STEP_DELAY_MS;
        startCountdown(target, async () => {
          await setState({ flowStep: 'goto-report' });
          window.location.href = REPORT_URL;
        });
      }
      return;
    }

    if (step === 'goto-report') {
      if (href.startsWith(REPORT_BASE) && !href.includes('format=csv')) {
        setStatus('Report page loaded', 'Waiting before download');
        const target = Date.now() + STEP_DELAY_MS;
        startCountdown(target, async () => {
          const outcome = await sendCsvToSheet();
          await setState({
            lastError: outcome.ok ? null : (outcome.error || 'upload failed'),
            lastSuccessAt: outcome.ok ? Date.now() : state.lastSuccessAt || null
          });

          const next = getNextScheduledTime(new Date(Date.now() + 1000));
          if (!next) {
            await finishForToday();
            return;
          }
          await setState({ flowStep: 'waiting', nextRunAt: next.getTime() });
          scheduleNextRun(next.getTime());
        });
      }
      return;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runFlow);
  } else {
    runFlow();
  }
})();
