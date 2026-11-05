const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./test-support/app-harness');

for (const action of ['like', 'comment']) test(`native ${action} persists the author's notification before confirming the write`, async t => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const inserting = new Promise(resolve => { started = resolve; });
  const stored = { id: 'native-delivery', source: 'uficonnect', author_id: 'bob', content: 'A community video update.',
    likes: [], comments_count: 0, created_at: new Date().toISOString() };
  const app = await createAppHarness({ connected: true, query: async (sql, params) => {
    if (sql.includes('FROM community_posts')) return { rows: [stored] };
    if (sql.includes('FROM users WHERE id')) return { rows: [{ id: params[0], name: 'Alice', billing_closed: false }] };
    if (sql.startsWith('UPDATE community_posts SET likes')) stored.likes = params[0];
    if (sql.includes('INSERT INTO notifications')) { started(); await gate; }
    return { rows: [] };
  } });
  t.after(() => { release(); return app.close(); });
  app.seedUser(member('alice')); app.seedUser(member('bob'));
  let resolved = false;
  const response = app.request(action === 'like' ? '/feed/native-delivery/like' : '/posts/native-delivery/comments', {
    userId: 'alice', method: 'POST', body: action === 'like' ? { liked: true } : { content: 'Thanks for the thoughtful update.' },
  }).then(result => { resolved = true; return result; });
  await inserting;
  assert.equal(resolved, false);
  release();
  assert.equal((await response).status, action === 'like' ? 200 : 201);
});

test('failed native comment writes never appear as cached comments or increment counts', async t => {
  const stored = { id: 'failed-comment', source: 'uficonnect', author_id: 'bob', content: 'A community update.',
    likes: [], comments_count: 0, created_at: new Date().toISOString() };
  const app = await createAppHarness({ connected: true, query: async sql => {
    if (sql.includes('FROM community_posts')) return { rows: [stored] };
    if (sql.includes('INSERT INTO post_comments')) throw new Error('Simulated storage failure');
    return { rows: [] };
  } });
  t.after(() => app.close());
  app.seedUser(member('alice')); app.seedUser(member('bob'));
  const failed = await app.request('/posts/failed-comment/comments', { userId: 'alice', method: 'POST', body: { content: 'A useful comment.' } });
  assert.equal(failed.status, 500);
  assert.equal(app.posts.find(post => post.id === stored.id).commentsCount, 0);
  const comments = await app.request('/posts/failed-comment/comments', { userId: 'alice' });
  assert.equal(comments.status, 200);
  assert.deepEqual(comments.data.comments, []);
  assert.equal(app.queries.some(query => query.sql.includes('INSERT INTO notifications')), false);
});
