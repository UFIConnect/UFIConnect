import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrafficPath, trafficSnapshot } from '../web/src/local/cityTraffic.mjs';
import { advanceDrivenVehicle, drivenVehiclePoint } from '../web/src/local/cityDriving.mjs';

const path = createTrafficPath([[0, .11, 0], [100, .11, 0]]);
const vehicle = (extra = {}) => ({ id: 'driver', path, distance: 10, speed: 0, cruise: 5.5, signals: [], active: true, priority: 200, ...extra });
const neighbor = (extra = {}) => trafficSnapshot(vehicle({ id: 'neighbor', priority: 1, ...extra }));
function step(car, frames, options = {}) {
  for (let index = 0; index < frames; index++) car = advanceDrivenVehicle(car, { delta: .05, time: index * .05, now: index * .05, ...options });
  return car;
}

test('steering moves the real traffic position, stays bounded and stops when released', () => {
  const right = step(vehicle(), 30, { input: { steer: 1 } });
  assert.equal(right.lateralOffset, 1.5);
  assert.equal(drivenVehiclePoint(right).position[2], 1.5);
  assert.deepEqual(trafficSnapshot(right).position, drivenVehiclePoint(right).position);
  const released = step(right, 5);
  assert.equal(released.lateralOffset, right.lateralOffset);
  const left = step(released, 40, { input: { steer: -1 } });
  assert.equal(left.lateralOffset, -1.5);
  assert.equal(drivenVehiclePoint(left).position[2], -1.5);
  const bounded = advanceDrivenVehicle(vehicle(), { delta: 1000, input: { steer: 1 } });
  assert.equal(bounded.lateralOffset, .12, 'A late animation frame cannot jump across lanes');
});

test('moving into the clear adjacent lane passes traffic that stopped the original lane', () => {
  const lead = neighbor({ distance: 14 });
  const queued = step(vehicle(), 240, { others: [lead] });
  assert.equal(queued.status, 'traffic');
  assert.equal(queued.speed, 0);
  const passing = step(queued, 120, { others: [lead], input: { steer: 1, throttle: true } });
  assert.ok(passing.distance > lead.position[0] + 5);
  assert.equal(passing.status, 'driving');
  assert.equal(passing.accidentCount || 0, 0, 'A clear adjacent lane does not count as a collision');
});

test('throttle increases movement, brake stops smoothly, and releasing brake resumes', () => {
  const normal = step(vehicle(), 80);
  const faster = step(vehicle(), 80, { input: { throttle: true } });
  assert.ok(faster.speed > normal.speed && faster.distance > normal.distance);
  assert.equal(faster.cruise, 5.5, 'Boost does not compound between frames');
  const slowing = advanceDrivenVehicle(vehicle({ speed: 5.5 }), { delta: .05, input: { brake: true } });
  assert.equal(slowing.status, 'braking');
  assert.ok(slowing.speed > 0 && slowing.speed < 5.5);
  const stopped = step(slowing, 30, { input: { brake: true } });
  assert.equal(stopped.speed, 0);
  const resumed = advanceDrivenVehicle(stopped, { delta: .05 });
  assert.ok(resumed.speed > 0 && resumed.distance > stopped.distance);
});

test('steering and throttle still respect signals; manual pause freezes all driver input', () => {
  const car = vehicle({ distance: 16.5, signals: [{ distance: 20, signal: {}, approach: 'arterial' }] });
  const waiting = step(car, 10, { time: 17, input: { steer: 1, throttle: true } });
  assert.equal(waiting.distance, 16.5);
  assert.equal(waiting.signal, 'red');
  const paused = advanceDrivenVehicle(waiting, { delta: .05, paused: true, input: { steer: -1, throttle: true } });
  assert.equal(paused.distance, waiting.distance);
  assert.equal(paused.lateralOffset, waiting.lateralOffset);
  assert.equal(paused.speed, 0);
  assert.equal(paused.status, 'paused');
});

