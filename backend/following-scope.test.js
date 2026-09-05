const test = require('node:test');
const assert = require('node:assert/strict');
const { GENERAL_UFI_GROUP_ID, isGeneralUfiFollowingPost, isFollowingSourceAllowed } = require('./following-scope');

test('Following accepts only general UFI posts from the native post pool', () => {
  assert.equal(isGeneralUfiFollowingPost({ source: 'uficonnect', groupId: GENERAL_UFI_GROUP_ID }), true);
  assert.equal(isGeneralUfiFollowingPost({ source: 'uficonnect', groupId: 'ufi-tech' }), false);
  assert.equal(isGeneralUfiFollowingPost({ source: 'reddit', groupId: GENERAL_UFI_GROUP_ID }), false);
});

test('Following excludes own-post-only Instagram and TikTok sources', () => {
  assert.equal(isFollowingSourceAllowed('instagram'), false);
  assert.equal(isFollowingSourceAllowed('TikTok'), false);
  assert.equal(isFollowingSourceAllowed('youtube'), true);
  assert.equal(isFollowingSourceAllowed('uficonnect'), true);
});
