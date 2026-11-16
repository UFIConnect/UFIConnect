import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { advanceFence, advanceZoneFences, checkFence, clearFenceCandidate, EMPTY_FENCE, fenceProfile, MAX_FIX_AGE_MS } from './focus-geofence.mjs';

export default function useFocusGeofence(settings, focusOpen, onBoundary) {
  const [requested, setRequested] = useState(false);
  const [reading, setReading] = useState(null);
  const [events, setEvents] = useState([]);
  const session = useRef(null);
  const selected = settings.zones.find(zone => zone.id === settings.activeZoneId);

  // Keep the confirmed side when names, actions, or background preferences change.
  const { scope, seconds } = settings.fence;
  const { maxAccuracy, buffer, highAccuracy } = fenceProfile(settings.fence);
  const key = JSON.stringify(settings.zones.filter(zone => zone.enabled
    && (scope !== 'selected' || zone.id === settings.activeZoneId))
    .map(({ id, center, radius }) => ({ id, center, radius })).sort((a, b) => a.id.localeCompare(b.id)));
  const config = useMemo(() => ({ monitored: JSON.parse(key), profile: { maxAccuracy, buffer, highAccuracy },
    scope, dwellMs: seconds * 1000 }), [key, maxAccuracy, buffer, highAccuracy, scope, seconds]);
  const { monitored } = config;
  const active = requested && monitored.length > 0;
  const enabled = active && (focusOpen || settings.fence.background);

  const clearReading = useCallback(() => {
    setReading(null);
    const running = session.current;
    if (!running) return;
    running.area = clearFenceCandidate(running.area);
    for (const [id, state] of running.zones) {
      running.zones.set(id, clearFenceCandidate(state));
    }
  }, []);

  const stop = useCallback(() => {
    session.current = null;
    setReading(null);
    setRequested(false);
  }, []);

  useEffect(() => { if (!monitored.length) stop(); }, [monitored.length, stop]);
  useEffect(() => { if (!enabled) clearReading(); }, [enabled, clearReading]);

  function acceptFix(fix) {
    if (!enabled) return;
    if (session.current?.config !== config) {
      session.current = { config, area: EMPTY_FENCE, zones: new Map() };
    }
    const running = session.current;
    if (fix.timestamp <= running.area.timestamp) return;
    // An expired or interrupted signal requires a fresh dwell before a crossing.
    if (Date.now() - running.area.timestamp >= MAX_FIX_AGE_MS) clearReading();
    const measured = checkFence(monitored, fix, config.profile);
    const result = advanceFence(running.area, measured.relation, fix.timestamp, config.dwellMs);
    const zones = advanceZoneFences(running.zones, measured.measurements, fix.timestamp, config.dwellMs);
    running.zones = zones.states;
    running.area = result.state;
    setReading({ config, status: {
      relation: measured.relation, measurements: zones.readings, fix, checking: running.area.candidate,
    } });

    const transitions = scope === 'individual' ? zones.transitions
      : result.transition ? [{ type: result.transition, zoneId: scope === 'selected' ? monitored[0].id : null }] : [];
    if (transitions.length) {
      setEvents(previous => [...transitions.map(event => ({ ...event, at: fix.timestamp })), ...previous].slice(0, 8));
      onBoundary(transitions);
    }
  }

  return {
    active, enabled, selected, monitoredCount: monitored.length, events, highAccuracy,
    status: enabled && reading?.config === config ? reading.status : null,
    start: () => setRequested(true), stop, acceptFix, clearReading, clearEvents: () => setEvents([]),
  };
}
