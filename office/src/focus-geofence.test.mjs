import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceFence, advanceZoneFences, checkFence, clearFenceCandidate, EMPTY_FENCE, FENCE_PROFILES, fenceProfile, locationOptions, MAX_FIX_AGE_MS, MAX_SURFACE_DISTANCE_METERS, measureLocation, readLocationFix } from './focus-geofence.mjs';
import { audioSessionType, boundaryRule, chooseBoundaryRule, DUCK_PRESETS, FOCUS_STORAGE_KEY, matchesDuckingPreset, RADIUS_VALUES, radiusIndex, readFocusSettings } from './focus-studio-model.mjs';

const point = (latitude, longitude, accuracy = 5) => ({ latitude, longitude, accuracy });
const a = { id: 'a', center: point(0, 179.99, 0), radius: 1500 };
const b = { id: 'b', center: point(0, -179.99, 0), radius: 1500 };

test('globe zones cross the date line and treat overlapping zones as one monitored area', () => {
  const fix = point(0, -180);
  const combined = checkFence([a, b], fix, FENCE_PROFILES.strict);
  assert.equal(combined.relation, 'inside');
  assert.ok(combined.measurements.every(value => value.distance > 1100 && value.distance < 1125));
  assert.equal(checkFence([a, b], point(0, -179.981), FENCE_PROFILES.strict).relation, 'inside');
  assert.equal(checkFence([a, b], point(0, -179.90), FENCE_PROFILES.strict).relation, 'outside');
});

test('boundary buffer and reported uncertainty block shaky transitions', () => {
  assert.equal(checkFence([a], point(0, 179.99, 80), FENCE_PROFILES.strict).relation, 'weak');
  assert.equal(checkFence([a], point(0, 179.99, 80), FENCE_PROFILES.balanced).relation, 'inside');
  const distance = measureLocation(a.center, point(0, 179.999), 1000).distance;
  assert.equal(measureLocation(a.center, point(0, 179.999), distance + 20, 25).relation, 'edge');
});

test('accuracy modes change both the accepted fix and the device request', () => {
  const raw = { fence: { profile: 'custom', custom: { maxAccuracy: 19, buffer: -50, highAccuracy: false } } };
  const { fence } = readFocusSettings({ getItem: () => JSON.stringify(raw) });
  const custom = fenceProfile(fence);
  assert.equal(custom.buffer, 0);
  assert.equal(custom.maxAccuracy, 19);
  assert.deepEqual(locationOptions(custom.highAccuracy), { enableHighAccuracy: false, maximumAge: 0, timeout: 12000 });
  assert.equal(locationOptions(FENCE_PROFILES.battery.highAccuracy).enableHighAccuracy, false);
  assert.equal(locationOptions(FENCE_PROFILES.precise.highAccuracy).enableHighAccuracy, true);
  const fix = point(0, 179.99, 19);
  assert.equal(checkFence([a], fix, FENCE_PROFILES.precise).relation, 'weak');
  assert.equal(checkFence([a], fix, custom).relation, 'inside');
  raw.fence.profile = '__proto__';
  assert.equal(readFocusSettings({ getItem: () => JSON.stringify(raw) }).fence.profile, 'balanced');
});

test('dwell needs two fresh readings, and ambiguity restarts confirmation', () => {
  let current = EMPTY_FENCE;
  const step = (relation, timestamp) => {
    const result = advanceFence(current, relation, timestamp, 8000);
    current = result.state;
    return result.transition;
  };
  assert.equal(step('inside', 1000), null);
  assert.equal(step('inside', 1000), null);
  assert.equal(step('inside', 9000), null);
  assert.equal(current.confirmed, 'inside');
  assert.equal(step('outside', 10000), null);
  assert.equal(step('edge', 15500), null);
  assert.equal(step('outside', 18000), null);
  assert.equal(step('outside', 25999), null);
  assert.equal(step('outside', 26000), 'exit');
  assert.equal(step('outside', 35000), null);
  assert.equal(step('inside', 36000), null);
  assert.equal(step('inside', 44000), 'enter');
});

test('location fixes must be recent and have finite coordinates and accuracy', () => {
  const now = 40000;
  assert.equal(readLocationFix(null, now), null);
  assert.equal(readLocationFix({ coords: point(0, 0), timestamp: now - MAX_FIX_AGE_MS }, now), null);
  assert.equal(readLocationFix({ coords: point(0, 0), timestamp: 10000 }, now), null);
  assert.equal(readLocationFix({ coords: point(0, 0), timestamp: 43000 }, now), null);
  assert.equal(readLocationFix({ coords: point(92, 0), timestamp: now }, now), null);
  assert.equal(readLocationFix({ coords: point(0, 0, -1), timestamp: now }, now), null);
  assert.equal(readLocationFix({ coords: point(0, 0), timestamp: now }, now).timestamp, now);
});

