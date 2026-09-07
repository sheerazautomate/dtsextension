'use client';

import StatusDot from './StatusDot';
import LedRow from './LedRow';
import TiltCard from './TiltCard';
import { freshness, timeAgo } from '../lib/useStatus';

export default function ExtensionPanel({ extension }) {
  const state = freshness(extension?.receivedAt, 45000, 40 * 60 * 1000);
  const glowState = extension ? state : 'unknown';
  // Extension heartbeats pause naturally between scheduled runs while the
  // tab is open but idle-waiting — allow a wider "stale" window before
  // calling it offline.

  return (
    <TiltCard className={`panel glow-${glowState}`}>
      <div className="panel-head">
        <div>
          <div className="panel-title">Browser extension</div>
          <div className="panel-sub">DTS Dashboard automation</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LedRow />
          <StatusDot state={glowState} />
        </div>
      </div>

      {extension ? (
        <div className="field-list">
          <div className="field-row">
            <span className="field-label">Flow step</span>
            <span className="field-value mono">{extension.flowStep || 'idle'}</span>
          </div>
          <div className="field-row">
            <span className="field-label">Next run</span>
            <span className="field-value mono">
              {extension.nextRunAt ? new Date(extension.nextRunAt).toLocaleTimeString() : '—'}
            </span>
          </div>
          <div className="field-row">
            <span className="field-label">Last success</span>
            <span className="field-value mono">{timeAgo(extension.lastSuccessAt)}</span>
          </div>
          <div className="field-row">
            <span className="field-label">Online</span>
            <span className={`field-value ${extension.isOnline ? 'ok' : 'critical'}`}>
              {extension.isOnline ? 'Yes' : 'No'}
            </span>
          </div>
          <div className="field-row">
            <span className="field-label">Day complete</span>
            <span className="field-value mono">{extension.dayComplete ? 'Yes' : 'No'}</span>
          </div>
          {extension.lastError && (
            <div className="field-row">
              <span className="field-label">Last error</span>
              <span className="field-value critical">
                {typeof extension.lastError === 'string' ? extension.lastError : JSON.stringify(extension.lastError)}
              </span>
            </div>
          )}
          <div className="field-row">
            <span className="field-label">Heartbeat</span>
            <span className="field-value mono">{timeAgo(extension.receivedAt)}</span>
          </div>
        </div>
      ) : (
        <div className="field-value muted">
          No heartbeat yet — the DTS Dashboard tab needs to be open with the extension running
        </div>
      )}
    </TiltCard>
  );
}