test('a side impact reports once, freezes for exactly four seconds and automatically continues', () => {
  const other = neighbor();
  const hit = advanceDrivenVehicle(vehicle({ lateralOffset: .98 }), { delta: .05, now: 10, others: [other], input: { steer: -1 } });
  assert.equal(hit.status, 'accident');
  assert.equal(hit.accidentUntil, 14);
  assert.equal(hit.accidentCount, 1);
  assert.equal(hit.accidentOtherId, 'neighbor');
  assert.equal(hit.speed, 0);
  for (const now of [10.001, 11, 12, 13, 13.999]) {
    const still = advanceDrivenVehicle(hit, { delta: .05, now, others: [other], input: { throttle: true, steer: 1 } });
    assert.equal(still.status, 'accident');
    assert.equal(still.distance, hit.distance);
    assert.equal(still.lateralOffset, hit.lateralOffset);
    assert.equal(still.accidentCount, 1);
  }
  const resumed = advanceDrivenVehicle(hit, { delta: .05, now: 14, others: [other] });
  assert.equal(resumed.status, 'driving');
  assert.ok(resumed.distance > hit.distance && resumed.speed > 0);
  assert.equal(resumed.accidentCount, 1, 'The same lingering overlap cannot cause another report');
  const moving = step(resumed, 80, { now: 15, others: [other] });
  assert.equal(moving.accidentCount, 1);
  assert.ok(moving.distance > 15, 'Reported contact does not trap the car in the following controller');
});

test('manual pause survives report expiry and a new contact can be reported after separation', () => {
  const other = neighbor();
  const hit = advanceDrivenVehicle(vehicle(), { delta: .05, now: 0, others: [other] });
  const held = advanceDrivenVehicle(hit, { delta: .05, now: 4, paused: true, others: [other] });
  assert.equal(held.status, 'paused');
  assert.equal(held.distance, hit.distance);
  const cleared = advanceDrivenVehicle(held, { delta: .05, now: 5, others: [neighbor({ distance: 50 })] });
  assert.deepEqual(cleared.accidentContacts, []);
  const again = advanceDrivenVehicle(cleared, { delta: .05, now: 6, others: [neighbor({ distance: cleared.distance })] });
  assert.equal(again.status, 'accident');
  assert.equal(again.accidentCount, 2);
  assert.equal(again.accidentUntil, 10);
});

test('overpasses, inactive traffic and the driver itself never cause phantom accidents', () => {
  for (const other of [neighbor({ path: createTrafficPath([[0, 2.91, 0], [100, 2.91, 0]]) }),
    neighbor({ active: false }), trafficSnapshot(vehicle())]) {
    const next = advanceDrivenVehicle(vehicle(), { delta: .05, others: [other] });
    assert.equal(next.status, 'driving');
    assert.equal(next.accidentCount || 0, 0);
  }
  const crossing = neighbor({ path: createTrafficPath([[10, .11, -10], [10, .11, 90]]) });
  assert.equal(advanceDrivenVehicle(vehicle(), { delta: .05, others: [crossing] }).status, 'accident');
});

test('skip arrives immediately even while paused or reporting and clears lateral movement', () => {
  const car = vehicle({ lateralOffset: 1.5, status: 'accident', accidentUntil: 100, accidentContacts: ['neighbor'] });
  const skipped = advanceDrivenVehicle(car, { delta: .05, now: 1, paused: true, skip: true });
  assert.equal(skipped.status, 'arrived');
  assert.equal(skipped.distance, path.length);
  assert.equal(skipped.speed, 0);
  assert.equal(skipped.lateralOffset, 0);
  assert.equal(skipped.accidentUntil, 0);
  assert.deepEqual(skipped.accidentContacts, []);
  assert.deepEqual(drivenVehiclePoint(skipped).position, [100, .11, 0]);
  const arrived = advanceDrivenVehicle(skipped, { delta: .05, input: { steer: 1, throttle: true }, paused: true });
  assert.equal(arrived.status, 'arrived');
  assert.equal(arrived.distance, path.length);
});

test('lateral movement eases into the destination and arrival stays centered', () => {
  const nearing = advanceDrivenVehicle(vehicle({ distance: 98, lateralOffset: 1.5 }), { delta: .05, input: { steer: 1 } });
  assert.ok(nearing.lateralOffset <= .5);
  const arrived = step(nearing, 100, { input: { steer: 1 } });
  assert.equal(arrived.status, 'arrived');
  assert.equal(arrived.lateralOffset, 0);
});
