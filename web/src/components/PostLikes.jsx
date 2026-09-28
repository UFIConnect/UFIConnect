import { useEffect, useState, useSyncExternalStore } from 'react';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import FollowListModal from './FollowListModal';
import { HeartIcon, postSource } from './PostCardChrome';

// Member likes on external posts are per viewer, so the shared feed snapshot
// never carries them. Cards on screen ask for theirs, batched into one request.
const memberLikes = new Map();
const listeners = new Set();
let pending = new Set(), timer = null, viewer = null;
const emit = () => listeners.forEach(listener => listener());
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };

function flush() {
  timer = null;
  const ids = [...pending]; pending = new Set();
  for (let start = 0; start < ids.length; start += 100) {
    const chunk = ids.slice(start, start + 100);
    client.get('/feed/likes', { params: { ids: chunk.join(',') } })
      .then(({ data }) => { chunk.forEach(id => memberLikes.set(id, data?.likes?.[id] || { count: 0, likedByMe: false })); emit(); })
      .catch(() => {});
  }
}

function useMemberLikes(postId, enabled, viewerId) {
  if (viewer !== viewerId) { viewer = viewerId; memberLikes.clear(); }
  useEffect(() => {
    if (!enabled || !postId || memberLikes.has(postId) || pending.has(postId)) return;
    pending.add(postId);
    timer ||= setTimeout(flush, 40);
  }, [postId, enabled, viewerId]);
  return useSyncExternalStore(subscribe, () => (enabled ? memberLikes.get(postId) : undefined));
}

// Heart plus like count. The heart likes or unlikes; the count opens who liked it.
// Member posts keep their own likes; external posts add members' likes to the
// count the source reports (sources don't share who liked a post).
export default function PostLikes({ post, onPostUpdated }) {
  const { token, profile } = useAuth();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [showLikers, setShowLikers] = useState(false);
  const isRestaurant = post.source === 'restaurants' && post.ufiInteractive;
  const isMember = !post.isExternal && ['uficonnect', 'livecamera'].includes(post.source || 'uficonnect');
  const interactive = isMember || isRestaurant;
  const member = useMemberLikes(post.id, !interactive, profile?.id || '');
  const src = postSource(post);
  const liked = interactive ? Boolean(post.likedByMe) : Boolean(member?.likedByMe);
  const memberCount = interactive ? Number(post.likesCount || 0) : Number(member?.count || 0);
  const sourceCount = interactive ? 0 : Math.max(0, Number(post.likesCount || 0));
  const total = memberCount + sourceCount;

  async function toggle() {
    if (busy) return;
    if (!token) { showToast('Sign in to like this post.', 'info'); return; }
    setBusy(true);
    try {
      if (interactive) {
        const { data } = await client.post(`/${isRestaurant ? 'restaurants' : 'posts'}/${encodeURIComponent(post.id)}/like`);
        onPostUpdated?.(data.post || { ...post, likedByMe: data.likedByMe, likesCount: data.likesCount });
      } else {
        const { data } = await client.post(`/feed/${encodeURIComponent(post.id)}/like`);
        memberLikes.set(post.id, { count: Number(data.memberLikesCount || 0), likedByMe: Boolean(data.likedByMe) }); emit();
      }
    } catch {
      showToast('Could not update that like. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function openLikers() {
    if (!token) { showToast('Sign in to see who liked this post.', 'info'); return; }
    setShowLikers(true);
  }

  const detail = sourceCount
    ? `${sourceCount.toLocaleString()} on ${src.label}${memberCount ? ` · ${memberCount.toLocaleString()} on UFIconnect` : ''}`
    : `${memberCount.toLocaleString()} ${memberCount === 1 ? 'like' : 'likes'}`;
  return (
    <div className={`post-chrome-like${total > 0 ? ' post-chrome-like-counted' : ''}`}>
      <button type="button" className="post-chrome-action" onClick={toggle} disabled={busy} aria-pressed={liked} aria-label={liked ? 'Unlike' : 'Like'} title={liked ? 'Unlike' : 'Like'}>
        <HeartIcon filled={liked} />
      </button>
      {total > 0 && (
        <button type="button" className="post-chrome-action post-chrome-like-count" onClick={openLikers} aria-label={`${total.toLocaleString()} ${total === 1 ? 'like' : 'likes'}: see who liked this`} title={`${detail}. See who liked this`}>
          {total.toLocaleString()}
        </button>
      )}
      {showLikers && (
        <FollowListModal
          fetchUrl={`/feed/${encodeURIComponent(post.id)}/likes`}
          title={`Liked by · ${memberCount.toLocaleString()}`}
          emptyLabel="No UFIconnect members have liked this yet."
          note={sourceCount ? `Plus ${sourceCount.toLocaleString()} ${sourceCount === 1 ? 'like' : 'likes'} on ${src.label}, which doesn't share who liked a post.` : ''}
          onClose={() => setShowLikers(false)}
        />
      )}
    </div>
  );
}
