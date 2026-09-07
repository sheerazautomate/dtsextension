'use client';

export default function StatusDot({ state }) {
  return <span className={`status-dot ${state}`} title={state} />;
}
