import { useEffect, useRef, useState } from 'react';
import { readOperation, operationNumber as num, operationDate as date } from './operations-runtime.mjs';
import TopicPicker from './TopicPicker';
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
  const [open,setOpen] = useState(false), [view,setView] = useState('groups');
  const [search,setSearch] = useState(''), [query,setQuery] = useState(''), [source,setSource] = useState('');
  const [cursor,setCursor] = useState(null), [history,setHistory] = useState([]), [revision,setRevision] = useState(0);
  const [page,setPage] = useState(null), [loading,setLoading] = useState(false), [listError,setListError] = useState('');
  const [groups,setGroups] = useState(null), [group,setGroup] = useState(null), [groupOffset,setGroupOffset] = useState(0);
  const [groupsLoading,setGroupsLoading] = useState(false), [groupsError,setGroupsError] = useState(''), [groupRevision,setGroupRevision] = useState(0);
  const [progress,setProgress] = useState(null), [indexing,setIndexing] = useState(false), [indexError,setIndexError] = useState(''), [indexRun,setIndexRun] = useState(0);
  const [selectedId,setSelectedId] = useState(null), [detail,setDetail] = useState(null), [detailRevision,setDetailRevision] = useState(0);
  const [detailLoading,setDetailLoading] = useState(false), [detailError,setDetailError] = useState(''), [topic,setTopic] = useState('');
  const [checked,setChecked] = useState([]), [batchTopic,setBatchTopic] = useState(''), [batchResults,setBatchResults] = useState(null);
  const [groupMembers,setGroupMembers] = useState(null), [selectingGroup,setSelectingGroup] = useState(false), [selectionProgress,setSelectionProgress] = useState(0);
  const [batchProgress,setBatchProgress] = useState(null), [stopping,setStopping] = useState(false);
  const [assigning,setAssigning] = useState(false), [result,setResult] = useState('');
  const [approvingGroup,setApprovingGroup] = useState(null), [approveProgress,setApproveProgress] = useState(null);
  const epoch = useRef(0), listGeneration = useRef(0), detailGeneration = useRef(0), groupGeneration = useRef(0), actionGeneration = useRef(0), assigningRef = useRef(false);
  const memberRequest = useRef(null), memberGeneration = useRef(0), stopBatch = useRef(false);
  useEffect(() => {
    const clear = () => {
      epoch.current++; listGeneration.current++; detailGeneration.current++; groupGeneration.current++; actionGeneration.current++; assigningRef.current = false;
      memberGeneration.current++; memberRequest.current?.abort(); stopBatch.current = true;
      setGroupMembers(null); setSelectingGroup(false); setSelectionProgress(0); setBatchProgress(null); setStopping(false);
      setPage(null); setGroups(null); setGroup(null); setGroupOffset(0); setProgress(null); setChecked([]); setBatchTopic(''); setBatchResults(null);
      setSelectedId(null); setDetail(null); setTopic(''); setSearch(''); setQuery(''); setSource(''); setCursor(null); setHistory([]); setView('groups');
      setListError(''); setGroupsError(''); setIndexError(''); setDetailError(''); setResult(''); setAssigning(false); setApprovingGroup(null); setApproveProgress(null); setRevision(value => value + 1); setIndexRun(value => value + 1);
    };
    clear(); window.addEventListener('office-token-changed',clear);
    return () => { epoch.current++; listGeneration.current++; detailGeneration.current++; groupGeneration.current++; actionGeneration.current++; memberGeneration.current++; memberRequest.current?.abort(); stopBatch.current = true; window.removeEventListener('office-token-changed',clear); };
  },[apiBase,request]);
  useEffect(() => { const timer = window.setTimeout(() => { setQuery(search.trim()); setCursor(null); setHistory([]); setGroupOffset(0); resetPage(); },300); return () => window.clearTimeout(timer); },[search]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(), currentEpoch = epoch.current;
    let active = true, wake;
    setIndexing(true); setIndexError('');
    const pause = ms => new Promise(resolve => { const timer = window.setTimeout(resolve,ms); wake = () => { window.clearTimeout(timer); resolve(); }; });
    async function index() {
      let complete = false;
      try {
        // Work through the entire backlog in small requests while this panel is open.
        // A fixed run limit also prevents an incoming stream from keeping this loop alive forever.
        for (let batch = 0; batch < 200 && active; batch++) {
          while (active && document.hidden) await pause(1000);
          if (!active) break;
          const body = await readOperation(await request(`${apiBase}/office/topic-review/groups/refresh`,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:'{}'}));
          if (!active || currentEpoch !== epoch.current) return;
          setProgress(body);
          if (batch % 4 === 0 || !body.remaining || !body.processed) setGroupRevision(value => value + 1);
          if (!body.remaining) { complete = true; break; }
          if (!body.processed) break;
          await pause(550);
        }
        if (active && !complete) setIndexError('Grouping paused. Resume to continue through the remaining posts.');
      } catch(error) { if (active && currentEpoch === epoch.current && error.name !== 'AbortError') setIndexError(error.message); }
      finally { if (active && currentEpoch === epoch.current) { setIndexing(false); setGroupRevision(value => value + 1); } }
    }
    index();
    return () => { active = false; controller.abort(); wake?.(); };
  },[open,apiBase,request,indexRun]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(), current = ++groupGeneration.current, currentEpoch = epoch.current;
    const parameters = new URLSearchParams({limit:'100',offset:String(groupOffset),...(query ? {q:query} : {}),...(source ? {source} : {})});
    setGroupsLoading(true); setGroupsError('');
    request(`${apiBase}/office/topic-review/groups?${parameters}`,{signal:controller.signal}).then(readOperation).then(body => {
      if (current === groupGeneration.current && currentEpoch === epoch.current) setGroups(body);
    }).catch(error => { if (current === groupGeneration.current && currentEpoch === epoch.current && error.name !== 'AbortError') { setGroups(null); setGroupsError(error.message); } })
      .finally(() => { if (current === groupGeneration.current && currentEpoch === epoch.current) setGroupsLoading(false); });
    return () => controller.abort();
  },[open,apiBase,request,query,source,groupOffset,groupRevision,revision]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(), current = ++listGeneration.current, currentEpoch = epoch.current;
    const parameters = new URLSearchParams({ limit:'25', ...(query ? {q:query} : {}), ...(source ? {source} : {}), ...(group ? {group:group.id} : {}), ...(cursor ? {cursor} : {}) });
    setLoading(true); setListError(''); setPage(null); setChecked([]);
    request(`${apiBase}/office/topic-review?${parameters}`,{signal:controller.signal}).then(readOperation).then(body => {
      if (current === listGeneration.current && currentEpoch === epoch.current) setPage(body);
    }).catch(error => { if (current === listGeneration.current && currentEpoch === epoch.current && error.name !== 'AbortError') setListError(error.message); })
      .finally(() => { if (current === listGeneration.current && currentEpoch === epoch.current) setLoading(false); });
    return () => controller.abort();
  },[open,apiBase,request,query,source,group,cursor,revision]);
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
  function clearSelection() { memberGeneration.current++; memberRequest.current?.abort(); setSelectingGroup(false); setGroupMembers(null); setSelectionProgress(0); setChecked([]); }
  function resetPage() { setCursor(null); setHistory([]); clearSelection(); setSelectedId(null); setDetail(null); setBatchResults(null); }
  function filterSource(value) { setSource(value); setGroupOffset(0); resetPage(); }
  function selectGroup(value) { setGroup(value); setView(value ? 'posts' : 'groups'); setBatchTopic(value?.topic || ''); resetPage(); }
  function selectPost(id) { if (assigningRef.current) return; setSelectedId(id); }
  function changePage(next) { if (!groupMembers) clearSelection(); else setChecked([]); setSelectedId(null); setCursor(next); }
  function refresh() { resetPage(); setRevision(value => value + 1); setIndexRun(value => value + 1); }
  async function assign(event) {
    event.preventDefault();
    if (assigningRef.current || !detail?.item.pending || !detail.taxonomy?.some(row => row.topic === topic)) return;
    const current = ++actionGeneration.current, currentEpoch = epoch.current, id = detail.item.id, version = detail.item.version;
    assigningRef.current = true; setAssigning(true); setDetailError(''); setResult(''); setBatchResults(null);
    try {
      const body = await readOperation(await request(`${apiBase}/office/topic-review/${encodeURIComponent(id)}/assign`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic,expectedVersion:version,confirmed:true})}));
      if (current !== actionGeneration.current || currentEpoch !== epoch.current) return;
      setResult(body.message || `Assigned to ${body.topic}.`); resetPage(); setTopic(''); setRevision(value => value + 1); onAssigned?.();
    } catch(error) { if (current === actionGeneration.current && currentEpoch === epoch.current) setDetailError(error.message); }
    finally { if (current === actionGeneration.current && currentEpoch === epoch.current) { assigningRef.current = false; setAssigning(false); } }
  }
  const taxonomy = groups?.taxonomy || page?.taxonomy || detail?.taxonomy || [];
  const batchItems = groupMembers || (page?.items || []).filter(item => checked.includes(item.id) && item.version).map(item => ({id:item.id,expectedVersion:item.version}));
  const selectedIds = new Set(batchItems.map(item => item.id));
  const validBatchTopic = taxonomy.some(row => row.topic === batchTopic);
  async function selectWholeGroup() {
    if (!group || assigningRef.current || selectingGroup) return;
    const current = ++memberGeneration.current, currentEpoch = epoch.current, controller = new AbortController();
    memberRequest.current?.abort(); memberRequest.current = controller;
    setSelectingGroup(true); setSelectionProgress(0); setListError(''); setGroupMembers(null); setChecked([]);
    try {
      let after = null, members = [];
      do {
        const parameters = new URLSearchParams({...(query ? {q:query} : {}),...(source ? {source} : {}),...(after ? {cursor:after} : {})});
        const body = await readOperation(await request(`${apiBase}/office/topic-review/groups/${encodeURIComponent(group.id)}/members?${parameters}`,{signal:controller.signal}));
        if (current !== memberGeneration.current || currentEpoch !== epoch.current) return;
        members.push(...body.items); setSelectionProgress(members.length); after = body.nextCursor;
      } while (after);
      if (current === memberGeneration.current && currentEpoch === epoch.current) { setGroupMembers(members); setBatchResults(null); }
    } catch(error) { if (current === memberGeneration.current && currentEpoch === epoch.current && error.name !== 'AbortError') setListError(error.message); }
    finally { if (current === memberGeneration.current && currentEpoch === epoch.current) { setSelectingGroup(false); memberRequest.current = null; } }
  }
  function checkPost(item, selected) {
    if (groupMembers) setGroupMembers(values => selected ? [...values,{id:item.id,expectedVersion:item.version}] : values.filter(value => value.id !== item.id));
    else setChecked(values => selected ? [...values,item.id] : values.filter(id => id !== item.id));
  }
  function checkPage(selected) {
    if (groupMembers) setGroupMembers(values => selected ? [...values,...selectable.filter(item => !selectedIds.has(item.id)).map(item => ({id:item.id,expectedVersion:item.version}))] : values.filter(value => !selectable.some(item => item.id === value.id)));
    else setChecked(selected ? selectable.map(item => item.id) : []);
  }
  async function assignBatch(event) {
    event.preventDefault();
    if (assigningRef.current || !batchItems.length || !validBatchTopic) return;
    const current = ++actionGeneration.current, currentEpoch = epoch.current;
    const items = [...batchItems], aggregate = {assigned:0,replayed:0,conflicts:0,failed:0,results:[]};
    let completed = 0;
    assigningRef.current = true; stopBatch.current = false; setStopping(false); setAssigning(true); setBatchProgress({completed:0,total:items.length}); setListError(''); setResult(''); setBatchResults(null);
    try {
      for (let offset = 0; offset < items.length; offset += 100) {
        if (stopBatch.current || current !== actionGeneration.current || currentEpoch !== epoch.current) break;
        const chunk = items.slice(offset,offset + 100);
        const body = await readOperation(await request(`${apiBase}/office/topic-review/batch-assign`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:chunk,topic:batchTopic,confirmed:true})}));
        if (current !== actionGeneration.current || currentEpoch !== epoch.current) return;
        for (const key of ['assigned','replayed','conflicts','failed']) aggregate[key] += Number(body[key] || 0);
        aggregate.results.push(...(body.results || []).filter(item => !item.ok));
        completed += chunk.length; setBatchProgress({completed,total:items.length});
        if (offset + 100 < items.length && !stopBatch.current) await new Promise(resolve => window.setTimeout(resolve,1100));
      }
      if (current !== actionGeneration.current || currentEpoch !== epoch.current) return;
      setResult(`${num(aggregate.assigned)} posts assigned to ${batchTopic}.${completed < items.length ? ` Stopped with ${num(items.length - completed)} selected posts still unprocessed.` : ''}`);
    } catch(error) { if (current === actionGeneration.current && currentEpoch === epoch.current) setListError(`${error.message} Completed batch results are shown below. Refresh the queue before retrying the remaining posts.`); }
    finally { if (current === actionGeneration.current && currentEpoch === epoch.current) { resetPage(); setBatchResults(aggregate); setRevision(value => value + 1); onAssigned?.(); assigningRef.current = false; setAssigning(false); setBatchProgress(null); setStopping(false); } }
  }
  async function approveSuggestedGroup(item) {
    // Approves the suggested topic the system already computed for this group.
    // The button never submits a topic chosen in the browser; the server holds
    // the only copy of the suggested topic for the group.
    if (assigningRef.current || approvingGroup) return;
    const current = ++actionGeneration.current, currentEpoch = epoch.current, id = item.id, label = item.label;
    assigningRef.current = true; setAssigning(true); setApprovingGroup(id); setApproveProgress({approved:item.count,topic:item.topic || '',done:0}); setListError(''); setResult(''); setBatchResults(null);
    try {
      let remaining = null, total = 0, assignedCount = 0, replayedCount = 0, conflictCount = 0, failedCount = 0, guard = 0, bodyTopic = '';
      do {
        const body = await readOperation(await request(`${apiBase}/office/topic-review/groups/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({group:id,confirmed:true})}));
        if (current !== actionGeneration.current || currentEpoch !== epoch.current) return;
        remaining = Number(body.remaining || 0); bodyTopic = body.topic || '';
        total += (Number(body.assigned || 0) + Number(body.replayed || 0) + Number(body.conflicts || 0) + Number(body.failed || 0));
        assignedCount += Number(body.assigned || 0); replayedCount += Number(body.replayed || 0); conflictCount += Number(body.conflicts || 0); failedCount += Number(body.failed || 0);
        guard += 1; setApproveProgress({approved:item.count,topic:bodyTopic || item.topic || '',done:total,remaining});
      } while (remaining > 0 && guard < 50);
      setResult(`Approved ${label}: ${num(assignedCount)} posts assigned to ${bodyTopic}. ${num(conflictCount)} changed or conflicted; ${num(failedCount)} failed; ${num(remaining || 0)} still pending in this group.${remaining > 0 ? ' Approve again to continue with the rest.' : ''}`);
      setRevision(value => value + 1); setIndexRun(value => value + 1); onAssigned?.();
    } catch(error) { if (current === actionGeneration.current && currentEpoch === epoch.current) setListError(`${error.message} Completed approval results are shown below. Refresh the queue before retrying the remaining posts.`); }
    finally { if (current === actionGeneration.current && currentEpoch === epoch.current) { assigningRef.current = false; setAssigning(false); setApprovingGroup(null); setApproveProgress(null); } }
  }
  const post = detail?.item.post, sourceUrl = httpsUrl(post?.source_url), validTopic = detail?.taxonomy?.some(row => row.topic === topic);
  const selectable = (page?.items || []).filter(item => item.version), counts = indexing ? progress || groups : groups || progress;
  const sources = groups?.sources || page?.sources || [];
  return <section className="op-card unknown-topic-review" aria-label="Held post review">
    <div className="op-heading"><div><h2>Review held posts</h2><p>{pendingCount == null ? 'Find related posts and review them together.' : `${num(pendingCount)} posts are waiting for topic review.`}</p></div>
      <button aria-expanded={open} disabled={assigning} onClick={() => { if (open) clearSelection(); setOpen(value => !value); }}>{open ? 'Hide held posts' : 'View held posts'}</button></div>
    {open && <>
      <p>Related posts are grouped automatically by topic or shared words. Review a group, choose a topic, and assign selected posts together. Each post keeps its full content and returns to normal screening.</p>
      <div className="utr-index-status" role="status">{indexing ? 'Grouping held posts… ' : 'Automatic groups: '}{counts ? `${num(counts.indexed)} of ${num(counts.total)} pending posts grouped${counts.remaining ? ` · ${num(counts.remaining)} remaining` : ''}.` : 'Preparing groups…'}
        {indexError && <><span>{indexError}</span><button type="button" disabled={indexing || assigning} onClick={() => setIndexRun(value => value + 1)}>Resume grouping</button></>}
      </div>
      <div className="utr-filters"><label>Find topics or posts<input type="search" value={search} disabled={assigning} onChange={event => { setSearch(event.target.value); clearSelection(); }} placeholder="Topic, title, text, or source" maxLength={200} /></label>
        <label>Source<select value={source} disabled={assigning} onChange={event => filterSource(event.target.value)}><option value="">All sources</option>{sources.map(row => row.source && <option key={row.source} value={row.source}>{row.source} ({num(row.count)})</option>)}</select></label>
        <button disabled={loading || assigning || indexing} onClick={refresh}>Refresh held posts</button></div>
      <div className="utr-view-controls" role="group" aria-label="Review view"><button type="button" aria-pressed={view === 'groups'} disabled={assigning} onClick={() => selectGroup(null)}>Topic groups</button><button type="button" aria-pressed={view === 'posts' && !group} disabled={assigning} onClick={() => { setGroup(null); setView('posts'); resetPage(); }}>Individual posts</button></div>
      {listError && <div className="op-error" role="alert">{listError}</div>}
      {groupsError && <div className="op-error" role="alert">{groupsError}</div>}
      {result && <div className="op-notice" role="status">{result}</div>}
      {batchResults && <div className="utr-batch-result"><p>{num(batchResults.assigned)} assigned · {num(batchResults.replayed)} already queued · {num(batchResults.conflicts)} changed or conflicted · {num(batchResults.failed)} failed.</p>
        {batchResults.results?.some(item => item.ok === false || item.status === 'conflict' || item.status === 'failed') && <details><summary>Posts that need another review</summary><ul>{batchResults.results.filter(item => item.ok === false || item.status === 'conflict' || item.status === 'failed').map(item => <li key={item.id}>{item.id}: {item.message || item.error || 'Refresh this post before retrying.'}</li>)}</ul></details>}
      </div>}
      {view === 'groups' ? <div className="utr-groups" aria-busy={groupsLoading}>
        <p aria-live="polite">{groupsLoading && !groups ? 'Loading topic groups…' : `${num(groups?.totalGroups || 0)} matching groups. Largest groups appear first.`}</p>
        <div className="utr-group-grid">{groups?.groups?.map(item => <div key={item.id} className="utr-group-card" aria-label={`${item.label} group`}>
          <span className="utr-group-count">{num(item.count)} posts</span><strong>{item.label}</strong><span className="utr-group-method">{{topic:'Suggested topic',ambiguous:'Competing topic matches',keyword:'Shared words',hashtag:'Shared hashtag',source:'Same source; topic needs review'}[item.method] || 'Related posts'}{item.topic && item.label !== item.topic ? ` · ${item.topic}` : ''}</span>
          {!!item.samples?.length && <span className="utr-group-samples">{item.samples.slice(0,3).map(sample => <span key={sample.id}>{sample.title || 'Untitled post'}</span>)}</span>}
          <span className="utr-group-actions">
            <button type="button" aria-label={`Review ${item.label} group`} disabled={assigning || !!approvingGroup} onClick={() => selectGroup(item)}>Review</button>
            {item.topic
              ? <button type="button" className="op-primary" aria-label={`Approved ${item.label} group`} disabled={assigning || !!approvingGroup} onClick={() => approveSuggestedGroup(item)}>{approvingGroup === item.id ? `Approving ${num(approveProgress?.done || 0)} of ${num(item.count)}…` : 'Approved'}</button>
              : <span className="utr-group-note">Review needed before approval</span>}
          </span>
        </div>)}</div>
        {groups && !groupsLoading && !groups.groups?.length && <p className="op-empty">{indexing ? 'Groups will appear as the backlog is processed.' : 'No groups match these filters.'}</p>}
        <nav className="utr-pagination" aria-label="Topic group pages"><button disabled={groupsLoading || assigning || !groupOffset} onClick={() => setGroupOffset(value => Math.max(0,value - 100))}>Previous groups</button><span>Page {Math.floor(groupOffset / 100) + 1}</span><button disabled={groupsLoading || assigning || !groups?.hasMore} onClick={() => setGroupOffset(groups.nextOffset)}>Next groups</button></nav>
      </div> : <>
        {group && <div className="utr-selected-group"><div><h3>{group.label}</h3><p>Inspect the posts in this group before assigning their topic.</p></div><div className="utr-group-actions"><button type="button" disabled={assigning || selectingGroup || loading || !page?.total} onClick={selectWholeGroup}>{selectingGroup ? `Selecting ${num(selectionProgress)} posts…` : 'Select all posts in this group'}</button><button type="button" disabled={assigning} onClick={() => selectGroup(null)}>All topic groups</button></div></div>}
        {selectingGroup && <p role="status">Preparing a snapshot of this group: {num(selectionProgress)} posts selected. New arrivals will need a separate review.</p>}
        {!selectingGroup && groupMembers && <p role="status">Group snapshot ready: {num(groupMembers.length)} posts selected. Choose their topic below. You can inspect other pages without changing this selection.</p>}
        <div className="utr-layout"><div className="utr-list-pane">
          <p className="utr-count" aria-live="polite">{loading ? 'Loading held posts…' : page ? `${num(page.total)} matching posts` : 'Review queue unavailable.'}</p>
          {!!batchItems.length && <form className="utr-batch-assignment" onSubmit={assignBatch}><h3>{num(batchItems.length)} posts selected</h3><p>{groupMembers ? 'This selection is a snapshot of the group.' : 'This selection contains the posts checked on this page.'} Changed posts remain available for another review.</p>
            <TopicPicker taxonomy={taxonomy} value={batchTopic} onChange={setBatchTopic} label="Topic for selected posts" disabled={assigning} />
            {batchTopic && !validBatchTopic && <small>Choose an available topic.</small>}
            <button className="op-primary" type="submit" disabled={assigning || !validBatchTopic || !batchItems.length}>{assigning ? 'Assigning selected posts…' : `Assign ${num(batchItems.length)} selected posts`}</button>
            <button type="button" disabled={assigning} onClick={clearSelection}>Clear selection</button>
            {batchProgress && <><p role="status">Processed {num(batchProgress.completed)} of {num(batchProgress.total)} selected posts.</p><button type="button" disabled={stopping} onClick={() => { stopBatch.current = true; setStopping(true); }}>{stopping ? 'Stopping after this batch…' : 'Stop after this batch'}</button></>}
          </form>}
          {!!selectable.length && <label className="utr-select-page"><input type="checkbox" disabled={loading || assigning || selectingGroup} checked={selectable.every(item => selectedIds.has(item.id))} onChange={event => checkPage(event.target.checked)} />Select all posts on this page</label>}
          <ul className="utr-list" aria-label="Held posts">{page?.items?.map(item => <li key={item.id} className="utr-post-row">
            <label className="utr-post-check"><input type="checkbox" aria-label={`Select ${item.title}`} disabled={assigning || selectingGroup || !item.version} checked={selectedIds.has(item.id)} onChange={event => checkPost(item,event.target.checked)} /></label>
            <button type="button" className={item.id === selectedId ? 'selected' : ''} aria-pressed={item.id === selectedId} disabled={assigning} onClick={() => selectPost(item.id)}>
              <span className="utr-source">{item.source || 'Source not recorded'}{item.mediaType ? ` · ${item.mediaType}` : ''}</span><strong>{item.title}</strong><span className="utr-excerpt">{item.excerpt || 'Open this post to inspect its details.'}</span><small>Held {date(item.heldAt)}</small>
            </button></li>)}</ul>
          {!loading && page && !page.items.length && <p className="op-empty">{query || source || group ? 'No held posts match these filters.' : 'No held posts on this page.'}</p>}
          <div className="utr-pagination"><button disabled={loading || assigning || !history.length} onClick={() => { changePage(history.at(-1)); setHistory(values => values.slice(0,-1)); }}>Previous page</button>
            <button disabled={loading || assigning || !page?.nextCursor} onClick={() => { setHistory(values => [...values,cursor]); changePage(page.nextCursor); }}>Next page</button></div>
        </div><div className="utr-preview" aria-label="Held post preview" aria-busy={detailLoading}>
          {!selectedId && <p className="op-empty">Choose a held post to read its full content and preview media. Use the checkboxes to review several posts together.</p>}
          {detailLoading && <p role="status">Loading the full post…</p>}
          {detailError && <div className="op-error" role="alert">{detailError}</div>}
          {selectedId && <button className="utr-refresh" disabled={detailLoading || assigning} onClick={() => setDetailRevision(value => value + 1)}>Refresh preview</button>}
          {post && <article>
            <div className="utr-post-meta"><span>{post.source || 'Source not recorded'}</span>{post.author_name && <span>{post.author_name}</span>}<span>{date(post.post_created_at)}</span></div>
            <h3>{post.title || 'Untitled post'}</h3><PostMedia post={post} />
            <details className="utr-content" open><summary>Full post text</summary><div>{post.content || 'No additional text was stored for this post.'}</div></details>
            {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open source post</a> : <p>No HTTPS source link is available.</p>}
            {!detail.item.pending ? <p className="op-notice">This post has already been resolved. Refresh the queue to see remaining posts.</p> : <form className="utr-assignment" onSubmit={assign}>
              {!!detail.suggestions?.length && <div className="utr-suggestions"><span>Suggested topic</span>{detail.suggestions.map(suggestion => <button key={suggestion.topic} type="button" disabled={assigning} onClick={() => setTopic(suggestion.topic)}>{suggestion.topic}</button>)}</div>}
              <TopicPicker taxonomy={detail.taxonomy} value={topic} onChange={setTopic} disabled={assigning} />
              {topic && !validTopic && <p>Choose a topic from the available list.</p>}
              <button className="op-primary" type="submit" disabled={assigning || !validTopic}>{assigning ? 'Assigning topic…' : 'Assign to topic'}</button>
            </form>}
          </article>}
        </div></div>
      </>}
    </>}
  </section>;
}
