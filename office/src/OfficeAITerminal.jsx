import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Play, RefreshCw, Square } from 'lucide-react';
import { safeOfficeLink } from './OfficeAIContent';
import { officeAIRequest, officeAIError, taskDate, taskState } from './office-ai-client';

const DONE = new Set(['completed', 'failed', 'cancelled', 'timed_out']);
export default function OfficeAITerminal({ apiBase, request }) {
  const [sessions, setSessions] = useState([]), [session, setSession] = useState(null), [capabilities, setCapabilities] = useState(null);
  const [command, setCommand] = useState(''), [ref, setRef] = useState('main'), [timeoutSeconds, setTimeoutSeconds] = useState(120), [output, setOutput] = useState(''), [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0), [observedAt, setObservedAt] = useState(''), [cancelRequested, setCancelRequested] = useState(false);
  const controllers = useRef(new Set()), generation = useRef(0), selected = useRef(null), submission = useRef(null), mutating = useRef(false);
  const api = (suffix = '', options = {}) => officeAIRequest(request, `${apiBase}/office/ai/terminal${suffix}`, options, controllers.current);
  useEffect(() => {
    let stopped = false, timer;
    const current = ++generation.current, valid = () => !stopped && current === generation.current;
    async function refresh() {
      try {
        const data = await api(); if (!valid()) return;
        const list = Array.isArray(data.sessions) ? data.sessions : [];
        setSessions(list); setCapabilities(data.capabilities || {});
        const id = selected.current || list.find(item => !DONE.has(item.status))?.id || list[0]?.id;
        if (id) { selected.current = id; const result = await api(`/${encodeURIComponent(id)}`); if (!valid()) return; setSession(result.session); setOutput(typeof result.output === 'string' ? result.output : ''); setTruncated(!!result.outputTruncated); setCancelRequested(!!result.session?.cancellationRequested && !DONE.has(result.session?.status)); }
        else { setSession(null); setOutput(''); }
        setObservedAt(new Date().toISOString()); setError('');
      } catch (cause) { if (valid()) setError(officeAIError(cause)); }
      finally { if (valid()) { setLoading(false); timer = setTimeout(refresh, 3000); } }
    }
    setLoading(true); refresh();
    const reset = () => { generation.current++; controllers.current.forEach(item => item.abort()); selected.current = null; submission.current = null; mutating.current = false; setSessions([]); setSession(null); setCapabilities(null); setCommand(''); setRef('main'); setOutput(''); setTruncated(false); setBusy(false); setCancelRequested(false); setObservedAt(''); setError(''); setRevision(value => value + 1); };
    window.addEventListener('office-token-changed', reset);
    return () => { stopped = true; generation.current++; clearTimeout(timer); controllers.current.forEach(item => item.abort()); window.removeEventListener('office-token-changed', reset); };
  }, [apiBase, request, revision]);
  async function mutate(suffix, body) {
    if (mutating.current) return;
    const current = generation.current; mutating.current = true; setBusy(true); setError('');
    try {
      const data = await api(suffix, { method: 'POST', body }); if (current !== generation.current) return;
      if (data.session) { selected.current = data.session.id; setSession(data.session); setSessions(previous => [data.session, ...previous.filter(item => item.id !== data.session.id)]); }
      if (!suffix) { setCommand(''); setOutput(''); submission.current = null; setCancelRequested(false); }
      else setCancelRequested(true);
      setRevision(value => value + 1);
    } catch (cause) { if (current === generation.current) setError(officeAIError(cause)); }
    finally { if (current === generation.current) { mutating.current = false; setBusy(false); } }
  }
  function submit(event) {
    event.preventDefault(); const body = { command: command.trim(), ref: ref.trim(), timeoutSeconds: Number(timeoutSeconds) }, signature = JSON.stringify(body);
    if (!body.command || !/^(main|[a-f0-9]{40})$/i.test(body.ref)) return;
    if (!submission.current || submission.current.signature !== signature) submission.current = { signature, clientRequestId: crypto.randomUUID() };
    mutate('', { ...body, clientRequestId: submission.current.clientRequestId });
  }
  const active = sessions.some(item => !DONE.has(item.status)), url = safeOfficeLink(session?.runUrl);
  return <section aria-label="Office terminal" className="office-ai-terminal">
    <div className="office-ai-section-heading"><div><h2>Command terminal</h2><p>Run commands against your repository in an isolated, temporary Ubuntu workspace on GitHub Actions. Each run starts a new workspace; local file changes disappear when it ends.</p></div><button type="button" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} />Refresh terminal</button></div>
    {error && <p className="office-ai-error" role="alert">{error}</p>}
    {!loading && capabilities && !capabilities.available && <p className="office-ai-setup" role="status">{capabilities.note || 'Connect GitHub and install the Office terminal workflow before running commands.'}</p>}
    <div className="office-ai-task-grid"><aside><form className="office-ai-task-form" onSubmit={submit}>
      <p className="office-ai-eyebrow">{capabilities?.repository || 'Connected repository'} · Ubuntu</p>
      <label className="office-ai-field">Terminal command<textarea required rows={7} maxLength={12000} disabled={busy} value={command} onChange={event => setCommand(event.target.value)} placeholder={'node --version\nnpm ci\nnpm test'} spellCheck={false} /></label>
      <label className="office-ai-field">Repository ref<input required pattern="main|[a-fA-F0-9]{40}" value={ref} disabled={busy} onChange={event => setRef(event.target.value)} placeholder="main or a full commit SHA" /></label>
      <label className="office-ai-field">Time limit<select value={timeoutSeconds} disabled={busy} onChange={event => setTimeoutSeconds(Number(event.target.value))}>{[30, 60, 120, 180, 300].map(value => <option key={value} value={value}>{value} seconds</option>)}</select></label>
      <button type="submit" className="office-ai-primary" disabled={loading || busy || active || !capabilities?.available || !command.trim()}><Play size={14} />{busy ? 'Submitting…' : 'Run command'}</button>
      <p className="office-ai-form-note">Run command authorizes this command in the temporary workspace. Use coding tasks to publish repository changes and deploy. GitHub workflow logs are public in this repository. Keep credentials and private data out of commands and output.</p>
    </form><div className="office-ai-task-history"><h3>Recent runs</h3>{sessions.length ? sessions.map(item => <button key={item.id} type="button" aria-pressed={item.id === session?.id} onClick={() => { selected.current = item.id; setCancelRequested(false); setRevision(value => value + 1); }}><strong>{item.command?.slice(0, 100)}</strong><span>{taskState(item.status)} · {taskDate(item.createdAt)}</span></button>) : <p>{loading ? 'Loading runs…' : 'No terminal commands yet.'}</p>}</div></aside>
    <div className="office-ai-task-detail"><div className="office-ai-task-heading"><div><h3>Terminal output</h3>{session && <span className="office-ai-run-state" data-state={session.conclusion === 'failure' || (Number.isInteger(session.exitCode) && session.exitCode !== 0) ? 'failed' : session.status}>{taskState(session.status)}{session.conclusion ? ` · ${taskState(session.conclusion)}` : ''}{Number.isInteger(session.exitCode) ? ` · exit ${session.exitCode}` : ''}</span>}</div>{session && !DONE.has(session.status) && <button type="button" disabled={busy || cancelRequested} onClick={() => mutate(`/${encodeURIComponent(session.id)}/cancel`, {})}><Square size={14} />{cancelRequested ? 'Cancellation requested' : 'Stop command'}</button>}</div>
      {session && <><p className="office-ai-form-note">{session.ref}{session.commitSha ? ` · ${session.commitSha}` : ''} · Last checked {taskDate(observedAt)}</p><pre className="office-ai-terminal-command">$ {session.command}</pre>{url && <a className="office-ai-run-link" href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open GitHub Actions run <ArrowUpRight size={14} /></a>}{session.error && <p className="office-ai-error" role="alert">{officeAIError({ message: session.error })}</p>}</>}
      <pre className="office-ai-terminal-output" aria-label="Command output" tabIndex={0}>{output || (session ? 'Output will appear when GitHub makes the run logs available.' : 'Run a command to see its output here.')}</pre>{truncated && <p className="office-ai-form-note">Output was truncated. Open the GitHub run for the complete logs.</p>}
    </div></div>
  </section>;
}
