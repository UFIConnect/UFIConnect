import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';
import { SOURCE_META } from '../components/sourceMeta';
import { extractYouTubeId, deriveBlueskyPlaylistUrl, isDirectVideoUrl, InlineAutoplayVideo } from '../components/videoMedia';

function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

// A page dedicated to a single post — the "View on UFconnect" button in the
// maximized media viewer (ImageLightbox) routes here instead of sending
// people straight off-site to the original source, so there's somewhere to
// land, read the full content, and see/leave comments without ever leaving
// the app. Handles both external aggregated posts and internal
// (user-created) community posts — GET /feed/:id resolves either.
export default function PostDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);

  const [comments, setComments] = useState(null);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsHasMore, setCommentsHasMore] = useState(false);
  const [commentsLoadingMore, setCommentsLoadingMore] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentSending, setCommentSending] = useState(false);

  const loadPost = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    try {
      const { data } = await client.get(`/feed/${encodeURIComponent(id)}`);
      setPost(data.post || null);
      if (!data.post) setNotFound(true);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadComments = useCallback(async () => {
    setCommentsLoading(true);
    try {
      const { data } = await client.get(`/feed/${encodeURIComponent(id)}/comments`);
      setComments(data.comments || []);
      setCommentsHasMore(!!data.hasMore);
    } catch {
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  }, [id]);

  async function loadMoreComments() {
    if (commentsLoadingMore || !comments) return;
    setCommentsLoadingMore(true);
    try {
      const { data } = await client.get(`/feed/${encodeURIComponent(id)}/comments`, {
        params: { offset: comments.length },
      });
      setComments(prev => [...(prev || []), ...(data.comments || [])]);
      setCommentsHasMore(!!data.hasMore);
    } catch {
      // Leave existing comments in place — button stays clickable to retry.
    } finally {
      setCommentsLoadingMore(false);
    }
  }

  useEffect(() => { loadPost(); loadComments(); }, [loadPost, loadComments]);

  async function toggleLike() {
    if (!post || likeBusy) return;
    setLikeBusy(true);
    try {
      const { data } = await client.post(`/posts/${encodeURIComponent(post.id)}/like`);
      setPost(prev => ({ ...prev, ...(data.post || { likedByMe: data.likedByMe, likesCount: data.likesCount }) }));
    } catch { /* keep existing state if it fails */ }
    finally { setLikeBusy(false); }
  }

  async function submitComment(e) {
    e.preventDefault();
    const content = commentDraft.trim();
    if (!content || commentSending || post?.isExternal) return;
    setCommentSending(true);
    try {
      const { data } = await client.post(`/posts/${encodeURIComponent(post.id)}/comments`, { content });
      setComments(prev => [...(prev || []), {
        id: data.comment?.id || `local_${Date.now()}`,
        author: data.comment?.author?.name || profile?.name || 'You',
        body: content,
        score: 0,
        created: new Date().toISOString(),
      }]);
      setCommentDraft('');
      setPost(prev => ({ ...prev, commentsCount: data.commentsCount ?? (prev.commentsCount || 0) + 1 }));
    } catch { /* leave draft in place so the user can retry */ }
    finally { setCommentSending(false); }
  }

  if (loading) {
    return (
      <Layout>
        <div style={{ maxWidth: 640, margin: '40px auto', textAlign: 'center', color: 'var(--muted)' }}>
          <span className="spinner spinner-primary" />
        </div>
      </Layout>
    );
  }

  if (notFound || !post) {
    return (
      <Layout>
        <div style={{ maxWidth: 640, margin: '60px auto', textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>🔍</div>
          <h2 style={{ marginBottom: 8 }}>Post not found</h2>
          <p style={{ color: 'var(--muted)', marginBottom: 20 }}>
            It may have aged out of the feed, or the link is no longer valid.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>Back to Feed</button>
        </div>
      </Layout>
    );
  }

  const src = SOURCE_META[post.source] || SOURCE_META.uficonnect || { icon: '🌐', label: 'UFconnect', color: 'var(--primary)' };
  const isVideo = post.mediaType === 'video';
  const isImage = post.mediaType === 'image';
  const youtubeId = post.source === 'youtube' ? (post.embedId || extractYouTubeId(post.sourceUrl)) : null;
  const playlistUrl = isVideo && post.source === 'bluesky' ? deriveBlueskyPlaylistUrl(post.mediaUrl) : null;
  const directVideoUrl = isVideo && !playlistUrl && !youtubeId && post.mediaUrl && isDirectVideoUrl(post.mediaUrl) ? post.mediaUrl : null;
  const canComment = !post.isExternal;

  return (
    <Layout>
      <Helmet>
        <title>{post.title ? `${post.title} | UFconnect` : 'Post | UFconnect'}</title>
      </Helmet>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px' }}>
        <button onClick={() => navigate(-1)} className="btn btn-ghost btn-sm" style={{ marginBottom: 16 }}>
          ‹ Back
        </button>

        <div className="card post-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            {!post.isExternal && post.author?.id ? (
              <Link to={post.author.id === profile?.id ? '/profile' : `/u/${post.author.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'inherit' }}>
                <div className="avatar avatar-md">{initials(post.author?.name)}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '.88rem' }}>{post.author?.name || 'Member'}</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>{timeAgo(post.createdAt)}</div>
                </div>
              </Link>
            ) : (
              <>
                <span style={{ fontSize: '1rem' }}>{src.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '.82rem', color: src.color }}>{post.sourceLabel || src.label}</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>
                    {post.author?.name ? `${post.author.name} · ` : ''}{timeAgo(post.createdAt)}
                  </div>
                </div>
              </>
            )}
          </div>

          {post.title && <h1 style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0 0 10px', lineHeight: 1.4 }}>{post.title}</h1>}
          {post.content && (
            <p style={{ fontSize: '.92rem', lineHeight: 1.65, whiteSpace: 'pre-wrap', margin: '0 0 12px', color: 'var(--text)' }}>
              {post.content}
            </p>
          )}

          {youtubeId && (
            <div style={{ borderRadius: 14, overflow: 'hidden', aspectRatio: '16/9', marginBottom: 12 }}>
              <iframe width="100%" height="100%" src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&mute=1`}
                title={post.title} frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen style={{ display: 'block' }} />
            </div>
          )}
          {!youtubeId && (playlistUrl || directVideoUrl) && (
            <div style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 12, background: '#000' }}>
              <InlineAutoplayVideo kind={playlistUrl ? 'hls' : 'file'} src={playlistUrl || directVideoUrl} poster={post.mediaUrl}
                style={{ width: '100%', display: 'block', maxHeight: 480 }} />
            </div>
          )}
          {!youtubeId && !playlistUrl && !directVideoUrl && isImage && post.mediaUrl && (
            <div style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}>
              <img src={post.mediaUrl} alt="" style={{ width: '100%', display: 'block', maxHeight: 480, objectFit: 'contain', background: '#000' }} />
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            {!post.isExternal ? (
              <button
                onClick={toggleLike}
                disabled={likeBusy}
                className={post.likedByMe ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
              >
                {post.likedByMe ? 'Liked' : 'Like'} {post.likesCount || 0}
              </button>
            ) : (
              post.likesCount > 0 && <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>❤️ {post.likesCount.toLocaleString()}</span>
            )}
            {post.sourceUrl && (
              <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer"
                style={{ marginLeft: 'auto', fontSize: '.75rem', fontWeight: 700, color: src.color, textDecoration: 'none' }}>
                Open on {post.sourceLabel || src.label} ↗
              </a>
            )}
          </div>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ fontSize: '.82rem', fontWeight: 700, marginBottom: 12 }}>
            Comments {comments?.length > 0 ? `(${comments.length})` : ''}
          </div>

          {canComment && (
            <form onSubmit={submitComment} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                value={commentDraft}
                onChange={e => setCommentDraft(e.target.value)}
                placeholder="Add a comment…"
                className="input"
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn btn-primary btn-sm" disabled={!commentDraft.trim() || commentSending} style={{ minWidth: 56 }}>
                {commentSending ? <span className="spinner" /> : 'Post'}
              </button>
            </form>
          )}

          {commentsLoading && (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <span className="spinner spinner-primary" />
            </div>
          )}

          {!commentsLoading && (!comments || comments.length === 0) && (
            <p style={{ fontSize: '.82rem', color: 'var(--muted)', margin: 0 }}>No comments yet.</p>
          )}

          {!commentsLoading && comments?.map(c => (
            <div key={c.id} style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                background: `${src.color}18`, border: `1.5px solid ${src.color}33`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '.72rem', fontWeight: 700, color: src.color,
              }}>
                {(c.author?.replace(/^(?:u\/|@)/, '') || '?')[0]?.toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: '.78rem' }}>{c.author}</span>
                  {c.score > 0 && <span style={{ fontSize: '.68rem', color: 'var(--muted)' }}>▲ {c.score.toLocaleString()}</span>}
                  <span style={{ fontSize: '.68rem', color: 'var(--muted)', marginLeft: 'auto' }}>{timeAgo(c.created)}</span>
                </div>
                <p style={{ fontSize: '.83rem', lineHeight: 1.6, margin: 0, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{c.body}</p>
              </div>
            </div>
          ))}

          {!commentsLoading && commentsHasMore && (
            <button
              onClick={loadMoreComments}
              disabled={commentsLoadingMore}
              style={{
                display: 'block', margin: '0 0 4px', background: 'none', border: 'none',
                color: src.color, cursor: commentsLoadingMore ? 'default' : 'pointer',
                fontSize: '.8rem', fontWeight: 700, padding: 0,
              }}
            >
              {commentsLoadingMore ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Load more comments'}
            </button>
          )}
        </div>
      </div>
    </Layout>
  );
}
