import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';

const PAGE_SIZE = 20;

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

function debounce(fn, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

function timeAgo(iso) {
  const d = (Date.now() - new Date(iso)) / 86400000;
  if (d < 1) return 'today';
  if (d < 2) return 'yesterday';
  return `${Math.floor(d)}d ago`;
}

function OpportunitySkeleton() {
  return (
    <div className="card opp-card" style={{ marginBottom: 12, opacity: 0.6 }}>
      <div style={{ height: 16, borderRadius: 4, background: 'var(--border)', marginBottom: 12, width: '30%', animation: 'pulse 2s ease-in-out infinite' }} />
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 6, background: 'var(--border)', animation: 'pulse 2s ease-in-out infinite', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ height: 14, borderRadius: 4, background: 'var(--border)', marginBottom: 8, animation: 'pulse 2s ease-in-out infinite' }} />
          <div style={{ height: 12, borderRadius: 4, background: 'var(--border)', width: '70%', animation: 'pulse 2s ease-in-out infinite' }} />
        </div>
      </div>
      <div style={{ height: 12, borderRadius: 4, background: 'var(--border)', marginBottom: 12, width: '60%', animation: 'pulse 2s ease-in-out infinite' }} />
    </div>
  );
}

function SourceBadge({ opp }) {
  const badges = {
    'LinkedIn': { icon: '🔷', color: '#0A66C2', bg: '#E8F0FB' },
    'Remotive': { icon: '🔴', label: 'Live · Remotive', color: '#2563EB', bg: '#EFF6FF' },
    'The Muse': { icon: '✦', label: 'Live · The Muse', color: '#7C3AED', bg: '#F3EEFF' },
    'Remote OK': { icon: '🔴', label: 'Live · Remote OK', color: '#10B981', bg: '#ECFDF5' },
    'USAJobs':   { icon: '🔴', label: 'Live · USAJobs',   color: '#005EA8', bg: '#E8F1FA' },
    'Indeed':    { icon: '🔴', label: 'Live · Indeed',    color: '#2557A7', bg: '#EEF2FB' },
  };
  const badge = badges[opp.source];
  return (
    <span style={{
      fontSize: '.73rem', fontWeight: 600,
      color: badge?.color || 'var(--muted)',
      background: badge?.bg || 'transparent',
      padding: badge ? '3px 8px' : 0,
      borderRadius: 4,
    }}>
      {badge?.label || `${badge?.icon || '•'} ${opp.source}`}
    </span>
  );
}

