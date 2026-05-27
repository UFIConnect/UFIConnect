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
  hackernews:    { label: 'Hacker News',   color: '#FF6600', icon: '🔶' },
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

/** Expandable text — shows full content, "Show less" toggle if long */
function PostText({ text }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const LIMIT = 500;
  const isLong = text.length > LIMIT;
  const shown  = isLong && !expanded ? text.slice(0, LIMIT) + '…' : text;
  return (
    <div>
      <p className="post-content" style={{ margin: '0 0 4px', whiteSpace: 'pre-wrap', lineHeight: 1.65 }}>{shown}</p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: '.8rem', fontWeight: 600, padding: 0 }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

/** Inline comments panel */
function CommentsPanel({ postId, count }) {
  const [open,     setOpen]     = useState(false);
  const [comments, setComments] = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [loaded,   setLoaded]   = useState(false);

  function toggle() {
    if (!open && !loaded) {
      setLoading(true);
      client.get(`/feed/${postId}/comments`)
        .then(({ data }) => { setComments(data.comments || []); setLoaded(true); })
        .catch(() => setLoaded(true))
        .finally(() => setLoading(false));
    }
    setOpen(o => !o);
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: '.78rem', color: 'var(--muted)', fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 4, padding: 0,
        }}
      >
        💬 {count || 0} comment{count !== 1 ? 's' : ''}
        {count > 0 && <span style={{ fontSize: '.7rem', opacity: .7 }}>{open ? ' ▲' : ' ▼'}</span>}
      </button>
      {open && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          {loading ? (
            <div style={{ color: 'var(--muted)', fontSize: '.82rem' }}>Loading comments…</div>
          ) : comments.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: '.82rem' }}>No comments to show.</div>
          ) : (
            comments.map(c => (
              <div key={c.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <div className="avatar" style={{ width: 22, height: 22, fontSize: '.65rem', borderRadius: '50%', background: 'var(--primary-light)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}>
                    {(c.author || '?')[0].toUpperCase()}
                  </div>
                  <span style={{ fontWeight: 700, fontSize: '.8rem' }}>{c.author}</span>
                  <span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>{timeAgo(c.created)}</span>
                  {c.score > 0 && <span style={{ fontSize: '.7rem', color: '#FF4500', marginLeft: 'auto' }}>▲ {c.score}</span>}
                </div>
                <p style={{ margin: 0, fontSize: '.83rem', lineHeight: 1.55, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{c.body}</p>
              </div>
            ))
          )}
        </div>
      )}
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

      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        <CommentsPanel postId={post.id} count={post.commentsCount} />
        <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer"
          style={{ marginLeft: 'auto', fontSize: '.72rem', color: src.color, fontWeight: 600, textDecoration: 'none', padding: '3px 9px', background: `${src.color}14`, borderRadius: 4 }}>
          ▶️ Watch ↗
        </a>
      </div>
    </div>
  );
}

/** Unified post card — handles all sources the same way */
function PostCard({ post }) {
  const c   = catStyle(post.group?.category);
  const src = SOURCE_META[post.source] || SOURCE_META.uficonnect;

  if (post.source === 'youtube') return <YouTubeCard post={post} />;

  const isExternal = post.isExternal;

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

      {/* Author — internal posts show full name; external show platform handle if set */}
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

      {/* Title (clickable for external article posts) */}
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

      {/* Full text */}
      <PostText text={post.content} />

      {/* Image */}
      {post.mediaUrl && post.mediaType === 'image' && (
        <div style={{ marginTop: 12, borderRadius: 14, overflow: 'hidden' }}>
          <img src={post.mediaUrl} alt={post.title || 'Post image'}
            style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 400 }}
            onError={e => { e.currentTarget.style.display = 'none'; }} />
        </div>
      )}

      {/* Video thumbnail (non-YouTube) */}
      {post.mediaUrl && post.mediaType === 'video' && (
        <a href={post.sourceUrl || '#'} target="_blank" rel="noopener noreferrer"
          style={{ textDecoration: 'none', display: 'block', marginTop: 12 }}>
          <div style={{ borderRadius: 14, overflow: 'hidden', position: 'relative', background: '#000', cursor: 'pointer' }}>
            <img src={post.mediaUrl} alt="Video"
              style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 360, opacity: 0.85 }}
              onError={e => { e.currentTarget.style.display = 'none'; }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: `${src.color}dd`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 20px rgba(0,0,0,.4)' }}>
                <span style={{ color: '#fff', fontSize: '1.5rem', marginLeft: 3 }}>▶</span>
              </div>
            </div>
          </div>
        </a>
      )}

      {/* Footer: comments + source link */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
        <CommentsPanel postId={post.id} count={post.commentsCount || 0} />
        {isExternal && post.sourceUrl && (
          <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ marginLeft: 'auto', fontSize: '.7rem', color: src.color, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 3, textDecoration: 'none',
              padding: '2px 8px', background: `${src.color}14`, borderRadius: 4 }}>
            {src.icon} {src.label} ↗
          </a>
        )}
      </div>
    </div>
  );
}

