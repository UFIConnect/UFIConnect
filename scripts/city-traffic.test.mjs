import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrafficPath, createDriveTrafficPath, continueTrafficPath, trafficPoint, trafficPathSignals, trafficLightPhase,
  trafficTurnSpeed, trafficSnapshot, advanceTrafficVehicle, cityResidentCount } from '../web/src/local/cityTraffic.mjs';
import { CITY_SITES, CITY_LANDMARKS, CITY_RAMPS, cityRoadPoint, cityRoadPoints, cityCollectorPoints,
  cityDriveOrigin, cityDriveWaypoints, cityRoadPosition, cityTrafficSignals, citySignalApproaches } from '../web/src/local/cityEngineering.mjs';

const line = (y = .11, z = 0, reverse = false) => createTrafficPath(reverse ? [[100, y, z], [0, y, z]] : [[0, y, z], [100, y, z]]);
const vehicle = (path = line(), extra = {}) => ({ id: 'driver', priority: 200, path, distance: 0, speed: 0, cruise: 5.5, signals: [], active: true, ...extra });
function step(car, seconds, options = {}) {
  for (let time = 0; time < seconds; time += .05) car = advanceTrafficVehicle(car, { delta: .05, time: (options.start || 0) + time, ...options });
  return car;
}

test('signal phases include amber and all-red clearance without conflicting greens', () => {
  for (let time = 0; time < 64; time += .05) {
    assert.equal(trafficLightPhase({}, time, 'arterial') === 'green' && trafficLightPhase({}, time, 'collector') === 'green', false);
  }
  assert.equal(trafficLightPhase({}, 14, 'arterial'), 'yellow');
  assert.equal(trafficLightPhase({}, 16.5, 'arterial'), 'red');
  assert.equal(trafficLightPhase({}, 16.5, 'collector'), 'red');
  assert.equal(trafficLightPhase({}, 17, 'collector'), 'green');
  assert.equal(trafficLightPhase({ offset: 17 }, 0, 'collector'), 'green');
  assert.equal(trafficLightPhase({}, 31.5, 'collector'), 'red');
});

test('smooth acceleration, turn slowing, braking and pause use bounded simulated time', () => {
  const car = vehicle();
  const start = advanceTrafficVehicle(car, { delta: .05 });
  assert.ok(start.speed > 0 && start.speed <= .12);
  assert.ok(start.distance < .01);
  assert.equal(advanceTrafficVehicle(car, { delta: 100 }).distance, start.distance, 'Background time cannot jump the vehicle forward');
  const corner = createTrafficPath([[0, .11, 0], [20, .11, 0], [20, .11, 30]]);
  assert.ok(trafficTurnSpeed(corner, 16) < trafficTurnSpeed(corner, 0) * .6);
  const turning = advanceTrafficVehicle(vehicle(corner, { distance: 16, speed: 5.5 }), { delta: .05 });
  assert.equal(turning.status, 'turning');
  assert.ok(turning.speed >= 5.5 - .275 && turning.speed < 5.5);
  const paused = advanceTrafficVehicle(turning, { delta: .05, paused: true });
  assert.equal(paused.distance, turning.distance); assert.equal(paused.speed, 0); assert.equal(paused.status, 'paused');
});

test('red and stoppable amber hold the exact stop line; green restarts and an entered junction clears', () => {
  const signal = { position: [20, .11, 0], axis: [1, 0, 0], offset: 0 };
  const path = line(), signals = trafficPathSignals(path, [signal]);
  assert.equal(signals[0].approach, 'arterial');
  let car = vehicle(path, { signals });
  car = step(car, 12, { start: 17 });
  assert.equal(car.status, 'red-light'); assert.equal(car.signal, 'red');
  assert.ok(car.distance <= 16.5); assert.ok(car.distance >= 16.49);
  assert.equal(car.speed, 0);
  const green = advanceTrafficVehicle(car, { delta: .05, time: 32 });
  assert.ok(green.speed > 0 && green.distance > car.distance);
  const paused = advanceTrafficVehicle(car, { delta: .05, time: 32, paused: true });
  assert.equal(paused.signal, 'green'); assert.equal(paused.distance, car.distance);
  const amber = advanceTrafficVehicle(vehicle(path, { signals, distance: 5, speed: 3 }), { delta: .05, time: 14.5 });
  assert.equal(amber.status, 'red-light'); assert.equal(amber.signal, 'yellow');
  const clearing = advanceTrafficVehicle(vehicle(path, { signals, distance: 18, speed: 4 }), { delta: .05, time: 17 });
  assert.equal(clearing.signal, null); assert.ok(clearing.distance > 18);
});

