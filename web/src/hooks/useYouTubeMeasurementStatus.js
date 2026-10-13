import { useEffect, useRef, useState } from 'react';
import client from '../api/client';
import { watchHistoryStore, WATCH_CHANGED } from '../media/watchHistory.mjs';
import { subscribeTelemetryPrivacy, telemetrySuppressed } from '../analytics/telemetryPrivacy.mjs';

// Public audience classification is resolved server-side. A post's own fields,
// client input, a guessed default, or a stale response cannot enable tracking.
export default function useYouTubeMeasurementStatus({ accountId, videoId, enabled }) {
  const identity = JSON.stringify([accountId, videoId]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    if (!accountId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId || '') || !enabled) return;
    let controller, refresh, version = 0, stopped = false;
    const schedule = delay => { clearTimeout(refresh); refresh = setTimeout(resolve, Math.max(1000, Math.min(15 * 60000, delay))); };
    async function resolve() {
      clearTimeout(refresh);
      controller?.abort();
      const generation = ++version;
      if (stopped || document.hidden || telemetrySuppressed() || !watchHistoryStore().read(accountId).enabled) return;
      setSnapshot(null);
      controller = new AbortController();
      try {
        const { data } = await client.get('/creator-analytics/playback-status', { params: { videoId }, signal: controller.signal, timeout: 12000 });
        if (stopped || generation !== version || currentIdentity.current !== identity || data?.videoId !== videoId) return;
        const checkedAt = Date.parse(data.checkedAt);
        const fresh = Number.isFinite(checkedAt) && checkedAt <= Date.now() + 60000 && checkedAt + 15 * 60000 > Date.now();
        const madeForKids = data.status === 'available' && fresh && typeof data.madeForKids === 'boolean' ? data.madeForKids : null;
        const expiresAt = Math.min(Date.now() + 15 * 60000, checkedAt + 15 * 60000);
        setSnapshot({ identity, madeForKids, expiresAt });
        schedule(madeForKids === null ? 60000 : expiresAt - Date.now() + 100);
      } catch {
        // Unknown audience never enables history or source-affinity tracking.
        if (!stopped && generation === version) schedule(60000);
      }
    }
    const changed = event => { if (event.detail?.accountId === accountId && ['enable', 'disable'].includes(event.detail.operation)) void resolve(); };
    const clear = () => { stopped = true; version++; controller?.abort(); setSnapshot(null); };
    void resolve();
    document.addEventListener('visibilitychange', resolve);
    window.addEventListener(WATCH_CHANGED, changed);
    window.addEventListener('ufi-session-cleared', clear);
    const unsubscribe = subscribeTelemetryPrivacy(resolve);
    return () => {
      stopped = true; version++; controller?.abort(); clearTimeout(refresh); unsubscribe();
      document.removeEventListener('visibilitychange', resolve);
      window.removeEventListener(WATCH_CHANGED, changed);
      window.removeEventListener('ufi-session-cleared', clear);
    };
  }, [identity, enabled]);
  return snapshot?.identity === identity && snapshot.expiresAt > Date.now() ? snapshot.madeForKids : null;
}
