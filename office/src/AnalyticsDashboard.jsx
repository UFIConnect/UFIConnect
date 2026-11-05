import { cloneElement, useMemo, useRef, useState } from 'react';
import { count, filterAnalytics, filterDiagnostics, reportDays } from './analytics-model.mjs';
import AnalyticsGeography from './AnalyticsGeography.jsx';
import TrafficAnalytics from './TrafficAnalytics.jsx';
import useAnalyticsReport from './useAnalyticsReport.js';
import './AnalyticsDashboard.css';

const number = value => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(count(value));
const errorNames = { script_error: 'Script errors', unhandled_rejection: 'Unhandled promises', render_error: 'Rendering errors', request_failed: 'Failed requests' };
const types = { page: 'Page', screen: 'App screen', tab: 'Tab' };

const analyticsTabs = [['overview', 'Overview'], ['pages', 'Pages & tabs'], ['geography', 'Geography'], ['diagnostics', 'Diagnostics'], ['traffic', 'Traffic history'], ['users', 'Users']];

function AnalyticsPanel({ name, activeTab, children }) {
  return <div className="office-analytics-panel" role="tabpanel" id={`office-analytics-panel-${name}`} aria-labelledby={`office-analytics-tab-${name}`} hidden={activeTab !== name} tabIndex={0}>{children}</div>;
}

function DailyTrend({ daily }) {
  const peak = Math.max(1, ...daily.map(row => row.views + row.tabs));
  return <section className="office-analytics-card" aria-labelledby="analytics-daily-heading">
    <div className="office-analytics-section-heading"><div><h2 id="analytics-daily-heading">Daily activity</h2><p>UTC calendar days. Page and app-screen views are separate from tab opens.</p></div><span>Peak: {daily.some(row => row.available) ? number(peak === 1 && !daily.some(row => row.views || row.tabs) ? 0 : peak) : 'Unavailable'}</span></div>
    <div className="office-analytics-legend"><span><i />Pages and screens</span><span><i className="tabs" />Tabs</span></div>
    <div className="office-analytics-chart" role="img" aria-label={`Daily activity for ${daily.length} days. Exact counts are in the daily data table.`}>
      {daily.map(row => <div key={row.day} className={`office-analytics-bar${row.available ? '' : ' unavailable'}`} title={row.available ? `${row.day}: ${number(row.views)} page/screen views, ${number(row.tabs)} tab opens, ${number(row.errors)} diagnostics` : `${row.day}: Historical analytics unavailable`}>
        {row.available && <><span className="tabs" style={{ height: `${row.tabs / peak * 100}%` }} /><span style={{ height: `${row.views / peak * 100}%` }} /></>}
      </div>)}
    </div>
    <div className="office-analytics-axis"><span>{daily[0]?.day}</span><span>{daily.at(-1)?.day}</span></div>
    <details><summary>View daily data</summary><div className="office-analytics-table-wrap" tabIndex={0} role="region" aria-label="Daily activity table">
      <table><thead><tr><th scope="col">Date (UTC)</th><th scope="col">Pages / screens</th><th scope="col">Tab opens</th><th scope="col">Diagnostics</th></tr></thead>
        <tbody>{daily.map(row => <tr key={row.day}><th scope="row">{row.day}</th><td>{row.available ? number(row.views) : 'Unavailable'}</td><td>{row.available ? number(row.tabs) : 'Unavailable'}</td><td>{row.available ? number(row.errors) : 'Unavailable'}</td></tr>)}</tbody></table>
    </div></details>
  </section>;
}

