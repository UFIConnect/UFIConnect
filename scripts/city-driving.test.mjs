import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrafficPath, trafficPathSignals, trafficSnapshot } from '../web/src/local/cityTraffic.mjs';
import { advanceDrivenVehicle, drivenVehiclePoint } from '../web/src/local/cityDriving.mjs';
import { planDriveDestination, planNextStreetTurn, startCityDrive } from '../web/src/local/cityDriveNavigation.mjs';
import { CITY_SITES, CITY_LANDMARKS, CITY_FREEWAY_HEIGHT, CITY_FREEWAY_CONNECTIONS, CITY_HIGHWAY_KINDS,
  CITY_END_ROADS, CITY_LOCAL_LINKS, CITY_RAMPS, cityCollectorPoints, cityRoadOpening, cityRoadPoint, cityRoadPoints, cityRoadPosition,
  cityTrafficSignals } from '../web/src/local/cityEngineering.mjs';
import { advancePedestrianCircuit, createPedestrianCircuit, pedestrianPose } from '../web/src/local/cityPedestrians.mjs';

const path = createTrafficPath([[0, .11, 0], [100, .11, 0]]);
const vehicle = (extra = {}) => ({ id: 'driver', path, distance: 10, speed: 0, cruise: 5.5, signals: [], active: true, priority: 200, ...extra });
const neighbor = (extra = {}) => trafficSnapshot(vehicle({ id: 'neighbor', priority: 1, ...extra }));
function step(car, frames, options = {}) {
  for (let index = 0; index < frames; index++) car = advanceDrivenVehicle(car, { delta: .05, time: index * .05, now: index * .05, ...options });
  return car;
}

const surveyedApproach = (kind, start, direction) => {
  const arterial = kind === 'arterial', height = arterial ? .105 : CITY_FREEWAY_HEIGHT;
  const points = [start, start + direction * 2].map(x => {
    const [px, z] = cityRoadPoint(kind, cityRoadPosition(kind, x), direction * (arterial ? -.9 : -2.55));
    return [px, height, z];
  });
  return vehicle({ path: createTrafficPath(points), distance: .5 });
};

test('turn controls take both arterial on-ramps and the matching freeway exits', () => {
  const turns = [
    ['arterial', -65, -1, 1, 'Central freeway ramp'],
    ['arterial', 93, 1, -1, 'Central freeway ramp'],
    ['highway-return', CITY_RAMPS[1][0][0] - 5, 1, 1, 'Main street exit'],
    ['highway', -103, 1, 1, 'Central freeway ramp'],
    ['highway-return', 91, 1, -1, 'North freeway ramp'],
  ];
  for (const [kind, x, direction, turn, label] of turns) {
    const original = surveyedApproach(kind, x, direction);
    const route = planNextStreetTurn(original, turn);
    assert.equal(route?.streetLabel, label);
    assert.ok(route.turnDistance > original.distance);
    assert.ok(Math.max(...route.path.points.map(point => point[1])) >= CITY_FREEWAY_HEIGHT);
    assert.deepEqual(drivenVehiclePoint(route).position, drivenVehiclePoint(original).position);
    assert.ok(route.path.points.at(-1)[1] < .2, 'Every selected ramp leaves a route back to a destination');
  }
});

