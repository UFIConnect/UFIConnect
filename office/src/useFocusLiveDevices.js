import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { MAX_FIX_AGE_MS } from './focus-geofence.mjs';
import { liveMovementFix, movementProfile } from './focus-movement.mjs';
import { createVisibleOfficePoller } from './office-polling.mjs';

const UPDATE_MS = 3500;
const EMPTY = [];

export default function useFocusLiveDevices(transport, tracking) {
  const request = transport?.request;
  const url = transport?.url;
  const [viewing, setViewing] = useState(false);
  const [sources, setSources] = useState(EMPTY);
  const [viewError, setViewError] = useState('');
  const [sharing, setSharing] = useState('');
  const [shareError, setShareError] = useState('');
  const session = useRef(null);
  const generation = useRef(0);
  const canShare = tracking.enabled && tracking.visible;

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
  }, [revoke]);

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
      const response = await request(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile ? { name: profile.name, kind: profile.kind, type: profile.type } :
          { name: 'Office phone', kind: 'phone' }),
      });
      if (!response.ok) throw new Error();
      const result = await response.json();
      const record = { ...result, controller: new AbortController(), lastSent: null, sending: false };
      if (generation.current !== attempt) { revoke(record); return; }
      session.current = record;
      setSharing('Waiting for GPS');
    } catch {
      if (generation.current !== attempt) return;
      setSharing('');
      setShareError('Could not start location sharing. Check your Office connection.');
    }
  }

  const publish = useEffectEvent(async () => {
    const record = session.current;
    const fix = tracking.liveFix;
    const time = Date.now();
    if (!record || record.sending || !canShare || document.hidden) return;
    if (!liveMovementFix(fix, time) || fix.accuracy > 5000) {
      setSharing('Waiting for GPS');
      return;
    }
    if (fix.timestamp === record.lastSent) return;
    record.sending = true;
    try {
      const { latitude, longitude, accuracy, speed, heading } = fix;
      const response = await request(`${url}/${record.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-focus-publisher': record.publisher },
        body: JSON.stringify({ latitude, longitude, accuracy, speed, heading, age: Math.max(0, time - fix.timestamp) }),
        signal: AbortSignal.any([record.controller.signal, AbortSignal.timeout(5000)]),
      });
      if (session.current !== record) return;
      if (response.status === 404 || response.status === 401 || response.status === 423) {
        stopSharing();
        setShareError('The sharing session ended. Start sharing again to reconnect.');
        return;
      }
      if (!response.ok) throw new Error();
      record.lastSent = fix.timestamp;
      setSharing('Sharing live GPS');
      setShareError('');
    } catch {
      if (session.current === record) setShareError('Live sharing is reconnecting.');
    } finally {
      record.sending = false;
    }
  });

  const publishing = Boolean(sharing);
  useEffect(() => {
    if (!publishing || !request) return undefined;
    void publish();
    const timer = setInterval(() => void publish(), UPDATE_MS);
    return () => clearInterval(timer);
  }, [publishing, request]);

  useEffect(() => {
    if (!request || !viewing) return undefined;
    const poller = createVisibleOfficePoller({ intervalMs: UPDATE_MS,
      onError: () => { setSources(EMPTY); setViewError('Could not load live devices. Retrying while Office is open.'); },
      async task({ signal }) {
        const started = performance.now();
        const response = await request(url, { cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(7000)]) });
        if (!response.ok) throw new Error();
        const { sources: list } = await response.json();
        if (signal.aborted) return;
        const now = Date.now();
        const latency = Math.max(0, Math.round(performance.now() - started));
        if (!Array.isArray(list)) throw new Error();
        setViewError('');
        setSources(current => list.slice(0, 40).flatMap(source => {
          const profile = movementProfile(source);
          const age = source?.fix?.age + latency;
          if (!profile || !Number.isFinite(age) || age < 0 || age >= MAX_FIX_AGE_MS || !Number.isFinite(source.observedAt)) return [];
          const marker = current.find(item => item.id === profile.id && item.observedAt === source.observedAt);
          const fix = marker?.fix ?? { ...source.fix, timestamp: now - age };
          return liveMovementFix(fix, now) ? [{ ...profile, fix, observedAt: source.observedAt }] : [];
        }));
      },
    });
    return poller.stop;
  }, [request, url, viewing]);

  return {
    available: Boolean(request), viewing, sources, viewError, sharing, shareError, canShare,
    startViewing: () => { setViewing(true); setViewError(''); },
    stopViewing: () => { setViewing(false); setSources(EMPTY); setViewError(''); },
    share, stopSharing,
  };
}
