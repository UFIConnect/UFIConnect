import { useEffect, useRef, useState } from 'react';
import { useDataPreferences, previewPlaybackAllowed } from '../preferences';
import { directMediaPlaybackAllowed, officialYouTubeId, officialVimeoId } from '../utils/sourceMediaPolicy.mjs';

// Every video surface (the Videos swipe feed, the photo/video lightbox, and
// each inline YouTube card in the Feed) starts muted by default and only
// ever unmutes in direct response to a click — necessary so the mute
// button's own state can never lie about whether sound is actually playing
// (see the fetchBluesky-adjacent fix elsewhere this session for why an
// automatic reveal can't be trusted). But taken alone, that meant a real
// click was needed on *every single video*, forever, since each one starts
// its own fresh, independent muted state with nothing carried over —
// confirmed as a genuine ongoing annoyance, not just an autoplay-policy
// nitpick. Once someone has directly clicked unmute at all this browser,
// that's real, registered engagement (the same signal browsers themselves
// use to judge autoplay-with-sound more leniently going forward) — worth
// remembering so every subsequent video can just start that way instead of
// demanding the same click over and over. Symmetric: explicitly muting
// again is remembered the same way.
const SOUND_PREF_KEY = 'ufc_wants_sound';
const SOUND_PREF_EVENT = 'ufc-sound-pref-change';
export function userWantsSound() {
  try { return localStorage.getItem(SOUND_PREF_KEY) === '1'; } catch { return false; }
}
export function rememberSoundPreference(wantsSound) {
  try {
    if (wantsSound) localStorage.setItem(SOUND_PREF_KEY, '1');
    else localStorage.removeItem(SOUND_PREF_KEY);
  } catch {}
  // Broadcast so every other mounted video on the page — a different card
  // in the Feed, a slide in the Videos swipe list, an open lightbox — picks
  // up the change in the same tick a real click happens on any one of them,
  // instead of only ever affecting videos that mount fresh afterward.
  window.dispatchEvent(new CustomEvent(SOUND_PREF_EVENT, { detail: wantsSound }));
}

// One on/off switch shared by every video surface at once: muting or
// unmuting any single video mutes/unmutes every other currently-mounted
// video too (Feed cards, the Videos swipe feed, the lightbox), matching
// how a single hardware mute button would behave. Plain per-component
// useState can't do that across independent instances, so this subscribes
// to the same broadcast rememberSoundPreference fires.
export function useGlobalMuted() {
  const [muted, setMutedState] = useState(() => !userWantsSound());
  useEffect(() => {
    const onChange = (e) => setMutedState(!e.detail);
    window.addEventListener(SOUND_PREF_EVENT, onChange);
    return () => window.removeEventListener(SOUND_PREF_EVENT, onChange);
  }, []);
  const toggleMuted = () => {
    const next = !muted;
    rememberSoundPreference(!next);
    setMutedState(next);
  };
  return [muted, toggleMuted];
}

// A mouse has a precise playback target that touch screens do not. Desktop
// inline feeds therefore play the video under the pointer (or containing
// keyboard focus), while phones and tablets keep their viewport-driven
// autoplay behavior. Keeping this as one shared hook prevents YouTube,
// Vimeo, HLS, and direct-file cards from interpreting pointer input
// differently. Full-screen Videos and Music use their active slide instead.
export function usePointerPlaybackGate() {
  const [requiresPointer, setRequiresPointer] = useState(() => (
    typeof window !== 'undefined'
      && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
  ));
  const [pointed, setPointed] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const media = window.matchMedia?.('(hover: hover) and (pointer: fine)');
    if (!media) return undefined;
    const update = () => {
      setRequiresPointer(media.matches);
      if (!media.matches) setPointed(false);
    };
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  return {
    playbackAllowed: !requiresPointer || pointed || focused,
    pointerHandlers: {
      onPointerEnter: (event) => {
        if (event.pointerType === 'mouse' || event.pointerType === 'pen') setPointed(true);
      },
      onPointerLeave: (event) => {
        if (event.pointerType === 'mouse' || event.pointerType === 'pen') setPointed(false);
      },
      onFocusCapture: () => setFocused(true),
      onBlurCapture: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      },
    },
  };
}

