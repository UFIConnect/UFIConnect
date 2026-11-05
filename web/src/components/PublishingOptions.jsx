import { useEffect, useRef, useState } from 'react';
import client, { publicOAuthRequestConfig } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { SOURCE_META } from './sourceMeta';
import { Link } from 'react-router-dom';
import { apiKeyConnectionSetup, publishingRecoveryPath } from './apiKeyConnection.mjs';
import { publishingDestinationChanged, publishingOptionDefaults, publishingOptionsReason } from './publishingOptionValidation.mjs';

export function EnablePublishingButton({ source, disabled = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const recoveryPath = publishingRecoveryPath(source);
  if (recoveryPath) return <Link className="btn btn-outline btn-sm" to={recoveryPath} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined} onClick={event => { if (disabled) event.preventDefault(); }}>{apiKeyConnectionSetup(source) ? 'Update publishing key' : 'Update connection'}</Link>;
  async function enable() {
    setBusy(true); setError('');
    try {
      const { data } = await client.get(`/auth/social/${source}/start`, publicOAuthRequestConfig({ params: { publishing: '1', returnTo: 'command-center' } }));
      if (!data?.url) throw new Error('The provider did not return an authorization URL.');
      window.location.assign(data.url);
    } catch (failure) {
      setError(failure.response?.data?.message || failure.message || 'Could not request publishing permission.'); setBusy(false);
    }
  }
  return <><button type="button" className="btn btn-outline btn-sm" disabled={disabled || busy} onClick={enable}>{busy ? 'Opening authorization…' : 'Enable publishing'}</button>{error && <p role="alert">{error}</p>}</>;
}

export function usePublishingOptions({ selected = [], accounts = {}, connected = {}, enabled = true } = {}) {
  const { profile } = useAuth();
  const owner = String(profile?.id || '');
  const [entries, setEntries] = useState({});
  const [values, setValues] = useState({});
  const [revision, setRevision] = useState({});
  const requests = useRef({});
  const currentOwner = useRef(owner); currentOwner.current = owner;
  const stateOwner = useRef(owner);
  const wanted = enabled ? [...selected].filter(key => connected[key] && accounts[key]?.crossPost?.settingsRequired).sort() : [];
  const signature = JSON.stringify(wanted.map(key => [key, ['github', 'gitlab'].includes(key) ? values[key]?.destinationId || '' : '', revision[key] || 0]));
  useEffect(() => {
    const ownerChanged = stateOwner.current !== owner;
    if (ownerChanged) {
      Object.values(requests.current).forEach(request => request.controller.abort());
      requests.current = {}; stateOwner.current = owner; setEntries({}); setValues({}); setRevision({});
    }
    for (const [key, request] of Object.entries(requests.current)) {
      if (!wanted.includes(key)) { request.controller.abort(); delete requests.current[key]; }
    }
    if (!owner) return;
    for (const key of wanted) {
      const destinationId = !ownerChanged && ['github', 'gitlab'].includes(key) ? values[key]?.destinationId || '' : '';
      const requestKey = `${owner}:${destinationId}:${revision[key] || 0}`;
      if (requests.current[key]?.key === requestKey) continue;
      requests.current[key]?.controller.abort();
      const controller = new AbortController();
      requests.current[key] = { key: requestKey, controller };
      const current = () => !controller.signal.aborted && currentOwner.current === owner && requests.current[key]?.key === requestKey;
      setEntries(old => ({ ...old, [key]: { ...old[key], loading: true, error: '', reconnectRequired: false } }));
      client.get(`/command-center/cross-post/${key}/destinations`, { signal: controller.signal, params: destinationId ? { destinationId } : {} }).then(({ data }) => {
        if (!current()) return;
        setEntries(old => ({ ...old, [key]: { schema: data, loading: false, error: '', reconnectRequired: false } }));
        setValues(old => ({ ...old, [key]: publishingOptionDefaults(data, old[key]) }));
      }).catch(failure => {
        if (!current()) return;
        setEntries(old => ({ ...old, [key]: { loading: false, error: failure.response?.data?.message || 'Could not load publishing destinations.', reconnectRequired: failure.response?.data?.reconnectRequired === true } }));
      });
    }
  }, [owner, signature]);
  useEffect(() => {
    const refresh = () => { Object.values(requests.current).forEach(request => request.controller.abort()); requests.current = {}; setEntries({}); setValues({}); setRevision(old => Object.fromEntries([...new Set([...Object.keys(old), ...wanted])].map(key => [key, (old[key] || 0) + 1]))); };
    window.addEventListener('ufi-connections-changed', refresh);
    return () => window.removeEventListener('ufi-connections-changed', refresh);
  }, [signature]);
  useEffect(() => () => { Object.values(requests.current).forEach(request => request.controller.abort()); requests.current = {}; }, []);
  const forSource = key => {
    const entry = stateOwner.current === owner ? entries[key] : null;
    return { ...entry, values: values[key] || {}, reason: entry?.loading ? 'Loading publishing options.' : entry?.error || publishingOptionsReason(entry?.schema, values[key]),
      change: (field, value) => setValues(old => ({ ...old, [key]: field === 'destinationId' ? publishingDestinationChanged(old[key], value) : { ...old[key], [field]: value } })),
      retry: () => setRevision(old => ({ ...old, [key]: (old[key] || 0) + 1 })),
    };
  };
  return { sources: wanted, forSource, reason: wanted.map(key => forSource(key).reason).find(Boolean) || '', payload: Object.fromEntries(wanted.map(key => [key, values[key] || {}])) };
}

