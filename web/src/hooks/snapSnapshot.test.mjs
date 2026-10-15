import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSnapSnapshots, saveSnapSnapshot, readSnapSnapshot, mergeSnapRefresh } from './snapSnapshot.mjs';
const now = 1_800_000_000_000;
const snap = (id, source = 'mastodon', expires = now + 60_000) => ({ id, source, expiresAt: new Date(expires).toISOString() });
test('transient source failure retains loaded snaps, authoritative empty removes them', () => {
  const old = [snap('a'), snap('b', 'youtube'), snap('expired', 'mastodon', now - 1)];
  assert.deepEqual(mergeSnapRefresh(old, [], { mastodon: 'Temporarily unavailable' }, null, now), [old[0]]);
  assert.deepEqual(mergeSnapRefresh(old, [], {}, 'mastodon', now), [old[1]]);
  assert.deepEqual(mergeSnapRefresh(old, [], { mastodon: 'Reconnect Mastodon' }, null, now), []);
  assert.deepEqual(mergeSnapRefresh(old, [snap('a')], { mastodon: 'Temporarily unavailable' }, null, now), [old[0]]);
});
test('navigation cache is account scoped, bounded by time and cleared on session changes', () => {
  clearSnapSnapshots();
  saveSnapSnapshot({ identity: 'a:home', snaps: [snap('a')], loading: false }, now);
  assert.equal(readSnapSnapshot('b:home', now), null);
  assert.equal(readSnapSnapshot('a:home', now).snaps.length, 1);
  saveSnapSnapshot({ identity: 'a:following', snaps: [snap('following')], loading: false }, now);
  assert.equal(readSnapSnapshot('a:following', now).snaps[0].id, 'following');
  assert.equal(readSnapSnapshot('a:home', now).snaps[0].id, 'a');
  assert.equal(readSnapSnapshot('a:home', now + 60_001).snaps.length, 0);
  assert.equal(readSnapSnapshot('a:home', now + 120_001), null);
  clearSnapSnapshots();
  assert.equal(readSnapSnapshot('a:home', now), null);
});
