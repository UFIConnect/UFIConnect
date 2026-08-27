import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import Layout from '../components/Layout';
import client from '../api/client';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';

const DISABLED_KEY = 'ufi_disabled_sources';

function loadDisabled() {
  try { return new Set(JSON.parse(localStorage.getItem(DISABLED_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveDisabled(set) {
  localStorage.setItem(DISABLED_KEY, JSON.stringify([...set]));
}

const SOURCE_META = {
  reddit:        { label: 'Reddit',           icon: '🟠', color: '#FF4500', desc: 'Community discussions and threads' },
  hackernews:    { label: 'Hacker News',       icon: '🗞',  color: '#FF6600', desc: 'Tech links and founder discussions' },
  devto:         { label: 'DEV Community',     icon: '👩‍💻', color: '#3B49DF', desc: 'Developer articles and tutorials' },
  github:        { label: 'GitHub',            icon: '🐙', color: '#24292F', desc: 'Open source repos and projects' },
  gitlab:        { label: 'GitLab',            icon: '🦊', color: '#FC6D26', desc: 'GitLab projects and activity' },
  youtube:       { label: 'YouTube',           icon: '▶️', color: '#FF0000', desc: 'Tech and creator video content' },
  medium:        { label: 'Medium',            icon: '📝', color: '#1A8917', desc: 'Long-form articles and essays' },
  stackoverflow: { label: 'Stack Overflow',    icon: '📚', color: '#F48024', desc: 'Programming Q&A and answers' },
  mastodon:      { label: 'Mastodon',          icon: '🦣', color: '#6364FF', desc: 'Decentralised social posts' },
  bluesky:       { label: 'Bluesky',           icon: '🦋', color: '#0085FF', desc: 'Open social network posts' },
  lobsters:      { label: 'Lobsters',          icon: '🦞', color: '#AC130D', desc: 'Curated tech link aggregator' },
  arxiv:         { label: 'arXiv',             icon: '🔬', color: '#B31B1B', desc: 'Academic research papers' },
  producthunt:   { label: 'Product Hunt',      icon: '🚀', color: '#DA552F', desc: 'New product and startup launches' },
  techcrunch:    { label: 'TechCrunch',        icon: '📰', color: '#0D9F3F', desc: 'Tech and startup news' },
  theverge:      { label: 'The Verge',         icon: '⬛', color: '#FF3333', desc: 'Tech, science and culture' },
  indiehackers:  { label: 'Indie Hackers',     icon: '💡', color: '#0E2150', desc: 'Bootstrapper and founder stories' },
  hashnode:      { label: 'freeCodeCamp',      icon: '🔥', color: '#006400', desc: 'Free coding tutorials and guides' },
  arstechnica:   { label: 'Ars Technica',      icon: '📡', color: '#FF6600', desc: 'Deep-dive tech and science' },
  wired:         { label: 'WIRED',             icon: '🔌', color: '#111111', desc: 'Tech, culture and future thinking' },
  theregister:   { label: 'The Register',      icon: '📋', color: '#CC0000', desc: 'Enterprise IT and open-source news' },
  venturebeat:   { label: 'VentureBeat',       icon: '💹', color: '#1E6FBF', desc: 'AI, enterprise tech and funding' },
  smashing:      { label: 'Smashing Magazine', icon: '🎨', color: '#E9620A', desc: 'Web design and frontend dev' },
  phoronix:      { label: 'Phoronix',          icon: '🐧', color: '#2B7BB9', desc: 'Linux and open-source hardware' },
  infoq:         { label: 'InfoQ',             icon: '🏗️', color: '#67B346', desc: 'Software architecture and DevOps' },
  mittr:         { label: 'MIT Tech Review',   icon: '🔬', color: '#A31F34', desc: 'Deep tech and AI policy' },
  remoteok:      { label: 'Remote OK',         icon: '💻', color: '#10B981', desc: 'Remote job listings' },
  yc:            { label: 'Y Combinator',      icon: '🦾', color: '#FF6600', desc: 'YC blog and startup essays' },
  crunchbase:    { label: 'Crunchbase News',   icon: '💰', color: '#146AFF', desc: 'Startup funding and company news' },
  behance:       { label: 'Behance',           icon: '🖼️', color: '#053EFF', desc: 'Creative portfolio projects' },
  designweb:     { label: 'Design & Web',      icon: '✏️', color: '#DB2777', desc: 'CSS, UX and design inspiration' },
  indeed:        { label: 'Indeed',            icon: '💼', color: '#2557A7', desc: 'Remote job listings' },
  usajobs:       { label: 'USAJobs',           icon: '🏛️', color: '#005EA8', desc: 'U.S. federal government job openings' },
  uficonnect:    { label: 'UFIconnect',        icon: '🌐', color: '#6366F1', desc: 'Posts from your community' },
};

const CATEGORIES = [
  { id: 'developer',  label: 'Developer',            sources: ['github', 'gitlab', 'devto', 'stackoverflow', 'hackernews', 'lobsters', 'arxiv', 'phoronix', 'infoq'] },
  { id: 'news',       label: 'Tech News',             sources: ['techcrunch', 'theverge', 'arstechnica', 'wired', 'theregister', 'venturebeat', 'mittr'] },
  { id: 'social',     label: 'Social & Community',   sources: ['reddit', 'mastodon', 'bluesky', 'indiehackers'] },
  { id: 'content',    label: 'Writing & Video',       sources: ['medium', 'hashnode', 'youtube', 'smashing'] },
  { id: 'startups',   label: 'Startups & Business',  sources: ['producthunt', 'yc', 'crunchbase'] },
  { id: 'jobs',       label: 'Jobs',                  sources: ['indeed', 'remoteok', 'usajobs'] },
  { id: 'design',     label: 'Design & Creative',     sources: ['behance', 'designweb'] },
  { id: 'community',  label: 'UFIconnect',            sources: ['uficonnect'] },
];

function Toggle({ enabled, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      onClick={e => { e.stopPropagation(); onChange(!enabled); }}
      style={{
        flexShrink: 0,
        width: 44, height: 24, borderRadius: 12,
        background: enabled ? '#6366F1' : 'var(--border)',
        border: 'none', cursor: 'pointer', position: 'relative',
        transition: 'background .2s',
        padding: 0,
      }}
    >
      <span style={{
        position: 'absolute',
        top: 3, left: enabled ? 23 : 3,
        width: 18, height: 18, borderRadius: '50%',
        background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,.2)',
        transition: 'left .2s',
        display: 'block',
      }} />
    </button>
  );
}

function HealthDot({ postCount, lastFetch }) {
  const age = lastFetch ? (Date.now() - new Date(lastFetch).getTime()) / 60000 : 9999;
  const live = postCount > 0 && age < 30;
  const stale = postCount > 0 && age >= 30;
  const color = live ? '#22C55E' : stale ? '#F59E0B' : '#94A3B8';
  const label = live ? 'Live' : stale ? 'Updating' : 'No data yet';
  return (
    <span title={label} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: '.68rem', color, fontWeight: 600,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: color,
        boxShadow: live ? `0 0 0 2px ${color}33` : 'none', display: 'inline-block',
      }} />
      {label}
    </span>
  );
}

function relativeTime(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function SourceRow({ sourceId, health, enabled, onToggle, expanded, onExpand }) {
  const meta = SOURCE_META[sourceId] || { label: sourceId, icon: '📡', color: '#6366F1', desc: '' };
  const { postCount = 0, lastFetch, samplePosts = [] } = health || {};

  return (
    <div style={{
      borderRadius: 12,
      border: '1px solid var(--border)',
      background: enabled ? 'var(--surface)' : 'var(--bg-secondary)',
      overflow: 'hidden',
      opacity: enabled ? 1 : 0.55,
      transition: 'opacity .2s, border-color .2s',
    }}>
      {/* Main row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
        {/* Icon */}
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: meta.color, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1rem', color: '#fff', fontWeight: 700,
        }}>
          {meta.icon}
        </div>

        {/* Name + desc */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '.88rem' }}>{meta.label}</span>
            {health && <HealthDot postCount={postCount} lastFetch={lastFetch} />}
          </div>
          <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: 1, lineHeight: 1.4 }}>
            {meta.desc}
          </div>
        </div>

        {/* Post count + expand + toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {postCount > 0 && (
            <span style={{
              fontSize: '.68rem', color: 'var(--muted)', fontWeight: 600,
              background: 'var(--bg-secondary)', borderRadius: 6, padding: '2px 7px',
            }}>
              {postCount} posts
            </span>
          )}
          {samplePosts.length > 0 && (
            <button
              onClick={onExpand}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--muted)', fontSize: '.7rem', padding: '4px 2px',
              }}
              title={expanded ? 'Hide preview' : 'Preview posts'}
            >
              {expanded ? '▲' : '▼'}
            </button>
          )}
          <Toggle enabled={enabled} onChange={onToggle} />
        </div>
      </div>

      {/* Expanded sample posts */}
      {expanded && samplePosts.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {samplePosts.slice(0, 3).map((p, i) => (
            <a
              key={p.id || i}
              href={p.sourceUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block', padding: '9px 14px',
                borderBottom: i < 2 ? '1px solid var(--border)' : 'none',
                textDecoration: 'none', color: 'inherit',
              }}
            >
              <div style={{ fontSize: '.8rem', fontWeight: 600, lineHeight: 1.4, marginBottom: 2 }}>
                {p.title || p.content?.slice(0, 80) || '(no title)'}
              </div>
              <div style={{ fontSize: '.7rem', color: 'var(--muted)', display: 'flex', gap: 8 }}>
                {p.author && <span>{p.author}</span>}
                {p.createdAt && <span>· {relativeTime(p.createdAt)}</span>}
                {p.likesCount > 0 && <span>· ▲ {p.likesCount}</span>}
              </div>
            </a>
          ))}
          <div style={{ padding: '8px 14px' }}>
            <Link
              to="/"
              onClick={() => window.dispatchEvent(new CustomEvent('feed:setSource', { detail: sourceId }))}
              style={{ fontSize: '.73rem', fontWeight: 600, color: meta.color, textDecoration: 'none' }}
            >
              See all {meta.label} posts in feed →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Sources() {
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [search,    setSearch]    = useState('');
  const [expanded,  setExpanded]  = useState(null);
  const [disabled,  setDisabled]  = useState(loadDisabled);

  const loadSources = useCallback((opts = {}) => {
    if (!opts.silent) setLoading(true);
    return client.get('/feed/sources?sample=3')
      .then(r => { setData(r.data); setError(null); })
      .catch(e => setError(e?.response?.data?.error || e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadSources(); }, [loadSources]);

  // Scrolling back up to the top acts as pull-to-refresh, same as every
  // other list page — refetches quietly (no full-page loading spinner).
  useScrollToRefresh(() => loadSources({ silent: true }), { enabled: !loading });

  const toggle = useCallback((sourceId) => {
    setDisabled(prev => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      saveDisabled(next);
      return next;
    });
  }, []);

  const enableAll  = () => { setDisabled(new Set()); saveDisabled(new Set()); };
  const disableAll = (ids) => { const s = new Set(ids); setDisabled(s); saveDisabled(s); };

  // Build a health map: sourceId → { postCount, lastFetch, samplePosts }
  const healthMap = useMemo(() => {
    const map = {};
    for (const s of (data?.sources || [])) {
      map[s.id] = { postCount: s.postCount, lastFetch: s.lastFetch, samplePosts: s.samplePosts || [] };
    }
    return map;
  }, [data]);

  // All known source IDs (union of API data + SOURCE_META)
  const allSourceIds = useMemo(() => {
    const fromApi = (data?.sources || []).map(s => s.id);
    const fromMeta = Object.keys(SOURCE_META);
    return [...new Set([...fromApi, ...fromMeta])];
  }, [data]);

  const q = search.trim().toLowerCase();
  const matchesSearch = (id) => {
    if (!q) return true;
    const meta = SOURCE_META[id] || {};
    return (meta.label || id).toLowerCase().includes(q) ||
           (meta.desc || '').toLowerCase().includes(q);
  };

  const enabledCount  = allSourceIds.filter(id => !disabled.has(id)).length;
  const liveCount     = (data?.sources || []).filter(s => {
    const age = s.lastFetch ? (Date.now() - new Date(s.lastFetch).getTime()) / 60000 : 9999;
    return s.postCount > 0 && age < 30;
  }).length;

  return (
    <Layout>
      <Helmet>
        <title>Feed Sources | UFIconnect</title>
        <meta name="description" content="Control which sources appear in your UFIconnect feed." />
      </Helmet>

      <Link to="/profile" className="btn-back" style={{ marginBottom: 14 }}><span className="btn-back-icon">‹</span> Back to Profile</Link>

      <div className="page-header">
        <h1 className="page-title">Feed Sources</h1>
        <p className="page-subtitle">
          Turn sources on or off to control what shows up in your feed.
        </p>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <span className="spinner spinner-primary" />
          <p style={{ marginTop: 12, color: 'var(--muted)', fontSize: '.85rem' }}>Loading…</p>
        </div>
      )}

      {error && (
        <div style={{
          padding: '12px 16px', borderRadius: 8, marginBottom: 20,
          background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', fontSize: '.85rem',
        }}>
          {error}
        </div>
      )}

      {!loading && (
        <>
          {/* Summary bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
            padding: '12px 16px', borderRadius: 12, background: 'var(--bg-secondary)',
            marginBottom: 20, border: '1px solid var(--border)',
          }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontWeight: 700, fontSize: '.9rem' }}>
                {enabledCount} of {allSourceIds.length} sources active
              </div>
              <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: 2 }}>
                {liveCount > 0 ? `${liveCount} fetching live right now` : 'Sources update in the background'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {disabled.size > 0 && (
                <button
                  onClick={enableAll}
                  className="btn btn-sm btn-outline"
                  style={{ fontSize: '.75rem' }}
                >
                  Enable all
                </button>
              )}
              {disabled.size < allSourceIds.length && (
                <button
                  onClick={() => disableAll(allSourceIds)}
                  className="btn btn-sm btn-ghost"
                  style={{ fontSize: '.75rem' }}
                >
                  Disable all
                </button>
              )}
            </div>
          </div>

          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 20 }}>
            <span style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              fontSize: '.85rem', opacity: 0.35, pointerEvents: 'none',
            }}>🔍</span>
            <input
              className="form-input"
              placeholder="Search sources…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 34, borderRadius: 20, fontSize: '.85rem' }}
            />
          </div>

          {/* Disabled banner */}
          {disabled.size > 0 && !q && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, marginBottom: 16,
              background: '#FFF7ED', border: '1px solid #FED7AA',
              fontSize: '.8rem', color: '#92400E', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>⚠️</span>
              <span>
                {disabled.size} source{disabled.size !== 1 ? 's are' : ' is'} hidden from your feed.
              </span>
              <button onClick={enableAll} style={{
                marginLeft: 'auto', background: 'none', border: 'none',
                color: '#92400E', fontWeight: 700, cursor: 'pointer', fontSize: '.8rem', textDecoration: 'underline',
              }}>
                Restore all
              </button>
            </div>
          )}

          {/* Categories */}
          {CATEGORIES.map(cat => {
            const visibleIds = cat.sources.filter(id => matchesSearch(id));
            if (visibleIds.length === 0) return null;
            return (
              <div key={cat.id} style={{ marginBottom: 28 }}>
                <div style={{
                  fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)',
                  textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 10,
                }}>
                  {cat.label}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {visibleIds.map(id => (
                    <SourceRow
                      key={id}
                      sourceId={id}
                      health={healthMap[id]}
                      enabled={!disabled.has(id)}
                      onToggle={() => toggle(id)}
                      expanded={expanded === id}
                      onExpand={() => setExpanded(expanded === id ? null : id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Sources not in any category (from API but not in CATEGORIES) */}
          {(() => {
            const categorised = new Set(CATEGORIES.flatMap(c => c.sources));
            const uncategorised = allSourceIds.filter(id => !categorised.has(id) && matchesSearch(id));
            if (!uncategorised.length) return null;
            return (
              <div style={{ marginBottom: 28 }}>
                <div style={{
                  fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)',
                  textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 10,
                }}>
                  Other
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {uncategorised.map(id => (
                    <SourceRow
                      key={id}
                      sourceId={id}
                      health={healthMap[id]}
                      enabled={!disabled.has(id)}
                      onToggle={() => toggle(id)}
                      expanded={expanded === id}
                      onExpand={() => setExpanded(expanded === id ? null : id)}
                    />
                  ))}
                </div>
              </div>
            );
          })()}

          {q && allSourceIds.filter(matchesSearch).length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: '.9rem' }}>
              No sources match "{search}".
            </div>
          )}

          {data?.refreshedAt && (
            <div style={{ textAlign: 'center', padding: '16px 0 4px', fontSize: '.7rem', color: 'var(--muted)' }}>
              Source data updated {relativeTime(data.refreshedAt)}
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
