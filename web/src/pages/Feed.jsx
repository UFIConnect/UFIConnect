import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import client from '../api/client';

const PLATFORM_COLORS = {
  facebook:  '#1877F2',
  instagram: '#E1306C',
  linkedin:  '#0A66C2',
  twitter:   '#000000',
  reddit:    '#FF4500',
};

const FILTERS = [
  { value: 'all',       label: 'All' },
  { value: 'facebook',  label: '🔵 Facebook' },
  { value: 'instagram', label: '🟣 Instagram' },
  { value: 'linkedin',  label: '🔷 LinkedIn' },
  { value: 'twitter',   label: '🐦 X / Twitter' },
  { value: 'reddit',    label: '🟠 Reddit' },
];

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60)   return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function PostCard({ post, onLike }) {
  const color = PLATFORM_COLORS[post.platform] || '#64748B';

  return (
    <div className="card post-card">
      <div className="post-header">
        <div className="avatar avatar-md" style={{ background: `${color}18`, color }}>
          {post.avatar || initials(post.author)}
        </div>
        <div className="post-meta">
          <div className="post-author">{post.author}</div>
          <div className="post-source">{post.source}</div>
        </div>
        <span className="post-platform-badge" style={{ color }}>
          {post.platform.charAt(0).toUpperCase() + post.platform.slice(1)}
        </span>
      </div>
      <p className="post-content">{post.content}</p>
      <div className="post-actions">
        <button
          className={`post-action-btn${post.liked ? ' liked' : ''}`}
          onClick={() => onLike(post.id)}
        >
          {post.liked ? '❤️' : '🤍'} {post.likes}
        </button>
        <button className="post-action-btn">
          💬 {post.comments}
        </button>
        <span className="post-time">{timeAgo(post.time)}</span>
      </div>
    </div>
  );
}

export default function Feed() {
  const [posts,   setPosts]   = useState([]);
  const [filter,  setFilter]  = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    client.get('/feed')
      .then(({ data }) => {
        // Backend returns { posts: [...] }; add a local `liked` flag
        setPosts((data.posts || []).map((p) => ({ ...p, liked: p.likedByUser || false })));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleLike(postId) {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? { ...p, liked: !p.liked, likes: p.liked ? p.likes - 1 : p.likes + 1 }
          : p
      )
    );
    try { await client.post(`/feed/${postId}/like`); } catch {}
  }

  const filtered = filter === 'all'
    ? posts
    : posts.filter((p) => p.platform === filter);

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Your Feed</h1>
        <p className="page-subtitle">Posts from your connected platforms and groups.</p>
      </div>

      <div className="filter-bar">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            className={`filter-btn${filter === value ? ' active' : ''}`}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <span className="spinner spinner-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📭</div>
          <div className="empty-title">No posts yet</div>
          <div className="empty-desc">Connect social accounts to see posts here.</div>
        </div>
      ) : (
        <div>
          {filtered.map((post) => (
            <PostCard key={post.id} post={post} onLike={handleLike} />
          ))}
        </div>
      )}
    </Layout>
  );
}
