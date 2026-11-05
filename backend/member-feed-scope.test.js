'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./generated-media');
const { createAppHarness, member } = require('./test-support/app-harness');

test('public group sources filter the candidate pool before pagination and preserve topic and privacy scope', async () => {
  const app = await createAppHarness();
  app.seedUser(member('group-source-reader'));
  app.groups.push(
    { id: 'source-reddit', name: 'Reddit engineering', isExternal: true, isPrivate: false },
    { id: 'source-devto', name: 'DEV engineering', isExternal: true, isPrivate: false },
    { id: 'source-private', name: 'Private engineering', isExternal: false, isPrivate: true },
  );
  const now = Date.now();
  app.globalFeedCache.posts = ['reddit', 'devto'].flatMap(source => Array.from({ length: 12 }, (_, index) => ({
    id: `source-${source}-${index}`, groupId: `source-${source}`, source,
    title: `${source} community update ${index}`, content: `${source} engineering discussion number ${index}.`,
    sourceUrl: `https://example.invalid/${source}/${index}`, topic: index < 6 ? 'Open Source' : 'Design',
    createdAt: new Date(now - index * 1000).toISOString(), likesCount: 0,
  })));
  app.posts.push({ id: 'private-source-post', groupId: 'source-private', authorId: 'group-source-reader', source: 'uficonnect', content: 'Private community discussion.', createdAt: new Date().toISOString(), likes: [] });
  try {
    const query = '/office/feed?mode=groups&groupScope=public&passive=1&limit=3&topics=Open%20Source';
    const reddit = await app.request(query + '&source=reddit', { userId: 'group-source-reader' });
    assert.equal(reddit.status, 200);
    assert.ok(reddit.data.posts.length > 0 && reddit.data.posts.length <= 3, JSON.stringify(reddit.data));
    assert.ok(reddit.data.posts.every(post => post.source === 'reddit' && post.topic === 'Open Source'));
    assert.equal(reddit.data.totalAvailable, 6);
    const next = await app.request(query + '&source=reddit&cursor=' + encodeURIComponent(reddit.data.cursor), { userId: 'group-source-reader' });
    assert.ok(next.data.posts.length > 0);
    assert.ok(next.data.posts.every(post => post.source === 'reddit' && !reddit.data.posts.some(first => first.id === post.id)));
    const devto = await app.request(query + '&sources=devto', { userId: 'group-source-reader' });
    assert.equal(devto.status, 200);
    assert.ok(devto.data.posts.length > 0 && devto.data.posts.length <= 3, JSON.stringify(devto.data));
    assert.ok(devto.data.posts.every(post => post.source === 'devto'));
    const both = await app.request(query + '&sources=reddit,devto', { userId: 'group-source-reader' });
    assert.equal(both.data.totalAvailable, 12);
    assert.deepEqual([...new Set(both.data.posts.map(post => post.source))].sort(), ['devto', 'reddit']);
    const native = await app.request(query + '&source=uficonnect', { userId: 'group-source-reader' });
    assert.deepEqual(native.data.posts, []);
  } finally { await app.close(); }
});

test('UFI includes general and joined posts, Your Groups stays joined-only, Following stays followed-general-only', async () => {
  const app = await createAppHarness();
  const viewer = member('scope-viewer', { joinedGroups: ['scope-joined', 'ufi-general'] });
  app.seedUser(viewer);
  app.seedUser(member('scope-author'));
  app.groups.push({ id: 'scope-joined', name: 'Joined', isPrivate: false, isExternal: false }, { id: 'scope-other', name: 'Other', isPrivate: false, isExternal: false });
  for (const [id, groupId, authorId] of [
    ['scope-group', 'scope-joined', 'scope-author'],
    ['scope-unjoined', 'scope-other', 'scope-author'],
    ['scope-general', 'ufi-general', 'scope-author'],
    ['scope-own', 'ufi-general', viewer.id],
  ]) app.posts.push({ id, groupId, authorId, source: 'uficonnect', content: 'A useful update for the community.', title: 'Community update', createdAt: new Date().toISOString(), likes: [], commentsCount: 0 });
  try {
    const publicUfi = await app.request('/posts?scope=ufi', { userId: viewer.id });
    assert.equal(publicUfi.status, 200);
    assert.deepEqual(publicUfi.data.posts.map(p => p.id).sort(), ['scope-general', 'scope-group', 'scope-own']);
    const filteredUfi = await app.request('/posts?scope=ufi&groupIds=scope-other,ufi-general', { userId: viewer.id });
    assert.deepEqual(filteredUfi.data.posts.map(p => p.id).sort(), ['scope-general', 'scope-own']);
    const ufi = await app.request('/posts?scope=joined', { userId: viewer.id });
    assert.equal(ufi.status, 200);
    assert.deepEqual(ufi.data.posts.map(p => p.id), ['scope-group']);
    const groupsFeed = await app.request('/office/feed?mode=groups&passive=1', { userId: viewer.id });
    assert.equal(groupsFeed.status, 200);
    assert.deepEqual(groupsFeed.data.posts.map(p => p.id), ['scope-group']);
    const forcedGroup = await app.request('/posts?scope=joined&groupIds=scope-other,ufi-general', { userId: viewer.id });
    assert.deepEqual(forcedGroup.data.posts, []);
    let following = await app.getFollowingFeedPosts(viewer.id, ['uficonnect'], { surface: 'feed' });
    assert.equal(following.posts.length, 0);
    app.follows.push({ followerId: viewer.id, followingId: 'scope-author' });
    following = await app.getFollowingFeedPosts(viewer.id, ['uficonnect'], { surface: 'feed' });
    assert.deepEqual(Array.from(following.posts, p => p.id), ['scope-general']);
    viewer.joinedGroups = [];
    const generalOnly = await app.request('/posts?scope=ufi', { userId: viewer.id });
    assert.deepEqual(generalOnly.data.posts.map(p => p.id).sort(), ['scope-general', 'scope-own']);
    const left = await app.request('/posts?scope=joined', { userId: viewer.id });
    assert.deepEqual(left.data.posts, []);
    const leftGroups = await app.request('/office/feed?mode=groups&passive=1', { userId: viewer.id });
    assert.equal(leftGroups.status, 200);
    assert.deepEqual(leftGroups.data.posts, []);
    app.follows.splice(app.follows.findIndex(f => f.followerId === viewer.id), 1);
    following = await app.getFollowingFeedPosts(viewer.id, ['uficonnect'], { surface: 'feed' });
    assert.equal(following.posts.length, 0);
  } finally { await app.close(); }
});

test('an empty followed-author scope cannot turn into an unrestricted database query', async () => {
  const app = await createAppHarness({ connected: true });
  try {
    const before = app.queries.length;
    const result = await app.getCommunityPosts({ viewerId: 'nobody', audienceAuthorIds: [], groupId: 'ufi-general' });
    assert.equal(result.posts.length, 0);
    assert.equal(app.queries.length, before);
  } finally { await app.close(); }
});
