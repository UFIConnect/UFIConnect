import { cloneElement, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { postSource } from './PostCardChrome';
import SourceReactionIcon from './SourceReactionIcon';
import { sourcePostCommands } from '../utils/sourceCommands.mjs';
import { isCareerPost } from '../utils/jobSummary.mjs';
import { originalSourceUrl, sendSourceInteraction, useSourceCapability, useSourceInteractionIdentity } from './ConnectedPostActions';
import { POST_ENGAGEMENT_EVENT, publishPostEngagement } from '../api/postEngagement.mjs';
import useBlueskyPostEngagement from './useBlueskyPostEngagement';

// The same post can be mounted in a feed and a viewer at the same time.
const pendingLikes = new Set();

export default function PostLikes({ post, onPostUpdated, menuItem = false, compact = true }) {
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
  const commands = sourcePostCommands(external ? post.source : 'uficonnect');
  const label = commands.metric || 'reactions';
  const provider = external ? (capability?.label || postSource(post).label) : 'UFIConnect';
  const sourceUrl = originalSourceUrl(post);
  const action = commands.reaction;
  const actionLabel = liked ? commands.undoReaction : action;
  const actionVerb = action?.toLowerCase();
  const canLike = Boolean(profile?.id && (!external || (sourceUrl && capability?.connected && capability?.like)));
  useBlueskyPostEngagement({ post, identity, isCurrent, enabled: Boolean(profile?.id && capability?.connected), onState: patch => {
    if (inFlight.current?.identity === identity) return;
    setState({ identity, liked: patch.sourceLikedByMe, count: patch.sourceLikesCount });
    onPostUpdated?.({ id: post.id, ...patch });
  } });
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
    if (!isCurrent() || !canLike || inFlight.current?.identity === identity || pendingLikes.has(identity)) return;
    const desired = !liked;
    const requestId = retry.current?.identity === identity && retry.current.liked === desired ? retry.current.requestId : crypto.randomUUID();
    retry.current = { identity, liked: desired, requestId };
    const request = { identity, requestId };
    inFlight.current = request;
    pendingLikes.add(identity);
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
        const confirmedLiked = data.likedByMe ?? data.post?.likedByMe;
        const confirmedCount = data.likesCount ?? data.post?.likesCount;
        if (typeof confirmedLiked !== 'boolean' || !Number.isSafeInteger(confirmedCount) || confirmedCount < 0) throw new Error('Like was not confirmed.');
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
      showToast(error.response?.data?.message || `The ${actionVerb} could not be confirmed. Check the original post before retrying.`, 'error');
    } finally { pendingLikes.delete(identity); if (inFlight.current === request) inFlight.current = null; }
  }

  const countLabel = count === null ? `${label} unavailable` : `${count.toLocaleString()} ${label}`;
  const visibleCount = count === null ? '—' : compact && !menuItem
    ? count.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 0 }) : count.toLocaleString();
  if (!action || external && isCareerPost(post)) return null;
  const contents = <><SourceReactionIcon kind={commands.icon} active={liked} /><span className="post-chrome-like-count" aria-hidden="true">{menuItem && `${actionLabel} · `}{visibleCount}{(!compact || menuItem) && ` ${label}`}</span></>;
  let control;
  if (!profile?.id) control = <Link className="post-chrome-action" to="/login" aria-label={`Sign in to ${actionVerb}, ${countLabel}`} title={`Sign in to ${actionVerb}`} onClick={event => event.stopPropagation()}>{contents}</Link>;
  else if (external && capability?.reconnectRequired) control = <Link className="post-chrome-action" to={`/connected-accounts?connect=${encodeURIComponent(post.source)}`} aria-label={`Reconnect ${provider} to ${actionVerb}, ${countLabel}`} title={`Reconnect ${provider} to ${actionVerb}`} onClick={event => event.stopPropagation()}>{contents}</Link>;
  else if (external && capability && !capability.like && sourceUrl) control = <a className="post-chrome-action" href={sourceUrl} target="_blank" rel="noopener noreferrer" title={`Open ${provider} to ${actionVerb}`} aria-label={`Open ${provider} to ${actionVerb}, ${countLabel}`} onClick={event => event.stopPropagation()}>{contents}</a>;
  else if (external && capability && !capability.connected) control = <Link className="post-chrome-action" data-locked="true" to="/connected-accounts?interactions=1" aria-label={`Connect ${provider} to ${actionVerb}, ${countLabel}`} title={`Connect ${provider} to ${actionVerb}`} onClick={event => event.stopPropagation()}>{contents}</Link>;
  else control = <button type="button" className="post-chrome-action" disabled={!canLike || Boolean(own?.busy)} aria-pressed={liked} aria-label={`${external ? `${actionLabel} on ${provider}` : actionLabel}, ${countLabel}`} title={external ? `${actionLabel} on ${provider}` : actionLabel} onClick={toggle}>{contents}</button>;
  if (compact && !menuItem) control = cloneElement(control, { title: `${control.props.title}. ${countLabel}` });
  if (menuItem) return cloneElement(control, { role: 'menuitem', className: `${control.props.className} video-feed-menu-action` });
  return <span className="post-chrome-like post-chrome-like-counted" data-reaction={commands.icon} title={`${provider}: ${countLabel}`}>{control}</span>;
}
