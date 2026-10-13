'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { hydratePostLikes } = require('./post-likes');
const { createReportVisibilityFilter } = require('./content-reports');
const { createNativePostVisibilityFilter } = require('./community-post-visibility');

// Exercise the production response boundary with the real permission and
// likes readers, independently of ingestion/startup jobs and external APIs.
const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const start = source.indexOf('async function sendFeedResponse(req, res, payload) {');
const end = source.indexOf('\nasync function canSeePostLikes(', start);
assert.ok(start >= 0 && end > start);
function sender(db) {
  return vm.runInNewContext(source.slice(start, end) + '\nsendFeedResponse;', {
    db, users: [], hydratePostLikes,
    visibleReportContent: createReportVisibilityFilter({ db }),
    visibleNativeGroupContent: createNativePostVisibilityFilter({ db }),
    hydrateCachedMemberAuthors: async () => {},
    sanitizeUser: user => user,
    publicFeedLocationContext: context => context,
  });
}
function response() {
  return { statusCode: 200, headers: {}, set(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
}
const fixtures = () => [
  { id: 'public-native', source: 'uficonnect', groupId: 'public-group', content: 'Public community post', commentsCount: 3 },
  { id: 'private-native', source: 'uficonnect', groupId: 'private-group', content: 'Private community post' },
  { id: 'public-external', source: 'reddit', sourceUrl: 'https://example.invalid/public', likesCount: 90, mediaUrl: '/public-photo.png' },
  { id: 'removed-external', source: 'reddit', sourceUrl: 'https://example.invalid/removed', content: 'Removed post' },
  { id: 'restaurant', source: 'restaurants', content: 'Public restaurant' },
];
function resultFor(sql, params, count = 5, liked = true) {
  if (sql.includes('FROM report_content_suppressions')) return { rows: [{ target_id: 'removed-external' }] };
  if (sql.includes('FROM UNNEST')) return { rows: [{ group_id: 'public-group' }] };
  return { rows: params[0].map(id => ({ post_id: id, likes_count: count, liked_by_me: liked })) };
}

test('a mixed response runs independent checks together and intersects permissions before emitting', async () => {
  const pending = [];
  const db = { isConnected: () => true, query: (sql, params) => new Promise(resolve => pending.push({ sql, params, resolve })) };
  const send = sender(db);
  const posts = fixtures();
  const res = response();
  const work = send({ user: { id: 'viewer' } }, res, { posts, liveFeeds: [posts[1], posts[4]], post: posts[2], hasMore: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 5, 'Moderation, group access, and all three like tables start without serial waits');
  assert.equal(res.body, undefined, 'No content is emitted while checks are pending');
  for (const task of pending) task.resolve(resultFor(task.sql, task.params));
  await work;
  assert.deepEqual(Array.from(res.body.posts, post => post.id), ['public-native', 'public-external', 'restaurant']);
  assert.deepEqual(Array.from(res.body.liveFeeds, post => post.id), ['restaurant']);
  assert.equal(res.body.post.id, 'public-external');
  assert.equal(res.body.post.likesCount, 5);
  assert.equal(res.body.post.likedByMe, true);
  assert.equal(res.body.post.sourceLikesCount, 90);
  assert.equal(res.body.post.mediaUrl, '/public-photo.png');
  assert.equal(res.body.posts[0].commentsCount, 3);
  assert.equal(res.body.hasMore, true);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.equal(posts[2].likesCount, 90, 'Shared feed objects never receive viewer-specific mutations');
});

test('repeated reads hydrate current likes without caching another viewer state', async () => {
  let count = 5, liked = true, reads = 0;
  const db = { isConnected: () => true, query: async (sql, params) => { reads++; return resultFor(sql, params, count, liked); } };
  const send = sender(db);
  const post = fixtures()[2];
  const first = response();
  await send({ user: { id: 'viewer-a' } }, first, { posts: [post] });
  count = 12; liked = false;
  const second = response();
  await send({ user: { id: 'viewer-b' } }, second, { posts: [post] });
  assert.equal(first.body.posts[0].likesCount, 5);
  assert.equal(first.body.posts[0].likedByMe, true);
  assert.equal(second.body.posts[0].likesCount, 12);
  assert.equal(second.body.posts[0].likedByMe, false);
  assert.equal(second.body.posts[0].sourceLikesCount, 90);
  assert.equal(reads, 4, 'Every response rechecks moderation and current likes');
});

test('failed moderation or group checks emit no response, and denied details return 404', async () => {
  for (const failure of ['FROM report_content_suppressions', 'FROM UNNEST']) {
    const db = { isConnected: () => true, query: async (sql, params) => {
      if (sql.includes(failure)) throw new Error('Synthetic permission lookup unavailable');
      return resultFor(sql, params);
    } };
    const res = response();
    await assert.rejects(sender(db)({ user: { id: 'viewer' } }, res, { posts: fixtures() }), /unavailable/);
    assert.equal(res.body, undefined, failure + ' must fail closed');
  }
  const db = { isConnected: () => true, query: async (sql, params) => resultFor(sql, params) };
  for (const post of [fixtures()[1], fixtures()[3]]) {
    const res = response();
    await sender(db)({}, res, { post });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.message, 'Post not found.');
    assert.equal(res.body.post, undefined);
  }
});
