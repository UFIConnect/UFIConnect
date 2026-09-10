import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, ExternalLink, RefreshCw, Search, X } from 'lucide-react';
import './PostPipeline.css';

const STAGES = ['staging', 'live', 'archived', 'queued', 'rejected', 'duplicate', 'retrying', 'dropped'];
const stamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not recorded';
const count = value => value == null ? '-' : Number(value).toLocaleString();
const age = value => {
  if (!value || !Number.isFinite(Date.parse(value))) return '-';
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
  return minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`;
};
async function payload(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function Tool({ label, children, ...props }) {
  return <button type="button" className="pp-tool" aria-label={label} title={label} {...props}>{children}</button>;
}
function Stage({ value }) { return <span className={`pp-stage pp-stage-${value}`}>{value}</span>; }
function Value({ value }) {
  if (value == null || value === '') return 'Not recorded';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function PostDetail({ data, loading, error, onClose, onRefresh }) {
  const [section, setSection] = useState('history');
  const latest = data?.snapshots?.[0] || data?.events?.[0];
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'post-pipeline-history.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <aside className="pp-detail" aria-label="Post details" aria-busy={loading}>
    <div className="pp-heading"><h2>Post Details</h2><div className="pp-tools">
      <Tool label="Refresh post details" onClick={onRefresh} disabled={loading}><RefreshCw size={16} /></Tool>
      <Tool label="Download post history" onClick={download} disabled={!data}><Download size={16} /></Tool>
      <Tool label="Close post details" onClick={onClose}><X size={16} /></Tool>
    </div></div>
    {loading && <p role="status">Loading post history...</p>}
    {error && <p role="alert" className="pp-error">{error}</p>}
    {data && <>
      <h3>{latest?.title || data.id}</h3>
      <div className="pp-id">{data.id}</div>
      <div className="pp-inline"><span>{latest?.source || 'Unknown source'}</span>
        {latest?.source_url && <a href={latest.source_url} target="_blank" rel="noreferrer">Source <ExternalLink size={13} /></a>}
      </div>
      <dl className="pp-facts">
        <dt>Storage copies</dt><dd>{data.snapshots.map(row => row.stage).join(', ') || 'No retained storage copy'}</dd>
        <dt>Transfer queue position</dt><dd>{data.queuePosition == null ? 'Not staged' : count(data.queuePosition)}</dd>
        <dt>Staging wait</dt><dd>{age(data.snapshots.find(row => row.stage === 'staging')?.fetched_at)}</dd>
        <dt>Recorded retry events</dt><dd>{count(data.events.filter(event => event.stage === 'retrying').length)}</dd>
        <dt>Snapshot taken</dt><dd>{stamp(data.fetchedAt)}</dd>
      </dl>
      <div className="pp-tabs" role="tablist" aria-label="Post detail views">
        {['history', 'storage'].map(tab => <button key={tab} role="tab" aria-selected={section === tab} onClick={() => setSection(tab)}>{tab === 'history' ? 'Event History' : 'Storage & Metadata'}</button>)}
      </div>
      {section === 'history' ? <div role="tabpanel">
        {!data.events.length && <p className="pp-muted">No retained events. This post may predate tracking or its history may have expired.</p>}
        <ol className="pp-timeline">{data.events.map(event => <li key={event.event_id}>
          <div className="pp-inline"><Stage value={event.stage} /><span className="pp-muted">{event.role}</span></div>
          <p>{event.reason || 'No reason recorded'}</p>
          <time dateTime={event.occurred_at}>{stamp(event.occurred_at)}</time>
        </li>)}</ol>
        {data.historyTruncated && <p className="pp-muted">Latest 500 retained events shown.</p>}
      </div> : <div role="tabpanel">
        {!data.snapshots.length && <p className="pp-muted">No staging, live, or archive copy remains.</p>}
        {data.snapshots.map(row => <section className="pp-storage" key={row.stage}>
          <h3><Stage value={row.stage} /></h3>
          {row.media_poster && <img className="pp-media" src={row.media_poster} alt={row.title || 'Post media'} loading="lazy" onError={event => { event.currentTarget.hidden = true; }} />}
          <dl className="pp-facts">{Object.entries(row).filter(([key]) => key !== 'stage').map(([key, value]) => <div className="pp-fact" key={key}>
            <dt>{key.replaceAll('_', ' ')}</dt><dd><Value value={value} /></dd>
          </div>)}</dl>
        </section>)}
      </div>}
    </>}
  </aside>;
}

export default function PostPipeline({ apiBase = '', request = fetch, pipelineStatus }) {
  const [query, setQuery] = useState(''), [source, setSource] = useState('');
  const [filters, setFilters] = useState({ q: '', source: '', stage: 'all', since: '' });
  const [offset, setOffset] = useState(0), [refresh, setRefresh] = useState(0);
  const [automatic, setAutomatic] = useState(true);
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [selected, setSelected] = useState(''), [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false), [detailError, setDetailError] = useState('');
  const [detailRefresh, setDetailRefresh] = useState(0);
  useEffect(() => {
    if (query.trim() === filters.q && source.trim() === filters.source) return;
    const timer = setTimeout(() => { setFilters(current => ({ ...current, q: query.trim(), source: source.trim() })); setOffset(0); }, 350);
    return () => clearTimeout(timer);
  }, [query, source, filters.q, filters.source]);
  useEffect(() => {
    if (!automatic) return;
    const timer = setInterval(() => { if (!document.hidden) setRefresh(value => value + 1); }, 30000);
    return () => clearInterval(timer);
  }, [automatic]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setData(null);
    const params = new URLSearchParams({ ...filters, offset: String(offset), limit: '40' });
    request(`${apiBase}/office/post-pipeline?${params}`, { signal: controller.signal }).then(payload)
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [apiBase, request, filters, offset, refresh]);
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    const controller = new AbortController();
    setDetailLoading(true); setDetailError(''); setDetail(null);
    request(`${apiBase}/office/post-pipeline/detail?id=${encodeURIComponent(selected)}`, { signal: controller.signal }).then(payload)
      .then(value => { if (!controller.signal.aborted) setDetail(value); })
      .catch(failure => { if (!controller.signal.aborted) setDetailError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [apiBase, request, selected, detailRefresh, refresh]);
  const changeFilter = (key, value) => { setFilters(current => ({ ...current, [key]: value })); setOffset(0); };
  return <div className="post-pipeline">
    <div className="pp-heading"><div><h1>Post Pipeline</h1><p className="pp-muted">Updated {stamp(data?.fetchedAt)}</p></div>
      <div className="pp-tools"><label className="pp-auto"><input type="checkbox" checked={automatic} onChange={event => setAutomatic(event.target.checked)} />Auto-refresh</label>
        <Tool label="Refresh pipeline" onClick={() => setRefresh(value => value + 1)} disabled={loading}><RefreshCw size={17} /></Tool>
      </div>
    </div>
    <div className="pp-stats" aria-label="Pipeline totals">
      {[['Staged', data?.stats?.staging], ['Live', data?.stats?.live], ['Archived', data?.stats?.archived], ['Retained events', data?.stats?.retained_events]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{count(value)}</strong></div>)}
      <div><span>Oldest staging wait</span><strong>{age(data?.stats?.oldest_staged_at)}</strong></div>
    </div>
    <form className="pp-filters" onSubmit={event => event.preventDefault()}>
      <label className="pp-search"><span>Post search</span><div><Search size={16} /><input type="search" aria-label="Search pipeline posts" placeholder="Title, post ID or source URL" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></div></label>
      <label><span>Stage</span><select aria-label="Stage" value={filters.stage} onChange={event => changeFilter('stage', event.target.value)}><option value="all">All stages</option>{STAGES.map(stage => <option key={stage} value={stage}>{stage}</option>)}</select></label>
      <label><span>Source</span><input value={source} placeholder="All sources" maxLength={100} onChange={event => setSource(event.target.value)} /></label>
      <label><span>Updated since</span><input type="date" value={filters.since} onChange={event => changeFilter('since', event.target.value)} /></label>
      <Tool label="Clear pipeline filters" onClick={() => { setQuery(''); setSource(''); setFilters({ q: '', source: '', stage: 'all', since: '' }); setOffset(0); }}><X size={17} /></Tool>
    </form>
    {error && <p className="pp-error" role="alert">{error}</p>}
    <div className={`pp-workspace${selected ? ' pp-selected' : ''}`}>
      <section className="pp-list" aria-label="Pipeline posts" aria-busy={loading}>
        <div className="pp-table-scroll"><table><thead><tr><th>Post</th><th>Stage / Reason</th><th>Source</th><th>Updated</th><th>Age</th></tr></thead>
          <tbody>{data?.posts.map(post => <tr key={post.id} className={selected === post.id ? 'pp-row-selected' : ''}>
            <td><button className="pp-post-button" onClick={() => setSelected(post.id)}>{post.title || post.id}</button><div className="pp-id">{post.id}</div><small>{[post.media_type, post.topic].filter(Boolean).join(' / ')}</small></td>
            <td><Stage value={post.stage} /><p className="pp-reason">{post.reason || 'Not recorded'}</p></td>
            <td>{post.source}</td><td>{stamp(post.updated_at)}</td><td>{age(post.updated_at)}</td>
          </tr>)}</tbody>
        </table></div>
        {loading && <p className="pp-empty" role="status">Loading pipeline posts...</p>}
        {!loading && !error && !data?.posts.length && <p className="pp-empty">No posts match these filters.</p>}
        <div className="pp-pagination"><span>{data?.posts.length ? `${count(offset + 1)}-${count(offset + data.posts.length)}` : '0'} posts</span><div className="pp-tools">
          <Tool label="Previous pipeline page" disabled={loading || !offset} onClick={() => setOffset(value => Math.max(0, value - 40))}><ArrowLeft size={17} /></Tool>
          <Tool label="Next pipeline page" disabled={loading || !data?.hasMore} onClick={() => setOffset(value => value + 40)}><ArrowRight size={17} /></Tool>
        </div></div>
      </section>
      {selected && <PostDetail key={selected} data={detail} loading={detailLoading} error={detailError} onClose={() => setSelected('')} onRefresh={() => setDetailRefresh(value => value + 1)} />}
    </div>
    {data && <footer className="pp-coverage">
      <p>History: up to {data.coverage.retentionDays} days / {count(data.coverage.maxEvents)} events. Earliest retained event: {stamp(data.stats.history_starts_at)}.</p>
      <p>Inventory: all retained storage rows. Current storage takes precedence; other stages reflect the latest recorded event, not a verified in-memory queue. Live cache presence does not guarantee visibility in every personalized feed.</p>
      <p>{data.serviceRole} history writer: {count(data.tracker.pendingEvents)} pending, {count(data.tracker.droppedEvents)} dropped since restart. Last persisted: {stamp(data.tracker.lastPersistedAt)}.</p>
      <p>Pipeline history writer: {pipelineStatus?.postPipeline ? `${count(pipelineStatus.postPipeline.pendingEvents)} pending, ${count(pipelineStatus.postPipeline.droppedEvents)} dropped since restart. Last persisted: ${stamp(pipelineStatus.postPipeline.lastPersistedAt)}.` : 'Status unavailable'}</p>
      {pipelineStatus?.postPipeline?.lastError && <p className="pp-error">{pipelineStatus.postPipeline.lastError}</p>}
      {data.tracker.lastError && <p className="pp-error">{data.tracker.lastError}</p>}
    </footer>}
  </div>;
}