test('clearing an expired candidate preserves the confirmed side and rejects older callbacks', () => {
  const confirmed = { confirmed: 'inside', candidate: 'outside', since: 9000, timestamp: 11000 };
  const expired = clearFenceCandidate(confirmed);
  assert.deepEqual(expired, { confirmed: 'inside', candidate: null, since: 0, timestamp: 11000 });
  assert.equal(advanceFence(expired, 'outside', 10000, 2000).state, expired);
  const first = advanceFence(expired, 'outside', 41000, 2000);
  assert.equal(first.transition, null);
  assert.equal(advanceFence(first.state, 'outside', 43000, 2000).transition, 'exit');
  const sameSide = advanceFence(expired, 'inside', 41000, 2000);
  assert.equal(sameSide.transition, null);
  assert.equal(sameSide.state.candidate, null);
});

test('exact one-meter and uncapped radii survive storage and use spherical distance', () => {
  const small = { ...a, center: point(0, 0, 0), radius: 1 };
  const world = { ...b, center: point(0, 0, 0), radius: 30_000_001 };
  const storage = { getItem: () => JSON.stringify({ zones: [small, world], radius: 987_653 }) };
  const settings = readFocusSettings(storage);
  assert.deepEqual(settings.zones.map(zone => zone.radius), [1, 30_000_001]);
  assert.equal(settings.radius, 987_653);
  assert.equal(RADIUS_VALUES[0], 1);
  assert.equal(radiusIndex(Number.MAX_VALUE), RADIUS_VALUES.length - 1);
  assert.equal(checkFence([small], point(0, 0, 0.5), FENCE_PROFILES.balanced).relation, 'inside');
  assert.equal(checkFence([small], point(0, 0, 5), FENCE_PROFILES.balanced).relation, 'edge');
  assert.equal(checkFence([small], point(0, 0.00002, 0.5), FENCE_PROFILES.balanced).relation, 'outside');
  assert.equal(measureLocation(world.center, point(0, 180), MAX_SURFACE_DISTANCE_METERS, 25).relation, 'inside');
  assert.equal(checkFence([world], point(0, 180), FENCE_PROFILES.strict).relation, 'inside');
});

test('existing zones, audio preferences and exit actions survive the update', () => {
  const initial = { zones: [{ ...a, name: 'Home' }, { ...b, name: 'Work', enabled: false }], activeZoneId: 'b',
    pauseOnExit: false, muted: true, duck: { attackMs: 235 }, quiet: true, mapMode: 'flat', streets: false };
  const storage = { getItem(key) { assert.equal(key, FOCUS_STORAGE_KEY); return JSON.stringify(initial); } };
  const settings = readFocusSettings(storage);
  assert.equal(settings.zones.length, 2);
  assert.equal(settings.zones[0].enabled, true);
  assert.equal(settings.zones[1].enabled, false);
  assert.equal(settings.activeZoneId, 'b');
  assert.equal(settings.fence.exit, 'status');
  assert.equal(settings.mapMode, 'flat');
  assert.equal(settings.streets, false);
  assert.equal(settings.quiet, true);
  assert.equal(settings.muted, true);
  assert.equal(settings.duck.attackMs, 235);
  assert.deepEqual(settings.audio, { enabled: true, mode: 'mix', silent: false });
  assert.equal(readFocusSettings({ getItem: () => JSON.stringify({ zones: [a] }) }).fence.exit, 'pause');
  assert.equal(readFocusSettings({ getItem: () => JSON.stringify({ zones: [a], streets: true }) }).fence.exit, 'status');
  assert.equal(readFocusSettings({ getItem: () => null }).fence.exit, 'status');
});

test('individual zones report their own crossings within the combined area', () => {
  let states = new Map();
  function update(fix, timestamp) {
    const { relation, measurements } = checkFence([a, b], fix, FENCE_PROFILES.strict);
    assert.equal(relation, 'inside');
    const result = advanceZoneFences(states, measurements, timestamp, 2000);
    states = result.states;
    return result.transitions;
  }
  assert.deepEqual(update(a.center, 1000), []);
  assert.deepEqual(update(a.center, 3000), []);
  assert.deepEqual(update(b.center, 5000), []);
  assert.deepEqual(update(b.center, 7000), [{ type: 'exit', zoneId: 'a' }, { type: 'enter', zoneId: 'b' }]);
});

