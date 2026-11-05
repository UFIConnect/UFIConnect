import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';

const emptyOptions = () => ({ privacyLevel: '', disableComment: true, autoAddMusic: false, isAigc: false, brandContent: false, brandOrganic: false, consent: false });

export function useTikTokPublishingOptions(enabled) {
  const [creator, setCreator] = useState(null);
  const [options, setOptions] = useState(emptyOptions);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [disclose, setDisclose] = useState(false);
  useEffect(() => {
    if (!enabled) { setCreator(null); setOptions(emptyOptions()); setError(''); setLoading(false); setDisclose(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(''); setCreator(null); setOptions(emptyOptions());
    client.get('/command-center/cross-post/tiktok/creator-info', { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setCreator(data.creator);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure.response?.data?.message || 'Could not load your TikTok publishing permissions.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [enabled, retry]);
  const reason = !enabled ? '' : loading ? 'Checking TikTok publishing permissions.' : error || (!creator ? 'TikTok publishing permissions are unavailable.'
    : !options.privacyLevel ? 'Choose who can view your TikTok post.'
    : disclose && !options.brandContent && !options.brandOrganic ? 'Select the commercial content disclosure that applies.'
    : options.brandContent && options.privacyLevel === 'SELF_ONLY' ? 'Paid partnership content cannot be private.'
    : !options.consent ? 'Review the TikTok publishing consent.' : '');
  return { creator, options, loading, error, reason, disclose, setDisclose: value => { setDisclose(value); setOptions(old => ({ ...old, brandContent: false, brandOrganic: false, consent: false })); },
    change: (key, value) => setOptions(old => ({ ...old, [key]: value, ...(key === 'consent' ? {} : { consent: false }) })),
    retry: () => setRetry(value => value + 1), resetConsent: () => setOptions(old => ({ ...old, consent: false })),
    payload: { ...options, creatorUsername: creator?.creatorUsername },
  };
}

const privacyLabels = { PUBLIC_TO_EVERYONE: 'Everyone', MUTUAL_FOLLOW_FRIENDS: 'Friends', FOLLOWER_OF_CREATOR: 'Followers', SELF_ONLY: 'Only you' };

export default function TikTokPublishingOptions({ publishing, disabled = false }) {
  const { creator, options, loading, error, change, disclose, setDisclose } = publishing;
  return <fieldset disabled={disabled || loading} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, margin: '14px 0 0', minWidth: 0 }}>
    <legend style={{ fontSize: '.85rem', fontWeight: 600 }}>Publish to TikTok</legend>
    {loading && <p role="status">Checking your TikTok account…</p>}
    {error && <p role="alert">{error} <button type="button" className="btn btn-ghost btn-sm" onClick={publishing.retry}>Try again</button> <Link to="/command-center?tab=accounts">Reconnect TikTok in account connections</Link></p>}
    {creator && <div style={{ display: 'grid', gap: 10, fontSize: '.82rem' }}>
      <strong>Account: {creator.creatorNickname || creator.creatorUsername} (@{creator.creatorUsername})</strong>
      <label>Who can view this post <select className="form-select" value={options.privacyLevel} onChange={event => change('privacyLevel', event.target.value)} required>
        <option value="">Choose visibility…</option>
        {(creator.privacyLevelOptions || []).map(level => <option key={level} value={level}>{privacyLabels[level] || level}</option>)}
      </select></label>
      <label><input type="checkbox" checked={!options.disableComment} disabled={creator.commentDisabled} onChange={event => change('disableComment', !event.target.checked)} /> Allow comments{creator.commentDisabled ? ' (disabled by your TikTok settings)' : ''}</label>
      <label><input type="checkbox" checked={options.autoAddMusic} onChange={event => change('autoAddMusic', event.target.checked)} /> Add music automatically</label>
      <label><input type="checkbox" checked={options.isAigc} onChange={event => change('isAigc', event.target.checked)} /> This post contains AI generated content</label>
      <label><input type="checkbox" checked={disclose} onChange={event => setDisclose(event.target.checked)} /> Disclose commercial content</label>
      {disclose && <div style={{ display: 'grid', gap: 8, paddingLeft: 18 }}>
        <label><input type="checkbox" checked={options.brandOrganic} onChange={event => change('brandOrganic', event.target.checked)} /> Promote my own brand or business</label>
        <label><input type="checkbox" checked={options.brandContent} onChange={event => change('brandContent', event.target.checked)} /> Paid partnership with another brand</label>
      </div>}
      <label><input type="checkbox" checked={options.consent} onChange={event => change('consent', event.target.checked)} /> I authorize this post to be published to the TikTok account shown above and agree to TikTok’s <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noopener noreferrer">Music Usage Confirmation</a>{options.brandContent || options.brandOrganic ? <> and <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noopener noreferrer">Branded Content Policy</a></> : null}.</label>
      {publishing.reason && <p role="status" style={{ margin: 0, color: 'var(--muted)' }}>{publishing.reason}</p>}
    </div>}
  </fieldset>;
}
