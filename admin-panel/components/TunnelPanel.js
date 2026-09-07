'use client';

import { useEffect, useState } from 'react';
import StatusDot from './StatusDot';
import LedRow from './LedRow';
import TiltCard from './TiltCard';
import { timeAgo } from '../lib/useStatus';

/**
 * Determine tunnel health state by combining multiple signals:
 * - Bot connected status (from Apps Script heartbeat) — primary signal
 * - Local bot health check (from /api/local) — verifies tunnel is reachable
 * - URL freshness (updatedAt) — secondary indicator
 *
 * The tunnel should NOT be flagged as unhealthy just because the URL timestamp
 * is stale. A stable tunnel that hasn't changed its URL is still healthy.
 */
function getTunnelState(tunnel, bot, localBotHealth) {
  // If the bot is connected via Apps Script, the tunnel is working
  // (because Apps Script only knows about the bot through the tunnel heartbeat)
  if (bot?.connected) {
    return 'live';
  }

  // If we have local health data, use it as the ground truth
  if (localBotHealth?.available && localBotHealth.data) {
    if (localBotHealth.data.connected) {
      return 'live';
    }
    // Bot is running locally but not connected to WhatsApp — tunnel may be down
    return 'stale';
  }

  // No bot connection and no local data — fall back to URL freshness
  if (!tunnel?.url) {
    return 'unknown';
  }

  // URL was reported — it's probably fine, but we can't confirm
  return 'stale';
}

export default function TunnelPanel({ tunnel, bot }) {
  const [localBotHealth, setLocalBotHealth] = useState(null);

  // Periodically check local bot health (bypasses tunnel, hits localhost directly)
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch('/api/local', { cache: 'no-store' });
        const json = await res.json();
        if (!cancelled) setLocalBotHealth(json.botHealth || null);
      } catch {
        // Not running locally — expected on Vercel
        if (!cancelled) setLocalBotHealth(null);
      }
    }
    check();
    const t = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const state = getTunnelState(tunnel, bot, localBotHealth);

  return (
    <TiltCard className={`panel glow-${state}`}>
      <div className="panel-head">
        <div>
          <div className="panel-title">Tunnel</div>
          <div className="panel-sub">Cloudflare quick tunnel</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LedRow />
          <StatusDot state={state} />
        </div>
      </div>

      {tunnel?.url ? (
        <div className="field-list">
          <div className="field-row">
            <span className="field-label">Current URL</span>
            <span className="field-value mono">
              <a href={tunnel.url} target="_blank" rel="noreferrer">
                {tunnel.url.replace('https://', '')}
              </a>
            </span>
          </div>
          <div className="field-row">
            <span className="field-label">Last reported</span>
            <span className="field-value mono">{timeAgo(tunnel.updatedAt)}</span>
          </div>
          {state === 'live' && (
            <div className="field-row">
              <span className="field-label">Health</span>
              <span className="field-value" style={{ color: 'var(--ok)' }}>
                ✓ Verified healthy
              </span>
            </div>
          )}
          {state === 'stale' && localBotHealth?.available && (
            <div className="field-row">
              <span className="field-label">Local bot</span>
              <span className="field-value mono">
                {localBotHealth.data?.connected ? 'Connected (tunnel likely OK)' : 'Bot not connected to WhatsApp'}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="field-value muted">No tunnel URL reported yet</div>
      )}
    </TiltCard>
  );
}