test('zone overrides are validated, and Quiet Mode takes precedence at overlapping crossings', () => {
  const stored = { zones: [
    { ...a, name: 'Home', rules: { enter: 'unsupported', exit: 'quiet' } },
    { ...b, name: 'Office', rules: { enter: 'holdSound', exit: 'pauseTimer' } },
  ], fence: { scope: 'individual', enter: 'resume', exit: 'stopSound' } };
  const settings = readFocusSettings({ getItem: () => JSON.stringify(stored) });
  assert.equal(settings.fence.scope, 'individual');
  assert.equal(boundaryRule(settings, { type: 'enter', zoneId: 'a' }).action, 'resume');
  assert.equal(boundaryRule(settings, { type: 'enter', zoneId: 'b' }).action, 'holdSound');
  assert.equal(boundaryRule(settings, { type: 'exit', zoneId: 'b' }).action, 'pauseTimer');
  assert.equal(boundaryRule(settings, { type: 'exit', zoneId: null }).action, 'stopSound');
  const events = [{ type: 'enter', zoneId: 'b' }, { type: 'exit', zoneId: 'a' }];
  assert.equal(chooseBoundaryRule(settings, events).action, 'quiet');
  assert.equal(chooseBoundaryRule(settings, [...events].reverse()).area, 'Home');
});

test('ducking stores exact millisecond settings, extended holds, and zero percent volume', () => {
  const raw = { duck: { attackMs: 237, holdMs: 12345, releaseMs: 5200, level: 0, pip: true } };
  const { duck } = readFocusSettings({ getItem: () => JSON.stringify(raw) });
  assert.deepEqual(duck, { attackMs: 237, holdMs: 12345, releaseMs: 5000, level: 0, pip: true });
  const fullMute = DUCK_PRESETS.find(preset => preset.name === 'Full mute');
  assert.equal(matchesDuckingPreset({ ...fullMute, pip: true }, fullMute), true);
  assert.equal(matchesDuckingPreset(duck, fullMute), false);
});

test('silent playback uses the exclusive media category, and other modes preserve their own categories', () => {
  assert.equal(audioSessionType({ mode: 'exclusive', silent: true }), 'playback');
  assert.equal(audioSessionType({ mode: 'exclusive', silent: false }), 'transient-solo');
  assert.equal(audioSessionType({ mode: 'mix', silent: true }), 'ambient');
  assert.equal(audioSessionType({ mode: 'duck', silent: true }), 'transient');
});

test('polygon, rectangle, corridor and exclusions use their boundaries with uncertainty', async () => {
  const { zoneGeometry } = await import('./focus-geofence.mjs');
  const p = (latitude, longitude, accuracy = 0) => ({ latitude, longitude, accuracy });
  const center = p(0, 0);
  const rectangle = { id: 'square', center, radius: 500, shape: 'rectangle', vertices: [p(-0.01, -0.01), p(0.01, 0.01)] };
  const polygon = { ...rectangle, shape: 'polygon', vertices: [p(-0.01, -0.01), p(-0.01, 0.01), p(0.01, 0)] };
  const corridor = { ...rectangle, shape: 'corridor', radius: 100, vertices: [p(0, -0.01), p(0, 0.01)] };
  for (const shape of [rectangle, polygon, corridor]) {
    assert.ok(zoneGeometry(shape));
    assert.equal(checkFence([shape], center, FENCE_PROFILES.balanced).relation, 'inside');
    assert.equal(checkFence([shape], p(0.03, 0), FENCE_PROFILES.balanced).relation, 'outside');
  }
  const seam = { ...rectangle, center: p(0, 179.99), vertices: [p(-0.01, 179.98), p(0.01, -179.98)] };
  assert.equal(checkFence([seam], p(0, -179.99), FENCE_PROFILES.balanced).relation, 'inside');
  const exclude = { id: 'excluded', center, radius: 50, exclude: true };
  assert.equal(checkFence([rectangle, exclude], center, FENCE_PROFILES.balanced, { useExclusions: true }).relation, 'outside');
  rectangle.overrides = { maxAccuracy: 15, buffer: 1 };
  assert.equal(checkFence([rectangle], p(0, 0, 20), FENCE_PROFILES.balanced).relation, 'weak');
});

