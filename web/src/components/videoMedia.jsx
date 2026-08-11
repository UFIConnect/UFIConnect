import { useEffect, useRef, useState } from 'react';

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
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari/iOS play HLS natively — no need to pull in hls.js at all.
      video.src = src;
      if (autoPlay) video.play().catch(() => {});
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
        if (autoPlay) hls.on(Hls.Events.MANIFEST_PARSED, () => videoRef.current?.play().catch(() => {}));
      }).catch(() => setErrored(true));
    }
    return () => { cancelled = true; hls?.destroy(); };
  }, [src, autoPlay]);

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
