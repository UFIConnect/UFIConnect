import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';

const PAGE_SIZE = 20;

const TYPE_META = {
  job:        { label: 'Job',         emoji: 'Job', color: '#2563EB', bg: '#EFF6FF' },
  gig:        { label: 'Gig',         emoji: 'Gig', color: '#7C3AED', bg: '#F3EEFF' },
  grant:      { label: 'Grant',       emoji: 'Grant', color: '#059669', bg: '#ECFDF5' },
  event:      { label: 'Event',       emoji: 'Event', color: '#D97706', bg: '#FFFBEB' },
  hackathon:  { label: 'Hackathon',   emoji: 'Hack', color: '#DB2777', bg: '#FDF2F8' },
  opensource: { label: 'Open Source', emoji: 'OSS', color: '#EA580C', bg: '#FFF7ED' },
  learning:   { label: 'Learning',    emoji: 'Learn', color: '#0284C7', bg: '#F0F9FF' },
};

// None of these five has a public jobs-listing API (see the backend's
// getPlatformSearchUrls) — Glassdoor/Handshake/Wellfound/Google were
// briefly tried as promoted source-tab entries instead of plain links and
// reverted: a single static search-link card standing in for a real
// "source" ended up being exactly the kind of listing this page exists to
// avoid. Plain external links, personalized to the user's title/role/resume
// (see getPlatformSearchUrls), is the honest version of this.
// Glassdoor, Handshake, and Wellfound all gate their job search behind a
// login wall (confirmed live — clicking through lands on a sign-in prompt,
// not results), unlike LinkedIn/Google which show real results with no
// account needed. loginRequired drives an honest label instead of a bare
// "Search X ↗" that reads the same as the two that actually work without
// signing in and then surprises whoever isn't already a member.
// LinkedIn specifically is a plain search link only because its real Jobs
// API sits behind LinkedIn's Talent Solutions partner program — no self-
// serve path, unlike the OAuth app already set up for basic profile login
// (see PLATFORMS.linkedin's own note server-side). This link itself is
// fully functional today (real search results, no account needed), so a
// "Coming soon" label here would be misleading — that messaging lives on
// the Connected Accounts page instead, where it actually describes
// something incomplete (the OAuth connection only imports a profile, not
// posts) rather than something that already works.
const PLATFORM_META = {
  linkedin:  { label: 'LinkedIn',  icon: 'in', color: '#0A66C2', bg: '#E8F0FB' },
  glassdoor: { label: 'Glassdoor', icon: 'GD', color: '#0CAA41', bg: '#E6F9EE', loginRequired: true },
  handshake: { label: 'Handshake', icon: 'HS', color: '#F97316', bg: '#FFF3E8', loginRequired: true },
  wellfound: { label: 'Wellfound', icon: 'WF', color: '#111827', bg: '#F3F4F6', loginRequired: true },
  google:    { label: 'Google',    icon: 'G', color: '#EA4335', bg: '#FEE8E6' },
};