export function SoundIcon({ muted, size = 16 }) {
  return muted ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="m22 9-6 6" />
      <path d="m16 9 6 6" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

// Feed cards (YouTube/Vimeo embeds, inline autoplay previews) each
// run their own IntersectionObserver to know when they've scrolled into
// view, but did so entirely independently of one another. On a normal card
// height (unlike the Videos swipe feed, where each slide fills the whole
// screen so only one can ever cross a >60% threshold at a time), two or
// more video cards can genuinely be >25% visible on screen simultaneously —
// so multiple were autoplaying, and for YouTube/Vimeo, audibly playing, at
// once. This makes only the most-recently-scrolled-to candidate eligible:
// every inView card registers itself in arrival order, and the last one to
// arrive wins, so scrolling to a new video pauses whatever was playing
// before it the same way the Videos feed's single activeIndex does.
const soloPlaybackOrder = [];
const SOLO_PLAYBACK_EVENT = 'ufc-solo-video-change';
function broadcastSoloWinner() {
  const winner = soloPlaybackOrder.length ? soloPlaybackOrder[soloPlaybackOrder.length - 1] : null;
  window.dispatchEvent(new CustomEvent(SOLO_PLAYBACK_EVENT, { detail: winner }));
}
export function useSoloVideoPlayback(id, inView) {
  const [isSolo, setIsSolo] = useState(false);
  useEffect(() => {
    const onChange = (e) => setIsSolo(e.detail === id);
    window.addEventListener(SOLO_PLAYBACK_EVENT, onChange);
    return () => window.removeEventListener(SOLO_PLAYBACK_EVENT, onChange);
  }, [id]);

  useEffect(() => {
    const existingIdx = soloPlaybackOrder.indexOf(id);
    if (existingIdx !== -1) soloPlaybackOrder.splice(existingIdx, 1);
    if (inView) soloPlaybackOrder.push(id);
    broadcastSoloWinner();
    return () => {
      const idx = soloPlaybackOrder.indexOf(id);
      if (idx !== -1) { soloPlaybackOrder.splice(idx, 1); broadcastSoloWinner(); }
    };
  }, [id, inView]);

  return isSolo;
}

// embedId (the YouTube video ID used for in-app iframe playback) only ever
// existed on the live/in-memory post shape — feed_posts_cache has no column
// for it, so any YouTube post served from the database (the primary path
// for most of the feed now) arrived with no way to actually play the video,
// only a thumbnail + an external link. It's recoverable from sourceUrl
// (watch?v=..., youtu.be/..., Shorts, or a live URL), which is always
// persisted.
export function extractYouTubeId(url) {
  return officialYouTubeId(url);
}

export function youTubePosterUrl(videoId, quality = 'hqdefault') {
  if (!videoId) return null;
  const safeId = String(videoId).match(/^[\w-]{11}$/) ? videoId : null;
  return safeId ? `https://i.ytimg.com/vi/${safeId}/${quality}.jpg` : null;
}

// Real Shorts (server-verified by actual video duration — see
// fetchYouTubeShortsByKeyword backend-side) are persisted with a
// youtube.com/shorts/... sourceUrl specifically so this classification
// survives the DB round-trip without needing its own column — a regular
// video's sourceUrl is always .../watch?v=... A vertical (9:16) video
// forced into a fixed 16:9 landscape container renders squeezed with its
// own thumbnail/title cropped, confirmed live as a Short's video looking
// visibly cut off in the Videos feed.
export function isYouTubeShortsUrl(url) {
  return /youtube\.com\/shorts\//.test(String(url || ''));
}

// Same idea as extractYouTubeId, for RSS articles that embed a Vimeo player
// instead (see parseRSSItems' vimeo detection backend-side) — a plain
// numeric ID, recoverable from either the canonical vimeo.com/{id} watch URL
// mediaUrl is normalized to, or a raw player.vimeo.com/video/{id} embed URL.
export function extractVimeoId(url) {
  return officialVimeoId(url);
}

// Retain the helper contract while disabling guessed media endpoints.
export function deriveBlueskyPlaylistUrl() {
  // Deriving a media endpoint from a thumbnail bypasses the source player.
  // Until an approved embed is installed, callers offer the original link.
  return null;
}

// Vimeo posts (see resolveVideoSource's own 'vimeo' branch in
// VideoFeedView.jsx) always have poster:null — mediaUrl there is the
// vimeo.com/{id} *watch* URL, needed as-is for extractVimeoId, so it can't
// double as a thumbnail source the way YouTube's mediaUrl-derived
// i.ytimg.com poster does. Confirmed live as a blank/emoji-only "no
// thumbnail" state for every Vimeo post: no letterboxed backdrop, no
// preview image while inactive. Vimeo's own oEmbed endpoint (public,
// CORS-enabled — meant for exactly this, embedding a preview on a
// third-party page) returns a real thumbnail_url given just the video ID,
// no API key needed. Module-level Map, not component state — every
// VideoSlide showing the same Vimeo post (repeats are possible, see
// VIDEO_DEDUP_WINDOW) shares one fetch and one cached result instead of
// each re-fetching independently; failures are cached too (as null) so a
// broken/private video doesn't get re-requested on every render.
const vimeoThumbnailCache = new Map();
export async function fetchVimeoMetadata(vimeoId) {
  if (!vimeoId) return null;
  if (vimeoThumbnailCache.has(vimeoId)) return vimeoThumbnailCache.get(vimeoId);
  const promise = fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${vimeoId}`)}`)
    .then(r => r.ok ? r.json() : null)
    .then(data => data ? { thumbnailUrl: data.thumbnail_url || null, durationSeconds: Number(data.duration) || null } : null)
    .catch(() => null);
  vimeoThumbnailCache.set(vimeoId, promise);
  while (vimeoThumbnailCache.size > 500) vimeoThumbnailCache.delete(vimeoThumbnailCache.keys().next().value);
  const result = await promise;
  if (vimeoThumbnailCache.get(vimeoId) === promise) vimeoThumbnailCache.set(vimeoId, result);
  return result;
}

