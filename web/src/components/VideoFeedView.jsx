import { useState, useEffect, useRef, useCallback } from 'react';
import client from '../api/client';
import { extractYouTubeId, deriveBlueskyPlaylistUrl, isDirectVideoUrl, HlsVideoPlayer } from './videoMedia';
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

function VideoSlide({ post, active, muted, onToggleMute }) {
  const src = resolveVideoSource(post);
  const meta = SOURCE_META[post.source] || SOURCE_META.uficonnect;
  const fileVideoRef = useRef(null);

  // Only the file-video path needs manual play/pause — YouTube's iframe and
  // the HLS player are only mounted at all while active (below), so they
  // start fresh each time rather than needing an imperative pause.
  useEffect(() => {
    const v = fileVideoRef.current;
    if (!v) return;
    if (active) v.play().catch(() => {});
    else { v.pause(); try { v.currentTime = 0; } catch {} }
  }, [active]);

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', overflow: 'hidden' }}>
      {!src ? (
        <div style={{ color: '#888', fontSize: '.85rem' }}>🎬 Video unavailable</div>
      ) : src.kind === 'youtube' ? (
        active ? (
          <iframe
            key={src.id}
            src={`https://www.youtube.com/embed/${src.id}?autoplay=1&mute=${muted ? 1 : 0}&playsinline=1&loop=1&playlist=${src.id}&controls=0&modestbranding=1&rel=0`}
            style={{ width: '100%', height: '100%', border: 'none' }}
            allow="autoplay; encrypted-media; picture-in-picture"
            title={post.title || 'video'}
          />
        ) : (
          <img src={src.poster} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.85 }} />
        )
      ) : src.kind === 'hls' ? (
        active ? (
          <HlsVideoPlayer src={src.src} poster={src.poster} autoPlay muted={muted} loop onClick={onToggleMute}
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
          onClick={onToggleMute}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      )}

      {/* Bottom caption overlay */}
      <div style={{
        position: 'absolute', left: 16, right: 76, bottom: 22, color: '#fff',
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

      {/* Right-side action rail */}
      <div style={{ position: 'absolute', right: 14, bottom: 22, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        {post.likesCount > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: '#fff', textShadow: '0 1px 6px rgba(0,0,0,.7)' }}>
            <span style={{ fontSize: '1.3rem' }}>❤️</span>
            <span style={{ fontSize: '.68rem', fontWeight: 700 }}>{post.likesCount.toLocaleString()}</span>
          </div>
        )}
        {post.sourceUrl && (
          <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer"
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
