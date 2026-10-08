import test from 'node:test';
import assert from 'node:assert/strict';
import { importedAppActions, sourceForVaultEntry } from '../web/src/vault/sourceApps.mjs';
test('imports identify official source domains while refusing lookalikes and shared sign-in domains', () => {
  assert.equal(sourceForVaultEntry({ name: 'My code', url: 'https://github.com/login' }, { github: { name: 'GitHub', loginUrl: 'https://github.com/login' } }), 'github');
  assert.equal(sourceForVaultEntry({ url: 'https://www.youtube.com/' }, { youtube: { name: 'YouTube', loginUrl: 'https://accounts.google.com/' } }), 'youtube');
  assert.equal(sourceForVaultEntry({ url: 'https://secure.indeed.com/account/login' }), 'indeed');
  assert.equal(sourceForVaultEntry({ url: 'https://social.example/@alice' }, { mastodon: { siteUrl: 'https://social.example/' } }), 'mastodon');
  for (const url of ['https://github.com.evil.example/login', 'https://evilgithub.com', 'https://accounts.google.com', 'javascript:alert(1)']) assert.equal(sourceForVaultEntry({ name: 'Private account', url }), '');
  assert.equal(sourceForVaultEntry({ name: 'GitHub' }), 'github');
});
test('imported Netflix and social apps have practical destinations and preserve membership routes', () => {
  const entry = { name: 'Netflix', url: 'https://www.netflix.com/login' };
  assert.equal(sourceForVaultEntry(entry), 'netflix');
  assert.deepEqual(importedAppActions(entry, 'netflix').map(row => [row.label, row.url]), [['Watch Netflix', 'https://www.netflix.com/browse'], ['My List', 'https://www.netflix.com/browse/my-list']]);
  const mastodon = importedAppActions({ url: 'https://mastodon.social' }, 'mastodon', { name: 'Mastodon', ownContent: { supported: true } }, true);
  assert.equal(mastodon[0].to, '/?feed=following&source=mastodon');
  assert.equal(importedAppActions({}, 'linkedin', { crossPost: { supported: true } }, true, true)[0].to, '/career-posts');
  assert.ok(!importedAppActions({}, 'linkedin', {}, false).some(row => row.to));
});
