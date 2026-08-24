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
// (watch?v=... or youtu.be/...), which is always persisted.
export function extractYouTubeId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

// Same idea as extractYouTubeId, for RSS articles that embed a Vimeo player
// instead (see parseRSSItems' vimeo detection backend-side) — a plain
// numeric ID, recoverable from either the canonical vimeo.com/{id} watch URL
// mediaUrl is normalized to, or a raw player.vimeo.com/video/{id} embed URL.
export function extractVimeoId(url) {
  if (!url) return null;
  const m = String(url).match(/vimeo\.com\/(?:video\/)?(\d+)/);
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
export function InlineAutoplayVideo({ kind, src, videoKey, poster, style, forcePause = false }) {
  const containerRef = useRef(null);
  const fileRef = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
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
  const isSolo = useSoloVideoPlayback(videoKey || src, inView && !forcePause);
  const shouldPlay = isSolo && !forcePause;

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

  return (
    <div ref={containerRef}>
      {kind === 'hls' ? (
        shouldPlay ? (
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
