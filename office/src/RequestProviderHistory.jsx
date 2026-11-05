import { useMemo } from 'react';
import { selectRequestDays } from './analytics-comparison-model.mjs';

const number = value => value === null || value === undefined ? 'Unavailable' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
export default function RequestProviderHistory({ report, start, end, role = 'all', invalidDates = false }) {
  const selected = useMemo(() => selectRequestDays(report, { start, end, role }), [report, start, end, role]);
  return <section className="office-analytics-card" aria-labelledby="provider-request-history-heading">
    <h3 id="provider-request-history-heading">Retained platform HTTP history</h3>
    <p>{report?.definition || 'HTTP totals recorded by Render. Their network scope differs from the classified request counters above.'} These observations overlap other request measurements and are shown separately.</p>
    {report?.available !== true ? <p>Platform HTTP history is unavailable for this report.</p> : <>
      <p className="office-analytics-meta">{report.coverage?.firstRecordedDay ? `Retained platform records begin ${report.coverage.firstRecordedDay}. ` : ''}The selected dates and service apply here. Missing dates remain unavailable.</p>
      {!invalidDates && <>
        <dl className="office-analytics-metrics">
          <div><dt>Platform HTTP requests</dt><dd>{number(selected.totals.requests)}</dd></div>
          <div><dt>Platform 5xx responses</dt><dd>{number(selected.totals.errors)}</dd></div>
          <div><dt>Platform 4xx responses</dt><dd>{number(selected.totals.clientErrors)}</dd></div>
        </dl>
        <div className="office-analytics-table-wrap analytics-comparison-table" tabIndex={0} role="region" aria-label="Daily platform HTTP requests table">
          <table><thead><tr><th scope="col">Day (UTC)</th><th scope="col">Requests</th><th scope="col">5xx responses</th><th scope="col">4xx responses</th></tr></thead>
            <tbody>{selected.daily.slice().reverse().map(row => <tr key={row.period}><th scope="row">{row.period}</th>{['requests', 'errors', 'clientErrors'].map(key => <td key={key}>{number(row[key])}</td>)}</tr>)}</tbody>
          </table>
        </div>
        {!selected.daily.length && <p>No retained platform HTTP observations for this selection.</p>}
      </>}
      {report.coverage?.note && <p className="office-analytics-meta">{report.coverage.note}</p>}
    </>}
  </section>;
}
