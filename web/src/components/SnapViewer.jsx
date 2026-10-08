import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { MoreHorizontal, X, ExternalLink, Trash2, Flag, Globe2, Users } from 'lucide-react';
import { postProfileLink, safePostLink } from '../../../backend/post-links.mjs';
import { SOURCE_META } from './sourceMeta';
import { isExternalSnap, snapAvailabilityLabel, snapPlaybackInfo } from './snapRanking.mjs';
import BrandIcon, { hasBrandIcon } from './BrandIcon';
import { OpenOnSource, postTimes } from './PostCardChrome';
import SnapAvatar from './SnapAvatar';
import { sourcePostMenuItems } from '../utils/sourcePostMenu.mjs';
import { HlsVideoPlayer, youTubeEmbedUrl } from './videoMedia';
import { officialSnapEmbedUrl } from '../utils/snapSourcePlayer.mjs';
import { officialTwitchClipId } from '../utils/sourceMediaPolicy.mjs';
import TwitchClipPlayer from './TwitchClipPlayer';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';

export default function SnapViewer({ items, index, profile, now, onChange, onClose, onDelete, onReport }) {
  const dialog = useRef(null), mounted = useRef(true), titleId = useId();
  const cube = useRef(null);
  const menuWrap = useRef(null), menuButton = useRef(null), menuPanel = useRef(null);
  const menuId = useId();
  const gesture = useRef({ touch: null, pointer: null, wheelDelta: 0, wheelAt: 0, movedAt: 0 });
  const [failed, setFailed] = useState(false), [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false), [error, setError] = useState('');
  const [transition, setTransition] = useState(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const snap = items[index], author = snap.author?.name || 'UFIConnect member';
  const profileLink = postProfileLink(snap, profile?.id), original = safePostLink(snap.sourceUrl);
  const source = SOURCE_META[snap.source]?.label || snap.source;
  const authorPost = { ...snap, author: { ...snap.author, name: author, avatarUrl: safePostLink(snap.author?.avatarUrl) } };
  const authorPhotos = [...(Array.isArray(snap.author?.avatarUrls) ? snap.author.avatarUrls : []), authorPost.author.avatarUrl];
  const posted = postTimes(snap);
  const playback = snapPlaybackInfo(snap);
  const twitchClip = playback.kind === 'source' && snap.source === 'twitch' && (officialTwitchClipId(snap.sourceUrl) || officialTwitchClipId(snap.mediaUrl));
  const sourceEmbedCandidate = playback.kind === 'source' ? officialSnapEmbedUrl(snap) : null;
  const sourceEmbed = sourceEmbedCandidate && typeof window !== 'undefined' && new URL(sourceEmbedCandidate).origin !== window.location.origin ? sourceEmbedCandidate : null;
  const mediaKey = `${snap.source}:${snap.id}`;
  const identity = String(profile?.id || 'guest');
  const activeTransition = transition?.identity === identity && transition.to === mediaKey ? transition : null;
  const canDelete = onDelete && snap.source === 'uficonnect' && profile?.id && (snap.owned || String(snap.author?.id || snap.authorId) === String(profile.id));
  const sourceItems = snap.source === 'uficonnect' ? [] : sourcePostMenuItems(snap).filter(item => item.key !== 'original'
    && safePostLink(item.href) && (snap.source !== 'youtube' || playback.kind === 'youtube'));
  useLockBodyScroll();
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => { mounted.current = false; if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    setFailed(false); setConfirmDelete(false); setError('');
    gesture.current.touch = null; gesture.current.pointer = null; gesture.current.wheelDelta = 0;
  }, [snap.id, snap.source, identity]);
  useEffect(() => {
    // A non-passive listener consumes viewer scrolling before the browser can
    // move the page or history. Player/control input stays native.
    const surfaces = Array.from(dialog.current?.querySelectorAll('.snap-viewer-topbar, .snap-viewer-media') || []);
    surfaces.forEach(element => element.addEventListener('wheel', scrollSnap, { passive: false }));
    return () => surfaces.forEach(element => element.removeEventListener('wheel', scrollSnap));
  });
  useEffect(() => {
    if (!transition) return undefined;
    if (transition.identity !== identity || transition.to !== mediaKey) { setTransition(null); return undefined; }
    const timer = window.setTimeout(() => setTransition(current => current === transition ? null : current), 560);
    return () => window.clearTimeout(timer);
  }, [transition, identity, mediaKey]);
  useLayoutEffect(() => {
    const element = cube.current;
    if (!element || !activeTransition) return;
    // Restart consecutive turns without remounting the focused navigation or
    // media region. Individual players retain their per-snap keys below.
    element.style.animation = 'none';
    void element.offsetWidth;
    element.style.removeProperty('animation');
  }, [activeTransition]);
  function closeOptions(restoreFocus = true) {
    setOptionsOpen(false); setConfirmDelete(false); setError('');
    if (restoreFocus) menuButton.current?.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (!optionsOpen) return undefined;
    menuPanel.current?.querySelector('a, button:not(:disabled), input:not(:disabled)')?.focus({ preventScroll: true });
    const outside = event => {
      if (!deleting && !menuWrap.current?.contains(event.target) && !menuPanel.current?.contains(event.target)) closeOptions(false);
    };
    const escape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      if (!deleting) closeOptions();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [optionsOpen, deleting]);
  function goTo(nextIndex, direction) {
    if (deleting || confirmDelete || nextIndex === index || !items[nextIndex]) return false;
    const next = items[nextIndex];
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const poster = playback.kind === 'image' ? playback.mediaUrl : playback.poster;
    // The outgoing cube face is a static preview, never a second player. Its
    // identity and target guards remove it synchronously on account changes.
    setTransition(reduceMotion ? null : {
      identity, to: `${next.source}:${next.id}`, direction: direction > 0 ? 'forward' : 'backward',
      poster: snap.source === 'uficonnect' && !profile?.id ? null : poster,
      author, avatars: authorPhotos, source, availability: snapAvailabilityLabel(snap, now),
      caption: snap.caption || '', posted: posted?.relative || '',
      audience: snap.source === 'uficonnect' ? snap.visibility === 'followers' ? 'Followers only' : 'Public' : '',
    });
    gesture.current.movedAt = Date.now();
    gesture.current.wheelDelta = 0;
    onChange(next);
    return true;
  }
  function move(direction) {
    if (items.length < 2) return false;
    return goTo((index + direction + items.length) % items.length, direction);
  }
  function canGesture(target) {
    return !optionsOpen && !deleting && !confirmDelete
      && !target.closest?.('video, iframe, .twitch-clip-player, .snap-viewer-media-twitch, .snap-viewer-menu, .snap-viewer-details, a, button, input, textarea, select, [contenteditable="true"]');
  }
  function scrollSnap(event) {
    if (!canGesture(event.target) || event.ctrlKey || event.metaKey) return;
    if (!Number.isFinite(event.deltaY) || !Number.isFinite(event.deltaX) || !event.deltaY && !event.deltaX) return;
    if (event.cancelable) event.preventDefault();
    const current = gesture.current, time = Date.now();
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) { current.wheelDelta = 0; return; }
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
    if (Math.abs(horizontal) >= 55 && Math.abs(horizontal) > Math.abs(vertical) * 1.2) move(Math.sign(horizontal));
  }
  function startDrag(event) {
    gesture.current.pointer = null;
    if (!canGesture(event.target)) return;
    event.currentTarget.focus?.({ preventScroll: true });
    if (event.pointerType !== 'mouse' || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    gesture.current.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, time: Date.now() };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* A cancelled pointer needs no capture. */ }
    event.preventDefault();
  }
  function endDrag(event) {
    const start = gesture.current.pointer;
    gesture.current.pointer = null;
    if (!start || start.id !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!canGesture(event.target) || Date.now() - start.time > 2000 || Date.now() - gesture.current.movedAt < 500) return;
    const horizontal = start.x - event.clientX, vertical = start.y - event.clientY;
    if (Math.abs(horizontal) >= 55 && Math.abs(horizontal) > Math.abs(vertical) * 1.2) move(Math.sign(horizontal));
  }
  const gestureHandlers = {
    onTouchStart: startSwipe, onTouchEnd: endSwipe,
    onTouchMove: event => { if (event.touches.length !== 1) gesture.current.touch = null; },
    onTouchCancel: () => { gesture.current.touch = null; },
    onPointerDown: startDrag, onPointerUp: endDrag,
    onPointerCancel: () => { gesture.current.pointer = null; },
    onLostPointerCapture: () => { gesture.current.pointer = null; },
    onDragStart: event => { if (canGesture(event.target)) event.preventDefault(); },
  };
  async function remove() {
    if (deleting || !canDelete || !confirmDelete) return;
    setDeleting(true); setError('');
    try { await onDelete(snap.id); if (mounted.current) onClose(); }
    catch (failure) { if (mounted.current) { setError(failure.response?.data?.message || 'Could not delete this snap. Please try again.'); setDeleting(false); } }
  }
  return createPortal(<dialog ref={dialog} className="snap-viewer snap-viewer-feed" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!deleting) { if (optionsOpen) closeOptions(); else onClose(); } }}
    onClick={event => { if (event.target === event.currentTarget && !deleting) onClose(); }}
    onKeyDown={event => {
      if (optionsOpen || event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey
        || (!event.target.closest?.('.snap-viewer-close') && !canGesture(event.target))) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
    }}>
    <button type="button" className="snap-dialog-icon snap-viewer-close" disabled={deleting} onClick={onClose} aria-label="Close snap" autoFocus><X size={22} /></button>
    <div ref={cube} className="snap-viewer-cube" data-cube-direction={activeTransition?.direction}
      onAnimationEnd={event => { if (event.target === event.currentTarget) setTransition(current => current?.to === mediaKey ? null : current); }}>
      {activeTransition && <div className="snap-viewer-cube-outgoing" aria-hidden="true" inert>
        <div className="snap-viewer-preview-shell">
          <div className="snap-viewer-preview-topbar"><strong>Snaps</strong><span>Swipe left or right</span></div>
          <div className="snap-viewer-preview-media">{activeTransition.poster && <img src={activeTransition.poster} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} />}</div>
          <div className="snap-viewer-preview-details">
            <div className="snap-viewer-preview-author"><SnapAvatar urls={activeTransition.avatars} className="snap-viewer-preview-avatar" /><div><strong className="snap-viewer-preview-name">{activeTransition.author}</strong><span className="snap-viewer-preview-source">{activeTransition.source} · {activeTransition.availability}</span>{activeTransition.posted && <span className="snap-viewer-preview-time">{activeTransition.posted}</span>}</div></div>
            {activeTransition.caption && <p className="snap-viewer-preview-caption">{activeTransition.caption}</p>}
            {activeTransition.audience && <p className="snap-viewer-preview-audience">{activeTransition.audience}</p>}
          </div>
        </div>
      </div>}
      <div className="snap-viewer-cube-current">
    <div className="snap-viewer-inner">
      <div className="snap-viewer-topbar" {...gestureHandlers}><strong>Snaps</strong><span className="snap-viewer-swipe-hint">Swipe left or right</span>
        <div className="snap-viewer-top-actions" role="group" aria-label="Snap commands">
          {original && <OpenOnSource post={snap} onClick={() => closeOptions(false)} />}
          <div ref={menuWrap} className="snap-viewer-menu-wrap post-chrome-more"><button ref={menuButton} type="button" className="post-chrome-action"
            aria-label="Snap options" title="Snap options" aria-expanded={optionsOpen} aria-controls={menuId} disabled={deleting}
            onClick={() => { if (optionsOpen) closeOptions(); else setOptionsOpen(true); }}
            onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOptionsOpen(true); } }}><MoreHorizontal size={20} aria-hidden="true" /></button></div>
        </div>
      </div>
      <div className={`snap-viewer-media${twitchClip ? ' snap-viewer-media-twitch' : ''}`} tabIndex={0} role="region" aria-label="Snap media"
        aria-description="Scroll up or down, swipe left or right, or use the left and right arrow keys to view snaps."
        aria-keyshortcuts="ArrowLeft ArrowRight" {...gestureHandlers}>
        {failed ? <p role="status">This snap’s media could not load.{original && <a href={original} target="_blank" rel="noopener noreferrer">Open on {source}</a>}</p>
        : twitchClip ? <TwitchClipPlayer key={mediaKey} post={snap} title={`${source} clip by ${author}`} />
        : playback.kind === 'youtube' ? <iframe key={mediaKey} src={youTubeEmbedUrl(playback.id, { autoplay: '0' })} title={`${source} clip by ${author}`} referrerPolicy="strict-origin-when-cross-origin" allow="encrypted-media; fullscreen; picture-in-picture" allowFullScreen onError={() => setFailed(true)} />
        : playback.kind === 'source' && sourceEmbed ? <iframe key={mediaKey} src={sourceEmbed} title={`${source} post by ${author}`} referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation" allow="encrypted-media; fullscreen; picture-in-picture" allowFullScreen onError={() => setFailed(true)} />
        : playback.kind === 'source' ? <div key={mediaKey} className="snap-viewer-source-preview">{playback.poster && <img src={playback.poster} alt={snap.caption || `${author}'s source clip`} referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} />}{playback.original ? <a href={playback.original} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />Watch on {source}</a> : <p role="status">Open this clip on its original source.</p>}</div>
        : playback.kind === 'hls' ? <HlsVideoPlayer key={mediaKey} src={playback.mediaUrl} poster={playback.poster} autoPlay={!isExternalSnap(snap)} muted loop={false} onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        : playback.kind === 'file' ? <video key={mediaKey} src={playback.mediaUrl} poster={playback.poster || undefined} controls autoPlay={!isExternalSnap(snap)} muted playsInline preload="metadata" onError={() => setFailed(true)} />
        : playback.mediaUrl ? <img key={mediaKey} src={playback.mediaUrl} alt={snap.caption || `${author}'s snap`} referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <p role="status">This snap’s media could not load.</p>}
      </div>
      <section className="snap-viewer-details" aria-label="Snap details">
        <header><div className="snap-social-header">
          <SnapAvatar urls={authorPhotos} source={snap.source} member={snap.source === 'uficonnect'} badge className="post-chrome-avatar" />
          <div className="snap-viewer-author snap-social-identity"><strong id={titleId} className="snap-social-name post-chrome-name">{profileLink?.to ? <Link to={profileLink.to} onClick={onClose}>{author}</Link> : profileLink?.href && !profileLink.fallback ? <a href={profileLink.href} target="_blank" rel="noopener noreferrer">{author}</a> : author}</strong>
            <span className="snap-viewer-source-details"><span className="snap-source-mark" aria-hidden="true">{hasBrandIcon(snap.source) ? <BrandIcon platform={snap.source} size={16} /> : <b>{source.slice(0, 2)}</b>}</span><span>{source} · {snapAvailabilityLabel(snap, now)}</span></span>
            {posted && <time className="snap-social-meta" dateTime={posted.iso} title={posted.full} aria-label={posted.full}>{posted.relative}</time>}
          </div>
        </div></header>
      {snap.caption && <p className="snap-viewer-caption">{snap.caption}</p>}
      {snap.source === 'uficonnect' && <p className="snap-viewer-audience">{snap.visibility === 'followers' ? <><Users size={13} />Followers only</> : <><Globe2 size={13} />Public</>}</p>}
      </section>
    </div>
    {optionsOpen && dialog.current && createPortal(<div ref={menuPanel} id={menuId} className="snap-viewer-menu post-chrome-menu" role="group" aria-label="Snap options"
      onKeyDown={event => event.stopPropagation()}>
      {sourceItems.map(item => <a key={item.key} href={safePostLink(item.href)} target="_blank" rel="noopener noreferrer" onClick={() => closeOptions(false)}>{item.label}{item.detail && <small>{item.detail}</small>}</a>)}
      <button type="button" disabled={items.length < 2 || deleting || confirmDelete} onClick={() => move(-1)} aria-label="Previous snap">Previous snap</button>
      {onReport && <button type="button" disabled={deleting} onClick={() => { closeOptions(false); onReport(snap); }} aria-label="Report this snap"><Flag size={16} aria-hidden="true" />Report</button>}
      {canDelete && (confirmDelete ? <div className="snap-viewer-delete-confirm"><p>Delete this snap?</p><button type="button" className="post-chrome-menu-danger" disabled={deleting} onClick={remove} autoFocus>{deleting ? 'Deleting…' : 'Delete snap'}</button><button type="button" disabled={deleting} onClick={() => { setConfirmDelete(false); setError(''); window.requestAnimationFrame(() => menuPanel.current?.querySelector('[aria-label="Delete this snap"]')?.focus({ preventScroll: true })); }}>Cancel</button></div>
        : <button type="button" className="post-chrome-menu-danger" onClick={() => setConfirmDelete(true)} aria-label="Delete this snap"><Trash2 size={16} aria-hidden="true" />Delete</button>)}
      {error && <p className="snap-viewer-error" role="alert">{error}</p>}
    </div>, dialog.current)}
      </div>
    </div>
  </dialog>, document.body);
}
