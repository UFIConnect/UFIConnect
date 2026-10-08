import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { Globe2, LockKeyhole, Power, RefreshCw, ShieldCheck } from 'lucide-react';
import './VaultVpnPanel.css';
import client from '../api/client';
import { getAccessToken } from '../auth/session';
import VaultVpnSubscription from './VaultVpnSubscription';
import VaultWireGuardProfile from './VaultWireGuardProfile';
import { paidVpnAccess } from '../lib/vpnAccess';
import WebProtectionPanel from './WebProtectionPanel';

function managedPlatform() {
  if (typeof navigator === 'undefined') return null;
  if (/Android/i.test(navigator.userAgent)) return 'android';
  if (/iPad|iPhone|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return /Win/i.test(navigator.platform || navigator.userAgent) ? 'windows' : null;
}

function launchUrl(data) {
  const expires = Date.parse(data?.expiresAt);
  if (typeof data?.url !== 'string' || !/^uficonnect-vpn:\/\/connect\?code=[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(data.url)
    || !Number.isFinite(expires) || expires <= Date.now() + 1000 || expires > Date.now() + 185000) {
    throw new Error('Invalid VPN app handoff.');
  }
  return data.url;
}

// The browser issues a bounded action ticket. Only the signed-in native app
// can redeem it and start a tunnel; opening its link is never proof of a VPN.
export function ManagedVpnPanel({ accountId, activityTarget, subscriptionTarget, billing,
  openApp = url => window.location.assign(url), downloadProfile }) {
  const [config, setConfig] = useState(null);
  const [checking, setChecking] = useState(true);
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState('');
  const [help, setHelp] = useState(false);
  const generation = useRef(0), sequence = useRef(0), inFlight = useRef(null);
  const currentAccount = useRef(accountId); currentAccount.current = accountId;
  const sessionToken = getAccessToken();
  const currentBilling = useRef(billing); currentBilling.current = billing;
  const paid = paidVpnAccess(billing);
  const platform = managedPlatform();
  useEffect(() => {
    const scroll = () => { if (window.location.hash === '#vpn') document.getElementById('vpn')?.scrollIntoView({ block: 'start' }); };
    const frame = requestAnimationFrame(scroll);
    window.addEventListener('hashchange', scroll);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('hashchange', scroll); };
  }, []);
  const refresh = useCallback(async () => {
    const request = ++sequence.current, account = accountId, revision = generation.current, token = getAccessToken();
    if (!account || !token || !paidVpnAccess(currentBilling.current)) { setConfig(null); setChecking(false); return; }
    const current = () => currentAccount.current === account && revision === generation.current && request === sequence.current && token === getAccessToken() && paidVpnAccess(currentBilling.current);
    setChecking(true);
    try {
      const { data } = await client.get('/vpn/config', { headers: { Authorization: `Bearer ${token}` } });
      if (current()) { setConfig(data); setError(''); }
    } catch (failure) { if (current()) { setConfig(null); setError(failure?.response?.status === 403
      ? 'An active paid Vault membership is required for VPN access. Check your subscription status.'
      : 'VPN availability could not be checked. Try again.'); } }
    finally { if (current()) setChecking(false); }
  }, [accountId, paid, sessionToken]);
  useEffect(() => {
    generation.current++; sequence.current++; inFlight.current = null;
    setConfig(null); setOpened(false); setOpening(false); setHelp(false); setError('');
    if (accountId) refresh(); else setChecking(false);
    const invalidate = () => { generation.current++; inFlight.current = null; setOpening(false); setOpened(false); setConfig(null); };
    const focus = () => { if (accountId && !inFlight.current) refresh(); };
    window.addEventListener('ufi-session-cleared', invalidate);
    window.addEventListener('focus', focus);
    return () => { generation.current++; sequence.current++; window.removeEventListener('ufi-session-cleared', invalidate); window.removeEventListener('focus', focus); };
  }, [accountId, refresh]);
  const available = config?.available === true && config?.protocol === 'wireguard' && Array.isArray(config?.gateways) && config.gateways.length > 0;
  const canConnect = Boolean(accountId && sessionToken && paid && available && platform && !checking);
  async function connect() {
    if (!canConnect || !paidVpnAccess(currentBilling.current) || inFlight.current || sessionToken !== getAccessToken() || currentAccount.current !== accountId) return;
    const operation = { account: accountId, revision: generation.current, token: sessionToken };
    const current = () => currentAccount.current === operation.account && generation.current === operation.revision && operation.token === getAccessToken() && paidVpnAccess(currentBilling.current);
    inFlight.current = operation;
    setOpening(true); setOpened(false); setError('');
    try {
      const { data } = await client.post('/vpn/launch', { platform }, { headers: { Authorization: `Bearer ${operation.token}` } });
      if (!current()) return;
      const url = launchUrl(data);
      openApp(url);
      setOpened(true); setHelp(true);
    } catch (failure) {
      if (!current()) return;
      const status = failure?.response?.status;
      setError(status === 401 ? 'Sign in again before opening VPN.' : status === 403 ? 'An active paid Vault membership is required. Check your subscription status.'
        : status === 503 ? 'VPN is temporarily unavailable. Try again shortly.' : 'UFIConnect could not be opened. Check that the VPN app is installed, then try again.');
      setHelp(true);
    } finally { if (inFlight.current === operation) { inFlight.current = null; setOpening(false); } }
  }
  const label = checking || billing.checking ? 'Checking availability' : !paid ? 'Subscription required' : !available ? 'Unavailable' : !platform ? 'App required' : opened ? 'Opening UFIConnect' : 'Ready to open app';
  if (platform === 'ios') return <>
    <VaultWireGuardProfile accountId={accountId} config={config} checking={checking} availabilityError={error} billing={billing} refresh={refresh} download={downloadProfile} />
    {subscriptionTarget && createPortal(<VaultVpnSubscription billing={billing} />, subscriptionTarget)}
    {activityTarget && createPortal(<section className="vault-panel vault-activity" aria-labelledby="vault-activity-title"><div className="vault-panel-heading"><h2 id="vault-activity-title">Connection status</h2><ShieldCheck size={16} /></div><p className="vault-helper">WireGuard shows the real connection status. Turn UFIConnect on or off there after importing your profile.</p></section>, activityTarget)}
  </>;
  return <>
    <section id="vpn" className="vault-panel vault-vpn-panel vault-managed-vpn" aria-labelledby="vault-vpn-title">
      <div className="vault-panel-heading"><span className="vault-eyebrow"><Globe2 size={15} /> CONNECTION</span><button className="vault-icon-button" type="button" aria-label="Check VPN availability" disabled={!paid || checking || opening} onClick={refresh}><RefreshCw size={15} /></button></div>
      <div className="vault-vpn-heading"><h2 id="vault-vpn-title">UFIConnect VPN</h2><span className="vault-status" role="status"><i />{label}</span></div>
      <p className="vault-helper">{platform === 'windows' ? 'Use your existing UFIConnect subscription. Install UFIConnect VPN once, sign in to the same account, then press Enable. The app handles the connection automatically.' : 'Connect this device with the UFIConnect app for Windows or Android. Install a version with VPN support and sign in to the same account once. On iPhone, open this page to get a WireGuard profile.'}</p>
      {platform === 'windows' && <div className="vault-vpn-guide">
        <a className="vault-text-button" href="/downloads/UFIConnect-VPN-Windows-x64-preview.zip" download>Download Windows preview</a>
        <p className="vault-footnote">Windows 10/11 x64. Extract the package and open UFIConnectVpnSetup.exe once. Setup installs the VPN components; no profile import or separate subscription is needed. This preview is unsigned and still needs installation and connection testing on Windows.</p>
      </div>}
      <p className="vault-footnote">UFIConnect uses account and device details to authorize access. Traffic and DNS pass through our gateway; its configuration does not log browsing or DNS queries. Private keys stay on your device. <a href="/privacy">Privacy policy</a></p>
      <div className="vault-vpn-quick-action">
        <button className="vault-button vault-button--full" type="button" disabled={!canConnect || opening} onClick={connect}>{!paid && !billing.checking ? <LockKeyhole size={19} /> : <Power size={19} />}{opening ? 'Opening UFIConnect…' : platform === 'windows' ? 'Enable VPN' : 'Connect VPN'}</button>
        <p className="vault-footnote">{!paid && !billing.checking ? 'An active paid Vault membership is required for VPN access.' : checking ? 'Checking VPN availability…' : !available ? 'VPN is temporarily unavailable. Check availability again shortly.' : !platform ? 'Use UFIConnect on Windows or Android, or get a WireGuard profile on iPhone.' : 'Opens UFIConnect and starts VPN. Your device may ask permission the first time.'}</p>
      </div>
      {error && <p className="vault-helper" role="alert">{error}</p>}
      {opened && <p className="vault-helper" role="status">Opening UFIConnect. Confirm the connection in the app; this page cannot verify the tunnel.</p>}
      <button className="vault-text-button" type="button" aria-expanded={help} onClick={() => setHelp(value => !value)}>{help ? 'Hide app help' : 'App did not open?'}</button>
      {help && <div className="vault-vpn-guide"><p>{platform === 'windows' ? 'Install the Windows preview above, sign in with this same UFIConnect account, and allow your browser to open the app. Then press Enable VPN again. Windows may ask for administrator permission.' : 'Install the UFIConnect app with VPN support, sign in to this same account, and allow your browser to open it. Then try Connect VPN again. Approve the device’s VPN permission if prompted.'}</p><p>Use {platform === 'windows' ? 'Disable' : 'Disconnect'} in the app to stop VPN. Closing this browser page does not disconnect it.</p></div>}
    </section>
    {subscriptionTarget && createPortal(<VaultVpnSubscription billing={billing} />, subscriptionTarget)}
    {activityTarget && createPortal(<section className="vault-panel vault-activity" aria-labelledby="vault-activity-title"><div className="vault-panel-heading"><h2 id="vault-activity-title">Connection status</h2><ShieldCheck size={16} /></div><p className="vault-helper">UFIConnect confirms Connected in the app after the tunnel has a secure handshake. Manage or disconnect the connection there.</p></section>, activityTarget)}
  </>;
}

export default function VaultVpnPanel(props) {
  const { search } = useLocation();
  // Native clients explicitly request their separate device connection flow.
  // Every ordinary browser visit uses automatic web protection.
  if (new URLSearchParams(search).get('device') === 'vpn') return <ManagedVpnPanel {...props} />;
  return <>
    <WebProtectionPanel accountId={props.accountId} />
    {props.subscriptionTarget && createPortal(<VaultVpnSubscription billing={props.billing} />, props.subscriptionTarget)}
    {props.activityTarget && createPortal(<section className="vault-panel vault-activity" aria-labelledby="vault-activity-title">
      <div className="vault-panel-heading"><h2 id="vault-activity-title">Across UFIConnect</h2><ShieldCheck size={16} /></div>
      <p className="vault-helper">Web protection covers your feed, messages, account settings and Vault. Check protection above to verify this browser’s connection and account session.</p>
    </section>, props.activityTarget)}
  </>;
}
