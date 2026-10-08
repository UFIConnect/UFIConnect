import { useEffect, useRef, useState } from 'react';
import './setup.css';

const labels = { ready:'Connected', configured:'Configured', missing:'Needs setup', degraded:'Needs attention', disabled:'Disabled' };
const priority = { degraded:0, missing:1, disabled:2, configured:3, ready:4 };
const activationLabels = { queued: 'Queued', checked: 'Checked', skipped: 'Skipped', failed: 'Failed' };
const count = value => Number.isInteger(value) && value >= 0 ? value : null;
const safeExplanation = value => String(value || '').replace(/https?:\/\/[^\s]+/gi, '[link omitted]')
  .replace(/\b(Bearer\s+)[^\s,;]+/gi, '$1[redacted]')
  .replace(/\b((?:[a-z_]*token|password|secret|api[_-]?key|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]').slice(0, 400);

export function OfficeActivationResult({ result, error }) {
  const services = Array.isArray(result?.services) ? result.services : [];
  if (!error && !services.length) return null;
  return <section className="office-activation-result" aria-label="Configured agent activation results">
    {error && <p className="office-activation-error" role="alert">{safeExplanation(error)}</p>}
    {services.length > 0 && <><p role="status">Activation requests completed. Agent status updates when fresh work is reported.</p>
      {services.map((service, index) => <div key={`${service.role}:${index}`} className="office-activation-service">
        <strong>{service.role === 'api' ? 'API' : service.role === 'pipeline' ? 'Pipeline' : 'Service'}</strong>
        <p>{Object.entries(activationLabels).filter(([key]) => count(service[key]) != null).map(([key, label]) => `${service[key]} ${label.toLowerCase()}`).join(' · ') || 'No work counts reported.'}</p>
        {Array.isArray(service.items) && service.items.length > 0 && <details><summary>Review agent results</summary><ul>{service.items.map((item, itemIndex) => <li key={`${item.id}:${itemIndex}`} data-activation-state={Object.hasOwn(activationLabels, item.status) ? item.status : 'unknown'}>
          <strong>{safeExplanation(item.label || item.id || 'Agent')}</strong><span>{Object.hasOwn(activationLabels, item.status) ? activationLabels[item.status] : 'Not reported'}</span>{item.reason && <p>{safeExplanation(item.reason)}</p>}
        </li>)}</ul></details>}
      </div>)}</>}
  </section>;
}

function setupWorkflow(item) {
  if (item.id === 'github' || item.id === 'render-status') return { view: 'deploy', label: 'Open Deploy Center' };
  if (item.id === 'agent-chat') return { view: 'city', label: 'Open Live City' };
  if (item.id === 'youtube' || item.id === 'twitch') return { view: 'sources', label: 'Open source agents' };
  return { view: 'controls', label: 'Open Controls' };
}

export default function Setup({ apiBase, pipelineBase, request, onNavigate, onActivate,
  activating = false, activationResult, activationError = '' }) {
  const [reports, setReports] = useState([]);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState('all');
  const [localActivationError, setLocalActivationError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
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
  async function connectConfigured() {
    if (!onActivate || busy || activating) return;
    setLocalActivationError('');
    try { await onActivate(); }
    catch { if (mounted.current) setLocalActivationError('Configured agents could not be activated. Refresh setup and retry.'); }
    finally { if (mounted.current) setRevision(value => value + 1); }
  }
  const visible = items.filter(item => filter === 'all' || (filter === 'attention' ? ['missing','degraded'].includes(item.status) : item.role === filter))
    .sort((a,b) => priority[a.status] - priority[b.status] || a.label.localeCompare(b.label));
  return <section className="office-setup" aria-busy={busy}>
    <header><div><h1>Office setup</h1><p>Check what the API and pipeline need to run your Office, website, and mobile features.</p></div>
      <div className="setup-header-actions"><button type="button" className="setup-connect-button" onClick={connectConfigured} disabled={busy || activating || !onActivate || !items.some(item => ['configured', 'ready'].includes(item.status))}>{activating ? 'Connecting configured setups…' : 'Connect configured setups'}</button>
        <button type="button" onClick={() => setRevision(value => value + 1)} disabled={busy || activating}>{busy ? 'Checking…' : 'Refresh setup'}</button></div></header>
    <p className="setup-explanation">Configured means the settings are present. Provider approval, billing, and real account access still need a successful connection. No secrets are displayed here.</p>
    <p className="setup-explanation">Connect configured setups runs supported checks and queues recoverable source agents. Missing credentials and account connections remain listed for setup.</p>
    <OfficeActivationResult result={activationResult} error={activationError || localActivationError} />
    <div className="setup-summary" aria-live="polite">{busy ? 'Checking both services…' : `${needsAttention.length} items need setup or attention · ${items.length} checks`}</div>
    {reports.filter(report => report.error).map(report => <div key={report.role} className="setup-error" role="alert"><strong>{report.role.toUpperCase()} unavailable</strong><p>{report.error}</p></div>)}
    <div className="setup-filters" role="group" aria-label="Setup filters">{[['all','All checks'],['attention','Needs attention'],['api','API'],['pipeline','Pipeline']].map(([id,label]) => <button key={id} aria-pressed={filter===id} onClick={() => setFilter(id)}>{label}</button>)}</div>
    <div className="setup-grid">{visible.map(item => <article key={`${item.role}-${item.id}`} data-setup-id={item.id} className={`setup-card setup-${item.status}`}>
      <div className="setup-card-meta"><span>{item.role.toUpperCase()} · {item.category}</span><span className="setup-badge">{labels[item.status] || 'Unknown'}</span></div>
      <h2>{item.label}</h2><p>{item.description}</p><p className="setup-detail">{item.detail}</p>
      {!!item.missingEnv?.length && <div className="setup-settings"><strong>Missing settings</strong>{item.missingEnv.map(name => <code key={name}>{name}</code>)}</div>}
      {onNavigate && <div className="setup-card-actions"><button type="button" onClick={() => onNavigate(setupWorkflow(item).view)}>{setupWorkflow(item).label}</button></div>}
    </article>)}</div>
    {!busy && !visible.length && <p>No checks match this filter.</p>}
  </section>;
}
