import test from 'node:test';
import assert from 'node:assert/strict';
import { createWatchHistoryStore, WATCH_MAX_RECORDS, WATCH_RETENTION_MS, WATCH_STORE_PREFIX } from './watchHistory.mjs';

const DAY = 86400000;
const makeStorage = () => {
  const data = new Map();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};
const sample = (extra = {}) => ({ mediaId: 'video-one', postId: 'post-one', source: 'youtube', hostSource: 'reddit', surface: 'videos',
  mediaTitle: 'A video', watchMs: 5000, newSession: true, ...extra });
const storeKey = accountId => WATCH_STORE_PREFIX + encodeURIComponent(accountId);

test('history records app time per actual player source, surface and account', () => {
  const storage = makeStorage(), notifications = [];
  const store = createWatchHistoryStore({ storage, now: () => Date.UTC(2026, 9, 11, 12), notify: id => notifications.push(id) });
  assert.equal(store.append('account-a', sample()), true);
  assert.equal(store.append('account-a', sample({ watchMs: 1000, newSession: false })), true);
  assert.equal(store.append('account-a', sample({ surface: 'music', watchMs: 2000 })), true);
  const rows = store.read('account-a').records;
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.surface === 'videos').watchMs, 6000);
  assert.equal(rows.find(row => row.surface === 'videos').sessions, 1);
  assert.equal(rows[0].source, 'youtube');
  assert.equal(rows[0].hostSource, 'reddit', 'Distribution source is distinct from the playing source');
  assert.deepEqual(store.read('account-b').records, []);
  assert.ok(notifications.every(value => value === 'account-a'));
});

test('continuing a session does not increment it and a new session does', () => {
  const store = createWatchHistoryStore({ storage: makeStorage(), now: () => Date.UTC(2026, 9, 11) });
  for (const newSession of [true, false, false, true, false]) store.append('a', sample({ newSession }));
  assert.equal(store.read('a').records[0].sessions, 2);
  assert.equal(store.read('a').records[0].watchMs, 25000);
});

test('signed media URLs and post identifiers do not enter serialized history', () => {
  const storage = makeStorage(), store = createWatchHistoryStore({ storage });
  const mediaId = 'https://cdn.example.invalid/movie.mp4?token=secret-media-token&signature=private-sentinel';
  const postId = 'source-post-private-sentinel';
  store.append('a', sample({ mediaId, postId, mediaTitle: 'Safe visible title', accessToken: 'never-persist-this', originalUrl: mediaId }));
  const raw = storage.getItem(storeKey('a'));
  for (const value of [mediaId, postId, 'cdn.example.invalid', 'secret-media-token', 'private-sentinel', 'never-persist-this']) assert.equal(raw.includes(value), false);
  assert.match(store.read('a').records[0].mediaKey, /^[a-f0-9]{16}$/);
  assert.equal(store.read('a').records[0].title, 'Safe visible title');
});

test('thirty-day retention removes expired rows from disk as well as the report', () => {
  let now = Date.UTC(2026, 8, 11, 12);
  const storage = makeStorage(), store = createWatchHistoryStore({ storage, now: () => now });
  store.append('a', sample({ mediaTitle: 'Expired row sentinel' }));
  now += WATCH_RETENTION_MS - 1;
  assert.equal(store.read('a').records.length, 1);
  store.append('a', sample({ mediaId: 'recent', mediaTitle: 'Recent row' }));
  now += 2;
  assert.equal(store.read('a').records.length, 1);
  assert.equal(store.read('a').records[0].title, 'Recent row');
  assert.equal(storage.getItem(storeKey('a')).includes('Expired row sentinel'), false);
});

test('day boundaries create distinct rows and account removal does not affect another account', () => {
  let now = Date.UTC(2026, 9, 10, 23, 59, 59);
  const store = createWatchHistoryStore({ storage: makeStorage(), now: () => now });
  store.append('a', sample()); store.append('b', sample());
  now += 2000; store.append('a', sample());
  assert.deepEqual(store.read('a').records.map(row => row.day), ['2026-10-11', '2026-10-10']);
  assert.equal(store.remove('a', store.read('a').records[0].mediaKey), true);
  assert.deepEqual(store.read('a').records, [], 'Remove forgets all days of this media');
  assert.equal(store.read('b').records.length, 1);
});

test('disable and clear preserve opt-out while re-enable allows later playback', () => {
  const store = createWatchHistoryStore({ storage: makeStorage() });
  store.append('a', sample());
  assert.equal(store.setEnabled('a', false), true);
  assert.equal(store.append('a', sample()), false);
  assert.equal(store.read('a').records[0].watchMs, 5000);
  assert.equal(store.clear('a'), true);
  assert.deepEqual(store.read('a').records, []);
  assert.equal(store.read('a').enabled, false);
  assert.equal(store.setEnabled('a', 'true'), true);
  assert.equal(store.read('a').enabled, false, 'Only a real boolean opt-in enables recording');
  assert.equal(store.setEnabled('a', true), true);
  assert.equal(store.append('a', sample()), true);
});

