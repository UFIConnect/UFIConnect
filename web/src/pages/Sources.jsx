import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import Layout from '../components/Layout';
import client from '../api/client';

const SOURCE_META = {
  reddit:        { label: 'Reddit',          color: '#FF4500', icon: '🟠' },
  hackernews:    { label: 'Hacker News',      color: '#FF6600', icon: '🗞' },
  devto:         { label: 'DEV Community',    color: '#3B49DF', icon: '👩‍💻' },
  bluesky:       { label: 'Bluesky',          color: '#0085FF', icon: '🦋' },
  github:        { label: 'GitHub',           color: '#24292F', icon: '🐙' },
  gitlab:        { label: 'GitLab',           color: '#FC6D26', icon: '🦊' },
  youtube:       { label: 'YouTube',          color: '#FF0000', icon: '▶️' },
  medium:        { label: 'Medium',           color: '#1A8917', icon: '📝' },
  stackoverflow: { label: 'Stack Overflow',   color: '#F48024', icon: '📚' },
  mastodon:      { label: 'Mastodon',         color: '#6364FF', icon: '🦣' },
  lobsters:      { label: 'Lobsters',         color: '#AC130D', icon: '🦞' },
  arxiv:         { label: 'arXiv',            color: '#B31B1B', icon: '🔬' },
  producthunt:   { label: 'Product Hunt',     color: '#DA552F', icon: '🚀' },
  techcrunch:    { label: 'TechCrunch',       color: '#0D9F3F', icon: '📰' },
  theverge:      { label: 'The Verge',        color: '#FF3333', icon: '⬛' },
  indiehackers:  { label: 'Indie Hackers',    color: '#0E2150', icon: '💡' },
  hashnode:      { label: 'freeCodeCamp',     color: '#006400', icon: '🔥' },
  arstechnica:   { label: 'Ars Technica',     color: '#FF6600', icon: '📡' },
  wired:         { label: 'WIRED',            color: '#111111', icon: '🔌' },
  theregister:   { label: 'The Register',     color: '#CC0000', icon: '📋' },
  venturebeat:   { label: 'VentureBeat',      color: '#1E6FBF', icon: '💹' },
  smashing:      { label: 'Smashing Mag',     color: '#E9620A', icon: '🎨' },
  phoronix:      { label: 'Phoronix',         color: '#2B7BB9', icon: '🐧' },
  infoq:         { label: 'InfoQ',            color: '#67B346', icon: '🏗️' },
  mittr:         { label: 'MIT Tech Review',  color: '#A31F34', icon: '🔬' },
  remoteok:      { label: 'Remote OK',        color: '#10B981', icon: '💻' },
  yc:            { label: 'Y Combinator',     color: '#FF6600', icon: 'YC' },
  crunchbase:    { label: 'Crunchbase',       color: '#146AFF', icon: 'CB' },
  behance:       { label: 'Behance',          color: '#053EFF', icon: 'Be' },
  designweb:     { label: 'Design Web',       color: '#DB2777', icon: 'UX' },
  indeed:        { label: 'Indeed',           color: '#2557A7', icon: '💼' },
  usajobs:       { label: 'USAJobs',          color: '#005EA8', icon: '🏛️' },
  uficonnect:    { label: 'UFIConnect',       color: '#6366F1', icon: '🌐' },
};

function relativeTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function HealthDot({ postCount, lastFetch }) {
  const age = lastFetch ? (Date.now() - new Date(lastFetch).getTime()) / 60000 : 9999;
  const ok = postCount > 0 && age < 30;
  const stale = postCount > 0 && age >= 30;
  return (
    <span title={ok ? 'Live' : stale ? 'Stale' : 'No data'} style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
      background: ok ? '#22C55E' : stale ? '#F59E0B' : '#94A3B8',
      boxShadow: ok ? '0 0 0 2px #DCFCE7' : stale ? '0 0 0 2px #FEF3C7' : 'none',
    }} />
  );
}

