import { privateSessionStorage } from '../auth/session';
﻿import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import JobsSidebarControls, { JOB_CAREER_SITES, JOB_SORT_OPTIONS } from '../components/JobsSidebarControls';
import HomeFeedTools from '../components/HomeFeedTools';
import client from '../api/client';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';
import { SaveJobButton } from '../components/SaveButtons';
import { postedDate } from '../utils/jobDates';

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

function timeAgo(iso) {
  return postedDate(iso);
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

function JobTab({ job, index, onSelect }) {
  return (
    <div
      id={`job-tab-${index}`}
      role="listitem"
      className="job-result-tab"
    >
      <button type="button" className="job-result-tab-open" onClick={onSelect} aria-label={`Open ${job.title} at ${job.org}`}>
        <span className="job-result-tab-title">{job.title}</span>
        <span className="job-result-tab-org">{job.org}</span>
        <span className="job-result-tab-meta">
          <span>{job.location || 'Location listed by source'}</span>
          <span>{timeAgo(job.posted)}</span>
        </span>
        <span className="job-result-tab-source">{job.source}</span>
        {(job.description || job.content) && <span className="job-feed-description">{job.description || job.content}</span>}
      </button>
      <SaveJobButton job={job} className="job-result-save-button" showLabel={false} />
    </div>
  );
}

export function JobDetail({ job }) {
  if (!job) return null;
  const about = job.about || `${job.org} is hiring for ${job.title}${job.location ? ` in ${job.location}` : ''}. This is a current listing from ${job.source}.`;
  const description = job.description || job.content
    || `Open the listing on ${job.source} for the full position description and requirements.`;
  return (
    <article
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

      <section className="job-detail-about">
        <h3>About</h3>
        <p>{about}</p>
      </section>

      <section className="job-detail-description">
        <h3>Description</h3>
        <p>{description}</p>
      </section>

      <div className="job-detail-actions">
        <SaveJobButton job={job} className="btn btn-ghost save-item-button" />
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
    : <Layout wide>{children}</Layout>;
}

function mergeOpportunities(current, incoming) {
  const seen = new Set(current.map((opportunity) => opportunity.id));
  return [...current, ...incoming.filter((opportunity) => !seen.has(opportunity.id))];
}

const JOB_SORT_VALUES = new Set(JOB_SORT_OPTIONS.map(({ value }) => value));

function requestedWorkSetting(searchParams) {
  const work = searchParams.get('work');
  if (work === 'remote' || work === 'other') return work;
  return searchParams.get('remote') === '1' ? 'remote' : 'all';
}

function isRemoteJob(job) {
  if (job?.remote) return true;
  return /\bremote\b/i.test([
    job?.location,
    job?.title,
    ...(Array.isArray(job?.tags) ? job.tags : []),
  ].filter(Boolean).join(' '));
}

export default function Opportunities({ embedded = false, searchQuery = null } = {}) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const postedWithin = ['1', '7', '30'].includes(searchParams.get('postedWithin')) ? searchParams.get('postedWithin') : '';
  const initialRouteQuery = embedded
    ? String(searchQuery ?? searchParams.get('q') ?? '').trim().slice(0, 200)
    : '';
  const [allOpps,   setAllOpps]   = useState([]);
  const [liveCount, setLiveCount] = useState(0);
  const filter = 'job';
  const initialSort = JOB_SORT_VALUES.has(searchParams.get('sort')) ? searchParams.get('sort') : 'newest';
  const [sort, setSort] = useState(embedded ? 'newest' : initialSort);
  const [workSetting, setWorkSetting] = useState(embedded ? 'all' : requestedWorkSetting(searchParams));
  const [liveOnly, setLiveOnly] = useState(embedded || searchParams.get('live') === '1');
  // Search can combine career sites; the standalone Jobs stream deliberately
  // keeps one active site at a time, matching Home's source controls.
  const [availableSources, setAvailableSources] = useState([]);
  const [sourceFilter, setSourceFilter] = useState([]);
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
  const nextOffsetRef = useRef(0);
  const requestGenerationRef = useRef(0);
  const sentinelRef = useRef(null);
  const routeSourcesAppliedRef = useRef('');
  // Source and quick-filter changes bypass a stale cached listing cohort;
  // ordinary infinite-scroll requests remain cacheable.
  const bustOnNextFetchRef = useRef(false);

  useEffect(() => {
    const nextQuery = embedded
      ? String(searchQuery ?? searchParams.get('q') ?? '').trim().slice(0, 200)
      : '';
    const timer = window.setTimeout(() => setSearch(nextQuery), 280);
    return () => window.clearTimeout(timer);
  }, [embedded, searchParams, searchQuery]);

  const routeControlKey = searchParams.toString();
  useEffect(() => {
    if (embedded) return;
    const requestedSort = searchParams.get('sort');
    setSort(JOB_SORT_VALUES.has(requestedSort) ? requestedSort : 'newest');
    setWorkSetting(requestedWorkSetting(searchParams));
    setLiveOnly(searchParams.get('live') === '1');
  }, [embedded, routeControlKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Career-site cards link here with a source selection. Apply it once after
  // the API confirms which live job sources are available, then leave normal
  // chip controls entirely in the member's hands.
  const requestedSources = searchParams.get('sources') || '';
  useEffect(() => {
    if (!requestedSources) {
      if (routeSourcesAppliedRef.current) setSourceFilter([]);
      routeSourcesAppliedRef.current = '';
      return;
    }
    if ((embedded && !availableSources.length) || routeSourcesAppliedRef.current === requestedSources) return;
    const requested = requestedSources.split(',').map(value => value.trim()).filter(Boolean);
    const allowedSources = embedded
      ? new Set(availableSources)
      : new Set([...availableSources, ...JOB_CAREER_SITES.map(({ label }) => label)]);
    const matched = requested.filter(source => allowedSources.has(source));
    routeSourcesAppliedRef.current = requestedSources;
    setSourceFilter(matched.length ? (embedded ? matched : matched.slice(0, 1)) : []);
  }, [availableSources, embedded, requestedSources]);

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
    if (postedWithin) params.postedWithin = postedWithin;
    const refreshRequest = refreshRequestRef.current;
    if (refreshRequest) {
      params.bust = '1';
      params.refresh = refreshRequest.key;
      if (refreshRequest.excludeIds.length) params.exclude = refreshRequest.excludeIds.join(',');
      refreshRequestRef.current = null;
    }
    if (filter !== 'all') params.type = filter;
    if (search) params.search = search;
    if (workSetting === 'remote') params.remote = true;
    if (workSetting === 'other') params.remote = false;
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
        nextOffsetRef.current = list.length;
        setTotalCount(data.totalCount || list.length);
        setHasMore(!!data.hasMore);
        setLiveCount(data.liveCount || 0);
        setAvailableSources(data.availableSources || []);
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
  }, [filter, sort, workSetting, liveOnly, search, sourceFilter, refreshTick, postedWithin]);

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
    if (loadingMoreRef.current || loading || refreshing || !hasMore) return;
    const requestGeneration = requestGenerationRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const params = { sort, limit: PAGE_SIZE, offset: nextOffsetRef.current };
    if (postedWithin) params.postedWithin = postedWithin;
    if (filter !== 'all') params.type = filter;
    if (search) params.search = search;
    if (workSetting === 'remote') params.remote = true;
    if (workSetting === 'other') params.remote = false;
    if (liveOnly) params.live = true;
    if (sourceFilter.length) params.sources = sourceFilter.join(',');
    client.get('/opportunities', { params })
      .then(({ data }) => {
        if (requestGeneration !== requestGenerationRef.current) return;
        const list = data.opportunities || [];
        setAllOpps(prev => mergeOpportunities(prev, list));
        nextOffsetRef.current += list.length;
        setTotalCount(data.totalCount || 0);
        setHasMore(!!data.hasMore);
      })
      .catch(err => {
        if (requestGeneration === requestGenerationRef.current) {
          console.error('Failed to load more opportunities:', err);
        }
      })
      .finally(() => {
        if (requestGeneration !== requestGenerationRef.current) return;
        loadingMoreRef.current = false; setLoadingMore(false);
      });
  }, [loading, refreshing, hasMore, allOpps.length, sort, filter, search, workSetting, sourceFilter, liveOnly, postedWithin]);

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
  }, [filter, loadMore]);

  // Scrolling back up to the top acts as pull-to-refresh, same as every
  // other list page on the site.
  useScrollToRefresh(() => {
    requestRefresh();
  }, { enabled: !loading && !refreshing });

  // Keep work-setting views accurate during a rolling frontend/API deploy too.
  // The API performs the full filter; this local guard catches stale responses
  // from an older instance and listings whose source only says "Remote" in text.
  const displayed = workSetting === 'other'
    ? allOpps.filter((job) => !isRemoteJob(job))
    : workSetting === 'remote'
      ? allOpps.filter(isRemoteJob)
      : allOpps;

  return (
    <>
      {!embedded && <Helmet>
        <title>Live Jobs and Career Listings | UFIconnect</title>
        <meta name="description" content="Browse current job listings personalized to your resume, role, and activity across connected career sites." />
        <meta name="keywords" content="live jobs, career listings, remote jobs, personalized jobs, tech jobs, startup jobs, internships" />
        <link rel="canonical" href="https://uficonnect.org/opportunities" />
      </Helmet>}
      <OpportunityFrame embedded={embedded}>
        <div className={embedded ? 'jobs-page-content jobs-page-content--embedded' : 'jobs-page-layout'}>
        <div className={embedded ? undefined : 'jobs-page-content'}>
        {embedded && <div className="page-header opportunities-page-header">
          <h1 className="page-title">
            {embedded ? 'Live Jobs' : 'Jobs'}
            {liveCount > 0 && (
              <span style={{
                marginLeft: 10, fontSize: '.7rem', fontWeight: 700, color: '#059669',
                background: '#DCFCE7', padding: '3px 10px', borderRadius: 20, display: 'inline-block',
              }}>
                {liveCount} live
              </span>
            )}
          </h1>
        </div>}

        {embedded && (
          <>
            <div className="jobs-embedded-filter-row">
              <button type="button" className={`jobs-filter-toggle${workSetting === 'remote' ? ' active' : ''}`} aria-pressed={workSetting === 'remote'} onClick={() => { bustOnNextFetchRef.current = true; setWorkSetting((current) => current === 'remote' ? 'all' : 'remote'); }}>Remote</button>
              <button type="button" className={`jobs-filter-toggle${liveOnly ? ' active' : ''}`} aria-pressed={liveOnly} onClick={() => { bustOnNextFetchRef.current = true; setLiveOnly(!liveOnly); }}>Live only</button>
            </div>
            {availableSources.length > 1 && (
              <div className="jobs-search-source-filter" role="group" aria-label="Career sites">
                {availableSources.map((source) => {
                  const active = sourceFilter.includes(source);
                  return (
                    <button
                      type="button"
                      key={source}
                      className={`jobs-filter-toggle${active ? ' active' : ''}`}
                      aria-pressed={active}
                      onClick={() => setSourceFilter((current) => current.includes(source)
                        ? current.filter((item) => item !== source)
                        : [...current, source])}
                    >
                      {source}
                    </button>
                  );
                })}
              </div>
            )}
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
                {JOB_SORT_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </>
        )}

        {/* Status messages */}
        {error && (
          <div style={{
            padding: '12px 16px', borderRadius: 12, marginBottom: 16,
            background: '#FEE2E2', color: '#991B1B', fontSize: '.85rem',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>!</span>
            <span>Failed to load jobs. <button onClick={() => window.location.reload()} style={{ background: 'none', border: 'none', color: '#991B1B', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}>Retry</button></span>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div>
            <div style={{ marginBottom: 12, color: 'var(--muted)', fontSize: '.85rem', fontWeight: 600 }}>
              Finding jobs...
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
              {search ? 'No jobs found' : 'No matching jobs'}
            </div>
            <div className="empty-desc">
              {embedded
                ? 'Adjust the job filters, or try a broader search.'
                : 'Choose another job view or career site from the Jobs sidebar.'}
            </div>
          </div>
        )}

        {/* Opportunities list */}
        {!loading && !error && displayed.length > 0 && (
          <div>
            {embedded && <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginBottom: 16, fontWeight: 500 }}>
              {displayed.length >= totalCount ? (
                filter === 'job'
                  ? `${totalCount} live job${totalCount !== 1 ? 's' : ''}`
                  : `${totalCount} opportunit${totalCount !== 1 ? 'ies' : 'y'}`
              ) : (
                filter === 'job'
                  ? `Showing ${displayed.length} of ${totalCount} live jobs`
                  : `Showing ${displayed.length} of ${totalCount} opportunit${totalCount !== 1 ? 'ies' : 'y'}`
              )}
            </div>}

            {filter === 'job' ? (
              <div className="job-browser job-browser--list">
                <div className="job-result-column">
                  <div className="job-result-tabs" role="list" aria-label="Live jobs">
                        {displayed.map((job, index) => (
                          <JobTab
                            key={job.id}
                            job={job}
                            index={index}
                            onSelect={() => {
                              try { privateSessionStorage.setItem(`ufi_job_detail:${job.id}`, JSON.stringify(job)); } catch {}
                              navigate(`/opportunities/${encodeURIComponent(job.id)}`, { state: { job } });
                            }}
                          />
                        ))}
                    {hasMore && (
                      <div ref={sentinelRef} className="job-list-sentinel" aria-hidden="true">
                        {loadingMore && <span className="spinner spinner-primary" />}
                      </div>
                    )}
                  </div>
                </div>
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
            {embedded && !hasMore && displayed.length > 0 && (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '.8rem', padding: '20px 0' }}>
                {filter === 'job'
                  ? `All ${totalCount} live job${totalCount !== 1 ? 's' : ''} shown`
                  : `All ${totalCount} opportunit${totalCount !== 1 ? 'ies' : 'y'} shown`}
              </div>
            )}
          </div>
        )}

        </div>
        {!embedded && (
          <aside className="jobs-page-right-tabs" aria-label="Job tools">
            <JobsSidebarControls />
            <div className="jobs-page-role-links">
              <Link to="/settings?tab=preferences" className="jobs-page-tool jobs-page-tool--compact" title={profile?.preferences?.role || 'Choose your target role'}>
                <strong>Roles</strong>
              </Link>
            </div>
            <div className="jobs-page-rail-bottom">
              <Link to="/groups" className="jobs-page-tool jobs-page-tool--compact">
                <strong>Discover groups</strong>
              </Link>
              <Link to="/messages" className="jobs-page-tool jobs-page-tool--compact">
                <strong>Messages</strong>
              </Link>
              <HomeFeedTools showSources={false} />
              <Link to="/resume-builder" className="jobs-page-tool jobs-page-tool--primary jobs-page-resume-builder">
                <strong>Resume Builder</strong>
                <span>Build, preview, and export</span>
              </Link>
            </div>
          </aside>
        )}
        </div>

        <style>{`
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        `}</style>
      </OpportunityFrame>
    </>
  );
}
