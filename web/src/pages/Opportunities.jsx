import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
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

function SourceBadge({ opp }) {
  if (opp.source === 'LinkedIn') {
    return (
      <span style={{ fontSize: '.75rem', fontWeight: 600, color: '#0A66C2', background: '#E8F0FB', padding: '3px 8px', borderRadius: 4 }}>
        🔷 LinkedIn
      </span>
    );
  }
  if (opp.source === 'Remotive') {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '.75rem', fontWeight: 600, color: '#2563EB', background: '#EFF6FF', padding: '3px 8px', borderRadius: 4 }}>
        🔴 Live · Remotive
      </span>
    );
  }
  return (
    <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>via {opp.source}</span>
  );
}

export default function Opportunities() {
  const [opps,      setOpps]      = useState([]);
  const [liveCount, setLiveCount] = useState(0);
  const [filter,    setFilter]    = useState('all');
  const [remote,    setRemote]    = useState(false);
  const [liveOnly,  setLiveOnly]  = useState(false);
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
        if (liveOnly) list = list.filter(o => o.isLive || o.source === 'Remotive');
        setOpps(list);
        setLiveCount(data.liveCount || 0);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filter, remote, liveOnly, search]);

  return (
    <>
      <Helmet>
        <title>Remote Jobs, Grants & Tech Opportunities | UFIConnect</title>
        <meta name="description" content="Discover remote jobs, gigs, grants, hackathons, and learning opportunities curated for your role. Find roles that match your skills and interests." />
      </Helmet>
      <Layout>
        <div className="page-header">
        <h1 className="page-title">Opportunities</h1>
        <p className="page-subtitle">
          Jobs, gigs, grants, events, hackathons — personalised to your role and skills.
          {liveCount > 0 && (
            <span style={{ marginLeft: 8, fontSize: '.78rem', fontWeight: 600, color: '#2563EB', background: '#EFF6FF', padding: '2px 8px', borderRadius: 4 }}>
              🔴 {liveCount} live listings
            </span>
          )}
        </p>
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
          className={`filter-btn${liveOnly ? ' active' : ''}`}
          style={liveOnly ? { background: '#2563EB', color: '#fff', borderColor: '#2563EB' } : {}}
          onClick={() => setLiveOnly((l) => !l)}
        >
          🔴 Live jobs
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
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {opp.isLive && (
                      <span style={{ fontSize: '.65rem', fontWeight: 700, color: '#059669', background: '#DCFCE7', padding: '2px 7px', borderRadius: 4 }}>
                        ● LIVE
                      </span>
                    )}
                    {opp.remote && <span className="tag" style={{ fontSize: '.7rem' }}>🌍 Remote</span>}
                  </div>
                </div>

                {/* Company logo + title row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 2 }}>
                  {opp.logo && (
                    <img
                      src={opp.logo}
                      alt={opp.org}
                      style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'contain', border: '1px solid #E2E8F0', flexShrink: 0 }}
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  )}
                  <div>
                    <div className="opp-title">{opp.title}</div>
                    <div className="opp-org">{opp.org}</div>
                  </div>
                </div>

                <div className="opp-meta">
                  <span>📍 {opp.location}</span>
                  {opp.pay && <span className="opp-pay">💵 {opp.pay}</span>}
                  <span>🕐 Posted {timeAgo(opp.posted)}</span>
                  {opp.matchScore > 0 && (
                    <span style={{ color:'var(--success)' }}>⭐ {opp.matchScore} match</span>
                  )}
                </div>

                <div className="tags" style={{ marginBottom: 12 }}>
                  {(opp.tags || []).map((t) => (
                    <span key={t} className="tag">{t}</span>
                  ))}
                </div>

                <div className="opp-footer">
                  <SourceBadge opp={opp} />
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
    </>
  );
}
