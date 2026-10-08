import { useCallback, useEffect, useRef, useState } from 'react';
import client from '../api/client';
import { getAccessToken, subscribeToSession } from '../auth/session';
import { verifiedWebConnection } from './webConnection.mjs';

export default function useWebConnection(accountId, enabled = true) {
  const [token, setToken] = useState(getAccessToken);
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(Boolean(enabled && accountId && token));
  const [error, setError] = useState(null);
  const sequence = useRef(0);
  const request = useRef(null);
  const account = useRef(accountId); account.current = accountId;
  const active = useRef(enabled); active.current = enabled;

  useEffect(() => subscribeToSession(value => {
    sequence.current++;
    request.current?.abort();
    setStatus(null); setError(null); setChecking(Boolean(active.current && value && account.current)); setToken(value);
  }), []);

  const refresh = useCallback(async () => {
    if (account.current !== accountId || token !== getAccessToken()) return;
    const revision = ++sequence.current;
    request.current?.abort();
    request.current = null;
    setStatus(null); setError(null);
    if (!enabled || !active.current || !accountId || !token) { setChecking(false); return; }
    const controller = new AbortController();
    request.current = controller;
    const current = () => enabled && active.current && !controller.signal.aborted && revision === sequence.current
      && account.current === accountId && token === getAccessToken();
    setChecking(true);
    try {
      const { data } = await client.get('/security/web-connection', {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      });
      const verified = verifiedWebConnection(data);
      if (current()) setStatus({ data: verified, accountId, token });
    } catch (failure) {
      if (current()) setError({ accountId, token, message: failure?.response?.status === 401
        ? 'Sign in again to check web protection.' : 'Web protection could not be verified. Check your connection and try again.' });
    } finally {
      if (current()) setChecking(false);
      if (request.current === controller) request.current = null;
    }
  }, [accountId, token, enabled]);

  useEffect(() => {
    void refresh();
    return () => { sequence.current++; request.current?.abort(); };
  }, [refresh]);

  useEffect(() => {
    if (!enabled || !accountId || !token) return undefined;
    const update = () => { if (active.current && !document.hidden) void refresh(); };
    const offline = () => {
      if (!active.current || account.current !== accountId || token !== getAccessToken()) return;
      sequence.current++; request.current?.abort(); setStatus(null); setChecking(false);
      setError({ accountId, token, message: 'You are offline. Reconnect to check web protection.' });
    };
    const timer = window.setInterval(update, 60000);
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', update);
    };
  }, [accountId, token, enabled, refresh]);

  // A new account can render before the cleanup effect runs. Never carry the
  // previous account's verified status into that render.
  const authenticated = Boolean(token && token === getAccessToken());
  const currentStatus = enabled && status?.accountId === accountId && status?.token === token
    && token === getAccessToken() ? status.data : null;
  const currentError = enabled && authenticated && error?.accountId === accountId && error?.token === token ? error.message : '';
  return { status: currentStatus, checking: Boolean(enabled && accountId && authenticated && checking), error: currentError, refresh, authenticated };
}
