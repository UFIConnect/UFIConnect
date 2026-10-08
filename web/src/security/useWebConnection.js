import { useCallback, useEffect, useRef, useState } from 'react';
import client from '../api/client';
import { getAccessToken, subscribeToSession } from '../auth/session';
import { verifiedWebConnection } from './webConnection.mjs';

export default function useWebConnection(accountId) {
  const [token, setToken] = useState(getAccessToken);
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(Boolean(accountId && token));
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const request = useRef(null);
  const account = useRef(accountId); account.current = accountId;

  useEffect(() => subscribeToSession(value => {
    sequence.current++;
    request.current?.abort();
    setStatus(null); setError(''); setChecking(Boolean(value && account.current)); setToken(value);
  }), []);

  const refresh = useCallback(async () => {
    const revision = ++sequence.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = () => !controller.signal.aborted && revision === sequence.current
      && account.current === accountId && token === getAccessToken();
    setStatus(null); setError('');
    if (!accountId || !token || token !== getAccessToken()) { setChecking(false); return; }
    setChecking(true);
    try {
      const { data } = await client.get('/security/web-connection', {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      });
      const verified = verifiedWebConnection(data);
      if (current()) setStatus({ data: verified, accountId, token });
    } catch (failure) {
      if (current()) setError(failure?.response?.status === 401
        ? 'Sign in again to check web protection.' : 'Web protection could not be verified. Check your connection and try again.');
    } finally {
      if (current()) setChecking(false);
      if (request.current === controller) request.current = null;
    }
  }, [accountId, token]);

  useEffect(() => {
    void refresh();
    return () => { sequence.current++; request.current?.abort(); };
  }, [refresh]);

  useEffect(() => {
    if (!accountId || !token) return undefined;
    const update = () => { if (!document.hidden) void refresh(); };
    const offline = () => {
      sequence.current++; request.current?.abort(); setStatus(null); setChecking(false);
      setError('You are offline. Reconnect to check web protection.');
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
  }, [accountId, token, refresh]);

  // A new account can render before the cleanup effect runs. Never carry the
  // previous account's verified status into that render.
  const currentStatus = status?.accountId === accountId && status?.token === token
    && token === getAccessToken() ? status.data : null;
  return { status: currentStatus, checking, error, refresh, authenticated: Boolean(token && token === getAccessToken()) };
}
