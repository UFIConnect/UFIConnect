// Confirmed writes wake existing views without adding a polling loop per card.
import { createEngagementLedger } from './engagementLedger.mjs';
export const POST_ENGAGEMENT_EVENT = 'ufi-post-engagement-updated';
export const engagementLedger = createEngagementLedger();
const confirmedComments = new Map();
export function clearConfirmedEngagement() { engagementLedger.clear(); confirmedComments.clear(); }
if (typeof window !== 'undefined') {
  window.addEventListener('ufi-session-cleared', clearConfirmedEngagement);
  window.addEventListener('ufi-connections-changed', clearConfirmedEngagement);
}
export function sourceComment(comment) {
  return { ...comment, author: typeof comment.author === 'object' ? comment.author?.name || 'You' : comment.author || 'You',
    body: comment.body ?? comment.content ?? '', created: comment.created ?? comment.createdAt };
}
export function mergeConfirmedComments(postId, incoming, now = Date.now(), sourceShape = false) {
  const entries = confirmedComments.get(postId) || [];
  const pending = entries.filter(entry => now - entry.at < 60_000 && !incoming.some(item =>
    String(item.id) === String(entry.comment.id) || entry.comment.url && (item.url === entry.comment.url || item.sourceUrl === entry.comment.url)));
  if (pending.length) confirmedComments.set(postId, pending); else confirmedComments.delete(postId);
  return [...incoming, ...pending.map(entry => sourceShape ? sourceComment(entry.comment) : entry.comment)];
}

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
  if (patch.comment?.id) {
    detail.comment = { ...patch.comment, ufiConfirmed: true };
    const entries = (confirmedComments.get(post.id) || []).filter(entry => String(entry.comment.id) !== String(patch.comment.id));
    confirmedComments.delete(post.id);
    confirmedComments.set(post.id, [...entries, { at: Date.now(), comment: detail.comment }].slice(-20));
    while (confirmedComments.size > 100) confirmedComments.delete(confirmedComments.keys().next().value);
  }
  const { postId, source, sourceUrl, action, commentId, comment, ...fields } = detail;
  engagementLedger.record(post.id, fields);
  target.dispatchEvent(new CustomEvent(POST_ENGAGEMENT_EVENT, { detail }));
}
