import JobPostContent from '../components/JobPostContent';
import { isCareerPost } from '../utils/jobSummary.mjs';
import ArticleIllustration from '../components/ArticleIllustration';
import PostImage from '../components/PostImage';
import SourceMediaFallback from '../components/SourceMediaFallback';
import SnapFeedRail from '../components/SnapFeedRail';
import VimeoPreview from '../components/VimeoPreview';
import { extractVimeoId } from '../components/videoMedia';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import GuestShell from '../components/GuestShell';
import PublicFooter from '../components/PublicFooter';
import useInfiniteScroll from '../hooks/useInfiniteScroll';
import client from '../api/client';
import { SOURCE_META } from '../components/sourceMeta';
import { OpenOnSource, PostHeader, PostOptionsMenu } from '../components/PostCardChrome';
import PostLikes from '../components/PostLikes';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';
import { orderNewestFeedCohorts } from '../utils/feedOrdering';
import { extractYouTubeId, deriveBlueskyPlaylistUrl, isDirectVideoUrl, youTubeEmbedUrl, HlsVideoPlayer, useGlobalMuted, SoundIcon } from '../components/videoMedia';
import { isNativeRuntime } from '../nativeRuntime.mjs';

const GUEST_FEED_AUTO_REFRESH_MS = 2 * 60 * 1000;

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
  const directUrl = !youtubeId && !playlistUrl && videoUrl && isDirectVideoUrl(videoUrl, post) ? videoUrl : null;

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
        {active && isNativeRuntime() ? (
          <a href={`https://www.youtube.com/watch?v=${youtubeId}`} target="_blank" rel="noopener noreferrer"
            style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', color: '#fff' }}>Open on YouTube</a>
        ) : active ? (
          <iframe
            key={muted ? 'muted' : 'unmuted'}
            src={youTubeEmbedUrl(youtubeId, { autoplay: 1, mute: muted ? 1 : 0, controls: 0 })}
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
      <HlsVideoPlayer src={playlistUrl} poster={null} autoPlay muted={muted} loop controls={false}
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
  const vimeoId = extractVimeoId(videoUrl);
  if (vimeoId) return <VimeoPreview id={vimeoId} title={post.title} active={active} />;
  return <SourceMediaFallback post={post} />;
}

// Deliberately simpler than Feed.jsx's own PostCard — no comments or
// report actions (those still route through PostDetail, already
// guest-safe — see its own GuestShell branch). The like count shows, and
// liking asks the guest to sign in. Video now plays inline
// (see GuestVideoPlayer) since a static "tap to watch" tile read as dead
// weight in a feed that's supposed to feel alive while scrolling.
function GuestPostCard({ post, active, muted, registerRef }) {
  const src = SOURCE_META[post.source] || SOURCE_META.uficonnect;
  const isVideo = post.mediaType === 'video';
  const isImage = post.mediaType === 'image';
  return (
    <div ref={registerRef} data-post-id={post.id} className="card post-card" style={{ marginBottom: 12, overflow: 'hidden', '--source-color': src.color }}>
      <div style={{ padding: '14px 14px 0' }}>
        <PostHeader post={post} member={!post.isExternal} />
        {post.matchedByLocation && (
          <div className="post-chrome-chips">
            <span style={{ fontSize: '.65rem', fontWeight: 700, color: '#047857', background: '#ECFDF5', border: '1px solid #A7F3D0', padding: '2px 7px', borderRadius: 5 }}>
              {post.locationMatchLabel || 'Near you'}
            </span>
          </div>
        )}
      </div>
      <Link
        to={`/p/${encodeURIComponent(post.id)}`}
        style={{ display: 'block', padding: '0 14px', textDecoration: 'none', color: 'inherit' }}
      >
        {post.title && <p style={{ fontWeight: 700, fontSize: '.95rem', margin: '0 0 6px', lineHeight: 1.4 }}>{post.title}</p>}
        {isCareerPost(post) ? <JobPostContent post={post} compact /> : post.content && (
          <p style={{
            fontSize: '.85rem', color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 4px',
            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {post.content}
          </p>
        )}
      </Link>
      <ArticleIllustration post={post} />
      {isImage && post.mediaUrl && (
        <Link to={`/p/${encodeURIComponent(post.id)}`} style={{ display: 'block', marginTop: 8 }}>
          <PostImage post={post} style={{ width: '100%', display: 'block', maxHeight: 320, objectFit: 'contain', background: 'var(--border)' }} />
        </Link>
      )}
      {isVideo && (
        <div style={{ marginTop: 8 }}>
          <GuestVideoPlayer post={post} active={active} muted={muted} />
        </div>
      )}
      <div style={{ padding: '0 14px 14px' }}>
        <div className="post-chrome-actions">
          <PostLikes post={post} />
          {post.commentsCount > 0 && <span style={{ fontSize: '.8rem', color: 'var(--muted)' }}>{post.commentsCount.toLocaleString()} comments</span>}
          <PostOptionsMenu post={post} />
          <OpenOnSource post={post} />
        </div>
      </div>
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
  const [locationContext, setLocationContext] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [failedPage, setFailedPage] = useState(null);
  const [activePostId, setActivePostId] = useState(null);
  const [muted, toggleMuted] = useGlobalMuted();
  const pendingRequest = useRef(null);
  const pageRef = useRef(1);
  const pageCursors = useRef(new Map([[1, null]]));
  const pageCache = useRef(new Map());
  const headingRef = useRef(null);
  const cardRefs = useRef(new Map());

  const loadPage = useCallback(async (pageNo = 1, { reset = false, force = false } = {}) => {
    if (!Number.isSafeInteger(pageNo) || pageNo < 1 || (!reset && !pageCursors.current.has(pageNo))) return false;
    pendingRequest.current?.abort();
    pendingRequest.current = null;
    if (reset) {
      pageNo = 1;
      pageCursors.current = new Map([[1, null]]);
      pageCache.current.clear();
      pageRef.current = 1;
      setPage(1);
      setPosts([]);
      setHasMore(false);
      setActivePostId(null);
    }
    setError('');
    setFailedPage(null);
    const cached = !force && pageCache.current.get(pageNo);
    if (cached) {
      pageRef.current = pageNo;
      setPage(pageNo);
      setActivePostId(null);
      setPosts(cached.posts);
      setHasMore(cached.hasMore);
      setLocationContext(cached.locationContext);
      setLoading(false);
      setRefreshing(false);
      return true;
    }
    setLoading(true);
    setRefreshing(reset);
    const controller = new AbortController();
    pendingRequest.current = controller;
    try {
      const params = { limit: 20 };
      const cursor = pageCursors.current.get(pageNo);
      if (cursor) params.cursor = cursor;
      const { data } = await client.get('/feed/guest', { params, signal: controller.signal });
      if (controller.signal.aborted || pendingRequest.current !== controller) return false;
      const nextCursor = typeof data.cursor === 'string' && data.cursor ? data.cursor : null;
      const cursorAdvanced = nextCursor && ![...pageCursors.current].some(([number, value]) => number <= pageNo && value === nextCursor);
      const next = { posts: mergeGuestPosts((data.posts || []).filter(post => post?.id)),
        hasMore: data.hasMore === true && Boolean(cursorAdvanced), locationContext: data.locationContext || null };
      const visiblePage = pageCache.current.get(pageRef.current);
      if (!next.posts.length && pageNo > 1 && visiblePage?.posts.length) {
        pageCache.current.set(pageRef.current, { ...visiblePage, hasMore: false });
        setHasMore(false);
        return false;
      }
      if (next.hasMore) pageCursors.current.set(pageNo + 1, nextCursor);
      pageCache.current.set(pageNo, next);
      // Keep cursor history for Previous while bounding retained media/cards.
      if (pageCache.current.size > 10) pageCache.current.delete(pageCache.current.keys().next().value);
      pageRef.current = pageNo;
      setPage(pageNo);
      setActivePostId(null);
      setPosts(previous => pageNo > 1 ? mergeGuestPosts(previous, next.posts) : next.posts);
      setHasMore(next.hasMore);
      setLocationContext(next.locationContext);
      return true;
    } catch {
      if (controller.signal.aborted || pendingRequest.current !== controller) return false;
      setError('This page of public posts could not load. Please try again.');
      setFailedPage(pageNo);
      return false;
    } finally {
      if (pendingRequest.current === controller) {
        setLoading(false);
        setRefreshing(false);
        pendingRequest.current = null;
      }
    }
  }, []);

  useEffect(() => {
    loadPage(1);
    return () => {
      pendingRequest.current?.abort();
      pendingRequest.current = null;
    };
  }, [loadPage]);

  const scrollSentinel = useInfiniteScroll({ enabled: hasMore && !loading && !refreshing && !error,
    onLoadMore: () => loadPage(page + 1), revision: page });

  // Full reset back to the freshest page 1 rather than merging, same as the
  // authenticated Feed's own manual refresh, so it actually reads as "live"
  // instead of old and new content interleaving. Two ways in: the explicit
  // button (see the banner below — scroll-to-refresh alone isn't
  // discoverable enough on a page with no other chrome hinting it exists)
  // and scrolling back to the top, same convention every other list-style
  // page in the app uses (see useScrollToRefresh's own comment).
  const handleRefresh = useCallback(async () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await loadPage(1, { reset: true });
  }, [loadPage]);
  useScrollToRefresh(handleRefresh, { enabled: !loading && !refreshing });

  useEffect(() => {
    const refreshQuietly = () => {
      if (document.hidden || pageRef.current !== 1 || pendingRequest.current) return;
      if (window.scrollY > 900) return;
      loadPage(1, { reset: true });
    };
    const interval = window.setInterval(refreshQuietly, GUEST_FEED_AUTO_REFRESH_MS);
    window.addEventListener('focus', refreshQuietly);
    document.addEventListener('visibilitychange', refreshQuietly);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshQuietly);
      document.removeEventListener('visibilitychange', refreshQuietly);
    };
  }, [loadPage]);

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
        <title>Global Feed | UFIconnect</title>
        <meta name="description" content="Browse public posts and videos from across UFIconnect's supported sources. Explore the global feed before creating an account." />
        <link rel="canonical" href="https://uficonnect.org/global" />
      </Helmet>
      <main className="guest-feed-main paginated-feed-page">
        <section className="public-feed-intro" aria-labelledby="global-feed-title">
          <h1 id="global-feed-title" ref={headingRef}>Explore the global feed</h1>
          <p>Browse public posts and videos from across UFIconnect's supported sources, without creating an account. Open a post to read more and see where it came from.</p>
          <p>{locationContext?.available ? `Approximate area: ${[locationContext.city, locationContext.countryName || locationContext.country].filter(Boolean).join(', ')}. Public recommendations may use this area.` : 'Showing global public posts.'}</p>
          <p><Link to="/register">Create an account</Link> to personalize your feed, follow communities, and join conversations. Already a member? <Link to="/login">Sign in</Link>.</p>
        </section>
        <SnapFeedRail mode="home" />
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

        {loading && posts.length === 0 && (
          <div role="status" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-primary" aria-hidden="true" /><span style={{ marginLeft: 8 }}>Loading public posts</span></div>
        )}

        {posts.map((p, i) => (
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

        {error && <p role="alert" style={{ textAlign: 'center', padding: 20 }}>{error} <button type="button" className="btn btn-ghost btn-sm" disabled={loading} onClick={() => loadPage(failedPage || page, { force: true })}>Try again</button></p>}
        {!loading && !error && !posts.length && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
            No public posts are available right now. Use Refresh to try again.
          </div>
        )}

        <div ref={scrollSentinel} data-feed-scroll-sentinel aria-hidden="true" style={{ height: 1 }} />
        {loading && posts.length > 0 && <p role="status">Loading more posts…</p>}
      </main>
      <PublicFooter />
    </GuestShell>
  );
}
