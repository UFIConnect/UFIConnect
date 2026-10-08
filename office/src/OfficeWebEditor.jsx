import { useEffect, useRef, useState } from 'react';
const maxBytes = 80 * 1024;
const safePath = path => typeof path === 'string' && !path.includes('..') && /^(?:web\/(?:src|public)\/.+\.(?:css|html|js|jsx|json|md|svg|ts|tsx|txt|webmanifest|xml)|web\/index\.html)$/.test(path);
async function read(response) { const data = await response.json().catch(() => ({})); if (!response.ok) throw Error(data.error || `Request failed (${response.status}).`); return data; }
export default function OfficeWebEditor({ agent, apiBase, officeFetch, initialInstruction = '', onClose, onResult }) {
  const [files, setFiles] = useState([]), [path, setPath] = useState(''), [loaded, setLoaded] = useState(null);
  const [instruction, setInstruction] = useState(initialInstruction), [content, setContent] = useState(''), [summary, setSummary] = useState('');
  const [edits, setEdits] = useState(null), [busy, setBusy] = useState('files'), [error, setError] = useState(''), [review, setReview] = useState(false);
  const [saved, setSaved] = useState(null), [revision, setRevision] = useState(0), pending = useRef(null), mounted = useRef(false), submitted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort(); }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setBusy('files'); setError('');
    officeFetch(`${apiBase}/office/frontend-files?target=web`, { signal: controller.signal }).then(read).then(data => {
      if (!Array.isArray(data.files) || data.target !== 'web') throw Error('Invalid web file list.');
      if (!controller.signal.aborted) { const options = data.files.filter(file => safePath(file.path) && (!file.bytes || file.bytes <= maxBytes)); setFiles(options); setPath(options[0]?.path || ''); }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setBusy(''); });
    return () => controller.abort();
  }, [apiBase, revision]);
  async function load() {
    if (!safePath(path) || busy || submitted.current) return;
    setBusy('load'); setError(''); setReview(false); setSaved(null); setLoaded(null); setContent(''); setEdits(null);
    try { const data = await read(await officeFetch(`${apiBase}/office/frontend-file?target=web&path=${encodeURIComponent(path)}`));
      if (data.target !== 'web' || data.path !== path || !/^[a-f0-9]{40}$/i.test(data.sha || '') || typeof data.content !== 'string' || new TextEncoder().encode(data.content).length > maxBytes) throw Error('This file cannot be opened in the agent editor.');
      if (mounted.current) { setLoaded(data); setContent(data.content); setSummary('Update public website'); }
    } catch (failure) { if (mounted.current) setError(failure.message); }
    finally { if (mounted.current) setBusy(''); }
  }
  async function prepare() {
    if (!loaded || busy || !instruction.trim() || submitted.current) return;
    setBusy('draft'); setError(''); setReview(false); setSaved(null); setEdits(null);
    const controller = new AbortController(); pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 55000);
    try { const data = await read(await officeFetch(`${apiBase}/office/agents/${encodeURIComponent(agent.id)}/web-draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ message: instruction.trim(), filePath: loaded.path, expectedSha: loaded.sha }),
    }));
      if (data.agentId !== agent.id || data.serviceRole !== 'api' || data.filePath !== loaded.path || data.expectedSha !== loaded.sha || data.original !== loaded.content
        || typeof data.content !== 'string' || !data.content || new TextEncoder().encode(data.content).length > maxBytes
        || typeof data.summary !== 'string' || !Array.isArray(data.edits)) throw Error('The agent returned an invalid change preview. Nothing was saved.');
      if (mounted.current && !controller.signal.aborted) { setContent(data.content); setSummary(data.summary.slice(0, 120)); setEdits(data.edits); }
    } catch (failure) { if (mounted.current) setError(controller.signal.aborted ? 'Preparation stopped. Your file remains unchanged.' : failure.message); }
    finally { clearTimeout(timeout); pending.current = null; if (mounted.current) setBusy(''); }
  }
  const changed = loaded && content !== loaded.content && content && new TextEncoder().encode(content).length <= maxBytes;
  async function commit() {
    if (!changed || !review || busy || submitted.current || summary.trim().length < 6) return;
    submitted.current = true; setBusy('commit'); setError('');
    try {
      const data = await read(await officeFetch(`${apiBase}/office/controls/commit.web-frontend/execute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true, filePath: loaded.path,
          expectedSha: loaded.sha, content, commitMessage: summary.trim(), contextId: `agent-chat:${agent.serviceRole}:${agent.id}`, contextLabel: `${agent.name}: public web edit` }),
      }));
      if (data.ok !== true || !data.runId || !/^[a-f0-9]{40}$/i.test(data.result?.commitSha || '')) throw Error('The commit result could not be verified. Check Office Controls history before retrying.');
      if (mounted.current) { setSaved(data); setReview(false); onResult(`Public web change committed: ${loaded.path}\n${summary.trim()}\nCommit ${data.result.commitSha}\nOffice run ${data.runId}\nThe release workflow must pass its checks before deployment. Check deployments for the live status.`); }
    } catch (failure) { if (mounted.current) setError(`${failure.message} Your draft remains here. Check Office Controls history before retrying an interrupted request.`); }
    finally { submitted.current = false; if (mounted.current) setBusy(''); }
  }
  return <section className="lc-web-editor" aria-label="Public web editor">
    <header><h4>Edit the public website</h4><button type="button" onClick={onClose} disabled={busy === 'commit'}>Close editor</button></header>
    <p>Choose an existing public web file. Ask the agent to prepare a change, or edit it below. Review the preview, then commit through Office. The release workflow checks the change before deployment.</p>
    <label htmlFor="lc-web-file">Public web file</label><select id="lc-web-file" value={path} disabled={!!busy} onChange={event => { setPath(event.target.value); setLoaded(null); setReview(false); setSaved(null); }}><option value="">Choose a file</option>{files.map(file => <option key={file.path} value={file.path}>{file.path}</option>)}</select>
    <button type="button" onClick={load} disabled={!!busy || !path}>Load current file</button><button type="button" onClick={() => setRevision(value => value + 1)} disabled={!!busy}>Reload file list</button>
    {loaded && <><p className="lc-hint">Editing {loaded.path} · revision {loaded.sha.slice(0, 8)}</p>
      <label htmlFor="lc-web-instruction">Describe the change</label><textarea id="lc-web-instruction" rows={3} maxLength={3000} value={instruction} disabled={!!busy || !!saved} onChange={event => setInstruction(event.target.value)} />
      <button type="button" onClick={prepare} disabled={!!busy || !!saved || !instruction.trim()}>Prepare web change</button><small>Uses OpenAI only when you request a draft.</small>
      <details><summary>Edit proposed file</summary><textarea aria-label="Proposed file content" className="lc-web-code" rows={12} value={content} spellCheck={false} disabled={!!busy || !!saved} onChange={event => { setContent(event.target.value); setEdits(null); setReview(false); }} /></details>
      {changed && <section aria-label="Web change preview"><h4>Change preview</h4>{edits ? edits.map((edit, index) => <div className="lc-web-diff" key={index}><div><strong>Before</strong><pre>{edit.find}</pre></div><div><strong>After</strong><pre>{edit.replace}</pre></div></div>) : <div className="lc-web-diff"><div><strong>Current file</strong><pre>{loaded.content}</pre></div><div><strong>Proposed file</strong><pre>{content}</pre></div></div>}
        <label htmlFor="lc-web-summary">Commit summary</label><input id="lc-web-summary" maxLength={120} value={summary} disabled={!!busy || !!saved} onChange={event => { setSummary(event.target.value); setReview(false); }} />
        {!review && !saved && <button type="button" onClick={() => setReview(true)} disabled={!!busy || summary.trim().length < 6}>Review public web commit</button>}
      </section>}
      {review && <section className="lc-task-review" aria-label="Confirm public web commit"><h4>Commit this public web change</h4><p>{loaded.path}: {summary.trim()}</p><p>This writes the reviewed file to the main branch and starts the checked release workflow. Office verifies the file revision again before saving.</p><button type="button" onClick={commit} disabled={!!busy}>Confirm and commit web change</button><button type="button" onClick={() => setReview(false)} disabled={!!busy}>Cancel commit</button></section>}
    </>}
    {saved && <p role="status">Committed {saved.result.commitSha.slice(0, 8)}. Check deployment status in Office.</p>}
    {busy && <p role="status">{busy === 'draft' ? 'Preparing the web change…' : busy === 'commit' ? 'Committing the reviewed file…' : 'Loading web files…'}</p>}
    {error && <p role="alert" className="lc-error">{error}</p>}
  </section>;
}
