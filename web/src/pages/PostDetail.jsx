import JobPostContent from '../components/JobPostContent';
import { isCareerPost } from '../utils/jobSummary.mjs';
import ArticleIllustration from '../components/ArticleIllustration';
import PostInlineText from '../components/PostInlineText';
import PostLinkPreviews from '../components/PostLinkPreviews';
import PostImage from '../components/PostImage';
import SourceMediaFallback from '../components/SourceMediaFallback';
import VimeoPreview from '../components/VimeoPreview';
import { extractVimeoId } from '../components/videoMedia';
﻿import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import GuestShell from '../components/GuestShell';
import PostLikes from '../components/PostLikes';
import ConnectedPostActions from '../components/ConnectedPostActions';
import { PostTime, PostOptionsMenu } from '../components/PostCardChrome';
import client from '../api/client';
import { SOURCE_META } from '../components/sourceMeta';
import BrandIcon, { hasBrandIcon } from '../components/BrandIcon';
import { extractYouTubeId, deriveBlueskyPlaylistUrl, isDirectVideoUrl, HlsVideoPlayer, loadYouTubeIframeApi, useGlobalMuted } from '../components/videoMedia';
import { SavePostButton } from '../components/SaveButtons';

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

function SourceMark({ source, label }) {
  const meta = SOURCE_META[source] || {};
  if (hasBrandIcon(source)) {
    return (
      <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)', flexShrink: 0 }}>
        <BrandIcon platform={source} size={16} />
      </span>
    );
  }
  return (
    <span style={{ width: 26, height: 26, borderRadius: '50%', background: `${meta.color || 'var(--primary)'}18`, color: meta.color || 'var(--primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900, flexShrink: 0 }}>
      {String(label || meta.icon || source || 'UFI').slice(0, 3).toUpperCase()}
    </span>
  );
}

// A page dedicated to a single post — the "View on UFIconnect" button in the
// maximized media viewer (ImageLightbox) routes here instead of sending
// people straight off-site to the original source, so there's somewhere to
// land, read the full content, and see/leave comments without ever leaving
// the app. Handles both external aggregated posts and internal
// (user-created) community posts — GET /feed/:id resolves either.

export default function PostDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile, token } = useAuth();
  const Shell = token ? Layout : GuestShell;

  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [comments, setComments] = useState(null);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsHasMore, setCommentsHasMore] = useState(false);
  const [commentsLoadingMore, setCommentsLoadingMore] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentSending, setCommentSending] = useState(false);

  // Shared across every video surface in the app (Feed, the Videos swipe
  // list, the lightbox) via useGlobalMuted — muting/unmuting here also
  // mutes/unmutes everything else, live, the same as everywhere else.
  // Called unconditionally, ahead of the loading/not-found early returns
  // below, same reason youtubeId is computed with optional chaining next:
  // React's hook order can't change between renders.
  const [muted, toggleMuted] = useGlobalMuted();
  const youtubeId = post?.source === 'youtube' ? (post.embedId || extractYouTubeId(post.sourceUrl)) : post?.mediaType === 'video' ? extractYouTubeId(post.mediaUrl) : null;
  const ytMountRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const fileVideoRef = useRef(null);

  // Real IFrame Player API, not a raw <iframe src="..."> — needed so the
  // mute button here can imperatively call mute()/unMute(), and so this
  // player can react when muted changes because of a click on some other
  // video elsewhere. Same pattern as ImageLightbox/VideoFeedView.
  useEffect(() => {
    if (!youtubeId) return;
    let cancelled = false;
    const startUnmuted = !muted;
    loadYouTubeIframeApi().then((YT) => {
      if (cancelled || !ytMountRef.current) return;
      const player = new YT.Player(ytMountRef.current, {
        videoId: youtubeId,
        playerVars: { autoplay: 1, mute: 1, playsinline: 1, modestbranding: 1, rel: 0, origin: window.location.origin },
        events: {
          onReady: (e) => {
            if (cancelled) return;
            ytPlayerRef.current = e.target;
            if (startUnmuted) e.target.unMute();
            e.target.playVideo();
          },
        },
      });
    }).catch(() => {});
    return () => {
      cancelled = true;
      try { ytPlayerRef.current?.destroy(); } catch {}
      ytPlayerRef.current = null;
    };
  }, [youtubeId]);

  useEffect(() => {
    if (!youtubeId || !ytPlayerRef.current) return;
    if (muted) ytPlayerRef.current.mute(); else ytPlayerRef.current.unMute();
  }, [muted, youtubeId]);

  // Same live-sync gap HlsVideoPlayer's own comment explains: the `muted`
  // JSX prop on a <video> element doesn't reliably keep the *live* element
  // in sync with prop changes after mount, so this page's own direct-file
  // <video> needs the same imperative correction on every muted change.
  useEffect(() => {
    if (fileVideoRef.current) fileVideoRef.current.muted = muted;
  }, [muted]);

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
      <Shell>
        <div style={{ maxWidth: 640, margin: '40px auto', textAlign: 'center', color: 'var(--muted)' }}>
          <span className="spinner spinner-primary" />
        </div>
      </Shell>
    );
  }

  if (notFound || !post) {
    return (
      <Shell>
        <div style={{ maxWidth: 640, margin: '60px auto', textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: '.9rem', fontWeight: 800, marginBottom: 12 }}>Q</div>
          <h2 style={{ marginBottom: 8 }}>Post not found</h2>
          <p style={{ color: 'var(--muted)', marginBottom: 20 }}>
            It may have aged out of the feed, or the link is no longer valid.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>Back to Home</button>
        </div>
      </Shell>
    );
  }

  const src = SOURCE_META[post.source] || SOURCE_META.uficonnect || { icon: 'UFI', label: 'UFIconnect', color: 'var(--primary)' };
  const isVideo = post.mediaType === 'video';
  const isImage = post.mediaType === 'image';
  const vimeoId = isVideo ? extractVimeoId(post.mediaUrl || post.sourceUrl) : null;
  const playlistUrl = isVideo && post.source === 'bluesky' ? deriveBlueskyPlaylistUrl(post.mediaUrl) : null;
  const directVideoUrl = isVideo && !playlistUrl && !youtubeId && post.mediaUrl && isDirectVideoUrl(post.mediaUrl, post) ? post.mediaUrl : null;
  const canComment = !post.isExternal && !!token;

  return (
    <Shell>
      <Helmet>
        <title>{post.title ? `${post.title} | UFIconnect` : 'Post | UFIconnect'}</title>
      </Helmet>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px' }}>
        <button onClick={() => navigate(-1)} className="btn btn-ghost btn-sm" style={{ marginBottom: 16 }}>
          ‹ Back
        </button>

        <div className="card post-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            {!post.isExternal && post.author?.id ? (
              <>
                <Link to={post.author.id === profile?.id ? '/profile' : `/u/${encodeURIComponent(post.author.id)}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="avatar avatar-md">{initials(post.author?.name)}</div>
                </Link>
                <div>
                  <Link to={post.author.id === profile?.id ? '/profile' : `/u/${encodeURIComponent(post.author.id)}`} style={{ fontWeight: 700, fontSize: '.88rem', textDecoration: 'none', color: 'inherit' }}>{post.author?.name || 'Member'}</Link>
                  <PostTime post={post} />
                </div>
              </>
            ) : (
              <>
                <SourceMark source={post.source} label={src.icon} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '.82rem', color: src.color }}>{post.sourceLabel || src.label}</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>
                    {post.author?.name || ''}<PostTime post={post} />
                  </div>
                </div>
              </>
            )}
          </div>

          {post.title && <h1 style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0 0 10px', lineHeight: 1.4, overflowWrap: 'break-word', wordBreak: 'break-word' }}><PostInlineText text={post.title} /></h1>}
          {isCareerPost(post) ? <JobPostContent post={post} /> : post.content && (
            <p style={{ fontSize: '.92rem', lineHeight: 1.65, whiteSpace: 'pre-wrap', margin: '0 0 12px', color: 'var(--text)', overflowWrap: 'break-word', wordBreak: 'break-word' }}>
              <PostInlineText text={post.content} />
            </p>
          )}

          <ArticleIllustration post={post} />
          {vimeoId && <VimeoPreview id={vimeoId} title={post.title} />}
          {isVideo && !youtubeId && !vimeoId && !playlistUrl && !directVideoUrl && <SourceMediaFallback post={post} />}
          {youtubeId && (
            // Real IFrame Player API (see the effects above), not a raw
            // <iframe src="...">, so this button can actually mute/unmute
            // it, and so an unmute anywhere else in the app (Feed, Videos,
            // the lightbox) is reflected here live too.
            <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', aspectRatio: '16/9', marginBottom: 12, background: '#000' }}>
              <div ref={ytMountRef} style={{ width: '100%', height: '100%' }} />
              <button
                onClick={() => toggleMuted()}
                aria-label={muted ? 'Unmute' : 'Mute'}
                style={{ position: 'absolute', top: 12, right: 12, width: 38, height: 38, borderRadius: '50%', background: 'rgba(0,0,0,.55)', border: 'none', color: '#fff', fontSize: '1.05rem', cursor: 'pointer' }}
              >{muted ? 'M' : 'S'}</button>
            </div>
          )}
          {!youtubeId && (playlistUrl || directVideoUrl) && (
            // This is the single dedicated post page, not a scrolling
            // preview, so native controls stay on for seek/fullscreen — but
            // mute now goes through the same shared toggle every other
            // video surface uses (see useGlobalMuted above), not a one-time
            // read of the stored preference, so it both reacts to an
            // unmute elsewhere and broadcasts its own.
            <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', marginBottom: 12, background: '#000' }}>
              {playlistUrl ? (
                <HlsVideoPlayer src={playlistUrl} poster={post.mediaPoster} autoPlay muted={muted}
                  style={{ width: '100%', display: 'block', maxHeight: 480 }} />
              ) : (
                <video ref={fileVideoRef} src={directVideoUrl} poster={post.mediaPoster} controls autoPlay playsInline
                  muted={muted} style={{ width: '100%', display: 'block', maxHeight: 480, background: '#000' }} />
              )}
              <button
                onClick={() => toggleMuted()}
                aria-label={muted ? 'Unmute' : 'Mute'}
                style={{ position: 'absolute', top: 12, right: 12, width: 38, height: 38, borderRadius: '50%', background: 'rgba(0,0,0,.55)', border: 'none', color: '#fff', fontSize: '1.05rem', cursor: 'pointer' }}
              >{muted ? 'M' : 'S'}</button>
            </div>
          )}
          {!youtubeId && !playlistUrl && !directVideoUrl && isImage && post.mediaUrl && (
            <div style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}>
              <PostImage post={post} style={{ width: '100%', display: 'block', maxHeight: 480, objectFit: 'contain', background: 'var(--surface)' }} />
            </div>
          )}

          <PostLinkPreviews post={post} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <PostLikes post={post} onPostUpdated={updated => setPost(current => ({ ...current, ...updated }))} />
            {token && <SavePostButton post={post} className="btn btn-ghost btn-sm save-item-button" />}
            <PostOptionsMenu post={post} onPostUpdated={updated => setPost(previous => ({ ...previous, ...updated }))} onRemoved={() => navigate('/')} />
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
          {post.isExternal && <ConnectedPostActions post={post} />}

          {!post.isExternal && !token && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 10 }}>
              <span style={{ fontSize: '.82rem', color: 'var(--muted)' }}>Sign in to join the conversation.</span>
              <Link to="/login"><button className="btn btn-primary btn-sm" type="button">Sign in</button></Link>
            </div>
          )}

          {canComment && (
            <form onSubmit={submitComment} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                value={commentDraft}
                onChange={e => setCommentDraft(e.target.value)}
                placeholder="Add a comment…"
                className="input"
                maxLength={1000}
                aria-label="Add a comment"
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
                <p style={{ fontSize: '.83rem', lineHeight: 1.6, margin: 0, color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'break-word' }}>{c.body}</p>
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

    </Shell>
  );
}
