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

function categoryStyle(cat) {
  return CATEGORY_COLORS[cat] || { text: 'var(--primary)', bg: 'var(--primary-light)' };
}

function PostCard({ post, onLike }) {
  const c = categoryStyle(post.group?.category);
  return (
    <div className="card post-card" style={{ marginBottom: 12 }}>
      {/* Group tag + relevance badge */}
      {post.group && (
        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Link to={`/groups/${post.group.id}`} style={{ textDecoration: 'none' }}>
            <span style={{
              fontSize: '.72rem', fontWeight: 700, letterSpacing: '.3px',
              background: c.bg, color: c.text,
              padding: '3px 9px', borderRadius: 6,
            }}>
              {post.group.name}
            </span>
          </Link>
          {post.fromJoinedGroup && (
            <span style={{ fontSize: '.7rem', color: 'var(--muted)' }}>· your group</span>
          )}
          {!post.fromJoinedGroup && post.forYou && (
            <span style={{ fontSize: '.7rem', color: '#059669' }}>✦ for you</span>
          )}
        </div>
      )}

      {/* Author */}
      <div className="post-header">
        <div className="avatar avatar-md">
          {initials(post.author?.name)}
        </div>
        <div className="post-meta">
          <div className="post-author">{post.author?.name || 'Anonymous'}</div>
          <div className="post-source">{post.author?.title}{post.author?.organization ? ` · ${post.author.organization}` : ''}</div>
        </div>
        <span className="post-time" style={{ fontSize: '.75rem', color: 'var(--muted)', marginLeft: 'auto' }}>
          {timeAgo(post.createdAt)}
        </span>
      </div>

      <p className="post-content">{post.content}</p>

      <div className="post-actions">
        <button
          className={`post-action-btn${post.likedByMe ? ' liked' : ''}`}
          onClick={() => onLike(post.id)}
        >
          {post.likedByMe ? '❤️' : '🤍'} {post.likesCount || 0}
        </button>
        <button className="post-action-btn">💬 {post.commentsCount || 0}</button>
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

  const categories = [...new Set(posts.map(p => p.group?.category).filter(Boolean))];

  const firstName = profile?.name?.split(' ')[0] || '';
  const role      = profile?.preferences?.role || '';
  const hasPrefs  = !!(profile?.preferences?.interests?.length || role);

  const filtered =
    filter === 'foryou' ? posts.filter(p => p.forYou || p.fromJoinedGroup)
    : filter === 'all'  ? posts
    : filter === 'mine' ? posts.filter(p => p.fromJoinedGroup)
    : posts.filter(p => p.group?.category === filter);

  // If user has no prefs and "For You" is empty, fall back to all
  const displayed = (filter === 'foryou' && filtered.length === 0) ? posts : filtered;

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">
          {firstName ? `Hey ${firstName} 👋` : 'Your Feed'}
        </h1>
        <p className="page-subtitle">
          {hasPrefs
            ? `Curated for ${role ? `${role}s` : 'you'} · posts matching your interests appear first.`
            : 'What\'s happening across the UFIConnect community.'}
        </p>
      </div>

      {/* Filters */}
      <div className="filter-bar" style={{ flexWrap: 'wrap' }}>
        <button className={`filter-btn${filter === 'foryou' ? ' active' : ''}`} onClick={() => setFilter('foryou')}>✦ For You</button>
        <button className={`filter-btn${filter === 'all'    ? ' active' : ''}`} onClick={() => setFilter('all')}>🌍 All</button>
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
            <Link to="/groups">Join some groups</Link> to see their posts here.
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
