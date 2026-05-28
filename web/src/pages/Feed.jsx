import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  stackoverflow: { label: 'Stack Overflow',color: '#F48024', icon: '📚' },
  mastodon:      { label: 'Mastodon',      color: '#6364FF', icon: '🦣' },
  lobsters:      { label: 'Lobsters',      color: '#AC130D', icon: '🦞' },
  arxiv:         { label: 'arXiv',         color: '#B31B1B', icon: '🔬' },
  indeed:        { label: 'Indeed',        color: '#2557A7', icon: '💼' },
  uficonnect:    { label: 'UFIConnect',    color: 'var(--primary)', icon: '🌐' },
};

const ALL_FILTER_SOURCES = [
  'reddit', 'github', 'devto', 'medium', 'youtube',
  'linkedin', 'twitter', 'facebook', 'instagram', 'tiktok',
  'stackoverflow', 'mastodon', 'lobsters', 'arxiv', 'indeed',
];

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

const PAGE_SIZE = 30;

function PostText({ text }) {
  if (!text) return null;
  return (
    <p className="post-content" style={{ margin: '0 0 4px', whiteSpace: 'pre-wrap', lineHeight: 1.65 }}>
      {text}
    </p>
  );
}

/** Video modal for non-YouTube platforms */
function VideoModal({ post, onClose }) {
  const src = SOURCE_META[post.source] || SOURCE_META.uficonnect;
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)', borderRadius: 20,
          maxWidth: 520, width: '100%', maxHeight: '90vh', overflow: 'auto',
          boxShadow: '0 24px 80px rgba(0,0,0,.6)',
        }}
      >
        {post.mediaUrl && (
          <div style={{ position: 'relative', background: '#000', borderRadius: '20px 20px 0 0', overflow: 'hidden' }}>
            <img src={post.mediaUrl} alt="" style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 320, opacity: 0.9 }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: `${src.color}e0`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 24px rgba(0,0,0,.5)' }}>
                <span style={{ color: '#fff', fontSize: '2rem', marginLeft: 4 }}>▶</span>
              </div>
            </div>
            <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: '50%', width: 36, height: 36, color: '#fff', fontSize: '1.2rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
          </div>
        )}
        <div style={{ padding: '16px 20px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span>{src.icon}</span>
            <span style={{ fontWeight: 700, fontSize: '.78rem', color: src.color }}>{post.sourceLabel || src.label}</span>
            <span style={{ fontSize: '.72rem', color: 'var(--muted)', marginLeft: 'auto' }}>{timeAgo(post.createdAt)}</span>
          </div>
          {post.author?.name && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: `${src.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.8rem' }}>{src.icon}</div>
              <span style={{ fontWeight: 700, fontSize: '.85rem' }}>{post.author.name}</span>
            </div>
          )}
          {post.title && <p style={{ fontWeight: 700, fontSize: '.98rem', margin: '0 0 10px', lineHeight: 1.4 }}>{post.title}</p>}
          {post.content && <p style={{ fontSize: '.88rem', lineHeight: 1.65, margin: '0 0 18px', whiteSpace: 'pre-wrap' }}>{post.content}</p>}
          <div style={{ display: 'flex', gap: 16, marginBottom: 18, fontSize: '.78rem', color: 'var(--muted)' }}>
            {post.likesCount > 0 && <span>❤️ {post.likesCount.toLocaleString()}</span>}
            {post.commentsCount > 0 && <span>💬 {post.commentsCount.toLocaleString()}</span>}
          </div>
          {post.sourceUrl && (
            <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: src.color === '#010101' ? '#333' : src.color, color: '#fff', textDecoration: 'none', padding: '13px 20px', borderRadius: 12, fontWeight: 700, fontSize: '.9rem' }}>
              {src.icon} Watch on {src.label} ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/** Filter panel dropdown */
function FilterPanel({ filters, onChange, sources, onClose, panelRef }) {
  const [local, setLocal] = useState({ ...filters });

  function toggleSource(s) {
    setLocal(f => {
      const next = f.sources.includes(s) ? f.sources.filter(x => x !== s) : [...f.sources, s];
      return { ...f, sources: next };
    });
  }

  function apply() {
    onChange(local);
    onClose();
  }

  function reset() {
    const cleared = { sort: 'newest', sources: [], timeRange: 'all' };
    setLocal(cleared);
    onChange(cleared);
    onClose();
  }

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute', top: '100%', right: 0, zIndex: 500, marginTop: 6,
        background: 'var(--surface)', border: '1.5px solid var(--border)',
        borderRadius: 16, padding: '18px 20px', width: 320,
        boxShadow: '0 8px 32px rgba(0,0,0,.12)',
      }}
    >
      {/* Sort */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Sort</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { value: 'newest',  label: '🕐 Newest' },
            { value: 'popular', label: '🔥 Popular' },
          ].map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setLocal(f => ({ ...f, sort: value }))}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 8, fontSize: '.8rem', fontWeight: 600,
                border: `1.5px solid ${local.sort === value ? 'var(--primary)' : 'var(--border)'}`,
                background: local.sort === value ? 'var(--primary)' : 'var(--surface)',
                color: local.sort === value ? '#fff' : 'var(--text)', cursor: 'pointer',
              }}
            >{label}</button>
          ))}
        </div>
      </div>

      {/* Time range */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Time</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { value: 'all',   label: 'All' },
            { value: '1h',    label: '1h' },
            { value: '6h',    label: '6h' },
            { value: 'today', label: 'Today' },
            { value: 'week',  label: 'Week' },
          ].map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setLocal(f => ({ ...f, timeRange: value }))}
              style={{
                padding: '5px 12px', borderRadius: 20, fontSize: '.77rem', fontWeight: 600,
                border: `1.5px solid ${local.timeRange === value ? 'var(--primary)' : 'var(--border)'}`,
                background: local.timeRange === value ? 'var(--primary)' : 'var(--surface)',
                color: local.timeRange === value ? '#fff' : 'var(--text)', cursor: 'pointer',
              }}
            >{label}</button>
          ))}
        </div>
      </div>

      {/* Sources */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
          Sources {local.sources.length > 0 && `(${local.sources.length} selected)`}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {sources.map(s => {
            const meta = SOURCE_META[s];
            if (!meta) return null;
            const active = local.sources.includes(s);
            return (
              <button
                key={s}
                onClick={() => toggleSource(s)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', borderRadius: 16, fontSize: '.73rem', fontWeight: 600,
                  border: `1.5px solid ${active ? meta.color : 'var(--border)'}`,
                  background: active ? `${meta.color}18` : 'var(--surface)',
                  color: active ? meta.color : 'var(--muted)', cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: '.8rem' }}>{meta.icon}</span>
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={reset} className="btn btn-ghost btn-sm" style={{ flex: 1 }}>Reset</button>
        <button onClick={apply} className="btn btn-primary btn-sm" style={{ flex: 2 }}>Apply filters</button>
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
        {post.group && <span style={{ fontSize: '.68rem', fontWeight: 600, background: c.bg, color: c.text, padding: '2px 7px', borderRadius: 5 }}>{post.group.name}</span>}
        {post.topic && <span style={{ fontSize: '.65rem', color: 'var(--muted)', background: 'var(--border)', padding: '2px 6px', borderRadius: 4 }}>🏷 {post.topic}</span>}
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
              allowFullScreen style={{ display: 'block' }} />
          </div>
        ) : (
          <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', cursor: 'pointer', marginBottom: 10 }} onClick={() => setPlaying(true)}>
            {post.mediaUrl && <img src={post.mediaUrl} alt={post.title} style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 280 }} />}
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
          <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: src.color }}>
            <span style={{ fontSize: '.75rem' }}>{src.icon}</span>
            <span style={{ fontSize: '.7rem', color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{post.sourceUrl}</span>
            <span style={{ fontSize: '.65rem', fontWeight: 700, color: src.color, background: `${src.color}14`, padding: '2px 7px', borderRadius: 4, flexShrink: 0 }}>▶️ Watch ↗</span>
          </a>
        </div>
      )}
    </div>
  );
}

/** Unified post card */
function PostCard({ post, onVideoOpen }) {
  const c   = catStyle(post.group?.category);
  const src = SOURCE_META[post.source] || SOURCE_META.uficonnect;

  if (post.source === 'youtube') return <YouTubeCard post={post} />;

  const isExternal = post.isExternal;
  const hasVideo   = post.mediaUrl && post.mediaType === 'video';

  return (
    <div className="card post-card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: '.85rem' }}>{src.icon}</span>
        <span style={{ fontSize: '.72rem', fontWeight: 700, color: src.color }}>{post.sourceLabel || src.label}</span>
        {post.group && <span style={{ fontSize: '.68rem', fontWeight: 700, background: c.bg, color: c.text, padding: '2px 8px', borderRadius: 5 }}>{post.group.name}</span>}
        {post.topic && <span style={{ fontSize: '.65rem', color: 'var(--muted)', background: 'var(--border)', padding: '2px 6px', borderRadius: 4 }}>🏷 {post.topic}</span>}
        {post.fromJoinedGroup && <span style={{ fontSize: '.68rem', color: 'var(--muted)' }}>· your group</span>}
        <span style={{ marginLeft: 'auto', fontSize: '.7rem', color: 'var(--muted)' }}>{timeAgo(post.createdAt)}</span>
      </div>

      {!isExternal && (
        <div className="post-header" style={{ marginBottom: 8 }}>
          <div className="avatar avatar-md">{initials(post.author?.name)}</div>
          <div className="post-meta">
            <div className="post-author">{post.author?.name || 'Member'}</div>
            <div className="post-source">{post.author?.title}{post.author?.organization ? ` · ${post.author.organization}` : ''}</div>
          </div>
        </div>
      )}
      {isExternal && post.author?.name && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: `${src.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.85rem', flexShrink: 0 }}>{src.icon}</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '.82rem' }}>{post.author.name}</div>
            <div style={{ fontSize: '.7rem', color: 'var(--muted)' }}>{src.label}</div>
          </div>
        </div>
      )}

      {post.title && (
        isExternal && post.sourceUrl ? (
          <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
            <p style={{ fontWeight: 700, fontSize: '.95rem', margin: '0 0 6px', lineHeight: 1.4 }}>
              {post.title}<span style={{ marginLeft: 5, fontSize: '.75rem', color: src.color, opacity: 0.8 }}>↗</span>
            </p>
          </a>
        ) : (
          <p style={{ fontWeight: 700, fontSize: '.95rem', margin: '0 0 6px', lineHeight: 1.4 }}>{post.title}</p>
        )
      )}

      <PostText text={post.content} />

      {post.mediaUrl && post.mediaType === 'image' && (
        <div style={{ marginTop: 12, borderRadius: 14, overflow: 'hidden' }}>
          <img src={post.mediaUrl} alt={post.title || 'Post image'}
            style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 400 }}
            onError={e => { e.currentTarget.style.display = 'none'; }} />
        </div>
      )}

      {hasVideo && (
        <button onClick={() => onVideoOpen(post)} style={{ all: 'unset', display: 'block', width: '100%', marginTop: 12, cursor: 'pointer' }}>
          <div style={{ borderRadius: 14, overflow: 'hidden', position: 'relative', background: '#000' }}>
            <img src={post.mediaUrl} alt="Video"
              style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 360, opacity: 0.82 }}
              onError={e => { e.currentTarget.style.display = 'none'; }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 60, height: 60, borderRadius: '50%', background: `${src.color}e0`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 20px rgba(0,0,0,.45)' }}>
                <span style={{ color: '#fff', fontSize: '1.5rem', marginLeft: 3 }}>▶</span>
              </div>
            </div>
            <span style={{ position: 'absolute', bottom: 10, right: 12, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '.68rem', fontWeight: 700, padding: '3px 8px', borderRadius: 4 }}>
              {src.icon} {src.label}
            </span>
          </div>
        </button>
      )}

      {post.sourceUrl && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: src.color }}>
            <span style={{ fontSize: '.75rem' }}>{src.icon}</span>
            <span style={{ fontSize: '.7rem', color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{post.sourceUrl}</span>
            <span style={{ fontSize: '.65rem', fontWeight: 700, color: src.color, background: `${src.color}14`, padding: '2px 7px', borderRadius: 4, flexShrink: 0 }}>
              {hasVideo ? 'Watch' : src.label} ↗
            </span>
          </a>
        </div>
      )}
    </div>
  );
}

