import { useEffect, useRef, useState } from 'react';
import client, { publicOAuthRequestConfig } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { SOURCE_META } from './sourceMeta';
import { Link } from 'react-router-dom';
import { apiKeyConnectionSetup, publishingRecoveryPath } from './apiKeyConnection.mjs';
import { publishingDestinationChanged, publishingOptionDefaults, publishingOptionsReason } from './publishingOptionValidation.mjs';
import { continueSourceConnectionInBrowser, isNativeRuntime } from '../nativeRuntime.mjs';
import { sourceConnectionPath } from './sourceConnectionPath.mjs';
import { publishingFormatGroups, sharedPublishingTitle } from './publishingFormats.mjs';

export function EnablePublishingButton({ source, disabled = false, label, newTab = false }) {
  const { profile } = useAuth();
  const owner = profile?.id;
  const currentOwner = useRef(owner);
  const mounted = useRef(false);
  const activeRequest = useRef(null);
  currentOwner.current = owner;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    mounted.current = true;
    setBusy(false); setError('');
    return () => { mounted.current = false; activeRequest.current?.abort(); activeRequest.current = null; };
  }, [owner, source]);
  const recoveryPath = publishingRecoveryPath(source);
  if (newTab) return <button type="button" className="btn btn-outline btn-sm" disabled={disabled} onClick={() => {
    if (isNativeRuntime()) { void continueSourceConnectionInBrowser(source, { publishing: true, returnTo: 'command-center' }); return; }
    window.open(sourceConnectionPath(source, { publishing: true, returnTo: 'command-center' }), '_blank', 'noopener,noreferrer');
  }}>{label || (recoveryPath ? apiKeyConnectionSetup(source) ? 'Update publishing key' : 'Update connection' : 'Enable publishing')}</button>;
  if (recoveryPath) return <Link className="btn btn-outline btn-sm" to={recoveryPath} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined} onClick={event => { if (disabled) event.preventDefault(); }}>{label || (apiKeyConnectionSetup(source) ? 'Update publishing key' : 'Update connection')}</Link>;
  async function enable() {
    if (disabled || !owner || activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    const current = () => mounted.current && currentOwner.current === owner
      && activeRequest.current === controller && !controller.signal.aborted;
    setBusy(true); setError('');
    try {
      if (await continueSourceConnectionInBrowser(source, { publishing: true, returnTo: 'command-center' })) {
        if (current()) { setBusy(false); activeRequest.current = null; }
        return;
      }
      if (!current()) return;
      const { data } = await client.get(`/auth/social/${source}/start`, publicOAuthRequestConfig({ signal: controller.signal, params: { publishing: '1', returnTo: 'command-center' } }));
      if (!current()) return;
      if (!data?.url) throw new Error('The provider did not return an authorization URL.');
      window.location.assign(data.url);
    } catch (failure) {
      if (!current()) return;
      setError(failure.response?.data?.message || failure.message || 'Could not request publishing permission.'); setBusy(false);
      activeRequest.current = null;
    }
  }
  return <><button type="button" className="btn btn-outline btn-sm" disabled={disabled || busy} onClick={enable}>{busy ? 'Opening authorization…' : label || 'Enable publishing'}</button>{error && <p role="alert">{error}</p>}</>;
}

