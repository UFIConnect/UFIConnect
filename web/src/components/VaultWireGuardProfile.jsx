import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Download, Globe2, RefreshCw, Trash2 } from 'lucide-react';
import client from '../api/client';
import { getAccessToken } from '../auth/session';
import { wireguardIdentity, forgetIdentity, profileText, validateProfile, profileList } from '../lib/wireguardProfile';
import { paidVpnAccess } from '../lib/vpnAccess';

export function downloadProfile(url) {
  const link = document.createElement('a');
  link.href = url; link.download = 'UFIConnect.conf'; link.rel = 'noreferrer';
  document.body.append(link); link.click(); link.remove();
}

export default function VaultWireGuardProfile({ accountId, config, checking, availabilityError, billing, refresh, download = downloadProfile }) {
  const [profiles, setProfiles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const revision = useRef(0), listSequence = useRef(0), operation = useRef(null), identity = useRef(null), file = useRef(null);
  const identityTimer = useRef(null), downloadTimer = useRef(null), profilesOwner = useRef(null);
  const listAbort = useRef(null);
  const sessionToken = getAccessToken();
  const account = useRef(accountId); account.current = accountId;
  const forget = useCallback(() => {
    clearTimeout(identityTimer.current); clearTimeout(downloadTimer.current);
    forgetIdentity(identity.current); identity.current = null;
    if (file.current) URL.revokeObjectURL(file.current.url);
    file.current = null;
  }, []);
  const loadProfiles = useCallback(async () => {
    const owner = accountId, epoch = revision.current, sequence = ++listSequence.current, token = getAccessToken();
    if (!owner || !token) return;
    listAbort.current?.abort();
    const abort = new AbortController(); listAbort.current = abort;
    const current = () => owner === account.current && epoch === revision.current && sequence === listSequence.current && token === getAccessToken();
    try {
      const { data } = await client.get('/vpn/profiles', { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal });
      const next = profileList(data);
      if (current()) {
        profilesOwner.current = { account: owner, token };
        setProfiles(next);
        if (file.current && !next.some(value => value.id === file.current.id)) { forget(); setReady(null); }
      }
    } catch { if (current()) { setProfiles(null); setError('Saved profiles could not be checked. Refresh and try again.'); } }
  }, [accountId, sessionToken, forget]);
  useLayoutEffect(() => {
    revision.current++; operation.current?.abort.abort(); operation.current = null; listAbort.current?.abort(); forget();
    profilesOwner.current = null;
    setProfiles(null); setReady(null); setBusy(false); setError(''); setRemoving(null); setAgreed(false); setManageOpen(false);
    if (accountId) void loadProfiles();
    const clear = () => {
      revision.current++; listSequence.current++; operation.current?.abort.abort(); operation.current = null; listAbort.current?.abort(); forget();
      profilesOwner.current = null;
      setProfiles(null); setReady(null); setBusy(false); setAgreed(false); setRemoving(null);
    };
    window.addEventListener('ufi-session-cleared', clear);
    // Keep private bytes and download URLs out of restored back/forward pages.
    window.addEventListener('pagehide', clear);
    return () => { revision.current++; listSequence.current++; operation.current?.abort.abort(); operation.current = null; listAbort.current?.abort(); forget(); window.removeEventListener('ufi-session-cleared', clear); window.removeEventListener('pagehide', clear); };
  }, [accountId, sessionToken, loadProfiles, forget]);
  const available = config?.available === true && config?.profileImportAvailable === true && config?.protocol === 'wireguard'
    && Array.isArray(config.gateways) && config.gateways.some(value => value?.country === 'DE');
  const paid = paidVpnAccess(billing);
  const visibleProfiles = profilesOwner.current?.account === accountId && profilesOwner.current?.token === sessionToken ? profiles : null;
  const visibleReady = ready?.account === accountId && ready?.token === sessionToken ? ready : null;
  const canCreate = Boolean(accountId && paid && available && !checking && visibleProfiles && agreed);
  const start = () => {
    if (operation.current || !accountId || !sessionToken || getAccessToken() !== sessionToken) return null;
    const request = { account: accountId, revision: revision.current, token: sessionToken, abort: new AbortController() };
    operation.current = request; setBusy(true); setError(''); listSequence.current++;
    return { request, current: () => account.current === request.account && revision.current === request.revision && getAccessToken() === request.token };
  };
  const finish = request => { if (operation.current === request) { operation.current = null; setBusy(false); } };
  async function createProfile() {
    if (!canCreate || file.current) return;
    const work = start(); if (!work) return;
    try {
      // Reuse this in-memory key on an explicit retry: a response lost in transit
      // must not consume another registration slot. Never persist these bytes.
      if (!identity.current) {
        identity.current = wireguardIdentity();
        const pending = identity.current;
        identityTimer.current = setTimeout(() => {
          if (identity.current === pending) {
            forgetIdentity(pending); identity.current = null;
            if (work.current()) setError('The pending download expired. Refresh and try again.');
          }
        }, 180000);
      }
      const pair = identity.current;
      const { data } = await client.post('/vpn/profiles', { publicKey: pair.publicKey, label: 'UFIConnect iOS' },
        { headers: { Authorization: `Bearer ${work.request.token}` }, signal: work.request.abort.signal });
      if (!work.current()) return;
      const profile = validateProfile(data, pair.publicKey, config);
      const url = URL.createObjectURL(new Blob([profileText(pair, data, config)], { type: 'application/octet-stream' }));
      const prepared = { url, id: profile.id, account: work.request.account, token: work.request.token };
      file.current = prepared; setReady(prepared);
      clearTimeout(identityTimer.current);
      forgetIdentity(pair); identity.current = null;
      downloadTimer.current = setTimeout(() => {
        if (file.current === prepared) {
          URL.revokeObjectURL(prepared.url); file.current = null; setReady(null);
          setError('The download link expired. If you imported the profile, connect in WireGuard. Otherwise remove it below and get a new one.');
        }
      }, 600000);
      profilesOwner.current = { account: work.request.account, token: work.request.token };
      setProfiles(previous => [...(previous || []).filter(value => value.id !== profile.id),
        { id: profile.id, publicKey: profile.publicKey, createdAt: data.profile.createdAt }]);
      // The visible download link remains available if Safari requires another
      // tap after this asynchronous request. Its URL points only to a local Blob.
      download(url);
    } catch (failure) {
      if (!work.current()) return;
      const status = failure?.response?.status;
      if ([400, 401, 403, 409].includes(status)) { clearTimeout(identityTimer.current); forgetIdentity(identity.current); identity.current = null; }
      if (status === 409) setManageOpen(true);
      setError(status === 403 ? 'An active paid Vault membership is required.'
        : status === 409 ? 'Your VPN device limit was reached. Disconnect an unused UFIConnect app device or remove a saved profile, then try again.'
          : status === 503 ? 'VPN is temporarily unavailable. Try again shortly.'
            : 'The profile could not be prepared. Try again.');
      // A committed registration whose response was lost must still be removable.
      if (!status || status >= 500 || status === 409) void loadProfiles();
    } finally { finish(work.request); }
  }
  async function removeProfile(id) {
    if (!profiles?.some(value => value.id === id) || removing !== id) return;
    const work = start(); if (!work) return;
    try {
      const { data } = await client.delete('/vpn/profiles/' + encodeURIComponent(id),
        { headers: { Authorization: `Bearer ${work.request.token}` }, signal: work.request.abort.signal });
      if (!work.current()) return;
      if (data?.removed !== true) throw new Error('Removal unconfirmed.');
      if (file.current?.id === id || identity.current?.publicKey === profiles.find(value => value.id === id)?.publicKey) { forget(); setReady(null); }
      setProfiles(previous => previous.filter(value => value.id !== id)); setRemoving(null);
    } catch { if (work.current()) setError('Profile removal could not be confirmed. Try again.'); }
    finally { finish(work.request); }
  }
  const status = checking || billing.checking ? 'Checking availability' : !paid ? 'Subscription required'
    : !available ? 'Unavailable' : visibleReady ? 'Profile ready' : 'Ready for WireGuard';
  return <section id="vpn" className="vault-panel vault-vpn-panel vault-managed-vpn" aria-labelledby="vault-vpn-title">
    <div className="vault-panel-heading"><span className="vault-eyebrow"><Globe2 size={15} /> CONNECTION</span><button className="vault-icon-button" type="button" aria-label="Check VPN availability" disabled={checking || busy} onClick={() => { setError(''); refresh(); void loadProfiles(); }}><RefreshCw size={15} /></button></div>
    <div className="vault-vpn-heading"><h2 id="vault-vpn-title">UFIConnect VPN</h2><span className="vault-status" role="status"><i />{status}</span></div>
    <p className="vault-helper">Import your profile into WireGuard once. Then switch UFIConnect on in WireGuard whenever you want to connect. Germany is selected automatically.</p>
    <a className="vault-text-button" href="https://apps.apple.com/app/wireguard/id1441195209" target="_blank" rel="noopener noreferrer">Get official WireGuard for iPhone <Download size={14} /></a>
    <p className="vault-footnote">Traffic and DNS pass through our gateway. Its configuration does not log browsing or DNS queries; IPv6 traffic is blocked. UFIConnect uses your account, device label and public key to verify paid access. Your private key is created here and is only included in your download. <a href="/privacy">Privacy policy</a></p>
    {!visibleReady && <label className="vault-vpn-consent"><input type="checkbox" checked={agreed} disabled={busy} onChange={event => setAgreed(event.target.checked)} /><span>I understand how the VPN uses my data and want to download my private profile.</span></label>}
    <div className="vault-vpn-quick-action">
      {visibleReady ? <a className="vault-button vault-button--full" href={visibleReady.url} download="UFIConnect.conf" rel="noreferrer">Download VPN profile</a>
        : <button className="vault-button vault-button--full" type="button" disabled={!canCreate || busy} onClick={createProfile}><Download size={19} />{busy ? 'Preparing profile…' : 'Get VPN profile'}</button>}
    </div>
    {(error || availabilityError) && <p className="vault-helper" role="alert">{error || availabilityError}</p>}
    {visibleReady && <p className="vault-helper" role="status">Your profile is ready. Import it in WireGuard to connect; this page cannot verify the tunnel. This download link expires after ten minutes or when you leave this page.</p>}
    <ol className="vault-vpn-import"><li>Save UFIConnect.conf to Files.</li><li>In WireGuard, tap +, import from a file, and choose UFIConnect.conf.</li><li>Approve iPhone’s VPN permission, then turn UFIConnect on. Turn it off in WireGuard to disconnect.</li></ol>
    <p className="vault-footnote">The file contains your private key. Keep it private and delete the downloaded copy after importing. Signing out of this website does not stop WireGuard. Access requires a paid membership; use Remove profile below to revoke an imported profile.</p>
    {visibleProfiles?.length > 0 && <details className="vault-vpn-profiles" open={manageOpen} onToggle={event => setManageOpen(event.currentTarget.open)}><summary>Manage saved profiles</summary><p className="vault-footnote">Already imported? Connect in WireGuard. Lost the file before importing? Remove that profile, then get a new one. Existing private keys cannot be downloaded again after leaving this page.</p>{visibleProfiles.map((profile, index) => <div className="vault-vpn-profile" key={profile.id}>
      <span>iPhone profile {index + 1} · {new Date(profile.createdAt).toLocaleDateString()}</span>
      {removing === profile.id ? <><p className="vault-footnote">This revokes access for this profile. Remove its copy from WireGuard too.</p><button className="vault-text-button" type="button" disabled={busy} onClick={() => removeProfile(profile.id)}>Confirm removal</button><button className="vault-text-button" type="button" disabled={busy} onClick={() => setRemoving(null)}>Keep profile</button></>
        : <button className="vault-text-button" type="button" disabled={busy} onClick={() => setRemoving(profile.id)}><Trash2 size={14} />Remove profile {index + 1}</button>}
    </div>)}</details>}
  </section>;
}
