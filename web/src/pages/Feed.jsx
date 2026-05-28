import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

const SOURCE_META = {
  reddit:        { label: 'Reddit',        color: '#FF4500', icon: '🟠' },
  devto:         { label: 'DEV Community', color: '#3B49DF', icon: '👩‍💻' },
  linkedin:      { label: 'LinkedIn',      color: '#0A66C2', icon: '💼' },
  twitter:       { label: 'X (Twitter)',   color: '#000000', icon: '𝕏' },
  facebook:      { label: 'Facebook',      color: '#1877F2', icon: '🔵' },
  instagram:     { label: 'Instagram',     color: '#E1306C', icon: '📸' },
  tiktok:        { label: 'TikTok',        color: '#010101', icon: '🎵' },
  github:        { label: 'GitHub',        color: '#24292F', icon: '🐙' },
  youtube:       { label: 'YouTube',       color: '#FF0000', icon: '▶️' },
  medium:        { label: 'Medium',        color: '#1A8917', icon: '📝' },
  discord:       { label: 'Discord',       color: '#5865F2', icon: '💬' },
  stackoverflow: { label: 'Stack Overflow',color: '#F48024', icon: '📚' },
  mastodon:      { label: 'Mastodon',      color: '#6364FF', icon: '🦣' },
  lobsters:      { label: 'Lobsters',      color: '#AC130D', icon: '🦞' },
  arxiv:         { label: 'arXiv',         color: '#B31B1B', icon: '🔬' },
  indeed:        { label: 'Indeed',        color: '#2557A7', icon: '💼' },
  uficonnect:    { label: 'UFIConnect',    color: 'var(--primary)', icon: '🌐' },
};

const CATEGORY_COLORS = {
  'AI & ML':     { text: '#2563EB', bg: '#EFF6FF' },
  'Engineering': { text: '#7C3AED', bg: '#F3EEFF' },
  'Startups':    { text: '#D97706', bg: '#FFFBEB' },
  'Design':      { text: '#DB2777', bg: '#FDF2F8' },
  'Marketing':   { text: '#059669', bg: '#ECFDF5' },
  'Finance':     { text: '#0284C7', bg: '#F0F9FF' },
  'Remote Work': { text: '#EA580C', bg: '#FFF7ED' },
  'Education':   { text: '#7C3AED', bg: '#F3EEFF' },
  'Social':      { text: '#6B7280', bg: '#F9FAFB' },
};
function catStyle(cat) {
  return CATEGORY_COLORS[cat] || { text: 'var(--primary)', bg: 'var(--primary-light)' };
}

function PostText({ text }) {
  if (!text) return null;
  return (
    <p className="post-content" style={{ margin: '0 0 4px', whiteSpace: 'pre-wrap', lineHeight: 1.65 }}>
      {text}
    </p>
  );
}

