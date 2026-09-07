// Server-only helper. APPS_SCRIPT_SECRET must never reach the browser —
// only call this from API routes (app/api/**/route.js), never from
// client components.

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const APPS_SCRIPT_SECRET = process.env.APPS_SCRIPT_SECRET;

function assertConfigured() {
  if (!APPS_SCRIPT_URL || !APPS_SCRIPT_SECRET) {
    throw new Error('APPS_SCRIPT_URL / APPS_SCRIPT_SECRET are not configured on the server.');
  }
}

export async function getStatus() {
  assertConfigured();
  const url = `${APPS_SCRIPT_URL}?action=getStatus&secret=${encodeURIComponent(APPS_SCRIPT_SECRET)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Apps Script returned ${res.status}`);
  return res.json();
}

export async function queueCommand(target, command, params) {
  assertConfigured();
  const url = `${APPS_SCRIPT_URL}?action=queueCommand`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ secret: APPS_SCRIPT_SECRET, target, command, params: params || {} })
  });
  if (!res.ok) throw new Error(`Apps Script returned ${res.status}`);
  return res.json();
}
