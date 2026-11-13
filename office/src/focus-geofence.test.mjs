import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceFence, checkFence, EMPTY_FENCE, FENCE_PROFILES, measureLocation, readLocationFix } from './focus-geofence.mjs';
import { FOCUS_STORAGE_KEY, readFocusSettings } from './focus-studio-model.mjs';

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
});
