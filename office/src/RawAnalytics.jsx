import { useMemo, useState } from 'react';
import { compareStoredActivity } from './analytics-model.mjs';

const number = new Intl.NumberFormat();
const delta = new Intl.NumberFormat(undefined, { signDisplay: 'exceptZero' });
const display = value => value === null ? '—' : number.format(value);

function Counts({ row }) {
  return <><td>{display(row.raw)}</td><td>{display(row.analytics)}</td>
    <td className={row.differentDays || row.raw !== row.analytics ? 'analytics-count-mismatch' : undefined}>
      {row.difference === null ? '—' : delta.format(row.difference)}
      {'differentDays' in row && <small>{row.differentDays ? `${row.differentDays} ${row.differentDays === 1 ? 'day differs' : 'days differ'}` : row.raw === null ? 'No data' : 'Match'}</small>}
    </td></>;
}

export default function RawAnalytics({ report, start, end }) {
  const [metric, setMetric] = useState('webOpens');
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const comparison = useMemo(() => compareStoredActivity(report, { start, end }), [report, start, end]);
  const selected = comparison?.find(row => row.key === metric);
  const daily = selected?.daily.filter(row => !onlyDifferences || row.raw !== row.analytics).reverse();
  const checkedAt = report.rawData?.checkedAt;

  return <section className="office-analytics-card" aria-labelledby="analytics-raw-heading">
    <h2 id="analytics-raw-heading">Raw data comparison</h2>
    <p>Stored activity counts and the totals shown in Office Analytics for {start} through {end} UTC.</p>
    {checkedAt && <p className="office-analytics-meta">Database snapshot <time dateTime={checkedAt}>{new Date(checkedAt).toLocaleString()}</time></p>}
    {comparison ? <>
      <div className="office-analytics-table-wrap analytics-raw-table" tabIndex={0} role="region" aria-label="Raw data totals">
        <table><thead><tr><th scope="col">Activity</th><th scope="col">Raw data</th><th scope="col">Office Analytics</th><th scope="col">Difference</th></tr></thead>
          <tbody>{comparison.map(row => <tr key={row.key}><th scope="row">{row.label}</th><Counts row={row} /></tr>)}</tbody>
        </table>
      </div>
      <p className="office-analytics-meta">Difference is Office Analytics minus raw data. A dash marks a missing count or different date coverage.</p>
      <details>
        <summary>Compare by day</summary>
        <div className="office-analytics-section-heading analytics-raw-filters">
          <label>Activity<select value={metric} onChange={event => setMetric(event.target.value)}>{comparison.map(row => <option key={row.key} value={row.key}>{row.label}</option>)}</select></label>
          <label className="analytics-raw-checkbox"><input type="checkbox" checked={onlyDifferences} onChange={event => setOnlyDifferences(event.target.checked)} />Show only differences</label>
        </div>
        {daily.length ? <div className="office-analytics-table-wrap office-analytics-geography-table analytics-raw-table" tabIndex={0} role="region" aria-label="Daily raw data comparison">
          <table><thead><tr><th scope="col">Date (UTC)</th><th scope="col">Raw data</th><th scope="col">Office Analytics</th><th scope="col">Difference</th></tr></thead>
            <tbody>{daily.map(row => <tr key={row.day}><th scope="row">{row.day}</th><Counts row={row} /></tr>)}</tbody>
          </table>
        </div> : <p>{selected.raw === null && selected.analytics === null ? 'No retained counts for this activity in the selected period.' : 'No daily differences for this activity in the selected period.'}</p>}
      </details>
    </> : <p role="status">Raw data is temporarily unavailable.</p>}
  </section>;
}
