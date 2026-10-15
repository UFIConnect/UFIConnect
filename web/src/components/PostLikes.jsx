import { cloneElement, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { HeartIcon, postSource } from './PostCardChrome';
import { originalSourceUrl, sendSourceInteraction, useSourceCapability, useSourceInteractionIdentity } from './ConnectedPostActions';
import { POST_ENGAGEMENT_EVENT, publishPostEngagement } from '../api/postEngagement.mjs';

export default function PostLikes({ post, onPostUpdated, menuItem = false, compact = false }) {
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
  const suppliedLiked = external ? Boolean(post.sourceLikedByMe) : Boolean(post.likedByMe);
  // A local UFI reaction is never used as a provider's viewer state or metric.
  const liked = own?.liked ?? suppliedLiked;
  const sourceCount = post.sourceLikesCount ?? (post.likesScope !== 'uficonnect' ? post.likesCount : null);
  const suppliedCount = external ? sourceCount : (post.likesAvailable === false ? null : post.likesCount);
  const value = own?.count ?? suppliedCount;
  const count = value == null || !Number.isFinite(Number(value)) ? null : Math.max(0, Math.floor(Number(value)));
  const label = external && ['github', 'gitlab'].includes(post.source) ? 'stars' : 'likes';
  const provider = external ? (capability?.label || postSource(post).label) : 'UFIConnect';
  const sourceUrl = originalSourceUrl(post);
  const action = external ? (capability?.likeLabel || 'Like') : 'Like';
  const actionLabel = liked ? (label === 'stars' ? 'Remove star' : post.source === 'reddit' ? 'Remove upvote' : 'Unlike') : action;
  const canLike = Boolean(profile?.id && (!external || (sourceUrl && capability?.connected && capability?.like)));
  useEffect(() => {
    const changed = ({ detail }) => {
      if (!isCurrent() || detail?.action !== 'like' || detail.postId !== post.id || detail.source !== (post.source || 'uficonnect')) return;
      const nextLiked = external ? detail.sourceLikedByMe : detail.likedByMe;
      const nextCount = external ? detail.sourceLikesCount : detail.likesCount;
      if (typeof nextLiked === 'boolean') setState({ identity, liked: nextLiked, count: nextCount });
    };
    window.addEventListener(POST_ENGAGEMENT_EVENT, changed);
    return () => window.removeEventListener(POST_ENGAGEMENT_EVENT, changed);
  }, [identity, isCurrent, post.id, post.source, external]);

  // A confirmed response bridges the parent update. Once acknowledged, fresh
  // feed metrics become authoritative again instead of being shadowed forever.
  useEffect(() => {
    if (own && !own.busy && own.liked === suppliedLiked
      && (own.count == null || Number(own.count) === Number(suppliedCount))) setState(null);
  }, [own, suppliedLiked, suppliedCount]);

  async function toggle(event) {
    event.stopPropagation();
    if (!isCurrent() || !canLike || inFlight.current?.identity === identity) return;
    const desired = !liked;
    const requestId = retry.current?.identity === identity && retry.current.liked === desired ? retry.current.requestId : crypto.randomUUID();
    retry.current = { identity, liked: desired, requestId };
    const request = { identity, requestId };
    inFlight.current = request;
    // Native likes can respond immediately. Provider reactions remain unchanged
    // until the provider confirms them, and never manufacture source counts.
    setState({ ...own, identity, liked: external ? liked : desired,
      count: external ? own?.count : count == null ? undefined : Math.max(0, count + (desired ? 1 : -1)), busy: true });
    try {
      if (external) {
        const result = await sendSourceInteraction(post, 'like', { liked: desired, requestId });
        if (result.liked !== desired) throw new Error('The source did not confirm this like.');
        if (!isCurrent()) return;
        const confirmedCount = result.likesCount != null && Number.isFinite(Number(result.likesCount)) ? Math.max(0, Math.floor(Number(result.likesCount))) : undefined;
        setState({ identity, liked: desired, count: confirmedCount });
        const patch = { id: post.id, sourceLikedByMe: desired, ...(confirmedCount !== undefined ? { sourceLikesCount: confirmedCount } : {}) };
        onPostUpdated?.(patch);
        publishPostEngagement(post, { action: 'like', ...patch });
        showToast(`${desired ? action : actionLabel} confirmed on ${provider}.`, 'success');
      } else {
        const { data } = await client.post(`/feed/${encodeURIComponent(post.id)}/like`, { liked: desired });
        if (!isCurrent()) return;
        const confirmedLiked = Boolean(data.likedByMe ?? data.post?.likedByMe);
        const confirmedCount = data.likesCount ?? data.post?.likesCount;
        setState({ identity, liked: confirmedLiked, count: confirmedCount });
        const patch = { id: post.id, likesCount: confirmedCount, likedByMe: confirmedLiked };
        onPostUpdated?.(patch);
        publishPostEngagement(post, { action: 'like', ...patch });
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
  const visibleCount = count === null ? '—' : compact && !menuItem
    ? count.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 0 }) : count.toLocaleString();
  const contents = <><HeartIcon filled={liked} /><span className="post-chrome-like-count" aria-hidden="true">{menuItem && `${actionLabel} · `}{visibleCount}{(!compact || menuItem) && ` ${label}`}</span></>;
  let control;
  if (!profile?.id) control = <Link className="post-chrome-action" to="/login" aria-label={`Sign in to like, ${countLabel}`} title="Sign in to like" onClick={event => event.stopPropagation()}>{contents}</Link>;
  else if (external && capability?.reconnectRequired) control = <Link className="post-chrome-action" to={`/connected-accounts?connect=${encodeURIComponent(post.source)}`} aria-label={`Reconnect ${provider} to like, ${countLabel}`} title={`Reconnect ${provider} to allow likes and replies`} onClick={event => event.stopPropagation()}>{contents}</Link>;
  else if (external && capability && !capability.like && sourceUrl) control = <a className="post-chrome-action" href={sourceUrl} target="_blank" rel="noopener noreferrer" title={`Open ${provider} to like`} aria-label={`Open ${provider} to like, ${countLabel}`} onClick={event => event.stopPropagation()}>{contents}</a>;
  else if (external && capability && !capability.connected) control = <Link className="post-chrome-action" data-locked="true" to="/connected-accounts?interactions=1" aria-label={`Connect ${provider} to like, ${countLabel}`} title={`Connect ${provider} to like`} onClick={event => event.stopPropagation()}>{contents}</Link>;
  else control = <button type="button" className="post-chrome-action" disabled={!canLike || Boolean(own?.busy)} aria-pressed={liked} aria-label={`${external ? `${actionLabel} on ${provider}` : actionLabel}, ${countLabel}`} title={external ? `${actionLabel} on ${provider}` : actionLabel} onClick={toggle}>{contents}</button>;
  if (compact && !menuItem) control = cloneElement(control, { title: `${control.props.title}. ${countLabel}` });
  if (menuItem) return cloneElement(control, { role: 'menuitem', className: `${control.props.className} video-feed-menu-action` });
  return <span className="post-chrome-like post-chrome-like-counted" title={`${provider}: ${countLabel}`}>{control}</span>;
}
