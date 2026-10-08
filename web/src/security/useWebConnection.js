import { useCallback, useEffect, useRef, useState } from 'react';
import client from '../api/client';
import { getAccessToken, subscribeToSession } from '../auth/session';
import { verifiedWebConnection } from './webConnection.mjs';

export default function useWebConnection(accountId, enabled = true, { endpoint = '/security/web-connection', onDenied, canCheck } = {}) {
  const [token, setToken] = useState(getAccessToken);
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(Boolean(enabled && accountId && token));
  const [error, setError] = useState(null);
  const sequence = useRef(0);
  const request = useRef(null);
  const account = useRef(accountId); account.current = accountId;
  const active = useRef(enabled); active.current = enabled;
  const denied = useRef(onDenied); denied.current = onDenied;
  const permitted = useRef(canCheck); permitted.current = canCheck;

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
    if (!enabled || !active.current || !accountId || !token || (permitted.current && !permitted.current())) { setChecking(false); return; }
    const controller = new AbortController();
    request.current = controller;
    const current = () => enabled && active.current && !controller.signal.aborted && revision === sequence.current
      && account.current === accountId && token === getAccessToken() && (!permitted.current || permitted.current());
    setChecking(true);
    try {
      const { data } = await client.get(endpoint, {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      });
      const verified = verifiedWebConnection(data);
      if (current()) setStatus({ data: verified, accountId, token });
    } catch (failure) {
      if (current()) {
        const status = failure?.response?.status;
        setError({ accountId, token, message: status === 401 ? 'Sign in again to check web protection.'
          : status === 403 ? 'An active paid Vault membership is required for connection monitoring.'
          : 'Web protection could not be verified. Check your connection and try again.' });
        if (status === 401 || status === 403) denied.current?.(status);
      }
    } finally {
      if (current()) setChecking(false);
      if (request.current === controller) request.current = null;
    }
  }, [accountId, token, enabled, endpoint]);

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
  const currentStatus = enabled && (!permitted.current || permitted.current()) && status?.accountId === accountId && status?.token === token
    && token === getAccessToken() ? status.data : null;
  const currentError = enabled && authenticated && error?.accountId === accountId && error?.token === token ? error.message : '';
  return { status: currentStatus, checking: Boolean(enabled && accountId && authenticated && checking), error: currentError, refresh, authenticated };
}
