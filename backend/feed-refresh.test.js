const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createAppHarness, member } = require('./test-support/app-harness');

test('manual refresh crosses the API/Pipeline boundary with canonical selected sources', async t => {
  const app = await createAppHarness({ connected: true }); t.after(() => app.close());
  app.seedUser(member('refresh-member'));
  assert.equal((await app.request('/feed/refresh', { method: 'POST', body: {} })).status, 401);
  const result = await app.request('/feed/refresh', { userId: 'refresh-member', method: 'POST', body: { sources: ['hackernews', 'github', 'hackernews'] } });
  assert.equal(result.status, 202);
  assert.equal(result.data.queued, true);
  assert.deepEqual(result.data.sourceIds, ['hn', 'github']);
  assert.ok(result.data.requestedAt);
  assert.equal(result.data.refreshedAt, undefined, 'A queued collection is not already refreshed');
  const inserts = app.queries.filter(item => item.sql.includes('INSERT INTO feed_source_refresh_requests'));
  assert.equal(inserts.length, 1);
  assert.deepEqual(Array.from(inserts[0].params[0]), ['hn', 'github']);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
});

test('refresh rejects identity-only providers and reports storage outages truthfully', async t => {
  const app = await createAppHarness(); t.after(() => app.close());
  app.seedUser(member('refresh-member'));
  assert.equal((await app.request('/feed/refresh', { userId: 'refresh-member', method: 'POST', body: { sources: ['linkedin'] } })).status, 400);
  const result = await app.request('/feed/refresh', { userId: 'refresh-member', method: 'POST', body: {} });
  assert.equal(result.status, 503);
  assert.equal(result.data.queued, false);
});

test('native comment insert failures leave visible counts unchanged; confirmed writes await the counter', async t => {
  let fail = true;
  const app = await createAppHarness({ connected: true, query: async sql => {
    if (sql.includes('SELECT * FROM community_posts')) return { rows: [{ id: 'refresh-comment-post', source: 'uficonnect', content: 'Test post', author_id: 'refresh-member', author_name: 'Test member', comments_count: 5, created_at: new Date().toISOString() }] };
    if (sql.includes('INSERT INTO post_comments') && fail) throw new Error('write unavailable');
    if (sql.includes('UPDATE community_posts SET comments_count')) return { rows: [{ comments_count: 6 }] };
    return { rows: [] };
  } }); t.after(() => app.close());
  app.seedUser(member('refresh-member'));
  app.setContentScreening(async ({ content }) => ({ allowed: true, content }));
  const post = { id: 'refresh-comment-post', source: 'uficonnect', content: 'Test post', authorId: 'refresh-member', commentsCount: 5, createdAt: new Date().toISOString() };
  app.posts.push(post);
  const send = () => app.request('/posts/refresh-comment-post/comments', { userId: 'refresh-member', method: 'POST', body: { content: 'A confirmed reply' } });
  assert.equal((await send()).status, 500);
  assert.equal(app.posts.find(item => item.id === post.id).commentsCount, 5);
  fail = false;
  const result = await send();
  assert.equal(result.status, 201);
  assert.equal(result.data.commentsCount, 6);
  assert.equal(app.posts.find(item => item.id === post.id).commentsCount, 6);
});