export default function AnalyticsDashboard({ apiBase, request, usersPanel }) {
  const { report, busy, error, updatedAt, revision, refresh, stale } = useAnalyticsReport({ apiBase, request });
  const [preset, setPreset] = useState('history'), [customStart, setCustomStart] = useState(''), [customEnd, setCustomEnd] = useState('');
  const [platform, setPlatform] = useState('all'), [category, setCategory] = useState('all'), [viewType, setViewType] = useState('all');
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
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
  const freshnessWarning = Boolean(error || stale || verificationNeedsAttention);
  const freshnessLabel = error ? 'Refresh failed' : stale ? 'Counts need a fresh check' : busy ? 'Checking latest counts'
    : verification?.status === 'verified' ? 'Database counts verified'
      : verification?.status === 'mismatch' ? 'Count verification needs attention'
        : verification?.status === 'error' ? 'Database verification unavailable'
          : verification?.status === 'stale' ? 'Database verification is overdue'
            : verification?.status === 'pending' ? 'Database verification pending' : 'Counts loaded; database verification unavailable';

  return <section className="office-analytics">
    <header className="office-analytics-header"><div><h1>Analytics</h1><p>Anonymous counts for website pages, app screens and internal tabs. Counts represent opens, not unique people.</p></div><button type="button" onClick={refresh} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh analytics'}</button></header>
    <section className={`office-analytics-freshness${freshnessWarning ? ' warning' : ''}`} aria-label="Analytics freshness">
      <strong role="status" aria-live="polite">{freshnessLabel}</strong>
      <p>{updatedAt ? <>Last successful read <time dateTime={updatedAt.toISOString()}>{updatedAt.toLocaleString()}</time>. </> : 'Waiting for the first successful read. '}Checks for updated counts every 30 seconds while this page is visible, and when you return or reconnect.</p>
      {verification && <p>{verification.checkedAt ? <>Database check <time dateTime={verification.checkedAt}>{new Date(verification.checkedAt).toLocaleString()}</time>. </> : 'Database check has not completed. '}{verification.status === 'verified' ? 'Displayed totals match the stored records.' : verification.status === 'mismatch' ? 'The stored records and reported totals differ. Review the count check before using these totals.' : verification.error || 'A successful database count check is still needed.'}{verification.lastVerifiedAt && verification.status !== 'verified' ? ` Last verified ${new Date(verification.lastVerifiedAt).toLocaleString()}.` : ''}</p>}
      {(error || stale) && report && <p>The last successful counts remain visible until a fresh read succeeds.</p>}
    </section>
    <p className="office-analytics-meta">UTC history from May 2026. Optional Google Analytics is reported separately.</p>
    <div ref={tabsAnchor} />
    <div className="office-analytics-tabs" role="tablist" aria-label="Analytics sections">
      {tabs.map(([name, label], index) => <button key={name} ref={element => { tabButtons.current[name] = element; }} type="button" role="tab" id={`office-analytics-tab-${name}`} aria-controls={`office-analytics-panel-${name}`} aria-selected={activeTab === name} tabIndex={activeTab === name ? 0 : -1} onClick={() => selectTab(name)} onKeyDown={event => navigateTabs(event, index)}>{label}</button>)}
    </div>
    {error && <div className="office-analytics-error" role="alert"><p>{error}{report ? ' The last successful report remains below.' : ''}</p><button type="button" onClick={refresh} disabled={busy}>Retry analytics</button></div>}
    {busy && <p role="status">Loading analytics…</p>}
    {report && <>
      <div className="office-analytics-filters" hidden={activeTab === 'users' || activeTab === 'traffic'}>
        <label>Period<select aria-label="Period" value={preset} onChange={event => { if (event.target.value === 'custom') { setCustomStart(start); setCustomEnd(end); } setPreset(event.target.value); }}><option value="history">Since May 2026</option><option value="1">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="custom">Custom dates</option></select></label>
        <label>From (UTC)<input type="date" min={days[0]} max={end || days.at(-1)} value={start} onChange={event => customDate('start', event.target.value)} /></label>
        <label>To (UTC)<input type="date" min={start || days[0]} max={days.at(-1)} value={end} onChange={event => customDate('end', event.target.value)} /></label>
        <label>Platform<select aria-label="Platform" value={platform} onChange={event => { setPlatform(event.target.value); setCategory('all'); }}><option value="all">Web and mobile</option><option value="web">Website</option><option value="mobile">Mobile app</option></select></label>
        <label>View type<select aria-label="View type" value={viewType} onChange={event => { setViewType(event.target.value); setCategory('all'); }}><option value="all">All types</option><option value="page">Website pages</option><option value="screen">App screens</option><option value="tab">Internal tabs</option></select></label>
        <label>Category<select aria-label="Category" value={category} onChange={event => setCategory(event.target.value)}><option value="all">All categories</option>{options.map(row => <option key={row.category} value={row.category}>{row.label}</option>)}</select></label>
      </div>
      {invalidDates ? <p role="alert" className="office-analytics-error" hidden={activeTab === 'users' || activeTab === 'traffic'}>Choose dates between {days[0]} and {days.at(-1)}, with the start before the end.</p> : <>
        <dl className="office-analytics-metrics" hidden={activeTab === 'users' || activeTab === 'traffic'}>{[['Page / screen views', filtered.views], ['Tab opens', filtered.tabs], ['Optional diagnostics', filtered.errors], ['Categories with activity', filtered.activeCategories]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{filtered.availableDays ? number(value) : 'Unavailable'}</dd></div>)}</dl>
        <p className="office-analytics-meta" hidden={activeTab === 'users' || activeTab === 'traffic'}>Page and screen views count navigation. Tab opens are counted separately. Database summary rows group many opens by date and category.</p>
        {report.history && <p className="office-analytics-meta" hidden={activeTab === 'users' || activeTab === 'traffic'}>{report.history.firstRecordedDay ? `Available analytics begins ${report.history.firstRecordedDay}. Earlier dates are unavailable and shaded in the chart. ` : 'Historical analytics is unavailable until an event is recorded. '}{count(report.history.restoredViews) > 0 ? `${number(report.history.restoredViews)} earlier page views were recovered. ` : ''}Selected totals include retained events only.</p>}
        <AnalyticsPanel name="overview" activeTab={activeTab}>
        <DailyTrend daily={filtered.daily} />
        <section className="office-analytics-card"><h2>Coverage and privacy</h2><p>Fixed category names and approximate network country and city are counted without IP addresses, device coordinates or visitor identifiers. Page addresses, search text, account identifiers, message content and form values are excluded. Private Vault, device-authentication and VPN screens do not send page counts or diagnostics.</p><p>May onward is available for date selection. {report.history?.firstRecordedDay ? `Retained activity starts on ${report.history.firstRecordedDay}. ` : 'No retained activity has been recorded. '}{count(report.history?.restoredViews) > 0 ? `${number(report.history.restoredViews)} historical page views were recovered from earlier records. ` : ''}Earlier dates are unavailable. Later dates with no retained events show zero recorded activity; previously expired or unrecorded events cannot be reconstructed.</p><p className="office-analytics-meta">Counts can be lower when requests are blocked, offline or rate limited. New categories and geographic counts have no historical backfill.</p></section>
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
          {!rows.length && <p>No categories match these filters.</p>}
        </section>
        </AnalyticsPanel>
      </>}
      <AnalyticsPanel name="diagnostics" activeTab={activeTab}>
        {!invalidDates && <section className="office-analytics-card" aria-labelledby="analytics-diagnostic-history-heading"><h2 id="analytics-diagnostic-history-heading">Diagnostic history</h2>
          <p>Recorded occurrences for the selected dates and filters. Historical counts remain after a fix; use new events to check whether an issue recurs. Diagnostics contain fixed categories and error types without raw error text or account details.</p>
          {diagnostics === null ? <p>Diagnostic detail is unavailable from this API release.</p> : diagnostics.length ? <div className="office-analytics-table-wrap office-analytics-geography-table" tabIndex={0} role="region" aria-label="Diagnostic history table"><table><thead><tr><th scope="col">Date (UTC)</th><th scope="col">Category</th><th scope="col">Diagnostic type</th><th scope="col">Occurrences</th></tr></thead><tbody>
            {diagnostics.map(row => <tr key={`${row.day}:${row.category}:${row.code}`}><th scope="row">{row.day}</th><td>{row.label}</td><td>{errorNames[row.code] || row.code}</td><td>{number(row.count)}</td></tr>)}
          </tbody></table></div> : <p>No diagnostics were recorded for this selection.</p>}
        </section>}
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
      </AnalyticsPanel>
    </>}
    <AnalyticsPanel name="traffic" activeTab={activeTab}>{visitedTabs.traffic && <TrafficAnalytics apiBase={apiBase} request={request} active={activeTab === 'traffic'} />}</AnalyticsPanel>
    {usersPanel && <AnalyticsPanel name="users" activeTab={activeTab}>{visitedTabs.users && cloneElement(usersPanel, { active: activeTab === 'users' })}</AnalyticsPanel>}
  </section>;
}
