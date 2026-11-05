import { useCallback, useEffect, useRef, useState } from 'react';
import { useOfficePageVisible } from './useOfficePolling.js';

export default function useOfficeAnalyticsSnapshot({ apiBase, endpoint, request, active = true, valid }) {
  const [report, setReport] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const generation = useRef(0), controller = useRef(null), reload = useRef(false), visible = useOfficePageVisible();
  const refresh = useCallback(() => { reload.current = true; setRevision(value => value + 1); }, []);
  useEffect(() => {
    const invalidate = () => { generation.current++; controller.current?.abort(); setReport(null); setError(''); refresh(); };
    window.addEventListener('office-token-changed', invalidate);
    return () => { generation.current++; controller.current?.abort(); window.removeEventListener('office-token-changed', invalidate); };
  }, [refresh]);
  useEffect(() => {
    if (!active || !visible) { setBusy(false); return; }
    const current = ++generation.current, abort = new AbortController(), force = reload.current;
    reload.current = false; controller.current = abort; setBusy(true); setError('');
    request(`${apiBase}${endpoint}`, { signal: abort.signal, ...(force ? { cache: 'reload' } : {}) })
      .then(async response => {
        const data = await response.json();
        if (response.status === 401 || response.status === 403) {
          if (generation.current === current && !abort.signal.aborted) setReport(null);
          throw new Error('Office access is required. Update your access and retry.');
        }
        if (!response.ok || data.available !== true || !valid(data)) throw new Error(data.error || 'These analytics are temporarily unavailable.');
        if (generation.current === current && !abort.signal.aborted) setReport(data);
      })
      .catch(failure => { if (generation.current === current && !abort.signal.aborted) setError(failure.message || 'Analytics could not be loaded.'); })
      .finally(() => { if (generation.current === current && !abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [apiBase, endpoint, request, active, visible, revision, valid]);
  return { report, busy, error, refresh };
}
