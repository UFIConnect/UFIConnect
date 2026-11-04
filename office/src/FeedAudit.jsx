import { useCallback, useEffect, useRef, useState } from 'react';
import { readOperation, safeSourceUrl, operationNumber as num, operationDate as date } from './operations-runtime.mjs';
import './office-operations.css';
import DeviceSecurity from './DeviceSecurity';

const policyFields = [['maxPerSourcePerMinute','Posts per source / minute',1,10000],['maxPerAuthorPerMinute','Posts per author / minute',1,1000],['duplicateWindowSeconds','Duplicate window (seconds)',10,3600],['targetApprovalPct','Approval target (%)',1,100],['minimumSample','Minimum sample for cooldown',5,1000],['cooldownSeconds','Source cooldown (seconds)',10,3600]];
const editablePolicy = policy => policy && Object.fromEntries(['enabled',...policyFields.map(([key]) => key),'sourcePullLimits'].map(key => [key,policy[key]]));
const policySignature = policy => JSON.stringify(editablePolicy(policy), (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
export default function FeedAudit({ apiBase = '', pipelineBase = '', request }) {
  const [data,setData] = useState(null), [error,setError] = useState(''), [busy,setBusy] = useState(false), [revision,setRevision] = useState(0);
  const [filters,setFilters] = useState({status:'all',reason:'',source:'',q:''}), [offset,setOffset] = useState(0);
  const [selected,setSelected] = useState(null), [detail,setDetail] = useState(null), [detailError,setDetailError] = useState('');
  const [settings,setSettings] = useState(null), [source,setSource] = useState(''), [blockReason,setBlockReason] = useState('');
  const [running,setRunning] = useState(''), [result,setResult] = useState(null);
  const [policyChanged,setPolicyChanged] = useState(false);
  const generation = useRef(0), actionGeneration = useRef(0), runningRef = useRef(false);
  const settingsDirty = useRef(false), loadedPolicy = useRef(null);
  const refresh = useCallback(() => setRevision(x => x + 1), []);
  useEffect(() => { const clear = () => { generation.current++; actionGeneration.current++; settingsDirty.current = false; loadedPolicy.current = null; setPolicyChanged(false); setData(null); setSettings(null); setSelected(null); setDetail(null); setResult(null); refresh(); }; window.addEventListener('office-token-changed',clear); return () => { generation.current++; actionGeneration.current++; window.removeEventListener('office-token-changed',clear); }; },[refresh]);
  useEffect(() => {
    const controller = new AbortController(), current = ++generation.current;
    setBusy(true); setError(''); setData(null);
    const params = new URLSearchParams({...filters,offset:String(offset),limit:'40'});
    request(`${apiBase}/office/feed-audit?${params}`,{signal:controller.signal}).then(readOperation).then(body => {
      if (current !== generation.current) return;
      setData(body);
      if (!settingsDirty.current) {
        setSettings(editablePolicy(body.policy)); loadedPolicy.current = policySignature(body.policy); setPolicyChanged(false);
      } else setPolicyChanged(loadedPolicy.current !== policySignature(body.policy));
    }).catch(e => { if (current === generation.current && e.name !== 'AbortError') setError(e.message); }).finally(() => { if (current === generation.current) setBusy(false); });
    return () => controller.abort();
  },[apiBase,request,filters,offset,revision]);
  useEffect(() => {
    setDetail(null); setDetailError(''); if (!selected) return;
    let active = true; const controller = new AbortController();
    request(`${apiBase}/office/feed-audit/items/${encodeURIComponent(selected)}`,{signal:controller.signal}).then(readOperation).then(body => { if(active) setDetail(body.item); }).catch(e => { if(active && e.name !== 'AbortError') setDetailError(e.message); });
    return () => { active = false; controller.abort(); };
  },[apiBase,request,selected,revision]);
  async function execute(id,payload = {},both = false) {
    if(runningRef.current) return;
    runningRef.current = true; setRunning(id); setError(''); setResult(null); const current = actionGeneration.current;
    const results = [];
    try {
      for(const base of both ? [...new Set([apiBase,pipelineBase || apiBase])] : [apiBase]) {
        const body = await readOperation(await request(`${base}/office/controls/${encodeURIComponent(id)}/execute`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:true,...payload})}));
        results.push({service:base === apiBase ? 'API' : 'Pipeline',...body});
      }
      if(current === actionGeneration.current) { setResult({command:id,results}); if(id === 'feed.audit-protect' || id === 'feed.flood-configure') { settingsDirty.current = false; loadedPolicy.current = null; setPolicyChanged(false); setSettings(null); } refresh(); }
    } catch(e) { if(current === actionGeneration.current) { setError(`${e.message}${results.length ? ' Earlier service results are shown below; this command partially completed.' : ''}`); if(results.length) setResult({command:id,results}); refresh(); } }
    finally { runningRef.current = false; setRunning(''); }
  }
  function filter(key,value) { setFilters(old => ({...old,[key]:value})); setOffset(0); setSelected(null); }
  function editSettings(update) { settingsDirty.current = true; setSettings(update); }
  function loadCurrentSettings() {
    settingsDirty.current = false; loadedPolicy.current = policySignature(data?.policy); setPolicyChanged(false); setSettings(editablePolicy(data?.policy));
  }
  function updatePullLimit(sourceId, key, value) {
    editSettings(old => ({ ...old, sourcePullLimits: {
      ...old.sourcePullLimits,
      [sourceId]: { ...old.sourcePullLimits[sourceId], [key]: value === '' ? '' : Number(value) },
    } }));
  }
  const summary = data?.summary, itemUrl = safeSourceUrl(detail?.sourceUrl);
  const sourceLabels = new Map((data?.sources || []).map(row => [row.id === 'hn' ? 'hackernews' : row.id, row.label || row.id]));
  const pullLimits = Object.entries(settings?.sourcePullLimits || {}).sort(([left], [right]) =>
    (sourceLabels.get(left) || left).localeCompare(sourceLabels.get(right) || right));
  return <section className="office-ops" aria-label="Feed audit">
    <div className="op-heading"><div><h1>Feed Audit</h1><p>Inspect spam, protect the intake, and control compromised sources.</p></div><button disabled={busy || !!running} onClick={refresh}>Refresh audit</button></div>
    {error && <div role="alert" className="op-error">{error}</div>}
    {busy && <p role="status">Loading audit records…</p>}
    {data?.health && <p role="status">{num(data.health.pendingEvents || 0)} audit records waiting to save. {data.health.droppedEvents > 0 && `${num(data.health.droppedEvents)} records were omitted because the audit queue was full; retained history is incomplete. `}{data.health.lastError || ''} {data.health.policyError || ''}</p>}
    <div className="op-stats">{[['Evaluated',summary?.checked],['Approved',summary?.approved],['Rejected',summary?.rejected],['Held by protection',summary?.held],['Approval',summary?.approvalPct == null ? null : `${summary.approvalPct}%`]].map(([label,value]) => <div key={label}><span>{label}</span><strong>{typeof value === 'string' ? value : num(value)}</strong></div>)}</div>
    <p>Approval measures evaluated posts. Flood holds are reported separately. The target triggers protective cooldowns; it does not change screening decisions or guarantee an approval rate. {summary?.scope}</p>
    <div className="op-card"><div className="op-heading"><div><h2>Protection command bundle</h2><p>Apply protective defaults, review the live feed, and refresh delivery caches.</p></div><button className="op-primary" disabled={!data || !!running} onClick={() => execute('feed.audit-protect',{},true)}>{running === 'feed.audit-protect' ? 'Applying protection…' : 'Run protection bundle'}</button></div>
      <div className="op-grid">{(data?.commands || []).filter(command => !command.id.startsWith('source.')).map(command => <details key={command.id}><summary>{command.label}</summary><p>{command.description}</p><code>{command.id}</code>{['feed.audit-review','feed.audit-protect'].includes(command.id) && <div className="op-actions"><button disabled={!!running} onClick={() => execute(command.id,{},true)}>Run {command.label}</button></div>}</details>)}</div>
      {result && <div className="op-notice" role="status">Command results: {result.command}<details><summary>View each result</summary><pre>{JSON.stringify(result.results,null,2)}</pre></details></div>}
    </div>
    <section className="op-card" aria-labelledby="anti-flooding-heading"><h2 id="anti-flooding-heading">Anti flooding</h2><p>Limit bursts and repeated content, then cool down sources with poor approval.</p>{settings && <form onSubmit={event => { event.preventDefault(); execute('feed.flood-configure',{settings:editablePolicy(settings)}); }}>
      {policyChanged && <div className="op-notice" role="status"><p>Flood settings changed on the server while you were editing. Your unsaved edits are preserved.</p><button type="button" disabled={busy || !!running || !data?.policy} onClick={loadCurrentSettings}>Load current flood settings</button></div>}
      <label className="op-check"><input type="checkbox" checked={!!settings.enabled} onChange={e => editSettings({...settings,enabled:e.target.checked})} />Flood protection enabled</label>
      <div className="op-filters">{policyFields.map(([key,label,min,max]) => <label key={key}>{label}<input type="number" required min={min} max={max} step="1" value={settings[key] ?? ''} onChange={e => editSettings({...settings,[key]:e.target.value === '' ? '' : Number(e.target.value)})} /></label>)}</div>
      <h3 id="source-pull-limits-heading">Source pull limits</h3>
      <p>Set the maximum collection rate for each source. Pulls are spaced evenly across the window, including manual refreshes. These limits apply even when post flood protection is off. You can reduce a source's rate; its collection ceiling and any stricter provider limits still apply.</p>
      {pullLimits.length ? <>
        <p>{num(pullLimits.length)} sources configured. New sources returned by the service appear here automatically.</p>
        <div className="op-table op-pull-limits" role="region" aria-labelledby="source-pull-limits-heading" tabIndex={0}><table>
          <thead><tr><th scope="col">Source</th><th scope="col">Maximum pulls</th><th scope="col">Window (seconds)</th><th scope="col">Policy minimum spacing</th></tr></thead>
          <tbody>{pullLimits.map(([sourceId, limit]) => {
            const label = sourceLabels.get(sourceId) || sourceId;
            const spacing = limit.windowSeconds > 0 && limit.maxPulls > 0 ? Math.ceil(limit.windowSeconds * 1000 / limit.maxPulls) / 1000 : null;
            return <tr key={sourceId}>
              <td data-label="Source"><strong>{label}</strong>{label !== sourceId && <small>{sourceId}</small>}</td>
              <td data-label="Maximum pulls"><input aria-label={`${label} maximum pulls`} type="number" required min="1" max="10000" step="1" value={limit.maxPulls ?? ''} onChange={event => updatePullLimit(sourceId,'maxPulls',event.target.value)} /></td>
              <td data-label="Window (seconds)"><input aria-label={`${label} window in seconds`} type="number" required min="1" max="86400" step="1" value={limit.windowSeconds ?? ''} onChange={event => updatePullLimit(sourceId,'windowSeconds',event.target.value)} /></td>
              <td data-label="Policy minimum spacing">{spacing == null ? 'Enter a valid limit' : `${spacing.toLocaleString(undefined, { maximumFractionDigits: 3 })} seconds`}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </> : <p>Source pull limits were not returned by this service.</p>}
      <div className="op-actions"><button className="op-primary" disabled={!!running || !data}>{running === 'feed.flood-configure' ? 'Saving flood settings…' : 'Save flood settings'}</button></div>
    </form>}</section>
    <section className="op-card"><h2>Source block command</h2><p>Block a source during a breach. Posts from blocked sources cannot enter or be served in the public feed. Changes reach other workers within five seconds.</p><form onSubmit={e => { e.preventDefault(); execute(`source.block.${source}`,{reason:blockReason}); }}><div className="op-filters"><label>Source to block<select aria-label="Source to block" required value={source} onChange={e => setSource(e.target.value)}><option value="">Select a source</option>{data?.sources?.map(row => <option key={row.id} value={row.id}>{row.label || row.id}</option>)}</select></label><label>Reason<input required maxLength={500} value={blockReason} onChange={e => setBlockReason(e.target.value)} placeholder="Breach or spam incident" /></label></div><button className="op-danger" disabled={!source || !blockReason.trim() || !!running || !data}>Block source</button></form>
      {(data?.policy?.blockedSources || []).map(row => <div key={row.source}><p><strong>{row.source}</strong> · {row.reason}<br /><small>Blocked {date(row.blockedAt)}</small></p><button disabled={!!running} onClick={() => execute(`source.unblock.${row.source}`)}>Unblock {row.source}</button></div>)}{data && !data.policy?.blockedSources?.length && <p>No sources blocked.</p>}
    </section>
    <section className="op-card"><h2>Review each post</h2><p>Open an item to inspect the content and the reason for its decision. Retained history is limited to seven days and 10,000 records.</p><div className="op-filters"><label className="op-search">Search audit<input type="search" value={filters.q} onChange={e => filter('q',e.target.value)} placeholder="Title, content or post ID" /></label><label>Decision<select aria-label="Decision" value={filters.status} onChange={e => filter('status',e.target.value)}>{['all','rejected','held','approved'].map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Spam or hold reason<select aria-label="Spam or hold reason" value={filters.reason} onChange={e => filter('reason',e.target.value)}><option value="">All reasons</option>{data?.reasons?.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label><label>Filter source<input value={filters.source} onChange={e => filter('source',e.target.value)} placeholder="Source ID" /></label></div>
      <div className="op-table"><table><thead><tr><th>Post</th><th>Decision</th><th>Reason</th><th>Observed</th></tr></thead><tbody>{data?.items?.map(item => <tr key={item.id}><td data-label="Post"><button className="op-link" onClick={() => setSelected(item.id)}>{item.title || item.postId || 'Untitled post'}</button><small>{item.source}</small></td><td data-label="Decision"><span className={`op-tag ${item.status}`}>{item.status}</span></td><td data-label="Reason">{item.reason?.replaceAll('_',' ')}<small>{item.explanation}</small></td><td data-label="Observed">{date(item.at)}</td></tr>)}</tbody></table></div>
      {data && !data.items?.length && <div className="op-empty">No audit records match these filters.</div>}<nav className="op-actions" aria-label="Audit pages"><button disabled={!offset || busy} onClick={() => setOffset(x => Math.max(0,x - 40))}>Previous audit page</button><span>Page {Math.floor(offset / 40) + 1}</span><button disabled={!data?.hasMore || busy} onClick={() => setOffset(x => x + 40)}>Next audit page</button></nav>
    </section>
    {selected && <section className="op-card op-detail" aria-label="Audit item details"><div className="op-heading"><h2>{detail?.title || 'Audit item details'}</h2><button onClick={() => setSelected(null)}>Close audit details</button></div>{detailError ? <div role="alert" className="op-error">{detailError}</div> : !detail ? <p role="status">Loading post…</p> : <><p><span className={`op-tag ${detail.status}`}>{detail.status}</span> · {detail.source} · {date(detail.at)}</p><h3>{detail.reason?.replaceAll('_',' ')}</h3><p>{detail.explanation}</p><div className="op-content">{detail.content || 'No retained text for this item.'}</div>{detail.contentTruncated && <p>Retained text is shortened. Open the original source to read the complete post.</p>}{itemUrl && <p><a href={itemUrl} target="_blank" rel="noopener noreferrer">Open original source</a></p>}<small>Post ID: {detail.postId}</small><div className="op-actions"><button className="op-danger" disabled={!!running || !detail.source} onClick={() => execute(`source.block.${detail.source}`,{reason:`Audit finding: ${detail.reason}`})}>Block this source</button></div></>}</section>}
    <DeviceSecurity apiBase={apiBase} request={request} />
  </section>;
}
