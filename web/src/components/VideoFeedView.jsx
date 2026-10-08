import { useState, useEffect, useLayoutEffect, useRef, useCallback, useId } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { feedLocationKey } from '../utils/feedLocation.mjs';
import { directMediaPlaybackAllowed } from '../utils/sourceMediaPolicy.mjs';
import { sourcePostMenuItems } from '../utils/sourcePostMenu.mjs';
import { extractYouTubeId, extractVimeoId, deriveBlueskyPlaylistUrl, isDirectVideoUrl, isYouTubeShortsUrl, HlsVideoPlayer, loadYouTubeIframeApi, userWantsSound, rememberSoundPreference, useGlobalMuted, fetchVimeoMetadata, youTubePosterUrl, createYouTubePlayerFrame, youTubeEmbedUrl } from './videoMedia';
import MediaPlaybackControls from './MediaPlaybackControls';
import { SOURCE_META, CONNECTED_SOCIAL_PLATFORMS } from './sourceMeta';
import BrandIcon, { hasBrandIcon } from './BrandIcon';
import FollowingConnectionNotice from './FollowingConnectionNotice';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';
import useNativePlayerSettings from '../hooks/useNativePlayerSettings';
import { orderNewestFeedCohorts } from '../utils/feedOrdering';
import { reportConsumed, reportEngaged, reportEngagementSignal } from '../api/engagement';
import { reportNegativeSignal } from '../api/errorReporting';
import { ALL_INTERESTS } from '../pages/Onboarding';
import ConnectedPostActions from './ConnectedPostActions';
import { SavePostButton } from './SaveButtons';
import PostLikes from './PostLikes';
import PostInlineText from './PostInlineText';
import PostLinkPreviews from './PostLinkPreviews';
import useTabMetrics, { useSelectedTabMetrics } from '../analytics/useTabMetrics';
import YouTubeSettingsDialog from './YouTubeSettingsDialog';
import { PostHeader, PostOptionsMenu, OpenOnSource, CommentIcon, HeartIcon } from './PostCardChrome';
import { isMemberPost, safePostLink } from '../../../backend/post-links.mjs';
import { Search, SlidersHorizontal, RotateCw, ArrowUpRight } from 'lucide-react';
import { videoDurationSeconds, isShortFeedVideo, videoSourceKey, safeMediaUrl, fitVideoFrame } from '../utils/videoFeedPolicy.mjs';
import './VideoFeedView.css';
import './navigation.css';

// A video counts as genuinely watched (as opposed to just scrolled past —
// see api/engagement.js for the view-vs-seen distinction) once playback
// crosses ~3s or ~50% of its length, whichever comes first — long enough
// that a fast scroll-by can't trigger it, short enough that a real
// full-length watch doesn't need to finish for it to register.
const VIDEO_ENGAGED_SECONDS = 3;
const VIDEO_ENGAGED_FRACTION = 0.5;
const VIDEO_FEED_TAIL_POLL_MS = 30 * 1000;
const VIDEO_QUEUE_LIMIT = 60;
const VIDEO_HISTORY_LIMIT = 2000;
const VIDEO_RETRY_MAX_MS = 60 * 1000;

function trimOldest(collection, limit = VIDEO_HISTORY_LIMIT) {
  while (collection.size > limit) collection.delete(collection.keys().next().value);
}

// Platforms genuinely excluded from the shared Feed-mode video pool.
// uficonnect is native/Following-only by design (a user's own network, not
// an aggregated platform). dribbble has no SOURCE_CONFIG entry server-side —
// no shared app-level fetcher exists for it (its real content only comes
// through Following mode's own per-user fetch, a separate path — see the
// note below), so including it here would just be a permanently-empty
// filter with no path to fix short of building a real aggregate one.
//
// Instagram is account-owned and only appears after its owner connects it.
// It is intentionally excluded from the shared Videos pool.
//
// Either way, this is entirely separate from Following mode's own path for
// these same platforms (FOLLOWING_VIDEO_SOURCES below) — that one is a
// per-user live fetch of a member's own connected account
// (CONNECTED_SOCIAL_SEARCH_FETCHERS/getFollowingFeedPosts), already works
// today independent of any app-level token, and was never gated by this
// exclusion list to begin with.
const FEED_ONLY_EXCLUDED_SOURCES = ['uficonnect', 'dribbble', 'instagram'];
// Feed mode's filter row — every publicly-aggregated source, since any of
// them can carry a real video (a dedicated video source like YouTube, a
// direct-file post from Reddit/Mastodon/Bluesky, or an article that embeds
// one — see rssPost/parseRSSItems server-side, which is shared by ~20 RSS
// sources, not just the handful that were originally assumed to be the only
// ones capable of it). Excludes the Following-only sources (native
// UFIconnect posts + connected-account platforms with no aggregate
// fetcher), which have their own separate filter row below with a
// different pool entirely.
const FEED_VIDEO_SOURCE_ORDER = [
  'reddit', 'github', 'youtube', 'hackernews',
  'twitter', 'facebook',
  'indeed', 'remoteok', 'remotive', 'muse', 'usajobs',
  'bluesky', 'devto', 'stackoverflow', 'gitlab', 'medium', 'hashnode', 'lobsters',
  'arxiv', 'producthunt', 'indiehackers', 'yc', 'crunchbase', 'techcrunch', 'theverge',
  'arstechnica', 'wired', 'theregister', 'venturebeat', 'infoq', 'mittr', 'phoronix',
  'smashing', 'behance', 'designweb', 'mastodon',
];
const FEED_VIDEO_SOURCES = FEED_VIDEO_SOURCE_ORDER.filter(k => SOURCE_META[k] && !FEED_ONLY_EXCLUDED_SOURCES.includes(k));
// Following mode's own filter set — every platform Connected Accounts
// offers (CONNECTED_SOCIAL_PLATFORMS), plus native UFIconnect, an entirely
// different pool from FEED_VIDEO_SOURCES above (see getFollowingFeedPosts
// server-side). This used to be hand-limited to LinkedIn/Twitter/
// Instagram/Facebook/TikTok, so a user who'd connected e.g. GitHub or
// Reddit had no way to even select it here. Not every entry has a live
// Following-timeline fetcher wired up yet (see FOLLOWING_SOURCE_FETCHERS/
// CONNECTED_SOCIAL_SEARCH_FETCHERS server-side) — one without a fetcher
// just shows the existing "no videos yet" empty state once selected,
// rather than being left off the picker entirely.
const FOLLOWING_VIDEO_SOURCES = ['uficonnect', ...CONNECTED_SOCIAL_PLATFORMS];

function SourceMark({ source, label, size = 14, active = false }) {
  const meta = SOURCE_META[source] || {};
  if (hasBrandIcon(source)) {
    return (
      <span style={{
        width: size + 8, height: size + 8, borderRadius: '50%',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: '#fff', flexShrink: 0,
      }}>
        <BrandIcon platform={source} size={size} />
      </span>
    );
  }
  return (
    <span style={{
      width: size + 8, height: size + 8, borderRadius: '50%',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: active ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.12)',
      color: '#fff', fontSize: Math.max(8, size - 7), fontWeight: 800, lineHeight: 1,
      flexShrink: 0,
    }}>
      {String(label || meta.icon || source || 'UFI').slice(0, 3).toUpperCase()}
    </span>
  );
}

// Figures out how a given post's video can actually be played in-app, per
// platform — the same Bluesky-playlist/direct-file detection ImageLightbox
// uses for a single item, but centralized here since this view needs it for
// every slide, not just one at a time.
function resolveVideoSource(post) {
  if (!post || typeof post !== 'object') return null;
  // Dedicated YouTube posts carry a playable sourceUrl; any
  // other source's article can embed a real YouTube video too (see
  // parseRSSItems' video detection backend-side), in which case either URL
  // can carry the player. Do not prefer one field blindly: a source article
  // often keeps its original article URL in sourceUrl and a YouTube URL in
  // mediaUrl, while persisted YouTube rows do the inverse.
  const youtubeUrls = [post.mediaUrl, post.sourceUrl].filter(url => {
    const parsed = safeMediaUrl(url);
    return parsed && /^(?:www\.|m\.)?(?:youtube(?:-nocookie)?\.com|youtu\.be)$/.test(parsed.hostname);
  });
  const youtubeUrl = youtubeUrls.find(url => extractYouTubeId(url));
  // Persisted provider labels and embedId can be stale. Only an actual
  // official video URL identifies the player and its YouTube settings.
  const ytId = extractYouTubeId(youtubeUrl);
  if (ytId) {
    // Real Shorts are persisted with a /shorts/ sourceUrl specifically so
    // this survives the DB round-trip (see isYouTubeShortsUrl's own
    // comment) — a vertical (9:16) video forced into VideoSlide's default
    // 16:9 container renders squeezed, with the video's own thumbnail/
    // title cropped, confirmed live as a Short looking visibly cut off.
    // A watched Short is sometimes stored as a regular /watch URL by a
    // channel RSS feed. Leave that shape unknown here so VideoFeedView can
    // confirm it from YouTube's portrait frame image before sizing the
    // shared player; known /shorts/ URLs remain vertical immediately.
    const vertical = youtubeUrls.some(isYouTubeShortsUrl) ? true : null;
    return { kind: 'youtube', id: ytId, poster: post.mediaPoster || youTubePosterUrl(ytId), vertical };
  }
  // Same idea for an article embedding a Vimeo player instead (see
  // parseRSSItems' vimeo detection backend-side) — mediaUrl is the
  // vimeo.com/{id} watch URL. No public thumbnail CDN pattern to borrow
  // like YouTube's i.ytimg.com, so poster stays null.
  const vimeoUrl = [post.mediaUrl, post.sourceUrl].find(url => {
    const parsed = safeMediaUrl(url);
    return parsed && /^(?:www\.|player\.)?vimeo\.com$/.test(parsed.hostname);
  });
  const vimeoId = extractVimeoId(vimeoUrl);
  if (vimeoId) return { kind: 'vimeo', id: vimeoId, poster: null };
  if (!directMediaPlaybackAllowed(post)) return null;
  if (post.source === 'bluesky' && safeMediaUrl(post.mediaUrl)) {
    const playlist = deriveBlueskyPlaylistUrl(post.mediaUrl);
    return playlist ? { kind: 'hls', src: playlist, poster: post.mediaPoster || null } : null;
  }
  const hlsUrl = [post.mediaUrl, post.sourceUrl].find(url => safeMediaUrl(url) && /\.m3u8(\?|$)/i.test(String(url || '')));
  if (hlsUrl) return { kind: 'hls', src: hlsUrl, poster: post.mediaPoster || null };
  if (safeMediaUrl(post.mediaUrl) && isDirectVideoUrl(post.mediaUrl, post)) {
    // mediaPoster is a real static preview frame server-side extracts
    // alongside the video itself where the source actually has one (Reddit's
    // own preview image, Mastodon's preview_url, Threads' thumbnail_url, an
    // RSS article's own image) — see mediaPoster in backend/index.js. Same
    // style treatment Bluesky gets below (kind:'hls', poster:post.mediaUrl),
    // just sourced from a dedicated field instead of a URL-pattern rewrite,
    // since the video and its poster are two genuinely distinct URLs here
    // rather than one derived from the other.
    return { kind: 'file', src: post.mediaUrl, poster: post.mediaPoster || null };
  }
  return null;
}

// Rolling dedup window for pagination — see the identical constant/reasoning
// in Feed.jsx. Bounded (not all-time) so pagination doesn't dead-end once a
// user has genuinely scrolled past everything the server has, but large
// enough that a normal scroll session never sees a near-term repeat caused
// by the server's video pool being rebuilt mid-session.
const VIDEO_FEED_AUTO_REFRESH_MS = 2 * 60 * 1000;
const VIDEO_COMMENTS_LIVE_REFRESH_MS = 15 * 1000;
const VIDEO_COMMENTS_PASSIVE_REFRESH_MS = 30 * 1000;

// How many slides on either side of the active one actually mount a real
// VideoSlide (video/iframe element, engagement tracking, comments wiring,
// etc.) — every other loaded post still gets a same-height placeholder div
// so scroll-snap geometry and the IntersectionObserver below stay correct,
// it just doesn't cost anything until scrolled near. Without this, a long
// scroll session (pagination keeps appending to videoPosts, uncapped) meant
// every single video ever scrolled past stayed fully mounted — a real
// <video>/<img> element each, most of them a 'file'-kind element that's
// unconditionally mounted regardless of active state (see its own render
// branch) — competing for decode/paint/memory for the rest of the session
// and getting slower to scroll the longer it went on. 2 covers a normal
// swipe-by-one and the occasional hard-flick-skips-two case (see the
// scrollSnapStop comment below) without a visible gap.
const VIDEO_MOUNT_RADIUS = 2;

function readYouTubeSettings(player) {
  const rates = [...new Set((player.getAvailablePlaybackRates?.() || []).filter(rate => Number.isFinite(rate) && rate > 0))].sort((a, b) => a - b);
  const rate = player.getPlaybackRate?.() || 1;
  let captionFontSize = null;
  if (player.getOptions?.('captions')?.includes('fontSize')) {
    const size = player.getOption('captions', 'fontSize');
    if (Number.isInteger(size) && size >= -1 && size <= 3) captionFontSize = size;
  }
  return { rates, rate, captionFontSize };
}

