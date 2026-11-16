import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { X, ChevronLeft, ChevronRight, Trash2, Flag, Globe2, Users, Info, Share2 } from 'lucide-react';
import { postProfileLink, safePostLink } from '../../../backend/post-links.mjs';
import { SOURCE_META } from './sourceMeta';
import { isExternalSnap, snapAvailabilityLabel, snapPlaybackInfo } from './snapRanking.mjs';
import { snapFilterStyle, SNAP_MAX_OVERLAY } from './snapEffects.mjs';
import BrandIcon, { hasBrandIcon } from './BrandIcon';
import { OpenOnSource, postTimes, CommentIcon } from './PostCardChrome';
import PostOptionsPopover from './PostOptionsPopover';
import PostLikes from './PostLikes';
import { sourcePostCommands } from '../utils/sourceCommands.mjs';
import { SavePostButton } from './SaveButtons';
import { SnapComments, NativeSnapLike, SnapShareButton, useNativeSnapEngagement, useSnapShare } from './SnapInteractions';
import SnapAvatar from './SnapAvatar';
import { sourcePostMenuItems } from '../utils/sourcePostMenu.mjs';
import { HlsVideoPlayer } from './videoMedia';
import { playMedia } from '../utils/mediaAutoplay.mjs';
import { officialSnapEmbedUrl } from '../utils/snapSourcePlayer.mjs';
import { officialTwitchClipId } from '../utils/sourceMediaPolicy.mjs';
import TwitchClipPlayer from './TwitchClipPlayer';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';
import useNativePlayerSettings from '../hooks/useNativePlayerSettings';
import useYouTubeSnapPlayback from '../hooks/useYouTubeSnapPlayback';
import YouTubeSettingsDialog from './YouTubeSettingsDialog';
import MediaPlaybackControls from './MediaPlaybackControls';
import useMediaWatchSession from '../hooks/useMediaWatchSession';

const EMPTY_NATIVE_PLAYBACK = { ready: false, paused: true, currentTime: 0, duration: 0 };
const SNAP_SOUND_KEY = 'ufc_snap_wants_sound';

