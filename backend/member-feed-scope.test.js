'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./generated-media');
const { createAppHarness, member } = require('./test-support/app-harness');

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
