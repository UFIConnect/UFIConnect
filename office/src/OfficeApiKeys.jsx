import { useEffect, useRef, useState } from 'react';
import { Check, Copy, FileText, Image, KeyRound, MessageSquare, RefreshCw, ShieldCheck, Terminal, Trash2 } from 'lucide-react';
import './OfficeApiKeys.css';

const blankForm = () => ({ type: 'data', name: '', scopes: ['topics:read', 'feed:read'], ownerId: '', expiration: '30' });
const TYPE_ICONS = { data: KeyRound, 'ai-chat': MessageSquare, media: Image, 'ai-content': FileText };
const QUICKSTARTS = {
  data: { path: '/topics', method: 'GET', endpoints: [{ label: 'Read topics', path: '/topics', scope: 'topics:read' }, { label: 'Read the public feed', path: '/feed?limit=20', scope: 'feed:read' }, { label: 'Read a post created by this key', path: '/posts/{postId}', scope: 'feed:read' }, { label: 'Publish a post', method: 'POST', path: '/posts', scope: 'posts:publish' }, { label: 'Edit a post created by this key', method: 'PATCH', path: '/posts/{postId}', scope: 'posts:edit' }] },
  'ai-chat': { path: '/chat/completions', method: 'POST', body: { messages: [{ role: 'user', content: 'Hello! How can you help?' }], max_tokens: 1024 }, endpoints: [{ label: 'AI chat', path: '/chat/completions', scope: 'ai:chat' }] },
  media: { path: '/images/generations', method: 'POST', body: { prompt: 'A peaceful mountain lake at sunrise' }, endpoints: [{ label: 'Generate a photo', path: '/images/generations', scope: 'images:generate' }, { label: 'Generate a video', path: '/videos/generations', scope: 'videos:generate' }] },
  'ai-content': { path: '/content/generations', method: 'POST', body: { prompt: 'Write a short welcome message for a travel community.', kind: 'post', tone: 'friendly' }, endpoints: [{ label: 'Generate AI content', path: '/content/generations', scope: 'content:generate' }] },
};
const date = value => value ? new Date(value).toLocaleString() : 'Never';
const statusOf = key => key.revokedAt ? 'revoked' : key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now() ? 'expired' : key.status || 'active';

async function read(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(response.status === 401 ? 'Reconnect to Office to manage API keys.' :
    response.status === 404 ? 'API key management is unavailable on this service version.' : data.error || data.message || 'The API key request could not be completed.');
  return data;
}

