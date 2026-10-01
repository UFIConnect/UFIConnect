import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { ArrowUpRight, Check, ChevronRight, Clock3, Copy, Download, Eye, EyeOff, Globe2, Grid2X2, KeyRound, List, LockKeyhole, Plus, Power, RefreshCw, Search, ShieldCheck, Star, Trash2, Upload, X } from 'lucide-react';
import Layout from '../components/Layout';
import client from '../api/client';
import { createAccountVault } from '../vault/accountVault.mjs';
import './Vault.css';
import { safeLaunchUrl, cleanVaultPreferences, VAULT_COMMANDS } from '../vault/vaultLaunchers.mjs';

const EMPTY_ENTRY = { name: '', url: '', appUrl: '', username: '', password: '', notes: '', favorite: false, launchCount: 0 };
const COMMAND_LABELS = { add: 'Add password', import: 'Import passwords', backup: 'Encrypted backup', web: 'Open website', app: 'Open app', copy: 'Copy password' };
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const LOCAL_PREVIEW = import.meta.env.VITE_VAULT_LOCAL_PREVIEW === 'true' && typeof window !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

function devicePlatform() {
  if (typeof navigator === 'undefined') return 'other';
  if (/iPad|iPhone|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return /Windows/i.test(navigator.userAgent) ? 'windows' : 'other';
}

function FaceScan({ size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3M8 9v2m8-2v2m-4-2v5h-1m-3 2c2 2 6 2 8 0" /></svg>;
}

function VaultDialog({ title, onClose, children }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector('input, button')?.focus();
    function keydown(event) {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const items = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]')].filter(item => item.getClientRects().length);
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
      if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
    }
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keydown);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return <div className="vault-dialog-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="vault-dialog" role="dialog" aria-modal="true" aria-labelledby="vault-dialog-title">
      <header><h2 id="vault-dialog-title">{title}</h2><button type="button" className="vault-icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></header>
      {children}
    </section>
  </div>;
}

function AppMark({ name, large = false }) {
  const seed = [...(name || 'U')].reduce((total, letter) => total + letter.charCodeAt(0), 0);
  return <span className={`vault-app-mark${large ? ' vault-app-mark--large' : ''}`} style={{ '--app-hue': `${[212, 255, 170, 32, 330][seed % 5]}` }} aria-hidden="true">{(name || 'U').trim().slice(0, 1).toUpperCase()}</span>;
}

function dateLabel(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Time unavailable';
}

function HardwareVerification({ accountId }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setStatus(null); setLoading(true);
    client.get('/security/vault/status', { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setStatus(data?.phase === 'software-prototype' ? data : null);
    }).catch(() => { /* An unavailable verifier must never display a verified device. */ })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [accountId]);
  const configured = status?.available === true;
  return <section className="vault-panel vault-hardware-status" aria-labelledby="vault-hardware-status-title">
    <div className="vault-panel-heading"><h2 id="vault-hardware-status-title">Hardware verification</h2><ShieldCheck size={16} /></div>
    <span className="vault-pending">{loading ? 'Checking availability' : configured ? 'Server checks configured' : status?.state === 'disabled' ? 'Awaiting hardware setup' : 'Status unavailable'}</span>
    <p>UFI Vault is designed to keep device keys inside its secure element. Each approval must confirm the account and action, expire quickly, and work only once.</p>
    <p>Secure hardware pairing and recovery are pending. Hardware verification is not active for your browser passwords.</p>
    {configured && status.lastVerifiedAt && <p className="vault-helper">Last server device check: <time dateTime={status.lastVerifiedAt}>{dateLabel(status.lastVerifiedAt)}</time></p>}
    <p className="vault-footnote">Your browser vault uses its passphrase and optional device unlock. Its contents stay outside analytics and learning features.</p>
  </section>;
}

