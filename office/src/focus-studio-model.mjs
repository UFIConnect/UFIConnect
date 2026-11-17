import { FENCE_CUSTOM_FIELDS, FENCE_PROFILES, MAX_SURFACE_DISTANCE_METERS, validCenter, zoneGeometry, zoneSchedule, ZONE_SHAPES } from './focus-geofence.mjs';
import { readTrackingSettings } from './focus-tracking.mjs';

export const MIN_RADIUS = 1;
export const DEFAULT_RADIUS = 250;
export const FOCUS_STORAGE_KEY = 'ufi-office-focus-v1';

const LEGACY_FOCUS_ACTIONS = new Set([
  'start', 'resume', 'startWithSound', 'pauseTimer', 'pause', 'resetTimer', 'bodyReset', 'endReset',
  'playSound', 'stopSound', 'muteSound', 'unmuteSound', 'duckSound', 'holdSound', 'restoreSound', 'quietOff', 'quiet',
]);
export const ENTRY_ACTIONS = [
  { id: 'status', label: 'Show status', priority: 0 },
  { id: 'stopTracking', label: 'Stop Geofencing', priority: 8 },
];
export const EXIT_ACTIONS = ENTRY_ACTIONS;
const OPTIONAL_ACTIONS = [{ id: 'off', label: 'Off', priority: -1 }, ...ENTRY_ACTIONS];
export const RULE_ACTIONS = { enter: ENTRY_ACTIONS, exit: EXIT_ACTIONS, stay: OPTIONAL_ACTIONS, approach: OPTIONAL_ACTIONS };
export const FENCE_TIMING = {
  exitSeconds: { min: 2, max: 120, initial: 8 },
  staySeconds: { min: 10, max: 3600, initial: 120 },
  approachMeters: { min: 10, max: 5000, initial: 100 },
  cooldownSeconds: { min: 0, max: 3600, initial: 0 },
};
export const ZONE_OVERRIDE_FIELDS = {
  maxAccuracy: FENCE_CUSTOM_FIELDS.maxAccuracy,
  buffer: FENCE_CUSTOM_FIELDS.buffer,
  enterSeconds: FENCE_TIMING.exitSeconds,
  ...FENCE_TIMING,
};

export const FENCE_SCOPES = [
  { id: 'selected', label: 'Selected zone' }, { id: 'all', label: 'All enabled zones together' },
  { id: 'individual', label: 'Each zone separately' },
];

function storedAction(type, action, fallback) {
  if (RULE_ACTIONS[type].some(item => item.id === action)) return action;
  return LEGACY_FOCUS_ACTIONS.has(action) ? 'status' : fallback;
}

export function boundaryRule(settings, { type, zoneId }) {
  const zone = settings.zones.find(zone => zone.id === zoneId);
  const action = zone?.rules?.[type] ?? settings.fence[type];
  const choices = RULE_ACTIONS[type];
  const { id, label, priority } = choices.find(item => item.id === action) ?? choices[0];
  return { type, zoneId, action: id, label, priority, zonePriority: zone?.priority ?? 0, area: zone ? zoneLabel(zone) : 'the monitored area' };
}

export function chooseBoundaryRule(settings, events) {
  const score = ({ priority, zonePriority, type }) =>
    20 * zonePriority + 2 * priority + (type === 'exit' ? 1 : 0);
  return events.map(event => boundaryRule(settings, event))
    .reduce((chosen, rule) => score(rule) > score(chosen) ? rule : chosen);
}

function boundedInteger(value, { min, max }, fallback) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}

const RADIUS_RANGES = [[MIN_RADIUS, 20, 1], [25, 45, 5], [50, 1000, 25], [1100, 5000, 100],
  [5500, 20000, 500], [21000, 50000, 1000], [55000, 200000, 5000], [210000, 500000, 10000],
  [550000, 1000000, 50000], [1100000, 2000000, 100000], [2500000, 5000000, 500000],
  [6000000, 10000000, 1000000], [12000000, 20000000, 2000000]];
export const RADIUS_VALUES = [
  ...RADIUS_RANGES.flatMap(([start, end, step]) =>
    Array.from({ length: (end - start) / step + 1 }, (_, index) => start + index * step)),
  Math.ceil(MAX_SURFACE_DISTANCE_METERS),
];

export function radiusIndex(value) {
  if (value >= RADIUS_VALUES.at(-1)) return RADIUS_VALUES.length - 1;
  return RADIUS_VALUES.reduce((best, radius, index) =>
    Math.abs(radius - value) < Math.abs(RADIUS_VALUES[best] - value) ? index : best, 0);
}

export function roundRadius(value) {
  return Math.max(MIN_RADIUS, Math.round(value));
}

export function radiusLabel(radius) {
  if (radius < 1000) return `${radius.toLocaleString()} m`;
  const kilometers = radius / 1000;
  return `${kilometers >= 1e9 ? kilometers.toExponential(2) : kilometers.toLocaleString()} km`;
}

