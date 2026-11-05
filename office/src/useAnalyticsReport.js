import { useCallback, useEffect, useRef, useState } from 'react';

const REFRESH_MS = 30_000;
const REQUEST_TIMEOUT_MS = 25_000;
export const ANALYTICS_STALE_MS = 90_000;

export default function useAnalyticsReport({ apiBase, request, active: enabled = true }) {
  const [report, setReport] = useState(null), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null), [revision, setRevision] = useState(0), [checkedNow, setCheckedNow] = useState(Date.now);
  const refreshRef = useRef(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let disposed = false, generation = 0, active = null;
    const timeouts = new Set();
    const current = sequence => !disposed && generation === sequence;
    async function read(force = false) {
      if (disposed || active || !enabled || document.visibilityState === 'hidden') return;
      const controller = new AbortController(), sequence = ++generation;
      active = controller;
      setBusy(true); setCheckedNow(Date.now()); setRevision(value => value + 1);
      let timeout;
      try {
        const load = async () => {
          const response = await request(`${apiBase}/office/analytics/pageviews?detail=compact`, { signal: controller.signal, ...(force ? { cache: 'reload' } : {}) });
          if (response.status === 401 || response.status === 403) {
            if (current(sequence)) { setReport(null); setUpdatedAt(null); }
            throw new Error('Office access is required. Update your Office access and retry.');
          }
          const data = await response.json();
          if (!response.ok || data.available !== true) throw new Error(data.error || 'Analytics storage is unavailable. Retrying automatically.');
          if (data.mode !== 'aggregate' || !Array.isArray(data.categories) || !Array.isArray(data.daily)) throw new Error('Detailed analytics is unavailable from this API release.');
          return data;
        };
        const data = await Promise.race([load(), new Promise((_, reject) => {
          timeout = window.setTimeout(() => { controller.abort(); reject(new Error('The analytics check timed out. Retrying automatically.')); }, REQUEST_TIMEOUT_MS);
          timeouts.add(timeout);
        })]);
        if (current(sequence) && !controller.signal.aborted) {
          const receivedAt = new Date();
          setReport(data); setUpdatedAt(receivedAt); setCheckedNow(receivedAt.getTime()); setError('');
        }
      } catch (failure) {
        if (current(sequence)) setError(failure.message || 'Analytics could not be refreshed. Retrying automatically.');
      } finally {
        window.clearTimeout(timeout); timeouts.delete(timeout);
        if (current(sequence)) { active = null; setBusy(false); setCheckedNow(Date.now()); }
      }
    }
    const refreshVisible = () => {
      setCheckedNow(Date.now());
      if (document.visibilityState === 'hidden') { generation++; active?.abort(); active = null; setBusy(false); }
      else read();
    };
    const invalidate = () => {
      generation++; active?.abort(); active = null;
      setReport(null); setUpdatedAt(null); setError(''); setBusy(true); setRevision(value => value + 1);
      read(true);
    };
    refreshRef.current = () => read(true);
    window.addEventListener('office-token-changed', invalidate);
    window.addEventListener('focus', refreshVisible);
    window.addEventListener('online', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    const timer = window.setInterval(refreshVisible, REFRESH_MS);
    read();
    return () => {
      disposed = true; generation++; active?.abort(); refreshRef.current = () => {};
      for (const timeout of timeouts) window.clearTimeout(timeout);
      window.clearInterval(timer);
      window.removeEventListener('office-token-changed', invalidate);
      window.removeEventListener('focus', refreshVisible);
      window.removeEventListener('online', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [apiBase, request, enabled]);

  return { report, busy: enabled && busy, error, updatedAt, revision, refresh,
    stale: Boolean(updatedAt && checkedNow - updatedAt.getTime() >= ANALYTICS_STALE_MS) };
}
