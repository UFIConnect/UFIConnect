import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { SOURCE_META } from './sourceMeta';
import SourceButton from './SourceButton';
import { connectedFirstSourceIds } from './sourceSelection.mjs';
import { publishingDestinationState, publishingResults, publishingUnavailableReason, wasPublishingSubmitted } from './publishingAvailability.mjs';
import { sourceConnectionPath } from './sourceConnectionPath.mjs';
import PhotoPickerButton from './PhotoPickerButton';
import TikTokPublishingOptions, { useTikTokPublishingOptions } from './TikTokPublishingOptions';
import PublishingOptions, { EnablePublishingButton, usePublishingOptions } from './PublishingOptions';
import { continueSourceConnectionInBrowser, getNativeRuntime, isNativeRuntime, reportNativeError, subscribeNativeForeground } from '../nativeRuntime.mjs';

async function openAccountWorkspace(path) {
  if (!isNativeRuntime()) { window.open(path, '_blank', 'noopener,noreferrer'); return; }
  try {
    const host = getNativeRuntime();
    if (typeof host?.onOpenExternal !== 'function') throw new Error('Unavailable');
    await host.onOpenExternal(new URL(path, 'https://uficonnect.org').href);
    window.dispatchEvent(new Event('focus'));
  } catch { reportNativeError('The account page could not be opened. Please try again.'); }
}

function PublishingVideoPicker({ name, onFileSelected, disabled }) {
  const input = useRef(null);
  const label = `Add video for ${name}`;
  return <>
    <input ref={input} type="file" accept="video/*" aria-label={label} style={{ display: 'none' }} onChange={event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) onFileSelected(file);
    }} />
    <button type="button" className="btn btn-outline btn-sm" disabled={disabled} onClick={() => input.current?.click()}>{label}</button>
  </>;
}

