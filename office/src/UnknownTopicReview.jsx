import { useEffect, useId, useRef, useState } from 'react';
import { readOperation, operationNumber as num, operationDate as date } from './operations-runtime.mjs';
import './unknown-topic-review.css';

function httpsUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function PostMedia({ post }) {
  const media = httpsUrl(post.media_url), poster = httpsUrl(post.media_poster);
  const [failed,setFailed] = useState(false);
  useEffect(() => setFailed(false),[media,poster]);
  const kind = String(post.media_type || '').toLowerCase();
  const videoFile = media && /\.(?:mp4|webm|ogv|mov|m3u8)(?:$|[?#])/i.test(media);
  if (!media && !poster) return null;
  return <div className="utr-media">
    {!failed && (kind === 'image' || kind === 'photo') && media ? <img src={media} alt={post.title || 'Held post image'} referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} />
      : !failed && kind === 'video' && videoFile ? <video controls preload="none" poster={poster || undefined} src={media} onError={() => setFailed(true)} />
      : !failed && kind === 'audio' && media ? <audio controls preload="none" src={media} onError={() => setFailed(true)} />
      : !failed && poster ? <img src={poster} alt="Post preview" referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} /> : null}
    {failed && <p>Media preview unavailable.</p>}
    {media && <a href={media} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open media</a>}
  </div>;
}

