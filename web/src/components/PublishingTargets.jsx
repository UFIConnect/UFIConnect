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
import PublishingOptions, { usePublishingOptions } from './PublishingOptions';
import { continueSourceConnectionInBrowser, isNativeRuntime, subscribeNativeForeground } from '../nativeRuntime.mjs';
import { openAccountWorkspace } from './publishingWorkspace.mjs';
import { privateSessionStorage } from '../auth/session';
import { publishingDraftFingerprint, publishingPlan, readPublishingHold, retainedPublishingTargets, savePublishingHold, unconfirmedPublishingReasons } from './publishingPlan.mjs';
import PublishingReadiness from './PublishingReadiness';
import useCrossPostStatus from './useCrossPostStatus';
import { crossPostRequestConfig, mergePublishingResults, publishingProcessingMessage, publishingReceiptLink } from './publishingStatus.mjs';

export function PublishingVideoPicker({ name, onFileSelected, disabled }) {
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

export function usePublishingTargets({ enabled = true, group = false, media, content, localReason = '', localTextLimit = 2000 } = {}) {
  const { profile } = useAuth();
  const [accounts, setAccounts] = useState({});
  const [connected, setConnected] = useState({});
  const [selected, setSelected] = useState(['local']);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [resultBatchId, setResultBatchId] = useState(null);
  const resultBatch = useRef(null);
  const [submittingVideo, setSubmittingVideo] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(false);
  const currentOwner = useRef(profile?.id);
  const currentOptions = useRef(null);
  currentOwner.current = profile?.id;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { resultBatch.current = null; setAccounts({}); setConnected({}); setSelected(['local']); setError(''); setResults([]); setResultBatchId(null); setSubmittingVideo(false); }, [profile?.id]);
  const statusUpdates = useCrossPostStatus({ owner: profile?.id, enabled: enabled && profile?.plan === 'pro',
    posts: resultBatchId ? [{ id: resultBatchId, targets: results }] : [],
    onPosts: posts => setResults(previous => resultBatch.current === resultBatchId ? mergePublishingResults(previous, resultBatchId, posts) : previous) });
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
  const destinationState = key => publishingDestinationState(accounts[key], { connected: Boolean(connected[key]), plan: profile?.plan, media, reconnectRequired: key === 'youtube' && currentOptions.current?.forSource(key).reconnectRequired });
  const tiktok = useTikTokPublishingOptions(enabled && selected.includes('tiktok') && !unavailable('tiktok'));
  const options = usePublishingOptions({ selected, accounts, connected, enabled });
  currentOptions.current = options;
  const fingerprint = publishingDraftFingerprint(content, media);
  const holdKey = `ufi_inline_delivery_holds:${profile?.id}`;
  const heldReasons = readPublishingHold(privateSessionStorage, holdKey, fingerprint);
  const captionReason = media?.type === 'video' && !String(content || '').trim() ? 'Add a caption for the UFIConnect video post.' : '';
  const planFor = draftContent => publishingPlan(selected, { accounts, connected, plan: profile?.plan, media, content: draftContent,
    loading, optionReasons: options.reasons, localReason: localReason || captionReason, localTextLimit,
    extraReasons: { ...heldReasons, uficonnect: heldReasons.uficonnect || captionReason, tiktok: heldReasons.tiktok || tiktok.reason } });
  const batch = planFor(content);
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
    const run = planFor(payload.content);
    if (!run.ready.length) throw new Error(run.pending[0]?.reason || 'Complete a destination before publishing.');
    const chosen = [...selected];
    const external = run.ready.filter(key => !['local', 'uficonnect'].includes(key));
    const skipped = run.pending.map(({ platform, reason }) => ({ platform, status: 'skipped', error: reason }));
    const receipts = [];
    const rememberUnknown = () => savePublishingHold(privateSessionStorage, holdKey, fingerprint, unconfirmedPublishingReasons(receipts));
    busy.current = true;
    resultBatch.current = null;
    setResults([]); setResultBatchId(null); setError(''); setSubmittingVideo(payload.mediaType === 'video');
    let localResult;
    try {
      for (const key of run.ready.filter(key => ['local', 'uficonnect'].includes(key))) {
        assertCurrent();
        let result, failure;
        try {
          result = key === 'local' ? await localPublish() : await client.post('/groups/ufi-general/posts', payload);
        } catch (error) { failure = error; }
        const id = result?.data?.post?.id;
        if (failure) receipts.push({ platform: key, status: 'failed', deliveryUncertain: !failure.response || failure.response.status >= 500,
          error: failure.response?.data?.message || 'Native delivery could not be confirmed. Review the feed before retrying this draft.' });
        else if (typeof id === 'string' && id) {
          receipts.push({ platform: key, status: 'posted', postedUrl: `/p/${encodeURIComponent(id)}` });
          if (key === 'local') localResult = result;
        } else receipts.push({ platform: key, status: 'failed', deliveryUncertain: true, error: 'The native post did not return a receipt. Review the feed before retrying this draft.' });
        rememberUnknown();
        assertCurrent();
      }
      if (external.length) {
        assertCurrent();
        let data, failure;
        try {
          ({ data } = await client.post('/command-center/cross-post', { ...payload, platforms: external,
            publisherSettings: Object.fromEntries(external.filter(key => options.payload[key]).map(key => [key, options.payload[key]])),
            ...(external.includes('tiktok') ? { tiktok: tiktok.payload } : {}) }, crossPostRequestConfig(payload.mediaType)));
        } catch (error) { failure = error; }
        if (failure) {
          const definiteDenial = [400, 401, 403, 422, 429, 503].includes(failure.response?.status);
          receipts.push(...external.map(platform => ({ platform, status: 'failed', deliveryUncertain: !definiteDenial,
            error: failure.response?.data?.message || 'Delivery could not be confirmed. Review history before retrying this draft.' })));
        } else receipts.push(...publishingResults(external, data?.targets));
        rememberUnknown();
        assertCurrent();
        resultBatch.current = data?.id || null;
        setResultBatchId(resultBatch.current);
        for (const target of receipts.filter(target => target.reconnectRequired)) setAccounts(old => isCurrent()
          ? ({ ...old, [target.platform]: { ...old[target.platform], crossPost: { ...old[target.platform]?.crossPost, reconnectRequired: true, reconnectMessage: target.error } } }) : old);
        if (data?.historySaved === false) setError('Delivery was submitted. History will finish syncing shortly; do not resend accepted destinations.');
      }
      assertCurrent();
      setResults([...receipts, ...skipped]);
      const retained = retainedPublishingTargets(chosen, receipts);
      setSelected(current => isCurrent() ? retained.length ? retained : ['local'] : current);
      if (retained.length) {
        const pending = [...receipts.filter(target => !wasPublishingSubmitted(target)), ...skipped];
        const names = pending.map(target => `${target.platform === 'local' ? group ? 'This group' : 'UFIConnect' : SOURCE_META[target.platform]?.label || target.platform}: ${target.error || 'Needs review.'}`);
        throw new Error((receipts.some(wasPublishingSubmitted) ? 'Ready destinations were submitted. ' : 'No delivery was confirmed. ')
          + 'Your draft is retained; submitted destinations are deselected. ' + names.join(' '));
      }
      return { localResult, targets: receipts };
    } finally { busy.current = false; if (isCurrent()) { tiktok.resetConsent(); setSubmittingVideo(false); } }
  }
  return { accounts, connected, selected, toggle, publish, unavailable, destinationState, media, group, error, loading, tiktok, options, batch, results, statusUpdates, submittingVideo,
    submitLabel: batch.label, reason: batch.ready.length ? '' : batch.pending[0]?.reason || 'Choose a destination.', retry: () => setRetry(value => value + 1) };
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
    const reason = targets.loading ? targets.unavailable(key) : state.reason;
    const actionLabel = { connect: 'Connect', reconnect: key === 'youtube' ? 'Connect' : 'Reconnect', manage: 'Manage account' }[state.action];
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
    <PublishingReadiness plan={targets.batch} group={targets.group} disabled={disabled} onRemove={targets.toggle} />
    <PublishingOptions publishing={targets.options} disabled={disabled} newTab hideConnectionActions={['youtube']}
      renderExtra={source => source === 'tiktok' ? <TikTokPublishingOptions publishing={targets.tiktok} disabled={disabled} /> : null} />
    {targets.submittingVideo && <p role="status">Uploading video to the selected accounts. Waiting for the upload receipt; processing is checked after the upload is accepted.</p>}
    {targets.results.length > 0 && <section aria-label="Publishing results" style={{ marginTop: 12, fontSize: '.8rem' }}>
      <strong>Delivery results</strong><ul>{targets.results.map(target => {
        const receiptLink = publishingReceiptLink(target);
        return <li key={target.platform}>
        {target.platform === 'local' ? targets.group ? 'This group' : 'UFIConnect' : SOURCE_META[target.platform]?.label || target.platform}: {{ posted: 'Published', processing: 'Processing', handoff: 'Review at source', failed: 'Failed', skipped: 'Not sent' }[target.status] || 'Needs review'}{target.error && ` — ${target.error}`}
        {target.platform === 'youtube' && target.status === 'processing' && <> · {publishingProcessingMessage(target)}</>}
        {receiptLink && <> <a href={receiptLink.href} target="_blank" rel="noopener noreferrer">{receiptLink.label}</a></>}
      </li>; })}</ul>
      {(targets.statusUpdates.pending || targets.statusUpdates.error) && <p role="status">{targets.statusUpdates.error || 'Processing uploads are checked automatically while this page is open.'}</p>}
      <button type="button" className="btn btn-ghost btn-sm" disabled={targets.statusUpdates.syncing} onClick={targets.statusUpdates.refresh}>{targets.statusUpdates.syncing ? 'Checking...' : 'Refresh results'}</button>
    </section>}
    {targets.loading && <p role="status">Loading connected accounts…</p>}
    {targets.error && <p role="alert">{targets.error} <button type="button" className="btn btn-ghost btn-sm" onClick={targets.retry}>Retry</button></p>}
    <Link to="/connected-accounts" target="_blank" rel="noopener noreferrer" aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}
      onClick={event => { event.preventDefault(); if (!disabled) openAccountWorkspace('/connected-accounts'); }}
      style={{ display: 'inline-block', marginTop: 10, fontSize: '.8rem' }}>Manage connected accounts</Link>
  </fieldset>;
}

