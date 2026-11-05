import test from 'node:test';
import assert from 'node:assert/strict';
import { apiKeyConnectionSetup, publishingRecoveryPath } from './apiKeyConnection.mjs';
import { SOURCE_META, HOME_FEED_SOURCE_IDS, FOLLOWING_FEED_SOURCE_IDS } from './sourceMeta.js';
import { draftPublishingSource } from '../utils/publishingDraft.mjs';

test('Hashnode publication and the legacy freeCodeCamp feed keep distinct identities', () => {
  assert.equal(SOURCE_META.hashnode.label, 'freeCodeCamp');
  assert.equal(SOURCE_META.hashnode_blog.label, 'Hashnode');
  assert.equal(draftPublishingSource('hashnode'), 'hashnode_blog');
  assert.equal(draftPublishingSource('devto'), 'devto');
  assert.equal(draftPublishingSource('general'), null);
  assert.equal(HOME_FEED_SOURCE_IDS.includes('hashnode_blog'), false);
  assert.equal(FOLLOWING_FEED_SOURCE_IDS.includes('hashnode_blog'), false);
});

test('private API-key setup uses provider-specific labels and exact vetted links', () => {
  assert.equal(apiKeyConnectionSetup('devto').label, 'DEV API key');
  assert.equal(apiKeyConnectionSetup('hashnode_blog').label, 'Hashnode personal access token');
  for (const apiKeySetupUrl of ['https://evil.invalid/token', 'javascript:alert(1)', 'https://hashnode.com/settings/developer?redirect=evil']) {
    assert.equal(apiKeyConnectionSetup('hashnode_blog', { apiKeySetupUrl }).setupUrl, 'https://hashnode.com/settings/developer');
  }
  assert.equal(apiKeyConnectionSetup('hashnode_blog', { apiKeyDescription: 'Requires publication access.' }).description, 'Requires publication access.');
  assert.equal(apiKeyConnectionSetup('unsupported'), null);
});

test('key and federated connections recover through their existing account setup flows', () => {
  for (const source of ['devto', 'hashnode_blog', 'bluesky', 'mastodon']) {
    const recovery = new URL(publishingRecoveryPath(source), 'https://uficonnect.org');
    assert.equal(recovery.pathname, '/connected-accounts');
    assert.equal(recovery.searchParams.get('connect'), source);
    assert.equal(recovery.searchParams.get('publishing'), '1');
    assert.equal(recovery.searchParams.get('returnTo'), 'command-center');
  }
  assert.equal(publishingRecoveryPath('github'), null);
  assert.equal(publishingRecoveryPath('youtube'), null);
});
