import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Play, Send, Trash2 } from 'lucide-react';
import './AgentChat.css';
import OfficeWebEditor from './OfficeWebEditor';
const knownRole = role => ['api', 'pipeline'].includes(role);
const stamp = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not reported';
function chatError(status) {
  if (status === 401) return 'Office access is unavailable. Check your Office connection and retry.';
  if (status === 503) return 'The agent service is unavailable. Check your Office connection and retry.';
  if (status === 404) return 'Agent chat is unavailable on this service version. Refresh after the service is updated.';
  if (status === 429) return 'The agent is busy. Wait briefly, then send your message again.';
  return 'The agent could not respond. Your conversation remains here; try again.';
}
const validActions = input => Array.isArray(input) ? input.filter(action => action && /^[a-z][a-z0-9.-]{1,100}$/.test(action.id)
  && typeof action.label === 'string' && typeof action.description === 'string' && ['api', 'pipeline', 'both'].includes(action.target)
  && typeof action.requiresConfirmation === 'boolean').map(action => ({ ...action, label: action.label.slice(0, 180), description: action.description.slice(0, 600) })) : [];
function taskResult(data) {
  if (!data || typeof data !== 'object') return 'The control returned no result details.';
  const lines = [];
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'number' || typeof value === 'boolean') lines.push(`${key}: ${value}`);
    else if (Array.isArray(value) && value.every(item => typeof item === 'string' && /^[a-z0-9_-]{1,80}$/.test(item))) lines.push(`${key}: ${value.join(', ') || 'none'}`);
    else if (['status', 'state', 'scope', 'role', 'mode', 'lastRun'].includes(key) && typeof value === 'string') lines.push(`${key}: ${value.slice(0, 160)}`);
    if (lines.length === 10) break;
  }
  return lines.length ? lines.join('\n') : 'Detailed results are recorded in Office Controls history.';
}
export default function AgentChat({ agent, officeFetch, base, apiBase, pipelineBase, messages, updateMessages }) {
  const [draft, setDraft] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [actions, setActions] = useState([]), [actionsError, setActionsError] = useState(''), [actionsLoading, setActionsLoading] = useState(true), [revision, setRevision] = useState(0);
  const [running, setRunning] = useState(''), [review, setReview] = useState(null), [visibleCount, setVisibleCount] = useState(50);
  const [webEditor, setWebEditor] = useState(null);
  const pending = useRef(null), sequence = useRef(0), mounted = useRef(false), latest = useRef(messages), actionBusy = useRef(false);
  latest.current = messages;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; pending.current?.abort(); }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setActionsLoading(true); setActionsError('');
    officeFetch(`${base}/office/agents/${encodeURIComponent(agent.id)}/actions`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw Error('Task list unavailable'); const data = await response.json();
        if (data.agentId !== agent.id || data.serviceRole !== agent.serviceRole) throw Error('Incorrect agent task list');
        let list = validActions(data.actions);
        // Capabilities are checked on the service that will execute the task.
        // Pipeline does not need a GitHub write key to open API's web editor.
        const otherRole = agent.serviceRole === 'api' ? 'pipeline' : 'api', otherBase = otherRole === 'api' ? apiBase : pipelineBase;
        if (list.some(action => action.target === otherRole || action.target === 'both')) {
          try {
            if (!otherBase) throw Error('Missing task service');
            const otherResponse = await officeFetch(`${otherBase}/office/agents/${encodeURIComponent(agent.id)}/actions`, { signal: controller.signal });
            if (!otherResponse.ok) throw Error('Task service unavailable');
            const other = await otherResponse.json();
            if (other.agentId !== agent.id || other.serviceRole !== otherRole) throw Error('Incorrect task service');
            const remote = validActions(other.actions);
            list = list.map(action => {
              if (action.target !== otherRole && action.target !== 'both') return action;
              const owner = remote.find(item => item.id === action.id && item.target === action.target && item.requiresConfirmation === action.requiresConfirmation);
              if (!owner) return { ...action, available: false, unavailableReason: 'This task could not be verified on its required service. Retry tasks.' };
              return { ...action, available: action.target === 'both' ? action.available !== false && owner.available !== false : owner.available,
                unavailableReason: action.target === 'both' && action.available === false ? action.unavailableReason : owner.unavailableReason };
            });
          } catch { list = list.map(action => action.target === otherRole || action.target === 'both'
            ? { ...action, available: false, unavailableReason: 'Task availability could not be checked on the required service. Retry tasks.' } : action); }
        }
        if (!controller.signal.aborted) setActions(list); })
      .catch(() => { if (!controller.signal.aborted) setActionsError('Could not load this agent’s tasks. Retry to check available actions.'); })
      .finally(() => { if (!controller.signal.aborted) setActionsLoading(false); });
    return () => controller.abort();
  }, [agent.id, agent.serviceRole, base, apiBase, pipelineBase, revision]);
  function append(items) { const next = [...latest.current, ...items]; latest.current = next; updateMessages(next); }
  function clear() {
    if (actionBusy.current) return;
    sequence.current++; pending.current?.abort(); pending.current = null; setBusy(false); setError(''); setDraft(''); setReview(null); setVisibleCount(50); latest.current = []; updateMessages([]);
  }
  async function send(event) {
    event.preventDefault(); const message = draft.trim();
    if (!message || busy || actionBusy.current || !knownRole(agent.serviceRole)) return;
    setError(''); setBusy(true);
    const token = ++sequence.current, controller = new AbortController(); pending.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 25000);
    // Keep the conversation without a count cap. Only recent topic context
    // enters a bounded request; the full transcript stays in this page.
    const history = latest.current.filter(item => item.role === 'user').slice(-4).map(item => ({ role: 'user', content: item.content.slice(0, 1200) }));
    while (history.length && new TextEncoder().encode(JSON.stringify({ message, history })).length > 7800) history.shift();
    append([{ role: 'user', content: message }]); setDraft('');
    try {
      const response = await officeFetch(`${base}/office/agents/${encodeURIComponent(agent.id)}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, history }), signal: controller.signal,
      });
      if (!response.ok) throw Object.assign(Error('Chat unavailable'), { status: response.status });
      const data = await response.json();
      if (data?.agentId !== agent.id || data?.serviceRole !== agent.serviceRole || !['ai', 'diagnostics'].includes(data.mode) || typeof data.reply !== 'string' || !data.reply.trim()) throw Error('Invalid agent reply');
      if (sequence.current !== token || controller.signal.aborted) return;
      append([{ role: 'assistant', content: data.reply.slice(0, 6000), mode: data.mode, observedAt: data.observedAt, actions: validActions(data.actions),
        suggestions: Array.isArray(data.suggestions) ? data.suggestions.filter(item => typeof item === 'string').slice(0, 4).map(item => item.slice(0, 160)) : [] }]);
    } catch (failure) { if (sequence.current === token && (!controller.signal.aborted || timedOut)) setError(timedOut ? 'The agent took too long to respond. Try again shortly.' : chatError(failure.status)); }
    finally { clearTimeout(timeout); if (sequence.current === token) { pending.current = null; setBusy(false); } }
  }
  async function execute(action, confirmed = false) {
    if (busy || actionBusy.current) return;
    const canonical = actions.find(item => item.id === action.id);
    if (!canonical) { setError('Reload the task list before running this action.'); return; }
    if (canonical.available === false) { setError(canonical.unavailableReason || 'This task is unavailable.'); return; }
    if (canonical.input === 'frontend-file' && canonical.frontendTarget === 'web') {
      setWebEditor({ instruction: draft || latest.current.filter(item => item.role === 'user').at(-1)?.content || '' }); setReview(null); return;
    }
    if (canonical.requiresConfirmation && !confirmed) { setReview(canonical); return; }
    const targets = canonical.target === 'both' ? [apiBase, pipelineBase] : [canonical.target === 'pipeline' ? pipelineBase : apiBase];
    if (targets.some(target => !target)) { setError('The required Office service is not configured.'); return; }
    actionBusy.current = true; setRunning(canonical.id); setError(''); setReview(null);
    append([{ role: 'user', content: `Run task: ${canonical.label}` }]);
    const results = [];
    try {
      for (const target of [...new Set(targets)]) {
        const role = target === pipelineBase ? 'Pipeline' : 'API';
        try {
          const response = await officeFetch(`${target}/office/controls/${encodeURIComponent(canonical.id)}/execute`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirmed: canonical.requiresConfirmation ? confirmed : false, contextId: `agent-chat:${agent.serviceRole}:${agent.id}`, contextLabel: `${agent.name}: ${canonical.label}` }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data.ok !== true) throw Error(data.error || `The task failed (${response.status}).`);
          const queued = data.result?.queuedSources;
          const result = `${role}: ${Array.isArray(queued) || typeof queued === 'number' ? 'Task queued' : 'Control completed'}. Run ${data.runId}.\n${taskResult(data.result)}`;
          results.push(result);
        } catch (failure) { results.push(`${role}: ${failure.message || 'The request was interrupted.'} Check Office Controls history before retrying; an interrupted task may still be running.`); }
      }
      if (mounted.current) append([{ role: 'assistant', mode: 'task', content: `${canonical.label}\n${results.join('\n\n')}`, observedAt: new Date().toISOString() }]);
    } finally { actionBusy.current = false; if (mounted.current) setRunning(''); }
  }
  function actionCard(action, key = action.id) {
    action = actions.find(item => item.id === action.id) || action;
    return <div className="lc-agent-task" key={key}><div><strong>{action.label}</strong><p>{action.description}</p><small>{action.target === 'both' ? 'API and Pipeline' : action.target === 'pipeline' ? 'Pipeline' : 'API'} · {action.impact} impact</small>{action.available === false && <p className="lc-error">{action.unavailableReason}</p>}</div><button type="button" disabled={busy || !!running || actionsLoading || action.available === false} onClick={() => execute(action)} aria-label={`Run task: ${action.label}`}><Play size={13} />{running === action.id ? 'Running…' : action.input === 'frontend-file' ? 'Edit public web' : action.requiresConfirmation ? 'Review task' : 'Run task'}</button></div>;
  }
  const suggestions = messages.at(-1)?.suggestions || [], visible = messages.slice(-visibleCount);
  return <section className="lc-chat" aria-label="Agent conversation">
    <div className="lc-section-heading"><h3><MessageSquare size={16} />Ask this agent</h3><button type="button" aria-label="Clear conversation" onClick={clear} disabled={!!running || (!messages.length && !busy && !draft)}><Trash2 size={14} />Clear</button></div>
    <p className="lc-hint">Ask about this agent or request a supported task. Run task executes through Office Controls and records the result. AI explanations use the available observations.</p>
    <details className="lc-agent-actions" open><summary>Agent actions {actions.length ? `(${actions.length})` : ''}</summary>
      {actionsLoading && <p role="status">Loading available tasks…</p>}
      {actionsError && <p role="alert" className="lc-error">{actionsError}<button type="button" disabled={!!running} onClick={() => setRevision(value => value + 1)}>Retry tasks</button></p>}
      {!actionsLoading && !actionsError && !actions.length && <p className="lc-hint">This integration runs through connected-account requests. You can ask for diagnostics here; no manual task is exposed.</p>}
      {actions.map(action => actionCard(action))}
    </details>
    {webEditor && <OfficeWebEditor agent={agent} apiBase={apiBase} officeFetch={officeFetch} initialInstruction={webEditor.instruction} onClose={() => setWebEditor(null)} onResult={content => { if (mounted.current) append([{ role: 'assistant', mode: 'task', content, observedAt: new Date().toISOString() }]); }} />}
    <div className="lc-chat-history" role="log" aria-live="polite" aria-relevant="additions text" aria-label={`${agent.name} conversation`}>
      {messages.length > visibleCount && <button type="button" onClick={() => setVisibleCount(value => value + 50)}>Show earlier messages ({messages.length - visibleCount})</button>}
      {!messages.length && <div className="lc-chat-empty"><MessageSquare size={24} /><p>Ask about recent work, or try “check the queue” or “run your main check.”</p></div>}
      {visible.map((item, index) => <article className={`lc-message lc-message-${item.role}`} key={messages.length - visible.length + index}><header>{item.role === 'user' ? 'You' : item.mode === 'ai' ? 'AI explanation' : item.mode === 'task' ? 'Task result' : 'Diagnostics reply'}{item.observedAt && <time>{stamp(item.observedAt)}</time>}</header><p>{item.content}</p>{validActions(item.actions).map(action => actionCard(action))}</article>)}
      {busy && <p className="lc-chat-wait" role="status">Reading this agent’s observations…</p>}{running && <p className="lc-chat-wait" role="status">Running the Office task…</p>}
    </div>
    {review && <section className="lc-task-review" role="region" aria-label="Review agent task"><h4>Review {review.label}</h4><p>{review.description}</p><p>This {review.impact} impact task runs on {review.target === 'both' ? 'API and Pipeline' : review.target}.</p><button type="button" onClick={() => execute(review, true)} disabled={!!running || busy}>Confirm and run task</button><button type="button" onClick={() => setReview(null)}>Cancel task</button></section>}
    {error && <p role="alert" className="lc-error">{error}</p>}
    {!!suggestions.length && <div className="lc-suggestions">{suggestions.map(suggestion => <button type="button" key={suggestion} disabled={busy || !!running} onClick={() => setDraft(suggestion)}>{suggestion}</button>)}</div>}
    <form onSubmit={send}><label htmlFor="lc-agent-message">Message this agent</label><textarea id="lc-agent-message" rows={3} maxLength={1200} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Ask a question or request a task" disabled={!knownRole(agent.serviceRole)} />
      <div className="lc-compose-footer"><small>{draft.length}/1200 · memory only</small><button type="submit" disabled={busy || !!running || !draft.trim() || !knownRole(agent.serviceRole)}><Send size={14} />Send message</button></div>
    </form><p className="lc-hint">{messages.length} messages · No conversation message limit. History stays in this page until you clear it or leave. Recent context keeps each request small.</p>
  </section>;
}