/** Full-screen video modal for non-YouTube video posts */
function VideoModal({ post, onClose }) {
  const src = SOURCE_META[post.source] || SOURCE_META.uficonnect;
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface)', borderRadius: 20,
          maxWidth: 520, width: '100%', maxHeight: '90vh',
          overflow: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,.6)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Thumbnail */}
        {post.mediaUrl && (
          <div style={{ position: 'relative', background: '#000', borderRadius: '20px 20px 0 0', overflow: 'hidden' }}>
            <img
              src={post.mediaUrl} alt=""
              style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 320, opacity: 0.9 }}
            />
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                width: 72, height: 72, borderRadius: '50%',
                background: `${src.color}e0`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 24px rgba(0,0,0,.5)',
              }}>
                <span style={{ color: '#fff', fontSize: '2rem', marginLeft: 4 }}>▶</span>
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                position: 'absolute', top: 12, right: 12,
                background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: '50%',
                width: 36, height: 36, color: '#fff', fontSize: '1.2rem',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >×</button>
          </div>
        )}

        <div style={{ padding: '16px 20px 20px' }}>
          {/* Source + time */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: '.9rem' }}>{src.icon}</span>
            <span style={{ fontWeight: 700, fontSize: '.78rem', color: src.color }}>{post.sourceLabel || src.label}</span>
            <span style={{ fontSize: '.72rem', color: 'var(--muted)', marginLeft: 'auto' }}>{timeAgo(post.createdAt)}</span>
          </div>

          {/* Author */}
          {post.author?.name && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: `${src.color}20`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '.8rem', flexShrink: 0,
              }}>{src.icon}</div>
              <span style={{ fontWeight: 700, fontSize: '.85rem' }}>{post.author.name}</span>
            </div>
          )}

          {post.title && (
            <p style={{ fontWeight: 700, fontSize: '.98rem', margin: '0 0 10px', lineHeight: 1.4 }}>{post.title}</p>
          )}
          {post.content && (
            <p style={{ fontSize: '.88rem', lineHeight: 1.65, margin: '0 0 18px', whiteSpace: 'pre-wrap', color: 'var(--text)' }}>
              {post.content}
            </p>
          )}

          {/* Engagement */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 18, fontSize: '.78rem', color: 'var(--muted)' }}>
            {post.likesCount > 0 && <span>❤️ {post.likesCount.toLocaleString()}</span>}
            {post.commentsCount > 0 && <span>💬 {post.commentsCount.toLocaleString()}</span>}
          </div>

          {/* CTA */}
          {post.sourceUrl && (
            <a
              href={post.sourceUrl} target="_blank" rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: src.color === '#010101' ? '#010101' : src.color,
                color: '#fff', textDecoration: 'none',
                padding: '13px 20px', borderRadius: 12,
                fontWeight: 700, fontSize: '.9rem',
              }}
            >
              {src.icon} Watch on {src.label} ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/** YouTube embed card */
function YouTubeCard({ post }) {
  const [playing, setPlaying] = useState(false);
  const src = SOURCE_META.youtube;
  const c   = catStyle(post.group?.category);
  return (
    <div className="card post-card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: '1rem', color: src.color }}>{src.icon}</span>
        <span style={{ fontSize: '.72rem', fontWeight: 700, color: src.color }}>YouTube</span>
        {post.group && (
          <span style={{ fontSize: '.68rem', fontWeight: 600, background: c.bg, color: c.text, padding: '2px 7px', borderRadius: 5 }}>
            {post.group.name}
          </span>
        )}
        {post.topic && (
          <span style={{ fontSize: '.65rem', color: 'var(--muted)', background: 'var(--border)', padding: '2px 6px', borderRadius: 4 }}>
            🏷 {post.topic}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '.7rem', color: 'var(--muted)' }}>{timeAgo(post.createdAt)}</span>
      </div>

      <p style={{ fontWeight: 700, fontSize: '.95rem', margin: '0 0 10px', lineHeight: 1.4 }}>{post.title}</p>

      {post.embedId ? (
        playing ? (
          <div style={{ borderRadius: 14, overflow: 'hidden', aspectRatio: '16/9', marginBottom: 10 }}>
            <iframe width="100%" height="100%"
              src={`https://www.youtube.com/embed/${post.embedId}?autoplay=1`}
              title={post.title} frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen style={{ display: 'block' }}
            />
          </div>
        ) : (
          <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', cursor: 'pointer', marginBottom: 10 }}
            onClick={() => setPlaying(true)}>
            {post.mediaUrl && (
              <img src={post.mediaUrl} alt={post.title}
                style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 280 }} />
            )}
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#FF0000', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 20px rgba(0,0,0,.4)' }}>
                <span style={{ color: '#fff', fontSize: '1.7rem', marginLeft: 4 }}>▶</span>
              </div>
            </div>
          </div>
        )
      ) : post.mediaUrl ? (
        <div style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 10 }}>
          <img src={post.mediaUrl} alt={post.title} style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 280 }} />
        </div>
      ) : null}

      {post.content && <PostText text={post.content} />}

      {post.sourceUrl && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: src.color }}>
            <span style={{ fontSize: '.75rem' }}>{src.icon}</span>
            <span style={{ fontSize: '.7rem', color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {post.sourceUrl}
            </span>
            <span style={{ fontSize: '.65rem', fontWeight: 700, color: src.color, background: `${src.color}14`, padding: '2px 7px', borderRadius: 4, flexShrink: 0 }}>
              ▶️ Watch ↗
            </span>
          </a>
        </div>
      )}
    </div>
  );
}