const FILTERS = [
  { value: 'all', label: 'All' },
  ...Object.entries(TYPE_META).map(([value, { label }]) => ({ value, label })),
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
    'LinkedIn':  { icon: 'in', color: '#0A66C2', bg: '#E8F0FB' },
    'Remotive':  { icon: 'RM', label: 'Live · Remotive', color: '#2563EB', bg: '#EFF6FF' },
    'The Muse':  { icon: 'MU', label: 'Live · The Muse', color: '#7C3AED', bg: '#F3EEFF' },
    'Remote OK': { icon: 'RO', label: 'Live · Remote OK', color: '#10B981', bg: '#ECFDF5' },
    'USAJobs':   { icon: 'US', label: 'Live · USAJobs',   color: '#005EA8', bg: '#E8F1FA' },
    'Indeed':    { icon: 'IN', label: 'Live · Indeed',    color: '#2557A7', bg: '#EEF2FB' },
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
      {badge?.label || `${badge?.icon || ''} ${opp.source}`.trim()}
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,     setError]     = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore,   setHasMore]   = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const silentRefreshRef = useRef(false);
  const refreshRequestRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef(null);
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
    }, 400),
    []
  );

  // Type filter changing invalidates whatever sources were picked (a
  // source chip is scoped to what's poll-able within the current type — see
  // availableSources below), so a stale source picked under Jobs shouldn't
  // silently keep filtering once you switch to Grants.
  useEffect(() => { setSourceFilter([]); }, [filter]);

  // Fetch the first page whenever a real filter/search/sort change happens
  // — /opportunities now supports real server-side offset/limit (added
  // alongside this) instead of this page fetching everything in one shot
  // and slicing it client-side, so scrolling to the bottom can actually ask
  // the server for more instead of just revealing more of what's already
  // in memory.
  useEffect(() => {
    const params = { sort, limit: PAGE_SIZE, offset: 0 };
    const refreshRequest = refreshRequestRef.current;
    if (refreshRequest) {
      params.bust = '1';
      params.refresh = refreshRequest.key;
      if (refreshRequest.excludeIds.length) params.exclude = refreshRequest.excludeIds.join(',');
      refreshRequestRef.current = null;
    }
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
        setTotalCount(data.totalCount || list.length);
        setHasMore(!!data.hasMore);
        setLiveCount(data.liveCount || 0);
        setPlatformSearchUrls(data.platformSearchUrls || null);
        setAvailableSources(data.availableSources || []);
      })
      .catch(err => {
        console.error('Failed to load opportunities:', err);
        setError(true);
        if (!refreshRequest) {
          setAllOpps([]);
          setHasMore(false);
        }
      })
      .finally(() => {
        setLoading(false);
        if (refreshRequest) setRefreshing(false);
      });
  }, [filter, sort, remote, liveOnly, search, sourceFilter, refreshTick]);

  const requestRefresh = useCallback(() => {
    if (refreshing) return;
    refreshRequestRef.current = {
      key: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      excludeIds: allOpps.map((opportunity) => opportunity.id).filter(Boolean).slice(0, 100),
    };
    silentRefreshRef.current = true;
    setRefreshing(true);
    setRefreshTick((tick) => tick + 1);
  }, [allOpps, refreshing]);

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || loading || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const params = { sort, limit: PAGE_SIZE, offset: allOpps.length };
    if (filter !== 'all') params.type = filter;
    if (search) params.search = search;
    if (remote) params.remote = true;
    if (sourceFilter.length) params.sources = sourceFilter.join(',');
    client.get('/opportunities', { params })
      .then(({ data }) => {
        let list = data.opportunities || [];
        if (liveOnly) list = list.filter(o => o.isLive || o.source === 'Remotive');
        setAllOpps(prev => [...prev, ...list]);
        setTotalCount(data.totalCount || 0);
        setHasMore(!!data.hasMore);
      })
      .catch(err => console.error('Failed to load more opportunities:', err))
      .finally(() => { loadingMoreRef.current = false; setLoadingMore(false); });
  }, [loading, hasMore, allOpps.length, sort, filter, search, remote, sourceFilter, liveOnly]);

  // Same sentinel + IntersectionObserver pattern as the main Feed page
  // (400px rootMargin fires the fetch just before the sentinel is actually
  // on screen, so more content is ready by the time someone scrolls to it).
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore(); },
      { rootMargin: '400px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  // Scrolling back up to the top acts as pull-to-refresh, same as every
  // other list page on the site.
  useScrollToRefresh(() => {
    requestRefresh();
  }, { enabled: !loading && !refreshing });

  const displayed = allOpps;

  return (
    <>
      <Helmet>
        <title>Jobs, Gigs, Grants, Events & Career Opportunities | UFIconnect</title>
        <meta name="description" content="Browse all career opportunities: full-time jobs, gigs, grants, hackathons, events, open-source opportunities, and learning resources. Discover positions and opportunities for engineers, designers, founders, marketers, product managers, and creatives worldwide." />
        <meta name="keywords" content="job opportunities, career opportunities, gigs, grants, hackathons, events, open source opportunities, learning opportunities, tech jobs, startup jobs, freelance work, internships, positions, career growth, job listings, employment opportunities, career development, work opportunities" />
        <link rel="canonical" href="https://uficonnect.org/opportunities" />
      </Helmet>
      <Layout>
        <div className="page-header opportunities-page-header">
          <h1 className="page-title">
            All Opportunities
            {liveCount > 0 && (
              <span style={{
                marginLeft: 10, fontSize: '.7rem', fontWeight: 700, color: '#059669',
                background: '#DCFCE7', padding: '3px 10px', borderRadius: 20, display: 'inline-block',
              }}>
                {liveCount} live
              </span>
            )}
          </h1>
          <Link to="/resume-builder" className="btn btn-primary btn-sm opportunities-resume-builder">Resume Builder</Link>
        </div>

        {/* Search bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: '.75rem', fontWeight: 800, pointerEvents: 'none' }}>Q</span>
            <input
              className="form-input"
              placeholder="Search by title, company, or tag..."
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
            onClick={() => { bustOnNextFetchRef.current = true; setRemote(!remote); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
              padding: '7px 14px', borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap',
              border: `1.5px solid ${remote ? 'var(--primary)' : 'var(--border)'}`,
              background: remote ? 'var(--primary)' : 'var(--surface)',
              color: remote ? '#fff' : 'var(--text)',
              fontWeight: remote ? 700 : 500, fontSize: '.8rem', cursor: 'pointer',
            }}
          >
            Remote
          </button>
          <button
            onClick={() => { bustOnNextFetchRef.current = true; setLiveOnly(!liveOnly); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
              padding: '7px 14px', borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap',
              border: `1.5px solid ${liveOnly ? 'var(--primary)' : 'var(--border)'}`,
              background: liveOnly ? 'var(--primary)' : 'var(--surface)',
              color: liveOnly ? '#fff' : 'var(--text)',
              fontWeight: liveOnly ? 700 : 500, fontSize: '.8rem', cursor: 'pointer',
            }}
          >
            Live only
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
                onClick={() => setSourceFilter([])}
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
        <div className="opportunities-sort-row">
          <label htmlFor="opp-sort" style={{ fontSize: '.8rem', fontWeight: 600, color: 'var(--muted)' }}>
            Sort by
          </label>
          <select
            id="opp-sort"
            value={sort}
            onChange={e => setSort(e.target.value)}
            className="form-input"
            style={{ width: 'auto', padding: '6px 10px', fontSize: '.8rem' }}
          >
            <option value="newest">Newest</option>
            <option value="match">Best match</option>
          </select>
          <button
            type="button"
            className="btn btn-ghost btn-sm opportunities-refresh-btn opportunities-refresh-btn--sort"
            onClick={requestRefresh}
            disabled={loading || refreshing}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {/* LinkedIn/Glassdoor/Handshake/Wellfound/Google don't offer a
            public jobs API — there's no legitimate way to pull their
            listings directly the way Remotive/The Muse/RemoteOK/USAJobs/
            Indeed are above, and faking that would be exactly the kind of
            low-legitimacy listing this page is trying to avoid. What's real
            and accurate instead: a live search on each platform, pre-filled
            with this user's actual title/role and (see the backend's
            getPlatformSearchUrls) their selected resume's own keywords.
            Styled to match the Source filter chips above (same pill shape/
            size/border-radius) even though behavior is unchanged — still an
            external link, not an in-app filter — so the ↗ and "Search"
            label stay to keep that honest rather than implying these are
            real aggregated listings like the tabs next to them. */}
        {platformSearchUrls && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>
              Search more platforms
            </div>
            <div className="opportunities-platform-links">
              {Object.entries(PLATFORM_META).filter(([key]) => key !== 'google').map(([key, meta]) => (
                platformSearchUrls[key] && (
                  <a
                    key={key}
                    href={platformSearchUrls[key]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="opportunities-platform-link"
                    title={meta.loginRequired ? `${meta.label} requires a school or employer login to search` : undefined}
                    style={{ background: meta.bg, color: meta.color, borderColor: `${meta.color}55` }}
                  >
                    {meta.icon} Search {meta.label}{meta.loginRequired ? ' (login required)' : ''}
                  </a>
                )
              ))}
              {platformSearchUrls.google && (
                <a
                  href={platformSearchUrls.google}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="opportunities-platform-link"
                  style={{
                    background: PLATFORM_META.google.bg,
                    color: PLATFORM_META.google.color,
                    borderColor: `${PLATFORM_META.google.color}55`,
                  }}
                >
                  {PLATFORM_META.google.icon} Search {PLATFORM_META.google.label}
                </a>
              )}
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
            <span>!</span>
            <span>Failed to load opportunities. <button onClick={() => window.location.reload()} style={{ background: 'none', border: 'none', color: '#991B1B', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}>Retry</button></span>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div>
            <div style={{ marginBottom: 12, color: 'var(--muted)', fontSize: '.85rem', fontWeight: 600 }}>
              Finding opportunities...
            </div>
            <OpportunitySkeleton />
            <OpportunitySkeleton />
            <OpportunitySkeleton />
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && displayed.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">Jobs</div>
            <div className="empty-title">
              {searchInput ? 'No opportunities found' : 'No matching opportunities'}
            </div>
            <div className="empty-desc">
              {searchInput ? (
                <button className="btn btn-ghost btn-sm" onClick={() => {
                  setSearchInput('');
                  searchRef.current = '';
                  setSearch('');
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
              {displayed.length >= totalCount ? (
                `${totalCount} opportunit${totalCount !== 1 ? 'ies' : 'y'}`
              ) : (
                `Showing ${displayed.length} of ${totalCount} opportunit${totalCount !== 1 ? 'ies' : 'y'}`
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
                      {meta.label}
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
                        Remote
                      </span>
                    )}
                    {opp.matchScore > 6 && (
                      <span style={{
                        fontSize: '.68rem', fontWeight: 700, color: '#7C3AED',
                        background: '#F3EEFF', padding: '2px 8px', borderRadius: 4,
                      }}>
                        Top match
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
                    <span>{opp.location}</span>
                    {opp.pay && <span>{opp.pay}</span>}
                    <span>{timeAgo(opp.posted)}</span>
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
                          Match: {r}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Footer: source + link */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                    <SourceBadge opp={opp} />
                    <a href={opp.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', textDecoration: 'none' }}>
                      <button className="btn btn-primary btn-sm">View</button>
                    </a>
                  </div>
                </div>
              );
            })}

            {/* Infinite scroll sentinel — same IntersectionObserver pattern
                as the main Feed page. Kept invisible when nothing more to
                load so it never leaves stray blank space at the bottom. */}
            {hasMore && (
              <div ref={sentinelRef} style={{ textAlign: 'center', padding: '24px 0' }}>
                {loadingMore && <span className="spinner spinner-primary" />}
              </div>
            )}

            {/* End message */}
            {!hasMore && displayed.length > 0 && (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '.8rem', padding: '20px 0' }}>
                All {totalCount} opportunit{totalCount !== 1 ? 'ies' : 'y'} shown
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
