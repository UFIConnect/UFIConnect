import { cloneElement, useMemo, useRef, useState } from 'react';
import { count, filterAnalytics, filterDiagnostics, reportDays, filterAnalyticsOverview, OVERVIEW_METRICS } from './analytics-model.mjs';
import AnalyticsGeography from './AnalyticsGeography.jsx';
import TrafficAnalytics from './TrafficAnalytics.jsx';
import AnalyticsComparison from './AnalyticsComparison.jsx';
import RequestsAnalytics from './RequestsAnalytics.jsx';
import useAnalyticsReport from './useAnalyticsReport.js';
import './AnalyticsDashboard.css';

const number = value => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(count(value));
const errorNames = { script_error: 'Script errors', unhandled_rejection: 'Unhandled promises', render_error: 'Rendering errors', request_failed: 'Failed requests' };
const types = { page: 'Page', screen: 'App screen', tab: 'Tab' };

const analyticsTabs = [['overview', 'Overview'], ['pages', 'Pages & tabs'], ['geography', 'Geography'], ['diagnostics', 'Diagnostics'], ['traffic', 'Traffic history'], ['comparison', 'Compare'], ['requests', 'API requests'], ['users', 'Users']];

function AnalyticsPanel({ name, activeTab, children }) {
  return <div className="office-analytics-panel" role="tabpanel" id={`office-analytics-panel-${name}`} aria-labelledby={`office-analytics-tab-${name}`} hidden={activeTab !== name} tabIndex={0}>{children}</div>;
}

function DailyTrend({ daily, metric }) {
  const peak = Math.max(1, ...daily.map(row => row.value || 0));
  return <section className="office-analytics-card" aria-labelledby="analytics-daily-heading">
    <div className="office-analytics-section-heading"><div><h2 id="analytics-daily-heading">Daily activity</h2><p>{metric.label} on the selected UTC dates. Shaded dates have no retained measurement.</p></div><span>Peak: {daily.some(row => row.available) ? number(Math.max(...daily.map(row => row.value || 0))) : 'Unavailable'}</span></div>
    <div className="office-analytics-legend"><span><i className={metric.source === 'activity' ? 'tabs' : ''} />{metric.label}</span></div>
    <div className="office-analytics-chart" role="img" aria-label={`${metric.label} for ${daily.length} UTC days. Exact counts are in the daily data table.`}>
      {daily.map(row => <div key={row.day} className={`office-analytics-bar${row.available ? '' : ' unavailable'}`} title={row.available ? `${row.day}: ${number(row.value)} ${metric.label.toLowerCase()}` : `${row.day}: Historical analytics unavailable`}>
        {row.available && <span className={metric.source === 'activity' ? 'tabs' : ''} style={{ height: `${row.value / peak * 100}%` }} />}
      </div>)}
    </div>
    <div className="office-analytics-axis"><span>{daily[0]?.day}</span><span>{daily.at(-1)?.day}</span></div>
    <details><summary>View daily data</summary><div className="office-analytics-table-wrap" tabIndex={0} role="region" aria-label="Daily activity table">
      <table><thead><tr><th scope="col">Date (UTC)</th><th scope="col">{metric.label}</th></tr></thead>
        <tbody>{daily.map(row => <tr key={row.day}><th scope="row">{row.day}</th><td>{row.available ? number(row.value) : 'Unavailable'}</td></tr>)}</tbody></table>
    </div></details>
  </section>;
}

