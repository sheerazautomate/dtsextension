'use client';

import { useState } from 'react';

export default function ControlRail({ onCommandSent }) {
  const [pending, setPending] = useState(null); // which button is in-flight
  const [result, setResult] = useState(null);
  const [testMessage, setTestMessage] = useState('🔧 Test message from the admin panel');

  async function send(target, command, params) {
    const key = `${target}:${command}`;
    setPending(key);
    setResult(null);
    try {
      const res = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, command, params })
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
      setResult({ ok: true, message: `Queued "${command}" for ${target}. It'll run on that service's next poll.` });
      onCommandSent && onCommandSent();
    } catch (err) {
      setResult({ ok: false, message: String(err.message || err) });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="controls">
      <div className="controls-title">Controls</div>
      <div className="control-row">
        <button
          className="btn danger"
          disabled={pending === 'bot:restartBot'}
          onClick={() => send('bot', 'restartBot')}
        >
          {pending === 'bot:restartBot' ? 'Restarting…' : 'Restart bot'}
        </button>

        <button
          className="btn danger"
          disabled={pending === 'tunnel:restartTunnel'}
          onClick={() => send('tunnel', 'restartTunnel')}
        >
          {pending === 'tunnel:restartTunnel' ? 'Restarting…' : 'Restart tunnel'}
        </button>

        <button
          className="btn"
          disabled={pending === 'extension:triggerRun'}
          onClick={() => send('extension', 'triggerRun')}
        >
          {pending === 'extension:triggerRun' ? 'Triggering…' : 'Trigger run now'}
        </button>
      </div>

      <div className="control-row" style={{ marginTop: 12 }}>
        <input
          className="text-input"
          value={testMessage}
          onChange={(e) => setTestMessage(e.target.value)}
          placeholder="Test message text"
        />
        <button
          className="btn"
          disabled={pending === 'bot:sendTestMessage'}
          onClick={() => send('bot', 'sendTestMessage', { text: testMessage })}
        >
          {pending === 'bot:sendTestMessage' ? 'Sending…' : 'Send test message'}
        </button>
      </div>

      {result && (
        <div className={`control-result ${result.ok ? 'ok' : 'error'}`}>{result.message}</div>
      )}

      <div className="footer-note" style={{ marginTop: 12 }}>
        Commands are queued in Apps Script and picked up the next time the target service polls
        (bot/tunnel: every ~10–15s; extension: every ~20s while the dashboard tab is open).
        There's no confirmation that the action actually succeeded beyond the ack shown here —
        check the panel above and the event log below after a few seconds.
      </div>
    </div>
  );
}
