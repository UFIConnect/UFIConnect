const test = require('node:test');
const assert = require('node:assert/strict');
require('./generated-media');
const { createAppHarness, member } = require('./test-support/app-harness');

test('Your groups excludes legacy external subscriptions, general/shop and unjoined posts', async t => {
  const app = await createAppHarness(); t.after(() => app.close());
  const viewer = member('group-boundary', { joinedGroups: ['native-group', 'legacy-external', 'ufi-general', 'ufi-shop'] });
  app.seedUser(viewer); app.seedUser(member('group-author'));
  app.groups.push({ id: 'native-group', name: 'Joined community', isExternal: false }, { id: 'other-group', name: 'Other community', isExternal: false }, { id: 'legacy-external', name: 'Platform timeline', isExternal: true });
  for (const groupId of ['native-group', 'other-group', 'legacy-external', 'ufi-general', 'ufi-shop']) app.posts.push({
    id: `boundary-${groupId}`, groupId, authorId: 'group-author', source: 'uficonnect',
    title: 'Community project update', content: 'The team has shared a helpful update about the project.',
    createdAt: new Date().toISOString(), likes: [], commentsCount: 0,
  });
  const result = await app.request('/office/feed?mode=groups&passive=1', { userId: viewer.id });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.posts.map(post => post.id), ['boundary-native-group']);
  assert.equal(result.data.connectedSourceCount, 0);
  const leave = await app.request('/groups/native-group/join', { userId: viewer.id, method: 'DELETE' });
  assert.equal(leave.status, 200);
  const after = await app.request('/office/feed?mode=groups&passive=1', { userId: viewer.id });
  assert.deepEqual(after.data.posts, []);
});

test('Bars has its own authenticated, topic-filtered discovery pool and cursor', async t => {
  const app = await createAppHarness(); t.after(() => app.close());
  app.seedUser(member('bar-reader', { preferences: { interests: [], goals: [] } }));
  const posts = Array.from({ length: 8 }, (_, index) => ({
    id: `bar_opening_${String(index).padStart(20, '0')}`, source: 'bars', sourceLabel: 'Bars',
    title: `Riverside pub opens a new outdoor garden ${index}`, content: 'The neighbourhood pub has opened a garden with a seasonal menu and local live music.',
    sourceUrl: `https://www.bbc.com/news/articles/bar${index}`, createdAt: new Date(Date.now() - index * 60000).toISOString(),
    topic: index === 7 ? 'Live Events & Concerts' : 'Wine & Spirits', isExternal: true, author: { name: 'Local news' },
  }));
  app.locationLiveFeedCache.set('bars:worldwide', { posts, expiresAt: Date.now() + 60000, fetchedAt: new Date().toISOString() });
  assert.equal((await app.request('/office/feed?mode=bars')).status, 401);
  const first = await app.request('/office/feed?mode=bars&passive=1&limit=3&topics=Wine%20%26%20Spirits', { userId: 'bar-reader' });
  assert.equal(first.status, 200); assert.equal(first.data.mode, 'bars');
  assert.ok(first.data.posts.length > 0); assert.ok(first.data.posts.every(post => post.source === 'bars' && post.topic === 'Wine & Spirits'));
  assert.ok(first.data.cursor);
  const next = await app.request(`/office/feed?mode=bars&passive=1&limit=3&topics=Wine%20%26%20Spirits&cursor=${encodeURIComponent(first.data.cursor)}`, { userId: 'bar-reader' });
  assert.equal(next.status, 200); assert.ok(next.data.posts.length > 0);
  assert.ok(next.data.posts.every(post => !first.data.posts.some(previous => previous.id === post.id)));
});
