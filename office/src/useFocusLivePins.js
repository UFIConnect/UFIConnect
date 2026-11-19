import { useEffect, useReducer, useState } from 'react';
import { LIVE_PIN_LIMIT, LIVE_PIN_STORAGE_KEY, livePinTargets, nextPinExpiry, readLivePins, resolveLivePin } from './focus-live-pins.mjs';

function readBindings() {
  try { return readLivePins(JSON.parse(localStorage.getItem(LIVE_PIN_STORAGE_KEY))); }
  catch { return []; }
}

export default function useFocusLivePins(tracking, devices) {
  const [bindings, setBindings] = useState(readBindings);
  const [selectedId, setSelectedId] = useState('');
  const [followRequest, setFollowRequest] = useState(0);
  const [storageError, setStorageError] = useState(false);
  const [, expire] = useReducer(value => value + 1, 0);
  const now = Date.now();
  const targets = livePinTargets(tracking, devices, now);
  const pins = bindings.map(pin => resolveLivePin(pin, targets, tracking, devices, now));
  const expiry = nextPinExpiry(targets, now);

  useEffect(() => {
    try {
      localStorage.setItem(LIVE_PIN_STORAGE_KEY, JSON.stringify(bindings));
      setStorageError(false);
    } catch { setStorageError(true); }
  }, [bindings]);
  useEffect(() => {
    if (!Number.isFinite(expiry)) return undefined;
    const timer = setTimeout(expire, Math.max(0, expiry - Date.now() + 1));
    return () => clearTimeout(timer);
  }, [expiry]);

  function follow(id) {
    setSelectedId(id);
    setFollowRequest(value => value + 1);
  }
  function attach(sourceId) {
    const target = targets.find(source => source.id === sourceId && source.fix);
    if (!target) return false;
    const previous = bindings.find(pin => pin.sourceId === sourceId);
    if (!previous && bindings.length >= LIVE_PIN_LIMIT) return false;
    const id = previous?.id ?? crypto.randomUUID();
    setBindings(current => previous ? current.map(pin => pin.id === id ? { ...pin, paused: false } : pin)
      : [...current, { id, sourceId, name: target.name, paused: false }]);
    follow(id);
    tracking.recordDiagnostic('LIVE_PIN_ATTACHED', 'A live pin was attached to a selected, fresh GPS source.');
    return true;
  }
  function pause(id, paused) {
    setBindings(current => current.map(pin => pin.id === id ? { ...pin, paused } : pin));
    if (!paused) follow(id);
  }
  return { pins, targets, attach, pause, follow, selectedId, followRequest, storageError,
    selected: pins.find(pin => pin.id === selectedId),
    clearFollow: () => follow(''),
    remove(id) {
      setBindings(current => current.filter(pin => pin.id !== id));
      if (selectedId === id) follow('');
    },
  };
}