export async function fetchVimeoThumbnail(vimeoId) {
  return (await fetchVimeoMetadata(vimeoId))?.thumbnailUrl || null;
}

// Direct file playback requires native media or an explicit backend rights flag.
export function isDirectVideoUrl(url, post) {
  return directMediaPlaybackAllowed(post) && !!url && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
}

// A raw <iframe src="youtube.com/embed/..."> has no programmatic control at
// all — no pause, no seek, nothing but what's baked into the URL at mount
// time. Pause + a scrub tracker for YouTube specifically requires the real
// IFrame Player API (window.YT.Player), which needs its script loaded once
// and its "API ready" callback awaited before any player can be constructed.
let youtubeApiPromise = null;
// Set identity and referrer policy before the iframe's first navigation.
// YouTube error 153 means that the embed did not identify its real client.
export function youTubeEmbedUrl(videoId, playerVars = {}) {
  if (!/^[\w-]{11}$/.test(String(videoId || ''))) return '';
  const params = new URLSearchParams({
    playsinline: '1', rel: '0', controls: '1', ...playerVars,
    enablejsapi: '1', origin: window.location.origin,
  });
  return `https://www.youtube.com/embed/${videoId}?${params}`;
}

export function createYouTubePlayerFrame(host, videoId, playerVars = {}, title = 'YouTube video') {
  const frame = document.createElement('iframe');
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.title = title || 'YouTube video';
  frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
  frame.allowFullscreen = true;
  frame.style.cssText = 'width:100%;height:100%;border:0;display:block;pointer-events:auto';
  frame.src = youTubeEmbedUrl(videoId, playerVars);
  host.replaceChildren(frame);
  return frame;
}

export function loadYouTubeIframeApi() {
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) { resolve(window.YT); return; }
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prevCallback?.();
      resolve(window.YT);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    }
  });
  return youtubeApiPromise;
}

