import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { MAX_FIX_AGE_MS, readLocationFix } from './focus-geofence.mjs';
import { liveMovementFix, movementProfile } from './focus-movement.mjs';
import { assessTrackingFix } from './focus-tracking.mjs';
import { createVisibleOfficePoller } from './office-polling.mjs';

const UPDATE_MS = 3500;
const EMPTY = [];
const retryDelay = failures => Math.min(30000, UPDATE_MS * 2 ** Math.min(4, failures));
function responseError(response) {
  const error = new Error(`HTTP ${response.status}`);
  error.status = response.status;
  return error;
}
function failureMessage(error) {
  if (error?.status === 401 || error?.status === 403) return `Office access was denied (HTTP ${error.status}). Check your Office sign-in.`;
  if (error?.status === 429) return 'Office is limiting updates (HTTP 429). Retrying more slowly.';
  if (error?.status) return `Office returned HTTP ${error.status}. Retrying with backoff.`;
  return navigator.onLine === false ? 'Device reports offline. Shared GPS will retry after reconnection.'
    : 'No Office response was received. The network failure’s cause is unavailable. Retrying with backoff.';
}

export default function useFocusLiveDevices(transport, tracking) {
  const request = transport?.request;
  const url = transport?.url;
  const [viewing, setViewing] = useState(false);
  const [sources, setSources] = useState(EMPTY);
  const [viewError, setViewError] = useState('');
  const [sharing, setSharing] = useState('');
  const [shareError, setShareError] = useState('');
  const [connection, setConnection] = useState(null);
  const session = useRef(null);
  const generation = useRef(0);
  const canShare = tracking.enabled && tracking.visible;
  const recordDiagnostic = tracking.recordDiagnostic;
  const observeResponse = useCallback((response, started) => {
    const time = Date.now();
    setConnection(current => ({ status: response.status, attemptedAt: time,
      latency: Math.max(0, Math.round(performance.now() - started)),
      successAt: response.ok ? time : current?.successAt ?? null }));
  }, []);
  const observeFailure = useCallback((error, context) => {
    const message = failureMessage(error);
    recordDiagnostic?.(error?.status ? `OFFICE_HTTP_${error.status}` : 'OFFICE_NETWORK_ERROR', `${context}: ${message}`);
    if (!error?.status) setConnection(current => ({ ...current, status: null, attemptedAt: Date.now(), latency: null }));
    return message;
  }, [recordDiagnostic]);

  const revoke = useCallback(record => {
    if (!record?.id || !request) return;
    void request(`${url}/${record.id}`, { method: 'DELETE', keepalive: true,
      headers: { 'x-focus-publisher': record.publisher } }).catch(() => {});
  }, [request, url]);

  const stopSharing = useCallback(() => {
    generation.current++;
    const record = session.current;
    session.current = null;
    record?.controller.abort();
    revoke(record);
    setSharing('');
    if (record) recordDiagnostic?.('SHARING_STOPPED', 'Local publishing stopped and revocation was requested. If Office is unreachable, the last shared fix expires within 25 seconds. Restart sharing explicitly when visible.');
  }, [revoke, recordDiagnostic]);

  useEffect(() => () => {
    generation.current++;
    session.current?.controller.abort();
    revoke(session.current);
    session.current = null;
  }, [revoke]);

  useEffect(() => {
    if (canShare) return;
    stopSharing();
  }, [canShare, stopSharing]);

  async function share(profile) {
    if (!request || !canShare || session.current || sharing) return;
    const attempt = ++generation.current;
    setSharing('Starting…');
    setShareError('');
    try {
      const started = performance.now();
      const response = await request(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile ? { name: profile.name, kind: profile.kind, type: profile.type } :
          { name: 'Office phone', kind: 'phone' }),
        signal: AbortSignal.timeout(7000),
      });
      if (generation.current !== attempt) return;
      observeResponse(response, started);
      if (!response.ok) throw responseError(response);
      const result = await response.json();
      const record = { ...result, controller: new AbortController(), lastSent: null, sending: false, failures: 0, retryAt: 0 };
      if (generation.current !== attempt) { revoke(record); return; }
      session.current = record;
      setSharing('Waiting for GPS');
      recordDiagnostic?.('SHARING_STARTED', 'Location sharing was explicitly enabled for this Office session.');
    } catch (error) {
      if (generation.current !== attempt) return;
      setSharing('');
      setShareError(observeFailure(error, 'Start sharing'));
    }
  }

  const publish = useEffectEvent(async () => {
    const record = session.current;
    const fix = tracking.liveFix;
    const time = Date.now();
    if (!record || record.sending || !canShare || document.hidden) return;
    if (navigator.onLine === false || time < record.retryAt) return;
    if (!liveMovementFix(fix, time) || fix.accuracy > 5000) {
      setSharing('Waiting for GPS');
      return;
    }
    if (fix.timestamp === record.lastSent) return;
    record.sending = true;
    try {
      const started = performance.now();
      const { latitude, longitude, accuracy, speed, heading } = fix;
      const response = await request(`${url}/${record.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-focus-publisher': record.publisher },
        body: JSON.stringify({ latitude, longitude, accuracy, speed, heading, age: Math.max(0, time - fix.timestamp) }),
        signal: AbortSignal.any([record.controller.signal, AbortSignal.timeout(5000)]),
      });
      if (session.current !== record) return;
      observeResponse(response, started);
      if (response.status === 404 || response.status === 401 || response.status === 423) {
        stopSharing();
        setShareError('The sharing session ended. Start sharing again to reconnect.');
        recordDiagnostic?.('SHARING_SESSION_ENDED', `Office returned HTTP ${response.status}. Renew sharing to reconnect.`);
        return;
      }
      if (!response.ok) throw responseError(response);
      if (record.failures) recordDiagnostic?.('SHARING_RECOVERED', 'Office accepted a fresh GPS update after reconnection.');
      record.failures = 0;
      record.retryAt = 0;
      record.lastSent = fix.timestamp;
      setSharing('Sharing live GPS');
      setShareError('');
    } catch (error) {
      if (session.current === record) {
        record.retryAt = Date.now() + retryDelay(record.failures++);
        setShareError(observeFailure(error, 'Publish shared GPS'));
      }
    } finally {
      record.sending = false;
    }
  });

  const publishing = Boolean(sharing);
  useEffect(() => {
    if (!publishing || !request) return undefined;
    void publish();
    const timer = setInterval(() => void publish(), UPDATE_MS);
    const reconnect = () => { if (session.current) session.current.retryAt = 0; void publish(); };
    window.addEventListener('online', reconnect);
    return () => { clearInterval(timer); window.removeEventListener('online', reconnect); };
  }, [publishing, request]);

  useEffect(() => {
    if (!request || !viewing) return undefined;
    let failures = 0;
    const poller = createVisibleOfficePoller({ intervalMs: () => failures ? retryDelay(failures - 1) : UPDATE_MS,
      onError: error => {
        failures++;
        // A transient network failure must not erase a still-fresh observation.
        setSources(current => error?.status === 401 || error?.status === 403 ? EMPTY
          : current.filter(source => liveMovementFix(source.fix, Date.now())));
        setViewError(observeFailure(error, 'Load shared devices'));
      },
      async task({ signal }) {
        const started = performance.now();
        const response = await request(url, { cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(7000)]) });
        if (signal.aborted) return;
        observeResponse(response, started);
        if (!response.ok) throw responseError(response);
        const { sources: list } = await response.json();
        if (signal.aborted) return;
        const now = Date.now();
        const latency = Math.max(0, Math.round(performance.now() - started));
        if (!Array.isArray(list)) throw new Error();
        if (failures) recordDiagnostic?.('OFFICE_SYNC_RECOVERED', 'Office returned a fresh shared-device list after reconnection.');
        failures = 0;
        setViewError('');
        setSources(current => list.slice(0, 40).flatMap(source => {
          const profile = movementProfile(source);
          const age = source?.fix?.age + latency;
          if (!profile || !Number.isFinite(age) || age < 0 || age >= MAX_FIX_AGE_MS || !Number.isFinite(source.observedAt)) return [];
          const marker = current.find(item => item.id === profile.id && item.observedAt === source.observedAt);
          const fix = marker?.fix ?? readLocationFix({ coords: source.fix, timestamp: now - age }, now);
          const previous = current.find(item => item.id === profile.id);
          const quality = assessTrackingFix(marker ? null : previous?.fix, fix, 5000, now);
          if (quality) return previous && liveMovementFix(previous.fix, now)
            ? [{ ...previous, signalNotice: `Shared GPS reading rejected (${quality}). The last accepted observation is shown until it expires.` }] : [];
          return liveMovementFix(fix, now) ? [{ ...profile, fix, observedAt: source.observedAt,
            firstSharedAt: source.firstSharedAt }] : [];
        }));
      },
    });
    const reconnect = () => { failures = 0; poller.refresh(); };
    window.addEventListener('online', reconnect);
    return () => { poller.stop(); window.removeEventListener('online', reconnect); };
  }, [request, url, viewing, recordDiagnostic, observeFailure, observeResponse]);

  const expiresAt = Math.min(...sources.map(source => source.fix.timestamp + MAX_FIX_AGE_MS));
  useEffect(() => {
    if (!Number.isFinite(expiresAt)) return undefined;
    const timer = setTimeout(() => setSources(current => current.filter(source => liveMovementFix(source.fix, Date.now()))),
      Math.max(0, expiresAt - Date.now() + 1));
    return () => clearTimeout(timer);
  }, [expiresAt]);

  const rejectedSource = sources.find(source => source.signalNotice);
  useEffect(() => {
    if (rejectedSource) recordDiagnostic?.('SHARED_GPS_REJECTED', rejectedSource.signalNotice);
  }, [rejectedSource?.id, rejectedSource?.signalNotice, recordDiagnostic]);

  return {
    available: Boolean(request), viewing, sources, viewError, sharing, shareError, canShare, connection,
    startViewing: () => { setViewing(true); setViewError(''); },
    stopViewing: () => { setViewing(false); setSources(EMPTY); setViewError(''); },
    share, stopSharing,
  };
}
