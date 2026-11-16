import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import Layout from '../components/Layout';
import PostPagesNavigation from '../components/PostPagesNavigation';
import { useAuth } from '../contexts/AuthContext';
import client from '../api/client';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';
import usePagedResults from '../hooks/usePagedResults';
import { SavePostButton } from '../components/SaveButtons';
import PostInlineText from '../components/PostInlineText';
import PostLinkPreviews from '../components/PostLinkPreviews';
import { safePostLink } from '../../../backend/post-links.mjs';
import { postTextPreview } from '../../../backend/post-text.mjs';

const PAGE_SIZE = 12;
const AUTO_REFRESH_MS = 45 * 1000;

function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || t <= 0) return '';
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function mergePosts(existing, incoming) {
  const byId = new Map(existing.map(post => [post.id, post]));
  for (const post of incoming) byId.set(post.id, post);
  return [...byId.values()];
}

function OwnPostCard({ post }) {
  const title = post.title || postTextPreview(post.content, 120) || 'Untitled post';
  const videoUrl = post.mediaType === 'video' ? safePostLink(post.mediaUrl) : null;
  const imageUrl = safePostLink(post.mediaType === 'image' ? post.mediaUrl : post.mediaPoster);
  return (
    <article className="card post-card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span className="tag">{post.group?.name || 'UFIconnect'}</span>
        <span style={{ color: 'var(--muted)', fontSize: '.72rem', whiteSpace: 'nowrap' }}>{timeAgo(post.createdAt)}</span>
      </div>

      <h2 style={{ margin: '0 0 8px', fontSize: '.98rem', lineHeight: 1.35 }}><PostInlineText text={title} /></h2>
      {post.content && post.content !== title && (
        <p style={{ margin: '0 0 12px', color: 'var(--text)', fontSize: '.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          <PostInlineText text={post.content} />
        </p>
      )}

      {(imageUrl || videoUrl) && (
        <div style={{ borderRadius: 8, overflow: 'hidden', marginBottom: 12, background: '#0f172a' }}>
          {videoUrl
            ? <video src={videoUrl} poster={imageUrl || undefined} controls playsInline preload="none" style={{ width: '100%', maxHeight: 440, display: 'block' }} />
            : <img src={imageUrl} alt="" loading="lazy" style={{ width: '100%', maxHeight: 440, objectFit: 'contain', display: 'block' }} />}
        </div>
      )}

      <PostLinkPreviews post={post} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <div style={{ color: 'var(--muted)', fontSize: '.78rem' }}>
          {[post.likesCount ? `${post.likesCount} likes` : null, post.commentsCount ? `${post.commentsCount} comments` : null].filter(Boolean).join(' · ')}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <SavePostButton post={post} className="btn btn-ghost btn-sm save-item-button" />
          <Link to={`/p/${encodeURIComponent(post.id)}`} className="btn btn-ghost btn-sm">Open post</Link>
        </div>
      </div>
    </article>
  );
}

export default function YourPostsFeed() {
  const { profile } = useAuth();
  const results = usePagedResults({
    enabled: !!profile?.id,
    queryKey: JSON.stringify(['your-posts', profile?.id]),
    errorMessage: 'Could not load your posts right now. Please try again.',
    mergeItems: mergePosts,
    loadPage: async ({ cursor, signal }) => {
      const { data } = await client.get('/posts/mine', {
        params: { limit: PAGE_SIZE, cursor: cursor || undefined }, signal,
      });
      return { items: data.posts || [], hasNext: data.hasMore === true, nextCursor: data.cursor, total: data.totalAvailable };
    },
  });
  const { items: posts, total, hasNext: hasMore, loading, error } = results;
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

  useScrollToRefresh(results.refresh, { enabled: !loading });

  return (
    <>
      <Helmet>
        <title>Your Posts | UFIconnect</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <Layout>
        <div className="paginated-feed-page">
        <h1 className="page-title" style={{ marginBottom: 20 }}>Your Posts</h1>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18, alignItems: 'center' }}>
          <div className="tag tag-primary">{(total ?? posts.length).toLocaleString()} posts</div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={results.refresh}
            disabled={loading || refreshing}
            style={{ marginLeft: 'auto' }}
          >
            {refreshing ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Refresh'}
          </button>
        </div>

        {loading && posts.length === 0 ? (
          <div className="empty-state"><span className="spinner spinner-primary" /></div>
        ) : error && posts.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Your posts did not load</div>
            <p style={{ color: 'var(--muted)', fontSize: '.88rem', margin: '0 0 16px' }}>{error}</p>
            <button type="button" className="btn btn-primary btn-sm" onClick={results.retry}>Try again</button>
          </div>
        ) : posts.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>No posts yet</div>
            <Link to="/post" className="btn btn-primary btn-sm">Create a post</Link>
          </div>
        ) : (
          <>
            {posts.map(post => <OwnPostCard key={post.id} post={post} />)}
            {!hasMore && !error && (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '.8rem', padding: '12px 16px', marginBottom: 24 }}>
                You’re caught up.
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
