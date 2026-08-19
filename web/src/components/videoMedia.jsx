import { useEffect, useRef, useState } from 'react';

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
export function userWantsSound() {
  try { return localStorage.getItem(SOUND_PREF_KEY) === '1'; } catch { return false; }
}
export function rememberSoundPreference(wantsSound) {
  try {
    if (wantsSound) localStorage.setItem(SOUND_PREF_KEY, '1');
    else localStorage.removeItem(SOUND_PREF_KEY);
  } catch {}
}

// embedId (the YouTube video ID used for in-app iframe playback) only ever
// existed on the live/in-memory post shape — feed_posts_cache has no column
// for it, so any YouTube post served from the database (the primary path
// for most of the feed now) arrived with no way to actually play the video,
// only a thumbnail + an external link. It's recoverable from sourceUrl
// (watch?v=... or youtu.be/...), which is always persisted.
export function extractYouTubeId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

// Bluesky video posts store the HLS playlist URL and its thumbnail at the
// same path, differing only in filename (.../thumbnail.jpg vs
// .../playlist.m3u8) — mediaUrl only ever holds the thumbnail (the DB
// column it persists through already existed; a separate stream-url column
// didn't), so the playlist URL is recovered by swapping the filename.
export function deriveBlueskyPlaylistUrl(thumbnailUrl) {
  if (!thumbnailUrl || !thumbnailUrl.includes('/thumbnail.')) return null;
  return thumbnailUrl.replace(/\/thumbnail\.[a-z0-9]+(\?.*)?$/i, '/playlist.m3u8');
}

// Reddit/Mastodon (and any other source) can store a direct, already-playable
// video file URL in mediaUrl rather than a poster image — no separate
// thumbnail exists, so this URL needs a plain <video> element, not an <img>.
export function isDirectVideoUrl(url) {
  return !!url && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
}

// A raw <iframe src="youtube.com/embed/..."> has no programmatic control at
// all — no pause, no seek, nothing but what's baked into the URL at mount
// time. Pause + a scrub tracker for YouTube specifically requires the real
// IFrame Player API (window.YT.Player), which needs its script loaded once
// and its "API ready" callback awaited before any player can be constructed.
let youtubeApiPromise = null;
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
export function HlsVideoPlayer({ src, poster, autoPlay = true, muted = false, loop = false, onClick, videoRef: externalRef, onTimeUpdate, onLoadedMetadata, onPlay, onPause, style }) {
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
    // Always start muted and stay muted — the one autoplay policy every
    // browser reliably allows. This used to reveal sound right after play()
    // resolved if the caller wanted it unmuted, but that reveal is a
    // delayed, asynchronous `.muted = false` write, not the direct,
    // synchronous result of a user gesture — Safari in particular can
    // silently accept the property write (so `.muted` correctly reads back
    // false, and any UI bound to it shows "unmuted") while still refusing
    // to actually output audio, which is exactly what "shows unmuted but no
    // voice is playing" looks like from the outside. The caller's own mute
    // button is what actually unmutes now (see the effect below), since a
    // direct click handler is a gesture every browser honors.
    function startMuted() {
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.play().catch(() => {});
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
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled || !videoRef.current) return;
        if (!Hls.isSupported()) { setErrored(true); return; }
        hls = new Hls();
        hls.loadSource(src);
        hls.attachMedia(videoRef.current);
        hls.on(Hls.Events.ERROR, (_evt, data) => { if (data?.fatal) setErrored(true); });
        if (autoPlay) hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!videoRef.current) return;
          startMuted();
        });
      }).catch(() => setErrored(true));
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
        🎬 Video unavailable
      </div>
    );
  }
  return (
    <video ref={setRef} controls={!onClick} autoPlay={autoPlay} muted={muted} loop={loop}
      playsInline poster={poster} onClick={onClick}
      onTimeUpdate={onTimeUpdate} onLoadedMetadata={onLoadedMetadata} onPlay={onPlay} onPause={onPause}
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
export function InlineAutoplayVideo({ kind, src, poster, style }) {
  const containerRef = useRef(null);
  const fileRef = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.4 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Direct-file case drives its own <video> element here; the HLS case
  // (below, in the render) hands autoplay off to HlsVideoPlayer instead,
  // which already primes muted state right before play() and falls back
  // gracefully if a browser still blocks it regardless (same handling
  // ImageLightbox's video playback relies on).
  useEffect(() => {
    if (kind !== 'file') return;
    const v = fileRef.current;
    if (!v) return;
    if (inView) {
      v.muted = true;
      v.defaultMuted = true;
      v.playsInline = true;
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [inView, kind]);

  return (
    <div ref={containerRef}>
      {kind === 'hls' ? (
        inView ? (
          <HlsVideoPlayer src={src} poster={poster} autoPlay muted loop style={style} />
        ) : (
          <img src={poster} alt="" style={style} />
        )
      ) : (
        <video ref={fileRef} src={src} muted loop playsInline preload="metadata" style={style} />
      )}
    </div>
  );
}
