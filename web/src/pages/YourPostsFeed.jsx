import { timeAgo } from '../utils/postTime.mjs';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import Layout from '../components/Layout';
import PostPagesNavigation from '../components/PostPagesNavigation';
import { useAuth } from '../contexts/AuthContext';
import client from '../api/client';
import { SOURCE_META } from '../components/sourceMeta';
import BrandIcon, { hasBrandIcon } from '../components/BrandIcon';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';
import usePagedResults from '../hooks/usePagedResults';
import { orderNewestFeedCohorts } from '../utils/feedOrdering';
import { SavePostButton } from '../components/SaveButtons';
import PostInlineText from '../components/PostInlineText';
import PostLinkPreviews from '../components/PostLinkPreviews';
import { safePostLink } from '../../../backend/post-links.mjs';
import { postTextPreview } from '../../../backend/post-text.mjs';

const PAGE_SIZE = 12;
const AUTO_REFRESH_MS = 45 * 1000;


function mergePosts(existing, incoming) {
  const byId = new Map();
  [...incoming, ...existing].forEach(post => {
    if (!post?.id || byId.has(post.id)) return;
    byId.set(post.id, post);
  });
  return orderNewestFeedCohorts([...byId.values()]);
}

function SourceBadge({ source }) {
  const meta = SOURCE_META[source] || SOURCE_META.uficonnect;
  const mark = hasBrandIcon(source) ? (
    <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <BrandIcon platform={source} size={13} />
    </span>
  ) : (
    <span style={{ width: 20, height: 20, borderRadius: '50%', background: `${meta.color}20`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 900, lineHeight: 1, flexShrink: 0 }}>
      {String(meta.icon || source || 'UFI').slice(0, 3).toUpperCase()}
    </span>
  );
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      color: meta.color, background: `${meta.color}14`,
      border: `1px solid ${meta.color}33`, borderRadius: 999,
      padding: '3px 8px', fontSize: '.72rem', fontWeight: 800,
    }}>
      {mark}
      {meta.label}
    </span>
  );
}