function useSnapNativePlayback({ getVideo, enabled, mediaKey, forcePause, muted, onMutedChange }) {
  const identity = useRef(null), binding = useRef(null);
  const [snapshot, setSnapshot] = useState(null);
  identity.current = { getVideo, enabled, mediaKey, forcePause, muted };
  const owns = owner => Boolean(owner && binding.current === owner && identity.current.enabled
    && identity.current.mediaKey === owner.mediaKey && identity.current.getVideo() === owner.video && owner.video.isConnected);
  function play(owner) {
    // Keep blocked clips paused with sound selected so the Play button can
    // retry audibly from a direct user gesture.
    void playMedia(owner.video, { muted: identity.current.muted, fallbackToMuted: false,
      isCurrent: () => owns(owner) && !document.hidden && !identity.current.forcePause }).then(() => read(owner));
  }
  function read(owner) {
    if (!owns(owner)) return;
    const video = owner.video;
    if (document.hidden || identity.current.forcePause) {
      if (document.hidden) owner.autoplayAttempted = true;
      if (!video.paused) { video.pause(); return; }
    } else if (!owner.autoplayAttempted && (video.getAttribute('src') || video.srcObject || video.readyState >= 1)) {
      // One autoplay attempt belongs to this opened clip. Chrome/visibility pauses
      // and an explicit user pause never re-arm it for the same media.
      owner.autoplayAttempted = true;
      play(owner);
    }
    const playback = { ready: true, paused: video.paused || video.ended, muted: video.muted || video.volume === 0,
      currentTime: Number.isFinite(video.currentTime) && video.currentTime >= 0 ? video.currentTime : 0,
      duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0 };
    setSnapshot(previous => previous?.owner === owner && Object.keys(playback).every(key => previous.playback[key] === playback[key])
      ? previous : { owner, playback });
  }
  useLayoutEffect(() => {
    const video = enabled ? getVideo() : null;
    if (video && binding.current?.video === video && binding.current.mediaKey === mediaKey) return;
    binding.current?.cleanup(); binding.current = null;
    if (!video) { setSnapshot(previous => previous === null ? previous : null); return; }
    const owner = { video, mediaKey, autoplayAttempted: document.hidden };
    const update = () => read(owner);
    const events = ['play', 'playing', 'pause', 'ended', 'volumechange', 'timeupdate', 'loadedmetadata', 'durationchange', 'seeking', 'seeked', 'emptied'];
    events.forEach(name => video.addEventListener(name, update));
    owner.cleanup = () => { events.forEach(name => video.removeEventListener(name, update)); video.pause(); };
    binding.current = owner;
    read(owner);
  });
  useEffect(() => () => { binding.current?.cleanup(); binding.current = null; }, []);
  useEffect(() => {
    const pauseBlocked = () => {
      const owner = binding.current;
      if (!owns(owner)) return;
      if (document.hidden || identity.current.forcePause) {
        if (document.hidden) owner.autoplayAttempted = true;
        owner.video.pause();
      }
      read(owner);
    };
    pauseBlocked();
    document.addEventListener('visibilitychange', pauseBlocked);
    return () => document.removeEventListener('visibilitychange', pauseBlocked);
  }, [forcePause, enabled, mediaKey]);
  const togglePlay = () => {
    const owner = binding.current;
    if (!owns(owner) || owner.mediaKey !== mediaKey || document.hidden || identity.current.forcePause) return;
    owner.autoplayAttempted = true;
    if (owner.video.paused || owner.video.ended) play(owner);
    else owner.video.pause();
  };
  const toggleMute = () => {
    const owner = binding.current;
    if (!owns(owner) || owner.mediaKey !== mediaKey) return;
    const silent = owner.video.muted || owner.video.volume === 0;
    if (silent && owner.video.volume === 0) owner.video.volume = 1;
    owner.video.muted = !silent;
    onMutedChange(!silent);
    read(owner);
  };
  const seek = seconds => {
    const owner = binding.current;
    if (!owns(owner) || owner.mediaKey !== mediaKey || document.hidden || identity.current.forcePause || !Number.isFinite(seconds)) return;
    const video = owner.video;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    let target = Math.max(0, Math.min(video.duration, seconds));
    // HLS windows may not begin at zero or contain the entire duration.
    // Seek only within an actual available range when the player exposes one.
    if (video.seekable.length) {
      let nearest = video.seekable.start(0), distance = Infinity;
      for (let i = 0; i < video.seekable.length; i++) {
        const start = video.seekable.start(i), end = video.seekable.end(i);
        const candidate = Math.max(start, Math.min(end, target));
        if (Math.abs(candidate - target) < distance) { nearest = candidate; distance = Math.abs(candidate - target); }
      }
      target = nearest;
    }
    try { video.currentTime = target; read(owner); } catch { read(owner); }
  };
  return { muted, ...(snapshot && owns(snapshot.owner) ? snapshot.playback : EMPTY_NATIVE_PLAYBACK), togglePlay, toggleMute, seek };
}

function SnapCaption({ caption }) {
  const [expanded, setExpanded] = useState(false);
  const captionId = useId();
  const hasMore = caption.length > 50;
  const preview = caption.length > 200 ? `${caption.slice(0, 200).replace(/\s+\S*$/, '').trimEnd()}…` : caption;
  return <div className="snap-viewer-caption-wrap" data-expanded={expanded ? 'true' : 'false'}>
    <p id={captionId} className="snap-viewer-caption">{expanded ? caption : preview}</p>
    {hasMore && <button type="button" className="snap-viewer-read-more" aria-expanded={expanded} aria-controls={captionId}
      onClick={() => setExpanded(value => !value)}>{expanded ? 'Show less' : 'Read more'}</button>}
  </div>;
}

