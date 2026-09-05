import { useState, useEffect, useRef, useCallback } from 'react';
import client from '../api/client';
import { extractYouTubeId, extractVimeoId, deriveBlueskyPlaylistUrl, isDirectVideoUrl, isYouTubeShortsUrl, HlsVideoPlayer, loadYouTubeIframeApi, userWantsSound, useGlobalMuted, usePointerPlaybackGate, fetchVimeoThumbnail, youTubePosterUrl, SoundIcon } from './videoMedia';
import { SOURCE_META, CONNECTED_SOCIAL_PLATFORMS } from './sourceMeta';
import BrandIcon, { hasBrandIcon } from './BrandIcon';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';
import { orderNewestFeedCohorts } from '../utils/feedOrdering';
import { reportConsumed, reportEngaged, reportEngagementSignal } from '../api/engagement';
import { reportNegativeSignal } from '../api/errorReporting';
import { ALL_INTERESTS } from '../pages/Onboarding';

// A video counts as genuinely watched (as opposed to just scrolled past —
// see api/engagement.js for the view-vs-seen distinction) once playback
// crosses ~3s or ~50% of its length, whichever comes first — long enough
// that a fast scroll-by can't trigger it, short enough that a real
// full-length watch doesn't need to finish for it to register.
const VIDEO_ENGAGED_SECONDS = 3;
const VIDEO_ENGAGED_FRACTION = 0.5;
const VIDEO_FEED_TAIL_POLL_MS = 30 * 1000;

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
  // Dedicated YouTube posts carry embedId (or a recoverable sourceUrl); any
  // other source's article can embed a real YouTube video too (see
  // parseRSSItems' video detection backend-side), in which case either URL
  // can carry the player. Do not prefer one field blindly: a source article
  // often keeps its original article URL in sourceUrl and a YouTube URL in
  // mediaUrl, while persisted YouTube rows do the inverse.
  const youtubeUrls = [post.mediaUrl, post.sourceUrl].filter(Boolean);
  const youtubeUrl = youtubeUrls.find(url => extractYouTubeId(url)) || youtubeUrls[0] || null;
  const ytId = post.embedId || extractYouTubeId(youtubeUrl);
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
  const vimeoId = extractVimeoId(post.mediaUrl || post.sourceUrl);
  if (vimeoId) return { kind: 'vimeo', id: vimeoId, poster: null };
  if (post.source === 'bluesky') {
    const playlist = deriveBlueskyPlaylistUrl(post.mediaUrl);
    return playlist ? { kind: 'hls', src: playlist, poster: post.mediaPoster || null } : null;
  }
  const hlsUrl = [post.mediaUrl, post.sourceUrl].find(url => /\.m3u8(\?|$)/i.test(String(url || '')));
  if (hlsUrl) return { kind: 'hls', src: hlsUrl, poster: post.mediaPoster || null };
  if (isDirectVideoUrl(post.mediaUrl)) {
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

// Shared look for the three floating controls over the video (back, refresh,
// mute) — previously each had its own one-off style (the back button in
// particular stood out with a harsh 2px solid white ring at a different size
// from its neighbors). A soft blurred-glass circle reads as one consistent
// control language instead of three mismatched buttons, and adapts to
// whatever's playing behind it rather than fighting it with a hard outline.
const OVERLAY_BTN_STYLE = {
  zIndex: 10, width: 40, height: 40, borderRadius: '50%',
  background: 'rgba(0,0,0,.4)',
  backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,.18)',
  boxShadow: '0 2px 10px rgba(0,0,0,.35)',
  color: '#fff', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// sharedYt: { paused, duration, currentTime, failed, togglePlay, seekTo } —
// the one YouTube player VideoFeedView keeps alive across every slide (see
// its own top comment) instead of each slide owning/destroying its own.
// Only meaningful when src.kind === 'youtube'; file/hls/vimeo keep their
// existing fully-local state below, untouched.
function VideoSlide({ post, active, playbackAllowed, muted, onToggleMute, isScrolling, onOpenComments, sharedYt }) {
  const src = resolveVideoSource(post);
  const meta = SOURCE_META[post.source] || SOURCE_META.uficonnect;
  const fileVideoRef = useRef(null);
  const hlsVideoRef = useRef(null);
  const vimeoIframeRef = useRef(null);
  const seekingRef = useRef(false);
  const progressBarRef = useRef(null);
  // Caption starts clamped (see the overlay below) — the video is the point
  // of this view, a wall of text over it isn't. "more" only shows up when
  // there's actually more than the clamp already reveals: a long title, or
  // real content beyond just the title repeated.
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const captionBody = post.content?.trim() && post.content.trim() !== post.title?.trim()
    ? post.content.trim()
    : '';
  const hasExtraCaption = (post.title?.length || 0) > 80 || Boolean(captionBody);

  // file/hls/vimeo's own fully-local playback state — youtube reads
  // sharedYt instead (see effectivePaused/effectiveDuration/
  // effectiveCurrentTime below), since its player lives in the parent now.
  const [paused, setPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [seeking, setSeeking] = useState(false);
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
    fetchVimeoThumbnail(src.id).then(url => { if (!cancelled) setVimeoPoster(url); });
    return () => { cancelled = true; };
  }, [src?.kind, src?.id]);

  const getNativeEl = useCallback(() => (src?.kind === 'hls' ? hlsVideoRef.current : fileVideoRef.current), [src?.kind]);

  // What the render/scrub-bar/engagement-tracking below actually read —
  // youtube's real values live on the shared player (see sharedYt, owned
  // by VideoFeedView), everything else keeps reading this slide's own
  // local state exactly as before.
  const isYoutube = src?.kind === 'youtube';
  const backdropPoster = isYoutube
    ? src?.poster
    : (!active ? (src?.kind === 'vimeo' ? vimeoPoster : src?.poster) : null);
  const effectivePaused = isYoutube ? !!sharedYt?.paused : paused;
  const effectiveDuration = isYoutube ? (sharedYt?.duration || 0) : duration;
  const effectiveCurrentTime = isYoutube ? (sharedYt?.currentTime || 0) : currentTime;
  // The shared player is a sibling of the scroll slides. For a landscape
  // video it occupies a centered 16:9 box, leaving a large unused area above
  // and below it. Keep the existing caption/actions in their original style,
  // but offset their bottom anchor by that measured letterbox so they stay
  // inside the actual YouTube frame on phones as well as portrait Shorts.
  const youtubeFrameInset = isYoutube && active && Number.isFinite(sharedYt?.frame?.top) && sharedYt.frame.height > 0
    ? Math.max(0, Math.round(sharedYt.frame.top))
    : null;
  const captionBottom = youtubeFrameInset === null ? 40 : youtubeFrameInset + 40;
  const railBottom = youtubeFrameInset === null ? 46 : youtubeFrameInset + 46;
  const scrubberBottom = youtubeFrameInset === null ? 12 : youtubeFrameInset + 12;
  const durationBottom = youtubeFrameInset === null ? 20 : youtubeFrameInset + 20;
  const safeBottom = value => `calc(${value}px + env(safe-area-inset-bottom, 0px))`;

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
    const startedAt = Date.now();
    return () => {
      reportEngagementSignal({ postId: post.id, source: post.source, topic: post.topic, watchMs: Date.now() - startedAt });
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
      if (playbackAllowed) v.play().catch(() => {});
      else v.pause();
    } else {
      v.pause(); try { v.currentTime = 0; } catch {} setCurrentTime(0); setPaused(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, playbackAllowed, src?.kind, getNativeEl]);

  // Keeps an already-active file/hls video's mute state in sync with manual
  // toggles of the shared mute button — the play effect above already sets
  // the correct state once play() resolves; this only needs to react to
  // changes after that point.
  useEffect(() => {
    if (src?.kind === 'youtube') return;
    const v = getNativeEl();
    if (v && active) v.muted = muted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted]);

  // Vimeo: a cross-origin iframe with no DOM <video> to attach onPlay/
  // onPause/onTimeUpdate to, so paused/duration/currentTime — and with
  // them the scrub bar, time readout, and "tap to play" affordance every
  // other kind here already gets — previously never updated for this kind
  // at all. paused's useState(false) default meant a silently-blocked
  // autoplay just looked like a frozen video with nothing tappable, and
  // togglePlay()/seekToFraction() had no element to act on either.
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
    let ready = false;
    function post(msg) {
      try { vimeoIframeRef.current?.contentWindow?.postMessage(JSON.stringify(msg), 'https://player.vimeo.com'); } catch {}
    }
    function handleMessage(event) {
      if (event.origin !== 'https://player.vimeo.com') return;
      if (event.source !== vimeoIframeRef.current?.contentWindow) return;
      let msg;
      try { msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
      if (msg?.event === 'ready' && !ready) {
        ready = true;
        post({ method: 'addEventListener', value: 'play' });
        post({ method: 'addEventListener', value: 'pause' });
        post({ method: 'addEventListener', value: 'timeupdate' });
      } else if (msg?.event === 'play') {
        setPaused(false);
      } else if (msg?.event === 'pause' || msg?.event === 'finish') {
        setPaused(true);
      } else if (msg?.event === 'timeupdate' && msg.data) {
        if (!seekingRef.current) setCurrentTime(msg.data.seconds || 0);
        if (msg.data.duration) setDuration(msg.data.duration);
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [active, playbackAllowed, src?.kind]);

  // Same "every slide starts fresh" reset file/hls gets on becoming
  // inactive (above) — the iframe itself already fully unmounts when
  // inactive (see the vimeo render branch) so playback genuinely stops,
  // but this slide's own local paused/duration/currentTime state would
  // otherwise still hold whatever it last saw next time this exact post
  // becomes active again.
  useEffect(() => {
    if (src?.kind !== 'vimeo' || active) return;
    setCurrentTime(0); setPaused(false); setDuration(0);
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
    if (!active || src?.kind === 'youtube') return;
    if (src?.kind === 'vimeo') {
      try {
        vimeoIframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ method: isScrolling || !playbackAllowed ? 'pause' : 'play' }),
          'https://player.vimeo.com',
        );
      } catch {}
      return;
    }
    const v = getNativeEl();
    if (!v) return;
    if (isScrolling || !playbackAllowed) v.pause();
    else if (v.paused) v.play().catch(() => {});
  }, [isScrolling, active, playbackAllowed, src?.kind, getNativeEl]);

  function togglePlay() {
    if (isYoutube) {
      sharedYt?.togglePlay?.();
    } else if (src?.kind === 'vimeo') {
      try {
        vimeoIframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ method: paused ? 'play' : 'pause' }), 'https://player.vimeo.com'
        );
      } catch {}
    } else {
      const v = getNativeEl();
      if (!v) return;
      if (v.paused) v.play().catch(() => {}); else v.pause();
    }
  }

  function computeFraction(clientX) {
    const el = progressBarRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (!rect.width) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }

  function seekToFraction(fraction) {
    const time = fraction * (effectiveDuration || 0);
    if (isYoutube) {
      sharedYt?.seekTo?.(time);
    } else if (src?.kind === 'vimeo') {
      setCurrentTime(time);
      try {
        vimeoIframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ method: 'setCurrentTime', value: time }), 'https://player.vimeo.com'
        );
      } catch {}
    } else {
      setCurrentTime(time);
      const v = getNativeEl();
      if (v) v.currentTime = time;
    }
  }

  function handleBarPointerDown(e) {
    e.stopPropagation();
    if (!effectiveDuration) return;
    seekingRef.current = true;
    // Also flips the shared player's own seeking guard (see sharedYt.
    // seekingRef in VideoFeedView) — that guard is what stops its polling
    // interval from overwriting the scrub bar's position mid-drag with a
    // stale getCurrentTime() read, same idea seekingRef already serves for
    // file/hls, just needs to reach the parent's poll instead of a local one.
    if (isYoutube && sharedYt?.seekingRef) sharedYt.seekingRef.current = true;
    setSeeking(true);
    seekToFraction(computeFraction(e.clientX));
    const handleMove = (ev) => seekToFraction(computeFraction(ev.clientX));
    const handleUp = () => {
      seekingRef.current = false;
      if (isYoutube && sharedYt?.seekingRef) sharedYt.seekingRef.current = false;
      setSeeking(false);
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
  }

  const progressFraction = effectiveDuration > 0 ? Math.min(1, effectiveCurrentTime / effectiveDuration) : 0;
  function handleSlideClick(e) {
    if (e.target.closest?.('button, a, [role="button"], .video-caption-scroll, [data-video-scrubber]')) return;
    togglePlay();
  }

  return (
    <div
      className="video-feed-slide"
      onClick={handleSlideClick}
      style={{ position: 'relative', height: '100%', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', overflow: 'hidden', touchAction: 'pan-y' }}
    >
      {/* Blurred poster backdrop — most video here is landscape (regular
          YouTube uploads, arbitrary hls/file clips), while this view's box
          is portrait. A cross-origin YouTube iframe can't be cropped with
          objectFit (that only affects the iframe's own box, not what's
          inside it) so YouTube's player letterboxes it instead, same as
          hls/file content that just isn't natively 9:16 — real black bars
          top and bottom otherwise. Filling that space with the same
          poster, blurred and scaled past the edge so the blur radius
          doesn't reveal a hard border, reads as an intentional frame
          rather than empty space. z-index -1, not just DOM order: the
          foreground below is a mix of positioned (youtube's active
          wrapper) and unpositioned (poster <img>, hls/file <video>)
          elements, and per CSS painting order any positioned element with
          z-index:auto paints above unpositioned siblings regardless of DOM
          order — without a negative z-index here this backdrop would cover
          the plain-element cases instead of sitting behind them. Harmless
          no-op for kinds with no poster (file, or vimeo before its oEmbed
          fetch resolves). effectivePoster prefers vimeoPoster over
          src.poster — resolveVideoSource always hands back poster:null
          for vimeo (see vimeoPoster's own comment above), so without this
          override every Vimeo post would permanently skip this backdrop
          and the inactive-state preview image below. */}
      {backdropPoster && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: isYoutube ? 0 : -1,
          backgroundImage: `url(${backdropPoster})`,
          backgroundSize: 'cover', backgroundPosition: 'center',
          transform: 'scale(1.15)', filter: 'blur(30px) brightness(0.45)',
        }} />
      )}
      {!src ? (
        <div style={{ color: '#888', fontSize: '.85rem' }}>Video unavailable</div>
      ) : src.kind === 'youtube' ? (
        active && playbackAllowed ? (
          // The actual video pixels render via VideoFeedView's own shared
          // overlay now (see sharedYtHostRef there), positioned to match
          // this exact same centered/aspect-ratio box independently — this
          // slide only needs to *not* render anything competing in that
          // spot, letting the backdrop above and the parent's overlay
          // beneath the caption/scrub UI below show through. See
          // VideoFeedView's own top-of-file comment for why the player
          // itself isn't owned per-slide anymore.
          null
        ) : (
          <div style={{ width: '100%', height: '100%', background: '#000' }} />
        )
      ) : src.kind === 'vimeo' ? (
        // Play/pause/duration/currentTime now come from Vimeo's postMessage
        // event protocol (see the effect above) instead of being untracked
        // — api=1 is what turns that protocol on for this embed. The
        // shared mute button still can't affect it post-mount (see its own
        // kind check) — unlike play state, wiring mute wasn't part of this
        // fix. Best-effort respects the stored preference at mount time
        // instead: if this browser already earned "unmuted" elsewhere,
        // start here unmuted too rather than forcing yet another mute
        // cycle the app can't itself unwind.
        active && playbackAllowed ? (
          // pointerEvents:'none' on the iframe itself makes a tap fall
          // through to this wrapping div's onClick instead of being
          // captured inside the iframe's own document (a click landing on
          // an iframe never bubbles out to the parent page at all) — same
          // click-through technique the shared YouTube overlay already
          // uses, needed here for the same reason: without it, tapping a
          // stalled/blocked Vimeo video to resume it would do nothing.
          <div onClick={(e) => { e.stopPropagation(); togglePlay(); }} style={{ width: '100%', height: '100%' }}>
            <iframe
              ref={vimeoIframeRef}
              src={`https://player.vimeo.com/video/${src.id}?autoplay=1&muted=${userWantsSound() ? 0 : 1}&loop=1&title=0&byline=0&portrait=0&api=1`}
              style={{ width: '100%', height: '100%', border: 'none', display: 'block', pointerEvents: 'none' }}
              allow="autoplay; fullscreen; picture-in-picture"
              title={post.title}
            />
          </div>
        ) : vimeoPoster ? (
          <img src={vimeoPoster} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.85 }} />
        ) : (
          <div style={{ color: '#888', fontSize: '.85rem' }}>Vimeo video</div>
        )
      ) : src.kind === 'hls' ? (
        active ? (
          <HlsVideoPlayer src={src.src} poster={null} autoPlay muted={muted} loop
            videoRef={hlsVideoRef} onClick={(e) => { e.stopPropagation(); togglePlay(); }}
            onTimeUpdate={(e) => { if (!seekingRef.current) setCurrentTime(e.target.currentTime); }}
            onLoadedMetadata={(e) => setDuration(e.target.duration || 0)}
            onPlay={() => setPaused(false)} onPause={() => setPaused(true)}
            onError={() => reportNegativeSignal({ signalType: 'video_load_fail', source: post.source, topic: post.topic, postId: post.id, context: { surface: 'videos' } })}
            style={{ height: '100%', width: '100%', objectFit: 'contain', pointerEvents: 'none' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: '#000' }} />
        )
      ) : (
        // contain, not cover: 'file' is the catch-all for an arbitrary
        // direct-linked video URL (see isDirectVideoUrl), most commonly a
        // landscape clip (e.g. Reddit-hosted video) forced into this view's
        // tall portrait box. cover used to crop these to fill the frame —
        // confirmed live on mobile (where the box is a full phone screen,
        // the most extreme portrait ratio this view ever renders into) as
        // genuinely cutting off most of the picture, not just "occasional
        // edge framing loss." contain guarantees the whole video is always
        // visible, same as every other kind here (hls already uses contain;
        // youtube/vimeo effectively letterbox within their fitted box too).
        // Same style treatment every other kind here already gets: a real
        // poster (see resolveVideoSource/mediaPoster) means this shows an
        // actual thumbnail immediately, same as Bluesky/YouTube, instead of
        // a blank black tile until the first frame decodes — falls back to
        // this wrapper's own plain #000 background when a source genuinely
        // has no distinct preview image to offer.
        <video
          ref={fileVideoRef}
          src={src.src}
          poster={undefined}
          // Only the active slide needs to actually buffer video data ahead
          // of play() — a neighbor within VIDEO_MOUNT_RADIUS (mounted so
          // it's instant if scrolled to, see the render loop above) only
          // needs its metadata (dimensions/duration) resolved, not the file
          // itself downloading in the background before it's ever watched.
          preload={active ? 'auto' : 'metadata'}
          muted={muted}
          loop
          playsInline
          draggable={false}
          onClick={(e) => { e.stopPropagation(); togglePlay(); }}
          onTimeUpdate={(e) => { if (!seekingRef.current) setCurrentTime(e.target.currentTime); }}
          onLoadedMetadata={(e) => setDuration(e.target.duration || 0)}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onError={() => reportNegativeSignal({ signalType: 'video_load_fail', source: post.source, topic: post.topic, postId: post.id, context: { surface: 'videos' } })}
          style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
        />
      )}

      {/* Center pause indicator — only visible while actually paused, tap
          anywhere on the video (outside the progress bar) to resume.
          YouTube and Vimeo specifically get an explicit "Tap to play"
          label — cross-origin embedded video is subject to stricter mobile
          autoplay policy than a native <video> element (confirmed live:
          Bluesky/direct-file videos in this same view autoplay reliably,
          YouTube's often don't, especially for a viewer with no prior
          engagement with youtube.com on their device — a real browser
          policy, not something fixable from here). Without the label this
          reads as a broken/half-loaded video; with it, it reads as an
          intentional "tap to start" design, the same pattern Instagram/
          TikTok use for some embedded content. */}
      {src && effectivePaused && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 2, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 10, pointerEvents: 'none',
        }}>
          <button
            onClick={togglePlay}
            aria-label="Play"
            style={{
              width: 64, height: 64,
              borderRadius: '50%', background: 'rgba(0,0,0,.45)', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: '1.6rem', cursor: 'pointer', pointerEvents: 'none',
            }}
          >▶</button>
          {(src.kind === 'youtube' || src.kind === 'vimeo') && (
            <span style={{
              color: '#fff', fontSize: '.78rem', fontWeight: 700,
              textShadow: '0 1px 6px rgba(0,0,0,.7)', background: 'rgba(0,0,0,.45)',
              padding: '4px 12px', borderRadius: 12,
            }}>
              Tap to play
            </span>
          )}
        </div>
      )}

      {/* Bottom vignette — one continuous gradient behind ALL the bottom UI
          (source/author, writing, Show more, scrub bar, time, comments/
          likes rail) instead of one-off boxed backgrounds on just some of
          them. Reads as one deliberate treatment and keeps legibility
          consistent regardless of what's actually playing behind it,
          rather than some text having a boundary and some not. Grows
          taller when the caption expands so a long post's writing —
          capped below at 42dvh — is never left partly uncovered. */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 1,
        height: captionExpanded ? '78%' : '40%',
        background: 'linear-gradient(to top, rgba(0,0,0,.82) 0%, rgba(0,0,0,.5) 55%, rgba(0,0,0,0) 100%)',
        pointerEvents: 'none', transition: 'height .2s ease',
      }} />

      {/* Bottom caption overlay. Source + author are a pinned header, the
          actual writing comes right below them, and Show more/less is
          pinned right after the writing — none of the three ever move
          based on scroll/expand state, so everything stays visible and in
          a consistent reading order. Two fixes behind this shape, both
          confirmed live: (1) this whole block used to be one
          pointerEvents:'none' div — harmless while collapsed, but once
          expanded it meant nothing inside, including its own
          overflowY:auto, could ever receive a scroll/drag gesture; it just
          fell through to whatever's behind it. Only the scrollable writing
          below is pointerEvents:'auto' now (via .video-caption-scroll,
          which the mouse-drag-to-scroll handler above knows to skip so the
          two don't fight over the same drag). (2) Show more/less used to
          live at the very bottom of that same scrolling block — on a long
          post it scrolled out of view with no way to reach it, reading as
          "Show less just disappears." It's outside the scrollable region
          entirely now, so it's always reachable regardless of how far the
          writing itself is scrolled. */}
      <div
        className={isYoutube ? 'video-feed-caption video-feed-caption--youtube' : 'video-feed-caption'}
        data-video-caption
        style={{
        position: 'absolute', zIndex: 4, left: 16, right: 76, bottom: safeBottom(captionBottom), color: '#fff',
        textShadow: '0 1px 6px rgba(0,0,0,.7)', pointerEvents: 'none',
      }}>
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: '.8rem', fontWeight: 700 }}>
            <SourceMark source={post.source} label={meta.icon} size={13} />
            <span>{post.sourceLabel || meta.label}</span>
            {post.matchedByLocation && (
              <span style={{
                fontSize: '.65rem', fontWeight: 800, color: '#D1FAE5',
                border: '1px solid rgba(167,243,208,.7)', background: 'rgba(6,78,59,.72)',
                padding: '2px 7px', borderRadius: 5, textShadow: 'none', whiteSpace: 'nowrap',
              }}>
                {post.locationMatchLabel || 'Near you'}
              </span>
            )}
          </div>
          {post.author?.name && <div style={{ fontSize: '.78rem', opacity: 0.85, marginTop: 2 }}>{post.author.name}</div>}
        </div>
        <div
          className={captionExpanded ? 'video-caption-scroll' : undefined}
          style={{
            maxHeight: captionExpanded ? '42dvh' : undefined,
            overflowY: captionExpanded ? 'auto' : undefined,
            WebkitOverflowScrolling: captionExpanded ? 'touch' : undefined,
            touchAction: captionExpanded ? 'pan-y' : undefined,
            pointerEvents: captionExpanded ? 'auto' : 'none',
          }}
        >
          {post.title && (
            <div style={{
              fontSize: '.9rem', fontWeight: 600, marginBottom: 4, lineHeight: 1.35,
              display: captionExpanded ? 'block' : '-webkit-box',
              WebkitLineClamp: captionExpanded ? 'unset' : 3, WebkitBoxOrient: 'vertical',
              overflow: captionExpanded ? 'visible' : 'hidden', whiteSpace: 'pre-wrap',
            }}>
              {post.title}
            </div>
          )}
          {captionBody && (
            <div style={{
              fontSize: '.82rem', lineHeight: 1.45, whiteSpace: 'pre-wrap', opacity: 0.92,
              display: captionExpanded ? 'block' : '-webkit-box',
              WebkitLineClamp: captionExpanded ? 'unset' : 2,
              WebkitBoxOrient: 'vertical', overflow: captionExpanded ? 'visible' : 'hidden',
            }}>
              {captionBody}
            </div>
          )}
        </div>
        {(hasExtraCaption || post.sourceUrl) && (
          <div className="video-feed-caption-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {hasExtraCaption && (
              <button
                onClick={(e) => { e.stopPropagation(); setCaptionExpanded(x => !x); }}
                style={{
                  background: 'rgba(0,0,0,.5)', border: 'none', borderRadius: 10,
                  color: '#fff', fontWeight: 700, fontSize: '.75rem', padding: '4px 9px',
                  cursor: 'pointer', pointerEvents: 'auto', opacity: 0.95,
                }}
              >
                {captionExpanded ? 'Show less' : 'Read more'}
              </button>
            )}
            {post.sourceUrl && (
              <a
                href={post.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.stopPropagation();
                  reportEngagementSignal({ postId: post.id, source: post.source, topic: post.topic, linkClick: true });
                }}
                style={{
                  display: 'inline-block', background: 'rgba(0,0,0,.5)',
                  borderRadius: 10, color: '#fff', fontWeight: 700, fontSize: '.75rem',
                  padding: '4px 9px', textDecoration: 'none', pointerEvents: 'auto', opacity: 0.95,
                }}
              >
                View original post ↗
              </a>
            )}
          </div>
        )}
      </div>

      {/* Scrub tracker — click or drag anywhere on the bar to skip to that
          point in the video. Widens slightly while actively dragging so
          it's easier to hit on touch. Black track/fill/thumb (not the
          previous white) to sit quietly against the video instead of a
          bright white bar cutting across it — the thumb keeps a thin light
          ring so it's still visible/grabbable against genuinely black
          video content, widening along with the dot itself while seeking. */}
      {src && effectiveDuration > 0 && (
        <div
          data-video-scrubber
          ref={progressBarRef}
          onPointerDown={handleBarPointerDown}
          style={{
            position: 'absolute', zIndex: 2, left: 12, right: 12, bottom: safeBottom(scrubberBottom),
            height: seeking ? 10 : 4, borderRadius: 4, background: 'rgba(0,0,0,.45)',
            cursor: 'pointer', touchAction: 'none', transition: 'height .12s',
          }}
        >
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4,
            width: `${progressFraction * 100}%`, background: '#000',
          }} />
          <div style={{
            position: 'absolute', top: '50%', left: `${progressFraction * 100}%`,
            transform: 'translate(-50%, -50%)', width: seeking ? 16 : 11, height: seeking ? 16 : 11,
            borderRadius: '50%', background: '#000',
            boxShadow: seeking
              ? '0 0 0 2px rgba(255,255,255,.85), 0 2px 8px rgba(0,0,0,.6)'
              : '0 0 0 1.5px rgba(255,255,255,.7), 0 1px 4px rgba(0,0,0,.5)',
            transition: 'width .12s, height .12s',
          }} />
        </div>
      )}
      {src && effectiveDuration > 0 && (
        <div style={{
          position: 'absolute', zIndex: 2, right: 14, bottom: safeBottom(durationBottom), color: '#fff', fontSize: '.65rem',
          fontWeight: 600, textShadow: '0 1px 4px rgba(0,0,0,.7)', pointerEvents: 'none',
        }}>
          {formatTime(effectiveCurrentTime)} / {formatTime(effectiveDuration)}
        </div>
      )}

      {/* Right-side action rail */}
      <div
        className={isYoutube ? 'video-feed-action-rail video-feed-action-rail--youtube' : 'video-feed-action-rail'}
        data-video-actions
        role="group"
        aria-label="Video engagement"
        style={{ position: 'absolute', zIndex: 4, right: 14, bottom: safeBottom(railBottom), display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: '#fff', textShadow: '0 1px 6px rgba(0,0,0,.7)' }}>
          <span style={{ fontSize: '.72rem', fontWeight: 800 }}>Likes</span>
          <span style={{ fontSize: '.68rem', fontWeight: 700 }}>{(post.likesCount || 0).toLocaleString()}</span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onOpenComments?.(post); }}
          style={{
            all: 'unset', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            color: '#fff', textShadow: '0 1px 6px rgba(0,0,0,.7)', cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: '.72rem', fontWeight: 800 }}>Comments</span>
          <span style={{ fontSize: '.68rem', fontWeight: 700 }}>{(post.commentsCount || 0).toLocaleString()}</span>
        </button>
      </div>
    </div>
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
  const [comments, setComments] = useState(null);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

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
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.55)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560, maxHeight: '70dvh', background: '#fff',
          borderRadius: '18px 18px 0 0', display: 'flex', flexDirection: 'column',
          animation: 'commentsSheetUp .22s ease-out',
        }}
      >
        <style>{'@keyframes commentsSheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }'}</style>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', borderBottom: '1px solid rgba(0,0,0,.1)', flexShrink: 0,
        }}>
          <div style={{ color: '#000', fontWeight: 700, fontSize: '.92rem' }}>
            Comments {comments?.length > 0 ? `(${comments.length})` : ''}
          </div>
          <button
            onClick={onClose}
            aria-label="Close comments"
            style={{ all: 'unset', color: 'rgba(0,0,0,.55)', fontSize: '1.3rem', cursor: 'pointer', lineHeight: 1, padding: 4 }}
          >×</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '10px 16px 20px' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <span className="spinner spinner-primary" />
            </div>
          )}
          {!loading && comments?.length === 0 && (
            <div style={{ textAlign: 'center', padding: '20px 8px', color: 'rgba(0,0,0,.55)', fontSize: '.85rem' }}>
              {live === false && post.sourceUrl
                ? <>No comments loaded from {post.sourceLabel || post.source} yet.<br />
                    <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#000', fontWeight: 700 }}>
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
                background: 'rgba(0,0,0,.08)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '.75rem', fontWeight: 700, color: '#000',
              }}>
                {(c.author?.replace(/^(?:u\/|@)/, '') || '?')[0]?.toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: '.8rem', color: '#000' }}>{c.author}</span>
                  {c.score > 0 && <span style={{ fontSize: '.68rem', color: 'rgba(0,0,0,.55)' }}>▲ {c.score.toLocaleString()}</span>}
                  <span style={{ fontSize: '.68rem', color: 'rgba(0,0,0,.55)', marginLeft: 'auto' }}>{timeAgo(c.created)}</span>
                </div>
                <p style={{ fontSize: '.84rem', lineHeight: 1.55, margin: 0, color: 'rgba(0,0,0,.92)', whiteSpace: 'pre-wrap' }}>{c.body}</p>
              </div>
            </div>
          ))}
          {!loading && hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              style={{
                display: 'block', margin: '4px auto 8px', background: 'none', border: 'none',
                color: '#000', cursor: loadingMore ? 'default' : 'pointer', fontSize: '.8rem', fontWeight: 700,
                opacity: 0.85, padding: '6px 10px',
              }}
            >
              {loadingMore ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Load more comments'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VideoFeedView({ onExit }) {
  const [videoPosts, setVideoPosts] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
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
  const [muted, toggleMuted] = useGlobalMuted();
  const [hasMore, setHasMore] = useState(true);
  const [tailWaiting, setTailWaiting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Same Feed/Following split as the main feed (see pages/Feed.jsx) — the
  // aggregate true mix here and the Following pool never share sources
  // (gated platforms only ever appear in Following, see FEED_SOCIAL_TABS
  // backend-side), so switching mode also resets the source filter.
  const [viewMode, setViewMode] = useState('feed');
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
  const searchQueryRef = useRef('');
  const topicFiltersRef = useRef([]);
  // Whether the search sheet (just the text input) or the filter sheet
  // (topic/platform) is open — two separate buttons/sheets rather
  // than one combined one, so each stays focused and quick to scan
  // instead of a single sheet trying to do three different jobs at once.
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  // Mirrors state into refs so loadPage (called from effects/callbacks that
  // don't want to be redeclared on every mode/filter change) always reads
  // the current value instead of whatever was captured at its own creation —
  // same pattern as refreshSeedRef below and viewModeRef in pages/Feed.jsx.
  const viewModeRef = useRef('feed');
  const sourceFilterRef = useRef([]);
  const containerRef = useRef(null);
  const { playbackAllowed: pointerPlaybackAllowed, pointerHandlers: framePointerHandlers } = usePointerPlaybackGate();
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
  }, []);

  const loadPage = useCallback(async ({ reset = false, bust = false, preserveOnEmpty = false, preserveQueue = false, quiet = false, continuationDepth = 0 } = {}) => {
    const requestId = ++loadRequestRef.current;
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
        endpoint = '/office/feed/videos';
      }
      const { data } = await client.get(`${endpoint}?${params}`);
      if (requestId !== loadRequestRef.current) return;
      const incoming = (Array.isArray(data.posts) ? data.posts : []).filter(p => p && resolveVideoSource(p));
      const isExplicitSearch = Boolean(searchQueryRef.current);
      const sourceExhausted = data.waitingForNew === true || data.hasMore === false;
      if (reset && isExplicitSearch) {
        // Search is the explicit exception to the no-repeat rule.
        knownIds.current = new Set();
      }
      const fresh = isExplicitSearch ? incoming : incoming.filter(p => !knownIds.current.has(p.id));
      fresh.forEach(p => markKnownId(p.id));
      setVideoPosts(prev => {
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
          const freshIds = new Set(fresh.map(post => post.id));
          return [...orderNewestFeedCohorts(fresh), ...prev.filter(post => !freshIds.has(post.id))];
        }
        if (reset) return orderNewestFeedCohorts(fresh);
        // Cursor pages are already ordered by the API. Re-sorting the full
        // mounted queue here moves slides above the viewport and makes the
        // same swipe jump backward when pagination lands.
        return [...prev, ...fresh];
      });
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
    } catch {
      if (requestId === loadRequestRef.current && !quiet) setError(true);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [markKnownId]);

  useEffect(() => () => { loadRequestRef.current += 1; }, []);
  useEffect(() => { loadPage({ reset: true }); }, [loadPage]);

  // A refresh/filter response can legitimately contain fewer items than the
  // prior queue. Keep the active pointer valid instead of leaving mobile
  // player effects pointed at an index that no longer exists.
  useEffect(() => {
    setActiveIndex(current => Math.min(Math.max(current, 0), Math.max(videoPosts.length - 1, 0)));
  }, [videoPosts.length]);

  const videoLiveStateRef = useRef({ loading: false, refreshing: false, activeIndex: 0 });
  useEffect(() => {
    videoLiveStateRef.current = { loading, refreshing, activeIndex };
  }, [loading, refreshing, activeIndex]);

  useEffect(() => {
    const refreshQuietly = () => {
      const state = videoLiveStateRef.current;
      if (document.hidden || state.loading || state.refreshing || loadingMoreRef.current) return;
      if (state.activeIndex !== 0 || (containerRef.current?.scrollTop || 0) > 1) return;
      loadPage({ reset: true, bust: false, preserveOnEmpty: true, preserveQueue: true, quiet: true });
    };
    const interval = window.setInterval(refreshQuietly, VIDEO_FEED_AUTO_REFRESH_MS);
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
    await loadPage({ reset: true, bust: true });
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

  // Filter sheet's "Clear all" resets source and topic together. Search
  // remains independent in its own sheet.
  const clearFilters = useCallback(() => {
    if (!sourceFilterRef.current.length && !topicFiltersRef.current.length) return;
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
  // The shared YouTube layer is click-through, so input over video pixels
  // reaches this native scroll container as well.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    function handlePointerDown(e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if (e.target.closest('button, a, [role="button"], .video-caption-scroll')) return;
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

  // iOS can occasionally finish a vertical gesture without moving this
  // nested snap container when the gesture began over embedded media or an
  // overlay control. Native scrolling remains the primary path; this only
  // advances when a clear swipe produced effectively zero container motion.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let gesture = null;
    let fallbackTimer = null;
    const handleTouchStart = event => {
      if (event.touches.length !== 1) {
        gesture = null;
        return;
      }
      gesture = {
        y: event.touches[0].clientY,
        scrollTop: container.scrollTop,
        nestedScroller: event.target instanceof Element
          ? event.target.closest('.video-caption-scroll')
          : null,
      };
    };
    const handleTouchEnd = event => {
      if (!gesture || event.changedTouches.length !== 1) return;
      const start = gesture;
      gesture = null;
      const deltaY = start.y - event.changedTouches[0].clientY;
      if (Math.abs(deltaY) < 56) return;
      if (start.nestedScroller) {
        const maxScroll = start.nestedScroller.scrollHeight - start.nestedScroller.clientHeight;
        const canContinueInside = deltaY > 0
          ? start.nestedScroller.scrollTop < maxScroll - 1
          : start.nestedScroller.scrollTop > 1;
        if (canContinueInside) return;
      }
      clearTimeout(fallbackTimer);
      fallbackTimer = setTimeout(() => {
        if (Math.abs(container.scrollTop - start.scrollTop) > 16) return;
        const height = container.clientHeight || 1;
        const startIndex = Math.round(start.scrollTop / height);
        const targetIndex = Math.min(
          Math.max(startIndex + (deltaY > 0 ? 1 : -1), 0),
          Math.max(videoPosts.length - 1, 0),
        );
        container.scrollTo({ top: targetIndex * height, behavior: 'smooth' });
      }, 120);
    };
    const cancelTouch = () => { gesture = null; };
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', cancelTouch, { passive: true });
    return () => {
      clearTimeout(fallbackTimer);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', cancelTouch);
    };
  }, [videoPosts.length]);

  // Fetch the next page a couple of slides before actually running out.
  // emptyStreakRef cap (see its own declaration above): without it, a
  // search/topic filter matching nothing anywhere would auto-fetch page
  // after page in the background indefinitely, since the server's hasMore
  // reflects real cursor exhaustion, not whether the filter ever matched
  // anything — this stops that once it's genuinely looking hopeless
  // rather than hammering the server (and the user's connection) forever
  // in a loop that never shows anything on screen.
  useEffect(() => {
    if (!hasMore || loadingMoreRef.current || loading) return;
    if (searchQueryRef.current && emptyStreakRef.current >= EMPTY_STREAK_LIMIT) return;
    if (activeIndex >= videoPosts.length - 3) {
      loadingMoreRef.current = true;
      // A later page may time out on a mobile connection. The videos already
      // on screen remain usable, so this must stay quiet rather than replace
      // the whole swipe feed with an error state.
      loadPage({ quiet: true }).finally(() => { loadingMoreRef.current = false; });
    }
  }, [activeIndex, videoPosts.length, hasMore, loading, loadPage]);

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
    const interval = window.setInterval(pollForNewVideos, VIDEO_FEED_TAIL_POLL_MS);
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
      setYoutubeFrameOrientations(current => (
        current[videoId] ? current : { ...current, [videoId]: orientation }
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
  const sharedYtSeekingRef = useRef(false);
  // Guards a fast-swipe race on loadVideoById — see the effect below.
  const sharedYtPendingLoadRef = useRef(null);
  const sharedYtRetryRef = useRef(null);
  const sharedYtReadyTimeoutRef = useRef(null);
  const [sharedYt, setSharedYt] = useState({ paused: false, duration: 0, currentTime: 0, failed: false });
  sharedYtDesiredIdRef.current = pointerPlaybackAllowed && activeSrc?.kind === 'youtube' ? activeSrc.id : null;
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
  const [ytBoxSize, setYtBoxSize] = useState({ width: 0, height: 0, top: 0 });
  useEffect(() => {
    const wrapper = sharedYtWrapperRef.current;
    if (!wrapper) return;
    const ratio = activeSrc?.vertical ? 9 / 16 : 16 / 9;
    function recompute(availW, availH) {
      if (!availW || !availH) return;
      const width = availW / ratio <= availH ? availW : availH * ratio;
      const height = width / ratio;
      setYtBoxSize({ width, height, top: Math.max(0, (availH - height) / 2) });
    }
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      recompute(width, height);
    });
    observer.observe(wrapper);
    const rect = wrapper.getBoundingClientRect();
    recompute(rect.width, rect.height);
    return () => observer.disconnect();
  }, [activeSrc?.vertical]);

  const startSharedYtAutoplayRetry = useCallback((player, videoId) => {
    clearInterval(sharedYtRetryRef.current);
    let attempts = 0;
    sharedYtRetryRef.current = setInterval(() => {
      if (!sharedYtMountedRef.current || sharedYtDesiredIdRef.current !== videoId) {
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
      sharedYtPlayerRef.current = null;
      sharedYtReadyRef.current = false;
      sharedYtCreatingRef.current = false;
      sharedYtLoadedIdRef.current = null;
      try { player?.destroy(); } catch {}
      try { sharedYtHostRef.current?.replaceChildren(); } catch {}
    };
  }, []);

  useEffect(() => {
    const videoId = pointerPlaybackAllowed && activeSrc?.kind === 'youtube' ? activeSrc.id : null;
    clearTimeout(sharedYtPendingLoadRef.current);
    clearInterval(sharedYtRetryRef.current);

    if (!videoId) {
      try { if (sharedYtReadyRef.current) sharedYtPlayerRef.current?.pauseVideo(); } catch {}
      return;
    }

    setSharedYt(s => ({ ...s, failed: false }));
    const activatePlayer = (player, targetId) => {
      if (!sharedYtMountedRef.current || sharedYtDesiredIdRef.current !== targetId || !sharedYtReadyRef.current) return;
      try {
        if (sharedYtLoadedIdRef.current !== targetId) {
          sharedYtLoadedIdRef.current = targetId;
          setSharedYt(s => ({ ...s, duration: 0, currentTime: 0, paused: false }));
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
      const mount = document.createElement('div');
      mount.style.width = '100%';
      mount.style.height = '100%';
      mount.style.pointerEvents = 'none';
      host.appendChild(mount);

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
            autoplay: 1, mute: 1, playsinline: 1, loop: 1,
            controls: 0, modestbranding: 1, rel: 0, playlist: initialId,
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
                iframe.style.pointerEvents = 'none';
                iframe.style.touchAction = 'pan-y';
                iframe.tabIndex = -1;
              } catch {}

              const desiredId = sharedYtDesiredIdRef.current;
              if (!desiredId) {
                try { e.target.pauseVideo(); } catch {}
                return;
              }
              if (desiredId !== initialId) {
                try { e.target.loadVideoById(desiredId); } catch {}
              }
              sharedYtLoadedIdRef.current = desiredId;
              try {
                if (sharedYtMutedRef.current) e.target.mute(); else e.target.unMute();
                e.target.playVideo();
              } catch {}
              try {
                const duration = e.target.getDuration() || 0;
                setSharedYt(s => ({ ...s, duration, currentTime: 0, paused: false }));
              } catch {}
              startSharedYtAutoplayRetry(e.target, desiredId);
            },
            onStateChange: (e) => {
              if (!isCurrent()) return;
              setSharedYt(s => ({ ...s, paused: e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED }));
              try {
                const duration = e.target.getDuration() || 0;
                if (duration) {
                  setSharedYt(s => ({ ...s, duration }));
                }
              } catch {}
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
  }, [activeIndex, activeSrc?.kind, activeSrc?.id, pointerPlaybackAllowed, startSharedYtAutoplayRetry]);

  useEffect(() => {
    const pollId = setInterval(() => {
      if (!sharedYtReadyRef.current || !sharedYtDesiredIdRef.current || sharedYtSeekingRef.current) return;
      try {
        const player = sharedYtPlayerRef.current;
        const currentTime = player?.getCurrentTime() || 0;
        const duration = player?.getDuration() || 0;
        setSharedYt(s => (s.currentTime === currentTime && s.duration === duration)
          ? s
          : { ...s, currentTime, duration });
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
    if (!p) return;
    try { if (p.getPlayerState() === 1) p.pauseVideo(); else p.playVideo(); } catch {}
  }, []);

  const sharedYtSeekTo = useCallback((time) => {
    setSharedYt(s => ({ ...s, currentTime: time }));
    try { sharedYtPlayerRef.current?.seekTo(time, true); } catch {}
  }, []);

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
    const handleKey = (e) => { if (e.key === 'Escape') onExit(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onExit]);

  // Standalone/installed-PWA mobile ("app view") renders under a real
  // status bar/notch that a plain mobile-browser tab doesn't have — index.html
  // already sets viewport-fit=cover so env(safe-area-inset-top) is live; adding
  // it here (rather than just a fixed px offset) keeps the whole control
  // cluster clear of a notch across whatever device this actually runs on,
  // in-browser or installed, instead of guessing one fixed number that's
  // only right for some devices.
  const topSafe = 'calc(16px + env(safe-area-inset-top, 0px))';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'radial-gradient(ellipse 80% 60% at 50% 40%, #181818 0%, #000 70%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'pan-y',
    }}>
      {/* Everything but the comments sheet lives inside this frame. Built
          for a phone screen (full-bleed controls, a 9:16 video box) — on a
          wide desktop browser the outer root above is the whole browser
          window, so without a width cap the controls would spread edge to
          edge (disconnected from the actual video) and the video box itself
          would get squashed (aspect-ratio kept, but its width stays 100% of
          a very wide parent while max-height clips it, distorting the
          frame). Full-bleed edge-to-edge also just reads as unstyled once
          it's not filling the whole screen anymore — see the
          `.video-feed-frame` media-query rule in index.css, which caps this
          at a phone-like width *and* height, centers it (the flex on the
          root above), and gives it rounded corners + a shadow so it reads
          as a deliberate "theater" card sitting on the page rather than a
          mobile layout stretched into a black void. Every absolutely-
          positioned child below keys off THIS div (the nearest positioned
          ancestor), so they all move and scale with the card together.
          Full-bleed edge-to-edge on an actual phone width is unaffected. */}
      <div
        className="video-feed-frame"
        data-orientation={activeIsWideVideo ? 'landscape' : 'portrait'}
        {...framePointerHandlers}
        style={{ position: 'relative', height: '100%', width: '100%' }}
      >
      {/* All controls on one row now, at the very top — was three separate
          absolutely-positioned rows (icons, then Feed/Following, then
          Search/Filter), split apart specifically because independently
          absolute-positioned elements had no awareness of each other's real
          width and could mathematically overlap on a narrow phone (the
          Feed/Following pill covering the refresh button was the confirmed
          case — see git history). A single flex container sidesteps that
          class of bug entirely: every child gets its own space in normal
          flex flow, so two elements can't occupy the same pixels regardless
          of viewport width. Search/Filter dropped their text labels here
          (icon + a small active-state dot instead of "Search"/"Filter · N")
          — with every other control now sharing this same row, keeping the
          full-width pills would overflow a real phone width; a badge reads
          fine at a glance and the sheet itself still shows exactly what's
          active. */}
      <div className="video-feed-top-controls" style={{
        position: 'absolute', top: topSafe, left: 12, right: 12,
        zIndex: 20, display: 'flex', alignItems: 'center', gap: 6,
        pointerEvents: 'auto', touchAction: 'manipulation',
      }}>
        <button type="button" onPointerDown={event => event.stopPropagation()} onClick={onExit} aria-label="Back to Home" style={{ ...OVERLAY_BTN_STYLE, width: 36, height: 36, flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        {/* Feed/Following toggle — same split and reasoning as
            pages/Feed.jsx's view-mode tabs, styled for the dark full-bleed
            video overlay instead of the light page chrome. */}
        <div style={{
          display: 'flex', gap: 4, flexShrink: 0,
          background: 'rgba(0,0,0,.4)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,.18)', borderRadius: 18, padding: 3,
        }}>
          {[{ key: 'feed', label: 'Home' }, { key: 'following', label: 'Following' }].map(({ key, label }) => {
            const active = viewMode === key;
            return (
              <button
                key={key}
                type="button"
                onPointerDown={event => event.stopPropagation()}
                onClick={event => {
                  event.stopPropagation();
                  if (key === 'feed') {
                    onExit();
                    return;
                  }
                  switchViewMode(key);
                }}
                style={{
                  padding: '5px 10px', borderRadius: 15, border: 'none', cursor: 'pointer',
                  fontWeight: 700, fontSize: '.72rem', whiteSpace: 'nowrap',
                  background: active ? '#fff' : 'transparent',
                  color: active ? '#000' : '#fff',
                  touchAction: 'manipulation',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Search + Filter — two separate buttons/sheets, each doing one
            job, rather than one combined sheet trying to do three (search/
            topic/platform) at once. Following mode uses its own,
            separate source list (FOLLOWING_VIDEO_SOURCES) — the Filter
            sheet switches between them based on viewMode. */}
        <button
          onClick={() => { setSearchInput(searchQuery); setSearchOpen(true); }}
          aria-label="Search videos"
          style={{
            ...OVERLAY_BTN_STYLE, width: 36, height: 36, flexShrink: 0, position: 'relative',
            border: `1px solid ${searchQuery ? '#fff' : 'rgba(255,255,255,.18)'}`,
            background: searchQuery ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.4)',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          {searchQuery && (
            <span style={{ position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: '50%', background: '#4ADE80', border: '1px solid rgba(0,0,0,.4)' }} />
          )}
        </button>
        <button
          onClick={() => setFilterOpen(true)}
          aria-label="Filter videos"
          style={{
            ...OVERLAY_BTN_STYLE, width: 36, height: 36, flexShrink: 0, position: 'relative',
            border: `1px solid ${(sourceFilter.length || topicFilters.length) ? '#fff' : 'rgba(255,255,255,.18)'}`,
            background: (sourceFilter.length || topicFilters.length) ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.4)',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6" x2="20" y2="6" /><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
            <line x1="4" y1="12" x2="20" y2="12" /><circle cx="16" cy="12" r="2" fill="currentColor" stroke="none" />
            <line x1="4" y1="18" x2="20" y2="18" /><circle cx="11" cy="18" r="2" fill="currentColor" stroke="none" />
          </svg>
          {(sourceFilter.length || topicFilters.length) > 0 && (
            <span style={{ position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: '50%', background: '#4ADE80', border: '1px solid rgba(0,0,0,.4)' }} />
          )}
        </button>

        {/* Spacer pushes refresh/mute to the far right regardless of how
            much room the controls above actually take up. */}
        <div style={{ flex: 1 }} />

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh videos"
          style={{
            ...OVERLAY_BTN_STYLE, width: 36, height: 36, flexShrink: 0,
            fontSize: '.95rem', cursor: refreshing ? 'default' : 'pointer', opacity: refreshing ? 0.6 : 1,
          }}
        >
          <span style={{ display: 'inline-block', animation: refreshing ? 'spin 0.9s linear infinite' : 'none' }}>⟳</span>
        </button>
        <button
          onClick={() => { if (!muteControllable) return; toggleMuted(); }}
          disabled={!muteControllable}
          aria-label={muteControllable ? (muted ? 'Unmute' : 'Mute') : 'This video uses its own built-in volume control'}
          style={{
            ...OVERLAY_BTN_STYLE, width: 36, height: 36, flexShrink: 0, fontSize: '1rem',
            opacity: muteControllable ? 1 : 0.35, cursor: muteControllable ? 'pointer' : 'default',
          }}
        ><SoundIcon muted={muted} size={16} /></button>
      </div>

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
                onClick={() => clearSearch()}
                disabled={!searchInput && !searchQuery}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 10, marginTop: 10,
                  border: '1px solid rgba(255,255,255,.25)', background: 'transparent',
                  color: (!searchInput && !searchQuery) ? 'rgba(255,255,255,.35)' : '#fff',
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
              <div style={{ fontSize: '.72rem', fontWeight: 700, letterSpacing: '.02em', opacity: 0.6, marginBottom: 8, textTransform: 'uppercase' }}>Platform</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
                {(viewMode === 'following' ? FOLLOWING_VIDEO_SOURCES : FEED_VIDEO_SOURCES).map(key => {
                  const meta = SOURCE_META[key] || {};
                  const active = sourceFilter.includes(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleSourceFilter(key)}
                      aria-label={meta.label || key}
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

              <div style={{ fontSize: '.72rem', fontWeight: 700, letterSpacing: '.02em', opacity: 0.6, marginBottom: 8, textTransform: 'uppercase' }}>Topic</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {ALL_INTERESTS.map(topic => {
                  const active = topicFilters.includes(topic);
                  return (
                    <button
                      key={topic}
                      onClick={() => toggleTopicFilter(topic)}
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
                onClick={() => clearFilters()}
                disabled={sourceFilter.length === 0 && topicFilters.length === 0}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 10, marginTop: 10,
                  border: '1px solid rgba(255,255,255,.25)', background: 'transparent',
                  color: (sourceFilter.length === 0 && topicFilters.length === 0) ? 'rgba(255,255,255,.35)' : '#fff',
                  fontWeight: 700, fontSize: '.85rem',
                  cursor: (sourceFilter.length === 0 && topicFilters.length === 0) ? 'default' : 'pointer',
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

      {loading && videoPosts.length === 0 ? (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '.9rem' }}>
          Loading videos... lining up the good stuff.
        </div>
      ) : videoPosts.length === 0 ? (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', gap: 14, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: '2.2rem', fontWeight: 800 }}>Video</div>
          <div style={{ fontSize: '.9rem', opacity: 0.85, maxWidth: 280 }}>
            {error
              ? "Couldn't load videos right now."
              : viewMode === 'following'
                ? 'No videos yet from your connected world. Try another platform filter while the popcorn regroups.'
                : 'No videos yet. The scroll is warming up and trying not to trip over its own shoelaces.'}
          </div>
          <button onClick={onExit} className="btn btn-primary btn-sm">Back to Home</button>
        </div>
      ) : (
        <>
        {/* loading (a filter/topic/search/sort change, or Following/Feed
            switch — see loadPage's reset path) used to be its own branch
            above, replacing this entire fragment — including the shared
            YouTube player's mount div below — with the plain spinner. React
            fully unmounted that div, but sharedYtPlayerRef.current (the
            underlying YT.Player, deliberately never cleared — see the
            comment on the overlay below) was never reset to match, so the
            next video's play/pause calls silently no-op against an
            already-detached iframe. Confirmed live as "tap to play does
            nothing" on every filter change, and effectively "always" since
            ~73% of this feed's content is YouTube-kind. Now the fragment
            (and the live player inside it) stays mounted straight through a
            reset — videoPosts still holds the pre-filter content until the
            new page actually lands (see loadPage) — with just a dimmed
            overlay on top for the brief gap, instead of tearing the player
            down and rebuilding it every time. */}
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 50, background: 'rgba(0,0,0,.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: '.9rem', pointerEvents: 'none',
          }}>
            Loading videos…
          </div>
        )}
        <div
          ref={containerRef}
          // video-feed-scroll: hides this element's own native scrollbar
          // (see index.css) — on desktop that scrollbar renders right at
          // the frame's edge, easy to mistake for some kind of cursor.
          // scrollbar-width/::-webkit-scrollbar together cover every
          // browser, since no single property does; a real OS scrollbar's
          // color isn't reliably stylable across all of them either
          // (::-webkit-scrollbar-thumb only works in Chromium/WebKit, not
          // Firefox), so hiding it outright is the one fix that's actually
          // consistent everywhere. Purely visual — scrolling (wheel,
          // drag, touch, keyboard) all still work exactly the same.
          className="video-feed-scroll"
          // userSelect:'none' is also what actually answers "get rid of the
          // text cursor" (a real OS text-caret icon can't be recolored from
          // CSS) — with nothing in this view selectable, the browser has no
          // reason to ever show it over the likes count/source label/
          // caption text, so it never appears in the first place rather
          // than needing to be hidden after the fact. cursor:'grab' hints
          // the click-and-drag scrolling below on desktop (a no-op on
          // touch, nothing renders a cursor there); the drag handler swaps
          // it to 'grabbing' for the duration of an actual drag.
          style={{
            height: '100%', overflowY: 'auto', scrollSnapType: 'y mandatory', WebkitOverflowScrolling: 'touch',
            overscrollBehaviorY: 'none', touchAction: 'pan-y', userSelect: 'none', cursor: 'grab',
          }}
        >
          {videoPosts.map((post, idx) => (
            <div
              // idx included — the pool now legitimately wraps/repeats once
              // real supply runs out (see sliceCircular server-side), so
              // the same post.id can appear more than once in this list.
              key={`${post.id || 'v'}-${idx}`}
              ref={el => { slideRefs.current[idx] = el; }}
              data-idx={idx}
              data-post-id={post.id || ''}
              data-source={post.source || ''}
              // Was 100dvh — an absolute viewport unit computed independently
              // of this slide's own ancestor chain (the root is pinned to the
              // real viewport via position:fixed + inset:0, then height:100%
              // down to this scroll container). 100dvh and inset:0 are
              // *supposed* to resolve to the same value, but on some mobile
              // browsers they can drift apart slightly as the browser's own
              // UI chrome (address bar, etc.) animates open/closed — leaving
              // a thin gap at the bottom of every slide where the page's own
              // light background (#F8FAFC) shows through behind the video,
              // confirmed live as a persistent white/grey strip at the
              // bottom of every video regardless of which post. height:100%
              // instead ties this directly to the same already-correctly-
              // sized ancestor rather than an independently-computed unit
              // that can disagree with it.
              // scrollSnapStop:'always' used to sit here too, to stop a fast
              // fling from skipping past more than one video at a time — but
              // on WebKit it also disables real-time finger-tracking during
              // the drag itself: instead of the slide moving 1:1 with the
              // touch the way native scrolling normally does, the browser
              // holds it still for the whole gesture and only animates it to
              // the decided snap target on release, confirmed live as
              // "video stays stationary for a second then jumps." Dropping
              // it restores normal drag-tracking (scrollSnapType alone still
              // snaps cleanly on release) at the cost of a very hard flick
              // occasionally advancing two slides instead of one — the same
              // tradeoff TikTok's own web player makes.
              style={{ height: '100%', scrollSnapAlign: 'start' }}
            >
              {Math.abs(idx - activeIndex) <= VIDEO_MOUNT_RADIUS ? (
                <VideoSlide
                  post={post}
                  active={idx === activeIndex}
                  playbackAllowed={pointerPlaybackAllowed}
                  muted={muted}
                  onToggleMute={toggleMuted}
                  isScrolling={isScrolling}
                  onOpenComments={setCommentsPost}
                  // Only the active slide ever reads this — see VideoSlide's
                  // own effectivePaused/effectiveDuration/effectiveCurrentTime,
                  // which fall back to 0/false when it's undefined, correctly
                  // hiding the pause indicator/scrub bar on every inactive
                  // slide exactly like before this refactor.
                  sharedYt={idx === activeIndex ? {
                    paused: sharedYt.paused,
                    duration: sharedYt.duration,
                    currentTime: sharedYt.currentTime,
                    failed: sharedYt.failed,
                    togglePlay: sharedYtTogglePlay,
                    seekTo: sharedYtSeekTo,
                    seekingRef: sharedYtSeekingRef,
                    frame: activeSrc?.kind === 'youtube' ? ytBoxSize : undefined,
                  } : undefined}
                />
              ) : (
                // Outside VIDEO_MOUNT_RADIUS — same solid background every
                // VideoSlide starts from (see its own outer wrapper), so a
                // fast fling passing through never shows anything visibly
                // different from a real slide that just hasn't started
                // playing yet.
                <div style={{ height: '100%', width: '100%', background: '#000' }} />
              )}
            </div>
          ))}
        </div>

        {/* Shared YouTube player overlay (see sharedYt/sharedYtPlayerRef
            above) — ALWAYS mounted, never conditionally removed from the
            DOM based on which slide is active. YouTube's IFrame API
            physically replaces the mount div below with its own <iframe>,
            entirely outside React's knowledge (same hazard Feed.jsx's own
            YouTubeEmbedBlock documents at length). This used to be wrapped
            in `{activeSrc?.kind === 'youtube' && (...)}`, so React tore the
            mount div — and the live iframe YouTube had already substituted
            in its place — out of the DOM the instant the user scrolled to
            a single non-YouTube video, but sharedYtPlayerRef.current was
            never cleared to match. The next YouTube video's effect then
            took the "reuse existing player" branch against a reference to
            an already-destroyed player, silently failing every play/
            pause/seek call — confirmed live as "tap to play doesn't
            work," and it undid the entire point of keeping one player
            alive across slides. Hidden via opacity/pointer-events instead
            of unmounted, so the node (and whatever live iframe YouTube has
            put in its place) survives scrolling past any number of non-
            YouTube videos in between. Positioned independently of any
            individual slide, matching the exact same centered/aspect-ratio
            box a per-slide player would have used, so it always lines up
            with the active slide (which, scroll-snapped, always fills this
            same viewport). z-index sits above the scrolling slide list
            itself (default stacking) but below every per-slide UI element
            (caption/scrub bar/action rail/pause indicator, all bumped to
            z-index 2 — see VideoSlide) and well below the top controls
            (z-index 10) and any modal (comments sheet, filter sheet).
            Also hidden (not just when non-YouTube) for the duration of an
            active scroll gesture, same as the isScrolling check every
            file/hls slide already uses to pause in place — but for a
            different reason here: this overlay is positioned to the fixed
            viewport, not inside the scrolling slide list, so unlike a
            per-slide player it doesn't move WITH the drag at all — left
            visible, it would visually "stick" floating in place while
            everything else (backdrop, caption, other slides) scrolls past
            around it. Fading out for the drag and back in once scrolling
            settles (when activeIndex itself updates) reads as clean rather
            than broken; a brief transition softens the swap instead of an
            abrupt cut. */}
        <div ref={sharedYtWrapperRef} className="video-feed-youtube-player" style={{
          position: 'absolute', inset: 0, zIndex: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          // This player is a visual sibling of the scroll container. Let
          // native wheel, trackpad, and touch input pass through to it.
          pointerEvents: 'none',
          opacity: activeSrc?.kind === 'youtube' && !isScrolling ? 1 : 0,
          transition: 'opacity .15s ease-out',
        }}>
          <div
            // Explicit pixel width/height from ytBoxSize (measured off this
            // wrapper via ResizeObserver, see above) instead of width/
            // height:auto + aspect-ratio — that CSS-only approach doesn't
            // reliably resolve here (this box is a centered, not stretched,
            // flex item, so neither axis ever becomes definite from layout
            // alone), confirmed live as a video rendering at roughly a
            // bare <iframe>'s ~300x150 browser default regardless of how
            // large the actual card was. Falls back to 100%/100% only for
            // the brief instant before the very first measurement lands.
            style={{
              width: ytBoxSize.width || '100%', height: ytBoxSize.height || '100%',
              position: 'relative', pointerEvents: 'none',
            }}
          >
            <div ref={sharedYtHostRef} style={{ width: '100%', height: '100%', pointerEvents: 'none', visibility: sharedYt.failed ? 'hidden' : 'visible' }} />
            {sharedYt.failed && activeSrc?.kind === 'youtube' && pointerPlaybackAllowed && (
              // Same reasoning as the old per-slide fallback: the IFrame
              // Player API script never went ready (blocked, offline,
              // slow network) — a plain embed iframe doesn't load that
              // script at all and still autoplays muted on its own.
              <iframe
                src={`https://www.youtube.com/embed/${activeSrc.id}?autoplay=1&mute=${userWantsSound() ? 0 : 1}&playsinline=1&loop=1&playlist=${activeSrc.id}&controls=0&modestbranding=1&rel=0`}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', display: 'block', pointerEvents: 'none' }}
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                title={videoPosts[activeIndex]?.title}
              />
            )}
          </div>
        </div>
        </>
      )}
      </div>

      {commentsPost && <CommentsSheet post={commentsPost} onClose={() => setCommentsPost(null)} />}
    </div>
  );
}
