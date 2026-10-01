import { useEffect, useState } from 'react';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import FollowListModal from './FollowListModal';
import { HeartIcon, postSource } from './PostCardChrome';
import { originalSourceUrl, sendSourceInteraction, useSourceCapability } from './ConnectedPostActions';

// External counts always come from the original source. Confirmed actions only
// change this viewer's button state; they never increment a public counter.
export default function PostLikes({ post, onPostUpdated }) {
  const { token } = useAuth();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [showLikers, setShowLikers] = useState(false);
  const [sourceLiked, setSourceLiked] = useState(false);
  const [lastRequest, setLastRequest] = useState(null);
  const isRestaurant = post.source === 'restaurants' && post.ufiInteractive;
  const isMember = !post.isExternal && ['uficonnect', 'livecamera'].includes(post.source || 'uficonnect');
  const interactive = isMember || isRestaurant;
  const capability = useSourceCapability(interactive ? null : post);
  const src = postSource(post);
  const sourceUrl = originalSourceUrl(post);
  const liked = interactive ? Boolean(post.likedByMe) : sourceLiked;
  const available = typeof post.likesCount === 'number' && Number.isFinite(post.likesCount);
  const count = available ? Math.max(0, post.likesCount) : null;
  const canLike = interactive || Boolean(sourceUrl && capability?.connected === true && capability?.like === true);

  useEffect(() => { setSourceLiked(false); setLastRequest(null); setShowLikers(false); }, [post.id, post.source]);

  async function toggle() {
    if (busy || !canLike) return;
    if (!token) { showToast('Sign in to like this post.', 'info'); return; }
    setBusy(true);
    try {
      if (interactive) {
        const { data } = await client.post('/' + (isRestaurant ? 'restaurants' : 'posts') + '/' + encodeURIComponent(post.id) + '/like');
        onPostUpdated?.(data.post || { ...post, likedByMe: data.likedByMe, likesCount: data.likesCount });
      } else {
        const next = !liked;
        const requestId = lastRequest?.liked === next ? lastRequest.requestId : crypto.randomUUID();
        setLastRequest({ liked: next, requestId });
        const data = await sendSourceInteraction(post, 'like', { liked: next, requestId });
        setSourceLiked(data.liked === true);
        setLastRequest(null);
      }
    } catch (error) {
      showToast(error?.response?.data?.message || 'The source did not confirm this action. Check the original post before retrying.', 'error');
    } finally { setBusy(false); }
  }

  function openLikers() {
    if (!token) { showToast('Sign in to see who liked this post.', 'info'); return; }
    setShowLikers(true);
  }

  const actionLabel = liked ? 'Unlike' : capability?.likeLabel || 'Like';
  return <div className={'post-chrome-like' + (count > 0 ? ' post-chrome-like-counted' : '')}>
    {canLike ? <button type="button" className="post-chrome-action" onClick={toggle} disabled={busy} aria-pressed={liked} aria-label={actionLabel + (interactive ? '' : ' on ' + src.label)} title={actionLabel + (interactive ? '' : ' on ' + src.label + '; counts are supplied by the source')}><HeartIcon filled={liked} /></button>
      : sourceUrl ? <a className="post-chrome-action" href={sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={'Like on ' + src.label + ' (opens in a new tab)'} title={'Like on ' + src.label + ' ↗'} onClick={event => event.stopPropagation()}><HeartIcon /><span aria-hidden="true">↗</span></a>
        : <span className="post-chrome-action" title="Source interactions unavailable"><HeartIcon /></span>}
    {interactive && count > 0 ? <button type="button" className="post-chrome-action post-chrome-like-count" onClick={openLikers} aria-label={count.toLocaleString() + ' likes: see who liked this'} title="See who liked this">{count.toLocaleString()}</button>
      : !interactive && <span className="post-chrome-action post-chrome-like-count" title={count === null ? src.label + ' has not supplied a like count' : 'Engagement metrics are provided by ' + src.label} aria-label={count === null ? 'Likes unavailable from ' + src.label : count.toLocaleString() + ' likes on ' + src.label}>{count === null ? 'Unavailable' : count.toLocaleString()}</span>}
    {showLikers && interactive && <FollowListModal fetchUrl={'/feed/' + encodeURIComponent(post.id) + '/likes'} title={'Liked by · ' + (count || 0).toLocaleString()} emptyLabel="No UFIconnect members have liked this yet." onClose={() => setShowLikers(false)} />}
  </div>;
}
