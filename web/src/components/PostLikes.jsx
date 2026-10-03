import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import FollowListModal from './FollowListModal';
import { HeartIcon, postSource } from './PostCardChrome';
import { originalSourceUrl } from './ConnectedPostActions';
import { loadPostLikes } from '../api/postLikes';

export default function PostLikes({ post, onPostUpdated }) {
  const { token, profile } = useAuth();
  const location = useLocation();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [showLikers, setShowLikers] = useState(false);
  const [confirmed, setConfirmed] = useState(null);
  const pending = useRef(false);
  const updateRef = useRef(onPostUpdated);
  updateRef.current = onPostUpdated;
  const viewer = profile?.id || '';
  const isExternal = post.isExternal || !['uficonnect', 'livecamera', 'restaurants'].includes(post.source || 'uficonnect');
  const needsCounts = isExternal && post.likesScope !== 'uficonnect';
  const hasConfirmed = confirmed?.viewer === viewer && confirmed?.post.id === post.id;

  useEffect(() => {
    setShowLikers(false);
  }, [post.id, viewer]);

  useEffect(() => {
    // A feed read started before a click can arrive after the write. Keep the
    // confirmed reaction until the incoming card agrees with that state.
    setConfirmed(current => {
      if (current?.viewer !== viewer || current?.post.id !== post.id
          || post.likesScope !== 'uficonnect' || current.post.likedByMe !== post.likedByMe) return current;
      return { viewer, post: { ...current.post, ...post } };
    });
  }, [post.id, viewer, post.likesCount, post.likedByMe, post.likesScope, post.likesAvailable]);

  useEffect(() => {
    const update = event => {
      if (event.detail.viewer !== viewer || event.detail.post.id !== post.id) return;
      setConfirmed({ viewer, post: event.detail.post });
      updateRef.current?.(event.detail.post);
    };
    window.addEventListener('ufi-post-like-updated', update);
    return () => window.removeEventListener('ufi-post-like-updated', update);
  }, [post.id, viewer]);

  useEffect(() => {
    if (!needsCounts) return;
    let cancelled = false;
    const separateTable = post.source === 'restaurants' || /^osm:(?:node|way|relation):\d+$/i.test(post.id);
    loadPostLikes(post.id, separateTable).then(data => {
      if (!cancelled) setConfirmed(current => current?.viewer === viewer && current?.post.id === post.id ? current : {
        viewer, post: { ...data, ...(separateTable ? {} : { sourceLikesCount: post.sourceLikesCount ?? post.likesCount }) },
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [post.id, viewer, needsCounts, post.source]);

  const current = hasConfirmed ? confirmed.post : post;
  const liked = Boolean(current.likedByMe);
  const available = current.likesAvailable !== false && (hasConfirmed || !needsCounts);
  const count = available ? Math.max(0, Number(current.likesCount) || 0) : null;
  const countLabel = count === null ? '—' : count.toLocaleString();
  const src = postSource(post);
  const sourceUrl = originalSourceUrl(post);
  const sourceCount = Number(current.sourceLikesCount ?? post.sourceLikesCount ?? (needsCounts ? post.likesCount : undefined));
  const signIn = '/login';
  const signInState = { from: location.pathname + location.search };

  async function toggle() {
    if (pending.current || !token || !available) return;
    pending.current = true;
    setBusy(true);
    try {
      const endpoint = post.source === 'restaurants' && post.ufiInteractive ? 'restaurants' : 'feed';
      const { data } = await client.post(`/${endpoint}/${encodeURIComponent(post.id)}/like`, { liked: !liked });
      const updated = { ...data.post, id: post.id, likedByMe: data.likedByMe, likesCount: data.likesCount };
      window.dispatchEvent(new CustomEvent('ufi-post-like-updated', { detail: { viewer, post: updated } }));
    } catch (error) {
      showToast(error?.response?.data?.message || 'Could not update your like. Please try again.', 'error');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <div className="post-chrome-like post-chrome-like-counted" onClick={event => event.stopPropagation()}>
    {token ? <button type="button" className="post-chrome-action" onClick={toggle} disabled={busy || !available} aria-pressed={liked} aria-label={liked ? 'Unlike' : 'Like'} title={!available ? 'Like counts are unavailable. Refresh to try again.' : liked ? 'Unlike on UFIconnect' : 'Like on UFIconnect'}><HeartIcon filled={liked} /></button>
      : <Link className="post-chrome-action" to={signIn} state={signInState} aria-label="Sign in to like" title="Sign in to like"><HeartIcon /></Link>}
    {token ? <button type="button" className="post-chrome-action post-chrome-like-count" onClick={() => setShowLikers(true)} aria-label={`${count === null ? 'View' : countLabel} likes: see who liked this`} title="See who liked this"><span aria-live="polite">{countLabel}</span></button>
      : <Link className="post-chrome-action post-chrome-like-count" to={signIn} state={signInState} aria-label={`${count === null ? 'View' : countLabel} likes: sign in to see who liked this`}>{countLabel}</Link>}
    {Number.isFinite(sourceCount) && sourceCount > 0 && sourceUrl && <a className="post-chrome-source-count" href={sourceUrl} target="_blank" rel="noopener noreferrer" title={`Reported by ${src.label}`}>{sourceCount.toLocaleString()} {['github', 'gitlab'].includes(post.source) ? 'stars' : 'reactions'} on {src.label}</a>}
    {showLikers && token && <FollowListModal fetchUrl={`/feed/${encodeURIComponent(post.id)}/likes`} title={`Liked by · ${countLabel}`} emptyLabel="No UFIconnect members have liked this yet." onClose={() => setShowLikers(false)} />}
  </div>;
}
