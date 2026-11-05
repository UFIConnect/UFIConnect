import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Download, RefreshCw, RotateCcw, Square } from 'lucide-react';
import OfficeAIContent, { safeOfficeLink } from './OfficeAIContent';
import OfficeAIArtifacts from './OfficeAIArtifacts';
import { officeAIRequest, officeAIError, taskDate, taskState } from './office-ai-client';

export const FINISHED_TASKS = new Set(['succeeded','failed','cancelled']);
function ReceiptLink({ url, children }) { const href = safeOfficeLink(url); return href ? <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{children}<ArrowUpRight size={13} /></a> : <span>{children}</span>; }

function TerminalReceipt({ terminal, apiBase, request, onOpenTerminal }) {
  const [opened,setOpened] = useState(false), [output,setOutput] = useState(null), [error,setError] = useState(''), [revision,setRevision] = useState(0);
  const controllers = useRef(new Set());
  useEffect(() => {
    if (!opened) return;
    let active = true;
    officeAIRequest(request,`${apiBase}/office/ai/terminal/${encodeURIComponent(terminal.id)}`,{},controllers.current).then(data => { if(active) { setOutput(data); setError(''); } }).catch(cause => { if(active) setError(officeAIError(cause)); });
    return () => { active = false; controllers.current.forEach(controller => controller.abort()); };
  },[opened,terminal.id,terminal.status,apiBase,request,revision]);
  return <div className="office-ai-receipt"><strong>Terminal run · {taskState(terminal.status)}{Number.isInteger(terminal.exitCode) ? ` · exit ${terminal.exitCode}` : ''}</strong>
    <ReceiptLink url={terminal.url}>Open command run</ReceiptLink>
    <details onToggle={event => setOpened(event.currentTarget.open)}><summary>Command output</summary>{error && <p role="alert" className="office-ai-error">{error}</p>}<pre className="office-ai-conversation-output">{output?.output || (output ? 'Output is not available yet.' : 'Loading command output…')}</pre>{output?.outputTruncated && <p>Output is truncated. Open the command run for complete logs.</p>}<button type="button" onClick={() => setRevision(value => value + 1)}><RefreshCw size={13} />Refresh output</button></details>
    {onOpenTerminal && <button type="button" onClick={() => onOpenTerminal(terminal.id)}>Open in Terminal</button>}
  </div>;
}

