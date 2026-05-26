import { useState, useEffect } from 'react';
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
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

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

const SOURCE_META = {
  reddit:      { label: 'Reddit',        color: '#FF4500', icon: '🟠' },
  hackernews:  { label: 'Hacker News',   color: '#FF6600', icon: '🔶' },
  devto:       { label: 'DEV.to',        color: '#3B49DF', icon: '👩‍💻' },
  linkedin:    { label: 'LinkedIn',      color: '#0A66C2', icon: '💼' },
  twitter:     { label: 'X (Twitter)',   color: '#000000', icon: '𝕏' },
  facebook:    { label: 'Facebook',      color: '#1877F2', icon: '🔵' },
  instagram:   { label: 'Instagram',     color: '#E1306C', icon: '📸' },
  github:      { label: 'GitHub',        color: '#24292F', icon: '🐙' },
  youtube:     { label: 'YouTube',       color: '#FF0000', icon: '▶️' },
  medium:      { label: 'Medium',        color: '#1A8917', icon: '📝' },
  discord:     { label: 'Discord',       color: '#5865F2', icon: '💬' },
  indeed:      { label: 'Indeed Jobs',   color: '#2164F3', icon: '🔍' },
  dribbble:    { label: 'Dribbble',      color: '#EA4C89', icon: '🏀' },
  behance:     { label: 'Behance',       color: '#053EFF', icon: '🎨' },
  uficonnect:  { label: 'UFIConnect',    color: 'var(--primary)', icon: '🌐' },
};

function categoryStyle(cat) {
  return CATEGORY_COLORS[cat] || { text: 'var(--primary)', bg: 'var(--primary-light)' };
}

/** Card for social search deep-links (LinkedIn/Twitter/Facebook) */
function SocialSearchCard({ post }) {
  const src = SOURCE_META[post.source] || SOURCE_META.uficonnect;
  return (
    <a
      href={post.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{ textDecoration: 'none', display: 'block', marginBottom: 12 }}
    >
      <div
        className="card post-card"
        style={{
          borderLeft: `3px solid ${src.color}`,
          cursor: 'pointer',
          background: `${src.color}08`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '1.6rem' }}>{src.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--text)' }}>
              {post.title}
              <span style={{ marginLeft: 6, fontSize: '.75rem', color: src.color }}>↗</span>
            </div>
            <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 3 }}>
              {post.content}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {post.topic && (
            <span style={{ fontSize: '.68rem', color: 'var(--muted)', background: 'var(--border)', padding: '2px 7px', borderRadius: 4 }}>
              🏷 {post.topic}
            </span>
          )}
          <span style={{ fontSize: '.7rem', fontWeight: 700, color: src.color, background: `${src.color}14`, padding: '3px 10px', borderRadius: 4, marginLeft: 'auto' }}>
            Search {src.label} →
          </span>
        </div>
      </div>
    </a>
  );
}

