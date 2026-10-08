import { useCallback, useEffect, useRef, useState } from 'react';
import './reports.css';

const reasons = { child_safety: 'Child safety', copyright: 'Copyright / intellectual property', nonconsensual_intimate: 'Non-consensual intimate imagery', harassment: 'Harassment', spam: 'Spam or scam', inappropriate: 'Inappropriate content', impersonation: 'Impersonation', other: 'Other' };
const date = value => value ? new Date(value).toLocaleString() : '—';
const actionNames = { review: 'Review decision', remove_uficonnect: 'Removed from UFIConnect', source_handoff: 'Source reporting prepared', support_handoff: 'Support draft prepared' };
const actionTitles = { remove_uficonnect: 'Remove from UFIConnect', source_handoff: 'Report on source', support_handoff: 'Contact support' };
function safeLink(value, support = false) {
  if (typeof value !== 'string') return null;
  if (support) return value.startsWith('mailto:support@uficonnect.org?') ? value : null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

export default function Reports({ apiBase, request }) {
  const [status, setStatus] = useState('open'), [revision, setRevision] = useState(0);
  const [reports, setReports] = useState([]), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [selected, setSelected] = useState(null), [history, setHistory] = useState([]), [note, setNote] = useState('');
  const [historyBusy, setHistoryBusy] = useState(false), [saving, setSaving] = useState(false);
  const [choices, setChoices] = useState(null), [actionKind, setActionKind] = useState(null), [actionNote, setActionNote] = useState('');
  const [actionResult, setActionResult] = useState(null), [notice, setNotice] = useState('');
  const generation = useRef(0), historyGeneration = useRef(0);
  const actionKey = useRef(null), confirmation = useRef(null), opener = useRef(null);
  const refresh = useCallback(() => { generation.current++; historyGeneration.current++; setReports([]); setSelected(null); setHistory([]); setChoices(null); setActionKind(null); setActionResult(null); setNote(''); setSaving(false); setRevision(value => value + 1); }, []);
  useEffect(() => { if (actionKind) confirmation.current?.focus(); }, [actionKind]);
  useEffect(() => {
    window.addEventListener('office-token-changed', refresh);
    return () => { generation.current++; historyGeneration.current++; window.removeEventListener('office-token-changed', refresh); };
  }, [refresh]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const current = ++generation.current;
    setBusy(true); setError(''); setReports([]); setSelected(null); setHistory([]); setChoices(null); setActionKind(null); setActionResult(null); setNote('');
    request(`${apiBase}/office/reports?status=${status}`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.reports)) throw new Error(data.message || 'Reports could not be loaded. Check Office access and try again.');
      if (active && generation.current === current) setReports(data.reports);
    }).catch(error => { if (active && generation.current === current) setError(error.message); })
      .finally(() => { if (active && generation.current === current) setBusy(false); });
    return () => { active = false; controller.abort(); };
  }, [apiBase, request, status, revision]);

  async function select(report, preserveResult = false) {
    const current = ++historyGeneration.current;
    setSelected(report); setNote(''); setHistory([]); setChoices(null); setHistoryBusy(true); setError('');
    if (!preserveResult) { setActionResult(null); setNotice(''); }
    try {
      const [data, actions] = await Promise.all(['history', 'actions'].map(async endpoint => {
        const response = await request(`${apiBase}/office/reports/${encodeURIComponent(report.id)}/${endpoint}`, { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Report details could not be loaded.');
        return data;
      }));
      if (!Array.isArray(data.events) || !actions.removal || !actions.support) throw new Error('Report details could not be loaded.');
      if (historyGeneration.current === current) { setHistory(data.events); setChoices(actions); }
    } catch (error) { if (historyGeneration.current === current) setError(error.message); }
    finally { if (historyGeneration.current === current) setHistoryBusy(false); }
  }
  function beginAction(kind, event) {
    opener.current = event.currentTarget;
    actionKey.current = crypto.randomUUID();
    setActionNote(''); setActionKind(kind); setError('');
  }
  function closeAction() {
    if (saving) return;
    setActionKind(null);
    opener.current?.focus();
  }
  async function performAction(event) {
    event.preventDefault();
    if (!selected || !actionKind || saving || actionNote.trim().length < 5) return;
    const current = generation.current, report = selected, kind = actionKind;
    setSaving(true); setError('');
    try {
      const response = await request(`${apiBase}/office/reports/${encodeURIComponent(report.id)}/actions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: kind, note: actionNote, confirmed: true, idempotencyKey: actionKey.current }),
      });
      const data = await response.json();
      if (!response.ok || data.ok !== true) throw new Error(data.message || 'The action could not be confirmed. Retry with the same note.');
      if (generation.current !== current) return;
      setActionKind(null); setNotice(data.message);
      if (kind === 'remove_uficonnect') refresh();
      else { setActionResult(data); await select(report, true); opener.current?.focus(); }
    } catch (error) { if (generation.current === current) setError(error.message); }
    finally { if (generation.current === current) setSaving(false); }
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
    <p>Review reports, remove verified content from UFIConnect, and prepare source reports or support requests. Record the basis for each action in its audit history.</p>
    <div className="office-report-tools"><label htmlFor="office-reports-queue">Queue</label><select id="office-reports-queue" value={status} onChange={event => { historyGeneration.current++; setStatus(event.target.value); }} disabled={saving}><option value="open">Open</option><option value="resolved">Resolved</option></select><button type="button" onClick={refresh} disabled={busy || saving}>Refresh</button></div>
    {error && <p className="office-report-error" role="alert">{error}</p>}
    {notice && <p className="office-report-notice" role="status">{notice}</p>}
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
        <h3>Actions</h3>
        {historyBusy ? <p role="status">Checking stored target…</p> : choices && <>
          <p>{choices.removal.explanation}</p>
          <div className="office-report-actions">
            {choices.account?.available && /^\?account=[a-f0-9-]+#analytics$/i.test(choices.account.url) && <a className="office-report-account" href={choices.account.url}>Manage reported account</a>}
            <button type="button" className="office-report-remove" disabled={saving || !choices.removal.available} onClick={event => beginAction('remove_uficonnect', event)}>Remove from UFIConnect</button>
            <button type="button" disabled={saving || !safeLink(choices.source?.url)} onClick={event => beginAction('source_handoff', event)}>Report on source</button>
            <button type="button" disabled={saving} onClick={event => beginAction('support_handoff', event)}>Contact support</button>
          </div>
          {choices.source?.url ? <p>Verified original: <a href={safeLink(choices.source.url)} target="_blank" rel="noopener noreferrer">{choices.source.label}</a>. Use the source reporting controls to submit the report. <a href={safeLink(choices.source.helpUrl)} target="_blank" rel="noopener noreferrer">Reporting instructions</a>.</p> : <p>{choices.source?.explanation}</p>}
        </>}
        {actionResult?.handoff && safeLink(actionResult.handoff.url, actionResult.action === 'support_handoff') && <div className="office-report-handoff" role="status">
          <p>{actionResult.message}</p>
          <a href={safeLink(actionResult.handoff.url, actionResult.action === 'support_handoff')} target={actionResult.action === 'support_handoff' ? undefined : '_blank'} rel="noopener noreferrer">{actionResult.action === 'support_handoff' ? 'Open support email draft' : `Open ${actionResult.handoff.label} to report`}</a>
          <p>Submission status: awaiting your submission.</p>
        </div>}
        <p>Keep private report details within the review team. Follow the <a href="https://uficonnect.org/copyright" target="_blank" rel="noopener noreferrer">copyright procedure</a> for formal notices and counter-notices. Check evidence and applicable obligations before taking separate enforcement action.</p>
        <form onSubmit={review}><label htmlFor="office-report-note">Review note</label><textarea id="office-report-note" required minLength={5} maxLength={2000} rows={4} value={note} disabled={saving} onChange={event => setNote(event.target.value)} /><p>Record the review basis and any separate action reference. Access uses a shared Office credential, so history identifies the reviewer as “office”.</p><button disabled={saving || note.trim().length < 5}>{saving ? 'Saving…' : selected.status === 'open' ? 'Record review and resolve' : 'Record review and reopen'}</button></form>
        <h3>Review history</h3>{historyBusy ? <p role="status">Loading history…</p> : history.length ? <ol>{history.map(entry => <li key={entry.id}><strong>{entry.previousStatus} → {entry.status}</strong><span> · {actionNames[entry.action] || 'Review decision'} · {entry.actor} · {date(entry.createdAt)}</span><p className="office-report-text">{entry.note}</p>{entry.outcome?.handoff && <p>Awaiting manual submission on the destination.</p>}</li>)}</ol> : <p>No recorded review decisions.</p>}
      </article>}
    </div>
    {actionKind && <div className="office-report-dialog-backdrop"><div className="office-report-dialog" role="dialog" aria-modal="true" aria-labelledby="office-report-action-title" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); closeAction(); }
      if (event.key === 'Tab') {
        const fields = [...event.currentTarget.querySelectorAll('textarea,button')].filter(field => !field.disabled);
        const first = fields[0], last = fields[fields.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <h2 id="office-report-action-title">{actionTitles[actionKind]}</h2>
      {error && <p className="office-report-error" role="alert">{error}</p>}
      <p>{actionKind === 'remove_uficonnect' ? choices?.removal.explanation : actionKind === 'source_handoff' ? 'Prepare a link to the verified original and record this handoff. Submit the report using the source controls.' : 'Prepare an email draft addressed to support@uficonnect.org with this report reference. Review and send the message from your email application.'}</p>
      {actionKind === 'remove_uficonnect' && choices?.removal.kind === 'native_post' && <p>The post and its UFIConnect comments will be deleted.</p>}
      <form onSubmit={performAction}><label htmlFor="office-report-action-note">Action note</label><textarea ref={confirmation} id="office-report-action-note" required minLength={5} maxLength={2000} rows={4} value={actionNote} disabled={saving} onChange={event => setActionNote(event.target.value)} />
        <div className="office-report-actions"><button type="button" disabled={saving} onClick={closeAction}>Cancel</button><button disabled={saving || actionNote.trim().length < 5}>{saving ? 'Saving action…' : actionKind === 'remove_uficonnect' ? 'Confirm removal' : 'Prepare handoff'}</button></div>
      </form>
    </div></div>}
  </section>;
}
