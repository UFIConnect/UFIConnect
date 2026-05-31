import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
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
  hackernews:    { label: 'News',          color: '#FF6600', icon: '🗞' },
  devto:         { label: 'DEV Community', color: '#3B49DF', icon: '👩‍💻' },
  linkedin:      { label: 'LinkedIn',      color: '#0A66C2', icon: '💼' },
  twitter:       { label: 'X (Twitter)',   color: '#000000', icon: '𝕏' },
  bluesky:       { label: 'Bluesky',       color: '#0085FF', icon: '🦋' },
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
  usajobs:       { label: 'USAJobs',       color: '#005EA8', icon: '🏛️' },
  producthunt:   { label: 'Product Hunt',  color: '#DA552F', icon: '🚀' },
  techcrunch:    { label: 'TechCrunch',      color: '#0D9F3F', icon: '📰' },
  theverge:      { label: 'The Verge',       color: '#FF3333', icon: '⬛' },
  indiehackers:  { label: 'Indie Hackers',   color: '#0E2150', icon: '💡' },
  hashnode:      { label: 'freeCodeCamp',    color: '#006400', icon: '🔥' },
  arstechnica:   { label: 'Ars Technica',    color: '#FF6600', icon: '📡' },
  wired:         { label: 'WIRED',           color: '#111111', icon: '🔌' },
  theregister:   { label: 'The Register',    color: '#CC0000', icon: '📋' },
  venturebeat:   { label: 'VentureBeat',     color: '#1E6FBF', icon: '💹' },
  smashing:      { label: 'Smashing Mag',    color: '#E9620A', icon: '🎨' },
  phoronix:      { label: 'Phoronix',        color: '#2B7BB9', icon: '🐧' },
  infoq:         { label: 'InfoQ',           color: '#67B346', icon: '🏗️' },
  mittr:         { label: 'MIT Tech Review', color: '#A31F34', icon: '🔬' },
  uficonnect:    { label: 'UFIConnect',      color: 'var(--primary)', icon: '🌐' },
};

const SOURCE_TABS = [
  { key: 'all',        label: 'All',         icon: '⚡' },
  { key: 'twitter',    label: 'X (Twitter)', icon: '𝕏' },
  { key: 'linkedin',   label: 'LinkedIn',    icon: '💼' },
  { key: 'instagram',  label: 'Instagram',   icon: '📸' },
  { key: 'facebook',   label: 'Facebook',    icon: '🔵' },
  { key: 'reddit',     label: 'Reddit',      icon: '🟠' },
  { key: 'github',     label: 'GitHub',      icon: '🐙' },
  { key: 'youtube',    label: 'YouTube',     icon: '▶️' },
  { key: 'hackernews', label: 'News',        icon: '🗞' },
];

const CONNECTED_SOCIAL_TABS = new Set(['twitter', 'linkedin', 'instagram', 'facebook']);
const FEED_PAGE_SIZE = 250;

