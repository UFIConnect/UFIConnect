import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useEngagementTracking } from '../hooks/useEngagementTracking';
import { Link } from 'react-router-dom';
import client from '../api/client';
import PostLikes from './PostLikes';
import { CommentIcon, PostTime, PostOptionsMenu, OpenOnSource } from './PostCardChrome';
import ImageLightbox from './ImageLightbox';
import { InlineAutoplayVideo } from './videoMedia';
import { SavePostButton } from './SaveButtons';
import ShopPostDetails from './ShopPostDetails';
import PostInlineText from './PostInlineText';
import PostLinkPreviews from './PostLinkPreviews';
import { postTextPreview } from '../../../backend/post-text.mjs';
import { POST_ENGAGEMENT_EVENT, publishPostEngagement, mergeConfirmedComments } from '../api/postEngagement.mjs';

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function mergeComments(...lists) {
  const seen = new Set();
  return lists.flat().filter(comment => {
    if (!comment?.id || seen.has(comment.id)) return false;
    seen.add(comment.id);
    return true;
  });
}

// Card view is a preview, not the full read — long posts (the backend keeps
// up to ~600 chars per post, see trimPostContent server-side) used to render
// their entire content inline, every time, which made a handful of long
// posts balloon the whole feed's scroll height. Cut at the last full word
// so "Read more" doesn't land mid-word.
const CONTENT_PREVIEW_LEN = 260;
function truncateAtWord(text, limit) {
  if (text.length <= limit) return text;
  const cut = postTextPreview(text, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

function PostListCard({ post, trackReading, children }) {
  const ref = useRef(null);
  useEngagementTracking(ref, trackReading ? { ...post, topic: post.topic || post.group?.name } : null);
  return <div ref={ref} className="card post-card" style={{ marginBottom: 12 }}>{children}</div>;
}

export default function PostList({
  posts = [],
  loading = false,
  emptyTitle = 'No posts yet',
  emptyDesc = 'Posts shared by this member will show up here.',
  emptyAction = null,
  showAuthor = true,
  shopMode = false,
  maxWidth = 640,
  interactive = true,
  onPostUpdated = null,
  currentUserId = null,
  trackReading = false,
  onPostDeleted = null,
  // Lets the "max view" lightbox pull in more posts as the viewer nears the
  // end of what's already loaded here — same idea as Feed.jsx's own
  // loadMoreRemote, just optional since not every caller paginates (a
  // caller with no more pages to fetch simply doesn't pass this).
  onNearEnd = null,
}) {
  const [localPosts, setLocalPosts] = useState(posts);
  const [openComments, setOpenComments] = useState({});
  const [commentsByPost, setCommentsByPost] = useState({});
  const [commentsLoading, setCommentsLoading] = useState({});
  const [commentsHasMoreByPost, setCommentsHasMoreByPost] = useState({});
  const [commentsLoadingMore, setCommentsLoadingMore] = useState({});
  const [commentsErrors, setCommentsErrors] = useState({});
  const [commentDrafts, setCommentDrafts] = useState({});
  const [commentBusy, setCommentBusy] = useState({});
  const [mediaLightboxPostId, setMediaLightboxPostId] = useState(null);
  const [expandedPosts, setExpandedPosts] = useState({});
  const sentinelRef = useRef(null);
  const mountedRef = useRef(false);
  const commentRequestsRef = useRef(new Map());
  const commentWritesRef = useRef(new Set());
  const viewRef = useRef(null);
  viewRef.current = { currentUserId, localPosts, openComments, commentsByPost, onPostUpdated };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; commentRequestsRef.current.clear(); };
  }, []);

  useEffect(() => {
    commentRequestsRef.current.clear();
    commentWritesRef.current.clear();
    setOpenComments({});
    setCommentsByPost({});
    setCommentsLoading({});
    setCommentsLoadingMore({});
    setCommentsErrors({});
    setCommentDrafts({});
    setCommentBusy({});
  }, [currentUserId]);

  useEffect(() => {
    setLocalPosts(posts);
  }, [posts]);

  // onNearEnd used to only fire from inside the fullscreen media lightbox's
  // own next/prev paging — scrolling the plain list on Profile/GroupDetail/
  // PublicProfile itself never loaded a second page no matter how far down
  // you scrolled. Every caller's own onNearEnd handler already no-ops when
  // there's nothing more to load or a fetch is already in flight (see e.g.
  // Profile.jsx's loadMorePosts), so calling it liberally here is safe.
  const handleNearEnd = useCallback(() => { onNearEnd?.(); }, [onNearEnd]);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !onNearEnd) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) handleNearEnd(); },
      { rootMargin: '400px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [handleNearEnd, onNearEnd, localPosts.length]);

  // Photos and videos share one scrollable viewer (see ImageLightbox) —
  // videos here used to just be plain inline <video controls> with no way
  // to browse from one post's video/photo to the next without scrolling
  // the page itself.
  const mediaPosts = useMemo(
    () => localPosts.filter(p => p?.mediaUrl && (p.mediaType === 'image' || p.mediaType === 'video')),
    [localPosts]
  );
  const mediaLightboxIndex = mediaLightboxPostId
    ? mediaPosts.findIndex(p => p.id === mediaLightboxPostId)
    : -1;

  function updatePost(updatedPost) {
    if (!updatedPost?.id) return;
    setLocalPosts(prev => prev.map(post =>
      post.id === updatedPost.id ? { ...post, ...updatedPost } : post
    ));
    onPostUpdated?.(updatedPost);
  }

  const fetchPostComments = useCallback(async (post, { append = false } = {}) => {
    const id = post.id;
    if (commentRequestsRef.current.has(id) || commentWritesRef.current.has(id)) return;
    const request = { currentUserId: viewRef.current.currentUserId };
    commentRequestsRef.current.set(id, request);
    const current = viewRef.current.commentsByPost[id] || [];
    const isCurrent = () => mountedRef.current && viewRef.current.currentUserId === request.currentUserId
      && commentRequestsRef.current.get(id) === request && viewRef.current.localPosts.some(item => item.id === id);
    const setPending = append ? setCommentsLoadingMore : setCommentsLoading;
    setPending(prev => ({ ...prev, [id]: true }));
    setCommentsErrors(prev => ({ ...prev, [id]: false }));
    try {
      const { data } = await client.get(`/posts/${encodeURIComponent(id)}/comments`, {
        params: { limit: append ? 50 : Math.min(100, Math.max(50, current.length)), ...(append ? { offset: current.filter(comment => !comment.ufiConfirmed).length } : {}) },
      });
      if (!isCurrent()) return;
      const incoming = mergeConfirmedComments(id, data.comments || []);
      setCommentsByPost(prev => ({ ...prev, [id]: append ? mergeComments(prev[id] || [], incoming) : mergeComments(incoming) }));
      setCommentsHasMoreByPost(prev => ({ ...prev, [id]: !!data.hasMore }));
      if (Number.isFinite(data.commentsCount)) {
        const patch = { id, commentsCount: data.commentsCount };
        setLocalPosts(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
        viewRef.current.onPostUpdated?.(patch);
      }
    } catch {
      if (isCurrent()) setCommentsErrors(prev => ({ ...prev, [id]: true }));
    } finally {
      if (commentRequestsRef.current.get(id) === request) {
        commentRequestsRef.current.delete(id);
        if (mountedRef.current && viewRef.current.currentUserId === request.currentUserId) setPending(prev => ({ ...prev, [id]: false }));
      }
    }
  }, []);

  useEffect(() => {
    if (!interactive) return undefined;
    const refreshOpen = () => {
      if (document.hidden) return;
      for (const post of viewRef.current.localPosts) {
        if (viewRef.current.openComments[post.id]) fetchPostComments(post);
      }
    };
    const refreshConfirmed = ({ detail }) => {
      if (detail?.action !== 'comment') return;
      const post = viewRef.current.localPosts.find(item => item.id === detail.postId
        && (item.source || 'uficonnect') === detail.source);
      if (post && viewRef.current.openComments[post.id]) {
        if (detail.comment) setCommentsByPost(previous => ({ ...previous, [post.id]: mergeComments(previous[post.id] || [], detail.comment) }));
        fetchPostComments(post);
      }
    };
    window.addEventListener('focus', refreshOpen);
    const timer = window.setInterval(refreshOpen, 10000);
    document.addEventListener('visibilitychange', refreshOpen);
    window.addEventListener(POST_ENGAGEMENT_EVENT, refreshConfirmed);
    return () => {
      window.removeEventListener('focus', refreshOpen);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshOpen);
      window.removeEventListener(POST_ENGAGEMENT_EVENT, refreshConfirmed);
    };
  }, [interactive, fetchPostComments]);

  function toggleComments(post) {
    if (!interactive) return;
    const isOpen = !!openComments[post.id];
    setOpenComments(prev => ({ ...prev, [post.id]: !isOpen }));
    if (!isOpen) fetchPostComments(post);
  }

  function loadMoreComments(post) {
    fetchPostComments(post, { append: true });
  }

  async function submitComment(e, post) {
    e.preventDefault();
    const content = (commentDrafts[post.id] || '').trim();
    if (!content || commentWritesRef.current.has(post.id)) return;

    const currentUser = currentUserId;
    commentWritesRef.current.add(post.id);
    // A read started before this write cannot erase its confirmed comment/count.
    commentRequestsRef.current.delete(post.id);
    setCommentsLoading(prev => ({ ...prev, [post.id]: false }));
    setCommentsLoadingMore(prev => ({ ...prev, [post.id]: false }));
    setCommentBusy(prev => ({ ...prev, [post.id]: true }));
    setCommentsErrors(prev => ({ ...prev, [post.id]: false }));
    try {
      const { data } = await client.post(`/posts/${encodeURIComponent(post.id)}/comments`, { content });
      if (!mountedRef.current || viewRef.current.currentUserId !== currentUser) return;
      setCommentsByPost(prev => ({
        ...prev,
        [post.id]: mergeComments(prev[post.id] || [], data.comment || []),
      }));
      setCommentDrafts(prev => ({ ...prev, [post.id]: '' }));
      const commentsCount = data.commentsCount ?? data.post?.commentsCount;
      if (Number.isFinite(commentsCount)) updatePost({ id: post.id, commentsCount });
      publishPostEngagement(post, { action: 'comment', commentId: data.comment?.id, comment: data.comment, commentsCount });
    } catch {
      if (mountedRef.current && viewRef.current.currentUserId === currentUser) {
        setCommentsErrors(prev => ({ ...prev, [post.id]: 'Could not publish your comment. Your draft is saved here; please try Send again.' }));
      }
    } finally {
      if (mountedRef.current && viewRef.current.currentUserId === currentUser) {
        commentWritesRef.current.delete(post.id);
        setCommentBusy(prev => ({ ...prev, [post.id]: false }));
      }
    }
  }

  if (loading) {
    return (
      <div style={{ maxWidth, textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
        Loading posts...
      </div>
    );
  }

  if (!localPosts.length) {
    return (
      <div className="card" style={{ maxWidth, textAlign: 'center', padding: '32px 24px' }}>
        <div style={{ fontSize: '2rem', marginBottom: 10 }}>Posts</div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{emptyTitle}</div>
        <p style={{ color: 'var(--muted)', fontSize: '.88rem', margin: emptyAction ? '0 0 16px' : 0 }}>
          {emptyDesc}
        </p>
        {emptyAction}
      </div>
    );
  }

  return (
    <div style={{ maxWidth }}>
      {localPosts.map((post) => {
        const commentsOpen = !!openComments[post.id];
        const comments = commentsByPost[post.id] || [];
        const isExpanded = !!expandedPosts[post.id];
        const isLongPost = !!post.content && post.content.length > CONTENT_PREVIEW_LEN;
        const isShopPost = shopMode || post.groupId === 'ufi-shop' || post.group?.id === 'ufi-shop';
        return (
          <PostListCard key={post.id} post={post} trackReading={trackReading}>
            {showAuthor ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <Link
                  to={post.authorId && post.authorId === currentUserId ? '/profile' : `/u/${post.authorId || post.author?.id}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}
                >
                  {post.author?.avatarUrl ? (
                    <img src={post.author.avatarUrl} alt="" className="avatar-sm" style={{ borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div className="avatar avatar-sm">{initials(post.author?.name)}</div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '.85rem' }}>{post.author?.name || 'Member'}</div>
                    <div style={{ fontSize: '.72rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {post.author?.title || 'UFIconnect Member'}{post.group ? ` - ${post.group.name}` : ''}
                    </div>
                  </div>
                </Link>
                <span style={{ fontSize: '.7rem', color: 'var(--muted)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <PostTime post={post} />
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: '.76rem', fontWeight: 700, color: 'var(--primary)' }}>
                  {post.group?.name || 'UFIconnect'}
                </span>
                <span style={{ fontSize: '.7rem', color: 'var(--muted)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <PostTime post={post} />
                </span>
              </div>
            )}

            {post.content && !isShopPost && (
              <p style={{ margin: '0 0 10px', fontSize: '.9rem', lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'break-word' }}>
                <PostInlineText text={isLongPost && !isExpanded
                  ? `${truncateAtWord(post.content, CONTENT_PREVIEW_LEN)}… `
                  : post.content} />
                {isLongPost && (
                  <button
                    type="button"
                    onClick={() => setExpandedPosts(prev => ({ ...prev, [post.id]: !isExpanded }))}
                    style={{ fontWeight: 700, color: 'var(--primary)', background: 'none', border: 'none', padding: 0, marginLeft: isExpanded ? 0 : 4, cursor: 'pointer', font: 'inherit', whiteSpace: 'nowrap', display: isExpanded ? 'block' : 'inline' }}
                  >
                    {isExpanded ? 'Show less' : 'Read more'}
                  </button>
                )}
              </p>
            )}

            {post.mediaUrl && (
              <div style={{ borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 10, background: '#000' }}>
                {post.mediaType === 'video' ? (
                  <button
                    onClick={() => setMediaLightboxPostId(post.id)}
                    style={{ all: 'unset', display: 'block', width: '100%', cursor: 'pointer', position: 'relative' }}
                  >
                    {/* Autoplays muted/looping as it scrolls into view instead
                        of sitting as a static frame with a "tap to play"
                        badge — click-to-maximize is unchanged, same as
                        photos: this button still opens ImageLightbox for
                        sound, seeking, and next/prev. */}
                    <InlineAutoplayVideo post={post} kind="file" src={post.mediaUrl}
                      style={{ width: '100%', maxHeight: 420, display: 'block' }}
                      forcePause={mediaLightboxPostId === post.id} />
                  </button>
                ) : (
                  <button
                    onClick={() => setMediaLightboxPostId(post.id)}
                    style={{ all: 'unset', display: 'block', width: '100%', cursor: 'pointer' }}
                  >
                    <img src={post.mediaUrl} alt="" style={{ width: '100%', maxHeight: 420, objectFit: 'contain', display: 'block' }} />
                  </button>
                )}
              </div>
            )}

            {!isShopPost && <PostLinkPreviews post={post} />}
            {isShopPost && <ShopPostDetails post={post} />}
            <div className="post-chrome-actions" style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <PostLikes post={post} onPostUpdated={updatePost} />

              <button
                type="button"
                onClick={() => toggleComments(post)}
                disabled={!interactive}
                className="post-chrome-action"
                aria-label={`${commentsOpen ? 'Hide' : 'Show'} comments (${post.commentsCount || 0})`}
                aria-expanded={commentsOpen}
                title={commentsOpen ? 'Hide comments' : 'Comments'}
              >
                <CommentIcon /><span aria-hidden="true">{(post.commentsCount || 0).toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 0 })}</span>
              </button>

              <SavePostButton
                post={post}
                className="post-chrome-action save-item-button"
                showLabel={false}
              />
              {post.group && (
                <span style={{
                  fontSize: '.72rem', fontWeight: 600, marginLeft: 'auto',
                  color: 'var(--primary)', background: 'var(--primary-light)',
                  padding: '2px 8px', borderRadius: 10,
                }}>
                  {post.group.name}
                </span>
              )}
              <PostOptionsMenu post={post} onPostUpdated={updatePost} onRemoved={removed => {
                setLocalPosts(previous => previous.filter(item => item.id !== removed.id));
                onPostDeleted?.(removed.id);
              }} />
              <OpenOnSource post={post} />
            </div>

            {commentsOpen && (
              <div className="post-comments">
                {commentsErrors[post.id] && <p role="alert" style={{ color: 'var(--danger)', fontSize: '.82rem' }}>
                  {typeof commentsErrors[post.id] === 'string' ? commentsErrors[post.id] : <>Comments could not be refreshed. <button type="button" className="btn btn-ghost btn-sm" onClick={() => fetchPostComments(post)}>Retry</button></>}
                </p>}
                {commentsLoading[post.id] && !comments.length ? (
                  <div style={{ textAlign: 'center', padding: '12px 0' }}>
                    <span className="spinner spinner-primary" />
                  </div>
                ) : comments.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
                    {comments.map(comment => (
                      <div key={comment.id} className="post-comment" style={{ display: 'flex', gap: 10 }}>
                        <Link
                          to={comment.author?.id && comment.author.id === currentUserId ? '/profile' : `/u/${comment.author?.id}`}
                          className="avatar avatar-sm"
                          style={{ flexShrink: 0 }}
                        >
                          {initials(comment.author?.name)}
                        </Link>
                        <div className="post-comment-body" style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                            <Link
                              to={comment.author?.id && comment.author.id === currentUserId ? '/profile' : `/u/${comment.author?.id}`}
                              style={{ fontWeight: 700, fontSize: '.78rem', color: 'inherit', textDecoration: 'none' }}
                            >
                              {comment.author?.name || 'Member'}
                            </Link>
                            <span style={{ fontSize: '.68rem', color: 'var(--muted)', marginLeft: 'auto' }}>{timeAgo(comment.createdAt)}</span>
                          </div>
                          <p style={{ margin: 0, fontSize: '.84rem', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                            {comment.content}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize: '.82rem', color: 'var(--muted)', margin: '0 0 12px' }}>
                    No comments yet.
                  </p>
                )}

                {!commentsLoading[post.id] && commentsHasMoreByPost[post.id] && (
                  <button
                    onClick={() => loadMoreComments(post)}
                    disabled={commentsLoadingMore[post.id]}
                    style={{
                      display: 'block', margin: '0 0 12px', background: 'none', border: 'none',
                      color: 'var(--primary)', cursor: commentsLoadingMore[post.id] ? 'default' : 'pointer',
                      fontSize: '.8rem', fontWeight: 700, padding: 0,
                    }}
                  >
                    {commentsLoadingMore[post.id] ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Load more comments'}
                  </button>
                )}

                <form className="post-comment-form" onSubmit={(e) => submitComment(e, post)} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    className="form-input"
                    value={commentDrafts[post.id] || ''}
                    onChange={e => setCommentDrafts(prev => ({ ...prev, [post.id]: e.target.value }))}
                    placeholder="Write a comment..."
                    aria-label="Write a comment"
                    maxLength={1000}
                    style={{ flex: 1, fontSize: '.86rem' }}
                  />
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={commentBusy[post.id] || !(commentDrafts[post.id] || '').trim()}
                    style={{ flexShrink: 0 }}
                  >
                    {commentBusy[post.id] ? <span className="spinner" /> : 'Send'}
                  </button>
                </form>
              </div>
            )}
          </PostListCard>
        );
      })}

      {onNearEnd && <div ref={sentinelRef} style={{ height: 1 }} />}

      {mediaLightboxIndex !== -1 && (
        <ImageLightbox
          items={mediaPosts.map(p => ({ url: p.mediaUrl, type: p.mediaType, post: p }))}
          startIndex={mediaLightboxIndex}
          onClose={() => setMediaLightboxPostId(null)}
          onNearEnd={onNearEnd}
        />
      )}
    </div>
  );
}
