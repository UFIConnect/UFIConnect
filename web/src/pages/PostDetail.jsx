import { timeAgo } from '../utils/postTime.mjs';
import JobPostContent from '../components/JobPostContent';
import { isCareerPost } from '../utils/jobSummary.mjs';
import ArticleIllustration from '../components/ArticleIllustration';
import PostInlineText from '../components/PostInlineText';
import PostLinkPreviews from '../components/PostLinkPreviews';
import PostImage from '../components/PostImage';
import SourceMediaFallback from '../components/SourceMediaFallback';
import VimeoPreview from '../components/VimeoPreview';
import MediaPlaybackControls from '../components/MediaPlaybackControls';
import { resolveVideoSource } from '../utils/videoSource.mjs';
﻿import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import GuestShell from '../components/GuestShell';
import PostLikes from '../components/PostLikes';
import ConnectedPostActions from '../components/ConnectedPostActions';
import { OpenOnSource, PostHeader, PostOptionsMenu } from '../components/PostCardChrome';
import client from '../api/client';
import { SOURCE_META } from '../components/sourceMeta';
import BrandIcon, { hasBrandIcon } from '../components/BrandIcon';
import { HlsVideoPlayer, loadYouTubeIframeApi, createYouTubePlayerFrame, useGlobalMuted, rememberSoundPreference } from '../components/videoMedia';
import { SavePostButton } from '../components/SaveButtons';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';
import { POST_ENGAGEMENT_EVENT, publishPostEngagement, sourceComment } from '../api/postEngagement.mjs';

