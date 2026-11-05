import { useEffect, useRef } from 'react';
import client from '../api/client';
import { POST_ENGAGEMENT_EVENT } from '../api/postEngagement.mjs';

const reads = new Map();
if (typeof window !== 'undefined') {
  window.addEventListener('ufi-session-cleared', () => reads.clear());
  window.addEventListener('ufi-connections-changed', () => reads.clear());
}
function readState(key, sourceUrl) {
  const cached = reads.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = client.get('/social/post-engagement', { params: { source: 'bluesky', sourceUrl } }).then(({ data }) => data);
  reads.set(key, { promise, expiresAt: Date.now() + 2000 });
  while (reads.size > 200) reads.delete(reads.keys().next().value);
  promise.catch(() => { if (reads.get(key)?.promise === promise) reads.delete(key); });
  return promise;
}

// AppView can take a few seconds to index a confirmed repository write.
// Refresh after writes and on focus; do not run a polling loop for every card.
export default function useBlueskyPostEngagement({ post, identity, enabled, isCurrent, onState }) {
  const update = useRef(onState); update.current = onState;
  useEffect(() => {
    if (!enabled || post.source !== 'bluesky' || !post.sourceUrl) return undefined;
    let cancelled = false, generation = 0, expected;
    const timers = new Set();
    const key = `${identity}:${post.sourceUrl}`;
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      const requestGeneration = generation;
      try {
        const data = await readState(key, post.sourceUrl);
        if (cancelled || !isCurrent() || requestGeneration !== generation || typeof data.sourceLikedByMe !== 'boolean') return;
        if (expected !== undefined && data.sourceLikedByMe !== expected) return;
        expected = undefined;
        update.current(data);
      } catch { /* A failed background read must not undo a confirmed write. */ }
    };
    const changed = ({ detail }) => {
      if (detail?.source !== 'bluesky' || detail.postId !== post.id) return;
      generation++;
      if (typeof detail.sourceLikedByMe === 'boolean') expected = detail.sourceLikedByMe;
      reads.delete(key);
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
      for (const delay of [800, 2500, 6000, 15000, 30000]) {
        const timer = window.setTimeout(() => { timers.delete(timer); refresh(); }, delay);
        timers.add(timer);
      }
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener(POST_ENGAGEMENT_EVENT, changed);
    return () => {
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(POST_ENGAGEMENT_EVENT, changed);
    };
  }, [enabled, identity, isCurrent, post.id, post.source, post.sourceUrl]);
}
