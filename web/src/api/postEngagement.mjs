// Confirmed writes wake existing views without adding a polling loop per card.
export const POST_ENGAGEMENT_EVENT = 'ufi-post-engagement-updated';

export function publishPostEngagement(post, patch, target = globalThis.window) {
  if (!post?.id || !['like', 'comment'].includes(patch?.action) || !target?.dispatchEvent) return;
  const detail = { postId: post.id, source: post.source || 'uficonnect', sourceUrl: post.sourceUrl || '', action: patch.action };
  for (const key of ['likedByMe', 'sourceLikedByMe']) {
    if (typeof patch[key] === 'boolean') detail[key] = patch[key];
  }
  for (const key of ['likesCount', 'sourceLikesCount', 'commentsCount']) {
    if (patch[key] != null && Number.isFinite(Number(patch[key]))) detail[key] = Math.max(0, Math.floor(Number(patch[key])));
  }
  if (typeof patch.commentId === 'string' && patch.commentId) detail.commentId = patch.commentId;
  target.dispatchEvent(new CustomEvent(POST_ENGAGEMENT_EVENT, { detail }));
}
