import { useState, useEffect, useCallback, useRef, useMemo, Component, memo } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';

// Utility: debounce function for search input
function debounce(fn, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || t <= 0) return '';
  const diff = (Date.now() - t) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function feedPostTime(post) {
  const time = new Date(post?.createdAt || post?.time || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function postEngagement(post) {
  const likes = Number(post?.likesCount || post?.likes || 0);
  const comments = Number(post?.commentsCount || post?.comments || 0);
  return Math.max(0, likes) + Math.max(0, comments) * 2;
}

function postRankScore(post) {
  const ts = feedPostTime(post);
  const ageHours = ts > 0 ? Math.max(0, (Date.now() - ts) / (60 * 60 * 1000)) : 9999;
  const recency = Math.max(0, 100 - ageHours * 1.8);
  const engagement = Math.log1p(postEngagement(post)) * 12;
  const communityBoost = post?.fromJoinedGroup ? 18 : 0;
  const firstPartyBoost = (post?.source || 'uficonnect') === 'uficonnect' ? 10 : 0;
  return recency + engagement + communityBoost + firstPartyBoost;
}

function normalizeFeedSort(value) {
  return ['ranked', 'newest', 'popular', 'balanced', 'bylink'].includes(value) ? value : 'ranked';
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url || ''; }
}

function sortByLink(posts = []) {
  return [...posts].sort((a, b) => {
    const da = extractDomain(a.sourceUrl || '');
    const db = extractDomain(b.sourceUrl || '');
    return da.localeCompare(db) || feedPostTime(b) - feedPostTime(a);
  });
}

function diversifyPostsBySource(posts = [], maxConsecutive = 2) {
  const pool = [...posts];
  const output = [];
  let lastSource = null;
  let streak = 0;

  while (pool.length) {
    let pickIndex = 0;
    if (lastSource && streak >= maxConsecutive) {
      const alternate = pool.findIndex(p => (p?.source || 'unknown') !== lastSource);
      if (alternate >= 0) pickIndex = alternate;
    }
    const [post] = pool.splice(pickIndex, 1);
    const source = post?.source || 'unknown';
    if (source === lastSource) streak += 1;
    else { lastSource = source; streak = 1; }
    output.push(post);
  }

  return output;
}

function sortPostsForView(list = [], sort = 'ranked') {
  const sortMode = normalizeFeedSort(sort);
  if (sortMode === 'bylink') return sortByLink(list);
  const result = [...list];
  result.sort((a, b) => {
    if (sortMode === 'newest') return feedPostTime(b) - feedPostTime(a);
    if (sortMode === 'popular') return (postEngagement(b) - postEngagement(a)) || (feedPostTime(b) - feedPostTime(a));
    return (postRankScore(b) - postRankScore(a)) || (feedPostTime(b) - feedPostTime(a));
  });
  return sortMode === 'balanced' ? diversifyPostsBySource(result) : result;
}

function mergeFeedPosts(list = [], sort = 'ranked') {
  const byId = new Map();
  for (const post of list) {
    if (!post) continue;
    const key = post.id || `${post.source || 'feed'}:${post.sourceUrl || post.title || post.content || ''}:${post.createdAt || ''}`;
    if (!key) continue;
    const previous = byId.get(key);
    if (!previous || feedPostTime(post) >= feedPostTime(previous)) byId.set(key, post);
  }
  return sortPostsForView([...byId.values()], sort);
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
  gitlab:        { label: 'GitLab',        color: '#FC6D26', icon: 'GL' },
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
  remoteok:      { label: 'Remote OK',       color: '#10B981', icon: 'RO' },
  yc:            { label: 'Y Combinator',    color: '#FF6600', icon: 'YC' },
  crunchbase:    { label: 'Crunchbase',      color: '#146AFF', icon: 'CB' },
  behance:       { label: 'Behance',         color: '#053EFF', icon: 'Be' },
  designweb:     { label: 'Design Web',      color: '#DB2777', icon: 'UX' },
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

const DEFAULT_FILTERS = { sort: 'newest', sources: [], timeRange: 'all' };
const FEED_PAGE_SIZE = 50;
const FEED_AUTO_REFRESH_MS = 10 * 60 * 1000;

const FEED_STATE_KEY = 'ufi_feed_state';

function loadFeedState() {
  try {
    const raw = sessionStorage.getItem(FEED_STATE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return {
      filters:    { ...DEFAULT_FILTERS, ...(s.filters || {}) },
      activeTabs: Array.isArray(s.activeTabs) ? s.activeTabs : [],
      search:     typeof s.search === 'string' ? s.search : '',
      viewMode:   s.viewMode === 'archive' ? 'archive' : 'feed',
    };
  } catch { return null; }
}

function saveFeedState(filters, activeTabs, search, viewMode) {
  try {
    sessionStorage.setItem(FEED_STATE_KEY, JSON.stringify({ filters, activeTabs, search, viewMode }));
  } catch {}
}

const ALL_FILTER_SOURCES = [
  'reddit', 'github', 'gitlab', 'devto', 'medium', 'youtube',
  'linkedin', 'twitter', 'bluesky', 'facebook', 'instagram', 'tiktok',
  'stackoverflow', 'mastodon', 'lobsters', 'arxiv',
  'indeed', 'usajobs', 'producthunt', 'techcrunch', 'theverge', 'indiehackers', 'hashnode',
  'arstechnica', 'wired', 'theregister', 'venturebeat', 'smashing', 'phoronix', 'infoq', 'mittr',
  'remoteok', 'yc', 'crunchbase', 'behance', 'designweb',
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

function PostCardSkeleton() {
  return (
    <div className="card post-card" style={{ marginBottom: 12, opacity: 0.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--border)', animation: 'pulse 2s ease-in-out infinite' }} />
        <div style={{ flex: 1, height: 12, borderRadius: 4, background: 'var(--border)', animation: 'pulse 2s ease-in-out infinite' }} />
      </div>
      <div style={{ height: 16, borderRadius: 4, background: 'var(--border)', marginBottom: 10, animation: 'pulse 2s ease-in-out infinite' }} />
      <div style={{ height: 12, borderRadius: 4, background: 'var(--border)', marginBottom: 20, width: '85%', animation: 'pulse 2s ease-in-out infinite' }} />
      <div style={{ height: 200, borderRadius: 12, background: 'var(--border)', animation: 'pulse 2s ease-in-out infinite' }} />
    </div>
  );
}

/** Video modal for non-YouTube platforms */
function VideoModal({ post, onClose }) {
  const src = SOURCE_META[post.source] || SOURCE_META.uficonnect;
  const modalRef = useRef(null);

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    // Focus trap
    const prev = document.activeElement;
    if (modalRef.current) modalRef.current.focus();
    return () => {
      document.removeEventListener('keydown', h);
      if (prev && prev.focus) prev.focus();
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${post.title || 'Post'} from ${src.label}`}
      ref={modalRef}
      tabIndex={-1}
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
            <button onClick={onClose} aria-label="Close modal" style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: '50%', width: 36, height: 36, color: '#fff', fontSize: '1.2rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
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

  useEffect(() => {
    setLocal({ ...filters });
  }, [filters]);

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
    const cleared = { ...DEFAULT_FILTERS };
    setLocal(cleared);
    onChange(cleared);
    onClose();
  }

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute', top: '100%', zIndex: 500, marginTop: 6,
        background: 'var(--surface)', border: '1.5px solid var(--border)',
        borderRadius: 16, padding: '18px 20px', width: 'min(320px, calc(100vw - 24px))',
        maxHeight: 'calc(100vh - 200px)', overflowY: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,.12)',
        right: 'clamp(12px, calc(50vw - 150px), 0px)',
      }}
    >
      {/* Sort */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Sort</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { value: 'ranked',   label: 'Ranked' },
            { value: 'newest',   label: 'Newest' },
            { value: 'popular',  label: 'Popular' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'bylink',   label: 'By Domain' },
          ].map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setLocal(f => ({ ...f, sort: value }))}
              style={{
                flex: '1 1 46%', padding: '7px 0', borderRadius: 8, fontSize: '.8rem', fontWeight: 600,
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

/** Gate shown when user clicks a social tab but hasn't connected that account */
function SocialConnectGate({ platform, onConnect, connecting }) {
  const meta = SOURCE_META[platform] || {};
  const descriptions = {
    twitter:   'See posts, threads, and trending topics from the people you follow on X (Twitter).',
    linkedin:  'Bring your LinkedIn feed into UFIConnect — professional updates, articles, and job posts.',
    instagram: 'View posts and reels from the creators and brands you follow on Instagram.',
    facebook:  'See updates from your Facebook friends and the pages you follow.',
  };
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '60px 24px', textAlign: 'center',
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%', marginBottom: 20,
        background: `${meta.color}18`, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: '2rem',
        border: `2px solid ${meta.color}30`,
      }}>
        {meta.icon}
      </div>
      <h2 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: 10, color: 'var(--text)' }}>
        Connect your {meta.label} account
      </h2>
      <p style={{ fontSize: '.9rem', color: 'var(--muted)', maxWidth: 380, lineHeight: 1.6, marginBottom: 28 }}>
        {descriptions[platform] || `Connect your ${meta.label} account to see your personalised feed here.`}
      </p>
      <button
        onClick={onConnect}
        disabled={connecting}
        style={{
          padding: '12px 32px', borderRadius: 24, fontWeight: 700, fontSize: '.95rem',
          background: meta.color, color: '#fff', border: 'none', cursor: connecting ? 'default' : 'pointer',
          opacity: connecting ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 8,
          transition: 'opacity .15s',
        }}
      >
        {connecting ? <span className="spinner" style={{ borderTopColor: '#fff', width: 16, height: 16 }} /> : meta.icon}
        {connecting ? 'Redirecting…' : `Connect ${meta.label}`}
      </button>
      <p style={{ marginTop: 16, fontSize: '.78rem', color: 'var(--muted)' }}>
        You can disconnect at any time from Settings → Connected Accounts
      </p>
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
          <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', cursor: 'pointer', marginBottom: 10, background: 'var(--border)' }} onClick={() => setPlaying(true)}>
            {post.mediaUrl && <img src={post.mediaUrl} alt={post.title} style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 280 }}
              onError={e => {
                e.currentTarget.style.display = 'none';
                const fallback = e.currentTarget.parentElement.querySelector('[data-youtube-fallback]');
                if (fallback) fallback.style.display = 'flex';
              }} />}
            <div data-youtube-fallback style={{
              display: post.mediaUrl ? 'none' : 'flex', position: 'absolute', inset: 0,
              alignItems: 'center', justifyContent: 'center',
              background: 'var(--border)', color: 'var(--muted)', fontSize: '.85rem',
            }}>
              🎥 Thumbnail unavailable
            </div>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#FF0000', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 20px rgba(0,0,0,.4)' }}>
                <span style={{ color: '#fff', fontSize: '1.7rem', marginLeft: 4 }}>▶</span>
              </div>
            </div>
          </div>
        )
      ) : post.mediaUrl ? (
        <div style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 10, background: 'var(--border)' }}>
          <img src={post.mediaUrl} alt={post.title} style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 280 }}
            onError={e => {
              e.currentTarget.style.display = 'none';
              const fallback = e.currentTarget.parentElement.querySelector('[data-youtube-img-fallback]');
              if (fallback) fallback.style.display = 'flex';
            }} />
          <div data-youtube-img-fallback style={{
            display: 'none', alignItems: 'center', justifyContent: 'center',
            height: 200, color: 'var(--muted)', fontSize: '.85rem',
          }}>
            📷 Image unavailable
          </div>
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
  'uficonnect',
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

function commentToFeedComment(comment) {
  return {
    id: comment?.id || `local_${Date.now()}`,
    author: comment?.author?.name || 'Member',
    body: comment?.content || '',
    score: 0,
    created: comment?.createdAt || new Date().toISOString(),
  };
}

/** Unified post card */
function commentUrl(post) {
  const u = post.sourceUrl || '';
  if (!u) return null; // No valid URL to link to
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

const PostCard = memo(function PostCard({ post, onVideoOpen, onPostUpdated }) {
  const [showComments,    setShowComments]    = useState(false);
  const [comments,        setComments]        = useState(null);
  const [commentsLive,    setCommentsLive]    = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError,   setCommentsError]   = useState(false);
  const [commentDraft,    setCommentDraft]    = useState('');
  const [commentSending,  setCommentSending]  = useState(false);
  const [commentPostError,setCommentPostError]= useState(false);

  if (!post || typeof post !== 'object') return null;

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
  const canWriteComment = !post.isExternal && (post.source || 'uficonnect') === 'uficonnect';

  async function fetchComments() {
    setCommentsLoading(true);
    setCommentsError(false);
    try {
      const { data } = await client.get(`/feed/${encodeURIComponent(post.id)}/comments`);
      setComments(data.comments || []);
      setCommentsLive(!!data.live);
    } catch {
      setCommentsError(true);
      setComments([]);
    }
    finally { setCommentsLoading(false); }
  }

  function toggleComments() {
    if (showComments) { setShowComments(false); return; }
    setShowComments(true);
    if (comments !== null && !commentsError) return;
    fetchComments();
  }

  async function submitComment(e) {
    e.preventDefault();
    if (!canWriteComment || commentSending) return;
    const content = commentDraft.trim();
    if (!content) return;

    setCommentSending(true);
    setCommentPostError(false);
    try {
      const { data } = await client.post(`/posts/${encodeURIComponent(post.id)}/comments`, { content });
      setComments(prev => [...(prev || []), commentToFeedComment(data.comment)]);
      setCommentsLive(true);
      setCommentDraft('');
      onPostUpdated?.(data.post || { ...post, commentsCount: data.commentsCount });
    } catch {
      setCommentPostError(true);
    } finally {
      setCommentSending(false);
    }
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
        <div style={{ marginTop: 12, borderRadius: 14, overflow: 'hidden', background: 'var(--border)' }}>
          <img src={post.mediaUrl} alt={post.title || 'Post image'}
            style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 400 }}
            onError={e => {
              e.currentTarget.style.display = 'none';
              const placeholder = e.currentTarget.parentElement.querySelector('[data-img-placeholder]');
              if (placeholder) placeholder.style.display = 'flex';
            }} />
          <div data-img-placeholder style={{
            display: 'none', alignItems: 'center', justifyContent: 'center',
            height: 200, color: 'var(--muted)', fontSize: '.85rem', fontWeight: 500,
          }}>
            📷 Image unavailable
          </div>
        </div>
      )}

      {hasVideo && (
        <button onClick={() => onVideoOpen(post)} style={{ all: 'unset', display: 'block', width: '100%', marginTop: 12, cursor: 'pointer' }}>
          <div style={{ borderRadius: 14, overflow: 'hidden', position: 'relative', background: '#000' }}>
            <img src={post.mediaUrl} alt="Video"
              style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 360, opacity: 0.82 }}
              onError={e => {
                e.currentTarget.style.display = 'none';
                const fallback = e.currentTarget.parentElement.querySelector('[data-video-fallback]');
                if (fallback) fallback.style.display = 'flex';
              }} />
            <div data-video-fallback style={{
              display: 'none', position: 'absolute', inset: 0,
              alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,0,0,0.5)', color: 'var(--muted)', fontSize: '.85rem',
            }}>
              🎬 Video unavailable
            </div>
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
                {(c.author?.replace(/^(?:u\/|@)/, '') || '?')[0]?.toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: '.78rem' }}>{c.author}</span>
                  {c.type === 'commit' && <span style={{ fontSize: '.62rem', background: '#1e293b', color: '#94a3b8', borderRadius: 4, padding: '1px 5px' }}>commit</span>}
                  {c.type === 'issue'  && <span style={{ fontSize: '.62rem', background: '#14532d', color: '#86efac', borderRadius: 4, padding: '1px 5px' }}>issue</span>}
                  {c.score > 0 && (
                    <span style={{ fontSize: '.68rem', color: 'var(--muted)' }}>▲ {c.score.toLocaleString()}</span>
                  )}
                  <span style={{ fontSize: '.68rem', color: 'var(--muted)', marginLeft: 'auto' }}>{timeAgo(c.created)}</span>
                </div>
                <p style={{ fontSize: '.83rem', lineHeight: 1.6, margin: 0, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
                  {c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{c.body}</a> : c.body}
                </p>
              </div>
            </div>
          ))}

          {!commentsLoading && commentsError && (
            <div style={{ fontSize: '.78rem', color: 'var(--danger)', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
              Couldn't load comments.
              <button onClick={fetchComments} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '.78rem', fontWeight: 600, padding: 0 }}>
                Try again
              </button>
            </div>
          )}
          {!commentsLoading && !commentsError && comments?.length === 0 && (
            <p style={{ fontSize: '.78rem', color: 'var(--muted)', margin: '0 0 10px' }}>No {sectionLabel.toLowerCase()} found.</p>
          )}

          {/* Read-more link — always shown at bottom */}
          {canWriteComment && (
            <form onSubmit={submitComment} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
              <input
                className="form-input"
                value={commentDraft}
                onChange={e => {
                  setCommentDraft(e.target.value);
                  if (commentPostError) setCommentPostError(false);
                }}
                placeholder="Write a comment..."
                maxLength={1000}
                style={{ flex: 1, fontSize: '.86rem' }}
              />
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={commentSending || !commentDraft.trim()}
                style={{ flexShrink: 0 }}
              >
                {commentSending ? <span className="spinner" /> : 'Send'}
              </button>
            </form>
          )}

          {commentPostError && (
            <div style={{ fontSize: '.76rem', color: 'var(--danger)', marginTop: 8 }}>
              Couldn't post that comment. Try again.
            </div>
          )}

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
}); // PostCard memo

class FeedErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(err) { return { error: err }; }
  componentDidCatch(err, info) { console.error('[Feed] render error:', err, info?.componentStack); }
  render() {
    if (this.state.error) {
      return (
        <div className="empty-state">
          <div className="empty-icon">⚠️</div>
          <div className="empty-title">Some posts couldn't be displayed</div>
          <div className="empty-desc">
            <button className="btn btn-ghost btn-sm" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const FEED_CACHE_KEY       = 'ufi_feed_v1';
const FEED_CACHE_SILENT_MS = 10 * 60 * 1000; // silent bg refresh within 10 min
const FEED_CACHE_SHOW_MS   = 60 * 60 * 1000; // show stale posts up to 1 hr

function readFeedCache() {
  try {
    const raw = localStorage.getItem(FEED_CACHE_KEY);
    if (!raw) return null;
    const { posts, ts } = JSON.parse(raw);
    if (!Array.isArray(posts)) return null;
    const age = Date.now() - ts;
    if (age > FEED_CACHE_SHOW_MS) return null;
    return { posts, fresh: age < FEED_CACHE_SILENT_MS };
  } catch { return null; }
}

function writeFeedCache(posts) {
  try {
    localStorage.setItem(FEED_CACHE_KEY, JSON.stringify({ posts: posts.slice(0, 100), ts: Date.now() }));
  } catch {}
}

export default function Feed() {
  const { profile } = useAuth();
  const [connectedSocial, setConnectedSocial] = useState(null); // null = not yet fetched
  const [socialBannerDismissed, setSocialBannerDismissed] = useState(false);
  const [connecting,    setConnecting]   = useState(false);
  const _cache = readFeedCache();
  const [posts,         setPosts]        = useState(_cache?.posts || []);
  const [loading,       setLoading]      = useState(!_cache);
  const [refreshing,    setRefreshing]   = useState(false);
  const [loadingMore,   setLoadingMore]  = useState(false);
  const [remotePage,    setRemotePage]   = useState(2);
  const [remoteHasMore, setRemoteHasMore]= useState(true);
  const _saved = loadFeedState();
  const [search,        setSearch]       = useState(_saved?.search || '');
  const [searchInput,   setSearchInput]  = useState(_saved?.search || '');
  const [filterOpen,    setFilterOpen]   = useState(false);
  const [videoPost,     setVideoPost]    = useState(null);
  const [lastRefresh,   setLastRefresh]  = useState(null);
  const [filters, setFilters] = useState(_saved?.filters || DEFAULT_FILTERS);
  const [liveActive,    setLiveActive]    = useState(false);
  const [activeTabs,    setActiveTabs]    = useState(_saved?.activeTabs || []); // [] = All
  const [viewMode,      setViewMode]      = useState(_saved?.viewMode || 'feed');

  const filterBtnRef  = useRef(null);
  const panelRef      = useRef(null);
  const knownIds      = useRef(new Set((_cache?.posts || []).map(p => p.id).filter(Boolean)));
  const sentinelRef   = useRef(null);
  const activeTabsRef = useRef(_saved?.activeTabs || []);
  const filtersRef    = useRef(_saved?.filters || DEFAULT_FILTERS);
  const viewModeRef   = useRef(_saved?.viewMode || 'feed');
  const searchRef     = useRef(_saved?.search || '');
  const postsRef      = useRef([]);
  const loadStateRef  = useRef({ loading: false, refreshing: false, loadingMore: false });

  const loadFeed = useCallback(async (manual = false, tabs = [], options = {}) => {
    const {
      silent = false,
      live = manual,
      preserveScroll = silent,
      q,
      filters: requestedFilters,
      mode: requestedMode,
      replace = false,
    } = options || {};
    const activeFilters = { ...DEFAULT_FILTERS, ...(requestedFilters || filtersRef.current) };
    activeFilters.sort = normalizeFeedSort(activeFilters.sort);
    const activeMode = requestedMode || viewModeRef.current;
    const activeSearch = typeof q === 'string' ? q.trim() : searchRef.current.trim();
    const activeSourceTabs = Array.isArray(tabs) ? tabs : activeTabsRef.current;
    const requestedSources = activeFilters.sources?.length ? activeFilters.sources : activeSourceTabs;
    if (!silent) {
      if (manual) setRefreshing(true);
      else setLoading(true);
    }
    try {
      const params = new URLSearchParams({
        limit: `${FEED_PAGE_SIZE}`,
        mode: activeMode,
        sort: activeFilters.sort,
      });
      if (activeFilters.timeRange && activeFilters.timeRange !== 'all') params.set('timeRange', activeFilters.timeRange);
      if (activeSearch) params.set('q', activeSearch);
      if (requestedSources.length === 1) params.set('source', requestedSources[0]);
      else if (requestedSources.length > 1) params.set('sources', requestedSources.join(','));
      if (manual) {
        params.set('bust', '1');
      }
      const url = `/office/feed?${params.toString()}`;
      const { data } = await client.get(url);
      const incoming = data.posts || [];
      const previous = postsRef.current;
      const shouldMerge = (manual || live) && !replace;
      const nextPosts = shouldMerge
        ? mergeFeedPosts([...incoming, ...previous], activeFilters.sort)
        : mergeFeedPosts(incoming, activeFilters.sort);

      if (shouldMerge) {
        const prevIds = new Set(previous.map(p => p.id).filter(Boolean));
        const fresh = nextPosts.filter(p => p?.id && !prevIds.has(p.id)).length;
        if (fresh > 0 && manual && !preserveScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      if (manual && nextPosts.length === 0 && previous.length > 0) {
        setLastRefresh(new Date());
        return;
      }
      knownIds.current = new Set(nextPosts.map(p => p.id).filter(Boolean));
      setPosts(nextPosts);
      if (activeMode === 'feed' && !activeSearch) writeFeedCache(nextPosts);
      if (!shouldMerge || previous.length === 0 || replace) setRemotePage(2);
      setRemoteHasMore(data.hasMore !== false);
      setLastRefresh(new Date());
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []); // eslint-disable-line

  // Keep postsRef in sync so loadFeed can read current posts without a dep cycle
  useEffect(() => { postsRef.current = posts; }, [posts]);
  useEffect(() => { filtersRef.current = filters; }, [filters]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { searchRef.current = search; }, [search]);

  // Persist filter state so the page reopens with the same settings
  useEffect(() => {
    saveFeedState(filters, activeTabs, search, viewMode);
  }, [filters, activeTabs, search, viewMode]);
  useEffect(() => {
    loadStateRef.current = { loading, refreshing, loadingMore };
  }, [loading, refreshing, loadingMore]);

  const switchViewMode = useCallback((mode) => {
    const nextMode = mode === 'archive' ? 'archive' : 'feed';
    if (viewModeRef.current === nextMode) return;
    viewModeRef.current = nextMode;
    setViewMode(nextMode);
    setRemotePage(2);
    setRemoteHasMore(true);
    loadFeed(false, activeTabsRef.current, {
      mode: nextMode,
      filters: filtersRef.current,
      q: searchRef.current,
      replace: true,
    });
  }, [loadFeed]);

  const applyFilters = useCallback((nextFilters) => {
    const next = { ...DEFAULT_FILTERS, ...(nextFilters || {}) };
    next.sort = normalizeFeedSort(next.sort);
    filtersRef.current = next;
    setFilters(next);
    setRemotePage(2);
    setRemoteHasMore(true);
    loadFeed(false, activeTabsRef.current, {
      filters: next,
      q: searchRef.current,
      replace: true,
    });
  }, [loadFeed]);


  const clearFeedControls = useCallback(() => {
    activeTabsRef.current = [];
    filtersRef.current = DEFAULT_FILTERS;
    searchRef.current = '';
    setActiveTabs([]);
    setFilters(DEFAULT_FILTERS);
    setSearch('');
    setSearchInput('');
    setRemotePage(2);
    setRemoteHasMore(true);
    loadFeed(false, [], { filters: DEFAULT_FILTERS, q: '', replace: true });
  }, [loadFeed]);

  // Debounced search handler
  const debouncedSearch = useMemo(
    () => debounce((query) => {
      searchRef.current = query.trim();
      setSearch(query.trim());
      setRemotePage(2);
      setRemoteHasMore(true);
      loadFeed(false, activeTabsRef.current, { q: query.trim(), replace: true });
    }, 400),
    [loadFeed]
  );

  const toggleTab = useCallback((key) => {
    searchRef.current = '';
    setSearch('');
    setSearchInput('');
    if (key === 'all') {
      activeTabsRef.current = [];
      setActiveTabs([]);
      // Clears source filtering only — sort stays whatever's set in the Sort
      // filter (Ranked by default, Balanced still available there).
      loadFeed(false, [], {
        silent: true,
        live: viewModeRef.current === 'feed',
        replace: true,
      });
      return;
    }
    const prev = activeTabsRef.current;
    const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
    activeTabsRef.current = next;
    setActiveTabs(next);
    // Filter client-side immediately; silently fetch more source posts in background
    loadFeed(false, next, {
      silent: true,
      live: viewModeRef.current === 'feed',
      replace: true,
    });
  }, [loadFeed]); // eslint-disable-line

  const loadMoreRemote = useCallback(async () => {
    if (loadingMore || !remoteHasMore) return;
    setLoadingMore(true);
    try {
      const tabs = activeTabsRef.current;
      const activeFilters = { ...DEFAULT_FILTERS, ...filtersRef.current };
      activeFilters.sort = normalizeFeedSort(activeFilters.sort);
      const requestedSources = activeFilters.sources?.length ? activeFilters.sources : tabs;
      const params = new URLSearchParams({
        page: `${remotePage}`,
        limit: `${FEED_PAGE_SIZE}`,
        mode: viewModeRef.current,
        sort: activeFilters.sort,
      });
      const q = searchRef.current.trim();
      if (q) params.set('q', q);
      if (activeFilters.timeRange && activeFilters.timeRange !== 'all') params.set('timeRange', activeFilters.timeRange);
      if (requestedSources.length === 1) params.set('source', requestedSources[0]);
      else if (requestedSources.length > 1) params.set('sources', requestedSources.join(','));
      const { data } = await client.get(`/office/feed?${params.toString()}`);
      const incoming = (data.posts || []).filter(p => !knownIds.current.has(p.id));
      incoming.forEach(p => knownIds.current.add(p.id));
      if (incoming.length > 0) {
        setPosts(prev => mergeFeedPosts([...prev, ...incoming], activeFilters.sort));
      }
      setRemotePage(p => p + 1);
      setRemoteHasMore(data.hasMore !== false);
    } catch {}
    finally { setLoadingMore(false); }
  }, [loadingMore, remoteHasMore, remotePage]);

  const updateFeedPost = useCallback((updatedPost) => {
    if (!updatedPost?.id) return;
    setPosts(prev => prev.map(post =>
      post.id === updatedPost.id ? { ...post, ...updatedPost } : post
    ));
  }, []);

  // Load initial feed — if cache is fresh, show it instantly and stream new posts on top silently
  useEffect(() => {
    const c = readFeedCache();
    loadFeed(false, [], { silent: !!c?.fresh, live: !!c?.fresh });
  }, [loadFeed]); // eslint-disable-line

  useEffect(() => {
    const refreshQuietly = () => {
      const state = loadStateRef.current;
      if (viewModeRef.current !== 'feed') return;
      if (document.hidden || state.loading || state.refreshing || state.loadingMore) return;
      loadFeed(false, activeTabsRef.current, { silent: true, live: true, preserveScroll: true });
    };
    const intervalId = window.setInterval(refreshQuietly, FEED_AUTO_REFRESH_MS);
    const handleVisibility = () => { if (!document.hidden) refreshQuietly(); };
    window.addEventListener('focus', refreshQuietly);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshQuietly);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadFeed]);

  // Scroll-to-refresh: scrolling back up to the very top acts as pull-to-refresh
  useEffect(() => {
    let lastScrollY = window.scrollY;
    let lastPullAt = 0;
    const PULL_COOLDOWN_MS = 8000;
    const handleScroll = () => {
      const y = window.scrollY;
      const pulledToTop = y <= 0 && lastScrollY > 40;
      lastScrollY = y;
      if (!pulledToTop || viewModeRef.current !== 'feed') return;
      const state = loadStateRef.current;
      if (state.loading || state.refreshing || state.loadingMore) return;
      if (Date.now() - lastPullAt < PULL_COOLDOWN_MS) return;
      lastPullAt = Date.now();
      loadFeed(true, activeTabsRef.current, { preserveScroll: true });
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [loadFeed]);

  // Fetch social connection status for personalisation banners
  useEffect(() => {
    if (!profile) { setConnectedSocial({}); return; }
    client.get('/profile/social').then(({ data }) => setConnectedSocial(data.connected || {})).catch(() => setConnectedSocial({}));
  }, [profile]);


  // SSE: stream new posts from all source workers in real time — with reconnection logic
  useEffect(() => {
    let es = null;
    let reconnectAttempt = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;
    const BASE_RECONNECT_DELAY = 1000;
    let reconnectTimeoutId;

    function setupSSE() {
      try {
        const base = import.meta.env.VITE_API_URL || '/api';
        const token = localStorage.getItem('pc_token') || '';
        es = new EventSource(`${base}/feed/stream?token=${encodeURIComponent(token)}`);
        setLiveActive(false);

        es.onopen = () => {
          setLiveActive(true);
          reconnectAttempt = 0; // Reset backoff on successful connection
        };

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
            if (viewModeRef.current !== 'feed') return;
            // Only surface posts that match the active source tabs.
            const tabs = activeTabsRef.current;
            const activeFilters = filtersRef.current;
            const q = searchRef.current.trim().toLowerCase();
            const tabFresh = tabs.length === 0 ? fresh : fresh.filter(p => tabs.includes(p.source));
            const filterFresh = tabFresh.filter(p => {
              if (activeFilters.sources?.length && !activeFilters.sources.includes(p.source)) return false;
              if (activeFilters.timeRange && activeFilters.timeRange !== 'all') {
                const cutoff = timeRangeCutoff(activeFilters.timeRange);
                if (feedPostTime(p) < cutoff) return false;
              }
              if (q) {
                const text = `${p.title || ''} ${p.content || ''} ${p.author?.name || ''} ${p.topic || ''} ${p.sourceLabel || ''}`.toLowerCase();
                if (!text.includes(q)) return false;
              }
              return true;
            });
            if (!filterFresh.length) return;
            setPosts(prev => {
              const next = mergeFeedPosts([...filterFresh, ...prev], activeFilters.sort);
              knownIds.current = new Set(next.map(p => p.id).filter(Boolean));
              return next;
            });
            setLastRefresh(new Date());
          } catch (err) {
            console.error('[SSE] Error parsing message:', err);
          }
        };

        es.onerror = () => {
          setLiveActive(false);
          es?.close();
          es = null;
          // Exponential backoff reconnection with max attempts
          if (reconnectAttempt < MAX_RECONNECT_ATTEMPTS) {
            const delay = BASE_RECONNECT_DELAY * Math.pow(1.5, reconnectAttempt);
            reconnectTimeoutId = window.setTimeout(() => {
              reconnectAttempt += 1;
              setupSSE();
            }, delay);
          }
        };
      } catch (err) {
        console.error('[SSE] Setup error:', err);
        setLiveActive(false);
      }
    }

    setupSSE();

    return () => {
      if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
      if (es) {
        es.close();
        es = null;
      }
      setLiveActive(false);
    };
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

    // Respect sources the user has disabled from the Sources settings page
    try {
      const disabled = new Set(JSON.parse(localStorage.getItem('ufi_disabled_sources') || '[]'));
      if (disabled.size > 0) result = result.filter(p => !disabled.has(p.source));
    } catch { /* ignore */ }

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
    if (activeTabs.length > 0) {
      result = result.filter(p => activeTabs.includes(p.source));
    }

    if (filters.sources.length > 0) {
      result = result.filter(p => filters.sources.includes(p.source));
    }

    // Time range
    if (filters.timeRange && filters.timeRange !== 'all') {
      const cutoff = timeRangeCutoff(filters.timeRange);
      result = result.filter(p => feedPostTime(p) >= cutoff);
    }

    return sortPostsForView(result, filters.sort);
  }, [posts, search, filters, activeTabs]);

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

  // Close filter panel and source picker on outside click
  useEffect(() => {
    function handleClick(e) {
      if (
        filterOpen &&
        panelRef.current && !panelRef.current.contains(e.target) &&
        filterBtnRef.current && !filterBtnRef.current.contains(e.target)
      ) setFilterOpen(false);
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
  const selectedSourceLabel = activeTabs.map(k => SOURCE_META[k]?.label || k).join(', ');

  return (
    <Layout>
      <Helmet>
        <title>Professional News Feed | News & Updates for Your Career | UFIConnect</title>
        <meta name="description" content="Your personalized professional news feed. Get news and updates from Reddit, Hacker News, GitHub, Medium, DEV.to, plus search news on LinkedIn, Twitter, Facebook, YouTube, and more — all tailored to your role and interests." />
        <meta name="keywords" content="professional news, tech news, career news, news feed, industry news, Reddit news, Hacker News, news updates, professional updates, tech updates, career updates, community news, LinkedIn news, Twitter news, Facebook news, networking news, connect news" />
        <link rel="canonical" href="https://uficonnect.org/feed" />
      </Helmet>
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

      </div>


      {/* Toolbar: search + filter + refresh */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', position: 'relative', flexWrap: 'wrap' }}>
        {/* Search */}
        <div style={{ flex: 1, position: 'relative', display: 'flex', gap: 6 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: '.85rem', opacity: 0.4, pointerEvents: 'none' }}>🔍</span>
            <input
              className="form-input"
              placeholder="Search posts…"
              value={searchInput}
              onChange={e => {
                setSearchInput(e.target.value);
                debouncedSearch(e.target.value);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const nextQ = searchInput.trim();
                  searchRef.current = nextQ;
                  setSearch(nextQ);
                  setRemotePage(2);
                  setRemoteHasMore(true);
                  loadFeed(false, activeTabsRef.current, { q: nextQ, replace: true });
                }
              }}
              style={{ paddingLeft: 36, borderRadius: 22, padding: '9px 14px 9px 36px', fontSize: '.875rem' }}
            />
            {searchInput && (
              <button type="button" aria-label="Clear search" onClick={() => {
                searchRef.current = '';
                setSearchInput('');
                setSearch('');
                loadFeed(false, activeTabsRef.current, { q: '', replace: true });
              }}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--muted)' }}>×</button>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              const nextQ = searchInput.trim();
              searchRef.current = nextQ;
              setSearch(nextQ);
              loadFeed(false, activeTabsRef.current, { q: nextQ, replace: true });
            }}
            style={{
              padding: '9px 16px', borderRadius: 22, border: '1.5px solid var(--border)',
              background: searchInput.trim() ? 'var(--primary)' : 'var(--surface)',
              color: searchInput.trim() ? '#fff' : 'var(--muted)',
              fontWeight: 600, fontSize: '.875rem', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              transition: 'background .15s, color .15s',
            }}
          >
            Search
          </button>
        </div>

        {/* Filter button */}
        <div style={{ position: 'relative' }}>
          <button
            ref={filterBtnRef}
            aria-label="Open filter panel"
            aria-expanded={filterOpen}
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
              onChange={applyFilters}
              sources={ALL_FILTER_SOURCES}
              onClose={() => setFilterOpen(false)}
              panelRef={panelRef}
            />
          )}
        </div>

      </div>

      {/* View-mode tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {[
          { key: 'feed',    label: 'Personal Feed' },
          { key: 'archive', label: 'All Collected' },
        ].map(({ key, label }) => {
          const active = viewMode === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => switchViewMode(key)}
              style={{
                padding: '7px 14px', borderRadius: 20, fontWeight: 700, fontSize: '.82rem', cursor: 'pointer',
                border: `1.5px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                background: active ? 'var(--primary)' : 'var(--surface)',
                color: active ? '#fff' : 'var(--text)',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Source tabs — single scrollable row */}
      <div style={{
        display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 14,
        paddingBottom: 4, scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch', msOverflowStyle: 'none',
      }}>
        {SOURCE_TABS.map(tab => {
          const meta  = SOURCE_META[tab.key];
          const color = meta?.color || 'var(--primary)';
          const active = tab.key === 'all' ? activeTabs.length === 0 : activeTabs.includes(tab.key);
          const activeColor = tab.key === 'all' ? 'var(--primary)' : color;
          return (
            <button
              key={tab.key}
              onClick={() => toggleTab(tab.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
                padding: '6px 13px', borderRadius: 20, whiteSpace: 'nowrap',
                border: `1.5px solid ${active ? activeColor : 'var(--border)'}`,
                background: active ? activeColor : 'var(--surface)',
                color: active ? '#fff' : 'var(--text)',
                fontWeight: active ? 700 : 500, fontSize: '.8rem', cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: '.85rem' }}>{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {(activeTabs.length > 0 || activeFilterCount > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 12, fontSize: '.78rem' }}>
          <span style={{ color: 'var(--muted)', fontWeight: 500, marginRight: 2 }}>Showing:</span>

          {activeTabs.length > 0 ? activeTabs.map(key => {
            const meta = SOURCE_META[key] || {};
            const color = meta.color || 'var(--primary)';
            return (
              <span key={key} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 9px', borderRadius: 12,
                background: `${color}18`, color, fontWeight: 600,
                border: `1px solid ${color}44`,
              }}>
                {meta.icon || ''} {meta.label || key}
                <button onClick={() => toggleTab(key)} style={{
                  marginLeft: 2, background: 'none', border: 'none', cursor: 'pointer',
                  color, fontWeight: 700, fontSize: '.75rem', padding: 0, lineHeight: 1,
                }}>×</button>
              </span>
            );
          }) : (
            <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>All sources</span>
          )}

          {filters.timeRange !== 'all' && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 9px', borderRadius: 12,
              background: 'var(--card)', color: 'var(--text)', fontWeight: 600,
              border: '1px solid var(--border)',
            }}>
              {filters.timeRange === '1h' ? 'Past hour' : filters.timeRange === '6h' ? 'Past 6h' : filters.timeRange === 'today' ? 'Past 24h' : filters.timeRange === 'week' ? 'Past week' : filters.timeRange}
              <button onClick={() => applyFilters({ ...filtersRef.current, timeRange: 'all' })} style={{
                marginLeft: 2, background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--muted)', fontWeight: 700, fontSize: '.75rem', padding: 0, lineHeight: 1,
              }}>×</button>
            </span>
          )}

          {filters.sort !== 'newest' && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 9px', borderRadius: 12,
              background: 'var(--card)', color: 'var(--text)', fontWeight: 600,
              border: '1px solid var(--border)',
            }}>
              Sort: {filters.sort}
              <button onClick={() => applyFilters({ ...filtersRef.current, sort: 'newest' })} style={{
                marginLeft: 2, background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--muted)', fontWeight: 700, fontSize: '.75rem', padding: 0, lineHeight: 1,
              }}>×</button>
            </span>
          )}

          {filters.sources.length > 0 && filters.sources.map(key => {
            const meta = SOURCE_META[key] || {};
            return (
              <span key={key} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 9px', borderRadius: 12,
                background: 'var(--card)', color: 'var(--text)', fontWeight: 600,
                border: '1px solid var(--border)',
              }}>
                {meta.label || key}
                <button onClick={() => applyFilters({ ...filtersRef.current, sources: filtersRef.current.sources.filter(s => s !== key) })} style={{
                  marginLeft: 2, background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--muted)', fontWeight: 700, fontSize: '.75rem', padding: 0, lineHeight: 1,
                }}>×</button>
              </span>
            );
          })}

          <button
            onClick={clearFeedControls}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '.75rem', fontWeight: 600, padding: '2px 4px', textDecoration: 'underline' }}
          >
            Clear all
          </button>
        </div>
      )}

      {/* Social connect prompt — logged-in users with no social accounts connected */}
      {profile && connectedSocial !== null && !socialBannerDismissed && !Object.values(connectedSocial).some(Boolean) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
          padding: '12px 16px', borderRadius: 12,
          background: 'linear-gradient(135deg, #FFF7ED 0%, #FEF3C7 100%)',
          border: '1.5px solid #FED7AA',
          fontSize: '.85rem', fontWeight: 500, color: '#92400E',
          boxShadow: '0 2px 8px rgba(234, 88, 12, 0.1)',
        }}>
          <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>🚀</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>Personalize your feed</div>
            <div style={{ fontSize: '.78rem', opacity: 0.9 }}>Connect social accounts to discover content tailored to your interests</div>
          </div>
          <Link to="/connected-accounts" style={{
            background: '#EA580C', color: '#fff', fontWeight: 700, fontSize: '.8rem',
            padding: '7px 14px', borderRadius: 6, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
            display: 'inline-block',
            transition: 'background 0.2s'
          }}>
            Connect now
          </Link>
          <button
            onClick={() => setSocialBannerDismissed(true)}
            style={{
              marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer', color: '#92400E',
              fontSize: '1.1rem', opacity: 0.6, padding: '0 4px', flexShrink: 0,
              transition: 'opacity 0.2s'
            }}
            aria-label="Dismiss"
          >×</button>
        </div>
      )}

      {/* Last refresh time */}
      {lastRefresh && (
        <div style={{
          fontSize: '.78rem', color: 'var(--muted)', marginBottom: 16,
          padding: '8px 12px', borderRadius: 8, background: 'var(--card)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          border: '1px solid var(--border)'
        }}>
          <div>
            {activeTabs.length > 0 && (
              <span style={{ fontWeight: 600, color: SOURCE_META[activeTabs[0]]?.color || 'var(--primary)', marginRight: 8 }}>
                {activeTabs.map(k => `${SOURCE_META[k]?.icon || ''} ${SOURCE_META[k]?.label || k}`.trim()).join(', ')}
              </span>
            )}
            <span style={{ fontWeight: 500 }}>Updated {timeAgo(lastRefresh.toISOString())}</span>
            {posts.length > 0 && <span style={{ marginLeft: 8, opacity: 0.7 }}>· {posts.length.toLocaleString()} post{posts.length !== 1 ? 's' : ''}</span>}
            {search && <span style={{ marginLeft: 8, opacity: 0.7 }}>· searching "{search}"</span>}
            {refreshing && <span style={{ marginLeft: 8, opacity: 0.7 }}>· refreshing…</span>}
          </div>
        </div>
      )}

      {loading ? (
        <div>
          <div style={{
            marginBottom: 16,
            color: 'var(--primary)',
            fontSize: '.85rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <span style={{
              display: 'inline-block',
              animation: 'spin 1s linear infinite',
              transformOrigin: 'center'
            }}>⚡</span>
            {activeTabs.length > 0 ? `Loading ${selectedSourceLabel} posts…` : 'Loading your feed…'}
          </div>
          <PostCardSkeleton />
          <PostCardSkeleton />
          <PostCardSkeleton />
        </div>
      ) : displayed.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">{search ? '🔍' : (activeTabs.length === 1 ? SOURCE_META[activeTabs[0]]?.icon : null) || '📭'}</div>
          <div className="empty-title">
            {search ? `No posts match "${search}"` : activeTabs.length > 0 ? `No ${selectedSourceLabel} posts yet` : 'Your feed is empty'}
          </div>
          <div className="empty-desc">
            {search ? (
              <>
                <p style={{ marginBottom: 8 }}>Try a different search term or clear your filters.</p>
                <button className="btn btn-ghost btn-sm" onClick={() => {
                  searchRef.current = '';
                  setSearch('');
                  setSearchInput('');
                  setRemotePage(2);
                  setRemoteHasMore(true);
                  loadFeed(false, activeTabsRef.current, { q: '', replace: true });
                }}>Clear search</button>
              </>
            ) : activeFilterCount > 0 ? (
              <>
                <p style={{ marginBottom: 8 }}>No posts match your current filters.</p>
                <button className="btn btn-ghost btn-sm" onClick={() => applyFilters(DEFAULT_FILTERS)}>
                  Reset filters
                </button>
              </>
            ) : activeTabs.length > 0 ? (
              <>
                <p style={{ marginBottom: 12 }}>No posts from {selectedSourceLabel} yet. Check back soon or explore other sources!</p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => toggleTab('all')}>Explore all sources</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => loadFeed(true, activeTabsRef.current)}>Refresh now</button>
                </div>
              </>
            ) : (
              <>
                <p style={{ marginBottom: 12 }}>Your feed is ready! Start by connecting your social accounts to personalize your experience.</p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <Link to="/connected-accounts" className="btn btn-primary btn-sm">Connect accounts</Link>
                  <Link to="/groups" className="btn btn-ghost btn-sm">Join communities</Link>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <FeedErrorBoundary>
          <div>
            {displayed.map((post, idx) => (
              <PostCard
                key={post.id || `temp-${idx}-${post.createdAt}`}
                post={post}
                onVideoOpen={setVideoPost}
                onPostUpdated={updateFeedPost}
              />
            ))}
          </div>
          </FeedErrorBoundary>

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} style={{ height: 1 }} />

          {loadingMore && (
            <div style={{ textAlign: 'center', padding: '16px 0 24px' }}>
              <span className="spinner spinner-primary" />
            </div>
          )}
          {!hasMore && displayed.length > 0 && (
            <div style={{
              textAlign: 'center', color: 'var(--muted)', fontSize: '.8rem', marginBottom: 24,
              padding: '12px 16px', borderRadius: 8, background: 'var(--card)',
              border: '1px dashed var(--border)'
            }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>📍 You've reached the end</div>
              Showing {displayed.length.toLocaleString()} post{displayed.length !== 1 ? 's' : ''} · Pull to refresh for new content
            </div>
          )}
        </>
      )}

      {/* Padding to prevent sticky banner from covering content */}
      {!profile && <div style={{ height: 70 }} />}

      {/* Guest sign-in sticky bottom banner */}
      {!profile && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1000,
          background: 'linear-gradient(90deg, #1E40AF, #4F46E5)',
          color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 12, padding: '14px 20px',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.18)',
        }}>
          <span style={{ fontSize: '1.1rem' }}>🌐</span>
          <span style={{ fontSize: '.9rem', fontWeight: 500 }}>
            Sign in to personalise your feed, save posts, and join communities
          </span>
          <Link
            to="/login"
            style={{
              background: '#fff', color: '#2563EB', fontWeight: 700,
              padding: '7px 18px', borderRadius: 20, fontSize: '.85rem',
              textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            Sign In
          </Link>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </Layout>
  );
}