export default function SnapViewer({ items, index, profile, now, onChange, onClose, onDelete, onReport }) {
  const dialog = useRef(null), mounted = useRef(true), titleId = useId();
  const cube = useRef(null);
  const nativeVideo = useRef(null);
  const menuButton = useRef(null);
  const deleteRequest = useRef(null);
  const gesture = useRef({ touch: null, pointer: null, wheelDelta: 0, wheelAt: 0, movedAt: 0 });
  const [failedPlaybackKey, setFailedPlaybackKey] = useState(null), [deleting, setDeleting] = useState(false);
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem(SNAP_SOUND_KEY) === '0'; } catch { return false; }
  });
  function changeMuted(nextMuted) {
    setMuted(nextMuted);
    try { localStorage.setItem(SNAP_SOUND_KEY, nextMuted ? '0' : '1'); } catch { /* Keep the in-memory choice. */ }
  }
  const [confirmDelete, setConfirmDelete] = useState(false), [error, setError] = useState('');
  const [transition, setTransition] = useState(null);
  const [openOptionsFor, setOpenOptionsFor] = useState(null);
  const [playerSettingsOpen, setPlayerSettingsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false), [commentsOpen, setCommentsOpen] = useState(false);
  const detailsId = useId(), commentsId = useId();
  const commentsButton = useRef(null);
  const [sourceControlsTarget, setSourceControlsTarget] = useState(null);
  const [sourceVisible, setSourceVisible] = useState(() => !document.hidden);
  const [sourceSuspendedKey, setSourceSuspendedKey] = useState(null);
  const activePlaybackKey = useRef(null);
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
  const optionsKey = `${identity}:${mediaKey}`;
  const optionsOpen = openOptionsFor === optionsKey;
  const playbackKey = `${optionsKey}:${playback.id || playback.mediaUrl || ''}`;
  const failed = failedPlaybackKey === playbackKey;
  activePlaybackKey.current = playbackKey;
  const failCurrentMedia = () => { if (activePlaybackKey.current === playbackKey) setFailedPlaybackKey(playbackKey); };
  const getNativeVideo = useCallback(() => nativeVideo.current, []);
  const nativePlayback = playback.kind === 'file' || playback.kind === 'hls';
  const nativeSettings = useNativePlayerSettings({ getVideo: getNativeVideo, enabled: nativePlayback, mediaKey: `${identity}:${mediaKey}` });
  const pauseForChrome = optionsOpen || playerSettingsOpen || commentsOpen || deleting;
  const nativeControls = useSnapNativePlayback({ getVideo: getNativeVideo, enabled: nativePlayback && !failed, mediaKey: playbackKey,
    forcePause: pauseForChrome, muted, onMutedChange: changeMuted });
  const youtubeControls = useYouTubeSnapPlayback({ enabled: playback.kind === 'youtube' && !failed, mediaKey: playbackKey,
    videoId: playback.id, title: `${source} clip by ${author}`, forcePause: pauseForChrome, muted, onMutedChange: changeMuted });
  const hasPlayback = nativePlayback || playback.kind === 'youtube';
  const controls = nativePlayback ? nativeControls : youtubeControls;
  const settingsProvider = nativePlayback ? 'native' : playback.kind === 'youtube' ? 'youtube' : 'source';
  const playerSource = playback.kind === 'youtube' ? 'YouTube' : source;
  const settingsTitle = nativePlayback && snap.source === 'uficonnect' ? 'Player settings' : `${playerSource} settings`;
  const sourceOriginal = playback.kind === 'youtube' ? `https://www.youtube.com/watch?v=${playback.id}` : playback.original || original;
  const playerSourcePost = playback.kind === 'youtube' && snap.source !== 'youtube'
    ? { ...snap, source: 'youtube', sourceUrl: sourceOriginal } : snap;
  const sourcePlayerVisible = Boolean(sourceEmbed && sourceVisible && !playerSettingsOpen && !commentsOpen && !deleting && sourceSuspendedKey !== playbackKey);
  const canOpenSettings = snap.mediaType === 'video' && (hasPlayback || Boolean(sourceOriginal));
  const playbackNotice = failed ? 'This snap’s media could not load.'
    : playback.kind === 'youtube' && youtubeControls.failed ? 'Playback controls are unavailable. Open this clip on YouTube using its source link.'
      : playback.kind === 'source' && !twitchClip ? sourceEmbed
        ? `This ${source} player uses its own controls. Additional settings are available on the source.`
        : sourceOriginal ? `Watch this clip on ${source} using its source link.` : `This clip is unavailable. Its source link was not supplied.`
      : !playback.mediaUrl && playback.kind === 'image' ? 'This snap’s media is unavailable.' : '';
  const activeTransition = transition?.identity === identity && transition.to === mediaKey ? transition : null;
  const canDelete = onDelete && snap.source === 'uficonnect' && profile?.id && (snap.owned || String(snap.author?.id || snap.authorId) === String(profile.id));
  const sourceItems = snap.source === 'uficonnect' || (snap.source === 'youtube' && playback.kind !== 'youtube')
    ? [] : sourcePostMenuItems(snap).filter(item => item.key !== 'original' && item.href);
  const share = useSnapShare(snap);
  const changeOptionsOpen = useCallback(open => {
    setOpenOptionsFor(open ? optionsKey : null);
    if (!open) { setConfirmDelete(false); setError(''); }
  }, [optionsKey]);
  const nativeEngagement = useNativeSnapEngagement({ snap, profile });
  const commentsCount = snap.source === 'uficonnect' ? nativeEngagement.commentsCount : snap.commentsCount;
  const interactionPost = { ...snap, title: snap.caption || '', content: snap.caption || '', mediaPoster: snap.thumbnailUrl };
  useMediaWatchSession({ accountId: profile?.id, mediaId: playbackKey, postId: snap.id, mediaTitle: snap.caption || 'Snap',
    providerMediaId: playback.kind === 'youtube' ? playback.id : undefined,
    hostSource: snap.source, playbackSource: playback.kind === 'youtube' ? 'youtube' : snap.source, surface: 'snaps',
    enabled: hasPlayback && controls.ready && !failed && !pauseForChrome, playing: nativePlayback ? !controls.paused : controls.playing === true,
    currentTime: controls.currentTime, duration: controls.duration, seeking: nativePlayback && nativeVideo.current?.seeking,
    rate: controls.settings?.rate || nativeSettings.settings?.rate, trackingAllowed: playback.kind !== 'youtube' || snap.madeForKids !== true,
    privacyClassification: playback.kind !== 'youtube' ? 'not_applicable' : snap.madeForKids === false ? 'not_made_for_kids' : snap.madeForKids === true ? 'made_for_kids' : 'unknown' });
  useLockBodyScroll();
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => { mounted.current = false; if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    setOpenOptionsFor(null); setDeleting(false); deleteRequest.current = null;
    setConfirmDelete(false); setError(''); setPlayerSettingsOpen(false); setDetailsOpen(false); setCommentsOpen(false);
    gesture.current.touch = null; gesture.current.pointer = null; gesture.current.wheelDelta = 0;
  }, [snap.id, snap.source, identity]);
  useEffect(() => {
    // Widgets without a playback API stop only when their official frame is
    // removed. Restoring visibility must not resume media without a new click.
    const visibility = () => {
      setSourceVisible(!document.hidden);
      if (document.hidden) setSourceSuspendedKey(playbackKey);
    };
    visibility();
    if (playerSettingsOpen || commentsOpen || deleting) setSourceSuspendedKey(playbackKey);
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, [playbackKey, playerSettingsOpen, commentsOpen, deleting]);
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
  function goTo(nextIndex, direction) {
    if (deleting || confirmDelete || nextIndex === index || !items[nextIndex]) return false;
    setFailedPlaybackKey(null);
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
      filter: snap.source === 'uficonnect' ? snap.filter : 'original',
      overlayText: snap.source === 'uficonnect' && typeof snap.overlayText === 'string' ? snap.overlayText.slice(0, SNAP_MAX_OVERLAY) : '',
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
    return !optionsOpen && !playerSettingsOpen && !commentsOpen && !deleting && !confirmDelete
      && !target.closest?.('video, iframe, .twitch-clip-player, .snap-viewer-media-twitch, .post-chrome-menu, .snap-viewer-details, a, button, input, textarea, select, [contenteditable="true"]');
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
    if (optionsOpen || playerSettingsOpen || commentsOpen || deleting || confirmDelete || event.touches.length !== 1
      || event.target.closest?.('iframe, .twitch-clip-player, .snap-viewer-media-twitch, .post-chrome-menu, .snap-viewer-playback, a, button, input, textarea, select, [contenteditable="true"]')) return;
    const touch = event.touches[0];
    const video = event.target.closest?.('video');
    if (video && touch.clientY >= video.getBoundingClientRect().bottom - 64) return;
    gesture.current.touch = { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: Date.now() };
  }
  function endSwipe(event) {
    const start = gesture.current.touch;
    gesture.current.touch = null;
    if (!start || optionsOpen || playerSettingsOpen || commentsOpen || deleting || confirmDelete || event.touches.length || Date.now() - start.time > 900 || Date.now() - gesture.current.movedAt < 500) return;
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
    if (deleteRequest.current || !canDelete || !confirmDelete) return;
    const request = {};
    deleteRequest.current = request;
    setDeleting(true); setError('');
    try {
      await onDelete(snap.id);
      if (mounted.current && deleteRequest.current === request) onClose();
    } catch (failure) {
      if (mounted.current && deleteRequest.current === request) setError(failure.response?.data?.message || 'Could not delete this snap. Please try again.');
    } finally {
      if (mounted.current && deleteRequest.current === request) {
        deleteRequest.current = null;
        setDeleting(false);
      }
    }
  }
  const options = confirmDelete && canDelete ? [
    { label: 'Cancel', keepOpen: true, onSelect: () => { setConfirmDelete(false); setError(''); } },
    { label: 'Delete snap', danger: true, busy: deleting, keepOpen: true, onSelect: remove },
  ] : [
    canOpenSettings && { label: settingsTitle, onSelect: () => setPlayerSettingsOpen(true),
      detail: nativePlayback ? 'Playback speed and available captions' : playback.kind === 'youtube' ? 'Playback speed and source playback options' : `Available playback settings on ${source}` },
    snap.source !== 'uficonnect' && share && { label: 'Share original', icon: <Share2 size={16} aria-hidden="true" />, onSelect: share },
    onReport && { label: 'Report', ariaLabel: 'Report this snap', icon: <Flag size={16} aria-hidden="true" />, onSelect: () => onReport(snap) },
    canDelete && { label: 'Delete', ariaLabel: 'Delete this snap', danger: true, keepOpen: true,
      icon: <Trash2 size={16} aria-hidden="true" />, onSelect: () => setConfirmDelete(true) },
    ...sourceItems,
    playerSourcePost !== snap && original && { label: `Original post on ${source}`, href: original },
  ];
  return createPortal(<dialog ref={dialog} className="snap-viewer snap-viewer-feed" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!deleting) { if (optionsOpen) { changeOptionsOpen(false); menuButton.current?.focus({ preventScroll: true }); } else if (commentsOpen) { setCommentsOpen(false); commentsButton.current?.focus(); } else onClose(); } }}
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
          <div className="snap-viewer-preview-media">{activeTransition.poster && <img src={activeTransition.poster} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} style={snapFilterStyle(activeTransition.filter)} />}{activeTransition.overlayText && <span className="snap-text-overlay">{activeTransition.overlayText}</span>}</div>
          <div className="snap-viewer-preview-details">
            <div className="snap-viewer-preview-author"><SnapAvatar urls={activeTransition.avatars} className="snap-viewer-preview-avatar" /><div><strong className="snap-viewer-preview-name">{activeTransition.author}</strong><span className="snap-viewer-preview-source">{activeTransition.source} · {activeTransition.availability}</span>{activeTransition.posted && <span className="snap-viewer-preview-time">{activeTransition.posted}</span>}</div></div>
            {activeTransition.caption && <p className="snap-viewer-preview-caption">{activeTransition.caption}</p>}
            {activeTransition.audience && <p className="snap-viewer-preview-audience">{activeTransition.audience}</p>}
          </div>
        </div>
      </div>}
      <div className="snap-viewer-cube-current">
    <div className="snap-viewer-inner" data-has-playback={hasPlayback ? 'true' : undefined} {...gestureHandlers}>
      <div className="snap-viewer-topbar"><strong id={titleId}>Snaps</strong>
        {items.length > 1 && <div className="snap-viewer-navigation" role="group" aria-label="Snap navigation">
          <button type="button" className="post-chrome-action" aria-label="Previous snap" disabled={deleting || confirmDelete || optionsOpen || playerSettingsOpen || commentsOpen} onClick={() => move(-1)}><ChevronLeft size={20} aria-hidden="true" /></button>
          <span className="snap-viewer-count" role="status" aria-live="polite" aria-atomic="true">{index + 1} / {items.length}</span>
          <button type="button" className="post-chrome-action" aria-label="Next snap" disabled={deleting || confirmDelete || optionsOpen || playerSettingsOpen || commentsOpen} onClick={() => move(1)}><ChevronRight size={20} aria-hidden="true" /></button>
        </div>}
        <span className="snap-viewer-swipe-hint">Swipe left or right</span>
      </div>
      <div className={`snap-viewer-media${twitchClip ? ' snap-viewer-media-twitch' : ''}`} tabIndex={0} role="region" aria-label="Snap media"
        aria-description="Scroll up or down, swipe left or right, or use the left and right arrow keys to view snaps."
        aria-keyshortcuts="ArrowLeft ArrowRight">
        {failed ? null
        : twitchClip ? <TwitchClipPlayer key={playbackKey} post={snap} title={`${source} clip by ${author}`} controlsTarget={sourceControlsTarget} forcePause={pauseForChrome} muted={muted} />
        : playback.kind === 'youtube' ? <div ref={youtubeControls.hostRef} className="snap-viewer-youtube-player" style={{ width: '100%', height: '100%' }} />
        : playback.kind === 'source' && sourcePlayerVisible ? <iframe key={playbackKey} src={sourceEmbed} title={`${source} post by ${author}`} referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation" allow="encrypted-media; fullscreen; picture-in-picture" allowFullScreen onError={failCurrentMedia} />
        : playback.kind === 'source' ? <div key={mediaKey} className="snap-viewer-source-preview">{playback.poster && <img src={playback.poster} alt={snap.caption || `${author}'s source clip`} referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} />}</div>
        : playback.kind === 'hls' ? <HlsVideoPlayer key={playbackKey} videoRef={nativeVideo} src={playback.mediaUrl} controls={false} controlsList="nodownload noplaybackrate noremoteplayback" disablePictureInPicture disableRemotePlayback autoPlay={false} muted={muted} loop={false} onError={failCurrentMedia} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        : playback.kind === 'file' ? <video key={playbackKey} ref={nativeVideo} src={playback.mediaUrl} controls={false} controlsList="nodownload noplaybackrate noremoteplayback" disablePictureInPicture disableRemotePlayback muted={muted} playsInline preload="metadata" onError={failCurrentMedia} style={snap.source === 'uficonnect' ? snapFilterStyle(snap.filter) : undefined} />
        : playback.mediaUrl ? <img key={playbackKey} src={playback.mediaUrl} alt={snap.caption || `${author}'s snap`} referrerPolicy="no-referrer" onError={failCurrentMedia} style={snap.source === 'uficonnect' ? snapFilterStyle(snap.filter) : undefined} /> : null}
        {!failed && snap.source === 'uficonnect' && typeof snap.overlayText === 'string' && snap.overlayText.trim() && <span className="snap-text-overlay">{snap.overlayText.slice(0, SNAP_MAX_OVERLAY)}</span>}
      </div>
      <div className="snap-viewer-playback">
      {hasPlayback && <MediaPlaybackControls key={playbackKey} mediaKey={playbackKey} paused={controls.paused} muted={controls.muted}
        currentTime={controls.currentTime} duration={controls.duration} onTogglePlay={controls.togglePlay} onToggleMute={controls.toggleMute}
        onSeek={controls.seek} disabled={!controls.ready || failed || pauseForChrome} />}
      <div ref={setSourceControlsTarget} className="snap-viewer-source-controls" />
      {playback.kind === 'source' && sourceEmbed && !twitchClip && !failed && <div className="snap-viewer-widget-controls" role="group" aria-label={`${source} player controls`}>
        <button type="button" className="snap-viewer-source-toggle" disabled={!sourceVisible || playerSettingsOpen || commentsOpen || deleting}
          onClick={() => setSourceSuspendedKey(sourcePlayerVisible ? playbackKey : null)}>{sourcePlayerVisible ? `Close ${source} player` : `Load ${source} player`}</button>
      </div>}
      </div>
      <section className="snap-viewer-details" aria-label="Snap details" data-expanded={detailsOpen || commentsOpen ? 'true' : 'false'}>
        {playbackNotice && <p className="snap-viewer-playback-note" role="status">{playbackNotice}</p>}
        {nativeEngagement.actionError && <p className="snap-interaction-error" role="alert">{nativeEngagement.actionError}</p>}
        <header><div className="snap-social-header">
          <SnapAvatar urls={authorPhotos} source={snap.source} member={snap.source === 'uficonnect'} badge className="post-chrome-avatar" />
          <div className="snap-viewer-author snap-social-identity"><strong className="snap-social-name post-chrome-name">{profileLink?.to ? <Link to={profileLink.to} onClick={onClose}>{author}</Link> : profileLink?.href && !profileLink.fallback ? <a href={profileLink.href} target="_blank" rel="noopener noreferrer">{author}</a> : author}</strong>
            <span className="snap-viewer-source-details"><span className="snap-source-mark" aria-hidden="true">{hasBrandIcon(snap.source) ? <BrandIcon platform={snap.source} size={16} /> : <b>{source.slice(0, 2)}</b>}</span><span>{source} · {snapAvailabilityLabel(snap, now)}</span></span>
            {posted && <time className="snap-social-meta" dateTime={posted.iso} title={posted.full} aria-label={posted.full}>{posted.relative}</time>}
          </div>
        </div></header>
        <div id={detailsId} hidden={!detailsOpen && snap.source !== 'twitter'}>
      {snap.caption && <SnapCaption key={`${identity}:${mediaKey}:${snap.caption}`} caption={snap.caption} />}
      {snap.source === 'uficonnect' && <p className="snap-viewer-audience">{snap.visibility === 'followers' ? <><Users size={13} />Followers only</> : <><Globe2 size={13} />Public</>}</p>}
        </div>
        <SnapComments key={`${identity}:${mediaKey}`} snap={snap} profile={profile} active={commentsOpen} id={commentsId}
          onCountChange={nativeEngagement.setCommentsCount}
          onClose={() => { setCommentsOpen(false); commentsButton.current?.focus({ preventScroll: true }); }} />
      </section>
      <div className="snap-viewer-post-actions post-chrome-actions" role="group" aria-label="Snap commands">
        {snap.source === 'uficonnect' ? <NativeSnapLike engagement={nativeEngagement} profile={profile} onNavigate={onClose} /> : <PostLikes key={`${identity}:${mediaKey}`} post={interactionPost} compact />}
        <button ref={commentsButton} type="button" className="post-chrome-action" aria-label={`${sourcePostCommands(snap.source).discussions}${Number.isFinite(commentsCount) ? ` ${commentsCount.toLocaleString()}` : ''}`}
          title={sourcePostCommands(snap.source).discussions} aria-expanded={commentsOpen} aria-controls={commentsId}
          onClick={() => { setDetailsOpen(false); setCommentsOpen(value => !value); }}><CommentIcon />{Number.isFinite(commentsCount) && <span>{commentsCount.toLocaleString()}</span>}</button>
        {snap.source !== 'uficonnect' && original && <SavePostButton key={`save:${identity}:${mediaKey}`} post={interactionPost} className="post-chrome-action" showLabel={false} />}
        {snap.source === 'uficonnect' && <SnapShareButton snap={snap} compact />}
        <button type="button" className="post-chrome-action snap-viewer-details-toggle" aria-label="Snap details" title="Snap details" aria-expanded={detailsOpen} aria-controls={detailsId}
          onClick={() => { setCommentsOpen(false); setDetailsOpen(value => !value); }}><Info size={18} aria-hidden="true" /></button>
        <PostOptionsPopover key={`options:${optionsKey}`} items={options} label="Snap options" triggerLabel="Snap options"
          trigger={menuButton} open={optionsOpen} onOpenChange={changeOptionsOpen}
          prompt={confirmDelete && canDelete ? 'Delete this snap?' : undefined} error={error} pending={deleting} />
        {sourceOriginal && <OpenOnSource post={playerSourcePost} onClick={() => changeOptionsOpen(false)} />}
      </div>
    </div>
    {playerSettingsOpen && canOpenSettings && <YouTubeSettingsDialog key={playbackKey} title={settingsTitle} provider={settingsProvider} sourceLabel={playerSource}
      settings={nativePlayback ? nativeSettings.settings : playback.kind === 'youtube' ? youtubeControls.settings : undefined}
      onRateChange={nativePlayback ? nativeSettings.setRate : playback.kind === 'youtube' ? youtubeControls.setPlaybackRate : undefined}
      onCaptionSizeChange={playback.kind === 'youtube' ? youtubeControls.setCaptionFontSize : undefined}
      onCaptionTrackChange={nativePlayback ? nativeSettings.setCaptionTrack : undefined}
      onOpenSource={sourceOriginal ? () => { window.open(sourceOriginal, '_blank', 'noopener,noreferrer'); } : undefined}
      sourceNotice={settingsProvider === 'source' ? `This clip uses the official ${source} player or source page. Change supported playback options there.` : undefined}
      onClose={() => setPlayerSettingsOpen(false)} />}
      </div>
    </div>
  </dialog>, document.body);
}
