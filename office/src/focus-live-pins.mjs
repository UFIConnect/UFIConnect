import { MAX_FIX_AGE_MS } from './focus-geofence.mjs';
import { liveMovementFix } from './focus-movement.mjs';

export const LIVE_PIN_LIMIT = 20;
export const LOCAL_PIN_SOURCE = 'this-device';
export const LIVE_PIN_STORAGE_KEY = 'ufi-office-live-pins-v1';

export function readLivePins(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).slice(0, LIVE_PIN_LIMIT).flatMap(pin => {
    if (typeof pin?.id !== 'string' || !pin.id || typeof pin.sourceId !== 'string' || !pin.sourceId
      || seen.has(pin.id) || pin.id.length > 100 || pin.sourceId.length > 100) return [];
    seen.add(pin.id);
    // Restore bindings only. GPS and shared-device viewing still require explicit controls.
    return [{ id: pin.id, sourceId: pin.sourceId, name: String(pin.name || 'Live pin').slice(0, 80), paused: true }];
  });
}

export function livePinTargets(tracking, devices, now = Date.now()) {
  const local = tracking.active && !tracking.paused && tracking.visible
    && liveMovementFix(tracking.liveFix, now) ? tracking.liveFix : null;
  return [{ id: LOCAL_PIN_SOURCE, name: 'This device', fix: local },
    ...(devices.viewing && tracking.visible ? devices.sources : []).map(source => ({
      id: source.id, name: source.name,
      fix: liveMovementFix(source.fix, now) ? source.fix : null,
    }))];
}

export function resolveLivePin(pin, targets, tracking, devices, now = Date.now()) {
  const target = targets.find(source => source.id === pin.sourceId);
  let status = 'Live';
  if (pin.paused) status = 'Paused';
  else if (!tracking.visible) status = 'Page hidden';
  else if (pin.sourceId === LOCAL_PIN_SOURCE && !tracking.active) status = 'GPS off';
  else if (pin.sourceId === LOCAL_PIN_SOURCE && tracking.paused) status = 'GPS paused';
  else if (pin.sourceId !== LOCAL_PIN_SOURCE && !devices.viewing) status = 'Shared viewing off';
  else if (!liveMovementFix(target?.fix, now)) status = 'Waiting for fresh GPS';
  return { ...pin, status, fix: status === 'Live' ? target.fix : null,
    sourceName: target?.name ?? pin.name };
}

export function nextPinExpiry(targets, now = Date.now()) {
  return Math.min(...targets.flatMap(target => liveMovementFix(target.fix, now)
    ? [target.fix.timestamp + MAX_FIX_AGE_MS] : []));
}
