import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Play, RefreshCw, Square } from 'lucide-react';
import OfficeAITaskDetail from './OfficeAITaskDetail';
import OfficeAITaskScope, { DEFAULT_TASK_PERMISSIONS } from './OfficeAITaskScope';
import { officeAIRequest, officeAIError, taskDate, taskState } from './office-ai-client';

const FINISHED = new Set(['succeeded', 'failed', 'cancelled']);

export default function OfficeAITasks({ apiBase, request, onOpenTerminal }) {
  const [tasks, setTasks] = useState([]), [task, setTask] = useState(null), [capabilities, setCapabilities] = useState(null);
  const [draft, setDraft] = useState(''), [permissions, setPermissions] = useState({ ...DEFAULT_TASK_PERMISSIONS }), [targets, setTargets] = useState([]);
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
      setTasks([]); setTask(null); setCapabilities(null); setDraft(''); setTargets([]); setPermissions({ ...DEFAULT_TASK_PERMISSIONS }); setError(''); setObservedAt(''); setBusy(false); setRevision(value => value + 1);
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
  return <section className="office-ai-task-workspace" aria-label="Coding tasks">
    <div className="office-ai-section-heading"><div><h2>Run a task</h2><p>Ask Cloudflare AI to inspect the repository, edit code, run checks, publish, and deploy within your selected scope.</p></div><button type="button" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} />Refresh tasks</button></div>
    {error && <p className="office-ai-error" role="alert">{error} Last observed results remain below.</p>}
    <div className="office-ai-task-grid"><aside>
      <form className="office-ai-task-form" onSubmit={submit}>
        <p className="office-ai-eyebrow">{capabilities?.repository || 'Connected Office repository'}</p>
        <label className="office-ai-field">Task request<textarea rows={6} maxLength={12000} required value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} placeholder="Fix a bug, run the relevant checks, and publish the change. Describe the result you want." /></label>
        <OfficeAITaskScope permissions={permissions} setPermissions={setPermissions} targets={targets} setTargets={setTargets} capabilities={capabilities} disabled={busy} />
        <button type="submit" className="office-ai-primary" disabled={busy || loading || !capabilities || !draft.trim()}><Play size={14} />{busy ? 'Submitting…' : 'Run task'}</button>
        <p className="office-ai-form-note">Task instructions and selected repository context are sent to Cloudflare. Runs and results are stored in Office for authorized operators.</p>
      </form>
      <div className="office-ai-task-history"><h3>Recent tasks</h3>{tasks.length ? tasks.map(item => <button type="button" key={item.id} aria-pressed={task?.id === item.id} onClick={() => { selected.current = item.id; setRevision(value => value + 1); }}><strong>{item.message?.slice(0, 100) || 'Office task'}</strong><span>{taskState(item.status)} · {taskDate(item.createdAt)}</span></button>) : <p>{loading ? 'Loading tasks…' : 'Your tasks will appear here.'}</p>}</div>
    </aside>{task ? <OfficeAITaskDetail task={task} busy={busy} observedAt={observedAt} mutate={mutate} apiBase={apiBase} request={request} onOpenTerminal={onOpenTerminal} /> : <div className="office-ai-task-detail office-ai-empty"><Play size={28} /><h3>Work with a visible record</h3><p>Follow the steps and inspect command, check, and deployment results here.</p></div>}</div>
  </section>;
}