test('same-road queues keep a safe bumper gap and never use opposing lanes or overpasses as blockers', () => {
  const path = line();
  const lead = trafficSnapshot(vehicle(path, { id: 'lead', distance: 15, speed: 0, priority: 1 }));
  const queued = step(vehicle(path), 12, { others: [lead] });
  assert.equal(queued.status, 'traffic'); assert.ok(queued.distance <= 12.2); assert.equal(queued.speed, 0);
  assert.ok(lead.position[0] - queued.distance >= 2.8);
  for (const other of [vehicle(line(.11, 1.8, true), { id: 'opposing', distance: 85, speed: 3 }),
    vehicle(line(2.91), { id: 'overpass', distance: 15, speed: 0 }),
    vehicle(path, { id: 'behind', distance: 0, speed: 0 })]) {
    const car = step(vehicle(path, { distance: 4 }), 5, { others: [trafficSnapshot(other)] });
    assert.equal(car.status, 'driving'); assert.ok(car.distance > 20);
  }
});

test('crossing traffic has deterministic yielding and stopped cars outside the crossing do not deadlock it', () => {
  const crossing = createTrafficPath([[20, .11, -30], [20, .11, 30]]);
  const car = vehicle(line(), { distance: 16, speed: 4 });
  const moving = trafficSnapshot(vehicle(crossing, { id: 'crossing', priority: 1, distance: 24, speed: 3 }));
  const yielded = advanceTrafficVehicle(car, { delta: .05, others: [moving] });
  assert.equal(yielded.status, 'traffic'); assert.ok(yielded.speed < car.speed);
  const outside = { ...moving, speed: 0 };
  assert.equal(advanceTrafficVehicle(car, { delta: .05, others: [outside] }).status, 'driving');
  const overpass = { ...moving, position: [20, 2.91, -6] };
  assert.equal(advanceTrafficVehicle(car, { delta: .05, others: [overpass] }).status, 'driving');
  const entered = vehicle(line(), { distance: 19.5, speed: 1, priority: 200 });
  const crossingEntered = vehicle(crossing, { id: 'crossing', distance: 29.5, speed: 1, priority: 1 });
  assert.equal(advanceTrafficVehicle(entered, { delta: .05, others: [trafficSnapshot(crossingEntered)] }).status, 'traffic');
  assert.ok(advanceTrafficVehicle(crossingEntered, { delta: .05, others: [trafficSnapshot(entered)] }).distance > crossingEntered.distance,
    'Overlapping intersection arrivals must give one vehicle priority to clear');
});

test('looping collector routes include the return intersection and use collector permission', () => {
  const path = createTrafficPath([[0, .11, 0], [0, .11, 30], [.6, .11, 30], [.6, .11, 0]], { loop: true });
  const crossings = trafficPathSignals(path, [{ position: [0, .11, 0], axis: [1, 0, 0] }]);
  assert.equal(crossings.length, 1); assert.equal(crossings[0].approach, 'collector');
  const stopped = advanceTrafficVehicle(vehicle(path, { distance: path.length - 4, signals: crossings, speed: 2 }), { delta: .05, time: 0 });
  assert.equal(stopped.status, 'red-light');
});

test('both highway ramp terminals stop on collector red and enter the arterial on their green', () => {
  const signals = cityTrafficSignals();
  assert.equal(signals.length, new Set(CITY_SITES.map(site => site.station)).size + CITY_LANDMARKS.length + CITY_RAMPS.length);
  assert.equal(signals.filter(signal => signal.collectors.length === 2).length, 8, 'Opposite district streets share one signal cycle');
  assert.equal(new Set(signals.map(signal => signal.id)).size, signals.length);
  for (const [index, ramp] of CITY_RAMPS.entries()) {
    const signal = signals.find(item => item.id === 'highway-ramp-' + index), end = ramp.at(-1);
    assert.deepEqual(signal.position, [end[0], .11, end[2]]);
    const approach = citySignalApproaches(signal).find(item => item.type === 'collector');
    assert.ok(Math.abs(signal.axis[0] * approach.axis[0] + signal.axis[2] * approach.axis[2]) < .5,
      'Ramp signal faces a crossing approach rather than an opposing arterial lane');
    const angle = cityRoadPosition('arterial', end[0]);
    const onward = Array.from({ length: 20 }, (_, i) => cityRoadPoint('arterial', angle + (i + 1) * .002));
    const path = createTrafficPath([...ramp, ...onward]);
    const crossings = trafficPathSignals(path, [signal]);
    assert.equal(crossings.length, 1); assert.equal(crossings[0].approach, 'collector');
    const stopLine = crossings[0].distance - 3.5;
    const stopped = advanceTrafficVehicle(vehicle(path, { distance: stopLine, signals: crossings }),
      { delta: .05, time: 5 - signal.offset });
    assert.equal(stopped.status, 'red-light'); assert.equal(stopped.distance, stopLine);
    const green = advanceTrafficVehicle(stopped, { delta: .05, time: 20 - signal.offset });
    assert.ok(green.distance > stopped.distance); assert.ok(green.speed > 0);
  }
});

