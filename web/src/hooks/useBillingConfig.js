import { useCallback, useEffect, useState } from 'react';
import client from '../api/client';

export default function useBillingConfig() {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setConfig(null);
    setError('');
    client.get('/billing/config', { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setConfig(data || {}); })
      .catch(() => {
        if (controller.signal.aborted) return;
        setConfig({});
        setError('We could not load current billing prices. Check your connection and try again.');
      });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    // A deployment or lost connection can outlast the API client's immediate
    // retries. Recheck an unavailable catalogue without remounting the page.
    if (config === null || config.paymentsReady === true) return undefined;
    const retry = () => { if (!document.hidden) refresh(); };
    const timer = window.setInterval(retry, 60_000);
    window.addEventListener('focus', retry);
    window.addEventListener('online', retry);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', retry);
      window.removeEventListener('online', retry);
    };
  }, [config, refresh]);

  return { config, error, checking: config === null, refresh };
}
