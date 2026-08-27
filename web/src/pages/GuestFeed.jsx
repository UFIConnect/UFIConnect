import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import GuestShell from '../components/GuestShell';
import client from '../api/client';
import { SOURCE_META } from '../components/sourceMeta';

function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Deliberately simpler than Feed.jsx's own PostCard — no inline video
// playback, no comments, no like/report actions. Tapping through to
// PostDetail (already guest-safe — see its own GuestShell branch) is where
// a guest gets the real reading/watching experience; this card's only job
// is to be a fast, honest preview that makes tapping through worth it.
function GuestPostCard({ post }) {
  const src = SOURCE_META[post.source] || SOURCE_META.uficonnect;
  const isVideo = post.mediaType === 'video';
  const isImage = post.mediaType === 'image';
  return (
    <Link
      to={`/p/${encodeURIComponent(post.id)}`}
      className="card post-card"
      style={{ display: 'block', marginBottom: 12, textDecoration: 'none', color: 'inherit' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: '.85rem' }}>{src.icon}</span>
        <span style={{ fontSize: '.72rem', fontWeight: 700, color: src.color }}>{post.sourceLabel || src.label}</span>
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
      {isImage && post.mediaUrl && (
        <div style={{ borderRadius: 12, overflow: 'hidden', marginTop: 8, background: 'var(--border)' }}>
          <img src={post.mediaUrl} alt="" style={{ width: '100%', display: 'block', maxHeight: 320, objectFit: 'cover' }} />
        </div>
      )}
      {isVideo && (
        <div style={{
          borderRadius: 12, overflow: 'hidden', marginTop: 8, position: 'relative',
          background: '#000', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {(post.mediaPoster || post.mediaUrl) && (
            <img
              src={post.mediaPoster || post.mediaUrl} alt=""
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.7 }}
            />
          )}
          <span style={{ position: 'relative', fontSize: '2.2rem' }}>▶️</span>
        </div>
      )}
      {(post.likesCount > 0 || post.commentsCount > 0) && (
        <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: '.75rem', color: 'var(--muted)' }}>
          {post.likesCount > 0 && <span>❤️ {post.likesCount.toLocaleString()}</span>}
          {post.commentsCount > 0 && <span>💬 {post.commentsCount.toLocaleString()}</span>}
        </div>
      )}
    </Link>
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
  const loadingMoreRef = useRef(false);
  const knownIds = useRef(new Set());
  const sentinelRef = useRef(null);

  const loadPage = useCallback(async (reset = false) => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    try {
      const params = { limit: 20 };
      if (!reset && cursor) params.cursor = cursor;
      const { data } = await client.get('/feed/guest', { params });
      const incoming = (data.posts || []).filter(p => p?.id && !knownIds.current.has(p.id));
      incoming.forEach(p => knownIds.current.add(p.id));
      setPosts(prev => (reset ? incoming : [...prev, ...incoming]));
      setCursor(data.cursor || null);
      setHasMore(data.hasMore !== false);
    } catch {
      setHasMore(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  useEffect(() => { loadPage(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  return (
    <GuestShell>
      <Helmet>
        <title>UFconnect — Browse as a guest</title>
      </Helmet>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 60px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          background: 'var(--primary-light, #EDE9FE)', border: '1px solid var(--primary)',
          borderRadius: 12, padding: '12px 16px', marginBottom: 18,
        }}>
          <span style={{ fontSize: '.82rem', color: 'var(--text)' }}>
            You're browsing as a guest — sign in or join to like, comment, and personalize your feed.
          </span>
          <Link to="/register"><button className="btn btn-primary btn-sm" type="button" style={{ flexShrink: 0 }}>Join free</button></Link>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-primary" /></div>
        )}

        {!loading && posts.map((p, i) => <GuestPostCard key={`${p.id}-${i}`} post={p} />)}

        {!loading && !posts.length && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
            Nothing to show right now — check back soon.
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