export default function OfficeApiKeys({ apiBase, request }) {
  const [keys, setKeys] = useState([]), [scopes, setScopes] = useState([]), [types, setTypes] = useState([]), [form, setForm] = useState(blankForm);
  const [loading, setLoading] = useState(true), [ready, setReady] = useState(false), [busy, setBusy] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [secret, setSecret] = useState('');
  const [copied, setCopied] = useState(false), [revoking, setRevoking] = useState(''), [revision, setRevision] = useState(0);
  const [rateLimit, setRateLimit] = useState(null);
  const [generationLimits, setGenerationLimits] = useState({});
  const [exampleMedia, setExampleMedia] = useState('photo'), [contentKind, setContentKind] = useState('post'), [contentTone, setContentTone] = useState('friendly');
  const [ownerQuery, setOwnerQuery] = useState(''), [owners, setOwners] = useState([]), [ownerLoading, setOwnerLoading] = useState(false), [ownerSearched, setOwnerSearched] = useState(false), [ownerError, setOwnerError] = useState('');
  const [exampleData, setExampleData] = useState('read');
  const mounted = useRef(false), generation = useRef(0), controllers = useRef(new Set()), lock = useRef(false), secretRef = useRef('');
  const ownerSequence = useRef(0);
  const generatedInput = useRef(null);
  const apiOrigin = /^(?:www\.)?uficonnect\.ai$/i.test(window.location.hostname) ? window.location.origin : apiBase || window.location.origin;
  const endpoint = `${apiOrigin.replace(/\/$/, '')}/api/v1`;
  const selectedType = types.find(type => type.id === form.type);
  const visibleScopes = scopes.filter(scope => selectedType?.scopes.includes(scope.id));
  const requiresOwner = form.type === 'data' && form.scopes.some(scope => ['posts:publish', 'posts:edit'].includes(scope));
  const editingOnly = form.type === 'data' && form.scopes.includes('posts:edit') && !form.scopes.includes('posts:publish');
  const dataExamples = [{ id: 'read', label: 'Read topics', scope: 'topics:read', path: '/topics', method: 'GET' }, { id: 'feed', label: 'Read the public feed', scope: 'feed:read', path: '/feed?limit=20', method: 'GET' }, { id: 'publish', label: 'Publish a post', scope: 'posts:publish', path: '/posts', method: 'POST', body: { requestId: 'REQUEST_UUID', content: 'Hello from the UFIConnect API!' } }, { id: 'edit', label: 'Edit a post', scope: 'posts:edit', path: '/posts/POST_ID', method: 'PATCH', body: { content: 'An updated message from the API.', expectedVersion: 1 } }].filter(item => form.scopes.includes(item.scope));
  const dataExample = dataExamples.find(item => item.id === exampleData) || dataExamples[0] || QUICKSTARTS.data;
  const mediaExample = form.scopes.includes('videos:generate') && (!form.scopes.includes('images:generate') || exampleMedia === 'video') ? 'video' : 'photo';
  const baseQuickstart = QUICKSTARTS[form.type] || QUICKSTARTS.data;
  const quickstart = form.type === 'data' ? { ...baseQuickstart, ...dataExample, endpoints: baseQuickstart.endpoints } : form.type === 'media' && mediaExample === 'video' ? { ...baseQuickstart, path: '/videos/generations', body: { prompt: 'A peaceful mountain lake at sunrise', seconds: 4 } } : form.type === 'ai-content' ? { ...baseQuickstart, body: { ...baseQuickstart.body, kind: contentKind, tone: contentTone } } : baseQuickstart;
  const example = [`curl ${quickstart.method === 'PATCH' ? '-X PATCH ' : ''}"${endpoint}${quickstart.path}"`, '  -H "Authorization: Bearer $UFICONNECT_API_KEY"', ...(quickstart.body ? ['  -H "Content-Type: application/json"', `  -d '${JSON.stringify(quickstart.body)}'`] : [])].join(' \\\n');

  useEffect(() => {
    mounted.current = true;
    const clear = () => {
      generation.current++; controllers.current.forEach(controller => controller.abort()); controllers.current.clear(); lock.current = false; secretRef.current = '';
      ownerSequence.current++; setOwners([]); setOwnerQuery(''); setOwnerSearched(false); setOwnerLoading(false); setOwnerError(''); setExampleData('read');
      setKeys([]); setScopes([]); setTypes([]); setRateLimit(null); setGenerationLimits({}); setReady(false); setForm(blankForm()); setExampleMedia('photo'); setContentKind('post'); setContentTone('friendly'); setSecret(''); setCopied(false); setRevoking(''); setBusy(''); setError(''); setNotice(''); setRevision(value => value + 1);
    };
    window.addEventListener('office-token-changed', clear);
    return () => {
      mounted.current = false; generation.current++; secretRef.current = ''; controllers.current.forEach(controller => controller.abort()); controllers.current.clear();
      window.removeEventListener('office-token-changed', clear);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController(), current = generation.current;
    let stopped = false;
    const isCurrent = () => mounted.current && current === generation.current && !stopped;
    const timer = setTimeout(() => controller.abort(), 20000);
    controllers.current.add(controller); setLoading(true); setError('');
    request(`${apiBase}/office/api-keys`, { signal: controller.signal }).then(read).then(data => {
      if (!isCurrent() || controller.signal.aborted) return;
      if (!Array.isArray(data.keys) || !Array.isArray(data.scopes) || !data.scopes.length || !Array.isArray(data.types) || !data.types.length) throw Error('API key management is unavailable on this service version.');
      setKeys(data.keys); setScopes(data.scopes); setTypes(data.types); setRateLimit(data.rateLimit); setGenerationLimits(data.generationLimits || {}); setReady(true);
    }).catch(e => {
      if (isCurrent()) { setReady(false); setError(controller.signal.aborted ? 'The API key check timed out. Refresh to try again.' : e.message); }
    }).finally(() => { clearTimeout(timer); controllers.current.delete(controller); if (isCurrent()) setLoading(false); });
    return () => { stopped = true; clearTimeout(timer); controller.abort(); controllers.current.delete(controller); };
  }, [apiBase, request, revision]);

  useEffect(() => { if (secret) generatedInput.current?.focus(); }, [secret]);

  async function operation(action, keyId) {
    if (lock.current || (action === 'create' && (secretRef.current || editingOnly || (requiresOwner && !form.ownerId)))) return;
    const controller = new AbortController(), current = generation.current;
    const isCurrent = () => mounted.current && current === generation.current;
    lock.current = true; setBusy(action === 'create' ? 'create' : keyId); setError(''); setNotice('');
    controllers.current.add(controller);
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const options = action === 'create' ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: form.type, name: form.name.trim(), scopes: form.scopes, ...(requiresOwner ? { ownerId: form.ownerId } : {}), expiresInDays: form.expiration === 'never' ? null : Number(form.expiration) }) } : { method: 'DELETE' };
      const data = await read(await request(`${apiBase}/office/api-keys${action === 'create' ? '' : `/${encodeURIComponent(keyId)}`}`, { ...options, signal: controller.signal }));
      if (!isCurrent() || controller.signal.aborted) return;
      if (!data.apiKey || (action === 'create' && typeof data.key !== 'string')) throw Error('The server returned an incomplete result. Refresh the key list before retrying.');
      setKeys(previous => [data.apiKey, ...previous.filter(key => key.id !== data.apiKey.id)]);
      if (action === 'create') {
        secretRef.current = data.key; setSecret(data.key); setCopied(false); setForm(previous => ({ ...previous, name: '' })); setRevoking('');
      } else { setRevoking(''); setNotice(`${data.apiKey.name} was revoked. Requests using it will be rejected.`); }
    } catch (e) {
      if (isCurrent()) setError(controller.signal.aborted ? 'The request timed out. Refresh the key list to check whether it completed before retrying.' : e.message);
    } finally {
      clearTimeout(timer); controllers.current.delete(controller);
      if (isCurrent()) { lock.current = false; setBusy(''); }
    }
  }

  async function searchOwners() {
    if (!ownerQuery.trim() || ownerLoading) return;
    const controller = new AbortController(), current = generation.current, sequence = ++ownerSequence.current;
    const isCurrent = () => mounted.current && current === generation.current && sequence === ownerSequence.current;
    const timer = setTimeout(() => controller.abort(), 20000);
    controllers.current.add(controller); setOwnerLoading(true); setOwnerError(''); setOwnerSearched(false); setOwners([]); setForm(previous => ({ ...previous, ownerId: '' }));
    try {
      const params = new URLSearchParams({ q: ownerQuery.trim(), state: 'all', days: 'all', page: '1' });
      const data = await read(await request(`${apiBase}/office/users?${params}`, { signal: controller.signal, cache: 'no-store' }));
      if (!isCurrent() || controller.signal.aborted) return;
      if (!data.available || !Array.isArray(data.recent)) throw Error('Member accounts could not be loaded. Try searching again.');
      setOwners(data.recent); setOwnerSearched(true); setForm(previous => ({ ...previous, ownerId: data.recent.some(owner => owner.id === previous.ownerId) ? previous.ownerId : '' }));
    } catch (e) {
      if (isCurrent()) setOwnerError(controller.signal.aborted ? 'The account search timed out. Try searching again.' : e.message);
    } finally {
      clearTimeout(timer); controllers.current.delete(controller); if (isCurrent()) setOwnerLoading(false);
    }
  }

  async function copyKey() {
    const current = generation.current, value = secretRef.current;
    if (!value) return;
    setError('');
    try {
      if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      if (mounted.current && current === generation.current && secretRef.current === value) { setCopied(true); setNotice('API key copied. Save it in your secret manager.'); }
    } catch {
      if (mounted.current && current === generation.current && secretRef.current === value) {
        setError('Your browser could not copy the key. Select the key and copy it manually.'); generatedInput.current?.focus(); generatedInput.current?.select();
      }
    }
  }
  const activeCount = keys.filter(key => statusOf(key) === 'active').length;
  const unavailable = loading || Boolean(busy) || !ready;
  return <section className="office-api-keys" aria-label="UFIConnect API keys" aria-busy={loading || Boolean(busy)}>
    <div className="oak-heading"><div><p className="oak-eyebrow">BUILD WITH UFICONNECT</p><h2>API Keys</h2><p>Create separate keys for platform data, AI chat, photo and video generation, and AI content. Choose the access each integration needs.</p></div>
      <button type="button" disabled={loading || Boolean(busy)} onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} aria-hidden="true" />Refresh keys</button></div>
    {error && <p className="oak-error" role="alert">{error}</p>}
    {notice && <p className="oak-notice" role="status">{notice}</p>}
    {secret && <div className="oak-secret" aria-labelledby="oak-secret-title"><div className="oak-title"><KeyRound size={20} aria-hidden="true" /><h3 id="oak-secret-title">Save your new API key</h3></div>
      <p>The full key is shown only once. Save it now: closing this panel or leaving this tab hides it permanently.</p>
      <div className="oak-secret-value"><input ref={generatedInput} aria-label="New API key" type="text" readOnly value={secret} autoComplete="off" autoCapitalize="none" spellCheck="false" onFocus={event => event.target.select()} />
        <button type="button" onClick={copyKey}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copied ? 'Copied' : 'Copy key'}</button></div>
      <button type="button" onClick={() => { secretRef.current = ''; setSecret(''); setCopied(false); setNotice(''); setError(''); }}>I saved my key</button>
    </div>}
    <div className="oak-layout">
      <form className="oak-card oak-create" onSubmit={event => { event.preventDefault(); operation('create'); }} aria-label="Generate an API key">
        <div className="oak-title"><KeyRound size={20} aria-hidden="true" /><h3>Generate a key</h3></div>
        <fieldset className="oak-types-fieldset" disabled={unavailable || Boolean(secret)}><legend>Key type</legend><p>Each key belongs to one category.</p><div className="oak-types">{types.map(type => {
          const Icon = TYPE_ICONS[type.id] || KeyRound;
          return <label key={type.id} className={`oak-type${form.type === type.id ? ' oak-type-selected' : ''}`}><input type="radio" name="api-key-type" value={type.id} checked={form.type === type.id} onChange={() => setForm(value => ({ ...value, type: type.id, ownerId: '', scopes: type.scopes.filter(scope => type.id !== 'data' || scope.endsWith(':read')) }))} /><Icon size={17} aria-hidden="true" /><span><strong>{type.label}</strong><small>{type.description}</small></span></label>;
        })}</div>{!types.length && <p>{loading ? 'Loading key types...' : 'Refresh keys to load available key types.'}</p>}</fieldset>
        <label className="oak-field">Key name<input name="api-key-name" placeholder="e.g. Website integration" required maxLength={80} value={form.name} disabled={unavailable || Boolean(secret)} onChange={event => setForm(value => ({ ...value, name: event.target.value }))} /></label>
        <fieldset disabled={unavailable || Boolean(secret)}><legend>Permissions</legend><p>Choose the options available to this key.</p>
          {visibleScopes.map(scope => <label key={scope.id} className="oak-scope"><input type="checkbox" checked={form.scopes.includes(scope.id)} onChange={event => setForm(value => ({ ...value, scopes: event.target.checked ? [...value.scopes, scope.id] : value.scopes.filter(id => id !== scope.id) }))} /><span><strong>{scope.label}</strong><small>{scope.description}</small>{generationLimits[scope.id] != null && <small className="oak-limit">Daily limit: {generationLimits[scope.id]} requests per key</small>}</span></label>)}
          {!visibleScopes.length && <p>{loading ? 'Loading available permissions...' : 'Refresh keys to load available permissions.'}</p>}
          {editingOnly && <p className="oak-small">Enable Publish posts so this key can create the posts it edits.</p>}
          {form.type !== 'data' && <p className="oak-small">Daily limits reset at 00:00 UTC. Generation requires the corresponding AI provider to be connected in Office.</p>}
        </fieldset>
        {requiresOwner && <div className="oak-owner"><h4>Publishing account</h4><p>Choose the member account this key publishes as. Editing is limited to posts created by this key.</p><label className="oak-field">Find a member<input type="search" value={ownerQuery} disabled={unavailable || Boolean(secret)} maxLength={160} placeholder="Search by name or email" onChange={event => { setOwnerQuery(event.target.value); setForm(previous => ({ ...previous, ownerId: '' })); setOwners([]); setOwnerSearched(false); setOwnerError(''); ownerSequence.current++; setOwnerLoading(false); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); searchOwners(); } }} /></label><button type="button" onClick={searchOwners} disabled={unavailable || Boolean(secret) || ownerLoading || !ownerQuery.trim()}>{ownerLoading ? 'Searching accounts...' : 'Search accounts'}</button>
          {ownerError && <p role="alert" className="oak-error">{ownerError}</p>}{ownerLoading && <p role="status">Finding member accounts...</p>}
          {owners.length > 0 && <label className="oak-field">Publish as<select aria-label="Publish as" required value={form.ownerId} disabled={unavailable || Boolean(secret)} onChange={event => setForm(value => ({ ...value, ownerId: event.target.value }))}><option value="">Select a member account</option>{owners.map(owner => <option key={owner.id} value={owner.id}>{owner.name || 'Member'}{owner.email ? ` (${owner.email})` : ''}</option>)}</select></label>}
          {ownerSearched && !owners.length && <p>No matching accounts found. Try a different name or email.</p>}
        </div>}
        <label className="oak-field">Expiration<select aria-label="Expiration" value={form.expiration} disabled={unavailable || Boolean(secret)} onChange={event => setForm(value => ({ ...value, expiration: event.target.value }))}><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option><option value="never">No expiration</option></select></label>
        <button className="oak-primary" type="submit" disabled={unavailable || Boolean(secret) || !form.name.trim() || !form.scopes.length || editingOnly || (requiresOwner && !form.ownerId)}>{busy === 'create' ? 'Generating key...' : 'Generate API key'}</button>
        <p className="oak-small">{secret ? 'Save the new key above before generating another.' : 'Keep keys in your server environment or secret manager. Generate a separate key for each category and integration.'}</p>
      </form>
      <div className="oak-card oak-guide"><div className="oak-title"><Terminal size={20} aria-hidden="true" /><h3>Make your first request</h3></div>
        <p>Set <code>UFICONNECT_API_KEY</code> in your environment, then send the key in the Authorization header.</p>
        {form.type === 'data' && <label className="oak-field">Example request<select aria-label="Example request" value={dataExample.id || 'read'} disabled={!dataExamples.length} onChange={event => setExampleData(event.target.value)}>{dataExamples.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}{!dataExamples.length && <option value="read">Select a permission first</option>}</select></label>}
        {form.type === 'media' && <label className="oak-field">Example request<select aria-label="Example request" value={mediaExample} onChange={event => setExampleMedia(event.target.value)}><option value="photo" disabled={!form.scopes.includes('images:generate')}>Generate a photo</option><option value="video" disabled={!form.scopes.includes('videos:generate')}>Generate a video</option></select></label>}
        {form.type === 'ai-content' && <div className="oak-example-options"><label className="oak-field">Content format<select aria-label="Content format" value={contentKind} onChange={event => setContentKind(event.target.value)}><option value="post">Social post</option><option value="caption">Caption</option><option value="article">Article</option><option value="email">Email</option><option value="product-description">Product description</option><option value="hashtags">Hashtags</option></select></label><label className="oak-field">Tone<select aria-label="Tone" value={contentTone} onChange={event => setContentTone(event.target.value)}><option value="friendly">Friendly</option><option value="professional">Professional</option><option value="calm">Calm</option><option value="playful">Playful</option></select></label></div>}
        <p className="oak-guide-type">{selectedType?.label || 'Platform data'} example</p><pre><code>{example}</code></pre>
        <dl className="oak-endpoints">{quickstart.endpoints.map(item => <div key={`${item.method || baseQuickstart.method}:${item.path}`}><dt>{item.label}</dt><dd><code>{item.method || baseQuickstart.method} /api/v1{item.path}</code><span>Requires {item.scope}</span></dd></div>)}</dl>
        {form.type === 'data' && requiresOwner && <p className="oak-small">Publishing creates posts on behalf of the selected member. Replace REQUEST_UUID with a fresh UUID for each new post; reuse it when retrying that same post. Editing applies only to posts created by this key. Replace POST_ID with its returned post ID and expectedVersion with its current version.</p>}
        {form.type === 'media' && <p className="oak-small">Photo and video access can be selected independently. Video generation runs as a job; use the returned job ID to check its progress.</p>}
        {rateLimit && <p className="oak-small">Rate limit: {rateLimit.requests} requests per key every {rateLimit.windowSeconds} seconds.{form.type === 'data' ? ' Feed responses support pagination with a cursor.' : ''}</p>}
        <p className="oak-security"><ShieldCheck size={17} aria-hidden="true" />Only a hash of each key is stored. Revoke a key here to stop future requests.</p>
      </div>
    </div>
    <div className="oak-list-heading"><h3>Your keys</h3><span>{loading ? 'Checking keys...' : ready ? `${activeCount} active` : 'Check unavailable'}</span></div>
    {loading && <p role="status">Loading API keys...</p>}
    {!loading && ready && !keys.length && <div className="oak-empty"><KeyRound size={27} aria-hidden="true" /><h3>No API keys yet</h3><p>Give your first key a name and choose its permissions to get started.</p></div>}
    {ready && <div className="oak-key-list">{keys.map(key => {
      const status = statusOf(key);
      return <article className="oak-card oak-key" key={key.id} aria-label={`API key ${key.name}`}><div className="oak-key-heading"><div><h4>{key.name}</h4><code>{key.prefix}...</code></div><span className={`oak-status oak-${status}`}>{status}</span></div>
        <div className="oak-key-type">{types.find(type => type.id === (key.type || 'data'))?.label || key.type || 'Platform data'}</div>
        {key.ownerId && <p className="oak-small">Publishing account: {owners.find(owner => owner.id === key.ownerId)?.name || key.ownerId}</p>}
        <div className="oak-tags">{key.scopes.map(scope => <span key={scope}>{scope}</span>)}</div>
        <dl className="oak-dates"><div><dt>Created</dt><dd>{date(key.createdAt)}</dd></div><div><dt>Expires</dt><dd>{date(key.expiresAt)}</dd></div><div><dt>Last used</dt><dd>{key.lastUsedAt ? date(key.lastUsedAt) : 'Not used yet'}</dd></div>{key.revokedAt && <div><dt>Revoked</dt><dd>{date(key.revokedAt)}</dd></div>}</dl>
        {status !== 'revoked' && (revoking === key.id ? <div className="oak-confirm"><p>Revoke {key.name}? Any integration using this key will lose access.</p><div className="oak-actions"><button type="button" className="oak-danger" disabled={unavailable} onClick={() => operation('revoke', key.id)}>{busy === key.id ? 'Revoking...' : 'Confirm revoke'}</button><button type="button" disabled={Boolean(busy)} onClick={() => setRevoking('')}>Cancel</button></div></div> : <button type="button" className="oak-revoke" disabled={unavailable} onClick={() => { setRevoking(key.id); setError(''); setNotice(''); }} aria-label={`Revoke ${key.name}`}><Trash2 size={14} aria-hidden="true" />Revoke key</button>)}
      </article>;
    })}</div>}
  </section>;
}
