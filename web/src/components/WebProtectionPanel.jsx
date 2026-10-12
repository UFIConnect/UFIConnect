import { useEffect, useId } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Check, Power, RefreshCw, ShieldCheck, ShieldAlert } from 'lucide-react';
import useWebConnection from '../security/useWebConnection';
import { webConnectionProtected } from '../security/webConnection.mjs';
import { useVaultConnection } from '../contexts/VaultConnectionContext';
import useVaultConnectionMonitor from '../security/useVaultConnectionMonitor';
import './WebProtectionPanel.css';
import { isNativeRuntime } from '../nativeRuntime.mjs';

const SAFEGUARDS = [
  ['revocableSession', 'Verified sign-in and session revocation'],
  ['privateResponses', 'Private account responses stay out of shared caches'],
  ['privateMessages', 'Private messages require participant access'],
  ['validatedImports', 'Vault imports are checked before use'],
];

export default function WebProtectionPanel({ accountId, billing, variant = 'vault' }) {
  const shared = useVaultConnection();
  if (variant === 'vault' && shared) {
    const matching = shared.accountId === accountId;
    const service = matching ? shared : { ...shared, paid: false, enabled: false, status: null, error: '', checking: true };
    return <WebProtectionContent accountId={matching ? accountId : null} billing={shared.billing} variant={variant} service={service} />;
  }
  return variant === 'vault' ? <StandaloneVaultProtection accountId={accountId} billing={billing} /> : <BaselineWebProtection accountId={accountId} />;
}

function StandaloneVaultProtection({ accountId, billing }) {
  const service = useVaultConnectionMonitor(accountId, billing);
  return <WebProtectionContent accountId={accountId} billing={billing} variant="vault" service={service} />;
}

function BaselineWebProtection({ accountId }) {
  const connection = useWebConnection(accountId);
  return <WebProtectionContent accountId={accountId} variant="settings" service={{ ...connection, paid: true, enabled: true }} />;
}

function WebProtectionContent({ accountId, billing, variant, service }) {
  const location = useLocation();
  const vault = variant === 'vault';
  const { paid, enabled, status, checking, error, refresh, authenticated } = service;
  const heading = useId();
  const monitoringLabel = useId();
  const protectedConnection = enabled && webConnectionProtected(status);
  const label = !accountId || !authenticated ? 'Sign in to check' : vault && billing?.checking && !paid ? 'Checking subscription'
    : !paid ? 'Subscription required' : !enabled ? 'Monitoring paused'
    : checking ? 'Checking protection' : protectedConnection ? 'Protected' : 'Needs attention';
  const toggleMonitoring = () => {
    if (!paid || !accountId || !authenticated) return;
    service.setMonitoring(!enabled);
  };
  useEffect(() => {
    if (variant !== 'vault' || !['#vpn', '#web-protection'].includes(location.hash)) return undefined;
    const frame = requestAnimationFrame(() => document.getElementById('web-protection')?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [variant, location.hash]);
  return <section id={variant === 'vault' ? 'web-protection' : undefined}
    className={`web-protection-panel ${variant === 'vault' ? 'vault-panel' : 'card'}`}
    aria-labelledby={heading} aria-busy={checking}>
    <div className="web-protection-heading">
      <h2 id={heading}><ShieldCheck size={20} aria-hidden="true" />Web protection</h2>
      <span className={`web-protection-status${protectedConnection ? ' is-protected' : ''}`} role="status">
        {protectedConnection ? <ShieldCheck size={14} aria-hidden="true" /> : !enabled ? <Power size={14} aria-hidden="true" /> : <ShieldAlert size={14} aria-hidden="true" />}{label}
      </span>
    </div>
    <p>{vault ? 'Your paid Vault membership includes automatic connection monitoring across UFIConnect pages in this browser. No app, profile or download is needed.' : 'HTTPS and account security protect your UFIConnect connection in this browser. These checks verify the current connection.'}</p>
    {variant === 'vault' && <>
      <div className="web-protection-monitoring">
        <h3 id={monitoringLabel}>Vault connection monitoring</h3>
        <button type="button" role="switch" aria-labelledby={monitoringLabel} aria-checked={enabled}
          className={`web-protection-switch${enabled ? ' is-on' : ''}`} disabled={!paid || !accountId || !authenticated} onClick={toggleMonitoring}>
          <Power size={15} aria-hidden="true" />{enabled ? 'On' : 'Off'}
        </button>
      </div>
      <p className="web-protection-caption">Turn automatic connection checks on or off. HTTPS, Vault encryption and account security stay active.</p>
      {!paid && !billing?.checking && <p className="web-protection-caption">{isNativeRuntime() ? 'An active Vault membership is required to enable connection monitoring. Check your membership status to confirm existing access.' : 'An active paid Vault membership is required to enable connection monitoring. Subscribe or check your subscription status.'}</p>}
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
