import { FENCE_CUSTOM_FIELDS, FENCE_PROFILES, MAX_SURFACE_DISTANCE_METERS, validCenter } from './focus-geofence.mjs';

export const MIN_RADIUS = 1;
export const DEFAULT_RADIUS = 250;
export const FOCUS_STORAGE_KEY = 'ufi-office-focus-v1';

export const DURATIONS = [15, 25, 45, 60];
export const SCENE_IDS = ['rain', 'orbit', 'train', 'coast'];
const ZONE_ACTIONS = [
  { id: 'status', label: 'Show status', priority: 0 },
  { id: 'start', label: 'Start or resume timer', priority: 3 },
  { id: 'resume', label: 'Resume timer', priority: 3 },
  { id: 'startWithSound', label: 'Start or resume timer with soundscape', priority: 3 },
  { id: 'pauseTimer', label: 'Pause timer only', priority: 8 },
  { id: 'pause', label: 'Pause timer and sound', priority: 9 },
  { id: 'resetTimer', label: 'Reset timer', priority: 8 },
  { id: 'bodyReset', label: 'Start a one-minute reset', priority: 8 },
  { id: 'endReset', label: 'End body reset', priority: 1 },
  { id: 'playSound', label: 'Play the soundscape', priority: 2 },
  { id: 'stopSound', label: 'Stop soundscape', priority: 7 },
  { id: 'muteSound', label: 'Mute the soundscape', priority: 6 },
  { id: 'unmuteSound', label: 'Unmute the soundscape', priority: 2 },
  { id: 'duckSound', label: 'Duck the soundscape briefly', priority: 4 },
  { id: 'holdSound', label: 'Hold soundscape ducking', priority: 5 },
  { id: 'restoreSound', label: 'Restore soundscape volume', priority: 2 },
  { id: 'quietOff', label: 'Turn off Quiet Mode', priority: 1 },
  { id: 'stopTracking', label: 'Stop Geofencing', priority: 8 },
];
export const ENTRY_ACTIONS = [
  ...ZONE_ACTIONS, { id: 'quiet', label: 'Turn on Quiet Mode', priority: 10 },
];
export const EXIT_ACTIONS = [
  ...ZONE_ACTIONS, { id: 'quiet', label: 'Pause and turn on Quiet Mode', priority: 10 },
];

export const FENCE_SCOPES = [
  { id: 'selected', label: 'Selected zone' }, { id: 'all', label: 'All enabled zones together' },
  { id: 'individual', label: 'Each zone separately' },
];

export const AUDIO_MODES = [
  { id: 'mix', label: 'Mix with Other Apps' }, { id: 'exclusive', label: 'Do Not Mix' },
  { id: 'duck', label: 'Duck Other Apps' },
];

export function audioSessionType({ mode, silent }) {
  if (mode === 'exclusive') return silent ? 'playback' : 'transient-solo';
  return mode === 'duck' ? 'transient' : 'ambient';
}

export function boundaryRule(settings, { type, zoneId }) {
  const zone = settings.zones.find(zone => zone.id === zoneId);
  const action = zone?.rules?.[type] ?? settings.fence[type];
  const choices = type === 'enter' ? ENTRY_ACTIONS : EXIT_ACTIONS;
  const { id, label, priority } = choices.find(item => item.id === action) ?? choices[0];
  return { type, action: id, label, priority, area: zone ? zoneLabel(zone) : 'the monitored area' };
}

export function chooseBoundaryRule(settings, events) {
  const score = ({ priority, type }) => 2 * priority + (type === 'exit' ? 1 : 0);
  return events.map(event => boundaryRule(settings, event))
    .reduce((chosen, rule) => score(rule) > score(chosen) ? rule : chosen);
}

export const DUCK_FIELDS = {
  attackMs: { initial: 180, min: 0, max: 5000 },
  holdMs: { initial: 900, min: 0, max: 15000 },
  releaseMs: { initial: 400, min: 0, max: 5000 },
  level: { initial: 30, min: 0, max: 100 },
};
export const DUCK_PRESETS = [
  { name: 'Quick dip', attackMs: 60, holdMs: 200, releaseMs: 180, level: 45 },
  { name: 'Gentle', attackMs: 300, holdMs: 800, releaseMs: 800, level: 55 },
  { name: 'Balanced', attackMs: 180, holdMs: 900, releaseMs: 400, level: 30 },
  { name: 'Deep', attackMs: 80, holdMs: 1200, releaseMs: 650, level: 5 },
  { name: 'Soft return', attackMs: 250, holdMs: 1600, releaseMs: 2200, level: 25 },
  { name: 'Full mute', attackMs: 0, holdMs: 900, releaseMs: 400, level: 0 },
];

export function matchesDuckingPreset(settings, preset) {
  return Object.keys(DUCK_FIELDS).every(field => preset[field] === settings[field]);
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
    const rules = {};
    if (ENTRY_ACTIONS.some(item => item.id === zone.rules?.enter)) rules.enter = zone.rules.enter;
    if (EXIT_ACTIONS.some(item => item.id === zone.rules?.exit)) rules.exit = zone.rules.exit;
    return [{ id: zone.id, name: typeof zone.name === 'string' ? zone.name.trim().slice(0, 64) : '',
      center: { latitude, longitude, accuracy }, radius: roundRadius(zone.radius), enabled: zone.enabled !== false, rules }];
  }) : [];
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
    minutes: DURATIONS.includes(stored?.minutes) ? stored.minutes : 25,
    volume: Number.isFinite(stored?.volume) ? Math.min(1, Math.max(0, stored.volume)) : 0.35,
    muted: stored?.muted === true,
    quiet: stored?.quiet === true,
    scene: SCENE_IDS.includes(stored?.scene) ? stored.scene : 'rain',
    sessionAmbience: stored?.sessionAmbience === true,
    audio: {
      enabled: stored?.audio?.enabled !== false,
      mode: AUDIO_MODES.some(item => item.id === stored?.audio?.mode) ? stored.audio.mode : 'mix',
      silent: stored?.audio?.silent === true,
    },
    zones, activeZoneId,
    radius: Number.isFinite(stored?.radius) ? roundRadius(stored.radius) : DEFAULT_RADIUS,
    tracking: { background: stored?.tracking?.background === true },
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
      enter: ENTRY_ACTIONS.some(item => item.id === fence?.enter) ? fence.enter : 'status',
      exit: EXIT_ACTIONS.some(item => item.id === fence?.exit) ? fence.exit : stored?.pauseOnExit === false ? 'status' : 'pause',
    },
    bodyReminders: stored?.bodyReminders !== false,
    duck: { ...Object.fromEntries(Object.entries(DUCK_FIELDS).map(([field, limits]) =>
      [field, boundedInteger(stored?.duck?.[field], limits, limits.initial)])),
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
