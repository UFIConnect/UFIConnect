import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { locationOptions, MAX_FIX_AGE_MS, measureLocation, readLocationFix } from './focus-geofence.mjs';
import { appendRouteFix, trackingFixGap, trackingProfile } from './focus-tracking.mjs';
import { appendWalkFix, createWalk, interruptWalk } from './focus-walk.mjs';
import useFocusGeofence from './useFocusGeofence';

export function locationMessage(error) {
  if (error?.code === 1) return 'Location access is blocked. Check location permissions for this site.';
  if (error?.code === 3) return 'Waiting for a fresh location fix. Try again with a clearer signal.';
  return 'Location is unavailable. Check that your device’s location services are on.';
}

export default function useFocusLocation(settings, focusOpen) {
  const monitor = useFocusGeofence(settings, focusOpen);
  const preferences = settings.tracking;
  const profile = trackingProfile(preferences);
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [fix, setFix] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [permissionError, setPermissionError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [points, setPoints] = useState([]);
  const [waypoints, setWaypoints] = useState([]);
  const [distance, setDistance] = useState(0);
  const [deadline, setDeadline] = useState(null);
  const [notice, setNotice] = useState('');
  const [walk, setWalk] = useState(null);
  const [walkFix, setWalkFix] = useState(null);
  const refreshLocation = useRef(null);
  const captureRequest = useRef(0);
  const segment = useRef(0);
  const tripDistance = useRef({ last: null, lastSeenAt: null, meters: 0 });

  const trackEnabled = active && !paused && (focusOpen || preferences.background);
  const walkEnabled = focusOpen && walk?.phase === 'walking';
  const supported = Boolean(window.isSecureContext && navigator.geolocation);
  const watching = supported && visible && (trackEnabled || monitor.enabled || walkEnabled);
  const highAccuracy = Boolean(walkEnabled || (trackEnabled && profile.highAccuracy) || (monitor.enabled && monitor.highAccuracy));
  const timeoutMs = monitor.enabled || walkEnabled ? 12000 : preferences.timeoutSeconds * 1000;
  const intervalMs = Math.min(
    trackEnabled && preferences.interval ? preferences.interval * 1000 : Infinity,
    monitor.enabled ? monitor.highAccuracy ? 6500 : 12000 : Infinity,
    walkEnabled ? 5000 : Infinity,
  );

  const stop = useCallback((message = '') => {
    captureRequest.current++;
    setActive(false);
    setPaused(false);
    setNotice(typeof message === 'string' ? message : '');
    setFix(null);
    setSnapshot(null);
    setRecording(false);
    setCapturing(false);
    setDeadline(null);
    tripDistance.current.last = null;
    tripDistance.current.lastSeenAt = null;
    segment.current++;
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      setVisible(!document.hidden);
      if (document.hidden) setWalk(current => interruptWalk(current, 'hidden'));
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (trackEnabled) return;
    setFix(null);
    tripDistance.current.last = null;
    tripDistance.current.lastSeenAt = null;
  }, [trackEnabled]);
  useEffect(() => {
    if (focusOpen && visible) return;
    setWalk(current => interruptWalk(current, 'hidden'));
    captureRequest.current++;
    setCapturing(false);
    setSnapshot(null);
  }, [focusOpen, visible]);
  useEffect(() => {
    if (deadline === null) return undefined;
    const timer = window.setTimeout(() => stop('Geo Tracking stopped at the time limit.'), Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [deadline, stop]);

  const receive = useEffectEvent(reading => {
    monitor.acceptFix(reading);
    if (walkEnabled && reading.timestamp >= walk.startedAt) {
      setWalkFix(reading);
      setWalk(current => appendWalkFix(current, reading));
    }
    if (!trackEnabled) return;
    setFix(reading);
    if (reading.accuracy > profile.maxAccuracy) return;
    const traveled = tripDistance.current;
    const gap = traveled.lastSeenAt === null || reading.timestamp - traveled.lastSeenAt >= trackingFixGap(preferences);
    traveled.lastSeenAt = reading.timestamp;
    if (gap) {
      segment.current++;
      traveled.last = null;
    }
    if (recording) {
      const routeSegment = segment.current;
      setPoints(current => appendRouteFix(current, reading, preferences, routeSegment));
    }
    const last = traveled.last;
    if (!last) {
      traveled.last = reading;
    } else {
      const change = measureLocation(last, reading, 0).distance;
      if (change > Math.max(2, last.accuracy + reading.accuracy)) {
        traveled.last = reading;
        traveled.meters += change;
        setDistance(traveled.meters);
      }
    }
    if (preferences.stopMeters > 0 && traveled.meters >= preferences.stopMeters) {
      stop('Geo Tracking stopped at the distance limit.');
    }
  });
  const clearReading = useEffectEvent((breakTrip = true) => {
    setFix(null);
    setWalkFix(null);
    if (breakTrip) {
      tripDistance.current.last = null;
      tripDistance.current.lastSeenAt = null;
    }
    monitor.clearReading();
  });
  const onDenied = useEffectEvent(failure => {
    setPermissionError(locationMessage(failure));
    setWalk(current => interruptWalk(current, 'permission'));
    stop();
    monitor.stop();
  });

  useEffect(() => {
    clearReading();
    setError('');
    setRefreshing(false);
    if (!watching) return undefined;

    const device = navigator.geolocation;
    const options = locationOptions(highAccuracy, timeoutMs);
    let live = true;
    let watchId;
    let expires;
    let pending = false;
    let lastTimestamp = -Infinity;

    function clear() {
      live = false;
      window.clearTimeout(expires);
      if (watchId !== undefined) device.clearWatch(watchId);
      watchId = undefined;
      refreshLocation.current = null;
    }

    function expire(message, breakTrip = true) {
      clearReading(breakTrip);
      setError(message);
    }

    function update(position) {
      if (!live || document.hidden) return;
      const fresh = readLocationFix(position, Date.now());
      if (!fresh || fresh.timestamp <= lastTimestamp) return;
      lastTimestamp = fresh.timestamp;
      setError('');
      receive(fresh);
      window.clearTimeout(expires);
      expires = window.setTimeout(() => {
        expire('The last location fix expired. Waiting for a new reading.', false);
      }, Math.max(0, fresh.timestamp + MAX_FIX_AGE_MS - Date.now()));
    }

    function fail(failure) {
      if (!live) return;
      if (failure?.code === 1) {
        clear();
        clearReading();
        setRefreshing(false);
        onDenied(failure);
      } else if (!document.hidden && Date.now() - lastTimestamp >= MAX_FIX_AGE_MS) {
        expire(locationMessage(failure));
      }
    }

    function probe(manual = false) {
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
      } catch (failure) {
        finish(fail, failure);
      }
    }

    refreshLocation.current = probe;
    try {
      watchId = device.watchPosition(update, fail, options);
    } catch (failure) {
      fail(failure);
    }
    return clear;
  }, [watching, highAccuracy, timeoutMs]);

  useEffect(() => {
    if (!watching || !Number.isFinite(intervalMs)) return undefined;
    // A fresh confirmation may be needed even when the device is stationary.
    const timer = window.setInterval(() => refreshLocation.current?.(), intervalMs);
    return () => window.clearInterval(timer);
  }, [watching, intervalMs]);

  function canStart() {
    setPermissionError(supported ? '' : 'Open this page over HTTPS in a browser with location access.');
    return supported;
  }

  function start(minutes) {
    if (active || !canStart()) return;
    captureRequest.current++;
    setCapturing(false);
    setSnapshot(null);
    setNotice('');
    setPaused(false);
    setDistance(0);
    tripDistance.current = { last: null, lastSeenAt: null, meters: 0 };
    const limit = Number.isFinite(minutes) ? minutes : preferences.stopMinutes;
    setDeadline(limit > 0 ? Date.now() + limit * 60000 : null);
    setActive(true);
  }

  function captureOnce() {
    if (capturing || document.hidden || !canStart()) return;
    const request = ++captureRequest.current;
    setCapturing(true);
    setSnapshot(null);
    const finish = (position, failure) => {
      if (captureRequest.current !== request || document.hidden) return;
      setCapturing(false);
      const result = readLocationFix(position, Date.now());
      setSnapshot(result);
      if (!result) setPermissionError(locationMessage(failure ?? { code: 3 }));
    };
    try {
      navigator.geolocation.getCurrentPosition(value => finish(value), error => finish(null, error),
        locationOptions(profile.highAccuracy, preferences.timeoutSeconds * 1000));
    } catch (error) { finish(null, error); }
  }

  const display = visible ? trackEnabled && fix ? fix : snapshot : null;
  const shared = { visible, refreshing, refresh: () => refreshLocation.current?.(true) };
  return {
    walk: {
      state: walk,
      fix: walkEnabled && visible ? walkFix : null,
      error: permissionError || (walkEnabled ? error : ''),
      open: mode => setWalk(current => current ?? createWalk(mode)),
      setPin: pin => setWalk(current => current?.phase === 'ready' || current?.phase === 'walking' && !current.points.length
        ? { ...current, pin, signal: '' } : current),
      resume: () => {
        if (!focusOpen || document.hidden || !canStart()) return;
        setWalkFix(null);
        const startedAt = Date.now();
        setWalk(current => current && ['ready', 'paused', 'review'].includes(current.phase) && current.signal !== 'limit'
          ? { ...current, phase: 'walking', startedAt, lastFix: null, signal: '' } : current);
      },
      pause: () => setWalk(current => interruptWalk(current, '')),
      finish: () => setWalk(current => current?.points.length ? { ...current, phase: 'review', signal: '' } : current),
      discard: () => setWalk(null),
    },
    tracking: {
      ...shared, active, paused, recording, capturing, notice, deadline, distance, points, waypoints,
      error: permissionError || (visible && trackEnabled ? error : ''),
      fix: display, captureOnce, start, stop,
      clearSnapshot: () => setSnapshot(null),
      pause: () => {
        setPaused(true);
        tripDistance.current.last = null;
        tripDistance.current.lastSeenAt = null;
      },
      resume: () => setPaused(false),
      toggleRecording: () => { segment.current++; setRecording(value => !value); },
      clearRoute: () => { setPoints([]); setWaypoints([]); segment.current++; },
      addWaypoint: (name, note = '') => {
        if (!display || Date.now() - display.timestamp >= MAX_FIX_AGE_MS) return false;
        setWaypoints(current => [...current.slice(-49), {
          ...display, id: crypto.randomUUID(), name: name.trim().slice(0, 80) || 'Waypoint ' + (current.length + 1),
          note: note.trim().slice(0, 160),
        }]);
        return true;
      },
    },
    monitor: {
      ...monitor,
      ...shared,
      error: permissionError || (visible && monitor.enabled ? error : ''),
      status: visible ? monitor.status : null,
      start: () => { if (monitor.monitoredCount && canStart()) monitor.start(); },
    },
  };
}
