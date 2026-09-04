'use strict';

const GENERAL_UFI_GROUP_ID = 'ufi-general';

function isGeneralUfiFollowingPost(post) {
  return Boolean(
    post
    && (post.source || 'uficonnect') === 'uficonnect'
    && post.groupId === GENERAL_UFI_GROUP_ID
  );
}

module.exports = { GENERAL_UFI_GROUP_ID, isGeneralUfiFollowingPost };
