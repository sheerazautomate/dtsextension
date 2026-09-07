'use client';

import StatusDot from './StatusDot';
import LedRow from './LedRow';
import TiltCard from './TiltCard';
import { freshness, timeAgo } from '../lib/useStatus';

function formatUptime(sec) {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function BotPanel({ bot }) {
  const state = freshness(bot?.receivedAt);
  const glowState = bot ? state : 'unknown';

  return (
    <TiltCard className={`panel glow-${glowState}`}>
      <div className="panel-head">
        <div>
          <div className="panel-title">WhatsApp bot</div>
          <div className="panel-sub">Baileys session + webhook</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LedRow />
          <StatusDot state={glowState} />
        </div>
      </div>

      {bot ? (
        <div className="field-list">
          <div className="field-row">
            <span className="field-label">Connected</span>
            <span className={`field-value ${bot.connected ? 'ok' : 'critical'}`}>
              {bot.connected ? 'Yes' : 'No'}
            </span>
          </div>
          <div className="field-row">
            <span className="field-label">Uptime</span>
            <span className="field-value mono">{formatUptime(bot.uptimeSec)}</span>
          </div>
          <div className="field-row">
            <span className="field-label">Reconnects</span>
            <span className={`field-value mono ${bot.reconnectCount > 5 ? 'warn' : ''}`}>
              {bot.reconnectCount ?? 0}
            </span>
          </div>
          <div className="field-row">
            <span className="field-label">Sends (ok / failed)</span>
            <span className="field-value mono">
              {bot.sendCount ?? 0} / {bot.sendFailCount ?? 0}
            </span>
          </div>
          <div className="field-row">
            <span className="field-label">Last send</span>
            <span className="field-value mono">{timeAgo(bot.lastSendAt)}</span>
          </div>
          {bot.lastError && (
            <div className="field-row">
              <span className="field-label">Last error</span>
              <span className="field-value critical">
                {typeof bot.lastError === 'string' ? bot.lastError : JSON.stringify(bot.lastError)}
              </span>
            </div>
          )}
          <div className="field-row">
            <span className="field-label">Heartbeat</span>
            <span className="field-value mono">{timeAgo(bot.receivedAt)}</span>
          </div>
        </div>
      ) : (
        <div className="field-value muted">No heartbeat received yet</div>
      )}
    </TiltCard>
  );
}
