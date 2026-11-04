import { useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
const dateLabel = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : '';

export default function OfficeAIActivity({ apiBase, request }) {
  const [report, setReport] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    let active = true, pending, timer;
    const current = ++generation.current;
    const valid = () => active && current === generation.current;
    async function check() {
      const controller = new AbortController(); pending = controller; setBusy(true);
      const deadline = setTimeout(() => controller.abort(), 25000);
      try {
        const response = await request(`${apiBase}/office/ai/activity`, { signal: controller.signal });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw Error(typeof data.error === 'string' ? data.error : 'Activity monitoring is unavailable. Refresh to retry.');
        if (valid()) { setReport(data); setError(''); }
      } catch (cause) { if (valid()) setError(cause.name === 'AbortError' ? 'The activity check timed out. Refresh to retry.' : cause.message); }
      finally { clearTimeout(deadline); if (valid()) { setBusy(false); timer = setTimeout(check, 60000); } }
    }
    check();
    const reset = () => { generation.current++; pending?.abort(); setReport(null); setError(''); setRevision(value => value + 1); };
    window.addEventListener('office-token-changed', reset);
    return () => { active = false; generation.current++; clearTimeout(timer); pending?.abort(); window.removeEventListener('office-token-changed', reset); };
  }, [apiBase, request, revision]);
  return <section className="office-ai-memory" aria-label="Office AI activity monitoring"><div className="office-ai-section-heading"><div><h2><ShieldAlert size={20} /> Unusual activity</h2><p>Checks recorded activity for new actions and destinations, unusual failures, and changes in volume. New patterns can stand out even without a known signature.</p></div><button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} />Check activity</button></div>
    <p className="office-ai-form-note">Monitoring covers activity recorded by Office AI and its connected execution tools. Alerts explain the observation and link it to its original record. A new pattern can be legitimate; findings preserve evidence for review.</p>
    {error && <p className="office-ai-error" role="alert">{error}</p>}{busy && <p role="status">Checking recorded activity…</p>}
    {report && <p className="office-ai-form-note">Last checked {dateLabel(report.checkedAt)} · {report.baselineCount || 0} records examined · {report.scope || 'Office recorded activity'}</p>}
    <div className="office-ai-memory-list">{(report?.findings || []).map((finding, index) => <article className="office-ai-memory-entry" key={finding.id || index}><header><strong>{finding.severity || 'notice'} · {finding.rule || 'Unusual pattern'}</strong><time>{dateLabel(finding.createdAt || finding.at)}</time></header><h3>{finding.title || finding.label || 'Activity worth reviewing'}</h3><p>{finding.reason || finding.content || finding.detail}</p>{finding.referenceId && <small>Original record: {finding.referenceId}</small>}{finding.evidence && <details><summary>Evidence</summary><pre>{typeof finding.evidence === 'string' ? finding.evidence : JSON.stringify(finding.evidence, null, 2)}</pre></details>}</article>)}</div>
    {report && !report.findings?.length && !busy && <div className="office-ai-empty"><ShieldAlert size={28} /><h3>No unusual patterns observed</h3><p>{report.baselineCount ? 'No findings in the records checked. Monitoring continues as new activity is recorded.' : 'Record more discussion and execution history to build a useful baseline.'}</p></div>}
  </section>;
}
