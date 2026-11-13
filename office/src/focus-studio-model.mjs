import { FENCE_PROFILES, validCenter } from './focus-geofence.mjs';

export const MIN_RADIUS = 50;
export const MAX_RADIUS = 500000;
export const DEFAULT_RADIUS = 250;
export const FOCUS_STORAGE_KEY = 'ufi-office-focus-v1';

export const DURATIONS = [15, 25, 45, 60];
export const SCENE_IDS = ['rain', 'orbit', 'train', 'coast'];
export const ENTRY_ACTIONS = [
  { id: 'status', label: 'Show status' }, { id: 'resume', label: 'Resume timer' }, { id: 'quiet', label: 'Turn on Quiet Mode' },
];
export const EXIT_ACTIONS = [
  { id: 'status', label: 'Show status' }, { id: 'pause', label: 'Pause timer and sound' }, { id: 'quiet', label: 'Pause and turn on Quiet Mode' },
];

export const DUCK_FIELDS = {
  attackMs: { initial: 180, min: 0, max: 3000, step: 10 },
  holdMs: { initial: 900, min: 100, max: 5000, step: 10 },
  releaseMs: { initial: 400, min: 0, max: 3000, step: 10 },
  level: { initial: 30, min: 5, max: 90, step: 1 },
};

export function duckValue(field, value) {
  const { initial, min, max } = DUCK_FIELDS[field];
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : initial;
}

const RADIUS_RANGES = [[MIN_RADIUS, 1000, 25], [1100, 5000, 100], [5500, 20000, 500],
  [21000, 50000, 1000], [55000, 200000, 5000], [210000, MAX_RADIUS, 10000]];
export const RADIUS_VALUES = RADIUS_RANGES.flatMap(([start, end, step]) =>
  Array.from({ length: (end - start) / step + 1 }, (_, index) => start + index * step));

export function radiusIndex(value) {
  return RADIUS_VALUES.reduce((best, radius, index) =>
    Math.abs(radius - value) < Math.abs(RADIUS_VALUES[best] - value) ? index : best, 0);
}

export function roundRadius(value) {
  return RADIUS_VALUES[radiusIndex(value)];
}

export function radiusLabel(radius) {
  return radius < 1000 ? `${radius.toLocaleString()} m` : `${(radius / 1000).toLocaleString()} km`;
}

export function coordinateLabel({ latitude, longitude }) {
  const format = (value, positive, negative) => `${Math.abs(value).toFixed(4)}° ${value < 0 ? negative : positive}`;
  return `${format(latitude, 'N', 'S')} · ${format(longitude, 'E', 'W')}`;
}

export function zoneLabel(zone) {
  return zone.name || coordinateLabel(zone.center);
}

export function nextZoneName(zones, base = 'Focus zone') {
  const names = new Set(zones.map(zone => zone.name));
  if (!names.has(base)) return base;
  let number = 2;
  while (names.has(`${base} ${number}`)) number++;
  return `${base} ${number}`;
}

function getStored(storage) {
  try { return JSON.parse((storage ?? globalThis.localStorage).getItem(FOCUS_STORAGE_KEY)); }
  catch { return null; }
}

export function readQuietMode() {
  return getStored()?.quiet === true;
}

export function readFocusSettings(storage) {
  const stored = getStored(storage);
  const seen = new Set();
  let zones = Array.isArray(stored?.zones) ? stored.zones.flatMap(zone => {
    if (typeof zone?.id !== 'string' || !zone.id || seen.has(zone.id)
      || !validCenter(zone.center) || !Number.isFinite(zone.radius)) return [];
    seen.add(zone.id);
    const { latitude, longitude, accuracy } = zone.center;
    return [{ id: zone.id, name: typeof zone.name === 'string' ? zone.name.trim().slice(0, 64) : '',
      center: { latitude, longitude, accuracy }, radius: roundRadius(zone.radius), enabled: zone.enabled !== false }];
  }) : [];
  if (!Array.isArray(stored?.zones) && validCenter(stored?.center)) {
    const { latitude, longitude, accuracy } = stored.center;
    zones = [{ id: 'original-zone', name: 'Focus zone', center: { latitude, longitude, accuracy },
      radius: Number.isFinite(stored.radius) ? roundRadius(stored.radius) : DEFAULT_RADIUS, enabled: true }];
  }
  const activeZoneId = zones.find(zone => zone.id === stored?.activeZoneId)?.id ?? zones[0]?.id ?? null;
  const fence = stored?.fence;
  return {
    minutes: DURATIONS.includes(stored?.minutes) ? stored.minutes : 25,
    volume: Number.isFinite(stored?.volume) ? Math.min(1, Math.max(0, stored.volume)) : 0.35,
    muted: stored?.muted === true,
    quiet: stored?.quiet === true,
    scene: SCENE_IDS.includes(stored?.scene) ? stored.scene : 'rain',
    sessionAmbience: stored?.sessionAmbience === true,
    zones, activeZoneId,
    radius: Number.isFinite(stored?.radius) ? roundRadius(stored.radius) : DEFAULT_RADIUS,
    fence: {
      scope: fence?.scope === 'all' ? 'all' : 'selected',
      profile: fence?.profile === 'strict' ? 'strict' : 'balanced',
      seconds: Number.isFinite(fence?.seconds) ? Math.min(30, Math.max(2, Math.round(fence.seconds)))
        : FENCE_PROFILES[fence?.profile === 'strict' ? 'strict' : 'balanced'].defaultSeconds,
      enter: ENTRY_ACTIONS.some(item => item.id === fence?.enter) ? fence.enter : 'status',
      exit: EXIT_ACTIONS.some(item => item.id === fence?.exit) ? fence.exit : stored?.pauseOnExit === false ? 'status' : 'pause',
    },
    bodyReminders: stored?.bodyReminders !== false,
    duck: { ...Object.fromEntries(Object.keys(DUCK_FIELDS).map(field => [field, duckValue(field, stored?.duck?.[field])])),
      pip: stored?.duck?.pip === true },
  };
}

export function saveFocusSettings(settings) {
  try { localStorage.setItem(FOCUS_STORAGE_KEY, JSON.stringify(settings)); } catch { /* Use in-memory preferences. */ }
}

export function clockText(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(safe / 60).toString().padStart(2, '0')}:${(safe % 60).toString().padStart(2, '0')}`;
}
