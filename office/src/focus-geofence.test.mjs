import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceFence, advanceZoneFences, checkFence, EMPTY_FENCE, FENCE_PROFILES, measureLocation, readLocationFix } from './focus-geofence.mjs';
import { audioSessionType, boundaryRule, chooseBoundaryRule, FOCUS_STORAGE_KEY, readFocusSettings } from './focus-studio-model.mjs';

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
  assert.equal(readLocationFix({ coords: point(0, 0), timestamp: 10000 }, now), null);
  assert.equal(readLocationFix({ coords: point(0, 0), timestamp: 43000 }, now), null);
  assert.equal(readLocationFix({ coords: point(92, 0), timestamp: now }, now), null);
  assert.equal(readLocationFix({ coords: point(0, 0, -1), timestamp: now }, now), null);
  assert.equal(readLocationFix({ coords: point(0, 0), timestamp: now }, now).timestamp, now);
});

test('existing zones, audio preferences and exit actions survive the update', () => {
  const initial = { zones: [{ ...a, name: 'Home' }, { ...b, name: 'Work', enabled: false }], activeZoneId: 'b',
    pauseOnExit: false, muted: true, duck: { attackMs: 235 }, quiet: true };
  const storage = { getItem(key) { assert.equal(key, FOCUS_STORAGE_KEY); return JSON.stringify(initial); } };
  const settings = readFocusSettings(storage);
  assert.equal(settings.zones.length, 2);
  assert.equal(settings.zones[0].enabled, true);
  assert.equal(settings.zones[1].enabled, false);
  assert.equal(settings.activeZoneId, 'b');
  assert.equal(settings.fence.exit, 'status');
  assert.equal(settings.quiet, true);
  assert.equal(settings.muted, true);
  assert.equal(settings.duck.attackMs, 235);
  assert.deepEqual(settings.audio, { enabled: true, mode: 'mix', silent: false });
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
    { ...a, name: 'Home', rules: { enter: 'pause', exit: 'quiet' } },
    { ...b, name: 'Office', rules: { enter: 'start' } },
  ], fence: { scope: 'individual', enter: 'resume', exit: 'stopSound' } };
  const settings = readFocusSettings({ getItem: () => JSON.stringify(stored) });
  assert.equal(settings.fence.scope, 'individual');
  assert.equal(boundaryRule(settings, { type: 'enter', zoneId: 'a' }).action, 'resume');
  assert.equal(boundaryRule(settings, { type: 'exit', zoneId: null }).action, 'stopSound');
  const events = [{ type: 'enter', zoneId: 'b' }, { type: 'exit', zoneId: 'a' }];
  assert.equal(chooseBoundaryRule(settings, events).action, 'quiet');
  assert.equal(chooseBoundaryRule(settings, [...events].reverse()).area, 'Home');
});

test('silent playback uses the exclusive media category, and other modes preserve their own categories', () => {
  assert.equal(audioSessionType({ mode: 'exclusive', silent: true }), 'playback');
  assert.equal(audioSessionType({ mode: 'exclusive', silent: false }), 'transient-solo');
  assert.equal(audioSessionType({ mode: 'mix', silent: true }), 'ambient');
  assert.equal(audioSessionType({ mode: 'duck', silent: true }), 'transient');
});
