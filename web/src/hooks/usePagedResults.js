import { useCallback, useEffect, useRef, useState } from 'react';

const emptyPage = () => ({ items: [], page: 1, hasNext: false, total: null, data: null, loading: true, error: '', failedPage: null });

// Offset and cursor APIs share the same visible-page lifecycle. Only successful
// responses commit a new page; a failed Next keeps the current page for retry.
export default function usePagedResults({ enabled = true, queryKey, loadPage, delay = 0, errorMessage = 'Results could not be loaded. Please try again.' }) {
  const [snapshot, setSnapshot] = useState(() => ({ key: queryKey, ...emptyPage() }));
  const latest = useRef({ queryKey, enabled, loadPage, errorMessage });
  latest.current = { queryKey, enabled, loadPage, errorMessage };
  const epoch = useRef(0), controller = useRef(null), pending = useRef(false);
  const cache = useRef(new Map()), visible = useRef(null);

  const requestPage = useCallback(async (page, { reset = false } = {}) => {
    const config = latest.current;
    if (!config.enabled || pending.current || !Number.isInteger(page) || page < 1) return false;
    const revision = epoch.current, key = config.queryKey;
    const current = () => revision === epoch.current && key === latest.current.queryKey && latest.current.enabled;
    if (!reset && cache.current.has(page)) {
      const cached = cache.current.get(page);
      visible.current = { ...cached, key };
      setSnapshot({ key, ...cached, loading: false, error: '', failedPage: null });
      return true;
    }
    pending.current = true;
    const abort = new AbortController(); controller.current = abort;
    setSnapshot(previous => ({ ...(reset || previous.key !== key ? emptyPage() : previous), key, loading: true, error: '', failedPage: null }));
    try {
      const response = await config.loadPage({ page, cursor: cache.current.get(page - 1)?.nextCursor || '', signal: abort.signal });
      if (!current() || abort.signal.aborted) return false;
      const value = { items: Array.isArray(response.items) ? response.items : [], page,
        hasNext: response.hasNext === true, total: Number.isFinite(response.total) && response.total >= 0 ? response.total : null,
        nextCursor: typeof response.nextCursor === 'string' ? response.nextCursor : '', data: response.data || null };
      // Rows can disappear between offset requests. Keep the last populated
      // page visible instead of stranding the reader on an empty extra page.
      if (value.items.length === 0 && page > 1 && visible.current?.items.length) {
        const previous = { ...visible.current, hasNext: false };
        if (value.total !== null) previous.total = value.total;
        cache.current.set(previous.page, previous); visible.current = previous;
        setSnapshot({ ...previous, key, loading: false, error: '', failedPage: null });
        return false;
      }
      cache.current.set(page, value); visible.current = { ...value, key };
      setSnapshot({ key, ...value, loading: false, error: '', failedPage: null });
      return true;
    } catch {
      if (current() && !abort.signal.aborted) setSnapshot(previous => ({ ...previous, key, loading: false, error: config.errorMessage, failedPage: page }));
      return false;
    } finally {
      if (current()) { pending.current = false; controller.current = null; }
    }
  }, []);

  useEffect(() => {
    epoch.current++; controller.current?.abort(); controller.current = null; pending.current = false;
    cache.current = new Map(); visible.current = null;
    setSnapshot({ key: queryKey, ...emptyPage(), loading: enabled });
    if (!enabled) return undefined;
    const timer = setTimeout(() => { void requestPage(1, { reset: true }); }, delay);
    return () => { clearTimeout(timer); epoch.current++; controller.current?.abort(); pending.current = false; };
  }, [queryKey, enabled, delay, requestPage]);

  const goToPage = useCallback(page => {
    const current = visible.current;
    if (!current || current.key !== latest.current.queryKey || pending.current || (page !== current.page - 1 && page !== current.page + 1)
      || page > current.page && !current.hasNext) return Promise.resolve(false);
    return requestPage(page);
  }, [requestPage]);
  const refresh = useCallback(() => {
    epoch.current++; controller.current?.abort(); pending.current = false; cache.current.clear(); visible.current = null;
    return requestPage(1, { reset: true });
  }, [requestPage]);
  const retry = useCallback(() => requestPage(snapshot.failedPage || snapshot.page), [requestPage, snapshot.failedPage, snapshot.page]);
  const updateItems = useCallback(updater => {
    setSnapshot(previous => {
      const items = typeof updater === 'function' ? updater(previous.items) : updater;
      const next = { ...previous, items };
      if (cache.current.has(previous.page)) { const cached = { ...cache.current.get(previous.page), items }; cache.current.set(previous.page, cached); visible.current = { ...cached, key: previous.key }; }
      return next;
    });
  }, []);
  return { ...(snapshot.key === queryKey ? snapshot : emptyPage()), goToPage, refresh, retry, updateItems };
}
