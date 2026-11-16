import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { locationOptions, MAX_FIX_AGE_MS, readLocationFix } from './focus-geofence.mjs';
import useFocusGeofence from './useFocusGeofence';

export function locationMessage(error) {
  if (error?.code === 1) return 'Location access is blocked. Check location permissions for this site.';
  if (error?.code === 3) return 'Waiting for a fresh location fix. Try again with a clearer signal.';
  return 'Location is unavailable. Check that your device’s location services are on.';
}

export default function useFocusLocation(settings, focusOpen, onBoundary) {
  const monitor = useFocusGeofence(settings, focusOpen, onBoundary);
  const [tracking, setTracking] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [fix, setFix] = useState(null);
  const [error, setError] = useState('');
  const [permissionError, setPermissionError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const refreshLocation = useRef(null);
  const trackEnabled = tracking && (focusOpen || settings.tracking.background);
  const supported = Boolean(window.isSecureContext && navigator.geolocation);
  const watching = supported && visible && (trackEnabled || monitor.enabled);
  const { highAccuracy } = monitor;

  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => { if (!trackEnabled) setFix(null); }, [trackEnabled]);

  const receive = useEffectEvent(fix => {
    if (trackEnabled) setFix(fix);
    monitor.acceptFix(fix);
  });
  const clearReading = useEffectEvent(() => {
    setFix(null);
    monitor.clearReading();
  });
  const onDenied = useEffectEvent(failure => {
    setPermissionError(locationMessage(failure));
    setTracking(false);
    monitor.stop();
  });

  useEffect(() => {
    clearReading();
    setError('');
    setRefreshing(false);
    if (!watching) return undefined;

    const device = navigator.geolocation;
    const options = locationOptions(highAccuracy);
    let live = true;
    let watchId;
    let interval;
    let expires;
    let pending = false;
    let lastTimestamp = -Infinity;

    function clear() {
      live = false;
      window.clearInterval(interval);
      window.clearTimeout(expires);
      if (watchId !== undefined) device.clearWatch(watchId);
      watchId = undefined;
      refreshLocation.current = null;
    }

    function expire(message) {
      clearReading();
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
        expire('The last location fix expired. Waiting for a new reading.');
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

    // A fresh fix also confirms a dwell when the device is stationary.
    interval = window.setInterval(probe, highAccuracy ? 6500 : 12000);
    refreshLocation.current = () => probe(true);
    try {
      watchId = device.watchPosition(update, fail, options);
    } catch (failure) {
      fail(failure);
    }
    return clear;
  }, [watching, highAccuracy]);

  function canStart() {
    setPermissionError(supported ? '' : 'Open this page over HTTPS in a browser with location access.');
    return supported;
  }

  const location = { visible, refreshing, refresh: () => refreshLocation.current?.() };
  return {
    tracking: {
      ...location,
      active: tracking,
      error: permissionError || (visible && trackEnabled ? error : ''),
      fix: visible && trackEnabled ? fix : null,
      start: () => { if (canStart()) setTracking(true); },
      stop: () => { setTracking(false); setFix(null); },
    },
    monitor: {
      ...monitor,
      ...location,
      error: permissionError || (visible && monitor.enabled ? error : ''),
      status: visible ? monitor.status : null,
      start: () => { if (monitor.monitoredCount && canStart()) monitor.start(); },
    },
  };
}