function OwnPostCard({ post }) {
  const originalUrl = safePostLink(post.sourceUrl);
  const title = post.title || postTextPreview(post.content, 120) || 'Untitled post';
  const hasImage = post.mediaType === 'image' && post.mediaUrl;
  const hasVideoPoster = post.mediaType === 'video_thumbnail_only' && post.mediaUrl;
  return (
    <article className="card post-card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <SourceBadge source={post.source || 'uficonnect'} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {post.matchedByLocation && (
            <span style={{ fontSize: '.65rem', fontWeight: 700, color: '#047857', background: '#ECFDF5', border: '1px solid #A7F3D0', padding: '2px 7px', borderRadius: 5 }}>
              {post.locationMatchLabel || 'Near you'}
            </span>
          )}
          <span style={{ color: 'var(--muted)', fontSize: '.72rem', whiteSpace: 'nowrap' }}>{timeAgo(post.createdAt)}</span>
        </div>
      </div>

      <h2 style={{ margin: '0 0 8px', fontSize: '.98rem', lineHeight: 1.35 }}><PostInlineText text={title} /></h2>
      {post.content && post.content !== title && (
        <p style={{ margin: '0 0 12px', color: 'var(--text)', fontSize: '.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          <PostInlineText text={post.content} />
        </p>
      )}

      {(hasImage || hasVideoPoster) && (
        <div style={{ borderRadius: 8, overflow: 'hidden', marginBottom: 12, background: '#0f172a' }}>
          <img src={post.mediaUrl} alt="" style={{ width: '100%', maxHeight: 440, objectFit: 'contain', display: 'block' }} />
        </div>
      )}

      <PostLinkPreviews post={post} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <div style={{ color: 'var(--muted)', fontSize: '.78rem' }}>
          {[post.likesCount ? `${post.likesCount} likes` : null, post.commentsCount ? `${post.commentsCount} comments` : null].filter(Boolean).join(' · ') || 'Synced from your connected account'}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <SavePostButton post={post} className="btn btn-ghost btn-sm save-item-button" />
          {originalUrl && (
            <a href={originalUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
              View original
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export default function YourPostsFeed() {
  const { profile } = useAuth();
  const headingRef = useRef(null);
  const bustNextRequest = useRef(false);
  const results = usePagedResults({
    enabled: !!profile?.id,
    queryKey: JSON.stringify(['your-connected-posts', profile?.id]),
    errorMessage: 'Could not load your connected posts right now. Please try again.',
    mergeItems: mergePosts,
    loadPage: async ({ page, signal }) => {
      const bust = bustNextRequest.current;
      bustNextRequest.current = false;
      const { data } = await client.get('/command-center/your-content/feed', {
        params: { page, limit: PAGE_SIZE, ...(bust ? { bust: 1 } : {}) }, signal,
      });
      return { items: mergePosts([], data.posts || []), hasNext: data.hasMore === true, total: data.totalAvailable, data };
    },
  });
  const { items: posts, page, hasNext: hasMore, loading, error } = results;
  const meta = results.data || {};
  const refreshing = loading && posts.length > 0;
  const latestResults = useRef(results);
  latestResults.current = results;
  useEffect(() => {
    const id = setInterval(() => {
      const current = latestResults.current;
      if (current.page === 1 && !document.hidden && !current.loading) current.refresh();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const refreshFeed = useCallback(() => {
    bustNextRequest.current = true;
    return results.refresh();
  }, [results.refresh]);
  useScrollToRefresh(refreshFeed, { enabled: !loading });

  const activeSources = useMemo(
    () => Object.entries(meta.sources || {}).filter(([, count]) => count > 0),
    [meta.sources]
  );
  const sourceErrors = Object.entries(meta.sourceErrors || {});

  return (
    <>
      <Helmet>
        <title>Your Connected Posts | UFIconnect</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <Layout>
        <div className="paginated-feed-page">
        <h1 ref={headingRef} className="page-title" style={{ marginBottom: 20 }}>Your Connected Posts</h1>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18, alignItems: 'center' }}>
          <div className="tag tag-primary">{(meta.totalAvailable || posts.length).toLocaleString()} posts</div>
          <div className="tag">{activeSources.length.toLocaleString()} active sources</div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={refreshFeed}
            disabled={loading || refreshing}
            style={{ marginLeft: 'auto' }}
          >
            {refreshing ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Refresh'}
          </button>
        </div>

        {activeSources.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
            {activeSources.map(([source, count]) => (
              <span key={source} className="tag" style={{ gap: 6 }}>
                <SourceBadge source={source} />
                {count}
              </span>
            ))}
          </div>
        )}

        {sourceErrors.length > 0 && (
          <div className="card" style={{ marginBottom: 14, color: 'var(--muted)', fontSize: '.84rem' }}>
            {sourceErrors.map(([source, message]) => (
              <div key={source}>
                {(SOURCE_META[source] || SOURCE_META.uficonnect).label}: {message}
              </div>
            ))}
          </div>
        )}

        {loading && posts.length === 0 ? (
          <div className="empty-state"><span className="spinner spinner-primary" /></div>
        ) : error && posts.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Your connected posts did not load</div>
            <p style={{ color: 'var(--muted)', fontSize: '.88rem', margin: '0 0 16px' }}>{error}</p>
            <button type="button" className="btn btn-primary btn-sm" onClick={results.retry}>Try again</button>{' '}
            <Link to="/connected-accounts" className="btn btn-ghost btn-sm">Check connected accounts</Link>
          </div>
        ) : posts.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>
              {meta.connectedPlatforms?.length ? 'No connected posts yet' : 'Connect an account to start'}
            </div>
            <p style={{ color: 'var(--muted)', fontSize: '.88rem', margin: '0 0 16px' }}>
              Your posts from supported connected accounts will appear here.
            </p>
            <Link to="/connected-accounts" className="btn btn-primary btn-sm">Manage accounts</Link>
          </div>
        ) : (
          <>
            {posts.map(post => <OwnPostCard key={post.id} post={post} />)}
            {!hasMore && !error && (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '.8rem', padding: '12px 16px', marginBottom: 24 }}>
                You’re caught up. Refresh to check for new connected posts.
              </div>
            )}
          </>
        )}
        {posts.length > 0 && <PostPagesNavigation results={results} continuous />}
        </div>
      </Layout>
    </>
  );
}
