import { useEffect, useMemo, useRef, useState } from 'react';
import { advanceFence, checkFence, EMPTY_FENCE, FENCE_PROFILES, MAX_FIX_AGE_MS, readLocationFix } from './focus-geofence.mjs';

export const LOCATION_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 };
const PROBE_MS = 6500;

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
  const [event, setEvent] = useState(null);
  const [permissionError, setPermissionError] = useState('');
  const watched = useRef(null);
  const boundary = useRef(onBoundary);
  boundary.current = onBoundary;
  const selected = settings.zones.find(zone => zone.id === settings.activeZoneId);
  // The watch depends on boundary geometry, so renaming a zone leaves monitoring active.
  const key = JSON.stringify(settings.zones.filter(zone => zone.enabled
    && (settings.fence.scope === 'all' || zone.id === settings.activeZoneId))
    .map(({ id, center, radius }) => ({ id, center, radius })).sort((a, b) => a.id.localeCompare(b.id)));
  const monitored = useMemo(() => JSON.parse(key), [key]);
  const options = settings.fence;
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
    if (!monitored.length && requested) setRequested(false);
    if (!active || !visible) return undefined;
    let live = true;
    let machine = EMPTY_FENCE;
    let watchId;
    let pending = false;
    let expires;
    let lastGood = 0;
    const device = navigator.geolocation;
    const update = position => {
      if (!live || document.hidden) return;
      const fix = readLocationFix(position, Date.now());
      if (!fix || fix.timestamp <= machine.timestamp) return;
      lastGood = Date.now();
      const measured = checkFence(monitored, fix, FENCE_PROFILES[options.profile]);
      const result = advanceFence(machine, measured.relation, fix.timestamp, options.seconds * 1000);
      machine = result.state;
      setError('');
      setStatus({ ...measured, accuracy: fix.accuracy, confirmed: machine.confirmed, checking: machine.candidate });
      window.clearTimeout(expires);
      expires = window.setTimeout(() => {
        if (!live) return;
        machine = { ...EMPTY_FENCE, timestamp: machine.timestamp };
        setStatus(null);
        setError('The last location fix expired. Waiting for a new reading.');
      }, Math.max(0, fix.timestamp + MAX_FIX_AGE_MS - lastGood));
      if (result.transition) {
        setEvent({ type: result.transition, at: lastGood });
        boundary.current(result.transition);
      }
    };
    const fail = failure => {
      if (!live || document.hidden) return;
      if (failure?.code === 1) {
        live = false;
        setPermissionError(locationMessage(failure));
        setRequested(false);
        return;
      }
      if (Date.now() - lastGood > MAX_FIX_AGE_MS) setError(locationMessage(failure));
    };
    const probe = () => {
      if (!live || pending || document.hidden) return;
      pending = true;
      const finish = (callback, result) => { pending = false; callback(result); };
      try {
        device.getCurrentPosition(position => finish(update, position), failure => finish(fail, failure), LOCATION_OPTIONS);
      } catch (failure) { finish(fail, failure); }
    };
    try {
      watchId = device.watchPosition(update, fail, LOCATION_OPTIONS);
    } catch (failure) { fail(failure); }
    const timer = window.setInterval(probe, PROBE_MS);
    const clear = () => {
      live = false;
      window.clearInterval(timer);
      window.clearTimeout(expires);
      if (watchId !== undefined) { device.clearWatch(watchId); watchId = undefined; }
    };
    watched.current = clear;
    return () => { clear(); if (watched.current === clear) watched.current = null; };
  }, [active, visible, requested, monitored, options.profile, options.seconds]);

  // Permission errors can arrive after a stop state commits. Keep them visible
  // separately from transient monitoring status until the user retries.
  function start() {
    setEvent(null);
    if (!supported) { setPermissionError('Open this page over HTTPS in a browser with location access.'); return; }
    setPermissionError('');
    setRequested(true);
  }

  function stop() {
    watched.current?.();
    setRequested(false);
    setEvent(null);
    setPermissionError('');
  }

  return { active, visible, selected, monitoredCount: monitored.length, status, event, error: permissionError || error, start, stop };
}
