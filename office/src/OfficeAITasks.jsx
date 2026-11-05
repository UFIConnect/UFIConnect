import { useEffect, useRef, useState } from 'react';
import { Bot, Plus, RefreshCw, Send } from 'lucide-react';
import OfficeAITaskDetail, { OfficeAITaskRun } from './OfficeAITaskDetail';
import OfficeAIContent, { safeOfficeLink } from './OfficeAIContent';
import OfficeAITaskScope, { DEFAULT_TASK_PERMISSIONS } from './OfficeAITaskScope';
import { officeAIRequest, officeAIError, taskDate, taskState } from './office-ai-client';
import { isAgentQuestion } from './office-ai-intent.mjs';
import { officeAIHistory } from './office-ai-history.mjs';
import { createVisibleOfficePoller } from './office-polling.mjs';

const FINISHED = new Set(['succeeded', 'failed', 'cancelled']);
const context = officeAIHistory;

export default function OfficeAITasks({ apiBase, request, onOpenTerminal, initialDestination = 'auto', tone = 'friendly' }) {
  const upgrade = initialDestination === 'self-update', agentName = upgrade ? 'Upgrade Pip agent' : 'Task agent';
  const [tasks, setTasks] = useState([]), [task, setTask] = useState(null), [capabilities, setCapabilities] = useState(null);
  const [destination, setDestination] = useState(initialDestination), [remember, setRemember] = useState(true), [mode, setMode] = useState('work');
  const [draft, setDraft] = useState(''), [messages, setMessages] = useState([]), [permissions, setPermissions] = useState({ ...DEFAULT_TASK_PERMISSIONS }), [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [pollError, setPollError] = useState(''), [observedAt, setObservedAt] = useState(''), [revision, setRevision] = useState(0);
  const controllers = useRef(new Set()), generation = useRef(0), selected = useRef(null), submission = useRef(null), mutating = useRef(false), transcript = useRef(null), composer = useRef(null);
  const api = (suffix = '', options = {}) => officeAIRequest(request, `${apiBase}/office/ai/tasks${suffix}`, options, controllers.current);
  const asking = mode === 'ask' || isAgentQuestion(draft);
  const working = (task && !FINISHED.has(task.status)) || messages.some(item => item.taskId && !FINISHED.has(item.status));
  useEffect(() => {
    let stopped = false, nextDelay = 15000;
    const current = ++generation.current, valid = () => !stopped && generation.current === current;
    async function refresh({ signal }) {
      let active = false;
      try {
        const data = await api('', { signal });
        if (!valid() || signal.aborted) return;
        const list = (Array.isArray(data.tasks) ? data.tasks : []).filter(item => !upgrade || item.route?.target === 'self-update' || item.target === 'self-update');
        setTasks(list); setCapabilities(data.capabilities || {}); active = list.some(item => !FINISHED.has(item.status));
        const id = selected.current === false ? null : selected.current || list.find(item => !FINISHED.has(item.status))?.id || list[0]?.id;
        if (id) { selected.current = id; const result = await api(`/${encodeURIComponent(id)}`, { signal }); if (!valid() || signal.aborted) return; setTask(result.task); }
        setObservedAt(new Date().toISOString()); setPollError('');
      } catch (cause) { if (valid() && !signal.aborted) setPollError(officeAIError(cause)); }
      finally { nextDelay = active ? 3000 : 15000; if (valid()) setLoading(false); }
    }
    setLoading(true); const poller = createVisibleOfficePoller({ task: refresh, intervalMs: () => nextDelay });
    const reset = () => {
      generation.current++; controllers.current.forEach(item => item.abort()); selected.current = null; submission.current = null; mutating.current = false;
      setDestination(initialDestination); setRemember(true); setMode('work'); setMessages([]); setTasks([]); setTask(null); setCapabilities(null); setDraft(''); setTargets([]); setPermissions({ ...DEFAULT_TASK_PERMISSIONS }); setError(''); setPollError(''); setObservedAt(''); setBusy(false); setRevision(value => value + 1);
    };
    window.addEventListener('office-token-changed', reset);
    return () => { stopped = true; generation.current++; poller.stop(); controllers.current.forEach(item => item.abort()); window.removeEventListener('office-token-changed', reset); };
  }, [apiBase, request, revision]);
  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: 'smooth' }); }, [messages.length, busy]);

  async function mutate(suffix, body) {
    if (mutating.current) return;
    mutating.current = true; setBusy(true); setError(''); const current = generation.current;
    try {
      const data = await api(suffix, { method: 'POST', body });
      if (current !== generation.current) return;
      if (data.task) { selected.current = data.task.id; setTask(data.task); setTasks(previous => [data.task, ...previous.filter(item => item.id !== data.task.id)]); }
      setObservedAt(new Date().toISOString()); setRevision(value => value + 1);
    } catch (cause) { if (current === generation.current) setError(officeAIError(cause)); }
    finally { if (current === generation.current) { mutating.current = false; setBusy(false); } }
  }
  async function submit(event) {
    event.preventDefault(); const message = draft.trim();
    if (!message || mutating.current || (!asking && (working || !capabilities))) return;
    const prior = task ? [{ role: 'user', content: task.message }, ...(task.summary ? [{ role: 'assistant', content: task.summary }] : [])] : [];
    const history = context([...prior, ...messages]);
    const toneSetting = capabilities?.tonesAvailable === true ? { tone } : {};
    const body = asking ? { mode: 'chat', message, history, memory: remember, research: true, ...toneSetting }
      : { message, history, target: destination, memory: remember, permissions, deployTargets: targets, ...toneSetting };
    const signature = JSON.stringify({ message, destination, remember, permissions, targets, ...toneSetting });
    if (!asking && (!submission.current || submission.current.signature !== signature)) submission.current = { signature, body, clientRequestId: crypto.randomUUID() };
    if (!asking && !task) selected.current = false;
    mutating.current = true; setBusy(true); setError(''); const current = generation.current;
    try {
      const data = asking
        ? await officeAIRequest(request, `${apiBase}/office/ai/chat`, { method: 'POST', body, timeoutMs: 220000 }, controllers.current)
        : await api('', { method: 'POST', body: { ...submission.current.body, clientRequestId: submission.current.clientRequestId } });
      if (current !== generation.current) return;
      if (asking) {
        if (typeof data.reply !== 'string' || !data.reply.trim()) throw Error('Pip returned an empty reply. Your message is ready to retry.');
        setMessages(previous => [...previous, { role: 'user', content: message }, { role: 'assistant', content: data.reply, sources: data.sources, research: data.research }]);
      } else {
        if (!data.task?.id) throw Error('No run receipt arrived. Send the same request again to recover it.');
        setMessages(previous => [...previous, { role: 'user', content: message }, { role: 'assistant', content: data.task.summary || 'Follow the work and results below.', taskId: data.task.id, status: data.task.status }]);
        if (!task) selected.current = false;
        setTasks(previous => [data.task, ...previous.filter(item => item.id !== data.task.id)]); submission.current = null;
      }
      setDraft('');
    } catch (cause) { if (current === generation.current) setError(`${officeAIError(cause)}${!asking ? ' Your draft is ready to retry. Sending the same request recovers its receipt without starting it twice.' : ''}`); }
    finally { if (current === generation.current) { mutating.current = false; setBusy(false); composer.current?.focus(); } }
  }
  function newChat() { if (!busy) { selected.current = false; submission.current = null; setTask(null); setMessages([]); setDraft(''); setError(''); composer.current?.focus(); } }
  function updateTask(value) {
    setMessages(previous => previous.some(item => item.taskId === value.id && (item.status !== value.status || (value.summary && item.content !== value.summary)))
      ? previous.map(item => item.taskId === value.id ? { ...item, status: value.status, content: value.summary || item.content } : item) : previous);
  }
  return <section className="office-ai-task-workspace" aria-label={upgrade ? 'AI upgrades' : 'Coding tasks'}>
    <div className="office-ai-section-heading"><div><h2>{agentName}</h2><p>{upgrade ? 'Talk through an improvement, then ask Pip to make it. Follow its edits, checks, and release here.' : 'Ask a question or describe the result you want. Your agent keeps the discussion and work together.'}</p></div><button type="button" disabled={busy} onClick={newChat}><Plus size={14} />New agent chat</button></div>
    <div className="office-ai-agent-grid"><div className="office-ai-chat">
      <div className="office-ai-chat-bar"><span><Bot size={16} />{agentName}</span><span>{busy ? 'Preparing a reply…' : 'Ready for your message'}</span></div>
      <div className="office-ai-transcript" ref={transcript} role="log" aria-label={`${agentName} conversation`} aria-live="polite">
        {!messages.length && !task && <div className="office-ai-welcome"><Bot size={29} /><h3>{upgrade ? 'What should Pip do better?' : 'What would you like help with?'}</h3><p>Questions get an answer. In Work, a concrete request starts a run with the actions you allow.</p><div className="office-ai-starters">{(upgrade ? ['What can you improve?', 'Explain how upgrades work.'] : ['What can you do?', 'Help me plan a website.']).map(text => <button type="button" key={text} onClick={() => { setDraft(text); composer.current?.focus(); }}>{text}</button>)}</div></div>}
        {task && <OfficeAITaskDetail task={task} busy={busy} observedAt={observedAt} mutate={mutate} apiBase={apiBase} request={request} onOpenTerminal={onOpenTerminal} />}
        {messages.map((message, index) => <article key={index} className={`office-ai-message office-ai-message-${message.role}`}><div className="office-ai-message-author">{message.role === 'user' ? 'You' : <><Bot size={16} />Pip</>}</div><OfficeAIContent text={message.content} />{message.taskId && <OfficeAITaskRun taskId={message.taskId} apiBase={apiBase} request={request} onUpdate={updateTask} onOpenTerminal={onOpenTerminal} />}{Array.isArray(message.sources) && !!message.sources.length && <details className="office-ai-sources" open><summary>Sources for this reply</summary><ol>{message.sources.filter(source => safeOfficeLink(source?.url)).map((source, i) => <li key={i}><a href={safeOfficeLink(source.url)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{source.title || source.url}</a></li>)}</ol></details>}{message.research?.status === 'unavailable' && <p className="office-ai-research-note">Web research was unavailable for this reply.</p>}</article>)}
        {busy && <p className="office-ai-thinking" role="status"><span />{asking ? 'Preparing your answer…' : 'Starting your work…'}</p>}
      </div>
      <form className="office-ai-composer" onSubmit={submit}>
        {error && <p className="office-ai-error" role="alert">{error}</p>}
        <div className="office-ai-modes" role="group" aria-label={`${agentName} mode`}>{[['ask', 'Ask'], ['work', 'Work']].map(([value, label]) => <button type="button" key={value} aria-pressed={mode === value} disabled={busy} onClick={() => setMode(value)}>{label}</button>)}</div>
        <label className="office-ai-sr-only" htmlFor={`office-ai-agent-${initialDestination}`}>{upgrade ? 'Upgrade instructions' : 'Task instructions'}</label><textarea ref={composer} id={`office-ai-agent-${initialDestination}`} rows={3} required value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} placeholder={upgrade ? 'Ask about Pip or describe an improvement…' : 'Ask a question or tell your agent what to do…'} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }} />
        <div className="office-ai-composer-footer"><span>{asking ? 'Reply only' : working ? 'Your run is still active. You can ask about it.' : 'Work with allowed actions'} · Ctrl / ⌘ + Enter</span><button type="submit" className="office-ai-primary" disabled={busy || !draft.trim() || (!asking && (!capabilities || working))}><Send size={14} />{busy ? 'Sending…' : 'Send'}</button></div>
      </form>
    </div><aside className="office-ai-context">
      <details className="office-ai-context-card" open><summary>Work settings</summary><label className="office-ai-field">Request destination<select aria-label="Request destination" value={destination} disabled={busy || upgrade} onChange={event => setDestination(event.target.value)}><option value="auto">Choose from my request</option><option value="general">General task or research</option><option value="office">Office operations</option><option value="hosted-web">Website draft saved in memory</option><option value="public-web">Public website update</option><option value="mobile-app">Mobile apps</option><option value="self-update">Upgrade Pip itself</option></select></label><label className="office-ai-research-toggle"><span>Recall relevant memory</span><input type="checkbox" checked={remember} disabled={busy} onChange={event => setRemember(event.target.checked)} /></label><OfficeAITaskScope permissions={permissions} setPermissions={setPermissions} targets={targets} setTargets={setTargets} capabilities={capabilities} disabled={busy} /></details>
      <div className="office-ai-task-history"><div className="office-ai-card-heading"><h3>{upgrade ? 'Upgrade history' : 'Recent tasks'}</h3><button type="button" disabled={loading || busy} aria-label="Refresh tasks" onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} /></button></div>{pollError && <p className="office-ai-error" role="alert">{pollError}</p>}{tasks.length ? tasks.map(item => <button type="button" key={item.id} disabled={busy} aria-pressed={task?.id === item.id} onClick={() => { selected.current = item.id; setTask(item); setMessages([]); setError(''); setRevision(value => value + 1); }}><strong>{item.message?.slice(0, 100) || 'Office task'}</strong><span>{taskState(item.status)} · {taskDate(item.createdAt)}</span></button>) : <p>{loading ? 'Loading work…' : 'Your runs will appear here.'}</p>}</div>
      <p className="office-ai-form-note">Messages and selected source context go to Cloudflare. Runs are stored in Office. This discussion stays in this tab until you start a new agent chat or leave Pip.</p>
    </aside></div>
  </section>;
}
