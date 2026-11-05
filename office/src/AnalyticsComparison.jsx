import { useMemo, useState } from 'react';
import { COMPARISON_METRICS, selectComparison } from './analytics-comparison-model.mjs';
import useOfficeAnalyticsSnapshot from './useOfficeAnalyticsSnapshot.js';
import './analytics-comparison.css';

const valid = data => Array.isArray(data.daily) && typeof data.range?.from === 'string' && typeof data.range?.to === 'string';
const number = value => value === null || value === undefined ? 'Unavailable' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
const sourceLabels = { edge: 'Cloudflare traffic', firstParty: 'App and website activity', registrations: 'Registrations' };
function MetricValue({ row, metric }) {
  const coverage = row.coverage?.[metric.key];
  return <>{number(row[metric.key])}{coverage?.missingDays > 0 && <small className="analytics-coverage-note">{coverage.observedDays} of {row.days} days recorded</small>}</>;
}
function ComparisonTrend({ rows, left, right }) {
  const values = rows.flatMap(row => [row[left.key], row[right.key]]).filter(value => value !== null), peak = Math.max(1, ...values);
  const path = metric => {
    let connected = false;
    return rows.map((row, index) => {
      if (row[metric] === null) { connected = false; return ''; }
      const point = `${rows.length === 1 ? 450 : index / Math.max(1, rows.length - 1) * 900},${174 - row[metric] / peak * 160}`;
      const segment = `${connected ? 'L' : 'M'}${point}`; connected = true; return segment;
    }).join(' ');
  };
  return <section className="office-analytics-card"><h3>Activity on the same dates</h3><p>Both series use the same count scale. Gaps mean unavailable data. Exact counts and coverage are below.</p>
    <div className="analytics-comparison-legend"><span><i />{left.label}</span><span><i className="secondary" />{right.label}</span><span>Scale maximum: {values.length ? number(peak) : 'Unavailable'}</span></div>
    <svg className="analytics-comparison-chart" viewBox="-8 0 916 186" role="img" aria-label={`${left.label} and ${right.label} on the same dates; exact counts are in the comparison table.`}>
      <path d="M0 174H900" stroke="#334155" fill="none" /><path d={path(left.key)} fill="none" stroke="#60a5fa" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      <path d={path(right.key)} fill="none" stroke="#fbbf24" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      {rows.length === 1 && [left, right].map((metric, index) => rows[0][metric.key] === null ? null : <circle key={metric.key} cx="450" cy={174 - rows[0][metric.key] / peak * 160} r="3.5" fill={index ? '#fbbf24' : '#60a5fa'} />)}
    </svg><div className="office-analytics-axis"><span>{rows[0]?.period || 'No shared dates'}</span><span>{rows.at(-1)?.period}</span></div>
  </section>;
}

