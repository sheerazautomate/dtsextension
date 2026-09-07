'use client';

import { useEffect, useState } from 'react';

export default function LocalDiagnostics() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/local', { cache: 'no-store' });
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(String(err.message || err));
      }
    }
    load();
    const t = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (error) {
    return (
      <div className="section">
        <div className="section-head">Local diagnostics</div>
        <div className="empty-state">Couldn't reach /api/local: {error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="section">
        <div className="section-head">Local diagnostics</div>
        <div className="empty-state">Checking…</div>
      </div>
    );
  }

  return (
    <div className="section">
      <div className="section-head">
        <span>Local diagnostics</span>
        <span className="count">
          {data.localMode ? 'running on the same host as the bot' : 'no local services reachable — expected on Vercel'}
        </span>
      </div>
      <div className="local-grid">
        <div className="local-block">
          <h3>Bot health (direct, bypassing tunnel)</h3>
          {data.botHealth?.available ? (
            <div className="field-list">
              <div className="field-row">
                <span className="field-label">Status</span>
                <span className="field-value mono">{data.botHealth.data.status}</span>
              </div>
              <div className="field-row">
                <span className="field-label">Connected</span>
                <span className="field-value mono">{String(data.botHealth.data.connected)}</span>
              </div>
            </div>
          ) : (
            <div className="unavailable">Not reachable{data.botHealth?.error ? ` — ${data.botHealth.error}` : ''}</div>
          )}
        </div>

        <div className="local-block">
          <h3>pm2 processes</h3>
          {data.pm2?.available ? (
            data.pm2.processes.map((p) => (
              <div className="pm2-row" key={p.name}>
                <span className="mono">{p.name}</span>
                <span className={p.status === 'online' ? 'field-value ok' : 'field-value critical'}>
                  {p.status} · {p.restarts} restarts
                </span>
              </div>
            ))
          ) : (
            <div className="unavailable">Not available{data.pm2?.error ? ` — ${data.pm2.error}` : ''}</div>
          )}
        </div>

        <div className="local-block" style={{ gridColumn: '1 / -1' }}>
          <h3>cloudflared log (last 20 lines)</h3>
          {data.cloudflaredLog?.available ? (
            <div className="local-log">{data.cloudflaredLog.lines.join('\n')}</div>
          ) : (
            <div className="unavailable">
              Not available{data.cloudflaredLog?.error ? ` — ${data.cloudflaredLog.error}` : ''}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