export function usePublishingTargets({ enabled = true, group = false, media, content } = {}) {
  const { profile } = useAuth();
  const [accounts, setAccounts] = useState({});
  const [connected, setConnected] = useState({});
  const [selected, setSelected] = useState(['local']);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(false);
  const currentOwner = useRef(profile?.id);
  const currentOptions = useRef(null);
  currentOwner.current = profile?.id;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setAccounts({}); setConnected({}); setSelected(['local']); setError(''); }, [profile?.id]);
  useEffect(() => {
    if (!enabled || !profile?.id) return;
    let cancelled = false;
    const owner = profile?.id;
    const controller = new AbortController();
    setLoading(true); setError('');
    client.get('/social/platforms', { signal: controller.signal }).then(({ data }) => {
      if (cancelled || currentOwner.current !== owner) return;
      setAccounts(data.platforms || {});
      setConnected(data.connected || {});
    }).catch(() => { if (!cancelled && currentOwner.current === owner) { setAccounts({}); setConnected({}); setError('Connected accounts could not load.'); } })
      .finally(() => { if (!cancelled && currentOwner.current === owner) setLoading(false); });
    const refresh = () => setRetry(value => value + 1);
    const resume = () => {
      if (cancelled || currentOwner.current !== owner || document.hidden) return;
      refresh();
      // Recheck renewed grants while preserving entered publishing settings.
      const options = currentOptions.current;
      options?.sources.forEach(key => options.forSource(key).retry());
    };
    const native = isNativeRuntime();
    const stopForeground = subscribeNativeForeground(resume);
    if (!native) {
      window.addEventListener('focus', resume);
      document.addEventListener('visibilitychange', resume);
    }
    window.addEventListener('ufi-connections-changed', refresh);
    return () => {
      cancelled = true; controller.abort(); stopForeground();
      window.removeEventListener('ufi-connections-changed', refresh);
      if (!native) {
        window.removeEventListener('focus', resume);
        document.removeEventListener('visibilitychange', resume);
      }
    };
  }, [enabled, retry, profile?.id]);
  const unavailable = key => loading ? 'Checking connected accounts.' : publishingUnavailableReason(accounts[key], { connected: Boolean(connected[key]), plan: profile?.plan, media });
  const destinationState = key => publishingDestinationState(accounts[key], { connected: Boolean(connected[key]), plan: profile?.plan, media });
  const tiktok = useTikTokPublishingOptions(enabled && selected.includes('tiktok') && !unavailable('tiktok'));
  const options = usePublishingOptions({ selected, accounts, connected, enabled });
  currentOptions.current = options;
  useEffect(() => { tiktok.resetConsent(); }, [media, content]);
  const toggle = key => {
    if (!selected.includes(key) && !['local', 'uficonnect'].includes(key) && (loading || !destinationState(key).selectable)) return;
    setSelected(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
  };
  async function publish(localPublish, payload) {
    const owner = profile?.id;
    const isCurrent = () => Boolean(owner) && mounted.current && currentOwner.current === owner;
    const assertCurrent = () => { if (!isCurrent()) throw new Error('Your account changed. No additional destinations were sent. Review your draft before publishing again.'); };
    assertCurrent();
    if (busy.current) throw new Error('Publishing is already in progress.');
    if (!selected.length) throw new Error('Choose at least one publishing destination.');
    const external = selected.filter(key => !['local', 'uficonnect'].includes(key));
    if (external.includes('tiktok') && tiktok.reason) throw new Error(tiktok.reason);
    if (options.reason) throw new Error(options.reason);
    if (external.some(key => unavailable(key))) throw new Error('Update the selected accounts for this attachment before publishing.');
    busy.current = true;
    const completed = []; const failures = []; let localResult;
    try {
      for (const key of selected.filter(key => ['local', 'uficonnect'].includes(key))) {
        assertCurrent();
        try {
          const result = key === 'local' ? await localPublish() : await client.post('/groups/ufi-general/posts', payload);
          assertCurrent();
          if (key === 'local') localResult = result;
          completed.push(key);
        } catch (failure) {
          assertCurrent();
          failures.push((key === 'local' && group ? 'Group' : 'UFIconnect') + ': ' + (failure.response?.data?.message || 'Could not publish.'));
        }
      }
      if (external.length) {
        assertCurrent();
        try {
          const { data } = await client.post('/command-center/cross-post', { ...payload, platforms: external, publisherSettings: options.payload, ...(external.includes('tiktok') ? { tiktok: tiktok.payload } : {}) });
          assertCurrent();
          for (const target of publishingResults(external, data.targets)) {
            const label = SOURCE_META[target.platform]?.label || target.platform;
            if (wasPublishingSubmitted(target)) {
              completed.push(target.platform);
              if (target.status !== 'posted') failures.push(`${label}: ${target.status === 'handoff' ? target.platform === 'tiktok' ? 'Finish publishing in TikTok.' : 'Review at source. Check this destination before retrying.' : 'Publication is being confirmed.'} Check Cross-Post history before sending again.`);
            } else {
              failures.push(label + ': ' + target.error);
              if (target.reconnectRequired) setAccounts(old => isCurrent() ? ({ ...old, [target.platform]: { ...old[target.platform], crossPost: { ...old[target.platform]?.crossPost, reconnectRequired: true, reconnectMessage: target.error } } }) : old);
            }
          }
        } catch (failure) { assertCurrent(); failures.push(failure.response?.data?.message || 'Could not confirm account publication; check Cross-Post history before retrying.'); }
      }
      assertCurrent();
      if (failures.length) {
        setSelected(current => isCurrent() ? current.filter(key => !completed.includes(key)) : current);
        throw new Error((completed.length ? 'Submitted destinations are deselected to avoid duplicates. ' : '') + failures.join(' '));
      }
      setSelected(current => isCurrent() ? ['local'] : current);
      return localResult;
    } finally { busy.current = false; if (isCurrent()) tiktok.resetConsent(); }
  }
  return { accounts, connected, selected, toggle, publish, unavailable, destinationState, media, group, error, loading, tiktok, options, reason: options.reason || selected.filter(key => !['local', 'uficonnect'].includes(key)).map(unavailable).find(Boolean) || (selected.includes('tiktok') ? tiktok.reason : ''), retry: () => setRetry(value => value + 1) };
}

