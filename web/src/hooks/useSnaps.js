import { useCallback, useEffect, useRef, useState } from 'react';
import client from '../api/client';
import { normalizeSnapSourceErrors } from '../components/snapRanking.mjs';

// Snap reads have their own request lifecycle and never consume the post feed.
export default function useSnaps(mode, viewerId) {
  const identity = `${viewerId || 'guest'}:${mode}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const controller = useRef(null);
  const requestGeneration = useRef(0);
  const [snapshot, setSnapshot] = useState({ identity: '', snaps: [], loading: false, error: '', sourceErrors: {} });
  const refresh = useCallback(async (bust = false) => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const generation = ++requestGeneration.current;
    if (mode === 'following' && !viewerId) {
      setSnapshot({ identity, snaps: [], loading: false, error: '', sourceErrors: {} });
      return;
    }
    setSnapshot(previous => ({ identity, snaps: previous.identity === identity ? previous.snaps : [], loading: true, error: '', sourceErrors: previous.identity === identity ? previous.sourceErrors : {} }));
    try {
      const { data } = await client.get('/snaps', { params: { mode, ...(bust ? { bust: '1' } : {}) }, signal: request.signal });
      if (!Array.isArray(data?.snaps)) throw new Error('Snaps could not be loaded.');
      if (generation === requestGeneration.current && identity === currentIdentity.current && !request.signal.aborted) {
        setSnapshot({ identity, snaps: data.snaps, loading: false, error: '', sourceErrors: normalizeSnapSourceErrors(data.sourceErrors) });
      }
    } catch (error) {
      if (request.signal.aborted || generation !== requestGeneration.current || identity !== currentIdentity.current) return;
      setSnapshot(previous => ({ ...previous, loading: false, error: error.response?.data?.message || error.message || 'Snaps could not be loaded.' }));
    }
  }, [identity, mode, viewerId]);
  useEffect(() => {
    void refresh();
    const reload = () => { void refresh(true); };
    const clear = () => {
      controller.current?.abort();
      requestGeneration.current++;
      setSnapshot({ identity: '', snaps: [], loading: false, error: '', sourceErrors: {} });
    };
    window.addEventListener('ufi-connections-changed', reload);
    window.addEventListener('ufi-session-cleared', clear);
    return () => {
      controller.current?.abort();
      requestGeneration.current++;
      window.removeEventListener('ufi-connections-changed', reload);
      window.removeEventListener('ufi-session-cleared', clear);
    };
  }, [refresh]);
  const publish = useCallback(async payload => {
    if (!viewerId) throw new Error('Sign in to post a Snap.');
    const publishingIdentity = identity;
    const { data } = await client.post('/snaps', payload, { timeout: 60000 });
    if (publishingIdentity === currentIdentity.current) await refresh(true);
    return data.snap;
  }, [identity, viewerId, refresh]);
  const remove = useCallback(async snapId => {
    if (!viewerId) throw new Error('Sign in to manage your Snaps.');
    const deletingIdentity = identity;
    await client.delete(`/snaps/${encodeURIComponent(snapId)}`);
    if (deletingIdentity === currentIdentity.current) {
      setSnapshot(previous => previous.identity === identity ? { ...previous, snaps: previous.snaps.filter(snap => snap.id !== snapId) } : previous);
    }
  }, [identity, viewerId]);
  const visible = snapshot.identity === identity ? snapshot : { snaps: [], loading: true, error: '', sourceErrors: {} };
  return { items: visible.snaps, loading: visible.loading, error: visible.error, sourceErrors: visible.sourceErrors, refresh: () => refresh(true), publish, remove };
}
