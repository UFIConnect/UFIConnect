import { useCallback, useEffect, useRef, useState } from 'react';
import client from '../api/client';
import { createPublishingStatusPolling, pendingPublishingKey } from './publishingStatus.mjs';

export default function useCrossPostStatus({ owner, posts = [], onPosts, enabled = true }) {
  const currentOwner = useRef(owner); currentOwner.current = owner;
  const pending = pendingPublishingKey(posts);
  const currentPending = useRef(pending); currentPending.current = pending;
  const receive = useRef(onPosts); receive.current = onPosts;
  const poller = useRef(null);
  const [status, setStatus] = useState({ owner, syncing: false, error: '', lastCheckedAt: null });
  useEffect(() => {
    setStatus({ owner, syncing: false, error: '', lastCheckedAt: null });
    if (!owner || !enabled) return;
    const instance = createPublishingStatusPolling({
      request: async signal => (await client.post('/command-center/cross-post/sync', {}, { signal, timeout: 60000 })).data,
      onPosts: values => receive.current(values),
      onState: patch => setStatus(previous => ({ ...previous, owner, ...patch })),
      isCurrent: () => currentOwner.current === owner,
      isPending: () => Boolean(currentPending.current),
    });
    poller.current = instance;
    return () => { instance.close(); if (poller.current === instance) poller.current = null; };
  }, [owner, enabled]);
  useEffect(() => { poller.current?.update(); }, [pending]);
  const refresh = useCallback(() => poller.current?.refresh(), []);
  return { ...(status.owner === owner ? status : { syncing: false, error: '', lastCheckedAt: null }),
    pending: Boolean(pending), refresh };
}
