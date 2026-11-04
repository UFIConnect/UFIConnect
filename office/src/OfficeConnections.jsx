import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ExternalLink, GitBranch, Cloud, Server, RefreshCw } from 'lucide-react';
import './OfficeConnections.css';

const PROVIDERS = [
  { id: 'github', name: 'GitHub', Icon: GitBranch, description: 'Read and edit repository files, run checks and terminal commands, and publish requested code changes.',
    url: 'https://github.com/settings/personal-access-tokens/new', label: 'Create a GitHub token',
    help: 'Choose the UFIConnect repository and grant Contents and Actions write access. Repository access is verified before saving; each operation checks its required permissions.' },
  { id: 'render', name: 'Render', Icon: Server, description: 'Deploy the API, pipeline, website, and Office through the deployment controls.',
    url: 'https://dashboard.render.com/u/settings#api-keys', label: 'Open Render API keys',
    help: 'Use a Render API key and the service IDs for this Office. A service ID begins with srv-.' },
  { id: 'cloudflare', name: 'Cloudflare', Icon: Cloud, description: 'Power conversations, web research, and requested Workers deployments through your Cloudflare account.',
    url: 'https://dash.cloudflare.com/profile/api-tokens', label: 'Create a Cloudflare token',
    help: 'For a direct AI connection, grant Workers AI Read and AI Gateway Read for your account. Broad research needs Cloudflare search credits. An existing Worker binding can also power chat. Use a separate Workers Scripts Write token to enable deployment.' },
];
const blank = () => ({ token: '', deploymentToken: '', accountId: '', model: '@cf/google/gemma-4-26b-a4b-it', gateway: 'default', serviceIds: { api: '', pipeline: '', web: '', office: '' } });
async function read(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(response.status === 401 ? 'Reconnect to Office to manage connections.' :
    response.status === 404 ? 'Connection management is unavailable on this service version.' : data.error || 'The connection could not be updated.');
  return data;
}
export default function OfficeConnections({ apiBase, request, onConnected, onNavigate }) {
  const [connections, setConnections] = useState([]), [revision, setRevision] = useState(0), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState('');
  const [editing, setEditing] = useState(''), [form, setForm] = useState(blank), [disconnecting, setDisconnecting] = useState('');
  const generation = useRef(0), active = useRef(new Set()), lock = useRef(false), mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const clear = () => { generation.current++; active.current.forEach(c => c.abort()); active.current.clear(); lock.current = false;
      setConnections([]); setEditing(''); setForm(blank()); setDisconnecting(''); setBusy(''); setError(''); setNotice(''); setRevision(value => value + 1); };
    window.addEventListener('office-token-changed', clear);
    return () => { mounted.current = false; generation.current++; active.current.forEach(c => c.abort()); window.removeEventListener('office-token-changed', clear); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(), current = generation.current;
    let stopped = false;
    const timer = setTimeout(() => controller.abort(), 20000);
    const currentRequest = () => mounted.current && current === generation.current && !stopped;
    active.current.add(controller); setLoading(true); setError('');
    request(`${apiBase}/office/connections`, { signal: controller.signal }).then(read).then(data => {
      if (currentRequest() && !controller.signal.aborted) setConnections(Array.isArray(data.connections) ? data.connections : []);
    }).catch(e => { if (currentRequest()) setError(controller.signal.aborted ? 'Connection check timed out. Refresh connections to retry.' : e.message); })
      .finally(() => { clearTimeout(timer); active.current.delete(controller); if (currentRequest()) setLoading(false); });
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [apiBase, request, revision]);
  function edit(provider) {
    const saved = connections.find(item => item.id === provider);
    setForm({ ...blank(), accountId: saved?.accountId || '', model: saved?.model || blank().model, gateway: saved?.gateway || 'default', serviceIds: { ...blank().serviceIds, ...saved?.serviceIds } });
    setEditing(provider); setDisconnecting(''); setNotice(''); setError('');
  }
  async function operation(provider, action, body) {
    if (lock.current) return;
    lock.current = true; setBusy(`${provider}:${action}`); setError(''); setNotice('');
    const controller = new AbortController(), current = generation.current;
    active.current.add(controller);
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const data = await read(await request(`${apiBase}/office/connections/${provider}${action === 'verify' ? '/verify' : ''}`, {
        method: action === 'disconnect' ? 'DELETE' : 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
      }));
      if (!mounted.current || current !== generation.current) return;
      setNotice(data.detail || 'Disconnected from Office. The credential is not revoked at the provider.');
      setEditing(''); setForm(blank()); setDisconnecting(''); setRevision(value => value + 1); onConnected?.();
    } catch (e) {
      if (mounted.current && current === generation.current) setError(controller.signal.aborted ? 'The connection request timed out. Refresh to check whether it was saved before retrying.' : e.message);
    } finally {
      clearTimeout(timer); active.current.delete(controller);
      if (mounted.current && current === generation.current) { lock.current = false; setBusy(''); }
    }
  }
  function save(event) {
    event.preventDefault();
    const body = form.token.trim() ? { token: form.token.trim() } : {};
    if (editing === 'cloudflare') Object.assign(body, { accountId: form.accountId.trim(), model: form.model.trim(), gateway: form.gateway.trim(), ...(form.deploymentToken.trim() ? { deploymentToken: form.deploymentToken.trim() } : {}) });
    if (editing === 'render') body.serviceIds = Object.fromEntries(Object.entries(form.serviceIds).map(([role, value]) => [role, value.trim()]));
    operation(editing, 'save', body);
  }
  return <section className="office-connections" aria-label="Provider connections" aria-busy={loading || Boolean(busy)}>
    <div className="oc-heading"><div><h2>Your connections</h2><p>Connect the accounts that power your Office. Saved credentials are encrypted on the server and are never sent to the chatbot.</p></div>
      <button type="button" disabled={loading || Boolean(busy)} onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} /> Refresh connections</button></div>
    {error && <p role="alert" className="oc-error">{error}</p>}{notice && <p role="status" className="oc-notice">{notice}</p>}
    {loading && <p role="status">Checking connection settings…</p>}
    <div className="oc-grid">{PROVIDERS.map(provider => {
      const item = connections.find(value => value.id === provider.id), Icon = provider.Icon;
      return <article key={provider.id} className="oc-card">
        <div className="oc-card-title"><Icon size={23} /><h3>{provider.name}</h3><span className={item?.configured ? 'oc-connected' : ''}>{item?.configured ? 'Configured' : loading ? 'Checking' : 'Not connected'}</span></div>
        <p>{provider.description}</p>
        {item?.repository && <p className="oc-context">{item.repository}</p>}
        {item?.mode === 'worker-binding' && <p className="oc-context">Connected through a protected Cloudflare Worker</p>}
        {provider.id === 'cloudflare' && item?.configured && <p className="oc-context">Workers deployment access: {item.deploymentConfigured ? 'configured' : 'not connected'}</p>}
        {item?.verifiedAt && <p className="oc-context">Last verified {new Date(item.verifiedAt).toLocaleString()}</p>}
        <div className="oc-actions">
          <button type="button" disabled={Boolean(busy) || loading} onClick={() => edit(provider.id)}>{item?.configured ? 'Update connection' : 'Connect'} {provider.name}</button>
          {item?.configured && <button type="button" disabled={Boolean(busy)} onClick={() => operation(provider.id, 'verify')}><CheckCircle2 size={14} />{busy === `${provider.id}:verify` ? 'Verifying…' : 'Verify connection'}</button>}
          {item?.configured && <button type="button" disabled={Boolean(busy)} onClick={() => { setDisconnecting(provider.id); setEditing(''); setForm(blank()); }}>Disconnect</button>}
        </div>
        {disconnecting === provider.id && <div className="oc-confirm"><p>Disconnect {provider.name} from Office? This also disables the inherited server connection for Office.</p><button disabled={Boolean(busy)} onClick={() => operation(provider.id, 'disconnect', { confirmed: true })}>Confirm disconnect</button> <button disabled={Boolean(busy)} onClick={() => setDisconnecting('')}>Cancel</button></div>}
        {editing === provider.id && <form onSubmit={save} className="oc-form">
          <p>{provider.help}</p><a href={provider.url} target="_blank" rel="noopener noreferrer">{provider.label} <ExternalLink size={13} /></a>
          <label>{provider.name} {provider.id === 'render' ? 'API key' : 'API token'}<input type="password" autoComplete="off" spellCheck="false" required={provider.id !== 'cloudflare' || !item?.configured} minLength={20} maxLength={4096} value={form.token} disabled={Boolean(busy)} onChange={event => setForm(value => ({ ...value, token: event.target.value }))} /></label>
          {provider.id === 'cloudflare' && <>
            {item?.configured && <p>Leave the AI token empty to keep the current AI connection.</p>}
            <label>Workers deployment token<input type="password" autoComplete="off" spellCheck="false" minLength={20} maxLength={4096} value={form.deploymentToken} disabled={Boolean(busy)} onChange={event => setForm(value => ({ ...value, deploymentToken: event.target.value }))} /></label>
            <p>Optional. Grant Workers Scripts Write for this connected account. This credential is used only for approved deployment operations.</p>
            <label>Cloudflare account ID<input required pattern="[a-fA-F0-9]{32}" value={form.accountId} disabled={Boolean(busy)} onChange={event => setForm(value => ({ ...value, accountId: event.target.value }))} /></label>
            <label>AI model<input required maxLength={150} value={form.model} disabled={Boolean(busy)} onChange={event => setForm(value => ({ ...value, model: event.target.value }))} /></label>
            <label>AI Gateway<input required maxLength={64} value={form.gateway} disabled={Boolean(busy)} onChange={event => setForm(value => ({ ...value, gateway: event.target.value }))} /></label>
          </>}
          {provider.id === 'render' && Object.entries(form.serviceIds).map(([role, value]) => <label key={role}>{role === 'api' ? 'API' : role[0].toUpperCase() + role.slice(1)} service ID<input value={value} placeholder="srv-…" disabled={Boolean(busy)} onChange={event => setForm(state => ({ ...state, serviceIds: { ...state.serviceIds, [role]: event.target.value } }))} /></label>)}
          <div className="oc-actions"><button disabled={Boolean(busy) || (!form.token.trim() && !form.deploymentToken.trim())}>{busy === `${provider.id}:save` ? 'Verifying and saving…' : 'Verify and save'}</button><button type="button" disabled={Boolean(busy)} onClick={() => { setEditing(''); setForm(blank()); }}>Cancel</button></div>
        </form>}
      </article>;
    })}</div>
    <p className="oc-footer">Run coding and deployment tasks in Office AI, or use the existing Office commands. Cloudflare supplies AI and web research; GitHub and Render provide repository, check, and deployment actions.</p>
    <div className="oc-actions"><button type="button" onClick={() => onNavigate?.('controls')}>Open code and deployment controls</button><a href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer">Cloudflare dashboard <ExternalLink size={13} /></a></div>
  </section>;
}
