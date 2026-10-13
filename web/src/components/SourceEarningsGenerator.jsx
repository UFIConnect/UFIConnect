import { useMemo, useState } from 'react';
import { downloadText } from '../local/localWorkspace';
import { addEarningsEntry, earningsCsv, earningsCurrencies, generateEarningsReport, providerEarningsRecords, validateEarningsEntry } from '../analytics/sourceEarnings.mjs';
import './SourceEarningsGenerator.css';

const emptyEntry = { source: '', creatorAccount: '', amount: '', currency: 'USD', startDate: '', endDate: '', reference: '' };
const provenance = row => row.provenance === 'provider_estimate' ? 'Provider estimate' : 'Entered by you · unverified';
export default function SourceEarningsGenerator({ sources = [] }) {
  const [draft, setDraft] = useState(emptyEntry);
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const report = useMemo(() => generateEarningsReport(sources, entries.filter(row => sources.some(source => source.id === row.source))), [sources, entries]);
  const label = id => sources.find(source => source.id === id)?.label || id;
  const change = event => setDraft(value => ({ ...value, [event.target.name]: event.target.value }));
  function add(event) {
    event.preventDefault(); setError(''); setNotice('');
    try {
      const row = validateEarningsEntry(draft, sources.map(source => source.id));
      addEarningsEntry([...providerEarningsRecords(sources), ...entries], row);
      setEntries(value => addEarningsEntry(value, row));
      setDraft(value => ({ ...value, amount: '', reference: '' }));
      setNotice('Statement added to this report. Export to keep a copy.');
    } catch (failure) { setError(failure.message); }
  }
  function exportReport(format) {
    setError(''); setNotice('');
    try {
      // Export exactly the current preview, including its source selection and
      // overlap exclusions, if the provider report changes during this view.
      downloadText(`ufi-source-earnings-${report.generatedAt.slice(0, 10)}.${format}`,
        format === 'csv' ? earningsCsv(report) : JSON.stringify(report, null, 2), format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json');
      setNotice('Report prepared for download. It is not a payment instruction.');
    } catch (failure) { setError(failure.message); }
  }
  return <section className="creator-analytics-card source-earnings-generator" aria-labelledby="source-earnings-generator-title">
    <header><div><h3 id="source-earnings-generator-title">Source earnings report generator</h3><p className="creator-analytics-muted">Keep each reported amount with its original source, creator account, currency, and dates.</p></div></header>
    <p className="creator-analytics-caption">Connected provider estimates appear automatically when authorized and available. You can enter statements for accounts you manage. Entries stay in this view until you leave; export a copy to keep them.</p>
    <details><summary>Add a source statement</summary><form onSubmit={add} className="source-earnings-form">
      <label>Original source<select name="source" value={draft.source} onChange={change} required><option value="">Choose a source</option>{sources.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}</select></label>
      <label>Creator account URL<input name="creatorAccount" type="url" value={draft.creatorAccount} onChange={change} maxLength={2048} placeholder="https://" required /></label>
      <label>Reported earnings<input name="amount" inputMode="decimal" value={draft.amount} onChange={change} maxLength={19} placeholder="0.00" required /></label>
      <label>Currency<select name="currency" value={draft.currency} onChange={change}>{earningsCurrencies.map(currency => <option key={currency}>{currency}</option>)}</select></label>
      <label>Period start<input name="startDate" type="date" value={draft.startDate} onChange={change} max={new Date().toISOString().slice(0, 10)} required /></label>
      <label>Period end<input name="endDate" type="date" value={draft.endDate} onChange={change} min={draft.startDate || undefined} max={new Date().toISOString().slice(0, 10)} required /></label>
      <label className="source-earnings-reference">Statement reference<input name="reference" value={draft.reference} onChange={change} maxLength={160} placeholder="Statement ID or report name" required /></label>
      <p className="creator-analytics-caption source-earnings-reference">Enter the creator earnings shown on the statement. Do not estimate a platform share or convert views into money. Manually entered amounts remain unverified.</p>
      <button className="btn btn-primary" type="submit" disabled={!sources.length}>Add statement</button>
    </form></details>
    {error && <p role="alert" className="creator-analytics-message is-error">{error}</p>}
    {notice && <p role="status" className="creator-analytics-message">{notice}</p>}
    {report.excluded.length > 0 && <p role="status" className="creator-analytics-caption">{report.excluded.length} overlapping statement(s) excluded. The connected provider report takes precedence.</p>}
    {report.totals.length > 0 ? <div className="creator-analytics-table-wrap" role="region" aria-label="Earnings by source and creator" tabIndex={0}><table><caption>Reported earnings by source and creator account</caption><thead><tr><th scope="col">Source / creator</th><th scope="col">Reported amount</th><th scope="col">Report status</th></tr></thead><tbody>{report.totals.map(row => <tr key={JSON.stringify([row.source, row.creatorAccount, row.currency, row.provenance])}><th scope="row">{label(row.source)}<small>{row.creatorAccount}</small></th><td>{row.currency} {row.amount}</td><td>{provenance(row)}</td></tr>)}</tbody></table></div> : <p className="creator-analytics-muted">No earnings have been reported for this selection. Unavailable earnings are not treated as zero.</p>}
    {entries.length > 0 && <details><summary>Review entered statements ({entries.length})</summary><ul className="source-earnings-entries">{entries.map((row, index) => <li key={`${row.source}:${row.creatorAccount}:${row.currency}:${row.startDate}:${row.endDate}`}><span>{label(row.source)} · {row.startDate}–{row.endDate} · {row.currency} {row.amount}<small>{row.reference} · {row.creatorAccount}</small></span><button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove statement ${row.reference}`} onClick={() => { setEntries(value => value.filter((_, i) => i !== index)); setError(''); setNotice('Statement removed.'); }}>Remove</button></li>)}</ul></details>}
    <div className="creator-analytics-inline-actions"><button type="button" className="btn btn-ghost btn-sm" disabled={!report.records.length} onClick={() => exportReport('json')}>Export report JSON</button><button type="button" className="btn btn-ghost btn-sm" disabled={!report.records.length} onClick={() => exportReport('csv')}>Export statements CSV</button></div>
    <p className="creator-analytics-caption">These are account reports, not earnings caused by playback in UFI. Provider revenue shares and payout balances are unavailable. The source handles eligibility, advertising and payouts under its terms. This report does not send money.</p>
  </section>;
}
