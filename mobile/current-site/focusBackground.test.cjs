const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createBackgroundFocus, LIVE_TASK, ZONE_TASK } = require('./focusBackground.cjs');

function fixture(permission = true) {
  const callbacks = new Map(), values = new Map(), running = new Map(), requests = [];
  const controller = createBackgroundFocus({
    Accuracy: { High: 4 },
    GeofencingEventType: { Enter: 1, Exit: 2 },
    requestForegroundPermissionsAsync: async () => { requests.push('foreground'); return { granted: true }; },
    requestBackgroundPermissionsAsync: async () => { requests.push('background'); return { granted: permission }; },
    getBackgroundPermissionsAsync: async () => ({ granted: permission }),
    hasServicesEnabledAsync: async () => true,
    hasStartedLocationUpdatesAsync: async id => running.has(id),
    hasStartedGeofencingAsync: async id => running.has(id),
    startLocationUpdatesAsync: async (id, options) => { running.set(id, options); },
    startGeofencingAsync: async (id, regions) => { running.set(id, regions); },
    stopLocationUpdatesAsync: async id => { running.delete(id); },
    stopGeofencingAsync: async id => { running.delete(id); },
  }, { defineTask: (id, callback) => callbacks.set(id, callback) }, {
    read: async key => values.get(key) ?? null,
    write: async (key, value) => values.set(key, value),
    remove: async key => { values.delete(key); },
  }, 'android');
  return { controller, callbacks, running, values, requests };
}

const zone = { latitude: 37, longitude: -122, radius: 250 };

test('controls are off by default and denied permission leaves both tasks stopped', async () => {
  const { controller, requests, running } = fixture(false);
  assert.equal((await controller.snapshot()).live, false);
  assert.equal((await controller.snapshot()).monitoring, false);
  assert.deepEqual(requests, []);
  await assert.rejects(controller.live(true), /background location/);
  await assert.rejects(controller.geofence(true, zone), /background location/);
  assert.deepEqual(requests, ['foreground', 'background', 'foreground', 'background']);
  assert.equal(running.size, 0);
});

test('live location keeps the newest fix and can stop independently of geofencing', async () => {
  const { controller, callbacks, running, values } = fixture();
  await controller.live(true);
  await assert.rejects(controller.geofence(true, { ...zone, longitude: 300 }), /latitude, longitude/);
  await controller.geofence(true, zone);
  assert.ok(running.get(LIVE_TASK).foregroundService);
  const coords = { latitude: 38, longitude: -122, accuracy: 15 };
  await callbacks.get(LIVE_TASK)({ data: { locations: [{ coords, timestamp: 100 }, { coords, timestamp: 50 }] } });
  assert.equal((await controller.snapshot()).fix.timestamp, 100);
  await controller.live(false);
  await callbacks.get(LIVE_TASK)({ data: { locations: [{ coords, timestamp: 200 }] } });
  assert.equal(values.has('fix'), false);
  assert.equal((await controller.snapshot()).monitoring, true);
});

test('only the registered zone updates its last event and late events are ignored after stopping', async () => {
  const { controller, callbacks, running, values } = fixture();
  await controller.geofence(true, zone);
  const [region] = running.get(ZONE_TASK);
  const handler = callbacks.get(ZONE_TASK);
  await handler({ data: { region: { identifier: 'previous' }, eventType: 2 } });
  assert.equal(values.has('event'), false);
  await handler({ data: { region, eventType: 1 } });
  assert.equal((await controller.snapshot()).event.inside, true);
  await handler({ data: { region, eventType: 2 } });
  assert.equal((await controller.snapshot()).event.inside, false);
  await controller.geofence(false);
  await handler({ data: { region, eventType: 1 } });
  assert.equal(values.has('event'), false);
});
