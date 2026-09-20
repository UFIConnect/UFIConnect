import { useEffect, useState } from 'react';
import './setup.css';

const labels = { ready:'Connected', configured:'Configured', missing:'Needs setup', degraded:'Needs attention', disabled:'Disabled' };
const priority = { degraded:0, missing:1, disabled:2, configured:3, ready:4 };
export default function Setup({ apiBase, pipelineBase, request }) {
  const [reports, setReports] = useState([]);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState('all');
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setBusy(true);
    Promise.all([['api', apiBase], ['pipeline', pipelineBase]].map(async ([role, base]) => {
      try {
        const response = await request(`${base}/office/setup`, { signal:controller.signal });
        if (!response.ok) throw new Error(`Setup check failed (${response.status}). Check Office access and service readiness.`);
        const data = await response.json();
        if (data.role !== role || !Array.isArray(data.items)) throw new Error(`Expected ${role} setup information. Check the service address and SERVICE_ROLE.`);
        return { role, ...data };
      } catch (error) { return { role, error:error.message }; }
    })).then(results => { if (active) { setReports(results); setBusy(false); } });
    return () => { active = false; controller.abort(); };
  }, [apiBase, pipelineBase, request, revision]);
  const items = reports.flatMap(report => (report.items || []).map(item => ({...item,role:report.role})));
  const needsAttention = items.filter(item => ['missing','degraded'].includes(item.status));
  const visible = items.filter(item => filter === 'all' || (filter === 'attention' ? ['missing','degraded'].includes(item.status) : item.role === filter))
    .sort((a,b) => priority[a.status] - priority[b.status] || a.label.localeCompare(b.label));
  return <section className="office-setup" aria-busy={busy}>
    <header><div><h1>Office setup</h1><p>Check what the API and pipeline need to run your Office, website, and mobile features.</p></div>
      <button onClick={() => setRevision(value => value + 1)} disabled={busy}>{busy ? 'Checking…' : 'Refresh setup'}</button></header>
    <p className="setup-explanation">Configured means the settings are present. Provider approval, billing, and real account access still need a successful connection. No secrets are displayed here.</p>
    <div className="setup-summary" aria-live="polite">{busy ? 'Checking both services…' : `${needsAttention.length} items need setup or attention · ${items.length} checks`}</div>
    {reports.filter(report => report.error).map(report => <div key={report.role} className="setup-error" role="alert"><strong>{report.role.toUpperCase()} unavailable</strong><p>{report.error}</p></div>)}
    <div className="setup-filters" role="group" aria-label="Setup filters">{[['all','All checks'],['attention','Needs attention'],['api','API'],['pipeline','Pipeline']].map(([id,label]) => <button key={id} aria-pressed={filter===id} onClick={() => setFilter(id)}>{label}</button>)}</div>
    <div className="setup-grid">{visible.map(item => <article key={`${item.role}-${item.id}`} data-setup-id={item.id} className={`setup-card setup-${item.status}`}>
      <div className="setup-card-meta"><span>{item.role.toUpperCase()} · {item.category}</span><span className="setup-badge">{labels[item.status] || 'Unknown'}</span></div>
      <h2>{item.label}</h2><p>{item.description}</p><p className="setup-detail">{item.detail}</p>
      {!!item.missingEnv?.length && <div className="setup-settings"><strong>Missing settings</strong>{item.missingEnv.map(name => <code key={name}>{name}</code>)}</div>}
    </article>)}</div>
    {!busy && !visible.length && <p>No checks match this filter.</p>}
  </section>;
}