/** Unified post card — handles all sources */
function PostCard({ post, onVideoOpen }) {
  const c   = catStyle(post.group?.category);
  const src = SOURCE_META[post.source] || SOURCE_META.uficonnect;

  if (post.source === 'youtube') return <YouTubeCard post={post} />;

  const isExternal  = post.isExternal;
  const hasVideo    = post.mediaUrl && post.mediaType === 'video';

  return (
    <div className="card post-card" style={{ marginBottom: 12 }}>
      {/* Source row */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: '.85rem' }}>{src.icon}</span>
        <span style={{ fontSize: '.72rem', fontWeight: 700, color: src.color }}>{post.sourceLabel || src.label}</span>
        {post.group && (
          <span style={{ fontSize: '.68rem', fontWeight: 700, background: c.bg, color: c.text, padding: '2px 8px', borderRadius: 5 }}>
            {post.group.name}
          </span>
        )}
        {post.topic && (
          <span style={{ fontSize: '.65rem', color: 'var(--muted)', background: 'var(--border)', padding: '2px 6px', borderRadius: 4 }}>
            🏷 {post.topic}
          </span>
        )}
        {post.fromJoinedGroup && <span style={{ fontSize: '.68rem', color: 'var(--muted)' }}>· your group</span>}
        {!post.fromJoinedGroup && post.forYou && <span style={{ fontSize: '.7rem', color: '#059669' }}>✦ for you</span>}
        <span style={{ marginLeft: 'auto', fontSize: '.7rem', color: 'var(--muted)' }}>{timeAgo(post.createdAt)}</span>
      </div>

      {/* Author */}
      {!isExternal && (
        <div className="post-header" style={{ marginBottom: 8 }}>
          <div className="avatar avatar-md">{initials(post.author?.name)}</div>
          <div className="post-meta">
            <div className="post-author">{post.author?.name || 'Member'}</div>
            <div className="post-source">
              {post.author?.title}{post.author?.organization ? ` · ${post.author.organization}` : ''}
            </div>
          </div>
        </div>
      )}
      {isExternal && post.author?.name && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: `${src.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.85rem', flexShrink: 0 }}>
            {src.icon}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '.82rem' }}>{post.author.name}</div>
            <div style={{ fontSize: '.7rem', color: 'var(--muted)' }}>{src.label}</div>
          </div>
        </div>
      )}

      {/* Title */}
      {post.title && (
        isExternal && post.sourceUrl ? (
          <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
            <p style={{ fontWeight: 700, fontSize: '.95rem', margin: '0 0 6px', lineHeight: 1.4 }}>
              {post.title}
              <span style={{ marginLeft: 5, fontSize: '.75rem', color: src.color, opacity: 0.8 }}>↗</span>
            </p>
          </a>
        ) : (
          <p style={{ fontWeight: 700, fontSize: '.95rem', margin: '0 0 6px', lineHeight: 1.4 }}>{post.title}</p>
        )
      )}

      <PostText text={post.content} />

      {/* Image */}
      {post.mediaUrl && post.mediaType === 'image' && (
        <div style={{ marginTop: 12, borderRadius: 14, overflow: 'hidden' }}>
          <img src={post.mediaUrl} alt={post.title || 'Post image'}
            style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 400 }}
            onError={e => { e.currentTarget.style.display = 'none'; }} />
        </div>
      )}

      {/* Video thumbnail → opens VideoModal */}
      {hasVideo && (
        <button
          onClick={() => onVideoOpen(post)}
          style={{ all: 'unset', display: 'block', width: '100%', marginTop: 12, cursor: 'pointer' }}
        >
          <div style={{ borderRadius: 14, overflow: 'hidden', position: 'relative', background: '#000' }}>
            <img src={post.mediaUrl} alt="Video"
              style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 360, opacity: 0.82 }}
              onError={e => { e.currentTarget.style.display = 'none'; }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 60, height: 60, borderRadius: '50%', background: `${src.color}e0`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 20px rgba(0,0,0,.45)' }}>
                <span style={{ color: '#fff', fontSize: '1.5rem', marginLeft: 3 }}>▶</span>
              </div>
            </div>
            <span style={{
              position: 'absolute', bottom: 10, right: 12,
              background: 'rgba(0,0,0,0.6)', color: '#fff',
              fontSize: '.68rem', fontWeight: 700,
              padding: '3px 8px', borderRadius: 4,
            }}>
              {src.icon} {src.label}
            </span>
          </div>
        </button>
      )}

      {/* Footer: full post link */}
      {post.sourceUrl && !hasVideo && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: src.color }}>
            <span style={{ fontSize: '.75rem' }}>{src.icon}</span>
            <span style={{ fontSize: '.7rem', color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {post.sourceUrl}
            </span>
            <span style={{ fontSize: '.65rem', fontWeight: 700, color: src.color, background: `${src.color}14`, padding: '2px 7px', borderRadius: 4, flexShrink: 0 }}>
              {src.label} ↗
            </span>
          </a>
        </div>
      )}
      {/* For video posts, show a small open link below the thumbnail */}
      {hasVideo && post.sourceUrl && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: src.color }}>
            <span style={{ fontSize: '.75rem' }}>{src.icon}</span>
            <span style={{ fontSize: '.7rem', color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {post.sourceUrl}
            </span>
            <span style={{ fontSize: '.65rem', fontWeight: 700, color: src.color, background: `${src.color}14`, padding: '2px 7px', borderRadius: 4, flexShrink: 0 }}>
              Open ↗
            </span>
          </a>
        </div>
      )}
    </div>
  );
}

export default function Feed() {
  const { profile } = useAuth();
  const [posts,      setPosts]      = useState([]);
  const [filter,     setFilter]     = useState('foryou');
  const [search,     setSearch]     = useState('');
  const [loading,    setLoading]    = useState(true);
  const [videoPost,  setVideoPost]  = useState(null);
  const intervalRef  = useRef(null);

  const loadFeed = useCallback(() => {
    client.get('/feed')
      .then(({ data }) => setPosts(data.posts || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadFeed();
    intervalRef.current = setInterval(loadFeed, 3 * 60 * 1000);
    return () => clearInterval(intervalRef.current);
  }, [loadFeed]);

  const categories = [...new Set(posts.map(p => p.group?.category).filter(Boolean))];
  const firstName  = profile?.name?.split(' ')[0] || '';
  const role       = profile?.preferences?.role || '';
  const hasPrefs   = !!(profile?.preferences?.interests?.length || role);

  const counts = {
    reddit:  posts.filter(p => p.source === 'reddit').length,
    github:  posts.filter(p => p.source === 'github').length,
    devto:   posts.filter(p => p.source === 'devto').length,
    medium:  posts.filter(p => p.source === 'medium').length,
    youtube: posts.filter(p => p.source === 'youtube').length,
    video:   posts.filter(p => p.mediaType === 'video').length,
  };

  const sourceSummary = [
    counts.reddit  > 0 && `${counts.reddit} Reddit`,
    counts.github  > 0 && `${counts.github} GitHub`,
    counts.devto   > 0 && `${counts.devto} DEV`,
    counts.medium  > 0 && `${counts.medium} Medium`,
    counts.youtube > 0 && `${counts.youtube} YouTube`,
  ].filter(Boolean).join(' · ');

  const q = search.trim().toLowerCase();

  const byFilter =
    filter === 'foryou'  ? posts.filter(p => p.forYou || p.fromJoinedGroup)
    : filter === 'all'   ? posts
    : filter === 'mine'  ? posts.filter(p => p.fromJoinedGroup)
    : filter === 'video' ? posts.filter(p => p.mediaType === 'video' || p.source === 'youtube')
    : filter === 'reddit'  ? posts.filter(p => p.source === 'reddit')
    : filter === 'github'  ? posts.filter(p => p.source === 'github')
    : filter === 'devto'   ? posts.filter(p => p.source === 'devto')
    : filter === 'medium'  ? posts.filter(p => p.source === 'medium')
    : filter === 'youtube' ? posts.filter(p => p.source === 'youtube')
    : posts.filter(p => p.group?.category === filter);

  const afterFilter = (filter === 'foryou' && byFilter.length === 0) ? posts : byFilter;

  const displayed = q
    ? afterFilter.filter(p =>
        (p.title || '').toLowerCase().includes(q) ||
        (p.content || '').toLowerCase().includes(q) ||
        (p.author?.name || '').toLowerCase().includes(q) ||
        (p.topic || '').toLowerCase().includes(q) ||
        (p.sourceLabel || '').toLowerCase().includes(q)
      )
    : afterFilter;

  return (
    <Layout>
      {videoPost && (
        <VideoModal post={videoPost} onClose={() => setVideoPost(null)} />
      )}

      <div className="page-header">
        <h1 className="page-title">
          {firstName ? `Welcome back, ${firstName}` : 'Your Feed'}
        </h1>
        <p className="page-subtitle">
          {hasPrefs
            ? `Curated for ${role ? `${role}s` : 'you'} — ${sourceSummary || 'live content from communities across the web'}.`
            : 'Live content from professional communities, publications, and conversations across the web.'}
        </p>
      </div>

      {/* Search bar */}
      <div style={{ marginBottom: 14, position: 'relative', maxWidth: 520 }}>
        <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: '.9rem', opacity: 0.45, pointerEvents: 'none' }}>🔍</span>
        <input
          className="form-input"
          placeholder="Search posts by keyword, topic, or author…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ paddingLeft: 38, borderRadius: 22, padding: '9px 16px 9px 38px', fontSize: '.875rem' }}
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--muted)' }}
          >×</button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="filter-bar" style={{ flexWrap: 'wrap' }}>
        <button className={`filter-btn${filter === 'foryou'  ? ' active' : ''}`} onClick={() => setFilter('foryou')}>✦ For You</button>
        <button className={`filter-btn${filter === 'all'     ? ' active' : ''}`} onClick={() => setFilter('all')}>🌍 All</button>
        {counts.video > 0 && (
          <button className={`filter-btn${filter === 'video' ? ' active' : ''}`} onClick={() => setFilter('video')}>▶️ Videos ({counts.video})</button>
        )}
        {counts.reddit > 0 && (
          <button className={`filter-btn${filter === 'reddit'  ? ' active' : ''}`} onClick={() => setFilter('reddit')}>🟠 Reddit ({counts.reddit})</button>
        )}
        {counts.github > 0 && (
          <button className={`filter-btn${filter === 'github'  ? ' active' : ''}`} onClick={() => setFilter('github')}>🐙 GitHub ({counts.github})</button>
        )}
        {counts.devto > 0 && (
          <button className={`filter-btn${filter === 'devto'   ? ' active' : ''}`} onClick={() => setFilter('devto')}>👩‍💻 DEV ({counts.devto})</button>
        )}
        {counts.medium > 0 && (
          <button className={`filter-btn${filter === 'medium'  ? ' active' : ''}`} onClick={() => setFilter('medium')}>📝 Medium ({counts.medium})</button>
        )}
        <button className={`filter-btn${filter === 'mine'    ? ' active' : ''}`} onClick={() => setFilter('mine')}>⭐ My Groups</button>
        {categories.map(cat => (
          <button key={cat} className={`filter-btn${filter === cat ? ' active' : ''}`} onClick={() => setFilter(cat)}>
            {cat}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <span className="spinner spinner-primary" />
        </div>
      ) : displayed.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">{q ? '🔍' : '📭'}</div>
          <div className="empty-title">{q ? `No results for "${search}"` : 'Nothing here yet'}</div>
          <div className="empty-desc">
            {q ? (
              <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>Clear search</button>
            ) : (
              <>
                <Link to="/groups">Join some communities</Link> to see their content here, or complete your{' '}
                <Link to="/onboarding">profile preferences</Link> to personalise your feed.
              </>
            )}
          </div>
        </div>
      ) : (
        <div>
          {q && (
            <div style={{ marginBottom: 12, fontSize: '.78rem', color: 'var(--muted)' }}>
              {displayed.length} result{displayed.length !== 1 ? 's' : ''} for &ldquo;{search}&rdquo;
            </div>
          )}
          {displayed.map(post => (
            <PostCard key={post.id} post={post} onVideoOpen={setVideoPost} />
          ))}
        </div>
      )}
    </Layout>
  );
}