export default function AnalyticsComparison({ apiBase, request, active = true }) {
  const { report, busy, error, refresh } = useOfficeAnalyticsSnapshot({ apiBase, request, active, valid, endpoint: '/office/analytics/comparison' });
  const [customStart, setCustomStart] = useState(''), [customEnd, setCustomEnd] = useState(''), [group, setGroup] = useState('month'), [matched, setMatched] = useState(true);
  const [leftKey, setLeftKey] = useState('htmlPageViews'), [rightKey, setRightKey] = useState('webPageOpens');
  const start = customStart || report?.range?.from, end = customEnd || report?.range?.to;
  const invalidDates = Boolean(report && (!start || !end || start > end || start < report.range.from || end > report.range.to));
  const selected = useMemo(() => selectComparison(report, { start, end, group, matched, leftKey, rightKey }), [report, start, end, group, matched, leftKey, rightKey]);
  const left = COMPARISON_METRICS.find(metric => metric.key === leftKey), right = COMPARISON_METRICS.find(metric => metric.key === rightKey);
  return <section aria-labelledby="analytics-comparison-heading">
    <div className="office-analytics-section-heading"><div><h2 id="analytics-comparison-heading">Compare traffic and recorded activity</h2><p>Align UTC dates across edge traffic, website pages, mobile screens, tabs, diagnostics and known registrations.</p></div><button type="button" onClick={refresh} disabled={busy}>{busy ? 'Refreshing comparison…' : 'Refresh comparison'}</button></div>
    <p className="office-analytics-meta">These sources measure different events and populations. Counts are shown side by side; they are not unique visitors or a signup conversion rate.</p>
    {busy && !report && <p role="status">Loading the comparison…</p>}
    {error && <div role="alert" className="office-analytics-error">{error}{report ? ' The last successful comparison remains visible.' : ''}</div>}
    {report && <>
      <div className="office-analytics-filters">
        <label>Comparison from (UTC)<input aria-label="Comparison from (UTC)" type="date" min={report.range.from} max={end} value={start} onChange={event => setCustomStart(event.target.value)} /></label>
        <label>Comparison to (UTC)<input aria-label="Comparison to (UTC)" type="date" min={start} max={report.range.to} value={end} onChange={event => setCustomEnd(event.target.value)} /></label>
        <label>Compare by<select aria-label="Compare by" value={group} onChange={event => setGroup(event.target.value)}><option value="month">Month</option><option value="day">Day</option></select></label>
      </div>
      <div className="analytics-comparison-scope"><label><input type="checkbox" checked={matched} onChange={event => setMatched(event.target.checked)} />Only dates recorded for both selected series</label><button type="button" onClick={() => { setCustomStart(''); setCustomEnd(''); }}>All retained dates</button></div>
      {invalidDates ? <p role="alert" className="office-analytics-error">Choose dates between {report.range.from} and {report.range.to}, with the start before the end.</p> : <>
        <p className="office-analytics-meta">{selected.selectedDays} dates included from {selected.requestedDays} selected UTC days. {matched ? `${selected.requestedDays - selected.matchedDays} dates without records for both ${left.label.toLowerCase()} and ${right.label.toLowerCase()} are excluded.` : 'Each metric reports its own recorded days; partial coverage is marked.'} Other metrics do not restrict the dates of the selected pair.</p>
        <dl className="office-analytics-metrics analytics-comparison-metrics">{COMPARISON_METRICS.map(metric => <div key={metric.key}><dt>{metric.label}</dt><dd><MetricValue row={selected.totals} metric={metric} /></dd></div>)}</dl>
        <div className="office-analytics-filters analytics-comparison-series"><label>Traffic series<select aria-label="Traffic series" value={leftKey} onChange={event => setLeftKey(event.target.value)}>{COMPARISON_METRICS.filter(metric => metric.group === 'edge').map(metric => <option key={metric.key} value={metric.key}>{metric.label}</option>)}</select></label><label>Activity series<select aria-label="Activity series" value={rightKey} onChange={event => setRightKey(event.target.value)}>{COMPARISON_METRICS.filter(metric => metric.group !== 'edge').map(metric => <option key={metric.key} value={metric.key}>{metric.label}</option>)}</select></label></div>
        <ComparisonTrend rows={selected.rows} left={left} right={right} />
        <section className="office-analytics-card"><h3>Comparison by {group === 'month' ? 'month' : 'day'}</h3>
          <div className="office-analytics-table-wrap analytics-comparison-table" tabIndex={0} role="region" aria-label="Traffic and activity comparison table"><table><thead><tr><th scope="col">{group === 'month' ? 'Month' : 'Day'} (UTC)</th>{COMPARISON_METRICS.map(metric => <th scope="col" key={metric.key} title={metric.definition}>{metric.label}</th>)}</tr></thead><tbody>{selected.rows.slice().reverse().map(row => <tr key={row.period}><th scope="row">{row.period}<small>{row.days} {row.days === 1 ? 'day' : 'days'} included</small></th>{COMPARISON_METRICS.map(metric => <td key={metric.key}><MetricValue row={row} metric={metric} /></td>)}</tr>)}</tbody></table></div>
          {!selected.rows.length && <p>No dates have the selected coverage. Include all selected dates to see the available sources separately.</p>}
        </section>
      </>}
      <section className="office-analytics-card"><h3>Source coverage and definitions</h3><div className="analytics-source-coverage">{Object.entries(sourceLabels).map(([key, label]) => { const source = report.sources?.[key]; return <div key={key}><h4>{label}</h4><p>{source?.status || 'Unavailable'}. {source?.firstRecordedDay ? `Retained records begin ${source.firstRecordedDay}.` : 'No retained start date is available.'}</p><p>{source?.scope || 'This source has no reported scope.'}</p>{source?.checkedAt && <p className="office-analytics-meta">Checked {new Date(source.checkedAt).toLocaleString()}.</p>}</div>; })}</div><dl className="office-analytics-facts">{COMPARISON_METRICS.map(metric => <div key={metric.key}><dt>{metric.label}</dt><dd>{metric.definition}</dd></div>)}</dl><p>Missing history is unavailable. A recorded zero means no events were retained for that metric on that date. Registration counts do not identify which traffic requests led to an account.</p></section>
    </>}
  </section>;
}