export default function Feed() {
  const { profile } = useAuth();
  const [posts,   setPosts]   = useState([]);
  const [filter,  setFilter]  = useState('foryou');
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef(null);

  const loadFeed = useCallback(() => {
    client.get('/feed')
      .then(({ data }) => setPosts(data.posts || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadFeed();
    // Auto-refresh every 3 minutes
    intervalRef.current = setInterval(loadFeed, 3 * 60 * 1000);
    return () => clearInterval(intervalRef.current);
  }, [loadFeed]);

  const categories = [...new Set(posts.map(p => p.group?.category).filter(Boolean))];
  const firstName  = profile?.name?.split(' ')[0] || '';
  const role       = profile?.preferences?.role || '';
  const hasPrefs   = !!(profile?.preferences?.interests?.length || role);

  const counts = {
    reddit:  posts.filter(p => p.source === 'reddit').length,
    hn:      posts.filter(p => p.source === 'hackernews').length,
    github:  posts.filter(p => p.source === 'github').length,
    devto:   posts.filter(p => p.source === 'devto').length,
    medium:  posts.filter(p => p.source === 'medium').length,
    youtube: posts.filter(p => p.source === 'youtube').length,
  };

  const sourceSummary = [
    counts.reddit  > 0 && `${counts.reddit} Reddit`,
    counts.hn      > 0 && `${counts.hn} News`,
    counts.github  > 0 && `${counts.github} GitHub`,
    counts.devto   > 0 && `${counts.devto} DEV`,
    counts.medium  > 0 && `${counts.medium} Medium`,
    counts.youtube > 0 && `${counts.youtube} YouTube`,
  ].filter(Boolean).join(' · ');

  const filtered =
    filter === 'foryou'  ? posts.filter(p => p.forYou || p.fromJoinedGroup)
    : filter === 'all'   ? posts
    : filter === 'mine'  ? posts.filter(p => p.fromJoinedGroup)
    : filter === 'reddit'  ? posts.filter(p => p.source === 'reddit')
    : filter === 'hn'      ? posts.filter(p => p.source === 'hackernews')
    : filter === 'github'  ? posts.filter(p => p.source === 'github')
    : filter === 'devto'   ? posts.filter(p => p.source === 'devto')
    : filter === 'medium'  ? posts.filter(p => p.source === 'medium')
    : filter === 'youtube' ? posts.filter(p => p.source === 'youtube')
    : posts.filter(p => p.group?.category === filter);

  const displayed = (filter === 'foryou' && filtered.length === 0) ? posts : filtered;

  return (
    <Layout>
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

      <div className="filter-bar" style={{ flexWrap: 'wrap' }}>
        <button className={`filter-btn${filter === 'foryou'  ? ' active' : ''}`} onClick={() => setFilter('foryou')}>✦ For You</button>
        <button className={`filter-btn${filter === 'all'     ? ' active' : ''}`} onClick={() => setFilter('all')}>🌍 All</button>
        {counts.youtube > 0 && (
          <button className={`filter-btn${filter === 'youtube' ? ' active' : ''}`} onClick={() => setFilter('youtube')}>▶️ Videos ({counts.youtube})</button>
        )}
        {counts.reddit > 0 && (
          <button className={`filter-btn${filter === 'reddit'  ? ' active' : ''}`} onClick={() => setFilter('reddit')}>🟠 Reddit ({counts.reddit})</button>
        )}
        {counts.hn > 0 && (
          <button className={`filter-btn${filter === 'hn'      ? ' active' : ''}`} onClick={() => setFilter('hn')}>🔶 News ({counts.hn})</button>
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
          <div className="empty-icon">📭</div>
          <div className="empty-title">Nothing here yet</div>
          <div className="empty-desc">
            <Link to="/groups">Join some communities</Link> to see their content here, or complete your{' '}
            <Link to="/onboarding">profile preferences</Link> to personalise your feed.
          </div>
        </div>
      ) : (
        <div>
          {displayed.map(post => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </Layout>
  );
}
