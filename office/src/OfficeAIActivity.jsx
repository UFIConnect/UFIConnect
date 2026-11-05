import { useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { createVisibleOfficePoller } from './office-polling.mjs';

const dateLabel = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : '';
const listStyle = { gridAutoFlow: 'row', gridTemplateColumns: 'minmax(0, 1fr)' };
const LABELS = {
  'new-failure-class': 'First recorded failure for an action',
  'execution-failure': 'Execution failed',
  'unconfirmed-outcome': 'Execution outcome needs verification',
  'destination-mismatch': 'Executed action outside its destination',
  'activity-burst': 'Increased activity',
  'new-action': 'New recorded action',
  'new-destination': 'New recorded destination',
};

function Observation({ finding, historical = false }) {
  const observedAt = finding.observedAt || finding.createdAt || finding.at;
  const originalReference = finding.eventReferenceId || finding.evidence?.referenceId;
  return <article className="office-ai-memory-entry">
    <header><strong>{historical ? finding.state === 'resolved' ? 'Resolved' : 'Historical' : finding.severity === 'info' ? 'Observation' : finding.severity === 'critical' ? 'Critical' : 'Review'} · {historical && finding.rule === 'destination-mismatch' ? 'Earlier destination mismatch observation' : LABELS[finding.rule] || finding.rule || 'Recorded activity'}</strong>
      {dateLabel(observedAt) && <time dateTime={observedAt}>{dateLabel(observedAt)}</time>}</header>
    <p>{finding.reason || finding.content || finding.detail}</p>
    {originalReference && <small>Execution record: {originalReference}</small>}
    {finding.referenceId && finding.referenceId !== originalReference && <small>Observation record: {finding.referenceId}</small>}
    {finding.evidence && <details><summary>Evidence</summary><pre>{typeof finding.evidence === 'string' ? finding.evidence : JSON.stringify(finding.evidence, null, 2)}</pre></details>}
  </article>;
}

export default function OfficeAIActivity({ apiBase, request }) {
  const [report, setReport] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    let active = true, pending;
    const current = ++generation.current;
    const valid = () => active && current === generation.current;
    async function check({ signal }) {
      const controller = new AbortController(); pending = controller; setBusy(true);
      const abort = () => controller.abort();
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
      const deadline = setTimeout(() => controller.abort(), 25000);
      try {
        const response = await request(`${apiBase}/office/ai/activity`, { signal: controller.signal });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.status === 'unavailable') throw Error(typeof data.error === 'string' ? data.error : 'Activity monitoring is unavailable. Refresh to retry.');
        if (valid() && !signal.aborted) { setReport(data); setError(''); }
      } catch (cause) {
        if (valid() && !signal.aborted) { setReport(null); setError(cause.name === 'AbortError' ? 'The activity check timed out. Refresh to retry.' : cause.message); }
      } finally { clearTimeout(deadline); signal.removeEventListener('abort', abort); if (valid()) setBusy(false); }
    }
    const poller = createVisibleOfficePoller({ task: check, intervalMs: 60000 });
    const reset = () => { generation.current++; pending?.abort(); setReport(null); setError(''); setRevision(value => value + 1); };
    window.addEventListener('office-token-changed', reset);
    return () => { active = false; generation.current++; poller.stop(); pending?.abort(); window.removeEventListener('office-token-changed', reset); };
  }, [apiBase, request, revision]);
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const alerts = findings.filter(finding => finding.severity !== 'info');
  const observations = findings.filter(finding => finding.severity === 'info');
  const history = Array.isArray(report?.history) ? report.history : [];
  const incomplete = report?.coverage?.baselineSufficient === false;
  const truncated = report?.coverage?.findingsTruncated === true;
  return <section className="office-ai-memory" aria-label="Pip activity monitoring">
    <div className="office-ai-section-heading"><div><h2><ShieldAlert size={20} /> Recorded activity</h2><p>Current alerts cover the last five minutes. Execution failures and destination checks include their recorded evidence.</p></div>
      <button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} />Check activity</button></div>
    <p className="office-ai-form-note">Monitoring covers Pip and its connected execution tools. Storage and runtime health are reported in the Office service overview.</p>
    {error && <p className="office-ai-error" role="alert">{error}</p>}
    {busy && <p role="status">Checking recorded activity…</p>}
    {report && <p className="office-ai-form-note">Last checked {dateLabel(report.checkedAt)} · {report.baselineCount || 0} execution records examined · {report.scope || 'Office recorded activity'}</p>}
    {report?.coverage?.note && <p className="office-ai-form-note">{report.coverage.note}</p>}
    {incomplete && <p className="office-ai-form-note" role="status">The available baseline is insufficient for a reliable comparison of activity volume or new patterns. Recorded execution failures and destination checks remain visible.</p>}
    {truncated && <p className="office-ai-error" role="status">Some detected observations could not be returned. Review the execution records and check activity again. This check cannot establish that there are no current alerts.</p>}
    <div className="office-ai-memory-list" style={listStyle}>{alerts.map((finding, index) => <Observation key={finding.id || `${finding.eventId}:${finding.rule}:${index}`} finding={finding} />)}</div>
    {report && !alerts.length && !busy && <div className="office-ai-empty"><ShieldAlert size={28} /><h3>{truncated || incomplete ? 'Activity check is limited' : 'No current activity alerts'}</h3><p>{truncated ? 'Some detected observations are unavailable. Review the execution records before drawing a conclusion.' : incomplete ? 'Only the available execution evidence was checked. More history is needed for baseline comparisons.' : 'No current alerts in the records checked. Monitoring continues as new activity is recorded.'}</p></div>}
    {observations.length > 0 && <details><summary>Recent observations ({observations.length})</summary><p className="office-ai-form-note">New actions, destinations and increased activity can occur during ordinary work. These observations describe recorded patterns.</p><div className="office-ai-memory-list" style={listStyle}>{observations.map((finding, index) => <Observation key={finding.id || `${finding.eventId}:${finding.rule}:${index}`} finding={finding} />)}</div></details>}
    {history.length > 0 && <details><summary>Earlier observations ({history.length})</summary><p className="office-ai-form-note">These records preserve earlier evidence. Their timestamps show when the activity occurred.</p><div className="office-ai-memory-list" style={listStyle}>{history.map((finding, index) => <Observation key={finding.id || `${finding.eventId}:${finding.rule}:${index}`} finding={finding} historical />)}</div></details>}
  </section>;
}
