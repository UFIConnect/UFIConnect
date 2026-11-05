import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { SOURCE_META } from './sourceMeta';
import SourceButton from './SourceButton';
import { connectedFirstSourceIds } from './sourceSelection.mjs';
import { publishingResults, publishingUnavailableReason, wasPublishingSubmitted } from './publishingAvailability.mjs';
import TikTokPublishingOptions, { useTikTokPublishingOptions } from './TikTokPublishingOptions';
import PublishingOptions, { EnablePublishingButton, usePublishingOptions } from './PublishingOptions';

export function usePublishingTargets({ enabled = true, group = false, media, content } = {}) {
  const { profile } = useAuth();
  const [accounts, setAccounts] = useState({});
  const [connected, setConnected] = useState({});
  const [selected, setSelected] = useState(['local']);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  useEffect(() => { setAccounts({}); setConnected({}); setSelected(['local']); setError(''); }, [profile?.id]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true); setError('');
    client.get('/social/platforms').then(({ data }) => {
      if (cancelled) return;
      setAccounts(data.platforms || {});
      setConnected(data.connected || {});
    }).catch(() => { if (!cancelled) { setAccounts({}); setConnected({}); setError('Connected accounts could not load.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    const refresh = () => setRetry(value => value + 1);
    window.addEventListener('ufi-connections-changed', refresh);
    return () => { cancelled = true; window.removeEventListener('ufi-connections-changed', refresh); };
  }, [enabled, retry, profile?.id]);
  const unavailable = key => loading ? 'Checking connected accounts.' : publishingUnavailableReason(accounts[key], { connected: Boolean(connected[key]), plan: profile?.plan, media });
  const tiktok = useTikTokPublishingOptions(enabled && selected.includes('tiktok') && !unavailable('tiktok'));
  const options = usePublishingOptions({ selected, accounts, connected, enabled });
  useEffect(() => { tiktok.resetConsent(); }, [media, content]);
  useEffect(() => {
    setSelected(current => current.filter(key => ['local', 'uficonnect'].includes(key) || (connected[key] && (accounts[key]?.reconnectRequired || accounts[key]?.crossPost?.reconnectRequired)) || !publishingUnavailableReason(accounts[key], { connected: Boolean(connected[key]), plan: profile?.plan, media })));
  }, [accounts, connected, profile?.plan, media]);
  const toggle = key => {
    if (!selected.includes(key) && !['local', 'uficonnect'].includes(key) && unavailable(key)) return;
    setSelected(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
  };
  async function publish(localPublish, payload) {
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
        try {
          const result = key === 'local' ? await localPublish() : await client.post('/groups/ufi-general/posts', payload);
          if (key === 'local') localResult = result;
          completed.push(key);
        } catch (failure) {
          failures.push((key === 'local' && group ? 'Group' : 'UFIconnect') + ': ' + (failure.response?.data?.message || 'Could not publish.'));
        }
      }
      if (external.length) {
        try {
          const { data } = await client.post('/command-center/cross-post', { ...payload, platforms: external, publisherSettings: options.payload, ...(external.includes('tiktok') ? { tiktok: tiktok.payload } : {}) });
          for (const target of publishingResults(external, data.targets)) {
            const label = SOURCE_META[target.platform]?.label || target.platform;
            if (wasPublishingSubmitted(target)) {
              completed.push(target.platform);
              if (target.status !== 'posted') failures.push(`${label}: ${target.status === 'handoff' ? 'Finish publishing in TikTok.' : 'Publication is being confirmed.'} Check Cross-Post history before sending again.`);
            } else {
              failures.push(label + ': ' + target.error);
              if (target.reconnectRequired) setAccounts(old => ({ ...old, [target.platform]: { ...old[target.platform], crossPost: { ...old[target.platform]?.crossPost, reconnectRequired: true, reconnectMessage: target.error } } }));
            }
          }
        } catch (failure) { failures.push(failure.response?.data?.message || 'Could not confirm account publication; check Cross-Post history before retrying.'); }
      }
      if (failures.length) {
        setSelected(current => current.filter(key => !completed.includes(key)));
        throw new Error((completed.length ? 'Submitted destinations are deselected to avoid duplicates. ' : '') + failures.join(' '));
      }
      setSelected(['local']);
      return localResult;
    } finally { busy.current = false; tiktok.resetConsent(); }
  }
  return { accounts, connected, selected, toggle, publish, unavailable, group, error, loading, tiktok, options, reason: options.reason || selected.filter(key => !['local', 'uficonnect'].includes(key)).map(unavailable).find(Boolean) || (selected.includes('tiktok') ? tiktok.reason : ''), retry: () => setRetry(value => value + 1) };
}

export default function PublishingTargets({ targets, disabled = false }) {
  const sources = connectedFirstSourceIds(Object.keys(targets.accounts).filter(key => key !== 'uficonnect'), targets.connected);
  const disconnected = sources.filter(key => !targets.connected[key]);
  const destination = key => {
    const reason = targets.unavailable(key);
    return <SourceButton key={key} source={key} label={SOURCE_META[key]?.label || targets.accounts[key]?.name || key} selected={targets.selected.includes(key)} connected={Boolean(targets.connected[key])} locked={Boolean(reason)} reason={reason} onClick={() => targets.toggle(key)} />;
  };
  return <fieldset disabled={disabled} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, margin: '0 0 14px', minWidth: 0 }}>
    <legend style={{ fontSize: '.8rem', fontWeight: 500 }}>Post to</legend>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <SourceButton source="uficonnect" label={targets.group ? 'This group' : 'UFIConnect'} connected selected={targets.selected.includes('local')} onClick={() => targets.toggle('local')} />
      {targets.group && <SourceButton source="uficonnect" label="UFIConnect" connected selected={targets.selected.includes('uficonnect')} onClick={() => targets.toggle('uficonnect')} />}
      {sources.filter(key => targets.connected[key]).map(destination)}
    </div>
    {disconnected.length > 0 && <details style={{ marginTop: 10 }}><summary style={{ fontSize: '.8rem', cursor: 'pointer' }}>Other sources ({disconnected.length}) · connect to publish</summary><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>{disconnected.map(destination)}</div></details>}
    {targets.selected.includes('tiktok') && <TikTokPublishingOptions publishing={targets.tiktok} disabled={disabled} />}
    <PublishingOptions publishing={targets.options} disabled={disabled} />
    {sources.filter(key => targets.connected[key] && (targets.accounts[key]?.reconnectRequired || targets.accounts[key]?.crossPost?.reconnectRequired)).map(key => <div key={key} style={{ marginTop: 10 }}><span>{SOURCE_META[key]?.label || key}: </span><EnablePublishingButton source={key} disabled={disabled} />{targets.selected.includes(key) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => targets.toggle(key)}>Remove destination</button>}</div>)}
    {targets.loading && <p role="status">Loading connected accounts…</p>}
    {targets.error && <p role="alert">{targets.error} <button type="button" className="btn btn-ghost btn-sm" onClick={targets.retry}>Retry</button></p>}
    <Link to="/connected-accounts" style={{ display: 'inline-block', marginTop: 10, fontSize: '.8rem' }}>Manage connected accounts</Link>
  </fieldset>;
}