const ENGAGEMENT_FIELDS = ['likesCount', 'sourceLikesCount', 'likedByMe', 'sourceLikedByMe', 'commentsCount'];
function mergePostComments(...lists) {
  const seen = new Set();
  return lists.flat().filter(comment => {
    if (!comment?.id || seen.has(comment.id)) return false;
    seen.add(comment.id);
    return true;
  });
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
  const [commentsError, setCommentsError] = useState(false);
  const scope = `${profile?.id || ''}:${id}`;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const mountedRef = useRef(false);
  const postReadRef = useRef(null);
  const commentsReadRef = useRef(null);
  const commentWriteRef = useRef(null);
  const engagementRevisionRef = useRef(0);
  const commentsRevisionRef = useRef(0);
  const commentsCountRef = useRef(null);
  const detailRef = useRef(null);
  detailRef.current = { post, comments };

  // Shared across every video surface in the app (Feed, the Videos swipe
  // list, the lightbox) via useGlobalMuted — muting/unmuting here also
  // mutes/unmutes everything else, live, the same as everywhere else.
  // Called unconditionally, ahead of the loading/not-found early returns
  // below, same reason youtubeId is computed with optional chaining next:
  // React's hook order can't change between renders.
  const [muted, toggleMuted] = useGlobalMuted();
  const videoSource = resolveVideoSource(post);
  const youtubeId = videoSource?.kind === 'youtube' ? videoSource.id : null;
  const ytMountRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const fileVideoRef = useRef(null);
  const [ytReady, setYtReady] = useState(false);
  const [ytFailed, setYtFailed] = useState(false);
  const [ytVisible, setYtVisible] = useState(false);
  const ytAutoplayAttemptedRef = useRef(false);
  const [playback, setPlayback] = useState({ paused: true, muted: true, currentTime: 0, duration: 0 });

  useEffect(() => {
    setYtVisible(false);
    const host = ytMountRef.current;
    if (!youtubeId || loading || !host) return;
    let inView = false;
    const updateVisibility = () => {
      setYtVisible(inView && !document.hidden);
      if (document.hidden) {
        try { ytPlayerRef.current?.pauseVideo(); } catch {}
      }
    };
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting && entry.intersectionRatio > 0.5;
      updateVisibility();
    }, { threshold: [0, 0.5, 0.500001, 1] }) : null;
    observer?.observe(host);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, [youtubeId, loading]);

  // Real IFrame Player API, not a raw <iframe src="..."> — needed so the
  // mute button here can imperatively call mute()/unMute(), and so this
  // player can react when muted changes because of a click on some other
  // video elsewhere. Same pattern as ImageLightbox/VideoFeedView.
  useEffect(() => {
    setYtReady(false);
    setYtFailed(false);
    ytAutoplayAttemptedRef.current = false;
    if (!youtubeId || loading) return;
    const host = ytMountRef.current;
    if (!host) return;
    let cancelled = false;
    let player;
    host.replaceChildren();
    const playerVars = { autoplay: 0, mute: 1, playsinline: 1, controls: 0, rel: 0, origin: window.location.origin };
    const mount = createYouTubePlayerFrame(host, youtubeId, playerVars, post?.title || 'YouTube video');
    const readyTimeout = setTimeout(() => { if (!cancelled) setYtFailed(true); }, 6000);
    loadYouTubeIframeApi().then((YT) => {
      if (cancelled || !mount.isConnected) return;
      player = new YT.Player(mount, {
        videoId: youtubeId,
        playerVars,
        events: {
          onReady: (e) => {
            if (cancelled) { try { e.target.destroy(); } catch {} return; }
            clearTimeout(readyTimeout);
            ytPlayerRef.current = e.target;
            setYtReady(true);
            setYtFailed(false);
            try {
              e.target.mute();
            } catch { setYtFailed(true); }
          },
          onError: () => { if (!cancelled) { clearTimeout(readyTimeout); setYtReady(false); setYtFailed(true); } },
        },
      });
      ytPlayerRef.current = player;
    }).catch(() => { if (!cancelled) setYtFailed(true); });
    return () => {
      cancelled = true;
      clearTimeout(readyTimeout);
      try { player?.destroy(); } catch {}
      if (ytPlayerRef.current === player) ytPlayerRef.current = null;
      try { host.replaceChildren(); } catch {}
    };
  }, [youtubeId, loading]);

  useEffect(() => {
    const player = ytPlayerRef.current;
    if (!ytReady || loading || player?.getVideoData?.()?.video_id !== youtubeId) return;
    try {
      if (!ytVisible) player.pauseVideo();
      else if (!ytAutoplayAttemptedRef.current) {
        ytAutoplayAttemptedRef.current = true;
        player.mute();
        player.playVideo();
      }
    } catch {}
  }, [ytReady, ytVisible, youtubeId, loading]);

  useEffect(() => {
    setPlayback({ paused: true, muted: true, currentTime: 0, duration: 0 });
    if (loading) return;
    const readPlayback = () => {
      try {
        if (youtubeId) {
          const player = ytPlayerRef.current;
          if (!ytReady || player?.getVideoData?.()?.video_id !== youtubeId) return;
          const state = player.getPlayerState();
          setPlayback({ paused: state !== 1 && state !== 3, muted: player.isMuted?.() ?? true, currentTime: player.getCurrentTime() || 0, duration: player.getDuration() || 0 });
        } else if (fileVideoRef.current) {
          const video = fileVideoRef.current;
          setPlayback({ paused: video.paused, currentTime: video.currentTime || 0, duration: video.duration || 0 });
        }
      } catch {}
    };
    readPlayback();
    const interval = setInterval(readPlayback, 250);
    return () => clearInterval(interval);
  }, [loading, post?.id, youtubeId, ytReady]);

  function togglePlayback() {
    try {
      if (youtubeId) {
        const player = ytPlayerRef.current;
        if (!ytReady || player?.getVideoData?.()?.video_id !== youtubeId) return;
        ytAutoplayAttemptedRef.current = true;
        const state = player.getPlayerState();
        if (state === 1 || state === 3) player.pauseVideo(); else if (!document.hidden) player.playVideo();
      } else {
        const video = fileVideoRef.current;
        if (!video) return;
        if (video.paused) video.play().catch(() => {}); else video.pause();
      }
    } catch {}
  }

  function seekPlayback(seconds) {
    if (!Number.isFinite(seconds)) return;
    try {
      if (youtubeId) {
        const player = ytPlayerRef.current;
        if (ytReady && player?.getVideoData?.()?.video_id === youtubeId) player.seekTo(seconds, true);
      } else if (fileVideoRef.current) fileVideoRef.current.currentTime = seconds;
    } catch {}
  }

  function togglePlaybackMuted() {
    if (!youtubeId) { toggleMuted(); return; }
    const player = ytPlayerRef.current;
    if (!ytReady || player?.getVideoData?.()?.video_id !== youtubeId) return;
    try {
      const nextMuted = !(player.isMuted?.() ?? playback.muted);
      if (nextMuted) player.mute(); else player.unMute();
      setPlayback(previous => ({ ...previous, muted: nextMuted }));
      rememberSoundPreference(!nextMuted);
    } catch {}
  }

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

  const updatePost = useCallback(updated => {
    if (!updated?.id || updated.id !== id || !mountedRef.current) return;
    engagementRevisionRef.current += 1;
    setPost(previous => previous?.id === id ? { ...previous, ...updated } : previous);
  }, [id]);

  const loadPost = useCallback(({ background = true } = {}) => {
    if (postReadRef.current?.scope === scope) return postReadRef.current.promise;
    const request = { scope, revision: engagementRevisionRef.current, commentsRevision: commentsRevisionRef.current, controller: new AbortController() };
    postReadRef.current = request;
    if (!background) { setLoading(true); setNotFound(false); }
    const isCurrent = () => mountedRef.current && scopeRef.current === scope && postReadRef.current === request;
    request.promise = (async () => {
      try {
        const { data } = await client.get(`/feed/${encodeURIComponent(id)}`, { signal: request.controller.signal });
        if (!isCurrent()) return;
        if (!data.post) { if (!background) setNotFound(true); return; }
        setPost(previous => {
          const latest = { ...data.post };
          if (previous?.id === id && latest.sourceLikedByMe === undefined && previous.sourceLikedByMe !== undefined) latest.sourceLikedByMe = previous.sourceLikedByMe;
          if (previous?.id === id && request.revision !== engagementRevisionRef.current) {
            for (const field of ENGAGEMENT_FIELDS) if (previous[field] !== undefined) latest[field] = previous[field];
          } else if (request.commentsRevision !== commentsRevisionRef.current && commentsCountRef.current?.scope === scope) latest.commentsCount = commentsCountRef.current.count;
          return latest;
        });
        setNotFound(false);
      } catch {
        if (isCurrent() && !background) setNotFound(true);
      } finally {
        if (isCurrent()) { postReadRef.current = null; setLoading(false); }
      }
    })();
    return request.promise;
  }, [id, scope]);

  const loadComments = useCallback(({ background = true, append = false } = {}) => {
    if (commentWriteRef.current?.scope === scope) return Promise.resolve();
    if (commentsReadRef.current?.scope === scope) return commentsReadRef.current.promise;
    const current = detailRef.current.comments || [];
    const limit = Math.min(50, Math.max(20, current.length));
    const request = { scope, revision: engagementRevisionRef.current, controller: new AbortController() };
    commentsReadRef.current = request;
    if (append) setCommentsLoadingMore(true);
    else if (!background || !current.length) setCommentsLoading(true);
    const isCurrent = () => mountedRef.current && scopeRef.current === scope && commentsReadRef.current === request;
    request.promise = (async () => {
      try {
        const { data } = await client.get(`/feed/${encodeURIComponent(id)}/comments`, {
          signal: request.controller.signal, params: { limit, ...(append ? { offset: current.filter(comment => !comment.ufiConfirmed).length } : {}) },
        });
        if (!isCurrent() || request.revision !== engagementRevisionRef.current) return;
        if (data.unavailable) throw new Error('Comments are temporarily unavailable.');
        const incoming = data.comments || [];
        setComments(previous => append ? mergePostComments(previous || [], incoming) : mergePostComments(incoming, (previous || []).slice(limit)));
        setCommentsHasMore(!!data.hasMore);
        setCommentsError(false);
        const count = Number.isFinite(data.commentsCount) ? data.commentsCount : Number.isFinite(data.total) ? data.total : null;
        if (count !== null) {
          commentsRevisionRef.current += 1;
          commentsCountRef.current = { scope, count };
          setPost(previous => previous?.id === id ? { ...previous, commentsCount: count } : previous);
        }
      } catch {
        if (isCurrent()) setCommentsError(true);
      } finally {
        if (isCurrent()) { commentsReadRef.current = null; setCommentsLoading(false); setCommentsLoadingMore(false); }
      }
    })();
    return request.promise;
  }, [id, scope]);

  const refreshDetail = useCallback(() => Promise.all([loadPost(), loadComments()]), [loadPost, loadComments]);
  const scrollRefresh = useScrollToRefresh(refreshDetail, { enabled: !loading && !commentSending });

  useEffect(() => {
    mountedRef.current = true;
    setPost(null); setComments(null); setCommentsError(false); setCommentDraft(''); setCommentSending(false);
    setCommentsHasMore(false); setCommentsLoadingMore(false);
    loadPost({ background: false }); loadComments({ background: false });
    return () => {
      mountedRef.current = false;
      postReadRef.current?.controller.abort(); postReadRef.current = null;
      commentsReadRef.current?.controller.abort(); commentsReadRef.current = null;
      commentWriteRef.current = null;
    };
  }, [loadPost, loadComments]);

  useEffect(() => {
    const refreshVisible = () => { if (!document.hidden && detailRef.current.post?.id === id && !commentWriteRef.current) refreshDetail(); };
    const onConfirmed = ({ detail }) => {
      const current = detailRef.current.post;
      if (!current || detail?.postId !== id || detail.source !== (current.source || 'uficonnect')) return;
      const patch = { id };
      for (const field of ENGAGEMENT_FIELDS) if (detail[field] !== undefined) patch[field] = detail[field];
      updatePost(patch);
      if (detail.action === 'comment' && !commentWriteRef.current) {
        if (detail.comment) setComments(previous => mergePostComments(previous || [], sourceComment(detail.comment)));
        commentsReadRef.current?.controller.abort(); commentsReadRef.current = null;
        loadComments();
      }
    };
    const timer = window.setInterval(refreshVisible, 15000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    window.addEventListener(POST_ENGAGEMENT_EVENT, onConfirmed);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
      window.removeEventListener(POST_ENGAGEMENT_EVENT, onConfirmed);
    };
  }, [id, refreshDetail, updatePost, loadComments]);

  function loadMoreComments() { return loadComments({ append: true }); }

  async function submitComment(e) {
    e.preventDefault();
    const content = commentDraft.trim();
    if (!content || commentWriteRef.current || post?.isExternal) return;
    const request = { scope };
    commentWriteRef.current = request;
    engagementRevisionRef.current += 1;
    commentsReadRef.current?.controller.abort(); commentsReadRef.current = null;
    setCommentsLoading(false); setCommentsLoadingMore(false);
    setCommentSending(true);
    try {
      const { data } = await client.post(`/posts/${encodeURIComponent(post.id)}/comments`, { content });
      if (!mountedRef.current || scopeRef.current !== scope || commentWriteRef.current !== request) return;
      setComments(prev => mergePostComments(prev || [], {
        id: data.comment?.id || `local_${Date.now()}`,
        author: data.comment?.author?.name || profile?.name || 'You',
        body: content,
        score: 0,
        created: new Date().toISOString(),
      }));
      setCommentDraft('');
      setCommentsError(false);
      const commentsCount = data.commentsCount ?? data.post?.commentsCount ?? (detailRef.current.post?.commentsCount || 0) + 1;
      updatePost({ id, commentsCount });
      publishPostEngagement(post, { action: 'comment', commentsCount, commentId: data.comment?.id, comment: data.comment });
    } catch { /* leave draft in place so the user can retry */ }
    finally {
      if (mountedRef.current && scopeRef.current === scope && commentWriteRef.current === request) {
        commentWriteRef.current = null; setCommentSending(false);
      }
    }
  }

  if (loading || (post && post.id !== id)) {
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
  const isVideo = Boolean(videoSource) || post.mediaType === 'video';
  const isImage = !videoSource && post.mediaType === 'image';
  const vimeoId = videoSource?.kind === 'vimeo' ? videoSource.id : null;
  const playlistUrl = videoSource?.kind === 'hls' ? videoSource.src : null;
  const directVideoUrl = videoSource?.kind === 'file' ? videoSource.src : null;
  const canComment = !post.isExternal && !!token;

  return (
    <Shell>
      <Helmet>
        <title>{post.title ? `${post.title} | UFIconnect` : 'Post | UFIconnect'}</title>
      </Helmet>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px' }}>
        {scrollRefresh.refreshing && <p role="status" style={{ color: 'var(--muted)', fontSize: '.82rem' }}>Refreshing post and comments…</p>}
        <button onClick={() => navigate(-1)} className="btn btn-ghost btn-sm" style={{ marginBottom: 16 }}>
          ‹ Back
        </button>

        <div className="card post-card">
          <PostHeader post={post} member={!post.isExternal} />

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
            <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', aspectRatio: '16/9', marginBottom: 12, background: '#000' }}>
              <div ref={ytMountRef} style={{ width: '100%', height: '100%' }} />
            </div>
          )}
          {!youtubeId && (playlistUrl || directVideoUrl) && (
            <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', marginBottom: 12, background: '#000' }}>
              {playlistUrl ? (
                <HlsVideoPlayer videoRef={fileVideoRef} src={playlistUrl} poster={post.mediaPoster} autoPlay muted={muted} controls={false} onClick={togglePlayback}
                  style={{ width: '100%', display: 'block', maxHeight: 480 }} />
              ) : (
                <video ref={fileVideoRef} src={directVideoUrl} poster={post.mediaPoster} controls={false} autoPlay playsInline onClick={togglePlayback}
                  muted={muted} style={{ width: '100%', display: 'block', maxHeight: 480, background: '#000' }} />
              )}
            </div>
          )}
          {(youtubeId || playlistUrl || directVideoUrl) && !ytFailed && <MediaPlaybackControls
            mediaKey={`${post.id || ''}:${videoSource.kind}:${videoSource.id || videoSource.src}`}
            paused={playback.paused} muted={youtubeId ? playback.muted : muted} currentTime={playback.currentTime} duration={playback.duration}
            onTogglePlay={togglePlayback} onToggleMute={togglePlaybackMuted} onSeek={seekPlayback}
            disabled={Boolean(youtubeId && !ytReady)} />}
          {youtubeId && ytFailed && <p role="status">Playback is unavailable here. <a href={`https://www.youtube.com/watch?v=${youtubeId}`} target="_blank" rel="noopener noreferrer">Open on YouTube</a></p>}
          {!youtubeId && !playlistUrl && !directVideoUrl && isImage && post.mediaUrl && (
            <div style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}>
              <PostImage post={post} style={{ width: '100%', display: 'block', maxHeight: 480, objectFit: 'contain', background: 'var(--surface)' }} />
            </div>
          )}

          <PostLinkPreviews post={post} />
          <div className="post-chrome-actions" style={{ paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <PostLikes post={post} onPostUpdated={updatePost} />
            {token && <SavePostButton post={post} className="btn btn-ghost btn-sm save-item-button" />}
            <PostOptionsMenu post={post} onPostUpdated={updatePost} onRemoved={() => navigate('/')} />
            <OpenOnSource post={post} />
          </div>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ fontSize: '.82rem', fontWeight: 700, marginBottom: 12 }}>
            Comments {Number.isFinite(post.commentsCount) ? `(${post.commentsCount})` : comments?.length > 0 ? `(${comments.length})` : ''}
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

          {commentsError && <p role="alert" style={{ color: 'var(--danger)', fontSize: '.82rem' }}>
            Comments could not be refreshed. <button type="button" className="btn btn-ghost btn-sm" onClick={() => loadComments()}>Retry</button>
          </p>}
          {!commentsLoading && !commentsError && (!comments || comments.length === 0) && (
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
