import { AccountSiteLink } from './DirectoryControls';
import { sourceAuthorizationState } from './sourceAuthorization.mjs';
import SourceButton from './SourceButton';
import { useEffect, useId, useRef, useState } from 'react';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { apiKeyConnectionSetup } from './apiKeyConnection.mjs';

function ApiKeyConnectionDialog({ platformKey, platform, onClose }) {
  const setup = apiKeyConnectionSetup(platformKey, platform);
  const { profile } = useAuth();
  const owner = useRef(profile?.id);
  const controller = useRef(null);
  const input = useRef(null);
  const dialog = useRef(null);
  const titleId = useId();
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { const previousFocus = document.activeElement; input.current?.focus(); return () => { controller.current?.abort(); previousFocus?.focus?.(); }; }, []);
  useEffect(() => { if (owner.current !== profile?.id) { setApiKey(''); onClose(); } }, [profile?.id, onClose]);
  useEffect(() => {
    const escape = event => {
      if (event.key === 'Escape') { setApiKey(''); onClose(); }
      if (event.key === 'Tab') {
        const controls = [...(dialog.current?.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled)') || [])];
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  async function submit(event) {
    event.preventDefault();
    const credential = apiKey.trim();
    if (!credential || busy) return;
    setApiKey(''); setBusy(true); setError('');
    controller.current = new AbortController();
    try {
      await client.post(`/social/connect/${platformKey}`, { apiKey: credential }, { signal: controller.current.signal });
      if (controller.current.signal.aborted || owner.current !== profile?.id) return;
      window.dispatchEvent(new Event('ufi-connections-changed')); onClose();
    } catch (failure) {
      if (!controller.current.signal.aborted) { setError(failure.response?.data?.message || 'Could not verify this API key. Check it and try again.'); setBusy(false); input.current?.focus(); }
    }
  }
  return <div style={{ position: 'fixed', inset: 0, zIndex: 1300, background: '#0008', display: 'grid', placeItems: 'center', padding: 18 }} onClick={event => { if (event.target === event.currentTarget) { setApiKey(''); onClose(); } }}>
    <form ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} className="card" style={{ width: 'min(100%, 440px)', maxHeight: '90vh', overflowY: 'auto' }} onSubmit={submit}>
      <h3 id={titleId}>Connect {platform.name}</h3>
      <p>{setup.description} <a href={setup.setupUrl} target="_blank" rel="noopener noreferrer">Open {setup.settingsLabel}</a>. Your key is sent privately and stored encrypted.</p>
      <label className="form-label" htmlFor={`${titleId}-key`}>{setup.label}</label><input ref={input} id={`${titleId}-key`} className="form-input" type="password" autoComplete="off" value={apiKey} disabled={busy} onChange={event => setApiKey(event.target.value)} required />
      {error && <p role="alert">{error}</p>}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}><button className="btn btn-primary" type="submit" disabled={busy || !apiKey.trim()}>{busy ? 'Verifying…' : 'Connect account'}</button><button className="btn btn-ghost" type="button" onClick={() => { setApiKey(''); onClose(); }}>Cancel</button></div>
    </form>
  </div>;
}

// Catalog readiness controls account authorization. Website visits remain a
// separate action with a label that describes where the link goes.
export default function AccountConnectionAction({
  platformKey, platform, onConnect, connecting = false, disabled = false,
  isConnected = false, className = 'btn btn-outline btn-sm', compact = false,
}) {
  const [keyDialog, setKeyDialog] = useState(false);
  const keySetup = apiKeyConnectionSetup(platformKey, platform);
  const state = sourceAuthorizationState(platform, { isConnected });
  const inactive = disabled || connecting || !state.ready || (platform?.connectionMode === 'api-key' && !keySetup);
  const label = platform?.connectionMode === 'api-key' ? `Connect ${platform?.name || platformKey} with an API key` : `Sign in and connect ${platform?.name || platformKey}`;
  return <>
    <SourceButton source={platformKey} label={platform?.name || platformKey}
      connected={isConnected} locked={!state.ready} reason={state.ready ? label : state.reason}
      className="account-source-button" markClassName="account-action-icon" statusClassName="account-action-lock" onClick={inactive ? undefined : platform?.connectionMode === 'api-key' ? () => setKeyDialog(true) : onConnect}
      disabled={disabled || connecting} aria-label={label} aria-busy={connecting}>
      {connecting && <span className="spinner account-action-spinner" aria-hidden="true" />}
    </SourceButton>
    <AccountSiteLink platform={platformKey} name={platform?.name} siteUrl={platform?.siteUrl} className="account-connection-site-link"
      label={platform?.connectionMode === 'external' ? `Visit ${platform?.name || platformKey} website` : undefined} />
    {keyDialog && <ApiKeyConnectionDialog platformKey={platformKey} platform={platform} onClose={() => setKeyDialog(false)} />}
  </>;
}
