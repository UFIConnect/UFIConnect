import { useMemo, useState } from 'react';
import { selectRequestDays } from './analytics-comparison-model.mjs';
import useOfficeAnalyticsSnapshot from './useOfficeAnalyticsSnapshot.js';
import OfficeRequestDiagnostics from './OfficeRequestDiagnostics.jsx';
import RequestProviderHistory from './RequestProviderHistory.jsx';
import './analytics-comparison.css';

const valid = data => Array.isArray(data.daily) && Array.isArray(data.byFamily) && typeof data.range?.from === 'string';
const number = value => value === null || value === undefined ? 'Unavailable' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
const latencyLabels = { under_100ms: 'Under 100 ms', '100_499ms': '100–499 ms', '500_1999ms': '500–1,999 ms', '2_10s': '2–10 seconds', over_10s: 'Over 10 seconds', unknown: 'Time to headers unavailable' };
function Breakdown({ title, label, rows, field, names = {} }) {
  return <section className="office-analytics-card"><h3>{title}</h3><div className="office-analytics-table-wrap office-analytics-geography-table" tabIndex={0} role="region" aria-label={title}><table><thead><tr><th scope="col">{label}</th><th scope="col">Requests</th></tr></thead><tbody>{rows.map(row => <tr key={row[field]}><th scope="row">{names[row[field]] || row[field]}</th><td>{number(row.requests)}</td></tr>)}</tbody></table></div>{!rows.length && <p>No retained request observations.</p>}</section>;
}
export default function RequestsAnalytics({ apiBase, request, active = true }) {
  const { report, busy, error, refresh } = useOfficeAnalyticsSnapshot({ apiBase, request, active, valid, endpoint: '/office/analytics/requests' });
  const [customStart, setCustomStart] = useState(''), [customEnd, setCustomEnd] = useState(''), [role, setRole] = useState('all');
  const start = customStart || report?.range?.from, end = customEnd || report?.range?.to;
  const invalidDates = Boolean(report && (!start || !end || start > end || start < report.range.from || end > report.range.to));
  const selected = useMemo(() => selectRequestDays(report, { start, end, role }), [report, start, end, role]);
  const recoveredSources = (report?.history?.sources || []).filter(source => source.source === 'render-request-logs' && (role === 'all' || source.role === role));
  return <section aria-labelledby="analytics-requests-heading">
    <div className="office-analytics-section-heading"><div><h2 id="analytics-requests-heading">API and pipeline requests</h2><p>Retained request logs and current counters, grouped by UTC day, service, endpoint family and response status. Duration is included where measured.</p></div><button type="button" disabled={busy} onClick={refresh}>{busy ? 'Refreshing requests…' : 'Refresh request counts'}</button></div>
    <p className="office-analytics-meta">Requests include application and operational calls. They are separate from visitors, edge traffic and page opens. Raw paths, query strings, account identifiers and request contents are excluded.</p>
    <p className="office-analytics-meta">{typeof report?.measurement === 'string' ? report.measurement : 'Duration measures time until response headers are sent, including server work before those headers. It does not measure the full response download or a stream’s lifetime.'} Duration ranges are counts in fixed buckets, not latency percentiles.</p>
    {busy && !report && <p role="status">Loading server request counts…</p>}
    {error && <div role="alert" className="office-analytics-error">{error}{report ? ' Previously loaded request counts remain visible.' : ''}</div>}
    {report && <>
      <p className="office-analytics-meta">{report.coverage?.firstRecordedDay ? `Classified request observations begin ${report.coverage.firstRecordedDay}.` : 'No classified request history has been observed yet.'} Retained historical logs and current counters cover separate dates. Earlier unobserved dates remain unavailable.</p>
      <div className="office-analytics-filters"><label>Requests from (UTC)<input aria-label="Requests from (UTC)" type="date" min={report.range.from} max={end} value={start} onChange={event => setCustomStart(event.target.value)} /></label><label>Requests to (UTC)<input aria-label="Requests to (UTC)" type="date" min={start} max={report.range.to} value={end} onChange={event => setCustomEnd(event.target.value)} /></label><label>Request service<select aria-label="Request service" value={role} onChange={event => setRole(event.target.value)}><option value="all">API and pipeline</option><option value="api">API</option><option value="pipeline">Pipeline</option></select></label></div>
      {invalidDates ? <p role="alert" className="office-analytics-error">Choose dates between {report.range.from} and {report.range.to}.</p> : <>
        <dl className="office-analytics-metrics">{[['Recorded requests', 'requests'], ['Server errors · 5xx', 'errors'], ['Responses taking 2+ seconds', 'slowRequests'], ['Requests closed early', 'aborted']].map(([label, key]) => <div key={key}><dt>{label}</dt><dd>{number(selected.totals[key])}</dd>{selected.totals.coverage?.[key]?.missingDays > 0 && <small>{selected.totals.coverage[key].observedDays} of {selected.totals.days} recorded days measured</small>}</div>)}</dl>
        <section className="office-analytics-card"><h3>Daily server requests</h3><p>Selected service and dates. Only observed days are listed. A blank historical period does not establish zero requests.</p><div className="office-analytics-table-wrap analytics-comparison-table" tabIndex={0} role="region" aria-label="Daily server requests table"><table><thead><tr><th scope="col">Day (UTC)</th><th scope="col">Requests</th><th scope="col">5xx errors</th><th scope="col">4xx responses</th><th scope="col">2+ seconds</th><th scope="col">Closed early</th></tr></thead><tbody>{selected.daily.slice().reverse().map(row => <tr key={row.period}><th scope="row">{row.period}</th>{['requests', 'errors', 'clientErrors', 'slowRequests', 'aborted'].map(key => <td key={key}>{number(row[key])}</td>)}</tr>)}</tbody></table></div>{!selected.daily.length && <p>No retained request observations for this selection.</p>}</section>
      </>}
      <RequestProviderHistory report={report.providerHistory} start={start} end={end} role={role} invalidDates={invalidDates} />
      {recoveredSources.length > 0 && <section className="office-analytics-card" aria-labelledby="recovered-log-coverage-heading">
        <h3 id="recovered-log-coverage-heading">Recovered request log coverage</h3>
        <p>Retained coverage for the selected service, across all imported dates. The first retained day may be partial. Recovered logs do not contain a matching time-to-headers or early-disconnect measurement.</p>
        <div className="office-analytics-table-wrap" tabIndex={0} role="region" aria-label="Recovered request log coverage table"><table>
          <thead><tr><th scope="col">Service</th><th scope="col">First retained day</th><th scope="col">Through</th><th scope="col">Recovered requests</th><th scope="col">Coverage</th></tr></thead>
          <tbody>{recoveredSources.map(source => <tr key={source.role}><th scope="row">{source.role === 'pipeline' ? 'Pipeline' : 'API'}</th><td>{source.firstRecordedDay || 'Unavailable'}</td><td>{source.lastRecordedDay || 'Unavailable'}</td><td>{number(source.recoveredRequests)}</td><td>{source.retrievedCompletely ? 'Imported days retrieved' : 'Recovery incomplete'}<small>{number(source.completeDays?.length)} complete UTC days</small>{source.partialDays?.length > 0 && <small>Partial: {source.partialDays.map(day => day.day).join(', ')}</small>}</td></tr>)}</tbody>
        </table></div>
      </section>}
      <h3>All retained server observations</h3><p className="office-analytics-meta">The following breakdowns use the complete reported range, {report.range.from} through {report.range.to}, across both services. The date and service controls above apply to the daily table and its headline totals.</p>
      {report.metricCoverage && <p className="office-analytics-meta">Time to headers is measured for {number(report.metricCoverage.requestsWithHeaderLatency)} of {number(report.totals?.requests)} retained classified requests. Early-disconnect outcomes are known for {number(report.metricCoverage.requestsWithKnownAbortOutcome)} requests. Historical gaps are not treated as fast or completed requests.</p>}
      <div className="analytics-request-breakdowns"><Breakdown title="Requests by endpoint family" label="Endpoint family" rows={report.byFamily || []} field="family" /><Breakdown title="Requests by service" label="Service" rows={report.byRole || []} field="role" names={{ api: 'API', pipeline: 'Pipeline' }} /><Breakdown title="Requests by response status" label="Response status" rows={report.byStatus || []} field="statusClass" /><Breakdown title="Requests by duration" label="Response duration" rows={report.byLatency || []} field="latencyBucket" names={latencyLabels} /></div>
      <section className="office-analytics-card"><h3>Request collection status</h3><p>Counts acknowledged by durable storage survive process restarts. Very recent requests may still be waiting to save. Classified counts exclude private Vault, VPN and authorization callback requests. Platform totals have their own network scope.</p><dl className="office-analytics-facts"><div><dt>Storage</dt><dd>{report.storage?.status || 'Unavailable'}</dd></div><div><dt>Observed days</dt><dd>{number(report.coverage?.observedDays)}</dd></div><div><dt>Last report</dt><dd>{report.generatedAt ? new Date(report.generatedAt).toLocaleString() : 'Unavailable'}</dd></div></dl></section>
    </>}
    <OfficeRequestDiagnostics request={request} />
  </section>;
}