// Plays an HLS (.m3u8) stream via hls.js where needed, or natively where the
// browser already supports it (Safari/iOS). Used for Bluesky video — a
// simple <video src="...m3u8"> only works in Safari; everywhere else needs
// hls.js to actually decode the stream.
export function HlsVideoPlayer({ src, poster, autoPlay = true, muted = false, loop = false, controls, onClick, videoRef: externalRef, onTimeUpdate, onLoadedMetadata, onPlay, onPause, onVolumeChange, onError, style }) {
  const videoRef = useRef(null);
  // Callback ref so the caller (VideoFeedView's custom pause/seek controls)
  // can drive the underlying <video> element directly — hls.js attaches to
  // this same element internally, so there's only ever one element to share.
  const setRef = (el) => {
    videoRef.current = el;
    if (externalRef) externalRef.current = el;
  };
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    setErrored(false);
    let hls;
    let cancelled = false;
    // Always START muted — the one autoplay policy every browser reliably
    // allows — then correct to the real desired state (muted prop, itself
    // driven by userWantsSound: has this browser ever seen a direct unmute
    // click before) only once play() has actually resolved, confirming
    // playback genuinely started while still forced-muted. This has to
    // happen here, not just in the [muted]-sync effect below: on the
    // hls.js path (every non-Safari browser — most Android/Chrome mobile),
    // startMuted only runs later, async, inside the MANIFEST_PARSED
    // handler, well after the [muted] effect already ran once at mount.
    // With no correction here, that left the video permanently force-muted
    // regardless of the stored preference, with nothing left to fix it —
    // confirmed live as the actual mechanism behind "keep hitting a muted
    // video" despite having unmuted elsewhere already, and worse: the
    // mute button's displayed "unmuted" state (bound to the muted prop,
    // never actually corrected) went stale, so the next toggle click
    // called rememberSoundPreference with the wrong value and wiped the
    // saved preference entirely.
    function startMuted() {
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.play().then(() => {
        if (videoRef.current) videoRef.current.muted = muted;
      }).catch(() => {});
    }
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari/iOS play HLS natively — no need to pull in hls.js at all.
      video.src = src;
      if (autoPlay) startMuted();
    } else {
      // Lazy-loaded: hls.js is a genuinely large library, and bundling it
      // statically pulled it into every visitor's Feed download (~140KB
      // gzipped extra) whether or not they ever see a video post. Only
      // fetched now when a stream actually needs decoding.
      const fail = () => { setErrored(true); onError?.(); };
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled || !videoRef.current) return;
        if (!Hls.isSupported()) { fail(); return; }
        hls = new Hls();
        hls.loadSource(src);
        hls.attachMedia(videoRef.current);
        hls.on(Hls.Events.ERROR, (_evt, data) => { if (data?.fatal) fail(); });
        if (autoPlay) hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!videoRef.current) return;
          startMuted();
        });
      }).catch(() => fail());
    }
    return () => { cancelled = true; hls?.destroy(); };
  }, [src, autoPlay]);

  // React's `muted` JSX prop on a <video> element doesn't reliably keep the
  // *live* element's property in sync with prop changes after mount (a
  // known gap for media elements specifically) — without this, a caller
  // whose mute button toggles this prop could update their own button icon
  // with nothing actually changing on the element underneath. Imperative
  // and unconditional so it's a plain synchronous property set, not an
  // async one a browser's autoplay policy could second-guess.
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = muted;
  }, [muted]);

  if (errored) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, background: '#000', color: '#fff', fontSize: '.85rem', ...style }}>
        Video unavailable
      </div>
    );
  }
  return (
    <video ref={setRef} controls={controls ?? !onClick} autoPlay={autoPlay} muted={muted} loop={loop}
      playsInline draggable={false} poster={poster} onClick={onClick}
      onTimeUpdate={onTimeUpdate} onLoadedMetadata={onLoadedMetadata} onPlay={onPlay} onPause={onPause} onVolumeChange={onVolumeChange}
      // Catches the Safari-native path (no hls.js involved at all — see the
      // canPlayType branch above) plus any real network/decode error hls.js
      // itself doesn't surface through its own event system.
      onError={() => { setErrored(true); onError?.(); }}
      style={{ width: '100%', display: 'block', background: '#000', ...style }} />
  );
}