function DraftCheckpoints({task,busy,mutate,apiBase,request}) {
  const [selected,setSelected]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const controllers=useRef(new Set());
  useEffect(()=>()=>{controllers.current.forEach(controller=>controller.abort());},[task.id]);
  async function download(checkpoint) {
    setLoading(true);setError('');
    try {
      const data=await officeAIRequest(request,`${apiBase}/office/ai/tasks/${encodeURIComponent(task.id)}/checkpoints/${encodeURIComponent(checkpoint.id)}`,{},controllers.current);
      const url=URL.createObjectURL(new Blob([JSON.stringify(data.checkpoint,null,2)+'\n'],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download=`pip-draft-${checkpoint.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(cause) {setError(officeAIError(cause));} finally {setLoading(false);}
  }
  return <details className="office-ai-checkpoints"><summary>Draft rollback checkpoints ({Math.max(0,task.backups.length-1)} / 10 earlier versions)</summary><p className="office-ai-form-note">The saved draft and ten earlier versions are encrypted in Office. Restore a paused draft before publication; completed commits and deployments retain their receipts.</p>{task.backups.map((checkpoint,index)=><div className="office-ai-receipt" key={checkpoint.id}><span>{index===0?'Latest saved draft':`Rollback version ${index}`} · {checkpoint.summary}</span><small>{taskDate(checkpoint.createdAt)}</small><button type="button" disabled={loading} onClick={()=>download(checkpoint)}><Download size={13}/>Download draft</button>{index>0&&task.status==='needs_continuation'&&!task.commit&&<button type="button" disabled={busy} onClick={()=>setSelected(checkpoint)}><RotateCcw size={13}/>Restore draft</button>}</div>)}{selected&&<div className="office-ai-confirmation"><strong>Restore {selected.summary}?</strong><p>This replaces the staged files and keeps the task paused for review.</p><button type="button" disabled={busy} onClick={()=>{mutate(`/${task.id}/checkpoints/${selected.id}/restore`,{confirmed:true,continuationId:task.continuation.id});setSelected(null);}}>Confirm restore draft</button><button type="button" disabled={busy} onClick={()=>setSelected(null)}>Keep current draft</button></div>}{error&&<p role="alert" className="office-ai-error">{error}</p>}</details>;
}

export default function OfficeAITaskDetail({ task, busy, observedAt, mutate, apiBase, request, onOpenTerminal }) {
  if (!task) return null;
  const active = !FINISHED_TASKS.has(task.status);
  const latestStep = task.events?.at(-1);
  const live = task.deployments?.filter(item => item.status === 'live') || [];
  return <div className="office-ai-task-detail" aria-label="Task execution" aria-live="polite">
    <div className="office-ai-task-heading"><div><h3>{task.message || 'Office task'}</h3><span className="office-ai-run-state" data-state={task.status}>{taskState(task.status)}</span></div>{active && <button type="button" disabled={busy || task.status === 'cancel_requested'} onClick={() => mutate(`/${encodeURIComponent(task.id)}/cancel`, {})}><Square size={14} />{task.status === 'cancel_requested' ? 'Cancellation requested' : 'Stop task'}</button>}</div>
    <p className="office-ai-form-note" role="status">{active ? task.summary || latestStep?.label || 'Working on your request…' : task.status === 'succeeded' ? (live.length ? `Completed · ${live.length} deployments confirmed live` : 'Completed · results and receipts below') : task.error || 'Review the recorded result below.'}</p>
    <details className="office-ai-work-receipts office-ai-task-metadata"><summary>Task details</summary>
    <p className="office-ai-form-note">Last checked {taskDate(observedAt)}. Stopping cannot undo completed commits or deployments.</p>
    {task.route && <p className="office-ai-form-note">Destination: <strong>{task.route.target}</strong>. {task.route.reason}</p>}
    {task.memoryState?.status === 'unavailable' && <p className="office-ai-research-note">Memory is unavailable for this task. Its execution receipts remain below.</p>}
    {!!task.memoryState?.entries?.length && <details className="office-ai-sources"><summary>Memories used for this task</summary><ol>{task.memoryState.entries.map(entry => <li key={entry.id}><strong>{entry.title || 'Office memory'}</strong><small>{taskDate(entry.createdAt)} · {entry.kind} · {entry.status || 'recorded'}</small><small>Original record: {entry.referenceId || entry.id}</small></li>)}</ol></details>}
    {task.progress && <p className="office-ai-form-note">Model turns: {task.progress.modelTurns ?? 0}{task.limits?.modelTurns ? ` / ${task.limits.modelTurns}` : ''} · Tool calls: {task.progress.toolCalls ?? 0}{task.limits?.toolCalls ? ` / ${task.limits.toolCalls}` : ''}{task.progress.automaticContinuations ? ` · Continued automatically ${task.progress.automaticContinuations} / ${task.limits?.automaticContinuations ?? 10} times` : ''}{task.progress.resumes ? ` · Continued manually ${task.progress.resumes} times` : ''}</p>}
    </details>
    {task.confirmation && task.status === 'needs_confirmation' && <div className="office-ai-confirmation"><strong>{task.confirmation.label}</strong><p>{task.confirmation.detail}</p>{task.confirmation.uncertain ? <p>Review the recorded provider result before starting another task. This interrupted action cannot be replayed from a confirmation button.</p> : <button type="button" disabled={busy} onClick={() => mutate(`/${encodeURIComponent(task.id)}/confirm`, { confirmationId: task.confirmation.id, confirmed: true })}>Confirm this action</button>}</div>}
    {task.status === 'needs_continuation' && <div className="office-ai-confirmation"><strong>Ready to continue</strong><p>{task.continuation?.message || 'This task reached its current work limit. Continue from the saved checkpoint with the same permissions.'}</p><button type="button" disabled={busy || !task.resumable || !task.continuation?.id} onClick={() => mutate(`/${encodeURIComponent(task.id)}/resume`,{ confirmed: true, continuationId: task.continuation.id })}>Continue task</button></div>}
    {task.error && <p className="office-ai-error" role="alert">{officeAIError({ message: task.error })}</p>}
    {!!task.plan?.steps?.length && <ol className="office-ai-plan" aria-label="Work plan">{task.plan.steps.map(step=><li key={step.id} data-state={step.status}><span>{step.status==='completed'?'✓':step.status==='in_progress'?'→':'○'}</span>{step.title}<small>{taskState(step.status)}</small></li>)}</ol>}
    {task.recovery && <p className="office-ai-form-note" role="status">Recovery attempt {task.recovery.currentAttempt} / {task.recovery.limit ?? 2} · {task.recovery.step}</p>}
    {!!task.backups?.length && <DraftCheckpoints key={task.id} task={task} busy={busy} mutate={mutate} apiBase={apiBase} request={request}/>}
    {task.review && <details className="office-ai-work-receipts"><summary>Result verification</summary><ul>{task.review.checks.map(check=><li key={check.label}>{check.passed?'✓':'Review needed'} · {check.label}</li>)}</ul><p className="office-ai-form-note">{task.review.confirmedSteps} confirmed steps. A work plan alone does not verify completion.</p></details>}
    {task.summary && <OfficeAIContent text={task.summary} />}
    {!!task.artifacts?.length && <OfficeAIArtifacts key={task.id} task={task} apiBase={apiBase} request={request} />}
    <details className="office-ai-work-receipts"><summary>View work & receipts</summary>
    <ol className="office-ai-task-events" aria-label="Task steps">{(task.events || []).map((event,index) => <li key={event.id || index} data-state={event.status}><div><strong>{event.label || event.kind}</strong><span>{taskState(event.status)}</span></div>{event.detail && <p>{event.detail}</p>}<small>{taskDate(event.at)}</small>{event.url && <ReceiptLink url={event.url}>Open result</ReceiptLink>}</li>)}</ol></details>
    {!!task.terminals?.length && <section className="office-ai-task-results"><h3>Terminal results</h3>{task.terminals.map(terminal => <TerminalReceipt key={terminal.id} terminal={terminal} apiBase={apiBase} request={request} onOpenTerminal={onOpenTerminal} />)}</section>}
    {!!task.changedFiles?.length && <section className="office-ai-task-results"><h3>Changed files</h3>{task.changedFiles.map(file => <details key={file.path}><summary><code>{file.path}</code> <span>{file.status}</span></summary><pre>{file.diff || (file.before !== undefined && file.after !== undefined ? `Before\n${file.before}\n\nAfter\n${file.after}` : 'No diff was supplied for this file.')}</pre></details>)}</section>}
    {task.commit && <section className="office-ai-task-results"><h3>Commit</h3><ReceiptLink url={task.commit.url}><code>{task.commit.sha}</code></ReceiptLink><p>{task.commit.published ? 'Published to the repository default branch' : 'Candidate commit; not published'}{task.commit.ref ? ` · ${task.commit.refType || 'ref'}: ${task.commit.ref}` : ''}</p></section>}
    {!!task.checks?.length && <section className="office-ai-task-results"><h3>Checks</h3>{task.checks.map((check,index) => <div className="office-ai-receipt" key={check.id || index}><ReceiptLink url={check.url}>{check.name || 'Repository checks'}</ReceiptLink><span>{taskState(check.status)}{check.conclusion ? ` · ${taskState(check.conclusion)}` : ''}</span>{check.sha && <code>Commit {check.sha}</code>}</div>)}</section>}
    {!!task.deployments?.length && <section className="office-ai-task-results"><h3>Deployments</h3>{task.deployments.map((deployment,index) => <div className="office-ai-receipt" key={deployment.id || index}><ReceiptLink url={deployment.url}>{deployment.service || deployment.target || 'Deployment'}</ReceiptLink><span>{taskState(deployment.status)}</span>{deployment.id && <code>Deployment {deployment.id}</code>}{deployment.sha && <code>Commit {deployment.sha}</code>}</div>)}</section>}
  </div>;
}

export function OfficeAITaskRun({ taskId, apiBase, request, onUpdate, onOpenTerminal }) {
  const [task,setTask] = useState(null), [error,setError] = useState(''), [busy,setBusy] = useState(false), [observedAt,setObservedAt] = useState(''), [revision,setRevision] = useState(0);
  const controllers = useRef(new Set()), epoch = useRef(0), mutating = useRef(false), update = useRef(onUpdate);
  update.current = onUpdate;
  useEffect(() => {
    let stopped = false, timer;
    const current = ++epoch.current, valid = () => !stopped && epoch.current === current;
    async function refresh() {
      let finished = false;
      try {
        const data = await officeAIRequest(request,`${apiBase}/office/ai/tasks/${encodeURIComponent(taskId)}`,{},controllers.current);
        if(!valid()) return;
        if(!data.task || data.task.id !== taskId) throw Error('The task receipt could not be verified.');
        setTask(data.task); setObservedAt(new Date().toISOString()); setError(''); update.current?.(data.task);
        finished = FINISHED_TASKS.has(data.task.status);
      } catch(cause) { if(valid()) setError(officeAIError(cause)); }
      finally { if(valid() && !finished) timer = setTimeout(refresh,3000); }
    }
    refresh();
    return () => { stopped = true; epoch.current++; clearTimeout(timer); controllers.current.forEach(controller => controller.abort()); };
  },[taskId,apiBase,request,revision]);
  async function mutate(suffix,body) {
    if(mutating.current) return;
    mutating.current = true; setBusy(true); setError(''); const current = epoch.current;
    try {
      const data = await officeAIRequest(request,`${apiBase}/office/ai/tasks${suffix}`,{method:'POST',body},controllers.current);
      if(current !== epoch.current) return;
      if(data.task) { setTask(data.task); update.current?.(data.task); }
      setRevision(value => value + 1);
    } catch(cause) { if(current === epoch.current) setError(officeAIError(cause)); }
    finally { if(current === epoch.current) { mutating.current = false; setBusy(false); } }
  }
  return <div className="office-ai-conversation-task">{error && <p className="office-ai-error" role="alert">{error}<button type="button" onClick={() => setRevision(value => value + 1)}>Refresh task</button></p>}{task ? <OfficeAITaskDetail task={task} busy={busy} observedAt={observedAt} mutate={mutate} apiBase={apiBase} request={request} onOpenTerminal={onOpenTerminal} /> : <p role="status">Loading saved task…</p>}</div>;
}
