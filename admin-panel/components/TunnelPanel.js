'use client';

import StatusDot from './StatusDot';
import LedRow from './LedRow';
import TiltCard from './TiltCard';
import { freshness, timeAgo } from '../lib/useStatus';

export default function TunnelPanel({ tunnel }) {
  const state = freshness(tunnel?.updatedAt, 10 * 60 * 1000, 30 * 60 * 1000);
  const glowState = tunnel ? state : 'unknown';
  // Tunnel URLs are only reported on change, so "fresh" here means
  // "reported recently enough to still plausibly be the live one" —
  // thresholds are looser than the heartbeat-driven panels.

  return (
    <TiltCard className={`panel glow-${glowState}`}>
      <div className="panel-head">
        <div>
          <div className="panel-title">Tunnel</div>
          <div className="panel-sub">Cloudflare quick tunnel</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LedRow />
          <StatusDot state={glowState} />
        </div>
      </div>

      {tunnel ? (
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
        </div>
      ) : (
        <div className="field-value muted">No tunnel URL reported yet</div>
      )}
    </TiltCard>
  );
}
