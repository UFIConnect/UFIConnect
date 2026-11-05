import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Eye, EyeOff, KeyRound, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import './OfficeAIStudioKeys.css';

const clean = value => String(value || '').replace(/\bBearer\s+\S+/gi, '[credential omitted]').replace(/\b(?:pip_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]+)\b/g, '[credential omitted]').slice(0, 400);
const dateLabel = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
const SCOPES = { 'photos:generate': 'Photos', 'videos:generate': 'Videos', 'content:generate': 'AI content' };
async function payload(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(response.status === 401 ? 'Office access changed. Sign in again to manage API keys.' : clean(data.error || `API keys are unavailable (${response.status}).`));
  return data;
}

export default function OfficeAIStudioKeys({ apiBase = '', request = fetch, active = true }) {
  const [keys, setKeys] = useState([]), [name, setName] = useState(''), [secret, setSecret] = useState(''), [shown, setShown] = useState(false), [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [revision, setRevision] = useState(0);
  const mounted = useRef(false), epoch = useRef(0), pending = useRef(new Set()), mutating = useRef(false), secretField = useRef(null), secretKeyId = useRef(null);
  const root = `${apiBase}/office/ai/studio/keys`;
  const api = `${apiBase || 'https://api.uficonnect.org'}/api/pip/studio`;
  const example = `const headers = {
  Authorization: \`Bearer \${process.env.PIP_STUDIO_API_KEY}\`,
  'x-pip-user-id': signedInUser.id,
  'Content-Type': 'application/json'
};
const created = await fetch(${JSON.stringify(api + '/projects')}, {
  method: 'POST', headers,
  body: JSON.stringify({
    clientRequestId: crypto.randomUUID(), kind: 'video',
    title: 'My video', prompt: 'A sunrise over a quiet harbor',
    durationSeconds: 30
  })
}).then(response => response.json());
const render = await fetch(
  ${JSON.stringify(api + '/projects/')} + created.project.id + '/generate',
  { method: 'POST', headers, body: '{}' }
).then(response => response.json());`;
  async function call(path = '', options = {}) {
    const controller = new AbortController(); pending.current.add(controller);
    const timer = setTimeout(() => controller.abort(), 30000);
    try { return await payload(await request(`${root}${path}`, { ...options, signal: controller.signal })); }
    finally { clearTimeout(timer); pending.current.delete(controller); }
  }
  function clearSecret() { setSecret(''); setShown(false); setCopied(false); secretKeyId.current = null; }
  useEffect(() => {
    mounted.current = true;
    const reset = () => { epoch.current++; pending.current.forEach(controller => controller.abort()); mutating.current = false; setKeys([]); setName(''); clearSecret(); setError(''); setNotice(''); setBusy(''); setRevision(value => value + 1); };
    window.addEventListener('office-token-changed', reset);
    return () => { mounted.current = false; epoch.current++; pending.current.forEach(controller => controller.abort()); window.removeEventListener('office-token-changed', reset); };
  }, []);
  useEffect(() => {
    if (!active) { epoch.current++; pending.current.forEach(controller => controller.abort()); clearSecret(); setBusy(''); mutating.current = false; return; }
    const current = epoch.current; let valid = true;
    setLoading(true); setError('');
    call().then(data => { if (valid && mounted.current && current === epoch.current) { if (!Array.isArray(data.keys)) throw Error('The API key list is incomplete. Refresh to retry.'); setKeys(data.keys); } })
      .catch(cause => { if (valid && mounted.current && current === epoch.current) setError(cause.name === 'AbortError' ? 'The key list timed out. Refresh to retry.' : clean(cause.message)); })
      .finally(() => { if (valid && mounted.current && current === epoch.current) setLoading(false); });
    return () => { valid = false; };
  }, [root, request, active, revision]);
  async function generate(event) {
    event.preventDefault(); if (mutating.current || secret || !name.trim()) return;
    const current = epoch.current; mutating.current = true; setBusy('generate'); setError(''); setNotice('');
    try {
      const data = await call('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
      if (mounted.current && current === epoch.current) {
        if (typeof data.secret !== 'string' || !data.secret || !data.key?.id) throw Error('The new key receipt is incomplete. Refresh the list and revoke the unneeded key before generating another.');
        setKeys(previous => [data.key, ...previous.filter(item => item.id !== data.key.id)]); secretKeyId.current = data.key.id; setSecret(data.secret); setShown(false); setCopied(false); setName('');
      }
    } catch (cause) { if (mounted.current && current === epoch.current) setError(cause.name === 'AbortError' || cause.name === 'TypeError' ? 'The key receipt did not arrive. Refresh the list and revoke any new key you could not save before generating another.' : clean(cause.message)); }
    finally { if (mounted.current && current === epoch.current) { mutating.current = false; setBusy(''); } }
  }
  async function revoke(key) {
    if (mutating.current) return;
    const current = epoch.current; mutating.current = true; setBusy(key.id); setError(''); setNotice('');
    try {
      await call(`/${encodeURIComponent(key.id)}`, { method: 'DELETE' });
      if (mounted.current && current === epoch.current) { setKeys(previous => previous.map(item => item.id === key.id ? { ...item, revokedAt: new Date().toISOString() } : item)); if (secretKeyId.current === key.id) clearSecret(); setNotice(`${key.name || 'API key'} revoked. Servers using it must switch to another key.`); }
    } catch (cause) { if (mounted.current && current === epoch.current) setError(clean(cause.message)); }
    finally { if (mounted.current && current === epoch.current) { mutating.current = false; setBusy(''); } }
  }
  async function copy() {
    if (!secret) return;
    try { await navigator.clipboard.writeText(secret); setCopied(true); }
    catch { secretField.current?.focus(); secretField.current?.select(); setNotice('Select the key and copy it, then save it in Render.'); }
  }
  return <section className="studio-keys" aria-label="Pip media API keys">
    <div className="studio-keys-heading"><div><span className="studio-eyebrow"><KeyRound size={15} />PIP MEDIA API</span><h3>Connect your app to Pip.</h3><p>Generate a key for your Render server so users can create photos, videos, and your existing AI content through Pip.</p></div><button type="button" disabled={loading || !!busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} />Refresh keys</button></div>
    {error && <p className="office-ai-error" role="alert">{error}</p>}{notice && <p className="office-ai-notice" role="status"><Check size={15} />{notice}</p>}
    <div className="studio-keys-layout"><div>
      <form className="studio-brief" onSubmit={generate}><div className="studio-card-title"><div><span>01 / GENERATE A KEY</span><h3>Give this connection a name</h3></div><KeyRound size={21} /></div><label className="office-ai-field">Key name<input required maxLength={100} autoComplete="off" value={name} disabled={!!busy || !!secret} onChange={event => setName(event.target.value)} placeholder="For example, Render production" /></label><p className="studio-help">Fixed access: photo generation, video generation, and existing AI content generation. Keep keys on your server and revoke them when you no longer need them.</p><button type="submit" className="office-ai-primary" disabled={loading || !!busy || !!secret || !name.trim()}><Plus size={15} />{busy === 'generate' ? 'Generating key…' : 'Generate API key'}</button></form>
      {secret && <section className="studio-secret" aria-label="New API key"><div><ShieldCheck size={21} /><h3>Save your key now</h3></div><p>This key is shown once. Copy it to your Render service before leaving this tab.</p><div className="studio-secret-field"><input ref={secretField} aria-label="New Pip media API key" readOnly type={shown ? 'text' : 'password'} value={secret} autoComplete="off" spellCheck="false" /><button type="button" aria-label={shown ? 'Hide new API key' : 'Show new API key'} onClick={() => setShown(value => !value)}>{shown ? <EyeOff size={16} /> : <Eye size={16} />}</button></div><div className="studio-key-actions"><button type="button" onClick={copy}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy key'}</button><button type="button" onClick={clearSecret}>I have saved this key</button></div></section>}
      <section className="studio-key-library"><div className="studio-card-title"><div><span>YOUR CONNECTIONS</span><h3>API keys</h3></div><span>{keys.filter(item => !item.revokedAt).length} active</span></div>{loading && <p role="status">Loading API keys…</p>}{!loading && !keys.length && <p className="studio-help">No API keys yet. Create a key for each server that calls Pip.</p>}<div className="studio-key-list">{keys.map(key => <article key={key.id}><div><strong>{key.name || 'Media API key'}</strong><code>{key.prefix || key.lastFour || 'Hidden key'}{key.prefix ? '…' : ''}</code><div className="studio-key-scopes">{(key.scopes || []).filter(scope => SCOPES[scope]).map(scope => <span key={scope}>{SCOPES[scope]}</span>)}</div><small>Created {dateLabel(key.createdAt)}</small><small>Last used {dateLabel(key.lastUsedAt)}</small>{key.dailyGenerationLimit && <small>{key.dailyGenerationLimit} generations / day · {key.userDailyGenerationLimit || 10} per user</small>}{key.expiresAt && <small>Expires {dateLabel(key.expiresAt)}</small>}{key.revokedAt && <span className="studio-key-revoked">Revoked {dateLabel(key.revokedAt)}</span>}</div>{!key.revokedAt && <button type="button" disabled={!!busy} onClick={() => revoke(key)} aria-label={`Revoke key ${key.name || 'Media API key'}`}><Trash2 size={14} />Revoke</button>}</article>)}</div></section>
    </div><aside className="studio-render-guide"><div className="studio-card-title"><div><span>02 / ADD TO RENDER</span><h3>Use the key on your server</h3></div><ShieldCheck size={21} /></div><ol><li>Open your backend service in Render and choose <strong>Environment</strong>.</li><li>Add <code>PIP_STUDIO_API_KEY</code> and paste the generated key as its value.</li><li>Save and redeploy the service to apply the variable.</li><li>Have your server send the key in <code>Authorization: Bearer</code>, with the signed-in user’s ID in <code>x-pip-user-id</code>.</li></ol><p>Your users request generation through your backend. Read the user ID from your server’s authenticated session. Store PIP_STUDIO_API_KEY on your backend Render service; public VITE_* variables expose their contents to visitors.</p><p>Media generation uses the image, narration, storage, and rendering connections configured in Pip.</p><p className="studio-key-scope"><ShieldCheck size={16} />Only photos, videos, and existing AI content generation. Key permissions are fixed to these creation tools.</p><details><summary>Server integration example</summary><pre>{example}</pre><p>Check each HTTP response before continuing. Poll the returned project to follow rendering. Existing AI content drafts use <code>/api/pip/studio/content-draft</code>.</p></details></aside></div>
  </section>;
}