// sharedYt: { paused, duration, currentTime, failed, togglePlay } —
// the one YouTube player VideoFeedView keeps alive across every slide (see
// its own top comment) instead of each slide owning/destroying its own.
// Only meaningful when src.kind === 'youtube'; file/hls/vimeo keep their
// existing fully-local state below, untouched.
function VideoSlide({ post, active, muted, isScrolling, onOpenComments, sharedYt, onDurationResolved, onPostUpdated, onRemoved, fullScreen, onFullScreen }) {
  const slideRef = useRef(null);
  const src = resolveVideoSource(post);
  const fileVideoRef = useRef(null);
  const hlsVideoRef = useRef(null);
  const vimeoIframeRef = useRef(null);
  const vimeoStartMuted = useRef(!userWantsSound());
  const vimeoVolume = useRef(1);
  // Caption starts clamped (see the overlay below) — the video is the point
  // of this view, a wall of text over it isn't. "more" only shows up when
  // there's actually more than the clamp already reveals: a long title, or
  // real content beyond just the title repeated.
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const captionId = useId();
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => { if (!active) setSettingsOpen(false); }, [active]);
  const [cursorIdle, setCursorIdle] = useState(false);
  const cursorTimer = useRef(null);
  const cursorActivity = useCallback(() => {
    clearTimeout(cursorTimer.current);
    setCursorIdle(false);
    cursorTimer.current = setTimeout(() => setCursorIdle(true), 2200);
  }, []);
  useEffect(() => {
    setCursorIdle(false);
    clearTimeout(cursorTimer.current);
    if (!active) return;
    // The shared YouTube iframe is a sibling of the slide. Listen on their
    // common container so entering either player also reveals app controls.
    const body = slideRef.current?.closest('.video-feed-body');
    const events = ['pointermove', 'pointerdown', 'pointerover', 'focusin', 'keydown'];
    events.forEach(name => body?.addEventListener(name, cursorActivity));
    cursorActivity();
    return () => {
      clearTimeout(cursorTimer.current);
      events.forEach(name => body?.removeEventListener(name, cursorActivity));
    };
  }, [active, cursorActivity]);
  const captionBody = post.content?.trim() && post.content.trim() !== post.title?.trim()
    ? post.content.trim()
    : '';
  const hasExtraCaption = (post.title?.length || 0) > 80 || Boolean(captionBody);

  // file/hls/vimeo's own fully-local playback state — youtube reads
  // sharedYt instead (see effectiveDuration/
  // effectiveCurrentTime below), since its player lives in the parent now.
  const [paused, setPaused] = useState(true);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playerMuted, setPlayerMuted] = useState(true);
  const [vimeoReady, setVimeoReady] = useState(false);
  const scrollResumeRef = useRef(false);
  const hiddenResumeRef = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  // Vimeo-only: resolveVideoSource always hands back poster:null for it
  // (mediaUrl there is the watch URL, needed as-is, so it can't double as
  // a thumbnail source) — fetched separately via Vimeo's own oEmbed
  // endpoint (see fetchVimeoThumbnail) instead. Not gated on `active`:
  // useful for the inactive-state preview image too (see the render
  // below), and the module-level cache in fetchVimeoThumbnail means an
  // already-fetched video's poster resolves instantly here regardless.
  const [vimeoPoster, setVimeoPoster] = useState(null);
  useEffect(() => {
    if (src?.kind !== 'vimeo') return;
    let cancelled = false;
    fetchVimeoMetadata(src.id).then(metadata => {
      if (cancelled) return;
      setVimeoPoster(metadata?.thumbnailUrl || null);
      if (metadata?.durationSeconds) {
        setDuration(metadata.durationSeconds);
        onDurationResolved(post, metadata.durationSeconds);
      }
    });
    return () => { cancelled = true; };
  }, [src?.kind, src?.id, post, onDurationResolved]);

  const getNativeEl = useCallback(() => (src?.kind === 'hls' ? hlsVideoRef.current : fileVideoRef.current), [src?.kind]);
  const isNative = src?.kind === 'file' || src?.kind === 'hls';
  const nativeSettings = useNativePlayerSettings({
    getVideo: getNativeEl,
    enabled: active && isNative,
    mediaKey: `${post.id || ''}:${src?.kind || ''}:${src?.src || ''}`,
  });

  useEffect(() => {
    if (!active || src?.kind === 'youtube') return;
    const video = getNativeEl();
    const sendVimeo = method => vimeoIframeRef.current?.contentWindow?.postMessage(JSON.stringify({ method }), 'https://player.vimeo.com');
    const guardBackgroundPlay = () => {
      if (!document.hidden) return;
      hiddenResumeRef.current = true;
      video?.pause();
    };
    const visibilityChanged = () => {
      if (document.hidden) {
        hiddenResumeRef.current = src?.kind === 'vimeo' ? !pausedRef.current : Boolean(video && !video.paused) || scrollResumeRef.current;
        scrollResumeRef.current = false;
        if (src?.kind === 'vimeo') sendVimeo('pause'); else video?.pause();
      } else if (hiddenResumeRef.current) {
        hiddenResumeRef.current = false;
        if (src?.kind === 'vimeo') sendVimeo('play'); else video?.play().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    video?.addEventListener('play', guardBackgroundPlay);
    return () => {
      document.removeEventListener('visibilitychange', visibilityChanged);
      video?.removeEventListener('play', guardBackgroundPlay);
      hiddenResumeRef.current = false;
    };
  }, [active, src?.kind, getNativeEl]);

  // What the render/scrub-bar/engagement-tracking below actually read —
  // youtube's real values live on the shared player (see sharedYt, owned
  // by VideoFeedView), everything else keeps reading this slide's own
  // local state exactly as before.
  const isYoutube = src?.kind === 'youtube';
  const effectiveDuration = isYoutube ? (sharedYt?.duration || 0) : duration;
  const effectiveCurrentTime = isYoutube ? (sharedYt?.currentTime || 0) : currentTime;
  const acceptNativeMetadata = (event) => {
    const seconds = event.currentTarget.duration;
    setDuration(Number.isFinite(seconds) ? seconds : 0);
    if (isShortFeedVideo(seconds)) event.currentTarget.pause();
    onDurationResolved(post, seconds);
    setPaused(event.currentTarget.paused);
    setPlayerMuted(event.currentTarget.muted || event.currentTarget.volume === 0);
  };

  // Genuine-watch engagement signal (see api/engagement.js) — currentTime
  // already updates continuously during real playback (onTimeUpdate/the
  // YouTube poll below), so this just watches for it crossing the
  // threshold rather than needing its own timer. Only reachable while
  // active (a background/inactive slide's currentTime is reset, not
  // advancing) so a fast scroll-by can't cross the seconds threshold by
  // accident.
  useEffect(() => {
    if (!active || !post?.id) return;
    if (effectiveCurrentTime >= VIDEO_ENGAGED_SECONDS || (effectiveDuration > 0 && effectiveCurrentTime / effectiveDuration >= VIDEO_ENGAGED_FRACTION)) {
      reportEngaged(post.id, 'videos');
    }
  }, [active, post?.id, effectiveCurrentTime, effectiveDuration]);

  // Feeds the feed's own ranking (see recordEngagementSignal server-side),
  // separate from the yes/no reportEngaged above — wall-clock time this
  // slide was the one on screen, not just whether a threshold was crossed.
  // Wall-clock rather than summed currentTime deltas: a paused or scrubbed
  // video the user is still looking at is still real attention, and this
  // doesn't need to be more precise than "roughly how long were they here."
  useEffect(() => {
    if (!active) return;
    let startedAt = document.hidden ? null : Date.now();
    let watchMs = 0;
    const updateVisibility = () => {
      if (startedAt !== null) watchMs += Date.now() - startedAt;
      startedAt = document.hidden ? null : Date.now();
    };
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      document.removeEventListener('visibilitychange', updateVisibility);
      if (startedAt !== null) watchMs += Date.now() - startedAt;
      if (watchMs > 0) reportEngagementSignal({ postId: post.id, source: post.source, topic: post.topic, watchMs });
    };
  }, [active, post.id, post.source, post.topic]);

  // file/hls: play on becoming active, pause + rewind on becoming inactive
  // (leaving a video mid-scrub-progress for the next viewer would be
  // confusing — every slide always starts fresh). Always starts muted and
  // stays muted — this used to reveal sound right after play() resolved if
  // the shared mute state wanted it, but that reveal is a delayed,
  // asynchronous `.muted = false` write, not the direct synchronous result
  // of a user gesture. Safari in particular can silently accept the
  // property write (so the mute button's icon correctly shows "unmuted")
  // while still refusing to actually output audio — confirmed live as
  // "shows unmuted but no voice is playing." The sync effect right below,
  // which only ever runs in direct response to the mute button itself, is
  // what actually unmutes now — a gesture every browser honors.
  useEffect(() => {
    if (src?.kind === 'youtube') return;
    const v = getNativeEl();
    if (!v) return;
    if (active) {
      v.muted = true;
      v.defaultMuted = true;
      v.playsInline = true;
      hiddenResumeRef.current = document.hidden;
      scrollResumeRef.current = isScrolling;
      if (!document.hidden && !isScrolling) v.play().catch(() => setPaused(true));
    } else {
      v.pause(); try { v.currentTime = 0; } catch {} setCurrentTime(0); setPaused(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, src?.kind, getNativeEl]);

  // Keeps an already-active file/hls video's mute state in sync with manual
  // toggles of the shared mute button — the play effect above already sets
  // the correct state once play() resolves; this only needs to react to
  // changes after that point.
  useEffect(() => {
    if (src?.kind === 'youtube') return;
    const v = getNativeEl();
    if (v && active) v.muted = muted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted, active, getNativeEl, src?.kind]);

  // Vimeo: a cross-origin iframe with no DOM <video> to attach onPlay/
  // onPause/onTimeUpdate to, so paused/duration/currentTime — and with
  // them the scrub bar, time readout, and "tap to play" affordance every
  // other kind here already gets — previously never updated for this kind
  // at all. paused's useState(false) default meant a silently-blocked
  // autoplay just looked like a frozen video with nothing tappable, and
  // togglePlay() had no element to act on either.
  // Vimeo's embed exposes its own postMessage event protocol instead: it
  // pushes an unprompted {event:'ready'} once loaded, then after
  // subscribing with {method:'addEventListener', value:'play'|'pause'|
  // 'timeupdate'} it pushes {event:'play'|'pause'|'timeupdate', data} on
  // every change — wiring that into the exact same paused/duration/
  // currentTime state file/hls populate via real DOM events means the
  // rest of this component needs no further kind-specific branching for
  // any of that UI to also work correctly here.
  useEffect(() => {
    if (!active || src?.kind !== 'vimeo') return;
    setVimeoReady(false);
    let ready = false;
    function sendToVimeo(msg) {
      try { vimeoIframeRef.current?.contentWindow?.postMessage(JSON.stringify(msg), 'https://player.vimeo.com'); } catch {}
    }
    function handleMessage(event) {
      if (event.origin !== 'https://player.vimeo.com') return;
      if (event.source !== vimeoIframeRef.current?.contentWindow) return;
      let msg;
      try { msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
      if ((msg?.event === 'ready' || msg?.method === 'ping') && !ready) {
        ready = true;
        setVimeoReady(true);
        sendToVimeo({ method: 'addEventListener', value: 'play' });
        sendToVimeo({ method: 'addEventListener', value: 'pause' });
        sendToVimeo({ method: 'addEventListener', value: 'timeupdate' });
        sendToVimeo({ method: 'addEventListener', value: 'volumechange' });
        sendToVimeo({ method: 'getDuration' });
        sendToVimeo({ method: 'getPaused' });
        sendToVimeo({ method: 'getMuted' });
        sendToVimeo({ method: 'getVolume' });
        if (document.hidden) { hiddenResumeRef.current = true; sendToVimeo({ method: 'pause' }); }
      } else if (msg?.method === 'getDuration') {
        setDuration(Number(msg.value) || 0);
        onDurationResolved(post, Number(msg.value));
      } else if (msg?.method === 'getPaused' && typeof msg.value === 'boolean') {
        setPaused(msg.value);
      } else if ((msg?.method === 'getMuted' || msg?.method === 'setMuted') && typeof msg.value === 'boolean') {
        setPlayerMuted(msg.value || vimeoVolume.current === 0);
      } else if ((msg?.method === 'getVolume' || msg?.method === 'setVolume') && Number.isFinite(msg.value)) {
        vimeoVolume.current = msg.value;
        sendToVimeo({ method: 'getMuted' });
      } else if (msg?.event === 'volumechange' && msg.data) {
        vimeoVolume.current = Number(msg.data.volume);
        setPlayerMuted(Boolean(msg.data.muted) || Number(msg.data.volume) === 0);
      } else if (msg?.event === 'play') {
        if (document.hidden) { hiddenResumeRef.current = true; sendToVimeo({ method: 'pause' }); }
        setPaused(false);
      } else if (msg?.event === 'pause' || msg?.event === 'finish') {
        setPaused(true);
      } else if (msg?.method === 'setCurrentTime' && Number.isFinite(msg.value)) {
        setCurrentTime(msg.value);
      } else if (msg?.event === 'timeupdate' && msg.data) {
        setCurrentTime(msg.data.seconds || 0);
        if (msg.data.duration) { setDuration(msg.data.duration); onDurationResolved(post, msg.data.duration); }
      }
    }
    window.addEventListener('message', handleMessage);
    sendToVimeo({ method: 'ping' });
    return () => window.removeEventListener('message', handleMessage);
  }, [active, src?.kind, post, onDurationResolved]);

  // Same "every slide starts fresh" reset file/hls gets on becoming
  // inactive (above) — the iframe itself already fully unmounts when
  // inactive (see the vimeo render branch) so playback genuinely stops,
  // but this slide's own local paused/duration/currentTime state would
  // otherwise still hold whatever it last saw next time this exact post
  // becomes active again.
  useEffect(() => {
    if (src?.kind !== 'vimeo' || active) return;
    setCurrentTime(0); setPaused(true); setDuration(0); setVimeoReady(false);
  }, [active, src?.kind]);

  // youtube's player construction/autoplay-retry/mute-sync all live in
  // VideoFeedView now (see sharedYt/sharedYtPlayerRef there) — one player
  // reused across every slide instead of destroyed and rebuilt per slide.

  // Pause for the duration of an active scroll gesture, deliberately kept
  // separate from the active/inactive effect above: that one owns real
  // slide transitions (play-from-start, pause-and-rewind-to-0 for the next
  // viewer). This one only pauses-in-place and resumes-in-place while
  // scrolling happens to pass over an already-active slide without fully
  // leaving it — no rewind, no re-priming autoplay, just a hold.
  //
  // file/hls only — YouTube deliberately exempted. Confirmed live via an
  // instrumented build tracing every playVideo/pauseVideo call: this effect
  // would pause a YouTube player mid-scroll (onStateChange correctly firing
  // PLAYING right beforehand, so autoplay itself was fine), and the
  // "resume once isScrolling settles" half wasn't reliably reconnecting —
  // if `active` flips even briefly around the same window (a snap-scroll
  // settle landing on a neighboring slide, a fast flick's momentum still
  // decaying), the pause-effect's own `if (!active) return` at the top
  // means nothing calls playVideo() again for that slide, and it just
  // stays paused. file/hls's local <video> element has no equivalent
  // async construction/ready lifecycle to race against, so pausing it
  // in-place is cheap and reliable — pausing a remote iframe player isn't,
  // and the original reason for pausing at all (avoiding local decode
  // thrash during a fast scroll) doesn't really apply to a remote player
  // either. Simplest fix: never pause YouTube for scrolling, only for a
  // real slide transition (the active/inactive effect above already
  // handles that by destroying the player outright).
  useEffect(() => {
    if (!active || src?.kind === 'youtube' || document.hidden) return;
    if (src?.kind === 'vimeo') {
      try {
        if (isScrolling) {
          scrollResumeRef.current = scrollResumeRef.current || !pausedRef.current;
          vimeoIframeRef.current?.contentWindow?.postMessage(JSON.stringify({ method: 'pause' }), 'https://player.vimeo.com');
        } else if (scrollResumeRef.current) {
          scrollResumeRef.current = false;
          vimeoIframeRef.current?.contentWindow?.postMessage(JSON.stringify({ method: 'play' }), 'https://player.vimeo.com');
        }
      } catch {}
      return;
    }
    const v = getNativeEl();
    if (!v) return;
    if (isScrolling) {
      scrollResumeRef.current = scrollResumeRef.current || !v.paused;
      v.pause();
    } else if (scrollResumeRef.current) {
      scrollResumeRef.current = false;
      v.play().catch(() => {});
    }
  }, [isScrolling, active, src?.kind, getNativeEl]);

  function togglePlay() {
    if (isYoutube) {
      sharedYt?.togglePlay?.();
    } else if (src?.kind === 'vimeo') {
      if (!vimeoReady) return;
      try {
        vimeoIframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ method: paused ? 'play' : 'pause' }), 'https://player.vimeo.com'
        );
      } catch {}
    } else {
      const v = getNativeEl();
      if (!v) return;
      if (v.paused) v.play().catch(() => setPaused(true)); else v.pause();
    }
  }

  function toggleSound() {
    if (isYoutube) { sharedYt?.toggleMute?.(); return; }
    if (src?.kind === 'vimeo') {
      if (!vimeoReady) return;
      if (playerMuted && vimeoVolume.current === 0) vimeoIframeRef.current?.contentWindow?.postMessage(JSON.stringify({ method: 'setVolume', value: 1 }), 'https://player.vimeo.com');
      vimeoIframeRef.current?.contentWindow?.postMessage(JSON.stringify({ method: 'setMuted', value: !playerMuted }), 'https://player.vimeo.com');
      // Wait for Vimeo's response before changing the visible state.
      rememberSoundPreference(playerMuted);
      return;
    }
    const video = getNativeEl();
    if (!video) return;
    const next = !(video.muted || video.volume === 0);
    if (!next && video.volume === 0) video.volume = 1;
    video.muted = next;
    setPlayerMuted(next);
    rememberSoundPreference(!next);
  }

  function seekTo(seconds) {
    if (!active || !Number.isFinite(seconds) || !Number.isFinite(effectiveDuration) || effectiveDuration <= 0) return;
    const target = Math.max(0, Math.min(effectiveDuration, seconds));
    if (isYoutube) { sharedYt?.seekTo?.(target); return; }
    if (src?.kind === 'vimeo') {
      if (vimeoReady) vimeoIframeRef.current?.contentWindow?.postMessage(JSON.stringify({ method: 'setCurrentTime', value: target }), 'https://player.vimeo.com');
      return;
    }
    const video = getNativeEl();
    if (!video) return;
    let seekTarget = target;
    if (video.seekable.length) {
      let distance = Infinity;
      for (let i = 0; i < video.seekable.length; i++) {
        const candidate = Math.max(video.seekable.start(i), Math.min(video.seekable.end(i), target));
        if (Math.abs(candidate - target) < distance) { seekTarget = candidate; distance = Math.abs(candidate - target); }
      }
    }
    try { video.currentTime = seekTarget; setCurrentTime(video.currentTime); } catch {}
  }

  const validSourceActions = post.source !== 'youtube' || isYoutube;
  const sourceItems = sourcePostMenuItems(post).filter(item => validSourceActions || item.key === 'original')
    .map(item => validSourceActions ? item : { ...item, label: 'Open original post' });
  const options = [
    { label: fullScreen ? 'Exit full screen' : 'Full screen', onSelect: () => onFullScreen(getNativeEl()) },
    isYoutube && { label: 'YouTube settings', detail: 'Playback speed, quality and captions', onSelect: () => setSettingsOpen(true) },
    isNative && { label: 'Player settings', detail: 'Playback speed and available captions', onSelect: () => setSettingsOpen(true) },
  ].filter(Boolean);
  return (
    <article ref={slideRef} className="video-feed-slide" data-cursor-idle={cursorIdle}>
      <div className="video-feed-media" data-video-media onClick={event => {
        if (!event.target.closest('iframe, button, video')) togglePlay();
      }}>
        {!src ? <p>Video unavailable</p> : src.kind === 'youtube' ? null : src.kind === 'vimeo' ? (
          active ? <iframe ref={vimeoIframeRef}
            onLoad={() => vimeoIframeRef.current?.contentWindow?.postMessage(JSON.stringify({ method: 'ping' }), 'https://player.vimeo.com')}
            src={`https://player.vimeo.com/video/${src.id}?autoplay=1&muted=${vimeoStartMuted.current ? 1 : 0}&loop=1&api=1&title=0&byline=0&portrait=0&controls=1`}
            referrerPolicy="strict-origin-when-cross-origin"
            allow="autoplay; fullscreen; picture-in-picture" allowFullScreen title={post.title || 'Vimeo video'} />
          : vimeoPoster ? <img src={vimeoPoster} alt="" draggable={false} /> : null
        ) : src.kind === 'hls' ? (
          active ? <HlsVideoPlayer src={src.src} poster={src.poster} autoPlay muted={muted} loop controls={false}
            controlsList="nodownload noplaybackrate noremoteplayback" disablePictureInPicture disableRemotePlayback
            videoRef={hlsVideoRef} onTimeUpdate={event => setCurrentTime(event.target.currentTime)}
            onLoadedMetadata={acceptNativeMetadata} onPlay={() => setPaused(false)} onPause={() => setPaused(true)}
            onVolumeChange={event => setPlayerMuted(event.currentTarget.muted || event.currentTarget.volume === 0)}
            onError={() => reportNegativeSignal({ signalType: 'video_load_fail', source: post.source, topic: post.topic, postId: post.id, context: { surface: 'videos' } })}
            style={{ height: '100%', width: '100%', objectFit: 'contain' }} /> : null
        ) : <video ref={fileVideoRef} src={src.src} poster={src.poster || undefined}
            preload={active ? 'auto' : 'metadata'} muted={muted} loop playsInline controls={false} draggable={false}
            controlsList="nodownload noplaybackrate noremoteplayback" disablePictureInPicture disableRemotePlayback
            onTimeUpdate={event => setCurrentTime(event.target.currentTime)}
            onLoadedMetadata={acceptNativeMetadata} onDurationChange={acceptNativeMetadata}
            onPlay={() => setPaused(false)} onPause={() => setPaused(true)}
            onVolumeChange={event => setPlayerMuted(event.currentTarget.muted || event.currentTarget.volume === 0)}
            onError={() => reportNegativeSignal({ signalType: 'video_load_fail', source: post.source, topic: post.topic, postId: post.id, context: { surface: 'videos' } })} />}
      </div>
      <div className="video-feed-playback-status">
        <MediaPlaybackControls paused={isYoutube ? sharedYt?.paused !== false : paused}
          muted={isYoutube ? sharedYt?.muted !== false : playerMuted}
          currentTime={effectiveCurrentTime} duration={effectiveDuration}
          onTogglePlay={togglePlay} onToggleMute={toggleSound} onSeek={seekTo}
          disabled={!active || !src || (isYoutube ? !sharedYt?.ready || sharedYt?.failed : src.kind === 'vimeo' && !vimeoReady)} />
      </div>
      <div className="video-feed-details video-caption-scroll" data-video-details>
        <PostHeader post={post} member={isMemberPost(post)} />
        {isYoutube && sharedYt?.failed && <p className="video-feed-playback-note" role="status">The embedded player could not start. Try its play button.</p>}
        <div className="video-feed-caption" data-video-caption data-expanded={captionExpanded}>
          <div className="video-feed-caption-summary">
            {post.title && <h2>{post.title}</h2>}
            {(post.title || hasExtraCaption || post.author?.name) && <button type="button" className="video-feed-caption-toggle"
              aria-expanded={captionExpanded} aria-controls={captionId} onClick={() => setCaptionExpanded(value => !value)}>
              {captionExpanded ? 'Show less' : 'Read more'}
            </button>}
          </div>
          {captionExpanded && <div id={captionId} className="video-feed-caption-expanded">
            {post.matchedByLocation && <span>{post.locationMatchLabel || 'Near you'}</span>}
            {post.title && <p className="video-feed-expanded-title">{post.title}</p>}
            {captionBody && <p><PostInlineText text={captionBody} /></p>}
            <PostLinkPreviews post={post} variant="dark" />
          </div>}
        </div>
        <div className="post-chrome-actions video-feed-post-actions" data-video-actions role="group" aria-label="Post actions">
          {validSourceActions ? <PostLikes post={post} onPostUpdated={onPostUpdated} /> : <button type="button" className="post-chrome-action" disabled aria-label="Likes unavailable" title="A playable source video is required"><HeartIcon /></button>}
          <button type="button" className="post-chrome-action" aria-label={`Comments${Number.isFinite(post.commentsCount) ? ` ${post.commentsCount.toLocaleString()}` : ''}`} title="Comments" onClick={() => onOpenComments?.(post)}>
            <CommentIcon />{Number.isFinite(post.commentsCount) && <span>{post.commentsCount.toLocaleString()}</span>}
          </button>
          <SavePostButton post={post} className="post-chrome-action" showLabel={false} />
          <PostOptionsMenu post={post} items={options} sourceItems={sourceItems} onOpenComments={() => onOpenComments?.(post)} onPostUpdated={onPostUpdated} onRemoved={onRemoved} />
          {isMemberPost(post) ? <Link className="post-chrome-action post-chrome-source-link" to={`/p/${encodeURIComponent(post.id)}`} aria-label="Open post" title="Open post"><ArrowUpRight size={18} aria-hidden="true" /></Link>
            : <OpenOnSource post={post} label={validSourceActions ? undefined : 'Open original post'} />}
        </div>
      </div>
      {settingsOpen && isYoutube && <YouTubeSettingsDialog settings={sharedYt?.settings}
        onRateChange={sharedYt?.setPlaybackRate} onCaptionSizeChange={sharedYt?.setCaptionFontSize}
        onClose={() => setSettingsOpen(false)} onPlayerControls={() => { setSettingsOpen(false); sharedYt?.focusControls?.(); }} />}
      {settingsOpen && isNative && <YouTubeSettingsDialog title="Player settings" settings={nativeSettings.settings}
        onRateChange={nativeSettings.setRate} onCaptionTrackChange={nativeSettings.setCaptionTrack}
        onClose={() => setSettingsOpen(false)} />}
    </article>
  );
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Bottom-sheet popup — GET /feed/:postId/comments already exists (used by
// Feed.jsx's card view) and returns real, live comments for Reddit/HN/
// DEV.to/Stack Overflow/Mastodon/Lobsters; every other source honestly
// comes back with an empty list (live: false) rather than anything
// fabricated, so that's shown as its own state instead of pretending the
// section is just loading forever.
function videoCommentIdentity(comment) {
  return comment?.id || `${comment?.author || ''}:${comment?.created || ''}:${comment?.body || ''}`;
}

function mergeVideoCommentLists(primary = [], secondary = []) {
  const seen = new Set();
  const merged = [];
  for (const comment of [...primary, ...secondary]) {
    const key = videoCommentIdentity(comment);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(comment);
  }
  return merged;
}

function CommentsSheet({ post, onClose }) {
  const originalUrl = safePostLink(post.sourceUrl);
  const [comments, setComments] = useState(null);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const closeButton = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus();
    const handleKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onCloseRef.current(); return; }
      if (event.key !== 'Tab') return;
      const sheet = closeButton.current?.closest('.video-comments-sheet');
      const controls = [...(sheet?.querySelectorAll('a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])') || [])].filter(control => control.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first) return;
      if (!sheet.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus?.(); };
  }, []);

  // How long this specific post's comments were actually open — feeds the
  // feed's own ranking the same way video watch time does (see
  // recordEngagementSignal server-side). Mount-to-unmount, since this sheet
  // only ever exists while it's open (see its conditional render in
  // VideoFeedView).
  useEffect(() => {
    const openedAt = Date.now();
    return () => {
      reportEngagementSignal({ postId: post.id, source: post.source, topic: post.topic, commentsViewMs: Date.now() - openedAt });
    };
  }, [post.id, post.source, post.topic]);

  const commentsRef = useRef(comments);
  const commentsRequestRef = useRef(0);
  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);

  const fetchCommentsPage = useCallback(async ({ background = false } = {}) => {
    const requestId = ++commentsRequestRef.current;
    if (!background) {
      setLoading(true);
      setComments(null);
    }
    try {
      const currentCount = Array.isArray(commentsRef.current) ? commentsRef.current.length : 0;
      const limit = Math.min(50, Math.max(20, currentCount || 20));
      const { data } = await client.get(`/feed/${encodeURIComponent(post.id)}/comments`, {
        params: { limit },
      });
      if (requestId !== commentsRequestRef.current) return;
      const incoming = data.comments || [];
      setComments(prev => background ? mergeVideoCommentLists(incoming, prev || []) : incoming);
      setLive(!!data.live);
      setHasMore(!!data.hasMore);
    } catch {
      if (requestId === commentsRequestRef.current && !background) setComments([]);
    } finally {
      if (requestId === commentsRequestRef.current && !background) setLoading(false);
    }
  }, [post.id]);

  useEffect(() => {
    fetchCommentsPage({ background: false });
    return () => { commentsRequestRef.current += 1; };
  }, [fetchCommentsPage]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.hidden || loading || loadingMore) return;
      fetchCommentsPage({ background: true });
    }, live ? VIDEO_COMMENTS_LIVE_REFRESH_MS : VIDEO_COMMENTS_PASSIVE_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [fetchCommentsPage, live, loading, loadingMore]);

  async function loadMore() {
    if (loadingMore || !comments) return;
    setLoadingMore(true);
    try {
      const { data } = await client.get(`/feed/${encodeURIComponent(post.id)}/comments`, {
        params: { offset: comments.length },
      });
      setComments(prev => mergeVideoCommentLists([...(prev || []), ...(data.comments || [])]));
      setHasMore(!!data.hasMore);
    } catch {
      // Leave existing comments in place — button stays clickable to retry.
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div
      className="video-comments-sheet" role="dialog" aria-modal="true" aria-label="Comments"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.55)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560, maxHeight: '70dvh', background: 'var(--surface)', color: 'var(--text)',
          borderRadius: '18px 18px 0 0', display: 'flex', flexDirection: 'column',
          animation: 'commentsSheetUp .22s ease-out',
        }}
      >
        <style>{'@keyframes commentsSheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }'}</style>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.92rem' }}>
            Comments {comments?.length > 0 ? `(${comments.length})` : ''}
          </div>
          <button
            ref={closeButton}
            onClick={onClose}
            aria-label="Close comments"
            style={{ all: 'unset', color: 'var(--muted)', fontSize: '1.3rem', cursor: 'pointer', lineHeight: 1, padding: 4 }}
          >×</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '10px 16px 20px' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <span className="spinner spinner-primary" />
            </div>
          )}
          {!loading && comments?.length === 0 && (
            <div style={{ textAlign: 'center', padding: '20px 8px', color: 'var(--muted)', fontSize: '.85rem' }}>
              {live === false && originalUrl
                ? <>No comments loaded from {post.sourceLabel || post.source} yet.<br />
                    <a href={originalUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)', fontWeight: 700 }}>
                      View the original post ↗
                    </a>
                  </>
                : 'No comments yet.'}
            </div>
          )}
          {!loading && comments?.map(c => (
            <div key={c.id} style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <div style={{
                width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '.75rem', fontWeight: 700, color: 'var(--text)',
              }}>
                {(c.author?.replace(/^(?:u\/|@)/, '') || '?')[0]?.toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: '.8rem', color: 'var(--text)' }}>{c.author}</span>
                  {c.score > 0 && <span style={{ fontSize: '.68rem', color: 'var(--muted)' }}>▲ {c.score.toLocaleString()}</span>}
                  <span style={{ fontSize: '.68rem', color: 'var(--muted)', marginLeft: 'auto' }}>{timeAgo(c.created)}</span>
                </div>
                <p style={{ fontSize: '.84rem', lineHeight: 1.55, margin: 0, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{c.body}</p>
              </div>
            </div>
          ))}
          {!loading && hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              style={{
                display: 'block', margin: '4px auto 8px', background: 'none', border: 'none',
                color: 'var(--text)', cursor: loadingMore ? 'default' : 'pointer', fontSize: '.8rem', fontWeight: 700,
                opacity: 0.85, padding: '6px 10px',
              }}
            >
              {loadingMore ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Load more comments'}
            </button>
          )}
          <ConnectedPostActions post={post} />
        </div>
      </div>
    </div>
  );
}

