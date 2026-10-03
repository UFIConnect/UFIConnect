import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Clock3, Globe2, LockKeyhole, Plus, Power, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import './VaultVpnPanel.css';
import client from '../api/client';
import VaultVpnSubscription from './VaultVpnSubscription';

const LOCAL_PREVIEW = import.meta.env.VITE_VAULT_LOCAL_PREVIEW === 'true' && typeof window !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
const PLATFORMS = { windows: 'Windows', linux: 'Linux', ios: 'iOS', android: 'Android' };
const GUIDES = {
  windows: { settings: 'Settings → Network & internet → VPN', link: 'https://support.microsoft.com/windows/connect-to-a-vpn-in-windows-3d29aeb1-f497-f6b7-7633-115722c1009c' },
  linux: { settings: 'System settings → Network → VPN (NetworkManager)', link: 'https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/nmcli.html' },
  ios: { settings: 'Settings → General → VPN & Device Management → VPN', link: 'https://support.apple.com/guide/iphone/install-or-remove-configuration-profiles-iph6c493b19/ios' },
  android: { settings: 'Settings → Network & internet → VPN, or search Settings for VPN', link: 'https://support.google.com/android/answer/9089766' },
};
function devicePlatform() {
  if (typeof navigator === 'undefined') return 'windows';
  if (/Android/i.test(navigator.userAgent)) return 'android';
  if (/iPad|iPhone|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return /Linux/i.test(navigator.userAgent) ? 'linux' : 'windows';
}
function dateLabel(value) {
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function VaultVpnPanel({ accountId, activityTarget, subscriptionTarget, billing }) {
  const connectorAccess = LOCAL_PREVIEW || billing.active;
  const [platform, setPlatform] = useState(devicePlatform);
  const [state, setState] = useState(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [locations, setLocations] = useState([]);
  const [country, setCountry] = useState('');
  const [draft, setDraft] = useState({ name: '', country: '', confirmed: false });
  const [adding, setAdding] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const generation = useRef(0);
  const statusSequence = useRef(0);
  const operationActive = useRef(false);
  const locationSequence = useRef(0);
  const localDesktop = LOCAL_PREVIEW && ['windows', 'linux'].includes(platform);
  const useLocalAdapter = localDesktop && state?.platform === platform;
  const readStatus = useCallback(async () => {
    if (!localDesktop || operationActive.current) return;
    const request = generation.current;
    const sequence = ++statusSequence.current;
    try {
      const response = await fetch('/__vault/vpn/status', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error();
      const next = await response.json();
      if (request === generation.current && sequence === statusSequence.current) { setState(next); setError(''); }
    } catch { if (request === generation.current && sequence === statusSequence.current) { setState({ available: false, profiles: [], activity: [] }); setError('Local VPN companion unavailable. Use your device settings.'); } }
  }, [localDesktop]);
  useEffect(() => {
    generation.current += 1;
    statusSequence.current += 1; operationActive.current = false;
    setState(null); setError(''); setBusy(false); setSelected(''); setCountry(''); setGuideOpen(false); setAdding(false);
    setDraft({ name: '', country: '', confirmed: false });
    readStatus();
    const timer = localDesktop ? window.setInterval(() => { if (!document.hidden) readStatus(); }, 15000) : null;
    return () => { generation.current += 1; window.clearInterval(timer); };
  }, [localDesktop, platform, readStatus]);
  useEffect(() => {
    locationSequence.current++;
    setLocations([]); setCountry('');
    setBusy(false); setError(''); setAdding(false); setGuideOpen(false);
    setDraft({ name: '', country: '', confirmed: false });
    if (LOCAL_PREVIEW) return;
    let stopped = false;
    client.get('/vault/vpn/locations').then(({ data }) => { if (!stopped) setLocations(Array.isArray(data.locations) ? data.locations : []); })
      .catch(() => { if (!stopped) setError('Saved VPN locations could not be loaded. Check your connection and reload.'); });
    return () => { stopped = true; locationSequence.current++; };
  }, [accountId]);

  const profiles = useLocalAdapter && Array.isArray(state?.profiles) ? state.profiles : [];
  const platformLocations = locations.filter(item => item.platform === platform && (!useLocalAdapter || profiles.some(profile => profile.id === item.profileId)));
  const visibleProfiles = country ? profiles.filter(item => platformLocations.some(location => location.country === country && location.profileId === item.id)) : profiles;
  const profile = visibleProfiles.find(item => item.id === selected) || visibleProfiles[0];
  const location = platformLocations.find(item => item.country === country && (!useLocalAdapter || item.profileId === profile?.id));
  const countries = [...new Set(platformLocations.map(item => item.country))].sort();
  const connected = Boolean(useLocalAdapter && profile?.status === 'connected');
  const pending = ['connecting', 'disconnecting'].includes(profile?.status);
  const status = !connectorAccess && !connected ? 'Subscription required' : !useLocalAdapter ? 'Managed on your device' : connected ? 'Connected' : pending ? 'Pending' : profile?.status === 'disconnected' ? 'Not connected' : 'Status unavailable';
  const activity = useLocalAdapter && Array.isArray(state?.activity) ? state.activity.filter(item => ['connect', 'disconnect'].includes(item.action) && Number.isFinite(new Date(item.timestamp).getTime())) : [];

  async function changeConnection() {
    if (!connected && !connectorAccess) return;
    if (!useLocalAdapter || !profile || busy || !(connected ? profile.canDisconnect : profile.canConnect)) return;
    const request = generation.current;
    const action = connected ? 'disconnect' : 'connect';
    const profileId = profile.id;
    operationActive.current = true; statusSequence.current += 1;
    setBusy(true); setError('');
    try {
      const sessionResponse = await fetch('/__vault/session', { cache: 'no-store', credentials: 'same-origin' });
      if (!sessionResponse.ok) throw new Error('The local VPN session could not be verified.');
      const { csrfToken } = await sessionResponse.json();
      if (!csrfToken) throw new Error('The local VPN session could not be verified.');
      const headers = { 'Content-Type': 'application/json', 'X-Vault-CSRF': csrfToken };
      if (request !== generation.current) return;
      const challengeResponse = await fetch('/__vault/vpn/challenge', { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify({ action, profileId }) });
      const challenge = await challengeResponse.json();
      if (!challengeResponse.ok || !challenge.nonce) throw new Error(challenge.error || 'A fresh connection approval is required.');
      if (request !== generation.current) return;
      const response = await fetch(`/__vault/vpn/${action}`, { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify({ profileId, nonce: challenge.nonce }) });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || 'The VPN could not change connection state.');
      if (request === generation.current) { setState(next); if (next.operation?.confirmed === false) setError(next.message || 'Connection state has not been confirmed.'); }
    } catch (failure) { if (request === generation.current) setError(failure.message); }
    finally { if (request === generation.current) { operationActive.current = false; statusSequence.current += 1; setBusy(false); } }
  }
  async function addLocation(event) {
    event.preventDefault();
    if (busy || (!LOCAL_PREVIEW && !billing.active)) return;
    const name = (useLocalAdapter ? profile?.name : draft.name)?.trim().slice(0, 80);
    const label = draft.country.trim().slice(0, 80);
    if (!name || !label || !draft.confirmed || (useLocalAdapter && !profile)) return;
    const request = locationSequence.current;
    setBusy(true); setError('');
    try {
      const item = LOCAL_PREVIEW ? { id: crypto.randomUUID(), platform, name, country: label, ...(useLocalAdapter ? { profileId: profile.id } : {}) }
        : (await client.post('/vault/vpn/locations', { platform, name, country: label })).data.location;
      if (request !== locationSequence.current) return;
      setLocations(previous => [...previous, item].slice(-40));
      setCountry(label); setAdding(false); setDraft({ name: '', country: '', confirmed: false });
    } catch (failure) { if (request === locationSequence.current) setError(failure?.response?.data?.message || 'Could not save this VPN location.'); }
    finally { if (request === locationSequence.current) setBusy(false); }
  }
  async function removeLocation() {
    if (!location || busy) return;
    const request = locationSequence.current;
    setBusy(true); setError('');
    try {
      if (!LOCAL_PREVIEW) await client.delete(`/vault/vpn/locations/${encodeURIComponent(location.id)}`);
      if (request !== locationSequence.current) return;
      setLocations(previous => previous.filter(item => item.id !== location.id)); setCountry('');
    } catch (failure) { if (request === locationSequence.current) setError(failure?.response?.data?.message || 'Could not remove this VPN location.'); }
    finally { if (request === locationSequence.current) setBusy(false); }
  }

  return <>
    <section className="vault-panel vault-vpn-panel" aria-labelledby="vault-vpn-title">
      <div className="vault-panel-heading"><span className="vault-eyebrow"><Globe2 size={15} /> CONNECTION</span>{localDesktop && <button className="vault-icon-button" type="button" aria-label="Refresh VPN status" disabled={busy} onClick={readStatus}><RefreshCw size={15} /></button>}</div>
      <div className="vault-vpn-heading"><h2 id="vault-vpn-title">Your VPN</h2><span className={`vault-status${connected ? ' is-connected' : ''}`}><i />{status}</span></div>
      <div className="vault-vpn-guide"><h3>UFI VPN · setup pending</h3><p>UFI VPN is included with your Vault membership when service setup is complete. Connections will open after the VPN hosting and gateway are ready. The controls below use an existing VPN provider on your device.</p></div>
      <div className="vault-vpn-quick-action">
        {!connectorAccess && !connected ? <button type="button" className="vault-button vault-button--full" disabled><LockKeyhole size={19} />VPN locked</button> : useLocalAdapter ? <button type="button" className="vault-button vault-button--full" disabled={busy || pending || !state?.available || !(connected ? profile?.canDisconnect : profile?.canConnect)} onClick={changeConnection}><Power size={19} />{busy || pending ? 'Checking connection…' : connected ? 'Disconnect VPN' : 'Connect VPN'}</button>
          : platform === 'windows' && devicePlatform() === 'windows' ? <a className="vault-button vault-button--full" href="ms-settings:network-vpn"><Power size={19} />Open VPN controls</a>
            : <button type="button" className="vault-button vault-button--full" onClick={() => { setGuideOpen(true); setSetupOpen(true); }}><Power size={19} />Open VPN connection steps</button>}
        <p className="vault-footnote">{!connectorAccess && !connected ? <>Subscribe in <a href="#vpn-subscription-title">A space that’s yours</a> to unlock UFI’s connector tools. Your existing VPN app remains available on your device.</> : useLocalAdapter ? profile ? `Uses ${profile.name}. Change your profile in setup below.` : 'Choose an existing profile in setup below.' : platform === 'windows' && devicePlatform() === 'windows' ? 'Opens Windows VPN settings. Your device confirms the connection.' : 'Connect in your existing VPN app. Your browser cannot switch the VPN on or confirm its status.'}</p>
      </div>
      <details className="vault-vpn-setup" open={setupOpen} onToggle={event => setSetupOpen(event.currentTarget.open)}>
      <summary>Device, locations and setup</summary>
      <div className="vault-platform-switch" role="group" aria-label="VPN device">{Object.entries(PLATFORMS).map(([id, label]) => <button key={id} type="button" disabled={busy} aria-pressed={platform === id} onClick={() => setPlatform(id)}>{label}</button>)}</div>
      <p className="vault-helper">Use a profile from a trusted VPN provider or your organization. Device VPN settings need a configured server; they do not supply a VPN network.</p>
      <div className={`vault-connection-art${connected ? ' is-connected' : ''}`} aria-hidden="true"><div /><div /><ShieldCheck size={48} strokeWidth={1.3} /></div>

      <div className="vault-vpn-guide vault-vpn-providers">
        <h3>Optional: your existing Proton VPN</h3>
        <p>This is separate from the planned UFI VPN service. Already subscribed to Proton? Sign in to its official app, choose a country and connect there. These links remain free and do not activate UFI VPN.</p>
        <a className="vault-text-button" href="https://protonvpn.com/download" target="_blank" rel="noopener noreferrer">Official Proton VPN apps <ArrowUpRight size={13} /></a>
        <details><summary>Connection protection</summary>
          <p>{platform === 'android' ? 'In Android VPN settings, enable Always-on VPN and Block connections without VPN for Proton VPN.' : platform === 'ios' ? 'Enable Kill switch in Proton VPN Settings → Security Options. Some Apple services can still bypass the VPN for DNS requests.' : 'Enable Kill switch in Proton VPN settings. Advanced kill switch can also block traffic while deliberately disconnected.'}</p>
          <p>Proton apps include DNS leak protection. Custom DNS settings can interfere with it; follow Proton’s guidance. Your Vault cannot inspect or enforce these protections.</p>
          <a className="vault-text-button" href="https://protonvpn.com/support/what-is-kill-switch" target="_blank" rel="noopener noreferrer">Kill switch setup and platform limits <ArrowUpRight size={13} /></a>
          <a className="vault-text-button" href="https://protonvpn.com/support/dns-leaks-privacy" target="_blank" rel="noopener noreferrer">DNS protection guidance <ArrowUpRight size={13} /></a>
        </details>
        <p className="vault-footnote">Sign in only with Proton. UFIconnect never needs your Proton password, recovery codes, or VPN keys and cannot verify your Proton subscription or connection.</p>
      </div>

      <div className="vault-field"><label htmlFor="vault-vpn-countries">Your configured countries</label><select id="vault-vpn-countries" value={country} disabled={busy || !countries.length} onChange={event => { setCountry(event.target.value); setSelected(''); setGuideOpen(false); }}><option value="">{countries.length ? 'All configured locations' : 'Add an existing profile location'}</option>{countries.map(item => <option key={item}>{item}</option>)}</select></div>
      <p className="vault-footnote">Locations are labels you confirm from your provider. Selecting one prepares the matching profile; it does not change your connection or verify your location.</p>

      {useLocalAdapter ? <>
        {visibleProfiles.length ? <label className="vault-field">{PLATFORMS[platform]} connection<select disabled={busy} value={profile?.id || ''} onChange={event => setSelected(event.target.value)}>{visibleProfiles.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label> : <p className="vault-helper">No configured VPN profile is available here. Add one in your device settings.</p>}
        {profile && <p className="vault-helper">{profile.protocol}{profile.splitTunneling ? ' · Some traffic bypasses this VPN' : ''}. Routing, DNS protection, and a kill switch are managed by your VPN provider and operating system.</p>}
        <p className="vault-footnote">Disconnect an active profile before changing countries. Use your provider’s kill switch to protect traffic between connections.</p>
      </> : <div className="vault-vpn-guide">
        {location && <p>Selected profile: <strong>{location.name}</strong> · {location.country}</p>}
        <button type="button" className="vault-button vault-button--full vault-button--secondary" disabled={!connectorAccess} aria-expanded={guideOpen && connectorAccess} onClick={() => setGuideOpen(!guideOpen)}><Power size={17} />{guideOpen && connectorAccess ? 'Hide connection steps' : 'Connect using device settings'}</button>
        {guideOpen && connectorAccess && <ol><li>Open your existing VPN app, or <strong>{GUIDES[platform].settings}</strong>.</li><li>{location ? <>Select <strong>{location.name}</strong> and its configured {location.country} location.</> : 'Select a profile already configured by your VPN provider or organization.'} Connect or disconnect there.</li><li>Confirm the VPN status in the app or device settings, then return to Your Vault.</li></ol>}
        <p className="vault-footnote">The public website cannot control or verify an operating system VPN. {['windows', 'linux'].includes(platform) ? 'In-page controls are available only in the separate local companion on a supported computer.' : 'Your existing VPN app or installed profile handles the connection.'}</p>
      </div>}
      {(error || profile?.unavailableReason || state?.message) && <p className="vault-helper" role="status">{error || profile?.unavailableReason || state?.message}</p>}
      {connectorAccess && platform === 'windows' && devicePlatform() === 'windows' && <a className="vault-text-button" href="ms-settings:network-vpn">Open Windows VPN settings <ArrowUpRight size={13} /></a>}
      <a className="vault-text-button" href={GUIDES[platform].link} target="_blank" rel="noopener noreferrer">{PLATFORMS[platform]} VPN guidance <ArrowUpRight size={13} /></a>
      {['windows', 'linux'].includes(platform) && <a className="vault-text-button" href="https://github.com/UFIConnect/UFIConnect/blob/main/docs/VAULT-VPN-CONNECTOR.md" target="_blank" rel="noopener noreferrer">Set up the local companion <ArrowUpRight size={13} /></a>}

      <button type="button" className="vault-text-button" disabled={busy || (useLocalAdapter && !profile) || (!LOCAL_PREVIEW && !billing.active)} onClick={() => setAdding(!adding)} aria-expanded={adding}><Plus size={14} />{adding ? 'Cancel location' : 'Add configured location'}</button>
      {adding && <form className="vault-vpn-location-form" onSubmit={addLocation}>
        {!useLocalAdapter && <label className="vault-field">Existing VPN app or profile name<input required maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} autoComplete="off" /></label>}
        {useLocalAdapter && <p className="vault-helper">Label for {profile?.name}</p>}
        <label className="vault-field">Country shown by your provider<input required maxLength={80} value={draft.country} onChange={event => setDraft({ ...draft, country: event.target.value })} autoComplete="off" placeholder="For example, Canada" /></label>
        <label className="vault-vpn-confirm"><input type="checkbox" required checked={draft.confirmed} onChange={event => setDraft({ ...draft, confirmed: event.target.checked })} />This profile and location are already configured in my VPN app or device settings.</label>
        <button className="vault-button vault-button--secondary" disabled={busy || (!LOCAL_PREVIEW && !billing.active)} type="submit">{busy ? 'Saving…' : 'Add location'}</button>
      </form>}
      {location && <button className="vault-text-button" disabled={busy} type="button" onClick={removeLocation}><Trash2 size={13} />Remove this location label</button>}
      <p className="vault-footnote">{LOCAL_PREVIEW ? 'Preview labels stay in memory for this visit.' : 'Device types, profile labels and country labels are saved in your UFI account. You can read or remove existing labels after canceling.'} Never enter passwords or keys as labels. No VPN credentials, browsing history, destinations, or IP addresses are sent to UFIconnect.</p>
      </details>
    </section>
    {subscriptionTarget && createPortal(<VaultVpnSubscription billing={billing} />, subscriptionTarget)}
    {activityTarget && createPortal(<section className="vault-panel vault-activity" aria-labelledby="vault-activity-title">
      <div className="vault-panel-heading"><h2 id="vault-activity-title">Connection activity</h2><Clock3 size={16} /></div>
      <p className="vault-helper">{useLocalAdapter ? 'Local connection requests and timestamps only. Cleared when the local companion stops.' : 'Your device and VPN provider manage this activity. Your Vault cannot read it from the public website.'}</p>
      {activity.length ? <ol>{activity.slice(0, 5).map((item, index) => <li key={`${item.timestamp}-${index}`}><span className="vault-activity-dot" /><span>{item.action === 'connect' ? 'Connect requested' : 'Disconnect requested'}<time dateTime={item.timestamp}>{dateLabel(item.timestamp)}</time></span></li>)}</ol> : <div className="vault-activity-empty"><Clock3 size={20} /><span>{useLocalAdapter ? 'No connection activity yet' : 'Activity unavailable in browser'}</span></div>}
      <p className="vault-footnote">Timestamps limit visible history; they cannot prevent device cloning. Local connection approvals also use a short-lived, single-use request token. Hardware identity requires the device’s secure keys.</p>
    </section>, activityTarget)}
  </>;
}