function VpnPanel() {
  const [platform, setPlatform] = useState(() => devicePlatform() === 'ios' ? 'ios' : 'windows');
  const [state, setState] = useState(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const generation = useRef(0);
  const useLocalAdapter = LOCAL_PREVIEW && platform === 'windows';
  const readStatus = useCallback(async () => {
    if (!useLocalAdapter) return;
    const request = generation.current;
    try {
      const response = await fetch('/__vault/vpn/status', { cache: 'no-store' });
      if (!response.ok) throw new Error('The local VPN connection is unavailable.');
      const next = await response.json();
      if (mounted.current && request === generation.current) { setState(next); setError(''); }
    } catch { if (mounted.current && request === generation.current) { setState({ available: false, profiles: [], activity: [] }); setError('Local VPN service unavailable.'); } }
  }, [useLocalAdapter]);
  useEffect(() => {
    mounted.current = true;
    generation.current += 1;
    setState(null); setError(''); setBusy(false); setSelected('');
    if (useLocalAdapter) readStatus();
    const timer = useLocalAdapter ? window.setInterval(() => { if (!document.hidden) readStatus(); }, 15000) : null;
    return () => { mounted.current = false; generation.current += 1; window.clearInterval(timer); };
  }, [readStatus, useLocalAdapter]);
  const profiles = useLocalAdapter && Array.isArray(state?.profiles) ? state.profiles : [];
  const profile = profiles.find(item => item.id === selected) || profiles[0];
  const connected = profile?.status === 'connected';
  const pending = ['connecting', 'disconnecting'].includes(profile?.status);
  const status = !useLocalAdapter ? 'Managed on your device' : connected ? 'Connected' : pending ? 'Pending' : profile?.status === 'disconnected' ? 'Not connected' : 'Status unavailable';
  const activity = useLocalAdapter && Array.isArray(state?.activity) ? state.activity.filter(item => ['connect', 'disconnect'].includes(item.action) && Number.isFinite(new Date(item.timestamp).getTime())) : [];
  const showWindowsSettings = platform === 'windows' && (devicePlatform() === 'windows' || (useLocalAdapter && state?.platform === 'windows'));
  async function changeConnection() {
    if (!useLocalAdapter || !profile || busy || !(connected ? profile.canDisconnect : profile.canConnect)) return;
    const request = generation.current;
    setBusy(true); setError('');
    try {
      const sessionResponse = await fetch('/__vault/session', { cache: 'no-store' });
      if (!sessionResponse.ok) throw new Error('The local VPN session could not be verified.');
      const { csrfToken } = await sessionResponse.json();
      if (!csrfToken) throw new Error('The local VPN session could not be verified.');
      if (!mounted.current || request !== generation.current) return;
      const response = await fetch(`/__vault/vpn/${connected ? 'disconnect' : 'connect'}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Vault-CSRF': csrfToken }, body: JSON.stringify({ profileId: profile.id }) });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || 'The VPN could not change connection state.');
      if (mounted.current && request === generation.current) setState(next);
    } catch (failure) { if (mounted.current && request === generation.current) setError(failure.message); }
    finally { if (mounted.current && request === generation.current) { setBusy(false); readStatus(); } }
  }
  return <>
    <section className="vault-panel vault-vpn-panel" aria-labelledby="vault-vpn-title">
      <div className="vault-panel-heading"><span className="vault-eyebrow"><Globe2 size={15} /> CONNECTION</span>{useLocalAdapter && <button className="vault-icon-button" type="button" aria-label="Refresh VPN status" onClick={readStatus}><RefreshCw size={15} /></button>}</div>
      <div className="vault-vpn-heading"><h2 id="vault-vpn-title">Your VPN</h2><span className={`vault-status${connected ? ' is-connected' : ''}`}><i />{status}</span></div>
      <div className="vault-platform-switch" role="group" aria-label="VPN device"><button type="button" aria-pressed={platform === 'windows'} onClick={() => setPlatform('windows')}>Windows</button><button type="button" aria-pressed={platform === 'ios'} onClick={() => setPlatform('ios')}>iPhone &amp; iPad</button></div>
      <div className={`vault-connection-art${connected ? ' is-connected' : ''}`} aria-hidden="true"><div /><div /><ShieldCheck size={48} strokeWidth={1.3} /></div>
      {useLocalAdapter ? <>
      {profiles.length > 0 ? <label className="vault-field">Windows connection<select value={profile?.id || ''} onChange={event => setSelected(event.target.value)}>{profiles.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label> : <div className="vault-connection-empty"><strong>{state ? 'No supported VPN ready' : 'Checking this computer…'}</strong><p>Uses a VPN profile configured in Windows.</p></div>}
      {profile && <p className="vault-helper">{profile.protocol}{profile.splitTunneling ? ' · Some traffic bypasses this VPN' : ''}</p>}
      <button type="button" className={`vault-button vault-button--full${connected ? ' vault-button--secondary' : ' vault-button--primary'}`} disabled={busy || pending || !state?.available || !(connected ? profile?.canDisconnect : profile?.canConnect)} onClick={changeConnection}><Power size={17} />{busy ? 'Checking connection…' : connected ? 'Disconnect' : 'Connect VPN'}</button>
      {(error || profile?.unavailableReason || state?.message) && <p className="vault-helper" role="status">{error || profile?.unavailableReason || state?.message}</p>}
      <p className="vault-footnote">Connection status comes from Windows. A browser cannot protect traffic on its own.</p>
      </> : <div className="vault-vpn-guide">
        <h3>{platform === 'ios' ? 'Use your existing VPN' : 'Manage your Windows VPN'}</h3>
        <p>{platform === 'ios' ? 'Connect or disconnect in your VPN provider’s app, or use a VPN profile already installed on your iPhone or iPad.' : 'Connect or disconnect using your VPN app or an existing profile in Windows Settings.'}</p>
        <ol>{platform === 'ios' ? <><li>Open your VPN app, or go to <strong>Settings → General → VPN &amp; Device Management → VPN</strong>.</li><li>Select your existing connection and connect or disconnect there.</li><li>Check its status in the app or Settings, then return to Your Vault.</li></> : <><li>Open <strong>Settings → Network &amp; internet → VPN</strong>, or your VPN provider’s app.</li><li>Select your existing connection and connect or disconnect there.</li><li>Check its status on your device, then return to Your Vault.</li></>}</ol>
        <p className="vault-footnote">Status unavailable in browser. Your Vault cannot see or control this device’s VPN from the public website.{platform === 'windows' ? ' In-page Windows controls require the separate local companion.' : ''}</p>
        {platform === 'ios' && <a className="vault-text-button" href="https://www.apple.com/legal/privacy/data/en/vpns/" target="_blank" rel="noopener noreferrer">Apple VPN guidance <ArrowUpRight size={13} /></a>}
      </div>}
      {showWindowsSettings && <a className="vault-text-button" href="ms-settings:network-vpn">Open Windows VPN settings <ArrowUpRight size={13} /></a>}
    </section>
    <section className="vault-panel vault-activity" aria-labelledby="vault-activity-title">
      <div className="vault-panel-heading"><h2 id="vault-activity-title">Connection activity</h2><Clock3 size={16} /></div>
      <p className="vault-helper">{useLocalAdapter ? 'Connection requests and times only.' : 'VPN activity is managed by your device and provider. Your Vault does not receive that history.'}</p>
      {activity.length ? <ol>{activity.slice(0, 5).map((item, index) => <li key={`${item.timestamp}-${index}`}><span className="vault-activity-dot" /><span>{item.action === 'connect' ? 'Connect requested' : 'Disconnect requested'}<time dateTime={item.timestamp}>{dateLabel(item.timestamp)}</time></span></li>)}</ol> : <div className="vault-activity-empty"><Clock3 size={20} /><span>{useLocalAdapter ? 'No connection activity yet' : 'Activity unavailable in browser'}</span></div>}
    </section>
  </>;
}

export default function Vault({ accountId }) {
  const vault = useMemo(() => createAccountVault(accountId), [accountId]);
  const { hasVault, createVault, unlockVault, saveEntries, parsePasswordImport, exportEncryptedVault, restoreEncryptedVault, hasDeviceUnlock, enableDeviceUnlock, unlockWithDevice } = vault;
  const [exists, setExists] = useState(() => { try { return hasVault(); } catch { return false; } });
  const [session, setSession] = useState(null);
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [view, setView] = useState('grid');
  const [editor, setEditor] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreText, setRestoreText] = useState('');
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [deviceReady, setDeviceReady] = useState(() => hasDeviceUnlock());
  const [deviceSetupOpen, setDeviceSetupOpen] = useState(false);
  const [devicePassphrase, setDevicePassphrase] = useState('');
  const importRef = useRef(null);
  const epoch = useRef(0);
  const lockVault = useCallback((message = 'Vault locked.') => {
    epoch.current += 1;
    setSession(null); setPassphrase(''); setConfirmation(''); setEditor(null); setShowPassword(false);
    setQuery(''); setRestoreOpen(false); setRestoreText(''); setRestoreConfirmed(false); setBusy(false); setError(''); setNotice(message);
    setDeviceSetupOpen(false); setDevicePassphrase(''); setDeviceReady(hasDeviceUnlock());
    setBackupPassphrase('');
  }, []);
  useEffect(() => {
    if (!session) return undefined;
    let timer;
    const reset = () => { window.clearTimeout(timer); timer = window.setTimeout(() => lockVault('Vault locked after a minute of inactivity.'), 60000); };
    reset();
    window.addEventListener('pointerdown', reset, { passive: true });
    window.addEventListener('keydown', reset);
    return () => { window.clearTimeout(timer); window.removeEventListener('pointerdown', reset); window.removeEventListener('keydown', reset); };
  }, [session?.key, lockVault]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const visibility = () => { if (document.hidden) lockVault('Vault locked when you left this page.'); };
    const clearSession = () => lockVault('Vault locked when you signed out.');
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('ufi-session-cleared', clearSession);
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('ufi-session-cleared', clearSession); };
  }, [lockVault]);
  useEffect(() => () => { epoch.current += 1; }, []);

  async function openVault(event) {
    event.preventDefault();
    if (!exists && passphrase !== confirmation) { setError('The passphrases do not match.'); return; }
    const request = epoch.current;
    setBusy(true); setError(''); setNotice('');
    try {
      const next = await (exists ? unlockVault(passphrase) : createVault(passphrase));
      setExists(true);
      if (request === epoch.current && !document.hidden) { setSession(next); setPassphrase(''); setConfirmation(''); }
    } catch (failure) { if (request === epoch.current) setError(failure.message || 'The vault could not be opened.'); }
    finally { if (request === epoch.current) setBusy(false); }
  }

  async function persist(entries, message) {
    if (!session) return false;
    const request = epoch.current;
    setBusy(true); setError('');
    try {
      const next = await saveEntries({ ...session, preferences }, entries);
      if (request !== epoch.current) return false;
      setSession(next); setNotice(message); return true;
    } catch (failure) { if (request === epoch.current) setError(failure.message || 'Your changes could not be saved.'); return false; }
    finally { if (request === epoch.current) setBusy(false); }
  }

  async function saveEntry(event) {
    event.preventDefault();
    const entry = { ...editor, id: editor.id || crypto.randomUUID(), name: editor.name.trim(), url: editor.url.trim(), username: editor.username.trim() };
    const entries = editor.id ? session.entries.map(item => item.id === editor.id ? entry : item) : [...session.entries, entry];
    if (await persist(entries, 'Password saved in your encrypted vault.')) { setEditor(null); setShowPassword(false); }
  }

  async function importPasswords(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !session) return;
    const request = epoch.current;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('Choose a password file smaller than 2 MB.');
      const entries = parsePasswordImport(await file.text(), file.name);
      if (request !== epoch.current) return;
      await persist([...session.entries, ...entries], `${entries.length} passwords imported into your encrypted vault.`);
    } catch (failure) { if (request === epoch.current) setError(failure.message || 'The password file could not be imported.'); }
  }

  function downloadBackup() {
    if (session && !busy) void recordCommand('backup');
    try {
      const blob = new Blob([exportEncryptedVault()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `uficonnect-vault-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Encrypted backup downloaded. Keep its passphrase separately.');
    } catch (failure) { setError(failure.message || 'The encrypted backup could not be downloaded.'); }
  }

  async function readBackup(event) {
    const file = event.target.files?.[0]; setRestoreText('');
    if (!file) return;
    try { if (file.size > MAX_IMPORT_BYTES * 2) throw new Error('Choose an encrypted backup smaller than 4 MB.'); setRestoreText(await file.text()); }
    catch (failure) { setError(failure.message); }
  }

  async function restoreBackup(event) {
    event.preventDefault();
    if (busy || !restoreText || !backupPassphrase || (exists && (!session || !restoreConfirmed))) return;
    const request = epoch.current;
    setBusy(true); setError('');
    try {
      await restoreEncryptedVault(restoreText, backupPassphrase);
      setExists(true);
      if (request === epoch.current) lockVault('Backup verified and restored. Unlock it with the backup’s passphrase.');
    } catch (failure) { if (request === epoch.current) setError(failure.message || 'The backup could not be verified and restored.'); }
    finally { if (request === epoch.current) setBusy(false); }
  }

  async function copyPassword(value) {
    try { await navigator.clipboard.writeText(value); setNotice('Password copied to your clipboard.'); }
    catch { setError('Clipboard access is unavailable. Use Reveal password to copy it manually.'); }
  }

  async function useDeviceUnlock() {
    const request = epoch.current;
    setBusy(true); setError('');
    try {
      const next = await unlockWithDevice();
      if (request === epoch.current && !document.hidden) { setSession(next); setPassphrase(''); setConfirmation(''); setNotice('Vault unlocked with this device.'); }
    } catch (failure) { if (request === epoch.current) setError(failure.message || 'Device unlock is unavailable. Use your passphrase.'); }
    finally { if (request === epoch.current) setBusy(false); }
  }

  async function setupDevice(event) {
    event.preventDefault();
    if (!session) return;
    const request = epoch.current;
    setBusy(true); setError('');
    try {
      await enableDeviceUnlock(devicePassphrase);
      if (request === epoch.current) { setDeviceReady(hasDeviceUnlock()); setDeviceSetupOpen(false); setDevicePassphrase(''); setNotice('Device unlock configured. Keep your passphrase for recovery.'); }
    } catch (failure) { if (request === epoch.current) setError(failure.message || 'Device unlock could not be configured.'); }
    finally { if (request === epoch.current) setBusy(false); }
  }

  const preferences = cleanVaultPreferences(session?.preferences);
  const favoriteApps = [...(session?.entries || [])].filter(entry => entry.favorite || entry.launchCount > 0).sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.launchCount - a.launchCount).slice(0, 6);
  const favoriteCommands = VAULT_COMMANDS.filter(id => preferences.favorites.includes(id) || preferences.commands[id] > 0).sort((a, b) => Number(preferences.favorites.includes(b)) - Number(preferences.favorites.includes(a)) || preferences.commands[b] - preferences.commands[a]);
  function recordCommand(id, entryId) {
    const next = { ...preferences, commands: { ...preferences.commands, [id]: preferences.commands[id] + 1 } };
    return persist(session.entries.map(entry => entry.id === entryId ? { ...entry, launchCount: (entry.launchCount || 0) + 1 } : entry), '', next);
  }
  function runCommand(id) {
    if (busy) return;
    if (id === 'add') { void recordCommand(id); editEntry(EMPTY_ENTRY); }
    else if (id === 'import') { void recordCommand(id); importRef.current?.click(); }
    else if (id === 'backup') { downloadBackup(); }
    else { setNotice('Choose an app below to ' + COMMAND_LABELS[id].toLowerCase() + '.'); document.getElementById('vault-password-title')?.scrollIntoView({ block: 'center' }); }
  }
  function launchLink(entry, kind, compact = false) {
    const url = safeLaunchUrl(kind === 'app' ? entry.appUrl : entry.url, kind === 'app');
    return url ? <a className={compact ? 'vault-text-button' : 'vault-button vault-button--secondary'} href={url} target="_blank" rel="noopener noreferrer" onClick={event => { if (busy) event.preventDefault(); else void recordCommand(kind, entry.id); }}><ArrowUpRight size={14} />{kind === 'app' ? 'Open app' : 'Open website'}</a> : null;
  }
  const entries = useMemo(() => (session?.entries || []).filter(entry => `${entry.name} ${entry.username} ${entry.url}`.toLowerCase().includes(query.toLowerCase())), [session, query]);
  function editEntry(entry) { setError(''); setShowPassword(false); setEditor({ ...entry }); }

  return <Layout wide><Helmet><title>Your Vault | UFIconnect</title><meta name="robots" content="noindex,nofollow" /></Helmet>
    <section className="vault-page" aria-label="Your Vault">
      <header className="vault-page-heading"><div><div className="vault-wordmark"><ShieldCheck size={19} /><span>UFI<span>connect</span></span><span className="vault-preview-badge">{LOCAL_PREVIEW ? 'LOCAL PREVIEW' : 'BROWSER VAULT · BETA'}</span></div><h1>Your Vault<span>.</span></h1><p>Your passwords. Your connections. One private space.</p></div><div className="vault-heading-actions">{session && <button className="vault-button vault-button--secondary" onClick={() => lockVault()}><LockKeyhole size={16} />Lock vault</button>}<span className={`vault-status${session ? ' is-connected' : ''}`}><i />{session ? 'Unlocked' : 'Locked'}</span></div></header>

      <div className="vault-overview"><span><ShieldCheck size={16} />Encrypted on this browser</span><span><Clock3 size={16} />Auto-lock after 1 minute</span><span><Globe2 size={16} />No server sync</span></div>
      {notice && <div className="vault-feedback" role="status"><Check size={16} />{notice}<button aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15} /></button></div>}
      {error && !editor && !restoreOpen && !deviceSetupOpen && <div className="vault-feedback vault-feedback--error" role="alert">{error}</div>}

      <div className="vault-columns"><div className="vault-primary-column">
        {!session ? <section className="vault-panel vault-unlock-panel" aria-labelledby="vault-unlock-title">
          <div className="vault-lock-art" aria-hidden="true"><div className="vault-lock-orbit" /><span className="vault-orbit-app vault-orbit-app--one">@</span><span className="vault-orbit-app vault-orbit-app--two"><KeyRound size={19} /></span><span className="vault-orbit-app vault-orbit-app--three"><Globe2 size={20} /></span><div className="vault-lock-core"><ShieldCheck size={59} strokeWidth={1.1} /></div><span className="vault-art-label"><LockKeyhole size={12} />ONLY YOU HOLD THE KEY</span></div>
          <div className="vault-unlock-content"><span className="vault-eyebrow">A SPACE THAT’S YOURS</span><h2 id="vault-unlock-title">{exists ? 'Welcome back.' : 'Start with your key.'}</h2><p>{exists ? 'Unlock your passwords with your vault passphrase.' : 'Create a passphrase to keep your passwords encrypted on this browser.'}</p>
            <form onSubmit={openVault}><label className="vault-field">Vault passphrase<input type="password" name="vault-passphrase" autoComplete={exists ? 'current-password' : 'new-password'} value={passphrase} onChange={event => setPassphrase(event.target.value)} required minLength={12} maxLength={1024} placeholder={exists ? 'Enter your passphrase' : 'At least 12 characters'} /></label>
              {!exists && <label className="vault-field">Confirm passphrase<input type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} required minLength={12} maxLength={1024} placeholder="Enter it again" /></label>}
              <button className="vault-button vault-button--primary vault-button--full" disabled={busy}><LockKeyhole size={17} />{busy ? 'Opening vault…' : exists ? 'Unlock vault' : 'Create vault'}<ChevronRight size={17} /></button>
              {deviceReady && <button type="button" className="vault-button vault-button--secondary vault-button--full" disabled={busy} onClick={useDeviceUnlock}><FaceScan size={18} />Unlock with device</button>}
            </form>
            <p className="vault-footnote">Saved only in this browser for this account, with no cloud sync. Your passphrase cannot be reset. Keep an encrypted backup and its passphrase before clearing browser data or moving to another device.</p>
            {!exists && <button className="vault-text-button" type="button" onClick={() => { setError(''); setRestoreOpen(true); }}>Already have a backup? Restore it <ArrowUpRight size={14} /></button>}
          </div>
        </section> : <section className="vault-panel vault-password-panel" aria-labelledby="vault-password-title">
          <div className="vault-password-heading"><div><span className="vault-eyebrow">YOUR COLLECTION</span><h2 id="vault-password-title">Passwords <span>{session.entries.length}</span></h2></div><button className="vault-button vault-button--primary" onClick={() => runCommand('add')}><Plus size={16} />Add password</button></div>
          <p className="vault-helper">Launch from your Vault. Websites open in a new tab; app links open through your device. Passwords are never added to launch links or filled automatically.</p>
          <section className="vault-favorites" aria-label="Favorite commands"><div className="vault-panel-heading"><h3>Favorite commands</h3><button type="button" className="vault-text-button" disabled={busy} onClick={() => persist(session.entries.map(entry => ({ ...entry, launchCount: 0 })), 'Usage counts cleared.', { ...preferences, commands: {} })}>Clear usage</button></div>
            <div className="vault-command-grid">{favoriteCommands.map(id => <div key={id}><button type="button" disabled={busy} onClick={() => runCommand(id)}>{COMMAND_LABELS[id]}<small>{preferences.commands[id] || 0} uses</small></button><button type="button" className="vault-icon-button" disabled={busy} aria-label={`Pin ${COMMAND_LABELS[id]}`} aria-pressed={preferences.favorites.includes(id)} onClick={() => persist(session.entries, 'Favorite commands updated.', { ...preferences, favorites: preferences.favorites.includes(id) ? preferences.favorites.filter(item => item !== id) : [...preferences.favorites, id] })}><Star size={14} fill={preferences.favorites.includes(id) ? 'currentColor' : 'none'} /></button></div>)}</div>
            <p className="vault-helper">Pinned and frequently used actions. Counts are encrypted with your Vault and stay out of analytics.</p>
          </section>
          {!!favoriteApps.length && <section className="vault-favorites" aria-label="Favorite apps"><h3>Your everyday apps</h3><div className="vault-everyday-apps">{favoriteApps.map(entry => <div key={entry.id}><AppMark name={entry.name} /><strong>{entry.name}</strong>{launchLink(entry, 'web', true)}{launchLink(entry, 'app', true)}</div>)}</div></section>}
          <div className="vault-password-toolbar"><label className="vault-search"><Search size={16} /><input type="search" aria-label="Search passwords" placeholder="Find an app or account" value={query} onChange={event => setQuery(event.target.value)} /></label><div className="vault-view-switch" role="group" aria-label="Password layout"><button className={view === 'grid' ? 'is-active' : ''} aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Grid2X2 size={17} /></button><button className={view === 'list' ? 'is-active' : ''} aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={18} /></button></div></div>
          {entries.length ? <div className={`vault-entries vault-entries--${view}`}>{entries.map(entry => <article key={entry.id} className="vault-entry vault-launch-entry"><button className="vault-entry-details" onClick={() => editEntry(entry)} aria-label={`Details for ${entry.name}`}><AppMark name={entry.name} /><span className="vault-entry-copy"><strong>{entry.name}</strong><span>{entry.username || 'No username'}</span></span></button><button type="button" className="vault-icon-button vault-favorite" aria-label={`Favorite ${entry.name}`} aria-pressed={entry.favorite} disabled={busy} onClick={() => persist(session.entries.map(item => item.id === entry.id ? { ...item, favorite: !item.favorite } : item), 'Favorite updated.')}><Star size={16} fill={entry.favorite ? 'currentColor' : 'none'} /></button><div className="vault-launch-actions">{launchLink(entry, 'web', true)}{launchLink(entry, 'app', true)}{!entry.url && !entry.appUrl && <button className="vault-text-button" onClick={() => editEntry(entry)}>Add launch link</button>}</div></article>)}</div> : <div className="vault-empty"><span className="vault-empty-icon"><KeyRound size={27} /></span><h3>{query ? 'No matches yet' : 'Make room for your everyday apps.'}</h3><p>{query ? 'Try another name or account.' : 'Add your first password, or bring your passwords over from a CSV or JSON file.'}</p>{!query && <button className="vault-text-button" onClick={() => runCommand('import')}>Import your passwords <ArrowUpRight size={15} /></button>}</div>}
          <div className="vault-password-footer"><button className="vault-text-button" disabled={busy} onClick={() => importRef.current?.click()}><Upload size={15} />Import passwords</button><button className="vault-text-button" onClick={downloadBackup}><Download size={15} />Encrypted backup</button><button className="vault-text-button" onClick={() => { setError(''); setRestoreOpen(true); }}>Restore</button></div>
          <input className="vault-hidden-input" type="file" accept=".csv,.json,text/csv,application/json" ref={importRef} onChange={importPasswords} tabIndex={-1} aria-label="Import password file" />
        </section>}

        <div className="vault-device-grid"><section className="vault-panel vault-device-panel" aria-labelledby="vault-device-title"><div className="vault-panel-heading"><span className="vault-eyebrow">UFI DEVICE</span><span className="vault-pending">Awaiting hardware</span></div><div className="vault-device-body"><div className="vault-hardware-art" aria-hidden="true"><span>ufi</span><i /><div /></div><div><h2 id="vault-device-title">Your physical connection.</h2><p>The UFI device will appear here when hardware integration is available.</p></div></div><button className="vault-button vault-button--secondary vault-button--full" disabled><Plus size={16} />Connect device · pending</button></section>
          <section className="vault-panel vault-face-panel" aria-labelledby="vault-face-title"><div className="vault-panel-heading"><span className="vault-eyebrow">QUICK ACCESS</span><span className="vault-pending">{deviceReady ? 'Configured' : 'Not configured'}</span></div><div className="vault-face-art"><FaceScan size={40} /></div><h2 id="vault-face-title">Face ID / device unlock</h2><p>Face ID on supported Apple devices; your browser controls device verification.</p>{deviceReady ? <button className="vault-button vault-button--secondary vault-button--full" disabled={busy || !!session} onClick={useDeviceUnlock}><FaceScan size={17} />{session ? 'Device unlock is ready' : 'Unlock with device'}</button> : <button className="vault-button vault-button--secondary vault-button--full" disabled={!session || busy} onClick={() => { setError(''); setDeviceSetupOpen(true); }}><FaceScan size={17} />{session ? 'Set up device unlock' : 'Unlock vault to set up'}</button>}</section></div>
        <p className="vault-local-note"><LockKeyhole size={14} />{LOCAL_PREVIEW ? 'Local preview. ' : 'Browser vault beta. '}Passwords are saved encrypted in this browser; they do not sync with your account or other devices. Keep an encrypted backup and its passphrase for recovery. Independent security review and UFI hardware integration are pending.</p>
      </div><aside className="vault-secondary-column" aria-label="Connections and activity"><VpnPanel /><HardwareVerification accountId={accountId} /></aside></div>
    </section>

    {editor && session && <VaultDialog title={editor.id ? 'Password details' : 'Add a password'} onClose={() => { setEditor(null); setShowPassword(false); setError(''); }}><form onSubmit={saveEntry} className="vault-entry-form">
      <div className="vault-editor-brand"><AppMark name={editor.name} large /><span>Stored only in your encrypted vault</span></div>
      <label className="vault-field">App or website name<input required maxLength={200} value={editor.name} onChange={event => setEditor({ ...editor, name: event.target.value })} placeholder="e.g. Google" /></label>
      <label className="vault-field">Website<input maxLength={2048} value={editor.url} onChange={event => setEditor({ ...editor, url: event.target.value })} placeholder="https://example.com" inputMode="url" /></label>
      <label className="vault-field">App launch link (optional)<input maxLength={2048} value={editor.appUrl || ''} onChange={event => setEditor({ ...editor, appUrl: event.target.value.trim() })} placeholder="Official HTTPS app link, Spotify URI, or Teams app link" /></label>
      <div className="vault-launch-actions">{launchLink(editor, 'web')}{launchLink(editor, 'app')}</div>
      <label className="vault-field">Username or email<input autoComplete="off" maxLength={500} value={editor.username} onChange={event => setEditor({ ...editor, username: event.target.value })} /></label>
      <label className="vault-field">Password<div className="vault-password-input"><input required type={showPassword ? 'text' : 'password'} autoComplete="new-password" maxLength={4096} value={editor.password} onChange={event => setEditor({ ...editor, password: event.target.value })} /><button type="button" className="vault-icon-button" aria-label={showPassword ? 'Hide password' : 'Reveal password'} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button><button type="button" className="vault-icon-button" aria-label="Copy password" onClick={() => copyPassword(editor.password)}><Copy size={16} /></button></div></label>
      <label className="vault-field">Notes<textarea rows={3} maxLength={10000} value={editor.notes} onChange={event => setEditor({ ...editor, notes: event.target.value })} /></label>
      {error && <p className="vault-form-error" role="alert">{error}</p>}
      <div className="vault-dialog-actions">{editor.id && <button type="button" className="vault-button vault-button--danger" disabled={busy} onClick={async () => { if (window.confirm(`Delete the saved password for ${editor.name}?`) && await persist(session.entries.filter(item => item.id !== editor.id), 'Password removed.')) setEditor(null); }}><Trash2 size={16} />Delete</button>}<button className="vault-button vault-button--primary" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button></div>
    </form></VaultDialog>}

    {restoreOpen && <VaultDialog title="Restore encrypted backup" onClose={() => { setRestoreOpen(false); setRestoreText(''); setRestoreConfirmed(false); setBackupPassphrase(''); setError(''); }}><form className="vault-entry-form" onSubmit={restoreBackup}><p className="vault-helper">Choose a UFIconnect encrypted backup. It must be unlocked and verified before replacing anything in this browser.</p><label className="vault-field">Backup file<input type="file" accept=".json,application/json" required onChange={readBackup} /></label><label className="vault-field">Backup passphrase<input type="password" autoComplete="off" required maxLength={1024} value={backupPassphrase} onChange={event => setBackupPassphrase(event.target.value)} placeholder="Passphrase used for this backup" /></label>{exists && <><p className="vault-form-warning">Restoring replaces the passwords stored in this browser. Download your current encrypted backup first.</p><button type="button" className="vault-text-button" onClick={downloadBackup}><Download size={16} />Download current backup</button><label className="vault-confirm"><input type="checkbox" checked={restoreConfirmed} onChange={event => setRestoreConfirmed(event.target.checked)} />I understand this replaces my current vault.</label></>}{error && <p className="vault-form-error" role="alert">{error}</p>}<button className="vault-button vault-button--primary vault-button--full" disabled={busy || !restoreText || !backupPassphrase || (exists && (!session || !restoreConfirmed))}>{busy ? 'Verifying backup…' : 'Restore backup'}</button></form></VaultDialog>}
    {deviceSetupOpen && session && <VaultDialog title="Set up device unlock" onClose={() => { setDeviceSetupOpen(false); setDevicePassphrase(''); setError(''); }}><form className="vault-entry-form" onSubmit={setupDevice}><div className="vault-face-art"><FaceScan size={40} /></div><p className="vault-helper">Re-enter your vault passphrase, then follow your browser’s passkey prompt. Your authenticator must support encrypted passkey access. The browser chooses Face ID, device biometrics, or its verification method.</p><label className="vault-field">Vault passphrase<input type="password" autoComplete="current-password" required minLength={12} value={devicePassphrase} onChange={event => setDevicePassphrase(event.target.value)} /></label>{error && <p className="vault-form-error" role="alert">{error}</p>}<button className="vault-button vault-button--primary vault-button--full" disabled={busy}><FaceScan size={18} />{busy ? 'Waiting for your device…' : 'Continue with device'}</button><p className="vault-footnote">Keep your passphrase. A restored backup or a different device may need it.</p></form></VaultDialog>}
  </Layout>;
}
