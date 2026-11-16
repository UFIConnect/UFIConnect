import { useEffect, useMemo, useRef, useState } from 'react';
import { advanceFence, advanceZoneFences, checkFence, clearFenceCandidate, EMPTY_FENCE, fenceProfile, locationOptions, MAX_FIX_AGE_MS, readLocationFix } from './focus-geofence.mjs';

export function locationMessage(error) {
  if (error?.code === 1) return 'Location access is blocked. Check location permissions for this site.';
  if (error?.code === 3) return 'Waiting for a fresh location fix. Try again with a clearer signal.';
  return 'Location is unavailable. Check that your device’s location services are on.';
}

export default function useFocusGeofence(settings, onBoundary) {
  const [requested, setRequested] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [events, setEvents] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  const watcher = useRef(null);
  const session = useRef(null);
  const boundary = useRef(onBoundary);
  boundary.current = onBoundary;
  const selected = settings.zones.find(zone => zone.id === settings.activeZoneId);
  // The watch depends on boundary geometry, so renaming a zone leaves monitoring active.
  const { scope, seconds } = settings.fence;
  const { maxAccuracy, buffer, highAccuracy } = fenceProfile(settings.fence);
  const key = JSON.stringify(settings.zones.filter(zone => zone.enabled
    && (scope !== 'selected' || zone.id === settings.activeZoneId))
    .map(({ id, center, radius }) => ({ id, center, radius })).sort((a, b) => a.id.localeCompare(b.id)));
  const config = useMemo(() => ({ monitored: JSON.parse(key), profile: { maxAccuracy, buffer, highAccuracy },
    scope, dwellMs: seconds * 1000 }), [key, maxAccuracy, buffer, highAccuracy, scope, seconds]);
  const { monitored } = config;
  const supported = Boolean(window.isSecureContext && navigator.geolocation);
  const active = requested && supported && monitored.length > 0;

  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    setStatus(null);
    setError('');
    setRefreshing(false);
    if (!active) {
      session.current = null;
      if (!config.monitored.length && requested) setRequested(false);
      return undefined;
    }
    if (session.current?.config !== config) {
      session.current = { config, area: EMPTY_FENCE, zones: new Map() };
    }
    if (!visible) return undefined;
    const running = session.current;
    let live = true;
    let watchId;
    let pending = false;
    let expires;
    const device = navigator.geolocation;
    const options = locationOptions(config.profile.highAccuracy);
    const clearPending = () => {
      running.area = clearFenceCandidate(running.area);
      for (const [id, state] of running.zones) {
        running.zones.set(id, clearFenceCandidate(state));
      }
    };
    const expireReading = message => {
      clearPending();
      setStatus(null);
      setError(message);
    };
    const update = position => {
      if (!live || document.hidden) return;
      const now = Date.now();
      const fix = readLocationFix(position, now);
      if (!fix || fix.timestamp <= running.area.timestamp) return;
      // A delayed expiry timer must not allow a pre-gap candidate to complete.
      if (now - running.area.timestamp >= MAX_FIX_AGE_MS) clearPending();
      const measured = checkFence(config.monitored, fix, config.profile);
      const result = advanceFence(running.area, measured.relation, fix.timestamp, config.dwellMs);
      const zones = advanceZoneFences(running.zones, measured.measurements, fix.timestamp, config.dwellMs);
      running.zones = zones.states;
      running.area = result.state;
      setError('');
      setStatus({ relation: measured.relation, measurements: zones.readings, fix, checking: running.area.candidate });
      window.clearTimeout(expires);
      expires = window.setTimeout(() => {
        if (!live || running.area.timestamp !== fix.timestamp) return;
        expireReading('The last location fix expired. Waiting for a new reading.');
      }, Math.max(0, fix.timestamp + MAX_FIX_AGE_MS - Date.now()));
      const transitions = config.scope === 'individual' ? zones.transitions
        : result.transition ? [{ type: result.transition, zoneId: config.scope === 'selected' ? config.monitored[0].id : null }] : [];
      if (transitions.length) {
        setEvents(previous => [...transitions.map(event => ({ ...event, at: fix.timestamp })), ...previous].slice(0, 8));
        boundary.current(transitions);
      }
    };
    const fail = failure => {
      if (!live) return;
      if (failure?.code === 1) {
        live = false;
        session.current = null;
        setPermissionError(locationMessage(failure));
        setRequested(false);
        return;
      }
      if (!document.hidden && Date.now() - running.area.timestamp >= MAX_FIX_AGE_MS) {
        expireReading(locationMessage(failure));
      }
    };
    const probe = (manual = false) => {
      if (!live || document.hidden) return;
      if (manual) setRefreshing(true);
      if (pending) return;
      pending = true;
      const finish = (callback, result) => {
        pending = false;
        if (!live) return;
        setRefreshing(false);
        callback(result);
      };
      try {
        device.getCurrentPosition(position => finish(update, position), failure => finish(fail, failure), options);
      } catch (failure) { finish(fail, failure); }
    };
    try {
      watchId = device.watchPosition(update, fail, options);
    } catch (failure) { fail(failure); }
    const timer = window.setInterval(probe, config.profile.highAccuracy ? 6500 : 12000);
    const clear = () => {
      live = false;
      clearPending();
      window.clearInterval(timer);
      window.clearTimeout(expires);
      if (watchId !== undefined) { device.clearWatch(watchId); watchId = undefined; }
    };
    watcher.current = { clear, refresh: () => probe(true) };
    return () => { clear(); watcher.current = null; };
  }, [active, visible, requested, config]);

  // Permission errors can arrive after a stop state commits. Keep them visible
  // separately from transient monitoring status until the user retries.
  function start() {
    if (!supported) { setPermissionError('Open this page over HTTPS in a browser with location access.'); return; }
    setPermissionError('');
    setRequested(true);
  }

  function stop() {
    watcher.current?.clear();
    session.current = null;
    setRequested(false);
    setPermissionError('');
  }

  return { active, visible, selected, monitoredCount: monitored.length, status, events, refreshing,
    error: permissionError || error, start, stop, refresh: () => watcher.current?.refresh(), clearEvents: () => setEvents([]) };
}
