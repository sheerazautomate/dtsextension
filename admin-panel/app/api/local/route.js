import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const execAsync = promisify(exec);

const LOCAL_BOT_URL = process.env.LOCAL_BOT_URL || 'http://localhost:3000';
const LOCAL_BOT_SECRET = process.env.LOCAL_BOT_SECRET || '';
const LOCAL_CLOUDFLARED_LOG = process.env.LOCAL_CLOUDFLARED_LOG || '/tmp/cloudflared.log';

async function withTimeout(promise, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await promise(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

// These checks only succeed when this Next.js process is running on the
// same machine as the bot/tunnel — i.e. `npm run dev` / `npm start` on
// your own host. On Vercel they'll fail fast and the panel shows that
// plainly rather than pretending to have data it doesn't.

async function checkLocalBotHealth() {
  try {
    const res = await withTimeout(
      (signal) => fetch(`${LOCAL_BOT_URL}/health`, { signal }),
      2000
    );
    const data = await res.json();
    return { available: true, data };
  } catch (err) {
    return { available: false, error: String(err.message || err) };
  }
}

async function checkLocalBotDiagnostics() {
  if (!LOCAL_BOT_SECRET) return { available: false, error: 'LOCAL_BOT_SECRET not set' };
  try {
    const res = await withTimeout(
      (signal) => fetch(`${LOCAL_BOT_URL}/diagnostics?secret=${encodeURIComponent(LOCAL_BOT_SECRET)}`, { signal }),
      2000
    );
    const data = await res.json();
    return { available: true, data };
  } catch (err) {
    return { available: false, error: String(err.message || err) };
  }
}

async function checkCloudflaredLog() {
  try {
    const content = await fs.readFile(LOCAL_CLOUDFLARED_LOG, 'utf-8');
    const lines = content.trim().split('\n').slice(-20);
    return { available: true, lines };
  } catch (err) {
    return { available: false, error: String(err.message || err) };
  }
}

async function checkPm2() {
  try {
    const { stdout } = await execAsync('pm2 jlist', { timeout: 3000 });
    const list = JSON.parse(stdout);
    const processes = list.map((p) => ({
      name: p.name,
      status: p.pm2_env && p.pm2_env.status,
      restarts: p.pm2_env && p.pm2_env.restart_time,
      uptimeMs: p.pm2_env && p.pm2_env.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : null,
      memoryMb: p.monit ? Math.round(p.monit.memory / 1024 / 1024) : null,
      cpu: p.monit ? p.monit.cpu : null
    }));
    return { available: true, processes };
  } catch (err) {
    return { available: false, error: String(err.message || err) };
  }
}

export async function GET() {
  const [botHealth, botDiagnostics, cloudflaredLog, pm2List] = await Promise.all([
    checkLocalBotHealth(),
    checkLocalBotDiagnostics(),
    checkCloudflaredLog(),
    checkPm2()
  ]);

  const anyAvailable = [botHealth, botDiagnostics, cloudflaredLog, pm2List].some((c) => c.available);

  return NextResponse.json({
    ok: true,
    localMode: anyAvailable,
    checkedAt: new Date().toISOString(),
    botHealth,
    botDiagnostics,
    cloudflaredLog,
    pm2: pm2List
  });
}
