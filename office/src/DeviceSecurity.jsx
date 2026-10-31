import { useEffect, useRef, useState } from 'react';
import { readOperation, operationDate as date } from './operations-runtime.mjs';
import './office-operations.css';

export default function DeviceSecurity({ apiBase = '', request, userId = '' }) {
  const [data,setData] = useState(null), [error,setError] = useState(''), [revision,setRevision] = useState(0), [reason,setReason] = useState(''), [selected,setSelected] = useState(''), [running,setRunning] = useState(false), [notice,setNotice] = useState('');
  const generation = useRef(0), inFlight = useRef(false);
  useEffect(() => { const clear = () => { generation.current++; setData(null); setSelected(''); setReason(''); setNotice(''); setRevision(x => x + 1); }; window.addEventListener('office-token-changed',clear); return () => { generation.current++; window.removeEventListener('office-token-changed',clear); }; },[]);
  useEffect(() => { const current = ++generation.current, controller = new AbortController(); setData(null); setError('');
    request(`${apiBase}/office/security/devices${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`,{signal:controller.signal}).then(readOperation).then(body => { if(current === generation.current) setData(body); }).catch(e => { if(current === generation.current && e.name !== 'AbortError') setError(e.message); });
    return () => { generation.current++; controller.abort(); };
  },[apiBase,request,userId,revision]);
  async function unblock(event) { event.preventDefault(); if(inFlight.current || !selected || !reason.trim()) return; inFlight.current = true; setRunning(true); setError(''); setNotice(''); const current = generation.current;
    try { const body = await readOperation(await request(`${apiBase}/office/security/devices/${encodeURIComponent(selected)}/unblock`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:true,reason})})); if(current === generation.current) { setNotice(body.message); setSelected(''); setReason(''); setRevision(x => x + 1); } }
    catch(e) { if(current === generation.current) setError(e.message); } finally { inFlight.current = false; setRunning(false); }
  }
  return <section className="office-ops op-card" aria-label="Suspicious device activity"><div className="op-heading"><h2>Suspicious device activity</h2><button disabled={running} onClick={() => setRevision(x => x + 1)}>Refresh device activity</button></div>
    <p>The sixth distinct detected violation blocks the registered device from further writes. Spam, repeated content, link spam, and credential harvesting count; ordinary usage and failed service requests do not. Duplicate retries count once. Counts run from registration or the last reviewed reset.</p>
    {error && <div role="alert" className="op-error">{error}</div>}{notice && <div role="status" className="op-notice">{notice}</div>}{!data && !error && <p role="status">Loading device activity…</p>}
    {data && <><p><small>{data.scope}</small></p>{!data.devices?.length ? <p>No recorded suspicious device activity{userId ? ' for this user' : ''}.</p> : data.devices.map(device => <details key={device.id}><summary><span className={`op-tag ${device.blockedAt ? 'rejected' : 'held'}`}>{device.blockedAt ? 'Blocked' : 'Monitoring'}</span> {device.id.slice(0,8)} · {device.strikes} {device.strikes === 1 ? 'violation' : 'violations'}</summary><p>Device ID: {device.id}<br />{device.accounts} linked {device.accounts === 1 ? 'account' : 'accounts'} · Registered {date(device.createdAt)}{device.blockedAt && <><br />Blocked {date(device.blockedAt)}</>}</p><ul>{device.events?.map((event,index) => <li key={index}>{event.reason.replaceAll('_',' ')} · {date(event.occurred_at)}<br /><small>{event.activity}</small></li>)}</ul><button disabled={running} onClick={() => { setSelected(device.id); setReason(''); }}>{device.blockedAt ? 'Review and unblock device' : 'Review and reset strikes'}</button></details>)}</>}
    {selected && <form onSubmit={unblock}><h3>Review device {selected.slice(0,8)}</h3><div className="op-filters"><label>Review reason<input required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="Explain why this device should be allowed again" /></label></div><div className="op-actions"><button disabled={running || !reason.trim()}>{running ? 'Saving review…' : 'Unblock and reset strikes'}</button><button type="button" disabled={running} onClick={() => setSelected('')}>Cancel device review</button></div></form>}
  </section>;
}