export function coordinateLabel({ latitude, longitude }) {
  const format = (value, positive, negative) => `${Math.abs(value).toFixed(6)}° ${value < 0 ? negative : positive}`;
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

export function readFocusZones(input) {
  const seen = new Set();
  return Array.isArray(input) ? input.flatMap(zone => {
    if (typeof zone?.id !== 'string' || !zone.id || seen.has(zone.id)
      || !validCenter(zone.center) || !Number.isFinite(zone.radius)) return [];
    const shape = ZONE_SHAPES.some(item => item.id === zone.shape) ? zone.shape : 'circle';
    const vertices = Array.isArray(zone.vertices) ? zone.vertices.slice(0, 100).filter(validCenter)
      .map(({ latitude, longitude, accuracy }) => ({ latitude, longitude, accuracy })) : [];
    if (shape !== 'circle' && !zoneGeometry({ shape, vertices })) return [];
    seen.add(zone.id);
    const { latitude, longitude, accuracy } = zone.center;
    const rules = Object.fromEntries(Object.keys(RULE_ACTIONS).flatMap(type => {
      const action = storedAction(type, zone.rules?.[type]);
      return action ? [[type, action]] : [];
    }));
    const overrides = Object.fromEntries(Object.entries(ZONE_OVERRIDE_FIELDS).flatMap(([field, limits]) =>
      Number.isFinite(zone.overrides?.[field]) ? [[field, boundedInteger(zone.overrides[field], limits, limits.initial)]] : []));
    return [{ id: zone.id, name: typeof zone.name === 'string' ? zone.name.trim().slice(0, 64) : '',
      center: { latitude, longitude, accuracy }, radius: roundRadius(zone.radius), enabled: zone.enabled !== false, rules,
      ...(shape !== 'circle' && { shape, vertices }),
      ...(zone.exclude === true && { exclude: true }),
      ...(zone.overrides && Object.keys(overrides).length && { overrides }),
      ...(zone.schedule && { schedule: zoneSchedule(zone.schedule) }),
      ...(Number.isFinite(zone.until) && zone.until > 0 && { until: zone.until }),
      ...(Number.isFinite(zone.snoozedUntil) && zone.snoozedUntil > 0 && { snoozedUntil: zone.snoozedUntil }),
      ...(typeof zone.group === 'string' && zone.group.trim() && { group: zone.group.trim().slice(0, 40) }),
      ...(Number.isInteger(zone.priority) && { priority: Math.max(0, Math.min(9, zone.priority)) }),
    }];
  }) : [];
}

export function readFocusSettings(storage) {
  const stored = getStored(storage);
  let zones = readFocusZones(stored?.zones);
  if (!Array.isArray(stored?.zones) && validCenter(stored?.center)) {
    const { latitude, longitude, accuracy } = stored.center;
    zones = [{ id: 'original-zone', name: 'Focus zone', center: { latitude, longitude, accuracy },
      radius: Number.isFinite(stored.radius) ? roundRadius(stored.radius) : DEFAULT_RADIUS, enabled: true }];
  }
  const activeZoneId = zones.find(zone => zone.id === stored?.activeZoneId)?.id ?? zones[0]?.id ?? null;
  const fence = stored?.fence;
  const profile = Object.hasOwn(FENCE_PROFILES, fence?.profile) ? fence.profile : 'balanced';
  const custom = FENCE_PROFILES.custom;
  return {
    mapMode: stored?.mapMode === 'flat' ? 'flat' : 'globe',
    streets: stored?.streets !== false,
    zones, activeZoneId,
    radius: Number.isFinite(stored?.radius) ? roundRadius(stored.radius) : DEFAULT_RADIUS,
    tracking: readTrackingSettings(stored?.tracking),
    fence: {
      background: fence?.background === true,
      scope: FENCE_SCOPES.some(item => item.id === fence?.scope) ? fence.scope : 'selected',
      profile,
      seconds: Number.isFinite(fence?.seconds) ? Math.min(30, Math.max(2, Math.round(fence.seconds)))
        : FENCE_PROFILES[profile].defaultSeconds,
      custom: {
        maxAccuracy: boundedInteger(fence?.custom?.maxAccuracy, FENCE_CUSTOM_FIELDS.maxAccuracy, custom.maxAccuracy),
        buffer: boundedInteger(fence?.custom?.buffer, FENCE_CUSTOM_FIELDS.buffer, custom.buffer),
        highAccuracy: fence?.custom?.highAccuracy !== false,
      },
      enter: storedAction('enter', fence?.enter, 'status'),
      exit: storedAction('exit', fence?.exit, 'status'),
      stay: storedAction('stay', fence?.stay, 'off'),
      approach: storedAction('approach', fence?.approach, 'off'),
      ...Object.fromEntries(Object.entries(FENCE_TIMING).map(([field, limits]) =>
        [field, boundedInteger(fence?.[field], limits, limits.initial)])),
      separateExit: fence?.separateExit === true,
      fireOnStart: fence?.fireOnStart === true,
      combination: fence?.combination === 'every' ? 'every' : 'any',
      group: typeof fence?.group === 'string' ? fence.group.slice(0, 40) : '',
      notify: fence?.notify === true,
    },
  };
}

export function saveFocusSettings(settings) {
  try { localStorage.setItem(FOCUS_STORAGE_KEY, JSON.stringify(settings)); } catch { /* Use in-memory preferences. */ }
}

export function clockText(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(safe / 60).toString().padStart(2, '0')}:${(safe % 60).toString().padStart(2, '0')}`;
}
