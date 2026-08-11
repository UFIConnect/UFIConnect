import { useState, useEffect, useRef, useCallback } from 'react';
import client from '../api/client';
import { extractYouTubeId, deriveBlueskyPlaylistUrl, isDirectVideoUrl, HlsVideoPlayer, loadYouTubeIframeApi } from './videoMedia';
import { SOURCE_META } from './sourceMeta';

// Figures out how a given post's video can actually be played in-app, per
// platform — mirrors the logic in Feed.jsx's VideoModal, but centralized
// here since this view needs it for every slide, not just an on-demand modal.
function resolveVideoSource(post) {
  if (post.source === 'youtube') {
    const id = post.embedId || extractYouTubeId(post.sourceUrl);
    return id ? { kind: 'youtube', id, poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } : null;
  }
  if (post.source === 'bluesky') {
    const playlist = deriveBlueskyPlaylistUrl(post.mediaUrl);
    return playlist ? { kind: 'hls', src: playlist, poster: post.mediaUrl } : null;
  }
  if (isDirectVideoUrl(post.mediaUrl)) {
    return { kind: 'file', src: post.mediaUrl, poster: null };
  }
  return null;
}

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function VideoSlide({ post, active, muted, onToggleMute }) {
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
    if (active) { v.play().catch(() => {}); }
    else { v.pause(); try { v.currentTime = 0; } catch {} setCurrentTime(0); setPaused(false); }
  }, [active, src?.kind, getNativeEl]);

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
  const [muted, setMuted] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const containerRef = useRef(null);
  const slideRefs = useRef([]);
  const loadingMoreRef = useRef(false);

  const loadPage = useCallback(async (pageNum) => {
    try {
      const { data } = await client.get(`/office/feed/videos?limit=10&page=${pageNum}`);
      const incoming = (data.posts || []).filter(p => p?.mediaUrl);
      setVideoPosts(prev => {
        if (pageNum === 1) return incoming;
        const seen = new Set(prev.map(p => p.id));
        return [...prev, ...incoming.filter(p => !seen.has(p.id))];
      });
      setHasMore(data.hasMore !== false && incoming.length > 0);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPage(1); }, [loadPage]);

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
      <button onClick={onExit} aria-label="Back to Feed" style={{
        position: 'absolute', top: 16, left: 16, zIndex: 10, width: 38, height: 38, borderRadius: '50%',
        background: 'rgba(0,0,0,.45)', border: 'none', color: '#fff', fontSize: '1.2rem', cursor: 'pointer',
      }}>←</button>
      <button onClick={() => setMuted(m => !m)} aria-label={muted ? 'Unmute' : 'Mute'} style={{
        position: 'absolute', top: 16, right: 16, zIndex: 10, width: 38, height: 38, borderRadius: '50%',
        background: 'rgba(0,0,0,.45)', border: 'none', color: '#fff', fontSize: '1.1rem', cursor: 'pointer',
      }}>{muted ? '🔇' : '🔊'}</button>

      {loading ? (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '.9rem' }}>
          Loading videos…
        </div>
      ) : error || videoPosts.length === 0 ? (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', gap: 14, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: '2.2rem' }}>🎬</div>
          <div style={{ fontSize: '.9rem', opacity: 0.85, maxWidth: 280 }}>
            {error ? "Couldn't load videos right now." : 'No videos yet — check back soon as more platforms post video content.'}
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
              key={post.id || idx}
              ref={el => { slideRefs.current[idx] = el; }}
              data-idx={idx}
              style={{ height: '100dvh', scrollSnapAlign: 'start', scrollSnapStop: 'always' }}
            >
              <VideoSlide post={post} active={idx === activeIndex} muted={muted} onToggleMute={() => setMuted(m => !m)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