export default function UnknownTopicReview({ apiBase = '', request, onAssigned, pendingCount }) {
  const [open,setOpen] = useState(false), [search,setSearch] = useState(''), [query,setQuery] = useState(''), [source,setSource] = useState('');
  const [cursor,setCursor] = useState(null), [history,setHistory] = useState([]), [revision,setRevision] = useState(0);
  const [page,setPage] = useState(null), [loading,setLoading] = useState(false), [listError,setListError] = useState('');
  const [selectedId,setSelectedId] = useState(null), [detail,setDetail] = useState(null), [detailRevision,setDetailRevision] = useState(0);
  const [detailLoading,setDetailLoading] = useState(false), [detailError,setDetailError] = useState(''), [topic,setTopic] = useState('');
  const [assigning,setAssigning] = useState(false), [result,setResult] = useState('');
  const epoch = useRef(0), listGeneration = useRef(0), detailGeneration = useRef(0), actionGeneration = useRef(0), assigningRef = useRef(false);
  const topicListId = useId();
  useEffect(() => {
    const clear = () => {
      epoch.current++; listGeneration.current++; detailGeneration.current++; actionGeneration.current++; assigningRef.current = false;
      setPage(null); setSelectedId(null); setDetail(null); setTopic(''); setSearch(''); setQuery(''); setSource(''); setCursor(null); setHistory([]);
      setListError(''); setDetailError(''); setResult(''); setAssigning(false); setRevision(value => value + 1);
    };
    clear(); window.addEventListener('office-token-changed',clear);
    return () => { epoch.current++; listGeneration.current++; detailGeneration.current++; actionGeneration.current++; window.removeEventListener('office-token-changed',clear); };
  },[apiBase,request]);
  useEffect(() => { const timer = window.setTimeout(() => { setQuery(search.trim()); setCursor(null); setHistory([]); },300); return () => window.clearTimeout(timer); },[search]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(), current = ++listGeneration.current, currentEpoch = epoch.current;
    const parameters = new URLSearchParams({ limit:'25', ...(query ? {q:query} : {}), ...(source ? {source} : {}), ...(cursor ? {cursor} : {}) });
    setLoading(true); setListError(''); setPage(null);
    request(`${apiBase}/office/topic-review?${parameters}`,{signal:controller.signal}).then(readOperation).then(body => {
      if (current === listGeneration.current && currentEpoch === epoch.current) setPage(body);
    }).catch(error => { if (current === listGeneration.current && currentEpoch === epoch.current && error.name !== 'AbortError') setListError(error.message); })
      .finally(() => { if (current === listGeneration.current && currentEpoch === epoch.current) setLoading(false); });
    return () => controller.abort();
  },[open,apiBase,request,query,source,cursor,revision]);
  useEffect(() => {
    const current = ++detailGeneration.current, currentEpoch = epoch.current;
    setDetail(null); setTopic(''); setDetailError('');
    if (!open || !selectedId) { setDetailLoading(false); return; }
    const controller = new AbortController(); setDetailLoading(true);
    request(`${apiBase}/office/topic-review/${encodeURIComponent(selectedId)}`,{signal:controller.signal}).then(readOperation).then(body => {
      if (current === detailGeneration.current && currentEpoch === epoch.current) { setDetail(body); setTopic(body.suggestions?.[0]?.topic || ''); }
    }).catch(error => { if (current === detailGeneration.current && currentEpoch === epoch.current && error.name !== 'AbortError') setDetailError(error.message); })
      .finally(() => { if (current === detailGeneration.current && currentEpoch === epoch.current) setDetailLoading(false); });
    return () => controller.abort();
  },[open,selectedId,detailRevision,apiBase,request]);
  function filterSource(value) { setSource(value); setCursor(null); setHistory([]); }
  function selectPost(id) { if (assigningRef.current) return; setSelectedId(id); setResult(''); }
  async function assign(event) {
    event.preventDefault();
    if (assigningRef.current || !detail?.item.pending || !detail.taxonomy?.some(row => row.topic === topic)) return;
    const current = ++actionGeneration.current, currentEpoch = epoch.current, id = detail.item.id, version = detail.item.version;
    assigningRef.current = true; setAssigning(true); setDetailError(''); setResult('');
    try {
      const body = await readOperation(await request(`${apiBase}/office/topic-review/${encodeURIComponent(id)}/assign`,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({topic,expectedVersion:version,confirmed:true})}));
      if (current !== actionGeneration.current || currentEpoch !== epoch.current) return;
      setResult(body.message || `Assigned to ${body.topic}.`); setSelectedId(null); setDetail(null); setTopic(''); setRevision(value => value + 1); onAssigned?.();
    } catch(error) { if (current === actionGeneration.current && currentEpoch === epoch.current) setDetailError(error.message); }
    finally { if (current === actionGeneration.current && currentEpoch === epoch.current) { assigningRef.current = false; setAssigning(false); } }
  }
  const post = detail?.item.post, sourceUrl = httpsUrl(post?.source_url);
  const validTopic = detail?.taxonomy?.some(row => row.topic === topic);
  return <section className="op-card unknown-topic-review" aria-label="Held post review">
    <div className="op-heading"><div><h2>Review held posts</h2><p>{pendingCount == null ? 'Inspect preserved posts and choose their topics.' : `${num(pendingCount)} posts are waiting for topic review.`}</p></div>
      <button aria-expanded={open} disabled={assigning} onClick={() => setOpen(value => !value)}>{open ? 'Hide held posts' : 'View held posts'}</button></div>
    {open && <>
      <p>Open a post to read its full content, preview its media, and assign a topic. Assigned posts return to the regular screening and transfer queue.</p>
      <div className="utr-filters"><label>Search held posts<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Title, text, or source" maxLength={200} /></label>
        <label>Source<select value={source} onChange={event => filterSource(event.target.value)}><option value="">All sources</option>{page?.sources?.map(row => row.source && <option key={row.source} value={row.source}>{row.source} ({num(row.count)})</option>)}</select></label>
        <button disabled={loading || assigning} onClick={() => setRevision(value => value + 1)}>Refresh held posts</button></div>
      {listError && <div className="op-error" role="alert">{listError}</div>}
      {result && <div className="op-notice" role="status">{result}</div>}
      <div className="utr-layout"><div className="utr-list-pane">
        <p className="utr-count" aria-live="polite">{loading ? 'Loading held posts…' : page ? `${num(page.total)} matching posts` : 'Review queue unavailable.'}</p>
        <ul className="utr-list" aria-label="Held posts">{page?.items?.map(item => <li key={item.id}><button type="button" className={item.id === selectedId ? 'selected' : ''} aria-pressed={item.id === selectedId} disabled={assigning} onClick={() => selectPost(item.id)}>
          <span className="utr-source">{item.source || 'Source not recorded'}{item.mediaType ? ` · ${item.mediaType}` : ''}</span><strong>{item.title}</strong><span className="utr-excerpt">{item.excerpt || 'Open this post to inspect its details.'}</span><small>Held {date(item.heldAt)}</small>
        </button></li>)}</ul>
        {!loading && page && !page.items.length && <p className="op-empty">{query || source ? 'No held posts match these filters.' : 'No held posts on this page.'}</p>}
        <div className="utr-pagination"><button disabled={loading || assigning || !history.length} onClick={() => { setCursor(history.at(-1)); setHistory(values => values.slice(0,-1)); }}>Previous page</button>
          <button disabled={loading || assigning || !page?.nextCursor} onClick={() => { setHistory(values => [...values,cursor]); setCursor(page.nextCursor); }}>Next page</button></div>
      </div><div className="utr-preview" aria-label="Held post preview" aria-busy={detailLoading}>
        {!selectedId && <p className="op-empty">Choose a held post to inspect it.</p>}
        {detailLoading && <p role="status">Loading the full post…</p>}
        {detailError && <div className="op-error" role="alert">{detailError}</div>}
        {selectedId && <button className="utr-refresh" disabled={detailLoading || assigning} onClick={() => setDetailRevision(value => value + 1)}>Refresh preview</button>}
        {post && <article>
          <div className="utr-post-meta"><span>{post.source || 'Source not recorded'}</span>{post.author_name && <span>{post.author_name}</span>}<span>{date(post.post_created_at)}</span></div>
          <h3>{post.title || 'Untitled post'}</h3>
          <PostMedia post={post} />
          <details className="utr-content" open><summary>Full post text</summary><div>{post.content || 'No additional text was stored for this post.'}</div></details>
          {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open source post</a> : <p>No HTTPS source link is available.</p>}
          {!detail.item.pending ? <p className="op-notice">This post has already been resolved. Refresh the queue to see remaining posts.</p> : <form className="utr-assignment" onSubmit={assign}>
            {!!detail.suggestions?.length && <div className="utr-suggestions"><span>Suggested topic</span>{detail.suggestions.map(suggestion => <button key={suggestion.topic} type="button" disabled={assigning} onClick={() => setTopic(suggestion.topic)}>{suggestion.topic}</button>)}</div>}
            <label>Assign topic<input aria-label="Assign topic" type="search" list={topicListId} value={topic} onChange={event => setTopic(event.target.value)} placeholder="Search the available topics" disabled={assigning} autoComplete="off" /></label>
            <datalist id={topicListId}>{detail.taxonomy?.map(row => <option key={row.topic} value={row.topic} />)}</datalist>
            {topic && !validTopic && <p>Choose a topic from the available list.</p>}
            <button className="op-primary" type="submit" disabled={assigning || !validTopic}>{assigning ? 'Assigning topic…' : 'Assign to topic'}</button>
          </form>}
        </article>}
      </div></div>
    </>}
  </section>;
}