export default function VideoFeedView({ onExit, music = false }) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [fullScreen, setFullScreen] = useState(Boolean(document.fullscreenElement));
  const enteredFullScreen = useRef(false);
  const fullScreenView = useRef({ mounted: true, generation: 0 });
  useEffect(() => {
    fullScreenView.current.mounted = true;
    const update = () => { setFullScreen(Boolean(document.fullscreenElement)); if (!document.fullscreenElement) enteredFullScreen.current = false; };
    document.addEventListener('fullscreenchange', update);
    return () => {
      fullScreenView.current.mounted = false;
      fullScreenView.current.generation += 1;
      document.removeEventListener('fullscreenchange', update);
      if (enteredFullScreen.current && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);
  const onFullScreen = async nativeVideo => {
    const generation = fullScreenView.current.generation;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        if (!fullScreenView.current.mounted || generation !== fullScreenView.current.generation) {
          if (document.fullscreenElement === document.documentElement) await document.exitFullscreen();
          return;
        }
        enteredFullScreen.current = true;
      }
      else if (nativeVideo?.webkitEnterFullscreen) nativeVideo.webkitEnterFullscreen();
      else showToast('Use the player’s full screen button.', 'info');
    } catch { if (fullScreenView.current.mounted) showToast('Full screen could not open. Try the player’s full screen button.', 'error'); }
  };
  const exitFeed = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    onExit();
  }, [onExit]);
  const memberRef = useRef(profile?.id);
  memberRef.current = profile?.id;
  const regionalKey = `${profile?.id || ''}:${feedLocationKey(profile?.roleSettings)}`;
  const contextKeyRef = useRef(regionalKey);
  contextKeyRef.current = regionalKey;
  const lastMemberRef = useRef(profile?.id);
  const [videoPosts, setVideoPosts] = useState([]);
  const updatePost = useCallback(updated => setVideoPosts(posts => posts.map(post => post.id === updated.id ? { ...post, ...updated } : post)), []);
  const [activeIndex, setActiveIndex] = useState(0);
  const durationCacheRef = useRef(new Map());
  const queueRef = useRef(videoPosts);
  const activeIndexRef = useRef(activeIndex);
  const lastSwipeAtRef = useRef(-Infinity);
  const pendingScrollIndexRef = useRef(null);
  queueRef.current = videoPosts;
  activeIndexRef.current = activeIndex;
  const onDurationResolved = useCallback((post, seconds) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const key = videoSourceKey(resolveVideoSource(post));
    if (!key || durationCacheRef.current.get(key) === seconds) return;
    durationCacheRef.current.set(key, seconds);
    trimOldest(durationCacheRef.current);
    if (!isShortFeedVideo(seconds)) return;
    const previous = queueRef.current;
    const activePost = previous[activeIndexRef.current];
    const next = previous.filter(item => videoSourceKey(resolveVideoSource(item)) !== key);
    if (next.length === previous.length) return;
    const keptIndex = next.findIndex(item => item === activePost);
    const nextIndex = keptIndex >= 0 ? keptIndex : Math.min(activeIndexRef.current, Math.max(next.length - 1, 0));
    queueRef.current = next;
    activeIndexRef.current = nextIndex;
    pendingScrollIndexRef.current = nextIndex;
    setVideoPosts(next);
    setActiveIndex(nextIndex);
  }, []);
  const [youtubeFrameOrientations, setYoutubeFrameOrientations] = useState({});
  // The post currently showing in the comments popup — lifted up here
  // (rather than local to each VideoSlide) so it renders once, fixed to the
  // whole viewport, instead of being scoped/clipped inside one snap-scroll
  // slide.
  const [commentsPost, setCommentsPost] = useState(null);
  // Starts muted like every platform's own feed does — this used to start
  // unmuted on the theory that clicking the Videos nav item first counted
  // as enough interaction for browsers to allow autoplay-with-sound
  // directly, but per-embed/per-element autoplay-with-sound is judged more
  // strictly than that, especially in Safari: the video plays and the mute
  // button can end up showing "unmuted" while the actual audio output stays
  // silently blocked (see VideoSlide's play effects for the mechanics).
  // Tapping the mute button is a direct gesture every browser honors, so
  // that's the only thing that ever unmutes now.
  //
  // Starting *every* video muted-until-tapped, taken alone, meant a real
  // tap was needed on every single slide scrolled to, forever — see
  // userWantsSound's own comment. Once the user has directly tapped unmute
  // at all this browser, slides start already unmuted instead.
  const [muted] = useGlobalMuted();
  const [hasMore, setHasMore] = useState(true);
  const [tailWaiting, setTailWaiting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sourceErrors, setSourceErrors] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  // Same Feed/Following split as the main feed (see pages/Feed.jsx) — the
  // aggregate true mix here and the Following pool never share sources
  // (gated platforms only ever appear in Following, see FEED_SOCIAL_TABS
  // backend-side), so switching mode also resets the source filter.
  const [viewMode, setViewMode] = useState('feed');
  useTabMetrics(music ? 'music_mode' : 'video_mode', viewMode);
  // Array, not a single value — selecting more than one platform at once is
  // exactly what makes the server's true-mix rebalancing (see the
  // maxSharePct comment in handleVideoFeedRequest) actually apply here; a
  // single-value toggle could never combine sources in the first place.
  const [sourceFilter, setSourceFilter] = useState([]);
  // Search and topic each have their own small floating button (searchOpen/
  // filterOpen below) rather than a single always-visible bar/row — a
  // permanent search bar floating over a full-bleed swipe feed would
  // compete with the video for the very top of the screen, exactly the
  // "look ugly" this was asked to avoid. Topic (multi-select — any post
  // matching ANY of the picked topics) and Platform apply immediately on
  // tap, same as before — no separate "uncommitted" state needed for
  // either. Search is the one exception: searchInput is the raw,
  // uncommitted textbox value, searchQuery/searchQueryRef is what's
  // actually been applied and sent to loadPage, only updated on the
  // search sheet's own Done/Enter (applySearch) — live-as-you-type doesn't
  // make much sense tucked inside a sheet the user has to deliberately
  // open anyway.
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [topicFilters, setTopicFilters] = useState([]);
  const [genre, setGenre] = useState('');
  const genreRef = useRef('');
  const searchQueryRef = useRef('');
  const topicFiltersRef = useRef([]);
  // Whether the search sheet (just the text input) or the filter sheet
  // (topic/platform) is open — two separate buttons/sheets rather
  // than one combined one, so each stays focused and quick to scan
  // instead of a single sheet trying to do three different jobs at once.
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  useSelectedTabMetrics(music ? 'music_source' : 'video_source', sourceFilter, filterOpen || sourceFilter.length > 0);
  // Mirrors state into refs so loadPage (called from effects/callbacks that
  // don't want to be redeclared on every mode/filter change) always reads
  // the current value instead of whatever was captured at its own creation —
  // same pattern as refreshSeedRef below and viewModeRef in pages/Feed.jsx.
  const viewModeRef = useRef('feed');
  const sourceFilterRef = useRef([]);
  const containerRef = useRef(null);
  const slideRefs = useRef([]);
  const consumedVideoIds = useRef(new Set());
  // Consecutive pages that came back with zero results after a search/topic
  // filter was applied server-side — resets to 0 the moment any page has
  // real posts. Guards the "keep auto-fetching while hasMore" effect below:
  // hasMore now correctly reflects the server's own real cursor/page
  // exhaustion rather than "did THIS page have anything" (see loadPage's
  // own comment), which is what actually fixes empty-first-page search
  // results — but a search term with genuinely zero matches anywhere would
  // otherwise auto-fetch page after page in the background forever, since
  // the server can keep saying hasMore:true right up until real exhaustion
  // regardless of the filter ever matching anything. Capped rather than
  // trusting the server's own bounded-retry (fetchPlayableVideoPage's own
  // 4 attempts) alone, since that resets per-request — this tracks across
  // the whole client-side auto-fetch sequence instead.
  const emptyStreakRef = useRef(0);
  const EMPTY_STREAK_LIMIT = 6;
  const loadingMoreRef = useRef(false);
  const requestControllerRef = useRef(null);
  const pendingRequestIntentRef = useRef(null);
  const retryStateRef = useRef({ failures: 0, until: 0 });
  const [retryAt, setRetryAt] = useState(0);
  const lastFeedReadRef = useRef(0);
  // Reset/filter/focus loads can overlap. Only the newest request may
  // replace the queue; otherwise an identical late response is filtered by
  // knownIds and can incorrectly turn a valid video page into an empty one.
  const loadRequestRef = useRef(0);
  // Keep a session-wide set so pagination cannot reappend a video that was
  // already delivered while a consumed-state write is in flight.
  const knownIds = useRef(new Set());
  // Both modes use opaque backend cursors. Feed advances through retained
  // database history; Following advances through each connected source's
  // live pool without relying on delayed viewed-state writes.
  const cursorRef = useRef(null);
  const followingPageRef = useRef(1);
  const markKnownId = useCallback((id) => {
    if (!id || knownIds.current.has(id)) return;
    knownIds.current.add(id);
    trimOldest(knownIds.current);
  }, []);

  const loadPage = useCallback(async ({ reset = false, bust = false, preserveOnEmpty = false, preserveQueue = false, quiet = false, continuationDepth = 0 } = {}) => {
    const intent = { reset, bust, preserveOnEmpty, preserveQueue, quiet };
    if (reset) {
      // A new filter supersedes both an in-flight page and a delayed retry.
      // Retain its reset semantics while honoring server overload backoff.
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      loadRequestRef.current += 1;
      pendingRequestIntentRef.current = intent;
    }
    if (Date.now() < retryStateRef.current.until) {
      if (!quiet) setLoading(false);
      return;
    }
    if (!reset && pendingRequestIntentRef.current?.reset) return loadPage(pendingRequestIntentRef.current);
    if (!reset && requestControllerRef.current && continuationDepth === 0) return;
    if (reset) requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const requestId = ++loadRequestRef.current;
    const requestContext = contextKeyRef.current;
    try {
      // A genuinely new search/topic/filter/mode shouldn't inherit a
      // streak left over from whatever was applied before it — otherwise
      // a brand new filter's own first (possibly also thin) page could
      // get immediately blocked from auto-continuing by a limit already
      // used up by the previous one.
      if (reset) {
        emptyStreakRef.current = 0;
        if (continuationDepth === 0) setTailWaiting(false);
      }
      const mode = viewModeRef.current;
      const src = sourceFilterRef.current;
      let params = `limit=10&sort=newest`;
      // Same ?source= (single)/?sources= (multi) convention as the main feed.
      if (src.length === 1) params += `&source=${encodeURIComponent(src[0])}`;
      else if (src.length > 1) params += `&sources=${src.map(encodeURIComponent).join(',')}`;
      // Same ?q=/?topics= convention as the main feed (see handleFeedRequest/
      // handleVideoFeedRequest server-side).
      if (searchQueryRef.current) params += `&q=${encodeURIComponent(searchQueryRef.current)}`;
      if (music && genreRef.current) params += `&genre=${encodeURIComponent(genreRef.current)}`;
      if (topicFiltersRef.current.length) params += `&topics=${topicFiltersRef.current.map(encodeURIComponent).join(',')}`;
      let endpoint;
      if (mode === 'following') {
        if (reset) {
          followingPageRef.current = 1;
          cursorRef.current = null;
        }
        params += `&page=${followingPageRef.current}`;
        if (cursorRef.current) params += `&cursor=${encodeURIComponent(cursorRef.current)}`;
        // getFollowingFeedPosts backend-side now has its own caching per
        // connected source (YouTube's subscription feed) — bust=1 does
        // apply here, same as the main feed: without
        // it, a manual refresh had no way to get past that cache, so a
        // bad/empty result cached right after first connecting an account
        // could sit there for the full cache window regardless of how many
        // times "Refresh now" was tapped.
        if (bust) params += `&bust=1`;
        endpoint = '/office/feed/videos/following';
      } else {
        if (reset) cursorRef.current = null;
        if (cursorRef.current) params += `&cursor=${encodeURIComponent(cursorRef.current)}`;
        if (bust) params += `&bust=1`;
        endpoint = music ? '/office/feed/music' : '/office/feed/videos';
      }
      const { data } = await client.get(`${endpoint}?${params}`, {
        signal: controller.signal, _ufiManagedRetry: true,
      });
      if (requestId !== loadRequestRef.current || requestContext !== contextKeyRef.current) return;
      lastFeedReadRef.current = Date.now();
      setSourceErrors(mode === 'following' ? data.sourceErrors || {} : {});
      pendingRequestIntentRef.current = null;
      retryStateRef.current = { failures: 0, until: 0 };
      setRetryAt(0);
      const incoming = (Array.isArray(data.posts) ? data.posts : []).filter(post => {
        const playable = resolveVideoSource(post);
        if (!playable || isShortFeedVideo(videoDurationSeconds(post))) return false;
        return !isShortFeedVideo(durationCacheRef.current.get(videoSourceKey(playable)));
      });
      const isExplicitSearch = Boolean(searchQueryRef.current);
      const sourceExhausted = data.waitingForNew === true || data.hasMore === false;
      if (reset && isExplicitSearch) {
        // Search is the explicit exception to the no-repeat rule.
        knownIds.current = new Set();
      }
      // Picking/clearing a filter can legitimately return an unwatched item
      // already waiting in the current queue. The delivery dedupe must not
      // turn that selection into an empty feed. Refresh and cursor requests
      // still require new IDs, and consumed videos are never reintroduced.
      const retainedUnwatched = reset && !bust && !preserveOnEmpty && !preserveQueue
        ? new Set(queueRef.current.filter(post => !consumedVideoIds.current.has(post.id)).map(post => post.id))
        : null;
      const fresh = isExplicitSearch ? incoming : incoming.filter(p => !knownIds.current.has(p.id) || retainedUnwatched?.has(p.id));
      fresh.forEach(p => markKnownId(p.id));
      const previousQueue = queueRef.current;
      const nextQueue = (() => {
        const prev = previousQueue;
        // A flat all-time dedup here used to make infinite scroll dead-end
        // (once a user had scrolled through the whole real pool once, every
        // later page was "all already seen" and got filtered to nothing) —
        // but no dedup at all made the opposite mistake: two page requests
        // can still hand back overlapping content near a mode/filter
        // switch boundary, which read as duplicate videos appearing in
        // quick succession. A bounded rolling window filters near-term
        // repeats from either cause while still admitting a genuine repeat
        // once it's fallen out of the window. React keys below are still
        // (id + index) since a repeat past the window is still expected
        // eventually.
        //
        // Following mode skips the window entirely instead — its backend
        // pool (handleFollowingVideoFeedRequest) is often much smaller than
        // VIDEO_DEDUP_WINDOW (400), and it deliberately wraps around and
        // re-serves reshuffled content once that pool is exhausted (real
        // seen-tracking already happens server-side via filterUnseen/
        // markPostsSeen). With the window applied here too, every wrapped-
        // around repeat landed inside it and got silently dropped, making
        // Following videos look stuck at a small fixed amount even while
        // the server kept reporting hasMore:true. Confirmed live as
        // exactly that complaint.
        // A reset always replaces wholesale rather than merging — a
        // user-initiated refresh should hand back a clean view instead of
        // old and new videos interleaved indefinitely.
        if (reset && preserveOnEmpty && fresh.length === 0 && prev.length > 0) return prev;
        if (reset && preserveQueue) {
          // Background arrivals must never replace the clip being watched.
          // Append new clips; only an explicit refresh resets the queue.
          const existingIds = new Set(prev.map(post => post.id));
          return [...prev, ...orderNewestFeedCohorts(fresh).filter(post => !existingIds.has(post.id))];
        }
        if (reset) return orderNewestFeedCohorts(fresh);
        // Cursor pages are already ordered by the API. Re-sorting the full
        // mounted queue here moves slides above the viewport and makes the
        // same swipe jump backward when pagination lands.
        return [...prev, ...fresh];
      })();
      // Keep a small rewind window while dropping old slide DOM, metadata,
      // and decoded-media owners during long sessions. Preserve the active
      // item and compensate scrollTop before the next paint.
      const excess = Math.max(0, nextQueue.length - VIDEO_QUEUE_LIMIT);
      const removeBefore = reset ? 0 : Math.min(excess, Math.max(0, activeIndexRef.current - 10));
      const retained = nextQueue.slice(removeBefore, removeBefore + VIDEO_QUEUE_LIMIT);
      // A background refresh may replace the unseen tail. Allow those IDs
      // to be fetched again from the cursor instead of permanently skipping them.
      nextQueue.slice(removeBefore + VIDEO_QUEUE_LIMIT).forEach(post => knownIds.current.delete(post.id));
      queueRef.current = retained;
      if (removeBefore) {
        activeIndexRef.current -= removeBefore;
        pendingScrollIndexRef.current = activeIndexRef.current;
        setActiveIndex(activeIndexRef.current);
      }
      setVideoPosts(retained);
      if (sourceExhausted && !isExplicitSearch) {
        cursorRef.current = null;
        if (mode === 'following') followingPageRef.current = 1;
      } else if (mode === 'following') {
        followingPageRef.current += 1;
        if (data.cursor) cursorRef.current = data.cursor;
      } else if (data.cursor) cursorRef.current = data.cursor;
      // Was `data.hasMore !== false && incoming.length > 0` — conflated
      // "this one page happened to have zero results" with "there's
      // nothing left at all." A search/topic filter is applied server-
      // side against whatever page the cursor/balanced-page query already
      // fetched, same as a plain scroll — a narrow search term can easily
      // land on a page with zero matches while real matches sit further
      // back behind the SAME still-valid cursor. incoming.length===0 was
      // overriding the server's own hasMore to false right there, ending
      // pagination permanently on the very first thin page instead of
      // continuing to page forward — confirmed live as "No videos yet"
      // for search terms that do have real matches, just not on page one.
      // emptyStreakRef (below) is what keeps this from turning into an
      // unbounded background hammering loop for a term with genuinely no
      // matches anywhere.
      if (!isExplicitSearch) {
        setHasMore(true);
        emptyStreakRef.current = 0;
        setTailWaiting(sourceExhausted);
      } else if (!preserveOnEmpty || incoming.length > 0) {
        setHasMore(data.hasMore !== false);
        emptyStreakRef.current = incoming.length > 0 ? 0 : emptyStreakRef.current + 1;
      }
      setError(false);

      // A balanced cursor page can contain only videos already mounted in
      // this session. Keep scanning a bounded number of pages immediately
      // instead of waiting for a state change that never arrives. At true
      // exhaustion the cursor is reset above and the quiet tail poll takes
      // over, so watched videos are never recycled just to look endless.
      if (!isExplicitSearch && fresh.length === 0 && !sourceExhausted && continuationDepth < EMPTY_STREAK_LIMIT) {
        return loadPage({
          preserveOnEmpty: true,
          quiet: true,
          continuationDepth: continuationDepth + 1,
        });
      }
    } catch (failure) {
      if (requestId !== loadRequestRef.current || controller.signal.aborted || requestContext !== contextKeyRef.current) return;
      const status = failure?.response?.status;
      if (!status || status === 429 || status >= 500) {
        pendingRequestIntentRef.current = intent;
        const failures = Math.min(6, retryStateRef.current.failures + 1);
        const retryHeader = failure?.response?.headers?.['retry-after'];
        const retrySeconds = Number(retryHeader);
        const serverDelay = Number.isFinite(retrySeconds) ? retrySeconds * 1000 : Math.max(0, Date.parse(retryHeader) - Date.now()) || 0;
        const delay = Math.max(serverDelay, Math.min(VIDEO_RETRY_MAX_MS, 1000 * 2 ** failures)) + Math.random() * 1500;
        retryStateRef.current = { failures, until: Date.now() + delay };
        setRetryAt(retryStateRef.current.until);
      } else {
        pendingRequestIntentRef.current = null;
        retryStateRef.current = { failures: 0, until: 0 };
        setRetryAt(0);
      }
      if (!quiet) setError(true);
    } finally {
      if (requestId === loadRequestRef.current) {
        requestControllerRef.current = null;
        setLoading(false);
      }
    }
  }, [markKnownId, music]);

  useEffect(() => () => { loadRequestRef.current += 1; requestControllerRef.current?.abort(); }, []);
  useEffect(() => {
    requestControllerRef.current?.abort();
    loadRequestRef.current += 1;
    retryStateRef.current = { failures: 0, until: 0 };
    pendingRequestIntentRef.current = null;
    knownIds.current = new Set();
    consumedVideoIds.current = new Set();
    queueRef.current = [];
    setVideoPosts([]);
    setActiveIndex(0);
    setCommentsPost(null);
    setLoading(true);
    setError(false);
    setSourceErrors({});
    if (lastMemberRef.current !== profile?.id) {
      lastMemberRef.current = profile?.id;
      sourceFilterRef.current = []; topicFiltersRef.current = []; searchQueryRef.current = ''; genreRef.current = '';
      setSourceFilter([]); setTopicFilters([]); setSearchQuery(''); setSearchInput(''); setGenre('');
      viewModeRef.current = 'feed'; setViewMode('feed');
    }
    if (profile?.id) loadPage({ reset: true });
    return () => { loadRequestRef.current += 1; requestControllerRef.current?.abort(); };
  }, [loadPage, regionalKey]);

  useEffect(() => {
    if (!retryAt) return;
    const retry = () => {
      if (document.hidden || Date.now() < retryStateRef.current.until || requestControllerRef.current) return;
      loadPage(pendingRequestIntentRef.current || { reset: queueRef.current.length === 0, preserveOnEmpty: true, quiet: queueRef.current.length > 0 });
    };
    const timeout = window.setTimeout(retry, Math.max(0, Math.ceil(retryAt - Date.now())));
    document.addEventListener('visibilitychange', retry);
    return () => { window.clearTimeout(timeout); document.removeEventListener('visibilitychange', retry); };
  }, [retryAt, loadPage]);

  // A refresh/filter response can legitimately contain fewer items than the
  // prior queue. Keep the active pointer valid instead of leaving mobile
  // player effects pointed at an index that no longer exists.
  useEffect(() => {
    setActiveIndex(current => Math.min(Math.max(current, 0), Math.max(videoPosts.length - 1, 0)));
  }, [videoPosts.length]);

  useLayoutEffect(() => {
    if (pendingScrollIndexRef.current === null || !containerRef.current) return;
    containerRef.current.scrollTop = pendingScrollIndexRef.current * containerRef.current.clientHeight;
    pendingScrollIndexRef.current = null;
  }, [videoPosts]);

  const videoLiveStateRef = useRef({ loading: false, refreshing: false, activeIndex: 0 });
  useEffect(() => {
    videoLiveStateRef.current = { loading, refreshing, activeIndex };
  }, [loading, refreshing, activeIndex]);

  useEffect(() => {
    const refreshQuietly = () => {
      const state = videoLiveStateRef.current;
      if (document.hidden || state.loading || state.refreshing || loadingMoreRef.current || Date.now() - lastFeedReadRef.current < 30000) return;
      if (state.activeIndex !== 0 || (containerRef.current?.scrollTop || 0) > 1) return;
      loadPage({ reset: true, bust: false, preserveOnEmpty: true, preserveQueue: true, quiet: true });
    };
    const interval = window.setInterval(refreshQuietly, VIDEO_FEED_AUTO_REFRESH_MS + Math.random() * 30000);
    window.addEventListener('focus', refreshQuietly);
    document.addEventListener('visibilitychange', refreshQuietly);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshQuietly);
      document.removeEventListener('visibilitychange', refreshQuietly);
    };
  }, [loadPage]);

  // Manual refresh — fully replaces the queue with a fresh first page, same
  // as the main Feed's refresh — the view is already jumping back to the
  // first slide, so there's no "losing your place" cost to a full reset
  // here, and it means refresh actually reads as a refresh instead of old
  // and new videos staying interleaved together indefinitely.
  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setActiveIndex(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
    await loadPage({ reset: true, bust: true, preserveOnEmpty: true });
    setRefreshing(false);
  }, [refreshing, loadPage]);

  // Feed and Following pull from entirely different endpoints/pools (see
  // loadPage) with no shared source vocabulary between them, same reasoning
  // as switchViewMode in pages/Feed.jsx — switching mode always clears
  // whatever platform filter was selected and starts a clean page-1 load.
  const switchViewMode = useCallback((mode) => {
    const next = mode === 'following' ? 'following' : 'feed';
    if (next === viewModeRef.current) return;
    viewModeRef.current = next;
    setViewMode(next);
    sourceFilterRef.current = [];
    setSourceFilter([]);
    setActiveIndex(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
    setLoading(true);
    loadPage({ reset: true });
  }, [loadPage]);

  // Multi-select: tapping an unselected chip adds it, tapping a selected one
  // removes it — combining platforms is what actually exercises the
  // server's true-mix rebalancing for a filtered selection (see loadPage's
  // ?sources= param).
  const toggleSourceFilter = useCallback((key) => {
    const current = sourceFilterRef.current;
    const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
    sourceFilterRef.current = next;
    setSourceFilter(next);
    setActiveIndex(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
    setLoading(true);
    loadPage({ reset: true });
  }, [loadPage]);

  const clearSourceFilter = useCallback(() => {
    if (!sourceFilterRef.current.length) return;
    sourceFilterRef.current = [];
    setSourceFilter([]);
    setActiveIndex(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
    setLoading(true);
    loadPage({ reset: true });
  }, [loadPage]);

  // Multi-select, applies immediately — same pattern as toggleSourceFilter
  // above, now that Topic lives in the same immediate-apply Filter sheet as
  // Platform rather than paired with
  // Search's own text input (which does need to defer to a Done tap —
  // fetching on every keystroke isn't reasonable, but a topic pick isn't
  // keystroke-driven, so there's no reason to defer this one either).
  // Tapping an unselected chip adds it, tapping a selected one removes it
  // — the backend matches a post whose topic is ANY of the selected ones
  // (see handleVideoFeedRequest's topicsFilter), same idea as the
  // platform filter just above.
  const toggleTopicFilter = useCallback((topic) => {
    const current = topicFiltersRef.current;
    const next = current.includes(topic) ? current.filter(t => t !== topic) : [...current, topic];
    topicFiltersRef.current = next;
    setTopicFilters(next);
    setActiveIndex(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
    setLoading(true);
    loadPage({ reset: true });
  }, [loadPage]);

  const clearTopicFilter = useCallback(() => {
    if (!topicFiltersRef.current.length) return;
    topicFiltersRef.current = [];
    setTopicFilters([]);
    setActiveIndex(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
    setLoading(true);
    loadPage({ reset: true });
  }, [loadPage]);

  // Filter sheet's "Clear all" resets source and topic together. Search
  // remains independent in its own sheet.
  const selectGenre = (value) => {
    genreRef.current = value; setGenre(value); setActiveIndex(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
    setLoading(true); loadPage({ reset: true });
  };

  const clearFilters = useCallback(() => {
    if (!sourceFilterRef.current.length && !topicFiltersRef.current.length && !genreRef.current) return;
    genreRef.current = ''; setGenre('');
    sourceFilterRef.current = [];
    setSourceFilter([]);
    topicFiltersRef.current = [];
    setTopicFilters([]);
    setActiveIndex(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
    setLoading(true);
    loadPage({ reset: true });
  }, [loadPage]);

  // Search sheet's own Done/Enter — uncommitted searchInput (the textbox)
  // vs. committed searchQuery/searchQueryRef (what's actually applied and
  // sent to loadPage), same reasoning as before: deferred rather than
  // live-as-you-type, since a debounced live search doesn't make much
  // sense tucked inside a sheet the user has to deliberately open anyway.
  const applySearch = useCallback(() => {
    const trimmed = searchInput.trim();
    if (trimmed === searchQueryRef.current) return;
    searchQueryRef.current = trimmed;
    setSearchQuery(trimmed);
    setActiveIndex(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
    setLoading(true);
    loadPage({ reset: true });
  }, [searchInput, loadPage]);

  const clearSearch = useCallback(() => {
    if (!searchInput && !searchQueryRef.current) return;
    setSearchInput('');
    searchQueryRef.current = '';
    setSearchQuery('');
    setActiveIndex(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
    setLoading(true);
    loadPage({ reset: true });
  }, [searchInput, loadPage]);

  // Scrolling back up to video 1 after having scrolled further in acts as
  // pull-to-refresh, same mechanism as every other list on the site — no
  // separate touch-drag handling needed since the snap-scroll container
  // already reports scrollTop the same way a normal list would.
  useScrollToRefresh(handleRefresh, { containerRef, enabled: !loading });

  // This observer only records videos that have moved above the viewport.
  // Active selection is synchronized from real scrollTop below, avoiding an
  // undefined gap where neither of two half-visible slides crosses 60%.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const idx = Number(entry.target.dataset.idx);
        if (Number.isNaN(idx)) return;
        const passedAboveViewport = !entry.isIntersecting
          && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0);
        const post = videoPosts[idx];
        if (passedAboveViewport && post?.id && !consumedVideoIds.current.has(post.id)) {
          consumedVideoIds.current.add(post.id);
          trimOldest(consumedVideoIds.current);
          reportConsumed(post.id, 'videos');
        }
      });
    }, { root: container, threshold: 0 });
    slideRefs.current.forEach(el => el && observer.observe(el));
    return () => observer.disconnect();
  }, [videoPosts]);

  // Actively-scrolling detection, separate from the intersection-based
  // "which slide is active" above — that one only fires once a slide has
  // settled past the 60% threshold, so a fast fling through several videos
  // still briefly crossed 60% on each one along the way, each flicker
  // triggering a real decode+play() just to be paused again a moment later
  // (confirmed live as audible stutter during a fast scroll). Pausing
  // whatever's active for the duration of the scroll gesture — not
  // switching slides, not touching playback position — and resuming once
  // scrolling has actually stopped avoids that thrash. 150ms of no scroll
  // events is the same kind of settle window native mobile UIs use for
  // "has scrolling stopped" (a real end-of-scroll event isn't reliably
  // available across browsers, so this is the standard debounce fallback).
  const [isScrolling, setIsScrolling] = useState(false);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let settleTimer;
    let activeFrame;
    const syncActiveSlide = () => {
      activeFrame = null;
      const height = container.clientHeight || 1;
      const next = Math.min(
        Math.max(Math.round(container.scrollTop / height), 0),
        Math.max(videoPosts.length - 1, 0),
      );
      setActiveIndex(current => current === next ? current : next);
    };
    const handleScroll = () => {
      setIsScrolling(true);
      if (!activeFrame) activeFrame = requestAnimationFrame(syncActiveSlide);
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        syncActiveSlide();
        setIsScrolling(false);
      }, 150);
    };
    syncActiveSlide();
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (activeFrame) cancelAnimationFrame(activeFrame);
      clearTimeout(settleTimer);
    };
  }, [videoPosts.length]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleKey = event => {
      if (event.target !== container || !['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp'].includes(event.key)) return;
      event.preventDefault();
      const direction = ['ArrowDown', 'ArrowRight', 'PageDown'].includes(event.key) ? 1 : -1;
      const next = Math.max(0, Math.min(queueRef.current.length - 1, activeIndexRef.current + direction));
      container.scrollTo({ top: next * container.clientHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    };
    container.addEventListener('keydown', handleKey);
    return () => container.removeEventListener('keydown', handleKey);
  }, [videoPosts.length]);

  // Mouse click-and-drag scrolling. A mouse drag
  // over a plain overflow:auto container does nothing by default; the
  // browser instead tries to *select text*, which is exactly what showed up
  // as a stray text-caret cursor over the video on desktop and why nothing
  // advanced when dragging with a mouse there. Skipped entirely when the
  // drag starts on a real control (button/link) or the expanded caption
  // text (its own overflowY:auto needs to own drags that start on it — see
  // the caption's pointerEvents/className below) so those keep working
  // normally. scroll-snap (already on the container) takes over on release
  // exactly like it does after a wheel scroll, settling on the nearest
  // slide without any extra code here.
  //
  // The shared YouTube frame lives inside this scrolling region. Its own
  // controls handle their input; the browser chains wheel/touch scrolling
  // to this ancestor without a transparent layer covering the player.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    function handlePointerDown(e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if (e.target.closest('button, a, video[controls], input, [role="button"], .video-caption-scroll')) return;
      const startY = e.clientY;
      const startScrollTop = container.scrollTop;
      let dragged = false;
      function handleMove(ev) {
        const dy = ev.clientY - startY;
        if (Math.abs(dy) > 3) dragged = true;
        if (dragged) container.scrollTop = startScrollTop - dy;
      }
      function handleUp() {
        document.removeEventListener('pointermove', handleMove);
        document.removeEventListener('pointerup', handleUp);
        container.style.cursor = 'grab';
        // Set back to 'none' rather than removeProperty()'d away: this
        // element's JSX also declares userSelect:'none' as its permanent
        // default, and React only re-touches a style property on render
        // when ITS OWN last-known value for it changed — since that JSX
        // value never changes, a later render wouldn't notice (or undo) a
        // removeProperty() done here outside React, permanently reverting
        // to selectable text after the very first drag.
        container.style.userSelect = 'none';
      }
      container.style.cursor = 'grabbing';
      container.style.userSelect = 'none';
      document.addEventListener('pointermove', handleMove);
      document.addEventListener('pointerup', handleUp, { once: true });
    }
    container.addEventListener('pointerdown', handlePointerDown);
    return () => {
      container.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [videoPosts.length]);

  // Horizontal swipes browse the same queue as vertical scrolling. Native
  // controls and cross-origin players keep their own gestures; no overlay
  // intercepts them. The delayed vertical fallback only handles a clear
  // swipe that did not move the nested snap container on its own.
  const activeSwipePostId = videoPosts[activeIndex]?.id;
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let gesture = null;
    let fallbackTimer = null;
    let pendingSwipe = null;
    const cancelTouch = () => {
      gesture = null;
      pendingSwipe = null;
      clearTimeout(fallbackTimer);
    };
    const handleTouchStart = event => {
      cancelTouch();
      const target = event.target instanceof Element ? event.target : null;
      const video = target?.closest('video[controls]');
      const controlTouch = video && event.touches[0]?.clientY >= video.getBoundingClientRect().bottom - 64;
      if (event.touches.length !== 1 || controlTouch
        || target?.closest('input, textarea, select, button, a, audio[controls], [role="button"], [role="slider"], [contenteditable="true"]')
        || performance.now() - lastSwipeAtRef.current < 500) {
        return;
      }
      gesture = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
        identifier: event.touches[0].identifier,
        startedAt: performance.now(),
        scrollTop: container.scrollTop,
        scrollMoved: false,
        nestedScroller: event.target instanceof Element
          ? event.target.closest('.video-caption-scroll')
          : null,
      };
    };
    const handleTouchMove = event => {
      if (event.touches.length !== 1) cancelTouch();
    };
    const handleGestureScroll = () => {
      const start = gesture || pendingSwipe;
      if (start && Math.abs(container.scrollTop - start.scrollTop) > 16) start.scrollMoved = true;
    };
    const handleTouchEnd = event => {
      if (!gesture) return;
      const start = gesture;
      gesture = null;
      if (event.touches.length || event.changedTouches.length !== 1
        || event.changedTouches[0].identifier !== start.identifier
        || performance.now() - start.startedAt > 900 || start.scrollMoved) return;
      const deltaX = start.x - event.changedTouches[0].clientX;
      const deltaY = start.y - event.changedTouches[0].clientY;
      const horizontal = Math.abs(deltaX) >= 56 && Math.abs(deltaX) >= Math.abs(deltaY) * 1.4;
      const vertical = Math.abs(deltaY) >= 56 && Math.abs(deltaY) >= Math.abs(deltaX) * 1.4;
      if (!horizontal && !vertical) return;
      if (vertical && start.nestedScroller) {
        const maxScroll = start.nestedScroller.scrollHeight - start.nestedScroller.clientHeight;
        const canContinueInside = deltaY > 0
          ? start.nestedScroller.scrollTop < maxScroll - 1
          : start.nestedScroller.scrollTop > 1;
        if (canContinueInside) return;
      }
      clearTimeout(fallbackTimer);
      const advance = () => {
        pendingSwipe = null;
        if (start.scrollMoved || Math.abs(container.scrollTop - start.scrollTop) > 16
          || performance.now() - lastSwipeAtRef.current < 500) return;
        const height = container.clientHeight || 1;
        const startIndex = Math.round(start.scrollTop / height);
        const direction = (horizontal ? deltaX : deltaY) > 0 ? 1 : -1;
        const targetIndex = Math.min(
          Math.max(startIndex + direction, 0),
          Math.max(videoPosts.length - 1, 0),
        );
        if (targetIndex === startIndex) return;
        lastSwipeAtRef.current = performance.now();
        container.scrollTo({
          top: targetIndex * height,
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        });
      };
      if (horizontal) advance();
      else {
        pendingSwipe = start;
        fallbackTimer = setTimeout(advance, 120);
      }
    };
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', cancelTouch, { passive: true });
    container.addEventListener('scroll', handleGestureScroll, { passive: true });
    return () => {
      cancelTouch();
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', cancelTouch);
      container.removeEventListener('scroll', handleGestureScroll);
    };
  }, [activeIndex, activeSwipePostId, videoPosts.length, regionalKey, music, searchQuery]);

  // Fetch the next page a couple of slides before actually running out.
  // emptyStreakRef cap (see its own declaration above): without it, a
  // search/topic filter matching nothing anywhere would auto-fetch page
  // after page in the background indefinitely, since the server's hasMore
  // reflects real cursor exhaustion, not whether the filter ever matched
  // anything — this stops that once it's genuinely looking hopeless
  // rather than hammering the server (and the user's connection) forever
  // in a loop that never shows anything on screen.
  useEffect(() => {
    if (document.hidden || tailWaiting || !hasMore || loadingMoreRef.current || loading) return;
    if (searchQueryRef.current && emptyStreakRef.current >= EMPTY_STREAK_LIMIT) return;
    if (activeIndex >= videoPosts.length - 3) {
      loadingMoreRef.current = true;
      // A later page may time out on a mobile connection. The videos already
      // on screen remain usable, so this must stay quiet rather than replace
      // the whole swipe feed with an error state.
      loadPage({ quiet: true }).finally(() => { loadingMoreRef.current = false; });
    }
  }, [activeIndex, videoPosts.length, hasMore, tailWaiting, loading, loadPage]);

  // "Endless" here means the tail stays live for newly transferred unseen
  // videos. It deliberately does not wrap back to watched slides. Once the
  // retained cursor is exhausted, restart from newest on a quiet cadence;
  // knownIds and the backend's seen set discard anything already delivered.
  useEffect(() => {
    if (!tailWaiting || searchQuery) return undefined;
    const pollForNewVideos = () => {
      const state = videoLiveStateRef.current;
      if (document.hidden || state.loading || state.refreshing || loadingMoreRef.current) return;
      if (state.activeIndex < Math.max(videoPosts.length - 3, 0)) return;
      loadingMoreRef.current = true;
      loadPage({ preserveOnEmpty: true, quiet: true })
        .finally(() => { loadingMoreRef.current = false; });
    };
    const interval = window.setInterval(pollForNewVideos, VIDEO_FEED_TAIL_POLL_MS + Math.random() * 15000);
    return () => window.clearInterval(interval);
  }, [tailWaiting, searchQuery, videoPosts.length, loadPage]);

  // 73% of everything that ever shows up in this feed (checked live
  // against the DB: 160 of 219 cached video posts) resolves to the
  // youtube kind — not just the dedicated YouTube source, but DEV
  // Community's own /api/videos endpoint (100% YouTube-hosted under the
  // hood) and a chunk of Reddit's link posts too. Whatever slide the user
  // starts on, there's a strong chance a YouTube video is coming up soon,
  // so this warms up everything that's on YouTube's critical path *before*
  // it's actually needed instead of paying for it right when a video
  // needs to start: preconnect gets the DNS/TLS handshake to YouTube's
  // domains done ahead of time, and loadYouTubeIframeApi() kicks off
  // fetching+parsing the IFrame API script immediately rather than
  // waiting for the first YouTube slide to become active (previously the
  // very first YouTube video reached in a session paid for all of that
  // network/parse latency inline, on top of player construction). Safe to
  // call unconditionally even if the user never actually hits a YouTube
  // video this session — a few KB of an unused script and some idle
  // connections, nothing that costs playback quality. loadYouTubeIframeApi
  // itself memoizes (module-level youtubeApiPromise), so the shared-
  // player effect's own later call just reuses this same one, no double
  // fetch.
  useEffect(() => {
    const head = document.head;
    const links = ['https://www.youtube.com', 'https://i.ytimg.com', 'https://www.google.com'].map(href => {
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = href;
      link.crossOrigin = '';
      head.appendChild(link);
      return link;
    });
    loadYouTubeIframeApi().catch(() => {});
    return () => links.forEach(l => l.remove());
  }, []);

  // Vimeo is a plain iframe with no postMessage control layer (see
  // VideoSlide's own vimeo render branch) — this shared button can't
  // actually change its audio once mounted, only the `muted` state
  // file/hls/youtube slides read. Toggling it while looking at a Vimeo
  // slide would silently do nothing but still look like it worked, which
  // is worse than being upfront that it's not controllable here — dimmed
  // and inert instead, rather than a false control. Computed here (moved
  // up from just above the render) since the shared YouTube player effect
  // below needs it too.
  const resolvedActiveSrc = resolveVideoSource(videoPosts[activeIndex] || {});
  const activeYoutubeOrientation = resolvedActiveSrc?.kind === 'youtube'
    ? youtubeFrameOrientations[resolvedActiveSrc.id]
    : null;
  const activeSrc = resolvedActiveSrc?.kind === 'youtube'
    ? {
        ...resolvedActiveSrc,
        vertical: resolvedActiveSrc.vertical === true || activeYoutubeOrientation === 'portrait',
      }
    : resolvedActiveSrc;
  const muteControllable = activeSrc?.kind !== 'vimeo';
  // Landscape (16:9) YouTube/Vimeo content — the norm for DEV Community's
  // own tutorial videos, most Reddit clips, and any design-blog Vimeo
  // showcase reel, none of which are ever tagged vertical:true (that flag
  // only exists for confirmed Shorts) — letterboxes inside the same tall,
  // portrait-shaped card built for native vertical content, filling only
  // its top ~35% and reading as "smaller than everything else." Only
  // youtube carries a real vertical flag either way (Shorts detection);
  // vimeo never does, but this pipeline's vimeo embeds are themselves
  // design/blog showcase reels — same landscape assumption, reasonably
  // safe absent a real signal either way. See the matching
  // [data-orientation="landscape"] rule in index.css for the actual size
  // change, gated to the same desktop/tablet breakpoint as the rest of
  // the card so mobile (already full-bleed either way) is untouched.
  const activeIsWideVideo = activeSrc?.kind === 'youtube' ? activeSrc.vertical === false : activeSrc?.kind === 'vimeo';

  // RSS uses /watch URLs for both ordinary videos and Shorts. YouTube's
  // frame0 image carries the real frame orientation, including for those
  // ambiguous existing posts. Cache one small image probe per video so a
  // portrait upload fills the mobile feed instead of being boxed inside a
  // landscape iframe.
  useEffect(() => {
    if (
      resolvedActiveSrc?.kind !== 'youtube'
      || resolvedActiveSrc.vertical === true
      || activeYoutubeOrientation
    ) return;
    const videoId = resolvedActiveSrc.id;
    const probe = new Image();
    let cancelled = false;
    const settle = (orientation) => {
      if (cancelled) return;
      setYoutubeFrameOrientations(current => current[videoId] ? current : Object.fromEntries(
        [...Object.entries(current), [videoId, orientation]].slice(-VIDEO_HISTORY_LIMIT)
      ));
    };
    probe.onload = () => settle(probe.naturalHeight > probe.naturalWidth ? 'portrait' : 'landscape');
    probe.onerror = () => settle('landscape');
    probe.src = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/frame0.jpg`;
    return () => { cancelled = true; };
  }, [resolvedActiveSrc?.kind, resolvedActiveSrc?.id, resolvedActiveSrc?.vertical, activeYoutubeOrientation]);

  // ─── Shared YouTube player ──────────────────────────────────────────────
  // One YT.Player instance for the whole session instead of one per slide,
  // destroyed and reconstructed on every scroll. Browsers grant autoplay
  // leniency per *iframe*, not per site — recreating a fresh iframe every
  // slide switch threw away any "this frame has real user engagement"
  // trust the moment a user's first manual tap earned it, so every single
  // video started back at zero trust and needed its own tap. Confirmed
  // live: Bluesky/direct-file videos (native <video> elements, no iframe)
  // autoplay reliably in this same view; YouTube's routinely don't. Keeping
  // one iframe alive and swapping its video via loadVideoById() lets
  // engagement earned on an earlier video actually carry forward instead
  // of resetting every time.
  const sharedYtHostRef = useRef(null);
  const sharedYtPlayerRef = useRef(null);
  const sharedYtLoadedIdRef = useRef(null);
  const sharedYtReadyRef = useRef(false);
  const sharedYtCreatingRef = useRef(false);
  const sharedYtMountedRef = useRef(false);
  const sharedYtLifecycleRef = useRef(0);
  const sharedYtDesiredIdRef = useRef(null);
  const sharedYtMutedRef = useRef(muted);
  const sharedYtHiddenResumeRef = useRef(null);
  // Guards a fast-swipe race on loadVideoById — see the effect below.
  const sharedYtPendingLoadRef = useRef(null);
  const sharedYtRetryRef = useRef(null);
  const sharedYtReadyTimeoutRef = useRef(null);
  const sharedYtResumeRef = useRef(null);
  const [sharedYt, setSharedYt] = useState({ paused: false, duration: 0, currentTime: 0, failed: false });
  sharedYtDesiredIdRef.current = activeSrc?.kind === 'youtube' ? activeSrc.id : null;
  sharedYtMutedRef.current = muted;

  // The video box's own width/height:auto + max-width/max-height:100% +
  // aspect-ratio (the usual pure-CSS way to fit a ratio inside a box) turns
  // out not to resolve reliably here: this box is a flex item centered
  // (not stretched) inside its parent, so neither axis ever becomes
  // definite from layout, and with no other intrinsic size to fall back on
  // aspect-ratio alone doesn't anchor it to the parent's real size — it
  // collapses toward content size instead, which for an <iframe> with no
  // explicit width/height is the browser's own ~300x150 default. Confirmed
  // live: a landscape video rendering at roughly that exact size regardless
  // of how large the surrounding card actually was. Measuring the wrapper
  // directly and computing explicit pixel dimensions sidesteps the
  // ambiguity entirely instead of relying on that CSS behavior resolving
  // the way it's supposed to.
  const sharedYtWrapperRef = useRef(null);
  const [ytBoxSize, setYtBoxSize] = useState({ width: 0, height: 0, top: 0, left: 0 });
  useLayoutEffect(() => {
    const stage = slideRefs.current[activeIndex]?.querySelector('[data-video-media]');
    const container = containerRef.current;
    if (!stage || !container) return;
    const recompute = () => {
      const stageRect = stage.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const fitted = fitVideoFrame(stageRect.width, stageRect.height, activeSrc?.vertical ? 9 / 16 : 16 / 9);
      // Content coordinates keep one persistent iframe in the native scroll
      // chain. A sibling layer outside this container trapped wheel/touch
      // gestures because it had no scrollable ancestor to advance the feed.
      setYtBoxSize({ ...fitted,
        top: fitted.top + stageRect.top - containerRect.top + container.scrollTop,
        left: fitted.left + stageRect.left - containerRect.left + container.scrollLeft,
      });
    };
    const observer = new ResizeObserver(recompute);
    observer.observe(stage);
    observer.observe(container);
    recompute();
    return () => observer.disconnect();
  }, [activeIndex, activeSrc?.vertical, videoPosts]);

  const startSharedYtAutoplayRetry = useCallback((player, videoId) => {
    clearInterval(sharedYtRetryRef.current);
    let attempts = 0;
    sharedYtRetryRef.current = setInterval(() => {
      if (document.hidden || !sharedYtMountedRef.current || sharedYtDesiredIdRef.current !== videoId) {
        clearInterval(sharedYtRetryRef.current);
        return;
      }
      attempts += 1;
      try {
        if (player.getPlayerState() === 1) {
          clearInterval(sharedYtRetryRef.current);
          setSharedYt(s => ({ ...s, paused: false }));
          return;
        }
        if (attempts >= 3) {
          clearInterval(sharedYtRetryRef.current);
          setSharedYt(s => ({ ...s, paused: true }));
          return;
        }
        player.playVideo();
      } catch {
        clearInterval(sharedYtRetryRef.current);
      }
    }, 500);
  }, []);

  useEffect(() => {
    const lifecycle = ++sharedYtLifecycleRef.current;
    sharedYtMountedRef.current = true;
    return () => {
      if (sharedYtLifecycleRef.current === lifecycle) sharedYtLifecycleRef.current += 1;
      sharedYtMountedRef.current = false;
      clearTimeout(sharedYtPendingLoadRef.current);
      clearTimeout(sharedYtReadyTimeoutRef.current);
      clearInterval(sharedYtRetryRef.current);
      const player = sharedYtPlayerRef.current;
      try {
        sharedYtResumeRef.current = { id: player?.getVideoData?.()?.video_id, time: player?.getCurrentTime?.() || 0,
          paused: player?.getPlayerState?.() === 2, rate: player?.getPlaybackRate?.() };
      } catch { sharedYtResumeRef.current = null; }
      sharedYtPlayerRef.current = null;
      sharedYtReadyRef.current = false;
      sharedYtCreatingRef.current = false;
      sharedYtLoadedIdRef.current = null;
      try { player?.destroy(); } catch {}
      try { sharedYtHostRef.current?.replaceChildren(); } catch {}
    };
  }, []);

  useEffect(() => {
    const videoId = activeSrc?.kind === 'youtube' ? activeSrc.id : null;
    clearTimeout(sharedYtPendingLoadRef.current);
    clearInterval(sharedYtRetryRef.current);

    if (!videoId) {
      try { if (sharedYtReadyRef.current) sharedYtPlayerRef.current?.pauseVideo(); } catch {}
      return;
    }

    setSharedYt(s => ({ ...s, failed: false }));
    const activatePlayer = (player, targetId) => {
      if (!sharedYtMountedRef.current || sharedYtDesiredIdRef.current !== targetId || !sharedYtReadyRef.current) return;
      if (document.hidden) { sharedYtHiddenResumeRef.current = targetId; player.pauseVideo(); return; }
      try {
        if (sharedYtLoadedIdRef.current !== targetId) {
          sharedYtLoadedIdRef.current = targetId;
          setSharedYt(s => ({ ...s, duration: 0, currentTime: 0, paused: false, settings: null }));
          player.loadVideoById(targetId);
        }
        if (sharedYtMutedRef.current) player.mute(); else player.unMute();
        player.playVideo();
        startSharedYtAutoplayRetry(player, targetId);
      } catch {
        setSharedYt(s => ({ ...s, paused: true }));
      }
    };

    if (sharedYtReadyRef.current && sharedYtPlayerRef.current) {
      if (sharedYtLoadedIdRef.current === videoId) {
        activatePlayer(sharedYtPlayerRef.current, videoId);
      } else {
        sharedYtPendingLoadRef.current = setTimeout(() => {
          activatePlayer(sharedYtPlayerRef.current, videoId);
        }, 180);
      }
      return () => {
        clearTimeout(sharedYtPendingLoadRef.current);
        clearInterval(sharedYtRetryRef.current);
      };
    }

    if (!sharedYtCreatingRef.current) {
      const host = sharedYtHostRef.current;
      if (!host) return;
      const lifecycle = sharedYtLifecycleRef.current;
      const isCurrent = () => sharedYtMountedRef.current && sharedYtLifecycleRef.current === lifecycle;
      sharedYtCreatingRef.current = true;
      host.replaceChildren();
      const mount = createYouTubePlayerFrame(host, videoId, { autoplay: document.hidden ? 0 : 1, mute: 1, loop: 0, controls: 1 }, queueRef.current[activeIndexRef.current]?.title);

      clearTimeout(sharedYtReadyTimeoutRef.current);
      sharedYtReadyTimeoutRef.current = setTimeout(() => {
        if (isCurrent() && !sharedYtReadyRef.current && sharedYtDesiredIdRef.current) {
          setSharedYt(s => ({ ...s, failed: true, paused: true }));
        }
      }, 6000);

      loadYouTubeIframeApi().then((YT) => {
        if (!isCurrent() || !host.isConnected || !mount.isConnected) return;
        const initialId = sharedYtDesiredIdRef.current || videoId;
        const player = new YT.Player(mount, {
          videoId: initialId,
          playerVars: {
            autoplay: document.hidden ? 0 : 1, mute: 1, playsinline: 1, loop: 0,
            controls: 1, rel: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: (e) => {
              if (!isCurrent()) {
                try { e.target.destroy(); } catch {}
                return;
              }
              clearTimeout(sharedYtReadyTimeoutRef.current);
              sharedYtPlayerRef.current = e.target;
              sharedYtReadyRef.current = true;
              sharedYtCreatingRef.current = false;
              setSharedYt(s => ({ ...s, failed: false }));
              try {
                const iframe = e.target.getIframe();
                iframe.referrerPolicy = 'strict-origin-when-cross-origin';
                iframe.style.pointerEvents = 'auto';
                iframe.tabIndex = 0;
              } catch {}

              const desiredId = sharedYtDesiredIdRef.current;
              if (!desiredId) {
                try { e.target.pauseVideo(); } catch {}
                return;
              }
              if (document.hidden) {
                sharedYtHiddenResumeRef.current = desiredId;
                try { e.target.pauseVideo(); } catch {}
                return;
              }
              if (desiredId !== initialId) {
                try { e.target.loadVideoById(desiredId); } catch {}
              }
              sharedYtLoadedIdRef.current = desiredId;
              const resume = sharedYtResumeRef.current?.id === desiredId ? sharedYtResumeRef.current : null;
              sharedYtResumeRef.current = null;
              try {
                if (sharedYtMutedRef.current) e.target.mute(); else e.target.unMute();
                if (resume?.time > 0) e.target.seekTo(resume.time, true);
                if (resume?.rate && e.target.getAvailablePlaybackRates?.().includes(resume.rate)) e.target.setPlaybackRate(resume.rate);
                if (resume?.paused) e.target.pauseVideo(); else e.target.playVideo();
              } catch {}
              try {
                const duration = e.target.getDuration() || 0;
                setSharedYt(s => ({ ...s, duration, currentTime: resume?.time || 0, paused: Boolean(resume?.paused) }));
              } catch {}
              if (!resume?.paused) startSharedYtAutoplayRetry(e.target, desiredId);
            },
            onStateChange: (e) => {
              if (!isCurrent()) return;
              // A pause from the official controls must survive the early
              // autoplay retry, just as the app's former pause button did.
              if (e.data === YT.PlayerState.PAUSED && !document.hidden
                && e.target.getVideoData?.()?.video_id === sharedYtDesiredIdRef.current) {
                clearInterval(sharedYtRetryRef.current);
              }
              // loadVideoById does not replace the iframe's original playlist.
              // Loop the currently selected clip ourselves so ending a later
              // clip cannot jump back to the first video's stale playlist.
              if (e.data === YT.PlayerState.ENDED && !document.hidden
                && e.target.getVideoData?.()?.video_id === sharedYtDesiredIdRef.current) {
                try { e.target.seekTo(0, true); e.target.playVideo(); } catch {}
                return;
              }
              if (document.hidden && e.data === YT.PlayerState.PLAYING) {
                sharedYtHiddenResumeRef.current = sharedYtDesiredIdRef.current;
                try { e.target.pauseVideo(); } catch {}
              }
              setSharedYt(s => ({ ...s, paused: e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED }));
              try {
                const duration = e.target.getDuration() || 0;
                if (duration) {
                  setSharedYt(s => ({ ...s, duration }));
                }
              } catch {}
            },
            onPlaybackRateChange: e => {
              if (!isCurrent() || e.target.getVideoData?.()?.video_id !== sharedYtDesiredIdRef.current) return;
              try { setSharedYt(state => ({ ...state, settings: readYouTubeSettings(e.target) })); } catch {}
            },
            onApiChange: e => {
              if (!isCurrent() || e.target.getVideoData?.()?.video_id !== sharedYtDesiredIdRef.current) return;
              try { setSharedYt(state => ({ ...state, settings: readYouTubeSettings(e.target) })); } catch {}
            },
            onError: () => {
              sharedYtCreatingRef.current = false;
              if (isCurrent()) setSharedYt(s => ({ ...s, failed: true, paused: true }));
            },
          },
        });
        sharedYtPlayerRef.current = player;
      }).catch(() => {
        sharedYtCreatingRef.current = false;
        if (isCurrent()) setSharedYt(s => ({ ...s, failed: true, paused: true }));
      });
    }

    return () => {
      clearTimeout(sharedYtPendingLoadRef.current);
      clearInterval(sharedYtRetryRef.current);
    };
  }, [activeSrc?.kind, activeSrc?.id, startSharedYtAutoplayRetry]);

  useEffect(() => {
    const visibilityChanged = () => {
      const player = sharedYtPlayerRef.current;
      if (!player || !sharedYtReadyRef.current) return;
      try {
        if (document.hidden) {
          const state = player.getPlayerState();
          sharedYtHiddenResumeRef.current = state === 1 || state === 3 ? sharedYtDesiredIdRef.current : null;
          clearInterval(sharedYtRetryRef.current);
          player.pauseVideo();
        } else if (sharedYtHiddenResumeRef.current === sharedYtDesiredIdRef.current && sharedYtDesiredIdRef.current) {
          sharedYtHiddenResumeRef.current = null;
          if (sharedYtLoadedIdRef.current !== sharedYtDesiredIdRef.current) {
            sharedYtLoadedIdRef.current = sharedYtDesiredIdRef.current;
            player.loadVideoById(sharedYtDesiredIdRef.current);
          }
          player.playVideo();
        }
      } catch {}
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => document.removeEventListener('visibilitychange', visibilityChanged);
  }, []);

  useEffect(() => {
    const pollId = setInterval(() => {
      if (document.hidden || !sharedYtReadyRef.current || !sharedYtDesiredIdRef.current) return;
      try {
        const player = sharedYtPlayerRef.current;
        const currentTime = player?.getCurrentTime() || 0;
        const duration = player?.getDuration() || 0;
        const actualId = player?.getVideoData?.()?.video_id;
        const currentPost = queueRef.current[activeIndexRef.current];
        const expectedId = resolveVideoSource(currentPost)?.id;
        // getDuration can describe the previous item while loadVideoById is
        // still switching. Never reject a different item using stale data.
        if (!actualId || actualId !== expectedId) return;
        onDurationResolved(currentPost, duration);
        const settings = readYouTubeSettings(player);
        const state = player.getPlayerState();
        const paused = state !== 1 && state !== 3;
        const playerMuted = player.isMuted() || player.getVolume?.() === 0;
        setSharedYt(s => (s.currentTime === currentTime && s.duration === duration && s.paused === paused && s.muted === playerMuted && JSON.stringify(s.settings) === JSON.stringify(settings))
          ? s
          : { ...s, currentTime, duration, paused, muted: playerMuted, settings });
      } catch {}
    }, 250);
    return () => clearInterval(pollId);
  }, []);

  // Keep the shared player's mute state in sync with the top-bar toggle —
  // file/hls slides each do their own equivalent sync locally.
  useEffect(() => {
    if (!sharedYtPlayerRef.current) return;
    try { if (muted) sharedYtPlayerRef.current.mute(); else sharedYtPlayerRef.current.unMute(); } catch {}
  }, [muted]);

  const sharedYtTogglePlay = useCallback(() => {
    const p = sharedYtPlayerRef.current;
    try {
      if (!sharedYtReadyRef.current || p?.getVideoData?.()?.video_id !== sharedYtDesiredIdRef.current) return;
      clearInterval(sharedYtRetryRef.current);
      const state = p.getPlayerState();
      if (state === 1 || state === 3) p.pauseVideo(); else p.playVideo();
    } catch {}
  }, []);
  const currentSettingsPlayer = () => {
    try {
      const player = sharedYtPlayerRef.current;
      return sharedYtReadyRef.current && player?.getVideoData?.()?.video_id === sharedYtDesiredIdRef.current ? player : null;
    } catch { return null; }
  };
  const toggleYouTubeMute = () => {
    try {
      const player = currentSettingsPlayer();
      if (!player) return;
      const next = !(player.isMuted() || player.getVolume?.() === 0);
      if (next) player.mute(); else { if (player.getVolume?.() === 0) player.setVolume(100); player.unMute(); }
      rememberSoundPreference(!next);
      setSharedYt(state => ({ ...state, muted: player.isMuted() || player.getVolume?.() === 0 }));
    } catch {}
  };
  const seekYouTube = seconds => {
    try {
      const player = currentSettingsPlayer();
      const duration = player?.getDuration();
      if (!player || !Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) return;
      player.seekTo(Math.max(0, Math.min(duration, seconds)), true);
    } catch {}
  };
  const setYouTubePlaybackRate = rate => {
    try {
      const player = currentSettingsPlayer();
      if (!player || !player.getAvailablePlaybackRates?.().includes(rate)) return;
      player.setPlaybackRate(rate);
    } catch { showToast('Playback speed could not change. Try the YouTube player settings.', 'error'); }
  };
  const setYouTubeCaptionFontSize = size => {
    try {
      const player = currentSettingsPlayer();
      if (!player || !Number.isInteger(size) || size < -1 || size > 3 || !player.getOptions?.('captions')?.includes('fontSize')) return;
      player.setOption('captions', 'fontSize', size);
      setSharedYt(state => ({ ...state, settings: readYouTubeSettings(player) }));
    } catch { showToast('Caption size could not change. Try the YouTube player settings.', 'error'); }
  };
  const focusYouTubeControls = () => {
    requestAnimationFrame(() => {
      const frame = sharedYtWrapperRef.current?.querySelector('iframe');
      frame?.focus();
      showToast('Use YouTube’s settings gear for quality and its CC button for captions.', 'info');
    });
  };

  // Safety net for the page background showing through as a light strip
  // anywhere this full-bleed view doesn't perfectly cover the real
  // viewport (confirmed live as a persistent white/grey gap on some mobile
  // browsers even after fixing the slide-height mismatch that was one
  // known cause of it — belt and suspenders against any other, harder-to-
  // pin-down geometric cause behind the same symptom). The root view here
  // already paints black itself; this only guards the page *underneath*
  // it, restored to whatever it was on unmount.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlBg = html.style.background;
    const prevBodyBg = body.style.background;
    html.style.background = '#000';
    body.style.background = '#000';
    return () => {
      html.style.background = prevHtmlBg;
      body.style.background = prevBodyBg;
    };
  }, []);

  useEffect(() => {
    const handleKey = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.fullscreenElement) return;
      if (document.querySelector('[role="menu"], [role="dialog"], dialog[open], .video-comments-sheet')) return;
      exitFeed();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [exitFeed]);

  return (
    <div className="video-feed-view">
      <div className="video-feed-frame" data-orientation={activeIsWideVideo ? 'landscape' : 'portrait'}>
      <header className="video-feed-top-controls" aria-label={music ? 'Music feed' : 'Video feed'}>
        <button type="button" className="video-feed-header-button" onPointerDown={event => event.stopPropagation()} onClick={exitFeed} aria-label="Back to Home" title="Back to Home">
          <img className="video-feed-ufi-mark" src="/uficonnect-google-verification-icon.svg" alt="" width="25" height="25" />
        </button>
        <div className="video-feed-mode-switch" role="group" aria-label="Video feed mode">
          {(music ? [{ key: 'feed', label: 'Music' }] : [{ key: 'feed', label: 'Videos' }, { key: 'following', label: 'Following' }]).map(({ key, label }) => (
            <button key={key} type="button" aria-pressed={viewMode === key}
              onPointerDown={event => event.stopPropagation()}
              onClick={event => { event.stopPropagation(); switchViewMode(key); }}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="video-feed-header-button" onClick={() => { setSearchInput(searchQuery); setSearchOpen(true); }}
          aria-label="Search videos" title="Search videos" aria-expanded={searchOpen} data-active={Boolean(searchQuery)}>
          <Search size={18} aria-hidden="true" />
          {searchQuery && <span className="video-feed-filter-dot" aria-hidden="true" />}
        </button>
        <button type="button" className="video-feed-header-button" onClick={() => setFilterOpen(true)}
          aria-label="Filter videos" title="Sources, genres and topics" aria-expanded={filterOpen} data-active={Boolean(sourceFilter.length || topicFilters.length || genre)}>
          <SlidersHorizontal size={18} aria-hidden="true" />
          {Boolean(sourceFilter.length || topicFilters.length || genre) && <span className="video-feed-filter-dot" aria-hidden="true" />}
        </button>
        <button type="button" className="video-feed-header-button" onClick={handleRefresh} disabled={refreshing} aria-label="Refresh videos" title="Refresh videos">
          <RotateCw size={18} aria-hidden="true" className={refreshing ? 'video-feed-refreshing' : undefined} />
        </button>
      </header>
      {searchOpen && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setSearchOpen(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,.55)', display: 'flex',
            alignItems: 'flex-end', justifyContent: 'center',
          }}
        >
          <div style={{
            background: '#161616', color: '#fff', borderRadius: '20px 20px 0 0',
            width: '100%', maxWidth: 540,
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 -4px 32px rgba(0,0,0,.4)',
          }}>
            <div style={{ padding: '12px 20px 0', textAlign: 'center', flexShrink: 0 }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.25)', margin: '0 auto 14px' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Search</h2>
                <button
                  onClick={() => setSearchOpen(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.3rem', color: 'rgba(255,255,255,.6)', lineHeight: 1 }}
                >×</button>
              </div>
            </div>
            <div style={{ padding: '4px 20px 16px' }}>
              {/* Same pill/icon convention as pages/Search.jsx, dark-themed
                  to match this sheet. Uncommitted until Done/Enter — see
                  applySearch. */}
              <div style={{ position: 'relative' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>
                  <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  autoFocus
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { applySearch(); setSearchOpen(false); } }}
                  placeholder="Search videos…"
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '11px 14px 11px 40px',
                    borderRadius: 24, border: '1px solid rgba(255,255,255,.18)',
                    background: 'rgba(255,255,255,.08)', color: '#fff', fontSize: '.88rem', outline: 'none',
                  }}
                />
              </div>
            </div>
            <div style={{ padding: '10px 20px 18px', display: 'flex', gap: 10, borderTop: '1px solid rgba(255,255,255,.12)', flexShrink: 0 }}>
              <button
                className="ufi-clear-control"
                onClick={() => clearSearch()}
                disabled={!searchInput && !searchQuery}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 10, marginTop: 10,
                  fontWeight: 700, fontSize: '.85rem',
                  cursor: (!searchInput && !searchQuery) ? 'default' : 'pointer',
                }}
              >
                Clear
              </button>
              <button
                onClick={() => { applySearch(); setSearchOpen(false); }}
                style={{ flex: 1, padding: '10px 0', borderRadius: 10, marginTop: 10, border: 'none', background: '#fff', color: '#000', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer' }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {filterOpen && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setFilterOpen(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,.55)', display: 'flex',
            alignItems: 'flex-end', justifyContent: 'center',
          }}
        >
          <div style={{
            background: '#161616', color: '#fff', borderRadius: '20px 20px 0 0',
            // maxHeight back to the original 72vh (was briefly bumped to
            // 80vh when Topic/Platform both landed in this one sheet)
            // — the sheet's own on-screen footprint shouldn't grow just
            // because there's more to scroll through inside it; the
            // content area's own overflowY:auto (below) is what's meant to
            // absorb that, not the sheet itself taking up more of the screen.
            width: '100%', maxWidth: 540, maxHeight: '72vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 -4px 32px rgba(0,0,0,.4)',
          }}>
            <div style={{ padding: '12px 20px 0', textAlign: 'center', flexShrink: 0 }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.25)', margin: '0 auto 14px' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Filter</h2>
                {/* Every selection here already applies immediately on tap
                    (Topic/Platform, unlike Search's own deferred
                    text input) — this Done button, same as the one in the
                    footer below, is really just "close the sheet," not
                    "apply." A proper button up here instead of just the
                    small × means closing doesn't require scrolling all
                    the way down through Topic's ~230 chips first. */}
                <button
                  onClick={() => setFilterOpen(false)}
                  style={{
                    background: '#fff', border: 'none', borderRadius: 14,
                    padding: '5px 14px', color: '#000', fontWeight: 700, fontSize: '.78rem', cursor: 'pointer',
                  }}
                >Done</button>
              </div>
            </div>
            <div style={{ overflowY: 'auto', padding: '0 20px 16px', flex: 1 }}>
              {/* Platform before Topic (was the reverse) — Topic's ~230
                  chips are by far the longest list in this sheet, so with
                  it first, Platform ended up buried below a whole
                  separately-scrolling box for it, on top of the sheet's
                  own outer scroll — two nested scroll regions stacked on
                  top of each other, confirmed live as genuinely hard to
                  use (unclear which region a scroll gesture was even going
                  to, plus Topic's own box was so short it took many small
                  scrolls just to get through). Platform first means it's
                  reachable immediately with no scrolling. Topic now flows
                  as a normal part of the SAME single outer scroll instead
                  of its own bounded box — one predictable scroll region
                  for the whole sheet, and since Topic is last, scrolling
                  further into it never blocks reaching anything else
                  (Clear all/Done sit in their own fixed footer below,
                  outside this scrollable area entirely already). */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: '.72rem', fontWeight: 700, letterSpacing: '.02em', opacity: 0.6, textTransform: 'uppercase' }}>Platform</span>
                <button type="button" className="ufi-clear-control" onClick={clearSourceFilter} disabled={!sourceFilter.length} aria-label="Clear platforms">Clear</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
                {(viewMode === 'following' ? FOLLOWING_VIDEO_SOURCES : FEED_VIDEO_SOURCES).map(key => {
                  const meta = SOURCE_META[key] || {};
                  const active = sourceFilter.includes(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleSourceFilter(key)}
                      aria-label={meta.label || key}
                      aria-pressed={active}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '7px 12px', borderRadius: 18, cursor: 'pointer', whiteSpace: 'nowrap',
                        fontWeight: 700, fontSize: '.78rem',
                        border: `1px solid ${active ? '#fff' : 'rgba(255,255,255,.25)'}`,
                        background: active ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.06)',
                        color: '#fff',
                      }}
                    >
                      <SourceMark source={key} label={meta.icon} size={13} active={active} />{meta.label || key}
                    </button>
                  );
                })}
              </div>

              {music && <section aria-label="Music genres" style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <h3 style={{ fontSize: '.85rem' }}>Genres</h3>
                  <button type="button" className="ufi-clear-control" onClick={() => selectGenre('')} disabled={!genre} aria-label="Clear genres">Clear</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {['Pop', 'Rock', 'Hip hop', 'Rap', 'R&B', 'Jazz', 'Classical', 'Country', 'Electronic', 'Latin', 'Reggae', 'Metal', 'Folk', 'Acoustic', 'Live'].map(value => <button type="button" key={value} aria-pressed={genre === value} onClick={() => selectGenre(value)} style={{ borderRadius: 20, padding: '8px 12px', border: '1px solid #777', background: genre === value ? '#fff' : '#252525', color: genre === value ? '#111' : '#fff', cursor: 'pointer' }}>{value}</button>)}
                </div>
              </section>}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: '.72rem', fontWeight: 700, letterSpacing: '.02em', opacity: 0.6, textTransform: 'uppercase' }}>Topics</span>
                <button type="button" className="ufi-clear-control" onClick={clearTopicFilter} disabled={!topicFilters.length} aria-label="Clear video topics">Clear</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {ALL_INTERESTS.map(topic => {
                  const active = topicFilters.includes(topic);
                  return (
                    <button
                      key={topic}
                      onClick={() => toggleTopicFilter(topic)}
                      aria-pressed={active}
                      style={{
                        padding: '6px 12px', borderRadius: 16, cursor: 'pointer', whiteSpace: 'nowrap',
                        fontWeight: 600, fontSize: '.75rem',
                        border: `1px solid ${active ? '#fff' : 'rgba(255,255,255,.2)'}`,
                        background: active ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.05)',
                        color: '#fff',
                      }}
                    >
                      {active ? 'Selected: ' : ''}{topic}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ padding: '10px 20px 18px', display: 'flex', gap: 10, borderTop: '1px solid rgba(255,255,255,.12)', flexShrink: 0 }}>
              <button
                className="ufi-clear-control"
                onClick={() => clearFilters()}
                disabled={sourceFilter.length === 0 && topicFilters.length === 0 && !genre}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 10, marginTop: 10,
                  fontWeight: 700, fontSize: '.85rem',
                  cursor: (sourceFilter.length === 0 && topicFilters.length === 0 && !genre) ? 'default' : 'pointer',
                }}
              >
                Clear all
              </button>
              <button
                onClick={() => setFilterOpen(false)}
                style={{ flex: 1, padding: '10px 0', borderRadius: 10, marginTop: 10, border: 'none', background: '#fff', color: '#000', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer' }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="video-feed-body">
        {loading && videoPosts.length > 0 && <div className="video-feed-loading" role="status">Loading videos…</div>}
        <div ref={containerRef} data-video-feed-scroll className="video-feed-scroll" tabIndex={0} aria-label={music ? 'Music videos' : 'Videos'}>
        {videoPosts.length === 0 && <div className="video-feed-empty" role="status">
          {loading ? 'Loading videos…' : error ? 'Could not load videos. Try refreshing.' : 'No playable videos of at least 5 seconds found. Try another source or filter.'}
          {viewMode === 'following' && !loading && <FollowingConnectionNotice errors={sourceErrors} />}
        </div>}
            {videoPosts.map((post, idx) => <div key={post.id || idx} ref={element => { slideRefs.current[idx] = element; }}
              data-idx={idx} data-post-id={post.id || ''} data-source={post.source || ''} className="video-feed-snap-item">
              {Math.abs(idx - activeIndex) <= VIDEO_MOUNT_RADIUS ? <VideoSlide post={post} onPostUpdated={updatePost} onRemoved={removed => setVideoPosts(previous => previous.filter(item => item.id !== removed.id))} active={idx === activeIndex}
                fullScreen={fullScreen} onFullScreen={onFullScreen}
                muted={muted} isScrolling={isScrolling} onOpenComments={setCommentsPost}
                onDurationResolved={onDurationResolved}
                sharedYt={idx === activeIndex ? { ...sharedYt, ready: Boolean(currentSettingsPlayer()),
                  togglePlay: sharedYtTogglePlay, toggleMute: toggleYouTubeMute, seekTo: seekYouTube,
                  setPlaybackRate: setYouTubePlaybackRate, setCaptionFontSize: setYouTubeCaptionFontSize, focusControls: focusYouTubeControls } : undefined} />
                : <div className="video-feed-placeholder" />}
            </div>)}
        {/* Keep the iframe alive inside the scrolling region across filters
            and mixed-source slides. Native wheel/touch scrolling chains to
            this ancestor while provider controls remain fully interactive. */}
        <div ref={sharedYtWrapperRef} className="video-feed-youtube-player"
          aria-hidden={activeSrc?.kind !== 'youtube' || isScrolling}
          inert={activeSrc?.kind !== 'youtube' || isScrolling}
          style={{ position: 'absolute', zIndex: 1,
            ...(activeSrc?.kind === 'youtube' ? ytBoxSize : { left: 0, top: 0, width: 0, height: 0 }),
            visibility: activeSrc?.kind === 'youtube' && !isScrolling ? 'visible' : 'hidden' }}>
          <div ref={sharedYtHostRef} style={{ width: '100%', height: '100%', display: sharedYt.failed ? 'none' : 'block' }} />
          {sharedYt.failed && activeSrc?.kind === 'youtube' && <iframe
            src={youTubeEmbedUrl(activeSrc.id, { autoplay: 1, mute: muted ? 1 : 0, controls: 1 })}
            referrerPolicy="strict-origin-when-cross-origin"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen title={videoPosts[activeIndex]?.title || 'YouTube video'} />}
        </div>
        </div>
      </div>
      </div>
      {commentsPost && <CommentsSheet post={commentsPost} onClose={() => setCommentsPost(null)} />}
    </div>
  );
}