export default function PublishingOptions({ publishing, disabled = false }) {
  return publishing.sources.map(source => {
    const options = publishing.forSource(source);
    const schema = options.schema;
    const name = SOURCE_META[source]?.label || source;
    return <fieldset key={source} disabled={disabled} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, margin: '14px 0 0', minWidth: 0 }}>
      <legend style={{ fontSize: '.85rem', fontWeight: 600 }}>{schema?.label || `${name} publishing`}</legend>
      {options.loading && <p role="status">Loading {name} destinations…</p>}
      {options.error && <div role="alert"><p>{options.error}</p>{options.reconnectRequired ? <EnablePublishingButton source={source} disabled={disabled} /> : <button type="button" className="btn btn-ghost btn-sm" onClick={options.retry}>Try again</button>}</div>}
      {schema && !options.error && <div style={{ display: 'grid', gap: 12, fontSize: '.82rem' }}>
        {schema.notice && <p style={{ margin: 0 }}>{schema.notice}</p>}
        {(schema.destinations?.length > 0 || schema.destinationLabel) && !schema.allowCustomDestination && <label>{schema.destinationLabel || 'Destination'}<select className="form-select" value={options.values.destinationId || ''} onChange={event => options.change('destinationId', event.target.value)} required><option value="">Choose a destination…</option>{(schema.destinations || []).map(destination => <option key={destination.id} value={destination.id}>{destination.label}{destination.description ? ` — ${destination.description}` : ''}</option>)}</select></label>}
        {schema.allowCustomDestination && <label>{schema.destinationLabel || 'Destination URL or ID'}<input className="form-input" disabled={options.loading} value={options.values.destinationId || ''} onChange={event => options.change('destinationId', event.target.value)} list={`publishing-destinations-${source}`} autoComplete="off" required /><datalist id={`publishing-destinations-${source}`}>{(schema.destinations || []).map(destination => <option key={destination.id} value={destination.id}>{destination.label}</option>)}</datalist></label>}
        {(schema.fields || []).map(field => <label key={field.key}>{field.type === 'checkbox' ? <><input type="checkbox" checked={options.values[field.key] === true} disabled={options.loading} onChange={event => options.change(field.key, event.target.checked)} required={field.required} /> {field.label}</> : <>{field.label}{field.type === 'select' ? <select className="form-select" disabled={options.loading} value={options.values[field.key] || ''} onChange={event => options.change(field.key, event.target.value)} required={field.required}><option value="">Choose…</option>{(field.options || []).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input className="form-input" disabled={options.loading} value={options.values[field.key] || ''} maxLength={field.maxLength} required={field.required} onChange={event => options.change(field.key, event.target.value)} />}</>}</label>)}
        {options.reason && !options.loading && <p role="status" style={{ margin: 0, color: 'var(--muted)' }}>{options.reason}</p>}
      </div>}
    </fieldset>;
  });
}
