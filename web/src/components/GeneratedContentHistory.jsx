import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Download, RefreshCw, Search } from 'lucide-react';
import client from '../api/client';
import { useToast } from '../contexts/ToastContext';
import './GeneratedContentHistory.css';

const LABELS = { draft: 'AI drafts', hashtags: 'Hashtag sets', image: 'Image', video: 'Video' };

function textFor(item) {
  return item.kind === 'hashtags'
    ? (item.output.groups || []).map(group => `${group.label}\n${group.hashtags.join(' ')}`).join('\n\n')
    : (item.output.drafts || []).join('\n\n');
}

export default function GeneratedContentHistory({ section, revision = 0, onReuse, onUseMedia }) {
  const { showToast } = useToast();
  const [items, setItems] = useState([]);
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [refreshing, setRefreshing] = useState(null);
  const request = useRef(0);

  const load = useCallback(async (after = null) => {
    const id = ++request.current;
    setLoading(true); setError('');
    try {
      const { data } = await client.get('/command-center/history', { params: { section, kind, q: search, cursor: after || undefined } });
      if (id !== request.current) return;
      setItems(current => after ? [...current, ...(data.items || []).filter(item => !current.some(old => old.id === item.id))] : (data.items || []));
      setCursor(data.nextCursor || null);
    } catch (err) {
      if (id === request.current) setError(err.response?.data?.message || 'Could not load previous content. Please retry.');
    } finally { if (id === request.current) setLoading(false); }
  }, [section, kind, search]);

  useEffect(() => {
    setItems([]); setCursor(null); setExpanded(null);
    load();
    return () => { request.current += 1; };
  }, [load, revision]);

  const pendingIds = items.filter(item => item.status === 'processing').map(item => item.id).join(',');
  useEffect(() => {
    if (!pendingIds) return;
    let active = true;
    const timer = window.setInterval(async () => {
      if (document.hidden) return;
      for (const id of pendingIds.split(',')) {
        try {
          const { data } = await client.get(`/command-center/history/${encodeURIComponent(id)}`);
          if (active) setItems(current => current.map(item => item.id === id ? data.item : item));
        } catch { /* The explicit refresh control surfaces retryable failures. */ }
      }
    }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [pendingIds]);

  async function refreshItem(item) {
    setRefreshing(item.id);
    try {
      const { data } = await client.post(`/command-center/history/${encodeURIComponent(item.id)}/refresh`, {}, { timeout: 180000 });
      setItems(current => current.map(row => row.id === item.id ? data.item : row));
    } catch (err) { showToast(err.response?.data?.message || 'Could not refresh this video.', 'error'); }
    finally { setRefreshing(null); }
  }

  async function copy(item) {
    try { await navigator.clipboard.writeText(textFor(item)); showToast('Copied', 'success'); }
    catch { showToast('Could not copy. Select the text and copy it manually.', 'error'); }
  }

  async function download(item) {
    try {
      const media = item.output.mediaUrl;
      const blob = media ? await fetch(media).then(response => {
        if (!response.ok) throw new Error('Download unavailable');
        return response.blob();
      }) : new Blob([textFor(item)], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `uficonnect-${item.kind}-${item.id}.${media ? (item.kind === 'video' ? 'mp4' : 'png') : 'txt'}`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { showToast('Could not download this content. Please retry.', 'error'); }
  }

  return (
    <section className="generated-history" aria-label={section === 'media' ? 'Previous Studio media' : 'Previous AI content'}>
      <div className="generated-history-heading">
        <h3>Previous content</h3>
        <button className="btn btn-ghost btn-sm" type="button" aria-label="Refresh history" title="Refresh history" disabled={loading} onClick={() => load()}><RefreshCw size={17} /></button>
      </div>
      <form className="generated-history-filters" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); }}>
        <input className="form-input" type="search" aria-label="Search previous content" placeholder="Search previous content" value={query} onChange={event => setQuery(event.target.value)} />
        <button className="btn btn-ghost btn-sm" aria-label="Search history" title="Search history"><Search size={17} /></button>
        <select className="form-input" aria-label="Content type" value={kind} onChange={event => setKind(event.target.value)}>
          <option value="">All types</option>
          {(section === 'media' ? ['image', 'video'] : ['draft', 'hashtags']).map(value => <option key={value} value={value}>{LABELS[value]}</option>)}
        </select>
      </form>
      {error && <div role="alert" className="generated-history-error">{error} <button className="btn btn-ghost btn-sm" onClick={() => load()}>Retry</button></div>}
      {!error && !loading && !items.length && <p className="generated-history-empty">{search || kind ? 'No matching content.' : 'No saved content yet.'}</p>}
      {items.map(item => {
        const open = expanded === item.id;
        const media = item.output?.mediaUrl;
        return (
          <article className="generated-history-item" key={item.id}>
            <button className="generated-history-row" type="button" aria-expanded={open} aria-controls={`history-${item.id}`} onClick={() => setExpanded(open ? null : item.id)}>
              {item.kind === 'image' && media && <img src={media} alt="" loading="lazy" />}
              <span className="generated-history-summary">
                <strong>{item.prompt || LABELS[item.kind]}</strong>
                <span>{LABELS[item.kind]}{item.input?.platform ? ` / ${item.input.platform}` : ''} / {new Date(item.createdAt).toLocaleString()}{item.status !== 'completed' ? ` / ${item.status === 'failed' ? 'Failed' : 'Processing'}` : ''}</span>
              </span>
              {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            {open && <div className="generated-history-detail" id={`history-${item.id}`}>
              {media && (item.kind === 'video'
                ? <video src={media} controls playsInline preload="metadata" />
                : <img src={media} alt={item.prompt || 'Saved Studio image'} loading="lazy" />)}
              {item.output?.drafts?.map((draft, index) => <p className="generated-history-text" key={index}>{draft}</p>)}
              {item.output?.groups?.map((group, index) => <div className="generated-history-text" key={index}><strong>{group.label}</strong><p>{group.hashtags.join(' ')}</p></div>)}
              {item.output?.error && <p role="status">{item.output.error}</p>}
              <div className="generated-history-actions">
                {item.status === 'completed' && <>
                  {!media && <button className="btn btn-ghost btn-sm" title="Copy all" aria-label="Copy all" onClick={() => copy(item)}><Copy size={17} /></button>}
                  <button className="btn btn-ghost btn-sm" title="Download" aria-label="Download saved content" onClick={() => download(item)}><Download size={17} /></button>
                </>}
                {onReuse && <button className="btn btn-ghost btn-sm" onClick={() => onReuse(item)}>Reuse prompt</button>}
                {media && onUseMedia && <button className="btn btn-primary btn-sm" onClick={() => onUseMedia({ url: media, type: item.kind })}>Use in Cross-Post</button>}
                {item.status === 'processing' && item.resumable && <button className="btn btn-ghost btn-sm" disabled={refreshing === item.id} onClick={() => refreshItem(item)}><RefreshCw size={16} /> Check video status</button>}
              </div>
            </div>}
          </article>
        );
      })}
      {loading && <p role="status" className="generated-history-empty">Loading history...</p>}
      {cursor && <button className="btn btn-ghost" disabled={loading} onClick={() => load(cursor)}>Load more</button>}
    </section>
  );
}
