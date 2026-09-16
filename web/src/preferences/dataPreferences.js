export const DATA_PREFERENCES_KEY = 'uficonnect.data-preferences.v1';
export const DEFAULT_DATA_PREFERENCES = Object.freeze({ dataSaver: false, autoplayPreviews: true, performanceInsights: false });

export function normalizeDataPreferences(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.freeze(Object.fromEntries(Object.entries(DEFAULT_DATA_PREFERENCES)
    .map(([key, fallback]) => [key, typeof source[key] === 'boolean' ? source[key] : fallback])));
}

export function createDataPreferencesStore({ storage, eventTarget } = {}) {
  let persistenceError = null;
  function read() {
    try {
      const next = normalizeDataPreferences(JSON.parse(storage?.getItem(DATA_PREFERENCES_KEY)));
      if (next.performanceInsights) {
        try { storage.setItem(DATA_PREFERENCES_KEY, JSON.stringify(next)); }
        catch {
          persistenceError = 'Optional diagnostics are off because this browser cannot save changes to your choice.';
          return normalizeDataPreferences({ ...next, performanceInsights: false });
        }
      }
      return next;
    }
    catch { return DEFAULT_DATA_PREFERENCES; }
  }
  let current = read();
  const listeners = new Set();
  function publish(next) {
    if (Object.keys(DEFAULT_DATA_PREFERENCES).every(key => current[key] === next[key])) return false;
    current = next;
    listeners.forEach(listener => listener());
    return true;
  }
  const onStorage = event => { if (event.key === DATA_PREFERENCES_KEY || event.key === null) publish(read()); };
  eventTarget?.addEventListener('storage', onStorage);
  return Object.freeze({
    get: () => current,
    getPersistenceError: () => persistenceError,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    set(patch) {
      const next = normalizeDataPreferences({ ...current, ...patch });
      const previousError = persistenceError;
      try {
        if (!storage) throw new Error('Storage unavailable');
        storage.setItem(DATA_PREFERENCES_KEY, JSON.stringify(next));
        persistenceError = null;
      } catch {
        // If writing an opt-out fails (for example, storage is full), try to
        // remove a previously saved opt-in so reloading falls back to off.
        if (!next.performanceInsights) { try { storage?.removeItem(DATA_PREFERENCES_KEY); } catch {} }
        persistenceError = 'Your changes apply now, but this browser could not save them. Check these choices again after reloading.';
      }
      if (!publish(next) && previousError !== persistenceError) listeners.forEach(listener => listener());
      return next;
    },
    dispose() { listeners.clear(); eventTarget?.removeEventListener('storage', onStorage); },
  });
}

let browserStore;
function store() {
  if (!browserStore) {
    let storage;
    try { storage = typeof window !== 'undefined' ? window.localStorage : null; } catch {}
    browserStore = createDataPreferencesStore({ storage, eventTarget: typeof window !== 'undefined' ? window : null });
  }
  return browserStore;
}
export function getDataPreferences() { return store().get(); }
export function subscribeDataPreferences(listener) { return store().subscribe(listener); }
export const subscribe = subscribeDataPreferences;
export function setDataPreferences(patch) { return store().set(patch); }
export function getDataPreferencesPersistenceError() { return store().getPersistenceError(); }
export function previewPlaybackAllowed(preferences) { return preferences.autoplayPreviews && !preferences.dataSaver; }
