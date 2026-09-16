import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA_PREFERENCES_KEY, DEFAULT_DATA_PREFERENCES, normalizeDataPreferences,
  createDataPreferencesStore, previewPlaybackAllowed } from '../web/src/preferences/dataPreferences.js';

function fixture(initial) {
  const entries = new Map(initial ? [[DATA_PREFERENCES_KEY, JSON.stringify(initial)]] : []);
  const events = new Map();
  const storage = { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) };
  const eventTarget = { addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) };
  return { store: createDataPreferencesStore({ storage, eventTarget }), entries, events };
}

test('data preferences default to no optional diagnostics and persist only known boolean choices', () => {
  assert.deepEqual(normalizeDataPreferences(null), DEFAULT_DATA_PREFERENCES);
  assert.deepEqual(normalizeDataPreferences({ dataSaver: 'true', autoplayPreviews: 0, performanceInsights: 'yes', password: 'private' }), DEFAULT_DATA_PREFERENCES);
  const { store, entries } = fixture();
  store.set({ dataSaver: true, password: 'private', performanceInsights: true });
  assert.deepEqual(JSON.parse(entries.get(DATA_PREFERENCES_KEY)), { dataSaver: true, autoplayPreviews: true, performanceInsights: true });
  assert.ok(!entries.get(DATA_PREFERENCES_KEY).includes('private'));
});

test('choices apply synchronously, survive reload and update across browser tabs', () => {
  const { store, entries, events } = fixture();
  let changes = 0;
  const unsubscribe = store.subscribe(() => { changes++; });
  store.set({ autoplayPreviews: false });
  assert.equal(changes, 1);
  assert.equal(store.get().autoplayPreviews, false);
  assert.equal(fixture(JSON.parse(entries.get(DATA_PREFERENCES_KEY))).store.get().autoplayPreviews, false);
  entries.set(DATA_PREFERENCES_KEY, JSON.stringify({ performanceInsights: true }));
  events.get('storage')({ key: DATA_PREFERENCES_KEY });
  assert.equal(store.get().performanceInsights, true);
  entries.clear();
  events.get('storage')({ key: null });
  assert.deepEqual(store.get(), DEFAULT_DATA_PREFERENCES);
  unsubscribe();
  store.dispose();
  assert.equal(events.size, 0);
});

test('data saver overrides automatic preview playback without overwriting the saved autoplay choice', () => {
  const { store } = fixture();
  assert.equal(previewPlaybackAllowed(store.get()), true);
  store.set({ dataSaver: true });
  assert.equal(previewPlaybackAllowed(store.get()), false);
  assert.equal(store.get().autoplayPreviews, true);
  store.set({ dataSaver: false });
  assert.equal(previewPlaybackAllowed(store.get()), true);
  store.set({ autoplayPreviews: false });
  assert.equal(previewPlaybackAllowed(store.get()), false);
});

test('blocked or malformed browser storage fails to privacy-preserving defaults while controls remain usable', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  const store = createDataPreferencesStore({ storage: blocked });
  assert.equal(store.get().performanceInsights, false);
  store.set({ dataSaver: true });
  assert.equal(store.get().dataSaver, true);
  assert.match(store.getPersistenceError(), /could not save/);
  assert.equal(createDataPreferencesStore({ storage: { getItem: () => '{invalid' } }).get().performanceInsights, false);
});

test('a failed opt-out write removes the old saved opt-in when storage removal is available', () => {
  let saved = JSON.stringify({ performanceInsights: true });
  let blocked = false;
  const storage = { getItem: () => saved, setItem(_key, value) { if (blocked) throw Error('quota exceeded'); saved = value; }, removeItem() { saved = null; } };
  const store = createDataPreferencesStore({ storage });
  assert.equal(store.get().performanceInsights, true);
  blocked = true;
  store.set({ performanceInsights: false });
  assert.equal(store.get().performanceInsights, false);
  assert.match(store.getPersistenceError(), /could not save/);
  assert.equal(createDataPreferencesStore({ storage }).get().performanceInsights, false);
});

test('a readable stale diagnostic opt-in is ignored when the browser cannot save or remove choices', () => {
  const storage = { getItem: () => JSON.stringify({ performanceInsights: true, dataSaver: true }),
    setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  const store = createDataPreferencesStore({ storage });
  assert.equal(store.get().performanceInsights, false);
  assert.equal(store.get().dataSaver, true);
  assert.match(store.getPersistenceError(), /diagnostics are off/);
});