test('resident population increases while remaining bounded for mobile and neighborhood scenes', () => {
  assert.equal(cityResidentCount(), 108);
  assert.equal(cityResidentCount({ mobile: true }), 72);
  assert.equal(cityResidentCount({ overview: false, mobile: false }), 42);
  assert.equal(cityResidentCount({ overview: false, mobile: true }), 30);
});

test('changing direction keeps the current car position and joins the other lane without teleporting', () => {
  const old = line(.08, -.9), origin = trafficPoint(old, 30);
  const reversed = createTrafficPath([[30, .08, .9], [0, .08, .9]]);
  const joined = continueTrafficPath(reversed, origin);
  assert.deepEqual(trafficPoint(joined, 0).position, origin.position);
  let car = vehicle(joined);
  car = step(car, .25);
  assert.ok(Math.hypot(...trafficPoint(joined, car.distance).position.map((value, axis) => value - origin.position[axis])) < .1);
  assert.ok(joined.points.every(point => Math.abs(point[2]) <= .91 && point[0] <= 31 && point[0] >= 0),
    'The short turning join stays within the road lanes');
  assert.equal(step(vehicle(joined), 45).status, 'arrived');
});

test('every surveyed city and landmark arrives with real signal positions and moving adjacent traffic', () => {
  const destinations = [...CITY_SITES, ...CITY_LANDMARKS];
  const arterial = cityRoadPoints('arterial');
  const signals = cityTrafficSignals(destinations);
  const east = createTrafficPath(cityRoadPoints('arterial', -.9, .11), { loop: true });
  const west = createTrafficPath(cityRoadPoints('arterial', .9, .11).reverse(), { loop: true });
  east.signals = trafficPathSignals(east, signals); west.signals = trafficPathSignals(west, signals);
  for (const destination of destinations) {
    const path = createDriveTrafficPath(cityDriveWaypoints(null, destination), arterial);
    let car = vehicle(path, { signals: trafficPathSignals(path, signals) });
    let neighbors = [east, east, west, west].map((path, index) => vehicle(path, { id: 'neighbor-' + index,
      distance: path.length * (.17 + index * .21), cruise: 4.5, signals: path.signals, priority: index + 1 }));
    let elapsed = 0;
    for (; elapsed < 300 && car.status !== 'arrived'; elapsed += .05) {
      const snapshots = [trafficSnapshot(car), ...neighbors.map(trafficSnapshot)];
      neighbors = neighbors.map(item => advanceTrafficVehicle(item, { delta: .05, time: elapsed, others: snapshots }));
      car = advanceTrafficVehicle(car, { delta: .05, time: elapsed, others: neighbors.map(trafficSnapshot) });
    }
    assert.equal(car.status, 'arrived', destination.id + ' must arrive without frozen signals or phantom blockers');
    assert.equal(car.distance, path.length); assert.equal(car.speed, 0);
    assert.ok(elapsed < 300);
  }
  // Starting at a junction does not wait behind a stop line already crossed.
  const site = CITY_SITES[0], origin = cityDriveOrigin(site.junction);
  const reroute = createDriveTrafficPath(cityDriveWaypoints(origin, CITY_LANDMARKS[0]), arterial);
  const beginning = vehicle(reroute, { signals: trafficPathSignals(reroute, signals) });
  assert.ok(step(beginning, 5, { start: 17 }).distance > 0);
  assert.ok(cityCollectorPoints(site).length > 2, 'Use the existing surveyed collector geometry');
});