const ALL_FILTER_SOURCES = [
  'reddit', 'github', 'devto', 'medium', 'youtube',
  'linkedin', 'twitter', 'bluesky', 'facebook', 'instagram', 'tiktok',
  'stackoverflow', 'mastodon', 'lobsters', 'arxiv',
  'indeed', 'usajobs', 'producthunt', 'techcrunch', 'theverge', 'indiehackers', 'hashnode',
  'arstechnica', 'wired', 'theregister', 'venturebeat', 'smashing', 'phoronix', 'infoq', 'mittr',
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
        borderRadius: 16, padding: '18px 20px', width: 'min(320px, 92vw)',
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

// Sources that have an inline comment/review section
const COMMENT_SOURCES = new Set([
  'reddit','hackernews','devto','github','medium','stackoverflow',
  'mastodon','bluesky','lobsters','producthunt','techcrunch','theverge',
  'indiehackers','hashnode','arstechnica','wired','theregister','venturebeat',
  'smashing','phoronix','infoq','mittr','youtube','twitter','linkedin',
  'instagram','facebook','tiktok',
]);
// Article sources where comments read as reader reviews/discussion
const ARTICLE_SOURCES = new Set([
  'medium','techcrunch','theverge','arstechnica','wired','theregister',
  'venturebeat','smashing','phoronix','infoq','mittr','hashnode',
]);

function commentSectionLabel(source) {
  if (source === 'stackoverflow') return 'Answers';
  if (source === 'github')        return 'Discussion';
  if (['twitter','linkedin','instagram','facebook','bluesky','mastodon','tiktok'].includes(source)) return 'Replies';
  if (ARTICLE_SOURCES.has(source)) return 'Reader Comments';
  return 'Comments';
}

/** Unified post card */
function commentUrl(post) {
  const u = post.sourceUrl || '';
  switch (post.source) {
    case 'hackernews':   return u;
    case 'reddit':       return u;
    case 'devto':        return u.includes('#') ? u : `${u}#comments`;
    case 'github':       return u;
    case 'youtube':      return u;
    case 'stackoverflow':return u.includes('#') ? u : `${u}#answers`;
    case 'lobsters':     return u;
    case 'mastodon':     return u;
    case 'bluesky':      return u;
    case 'twitter':      return u;
    case 'linkedin':     return u;
    case 'instagram':    return u;
    case 'facebook':     return u;
    case 'tiktok':       return u;
    case 'producthunt':  return u;
    case 'indiehackers': return u;
    case 'medium':       return u;
    case 'techcrunch':   return `${u}#comments`;
    case 'theverge':     return `${u}#comments`;
    case 'arstechnica':  return `${u}?comments=1`;
    case 'theregister':  return `${u}#comments`;
    case 'venturebeat':  return `${u}#comments`;
    case 'smashing':     return `${u}#comments`;
    case 'infoq':        return `${u}#community`;
    case 'hashnode':     return u.includes('#') ? u : `${u}#comments`;
    case 'phoronix':     return u;
    case 'mittr':        return u;
    case 'wired':        return u;
    default:             return u;
  }
}

function PostCard({ post, onVideoOpen }) {
  const [showComments,    setShowComments]    = useState(false);
  const [comments,        setComments]        = useState(null);
  const [commentsLive,    setCommentsLive]    = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);

  const c   = catStyle(post.group?.category);
  const src = SOURCE_META[post.source] || SOURCE_META.uficonnect;

  if (post.source === 'youtube') return <YouTubeCard post={post} />;

  const isExternal     = post.isExternal;
  const hasVideo       = post.mediaUrl && post.mediaType === 'video';
  const commentCount   = post.commentsCount || 0;
  const isTruncated    = (post.content?.trim().endsWith('…') || post.content?.trim().endsWith('...'));
  const commUrl        = commentUrl(post);
  const hasComments    = COMMENT_SOURCES.has(post.source);
  const sectionLabel   = commentSectionLabel(post.source);
  const isArticle      = ARTICLE_SOURCES.has(post.source);

  async function toggleComments() {
    if (showComments) { setShowComments(false); return; }
    setShowComments(true);
    if (comments !== null) return;
    setCommentsLoading(true);
    try {
      const { data } = await client.get(`/feed/${encodeURIComponent(post.id)}/comments`);
      setComments(data.comments || []);
      setCommentsLive(!!data.live);
    } catch { setComments([]); }
    finally  { setCommentsLoading(false); }
  }

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

      {isTruncated && post.sourceUrl && (
        <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: '.78rem', color: src.color, textDecoration: 'none', display: 'inline-block', marginBottom: 8 }}>
          Read full post ↗
        </a>
      )}

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

      {/* Stats + actions bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        {post.likesCount > 0 && (
          <span style={{ fontSize: '.75rem', color: 'var(--muted)' }}>
            {'❤️'} {post.likesCount.toLocaleString()}
          </span>
        )}
        {hasComments && (
          <button
            onClick={toggleComments}
            style={{ all: 'unset', cursor: 'pointer', fontSize: '.75rem', color: showComments ? src.color : 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, fontWeight: showComments ? 700 : 400 }}
          >
            💬 {commentCount > 0 ? `${commentCount.toLocaleString()} ` : ''}{showComments ? `Hide ${sectionLabel}` : sectionLabel}
          </button>
        )}
        {post.sourceUrl && (
          <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, textDecoration: 'none' }}>
            <span style={{ fontSize: '.65rem', fontWeight: 700, color: src.color, background: `${src.color}14`, padding: '3px 8px', borderRadius: 5 }}>
              {hasVideo ? 'Watch' : 'Open'} on {src.label} ↗
            </span>
          </a>
        )}
      </div>

      {/* Inline comments / replies / answers / reviews */}
      {showComments && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>

          {/* Section header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <span style={{ fontSize: '.72rem', fontWeight: 700, color: src.color, textTransform: 'uppercase', letterSpacing: '.5px' }}>
              {sectionLabel}
            </span>
            {!commentsLive && (
              <span style={{ fontSize: '.62rem', color: 'var(--muted)', background: 'var(--border)', padding: '1px 6px', borderRadius: 4 }}>
                top picks
              </span>
            )}
            {commentsLive && (
              <span style={{ fontSize: '.62rem', color: '#059669', background: '#ECFDF5', padding: '1px 6px', borderRadius: 4 }}>
                live
              </span>
            )}
          </div>

          {/* Loading spinner */}
          {commentsLoading && (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <span className="spinner spinner-primary" />
            </div>
          )}

          {/* Comment list */}
          {!commentsLoading && comments?.length > 0 && comments.map(c => (
            <div key={c.id} style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <div style={{
                width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                background: `${src.color}18`, border: `1.5px solid ${src.color}33`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '.75rem', fontWeight: 700, color: src.color,
              }}>
                {(c.author?.replace(/^[@u\/]/, '') || '?')[0]?.toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: '.78rem' }}>{c.author}</span>
                  {c.score > 0 && (
                    <span style={{ fontSize: '.68rem', color: 'var(--muted)' }}>▲ {c.score.toLocaleString()}</span>
                  )}
                  <span style={{ fontSize: '.68rem', color: 'var(--muted)', marginLeft: 'auto' }}>{timeAgo(c.created)}</span>
                </div>
                <p style={{ fontSize: '.83rem', lineHeight: 1.6, margin: 0, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{c.body}</p>
              </div>
            </div>
          ))}

          {!commentsLoading && comments?.length === 0 && (
            <p style={{ fontSize: '.78rem', color: 'var(--muted)', margin: '0 0 10px' }}>No {sectionLabel.toLowerCase()} found.</p>
          )}

          {/* Read-more link — always shown at bottom */}
          {commUrl && (
            <a
              href={commUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                textDecoration: 'none', marginTop: comments?.length > 0 ? 12 : 0,
                paddingTop: comments?.length > 0 ? 10 : 0,
                borderTop: comments?.length > 0 ? '1px solid var(--border)' : 'none',
              }}
            >
              <span style={{ fontSize: '.82rem', fontWeight: 700, color: src.color }}>
                {src.icon} {isArticle ? 'Read all ' : 'View all '}
                {commentCount > 0 ? `${commentCount.toLocaleString()} ` : ''}
                {sectionLabel.toLowerCase()} on {src.label}
              </span>
              <span style={{ fontSize: '.72rem', color: src.color, background: `${src.color}14`, padding: '2px 8px', borderRadius: 5, fontWeight: 700 }}>↗</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default function Feed() {
  const { profile } = useAuth();
  const [connectedSocial, setConnectedSocial] = useState(null); // null = not yet fetched
  const [posts,         setPosts]        = useState([]);
  const [loading,       setLoading]      = useState(true);
  const [refreshing,    setRefreshing]   = useState(false);
  const [loadingMore,   setLoadingMore]  = useState(false);
  const [remotePage,    setRemotePage]   = useState(2);
  const [remoteHasMore, setRemoteHasMore]= useState(true);
  const [search,        setSearch]       = useState('');
  const [filterOpen,    setFilterOpen]   = useState(false);
  const [videoPost,     setVideoPost]    = useState(null);
  const [newPostsCount, setNewPostsCount]= useState(0);
  const [lastRefresh,   setLastRefresh]  = useState(null);
  const [filters, setFilters] = useState({ sort: 'newest', sources: [], timeRange: 'all' });
  const [liveActive,    setLiveActive]    = useState(false);
  const [sourceTab,     setSourceTab]     = useState('all');

  const filterBtnRef  = useRef(null);
  const panelRef      = useRef(null);
  const knownIds      = useRef(new Set());
  const sentinelRef   = useRef(null);
  const sourceTabRef  = useRef('all');
  const postsRef      = useRef([]);

  const loadFeed = useCallback(async (manual = false, source = null) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    try {
      const src = source && source !== 'all' ? source : null;
      const params = new URLSearchParams({ limit: `${FEED_PAGE_SIZE}` });
      if (src) params.set('source', src);
      if (manual) {
        params.set('bust', '1');
        params.set('live', '1');
      }
      const url = `/feed?${params.toString()}`;
      const { data } = await client.get(url);
      const incoming = data.posts || [];
      if (manual) {
        if (incoming.length === 0 && postsRef.current.length > 0) {
          setNewPostsCount(0);
          setLastRefresh(new Date());
          return;
        }
        const prevIds = new Set(postsRef.current.map(p => p.id));
        const fresh = incoming.filter(p => !prevIds.has(p.id)).length;
        setNewPostsCount(fresh);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      knownIds.current = new Set(incoming.map(p => p.id));
      setPosts(incoming);
      setRemotePage(2);
      setRemoteHasMore(data.hasMore !== false);
      setLastRefresh(new Date());
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []); // eslint-disable-line

  // Keep postsRef in sync so loadFeed can read current posts without a dep cycle
  useEffect(() => { postsRef.current = posts; }, [posts]);

  const switchTab = useCallback((key) => {
    setSourceTab(key);
    setSearch('');
    setNewPostsCount(0);
    const isConnected = !!connectedSocial?.[key];
    if (!CONNECTED_SOCIAL_TABS.has(key) || isConnected) {
      loadFeed(false, key === 'all' ? null : key);
    }
  }, [loadFeed, connectedSocial]); // eslint-disable-line

  const loadMoreRemote = useCallback(async () => {
    if (loadingMore || !remoteHasMore) return;
    setLoadingMore(true);
    try {
      const srcParam = sourceTab !== 'all' ? `&source=${encodeURIComponent(sourceTab)}` : '';
      const { data } = await client.get(`/feed?page=${remotePage}&limit=${FEED_PAGE_SIZE}${srcParam}`);
      const incoming = (data.posts || []).filter(p => !knownIds.current.has(p.id));
      incoming.forEach(p => knownIds.current.add(p.id));
      if (incoming.length > 0) setPosts(prev => [...prev, ...incoming]);
      setRemotePage(p => p + 1);
      setRemoteHasMore(data.hasMore !== false);
    } catch {}
    finally { setLoadingMore(false); }
  }, [loadingMore, remoteHasMore, remotePage, sourceTab]);

  // Load initial feed
  useEffect(() => { loadFeed(); }, [loadFeed]);

  // Fetch social connection status for personalisation banners
  useEffect(() => {
    if (!profile) { setConnectedSocial({}); return; }
    client.get('/profile/social').then(({ data }) => setConnectedSocial(data.connected || {})).catch(() => setConnectedSocial({}));
  }, [profile]);

  // Keep sourceTabRef in sync so the SSE closure can read the current tab
  useEffect(() => { sourceTabRef.current = sourceTab; }, [sourceTab]);

  // SSE: stream new posts from all source workers in real time
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
          incoming.forEach(p => knownIds.current.add(p.id));
          return;
        }
        const fresh = incoming.filter(p => !knownIds.current.has(p.id));
        if (!fresh.length) return;
        fresh.forEach(p => knownIds.current.add(p.id));
        // Only inject posts that match the current source tab
        const tab = sourceTabRef.current;
        const tabFresh = tab === 'all' ? fresh : fresh.filter(p => p.source === tab);
        if (!tabFresh.length) return;
        setPosts(prev => {
          const merged = [...tabFresh, ...prev];
          const seen = new Set();
          return merged
            .filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        });
      } catch {}
    };

    es.onerror = () => { setLiveActive(false); };

    return () => { es.close(); setLiveActive(false); };
  }, []);

  // Time range cutoff helper
  function timeRangeCutoff(range) {
    const now = Date.now();
    if (range === '1h')    return now - 60 * 60 * 1000;
    if (range === '6h')    return now - 6 * 60 * 60 * 1000;
    if (range === 'today') return now - 24 * 60 * 60 * 1000;
    if (range === 'week')  return now - 7 * 24 * 60 * 60 * 1000;
    return 0;
  }

  // Must be declared before the IntersectionObserver useEffect that reads processed.length
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

    // Sort within each source bucket first
    if (filters.sort === 'newest') {
      result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else {
      result.sort((a, b) => (b.likesCount || 0) - (a.likesCount || 0));
    }

    // On the all tab with no source filter, interleave round-robin across sources
    if (sourceTab === 'all' && filters.sources.length === 0) {
      const buckets = new Map();
      for (const p of result) {
        const src = p.source || 'unknown';
        if (!buckets.has(src)) buckets.set(src, []);
        buckets.get(src).push(p);
      }
      const keys = [...buckets.keys()];
      const mixed = [];
      let filled = true;
      while (filled) {
        filled = false;
        for (const k of keys) {
          const bucket = buckets.get(k);
          if (bucket.length) { mixed.push(bucket.shift()); filled = true; }
        }
      }
      return mixed;
    }

    return result;
  }, [posts, search, filters, sourceTab]);

  useEffect(() => {
    const hasNarrowFilter = !!search.trim() || filters.sources.length > 0 || filters.timeRange !== 'all';
    if (!hasNarrowFilter || loading || loadingMore || !remoteHasMore) return;
    if (processed.length < 20) loadMoreRemote();
  }, [filters, search, processed.length, loading, loadingMore, remoteHasMore, loadMoreRemote]);

  // Infinite scroll: fetch next remote page when sentinel enters the viewport
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMoreRemote(); },
      { rootMargin: '400px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMoreRemote]);

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

  const displayed = processed; // render all locally-held posts — no artificial cap
  const hasMore   = remoteHasMore;

  const firstName = profile?.name?.split(' ')[0] || '';
  const activeFilterCount = filters.sources.length + (filters.sort !== 'newest' ? 1 : 0) + (filters.timeRange !== 'all' ? 1 : 0);

  return (
    <Layout>
      <Helmet>
        <title>Feed | UFIConnect</title>
        <meta name="description" content="Your live professional feed — top stories from Reddit, GitHub, HN, YouTube, DEV, and 17+ more sources, filtered to your interests." />
      </Helmet>
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
          17 source workers pulling live from Reddit, GitHub, DEV, Medium, YouTube, Stack Overflow, HN, arXiv, Mastodon, Bluesky, TechCrunch, Product Hunt, Indie Hackers and more — new posts stream in automatically.
        </p>
      </div>


      {/* Toolbar: search + filter + refresh */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', position: 'relative', flexWrap: 'wrap' }}>
        {/* Search */}
        <div style={{ flex: 1, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: '.85rem', opacity: 0.4, pointerEvents: 'none' }}>🔍</span>
          <input
            className="form-input"
            placeholder="Search posts…"
            value={search}
            onChange={e => { setSearch(e.target.value); setNewPostsCount(0); }}
            style={{ paddingLeft: 36, borderRadius: 22, padding: '9px 14px 9px 36px', fontSize: '.875rem' }}
          />
          {search && (
            <button type="button" onClick={() => { setSearch(''); setNewPostsCount(0); }}
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
              onChange={f => { setFilters(f); }}
              sources={ALL_FILTER_SOURCES}
              onClose={() => setFilterOpen(false)}
              panelRef={panelRef}
            />
          )}
        </div>

        {/* Refresh button */}
        <button
          onClick={() => loadFeed(true, sourceTab !== 'all' ? sourceTab : null)}
          disabled={refreshing}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '9px 14px', borderRadius: 22, border: '1.5px solid var(--border)',
            background: 'var(--surface)', color: 'var(--text)',
            cursor: refreshing ? 'default' : 'pointer', fontWeight: 600, fontSize: '.875rem', whiteSpace: 'nowrap',
            opacity: refreshing ? 0.6 : 1, transition: 'background .15s, border-color .15s',
          }}
          onMouseOver={e => { if (!refreshing) { e.currentTarget.style.background = 'var(--card)'; e.currentTarget.style.borderColor = 'var(--primary)'; } }}
          onMouseOut={e => { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
        >
          <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>↺</span>
          {refreshing ? 'Updating…' : 'Refresh'}
        </button>
      </div>

      {/* Source tabs */}
      <div style={{
        display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 14,
        paddingBottom: 4, scrollbarWidth: 'none',
      }}>
        {SOURCE_TABS.map(tab => {
          const meta  = SOURCE_META[tab.key];
          const color = meta?.color || 'var(--primary)';
          const active = sourceTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => switchTab(tab.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '6px 13px', borderRadius: 20, whiteSpace: 'nowrap',
                border: `1.5px solid ${active ? color : 'var(--border)'}`,
                background: active ? (tab.key === 'all' ? 'var(--primary)' : color) : 'var(--surface)',
                color: active ? '#fff' : 'var(--text)',
                fontWeight: active ? 700 : 500, fontSize: '.8rem',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: '.85rem' }}>{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* New-posts banner — shown after manual refresh */}
      {newPostsCount > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
          padding: '8px 14px', borderRadius: 12,
          background: 'var(--primary-light)', border: '1.5px solid var(--primary)',
          fontSize: '.8rem', fontWeight: 600, color: 'var(--primary)',
        }}>
          <span>✨</span>
          <span>{newPostsCount} new post{newPostsCount !== 1 ? 's' : ''} loaded</span>
          <button onClick={() => setNewPostsCount(0)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '.9rem' }}>×</button>
        </div>
      )}

      {/* Last refresh time */}
      {lastRefresh && (
        <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginBottom: 12 }}>
          {sourceTab !== 'all' && SOURCE_META[sourceTab] && (
            <span style={{ fontWeight: 600, color: SOURCE_META[sourceTab].color, marginRight: 6 }}>
              {SOURCE_META[sourceTab].icon} {SOURCE_META[sourceTab].label}
            </span>
          )}
          Last updated {timeAgo(lastRefresh.toISOString())}
          {posts.length > 0 && ` · ${posts.length.toLocaleString()} post${posts.length !== 1 ? 's' : ''} loaded`}
          {search && ` for "${search}"`}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <span className="spinner spinner-primary" />
          {sourceTab !== 'all' && (
            <div style={{ marginTop: 12, color: 'var(--muted)', fontSize: '.85rem' }}>
              Fetching {SOURCE_META[sourceTab]?.label || sourceTab} posts…
            </div>
          )}
        </div>
      ) : displayed.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">{search ? '🔍' : (SOURCE_META[sourceTab]?.icon || '📭')}</div>
          <div className="empty-title">
            {search ? `No results for "${search}"` : `No ${SOURCE_META[sourceTab]?.label || ''} posts found`.trim()}
          </div>
          <div className="empty-desc">
            {search ? (
              <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>Clear search</button>
            ) : activeFilterCount > 0 ? (
              <button className="btn btn-ghost btn-sm" onClick={() => setFilters({ sort: 'newest', sources: [], timeRange: 'all' })}>
                Reset filters
              </button>
            ) : sourceTab !== 'all' ? (
              <button className="btn btn-ghost btn-sm" onClick={() => switchTab('all')}>Back to All</button>
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

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} style={{ height: 1 }} />

          {loadingMore && (
            <div style={{ textAlign: 'center', padding: '16px 0 24px' }}>
              <span className="spinner spinner-primary" />
            </div>
          )}
          {!hasMore && displayed.length > 0 && (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '.78rem', marginBottom: 24 }}>
              All {displayed.length.toLocaleString()} posts shown · Hit Refresh for latest content
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
