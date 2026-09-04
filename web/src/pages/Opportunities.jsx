import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
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

const FILTERS = [
  { value: 'all', label: 'All' },
  ...Object.entries(TYPE_META).map(([value, { label }]) => ({ value, label })),
];

const OPPORTUNITY_SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'match', label: 'Best match' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'live', label: 'Live first' },
  { value: 'remote', label: 'Remote first' },
  { value: 'employer', label: 'Employer A-Z' },
  { value: 'title', label: 'Title A-Z' },
  { value: 'source', label: 'Source A-Z' },
];

function debounce(fn, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

function timeAgo(iso) {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return 'recently';
  const d = (Date.now() - timestamp) / 86400000;
  if (d < 1) return 'today';
  if (d < 2) return 'yesterday';
  return `${Math.floor(d)}d ago`;
}

function postedDate(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return 'Recently listed';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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

function JobTab({ job, selected, index, onSelect, onKeyDown }) {
  return (
    <button
      id={`job-tab-${index}`}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls="selected-job-panel"
      tabIndex={selected ? 0 : -1}
      className={`job-result-tab${selected ? ' active' : ''}`}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      <span className="job-result-tab-title">{job.title}</span>
      <span className="job-result-tab-org">{job.org}</span>
      <span className="job-result-tab-meta">
        <span>{job.location || 'Location listed by source'}</span>
        <span>{timeAgo(job.posted)}</span>
      </span>
      <span className="job-result-tab-source">{job.source}</span>
    </button>
  );
}

function JobDetail({ job, tabIndex }) {
  if (!job) return null;
  return (
    <article
      id="selected-job-panel"
      role="tabpanel"
      aria-labelledby={`job-tab-${tabIndex}`}
      className="card job-detail-panel"
    >
      <div className="job-detail-heading">
        {job.logo && (
          <img
            src={job.logo}
            alt=""
            className="job-detail-logo"
            onError={(event) => { event.currentTarget.style.display = 'none'; }}
          />
        )}
        <div>
          <h2>{job.title}</h2>
          <p>{job.org}</p>
        </div>
      </div>

      <div className="job-detail-badges">
        <SourceBadge opp={job} />
        {job.isLive && <span className="job-detail-status job-detail-status--live">Live listing</span>}
        {job.remote && <span className="job-detail-status">Remote</span>}
        {job.matchScore > 6 && <span className="job-detail-status job-detail-status--match">Top match</span>}
      </div>

      <dl className="job-detail-facts">
        <div><dt>Location</dt><dd>{job.location || 'See source'}</dd></div>
        <div><dt>Posted</dt><dd>{postedDate(job.posted)}</dd></div>
        <div><dt>Work setting</dt><dd>{job.remote ? 'Remote' : 'See source'}</dd></div>
        <div><dt>Compensation</dt><dd>{job.pay || 'See source'}</dd></div>
      </dl>

      {job.matchReasons?.length > 0 && (
        <div className="job-detail-match-list" aria-label="Why this job matches">
          {job.matchReasons.slice(0, 4).map((reason) => <span key={reason}>{reason}</span>)}
        </div>
      )}

      {(job.tags || []).length > 0 && (
        <div className="job-detail-tags" aria-label="Position tags">
          {job.tags.slice(0, 10).map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      )}

      <section className="job-detail-description">
        <h3>Position information</h3>
        <p>{job.content || `Open the listing on ${job.source} for the full position description and requirements.`}</p>
      </section>

      <div className="job-detail-actions">
        <a className="btn btn-primary" href={job.sourceUrl} target="_blank" rel="noopener noreferrer">
          View full position on {job.source}
        </a>
      </div>
    </article>
  );
}

function OpportunityFrame({ embedded, children }) {
  return embedded
    ? <section className="search-jobs-panel">{children}</section>
    : <Layout>{children}</Layout>;
}

function mergeOpportunities(current, incoming) {
  const seen = new Set(current.map((opportunity) => opportunity.id));
  return [...current, ...incoming.filter((opportunity) => !seen.has(opportunity.id))];
}

export default function Opportunities({ embedded = false } = {}) {
  const [searchParams] = useSearchParams();
  const initialRouteQuery = String(searchParams.get('q') || '').trim().slice(0, 200);
  const [allOpps,   setAllOpps]   = useState([]);
  const [liveCount, setLiveCount] = useState(0);
  const [filter,    setFilter]    = useState('job');
  const [sort,      setSort]      = useState('newest');
  const [remote,    setRemote]    = useState(false);
  const [liveOnly,  setLiveOnly]  = useState(embedded);
  // Multi-select, same idea as Feed's source chips — which platforms are
  // actually pickable changes with `filter` (Job's sources are Remotive/The
  // Muse/Remote OK/USAJobs; other types pull from a much longer curated
  // list), so this comes from the API's own availableSources rather than a
  // fixed list here, and resets whenever the type filter changes underneath
  // it (a source picked for Jobs has no meaning once you're looking at
  // Grants).
  const [availableSources, setAvailableSources] = useState([]);
  const [sourceFilter, setSourceFilter] = useState([]);
  const [recommendationBasis, setRecommendationBasis] = useState('recent listings');
  const [recommendationLabel, setRecommendationLabel] = useState('');
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [searchInput, setSearchInput] = useState(initialRouteQuery);
  const [search,    setSearch]    = useState(initialRouteQuery);
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
  const requestGenerationRef = useRef(0);
  const sentinelRef = useRef(null);
  const jobTabListRef = useRef(null);
  const routeSourcesAppliedRef = useRef('');
  const routeQueryAppliedRef = useRef(initialRouteQuery);
  // Set right before a type-filter click (Job/Gig/Grant/etc, including
  // "All") — the fetch effect below reads and clears it. Live sources
  // (Remotive/Muse/RemoteOK/USAJobs/Indeed) are each cached server-side on
  // their own TTL, same as every other source in this app; a type click
  // was previously a passive re-filter of whatever happened to already be
  // cached, same as clicking into a tab that just silently shows stale
  // data. Bust makes clicking "Job" (or any type) double as a real
  // refresh for that type, matching how tab-clicks already work in Feed.
  const bustOnNextFetchRef = useRef(false);

  const searchRef = useRef(initialRouteQuery);

  // Debounced search
  const debouncedSearch = useMemo(
    () => debounce((query) => {
      searchRef.current = query.trim();
      setSearch(query.trim());
    }, 400),
    []
  );

  useEffect(() => {
    const routeQuery = String(searchParams.get('q') || '').trim().slice(0, 200);
    if (routeQuery === routeQueryAppliedRef.current) return;
    routeQueryAppliedRef.current = routeQuery;
    searchRef.current = routeQuery;
    setSearchInput(routeQuery);
    setSearch(routeQuery);
  }, [searchParams]);

  // Type filter changing invalidates whatever sources were picked (a
  // source chip is scoped to what's poll-able within the current type — see
  // availableSources below), so a stale source picked under Jobs shouldn't
  // silently keep filtering once you switch to Grants.
  useEffect(() => { setSourceFilter([]); }, [filter]);

  // Career-site cards link here with a source selection. Apply it once after
  // the API confirms which live job sources are available, then leave normal
  // chip controls entirely in the member's hands.
  const requestedSources = searchParams.get('sources') || '';
  useEffect(() => {
    if (!requestedSources || !availableSources.length || routeSourcesAppliedRef.current === requestedSources) return;
    const requested = requestedSources.split(',').map(value => value.trim()).filter(Boolean);
    const matched = requested.filter(source => availableSources.includes(source));
    routeSourcesAppliedRef.current = requestedSources;
    if (matched.length) setSourceFilter(matched);
  }, [availableSources, requestedSources]);

  // Fetch the first page whenever a real filter/search/sort change happens
  // — /opportunities now supports real server-side offset/limit (added
  // alongside this) instead of this page fetching everything in one shot
  // and slicing it client-side, so scrolling to the bottom can actually ask
  // the server for more instead of just revealing more of what's already
  // in memory.
  useEffect(() => {
    const requestGeneration = ++requestGenerationRef.current;
    loadingMoreRef.current = false;
    setLoadingMore(false);
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
    if (liveOnly) params.live = true;
    if (sourceFilter.length) params.sources = sourceFilter.join(',');
    if (bustOnNextFetchRef.current) { params.bust = '1'; bustOnNextFetchRef.current = false; }

    // Only show the full loading state on a real filter/search change —
    // refreshTick-driven refetches (scroll-to-refresh) should refill quietly
    // instead of flashing the loading UI over content the user is mid-read of.
    if (!silentRefreshRef.current) setLoading(true);
    silentRefreshRef.current = false;
    if (!refreshRequest) setRefreshing(false);
    setError(false);
    client.get('/opportunities', { params })
      .then(({ data }) => {
        if (requestGeneration !== requestGenerationRef.current) return;
        const list = data.opportunities || [];
        setAllOpps(list);
        setTotalCount(data.totalCount || list.length);
        setHasMore(!!data.hasMore);
        setLiveCount(data.liveCount || 0);
        setAvailableSources(data.availableSources || []);
        setRecommendationBasis(data.recommendationBasis || 'recent listings');
        setRecommendationLabel(data.recommendationLabel || '');
      })
      .catch(err => {
        if (requestGeneration !== requestGenerationRef.current) return;
        console.error('Failed to load opportunities:', err);
        setError(true);
        if (!refreshRequest) {
          setAllOpps([]);
          setHasMore(false);
        }
      })
      .finally(() => {
        if (requestGeneration !== requestGenerationRef.current) return;
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
    const requestGeneration = requestGenerationRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const params = { sort, limit: PAGE_SIZE, offset: allOpps.length };
    if (filter !== 'all') params.type = filter;
    if (search) params.search = search;
    if (remote) params.remote = true;
    if (liveOnly) params.live = true;
    if (sourceFilter.length) params.sources = sourceFilter.join(',');
    client.get('/opportunities', { params })
      .then(({ data }) => {
        if (requestGeneration !== requestGenerationRef.current) return;
        const list = data.opportunities || [];
        setAllOpps(prev => mergeOpportunities(prev, list));
        setTotalCount(data.totalCount || 0);
        setHasMore(!!data.hasMore);
      })
      .catch(err => {
        if (requestGeneration === requestGenerationRef.current) {
          console.error('Failed to load more opportunities:', err);
        }
      })
      .finally(() => { loadingMoreRef.current = false; setLoadingMore(false); });
  }, [loading, hasMore, allOpps.length, sort, filter, search, remote, sourceFilter, liveOnly]);

  // Same sentinel + IntersectionObserver pattern as the main Feed page
  // (400px rootMargin fires the fetch just before the sentinel is actually
  // on screen, so more content is ready by the time someone scrolls to it).
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const scrollRoot = filter === 'job' ? jobTabListRef.current : null;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore(); },
      { root: scrollRoot, rootMargin: scrollRoot ? '300px' : '400px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [filter, loadMore]);

  // Scrolling back up to the top acts as pull-to-refresh, same as every
  // other list page on the site.
  useScrollToRefresh(() => {
    requestRefresh();
  }, { enabled: !loading && !refreshing });

  const displayed = allOpps;
  const selectedJobIndex = Math.max(0, displayed.findIndex((job) => job.id === selectedJobId));
  const selectedJob = filter === 'job' ? displayed[selectedJobIndex] || null : null;
  const personalizationText = recommendationBasis === 'resume'
    ? `Matched to ${recommendationLabel || 'your selected resume'}`
    : recommendationBasis === 'role'
      ? `Matched to ${recommendationLabel || 'your selected role'}`
      : recommendationBasis === 'profile'
        ? 'Matched to your profile'
        : recommendationBasis === 'usage'
          ? 'Matched to your activity'
          : 'Newest live listings';

  useEffect(() => {
    if (filter !== 'job') return;
    setSelectedJobId((current) => (
      displayed.some((job) => job.id === current) ? current : (displayed[0]?.id || null)
    ));
  }, [displayed, filter]);

  function handleJobTabKeyDown(event, index) {
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? displayed.length - 1
        : event.key === 'ArrowDown' || event.key === 'ArrowRight'
          ? Math.min(displayed.length - 1, index + 1)
          : Math.max(0, index - 1);
    const nextJob = displayed[nextIndex];
    if (!nextJob) return;
    setSelectedJobId(nextJob.id);
    document.getElementById(`job-tab-${nextIndex}`)?.focus();
  }

  return (
    <>
      {!embedded && <Helmet>
        <title>Jobs, Gigs, Grants, Events & Career Opportunities | UFIconnect</title>
        <meta name="description" content="Browse all career opportunities: full-time jobs, gigs, grants, hackathons, events, open-source opportunities, and learning resources. Discover positions and opportunities for engineers, designers, founders, marketers, product managers, and creatives worldwide." />
        <meta name="keywords" content="job opportunities, career opportunities, gigs, grants, hackathons, events, open source opportunities, learning opportunities, tech jobs, startup jobs, freelance work, internships, positions, career growth, job listings, employment opportunities, career development, work opportunities" />
        <link rel="canonical" href="https://uficonnect.org/opportunities" />
      </Helmet>}
      <OpportunityFrame embedded={embedded}>
        <div className="page-header opportunities-page-header">
          <h1 className="page-title">
            {embedded ? 'Live Jobs' : 'All Opportunities'}
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
        {embedded && (
          <div className="jobs-personalization-status">
            <span>{personalizationText}</span>
            <span>Newest first</span>
          </div>
        )}

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
          {!embedded && FILTERS.map(({ value, label }) => (
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
          {!embedded && <button
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
          </button>}
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
            {OPPORTUNITY_SORT_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
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
                filter === 'job'
                  ? `${totalCount} live job${totalCount !== 1 ? 's' : ''}`
                  : `${totalCount} opportunit${totalCount !== 1 ? 'ies' : 'y'}`
              ) : (
                filter === 'job'
                  ? `Showing ${displayed.length} of ${totalCount} live jobs`
                  : `Showing ${displayed.length} of ${totalCount} opportunit${totalCount !== 1 ? 'ies' : 'y'}`
              )}
            </div>

            {filter === 'job' ? (
              <div className="job-browser">
                <div className="job-result-column">
                  <div className="job-result-column-heading">
                    <strong>Live job list</strong>
                    <span>{totalCount.toLocaleString()}</span>
                  </div>
                  <div ref={jobTabListRef} className="job-result-tabs" role="tablist" aria-label="Live jobs">
                    {displayed.map((job, index) => (
                      <JobTab
                        key={job.id}
                        job={job}
                        index={index}
                        selected={job.id === selectedJob?.id}
                        onSelect={() => setSelectedJobId(job.id)}
                        onKeyDown={(event) => handleJobTabKeyDown(event, index)}
                      />
                    ))}
                    {hasMore && (
                      <div ref={sentinelRef} className="job-list-sentinel" aria-hidden="true">
                        {loadingMore && <span className="spinner spinner-primary" />}
                      </div>
                    )}
                  </div>
                </div>
                <JobDetail job={selectedJob} tabIndex={selectedJobIndex} />
              </div>
            ) : displayed.map((opp) => {
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
            {filter !== 'job' && hasMore && (
              <div ref={sentinelRef} style={{ textAlign: 'center', padding: '24px 0' }}>
                {loadingMore && <span className="spinner spinner-primary" />}
              </div>
            )}

            {/* End message */}
            {!hasMore && displayed.length > 0 && (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '.8rem', padding: '20px 0' }}>
                {filter === 'job'
                  ? `All ${totalCount} live job${totalCount !== 1 ? 's' : ''} shown`
                  : `All ${totalCount} opportunit${totalCount !== 1 ? 'ies' : 'y'} shown`}
              </div>
            )}
          </div>
        )}

        <style>{`
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        `}</style>
      </OpportunityFrame>
    </>
  );
}