// Muted, looping, plays only while actually scrolled into view — used for
// feed-card video previews (Feed.jsx/PostList.jsx), which just need a
// lightweight autoplaying loop, unlike VideoFeedView's full-screen swipe
// slides or ImageLightbox's maximized single-video view, which both have
// their own dedicated play/pause/mute/seek UI. Visibility-gated so a long
// feed with many video posts doesn't try to decode and play all of them at
// once — matches the "only the active slide actually plays" behavior
// VideoFeedView already uses, just triggered by real scroll position
// instead of a swipe-snap container.
export function InlineAutoplayVideo({ kind, src, post, videoKey, poster, style, forcePause = false }) {
  const preferences = useDataPreferences();
  const automaticPlayback = previewPlaybackAllowed(preferences);
  const containerRef = useRef(null);
  const fileRef = useRef(null);
  const [inView, setInView] = useState(false);
  const { playbackAllowed, pointerHandlers } = usePointerPlaybackGate();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) {
      setInView(true);
      return;
    }
    // Was 0.4 — on a small mobile viewport a video box scrolling in doesn't
    // linger at high visibility for long before either settling fully into
    // view or continuing past, so a lower bar means autoplay actually
    // triggers during that transition instead of only once scrolling has
    // essentially already stopped with the video mostly centered.
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.25 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // forcePause is for a card whose media is currently open in ImageLightbox
  // (maximized) — the lightbox starts its own playback of the same file, and
  // this card never actually leaves the viewport when the lightbox opens
  // over it (IntersectionObserver only tracks geometric intersection, not
  // z-index occlusion), so inView alone would keep this copy playing too —
  // audibly doubled if the user has sound on. Kept separate from inView
  // itself so scroll-based visibility and "something else is showing this
  // right now" stay independent, composable signals. Also gated through the
  // shared solo-playback arbiter (see useSoloVideoPlayback) so only the
  // most-recently-scrolled-to video across the whole Feed plays at once.
  const isSolo = useSoloVideoPlayback(videoKey || src, automaticPlayback && inView && playbackAllowed && !forcePause);
  const sourceAllowed = directMediaPlaybackAllowed(post);
  const shouldPlay = sourceAllowed && automaticPlayback && isSolo && !forcePause;

  // Direct-file case drives its own <video> element here; the HLS case
  // (below, in the render) hands autoplay off to HlsVideoPlayer instead,
  // which already primes muted state right before play() and falls back
  // gracefully if a browser still blocks it regardless (same handling
  // ImageLightbox's video playback relies on).
  useEffect(() => {
    if (kind !== 'file') return;
    const v = fileRef.current;
    if (!v) return;
    if (shouldPlay) {
      v.muted = true;
      v.defaultMuted = true;
      v.playsInline = true;
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [shouldPlay, kind]);

  if (!sourceAllowed) return <span style={{ display: 'block', padding: 24, color: '#fff', background: '#111827' }}>Open the original source to watch</span>;
  return (
    <div ref={containerRef} {...pointerHandlers}>
      {preferences.dataSaver ? (
        <div style={{ minHeight: 220, background: '#000', color: '#fff', display: 'grid', placeItems: 'center', ...style }}>
          {poster && <img src={poster} alt="" loading="lazy" style={{ width: '100%', maxHeight: 220, objectFit: 'cover' }} />}
          <span style={{ padding: 16 }}>Open video to play · Data saver is on</span>
        </div>
      ) : kind === 'hls' ? (
        shouldPlay ? (
          <HlsVideoPlayer src={src} poster={null} autoPlay muted loop style={style} />
        ) : (
          <div style={{ minHeight: 220, background: '#000', color: '#fff', display: 'grid', placeItems: 'center', ...style }}>
            {!automaticPlayback && <span style={{ padding: 16 }}>Open video to play</span>}
          </div>
        )
      ) : (
        <video ref={fileRef} src={src} muted loop playsInline preload="metadata" style={style} />
      )}
    </div>
  );
}