test('overnight rules apply on the selected weekday and end before the next morning boundary', async () => {
  const { zoneAvailable, zoneSchedule } = await import('./focus-geofence.mjs');
  const calendarZone = { schedule: zoneSchedule({ enabled: true, days: [1, 1, 12], start: '22:00', end: '06:00' }) };
  const time = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
  assert.equal(zoneAvailable(calendarZone, time(16, 21, 59)), false);
  assert.equal(zoneAvailable(calendarZone, time(16, 22)), true);
  assert.equal(zoneAvailable(calendarZone, time(17, 5, 59)), true);
  assert.equal(zoneAvailable(calendarZone, time(17, 6)), false);
  assert.equal(zoneAvailable({ ...calendarZone, until: time(17, 5) }, time(17, 5, 30)), false);
  assert.equal(zoneAvailable({ ...calendarZone, snoozedUntil: time(17, 4) }, time(17, 2)), false);
});

test('a zone schedule can stay in its selected region when the device travels', async () => {
  const { zoneAvailable, zoneSchedule } = await import('./focus-geofence.mjs');
  const monday = { enabled: true, days: [1], start: '09:00', end: '17:00' };
  const time = Date.parse('2026-11-16T03:00:00Z');
  assert.equal(zoneAvailable({ schedule: zoneSchedule({ ...monday, timeZone: 'Asia/Tokyo' }) }, time), true);
  assert.equal(zoneAvailable({ schedule: zoneSchedule({ ...monday, timeZone: 'America/Los_Angeles' }) }, time), false);
  assert.equal(zoneSchedule({ ...monday, timeZone: { trim: 'invalid' } }).timeZone, '');
  assert.equal(zoneSchedule({ ...monday, timeZone: 'Invalid/Region' }).timeZone, '');
});

test('a stay restarts after uncertain readings and fires once per confirmed visit', async () => {
  const { advanceStay, EMPTY_STAY, interruptStay } = await import('./focus-geofence.mjs');
  const inside = { relation: 'inside', confirmed: 'inside' }, weak = { ...inside, relation: 'weak' };
  let state = advanceStay(EMPTY_STAY, inside, 1000, 10000).state;
  state = advanceStay(state, weak, 9000, 10000).state;
  state = advanceStay(state, inside, 12000, 10000).state;
  assert.equal(advanceStay(state, inside, 21000, 10000).transition, false);
  const done = advanceStay(state, inside, 22000, 10000);
  assert.equal(done.transition, true);
  assert.equal(advanceStay(interruptStay(done.state), inside, 36000, 10000).transition, false);
  assert.deepEqual(advanceStay(done.state, { relation: 'outside', confirmed: 'outside' }, 40000, 10000).state, EMPTY_STAY);
});

test('per-zone timings, shape and schedule round-trip through saved settings', () => {
  const corner = (latitude, longitude) => ({ latitude, longitude, accuracy: 0 });
  const zone = { id: 'a', name: 'Area', shape: 'rectangle', center: corner(0, 0), radius: 100, priority: 4,
    vertices: [corner(1, 1), corner(2, 2)], schedule: { enabled: true, days: [1, 5], start: '22:00', end: '03:00', timeZone: 'UTC' },
    rules: { stay: 'quiet', approach: 'status', exit: 'invalid' }, overrides: { enterSeconds: 5, exitSeconds: 27, maxAccuracy: -1, buffer: 0 } };
  const store = { getItem: () => JSON.stringify({ zones: [zone] }) };
  const [loaded] = readFocusSettings(store).zones;
  assert.equal(loaded.shape, 'rectangle');
  assert.deepEqual(loaded.overrides, { maxAccuracy: 1, buffer: 0, enterSeconds: 5, exitSeconds: 27 });
  assert.deepEqual(loaded.schedule, zone.schedule);
  assert.deepEqual(loaded.rules, { stay: 'quiet', approach: 'status' });
});

test('live readings keep optional sensor measurements when available', () => {
  const timestamp = 1800000000000;
  const coords = { latitude: 2, longitude: 3, accuracy: 4, altitude: -2, speed: 0, altitudeAccuracy: 9, heading: 275 };
  assert.deepEqual(readLocationFix({ timestamp, coords }, timestamp), { ...coords, timestamp });
  const unsupported = readLocationFix({ timestamp, coords: { ...coords, altitude: null, heading: 360, speed: -1 } }, timestamp);
  assert.deepEqual(unsupported, { latitude: 2, longitude: 3, accuracy: 4, timestamp, altitudeAccuracy: 9 });
});
