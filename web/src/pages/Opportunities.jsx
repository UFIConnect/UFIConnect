import { useState, useEffect, useRef, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';

const PAGE_SIZE = 30;

const TYPE_META = {
  job:        { label: 'Job',         emoji: '💼', color: '#2563EB', bg: '#EFF6FF' },
  gig:        { label: 'Gig',         emoji: '⚡', color: '#7C3AED', bg: '#F3EEFF' },
  grant:      { label: 'Grant',       emoji: '🏦', color: '#059669', bg: '#ECFDF5' },
  event:      { label: 'Event',       emoji: '📅', color: '#D97706', bg: '#FFFBEB' },
  hackathon:  { label: 'Hackathon',   emoji: '🏆', color: '#DB2777', bg: '#FDF2F8' },
  opensource: { label: 'Open Source', emoji: '🌐', color: '#EA580C', bg: '#FFF7ED' },
  learning:   { label: 'Learning',    emoji: '🎓', color: '#0284C7', bg: '#F0F9FF' },
};

const PLATFORM_META = {
  linkedin:  { label: 'LinkedIn',   icon: '🔷', color: '#0A66C2', bg: '#E8F0FB' },
  indeed:    { label: 'Indeed',     icon: '🔍', color: '#2557A7', bg: '#EEF2FB' },
  glassdoor: { label: 'Glassdoor',  icon: '🟢', color: '#0CAA41', bg: '#E6F9EE' },
  wellfound: { label: 'Wellfound',  icon: '🚀', color: '#000',    bg: '#F3F4F6' },
  google:    { label: 'Google',     icon: '🔎', color: '#EA4335', bg: '#FEE8E6' },
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
  if (opp.source === 'LinkedIn') return (
    <span style={{ fontSize: '.73rem', fontWeight: 600, color: '#0A66C2', background: '#E8F0FB', padding: '3px 8px', borderRadius: 4 }}>
      🔷 LinkedIn
    </span>
  );
  if (opp.source === 'Remotive') return (
    <span style={{ fontSize: '.73rem', fontWeight: 600, color: '#2563EB', background: '#EFF6FF', padding: '3px 8px', borderRadius: 4 }}>
      🔴 Live · Remotive
    </span>
  );
  if (opp.source === 'The Muse') return (
    <span style={{ fontSize: '.73rem', fontWeight: 600, color: '#7C3AED', background: '#F3EEFF', padding: '3px 8px', borderRadius: 4 }}>
      ✦ The Muse
    </span>
  );
  return <span style={{ fontSize: '.75rem', color: 'var(--muted)' }}>via {opp.source}</span>;
}

export default function Opportunities() {
  const { profile } = useAuth();
  const [opps,        setOpps]        = useState([]);
  const [liveCount,   setLiveCount]   = useState(0);
  const [filter,      setFilter]      = useState('all');
  const [remote,      setRemote]      = useState(false);
  const [liveOnly,    setLiveOnly]    = useState(false);
  const [search,      setSearch]      = useState('');
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [page,        setPage]        = useState(1);
  const [searchUrls,  setSearchUrls]  = useState(null);
  const [userRole,    setUserRole]    = useState('');
  const [userTitle,   setUserTitle]   = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const debounceRef = useRef(null);

  const fetchOpps = useCallback((params = {}, bust = false, silent = false) => {
    if (!silent) {
      if (bust) setRefreshing(true); else setLoading(true);
    }
    const finalParams = bust ? { ...params, bust: '1' } : params;
    client.get('/opportunities', { params: finalParams })
      .then(({ data }) => {
        let list = data.opportunities || [];
        if (liveOnly) list = list.filter(o => o.isLive || o.source === 'Remotive' || o.source === 'The Muse');
        setOpps(list);
        if (!silent) setPage(1);
        setLastRefresh(new Date());
        setLiveCount(data.liveCount || 0);
        if (data.platformSearchUrls) setSearchUrls(data.platformSearchUrls);
        if (data.userTitle) setUserTitle(data.userTitle);
        if (data.userRole) setUserRole(data.userRole);
      })
      .catch(console.error)
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, [liveOnly]); // eslint-disable-line

  useEffect(() => {
    const params = {};
    if (filter !== 'all') params.type   = filter;
    if (remote)           params.remote = 'true';
    if (search)           params.search = search;
    fetchOpps(params);
  }, [filter, remote, liveOnly]); // eslint-disable-line

  // Auto-refresh every 10 minutes silently in the background
  useEffect(() => {
    const id = setInterval(() => {
      const params = {};
      if (filter !== 'all') params.type   = filter;
      if (remote)           params.remote = 'true';
      if (search)           params.search = search;
      fetchOpps(params, false, true);
    }, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [filter, remote, search, fetchOpps]); // eslint-disable-line

  function handleSearchChange(e) {
    const val = e.target.value;
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = {};
      if (filter !== 'all') params.type   = filter;
      if (remote)           params.remote = 'true';
      if (val)              params.search = val;
      fetchOpps(params);
    }, 300);
  }

  function handleRefresh() {
    const params = {};
    if (filter !== 'all') params.type   = filter;
    if (remote)           params.remote = 'true';
    if (search)           params.search = search;
    fetchOpps(params, true);
  }

  // Prefer specific title (e.g. "Senior Frontend Engineer") over macro label
  const displayTitle = userTitle || profile?.title || '';
  const roleLabel    = userRole
    ? userRole.split('/')[0].trim()
    : profile?.preferences?.role?.split('/')[0]?.trim() || '';
  const searchLabel  = displayTitle || roleLabel;

  return (
    <>
      <Helmet>
        <title>Jobs, Gigs & Opportunities | UFIConnect</title>
        <meta name="description" content="Personalized jobs, gigs, grants, events, and learning opportunities matched to your role and interests." />
      </Helmet>
      <Layout>
        <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h1 className="page-title">Opportunities</h1>
            <p className="page-subtitle">
              {searchLabel
                ? <><strong>{searchLabel}</strong> roles ranked first · jobs, gigs, grants, events — matched to your profile.</>
                : 'Jobs, gigs, grants, events — personalised to your role and skills.'}
              {liveCount > 0 && (
                <span style={{ marginLeft: 8, fontSize: '.78rem', fontWeight: 600, color: '#2563EB', background: '#EFF6FF', padding: '2px 8px', borderRadius: 4 }}>
                  🔴 {liveCount} live
                </span>
              )}
              {lastRefresh && (
                <span style={{ marginLeft: 8, fontSize: '.72rem', color: 'var(--muted)' }}>
                  Updated {lastRefresh.toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleRefresh}
            disabled={refreshing}
            style={{ marginTop: 4, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>↻</span>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {/* ── Platform search strip ── */}
        {searchUrls && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.4px' }}>
              Search live {searchLabel ? `"${searchLabel}" jobs` : 'jobs'} on:
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(PLATFORM_META).map(([key, { label, icon, color, bg }]) => (
                searchUrls[key] && (
                  <a
                    key={key}
                    href={searchUrls[key]}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '7px 14px', borderRadius: 20, fontSize: '.8rem', fontWeight: 600,
                      background: bg, color, border: `1.5px solid ${color}30`,
                      textDecoration: 'none', transition: 'all .15s',
                    }}
                    onMouseOver={e => e.currentTarget.style.boxShadow = `0 2px 10px ${color}30`}
                    onMouseOut={e => e.currentTarget.style.boxShadow = 'none'}
                  >
                    {icon} {label} ↗
                  </a>
                )
              ))}
            </div>
          </div>
        )}

        {/* ── Search bar ── */}
        <div className="search-wrap" style={{ marginBottom: 12 }}>
          <span className="search-icon">🔍</span>
          <input
            className="search-input"
            placeholder="Search by title, company, or tag…"
            value={search}
            onChange={handleSearchChange}
          />
        </div>

        {/* ── Type + remote filters ── */}
        <div className="filter-bar" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
          {FILTERS.map(({ value, label }) => (
            <button key={value} className={`filter-btn${filter === value ? ' active' : ''}`} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
          <button className={`filter-btn${remote ? ' active' : ''}`} onClick={() => setRemote(r => !r)}>
            🌍 Remote only
          </button>
          <button
            className={`filter-btn${liveOnly ? ' active' : ''}`}
            style={liveOnly ? { background: '#2563EB', color: '#fff', borderColor: '#2563EB' } : {}}
            onClick={() => setLiveOnly(l => !l)}
          >
            🔴 Live only
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
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
            <p style={{ fontSize: '.8rem', color: 'var(--muted)', marginBottom: 10 }}>
              {opps.length} opportunit{opps.length !== 1 ? 'ies' : 'y'} · showing {Math.min(page * PAGE_SIZE, opps.length)}
            </p>
            {opps.slice(0, page * PAGE_SIZE).map((opp) => {
              const meta = TYPE_META[opp.type] || TYPE_META.job;
              return (
                <div key={opp.id} className="card opp-card" style={{ marginBottom: 12 }}>
                  <div className="opp-header">
                    <span className="opp-type-badge" style={{ background: meta.bg, color: meta.color }}>
                      {meta.emoji} {meta.label}
                    </span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {opp.isLive && (
                        <span style={{ fontSize: '.65rem', fontWeight: 700, color: '#059669', background: '#DCFCE7', padding: '2px 7px', borderRadius: 4 }}>
                          ● LIVE
                        </span>
                      )}
                      {opp.remote && <span className="tag" style={{ fontSize: '.7rem' }}>🌍 Remote</span>}
                      {opp.matchScore > 6 && (
                        <span style={{ fontSize: '.65rem', fontWeight: 700, color: '#7C3AED', background: '#F3EEFF', padding: '2px 7px', borderRadius: 4 }}>
                          ⭐ Top match
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Company + title */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 2 }}>
                    {opp.logo && (
                      <img src={opp.logo} alt={opp.org}
                        style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'contain', border: '1px solid #E2E8F0', flexShrink: 0 }}
                        onError={e => { e.target.style.display = 'none'; }} />
                    )}
                    <div>
                      <div className="opp-title">{opp.title}</div>
                      <div className="opp-org">{opp.org}</div>
                    </div>
                  </div>

                  <div className="opp-meta">
                    <span>📍 {opp.location}</span>
                    {opp.pay && <span className="opp-pay">💵 {opp.pay}</span>}
                    <span>🕐 {timeAgo(opp.posted)}</span>
                  </div>

                  <div className="tags" style={{ marginBottom: 10 }}>
                    {(opp.tags || []).map(t => <span key={t} className="tag">{t}</span>)}
                  </div>

                  {/* Match reasons */}
                  {opp.matchReasons?.length > 0 && (
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
                      {opp.matchReasons.map(r => (
                        <span key={r} style={{ fontSize: '.68rem', fontWeight: 600, color: '#059669', background: '#ECFDF5', padding: '2px 8px', borderRadius: 8 }}>
                          ✦ {r}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="opp-footer">
                    <SourceBadge opp={opp} />
                    <a href={opp.sourceUrl} target="_blank" rel="noopener noreferrer">
                      <button className="btn btn-primary btn-sm">View →</button>
                    </a>
                  </div>
                </div>
              );
            })}
            {opps.length > page * PAGE_SIZE && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <button className="btn btn-ghost" onClick={() => setPage(p => p + 1)}>
                  Load more opportunities ({opps.length - page * PAGE_SIZE} remaining)
                </button>
              </div>
            )}
          </div>
        )}
      </Layout>
    </>
  );
}
