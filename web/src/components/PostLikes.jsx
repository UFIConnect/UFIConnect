import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { HeartIcon, postSource } from './PostCardChrome';
import { originalSourceUrl, sendSourceInteraction, useSourceCapability, useSourceInteractionIdentity } from './ConnectedPostActions';

export default function PostLikes({ post, onPostUpdated }) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const discovery = ['restaurants', 'bars'].includes(post.source) || /^osm:(node|way|relation):\d+$/.test(post.id || '');
  const external = !discovery && (post.isExternal || !['uficonnect', 'livecamera'].includes(post.source || 'uficonnect'));
  const capability = useSourceCapability(external ? post : null);
  const { identity, isCurrent } = useSourceInteractionIdentity(post);
  const inFlight = useRef(null);
  const retry = useRef(null);
  const [state, setState] = useState(null);
  const own = state?.identity === identity ? state : null;
  // A local UFI reaction is never used as a provider's viewer state or metric.
  const liked = own?.liked ?? (external ? Boolean(post.sourceLikedByMe) : Boolean(post.likedByMe));
  const sourceCount = post.sourceLikesCount ?? (post.likesScope !== 'uficonnect' ? post.likesCount : null);
  const value = external ? own?.count ?? sourceCount : own?.count ?? (post.likesAvailable === false ? null : post.likesCount);
  const count = value == null || !Number.isFinite(Number(value)) ? null : Math.max(0, Math.floor(Number(value)));
  const label = external && ['github', 'gitlab'].includes(post.source) ? 'stars' : 'likes';
  const provider = external ? (capability?.label || postSource(post).label) : 'UFIConnect';
  const sourceUrl = originalSourceUrl(post);
  const action = external ? (capability?.likeLabel || 'Like') : 'Like';
  const actionLabel = liked ? (label === 'stars' ? 'Remove star' : post.source === 'reddit' ? 'Remove upvote' : 'Unlike') : action;
  const canLike = Boolean(profile?.id && (!external || (sourceUrl && capability?.connected && capability?.like)));

  async function toggle(event) {
    event.stopPropagation();
    if (!isCurrent() || !canLike || inFlight.current?.identity === identity) return;
    const desired = !liked;
    const requestId = retry.current?.identity === identity && retry.current.liked === desired ? retry.current.requestId : crypto.randomUUID();
    retry.current = { identity, liked: desired, requestId };
    const request = { identity, requestId };
    inFlight.current = request;
    setState({ ...own, identity, liked, busy: true });
    try {
      if (external) {
        const result = await sendSourceInteraction(post, 'like', { liked: desired, requestId });
        if (result.liked !== desired) throw new Error('The source did not confirm this like.');
        if (!isCurrent()) return;
        const confirmedCount = result.likesCount != null && Number.isFinite(Number(result.likesCount)) ? Math.max(0, Math.floor(Number(result.likesCount))) : undefined;
        setState({ identity, liked: desired, count: confirmedCount ?? own?.count });
        onPostUpdated?.({ id: post.id, sourceLikedByMe: desired, ...(confirmedCount !== undefined ? { sourceLikesCount: confirmedCount } : {}) });
        showToast(`${desired ? action : actionLabel} confirmed on ${provider}.`, 'success');
      } else {
        const { data } = await client.post(`/feed/${encodeURIComponent(post.id)}/like`, { liked: desired });
        if (!isCurrent()) return;
        setState({ identity, liked: Boolean(data.likedByMe), count: data.likesCount });
        onPostUpdated?.(data.post || { id: post.id, likesCount: data.likesCount, likedByMe: data.likedByMe });
      }
      retry.current = null;
    } catch (error) {
      if (!isCurrent()) return;
      // Retry an uncertain provider write with the same idempotency key.
      if (error.response?.status < 500 && error.response.status !== 409) retry.current = null;
      setState({ ...own, identity, liked, busy: false });
      showToast(error.response?.data?.message || 'The like could not be confirmed. Check the original post before retrying.', 'error');
    } finally { if (inFlight.current === request) inFlight.current = null; }
  }

  const countLabel = count === null ? `${label} unavailable` : `${count.toLocaleString()} ${label}`;
  const contents = <><HeartIcon filled={liked} /><span className="post-chrome-like-count" aria-hidden="true">{count === null ? '—' : count.toLocaleString()} {label}</span></>;
  let control;
  if (!profile?.id) control = <Link className="post-chrome-action" to="/login" aria-label={`Sign in to like, ${countLabel}`} title="Sign in to like" onClick={event => event.stopPropagation()}>{contents}</Link>;
  else if (external && capability?.reconnectRequired) control = <Link className="post-chrome-action" to={`/connected-accounts?connect=${encodeURIComponent(post.source)}`} aria-label={`Reconnect ${provider} to like, ${countLabel}`} title={`Reconnect ${provider} to allow likes and replies`} onClick={event => event.stopPropagation()}>{contents}</Link>;
  else if (external && capability && !capability.like && sourceUrl) control = <a className="post-chrome-action" href={sourceUrl} target="_blank" rel="noopener noreferrer" title={`Open ${provider} to like`} aria-label={`Open ${provider} to like, ${countLabel}`} onClick={event => event.stopPropagation()}>{contents}</a>;
  else if (external && capability && !capability.connected) control = <Link className="post-chrome-action" data-locked="true" to="/connected-accounts?interactions=1" aria-label={`Connect ${provider} to like, ${countLabel}`} title={`Connect ${provider} to like`} onClick={event => event.stopPropagation()}>{contents}</Link>;
  else control = <button type="button" className="post-chrome-action" disabled={!canLike || Boolean(own?.busy)} aria-pressed={liked} aria-label={`${external ? `${actionLabel} on ${provider}` : actionLabel}, ${countLabel}`} title={external ? `${actionLabel} on ${provider}` : actionLabel} onClick={toggle}>{contents}</button>;
  return <span className="post-chrome-like post-chrome-like-counted" title={`${provider} ${label}`}>{control}</span>;
}
