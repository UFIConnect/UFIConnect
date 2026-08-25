import { useState, useEffect, useRef, useCallback } from 'react';
import client from '../api/client';
import { extractYouTubeId, extractVimeoId, deriveBlueskyPlaylistUrl, isDirectVideoUrl, isYouTubeShortsUrl, HlsVideoPlayer, loadYouTubeIframeApi, userWantsSound, useGlobalMuted } from './videoMedia';
import { SOURCE_META, CONNECTED_SOCIAL_PLATFORMS } from './sourceMeta';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';
import { reportEngaged, reportEngagementSignal } from '../api/engagement';

// A video counts as genuinely watched (as opposed to just scrolled past —
// see api/engagement.js for the view-vs-seen distinction) once playback
// crosses ~3s or ~50% of its length, whichever comes first — long enough
// that a fast scroll-by can't trigger it, short enough that a real
// full-length watch doesn't need to finish for it to register.
const VIDEO_ENGAGED_SECONDS = 3;
const VIDEO_ENGAGED_FRACTION = 0.5;

// Platforms genuinely excluded from the shared Feed-mode video pool.
// uficonnect is native/Following-only by design (a user's own network, not
// an aggregated platform). discord and dribbble have no SOURCE_CONFIG entry
// server-side — no aggregate fetcher exists for either, so including them
// here would just be a permanently-empty filter with no path to fix short
// of building one.
//
// Twitter/LinkedIn/Instagram/Facebook are a different situation from those
// two: they DO have real SOURCE_CONFIG entries (see backend/index.js) — a
// genuine shared, cached, app-level fetcher, architecturally identical to
// every other source — just idling at 0 posts until an app bearer token is
// configured, same as any source having a quiet cycle (see the commit that
// brought them into the aggregate sort/rank pool). Instagram specifically
// is pulled from this filter row for now — it was showing up as a
// selectable platform with nothing behind it, which reads as broken rather
// than quiet. Not worth an app-level Instagram token yet at current
// traffic; the fetcher/SOURCE_CONFIG entry are untouched, so bringing it
// back once that's worth doing is just removing it from this one array.
//
// Either way, this is entirely separate from Following mode's own path for
// these same platforms (FOLLOWING_VIDEO_SOURCES below) — that one is a
// per-user live fetch of a member's own connected account
// (CONNECTED_SOCIAL_SEARCH_FETCHERS/getFollowingFeedPosts), already works
// today independent of any app-level token, and was never gated by this
// exclusion list to begin with.
const FEED_ONLY_EXCLUDED_SOURCES = ['uficonnect', 'discord', 'dribbble', 'instagram'];
// Feed mode's filter row — every publicly-aggregated source, since any of
// them can carry a real video (a dedicated video source like YouTube, a
// direct-file post from Reddit/Mastodon/Bluesky, or an article that embeds
// one — see rssPost/parseRSSItems server-side, which is shared by ~20 RSS
// sources, not just the handful that were originally assumed to be the only
// ones capable of it). Excludes the Following-only sources (native
// UFconnect posts + connected-account platforms with no aggregate
// fetcher), which have their own separate filter row below with a
// different pool entirely.
const FEED_VIDEO_SOURCES = Object.keys(SOURCE_META).filter(k => !FEED_ONLY_EXCLUDED_SOURCES.includes(k));
// Following mode's own filter set — every platform Connected Accounts
// offers (CONNECTED_SOCIAL_PLATFORMS), plus native UFconnect, an entirely
// different pool from FEED_VIDEO_SOURCES above (see getFollowingFeedPosts
// server-side). This used to be hand-limited to LinkedIn/Twitter/
// Instagram/Facebook/TikTok, so a user who'd connected e.g. GitHub or
// Reddit had no way to even select it here. Not every entry has a live
// Following-timeline fetcher wired up yet (see FOLLOWING_SOURCE_FETCHERS/
// CONNECTED_SOCIAL_SEARCH_FETCHERS server-side) — one without a fetcher
// just shows the existing "no videos yet" empty state once selected,
// rather than being left off the picker entirely.
const FOLLOWING_VIDEO_SOURCES = ['uficonnect', ...CONNECTED_SOCIAL_PLATFORMS];

