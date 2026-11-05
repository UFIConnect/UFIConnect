import assert from 'node:assert/strict';
import test from 'node:test';
import { connectedFirstAccountEntries, connectedFirstSourceIds } from './sourceSelection.mjs';
import { accountSections } from './sourceDirectory.js';

test('connected destinations precede disconnected favorites while preserving each catalog order', () => {
  const ids = ['reddit', 'linkedin', 'bluesky', 'mastodon', 'twitter'];
  const connected = { bluesky: true, twitter: true, linkedin: false, reddit: 'true' };
  assert.deepEqual(connectedFirstSourceIds(ids, connected), ['bluesky', 'twitter', 'reddit', 'linkedin', 'mastodon']);
  assert.deepEqual(ids, ['reddit', 'linkedin', 'bluesky', 'mastodon', 'twitter']);
  assert.deepEqual(connectedFirstSourceIds(ids), ids);
});

test('account ordering keeps the original provider records and does not mutate the catalog', () => {
  const entries = [['reddit', { name: 'Reddit' }], ['bluesky', { name: 'Bluesky' }], ['mastodon', { name: 'Mastodon' }]];
  const ordered = connectedFirstAccountEntries(entries, { mastodon: true, bluesky: true });
  assert.deepEqual(ordered.map(([key]) => key), ['bluesky', 'mastodon', 'reddit']);
  assert.equal(ordered[0], entries[1]);
  assert.deepEqual(entries.map(([key]) => key), ['reddit', 'bluesky', 'mastodon']);
});

test('account categories show connected accounts before the curated provider ranking', () => {
  const entries = [['facebook', { name: 'Facebook' }], ['bluesky', { name: 'Bluesky' }], ['twitter', { name: 'X' }], ['youtube', { name: 'YouTube' }]];
  const groups = accountSections(entries, { connected: { bluesky: true, youtube: true } });
  assert.deepEqual(groups.find(group => group.id === 'social').items.map(([key]) => key), ['bluesky', 'facebook', 'twitter']);
  assert.deepEqual(groups.find(group => group.id === 'video').items.map(([key]) => key), ['youtube']);
  assert.equal(groups.find(group => group.id === 'social').total, 3);
});