function UnifiedHistoryOverview({ report, start, end }) {
  const [trend, setTrend] = useState('htmlViews');
  const selected = useMemo(() => filterAnalyticsOverview(report, { start, end }), [report, start, end]);
  const metric = OVERVIEW_METRICS.find(item => item.key === trend);
  const daily = selected.daily.map(row => ({ day: row.day, value: row[trend], available: row[trend] !== null }));
  const cards = source => OVERVIEW_METRICS.filter(item => item.source === source).map(item => {
    const value = selected.metrics[item.key];
    return <div key={item.key}><dt>{item.label}</dt><dd>{value.total === null ? 'Unavailable' : number(value.total)}</dd><small>{value.observedDays} of {value.selectedDays} UTC dates recorded</small></div>;
  });
  return <>
    <section aria-label="Website traffic totals" className="analytics-unified-source"><h2>Website traffic</h2><p>Cloudflare records for the whole uficonnect.org zone, including proxied subdomains and automated traffic. HTML views count page requests.</p>
      {report.traffic?.available !== true && <p className="office-analytics-source-warning" role="status">{report.traffic?.error || 'Traffic history is temporarily unavailable.'} Tracked activity remains separate below.</p>}
      <dl className="office-analytics-metrics analytics-traffic-headlines">{cards('traffic')}</dl>
    </section>
    <section aria-label="Tracked activity totals" className="analytics-unified-source"><h2>Recorded app activity</h2><p>Website navigations, app screens and tab selections recorded by the app. These events have different coverage and are not added to traffic totals.</p>
      {report.activityAvailable === false && <p className="office-analytics-source-warning" role="status">{report.activityError}</p>}
      <dl className="office-analytics-metrics analytics-tracked-headlines">{cards('activity')}</dl>
    </section>
    <div className="office-analytics-section-heading analytics-trend-picker"><label>Daily trend<select aria-label="Daily trend" value={trend} onChange={event => setTrend(event.target.value)}>{OVERVIEW_METRICS.map(item => <option value={item.key} key={item.key}>{item.label}</option>)}</select></label><p>Totals and the trend use {start} through {end}. Changing the trend does not combine sources.</p></div>
    <DailyTrend daily={daily} metric={metric} />
    <section className="office-analytics-card"><h2>History and coverage</h2><p>{report.traffic?.coverage?.firstRecordedDay ? `Available traffic history begins ${report.traffic.coverage.firstRecordedDay}. ` : 'No traffic start date is available. '}{report.history?.firstRecordedDay ? `Tracked activity begins ${report.history.firstRecordedDay}. ` : 'No retained app activity start date is available. '}Earlier and missing dates are unavailable. A recorded zero is shown only when that source has an observation for the metric.</p>
      {count(report.history?.restoredViews) > 0 && <p>{number(report.history.restoredViews)} earlier tracked page views were recovered.</p>}
      <p>Page categories, platforms and cities in the other sections describe tracked events only. Unclassified traffic is not assigned to those categories or locations. Neither source establishes unique people, and their totals are never added together.</p>
      <p className="office-analytics-meta">The first and current collection days may be partial. Source records can be incomplete when collection was unavailable, blocked, offline or rate limited.</p>
    </section>
  </>;
}