export function usePublishingOptions({ selected = [], accounts = {}, connected = {}, enabled = true } = {}) {
  const { profile } = useAuth();
  const owner = String(profile?.id || '');
  const [entries, setEntries] = useState({});
  const [values, setValues] = useState({});
  const [revision, setRevision] = useState({});
  const requests = useRef({});
  const providerAccounts = useRef({});
  const currentOwner = useRef(owner); currentOwner.current = owner;
  const stateOwner = useRef(owner);
  const wanted = enabled ? [...selected].filter(key => connected[key] && accounts[key]?.crossPost?.settingsRequired).sort() : [];
  const signature = JSON.stringify(wanted.map(key => [key, ['github', 'gitlab'].includes(key) ? values[key]?.destinationId || '' : '', revision[key] || 0]));
  useEffect(() => {
    const ownerChanged = stateOwner.current !== owner;
    if (ownerChanged) {
      Object.values(requests.current).forEach(request => request.controller.abort());
      requests.current = {}; providerAccounts.current = {}; stateOwner.current = owner; setEntries({}); setValues({}); setRevision({});
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
        const identity = data.context?.account?.id;
        const accountChanged = Boolean(identity && providerAccounts.current[key] && String(identity) !== providerAccounts.current[key]);
        if (identity) providerAccounts.current[key] = String(identity);
        setEntries(old => ({ ...old, [key]: { schema: data, loading: false, error: '', reconnectRequired: false, accountChanged } }));
        setValues(old => ({ ...old, [key]: publishingOptionDefaults(data, accountChanged ? {} : old[key]) }));
      }).catch(failure => {
        if (!current()) return;
        setEntries(old => ({ ...old, [key]: { loading: false, error: failure.response?.data?.message || 'Could not load publishing destinations.', reconnectRequired: failure.response?.data?.reconnectRequired === true } }));
      });
    }
  }, [owner, signature]);
  useEffect(() => {
    const refresh = () => { Object.values(requests.current).forEach(request => request.controller.abort()); requests.current = {}; setEntries({}); setRevision(old => Object.fromEntries([...new Set([...Object.keys(old), ...wanted])].map(key => [key, (old[key] || 0) + 1]))); };
    window.addEventListener('ufi-connections-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('ufi-connections-changed', refresh); window.removeEventListener('focus', refresh); };
  }, [signature]);
  useEffect(() => () => { Object.values(requests.current).forEach(request => request.controller.abort()); requests.current = {}; }, []);
  const forSource = key => {
    const entry = stateOwner.current === owner ? entries[key] : null;
    const currentValues = stateOwner.current === owner ? values[key] || {} : {};
    return { ...entry, values: currentValues, reason: !wanted.includes(key) ? '' : entry?.loading ? 'Loading publishing options.' : entry?.error || publishingOptionsReason(entry?.schema, currentValues),
      change: (field, value) => { if (currentOwner.current === owner) setValues(old => ({ ...old, [key]: field === 'destinationId' ? publishingDestinationChanged(old[key], value) : { ...old[key], [field]: value } })); },
      retry: () => setRevision(old => ({ ...old, [key]: (old[key] || 0) + 1 })),
    };
  };
  return { sources: wanted, selectedSources: [...selected].filter(key => !['local', 'uficonnect'].includes(key)), accounts, forSource,
    reasons: Object.fromEntries(wanted.map(key => [key, forSource(key).reason])),
    reason: wanted.map(key => forSource(key).reason).find(Boolean) || '',
    payload: Object.fromEntries(wanted.map(key => [key, forSource(key).values])) };
}

const settingsStyle = { border: '1px solid var(--border)', borderRadius: 10, padding: 14, margin: '14px 0 0', minWidth: 0 };
const sourceName = source => SOURCE_META[source]?.label || source;

