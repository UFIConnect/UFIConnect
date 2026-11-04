import { useEffect, useRef, useState } from 'react';
import { Brain, RefreshCw, Search, Trash2 } from 'lucide-react';

const dateLabel = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : '';
const labels = { conversation: 'Discussion', execution: 'Execution', note: 'Note' };

export default function OfficeAIMemory({ apiBase, request }) {
  const [query, setQuery] = useState(''), [entries, setEntries] = useState([]), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [revision, setRevision] = useState(0), [clearReview, setClearReview] = useState(false);
  const pending = useRef(null), generation = useRef(0), mounted = useRef(false);
  const [storageStats, setStorageStats] = useState(null);
  async function api(suffix = '', options = {}) {
    const response = await request(`${apiBase}/office/ai/memory${suffix}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(response.status === 401 ? 'Sign in to Office to access memory.' : typeof data.error === 'string' ? data.error : 'Memory is unavailable. Please retry.');
    return data;
  }
  useEffect(() => {
    mounted.current = true;
    const reset = () => { generation.current++; pending.current?.abort(); setEntries([]); setQuery(''); setError(''); setNotice(''); setClearReview(false); setRevision(value => value + 1); };
    window.addEventListener('office-token-changed', reset);
    return () => { mounted.current = false; generation.current++; pending.current?.abort(); window.removeEventListener('office-token-changed', reset); };
  }, []);
  async function load(value = query) {
    pending.current?.abort();
    const controller = new AbortController(), current = ++generation.current;
    pending.current = controller; setBusy(true); setError('');
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const data = await api(`?query=${encodeURIComponent(value.trim())}&limit=30`, { signal: controller.signal });
      if (mounted.current && generation.current === current) { setEntries(Array.isArray(data.entries) ? data.entries : []); setStorageStats(data.storageStats || null); }
    } catch (cause) { if (mounted.current && generation.current === current) setError(cause.name === 'AbortError' ? 'Memory lookup timed out. Please retry.' : cause.message); }
    finally { clearTimeout(timeout); if (mounted.current && generation.current === current) { pending.current = null; setBusy(false); } }
  }
  useEffect(() => { load(''); }, [apiBase, request, revision]);
  async function forget(id) {
    if (busy) return;
    const controller = new AbortController(), current = generation.current;
    pending.current = controller; setBusy(true); setError(''); setNotice('');
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      await api(id ? `/${encodeURIComponent(id)}` : '/clear', { method: id ? 'DELETE' : 'POST', signal: controller.signal,
        ...(id ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) }) });
      if (mounted.current && generation.current === current) { setEntries(previous => id ? previous.filter(item => item.id !== id) : []); setClearReview(false); setNotice(id ? 'Memory entry forgotten.' : 'Memory cleared. Saved chats and audit receipts can still be managed in their original views.'); }
    } catch (cause) { if (mounted.current && generation.current === current) setError(cause.name === 'AbortError' ? 'The request timed out. Refresh memory to check its state.' : cause.message); }
    finally { clearTimeout(timeout); if (mounted.current && generation.current === current) { pending.current = null; setBusy(false); } }
  }
  async function importHistory() {
    if (busy) return;
    const controller = new AbortController(), current = ++generation.current;
    pending.current = controller; setBusy(true); setError(''); setNotice('Importing saved discussions…');
    let before, conversations = 0, imported = 0;
    try {
      do {
        const timeout = setTimeout(() => controller.abort(), 25000);
        let data;
        try { data = await api('/import', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 1, ...(before ? { before } : {}) }) }); }
        finally { clearTimeout(timeout); }
        if (!mounted.current || generation.current !== current) return;
        conversations += data.conversations || 0; imported += data.imported || 0; before = data.nextCursor;
        setNotice(`Imported ${imported} memories from ${conversations} saved discussions${before ? '…' : '.'}`);
      } while (before);
      await load();
    } catch (cause) { if (mounted.current && generation.current === current) setError(cause.name === 'AbortError' ? 'History import stopped. Import again to continue; previously imported entries will be preserved.' : cause.message); }
    finally { if (mounted.current && generation.current === current) { pending.current = null; setBusy(false); } }
  }
  return <section className="office-ai-memory" aria-label="Pip memory">
    <div className="office-ai-section-heading"><div><h2><Brain size={20} /> Memory and activity</h2><p>Recall discussions, task results, and execution receipts recorded through Office. This memory is shared with authorized Office operators.</p></div><button type="button" disabled={busy} onClick={() => load()}><RefreshCw size={14} />Refresh memory</button><button type="button" disabled={busy} onClick={importHistory}>Import saved discussions</button></div>
    <form className="office-ai-memory-search" onSubmit={event => { event.preventDefault(); load(); }}><label className="office-ai-field">Search memory<input type="search" maxLength={500} value={query} onChange={event => setQuery(event.target.value)} placeholder="An idea, change, decision, or task…" /></label><button type="submit" disabled={busy}><Search size={15} />Search</button></form>
    <p className="office-ai-form-note">Memory is encrypted in the Office database. It records activity handled by this application and cites the original record; it cannot observe unrelated activity on your devices. Outside sources and memories provide context, while the current request determines what to do.</p>
    {storageStats && <p className="office-ai-notice" role="status">Persistent knowledge storage · {storageStats.records ?? storageStats.totalRecords ?? 0} memories · {storageStats.artifacts ?? 0} file versions · {((storageStats.storedBytes || 0) / (1024 * 1024)).toFixed(2)} MB stored</p>}
    {error && <p className="office-ai-error" role="alert">{error}</p>}{notice && <p className="office-ai-notice" role="status">{notice}</p>}
    {busy && <p role="status">Loading memory…</p>}
    <div className="office-ai-memory-list">{entries.map(entry => <article key={entry.id} className="office-ai-memory-entry"><header><span>{labels[entry.kind] || entry.kind}{entry.mode ? ` · ${entry.mode}` : ''}{entry.status ? ` · ${entry.status}` : ''}</span><time dateTime={entry.createdAt}>{dateLabel(entry.createdAt)}</time></header><h3>{entry.title || 'Office memory'}</h3><details><summary>Trace this memory</summary><p>{entry.content}</p>{entry.referenceId && <small>Original record: {entry.referenceId}</small>}<small>Memory ID: {entry.id}</small></details><button type="button" disabled={busy} aria-label={`Forget ${entry.title || 'memory entry'}`} onClick={() => forget(entry.id)}><Trash2 size={13} />Forget</button></article>)}</div>
    {!busy && !error && !entries.length && <div className="office-ai-empty"><Brain size={28} /><h3>No matching memories</h3><p>Discussion and execution history will appear as Pip records your requests and results.</p></div>}
    {!!entries.length && <div className="office-ai-memory-clear">{clearReview ? <><p>Clear the searchable memory? Original saved chats and audit records remain in their own views.</p><button type="button" disabled={busy} onClick={() => forget()}>Confirm clear memory</button><button type="button" onClick={() => setClearReview(false)}>Keep memory</button></> : <button type="button" disabled={busy} onClick={() => setClearReview(true)}><Trash2 size={14} />Clear memory</button>}</div>}
  </section>;
}
