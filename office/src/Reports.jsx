import { useCallback, useEffect, useRef, useState } from 'react';
import './reports.css';

const reasons = { child_safety: 'Child safety', copyright: 'Copyright / intellectual property', nonconsensual_intimate: 'Non-consensual intimate imagery', harassment: 'Harassment', spam: 'Spam or scam', inappropriate: 'Inappropriate content', impersonation: 'Impersonation', other: 'Other' };
const date = value => value ? new Date(value).toLocaleString() : '—';

export default function Reports({ apiBase, request }) {
  const [status, setStatus] = useState('open'), [revision, setRevision] = useState(0);
  const [reports, setReports] = useState([]), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [selected, setSelected] = useState(null), [history, setHistory] = useState([]), [note, setNote] = useState('');
  const [historyBusy, setHistoryBusy] = useState(false), [saving, setSaving] = useState(false);
  const generation = useRef(0), historyGeneration = useRef(0);
  const refresh = useCallback(() => { generation.current++; historyGeneration.current++; setReports([]); setSelected(null); setHistory([]); setNote(''); setSaving(false); setRevision(value => value + 1); }, []);
  useEffect(() => {
    window.addEventListener('office-token-changed', refresh);
    return () => { generation.current++; historyGeneration.current++; window.removeEventListener('office-token-changed', refresh); };
  }, [refresh]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const current = ++generation.current;
    setBusy(true); setError(''); setReports([]); setSelected(null); setHistory([]); setNote('');
    request(`${apiBase}/office/reports?status=${status}`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.reports)) throw new Error(data.message || 'Reports could not be loaded. Check Office access and try again.');
      if (active && generation.current === current) setReports(data.reports);
    }).catch(error => { if (active && generation.current === current) setError(error.message); })
      .finally(() => { if (active && generation.current === current) setBusy(false); });
    return () => { active = false; controller.abort(); };
  }, [apiBase, request, status, revision]);

  async function select(report) {
    const current = ++historyGeneration.current;
    setSelected(report); setNote(''); setHistory([]); setHistoryBusy(true); setError('');
    try {
      const response = await request(`${apiBase}/office/reports/${encodeURIComponent(report.id)}/history`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.events)) throw new Error(data.message || 'Review history could not be loaded.');
      if (historyGeneration.current === current) setHistory(data.events);
    } catch (error) { if (historyGeneration.current === current) setError(error.message); }
    finally { if (historyGeneration.current === current) setHistoryBusy(false); }
  }
  async function review(event) {
    event.preventDefault();
    if (!selected || saving) return;
    const current = generation.current;
    setSaving(true); setError('');
    try {
      const response = await request(`${apiBase}/office/reports/${encodeURIComponent(selected.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: selected.status === 'open' ? 'resolved' : 'open', note }),
      });
      const data = await response.json();
      if (!response.ok || data.ok !== true) throw new Error(data.message || 'Review was not saved.');
      if (generation.current === current) refresh();
    } catch (error) { if (generation.current === current) setError(error.message); }
    finally { if (generation.current === current) setSaving(false); }
  }

  return <section className="office-reports">
    <h1>Reports</h1>
    <p>Review reports submitted to UFIConnect. A report is an allegation. Resolving it records a decision; it does not remove content, suspend an account, or send a source takedown.</p>
    <div className="office-report-tools"><label htmlFor="office-reports-queue">Queue</label><select id="office-reports-queue" value={status} onChange={event => { historyGeneration.current++; setStatus(event.target.value); }} disabled={saving}><option value="open">Open</option><option value="resolved">Resolved</option></select><button type="button" onClick={refresh} disabled={busy || saving}>Refresh</button></div>
    {error && <p className="office-report-error" role="alert">{error}</p>}
    {busy ? <p role="status">Loading reports…</p> : <p>{reports.length} {status} reports shown (up to 200). Child safety concerns appear first.</p>}
    <div className="office-report-layout">
      <div className="office-report-list" aria-label="Report queue">{reports.map(report => <button key={report.id} type="button" disabled={saving} aria-pressed={selected?.id === report.id} onClick={() => select(report)}>
        <strong>{reasons[report.reason] || report.reason}</strong><span>{report.targetType}: {report.targetId}</span><small>{date(report.createdAt)}</small>
      </button>)}{!busy && !reports.length && <p>No reports in this queue.</p>}</div>
      {selected && <article className="office-report-detail" aria-label="Selected report">
        <h2>{reasons[selected.reason] || selected.reason}</h2>
        <dl><dt>Reference</dt><dd>{selected.id}</dd><dt>Reporter account</dt><dd>{selected.reporterId}</dd><dt>Reported target</dt><dd>{selected.targetType}: {selected.targetId}</dd><dt>Created</dt><dd>{date(selected.createdAt)}</dd></dl>
        {selected.source && <p>Reported source: {selected.source}</p>}
        {selected.sourceUrl && <p className="office-report-url">Original URL supplied by reporter: {selected.sourceUrl}</p>}
        <h3>Report details</h3><p className="office-report-text">{selected.details || 'No details supplied.'}</p>
        <p>Keep private report details within the review team. Follow the <a href="https://uficonnect.org/copyright" target="_blank" rel="noopener noreferrer">copyright procedure</a> for formal notices and counter-notices. Check evidence and applicable obligations before taking separate enforcement action.</p>
        <form onSubmit={review}><label htmlFor="office-report-note">Review note</label><textarea id="office-report-note" required minLength={5} maxLength={2000} rows={4} value={note} disabled={saving} onChange={event => setNote(event.target.value)} /><p>Record the review basis and any separate action reference. Access uses a shared Office credential, so history identifies the reviewer as “office”.</p><button disabled={saving || note.trim().length < 5}>{saving ? 'Saving…' : selected.status === 'open' ? 'Record review and resolve' : 'Record review and reopen'}</button></form>
        <h3>Review history</h3>{historyBusy ? <p role="status">Loading history…</p> : history.length ? <ol>{history.map(entry => <li key={entry.id}><strong>{entry.previousStatus} → {entry.status}</strong><span> · {entry.actor} · {date(entry.createdAt)}</span><p className="office-report-text">{entry.note}</p></li>)}</ol> : <p>No recorded review decisions.</p>}
      </article>}
    </div>
  </section>;
}