function PostCard({ post, onLike }) {
  const c   = categoryStyle(post.group?.category);
  const src = SOURCE_META[post.source] || SOURCE_META.uficonnect;

  // Social search cards get their own special renderer
  if (post.isSocialCard) return <SocialSearchCard post={post} />;

  const postUrl = post.isExternal ? post.sourceUrl : null;

  return (
    <div
      className="card post-card"
      style={{ marginBottom: 12, cursor: postUrl ? 'pointer' : 'default', textDecoration: 'none', display: 'block' }}
      onClick={postUrl ? () => window.open(postUrl, '_blank', 'noopener,noreferrer') : undefined}
    >
      {/* Group tag + meta row */}
      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        {post.group && (
          post.isExternal ? (
            <a
              href={post.group.externalUrl || postUrl || '#'}
              target="_blank" rel="noopener noreferrer"
              style={{ textDecoration: 'none' }}
              onClick={e => e.stopPropagation()}
            >
              <span style={{ fontSize: '.72rem', fontWeight: 700, letterSpacing: '.3px', background: c.bg, color: c.text, padding: '3px 9px', borderRadius: 6 }}>
                {post.group.name}
              </span>
            </a>
          ) : (
            <Link to={`/groups/${post.group.id}`} style={{ textDecoration: 'none' }} onClick={e => e.stopPropagation()}>
              <span style={{ fontSize: '.72rem', fontWeight: 700, letterSpacing: '.3px', background: c.bg, color: c.text, padding: '3px 9px', borderRadius: 6 }}>
                {post.group.name}
              </span>
            </Link>
          )
        )}
        {/* Topic tag */}
        {post.topic && (
          <span style={{ fontSize: '.68rem', color: 'var(--muted)', background: 'var(--border)', padding: '2px 6px', borderRadius: 4 }}>
            🏷 {post.topic}
          </span>
        )}
        {post.fromJoinedGroup && <span style={{ fontSize: '.7rem', color: 'var(--muted)' }}>· your group</span>}
        {!post.fromJoinedGroup && post.forYou && <span style={{ fontSize: '.7rem', color: '#059669' }}>✦ for you</span>}
        {post.connectedBoost && <span style={{ fontSize: '.68rem', color: '#7C3AED', fontWeight: 600 }}>⚡ connected</span>}
      </div>

      {/* Author row */}
      <div className="post-header">
        <div className="avatar avatar-md">{initials(post.author?.name)}</div>
        <div className="post-meta">
          <div className="post-author">{post.author?.name || 'Anonymous'}</div>
          <div className="post-source">
            {post.author?.title}{post.author?.organization ? ` · ${post.author.organization}` : ''}
          </div>
        </div>
        <span style={{ fontSize: '.75rem', color: 'var(--muted)', marginLeft: 'auto' }}>
          {timeAgo(post.createdAt)}
        </span>
      </div>

      {/* Title — clickable link for external posts */}
      {post.title && post.isExternal && (
        <a
          href={postUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          <p style={{ fontWeight: 700, fontSize: '.95rem', margin: '8px 0 4px', color: 'var(--text)', lineHeight: 1.4 }}>
            {post.title}
            <span style={{ marginLeft: 5, fontSize: '.75rem', color: src.color, opacity: 0.8 }}>↗</span>
          </p>
        </a>
      )}

      <p className="post-content" style={{ marginTop: post.title && post.isExternal ? 0 : undefined }}>
        {post.content}
      </p>

      {/* Footer: actions + source */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
        <div className="post-actions" style={{ marginTop: 0 }} onClick={e => e.stopPropagation()}>
          <button
            className={`post-action-btn${post.likedByMe ? ' liked' : ''}`}
            onClick={() => !post.isExternal && onLike(post.id)}
            style={post.isExternal ? { cursor: 'default', opacity: 0.7 } : {}}
          >
            {post.likedByMe ? '❤️' : '🤍'} {post.likesCount || 0}
          </button>
          <button className="post-action-btn">💬 {post.commentsCount || 0}</button>
        </div>

        {/* Source badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {post.isExternal && post.sourceUrl ? (
            <a
              href={post.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ fontSize: '.7rem', color: src.color, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3, textDecoration: 'none', padding: '2px 8px', background: `${src.color}14`, borderRadius: 4 }}
            >
              {src.icon} {post.sourceLabel || src.label} · open ↗
            </a>
          ) : (
            <span style={{ fontSize: '.68rem', color: 'var(--muted)', opacity: 0.7 }}>
              {src.icon} {src.label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Feed() {
  const { profile } = useAuth();
  const [posts,   setPosts]   = useState([]);
  const [filter,  setFilter]  = useState('foryou');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    client.get('/feed')
      .then(({ data }) => setPosts(data.posts || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleLike(postId) {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? { ...p, likedByMe: !p.likedByMe, likesCount: p.likedByMe ? p.likesCount - 1 : p.likesCount + 1 }
          : p
      )
    );
    try { await client.post(`/feed/${postId}/like`); } catch {}
  }

  const categories    = [...new Set(posts.map(p => p.group?.category).filter(Boolean))];
  const firstName     = profile?.name?.split(' ')[0] || '';
  const role          = profile?.preferences?.role || '';
  const hasPrefs      = !!(profile?.preferences?.interests?.length || role);

  const redditCount   = posts.filter(p => p.source === 'reddit').length;
  const hnCount       = posts.filter(p => p.source === 'hackernews').length;
  const githubCount   = posts.filter(p => p.source === 'github').length;
  const devtoCount    = posts.filter(p => p.source === 'devto').length;
  const mediumCount   = posts.filter(p => p.source === 'medium').length;
  const socialCount   = posts.filter(p => p.isSocialCard).length;

  const filtered =
    filter === 'foryou'  ? posts.filter(p => p.forYou || p.fromJoinedGroup)
    : filter === 'all'   ? posts
    : filter === 'mine'  ? posts.filter(p => p.fromJoinedGroup)
    : filter === 'reddit' ? posts.filter(p => p.source === 'reddit')
    : filter === 'hn'     ? posts.filter(p => p.source === 'hackernews')
    : filter === 'github' ? posts.filter(p => p.source === 'github')
    : filter === 'devto'  ? posts.filter(p => p.source === 'devto')
    : filter === 'medium' ? posts.filter(p => p.source === 'medium')
    : filter === 'social' ? posts.filter(p => p.isSocialCard)
    : posts.filter(p => p.group?.category === filter);

  // If forYou returns nothing, fall back to showing all — never a blank feed
  const displayed = (filter === 'foryou' && filtered.length === 0) ? posts : filtered;

  const sourcesSummary = [
    redditCount  > 0 && `${redditCount} Reddit`,
    hnCount      > 0 && `${hnCount} HN`,
    githubCount  > 0 && `${githubCount} GitHub`,
    devtoCount   > 0 && `${devtoCount} DEV.to`,
    mediumCount  > 0 && `${mediumCount} Medium`,
    socialCount  > 0 && `${socialCount} social`,
  ].filter(Boolean).join(' · ');

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">
          {firstName ? `Hey ${firstName} 👋` : 'Your Feed'}
        </h1>
        <p className="page-subtitle">
          {hasPrefs
            ? `Personalised for ${role ? `${role}s` : 'you'} · ${sourcesSummary || 'live posts from Reddit, Hacker News & DEV.to'}.`
            : 'Live posts from Reddit, Hacker News, DEV.to + social search across LinkedIn, GitHub, YouTube & more.'}
        </p>
      </div>

      {/* Filters */}
      <div className="filter-bar" style={{ flexWrap: 'wrap' }}>
        <button className={`filter-btn${filter === 'foryou' ? ' active' : ''}`} onClick={() => setFilter('foryou')}>✦ For You</button>
        <button className={`filter-btn${filter === 'all'    ? ' active' : ''}`} onClick={() => setFilter('all')}>🌍 All</button>
        {redditCount > 0 && (
          <button className={`filter-btn${filter === 'reddit' ? ' active' : ''}`} onClick={() => setFilter('reddit')}>🟠 Reddit ({redditCount})</button>
        )}
        {hnCount > 0 && (
          <button className={`filter-btn${filter === 'hn' ? ' active' : ''}`} onClick={() => setFilter('hn')}>🔶 HN ({hnCount})</button>
        )}
        {githubCount > 0 && (
          <button className={`filter-btn${filter === 'github' ? ' active' : ''}`} onClick={() => setFilter('github')}>🐙 GitHub ({githubCount})</button>
        )}
        {devtoCount > 0 && (
          <button className={`filter-btn${filter === 'devto' ? ' active' : ''}`} onClick={() => setFilter('devto')}>👩‍💻 DEV.to ({devtoCount})</button>
        )}
        {mediumCount > 0 && (
          <button className={`filter-btn${filter === 'medium' ? ' active' : ''}`} onClick={() => setFilter('medium')}>📝 Medium ({mediumCount})</button>
        )}
        {socialCount > 0 && (
          <button className={`filter-btn${filter === 'social' ? ' active' : ''}`} onClick={() => setFilter('social')}>🔗 Social ({socialCount})</button>
        )}
        <button className={`filter-btn${filter === 'mine'   ? ' active' : ''}`} onClick={() => setFilter('mine')}>⭐ My groups</button>
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
            <Link to="/groups">Join some groups</Link> to see their posts here, or complete your{' '}
            <Link to="/onboarding">profile preferences</Link> to personalise your feed.
          </div>
        </div>
      ) : (
        <div>
          {displayed.map((post) => (
            <PostCard key={post.id} post={post} onLike={handleLike} />
          ))}
        </div>
      )}
    </Layout>
  );
}
