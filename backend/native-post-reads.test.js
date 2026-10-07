const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./test-support/app-harness');

test('native post reads use persisted edits and removals instead of another worker cache', async t => {
  let stored = { id: 'p_edited', author_id: 'post-owner', source: 'uficonnect', content: 'Edited on another worker', created_at: new Date().toISOString(), likes: [], comments_count: 0 };
  const app = await createAppHarness({ connected: true, query: async sql => ({ rows: /FROM community_posts/.test(sql) && stored ? [stored] : [], rowCount: 0 }) });
  t.after(() => app.close());
  app.seedUser(member('post-owner'));
  const old = { id: 'p_edited', authorId: 'post-owner', source: 'uficonnect', content: 'Stale cached text', createdAt: stored.created_at, likes: [] };
  app.posts.push(old);
  let response = await app.request('/feed/p_edited');
  assert.equal(response.status, 200);
  assert.equal(response.data.post.content, stored.content);
  app.posts.splice(0, app.posts.length, old);
  let page = await app.getCommunityPosts({ authorId: 'post-owner', viewerId: 'post-owner' });
  assert.equal(page.posts.find(post => post.id === 'p_edited').content, stored.content);
  stored = null;
  page = await app.getCommunityPosts({ authorId: 'post-owner', viewerId: 'post-owner' });
  assert.equal(page.posts.length, 0, 'Deleted posts cannot be merged back from memory');
  response = await app.request('/feed/p_edited');
  assert.equal(response.status, 404);
  assert.equal(app.posts.some(post => post.id === 'p_edited'), false);
});