// Figures out how a given post's video can actually be played in-app, per
// platform — the same Bluesky-playlist/direct-file detection ImageLightbox
// uses for a single item, but centralized here since this view needs it for
// every slide, not just one at a time.
function resolveVideoSource(post) {
  // Dedicated YouTube posts carry embedId (or a recoverable sourceUrl); any
  // other source's article can embed a real YouTube video too (see
  // parseRSSItems' video detection backend-side), in which case mediaUrl
  // itself is the watch URL — checked as a fallback so e.g. a YC blog post
  // with an embedded video plays the same way a dedicated YouTube post does.
  const ytId = post.source === 'youtube'
    ? (post.embedId || extractYouTubeId(post.sourceUrl))
    : extractYouTubeId(post.mediaUrl);
  if (ytId) {
    // Real Shorts are persisted with a /shorts/ sourceUrl specifically so
    // this survives the DB round-trip (see isYouTubeShortsUrl's own
    // comment) — a vertical (9:16) video forced into VideoSlide's default
    // 16:9 container renders squeezed, with the video's own thumbnail/
    // title cropped, confirmed live as a Short looking visibly cut off.
    const vertical = isYouTubeShortsUrl(post.source === 'youtube' ? post.sourceUrl : post.mediaUrl);
    return { kind: 'youtube', id: ytId, poster: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`, vertical };
  }
  // Same idea for an article embedding a Vimeo player instead (see
  // parseRSSItems' vimeo detection backend-side) — mediaUrl is the
  // vimeo.com/{id} watch URL. No public thumbnail CDN pattern to borrow
  // like YouTube's i.ytimg.com, so poster stays null.
  const vimeoId = extractVimeoId(post.mediaUrl);
  if (vimeoId) return { kind: 'vimeo', id: vimeoId, poster: null };
  if (post.source === 'bluesky') {
    const playlist = deriveBlueskyPlaylistUrl(post.mediaUrl);
    return playlist ? { kind: 'hls', src: playlist, poster: post.mediaUrl } : null;
  }
  if (isDirectVideoUrl(post.mediaUrl)) {
    return { kind: 'file', src: post.mediaUrl, poster: null };
  }
  return null;
}

// Rolling dedup window for pagination — see the identical constant/reasoning
// in Feed.jsx. Bounded (not all-time) so pagination doesn't dead-end once a
// user has genuinely scrolled past everything the server has, but large
// enough that a normal scroll session never sees a near-term repeat caused
// by the server's video pool being rebuilt mid-session.
const VIDEO_DEDUP_WINDOW = 400;

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
function VideoSlide({ post, active, muted, onToggleMute, isScrolling, onOpenComments, sharedYt }) {
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
  const hasExtraCaption = (post.title?.length || 0) > 80
    || (post.content && post.content.trim() && post.content.trim() !== post.title?.trim());

  // file/hls/vimeo's own fully-local playback state — youtube reads
  // sharedYt instead (see effectivePaused/effectiveDuration/
  // effectiveCurrentTime below), since its player lives in the parent now.
  const [paused, setPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [seeking, setSeeking] = useState(false);

  const getNativeEl = useCallback(() => (src?.kind === 'hls' ? hlsVideoRef.current : fileVideoRef.current), [src?.kind]);

  // What the render/scrub-bar/engagement-tracking below actually read —
  // youtube's real values live on the shared player (see sharedYt, owned
  // by VideoFeedView), everything else keeps reading this slide's own
  // local state exactly as before.
  const isYoutube = src?.kind === 'youtube';
  const effectivePaused = isYoutube ? !!sharedYt?.paused : paused;
  const effectiveDuration = isYoutube ? (sharedYt?.duration || 0) : duration;
  const effectiveCurrentTime = isYoutube ? (sharedYt?.currentTime || 0) : currentTime;

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
      reportEngaged(post.id);
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
      v.play().catch(() => {});
    } else {
      v.pause(); try { v.currentTime = 0; } catch {} setCurrentTime(0); setPaused(false);
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
  }, [active, src?.kind]);

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
    const v = getNativeEl();
    if (!v) return;
    if (isScrolling) v.pause();
    else v.play().catch(() => {});
  }, [isScrolling, active, src?.kind, getNativeEl]);

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

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', overflow: 'hidden' }}>
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
          no-op for kinds with no poster (file). */}
      {src?.poster && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: -1,
          backgroundImage: `url(${src.poster})`,
          backgroundSize: 'cover', backgroundPosition: 'center',
          transform: 'scale(1.15)', filter: 'blur(30px) brightness(0.45)',
        }} />
      )}
      {!src ? (
        <div style={{ color: '#888', fontSize: '.85rem' }}>🎬 Video unavailable</div>
      ) : src.kind === 'youtube' ? (
        active ? (
          // The actual video pixels render via VideoFeedView's own shared
          // overlay now (see sharedYtMountRef there), positioned to match
          // this exact same centered/aspect-ratio box independently — this
          // slide only needs to *not* render anything competing in that
          // spot, letting the backdrop above and the parent's overlay
          // beneath the caption/scrub UI below show through. See
          // VideoFeedView's own top-of-file comment for why the player
          // itself isn't owned per-slide anymore.
          null
        ) : (
          <img src={src.poster} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.85 }} />
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
        active ? (
          // pointerEvents:'none' on the iframe itself makes a tap fall
          // through to this wrapping div's onClick instead of being
          // captured inside the iframe's own document (a click landing on
          // an iframe never bubbles out to the parent page at all) — same
          // click-through technique the shared YouTube overlay already
          // uses, needed here for the same reason: without it, tapping a
          // stalled/blocked Vimeo video to resume it would do nothing.
          <div onClick={togglePlay} style={{ width: '100%', height: '100%' }}>
            <iframe
              ref={vimeoIframeRef}
              src={`https://player.vimeo.com/video/${src.id}?autoplay=1&muted=${userWantsSound() ? 0 : 1}&loop=1&title=0&byline=0&portrait=0&api=1`}
              style={{ width: '100%', height: '100%', border: 'none', display: 'block', pointerEvents: 'none' }}
              allow="autoplay; fullscreen; picture-in-picture"
              title={post.title}
            />
          </div>
        ) : src.poster ? (
          <img src={src.poster} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.85 }} />
        ) : (
          <div style={{ color: '#888', fontSize: '.85rem' }}>🎬 Vimeo video</div>
        )
      ) : src.kind === 'hls' ? (
        active ? (
          <HlsVideoPlayer src={src.src} poster={src.poster} autoPlay muted={muted} loop
            videoRef={hlsVideoRef} onClick={togglePlay}
            onTimeUpdate={(e) => { if (!seekingRef.current) setCurrentTime(e.target.currentTime); }}
            onLoadedMetadata={(e) => setDuration(e.target.duration || 0)}
            onPlay={() => setPaused(false)} onPause={() => setPaused(true)}
            style={{ height: '100%', width: '100%', objectFit: 'contain' }} />
        ) : (
          <img src={src.poster} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.85 }} />
        )
      ) : (
        // cover, not contain: 'file' is the catch-all for an arbitrary
        // direct-linked video URL (see isDirectVideoUrl) with no metadata
        // and — unlike every other kind here — no poster at all
        // (resolveVideoSource sets poster: null for it), so there's no
        // image to build a blurred backdrop from for the letterboxed-gap
        // trick used above. Cropping to fill trades occasional edge
        // framing loss for a guaranteed full-bleed frame, same tradeoff
        // every poster <img> in this file already makes with cover.
        <video
          ref={fileVideoRef}
          src={src.src}
          muted={muted}
          loop
          playsInline
          onClick={togglePlay}
          onTimeUpdate={(e) => { if (!seekingRef.current) setCurrentTime(e.target.currentTime); }}
          onLoadedMetadata={(e) => setDuration(e.target.duration || 0)}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
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

      {/* Bottom caption overlay */}
      <div style={{
        position: 'absolute', zIndex: 2, left: 16, right: 76, bottom: 40, color: '#fff',
        textShadow: '0 1px 6px rgba(0,0,0,.7)', pointerEvents: 'none',
        maxHeight: captionExpanded ? '55dvh' : undefined,
        overflowY: captionExpanded ? 'auto' : undefined,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: '.8rem', fontWeight: 700 }}>
          <span>{meta.icon}</span>
          <span>{post.sourceLabel || meta.label}</span>
        </div>
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
        {captionExpanded && post.content && post.content.trim() !== post.title?.trim() && (
          <div style={{ fontSize: '.82rem', lineHeight: 1.5, marginBottom: 6, whiteSpace: 'pre-wrap', opacity: 0.92 }}>
            {post.content}
          </div>
        )}
        {hasExtraCaption && (
          <button
            onClick={(e) => { e.stopPropagation(); setCaptionExpanded(x => !x); }}
            style={{
              background: 'none', border: 'none', color: '#fff', fontWeight: 700,
              fontSize: '.78rem', padding: 0, marginBottom: 6, cursor: 'pointer', pointerEvents: 'auto',
              opacity: 0.9,
            }}
          >
            {captionExpanded ? 'Show less' : 'Read more'}
          </button>
        )}
        {post.author?.name && <div style={{ fontSize: '.78rem', opacity: 0.85 }}>{post.author.name}</div>}
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
          ref={progressBarRef}
          onPointerDown={handleBarPointerDown}
          style={{
            position: 'absolute', zIndex: 2, left: 12, right: 12, bottom: 12,
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
          position: 'absolute', zIndex: 2, right: 14, bottom: 20, color: '#fff', fontSize: '.65rem',
          fontWeight: 600, textShadow: '0 1px 4px rgba(0,0,0,.7)', pointerEvents: 'none',
        }}>
          {formatTime(effectiveCurrentTime)} / {formatTime(effectiveDuration)}
        </div>
      )}

      {/* Right-side action rail */}
      <div style={{ position: 'absolute', zIndex: 2, right: 14, bottom: 46, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        <button
          onClick={(e) => { e.stopPropagation(); onOpenComments?.(post); }}
          style={{
            all: 'unset', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            color: '#fff', textShadow: '0 1px 6px rgba(0,0,0,.7)', cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: '1.3rem' }}>💬</span>
          <span style={{ fontSize: '.68rem', fontWeight: 700 }}>{post.commentsCount > 0 ? post.commentsCount.toLocaleString() : 'Comments'}</span>
        </button>
        {post.likesCount > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: '#fff', textShadow: '0 1px 6px rgba(0,0,0,.7)' }}>
            <span style={{ fontSize: '1.3rem' }}>🤍</span>
            <span style={{ fontSize: '.68rem', fontWeight: 700 }}>{post.likesCount.toLocaleString()}</span>
          </div>
        )}
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setComments(null);
    client.get(`/feed/${encodeURIComponent(post.id)}/comments`)
      .then(({ data }) => {
        if (cancelled) return;
        setComments(data.comments || []);
        setLive(!!data.live);
        setHasMore(!!data.hasMore);
      })
      .catch(() => { if (!cancelled) setComments([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [post.id]);

  async function loadMore() {
    if (loadingMore || !comments) return;
    setLoadingMore(true);
    try {
      const { data } = await client.get(`/feed/${encodeURIComponent(post.id)}/comments`, {
        params: { offset: comments.length },
      });
      setComments(prev => [...(prev || []), ...(data.comments || [])]);
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
  // Whether the platform-filter sheet (opened from the "Filters" button) is
  // showing — see its render block below for why this replaced an
  // always-visible chip row.
  const [filterOpen, setFilterOpen] = useState(false);
  // Mirrors state into refs so loadPage (called from effects/callbacks that
  // don't want to be redeclared on every mode/filter change) always reads
  // the current value instead of whatever was captured at its own creation —
  // same pattern as refreshSeedRef below and viewModeRef in pages/Feed.jsx.
  const viewModeRef = useRef('feed');
  const sourceFilterRef = useRef([]);
  const containerRef = useRef(null);
  const slideRefs = useRef([]);
  const loadingMoreRef = useRef(false);
  // Bounded rolling dedup — see VIDEO_DEDUP_WINDOW. Set for O(1) lookups,
  // paired with an array for FIFO eviction (Sets iterate in insertion
  // order, so the array is only needed to know what to evict, mirroring
  // the backend's seenPostIds/seenPostIdQueue pattern).
  const knownIds = useRef(new Set());
  const knownIdsQueue = useRef([]);
  // Feed mode: opaque date-cursor from the backend (see getCursorFeedPage
  // server-side) — null means "start from now." Following mode still pages
  // by number (getFollowingFeedPosts is a live per-user query with no
  // cursor of its own), tracked separately since the two modes pull from
  // entirely different endpoints/pools (see switchViewMode).
  const cursorRef = useRef(null);
  const followingPageRef = useRef(1);
  const markKnownId = useCallback((id) => {
    if (!id || knownIds.current.has(id)) return;
    knownIds.current.add(id);
    knownIdsQueue.current.push(id);
    if (knownIdsQueue.current.length > VIDEO_DEDUP_WINDOW) {
      knownIds.current.delete(knownIdsQueue.current.shift());
    }
  }, []);

  const loadPage = useCallback(async ({ reset = false, bust = false } = {}) => {
    try {
      const mode = viewModeRef.current;
      const src = sourceFilterRef.current;
      let params = `limit=10`;
      // Same ?source= (single)/?sources= (multi) convention as the main feed.
      if (src.length === 1) params += `&source=${encodeURIComponent(src[0])}`;
      else if (src.length > 1) params += `&sources=${src.map(encodeURIComponent).join(',')}`;
      let endpoint;
      if (mode === 'following') {
        if (reset) followingPageRef.current = 1;
        params += `&page=${followingPageRef.current}`;
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
      const incoming = (data.posts || []).filter(p => p?.mediaUrl);
      if (reset) {
        // A reset (initial mount, mode/filter switch, or a user-initiated
        // refresh) needs the dedup window to reset with it, otherwise
        // videos from before the reset would still count as "recently
        // seen" and suppress legitimately-fresh content right after.
        knownIds.current = new Set();
        knownIdsQueue.current = [];
      }
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
        // eventually, especially now that Following mode can still lap its
        // own smaller pool.
        const fresh = reset ? incoming : incoming.filter(p => !knownIds.current.has(p.id));
        fresh.forEach(p => markKnownId(p.id));
        // A reset always replaces wholesale rather than merging — a
        // user-initiated refresh should hand back a clean view instead of
        // old and new videos interleaved indefinitely.
        return reset ? fresh : [...prev, ...fresh];
      });
      if (mode === 'following') followingPageRef.current += 1;
      else if (data.cursor) cursorRef.current = data.cursor;
      setHasMore(data.hasMore !== false && incoming.length > 0);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [markKnownId]);

  useEffect(() => { loadPage({ reset: true }); }, [loadPage]);

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

  // Scrolling back up to video 1 after having scrolled further in acts as
  // pull-to-refresh, same mechanism as every other list on the site — no
  // separate touch-drag handling needed since the snap-scroll container
  // already reports scrollTop the same way a normal list would.
  useScrollToRefresh(handleRefresh, { containerRef, enabled: !loading });

  // Which slide is centered in the scroll-snap container is "active" — that's
  // the only one that actually mounts a player, so scrolling past a video
  // stops it exactly like swiping away in TikTok.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
          const idx = Number(entry.target.dataset.idx);
          if (!Number.isNaN(idx)) setActiveIndex(idx);
        }
      });
    }, { root: container, threshold: [0.6] });
    slideRefs.current.forEach(el => el && observer.observe(el));
    return () => observer.disconnect();
  }, [videoPosts.length]);

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
    const handleScroll = () => {
      setIsScrolling(true);
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => setIsScrolling(false), 150);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      clearTimeout(settleTimer);
    };
  }, [videoPosts.length]);

  // Mouse click-and-drag scrolling — touch already gets this for free (the
  // browser turns a finger drag into a real scroll on a touch device), but
  // a mouse drag over a plain overflow:auto container does nothing by
  // default; the browser instead tries to *select text*, which is exactly
  // what showed up as a stray text-caret cursor over the video on desktop
  // and why nothing advanced when dragging with a mouse there. Gated to
  // pointerType==='mouse' specifically so this never double-handles an
  // actual touchscreen's native scroll, and skipped entirely when the drag
  // starts on a real control (button/link) so click targets like mute/
  // comments/back keep working normally for mouse users. scroll-snap
  // (already on the container) takes over on release exactly like it does
  // after a wheel scroll, settling on the nearest slide without any extra
  // code here.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    function handlePointerDown(e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if (e.target.closest('button, a, [role="button"]')) return;
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
    return () => container.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  // Fetch the next page a couple of slides before actually running out.
  useEffect(() => {
    if (!hasMore || loadingMoreRef.current || loading) return;
    if (activeIndex >= videoPosts.length - 3) {
      loadingMoreRef.current = true;
      loadPage({}).finally(() => { loadingMoreRef.current = false; });
    }
  }, [activeIndex, videoPosts.length, hasMore, loading, loadPage]);

  useLockBodyScroll();

  // Vimeo is a plain iframe with no postMessage control layer (see
  // VideoSlide's own vimeo render branch) — this shared button can't
  // actually change its audio once mounted, only the `muted` state
  // file/hls/youtube slides read. Toggling it while looking at a Vimeo
  // slide would silently do nothing but still look like it worked, which
  // is worse than being upfront that it's not controllable here — dimmed
  // and inert instead, rather than a false control. Computed here (moved
  // up from just above the render) since the shared YouTube player effect
  // below needs it too.
  const activeSrc = resolveVideoSource(videoPosts[activeIndex] || {});
  const muteControllable = activeSrc?.kind !== 'vimeo';

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
  const sharedYtMountRef = useRef(null);
  const sharedYtPlayerRef = useRef(null);
  const sharedYtLoadedIdRef = useRef(null);
  const sharedYtSeekingRef = useRef(false);
  const [sharedYt, setSharedYt] = useState({ paused: false, duration: 0, currentTime: 0, failed: false });

  useEffect(() => {
    if (activeSrc?.kind !== 'youtube') {
      // Not the one on screen right now — pause it in place (don't
      // destroy) so it isn't still decoding/audible off-screen, but stays
      // ready to resume instantly if the user scrolls back to it.
      try { sharedYtPlayerRef.current?.pauseVideo(); } catch {}
      return;
    }
    let cancelled = false;
    let pollId, autoplayRetryId, readyTimeout;
    const videoId = activeSrc.id;
    const startUnmuted = !muted;
    setSharedYt(s => ({ ...s, failed: false }));

    // Retries playVideo() a few times before giving up — a single blocked/
    // timed-out attempt isn't necessarily final (the player can still be
    // settling internally right after onReady/loadVideoById), so hitting
    // it again a couple of times over ~1.5s recovers autoplay in cases
    // where one call alone wouldn't have. Only once every retry still
    // shows it not actually playing does this surface the tap-to-play UI.
    function startAutoplayRetry(player) {
      let attempts = 0;
      autoplayRetryId = setInterval(() => {
        if (cancelled) { clearInterval(autoplayRetryId); return; }
        attempts++;
        try {
          if (player.getPlayerState() === 1) { clearInterval(autoplayRetryId); return; }
          if (attempts >= 3) {
            clearInterval(autoplayRetryId);
            setSharedYt(s => ({ ...s, paused: true }));
            return;
          }
          player.playVideo();
        } catch { clearInterval(autoplayRetryId); }
      }, 500);
    }

    if (sharedYtPlayerRef.current) {
      // Player already exists (from an earlier slide) — reuse the same
      // iframe instead of destroying and rebuilding it, whether this is a
      // genuinely new video or scrolling back to one already loaded.
      const player = sharedYtPlayerRef.current;
      try {
        if (sharedYtLoadedIdRef.current !== videoId) {
          sharedYtLoadedIdRef.current = videoId;
          // Duration/currentTime otherwise keep showing the PREVIOUS
          // video's values until the next onStateChange event happens to
          // fire — confirmed live as the scrub bar/time readout briefly
          // (sometimes for a couple seconds) reporting the wrong length
          // right after scrolling to a new YouTube video. Zeroing here
          // hides the scrub bar/time text for that split second instead
          // (see effectiveDuration > 0 guards below) rather than show a
          // number that's flat wrong; the poll below repopulates the real
          // value continuously once it's available, not just on the next
          // state-change event.
          setSharedYt(s => ({ ...s, duration: 0, currentTime: 0 }));
          player.loadVideoById(videoId);
          if (startUnmuted) player.unMute(); else player.mute();
        }
        player.playVideo();
        startAutoplayRetry(player);
      } catch {}
    } else {
      // First time this session actually needing a YouTube player.
      readyTimeout = setTimeout(() => { if (!cancelled) setSharedYt(s => ({ ...s, failed: true })); }, 6000);
      loadYouTubeIframeApi().then((YT) => {
        if (cancelled || !sharedYtMountRef.current) return;
        new YT.Player(sharedYtMountRef.current, {
          videoId,
          playerVars: {
            autoplay: 1, mute: 1, playsinline: 1, loop: 1,
            controls: 0, modestbranding: 1, rel: 0, playlist: videoId,
            origin: window.location.origin,
          },
          events: {
            onReady: (e) => {
              if (cancelled) return;
              clearTimeout(readyTimeout);
              sharedYtPlayerRef.current = e.target;
              sharedYtLoadedIdRef.current = videoId;
              setSharedYt(s => ({ ...s, duration: e.target.getDuration() || 0 }));
              if (startUnmuted) e.target.unMute();
              e.target.playVideo();
              startAutoplayRetry(e.target);
            },
            onStateChange: (e) => {
              if (cancelled) return;
              setSharedYt(s => ({ ...s, paused: e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED }));
              const d = e.target.getDuration();
              if (d) setSharedYt(s => ({ ...s, duration: d }));
            },
            onError: () => { if (!cancelled) setSharedYt(s => ({ ...s, failed: true })); },
          },
        });
      }).catch(() => { if (!cancelled) setSharedYt(s => ({ ...s, failed: true })); });
    }

    pollId = setInterval(() => {
      if (sharedYtPlayerRef.current && !sharedYtSeekingRef.current) {
        try {
          const p = sharedYtPlayerRef.current;
          const ct = p.getCurrentTime() || 0;
          // Polled alongside currentTime, not just read once in onReady/
          // onStateChange — getDuration() can lag right after
          // loadVideoById() (metadata not parsed yet) or that event can be
          // slow/skipped in edge cases, and unlike currentTime it had no
          // other path back to a correct value. Polling makes it self-
          // correcting on the same cadence currentTime already relies on.
          const d = p.getDuration() || 0;
          setSharedYt(s => (s.currentTime === ct && s.duration === d) ? s : { ...s, currentTime: ct, duration: d });
        } catch {}
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(readyTimeout);
      clearInterval(pollId);
      clearInterval(autoplayRetryId);
      // Deliberately NOT destroying sharedYtPlayerRef.current — see this
      // effect's own top comment. Pausing (the early-return branch above)
      // is the only thing that actually stops it; staying alive across
      // switches is the entire point.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, activeSrc?.kind, activeSrc?.id]);

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
  const row2Safe = 'calc(64px + env(safe-area-inset-top, 0px))';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'radial-gradient(ellipse 80% 60% at 50% 40%, #181818 0%, #000 70%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
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
      <div className="video-feed-frame" style={{ position: 'relative', height: '100%', width: '100%' }}>
      {/* Row 1 is icon buttons ONLY (back / refresh / mute) — the
          Feed/Following toggle used to sit in this same row, centered, and
          on real mobile widths its pill was wide enough to visually and
          functionally overlap the refresh button's position. Both were
          painting at the same z-index, and the toggle rendered later in the
          DOM, so it silently won every tap meant for refresh (and
          sometimes mute) — confirmed as exactly "can't click mute or
          refresh." Moving the toggle to its own row below removes any way
          for that overlap to happen again, rather than tuning positions
          closer together and hoping. */}
      <button onClick={onExit} aria-label="Back to Feed" style={{ position: 'absolute', top: topSafe, left: 16, ...OVERLAY_BTN_STYLE }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <button
        onClick={handleRefresh}
        disabled={refreshing}
        aria-label="Refresh videos"
        style={{
          position: 'absolute', top: topSafe, right: 64, ...OVERLAY_BTN_STYLE,
          fontSize: '1.05rem', cursor: refreshing ? 'default' : 'pointer', opacity: refreshing ? 0.6 : 1,
        }}
      >
        <span style={{ display: 'inline-block', animation: refreshing ? 'spin 0.9s linear infinite' : 'none' }}>⟳</span>
      </button>
      <button
        onClick={() => { if (!muteControllable) return; toggleMuted(); }}
        disabled={!muteControllable}
        aria-label={muteControllable ? (muted ? 'Unmute' : 'Mute') : 'This video uses its own built-in volume control'}
        style={{
          position: 'absolute', top: topSafe, right: 16, ...OVERLAY_BTN_STYLE, fontSize: '1.1rem',
          opacity: muteControllable ? 1 : 0.35, cursor: muteControllable ? 'pointer' : 'default',
        }}
      >{muted ? '🔇' : '🔊'}</button>

      {/* Row 2: Feed/Following toggle — same split and reasoning as
          pages/Feed.jsx's view-mode tabs, styled for the dark full-bleed
          video overlay instead of the light page chrome. Own row now (see
          row-1 comment above), so its content-dependent width can never
          collide with the fixed-position icon buttons above it regardless
          of device width or which label ("Following" vs "Feed") is
          currently longer. */}
      <div style={{
        position: 'absolute', top: row2Safe, left: '50%', transform: 'translateX(-50%)',
        zIndex: 10, display: 'flex', gap: 6,
        background: 'rgba(0,0,0,.4)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,.18)', borderRadius: 20, padding: 3,
      }}>
        {[{ key: 'feed', label: 'Feed' }, { key: 'following', label: 'Following' }].map(({ key, label }) => {
          const active = viewMode === key;
          return (
            <button
              key={key}
              onClick={() => switchViewMode(key)}
              style={{
                padding: '6px 14px', borderRadius: 17, border: 'none', cursor: 'pointer',
                fontWeight: 700, fontSize: '.78rem',
                background: active ? '#fff' : 'transparent',
                color: active ? '#000' : '#fff',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Row 3: Platform filter — used to be a permanently-visible row of
          every publicly-aggregated source (FEED_VIDEO_SOURCES, ~30 of them)
          floating over the video at all times, which read as visual
          overload on top of an already-full-bleed video. Collapsed into a
          single button that opens a sheet with the full picker instead —
          same set of sources/multi-select behavior (toggleSourceFilter),
          just not permanently on-screen. Following mode uses its own,
          separate source list (FOLLOWING_VIDEO_SOURCES) — an entirely
          different pool from Feed mode's (see getFollowingFeedPosts
          server-side) — the sheet below switches between them based on
          viewMode. Own row below the toggle (was row 2, sharing space with
          it) for the same no-overlap reasoning as above. */}
      <button
        onClick={() => setFilterOpen(true)}
        aria-label="Filter by platform"
        style={{
          position: 'absolute', top: `calc(${row2Safe} + 46px)`, left: '50%', transform: 'translateX(-50%)',
          zIndex: 10, display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 14px', borderRadius: 18, cursor: 'pointer', whiteSpace: 'nowrap',
          fontWeight: 700, fontSize: '.78rem',
          border: `1px solid ${sourceFilter.length ? '#fff' : 'rgba(255,255,255,.25)'}`,
          background: sourceFilter.length ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.4)',
          backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
          color: '#fff',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="6" x2="20" y2="6" /><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
          <line x1="4" y1="12" x2="20" y2="12" /><circle cx="16" cy="12" r="2" fill="currentColor" stroke="none" />
          <line x1="4" y1="18" x2="20" y2="18" /><circle cx="11" cy="18" r="2" fill="currentColor" stroke="none" />
        </svg>
        Filters{sourceFilter.length > 0 ? ` · ${sourceFilter.length}` : ''}
      </button>

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
            width: '100%', maxWidth: 540, maxHeight: '72vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 -4px 32px rgba(0,0,0,.4)',
          }}>
            <div style={{ padding: '12px 20px 0', textAlign: 'center', flexShrink: 0 }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.25)', margin: '0 auto 14px' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Filter by platform</h2>
                <button
                  onClick={() => setFilterOpen(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.3rem', color: 'rgba(255,255,255,.6)', lineHeight: 1 }}
                >×</button>
              </div>
            </div>
            <div style={{ overflowY: 'auto', padding: '0 20px 16px', flex: 1, display: 'flex', flexWrap: 'wrap', gap: 8, alignContent: 'flex-start' }}>
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
                    <span>{meta.icon}</span>{meta.label || key}
                  </button>
                );
              })}
            </div>
            <div style={{ padding: '10px 20px 18px', display: 'flex', gap: 10, borderTop: '1px solid rgba(255,255,255,.12)', flexShrink: 0 }}>
              <button
                onClick={clearSourceFilter}
                disabled={sourceFilter.length === 0}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 10, marginTop: 10,
                  border: '1px solid rgba(255,255,255,.25)', background: 'transparent',
                  color: sourceFilter.length === 0 ? 'rgba(255,255,255,.35)' : '#fff',
                  fontWeight: 700, fontSize: '.85rem', cursor: sourceFilter.length === 0 ? 'default' : 'pointer',
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

      {loading ? (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '.9rem' }}>
          Loading videos…
        </div>
      ) : error || videoPosts.length === 0 ? (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', gap: 14, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: '2.2rem' }}>🎬</div>
          <div style={{ fontSize: '.9rem', opacity: 0.85, maxWidth: 280 }}>
            {error
              ? "Couldn't load videos right now."
              : viewMode === 'following'
                ? 'No videos yet from people you follow — try a different platform filter, or check back once they post.'
                : 'No videos yet — check back soon as more platforms post video content.'}
          </div>
          <button onClick={onExit} className="btn btn-primary btn-sm">Back to Feed</button>
        </div>
      ) : (
        <>
        <div
          ref={containerRef}
          // userSelect:'none' is also what actually answers "get rid of the
          // text cursor" (a real OS text-caret icon can't be recolored from
          // CSS) — with nothing in this view selectable, the browser has no
          // reason to ever show it over the likes count/source label/
          // caption text, so it never appears in the first place rather
          // than needing to be hidden after the fact. cursor:'grab' is a
          // no-op on touch (nothing renders a cursor there) and hints the
          // click-and-drag scrolling above on desktop; the drag handler
          // itself swaps it to 'grabbing' for the duration of an actual drag.
          style={{
            height: '100%', overflowY: 'auto', scrollSnapType: 'y mandatory', WebkitOverflowScrolling: 'touch',
            userSelect: 'none', cursor: 'grab',
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
              <VideoSlide
                post={post}
                active={idx === activeIndex}
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
                } : undefined}
              />
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
        <div style={{
          position: 'absolute', inset: 0, zIndex: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
          opacity: (activeSrc?.kind === 'youtube' && !isScrolling) ? 1 : 0,
          transition: 'opacity .15s ease-out',
        }}>
          <div
            // width/height:auto (not width:100%) is what makes this
            // actually fit inside BOTH constraints at once. With an
            // explicit width:100% + maxHeight:100%, a 9:16 video whose
            // derived height (from 100% width) exceeds the box's available
            // height gets its height clamped by maxHeight while the width
            // stays put — the box ends up wider, relative to its height,
            // than the real 9:16 ratio, visibly stretching the video. Now
            // that the frame itself is width *and* height capped on
            // desktop/tablet (see index.css), height is often the tighter
            // constraint, not width, so this wasn't just a theoretical
            // edge case. auto/auto + max-width/max-height lets the browser
            // pick the largest size that satisfies both limits while
            // holding the real aspect ratio, the same guarantee object-fit:
            // contain gives a native <video> (which a cross-origin YouTube
            // iframe can't use directly, hence needing this on its wrapper
            // instead).
            style={{
              width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%',
              aspectRatio: activeSrc?.vertical ? '9/16' : '16/9',
              position: 'relative', pointerEvents: activeSrc?.kind === 'youtube' ? 'auto' : 'none',
            }}
            onClick={sharedYtTogglePlay}
          >
            <div ref={sharedYtMountRef} style={{ width: '100%', height: '100%', pointerEvents: 'none', visibility: sharedYt.failed ? 'hidden' : 'visible' }} />
            {sharedYt.failed && activeSrc?.kind === 'youtube' && (
              // Same reasoning as the old per-slide fallback: the IFrame
              // Player API script never went ready (blocked, offline,
              // slow network) — a plain embed iframe doesn't load that
              // script at all and still autoplays muted on its own.
              <iframe
                src={`https://www.youtube.com/embed/${activeSrc.id}?autoplay=1&mute=${userWantsSound() ? 0 : 1}&playsinline=1&loop=1&playlist=${activeSrc.id}&controls=1&modestbranding=1&rel=0`}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', display: 'block' }}
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
