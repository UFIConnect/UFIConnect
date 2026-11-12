import { useEffect, useRef, useState } from 'react';
import { createWatchClock, mediaHistoryKey, playbackMeasurementAllowed } from '../media/watchTime.mjs';
import { watchHistoryStore, WATCH_CHANGED, WATCH_STORE_PREFIX } from '../media/watchHistory.mjs';
import { reportEngagementSignal } from '../api/engagement';
import { subscribeTelemetryPrivacy, telemetrySuppressed } from '../analytics/telemetryPrivacy.mjs';
import useYouTubeMeasurementStatus from './useYouTubeMeasurementStatus';
import { getAccessToken } from '../auth/session';

// One measured player per account in this application document. New playback
// takes ownership; an older still-mounted slide cannot also accrue time.
const owners = new Map();

export default function useMediaWatchSession(options) {
  const madeForKids = useYouTubeMeasurementStatus({ accountId: options.accountId, videoId: options.providerMediaId,
    enabled: options.playbackSource === 'youtube' && options.enabled });
  const measurement = options.playbackSource === 'youtube' ? { ...options,
    trackingAllowed: options.trackingAllowed !== false && madeForKids === false && options.privacyClassification !== 'made_for_kids',
    privacyClassification: madeForKids === false ? 'not_made_for_kids' : madeForKids === true ? 'made_for_kids' : 'unknown' } : options;
  const latest = useRef(options);
  latest.current = measurement;
  const identity = JSON.stringify([options.accountId, options.mediaId, options.surface, options.playbackSource, options.hostSource]);
  const [snapshot, setSnapshot] = useState({ identity: '', watchedMs: 0 });
  useEffect(() => {
    const initial = latest.current;
    if (!initial.accountId || !initial.mediaId) return;
    const owner = {}, clock = createWatchClock(), store = watchHistoryStore(), token = getAccessToken();
    let pending = 0, storedOnce = false, wasPlaying = false, lastFlush = performance.now(), cancelled = false, cleared = false;
    let saving = false;
    const flush = () => {
      if (saving || pending <= 0 || cleared) return;
      const current = latest.current;
      if (current.accountId !== initial.accountId || getAccessToken() !== token || telemetrySuppressed() || !store.read(initial.accountId).enabled
        || (current.mediaId === initial.mediaId && !playbackMeasurementAllowed(current))) { pending = 0; return; }
      saving = true;
      const delta = pending;
      if (store.append(initial.accountId, { ...initial, source: initial.playbackSource, watchMs: delta, newSession: !storedOnce })) {
        pending -= delta; storedOnce = true;
        // Existing source-affinity endpoint receives measured time only. It is
        // not a creator ledger, a provider view endpoint, or a payment service.
        if (token && getAccessToken() === token && !telemetrySuppressed() && initial.postId) reportEngagementSignal({
          postId: initial.postId, source: initial.hostSource || initial.playbackSource, topic: initial.topic, watchMs: Math.round(delta),
        });
      }
      saving = false;
    };
    function sample() {
      if (cancelled || cleared) return;
      const current = latest.current;
      const allowed = getAccessToken() === token && current.accountId === initial.accountId && current.mediaId === initial.mediaId
        && current.enabled && current.playing && !document.hidden && !telemetrySuppressed()
        && playbackMeasurementAllowed(current) && store.read(initial.accountId).enabled;
      if (allowed && (!wasPlaying || !owners.has(initial.accountId))) owners.set(initial.accountId, owner);
      if (!allowed && owners.get(initial.accountId) === owner) owners.delete(initial.accountId);
      wasPlaying = Boolean(allowed);
      const delta = clock.sample({ now: performance.now(), position: current.currentTime, rate: current.rate ?? 1,
        playing: Boolean(allowed && owners.get(initial.accountId) === owner), seeking: current.seeking === true });
      pending = Math.min(60000, pending + delta);
      if (delta) setSnapshot({ identity, watchedMs: clock.watchedMs });
      if (!allowed || performance.now() - lastFlush >= 5000) { flush(); lastFlush = performance.now(); }
    }
    const reset = () => { clock.reset(); sample(); flush(); };
    const clear = () => { cleared = true; pending = 0; clock.reset(); if (owners.get(initial.accountId) === owner) owners.delete(initial.accountId); };
    const historyChanged = event => {
      if (saving || event.detail?.accountId !== initial.accountId) return;
      const detail = event.detail;
      if (!['clear', 'remove', 'disable'].includes(detail.operation)) return;
      if (detail.operation === 'remove' && detail.mediaKey !== mediaHistoryKey(`${initial.playbackSource}:${initial.postId || ''}:${initial.mediaId || ''}`)) return;
      // Clear/remove/disable cannot be undone by a later pending session flush.
      pending = 0; clock.reset(); storedOnce = false;
    };
    const storageChanged = event => {
      if (event.key !== null && event.key !== WATCH_STORE_PREFIX + encodeURIComponent(initial.accountId)) return;
      pending = 0; clock.reset(); storedOnce = false;
    };
    const timer = setInterval(sample, 250);
    document.addEventListener('visibilitychange', reset);
    window.addEventListener('pagehide', reset);
    window.addEventListener('ufi-session-cleared', clear);
    window.addEventListener(WATCH_CHANGED, historyChanged);
    window.addEventListener('storage', storageChanged);
    const unsubscribe = subscribeTelemetryPrivacy(reset);
    sample();
    return () => {
      sample(); flush(); cancelled = true; clearInterval(timer); unsubscribe();
      document.removeEventListener('visibilitychange', reset);
      window.removeEventListener('pagehide', reset);
      window.removeEventListener('ufi-session-cleared', clear);
      window.removeEventListener(WATCH_CHANGED, historyChanged);
      window.removeEventListener('storage', storageChanged);
      if (owners.get(initial.accountId) === owner) owners.delete(initial.accountId);
    };
  }, [identity]);
  return { watchedMs: snapshot.identity === identity ? snapshot.watchedMs : 0 };
}