test('both route preferences reach every destination and the freeway routes stay on the surveyed pavement', () => {
  const destinations = [...CITY_SITES, ...CITY_LANDMARKS];
  const surfaces = [
    { points: cityRoadPoints('arterial', 0, .105), widths: 3.6 },
    ...CITY_HIGHWAY_KINDS.map(kind => ({ points: cityRoadPoints(kind, 0, CITY_FREEWAY_HEIGHT), widths: 7.6 })),
    ...CITY_END_ROADS.map(({ points }) => ({ points, widths: 3.4 })), ...CITY_FREEWAY_CONNECTIONS,
    ...CITY_LOCAL_LINKS.map(points => ({ points, widths: 1.85 })),
    ...destinations.map(site => ({ points: cityCollectorPoints(site), widths: site.collector ? 3.6 : 1.85 })),
    ...CITY_SITES.map(site => ({ points: [[site.entrance[0], .105, site.entrance[1]],
      [2 * site.x - site.entrance[0], .105, 2 * site.z - site.entrance[1]]], widths: 2.62 })),
  ];
  for (const destination of destinations) for (const viaFreeway of [false, true]) {
    const route = startCityDrive(destination.id, { viaFreeway });
    const { path } = route, [x, y, z] = path.points.at(-1);
    assert.equal(path.points.some(point => point[1] >= 2.8), viaFreeway, destination.id);
    assert.ok(y < .2 && Math.hypot(x - destination.entrance[0], z - destination.entrance[1]) < .6, destination.id);
    assert.ok(path.points.every(point => cityRoadOpening(point, surfaces, .05, .25)), destination.id);
  }
});

test('throttle increases movement, brake stops smoothly, and releasing brake resumes', () => {
  const normal = step(vehicle(), 80);
  const faster = step(vehicle(), 80, { input: { throttle: true } });
  assert.ok(faster.speed > normal.speed && faster.distance > normal.distance);
  assert.equal(faster.cruise, 5.5, 'Boost does not compound between frames');
  const slowing = advanceDrivenVehicle(vehicle({ speed: 5.5 }), { delta: .05, input: { brake: true } });
  assert.equal(slowing.status, 'braking');
  assert.ok(slowing.speed > 0 && slowing.speed < 5.5);
  const stopped = step(vehicle({ speed: 5.5 }), 20, { input: { brake: true } });
  assert.equal(stopped.speed, 0);
  const resumed = advanceDrivenVehicle(stopped, { delta: .05 });
  assert.ok(resumed.speed > 0 && resumed.distance > stopped.distance);
  const reversing = step(stopped, 15, { input: { brake: true } });
  assert.ok(reversing.speed < 0 && reversing.distance < stopped.distance);
});

test('throttle respects signals and manual pause freezes all driver input', () => {
  const car = vehicle({ distance: 16.5, signals: [{ distance: 20, signal: {}, approach: 'arterial' }] });
  const waiting = step(car, 10, { time: 17, input: { throttle: true } });
  assert.equal(waiting.distance, 16.5);
  assert.equal(waiting.signal, 'red');
  const paused = advanceDrivenVehicle(waiting, { delta: .05, paused: true, input: { throttle: true } });
  assert.equal(paused.distance, waiting.distance);
  assert.equal(paused.lateralOffset, waiting.lateralOffset);
  assert.equal(paused.speed, 0);
  assert.equal(paused.status, 'paused');
});