export default function PublishingTargets({ targets, disabled = false, onMediaSelected }) {
  const sources = connectedFirstSourceIds(Object.keys(targets.accounts).filter(key => key !== 'uficonnect'), targets.connected);
  const disconnected = sources.filter(key => !targets.connected[key]);
  const readyDisconnected = disconnected.filter(key => targets.destinationState(key).available);
  const unavailableDisconnected = disconnected.filter(key => !targets.destinationState(key).available);
  const destination = key => {
    const platform = targets.accounts[key];
    const name = SOURCE_META[key]?.label || platform?.name || key;
    const state = targets.destinationState(key);
    const selected = targets.selected.includes(key);
    const reason = targets.unavailable(key);
    const actionLabel = { connect: 'Connect', reconnect: 'Reconnect', manage: 'Manage account' }[state.action];
    const choose = async () => {
      if (state.selectable) targets.toggle(key);
      else if (state.available) {
        const intent = { publishing: platform?.crossPost?.supported === true, returnTo: 'command-center' };
        const path = state.action === 'manage' ? platform?.commandCenterOnly ? '/command-center?tab=accounts' : `/connected-accounts?source=${encodeURIComponent(key)}`
          : sourceConnectionPath(key, intent);
        if (isNativeRuntime() && state.action !== 'manage') { await continueSourceConnectionInBrowser(key, intent); return; }
        await openAccountWorkspace(path);
      }
    };
    const requiredMedia = platform?.crossPost?.requiresVideo ? 'video' : platform?.crossPost?.requiresPhoto ? 'image' : null;
    return <div key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5, minWidth: 0, maxWidth: '100%' }}>
      <SourceButton source={key} label={name} selected={selected} connected={Boolean(targets.connected[key])}
        locked={!state.available} disabled={targets.loading} reason={reason || `${selected ? 'Remove' : 'Select'} ${name}`}
        aria-label={actionLabel ? `${actionLabel} ${name}` : `${selected ? 'Remove' : 'Select'} ${name}`}
        onClick={choose}>{actionLabel && <span>{actionLabel}</span>}</SourceButton>
      {reason && !targets.loading && <span style={{ color: 'var(--muted)', fontSize: '.75rem', maxWidth: 270 }}>{reason}</span>}
      {key === 'youtube' && targets.connected[key] && state.available && platform?.crossPost?.supported &&
        <EnablePublishingButton source="youtube" label="Enable YouTube uploads" newTab disabled={disabled || targets.loading} />}
      {state.selectable && onMediaSelected && requiredMedia && targets.media?.type !== requiredMedia && (requiredMedia === 'video'
        ? <PublishingVideoPicker name={name} onFileSelected={onMediaSelected} disabled={disabled} />
        : <PhotoPickerButton onFileSelected={onMediaSelected} accept="image/*" disabled={disabled}
          className="btn btn-outline btn-sm" label={`Add photo for ${name}`} ariaLabel={`Add photo for ${name}`} />)}
      {selected && !state.selectable && <button type="button" className="btn btn-ghost btn-sm" onClick={() => targets.toggle(key)}>Remove destination</button>}
    </div>;
  };
  return <fieldset disabled={disabled} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, margin: '0 0 14px', minWidth: 0 }}>
    <legend style={{ fontSize: '.8rem', fontWeight: 500 }}>Post to</legend>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <SourceButton source="uficonnect" label={targets.group ? 'This group' : 'UFIConnect'} connected selected={targets.selected.includes('local')} onClick={() => targets.toggle('local')} />
      {targets.group && <SourceButton source="uficonnect" label="UFIConnect" connected selected={targets.selected.includes('uficonnect')} onClick={() => targets.toggle('uficonnect')} />}
      {sources.filter(key => targets.connected[key]).map(destination)}
    </div>
    {readyDisconnected.length > 0 && <section aria-label="Configured sources to connect" style={{ marginTop: 12 }}>
      <h3 style={{ fontSize: '.8rem', margin: '0 0 8px' }}>Configured sources to connect</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{readyDisconnected.map(destination)}</div>
    </section>}
    {unavailableDisconnected.length > 0 && <details style={{ marginTop: 10 }}><summary style={{ fontSize: '.8rem', cursor: 'pointer' }}>Other sources ({unavailableDisconnected.length}) · connect to publish</summary><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>{unavailableDisconnected.map(destination)}</div></details>}
    {targets.selected.includes('tiktok') && <TikTokPublishingOptions publishing={targets.tiktok} disabled={disabled} />}
    <PublishingOptions publishing={targets.options} disabled={disabled} newTab />
    {targets.loading && <p role="status">Loading connected accounts…</p>}
    {targets.error && <p role="alert">{targets.error} <button type="button" className="btn btn-ghost btn-sm" onClick={targets.retry}>Retry</button></p>}
    <Link to="/connected-accounts" target="_blank" rel="noopener noreferrer" aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}
      onClick={event => { event.preventDefault(); if (!disabled) openAccountWorkspace('/connected-accounts'); }}
      style={{ display: 'inline-block', marginTop: 10, fontSize: '.8rem' }}>Manage connected accounts</Link>
  </fieldset>;
}

