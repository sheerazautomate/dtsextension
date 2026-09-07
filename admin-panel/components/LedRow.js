'use client';

export default function LedRow({ count = 4 }) {
  return (
    <span className="led-row" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} className="led" style={{ animationDelay: `${i * 0.18}s` }} />
      ))}
    </span>
  );
}
