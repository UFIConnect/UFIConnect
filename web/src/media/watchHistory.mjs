import { mediaHistoryKey } from './watchTime.mjs';

export const WATCH_RETENTION_MS = 30 * 86400000;
export const WATCH_MAX_RECORDS = 1000;
export const WATCH_STORE_PREFIX = 'ufi:playback:v1:';
export const WATCH_CHANGED = 'ufi-playback-history-changed';
const DAY_MS = 86400000;
const safeSource = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value) ? value : null;
const safeAccount = value => typeof value === 'string' && /^[a-zA-Z0-9_.:@-]{1,128}$/.test(value) ? value : null;
const safeSurface = value => ['videos', 'music', 'snaps'].includes(value) ? value : null;
const title = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160) : '';

export function createWatchHistoryStore({ storage, now = Date.now, notify = () => {} }) {
  const key = accountId => safeAccount(accountId) ? WATCH_STORE_PREFIX + encodeURIComponent(accountId) : null;
  function normalize(value) {
    const cutoff = now() - WATCH_RETENTION_MS;
    const records = Array.isArray(value?.records) ? value.records.filter(row => row && /^[a-f0-9]{16}$/.test(row.mediaKey || '')
      && /^\d{4}-\d{2}-\d{2}$/.test(row.day || '') && safeSource(row.source) && safeSource(row.hostSource) && safeSurface(row.surface)
      && Number.isFinite(row.lastWatchedAt) && row.lastWatchedAt >= cutoff && row.lastWatchedAt <= now()
      && Number.isFinite(row.watchMs) && row.watchMs > 0 && row.watchMs <= DAY_MS
      && Number.isInteger(row.sessions) && row.sessions >= 1 && row.sessions <= 100000)
      .map(row => ({ mediaKey: row.mediaKey, day: row.day, source: row.source, hostSource: row.hostSource,
        surface: row.surface, title: title(row.title), lastWatchedAt: row.lastWatchedAt, watchMs: row.watchMs, sessions: row.sessions }))
      .sort((a, b) => b.lastWatchedAt - a.lastWatchedAt).slice(0, WATCH_MAX_RECORDS) : [];
    return { version: 1, enabled: value?.enabled !== false, records };
  }
  function read(accountId) {
    const name = key(accountId);
    if (!name) return { version: 1, enabled: false, records: [], available: true };
    try {
      const raw = storage?.getItem(name);
      if (!storage) throw Error('Storage unavailable');
      if (raw && raw.length >= 700000) throw Error('Invalid playback storage');
      const parsed = raw ? JSON.parse(raw) : null;
      if (raw && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.version !== 1)) throw Error('Invalid playback storage');
      const value = normalize(parsed);
      // Purge expired/corrupt rows from storage as well as the rendered report.
      if (raw && JSON.stringify(value) !== raw) storage.setItem(name, JSON.stringify(value));
      return { ...value, available: true };
    } catch { return { version: 1, enabled: false, records: [], available: false }; }
  }
  function write(accountId, value, operation = 'append', mediaKey = null) {
    const name = key(accountId);
    if (!name) return false;
    try { storage.setItem(name, JSON.stringify(normalize(value))); notify(accountId, { operation, mediaKey }); return true; }
    catch { return false; }
  }
  function append(accountId, { mediaId, postId, source, hostSource, surface, mediaTitle, watchMs, newSession = false }) {
    if (!safeSource(source) || !safeSource(hostSource) || !safeSurface(surface) || !Number.isFinite(watchMs) || watchMs <= 0 || watchMs > 60000) return false;
    const value = read(accountId);
    if (!value.available || !value.enabled) return false;
    const timestamp = now(), day = new Date(timestamp).toISOString().slice(0, 10);
    const mediaKey = mediaHistoryKey(`${source}:${postId || ''}:${mediaId || ''}`);
    const existing = value.records.find(row => row.day === day && row.mediaKey === mediaKey && row.surface === surface && row.hostSource === hostSource);
    if (existing) {
      existing.watchMs = Math.min(DAY_MS, existing.watchMs + watchMs);
      if (newSession) existing.sessions = Math.min(100000, existing.sessions + 1);
      existing.lastWatchedAt = timestamp;
      if (title(mediaTitle)) existing.title = title(mediaTitle);
    } else value.records.unshift({ mediaKey, day, source, hostSource, surface, title: title(mediaTitle),
      lastWatchedAt: timestamp, watchMs, sessions: 1 });
    return write(accountId, value);
  }
  return { read, append,
    clear(accountId) { const value = read(accountId); return write(accountId, { ...value, records: [] }, 'clear'); },
    setEnabled(accountId, enabled) { const value = read(accountId); return write(accountId, { ...value, enabled: enabled === true }, enabled ? 'enable' : 'disable'); },
    remove(accountId, mediaKey) { const value = read(accountId); return write(accountId, { ...value, records: value.records.filter(row => row.mediaKey !== mediaKey) }, 'remove', mediaKey); },
  };
}

let browserStore;
export function watchHistoryStore() {
  if (!browserStore) {
    let storage; try { storage = globalThis.localStorage; } catch {}
    browserStore = createWatchHistoryStore({ storage, notify: (accountId, detail) => {
      globalThis.window?.dispatchEvent(new CustomEvent(WATCH_CHANGED, { detail: { accountId, ...detail } }));
    } });
  }
  return browserStore;
}

if (typeof window !== 'undefined') {
  // Signing out clears viewing details on a shared device; the user's disabled
  // recording preference survives so sign-in cannot silently re-enable it.
  window.addEventListener('ufi-session-cleared', () => {
    try {
      const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(name => name?.startsWith(WATCH_STORE_PREFIX));
      for (const name of keys) watchHistoryStore().clear(decodeURIComponent(name.slice(WATCH_STORE_PREFIX.length)));
    } catch {}
  });
}
