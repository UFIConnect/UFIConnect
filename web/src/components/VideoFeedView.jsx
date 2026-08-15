import { useState, useEffect, useRef, useCallback } from 'react';
import client from '../api/client';
import { extractYouTubeId, deriveBlueskyPlaylistUrl, isDirectVideoUrl, HlsVideoPlayer, loadYouTubeIframeApi } from './videoMedia';
import { SOURCE_META, CONNECTED_SOCIAL_PLATFORMS } from './sourceMeta';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';

// Platforms with no public aggregate fetcher at all (not in SOURCE_CONFIG
// server-side) — pure Connected-Accounts/Following-only identifiers, never
// real entries in the shared Feed-mode video pool. Twitter/LinkedIn/
// Instagram/Facebook do have SOURCE_CONFIG entries, but are still excluded
// here since the aggregate pool itself excludes them (see FEED_SOCIAL_TABS
// server-side) — selecting them in Feed mode would be a guaranteed-empty
// filter either way.
const FEED_ONLY_EXCLUDED_SOURCES = ['uficonnect', 'linkedin', 'twitter', 'instagram', 'facebook', 'tiktok', 'discord', 'dribbble'];
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
  if (ytId) return { kind: 'youtube', id: ytId, poster: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` };
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

function VideoSlide({ post, active, muted, onToggleMute, isScrolling }) {
  const src = resolveVideoSource(post);
  const meta = SOURCE_META[post.source] || SOURCE_META.uficonnect;
  const fileVideoRef = useRef(null);
  const hlsVideoRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const ytMountRef = useRef(null);
  const seekingRef = useRef(false);
  const progressBarRef = useRef(null);

  const [paused, setPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [seeking, setSeeking] = useState(false);

  const getNativeEl = useCallback(() => (src?.kind === 'hls' ? hlsVideoRef.current : fileVideoRef.current), [src?.kind]);

  // file/hls: play on becoming active, pause + rewind on becoming inactive
  // (leaving a video mid-scrub-progress for the next viewer would be
  // confusing — every slide always starts fresh).
  useEffect(() => {
    if (src?.kind === 'youtube') return;
    const v = getNativeEl();
    if (!v) return;
    if (active) {
      // Mobile Safari/Chrome's autoplay policy checks muted state at the
      // moment play() is called, not just the JSX attribute — confirmed
      // this was the gap on mobile specifically (desktop tolerates it).
      // Setting both muted and defaultMuted imperatively right before
      // play() is the reliable fix; playsInline is already set via JSX but
      // reasserted here too since iOS is picky about it being present
      // before playback starts, not just at mount.
      v.muted = muted;
      v.defaultMuted = muted;
      v.playsInline = true;
      v.play().catch(() => {
        // Browser blocked autoplay-with-sound (no qualifying interaction
        // yet, or a stricter mobile policy) — muted autoplay is allowed
        // almost universally, so fall back to that instead of the video
        // just silently never starting. Syncs the shared mute state too, so
        // the mute button and every subsequent slide reflect reality.
        if (!v.muted) {
          v.muted = true;
          onToggleMute?.();
          v.play().catch(() => {});
        }
      });
    } else {
      v.pause(); try { v.currentTime = 0; } catch {} setCurrentTime(0); setPaused(false);
    }
  }, [active, src?.kind, getNativeEl, muted]);

  // youtube: the real IFrame Player API — a raw <iframe src="..."> embed has
  // no programmatic control at all, so pause + a scrub tracker need this
  // instead. Only constructed while active; destroyed on scroll-away.
  useEffect(() => {
    if (src?.kind !== 'youtube' || !active) return;
    let cancelled = false;
    let pollId;
    loadYouTubeIframeApi().then((YT) => {
      if (cancelled || !ytMountRef.current) return;
      const player = new YT.Player(ytMountRef.current, {
        videoId: src.id,
        playerVars: {
          autoplay: 1, mute: muted ? 1 : 0, playsinline: 1, loop: 1,
          controls: 0, modestbranding: 1, rel: 0, playlist: src.id,
        },
        events: {
          onReady: (e) => {
            if (cancelled) return;
            ytPlayerRef.current = e.target;
            setDuration(e.target.getDuration() || 0);
          },
          onStateChange: (e) => {
            if (cancelled) return;
            setPaused(e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED);
            const d = e.target.getDuration();
            if (d) setDuration(d);
          },
        },
      });
      pollId = setInterval(() => {
        if (ytPlayerRef.current && !seekingRef.current) {
          try { setCurrentTime(ytPlayerRef.current.getCurrentTime() || 0); } catch {}
        }
      }, 250);
    });
    return () => {
      cancelled = true;
      clearInterval(pollId);
      try { ytPlayerRef.current?.destroy(); } catch {}
      ytPlayerRef.current = null;
      setCurrentTime(0);
      setDuration(0);
      setPaused(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, src?.kind, src?.id]);

  // Keep an active YouTube player's mute state in sync with the top-bar
  // mute toggle (file/hls just re-render the <video muted> attribute).
  useEffect(() => {
    if (src?.kind !== 'youtube' || !ytPlayerRef.current) return;
    if (muted) ytPlayerRef.current.mute(); else ytPlayerRef.current.unMute();
  }, [muted, src?.kind]);

  // Pause for the duration of an active scroll gesture, deliberately kept
  // separate from the active/inactive effect above: that one owns real
  // slide transitions (play-from-start, pause-and-rewind-to-0 for the next
  // viewer). This one only pauses-in-place and resumes-in-place while
  // scrolling happens to pass over an already-active slide without fully
  // leaving it — no rewind, no re-priming autoplay, just a hold. Declared
  // after the active-effect above so if both fire in the same commit (a
  // fresh slide becomes active while still mid-scroll), this one's pause
  // is what actually lands.
  useEffect(() => {
    if (!active) return;
    if (src?.kind === 'youtube') {
      const p = ytPlayerRef.current;
      if (!p) return;
      if (isScrolling) p.pauseVideo?.(); else p.playVideo?.();
      return;
    }
    const v = getNativeEl();
    if (!v) return;
    if (isScrolling) v.pause();
    else v.play().catch(() => {});
  }, [isScrolling, active, src?.kind, getNativeEl]);

  function togglePlay() {
    if (src?.kind === 'youtube') {
      const p = ytPlayerRef.current;
      if (!p) return;
      if (paused) p.playVideo(); else p.pauseVideo();
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
    const time = fraction * (duration || 0);
    setCurrentTime(time);
    if (src?.kind === 'youtube') {
      ytPlayerRef.current?.seekTo(time, true);
    } else {
      const v = getNativeEl();
      if (v) v.currentTime = time;
    }
  }

  function handleBarPointerDown(e) {
    e.stopPropagation();
    if (!duration) return;
    seekingRef.current = true;
    setSeeking(true);
    seekToFraction(computeFraction(e.clientX));
    const handleMove = (ev) => seekToFraction(computeFraction(ev.clientX));
    const handleUp = () => {
      seekingRef.current = false;
      setSeeking(false);
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
  }

  const progressFraction = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', overflow: 'hidden' }}>
      {!src ? (
        <div style={{ color: '#888', fontSize: '.85rem' }}>🎬 Video unavailable</div>
      ) : src.kind === 'youtube' ? (
        active ? (
          <div style={{ position: 'absolute', inset: 0 }} onClick={togglePlay}>
            <div ref={ytMountRef} style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />
          </div>
        ) : (
          <img src={src.poster} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.85 }} />
        )
      ) : src.kind === 'hls' ? (
        active ? (
          <HlsVideoPlayer src={src.src} poster={src.poster} autoPlay muted={muted} loop
            videoRef={hlsVideoRef} onClick={togglePlay}
            onTimeUpdate={(e) => { if (!seekingRef.current) setCurrentTime(e.target.currentTime); }}
            onLoadedMetadata={(e) => setDuration(e.target.duration || 0)}
            onPlay={() => setPaused(false)} onPause={() => setPaused(true)}
            onMutedFallback={onToggleMute}
            style={{ height: '100%', width: '100%', objectFit: 'contain' }} />
        ) : (
          <img src={src.poster} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.85 }} />
        )
      ) : (
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
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      )}

      {/* Center pause indicator — only visible while actually paused, tap
          anywhere on the video (outside the progress bar) to resume. */}
      {src && paused && (
        <button
          onClick={togglePlay}
          aria-label="Play"
          style={{
            position: 'absolute', inset: 0, margin: 'auto', width: 64, height: 64,
            borderRadius: '50%', background: 'rgba(0,0,0,.45)', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: '1.6rem', cursor: 'pointer', pointerEvents: 'none',
          }}
        >▶</button>
      )}

      {/* Bottom caption overlay */}
      <div style={{
        position: 'absolute', left: 16, right: 76, bottom: 40, color: '#fff',
        textShadow: '0 1px 6px rgba(0,0,0,.7)', pointerEvents: 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: '.8rem', fontWeight: 700 }}>
          <span>{meta.icon}</span>
          <span>{post.sourceLabel || meta.label}</span>
        </div>
        {post.title && (
          <div style={{ fontSize: '.9rem', fontWeight: 600, marginBottom: 4, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {post.title}
          </div>
        )}
        {post.author?.name && <div style={{ fontSize: '.78rem', opacity: 0.85 }}>{post.author.name}</div>}
      </div>

      {/* Scrub tracker — click or drag anywhere on the bar to skip to that
          point in the video. Widens slightly while actively dragging so
          it's easier to hit on touch. */}
      {src && duration > 0 && (
        <div
          ref={progressBarRef}
          onPointerDown={handleBarPointerDown}
          style={{
            position: 'absolute', left: 12, right: 12, bottom: 12,
            height: seeking ? 10 : 4, borderRadius: 4, background: 'rgba(255,255,255,.28)',
            cursor: 'pointer', touchAction: 'none', transition: 'height .12s',
          }}
        >
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4,
            width: `${progressFraction * 100}%`, background: '#fff',
          }} />
          <div style={{
            position: 'absolute', top: '50%', left: `${progressFraction * 100}%`,
            transform: 'translate(-50%, -50%)', width: seeking ? 16 : 11, height: seeking ? 16 : 11,
            borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.5)',
            transition: 'width .12s, height .12s',
          }} />
        </div>
      )}
      {src && duration > 0 && (
        <div style={{
          position: 'absolute', right: 14, bottom: 20, color: '#fff', fontSize: '.65rem',
          fontWeight: 600, textShadow: '0 1px 4px rgba(0,0,0,.7)', pointerEvents: 'none',
        }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
      )}

      {/* Right-side action rail */}
      <div style={{ position: 'absolute', right: 14, bottom: 46, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        {post.likesCount > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: '#fff', textShadow: '0 1px 6px rgba(0,0,0,.7)' }}>
            <span style={{ fontSize: '1.3rem' }}>❤️</span>
            <span style={{ fontSize: '.68rem', fontWeight: 700 }}>{post.likesCount.toLocaleString()}</span>
          </div>
        )}
        {post.sourceUrl && (
          <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: '#fff', textDecoration: 'none' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,.16)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', backdropFilter: 'blur(4px)',
            }}>↗</div>
            <span style={{ fontSize: '.62rem', fontWeight: 600 }}>Open</span>
          </a>
        )}
      </div>
    </div>
  );
}

export default function VideoFeedView({ onExit }) {
  const [videoPosts, setVideoPosts] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  // Starts unmuted (with sound) rather than TikTok's muted-by-default —
  // browsers only block autoplay *with sound* when there's been no user
  // interaction with the page yet, and reaching this view always requires
  // clicking the Videos nav item first, which counts. play() falls back to
  // muted automatically (see VideoSlide) if a browser blocks it anyway, so
  // this never silently fails to play at all.
  const [muted, setMuted] = useState(false);
  const [page, setPage] = useState(1);
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
  // Sent as ?seed= on every request — the backend folds it into this user's
  // rotation offset into the shared video pool (see rotateForUser server-
  // side). Without this, a refresh handed back the exact same rotation of
  // the exact same pool every time, since neither the user nor the still-
  // warm pool changed — regenerated below whenever a fresh page-1 load
  // happens (mount or explicit refresh), left alone for page 2+ so
  // pagination keeps slicing the same rotated view within one sitting.
  const refreshSeedRef = useRef(Math.random().toString(36).slice(2));
  const markKnownId = useCallback((id) => {
    if (!id || knownIds.current.has(id)) return;
    knownIds.current.add(id);
    knownIdsQueue.current.push(id);
    if (knownIdsQueue.current.length > VIDEO_DEDUP_WINDOW) {
      knownIds.current.delete(knownIdsQueue.current.shift());
    }
  }, []);

  const loadPage = useCallback(async (pageNum, { bust = false } = {}) => {
    try {
      if (pageNum === 1) refreshSeedRef.current = Math.random().toString(36).slice(2);
      const mode = viewModeRef.current;
      const src = sourceFilterRef.current;
      let params = `limit=10&page=${pageNum}&seed=${refreshSeedRef.current}${bust ? '&bust=1' : ''}`;
      // Same ?source= (single)/?sources= (multi) convention as the main feed.
      if (src.length === 1) params += `&source=${encodeURIComponent(src[0])}`;
      else if (src.length > 1) params += `&sources=${src.map(encodeURIComponent).join(',')}`;
      // Following's pool is a live per-user query (see getFollowingFeedPosts
      // backend-side), not the cross-user snapshot the aggregate endpoint
      // caches — bust=1 doesn't apply to it, there's nothing to bust.
      const endpoint = mode === 'following' ? '/office/feed/videos/following' : '/office/feed/videos';
      const { data } = await client.get(`${endpoint}?${params}`);
      const incoming = (data.posts || []).filter(p => p?.mediaUrl);
      if (pageNum === 1) {
        // A fresh page-1 load is a full reset (initial mount, or a
        // user-initiated refresh) — the dedup window needs to reset with
        // it, otherwise videos from before a refresh would still count as
        // "recently seen" and suppress legitimately-fresh page-2+ content
        // right after.
        knownIds.current = new Set();
        knownIdsQueue.current = [];
      }
      setVideoPosts(prev => {
        // A flat all-time dedup here used to make infinite scroll dead-end
        // (once a user had scrolled through the whole real pool once, every
        // later page was "all already seen" and got filtered to nothing) —
        // but no dedup at all made the opposite mistake: the server's video
        // pool gets rebuilt periodically, so two page requests straddling a
        // rebuild can hand back overlapping content well before a user has
        // scrolled anywhere near the full pool, which read as duplicate
        // videos appearing in quick succession. A bounded rolling window
        // filters near-term repeats from either cause while still admitting
        // a genuine repeat once it's fallen out of the window. React keys
        // below are still (id + index) since a repeat past the window is
        // still expected eventually.
        const fresh = pageNum === 1 ? incoming : incoming.filter(p => !knownIds.current.has(p.id));
        fresh.forEach(p => markKnownId(p.id));
        // pageNum===1 always replaces wholesale rather than merging — a
        // user-initiated refresh should hand back a clean view instead of
        // old and new videos interleaved indefinitely.
        return pageNum === 1 ? fresh : [...prev, ...fresh];
      });
      setHasMore(data.hasMore !== false && incoming.length > 0);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [markKnownId]);

  useEffect(() => { loadPage(1); }, [loadPage]);

  // Manual refresh — busts the server's cached pool (see VIDEO_FEED_SNAPSHOT_TTL
  // backend-side) and fully replaces the queue with a fresh page 1, same as
  // the main Feed's refresh — the view is already jumping back to the first
  // slide, so there's no "losing your place" cost to a full reset here, and
  // it means refresh actually reads as a refresh instead of old and new
  // videos staying interleaved together indefinitely.
  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setActiveIndex(0);
    setPage(1);
    if (containerRef.current) containerRef.current.scrollTop = 0;
    await loadPage(1, { bust: true });
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
    setPage(1);
    if (containerRef.current) containerRef.current.scrollTop = 0;
    setLoading(true);
    loadPage(1);
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
    setPage(1);
    if (containerRef.current) containerRef.current.scrollTop = 0;
    setLoading(true);
    loadPage(1);
  }, [loadPage]);

  const clearSourceFilter = useCallback(() => {
    if (!sourceFilterRef.current.length) return;
    sourceFilterRef.current = [];
    setSourceFilter([]);
    setActiveIndex(0);
    setPage(1);
    if (containerRef.current) containerRef.current.scrollTop = 0;
    setLoading(true);
    loadPage(1);
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

  // Fetch the next page a couple of slides before actually running out.
  useEffect(() => {
    if (!hasMore || loadingMoreRef.current || loading) return;
    if (activeIndex >= videoPosts.length - 3) {
      loadingMoreRef.current = true;
      const next = page + 1;
      setPage(next);
      loadPage(next).finally(() => { loadingMoreRef.current = false; });
    }
  }, [activeIndex, videoPosts.length, hasMore, loading, page, loadPage]);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onExit(); };
    document.addEventListener('keydown', handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onExit]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: '#000' }}>
      <button onClick={onExit} aria-label="Back to Feed" style={{ position: 'absolute', top: 16, left: 16, ...OVERLAY_BTN_STYLE }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <button
        onClick={handleRefresh}
        disabled={refreshing}
        aria-label="Refresh videos"
        style={{
          position: 'absolute', top: 16, right: 64, ...OVERLAY_BTN_STYLE,
          fontSize: '1.05rem', cursor: refreshing ? 'default' : 'pointer', opacity: refreshing ? 0.6 : 1,
        }}
      >
        <span style={{ display: 'inline-block', animation: refreshing ? 'spin 0.9s linear infinite' : 'none' }}>⟳</span>
      </button>
      <button
        onClick={() => setMuted(m => !m)}
        aria-label={muted ? 'Unmute' : 'Mute'}
        style={{ position: 'absolute', top: 16, right: 16, ...OVERLAY_BTN_STYLE, fontSize: '1.1rem' }}
      >{muted ? '🔇' : '🔊'}</button>

      {/* Feed/Following toggle — same split and reasoning as pages/Feed.jsx's
          view-mode tabs, styled for the dark full-bleed video overlay
          instead of the light page chrome. */}
      <div style={{
        position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
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

      {/* Platform filter — used to be a permanently-visible row of every
          publicly-aggregated source (FEED_VIDEO_SOURCES, ~30 of them)
          floating over the video at all times, which read as visual
          overload on top of an already-full-bleed video. Collapsed into a
          single button that opens a sheet with the full picker instead —
          same set of sources/multi-select behavior (toggleSourceFilter),
          just not permanently on-screen. Following mode uses its own,
          separate source list (FOLLOWING_VIDEO_SOURCES) — an entirely
          different pool from Feed mode's (see getFollowingFeedPosts
          server-side) — the sheet below switches between them based on
          viewMode. */}
      <button
        onClick={() => setFilterOpen(true)}
        aria-label="Filter by platform"
        style={{
          position: 'absolute', top: 62, left: '50%', transform: 'translateX(-50%)',
          zIndex: 10, display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 14px', borderRadius: 18, cursor: 'pointer', whiteSpace: 'nowrap',
          fontWeight: 700, fontSize: '.78rem',
          border: `1px solid ${sourceFilter.length ? '#fff' : 'rgba(255,255,255,.25)'}`,
          background: sourceFilter.length ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.4)',
          backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
          color: '#fff',
        }}
      >
        🎛 Filters{sourceFilter.length > 0 ? ` · ${sourceFilter.length}` : ''}
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
        <div
          ref={containerRef}
          style={{ height: '100%', overflowY: 'auto', scrollSnapType: 'y mandatory', WebkitOverflowScrolling: 'touch' }}
        >
          {videoPosts.map((post, idx) => (
            <div
              // idx included — the pool now legitimately wraps/repeats once
              // real supply runs out (see sliceCircular server-side), so
              // the same post.id can appear more than once in this list.
              key={`${post.id || 'v'}-${idx}`}
              ref={el => { slideRefs.current[idx] = el; }}
              data-idx={idx}
              style={{ height: '100dvh', scrollSnapAlign: 'start', scrollSnapStop: 'always' }}
            >
              <VideoSlide post={post} active={idx === activeIndex} muted={muted} onToggleMute={() => setMuted(m => !m)} isScrolling={isScrolling} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
