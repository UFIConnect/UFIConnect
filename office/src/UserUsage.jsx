import { useEffect, useRef, useState } from 'react';
import { readOperation, operationNumber as num, operationDate as date } from './operations-runtime.mjs';
import './office-operations.css';
import DeviceSecurity from './DeviceSecurity';

export default function UserUsage({ user, apiBase, request, onClose }) {
  const [data,setData] = useState(null), [days,setDays] = useState(30), [error,setError] = useState(''), [revision,setRevision] = useState(0), [result,setResult] = useState(null), [running,setRunning] = useState('');
  const generation = useRef(0), activeUser = useRef(user.id), runningRef = useRef(false); activeUser.current = user.id;
  useEffect(() => { setResult(null); },[user.id]);
  useEffect(() => { const controller = new AbortController(), current = ++generation.current; setData(null); setError('');
    request(`${apiBase}/office/users/${encodeURIComponent(user.id)}/usage?days=${days}`,{signal:controller.signal}).then(readOperation).then(body => { if(current === generation.current) setData(body); }).catch(e => { if(current === generation.current && e.name !== 'AbortError') setError(e.message); });
    return () => { generation.current++; controller.abort(); };
  },[apiBase,request,user.id,days,revision]);
  async function optimize(command) { if(runningRef.current) return; runningRef.current = true; const current = generation.current, id = user.id; setRunning(command.id); setError(''); setResult(null);
    try { const body = await readOperation(await request(`${apiBase}/office/users/${encodeURIComponent(id)}/optimize`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:command.id,confirmed:true})})); if(current === generation.current && activeUser.current === id) { setResult(body); setRevision(x => x + 1); } }
    catch(e) { if(current === generation.current && activeUser.current === id) setError(e.message); } finally { runningRef.current = false; setRunning(''); }
  }
  return <section className="office-ops op-card op-detail" aria-label="User usage"><div className="op-heading"><div><h2>Usage · {user.name}</h2><small>{user.id}</small></div><button onClick={onClose}>Close usage</button></div><div className="op-filters"><label>Usage window<select aria-label="Usage window" value={days} onChange={e => setDays(Number(e.target.value))}><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label><button disabled={!!running} onClick={() => setRevision(x => x + 1)}>Refresh usage</button></div>
    {error && <div role="alert" className="op-error">{error}</div>}{!data && !error && <p role="status">Loading recorded usage…</p>}
    {data && <><p>Activity recorded by the app for the selected period. This does not measure time spent or activity on external websites. Last recorded activity: {date(data.activity?.lastRecordedAt)}.</p><div className="op-stats">{[['Posts',data.activity?.posts],['Comments',data.activity?.comments],['Source actions',data.activity?.sourceActions],['Saved posts',data.activity?.savedPosts],['Delivered posts',data.activity?.deliveredPosts],['Engaged posts',data.activity?.engagedPosts]].map(([label,value]) => <div key={label}><span>{label}</span><strong>{num(value)}</strong></div>)}</div>
    <h3>Usage optimization commands</h3><div className="op-grid">{data.commands?.map(command => <div className="op-card" key={command.id}><h3>{command.label}</h3><p>{command.description}</p><button disabled={!!running} onClick={() => optimize(command)}>{running === command.id ? 'Applying…' : command.label}</button><details><summary>View command</summary><code>{command.id}</code></details></div>)}</div>
    {data.recommendations?.length > 0 && <ul>{data.recommendations.map((text,index) => <li key={index}>{text}</li>)}</ul>}
    <div className="op-card"><h3>Generation allowance</h3><p>Current monthly allowance, separate from the activity window. Resets {date(data.generation?.period?.resetsAt)}.</p><div className="op-grid">{Object.entries(data.generation?.limits || {}).map(([kind,limit]) => <div key={kind}><strong>{kind}</strong><p>{num(limit.used)} used / {num(limit.limit)} allowed<br />{num(limit.remaining)} remaining</p></div>)}</div></div>
    <details><summary>Daily recorded activity</summary><div className="op-table"><table><thead><tr><th>Date (UTC)</th><th>Posts</th><th>Comments</th><th>Source actions</th></tr></thead><tbody>{data.activity?.daily?.map(row => <tr key={row.day}><td data-label="Date (UTC)">{row.day}</td><td data-label="Posts">{num(row.posts)}</td><td data-label="Comments">{num(row.comments)}</td><td data-label="Source actions">{num(row.sourceActions)}</td></tr>)}</tbody></table></div>{!data.activity?.daily?.length && <p>No recorded activity in this window.</p>}</details>
    <details><summary>Feed interests and source weights</summary><div className="op-table"><table><thead><tr><th>Interest</th><th>Kind</th><th>Weight</th></tr></thead><tbody>{data.affinity?.map(row => <tr key={`${row.kind}:${row.label}`}><td data-label="Interest">{row.label}</td><td data-label="Kind">{row.kind}</td><td data-label="Weight">{num(row.weight)}</td></tr>)}</tbody></table></div>{!data.affinity?.length && <p>No learned interests recorded.</p>}</details></>}
    {result && <div role="status" className="op-notice">Usage command completed.<details><summary>View result</summary><pre>{JSON.stringify(result,null,2)}</pre></details></div>}
    <DeviceSecurity apiBase={apiBase} request={request} userId={user.id} />
  </section>;
}