export default function Opportunities() {
  const [allOpps,   setAllOpps]   = useState([]);
  const [liveCount, setLiveCount] = useState(0);
  const [platformSearchUrls, setPlatformSearchUrls] = useState(null);
  const [filter,    setFilter]    = useState('job');
  const [sort,      setSort]      = useState('match');
  const [remote,    setRemote]    = useState(false);
  const [liveOnly,  setLiveOnly]  = useState(false);
  // Multi-select, same idea as Feed's source chips — which platforms are
  // actually pickable changes with `filter` (Job's sources are Remotive/The
  // Muse/Remote OK/USAJobs; other types pull from a much longer curated
  // list), so this comes from the API's own availableSources rather than a
  // fixed list here, and resets whenever the type filter changes underneath
  // it (a source picked for Jobs has no meaning once you're looking at
  // Grants).
  const [availableSources, setAvailableSources] = useState([]);
  const [sourceFilter, setSourceFilter] = useState([]);
  const [searchInput, setSearchInput] = useState('');
  const [search,    setSearch]    = useState('');
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(false);
  const [page,      setPage]      = useState(1);
  const [refreshTick, setRefreshTick] = useState(0);
  const silentRefreshRef = useRef(false);
  // Set right before a type-filter click (Job/Gig/Grant/etc, including
  // "All") — the fetch effect below reads and clears it. Live sources
  // (Remotive/Muse/RemoteOK/USAJobs/Indeed) are each cached server-side on
  // their own TTL, same as every other source in this app; a type click
  // was previously a passive re-filter of whatever happened to already be
  // cached, same as clicking into a tab that just silently shows stale
  // data. Bust makes clicking "Job" (or any type) double as a real
  // refresh for that type, matching how tab-clicks already work in Feed.
  const bustOnNextFetchRef = useRef(false);

  const searchRef = useRef('');

  // Debounced search
  const debouncedSearch = useMemo(
    () => debounce((query) => {
      searchRef.current = query.trim();
      setSearch(query.trim());
      setPage(1);
    }, 400),
    []
  );

  // Type filter changing invalidates whatever sources were picked (a
  // source chip is scoped to what's poll-able within the current type — see
  // availableSources below), so a stale source picked under Jobs shouldn't
  // silently keep filtering once you switch to Grants.
  useEffect(() => { setSourceFilter([]); }, [filter]);

  // Fetch opportunities with current filters
  useEffect(() => {
    const params = { sort };
    if (filter !== 'all') params.type = filter;
    if (search) params.search = search;
    if (remote) params.remote = true;
    if (sourceFilter.length) params.sources = sourceFilter.join(',');
    if (bustOnNextFetchRef.current) { params.bust = '1'; bustOnNextFetchRef.current = false; }

    // Only show the full loading state on a real filter/search change —
    // refreshTick-driven refetches (scroll-to-refresh) should refill quietly
    // instead of flashing the loading UI over content the user is mid-read of.
    if (!silentRefreshRef.current) setLoading(true);
    silentRefreshRef.current = false;
    setError(false);
    client.get('/opportunities', { params })
      .then(({ data }) => {
        let list = data.opportunities || [];
        if (liveOnly) list = list.filter(o => o.isLive || o.source === 'Remotive');
        setAllOpps(list);
        setLiveCount(data.liveCount || 0);
        setPlatformSearchUrls(data.platformSearchUrls || null);
        setAvailableSources(data.availableSources || []);
      })
      .catch(err => {
        console.error('Failed to load opportunities:', err);
        setError(true);
        setAllOpps([]);
      })
      .finally(() => setLoading(false));
  }, [filter, sort, remote, liveOnly, search, sourceFilter, refreshTick]);

  // Scrolling back up to the top acts as pull-to-refresh, same as every
  // other list page on the site.
  useScrollToRefresh(() => {
    silentRefreshRef.current = true;
    setRefreshTick(t => t + 1);
  }, { enabled: !loading });

  // Paginated display
  const displayed = allOpps.slice(0, page * PAGE_SIZE);
  const hasMore = page * PAGE_SIZE < allOpps.length;

  return (
    <>
      <Helmet>
        <title>Jobs, Gigs, Grants, Events & Career Opportunities | UFconnect</title>
        <meta name="description" content="Browse all career opportunities: full-time jobs, gigs, grants, hackathons, events, open-source opportunities, and learning resources. Discover positions and opportunities for engineers, designers, founders, marketers, product managers, and creatives worldwide." />
        <meta name="keywords" content="job opportunities, career opportunities, gigs, grants, hackathons, events, open source opportunities, learning opportunities, tech jobs, startup jobs, freelance work, internships, positions, career growth, job listings, employment opportunities, career development, work opportunities" />
        <link rel="canonical" href="https://uficonnect.org/opportunities" />
      </Helmet>
      <Layout>
        <div className="page-header">
          <h1 className="page-title">
            All Opportunities
            {liveCount > 0 && (
              <span style={{
                marginLeft: 10, fontSize: '.7rem', fontWeight: 700, color: '#059669',
                background: '#DCFCE7', padding: '3px 10px', borderRadius: 20, display: 'inline-block',
              }}>
                🔴 {liveCount} live
              </span>
            )}
          </h1>
        </div>

        {/* Search bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: '.9rem', pointerEvents: 'none' }}>🔍</span>
            <input
              className="form-input"
              placeholder="Search by title, company, or tag…"
              value={searchInput}
              onChange={e => {
                setSearchInput(e.target.value);
                debouncedSearch(e.target.value);
              }}
              style={{ paddingLeft: 36, borderRadius: 22, fontSize: '.875rem' }}
            />
            {searchInput && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setSearchInput('');
                  searchRef.current = '';
                  setSearch('');
                  setPage(1);
                }}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem',
                  color: 'var(--muted)', padding: 0,
                }}
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Type + filters */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 16, paddingBottom: 4, scrollbarWidth: 'none' }}>
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => {
                bustOnNextFetchRef.current = true;
                setPage(1);
                if (value === filter) {
                  // Already active — setFilter(value) alone wouldn't
                  // actually change state (same value in, same value out),
                  // so the fetch effect's own [filter, ...] dependency
                  // would never re-fire and clicking the current type again
                  // would silently do nothing. refreshTick exists exactly
                  // for this: re-run the same effect without a real filter
                  // change, same "click the tab you're already on to
                  // refresh it" pattern the main Feed uses.
                  setRefreshTick(t => t + 1);
                } else {
                  setFilter(value);
                }
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
                padding: '7px 14px', borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap',
                border: `1.5px solid ${filter === value ? 'var(--primary)' : 'var(--border)'}`,
                background: filter === value ? 'var(--primary)' : 'var(--surface)',
                color: filter === value ? '#fff' : 'var(--text)',
                fontWeight: filter === value ? 700 : 500, fontSize: '.8rem', cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => { bustOnNextFetchRef.current = true; setRemote(!remote); setPage(1); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
              padding: '7px 14px', borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap',
              border: `1.5px solid ${remote ? 'var(--primary)' : 'var(--border)'}`,
              background: remote ? 'var(--primary)' : 'var(--surface)',
              color: remote ? '#fff' : 'var(--text)',
              fontWeight: remote ? 700 : 500, fontSize: '.8rem', cursor: 'pointer',
            }}
          >
            🌍 Remote
          </button>
          <button
            onClick={() => { bustOnNextFetchRef.current = true; setLiveOnly(!liveOnly); setPage(1); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
              padding: '7px 14px', borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap',
              border: `1.5px solid ${liveOnly ? 'var(--primary)' : 'var(--border)'}`,
              background: liveOnly ? 'var(--primary)' : 'var(--surface)',
              color: liveOnly ? '#fff' : 'var(--text)',
              fontWeight: liveOnly ? 700 : 500, fontSize: '.8rem', cursor: 'pointer',
            }}
          >
            🔴 Live only
          </button>
        </div>

        {/* Source filter — multi-select, mirrors Feed's own source chips.
            Scoped to whatever's actually pickable for the current type
            filter (availableSources, from the API) rather than a fixed
            list, since Job's real sources (Remotive/The Muse/Remote OK/
            USAJobs) are a completely different set from Grant's or
            Event's curated ones. Hidden entirely when there's nothing
            meaningful to narrow (0 or 1 source). */}
        {availableSources.length > 1 && (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 16, paddingBottom: 4, scrollbarWidth: 'none', alignItems: 'center' }}>
            <span style={{ fontSize: '.8rem', fontWeight: 600, color: 'var(--muted)', flexShrink: 0 }}>Source</span>
            {availableSources.map((src) => {
              const active = sourceFilter.includes(src);
              return (
                <button
                  key={src}
                  onClick={() => {
                    setSourceFilter(cur => cur.includes(src) ? cur.filter(s => s !== src) : [...cur, src]);
                    setPage(1);
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
                    padding: '6px 12px', borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap',
                    border: `1.5px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                    background: active ? 'var(--primary)' : 'var(--surface)',
                    color: active ? '#fff' : 'var(--text)',
                    fontWeight: active ? 700 : 500, fontSize: '.78rem', cursor: 'pointer',
                  }}
                >
                  {src}
                </button>
              );
            })}
            {sourceFilter.length > 0 && (
              <button
                onClick={() => { setSourceFilter([]); setPage(1); }}
                style={{
                  flexShrink: 0, padding: '6px 10px', border: 'none', background: 'none',
                  color: 'var(--muted)', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline',
                }}
              >
                Clear
              </button>
            )}
          </div>
        )}

        {/* Sort */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <label htmlFor="opp-sort" style={{ fontSize: '.8rem', fontWeight: 600, color: 'var(--muted)' }}>
            Sort by
          </label>
          <select
            id="opp-sort"
            value={sort}
            onChange={e => { setSort(e.target.value); setPage(1); }}
            className="form-input"
            style={{ width: 'auto', padding: '6px 10px', fontSize: '.8rem' }}
          >
            <option value="newest">🕐 Newest</option>
            <option value="match">⭐ Best match</option>
          </select>
        </div>

        {/* LinkedIn and Indeed don't offer a public jobs API — there's no
            legitimate way to pull their listings directly the way Remotive/
            The Muse/RemoteOK/USAJobs are above, and faking that would be
            exactly the kind of low-legitimacy listing this page is trying
            to avoid. What's real and accurate instead: a live search on
            each platform, pre-filled with this user's actual title/role.
            Styled to match the Source filter chips above (same pill shape/
            size/border-radius) per product decision, even though behavior
            is unchanged — still an external link, not an in-app filter —
            so the ↗ and "Search" label stay to keep that honest rather
            than implying these are real aggregated listings like the tabs
            next to them. */}
        {platformSearchUrls && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>
              Search more platforms
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(PLATFORM_META).map(([key, meta]) => (
                platformSearchUrls[key] && (
                  <a
                    key={key}
                    href={platformSearchUrls[key]}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '6px 12px', borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap',
                      background: meta.bg, color: meta.color,
                      fontSize: '.78rem', fontWeight: 700, textDecoration: 'none',
                      border: `1.5px solid ${meta.color}55`,
                    }}
                  >
                    {meta.icon} Search {meta.label} ↗
                  </a>
                )
              ))}
            </div>
          </div>
        )}

        {/* Status messages */}
        {error && (
          <div style={{
            padding: '12px 16px', borderRadius: 12, marginBottom: 16,
            background: '#FEE2E2', color: '#991B1B', fontSize: '.85rem',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>⚠️</span>
            <span>Failed to load opportunities. <button onClick={() => window.location.reload()} style={{ background: 'none', border: 'none', color: '#991B1B', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}>Retry</button></span>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div>
            <div style={{ marginBottom: 12, color: 'var(--muted)', fontSize: '.85rem', fontWeight: 600 }}>
              Finding opportunities…
            </div>
            <OpportunitySkeleton />
            <OpportunitySkeleton />
            <OpportunitySkeleton />
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && displayed.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">🔭</div>
            <div className="empty-title">
              {searchInput ? 'No opportunities found' : 'No matching opportunities'}
            </div>
            <div className="empty-desc">
              {searchInput ? (
                <button className="btn btn-ghost btn-sm" onClick={() => {
                  setSearchInput('');
                  searchRef.current = '';
                  setSearch('');
                  setPage(1);
                }}>Clear search</button>
              ) : (
                <>Try adjusting your filters or check back soon for new opportunities.</>
              )}
            </div>
          </div>
        )}

        {/* Opportunities list */}
        {!loading && !error && displayed.length > 0 && (
          <div>
            <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginBottom: 16, fontWeight: 500 }}>
              {displayed.length === allOpps.length ? (
                `${allOpps.length} opportunit${allOpps.length !== 1 ? 'ies' : 'y'}`
              ) : (
                `Showing ${displayed.length} of ${allOpps.length} opportunit${allOpps.length !== 1 ? 'ies' : 'y'}`
              )}
            </div>

            {displayed.map((opp) => {
              const meta = TYPE_META[opp.type] || TYPE_META.job;
              return (
                <div key={opp.id} className="card opp-card" style={{ marginBottom: 12 }}>
                  {/* Header: badges + status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: '.72rem', fontWeight: 700, color: meta.color,
                      background: meta.bg, padding: '4px 10px', borderRadius: 6,
                    }}>
                      {meta.emoji} {meta.label}
                    </span>
                    {opp.isLive && (
                      <span style={{
                        fontSize: '.68rem', fontWeight: 700, color: '#059669',
                        background: '#DCFCE7', padding: '2px 8px', borderRadius: 4,
                      }}>
                        ● LIVE
                      </span>
                    )}
                    {opp.remote && (
                      <span style={{
                        fontSize: '.68rem', fontWeight: 700, color: '#0284C7',
                        background: '#F0F9FF', padding: '2px 8px', borderRadius: 4,
                      }}>
                        🌍 Remote
                      </span>
                    )}
                    {opp.matchScore > 6 && (
                      <span style={{
                        fontSize: '.68rem', fontWeight: 700, color: '#7C3AED',
                        background: '#F3EEFF', padding: '2px 8px', borderRadius: 4,
                      }}>
                        ⭐ Top match
                      </span>
                    )}
                  </div>

                  {/* Company + title */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                    {opp.logo && (
                      <img
                        src={opp.logo}
                        alt={opp.org}
                        style={{
                          width: 36, height: 36, borderRadius: 6, objectFit: 'contain',
                          border: '1px solid var(--border)', flexShrink: 0,
                        }}
                        onError={e => { e.currentTarget.style.display = 'none'; }}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '.95rem', marginBottom: 2, lineHeight: 1.3, color: 'var(--text)' }}>
                        {opp.title}
                      </div>
                      <div style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
                        {opp.org}
                      </div>
                    </div>
                  </div>

                  {/* Meta: location, pay, posted */}
                  <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: '.8rem', color: 'var(--muted)', flexWrap: 'wrap' }}>
                    <span>📍 {opp.location}</span>
                    {opp.pay && <span>💵 {opp.pay}</span>}
                    <span>🕐 {timeAgo(opp.posted)}</span>
                  </div>

                  {/* Tags */}
                  {(opp.tags || []).length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                      {opp.tags.slice(0, 4).map(t => (
                        <span
                          key={t}
                          style={{
                            fontSize: '.7rem', fontWeight: 600, color: 'var(--primary)',
                            background: 'var(--primary-light)', padding: '2px 8px', borderRadius: 6,
                          }}
                        >
                          {t}
                        </span>
                      ))}
                      {opp.tags.length > 4 && (
                        <span style={{ fontSize: '.7rem', color: 'var(--muted)' }}>
                          +{opp.tags.length - 4} more
                        </span>
                      )}
                    </div>
                  )}

                  {/* Match reasons */}
                  {opp.matchReasons?.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                      {opp.matchReasons.slice(0, 3).map(r => (
                        <span
                          key={r}
                          style={{
                            fontSize: '.68rem', fontWeight: 600, color: '#059669',
                            background: '#ECFDF5', padding: '2px 8px', borderRadius: 8,
                          }}
                        >
                          ✦ {r}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Footer: source + link */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                    <SourceBadge opp={opp} />
                    <a href={opp.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', textDecoration: 'none' }}>
                      <button className="btn btn-primary btn-sm">View →</button>
                    </a>
                  </div>
                </div>
              );
            })}

            {/* Load more button */}
            {hasMore && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <button
                  className="btn btn-ghost"
                  onClick={() => setPage(p => p + 1)}
                  style={{ fontSize: '.9rem' }}
                >
                  Load more ({allOpps.length - displayed.length} remaining)
                </button>
              </div>
            )}

            {/* End message */}
            {!hasMore && displayed.length > 0 && (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '.8rem', padding: '20px 0' }}>
                All {allOpps.length} opportunit{allOpps.length !== 1 ? 'ies' : 'y'} shown
              </div>
            )}
          </div>
        )}

        <style>{`
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        `}</style>
      </Layout>
    </>
  );
}
