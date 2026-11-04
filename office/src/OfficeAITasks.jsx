import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Play, RefreshCw, Square } from 'lucide-react';
import OfficeAIContent, { safeOfficeLink } from './OfficeAIContent';
import { officeAIRequest, officeAIError, taskDate, taskState } from './office-ai-client';

const FINISHED = new Set(['succeeded', 'failed', 'cancelled']);
const TARGET_LABELS = { api: 'API service', pipeline: 'Pipeline service', web: 'Website', office: 'Office', mobile: 'Mobile app', 'cloudflare-ai': 'Cloudflare AI Worker', 'cloudflare-site': 'Cloudflare Office website' };
function ReceiptLink({ url, children }) { const href = safeOfficeLink(url); return href ? <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{children}<ArrowUpRight size={13} /></a> : <span>{children}</span>; }

export default function OfficeAITasks({ apiBase, request }) {
  const [tasks, setTasks] = useState([]), [task, setTask] = useState(null), [capabilities, setCapabilities] = useState(null);
  const [draft, setDraft] = useState(''), [permissions, setPermissions] = useState({ editCode: true, publish: true, deploy: true, operate: false }), [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [observedAt, setObservedAt] = useState(''), [revision, setRevision] = useState(0);
  const controllers = useRef(new Set()), generation = useRef(0), selected = useRef(null), submission = useRef(null), mutating = useRef(false);
  const api = (suffix = '', options = {}) => officeAIRequest(request, `${apiBase}/office/ai/tasks${suffix}`, options, controllers.current);
  useEffect(() => {
    let stopped = false, timer;
    const current = ++generation.current;
    const valid = () => !stopped && generation.current === current;
    async function refresh() {
      try {
        const data = await api();
        if (!valid()) return;
        const list = Array.isArray(data.tasks) ? data.tasks : [];
        setTasks(list); setCapabilities(data.capabilities || {});
        const id = selected.current || list.find(item => !FINISHED.has(item.status))?.id || list[0]?.id;
        if (id) { selected.current = id; const result = await api(`/${encodeURIComponent(id)}`); if (!valid()) return; setTask(result.task); }
        else setTask(null);
        setObservedAt(new Date().toISOString()); setError('');
      } catch (cause) { if (valid()) setError(officeAIError(cause)); }
      finally { if (valid()) { setLoading(false); timer = setTimeout(refresh, 3000); } }
    }
    setLoading(true); refresh();
    const reset = () => {
      generation.current++; controllers.current.forEach(item => item.abort()); selected.current = null; submission.current = null; mutating.current = false;
      setTasks([]); setTask(null); setCapabilities(null); setDraft(''); setTargets([]); setPermissions({ editCode: true, publish: true, deploy: true, operate: false }); setError(''); setObservedAt(''); setBusy(false); setRevision(value => value + 1);
    };
    window.addEventListener('office-token-changed', reset);
    return () => { stopped = true; generation.current++; clearTimeout(timer); controllers.current.forEach(item => item.abort()); window.removeEventListener('office-token-changed', reset); };
  }, [apiBase, request, revision]);

  async function mutate(suffix, body) {
    if (mutating.current) return;
    mutating.current = true; setBusy(true); setError(''); const current = generation.current;
    try {
      const data = await api(suffix, { method: 'POST', body });
      if (current !== generation.current) return;
      if (data.task) { selected.current = data.task.id; setTask(data.task); setTasks(previous => [data.task, ...previous.filter(item => item.id !== data.task.id)]); }
      if (!suffix) { setDraft(''); submission.current = null; }
      setObservedAt(new Date().toISOString()); setRevision(value => value + 1);
    } catch (cause) { if (current === generation.current) setError(officeAIError(cause)); }
    finally { if (current === generation.current) { mutating.current = false; setBusy(false); } }
  }
  function submit(event) {
    event.preventDefault();
    const body = { message: draft.trim(), permissions, deployTargets: targets }, signature = JSON.stringify(body);
    if (!body.message) return;
    if (!submission.current || submission.current.signature !== signature) submission.current = { signature, clientRequestId: crypto.randomUUID() };
    mutate('', { ...body, clientRequestId: submission.current.clientRequestId });
  }
  const deployTargets = Array.isArray(capabilities?.deployTargets) ? capabilities.deployTargets : [];
  const targetId = target => typeof target === 'string' ? target : target.id;
  const active = task && !FINISHED.has(task.status);
  return <section className="office-ai-task-workspace" aria-label="Coding tasks">
    <div className="office-ai-section-heading"><div><h2>Run a task</h2><p>Ask Cloudflare AI to inspect the repository, edit code, run checks, publish, and deploy within your selected scope.</p></div><button type="button" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} />Refresh tasks</button></div>
    {error && <p className="office-ai-error" role="alert">{error} Last observed results remain below.</p>}
    <div className="office-ai-task-grid"><aside>
      <form className="office-ai-task-form" onSubmit={submit}>
        <p className="office-ai-eyebrow">{capabilities?.repository || 'Connected Office repository'}</p>
        <label className="office-ai-field">Task request<textarea rows={6} maxLength={12000} required value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} placeholder="Fix a bug, run the relevant checks, and publish the change. Describe the result you want." /></label>
        <fieldset disabled={busy}><legend>Allowed actions for this task</legend>{[['editCode', 'Edit code'], ['publish', 'Publish changes'], ['deploy', 'Deploy requested changes'], ['operate', 'Run Office commands']].map(([key, label]) => <label key={key}><input type="checkbox" checked={permissions[key]} onChange={event => setPermissions(previous => ({ ...previous, [key]: event.target.checked, ...(['editCode', 'deploy'].includes(key) && !event.target.checked ? { publish: false } : {}), ...(key === 'publish' && event.target.checked ? { editCode: true, deploy: true } : {}) }))} />{label}{capabilities?.[key] === false && <small>Connection required</small>}</label>)}</fieldset>
        <p className="office-ai-form-note">Publishing to main can trigger automatic deployment. Run task authorizes these actions only as needed for your request. Existing destructive commands still require their specific confirmation.</p>
        {permissions.deploy && !!deployTargets.length && <fieldset disabled={busy}><legend>Deployment targets</legend>{deployTargets.map(target => <label key={targetId(target)}><input type="checkbox" checked={targets.includes(targetId(target))} onChange={event => setTargets(previous => event.target.checked ? [...previous, targetId(target)] : previous.filter(id => id !== targetId(target)))} />{typeof target === 'string' ? TARGET_LABELS[target] || target : target.label || target.name || target.id}</label>)}</fieldset>}
        <button type="submit" className="office-ai-primary" disabled={busy || loading || !capabilities || !draft.trim()}><Play size={14} />{busy ? 'Submitting…' : 'Run task'}</button>
        <p className="office-ai-form-note">Task instructions and selected repository context are sent to Cloudflare. Runs and results are stored in Office for authorized operators.</p>
      </form>
      <div className="office-ai-task-history"><h3>Recent tasks</h3>{tasks.length ? tasks.map(item => <button type="button" key={item.id} aria-pressed={task?.id === item.id} onClick={() => { selected.current = item.id; setRevision(value => value + 1); }}><strong>{item.message?.slice(0, 100) || 'Office task'}</strong><span>{taskState(item.status)} · {taskDate(item.createdAt)}</span></button>) : <p>{loading ? 'Loading tasks…' : 'Your tasks will appear here.'}</p>}</div>
    </aside><div className="office-ai-task-detail" aria-live="polite">
      {!task ? <div className="office-ai-empty"><Play size={28} /><h3>Work with a visible record</h3><p>Follow the steps, inspect changes, and open the actual check and deployment results here.</p></div> : <>
        <div className="office-ai-task-heading"><div><h3>{task.message || 'Office task'}</h3><span className="office-ai-run-state" data-state={task.status}>{taskState(task.status)}</span></div>{active && <button type="button" disabled={busy || task.status === 'cancel_requested'} onClick={() => mutate(`/${encodeURIComponent(task.id)}/cancel`, {})}><Square size={14} />{task.status === 'cancel_requested' ? 'Cancellation requested' : 'Stop task'}</button>}</div>
        <p className="office-ai-form-note">Last checked {taskDate(observedAt)}. Stopping cannot undo completed commits or deployments.</p>
        {task.confirmation && task.status === 'needs_confirmation' && <div className="office-ai-confirmation"><strong>{task.confirmation.label}</strong><p>{task.confirmation.detail}</p>{task.confirmation.uncertain ? <p>Review the recorded provider result before starting another task. This interrupted action cannot be replayed from a confirmation button.</p> : <button type="button" disabled={busy} onClick={() => mutate(`/${encodeURIComponent(task.id)}/confirm`, { confirmationId: task.confirmation.id, confirmed: true })}>Confirm this action</button>}</div>}
        {task.error && <p className="office-ai-error" role="alert">{officeAIError({ message: task.error })}</p>}
        {task.summary && <OfficeAIContent text={task.summary} />}
        <ol className="office-ai-task-events" aria-label="Task steps">{(task.events || []).map((event, index) => <li key={event.id || index} data-state={event.status}><div><strong>{event.label || event.kind}</strong><span>{taskState(event.status)}</span></div>{event.detail && <p>{event.detail}</p>}<small>{taskDate(event.at)}</small>{event.url && <ReceiptLink url={event.url}>Open result</ReceiptLink>}</li>)}</ol>
        {!!task.changedFiles?.length && <section className="office-ai-task-results"><h3>Changed files</h3>{task.changedFiles.map(file => <details key={file.path}><summary><code>{file.path}</code> <span>{file.status}</span></summary><pre>{file.diff || (file.before !== undefined && file.after !== undefined ? `Before\n${file.before}\n\nAfter\n${file.after}` : 'No diff was supplied for this file.')}</pre></details>)}</section>}
        {task.commit && <section className="office-ai-task-results"><h3>Commit</h3><ReceiptLink url={task.commit.url}><code>{task.commit.sha}</code></ReceiptLink><p>{task.commit.published ? 'Published to the repository default branch' : 'Candidate commit; not published'}{task.commit.ref ? ` · ${task.commit.refType || 'ref'}: ${task.commit.ref}` : ''}</p></section>}
        {!!task.checks?.length && <section className="office-ai-task-results"><h3>Checks</h3>{task.checks.map((check, index) => <div className="office-ai-receipt" key={check.id || index}><ReceiptLink url={check.url}>{check.name || 'Repository checks'}</ReceiptLink><span>{taskState(check.status)}{check.conclusion ? ` · ${taskState(check.conclusion)}` : ''}</span>{check.sha && <code>Commit {check.sha}</code>}</div>)}</section>}
        {!!task.deployments?.length && <section className="office-ai-task-results"><h3>Deployments</h3>{task.deployments.map((deployment, index) => <div className="office-ai-receipt" key={deployment.id || index}><ReceiptLink url={deployment.url}>{deployment.service || deployment.target || 'Deployment'}</ReceiptLink><span>{taskState(deployment.status)}</span>{deployment.id && <code>Deployment {deployment.id}</code>}{deployment.sha && <code>Commit {deployment.sha}</code>}</div>)}</section>}
      </>}
    </div></div>
  </section>;
}
