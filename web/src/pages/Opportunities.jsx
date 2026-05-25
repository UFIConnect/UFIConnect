import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import client from '../api/client';

const TYPE_META = {
  job:        { label: 'Job',          emoji: '💼', color: '#2563EB', bg: '#EFF6FF' },
  gig:        { label: 'Gig',          emoji: '⚡', color: '#7C3AED', bg: '#F3EEFF' },
  grant:      { label: 'Grant',        emoji: '🏦', color: '#059669', bg: '#ECFDF5' },
  event:      { label: 'Event',        emoji: '📅', color: '#D97706', bg: '#FFFBEB' },
  hackathon:  { label: 'Hackathon',    emoji: '🏆', color: '#DB2777', bg: '#FDF2F8' },
  opensource: { label: 'Open Source',  emoji: '🌐', color: '#EA580C', bg: '#FFF7ED' },
  learning:   { label: 'Learning',     emoji: '🎓', color: '#0284C7', bg: '#F0F9FF' },
};

const FILTERS = [
  { value: 'all', label: 'All' },
  ...Object.entries(TYPE_META).map(([value, { label, emoji }]) => ({ value, label: `${emoji} ${label}` })),
];

function timeAgo(iso) {
  const d = (Date.now() - new Date(iso)) / 86400000;
  if (d < 1) return 'today';
  if (d < 2) return 'yesterday';
  return `${Math.floor(d)}d ago`;
}

export default function Opportunities() {
  const [opps,      setOpps]      = useState([]);
  const [filter,    setFilter]    = useState('all');
  const [remote,    setRemote]    = useState(false);
  const [linkedin,  setLinkedin]  = useState(false);
  const [search,    setSearch]    = useState('');
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    const params = {};
    if (filter !== 'all') params.type   = filter;
    if (remote)           params.remote = 'true';
    if (search)           params.search = search;
    setLoading(true);
    client.get('/opportunities', { params })
      .then(({ data }) => {
        let list = data.opportunities || [];
        if (linkedin) list = list.filter(o => o.source === 'LinkedIn');
        setOpps(list);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filter, remote, linkedin, search]);

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Opportunities</h1>
        <p className="page-subtitle">Jobs, gigs, grants, events, hackathons and more — tailored to your profile.</p>
      </div>

      {/* Search */}
      <div className="search-wrap">
        <span className="search-icon">🔍</span>
        <input
          className="search-input"
          placeholder="Search by title, company, or tag…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Type filter */}
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
        <button
          className={`filter-btn${remote ? ' active' : ''}`}
          onClick={() => setRemote((r) => !r)}
        >
          🌍 Remote only
        </button>
        <button
          className={`filter-btn${linkedin ? ' active' : ''}`}
          style={linkedin ? { background:'#0A66C2', color:'#fff', borderColor:'#0A66C2' } : {}}
          onClick={() => setLinkedin((l) => !l)}
        >
          🔷 LinkedIn
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding: 48 }}>
          <span className="spinner spinner-primary" />
        </div>
      ) : opps.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🔭</div>
          <div className="empty-title">No results</div>
          <div className="empty-desc">Try adjusting your filters or search term.</div>
        </div>
      ) : (
        <div>
          {opps.map((opp) => {
            const meta = TYPE_META[opp.type] || TYPE_META.job;
            return (
              <div key={opp.id} className="card opp-card" style={{ marginBottom: 12 }}>
                <div className="opp-header">
                  <span
                    className="opp-type-badge"
                    style={{ background: meta.bg, color: meta.color }}
                  >
                    {meta.emoji} {meta.label}
                  </span>
                  {opp.remote && <span className="tag" style={{ fontSize: '.7rem' }}>🌍 Remote</span>}
                </div>
                <div className="opp-title">{opp.title}</div>
                <div className="opp-org">{opp.org}</div>
                <div className="opp-meta">
                  <span>📍 {opp.location}</span>
                  {opp.pay && <span className="opp-pay">💵 {opp.pay}</span>}
                  <span>🕐 Posted {timeAgo(opp.posted)}</span>
                  {opp.matchScore > 0 && (
                    <span style={{ color:'var(--success)' }}>⭐ {opp.matchScore} match points</span>
                  )}
                </div>
                <div className="tags" style={{ marginBottom: 12 }}>
                  {opp.tags.map((t) => (
                    <span key={t} className="tag">{t}</span>
                  ))}
                </div>
                <div className="opp-footer">
                  {opp.source === 'LinkedIn' ? (
                    <span style={{ fontSize: '.75rem', fontWeight: 600, color: '#0A66C2', background: '#E8F0FB', padding: '3px 8px', borderRadius: 4 }}>
                      🔷 LinkedIn
                    </span>
                  ) : (
                    <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>via {opp.source}</span>
                  )}
                  <a href={opp.sourceUrl} target="_blank" rel="noopener noreferrer">
                    <button className="btn btn-primary btn-sm">View →</button>
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Layout>
  );
}
