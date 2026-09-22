import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import GuestShell from '../components/GuestShell';
import client from '../api/client';
import { SOURCE_META } from '../components/sourceMeta';
import BrandIcon, { hasBrandIcon } from '../components/BrandIcon';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';
import { orderNewestFeedCohorts } from '../utils/feedOrdering';
import { extractYouTubeId, deriveBlueskyPlaylistUrl, isDirectVideoUrl, youTubeEmbedUrl, HlsVideoPlayer, useGlobalMuted, SoundIcon } from '../components/videoMedia';

function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const GUEST_FEED_AUTO_REFRESH_MS = 2 * 60 * 1000;
const GUEST_DEDUP_WINDOW = 500;
const GUEST_EMPTY_STREAK_LIMIT = 6;

function SourceMark({ source, label }) {
  const meta = SOURCE_META[source] || {};
  if (hasBrandIcon(source)) {
    return (
      <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)', flexShrink: 0 }}>
        <BrandIcon platform={source} size={14} />
      </span>
    );
  }
  return (
    <span style={{ width: 22, height: 22, borderRadius: '50%', background: `${meta.color || 'var(--primary)'}18`, color: meta.color || 'var(--primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 900, flexShrink: 0 }}>
      {String(label || meta.icon || source || 'UFI').slice(0, 3).toUpperCase()}
    </span>
  );
}

function guestPostIdentity(post) {
  return post?.id || `${post?.source || 'feed'}:${post?.sourceUrl || post?.title || ''}:${post?.createdAt || ''}`;
}

function mergeGuestPosts(primary = [], secondary = []) {
  const seen = new Set();
  const merged = [];
  for (const post of [...primary, ...secondary]) {
    const key = guestPostIdentity(post);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(post);
  }
  return orderNewestFeedCohorts(merged);
}

// Lighter than VideoFeedView's own player — no shared cross-slide YouTube
// instance, no scrub bar. This is a plain scrolling list, not a snap-scroll
// feed, so each card owning its own (auto-destroyed-when-inactive) player
// is the right tradeoff here: simplicity over the reuse machinery
// VideoFeedView needs for rapid slide-to-slide swiping. `active` (only the
// card currently ~60% in view, see the IntersectionObserver below) gates
// whether anything actually plays, so scrolling past a video stops it the
// same way it does everywhere else in the app.
function GuestVideoPlayer({ post, active, muted }) {
  const directVideoRef = useRef(null);
  const videoUrl = post.source === 'youtube' ? (post.sourceUrl || post.mediaUrl) : (post.mediaUrl || post.sourceUrl);
  const youtubeId = post.embedId || extractYouTubeId(videoUrl);
  const playlistUrl = !youtubeId && post.source === 'bluesky' ? deriveBlueskyPlaylistUrl(post.mediaUrl) : null;
  const directUrl = !youtubeId && !playlistUrl && videoUrl && isDirectVideoUrl(videoUrl) ? videoUrl : null;

  useEffect(() => {
    const video = directVideoRef.current;
    if (!video || !directUrl) return;
    video.muted = muted;
    video.playsInline = true;
    if (active) {
      video.play().catch(() => {});
      requestAnimationFrame(() => video.play().catch(() => {}));
    } else {
      video.pause();
    }
  }, [active, directUrl, muted]);

  if (youtubeId) {
    return (
      <div style={{ width: '100%', aspectRatio: '16/9', background: '#000', position: 'relative' }}>
        {active ? (
          <iframe
            key={muted ? 'muted' : 'unmuted'}
            src={youTubeEmbedUrl(youtubeId, { autoplay: 1, mute: muted ? 1 : 0 })}
            referrerPolicy="strict-origin-when-cross-origin"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', pointerEvents: 'auto' }}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            title={post.title}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', background: 'linear-gradient(135deg, #111827, #020617)', fontSize: '.82rem', fontWeight: 800 }}>
            Video wakes up when you scroll here
          </div>
        )}
      </div>
    );
  }
  if (playlistUrl) {
    return active ? (
      <HlsVideoPlayer src={playlistUrl} poster={null} autoPlay muted={muted} loop
        style={{ width: '100%', display: 'block', maxHeight: 400 }} />
    ) : (
      <div style={{ height: 240, background: '#000', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.82rem', fontWeight: 800 }}>
        Video wakes up when you scroll here
      </div>
    );
  }
  if (directUrl) {
    return (
      <video
        ref={directVideoRef}
        src={directUrl}
        autoPlay={active} muted={muted} loop playsInline
        preload={active ? 'auto' : 'metadata'}
        draggable={false}
        style={{ width: '100%', display: 'block', maxHeight: 400, background: '#000' }}
      />
    );
  }
  return null;
}

// Deliberately simpler than Feed.jsx's own PostCard — no comments, no
// like/report actions (those still route through PostDetail, already
// guest-safe — see its own GuestShell branch). Video now plays inline
// (see GuestVideoPlayer) since a static "tap to watch" tile read as dead
// weight in a feed that's supposed to feel alive while scrolling.
function GuestPostCard({ post, active, muted, registerRef }) {
  const src = SOURCE_META[post.source] || SOURCE_META.uficonnect;
  const isVideo = post.mediaType === 'video';
  const isImage = post.mediaType === 'image';
  return (
    <div ref={registerRef} data-post-id={post.id} className="card post-card" style={{ marginBottom: 12, overflow: 'hidden' }}>
      <Link
        to={`/p/${encodeURIComponent(post.id)}`}
        style={{ display: 'block', padding: '14px 14px 0', textDecoration: 'none', color: 'inherit' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <SourceMark source={post.source} label={src.icon} />
          <span style={{ fontSize: '.72rem', fontWeight: 700, color: src.color }}>{post.sourceLabel || src.label}</span>
          {post.matchedByLocation && (
            <span style={{ fontSize: '.65rem', fontWeight: 700, color: '#047857', background: '#ECFDF5', border: '1px solid #A7F3D0', padding: '2px 7px', borderRadius: 5 }}>
              {post.locationMatchLabel || 'Near you'}
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: '.7rem', color: 'var(--muted)' }}>{timeAgo(post.createdAt)}</span>
        </div>
        {post.title && <p style={{ fontWeight: 700, fontSize: '.95rem', margin: '0 0 6px', lineHeight: 1.4 }}>{post.title}</p>}
        {post.content && (
          <p style={{
            fontSize: '.85rem', color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 4px',
            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {post.content}
          </p>
        )}
      </Link>
      {isImage && post.mediaUrl && (
        <Link to={`/p/${encodeURIComponent(post.id)}`} style={{ display: 'block', marginTop: 8 }}>
          <img src={post.mediaUrl} alt="" style={{ width: '100%', display: 'block', maxHeight: 320, objectFit: 'cover', background: 'var(--border)' }} />
        </Link>
      )}
      {isVideo && (
        <div style={{ marginTop: 8 }}>
          <GuestVideoPlayer post={post} active={active} muted={muted} />
        </div>
      )}
      {(post.likesCount > 0 || post.commentsCount > 0) && (
        <div style={{ display: 'flex', gap: 14, padding: '10px 14px 14px', fontSize: '.75rem', color: 'var(--muted)' }}>
          {post.likesCount > 0 && <span>{post.likesCount.toLocaleString()} likes</span>}
          {post.commentsCount > 0 && <span>{post.commentsCount.toLocaleString()} comments</span>}
        </div>
      )}
    </div>
  );
}

// Browsing before creating an account — a real (if simpler) read of the
// same aggregate content the authenticated Feed shows, via the separate
// GET /feed/guest endpoint (see its own backend comment for why this isn't
// just handleFeedRequest opened up to logged-out traffic). No search, sort,
// source filters, Following, or write actions — sign-up prompts instead.
export default function GuestFeed() {
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activePostId, setActivePostId] = useState(null);
  const [muted, toggleMuted] = useGlobalMuted();
  const loadingMoreRef = useRef(false);
  const knownIds = useRef(new Set());
  const knownIdsQueue = useRef([]);
  const emptyStreakRef = useRef(0);
  const sentinelRef = useRef(null);
  const cardRefs = useRef(new Map());

  const markKnownId = useCallback((id) => {
    if (!id || knownIds.current.has(id)) return;
    knownIds.current.add(id);
    knownIdsQueue.current.push(id);
    if (knownIdsQueue.current.length > GUEST_DEDUP_WINDOW) {
      knownIds.current.delete(knownIdsQueue.current.shift());
    }
  }, []);

  const loadPage = useCallback(async (reset = false, options = {}) => {
    const { merge = false } = options || {};
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    try {
      const params = { limit: 20 };
      if (!reset && cursor) params.cursor = cursor;
      const { data } = await client.get('/feed/guest', { params });
      if (reset && !merge) {
        knownIds.current = new Set();
        knownIdsQueue.current = [];
        emptyStreakRef.current = 0;
      }
      const rawIncoming = (data.posts || []).filter(p => p?.id);
      const incoming = reset && merge
        ? rawIncoming
        : rawIncoming.filter(p => !knownIds.current.has(p.id));
      incoming.forEach(p => markKnownId(p.id));
      setPosts(prev => {
        if (reset) return merge ? mergeGuestPosts(incoming, prev).slice(0, 120) : mergeGuestPosts(incoming, []);
        return mergeGuestPosts(prev, incoming);
      });
      setCursor(data.cursor || null);
      if (reset) {
        if (rawIncoming.length > 0) emptyStreakRef.current = 0;
      } else {
        emptyStreakRef.current = incoming.length > 0 ? 0 : emptyStreakRef.current + 1;
      }
      setHasMore(data.hasMore !== false && emptyStreakRef.current < GUEST_EMPTY_STREAK_LIMIT);
    } catch {
      setHasMore(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, markKnownId]);

  useEffect(() => { loadPage(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Full reset back to the freshest page 1 rather than merging, same as the
  // authenticated Feed's own manual refresh, so it actually reads as "live"
  // instead of old and new content interleaving. Two ways in: the explicit
  // button (see the banner below — scroll-to-refresh alone isn't
  // discoverable enough on a page with no other chrome hinting it exists)
  // and scrolling back to the top, same convention every other list-style
  // page in the app uses (see useScrollToRefresh's own comment).
  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    knownIds.current = new Set();
    knownIdsQueue.current = [];
    emptyStreakRef.current = 0;
    setCursor(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await loadPage(true);
    setRefreshing(false);
  }, [refreshing, loadPage]);
  useScrollToRefresh(handleRefresh, { enabled: !loading });

  useEffect(() => {
    const refreshQuietly = () => {
      if (document.hidden || loading || refreshing || loadingMoreRef.current) return;
      if (window.scrollY > 900) return;
      loadPage(true, { merge: true });
    };
    const interval = window.setInterval(refreshQuietly, GUEST_FEED_AUTO_REFRESH_MS);
    window.addEventListener('focus', refreshQuietly);
    document.addEventListener('visibilitychange', refreshQuietly);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshQuietly);
      document.removeEventListener('visibilitychange', refreshQuietly);
    };
  }, [loading, refreshing, loadPage]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loadingMoreRef.current) {
        setLoadingMore(true);
        loadPage(false);
      }
    }, { rootMargin: '400px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadPage]);

  // Which video card is "active" (the only one that actually plays) — the
  // one nearest 60% in view, same threshold VideoFeedView's own swipe feed
  // uses, just applied to a normal scrolling list instead of a snap-scroll
  // one. Re-observes whenever the post list changes (new page loaded).
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
          setActivePostId(entry.target.dataset.postId);
        }
      }
    }, { threshold: [0.6] });
    for (const el of cardRefs.current.values()) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [posts]);

  useEffect(() => {
    if (activePostId || posts.length === 0) return;
    const firstVideo = posts.find(post => post.mediaType === 'video');
    if (firstVideo) setActivePostId(firstVideo.id);
  }, [activePostId, posts]);

  return (
    <GuestShell>
      <Helmet>
        <title>UFIconnect - Global Scroll</title>
      </Helmet>
      <div className="guest-feed-main">
        <div className="guest-feed-banner">
          <div className="guest-feed-banner-actions" style={{ marginLeft: 'auto' }}>
            <button
              type="button" onClick={handleRefresh} disabled={refreshing || loading}
              className="btn btn-ghost btn-sm"
              aria-label="Refresh feed"
              title="Refresh feed"
            >
              <span style={{ display: 'inline-block', animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }}>Refresh</span>
            </button>
            <button
              type="button" onClick={() => toggleMuted()}
              className="btn btn-ghost btn-sm"
              aria-label={muted ? 'Unmute videos' : 'Mute videos'}
              title={muted ? 'Unmute videos' : 'Mute videos'}
            >
              <SoundIcon muted={muted} size={15} />
            </button>
            <Link to="/register" className="btn btn-primary btn-sm">Join free</Link>
          </div>
        </div>
        <style>{'@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'}</style>

        {loading && (
          <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-primary" /></div>
        )}

        {!loading && posts.map((p, i) => (
          <GuestPostCard
            key={`${p.id}-${i}`}
            post={p}
            active={activePostId === p.id}
            muted={muted}
            registerRef={el => {
              if (el) cardRefs.current.set(p.id, el);
              else cardRefs.current.delete(p.id);
            }}
          />
        ))}

        {!loading && !posts.length && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
            Nothing to show right now. The feed is taking a dramatic pause.
          </div>
        )}

        <div ref={sentinelRef} style={{ height: 1 }} />
        {loadingMore && (
          <div style={{ textAlign: 'center', padding: 20 }}><span className="spinner spinner-primary" /></div>
        )}
      </div>
    </GuestShell>
  );
}