function SourceCard({ source, expanded, onToggle }) {
  const meta = SOURCE_META[source.id] || {};
  const color = source.color || meta.color || '#6366F1';
  const icon = source.emoji || meta.icon || source.id.slice(0, 2).toUpperCase();

  return (
    <div className="card" style={{ overflow: 'hidden', transition: 'box-shadow .15s' }}>
      {/* Header row */}
      <div
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: 'pointer' }}
      >
        {/* Icon */}
        <div style={{
          width: 44, height: 44, borderRadius: 12, background: color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, fontSize: '1.1rem', color: '#fff', fontWeight: 700,
        }}>
          {icon}
        </div>

        {/* Name + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '.92rem' }}>{source.name}</span>
            <HealthDot postCount={source.postCount} lastFetch={source.lastFetch} />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 2, fontSize: '.76rem', color: 'var(--muted)' }}>
            <span>{source.postCount} posts</span>
            {source.totalSeen > source.postCount && (
              <span>({source.totalSeen} seen)</span>
            )}
            <span>·</span>
            <span>{relativeTime(source.lastFetch)}</span>
          </div>
        </div>

        {/* Expand toggle */}
        <span style={{ fontSize: '.75rem', color: 'var(--muted)', flexShrink: 0 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* Expanded sample posts */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '0 0 8px' }}>
          {source.description && (
            <p style={{ margin: '10px 16px 6px', fontSize: '.78rem', color: 'var(--muted)', lineHeight: 1.5 }}>
              {source.description}
            </p>
          )}
          {(source.samplePosts || []).length === 0 ? (
            <p style={{ padding: '8px 16px', fontSize: '.8rem', color: 'var(--muted)', fontStyle: 'italic' }}>
              No posts cached yet
            </p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {source.samplePosts.map((p, i) => (
                <li key={p.id || i} style={{
                  padding: '8px 16px',
                  borderBottom: i < source.samplePosts.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  <a
                    href={p.sourceUrl || p.url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--text)', textDecoration: 'none', display: 'block' }}
                  >
                    <div style={{ fontSize: '.83rem', fontWeight: 600, lineHeight: 1.4, marginBottom: 3 }}>
                      {p.title || p.content?.slice(0, 90) || '(no title)'}
                    </div>
                    <div style={{ display: 'flex', gap: 8, fontSize: '.72rem', color: 'var(--muted)' }}>
                      {p.author && <span>by {p.author}</span>}
                      {p.createdAt && <span>· {relativeTime(p.createdAt)}</span>}
                      {(p.likesCount > 0) && (
                        <span>· ▲ {p.likesCount}</span>
                      )}
                      {p.commentsCount > 0 && <span>· 💬 {p.commentsCount}</span>}
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <div style={{ padding: '8px 16px 4px' }}>
            <Link
              to={`/?source=${source.id}`}
              onClick={() => {
                // Navigate to feed filtered by this source
                window.dispatchEvent(new CustomEvent('feed:setSource', { detail: source.id }));
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: '.76rem', fontWeight: 600, color: color,
                textDecoration: 'none',
              }}
            >
              View all from {source.name} in feed →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Sources() {
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [search,   setSearch]   = useState('');
  const [expanded, setExpanded] = useState(null);
  const [sortBy,   setSortBy]   = useState('posts'); // posts | name | fresh

  useEffect(() => {
    client.get('/feed/sources?sample=5')
      .then(r => setData(r.data))
      .catch(e => setError(e?.response?.data?.error || e.message || 'Failed to load sources'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!data?.sources) return [];
    let list = data.sources;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q)
      );
    }
    if (sortBy === 'posts')  list = [...list].sort((a, b) => b.postCount - a.postCount);
    if (sortBy === 'name')   list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === 'fresh')  list = [...list].sort((a, b) => new Date(b.lastFetch || 0) - new Date(a.lastFetch || 0));
    return list;
  }, [data, search, sortBy]);

  const liveSources  = (data?.sources || []).filter(s => {
    const age = s.lastFetch ? (Date.now() - new Date(s.lastFetch).getTime()) / 60000 : 9999;
    return s.postCount > 0 && age < 30;
  }).length;

  return (
    <Layout>
      <Helmet>
        <title>Sources | UFIConnect</title>
        <meta name="description" content="All live data sources powering your feed — see which sources are active, how many posts they have cached, and their latest content." />
      </Helmet>

      <div className="page-header">
        <h1 className="page-title">Live Sources</h1>
        <p className="page-subtitle">
          All data sources powering your feed. Posts are cached continuously by background workers and ranked by freshness and engagement.
        </p>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <span className="spinner spinner-primary" />
          <p style={{ marginTop: 12, color: 'var(--muted)', fontSize: '.85rem' }}>Loading sources…</p>
        </div>
      )}

      {error && (
        <div style={{
          padding: '12px 16px', borderRadius: 8, background: '#FEF2F2',
          color: '#DC2626', border: '1px solid #FECACA', marginBottom: 20, fontSize: '.85rem',
        }}>
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Stats bar */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 12, marginBottom: 24,
          }}>
            {[
              { label: 'Total Sources', value: data.totalSources, icon: '📡' },
              { label: 'Live Now',      value: liveSources,        icon: '🟢' },
              { label: 'Cached Posts',  value: data.totalPosts,    icon: '📦' },
              { label: 'Global Cache',  value: data.globalCacheCount, icon: '🗄️' },
            ].map(stat => (
              <div key={stat.label} className="card" style={{ padding: '14px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: '1.4rem', marginBottom: 4 }}>{stat.icon}</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, lineHeight: 1 }}>{stat.value ?? '—'}</div>
                <div style={{ fontSize: '.7rem', color: 'var(--muted)', marginTop: 3 }}>{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Search + sort */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: 1, position: 'relative', minWidth: 180 }}>
              <span style={{
                position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                fontSize: '.85rem', opacity: 0.4, pointerEvents: 'none',
              }}>🔍</span>
              <input
                className="form-input"
                placeholder="Search sources…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ paddingLeft: 34, borderRadius: 20, padding: '8px 14px 8px 34px', fontSize: '.85rem' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[['posts', '# Posts'], ['fresh', 'Freshest'], ['name', 'A–Z']].map(([val, lbl]) => (
                <button
                  key={val}
                  onClick={() => setSortBy(val)}
                  style={{
                    padding: '7px 13px', borderRadius: 20, border: `1.5px solid ${sortBy === val ? 'var(--primary)' : 'var(--border)'}`,
                    background: sortBy === val ? 'var(--primary)' : 'var(--surface)',
                    color: sortBy === val ? '#fff' : 'var(--text)',
                    fontSize: '.78rem', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* Source count */}
          <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginBottom: 12 }}>
            {filtered.length} source{filtered.length !== 1 ? 's' : ''}
            {search ? ` matching "${search}"` : ''}
          </div>

          {/* Source cards */}
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: 'var(--muted)', fontSize: '.9rem' }}>
              No sources found{search ? ` for "${search}"` : ''}.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtered.map(source => (
                <SourceCard
                  key={source.id}
                  source={source}
                  expanded={expanded === source.id}
                  onToggle={() => setExpanded(expanded === source.id ? null : source.id)}
                />
              ))}
            </div>
          )}

          {data.refreshedAt && (
            <div style={{ textAlign: 'center', padding: '24px 0 8px', fontSize: '.72rem', color: 'var(--muted)' }}>
              Snapshot taken {relativeTime(data.refreshedAt)}
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
