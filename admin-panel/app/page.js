'use client';

import { useStatus } from '../lib/useStatus';
import TunnelPanel from '../components/TunnelPanel';
import BotPanel from '../components/BotPanel';
import ExtensionPanel from '../components/ExtensionPanel';
import ControlRail from '../components/ControlRail';
import EventLog from '../components/EventLog';
import LocalDiagnostics from '../components/LocalDiagnostics';

export default function Page() {
  const { data, error, loading, refresh } = useStatus();

  return (
    <div className="shell">
      <div className="topbar">
        <h1>DTS pipeline — ops</h1>
        <div className="topbar-meta">
          <span className="pulse">
            <span className={`pulse-dot ${error ? 'error' : ''}`} />
            {error ? 'Apps Script unreachable' : loading ? 'Connecting…' : 'Live'}
          </span>
          {data?.serverTime && <span className="mono">{new Date(data.serverTime).toLocaleTimeString()}</span>}
          <button className="refresh-btn" onClick={refresh}>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="section" style={{ marginBottom: 24 }}>
          <div className="empty-state">
            Couldn't load status from Apps Script: {error}. Check APPS_SCRIPT_URL / APPS_SCRIPT_SECRET
            in this deployment's environment variables.
          </div>
        </div>
      )}

      <div className="panel-grid">
        <TunnelPanel tunnel={data?.tunnel} bot={data?.bot} />
        <BotPanel bot={data?.bot} />
        <ExtensionPanel extension={data?.extension} />
      </div>

      <ControlRail onCommandSent={refresh} />

      <EventLog events={data?.recentEvents} />

      <LocalDiagnostics />

      <p className="footer-note">
        Polling Apps Script every 5s. This panel has no login — restrict access at the hosting
        level if that ever needs to change (e.g. Vercel deployment protection).
      </p>
    </div>
  );
}
