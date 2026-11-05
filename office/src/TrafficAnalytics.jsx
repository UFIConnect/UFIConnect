import { useEffect, useRef, useState } from 'react';

const number = value => Number.isFinite(value) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value) : 'Unavailable';

export default function TrafficAnalytics({ apiBase, request, active = true }) {
  const [report, setReport] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [revision, setRevision] = useState(0), [month, setMonth] = useState('all');
  const generation = useRef(0);
  useEffect(() => {
    const invalidate = () => { generation.current++; setReport(null); setError(''); setRevision(value => value + 1); };
    window.addEventListener('office-token-changed', invalidate);
    return () => window.removeEventListener('office-token-changed', invalidate);
  }, []);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(), current = ++generation.current;
    setBusy(true); setError('');
    request(`${apiBase}/office/analytics/traffic`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (response.status === 401 || response.status === 403) throw new Error('Office access is required to load traffic history.');
        if (!response.ok || data.available !== true || !Array.isArray(data.daily) || !Array.isArray(data.monthly)) {
          throw new Error(data.error || 'Traffic history is unavailable. Check the Cloudflare connection and retry.');
        }
        if (generation.current === current && !controller.signal.aborted) setReport(data);
      })
      .catch(failure => { if (generation.current === current && !controller.signal.aborted) setError(failure.message || 'Traffic history could not be loaded.'); })
      .finally(() => { if (generation.current === current && !controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [active, apiBase, request, revision]);
  const daily = (report?.daily || []).filter(row => month === 'all' || row.day.startsWith(month)).slice().reverse();
  return <section aria-labelledby="traffic-history-heading">
    <div className="office-analytics-section-heading"><div><h2 id="traffic-history-heading">Traffic since launch</h2><p>Cloudflare traffic for uficonnect.org and its proxied subdomains. UTC calendar days.</p></div>
      <button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>{busy ? 'Refreshing traffic…' : 'Refresh traffic history'}</button></div>
    <p className="office-analytics-meta">Edge requests include automated traffic. HTML page views and daily unique IPs describe network traffic; they do not identify unique people. These totals are separate from app opens and Google Analytics.</p>
    {busy && !report && <p role="status">Loading traffic history…</p>}
    {error && <div role="alert" className="office-analytics-error">{error}</div>}
    {report && <>
      {(report.status === 'stale' || error) && <p role="status" className="office-analytics-meta">Showing previously checked traffic. Fresh counts are temporarily unavailable.</p>}
      {report.persistence && <p className="office-analytics-meta" role={report.persistence.durable ? undefined : 'status'}>{report.persistence.durable ? 'Daily traffic history is saved for future reporting.' : 'Traffic is available, but saving its daily history is temporarily unavailable. Refresh to retry.'} {Number.isFinite(report.persistence.recoveredDays) && report.persistence.recoveredDays > 0 ? `${number(report.persistence.recoveredDays)} earlier days are preserved from stored observations.` : ''}</p>}
      <dl className="office-analytics-metrics">
        <div><dt>Edge requests</dt><dd>{number(report.totals?.requests)}</dd></div>
        <div><dt>HTML page views</dt><dd>{number(report.totals?.pageViews)}</dd></div>
        <div><dt>Recorded traffic days</dt><dd>{number(report.daily.length)}</dd></div>
        <div><dt>Unique people</dt><dd>Unavailable</dd></div>
      </dl>
      <p className="office-analytics-meta">Requested history: {report.range?.from} through {report.range?.to}. {report.coverage?.firstRecordedDay ? `Provider records begin ${report.coverage.firstRecordedDay}.` : 'No daily records were returned.'} Missing dates are unavailable; they are not filled with zero. Today may be incomplete. Provider data checked: {report.lastSuccessAt || report.generatedAt ? new Date(report.lastSuccessAt || report.generatedAt).toLocaleString() : 'Unavailable'}.</p>
      <section className="office-analytics-card" aria-labelledby="traffic-monthly-heading"><h3 id="traffic-monthly-heading">Monthly traffic</h3>
        <div className="office-analytics-table-wrap" tabIndex={0} role="region" aria-label="Monthly traffic table"><table><thead><tr><th scope="col">Month (UTC)</th><th scope="col">Recorded days</th><th scope="col">Requests</th><th scope="col">HTML page views</th></tr></thead><tbody>
          {report.monthly.map(row => <tr key={row.month}><th scope="row">{row.month}</th><td>{number(row.recordedDays)}</td><td>{number(row.requests)}</td><td>{number(row.pageViews)}</td></tr>)}
        </tbody></table></div>
      </section>
      <section className="office-analytics-card" aria-labelledby="traffic-daily-heading"><div className="office-analytics-section-heading"><h3 id="traffic-daily-heading">Daily traffic</h3><label>Traffic month<select aria-label="Traffic month" value={month} onChange={event => setMonth(event.target.value)}><option value="all">All recorded months</option>{report.monthly.map(row => <option key={row.month} value={row.month}>{row.month}</option>)}</select></label></div>
        <div className="office-analytics-table-wrap office-analytics-geography-table" tabIndex={0} role="region" aria-label="Daily traffic table"><table><thead><tr><th scope="col">Day (UTC)</th><th scope="col">Requests</th><th scope="col">HTML page views</th><th scope="col">Unique IPs that day</th></tr></thead><tbody>
          {daily.map(row => <tr key={row.day}><th scope="row">{row.day}</th><td>{number(row.requests)}</td><td>{number(row.pageViews)}</td><td>{number(row.uniqueIPs)}</td></tr>)}
        </tbody></table></div>
        {!daily.length && <p>No daily records for this month.</p>}
        <p className="office-analytics-meta">Daily unique IPs are never added into an all-time visitor total. One IP can represent several people, and the same IP can return on different days.</p>
      </section>
    </>}
  </section>;
}
