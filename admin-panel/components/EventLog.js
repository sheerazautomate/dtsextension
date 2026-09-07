'use client';

export default function EventLog({ events }) {
  return (
    <div className="section">
      <div className="section-head">
        <span>Event log</span>
        <span className="count">{events?.length || 0} of last 100</span>
      </div>

      {events && events.length > 0 ? (
        <div className="log-scroll">
          <table className="log-table">
            <thead>
              <tr>
                <th style={{ width: 150 }}>Time</th>
                <th style={{ width: 100 }}>Source</th>
                <th style={{ width: 140 }}>Type</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev, i) => (
                <tr key={i}>
                  <td className="ts">{new Date(ev.timestamp).toLocaleString()}</td>
                  <td className="source">{ev.source}</td>
                  <td className="type">{ev.type}</td>
                  <td className="mono">{ev.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          Nothing logged yet. Events appear here as the extension, bot, and tunnel report in.
        </div>
      )}
    </div>
  );
}
