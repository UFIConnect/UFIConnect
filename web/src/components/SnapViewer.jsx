import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ChevronLeft, X, ExternalLink, Trash2, Flag, Globe2, Users } from 'lucide-react';
import { postProfileLink, safePostLink } from '../../../backend/post-links.mjs';
import { SOURCE_META } from './sourceMeta';
import { isExternalSnap, snapAvailabilityLabel, snapPlaybackInfo } from './snapRanking.mjs';
import BrandIcon, { hasBrandIcon } from './BrandIcon';
import { PostAvatar, postTimes } from './PostCardChrome';
import { HlsVideoPlayer, youTubeEmbedUrl } from './videoMedia';
import { officialSnapEmbedUrl } from '../utils/snapSourcePlayer.mjs';
import { officialTwitchClipId } from '../utils/sourceMediaPolicy.mjs';
import TwitchClipPlayer from './TwitchClipPlayer';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';

export default function SnapViewer({ items, index, profile, now, onChange, onClose, onDelete, onReport }) {
  const dialog = useRef(null), mounted = useRef(true), titleId = useId();
  const gesture = useRef({ touch: null, wheelDelta: 0, wheelAt: 0, movedAt: 0 });
  const [failed, setFailed] = useState(false), [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false), [error, setError] = useState('');
  const [transition, setTransition] = useState(null);
  const snap = items[index], author = snap.author?.name || 'UFIConnect member';
  const profileLink = postProfileLink(snap, profile?.id), original = safePostLink(snap.sourceUrl);
  const source = SOURCE_META[snap.source]?.label || snap.source;
  const authorPost = { ...snap, author: { ...snap.author, name: author, avatarUrl: safePostLink(snap.author?.avatarUrl) } };
  const posted = postTimes(snap);
  const playback = snapPlaybackInfo(snap);
  const twitchClip = playback.kind === 'source' && snap.source === 'twitch' && (officialTwitchClipId(snap.sourceUrl) || officialTwitchClipId(snap.mediaUrl));
  const sourceEmbedCandidate = playback.kind === 'source' ? officialSnapEmbedUrl(snap) : null;
  const sourceEmbed = sourceEmbedCandidate && typeof window !== 'undefined' && new URL(sourceEmbedCandidate).origin !== window.location.origin ? sourceEmbedCandidate : null;
  const mediaKey = `${snap.source}:${snap.id}`;
  const identity = String(profile?.id || 'guest');
  const activeTransition = transition?.identity === identity && transition.to === mediaKey ? transition : null;
  const canDelete = onDelete && snap.source === 'uficonnect' && profile?.id && (snap.owned || String(snap.author?.id || snap.authorId) === String(profile.id));
  useLockBodyScroll();
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => { mounted.current = false; if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    setFailed(false); setConfirmDelete(false); setError('');
    gesture.current.touch = null; gesture.current.wheelDelta = 0;
  }, [snap.id, snap.source]);
  useEffect(() => {
    if (!transition) return undefined;
    if (transition.identity !== identity || transition.to !== mediaKey) { setTransition(null); return undefined; }
    const timer = window.setTimeout(() => setTransition(current => current === transition ? null : current), 560);
    return () => window.clearTimeout(timer);
  }, [transition, identity, mediaKey]);
  function goTo(nextIndex) {
    if (deleting || confirmDelete || nextIndex === index || !items[nextIndex]) return false;
    const next = items[nextIndex];
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const poster = playback.kind === 'image' ? playback.mediaUrl : playback.poster;
    // The outgoing cube face is a static preview, never a second player. Its
    // identity and target guards remove it synchronously on account changes.
    setTransition(reduceMotion ? null : {
      identity, to: `${next.source}:${next.id}`, direction: nextIndex > index ? 'forward' : 'backward',
      poster: snap.source === 'uficonnect' && !profile?.id ? null : poster,
    });
    gesture.current.movedAt = Date.now();
    gesture.current.wheelDelta = 0;
    onChange(next);
    return true;
  }
  function move(direction) { return goTo(index + direction); }
  function canGesture(target) {
    if (deleting || confirmDelete || target.closest?.('video, iframe, .twitch-clip-player, a, button, input, textarea, select, [contenteditable="true"]')) return false;
    return !target.closest?.('.snap-viewer-details') || Boolean(target.closest?.('.snap-viewer-navigation'));
  }
  function scrollSnap(event) {
    if (!canGesture(event.target) || event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const current = gesture.current, time = Date.now();
    if (time - current.movedAt < 500) { current.wheelDelta = 0; return; }
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? event.currentTarget.clientHeight : 1);
    if (time - current.wheelAt > 200 || Math.sign(delta) !== Math.sign(current.wheelDelta)) current.wheelDelta = 0;
    current.wheelAt = time;
    current.wheelDelta += delta;
    if (Math.abs(current.wheelDelta) >= 70) move(Math.sign(current.wheelDelta));
  }
  function startSwipe(event) {
    gesture.current.touch = null;
    if (!canGesture(event.target) || event.touches.length !== 1) return;
    const touch = event.touches[0];
    gesture.current.touch = { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: Date.now() };
  }
  function endSwipe(event) {
    const start = gesture.current.touch;
    gesture.current.touch = null;
    if (!start || !canGesture(event.target) || event.touches.length || Date.now() - start.time > 900 || Date.now() - gesture.current.movedAt < 500) return;
    const touch = Array.from(event.changedTouches).find(item => item.identifier === start.id);
    if (!touch) return;
    const vertical = start.y - touch.clientY, horizontal = start.x - touch.clientX;
    if (Math.abs(vertical) >= 55 && Math.abs(vertical) > Math.abs(horizontal) * 1.2) move(Math.sign(vertical));
  }
  const swipeHandlers = {
    onTouchStart: startSwipe, onTouchEnd: endSwipe,
    onTouchMove: event => { if (event.touches.length !== 1) gesture.current.touch = null; },
    onTouchCancel: () => { gesture.current.touch = null; },
  };
  async function remove() {
    if (deleting || !canDelete || !confirmDelete) return;
    setDeleting(true); setError('');
    try { await onDelete(snap.id); if (mounted.current) onClose(); }
    catch (failure) { if (mounted.current) { setError(failure.response?.data?.message || 'Could not delete this snap. Please try again.'); setDeleting(false); } }
  }
  return createPortal(<dialog ref={dialog} className="snap-viewer snap-viewer-feed" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!deleting) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !deleting) onClose(); }}
    onKeyDown={event => {
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey
        || (!event.target.closest?.('.snap-viewer-topbar') && !canGesture(event.target))) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    }}>
    <div className="snap-viewer-inner">
      <div className="snap-viewer-topbar" onWheel={scrollSnap} {...swipeHandlers}><strong>Snaps</strong><span className="snap-viewer-swipe-hint">Swipe up or down</span><button type="button" className="snap-dialog-icon" disabled={deleting} onClick={onClose} aria-label="Close snap" autoFocus><X size={22} /></button></div>
      <div className={`snap-viewer-media${twitchClip ? ' snap-viewer-media-twitch' : ''}`} tabIndex={0} role="region" aria-label="Snap media"
        onWheel={scrollSnap} {...swipeHandlers}
        onPointerDown={event => { if (canGesture(event.target)) event.currentTarget.focus({ preventScroll: true }); }}>
        <div key={mediaKey} className="snap-viewer-cube" data-cube-direction={activeTransition?.direction}
          onAnimationEnd={event => { if (event.target === event.currentTarget) setTransition(current => current?.to === mediaKey ? null : current); }}>
          {activeTransition && <div className="snap-viewer-cube-outgoing" aria-hidden="true" inert>
            {activeTransition.poster && <img src={activeTransition.poster} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} />}
          </div>}
          <div className="snap-viewer-cube-current">
        {failed ? <p role="status">This snap’s media could not load.{original && <a href={original} target="_blank" rel="noopener noreferrer">Open on {source}</a>}</p>
        : twitchClip ? <TwitchClipPlayer key={mediaKey} post={snap} title={`${source} clip by ${author}`} />
        : playback.kind === 'youtube' ? <iframe key={mediaKey} src={youTubeEmbedUrl(playback.id, { autoplay: '0' })} title={`${source} clip by ${author}`} referrerPolicy="strict-origin-when-cross-origin" allow="encrypted-media; fullscreen; picture-in-picture" allowFullScreen onError={() => setFailed(true)} />
        : playback.kind === 'source' && sourceEmbed ? <iframe key={mediaKey} src={sourceEmbed} title={`${source} post by ${author}`} referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation" allow="encrypted-media; fullscreen; picture-in-picture" allowFullScreen onError={() => setFailed(true)} />
        : playback.kind === 'source' ? <div className="snap-viewer-source-preview">{playback.poster && <img src={playback.poster} alt={snap.caption || `${author}'s source clip`} referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} />}{playback.original ? <a href={playback.original} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />Watch on {source}</a> : <p role="status">Open this clip on its original source.</p>}</div>
        : playback.kind === 'hls' ? <HlsVideoPlayer key={mediaKey} src={playback.mediaUrl} poster={playback.poster} autoPlay={!isExternalSnap(snap)} muted loop={false} onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        : playback.kind === 'file' ? <video key={mediaKey} src={playback.mediaUrl} poster={playback.poster || undefined} controls autoPlay={!isExternalSnap(snap)} muted playsInline preload="metadata" onError={() => setFailed(true)} />
        : playback.mediaUrl ? <img src={playback.mediaUrl} alt={snap.caption || `${author}'s snap`} referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <p role="status">This snap’s media could not load.</p>}
          </div>
        </div>
      </div>
      <section className="snap-viewer-details" aria-label="Snap details">
        <header><div className="snap-social-header">
          <PostAvatar post={authorPost} member={snap.source === 'uficonnect'} />
          <div className="snap-viewer-author snap-social-identity"><strong id={titleId} className="snap-social-name post-chrome-name">{profileLink?.to ? <Link to={profileLink.to} onClick={onClose}>{author}</Link> : profileLink?.href && !profileLink.fallback ? <a href={profileLink.href} target="_blank" rel="noopener noreferrer">{author}</a> : author}</strong>
            <span className="snap-viewer-source-details"><span className="snap-source-mark" aria-hidden="true">{hasBrandIcon(snap.source) ? <BrandIcon platform={snap.source} size={16} /> : <b>{source.slice(0, 2)}</b>}</span><span>{source} · {snapAvailabilityLabel(snap, now)}</span></span>
            {posted && <time className="snap-social-meta" dateTime={posted.iso} title={posted.full} aria-label={posted.full}>{posted.relative}</time>}
          </div>
        </div></header>
      {snap.caption && <p className="snap-viewer-caption">{snap.caption}</p>}
      {snap.source === 'uficonnect' && <p className="snap-viewer-audience">{snap.visibility === 'followers' ? <><Users size={13} />Followers only</> : <><Globe2 size={13} />Public</>}</p>}
      {error && <p className="snap-viewer-error" role="alert">{error}</p>}
      <footer><div className="snap-viewer-navigation" role="group" aria-label="Snap navigation" onWheel={scrollSnap} {...swipeHandlers}><button type="button" disabled={index === 0 || deleting || confirmDelete} onClick={() => move(-1)} aria-label="Previous snap"><ChevronLeft size={20} /></button><span aria-live="polite" title="Swipe up or down to change snaps">{index + 1} / {items.length}</span><input type="range" className="snap-viewer-position" aria-label="Snap position" min="1" max={items.length} step="1" value={index + 1} aria-valuetext={`${index + 1} of ${items.length} snaps`} disabled={items.length < 2 || deleting || confirmDelete} onChange={event => goTo(Number(event.target.value) - 1)} /></div>
        <div className="snap-viewer-actions">{original && <a className="post-chrome-action" href={original} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />Open on {source}</a>}
          {onReport && <button type="button" className="post-chrome-action" disabled={deleting} onClick={() => onReport(snap)} aria-label="Report this snap"><Flag size={16} />Report</button>}
          {canDelete && (confirmDelete ? <><button type="button" className="post-chrome-action" disabled={deleting} onClick={remove}>{deleting ? 'Deleting…' : 'Delete snap'}</button><button type="button" className="post-chrome-action" disabled={deleting} onClick={() => setConfirmDelete(false)}>Cancel</button></> : <button type="button" className="post-chrome-action" onClick={() => setConfirmDelete(true)} aria-label="Delete this snap"><Trash2 size={16} />Delete</button>)}</div>
      </footer>
      </section>
    </div>
  </dialog>, document.body);
}
