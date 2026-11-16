import { useEffect, useMemo, useRef, useState } from 'react';
import { readOperation, operationNumber as num, operationDate as date } from './operations-runtime.mjs';
import TopicPicker from './TopicPicker';
import { createVisibleOfficePoller } from './office-polling.mjs';
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
  const [progress,setProgress] = useState(null), [indexError,setIndexError] = useState(''), [indexRun,setIndexRun] = useState(0);
  const [selectedId,setSelectedId] = useState(null), [detail,setDetail] = useState(null), [detailRevision,setDetailRevision] = useState(0);
  const [detailLoading,setDetailLoading] = useState(false), [detailError,setDetailError] = useState(''), [topic,setTopic] = useState('');
  const [checked,setChecked] = useState([]), [batchTopic,setBatchTopic] = useState('');
  const [subtopic,setSubtopic] = useState(''), [batchSubtopic,setBatchSubtopic] = useState('');
  const [groupMembers,setGroupMembers] = useState(null), [selectingGroup,setSelectingGroup] = useState(false), [selectionProgress,setSelectionProgress] = useState(0);
  const [assigning,setAssigning] = useState(false), [result,setResult] = useState('');
  const [jobs,setJobs] = useState(null), [jobsError,setJobsError] = useState(''), [actionError,setActionError] = useState('');
  const [submitting,setSubmitting] = useState(''), [stopping,setStopping] = useState('');
  const epoch = useRef(0), listGeneration = useRef(0), detailGeneration = useRef(0), groupGeneration = useRef(0), actionGeneration = useRef(0), assigningRef = useRef(false);
  const memberRequest = useRef(null), memberGeneration = useRef(0);
  const jobPoller = useRef(null), jobState = useRef(null), jobReadGeneration = useRef(0), stoppingRef = useRef(false);
  const assignment = jobs?.assignment, distribution = jobs?.distribution;
  const distributing = submitting === 'distribution' || distribution?.status === 'running';
  const working = assigning || Boolean(submitting) || assignment?.status === 'running' || distributing;
  const rememberJobs = next => { jobState.current = next; setJobs(next); };

  useEffect(() => {
    const clear = () => {
      epoch.current++; listGeneration.current++; detailGeneration.current++; groupGeneration.current++; actionGeneration.current++; assigningRef.current = false;
      memberGeneration.current++; memberRequest.current?.abort(); jobReadGeneration.current++; stoppingRef.current = false;
      rememberJobs(null); setJobsError(''); setActionError(''); setSubmitting(''); setStopping('');
      setGroupMembers(null); setSelectingGroup(false); setSelectionProgress(0);
      setPage(null); setGroups(null); setGroup(null); setGroupOffset(0); setProgress(null); setChecked([]); setBatchTopic(''); setBatchSubtopic('');
      setSelectedId(null); setDetail(null); setTopic(''); setSubtopic(''); setSearch(''); setQuery(''); setSource(''); setCursor(null); setHistory([]); setView('groups');
      setListError(''); setGroupsError(''); setIndexError(''); setDetailError(''); setResult(''); setAssigning(false); setRevision(value => value + 1); setIndexRun(value => value + 1);
      jobPoller.current?.refresh();
    };
    clear(); window.addEventListener('office-token-changed',clear);
    return () => {
      epoch.current++; listGeneration.current++; detailGeneration.current++; groupGeneration.current++; actionGeneration.current++; jobReadGeneration.current++;
      memberGeneration.current++; memberRequest.current?.abort(); window.removeEventListener('office-token-changed',clear);
    };
  },[apiBase,request]);

  useEffect(() => {
    const poller = createVisibleOfficePoller({
      intervalMs: () => Object.values(jobState.current || {}).some(job => job?.status === 'running') ? 1500 : 15000,
      task: async ({ signal }) => {
        const current = jobReadGeneration.current;
        let next;
        try {
          next = await readOperation(await request(`${apiBase}/office/topic-review/jobs`,{signal}));
          if (!Number.isSafeInteger(next.pending) || next.pending < 0) throw new Error('Held-post job status is unavailable.');
        } catch (error) {
          if (!signal.aborted && current === jobReadGeneration.current) setJobsError(error.message);
          return;
        }
        if (signal.aborted || current !== jobReadGeneration.current) return;
        const finished = ['assignment','distribution'].some(kind =>
          jobState.current?.[kind]?.status === 'running' && next[kind]?.status !== 'running');
        rememberJobs(next); setJobsError('');
        if (finished) { setRevision(value => value + 1); setIndexRun(value => value + 1); onAssigned?.(); }
      },
    });
    jobPoller.current = poller;
    return () => { poller.stop(); jobPoller.current = null; };
  },[apiBase,request,onAssigned]);
  useEffect(() => {
    const next = search.trim();
    if (next === query) return;
    const timer = window.setTimeout(() => { setQuery(next); setGroupOffset(0); resetPage(); },300);
    return () => window.clearTimeout(timer);
  },[search,query]);
  useEffect(() => {
    if (!open) return;
    let lastProgress;
    const poller = createVisibleOfficePoller({
      intervalMs: () => lastProgress?.remaining ? 5000 : 15000,
      task: async ({ signal }) => {
        const next = await readOperation(await request(`${apiBase}/office/topic-review/groups/progress`,{signal}));
        if (signal.aborted) return;
        if (lastProgress && (next.indexed !== lastProgress.indexed || next.total !== lastProgress.total)) {
          setGroupRevision(value => value + 1);
        }
        lastProgress = next;
        setProgress(next); setIndexError('');
      },
      onError: error => setIndexError(error.message),
    });
    return () => poller.stop();
  },[open,apiBase,request,indexRun]);
  useEffect(() => {
    if (!open || view !== 'groups') return;
    const controller = new AbortController(), current = ++groupGeneration.current, currentEpoch = epoch.current;
    const parameters = new URLSearchParams({limit:'100',offset:String(groupOffset),...(query ? {q:query} : {}),...(source ? {source} : {})});
    setGroupsLoading(true); setGroupsError('');
    request(`${apiBase}/office/topic-review/groups?${parameters}`,{signal:controller.signal}).then(readOperation).then(body => {
      if (current === groupGeneration.current && currentEpoch === epoch.current) setGroups(body);
    }).catch(error => { if (current === groupGeneration.current && currentEpoch === epoch.current && error.name !== 'AbortError') { setGroups(null); setGroupsError(error.message); } })
      .finally(() => { if (current === groupGeneration.current && currentEpoch === epoch.current) setGroupsLoading(false); });
    return () => controller.abort();
  },[open,view,apiBase,request,query,source,groupOffset,groupRevision,revision]);
  useEffect(() => {
    if (!open || view !== 'posts') { setLoading(false); return; }
    const controller = new AbortController(), current = ++listGeneration.current, currentEpoch = epoch.current;
    const parameters = new URLSearchParams({ limit:'25', ...(query ? {q:query} : {}), ...(source ? {source} : {}), ...(group ? {group:group.id} : {}), ...(cursor ? {cursor} : {}) });
    setLoading(true); setListError(''); setPage(null); setChecked([]);
    request(`${apiBase}/office/topic-review?${parameters}`,{signal:controller.signal}).then(readOperation).then(body => {
      if (current === listGeneration.current && currentEpoch === epoch.current) setPage(body);
    }).catch(error => { if (current === listGeneration.current && currentEpoch === epoch.current && error.name !== 'AbortError') setListError(error.message); })
      .finally(() => { if (current === listGeneration.current && currentEpoch === epoch.current) setLoading(false); });
    return () => controller.abort();
  },[open,view,apiBase,request,query,source,group,cursor,revision]);
  useEffect(() => {
    const current = ++detailGeneration.current, currentEpoch = epoch.current;
    setDetail(null); setTopic(''); setSubtopic(''); setDetailError('');
    if (!open || !selectedId) { setDetailLoading(false); return; }
    const controller = new AbortController(); setDetailLoading(true);
    request(`${apiBase}/office/topic-review/${encodeURIComponent(selectedId)}`,{signal:controller.signal}).then(readOperation).then(body => {
      if (current === detailGeneration.current && currentEpoch === epoch.current) {
        setDetail(body); setTopic(body.suggestions?.[0]?.topic || ''); setSubtopic(body.suggestions?.[0]?.subtopic || '');
      }
    }).catch(error => { if (current === detailGeneration.current && currentEpoch === epoch.current && error.name !== 'AbortError') setDetailError(error.message); })
      .finally(() => { if (current === detailGeneration.current && currentEpoch === epoch.current) setDetailLoading(false); });
    return () => controller.abort();
  },[open,selectedId,detailRevision,apiBase,request]);
  function clearSelection() { memberGeneration.current++; memberRequest.current?.abort(); setSelectingGroup(false); setGroupMembers(null); setSelectionProgress(0); setChecked([]); }
  function resetPage() { setCursor(null); setHistory([]); clearSelection(); setSelectedId(null); setDetail(null); }
  function filterSource(value) { setSource(value); setGroupOffset(0); resetPage(); }
  function selectGroup(value) {
    setGroup(value); setView(value ? 'posts' : 'groups'); setBatchTopic(value?.topic || ''); setBatchSubtopic(value?.subtopic || ''); resetPage();
  }
  function selectPost(id) { if (assigningRef.current) return; setSelectedId(id); }
  function changePage(next) { if (!groupMembers) clearSelection(); else setChecked([]); setSelectedId(null); setCursor(next); }
  function refresh() { resetPage(); setRevision(value => value + 1); setIndexRun(value => value + 1); }
  async function assign(event) {
    event.preventDefault();
    if (assigningRef.current || working || !detail?.item.pending || !validTopic) return;
    const current = ++actionGeneration.current, currentEpoch = epoch.current, id = detail.item.id, version = detail.item.version;
    assigningRef.current = true; setAssigning(true); setDetailError(''); setResult('');
    try {
      const body = await readOperation(await request(`${apiBase}/office/topic-review/${encodeURIComponent(id)}/assign`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic,...(subtopic ? {subtopic} : {}),expectedVersion:version,confirmed:true})}));
      if (current !== actionGeneration.current || currentEpoch !== epoch.current) return;
      setResult(body.message || `Assigned to ${body.topic}.`); resetPage(); setTopic(''); setRevision(value => value + 1); jobPoller.current?.refresh(); onAssigned?.();
    } catch(error) { if (current === actionGeneration.current && currentEpoch === epoch.current) setDetailError(error.message); }
    finally { if (current === actionGeneration.current && currentEpoch === epoch.current) { assigningRef.current = false; setAssigning(false); } }
  }
  function rememberJob(job) {
    jobReadGeneration.current++;
    rememberJobs({ ...jobState.current, [job.kind]: job });
    jobPoller.current?.refresh();
  }

  async function startJob(kind, input = {}) {
    if (assigningRef.current || working) return;
    const current = ++actionGeneration.current;
    assigningRef.current = true; setSubmitting(kind); setActionError(''); setResult('');
    try {
      const job = await readOperation(await request(`${apiBase}/office/topic-review/jobs/${kind}`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id:crypto.randomUUID(),confirmed:true,...input}),
      }));
      if (current !== actionGeneration.current) return;
      rememberJob(job);
      if (kind === 'assignment') resetPage();
    } catch(error) {
      if (current !== actionGeneration.current) return;
      setActionError(error.message);
      jobPoller.current?.refresh();
    } finally {
      if (current === actionGeneration.current) { assigningRef.current = false; setSubmitting(''); }
    }
  }

  async function stopJob(job) {
    if (stoppingRef.current || job.stopRequested) return;
    const current = actionGeneration.current;
    stoppingRef.current = true; setStopping(job.id); setActionError('');
    try {
      const next = await readOperation(await request(`${apiBase}/office/topic-review/jobs/${encodeURIComponent(job.id)}/stop`,{method:'POST'}));
      if (current === actionGeneration.current) rememberJob(next);
    } catch(error) {
      if (current === actionGeneration.current) setActionError(error.message);
    } finally {
      if (current === actionGeneration.current) { stoppingRef.current = false; setStopping(''); }
    }
  }
  const taxonomy = groups?.taxonomy || page?.taxonomy || detail?.taxonomy || [];
  const batchItems = useMemo(() => groupMembers || (page?.items || []).filter(item => checked.includes(item.id) && item.version)
    .map(item => ({id:item.id,expectedVersion:item.version})), [groupMembers,page,checked]);
  const selectedIds = useMemo(() => new Set(batchItems.map(item => item.id)), [batchItems]);
  const validBatchTopic = taxonomy.some(row => row.topic === batchTopic && (!batchSubtopic || row.subtopics?.includes(batchSubtopic)));
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
      if (current === memberGeneration.current && currentEpoch === epoch.current) { setGroupMembers(members); }
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
  function assignBatch(event) {
    event.preventDefault();
    if (!batchItems.length || !validBatchTopic) return;
    startJob('assignment',{ items:batchItems, topic:batchTopic, ...(batchSubtopic ? {subtopic:batchSubtopic} : {}) });
  }
  const post = detail?.item.post, sourceUrl = httpsUrl(post?.source_url);
  const validTopic = detail?.taxonomy?.some(row => row.topic === topic && (!subtopic || row.subtopics?.includes(subtopic)));
  const selectable = (page?.items || []).filter(item => item.version), counts = progress || groups;
  const assignmentProgress = assignment?.progress;
  const distributionProgress = distribution?.progress;
  const sources = groups?.sources || page?.sources || [];
  return <section className="op-card unknown-topic-review" aria-label="Held post review">
    <div className="op-heading"><div><h2>Review held posts</h2><p>{pendingCount == null ? 'Find related posts and review them together.' : `${num(pendingCount)} posts are waiting for topic review.`}</p></div>
      <button aria-expanded={open} disabled={working} onClick={() => { if (open) clearSelection(); setOpen(value => !value); }}>{open ? 'Hide held posts' : 'View held posts'}</button></div>
    <div className="utr-distribution" aria-label="Assigned held posts">
      <div><strong>{jobs ? `${num(jobs.pending)} assigned ${jobs.pending === 1 ? 'post' : 'posts'} ready` : jobsError ? 'Assigned-post count unavailable' : 'Checking assigned posts…'}</strong><p>Publish all assigned posts across topics and sources. Normal screening applies.</p></div>
      <div className="utr-distribution-actions"><button type="button" className="op-primary" disabled={working || !jobs?.pending} onClick={() => startJob('distribution')}>{distributing ? 'Distributing…' : 'Distribute all assigned'}</button><button type="button" onClick={() => jobPoller.current?.refresh()}>Refresh assigned posts</button></div>
      {distribution && <div className="utr-distribution-result" role="status">
        <strong>{distribution.status === 'running' ? distribution.waiting ? 'Waiting for staging transfer' : 'Distribution in progress' : distribution.status === 'complete' ? 'Distribution complete' : 'Distribution stopped'}</strong>
        <p>{num(distributionProgress.drained ?? 0)} processed · {num(distributionProgress.transferred ?? 0)} feed {distributionProgress.transferred === 1 ? 'post' : 'posts'} created and distributed · {num(distributionProgress.screenedOut ?? 0)} screened out · {num(distributionProgress.heldForReview ?? 0)} returned to review · {num(distribution.remaining)} remaining in this run.</p>
        {distribution.total > 0 && <progress aria-label="Assigned posts processed" max={distribution.total} value={distribution.total - distribution.remaining} />}
      </div>}
      {distribution?.status === 'running' && <button type="button" disabled={distribution.stopRequested || stopping === distribution.id} onClick={() => stopJob(distribution)}>{distribution.stopRequested || stopping === distribution.id ? 'Stopping after this batch…' : 'Stop distribution after this batch'}</button>}
      {(actionError || jobsError) && <div className="op-error" role="alert">{actionError || jobsError}</div>}
    </div>
    {assignment && <div className="utr-batch-result">
      <p role="status"><strong>{assignment.status === 'running' ? 'Assignment in progress' : assignment.status === 'stopped' ? 'Assignment stopped' : 'Assignment complete'}</strong> · {num(assignment.total - assignment.remaining)} of {num(assignment.total)} selected posts reviewed for {assignment.subtopic ? `${assignment.topic} / ${assignment.subtopic}` : assignment.topic}.</p>
      <p>{num(assignmentProgress.assigned ?? 0)} assigned · {num(assignmentProgress.replayed ?? 0)} already queued · {num(assignmentProgress.conflicts ?? 0)} changed or conflicted · {num(assignmentProgress.failed ?? 0)} failed.</p>
      {assignment.status === 'running' && <button type="button" disabled={assignment.stopRequested || stopping === assignment.id} onClick={() => stopJob(assignment)}>{assignment.stopRequested || stopping === assignment.id ? 'Stopping after this batch…' : 'Stop after this batch'}</button>}
      {!!assignmentProgress.results?.length && <details><summary>Posts that need another review</summary>
        <ul>{assignmentProgress.results.map(item => <li key={item.id}>{item.id}: {item.message}</li>)}</ul>
        {assignmentProgress.conflicts + assignmentProgress.failed > assignmentProgress.results.length && <p>Showing the first {num(assignmentProgress.results.length)} posts that need review.</p>}
      </details>}
    </div>}
    {open && <>
      <p>Related posts are grouped automatically by topic or shared words. Review a group, choose a topic, and assign selected posts together. Each post keeps its full content and returns to normal screening.</p>
      <div className="utr-index-status" role="status">{counts?.remaining ? 'Grouping held posts in the background… ' : 'Automatic groups: '}{counts ? `${num(counts.indexed)} of ${num(counts.total)} pending posts grouped${counts.remaining ? ` · ${num(counts.remaining)} remaining` : ''}.` : 'Preparing groups…'}
        {indexError && <><span>{indexError}</span><button type="button" onClick={() => setIndexRun(value => value + 1)}>Refresh grouping status</button></>}
      </div>
      <div className="utr-filters"><label>Find topics or posts<input type="search" value={search} disabled={working} onChange={event => { setSearch(event.target.value); clearSelection(); }} placeholder="Topic, title, text, or source" maxLength={200} /></label>
        <label>Source<select value={source} disabled={working} onChange={event => filterSource(event.target.value)}><option value="">All sources</option>{sources.map(row => row.source && <option key={row.source} value={row.source}>{row.source} ({num(row.count)})</option>)}</select></label>
        <button disabled={loading || working} onClick={refresh}>Refresh held posts</button></div>
      <div className="utr-view-controls" role="group" aria-label="Review view"><button type="button" aria-pressed={view === 'groups'} disabled={working} onClick={() => selectGroup(null)}>Topic groups</button><button type="button" aria-pressed={view === 'posts' && !group} disabled={working} onClick={() => { selectGroup(null); setView('posts'); }}>Individual posts</button></div>
      {listError && <div className="op-error" role="alert">{listError}</div>}
      {groupsError && <div className="op-error" role="alert">{groupsError}</div>}
      {result && <div className="op-notice" role="status">{result}</div>}
      {view === 'groups' ? <div className="utr-groups" aria-busy={groupsLoading}>
        <p aria-live="polite">{groupsLoading && !groups ? 'Loading topic groups…' : `${num(groups?.totalGroups || 0)} matching groups. Largest groups appear first.`}</p>
        <div className="utr-group-grid">{groups?.groups?.map(item => <button key={item.id} type="button" className="utr-group-card" aria-label={`Review ${item.label} group`} disabled={working} onClick={() => selectGroup(item)}>
          <span className="utr-group-count">{num(item.count)} posts</span><strong>{item.label}</strong><span className="utr-group-method">{{topic:'Suggested topic',ambiguous:'Competing topic matches',keyword:'Shared words',hashtag:'Shared hashtag',source:'Same source needs review'}[item.method] || 'Related posts'}</span>
          {!!item.samples?.length && <span className="utr-group-samples">{item.samples.slice(0,3).map(sample => <span key={sample.id}>{sample.title || 'Untitled post'}</span>)}</span>}
          <span className="utr-group-open">Review group →</span>
        </button>)}</div>
        {groups && !groupsLoading && !groups.groups?.length && <p className="op-empty">{counts?.remaining ? 'Groups will appear as the backlog is processed.' : 'No groups match these filters.'}</p>}
        <nav className="utr-pagination" aria-label="Topic group pages"><button disabled={groupsLoading || working || !groupOffset} onClick={() => setGroupOffset(value => Math.max(0,value - 100))}>Previous groups</button><span>Page {Math.floor(groupOffset / 100) + 1}</span><button disabled={groupsLoading || working || !groups?.hasMore} onClick={() => setGroupOffset(groups.nextOffset)}>Next groups</button></nav>
      </div> : <>
        {group && <div className="utr-selected-group"><div><h3>{group.label}</h3><p>Inspect the posts in this group before assigning their topic.</p></div><div className="utr-group-actions"><button type="button" disabled={working || selectingGroup || loading || !page?.total} onClick={selectWholeGroup}>{selectingGroup ? `Selecting ${num(selectionProgress)} posts…` : 'Select all posts in this group'}</button><button type="button" disabled={working} onClick={() => selectGroup(null)}>All topic groups</button></div></div>}
        {selectingGroup && <p role="status">Preparing a snapshot of this group: {num(selectionProgress)} posts selected. New arrivals will need a separate review.</p>}
        {!selectingGroup && groupMembers && <p role="status">Group snapshot ready: {num(groupMembers.length)} posts selected. Choose their topic below. You can inspect other pages without changing this selection.</p>}
        <div className="utr-layout"><div className="utr-list-pane">
          <p className="utr-count" aria-live="polite">{loading ? 'Loading held posts…' : page ? `${num(page.total)} matching posts` : 'Review queue unavailable.'}</p>
          {!!batchItems.length && <form className="utr-batch-assignment" onSubmit={assignBatch}><h3>{num(batchItems.length)} posts selected</h3><p>{groupMembers ? 'This selection is a snapshot of the group.' : 'This selection contains the posts checked on this page.'} Changed posts remain available for another review.</p>
            <TopicPicker taxonomy={taxonomy} value={batchTopic} onChange={value => { setBatchTopic(value); setBatchSubtopic(''); }}
              subtopic={batchSubtopic} onSubtopicChange={setBatchSubtopic} label="Topic for selected posts" subtopicLabel="Subtopic for selected posts" disabled={working} />
            {batchTopic && !validBatchTopic && <small>Choose an available topic.</small>}
            <button className="op-primary" type="submit" disabled={working || !validBatchTopic || !batchItems.length}>{submitting === 'assignment' ? 'Saving assignment…' : `Assign ${num(batchItems.length)} selected posts`}</button>
            <button type="button" disabled={working} onClick={clearSelection}>Clear selection</button>
          </form>}
          {!!selectable.length && <label className="utr-select-page"><input type="checkbox" disabled={loading || working || selectingGroup} checked={selectable.every(item => selectedIds.has(item.id))} onChange={event => checkPage(event.target.checked)} />Select all posts on this page</label>}
          <ul className="utr-list" aria-label="Held posts">{page?.items?.map(item => <li key={item.id} className="utr-post-row">
            <label className="utr-post-check"><input type="checkbox" aria-label={`Select ${item.title}`} disabled={working || selectingGroup || !item.version} checked={selectedIds.has(item.id)} onChange={event => checkPost(item,event.target.checked)} /></label>
            <button type="button" className={item.id === selectedId ? 'selected' : ''} aria-pressed={item.id === selectedId} disabled={working} onClick={() => selectPost(item.id)}>
              <span className="utr-source">{item.source || 'Source not recorded'}{item.mediaType ? ` · ${item.mediaType}` : ''}</span><strong>{item.title}</strong><span className="utr-excerpt">{item.excerpt || 'Open this post to inspect its details.'}</span><small>Held {date(item.heldAt)}</small>
            </button></li>)}</ul>
          {!loading && page && !page.items.length && <p className="op-empty">{query || source || group ? 'No held posts match these filters.' : 'No held posts on this page.'}</p>}
          <div className="utr-pagination"><button disabled={loading || working || !history.length} onClick={() => { changePage(history.at(-1)); setHistory(values => values.slice(0,-1)); }}>Previous page</button>
            <button disabled={loading || working || !page?.nextCursor} onClick={() => { setHistory(values => [...values,cursor]); changePage(page.nextCursor); }}>Next page</button></div>
        </div><div className="utr-preview" aria-label="Held post preview" aria-busy={detailLoading}>
          {!selectedId && <p className="op-empty">Choose a held post to read its full content and preview media. Use the checkboxes to review several posts together.</p>}
          {detailLoading && <p role="status">Loading the full post…</p>}
          {detailError && <div className="op-error" role="alert">{detailError}</div>}
          {selectedId && <button className="utr-refresh" disabled={detailLoading || working} onClick={() => setDetailRevision(value => value + 1)}>Refresh preview</button>}
          {post && <article>
            <div className="utr-post-meta"><span>{post.source || 'Source not recorded'}</span>{post.author_name && <span>{post.author_name}</span>}<span>{date(post.post_created_at)}</span></div>
            <h3>{post.title || 'Untitled post'}</h3><PostMedia post={post} />
            <details className="utr-content" open><summary>Full post text</summary><div>{post.content || 'No additional text was stored for this post.'}</div></details>
            {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open source post</a> : <p>No HTTPS source link is available.</p>}
            {!detail.item.pending ? <p className="op-notice">This post has already been resolved. Refresh the queue to see remaining posts.</p> : <form className="utr-assignment" onSubmit={assign}>
              {!!detail.suggestions?.length && <div className="utr-suggestions"><span>Suggested topic</span>{detail.suggestions.map(suggestion => <button key={suggestion.topic} type="button" disabled={working} onClick={() => { setTopic(suggestion.topic); setSubtopic(suggestion.subtopic || ''); }}>{suggestion.topic}{suggestion.subtopic ? ` / ${suggestion.subtopic}` : ''}</button>)}</div>}
              <TopicPicker taxonomy={detail.taxonomy} value={topic} onChange={value => { setTopic(value); setSubtopic(''); }}
                subtopic={subtopic} onSubtopicChange={setSubtopic} disabled={working} />
              {topic && !validTopic && <p>Choose a topic from the available list.</p>}
              <button className="op-primary" type="submit" disabled={working || !validTopic}>{assigning ? 'Assigning topic…' : 'Assign to topic'}</button>
            </form>}
          </article>}
        </div></div>
      </>}
    </>}
  </section>;
}