test('a side impact reports once, freezes for exactly four seconds and automatically continues', () => {
  const other = neighbor();
  const hit = advanceDrivenVehicle(vehicle({ lateralOffset: .72 }), { delta: .05, now: 10, others: [other] });
  assert.equal(hit.status, 'accident');
  assert.equal(hit.accidentUntil, 14);
  assert.equal(hit.accidentCount, 1);
  assert.equal(hit.accidentOtherId, 'neighbor');
  assert.equal(hit.speed, 0);
  for (const now of [10.001, 11, 12, 13, 13.999]) {
    const still = advanceDrivenVehicle(hit, { delta: .05, now, others: [other], input: { throttle: true } });
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
  const arrived = advanceDrivenVehicle(skipped, { delta: .05, input: { throttle: true }, paused: true });
  assert.equal(arrived.status, 'arrived');
  assert.equal(arrived.distance, path.length);
});

test('changing the destination on a freeway retains the current lane and elevation', () => {
  const car = surveyedApproach('highway-return', 45, 1);
  const route = planDriveDestination(car, 'shopping');
  assert.ok(route);
  assert.deepEqual(drivenVehiclePoint(route).position, drivenVehiclePoint(car).position);
  assert.ok(route.path.points.some(point => point[1] > 1 && point[1] < 2.8), 'The return to the surface takes a graded ramp');
  assert.ok(route.path.points.at(-1)[1] < .2);
});

test('a selected freeway drive climbs and leaves the deck through traffic-controlled approaches', () => {
  const route = startCityDrive('shopping', { viaFreeway: true });
  const signals = trafficPathSignals(route.path, cityTrafficSignals());
  let car = vehicle({ ...route, signals }), reachedDeck = false, leftDeck = false, waited = false;
  for (let frame = 0; frame < 6000 && car.status !== 'arrived'; frame++) {
    car = advanceDrivenVehicle(car, { delta: .05, time: frame * .05 });
    const sample = drivenVehiclePoint(car);
    reachedDeck ||= sample.position[1] > 2.8;
    leftDeck ||= reachedDeck && sample.position[1] < .2;
    waited ||= car.status === 'red-light';
    assert.ok(Math.abs(sample.pitch) < .2, 'The car follows the paved grade without an elevation jump');
  }
  assert.ok(reachedDeck && leftDeck && waited);
  assert.equal(car.status, 'arrived');
});

test('ramp elevation stays level until its lane clears the parent deck', () => {
  for (const { id, from, points } of CITY_FREEWAY_CONNECTIONS.filter(road => road.points.at(-1)[1] < 1)) {
    const side = CITY_END_ROADS.find(road => road.id === from);
    const deck = side ? { points: side.points, widths: 3.4 }
      : { points: cityRoadPoints(from, 0, CITY_FREEWAY_HEIGHT), widths: 7.6 };
    for (const [x, y, z] of points) {
      if (cityRoadOpening([x, CITY_FREEWAY_HEIGHT, z], [deck], .58)) {
        assert.ok(CITY_FREEWAY_HEIGHT - y < .035, id + ' drops before clearing the adjacent deck');
      }
    }
  }
});

test('pedestrians maintain the same pace on long and short sidewalks and turn in place', () => {
  for (const length of [10, 30]) {
    const sidewalk = createTrafficPath([[0, .135, 1.2], [length, .135, 1.2]]);
    const walking = pedestrianPose(sidewalk, 3, .9, 0);
    assert.ok(Math.abs(walking.position[0] - 2.7) < .00001);
    assert.deepEqual(walking.position.slice(1), [.135, 1.2]);
    const endTime = length / .9, end = pedestrianPose(sidewalk, endTime, .9, 0);
    const turning = pedestrianPose(sidewalk, endTime + .35, .9, 0);
    const returning = pedestrianPose(sidewalk, endTime + 1.7, .9, 0);
    assert.deepEqual(turning.position, end.position);
    assert.equal(turning.stride, 0);
    assert.ok(Math.abs(turning.yaw - end.yaw - Math.PI / 2) < .00001);
    assert.ok(Math.abs(returning.position[0] - (length - .9)) < .00001);
  }
});

test('district walkers wait at the curb and drivers yield while they cross', () => {
  const loop = createPedestrianCircuit([[-2, .12, -3], [-2, .12, 0], [2, .12, 0], [2, .12, -3], [-2, .12, -3]], [1, 3]);
  const curb = loop.crossings[0].start;
  const approaching = { position: [-.8, .11, -2], heading: [0, 0, 1], speed: 3, active: true };
  const waiting = advancePedestrianCircuit(loop, { distance: curb - .02, walked: 0 }, .05, 1, [approaching]);
  assert.equal(waiting.distance, curb);
  assert.equal(waiting.crossing, false);
  const walking = advancePedestrianCircuit(loop, waiting, .05, 1, []);
  assert.ok(walking.distance > curb && walking.crossing);
  const crossing = { id: 'walker', position: [13, .11, .55], heading: [0, 0, 1], speed: 1, active: true, pedestrian: true };
  const stopped = step(vehicle({ speed: 2 }), 80, { others: [crossing] });
  assert.equal(stopped.status, 'crosswalk');
  assert.ok(stopped.distance <= 11.001 && stopped.speed === 0);
  assert.equal(stopped.accidentCount || 0, 0);
  assert.ok(step(stopped, 30).distance > stopped.distance);
});
