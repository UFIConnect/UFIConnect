'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { rssAuthorIdentity } = require('./rss-author-identity');
const { createFeedAudit } = require('./feed-audit');
const audit = () => createFeedAudit({ isConnected: () => false }, { now: () => 1000000, schedule: () => null });
const post = (id, author) => ({ id: `medium_${id}`, source: 'medium', title: `Distinct engineering article ${id}`,
  content: `Detailed project ${id} describes its separate results and implementation.`,
  sourceUrl: `https://medium.com/story-${id}`, author: { id: rssAuthorIdentity({ author }, 'medium'), name: author || '' } });

test('RSS names have stable provider-scoped identities across case, whitespace and Unicode formatting', () => {
  const identity = rssAuthorIdentity({ author: 'Alice Example' }, 'medium');
  assert.equal(rssAuthorIdentity({ author: '  ALICE\n  Example\t' }, ' Medium '), identity);
  assert.equal(rssAuthorIdentity({ author: 'Ａlice Example' }, 'medium'), identity);
  assert.notEqual(rssAuthorIdentity({ author: 'Bob Example' }, 'medium'), identity);
  assert.notEqual(rssAuthorIdentity({ author: 'Alice Example' }, 'devto'), identity);
  assert.equal(rssAuthorIdentity({ author: 'Alice' }, 'hn'), rssAuthorIdentity({ author: 'Alice' }, 'hackernews'));
  assert.equal(identity.includes('alice'), false);
});

test('missing or invalid RSS authors do not fabricate a source-wide author identity', () => {
  for (const author of [undefined, null, '', ' \n\u0000\t', {}, 42]) assert.equal(rssAuthorIdentity({ author }, 'medium'), null);
  assert.equal(rssAuthorIdentity(null, 'medium'), null);
  assert.equal(rssAuthorIdentity({ author: 'Alice' }, ''), null);
});

test('26 different RSS writers are admitted while the same writer is still held on the 26th post', () => {
  const differentWriters = audit();
  for (let id = 1; id <= 26; id++) assert.equal(differentWriters.admit(post(id, `Writer ${id}`)).allowed, true);
  const sameWriter = audit();
  for (let id = 1; id <= 25; id++) assert.equal(sameWriter.admit(post(id, 'One Writer')).allowed, true);
  assert.deepEqual(sameWriter.admit(post(26, ' ONE  WRITER ')), { allowed: false, reason: 'author_flood', retryAt: 1060000 });
});

test('unattributed RSS posts remain subject to the source flood cap', () => {
  const instance = audit();
  for (let id = 1; id <= 300; id++) assert.equal(instance.admit(post(id)).allowed, true);
  assert.deepEqual(instance.admit(post(301)), { allowed: false, reason: 'source_flood', retryAt: 1060000 });
});
