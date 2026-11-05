import { useSyncExternalStore } from 'react';

const EMPTY = { scope: 'This Office session', startedAt: null, rows: [] };
const emptyRead = () => EMPTY;
const noSubscription = () => () => {};
const number = value => Number.isFinite(value) ? value.toLocaleString() : 'Unknown';
const bytes = value => value >= 1048576 ? `${(value / 1048576).toFixed(2)} MB` : value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${value} B`;

export default function OfficeRequestDiagnostics({ request }) {
  const report = useSyncExternalStore(request?.subscribeDiagnostics || noSubscription, request?.getDiagnostics || emptyRead, emptyRead);
  const rows = [...report.rows].sort((left, right) => right.networkRequests - left.networkRequests || left.family.localeCompare(right.family));
  const total = key => rows.reduce((sum, row) => sum + (row[key] || 0), 0);
  return <section aria-label="This Office session requests" className="office-request-diagnostics">
    <h2>This Office session</h2>
    <p>Office API requests, including live streams, observed in this window since {report.startedAt ? new Date(report.startedAt).toLocaleString() : 'the current sign-in'}. Static assets and local website previews are outside this session report; the server and traffic reports have their own coverage.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, margin: '16px 0' }}>
      <span><strong>{number(total('networkRequests'))}</strong> network requests</span>
      <span><strong>{number(total('cacheHits'))}</strong> reads from memory</span>
      <span><strong>{number(total('coalesced'))}</strong> shared reads</span>
      <span><strong>{number(total('failures'))}</strong> failed requests</span>
      <span><strong>{number(total('cancelled'))}</strong> cancelled reads</span>
    </div>
    <p style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.6 }}>Response time measures arrival of response headers. Known sizes use the Content-Length header when available; missing sizes remain unknown. Counts include authentication responses. Measurements contain fixed request families and service labels, and stay in memory until the sign-in changes or this window closes. Live polling pauses when the page is hidden.</p>
    {!rows.length ? <p role="status">No requests have been observed in this session.</p> : <div style={{ overflowX: 'auto', maxWidth: '100%' }} tabIndex="0" aria-label="Request measurements table">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
        <thead><tr>{['Service', 'Request family', 'Method', 'Network', 'Memory', 'Shared', 'Latest status', 'Average time', 'Latest time', 'Known sizes'].map(label => <th scope="col" key={label} style={{ padding: '10px 8px', color: '#94a3b8', whiteSpace: 'nowrap' }}>{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={`${row.service}:${row.family}:${row.method}`}>
          {[row.service, row.family, row.method, number(row.networkRequests), number(row.cacheHits), number(row.coalesced),
            row.lastStatus ?? (row.inFlight ? 'Pending' : 'Unknown'), row.averageDurationMs == null ? 'Unknown' : `${row.averageDurationMs} ms`,
            row.lastDurationMs == null ? 'Unknown' : `${row.lastDurationMs} ms`, row.measuredResponses ? `${bytes(row.knownResponseBytes)} (${row.measuredResponses} responses)` : 'Unknown'].map((value, index) => <td key={index} style={{ padding: '10px 8px', borderTop: '1px solid rgba(255,255,255,.08)', whiteSpace: 'nowrap' }}>{value}</td>)}
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
