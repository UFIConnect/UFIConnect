import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Power, RefreshCw, ShieldCheck, ShieldAlert } from 'lucide-react';
import useWebConnection from '../security/useWebConnection';
import { webConnectionProtected } from '../security/webConnection.mjs';
import { paidVpnAccess } from '../lib/vpnAccess';
import './WebProtectionPanel.css';

const SAFEGUARDS = [
  ['revocableSession', 'Verified sign-in and session revocation'],
  ['privateResponses', 'Private account responses stay out of shared caches'],
  ['privateMessages', 'Private messages require participant access'],
  ['validatedImports', 'Vault imports are checked before use'],
];

function monitoringPreference(key) {
  if (!key) return true;
  try { return window.localStorage.getItem(key) !== 'off'; } catch { return true; }
}

export default function WebProtectionPanel({ accountId, billing, variant = 'vault' }) {
  const vault = variant === 'vault';
  const paid = !vault || paidVpnAccess(billing);
  const preferenceKey = variant === 'vault' && accountId ? `ufi:vault-monitoring:${encodeURIComponent(accountId)}` : null;
  const currentPreference = useRef(preferenceKey); currentPreference.current = preferenceKey;
  const savedMonitoring = useMemo(() => monitoringPreference(preferenceKey), [preferenceKey]);
  const [monitoring, setMonitoring] = useState(null);
  const enabled = paid && (!vault || (monitoring?.key === preferenceKey ? monitoring.enabled : savedMonitoring));
  const { status, checking, error, refresh, authenticated } = useWebConnection(accountId, enabled);
  const heading = useId();
  const monitoringLabel = useId();
  const protectedConnection = enabled && webConnectionProtected(status);
  const label = !accountId || !authenticated ? 'Sign in to check' : vault && billing?.checking ? 'Checking subscription'
    : !paid ? 'Subscription required' : !enabled ? 'Monitoring paused'
    : checking ? 'Checking protection' : protectedConnection ? 'Protected' : 'Needs attention';
  const toggleMonitoring = () => {
    if (!paid || !accountId || !authenticated) return;
    const next = !enabled;
    setMonitoring({ key: preferenceKey, enabled: next });
    try { if (preferenceKey) window.localStorage.setItem(preferenceKey, next ? 'on' : 'off'); } catch { /* Keep the control usable without browser storage. */ }
  };
  useEffect(() => {
    if (!preferenceKey) return undefined;
    const sync = event => {
      if (currentPreference.current !== preferenceKey) return;
      let storage;
      try { storage = window.localStorage; } catch { return; }
      if (event.storageArea === storage && (event.key === preferenceKey || event.key === null)) {
        setMonitoring({ key: preferenceKey, enabled: monitoringPreference(preferenceKey) });
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [preferenceKey]);
  useEffect(() => {
    if (variant !== 'vault') return undefined;
    const scroll = () => {
      if (['#vpn', '#web-protection'].includes(window.location.hash)) {
        document.getElementById('web-protection')?.scrollIntoView({ block: 'start' });
      }
    };
    const frame = requestAnimationFrame(scroll);
    window.addEventListener('hashchange', scroll);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('hashchange', scroll); };
  }, [variant]);
  return <section id={variant === 'vault' ? 'web-protection' : undefined}
    className={`web-protection-panel ${variant === 'vault' ? 'vault-panel' : 'card'}`}
    aria-labelledby={heading} aria-busy={checking}>
    <div className="web-protection-heading">
      <h2 id={heading}><ShieldCheck size={20} aria-hidden="true" />Web protection</h2>
      <span className={`web-protection-status${protectedConnection ? ' is-protected' : ''}`} role="status">
        {protectedConnection ? <ShieldCheck size={14} aria-hidden="true" /> : !enabled ? <Power size={14} aria-hidden="true" /> : <ShieldAlert size={14} aria-hidden="true" />}{label}
      </span>
    </div>
    <p>{vault ? 'Your paid Vault membership includes automatic connection monitoring inside UFIConnect. No app, profile or download is needed.' : 'Protection runs automatically across UFIConnect in this browser. No app, profile or download is needed.'}</p>
    {variant === 'vault' && <>
      <div className="web-protection-monitoring">
        <h3 id={monitoringLabel}>Vault connection monitoring</h3>
        <button type="button" role="switch" aria-labelledby={monitoringLabel} aria-checked={enabled}
          className={`web-protection-switch${enabled ? ' is-on' : ''}`} disabled={!paid || !accountId || !authenticated} onClick={toggleMonitoring}>
          <Power size={15} aria-hidden="true" />{enabled ? 'On' : 'Off'}
        </button>
      </div>
      <p className="web-protection-caption">Turn automatic connection checks on or off. HTTPS, Vault encryption and account security stay active.</p>
      {!paid && !billing?.checking && <p className="web-protection-caption">An active paid Vault membership is required to enable connection monitoring. Subscribe or check your subscription status.</p>}
    </>}
    {status && <ul className="web-protection-checks">
      <li>{status.transport.encrypted ? <Check size={16} aria-hidden="true" /> : <ShieldAlert size={16} aria-hidden="true" />}
        <span>{status.transport.encrypted ? 'Encrypted HTTPS connection' : 'This connection requires HTTPS'}</span></li>
      {SAFEGUARDS.map(([key, text]) => <li key={key}>
        {status.protections[key] ? <Check size={16} aria-hidden="true" /> : <ShieldAlert size={16} aria-hidden="true" />}
        <span>{text}{!status.protections[key] && ' — unavailable'}</span>
      </li>)}
    </ul>}
    {error && <p className="web-protection-error" role="alert">{error}</p>}
    {!checking && !error && status && !protectedConnection && <p className="web-protection-error" role="alert">Open UFIConnect with HTTPS to protect this connection.</p>}
    <button className={variant === 'vault' ? 'vault-button vault-button--secondary vault-button--full' : 'btn btn-ghost btn-sm'}
      type="button" disabled={!enabled || checking || !accountId || !authenticated} onClick={refresh}>
      <RefreshCw size={16} aria-hidden="true" />{checking ? 'Checking protection…' : 'Check protection'}
    </button>
    {status && <p className="web-protection-caption">Last checked <time dateTime={status.checkedAt}>{new Date(status.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>.</p>}
    <p className="web-protection-caption">Covers your UFIConnect connection and account requests. Other sites and apps use their own connections. Your IP address and device VPN settings stay the same.</p>
    <Link className="web-protection-privacy" to="/privacy">Privacy and security practices</Link>
  </section>;
}
