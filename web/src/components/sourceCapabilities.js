import { useCallback, useSyncExternalStore } from 'react';
import client from '../api/client';
import { getAccessToken, subscribeToSession } from '../auth/session';
import { useAuth } from '../contexts/AuthContext';

const REFRESH_MS = 60_000;
let store;

function createStore(memberId, token) {
  const subscribers = new Set();
  let sources = new Map();
  let request = null;
  let expiresAt = 0;
  let timer;

  function publish(next) {
    sources = next;
    subscribers.forEach(notify => notify());
  }

  function refresh() {
    if (!subscribers.size || document.hidden || request || Date.now() < expiresAt || getAccessToken() !== token) return;
    const controller = new AbortController();
    request = controller;
    expiresAt = Date.now() + REFRESH_MS;
    client.get('/social/interaction-capabilities', { signal: controller.signal }).then(({ data }) => {
      if (request !== controller || getAccessToken() !== token) return;
      const next = new Map();
      for (const [source, value] of Object.entries(data.sources || {})) {
        if (!value || typeof value !== 'object') continue;
        const previous = sources.get(source);
        const keys = Object.keys(value);
        const unchanged = previous && keys.length === Object.keys(previous).length
          && keys.every(key => Object.hasOwn(previous, key) && previous[key] === value[key]);
        next.set(source, unchanged ? previous : value);
      }
      publish(next);
    }).catch(() => {
      if (request !== controller) return;
      expiresAt = 0;
      publish(new Map());
    }).finally(() => {
      if (request === controller) request = null;
    });
  }

  function stop() {
    window.clearInterval(timer);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
  }

  function invalidate() {
    request?.abort();
    request = null;
    expiresAt = 0;
    publish(new Map());
  }

  return {
    memberId, token, refresh, invalidate,
    snapshot: source => sources.get(source) || null,
    subscribe(notify) {
      subscribers.add(notify);
      if (subscribers.size === 1) {
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);
        timer = window.setInterval(refresh, REFRESH_MS);
        refresh();
      }
      return () => {
        subscribers.delete(notify);
        if (!subscribers.size) stop();
      };
    },
    dispose() {
      stop();
      invalidate();
      subscribers.clear();
    },
  };
}

if (typeof window !== 'undefined') {
  subscribeToSession(token => {
    if (store && store.token !== token) {
      store.dispose();
      store = undefined;
    }
  });
  window.addEventListener('ufi-session-cleared', () => {
    store?.invalidate();
    // A session clear can be followed immediately by a new sign-in.
    queueMicrotask(() => store?.refresh());
  });
  window.addEventListener('ufi-connections-changed', () => {
    store?.invalidate();
    store?.refresh();
  });
}

const noSubscription = () => {};
const serverSnapshot = () => null;

export function useSourceCapability(post) {
  const { profile, token } = useAuth();
  const memberId = profile?.id;
  const source = post?.source;
  const eligible = Boolean(memberId && token && source);
  const subscribe = useCallback(notify => {
    if (!eligible || getAccessToken() !== token) return noSubscription;
    if (store?.memberId !== memberId || store?.token !== token) {
      store?.dispose();
      store = createStore(memberId, token);
    }
    return store.subscribe(notify);
  }, [eligible, memberId, token]);
  const snapshot = () => eligible && store?.memberId === memberId && store.token === token
    ? store.snapshot(source) : null;
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
