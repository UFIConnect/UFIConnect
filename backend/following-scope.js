'use strict';

const GENERAL_UFI_GROUP_ID = 'ufi-general';
const FOLLOWING_EXCLUDED_SOURCES = new Set(['instagram', 'tiktok', 'mastodon']);

function isGeneralUfiFollowingPost(post) {
  return Boolean(
    post
    && (post.source || 'uficonnect') === 'uficonnect'
    && post.groupId === GENERAL_UFI_GROUP_ID
  );
}

function isFollowingSourceAllowed(source) {
  return !FOLLOWING_EXCLUDED_SOURCES.has(String(source || '').trim().toLowerCase());
}

module.exports = { GENERAL_UFI_GROUP_ID, isGeneralUfiFollowingPost, isFollowingSourceAllowed };