function ProviderField({ field, options }) {
  return <label>{field.type === 'checkbox'
    ? <><input type="checkbox" checked={options.values[field.key] === true} disabled={options.loading}
      onChange={event => options.change(field.key, event.target.checked)} aria-required={field.required || undefined} /> {field.label}</>
    : <>{field.label}{field.type === 'select'
      ? <select className="form-select" disabled={options.loading} value={options.values[field.key] || ''}
        onChange={event => options.change(field.key, event.target.value)} aria-required={field.required || undefined}>
        <option value="">Choose…</option>{(field.options || []).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      : <input className="form-input" disabled={options.loading} value={options.values[field.key] || ''} maxLength={field.maxLength}
        aria-required={field.required || undefined} onChange={event => options.change(field.key, event.target.value)} />}</>}
  </label>;
}

export default function PublishingOptions({ publishing, disabled = false, newTab = false, renderExtra, hideConnectionActions = [] }) {
  const groups = publishingFormatGroups(publishing.selectedSources || publishing.sources, publishing.accounts);
  return groups.map(group => {
    const schemas = Object.fromEntries(group.sources.map(source => [source, publishing.forSource(source).schema]));
    const title = sharedPublishingTitle(group, schemas);
    const titles = title?.sources.map(source => String(publishing.forSource(source).values.title || '')) || [];
    const sharedValue = new Set(titles).size === 1 ? titles[0] : '';
    return <fieldset key={group.id} disabled={disabled} style={settingsStyle} aria-label={`${group.label} publishing template`}>
      <legend style={{ fontSize: '.9rem', fontWeight: 600 }}>{group.label} template</legend>
      <p style={{ fontSize: '.8rem', color: 'var(--muted)', marginTop: 0 }}>{group.sources.map(sourceName).join(' · ')} use your shared draft and attachment.</p>
      {title && <label style={{ display: 'block', marginBottom: 14 }}>{title.label}
        <input className="form-input" value={sharedValue} maxLength={title.maxLength}
          placeholder={new Set(titles).size > 1 ? 'Enter one title to use for these destinations' : ''}
          onChange={event => title.sources.forEach(source => publishing.forSource(source).change('title', event.target.value))} />
        <small style={{ color: 'var(--muted)' }}>Shared by {title.sources.map(sourceName).join(' and ')}.</small>
      </label>}
      {group.sources.map(source => {
        const options = publishing.forSource(source), schema = options.schema, name = sourceName(source);
        const extra = renderExtra?.(source);
        if (!schema && !options.loading && !options.error && !publishing.sources.includes(source)) return extra ? <div key={source}>{extra}</div> : null;
        const context = schema?.context;
        const lastUsed = new Date(context?.usage?.lastSuccessfulAt);
        const chosen = schema?.destinations?.find(destination => String(destination.id) === String(options.values.destinationId));
        const automatic = chosen && String(schema?.suggestedValues?.destinationId || '') === String(chosen.id);
        return <fieldset key={source} disabled={disabled} style={{ ...settingsStyle, marginTop: 10 }}>
          <legend style={{ fontSize: '.85rem', fontWeight: 600 }}>{schema?.label || `${name} publishing`}</legend>
          {context?.account?.label && <p style={{ margin: '0 0 8px' }}>Connected account: <strong>{context.account.label}</strong>{context.account.handle && ` (@${context.account.handle})`}</p>}
          {options.accountChanged && <p role="status">This connected account changed. Review its destination and publishing settings.</p>}
          {context?.usage?.source === 'uficonnect-publishing-history' && Number.isFinite(lastUsed.getTime()) && <p style={{ fontSize: '.76rem', color: 'var(--muted)' }}>Your last successful publication here: <time dateTime={lastUsed.toISOString()}>{lastUsed.toLocaleString()}</time>. From your UFIConnect publishing history.</p>}
          {automatic && <p style={{ fontSize: '.76rem', color: 'var(--muted)' }}>{context?.recommendation === 'last_successful_destination' ? 'Your last successful destination is selected' : 'The only verified destination is selected'}: {chosen.label}.</p>}
          {options.loading && <p role="status">Loading {name} destinations…</p>}
          {options.error && <div role="alert"><p>{options.error}</p>{options.reconnectRequired
            ? !hideConnectionActions.includes(source) && <EnablePublishingButton source={source} disabled={disabled} newTab={newTab} />
            : <button type="button" className="btn btn-ghost btn-sm" onClick={options.retry}>Try again</button>}</div>}
          {schema && !options.error && <div style={{ display: 'grid', gap: 12, fontSize: '.82rem' }}>
            {schema.notice && <p style={{ margin: 0 }}>{schema.notice}</p>}
            {(schema.destinations?.length > 0 || schema.destinationLabel) && !schema.allowCustomDestination && <label>{schema.destinationLabel || 'Destination'}
              <select className="form-select" value={options.values.destinationId || ''} onChange={event => options.change('destinationId', event.target.value)} aria-required="true">
                <option value="">Choose a destination…</option>{(schema.destinations || []).map(destination => <option key={destination.id} value={destination.id}>{destination.label}{destination.description ? ` — ${destination.description}` : ''}</option>)}
              </select>
            </label>}
            {schema.allowCustomDestination && <label>{schema.destinationLabel || 'Destination URL or ID'}<input className="form-input" disabled={options.loading}
              value={options.values.destinationId || ''} onChange={event => options.change('destinationId', event.target.value)}
              list={`publishing-destinations-${source}`} autoComplete="off" aria-required="true" />
              <datalist id={`publishing-destinations-${source}`}>{(schema.destinations || []).map(destination => <option key={destination.id} value={destination.id}>{destination.label}</option>)}</datalist>
            </label>}
            {(schema.fields || []).filter(field => !(field.key === 'title' && title?.sources.includes(source)))
              .map(field => <ProviderField key={field.key} field={field} options={options} />)}
            {options.reason && !options.loading && <p role="status" style={{ margin: 0, color: 'var(--muted)' }}>{options.reason}</p>}
          </div>}
          {extra}
        </fieldset>;
      })}
    </fieldset>;
  });
}
