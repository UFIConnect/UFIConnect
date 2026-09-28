import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { SOURCE_META } from './sourceMeta';

export function usePublishingTargets({ enabled = true, group = false, media } = {}) {
  const { profile } = useAuth();
  const [accounts, setAccounts] = useState({});
  const [selected, setSelected] = useState(['local']);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true); setError('');
    client.get('/social/platforms').then(({ data }) => {
      if (cancelled) return;
      setAccounts(Object.fromEntries(Object.entries(data.platforms || {}).filter(([key, value]) =>
        data.connected?.[key] && value.crossPost?.supported)));
    }).catch(() => { if (!cancelled) setError('Connected accounts could not load.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [enabled, retry]);
  const paid = profile?.plan && profile.plan !== 'free';
  const unavailable = key => {
    if (!paid) return 'Pro membership required';
    const capability = accounts[key]?.crossPost;
    if (!capability) return 'Account unavailable';
    if (capability.requiresPhoto && media?.type !== 'image') return 'Add a photo';
    if (media?.type === 'video' && capability.media !== 'link') return 'Video publishing is not supported';
    return '';
  };
  const toggle = key => setSelected(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
  async function publish(localPublish, payload) {
    if (busy.current) throw new Error('Publishing is already in progress.');
    if (!selected.length) throw new Error('Choose at least one publishing destination.');
    const external = selected.filter(key => !['local', 'uficonnect'].includes(key));
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
          const { data } = await client.post('/command-center/cross-post', { ...payload, platforms: external });
          for (const key of external) {
            const target = data.targets?.find(item => item.platform === key);
            if (['posted', 'handoff', 'processing'].includes(target?.status)) completed.push(key);
            else failures.push((SOURCE_META[key]?.label || key) + ': ' + (target?.error || 'Could not confirm publication; check Cross-Post history before retrying.'));
          }
        } catch (failure) { failures.push(failure.response?.data?.message || 'Could not confirm account publication; check Cross-Post history before retrying.'); }
      }
      if (failures.length) {
        setSelected(current => current.filter(key => !completed.includes(key)));
        throw new Error((completed.length ? 'Some destinations succeeded and are deselected to avoid duplicates. ' : '') + failures.join(' '));
      }
      setSelected(['local']);
      return localResult;
    } finally { busy.current = false; }
  }
  return { accounts, selected, toggle, publish, unavailable, group, error, loading, retry: () => setRetry(value => value + 1) };
}

export default function PublishingTargets({ targets, disabled = false }) {
  return <fieldset disabled={disabled} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, margin: '0 0 14px', minWidth: 0 }}>
    <legend style={{ fontSize: '.8rem', fontWeight: 500 }}>Post to</legend>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      <label><input type="checkbox" checked={targets.selected.includes('local')} onChange={() => targets.toggle('local')} /> {targets.group ? 'This group' : 'UFIconnect'}</label>
      {targets.group && <label><input type="checkbox" checked={targets.selected.includes('uficonnect')} onChange={() => targets.toggle('uficonnect')} /> UFIconnect</label>}
      {Object.keys(targets.accounts).map(key => {
        const reason = targets.unavailable(key);
        return <label key={key} title={reason || undefined} style={{ fontSize: '.85rem' }}>
          <input type="checkbox" checked={targets.selected.includes(key)} disabled={Boolean(reason)} onChange={() => targets.toggle(key)} />
          {' '}{SOURCE_META[key]?.label || key}{reason ? ' · ' + reason : ''}
        </label>;
      })}
    </div>
    {targets.loading && <p role="status">Loading connected accounts…</p>}
    {targets.error && <p role="alert">{targets.error} <button type="button" className="btn btn-ghost btn-sm" onClick={targets.retry}>Retry</button></p>}
    <Link to="/connected-accounts" style={{ display: 'inline-block', marginTop: 10, fontSize: '.8rem' }}>Manage connected accounts</Link>
  </fieldset>;
}