test('history caps records by recency and per-day totals without unbounded growth', () => {
  let now = Date.UTC(2026, 9, 11);
  const storage = makeStorage(), store = createWatchHistoryStore({ storage, now: () => now });
  for (let i = 0; i <= WATCH_MAX_RECORDS; i++) { now += 1; store.append('a', sample({ mediaId: `video-${i}`, mediaTitle: `Video ${i}` })); }
  const rows = store.read('a').records;
  assert.equal(rows.length, WATCH_MAX_RECORDS);
  assert.equal(rows[0].title, `Video ${WATCH_MAX_RECORDS}`);
  assert.ok(rows.every(row => row.title !== 'Video 0'));
  const raw = JSON.parse(storage.getItem(storeKey('a')));
  raw.records[0].watchMs = DAY - 1000;
  storage.setItem(storeKey('a'), JSON.stringify(raw));
  assert.equal(store.append('a', sample({ mediaId: `video-${WATCH_MAX_RECORDS}`, watchMs: 2000 })), true);
  assert.equal(store.read('a').records[0].watchMs, DAY);
});

test('invalid inputs fail closed without creating a history account', () => {
  const storage = makeStorage(), store = createWatchHistoryStore({ storage });
  for (const watchMs of [0, -1, NaN, Infinity, 60001, '100']) assert.equal(store.append('a', sample({ watchMs })), false);
  for (const source of ['', null, 'https://youtube.com', '<script>', 'source with space']) assert.equal(store.append('a', sample({ source })), false);
  for (const surface of ['feed', '', null, 'MUSIC']) assert.equal(store.append('a', sample({ surface })), false);
  for (const account of ['', null, '/private/path', 'a'.repeat(129)]) assert.equal(store.append(account, sample()), false);
  assert.equal(storage.data.size, 0);
  assert.equal(store.read(null).enabled, false);
});

test('stored records reject impossible values and strip unrelated fields', () => {
  const now = Date.UTC(2026, 9, 11), storage = makeStorage(), store = createWatchHistoryStore({ storage, now: () => now });
  store.append('a', sample());
  const original = store.read('a').records[0];
  storage.setItem(storeKey('a'), JSON.stringify({ version: 1, enabled: false, records: [
    { ...original, watchMs: 0 }, { ...original, watchMs: DAY + 1 }, { ...original, lastWatchedAt: now + 1 },
    { ...original, mediaKey: 'raw-private-url' }, { ...original, sessions: 0 },
    { ...original, extraToken: 'private-stored-sentinel', title: 'A\u0000\nvideo' },
  ], extraToken: 'private-top-level-sentinel' }));
  const value = store.read('a');
  assert.equal(value.records.length, 1);
  assert.equal(value.enabled, false);
  assert.equal(value.records[0].title, 'A  video');
  assert.equal(storage.getItem(storeKey('a')).includes('sentinel'), false);
});

test('unavailable and malformed storage cannot silently enable recording', () => {
  const unavailable = createWatchHistoryStore({ storage: undefined });
  assert.equal(unavailable.read('a').available, false);
  assert.equal(unavailable.read('a').enabled, false);
  assert.equal(unavailable.append('a', sample()), false);
  const storage = makeStorage(); storage.setItem(storeKey('a'), '{invalid JSON');
  const corrupt = createWatchHistoryStore({ storage });
  assert.equal(corrupt.read('a').available, false);
  assert.equal(corrupt.read('a').enabled, false);
  assert.equal(corrupt.append('a', sample()), false);
  const blocked = createWatchHistoryStore({ storage: { getItem() { return null; }, setItem() { throw Error('Quota exhausted'); } } });
  assert.equal(blocked.append('a', sample()), false);
});

test('oversized stored preferences do not silently turn recording back on', () => {
  const storage = makeStorage();
  storage.setItem(storeKey('a'), JSON.stringify({ version: 1, enabled: false, records: [], padding: 'x'.repeat(700000) }));
  const store = createWatchHistoryStore({ storage });
  assert.equal(store.read('a').enabled, false);
  assert.equal(store.append('a', sample()), false);
});

test('unrecognized storage schemas fail closed without replacing saved preferences', () => {
  for (const value of [{ version: 2, enabled: true, records: [] }, { enabled: true, records: [] }, [], null, true]) {
    const storage = makeStorage(), raw = JSON.stringify(value);
    storage.setItem(storeKey('a'), raw);
    const store = createWatchHistoryStore({ storage });
    assert.equal(store.read('a').enabled, false);
    assert.equal(store.read('a').available, false);
    assert.equal(store.append('a', sample()), false);
    assert.equal(storage.getItem(storeKey('a')), raw, 'Do not replace unknown stored preferences with enabled defaults');
  }
});
