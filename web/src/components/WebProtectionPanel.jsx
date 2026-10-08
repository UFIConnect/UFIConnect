import { useEffect, useId } from 'react';
import { Link } from 'react-router-dom';
import { Check, RefreshCw, ShieldCheck, ShieldAlert } from 'lucide-react';
import useWebConnection from '../security/useWebConnection';
import { webConnectionProtected } from '../security/webConnection.mjs';
import './WebProtectionPanel.css';

const SAFEGUARDS = [
  ['revocableSession', 'Verified sign-in and session revocation'],
  ['privateResponses', 'Private account responses stay out of shared caches'],
  ['privateMessages', 'Private messages require participant access'],
  ['validatedImports', 'Vault imports are checked before use'],
];

export default function WebProtectionPanel({ accountId, variant = 'vault' }) {
  const { status, checking, error, refresh, authenticated } = useWebConnection(accountId);
  const heading = useId();
  const protectedConnection = webConnectionProtected(status);
  const label = checking ? 'Checking protection' : protectedConnection ? 'Protected'
    : !accountId || !authenticated ? 'Sign in to check' : 'Needs attention';
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
        {protectedConnection ? <ShieldCheck size={14} aria-hidden="true" /> : <ShieldAlert size={14} aria-hidden="true" />}{label}
      </span>
    </div>
    <p>Protection runs automatically across UFIConnect in this browser. No app, profile or download is needed.</p>
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
      type="button" disabled={checking || !accountId || !authenticated} onClick={refresh}>
      <RefreshCw size={16} aria-hidden="true" />{checking ? 'Checking protection…' : 'Check protection'}
    </button>
    {status && <p className="web-protection-caption">Last checked <time dateTime={status.checkedAt}>{new Date(status.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>.</p>}
    <p className="web-protection-caption">Covers your UFIConnect connection and account requests. Other sites and apps use their own connections. Your IP address and device VPN settings stay the same.</p>
    <Link className="web-protection-privacy" to="/privacy">Privacy and security practices</Link>
  </section>;
}
