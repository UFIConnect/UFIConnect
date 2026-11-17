import { useCallback, useEffect, useRef, useState } from 'react';
import client from '../api/client';
import { engagementLedger, POST_ENGAGEMENT_EVENT } from '../api/postEngagement.mjs';
import { normalizeSnapSourceErrors } from '../components/snapRanking.mjs';
import { readSnapSnapshot, saveSnapSnapshot, clearSnapSnapshots, mergeSnapRefresh } from './snapSnapshot.mjs';

// Snap reads have their own request lifecycle and never consume the post feed.
export default function useSnaps(mode, viewerId) {
  const identity = `${viewerId || 'guest'}:${mode}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const controller = useRef(null);
  const requestGeneration = useRef(0);
  const explicitRefresh = useRef(null);
  const [avatarRevision, setAvatarRevision] = useState(0);
  const [snapshot, setSnapshot] = useState(() => readSnapSnapshot(identity) || { identity: '', snaps: [], loading: false, error: '', sourceErrors: {}, refreshingSources: [] });
  useEffect(() => { saveSnapSnapshot(snapshot); }, [snapshot]);
  const refresh = useCallback(async (bust = false, source = null) => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const generation = ++requestGeneration.current;
    if (mode === 'following' && !viewerId) {
      setSnapshot({ identity, snaps: [], loading: false, error: '', sourceErrors: {}, refreshingSources: [] });
      return;
    }
    setSnapshot(previous => {
      const existing = previous.identity === identity ? previous : readSnapSnapshot(identity);
      return { identity, snaps: existing?.snaps || [], loading: true, error: '', sourceErrors: existing?.sourceErrors || {}, refreshingSources: source ? [source] : [] };
    });
    try {
      const revision = engagementLedger.revision();
      const { data } = await client.get('/snaps', { params: { mode, ...(source ? { source } : {}), ...(bust ? { bust: '1' } : {}) }, signal: request.signal });
      if (!Array.isArray(data?.snaps)) throw new Error('Snaps could not be loaded.');
      if (generation === requestGeneration.current && identity === currentIdentity.current && !request.signal.aborted) {
        setSnapshot(previous => {
          const existing = previous.identity === identity ? previous : { snaps: [], sourceErrors: {} };
          const sourceErrors = normalizeSnapSourceErrors(data.sourceErrors);
          const incoming = data.snaps.map(snap => engagementLedger.apply(snap, revision));
          if (source) {
            const retainedErrors = { ...existing.sourceErrors };
            delete retainedErrors[source];
            return { identity, snaps: mergeSnapRefresh(existing.snaps, incoming, sourceErrors, source), loading: false, error: '', sourceErrors: { ...retainedErrors, ...(sourceErrors[source] ? { [source]: sourceErrors[source] } : {}) }, refreshingSources: [] };
          }
          return { identity, snaps: mergeSnapRefresh(existing.snaps, incoming, sourceErrors), loading: false, error: '', sourceErrors, refreshingSources: [] };
        });
      }
    } catch (error) {
      if (request.signal.aborted || generation !== requestGeneration.current || identity !== currentIdentity.current) return;
      const message = error.response?.data?.message || error.message || 'Snaps could not be loaded.';
      if ([401, 403, 404].includes(error.response?.status)) {
        clearSnapSnapshots();
        setSnapshot({ identity, snaps: [], loading: false, error: message, sourceErrors: {}, refreshingSources: [] });
        return;
      }
      setSnapshot(previous => ({ ...previous, loading: false, refreshingSources: [], ...(source ? { sourceErrors: { ...previous.sourceErrors, [source]: message } } : { error: message }) }));
    }
  }, [identity, mode, viewerId]);
  const refreshAll = useCallback(() => {
    if (explicitRefresh.current?.identity === identity) return explicitRefresh.current.promise;
    // Retry transient avatar failures even when a source returns the same URLs.
    setAvatarRevision(revision => revision + 1);
    const promise = refresh(true).finally(() => {
      if (explicitRefresh.current?.promise === promise) explicitRefresh.current = null;
    });
    explicitRefresh.current = { identity, promise };
    return promise;
  }, [identity, refresh]);
  useEffect(() => {
    void refresh();
    const reload = () => {
      clearSnapSnapshots();
      setSnapshot({ identity, snaps: [], loading: false, error: '', sourceErrors: {}, refreshingSources: [] });
      void refresh(true);
    };
    const clear = () => {
      clearSnapSnapshots();
      controller.current?.abort();
      requestGeneration.current++;
      setSnapshot({ identity: '', snaps: [], loading: false, error: '', sourceErrors: {}, refreshingSources: [] });
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
  useEffect(() => {
    const updateLikes = ({ detail }) => {
      if (detail?.action !== 'like') return;
      setSnapshot(previous => {
        if (previous.identity !== identity) return previous;
        const index = previous.snaps.findIndex(snap => snap.id === detail.postId && snap.source === detail.source);
        if (index < 0) return previous;
        const snaps = [...previous.snaps];
        snaps[index] = engagementLedger.apply(snaps[index], 0);
        return { ...previous, snaps };
      });
    };
    window.addEventListener(POST_ENGAGEMENT_EVENT, updateLikes);
    return () => window.removeEventListener(POST_ENGAGEMENT_EVENT, updateLikes);
  }, [identity]);
  const publish = useCallback(async payload => {
    if (!viewerId) throw new Error('Sign in to post a Snap.');
    const publishingIdentity = identity;
    const { data } = await client.post('/snaps', payload, { timeout: 60000 });
    const pending = explicitRefresh.current;
    if (pending?.identity === publishingIdentity) await pending.promise;
    if (publishingIdentity === currentIdentity.current) await refresh(true, 'uficonnect');
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
  const visible = snapshot.identity === identity ? snapshot : readSnapSnapshot(identity) || { snaps: [], loading: true, error: '', sourceErrors: {}, refreshingSources: [] };
  return { items: visible.snaps, loading: visible.loading, error: visible.error, sourceErrors: visible.sourceErrors,
    refreshingSources: visible.refreshingSources, avatarRevision, refresh: refreshAll, publish, remove };
}