export default function AnalyticsDashboard({ apiBase, request, usersPanel }) {
  const [activeTab, setActiveTab] = useState('overview');
  const independentTab = ['traffic', 'comparison', 'requests', 'users'].includes(activeTab);
  const { report, busy, error, updatedAt, revision, refresh, stale } = useAnalyticsReport({ apiBase, request, active: !independentTab });
  const [preset, setPreset] = useState('history'), [customStart, setCustomStart] = useState(''), [customEnd, setCustomEnd] = useState('');
  const [platform, setPlatform] = useState('all'), [category, setCategory] = useState('all'), [viewType, setViewType] = useState('all');
  const [search, setSearch] = useState('');
  const [visitedTabs, setVisitedTabs] = useState({ overview: true });
  const tabButtons = useRef({}), tabsAnchor = useRef(null);
  const tabs = usersPanel ? analyticsTabs : analyticsTabs.filter(([name]) => name !== 'users');
  function selectTab(name) {
    setActiveTab(name);
    setVisitedTabs(previous => previous[name] ? previous : { ...previous, [name]: true });
    if (window.matchMedia('(min-width: 761px)').matches && tabsAnchor.current?.getBoundingClientRect().top < 0) tabsAnchor.current.scrollIntoView({ block: 'start' });
    tabButtons.current[name]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function navigateTabs(event, index) {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const name = tabs[next][0];
    selectTab(name); tabButtons.current[name]?.focus({ preventScroll: true });
  }


  const days = reportDays(report);
  const end = preset === 'custom' ? customEnd : days.at(-1);
  const start = preset === 'custom' ? customStart : preset === 'history' ? days[0] : days[Math.max(0, days.length - Number(preset))];
  const invalidDates = !start || !end || start > end || start < days[0] || end > days.at(-1);
  const filtered = useMemo(() => filterAnalytics(report, { platform, category, viewType, start, end }), [report, platform, category, viewType, start, end]);
  const diagnostics = useMemo(() => filterDiagnostics(report, { platform, category, viewType, start, end }), [report, platform, category, viewType, start, end]);
  const rows = filtered.rows.filter(row => `${row.label} ${row.group}`.toLowerCase().includes(search.trim().toLowerCase()));
  const options = (report?.categories || []).filter(row => (platform === 'all' || row.platform === platform) && (viewType === 'all' || row.viewType === viewType));
  function customDate(which, value) { setCustomStart(start); setCustomEnd(end); setPreset('custom'); (which === 'start' ? setCustomStart : setCustomEnd)(value); }
  const service = report?.service;
  const responses = (service?.responses || []).reduce((result, row) => ({ ...result, [row.statusClass]: (result[row.statusClass] || 0) + count(row.count) }), {});
  const verification = report?.verification;
  const verificationNeedsAttention = verification && ['mismatch', 'error', 'stale'].includes(verification.status);
  const trafficStale = activeTab === 'overview' && report?.traffic?.status === 'stale';
  const freshnessWarning = Boolean(error || stale || verificationNeedsAttention || trafficStale);
  const freshnessLabel = error ? 'Refresh failed' : stale ? 'Counts need a fresh check' : busy ? 'Checking latest counts'
    : trafficStale ? 'Provider traffic needs a fresh check' : activeTab === 'overview' ? 'Analytics sources loaded'
    : verification?.status === 'verified' ? 'Database counts verified'
      : verification?.status === 'mismatch' ? 'Count verification needs attention'
        : verification?.status === 'error' ? 'Database verification unavailable'
          : verification?.status === 'stale' ? 'Database verification is overdue'
            : verification?.status === 'pending' ? 'Database verification pending' : 'Counts loaded; database verification unavailable';

  return <section className="office-analytics">
    <header className="office-analytics-header"><div><h1>Analytics</h1><p>Recorded traffic, app activity, registrations and server requests. Each source reports its own coverage.</p></div><button hidden={independentTab} type="button" onClick={refresh} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh analytics'}</button></header>
    <section hidden={independentTab} className={`office-analytics-freshness${freshnessWarning ? ' warning' : ''}`} aria-label="Analytics freshness">
      <strong role="status" aria-live="polite">{freshnessLabel}</strong>
      <p>{updatedAt ? <>Last successful read <time dateTime={updatedAt.toISOString()}>{updatedAt.toLocaleString()}</time>. </> : 'Waiting for the first successful read. '}Checks for updated counts every 30 seconds while this page is visible, and when you return or reconnect.</p>
      {activeTab === 'overview' && report && <p>Cloudflare traffic: {report.traffic?.available ? report.traffic.status || 'loaded' : 'unavailable'}. {report.traffic?.lastSuccessAt || report.traffic?.generatedAt ? `Provider checked ${new Date(report.traffic.lastSuccessAt || report.traffic.generatedAt).toLocaleString()}.` : 'No successful provider check is available.'}</p>}
      {verification && <p>Tracked activity only: {verification.checkedAt ? <>database check <time dateTime={verification.checkedAt}>{new Date(verification.checkedAt).toLocaleString()}</time>. </> : 'Database check has not completed. '}{verification.status === 'verified' ? 'Database counts verified. Tracked totals match the stored records.' : verification.status === 'mismatch' ? 'Count verification needs attention. The tracked records and reported totals differ.' : verification.error || 'A successful tracked activity count check is still needed.'}{verification.lastVerifiedAt && verification.status !== 'verified' ? ` Last verified ${new Date(verification.lastVerifiedAt).toLocaleString()}.` : ''}</p>}
      {report?.activityAvailable === false && <p>Tracked activity unavailable. Provider traffic remains usable when available.</p>}
      {(error || stale) && report && <p>The last successful counts remain visible until a fresh read succeeds.</p>}
    </section>
    <p className="office-analytics-meta">UTC history from May 2026. Optional Google Analytics is reported separately.</p>
    <div ref={tabsAnchor} />
    <div className="office-analytics-tabs" role="tablist" aria-label="Analytics sections">
      {tabs.map(([name, label], index) => <button key={name} ref={element => { tabButtons.current[name] = element; }} type="button" role="tab" id={`office-analytics-tab-${name}`} aria-controls={`office-analytics-panel-${name}`} aria-selected={activeTab === name} tabIndex={activeTab === name ? 0 : -1} onClick={() => selectTab(name)} onKeyDown={event => navigateTabs(event, index)}>{label}</button>)}
    </div>
    {error && !independentTab && <div className="office-analytics-error" role="alert"><p>{error}{report ? ' The last successful report remains below.' : ''}</p><button type="button" onClick={refresh} disabled={busy}>Retry analytics</button></div>}
    {busy && !independentTab && <p role="status">Loading analytics…</p>}
    {report && <>
      {report.activityAvailable === false && !independentTab && activeTab !== 'overview' && <p role="status" className="office-analytics-source-warning">Tracked page and category totals are temporarily unavailable. Traffic history remains available in Overview. Geographic counts are checked independently.</p>}
      <div className="office-analytics-filters" hidden={independentTab}>
        <label>Period<select aria-label="Period" value={preset} onChange={event => { if (event.target.value === 'custom') { setCustomStart(start); setCustomEnd(end); } setPreset(event.target.value); }}><option value="history">Since May 2026</option><option value="1">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="custom">Custom dates</option></select></label>
        <label>From (UTC)<input type="date" min={days[0]} max={end || days.at(-1)} value={start} onChange={event => customDate('start', event.target.value)} /></label>
        <label>To (UTC)<input type="date" min={start || days[0]} max={days.at(-1)} value={end} onChange={event => customDate('end', event.target.value)} /></label>
        <label hidden={activeTab === 'overview'}>Platform<select aria-label="Platform" value={platform} onChange={event => { setPlatform(event.target.value); setCategory('all'); }}><option value="all">Web and mobile</option><option value="web">Website</option><option value="mobile">Mobile app</option></select></label>
        <label hidden={activeTab === 'overview'}>View type<select aria-label="View type" value={viewType} onChange={event => { setViewType(event.target.value); setCategory('all'); }}><option value="all">All types</option><option value="page">Website pages</option><option value="screen">App screens</option><option value="tab">Internal tabs</option></select></label>
        <label hidden={activeTab === 'overview'}>Category<select aria-label="Category" value={category} onChange={event => setCategory(event.target.value)}><option value="all">All categories</option>{options.map(row => <option key={row.category} value={row.category}>{row.label}</option>)}</select></label>
      </div>
      {invalidDates ? <p role="alert" className="office-analytics-error" hidden={independentTab}>Choose dates between {days[0]} and {days.at(-1)}, with the start before the end.</p> : <>
        <dl className="office-analytics-metrics" hidden={independentTab || activeTab === 'overview'}>{[['Page / screen views', filtered.views], ['Tab opens', filtered.tabs], ['Optional diagnostics', filtered.errors], ['Categories with activity', filtered.activeCategories]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{filtered.availableDays ? number(value) : 'Unavailable'}</dd></div>)}</dl>
        <p className="office-analytics-meta" hidden={independentTab || activeTab === 'overview'}>Tracked events only. Cloudflare traffic totals have no app category assignment and are shown in Overview.</p>
        {report.history && <p className="office-analytics-meta" hidden={independentTab || activeTab === 'overview'}>{report.history.firstRecordedDay ? `Available analytics begins ${report.history.firstRecordedDay}. ` : 'Historical analytics is unavailable until an event is recorded. '}{count(report.history.restoredViews) > 0 ? `${number(report.history.restoredViews)} earlier page views were recovered. ` : ''}Selected totals include retained tracked events only.</p>}
        <AnalyticsPanel name="overview" activeTab={activeTab}>
        <UnifiedHistoryOverview report={report} start={start} end={end} />
        </AnalyticsPanel>
        <AnalyticsPanel name="geography" activeTab={activeTab}>
        {visitedTabs.geography && <AnalyticsGeography apiBase={apiBase} request={request} active={activeTab === 'geography'} filters={{ platform, category, viewType, start, end }} refreshRevision={revision} />}
        </AnalyticsPanel>
        <AnalyticsPanel name="pages" activeTab={activeTab}>
        <section className="office-analytics-card" aria-labelledby="analytics-category-heading">
          <div className="office-analytics-section-heading"><div><h2 id="analytics-category-heading">Every page, screen and tab</h2><p>Zero means no recorded activity in the selected period. Historical coverage varies by category.</p></div><label>Find a category<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search categories" /></label></div>
          <p className="office-analytics-meta">{rows.length} categories shown · {start} through {end}</p>
          <div className="office-analytics-table-wrap" tabIndex={0} role="region" aria-label="Category activity table"><table><thead><tr><th scope="col">Category</th><th scope="col">Platform / type</th><th scope="col">Selected period</th><th scope="col">Today</th><th scope="col">7 days</th><th scope="col">30 days</th><th scope="col">Diagnostics</th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.category}><th scope="row"><span>{row.label}</span><small>{row.group}</small></th><td>{row.platform === 'mobile' ? 'Mobile' : 'Web'} · {types[row.viewType] || row.viewType}</td><td>{filtered.availableDays ? number(row.selectedViews) : 'Unavailable'}</td><td>{number(row.today)}</td><td>{number(row.last7)}</td><td>{number(row.last30)}</td><td>{filtered.availableDays ? number(row.selectedErrors) : 'Unavailable'}</td></tr>)}</tbody></table></div>
          {!rows.length && <p>{report.activityAvailable === false ? 'Tracked category data is unavailable.' : 'No categories match these filters.'}</p>}
        </section>
        </AnalyticsPanel>
      </>}
      <AnalyticsPanel name="diagnostics" activeTab={activeTab}>
        {report.activityAvailable === false ? <p role="status">Tracked diagnostics are unavailable. Traffic counts do not provide client diagnostic details.</p> : <>
        {!invalidDates && <section className="office-analytics-card" aria-labelledby="analytics-diagnostic-history-heading"><h2 id="analytics-diagnostic-history-heading">Diagnostic history</h2>
          <p>Recorded occurrences for the selected dates and filters. Historical counts remain after a fix; use new events to check whether an issue recurs. Diagnostics contain fixed categories and error types without raw error text or account details.</p>
          {diagnostics === null ? <p>Diagnostic detail is unavailable from this API release.</p> : diagnostics.length ? <div className="office-analytics-table-wrap office-analytics-geography-table" tabIndex={0} role="region" aria-label="Diagnostic history table"><table><thead><tr><th scope="col">Date (UTC)</th><th scope="col">Category</th><th scope="col">Diagnostic type</th><th scope="col">Occurrences</th></tr></thead><tbody>
            {diagnostics.map(row => <tr key={`${row.day}:${row.category}:${row.code}`}><th scope="row">{row.day}</th><td>{row.label}</td><td>{errorNames[row.code] || row.code}</td><td>{number(row.count)}</td></tr>)}
          </tbody></table></div> : <p>No diagnostics were recorded for this selection.</p>}
        </section>}
      <button type="button" onClick={() => selectTab('requests')}>View durable API request history</button>
      <div className="office-analytics-two-columns">
        <section className="office-analytics-card"><h2>Optional diagnostic types</h2><p>All platforms, last 30 days. Diagnostic collection depends on each user's preference.</p><dl className="office-analytics-facts">{Object.entries(errorNames).map(([code, label]) => <div key={code}><dt>{label}</dt><dd>{number(report.performance?.byCode?.find(row => row.code === code)?.last30)}</dd></div>)}</dl></section>
        <section className="office-analytics-card"><h2>API responses</h2><p>Current API process only, since {service?.since ? new Date(service.since).toLocaleString() : 'startup'}. These request totals are separate from visits.</p><dl className="office-analytics-facts">{['2xx', '3xx', '4xx', '5xx'].map(code => <div key={code}><dt>{code} responses</dt><dd>{number(responses[code])}</dd></div>)}</dl><p className="office-analytics-meta">Total requests: {number(service?.total)}</p></section>
      </div>
      {report.storage && <section className="office-analytics-card"><h2>Collection status</h2><p>These collection checks describe the current API process. Successful events are acknowledged after storage confirms the write.</p><dl className="office-analytics-facts">
        <div><dt>Storage</dt><dd>{report.storage.connected ? report.storage.status === 'retrying' ? 'Retrying a write' : 'Connected' : 'Unavailable'}</dd></div>
        <div><dt>Last saved event batch</dt><dd>{report.storage.lastPersistedAt ? new Date(report.storage.lastPersistedAt).toLocaleString() : 'No batch saved by this process yet'}</dd></div>
        <div><dt>Events waiting for storage</dt><dd>{number(report.storage.pendingEvents)}</dd></div>
        <div><dt>Requests rate limited</dt><dd>{number(report.storage.collector?.rateLimited)}</dd></div>
        <div><dt>Storage write failures</dt><dd>{number(report.storage.collector?.writeFailures)}</dd></div>
      </dl></section>}
        </>}
      </AnalyticsPanel>
    </>}
    <AnalyticsPanel name="traffic" activeTab={activeTab}>{visitedTabs.traffic && <TrafficAnalytics apiBase={apiBase} request={request} active={activeTab === 'traffic'} onCompare={() => selectTab('comparison')} />}</AnalyticsPanel>
    <AnalyticsPanel name="comparison" activeTab={activeTab}>{visitedTabs.comparison && <AnalyticsComparison apiBase={apiBase} request={request} active={activeTab === 'comparison'} />}</AnalyticsPanel>
    <AnalyticsPanel name="requests" activeTab={activeTab}>{visitedTabs.requests && <RequestsAnalytics apiBase={apiBase} request={request} active={activeTab === 'requests'} />}</AnalyticsPanel>
    {usersPanel && <AnalyticsPanel name="users" activeTab={activeTab}>{visitedTabs.users && cloneElement(usersPanel, { active: activeTab === 'users' })}</AnalyticsPanel>}
  </section>;
}