export default function Feed() {
  const { profile } = useAuth();
  const [posts,       setPosts]      = useState([]);
  const [loading,     setLoading]    = useState(true);
  const [refreshing,  setRefreshing] = useState(false);
  const [search,      setSearch]     = useState('');
  const [filterOpen,  setFilterOpen] = useState(false);
  const [videoPost,   setVideoPost]  = useState(null);
  const [page,        setPage]       = useState(1);
  const [lastRefresh, setLastRefresh]= useState(null);
  const [filters, setFilters] = useState({ sort: 'newest', sources: [], timeRange: 'all' });
  const [livePending, setLivePending] = useState([]);   // buffered SSE posts
  const [liveCount,   setLiveCount]   = useState(0);    // banner count
  const [liveActive,  setLiveActive]  = useState(false); // SSE connected

  const filterBtnRef = useRef(null);
  const panelRef     = useRef(null);
  const knownIds     = useRef(new Set());

  const loadFeed = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else if (!posts.length) setLoading(true);
    try {
      const { data } = await client.get(manual ? '/feed?bust=1' : '/feed');
      const incoming = data.posts || [];
      if (manual) knownIds.current = new Set(incoming.map(p => p.id));
      else incoming.forEach(p => knownIds.current.add(p.id));
      setPosts(incoming);
      setPage(1);
      setLastRefresh(new Date());
      setLivePending([]);
      setLiveCount(0);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []); // eslint-disable-line

  // Load initial feed
  useEffect(() => { loadFeed(); }, [loadFeed]);

  // SSE: stream new posts from all 10 source workers in real time
  useEffect(() => {
    const base = import.meta.env.VITE_API_URL || '/api';
    const es = new EventSource(`${base}/feed/stream`);
    setLiveActive(false);

    es.onopen = () => setLiveActive(true);

    es.onmessage = (e) => {
      try {
        const { init, posts: incoming } = JSON.parse(e.data);
        if (!incoming?.length) return;
        if (init) {
          // Initial burst: seed knownIds but don't show banner for historical posts
          incoming.forEach(p => knownIds.current.add(p.id));
          return;
        }
        // Genuinely new posts
        const fresh = incoming.filter(p => !knownIds.current.has(p.id));
        if (!fresh.length) return;
        fresh.forEach(p => knownIds.current.add(p.id));
        setLivePending(prev => [...fresh, ...prev]);
        setLiveCount(c => c + fresh.length);
      } catch {}
    };

    es.onerror = () => { setLiveActive(false); };

    return () => { es.close(); setLiveActive(false); };
  }, []);

  function loadLivePosts() {
    setPosts(prev => {
      const merged = [...livePending, ...prev];
      // de-dup by id
      const seen = new Set();
      return merged.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
    });
    setLivePending([]);
    setLiveCount(0);
    setPage(1);
    setLastRefresh(new Date());
  }

  // Close filter panel on outside click
  useEffect(() => {
    function handleClick(e) {
      if (
        filterOpen &&
        panelRef.current && !panelRef.current.contains(e.target) &&
        filterBtnRef.current && !filterBtnRef.current.contains(e.target)
      ) {
        setFilterOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [filterOpen]);

  // Compute active source list from actual posts
  const activeSources = useMemo(
    () => [...new Set(posts.map(p => p.source).filter(s => ALL_FILTER_SOURCES.includes(s)))],
    [posts]
  );

  // Time range cutoff
  function timeRangeCutoff(range) {
    const now = Date.now();
    if (range === '1h')    return now - 60 * 60 * 1000;
    if (range === '6h')    return now - 6 * 60 * 60 * 1000;
    if (range === 'today') return now - 24 * 60 * 60 * 1000;
    if (range === 'week')  return now - 7 * 24 * 60 * 60 * 1000;
    return 0;
  }

  const processed = useMemo(() => {
    let result = [...posts];

    // Search
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(p =>
        (p.title || '').toLowerCase().includes(q) ||
        (p.content || '').toLowerCase().includes(q) ||
        (p.author?.name || '').toLowerCase().includes(q) ||
        (p.topic || '').toLowerCase().includes(q) ||
        (p.sourceLabel || '').toLowerCase().includes(q)
      );
    }

    // Source filter
    if (filters.sources.length > 0) {
      result = result.filter(p => filters.sources.includes(p.source));
    }

    // Time range
    if (filters.timeRange && filters.timeRange !== 'all') {
      const cutoff = timeRangeCutoff(filters.timeRange);
      result = result.filter(p => new Date(p.createdAt).getTime() >= cutoff);
    }

    // Sort
    if (filters.sort === 'newest') {
      result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else {
      result.sort((a, b) => (b.likesCount || 0) - (a.likesCount || 0));
    }

    return result;
  }, [posts, search, filters]);

  const displayed = processed.slice(0, page * PAGE_SIZE);
  const hasMore   = displayed.length < processed.length;

  const firstName = profile?.name?.split(' ')[0] || '';
  const activeFilterCount = filters.sources.length + (filters.sort !== 'newest' ? 1 : 0) + (filters.timeRange !== 'all' ? 1 : 0);

  return (
    <Layout>
      {videoPost && <VideoModal post={videoPost} onClose={() => setVideoPost(null)} />}

      <div className="page-header">
        <h1 className="page-title">
          {firstName ? `Welcome back, ${firstName}` : 'Your Feed'}
          <span style={{
            marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: '.65rem', fontWeight: 700, padding: '3px 9px', borderRadius: 20,
            background: liveActive ? '#DCFCE7' : '#F1F5F9',
            color: liveActive ? '#15803D' : '#94A3B8',
            verticalAlign: 'middle',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: liveActive ? '#22C55E' : '#CBD5E1', display: 'inline-block', animation: liveActive ? 'pulse 2s ease-in-out infinite' : 'none' }} />
            {liveActive ? 'LIVE' : 'connecting…'}
          </span>
        </h1>
        <p className="page-subtitle">
          10 source workers continuously pulling from Reddit, GitHub, DEV, Medium, YouTube, Stack Overflow, arXiv and more — new posts stream in automatically.
        </p>
      </div>

      {/* Live new-posts banner */}
      {liveCount > 0 && (
        <div
          onClick={loadLivePosts}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'var(--primary)', color: '#fff',
            padding: '10px 20px', borderRadius: 12, marginBottom: 14,
            cursor: 'pointer', fontWeight: 700, fontSize: '.875rem',
            boxShadow: '0 4px 16px rgba(99,102,241,.35)',
            animation: 'slideDown .25s ease',
          }}
        >
          ↑ {liveCount} new post{liveCount !== 1 ? 's' : ''} — tap to show
        </div>
      )}

      {/* Toolbar: search + filter + refresh */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', position: 'relative' }}>
        {/* Search */}
        <div style={{ flex: 1, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: '.85rem', opacity: 0.4, pointerEvents: 'none' }}>🔍</span>
          <input
            className="form-input"
            placeholder="Search posts…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            style={{ paddingLeft: 36, borderRadius: 22, padding: '9px 14px 9px 36px', fontSize: '.875rem' }}
          />
          {search && (
            <button type="button" onClick={() => { setSearch(''); setPage(1); }}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--muted)' }}>×</button>
          )}
        </div>

        {/* Filter button */}
        <div style={{ position: 'relative' }}>
          <button
            ref={filterBtnRef}
            onClick={() => setFilterOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '9px 14px', borderRadius: 22, border: `1.5px solid ${filterOpen || activeFilterCount > 0 ? 'var(--primary)' : 'var(--border)'}`,
              background: activeFilterCount > 0 ? 'var(--primary)' : 'var(--surface)',
              color: activeFilterCount > 0 ? '#fff' : 'var(--text)',
              cursor: 'pointer', fontWeight: 600, fontSize: '.875rem', whiteSpace: 'nowrap',
            }}
          >
            ⚙ Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''} {filterOpen ? '▲' : '▼'}
          </button>

          {filterOpen && (
            <FilterPanel
              filters={filters}
              onChange={f => { setFilters(f); setPage(1); }}
              sources={activeSources}
              onClose={() => setFilterOpen(false)}
              panelRef={panelRef}
            />
          )}
        </div>

        {/* Refresh button */}
        <button
          onClick={() => loadFeed(true)}
          disabled={refreshing}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '9px 14px', borderRadius: 22, border: '1.5px solid var(--border)',
            background: 'var(--surface)', color: 'var(--text)',
            cursor: refreshing ? 'default' : 'pointer', fontWeight: 600, fontSize: '.875rem', whiteSpace: 'nowrap',
            opacity: refreshing ? 0.6 : 1,
          }}
        >
          <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>↺</span>
          {refreshing ? 'Updating…' : 'Refresh'}
        </button>
      </div>

      {/* Last refresh time */}
      {lastRefresh && (
        <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginBottom: 12 }}>
          Last updated {timeAgo(lastRefresh.toISOString())}
          {processed.length > 0 && ` · ${processed.length.toLocaleString()} post${processed.length !== 1 ? 's' : ''}`}
          {search && ` for "${search}"`}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <span className="spinner spinner-primary" />
        </div>
      ) : displayed.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">{search ? '🔍' : '📭'}</div>
          <div className="empty-title">{search ? `No results for "${search}"` : 'No posts found'}</div>
          <div className="empty-desc">
            {search ? (
              <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>Clear search</button>
            ) : activeFilterCount > 0 ? (
              <button className="btn btn-ghost btn-sm" onClick={() => setFilters({ sort: 'newest', sources: [], timeRange: 'all' })}>
                Reset filters
              </button>
            ) : (
              <>
                <Link to="/groups">Join some communities</Link> or complete your{' '}
                <Link to="/onboarding">profile preferences</Link>.
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <div>
            {displayed.map(post => (
              <PostCard key={post.id} post={post} onVideoOpen={setVideoPost} />
            ))}
          </div>

          {hasMore && (
            <div style={{ textAlign: 'center', marginTop: 8, marginBottom: 24 }}>
              <button
                className="btn btn-ghost"
                onClick={() => setPage(p => p + 1)}
                style={{ borderRadius: 24, padding: '10px 32px', fontWeight: 600 }}
              >
                Load more posts ({processed.length - displayed.length} remaining)
              </button>
            </div>
          )}
          {!hasMore && displayed.length > PAGE_SIZE && (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '.78rem', marginBottom: 24 }}>
              All {processed.length} posts shown · Hit Refresh for latest content
            </div>
          )}
        </>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </Layout>
  );
}
