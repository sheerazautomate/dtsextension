'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 5000;

export function useStatus() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/status', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
      setError(null);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    timerRef.current = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timerRef.current);
  }, [refresh]);

  return { data, error, loading, refresh };
}

/** Freshness helper: returns 'live' | 'stale' | 'offline' | 'unknown' */
export function freshness(receivedAt, staleAfterMs = 45000, offlineAfterMs = 180000) {
  if (!receivedAt) return 'unknown';
  const age = Date.now() - new Date(receivedAt).getTime();
  if (age < staleAfterMs) return 'live';
  if (age < offlineAfterMs) return 'stale';
  return 'offline';
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
