'use strict';

const GENERAL_UFI_GROUP_ID = 'ufi-general';
const { following } = require('../shared/feed-source-catalog.json');
const FOLLOWING_SOURCES = new Set(['uficonnect', ...Object.entries(following)
  .filter(([, capability]) => capability === 'following').map(([source]) => source)]);

function isGeneralUfiFollowingPost(post) {
  return Boolean(
    post
    && (post.source || 'uficonnect') === 'uficonnect'
    && post.groupId === GENERAL_UFI_GROUP_ID
  );
}

function isFollowingSourceAllowed(source) {
  return FOLLOWING_SOURCES.has(String(source || '').trim().toLowerCase());
}

module.exports = { GENERAL_UFI_GROUP_ID, isGeneralUfiFollowingPost, isFollowingSourceAllowed };
