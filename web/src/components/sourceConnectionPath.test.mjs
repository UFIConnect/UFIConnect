import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceConnectionPath } from './sourceConnectionPath.mjs';

test('generic, federated and API-key sources retain their exact authorization intent', () => {
  for (const source of ['youtube', 'github', 'linkedin', 'bluesky', 'mastodon', 'devto', 'hashnode_blog']) {
    const url = new URL(sourceConnectionPath(source, { publishing: true, returnTo: 'command-center' }), 'https://uficonnect.org');
    assert.equal(url.pathname, '/connected-accounts');
    assert.deepEqual(Object.fromEntries(url.searchParams), { connect: source, publishing: '1', returnTo: 'command-center' });
    assert.equal(sourceConnectionPath(source), `/connected-accounts?connect=${source}`);
  }
});

test('connection paths reject unsafe provider names and never accept arbitrary return URLs or permission values', () => {
  for (const source of [undefined, '', '../youtube', 'youtube&publishing=1', 'https://evil.invalid', ' youtube', 'youtube#fragment']) {
    assert.equal(sourceConnectionPath(source, { publishing: true }), '/connected-accounts');
  }
  assert.equal(sourceConnectionPath('youtube', { publishing: 'true', returnTo: 'https://evil.invalid' }), '/connected-accounts?connect=youtube');
});
