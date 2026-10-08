import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import client from '../api/client';
import { getAccessToken } from '../auth/session';
import { feedLocationKey } from '../utils/feedLocation.mjs';
import { normalizeAccountLocationReport } from '../../../shared/accountLocation.js';

export default function useLocationBasedAccounts(enabled) {
  const { profile, token, deviceLocationRevision } = useAuth();
  const locationKey = feedLocationKey(profile?.roleSettings, 'feed');
  const owner = `${profile?.id || ''}:${profile?.plan || ''}:${token || ''}:${locationKey}:${deviceLocationRevision || 0}`;
  const currentOwner = useRef(owner); currentOwner.current = owner;
  const [report, setReport] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const canRequest = Boolean(enabled && profile?.id && token && token === getAccessToken());
  useEffect(() => {
    if (!canRequest) { setReport(null); return undefined; }
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && currentOwner.current === owner && token === getAccessToken();
    setReport({ owner, pending: true, data: null, error: '' });
    client.get('/social/platforms/location', { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => {
        if (!current()) return;
        const normalized = normalizeAccountLocationReport(data);
        if (!normalized) throw new Error('Location account ranking is unavailable.');
        setReport({ owner, pending: false, data: normalized, error: '' });
      })
      .catch(() => {
        if (current()) setReport({ owner, pending: false, data: null, error: 'Could not load location based accounts. Try again.' });
      });
    return () => controller.abort();
  }, [canRequest, owner, token, attempt]);
  const visible = canRequest && report?.owner === owner && token === getAccessToken() ? report : null;
  return { data: visible?.data || null, checking: canRequest && (!visible || visible.pending), error: visible?.error || '',
    refresh: () => setAttempt(value => value + 1) };
}
