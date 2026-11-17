import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geoAzimuthalEquidistant, geoOrthographic } from 'd3-geo';
import { dragMap, GLOBE_RADIUS, MAP_CENTER, screenBasis } from './focus-map.mjs';
import { appendWalkFix, createWalk, interruptWalk, reviewWalk } from './focus-walk.mjs';
import { appendRouteFix, csvCell, exportTrip, readTrackingSettings, recentTrips, redactTrip, routeStats, trackingFixGap } from './focus-tracking.mjs';

const point = (longitude, timestamp, overrides = {}) => ({ latitude: 0, longitude, timestamp, accuracy: 3, ...overrides });

test('globe drags stay on the same coordinates across the poles and during pinch zoom', () => {
  const camera = [170, 85, 0];
  const last = [230, 174];
  const next = dragMap(camera, MAP_CENTER, last, GLOBE_RADIUS, GLOBE_RADIUS, false);
  assert.ok(next[1] < 85);
  assert.ok(Math.abs(next[0] + 10) < 1e-8);

  for (const flat of [false, true]) {
    const start = [251, 155], end = [262, 171];
    const adjusted = dragMap(next, start, end, GLOBE_RADIUS, GLOBE_RADIUS * 2, flat);
    const projection = (view, scale) => (flat ? geoAzimuthalEquidistant() : geoOrthographic())
      .scale(flat ? scale * 2 / Math.PI : scale).translate(MAP_CENTER).rotate([-view[0], -view[1], view[2]]);
    const anchor = projection(next, GLOBE_RADIUS).invert(start);
    const actual = projection(adjusted, GLOBE_RADIUS * 2)(anchor);
    assert.ok(Math.hypot(actual[0] - end[0], actual[1] - end[1]) < 1e-7);
    if (flat) continue;
    const [x, y, z] = screenBasis(adjusted);
    const [lon, lat] = anchor.map(value => value * Math.PI / 180);
    const direction = [Math.cos(lon) * Math.cos(lat), Math.sin(lon) * Math.cos(lat), Math.sin(lat)];
    const dot = basis => basis.reduce((sum, value, index) => sum + value * direction[index], 0);
    assert.ok(dot(z) > 0);
    assert.ok(Math.abs(MAP_CENTER[0] + 2 * GLOBE_RADIUS * dot(x) - end[0]) < 1e-7);
    assert.ok(Math.abs(MAP_CENTER[1] - 2 * GLOBE_RADIUS * dot(y) - end[1]) < 1e-7);
  }
});

test('walking a route filters old or uncertain fixes and splits missing sections', () => {
  const pin = point(0, 0);
  let walk = { ...createWalk('route'), phase: 'walking', startedAt: 1000, pin };
  assert.equal(appendWalkFix(walk, point(0, 999)), walk);
  walk = appendWalkFix(walk, point(0, 1000, { accuracy: 45 }));
  assert.equal(walk.signal, 'accuracy');
  walk = appendWalkFix(walk, point(0.002, 2000));
  assert.equal(walk.signal, 'start');
  walk = appendWalkFix(walk, point(0, 3000));
  walk = appendWalkFix(walk, point(0.0003, 6000));
  walk = interruptWalk(walk, 'hidden');
  assert.equal(appendWalkFix(walk, point(0.0015, 10000)), walk);
  walk = appendWalkFix({ ...walk, phase: 'walking', startedAt: 11000 }, point(0.002, 11000));
  walk = appendWalkFix(walk, point(0.0022, 14000));
  assert.deepEqual(reviewWalk(walk).points.map(location => location.startsSegment), [true, false, true, false]);
});

test('walked geofences require a closed outline, reject crossing and rejoin at the last point after a gap', () => {
  const a = point(179.9998, 1000);
  const b = point(-179.9998, 4000);
  const c = point(-179.9998, 7000, { latitude: 0.0004 });
  const d = point(179.9998, 10000, { latitude: 0.0004 });
  const end = { ...a, timestamp: 13000 };
  const walk = [a, b, c, d].reduce(appendWalkFix, { ...createWalk('boundary'), phase: 'walking' });
  assert.match(reviewWalk(walk).error, /return/i);
  const gap = appendWalkFix({ ...walk, lastFix: null }, { ...a, timestamp: 40000 });
  assert.equal(gap.signal, 'rejoin');
  assert.equal(gap.points, walk.points);
  const back = appendWalkFix(gap, { ...d, timestamp: 43000 });
  const outline = reviewWalk(appendWalkFix(back, { ...end, timestamp: 46000 }));
  assert.equal(outline.shape, 'polygon');
  assert.deepEqual(outline.vertices.map(vertex => vertex.longitude), [179.9998, -179.9998, -179.9998, 179.9998]);
  assert.match(reviewWalk({ mode: 'boundary', points: [a, c, b, d, end] }).error, /crosses/);
});

test('tracking settings validate older saved settings, profile choices and limits', () => {
  const older = readTrackingSettings({ background: true });
  assert.equal(older.profile, 'balanced');
  assert.equal(older.background, true);
  const custom = readTrackingSettings({ profile: 'custom', interval: 60, timeoutSeconds: 99, stopMinutes: -5,
    minSeconds: '8', minMeters: 0, custom: { maxAccuracy: 0, highAccuracy: false } });
  assert.equal(custom.interval, 60);
  assert.equal(custom.timeoutSeconds, 60);
  assert.equal(custom.stopMinutes, 0);
  assert.equal(custom.minSeconds, 5);
  assert.equal(custom.minMeters, 0);
  assert.deepEqual(custom.custom, { maxAccuracy: 1, highAccuracy: false });
});

test('route capture filters uncertain readings and does not join paused segments', () => {
  const settings = readTrackingSettings({ profile: 'precise', minSeconds: 5, minMeters: 20 });
  let track = appendRouteFix([], point(0, 1000, { altitude: 10 }), settings, 1);
  assert.equal(appendRouteFix(track, point(0.1, 10000, { accuracy: 100 }), settings, 1), track);
  assert.equal(appendRouteFix(track, point(0.002, 4000), settings, 1), track);
  assert.equal(appendRouteFix(track, point(0.00001, 6000), settings, 1), track);
  track = appendRouteFix(track, point(0.003, 6000, { altitude: 19, speed: 5 }), settings, 1);
  track = appendRouteFix(track, point(0.1, 7000, { altitude: 1 }), settings, 2);
  const stats = routeStats(track);
  assert.equal(track.length, 3);
  assert.ok(stats.distance > 300 && stats.distance < 350);
  assert.equal(stats.durationMs, 5000);
  assert.equal(stats.movingMs, 5000);
  assert.equal(stats.climb, 9);
  assert.equal(stats.peak, 5);
});

test('privacy export hides readings and waypoints near each endpoint and splits gaps', () => {
  const points = [0, 0.004, 0.001, 0.012, 0.016].map((longitude, i) => point(longitude, 1000 + 1000 * i));
  const result = redactTrip(points, [point(0.0001, 1000), point(0.009, 1000)], 250);
  assert.deepEqual(result.points.map(point => point.longitude), [0.004, 0.012]);
  assert.ok(result.points[1].startsSegment);
  assert.deepEqual(result.waypoints.map(point => point.longitude), [0.009]);
  assert.deepEqual(redactTrip([], result.waypoints, 250), { points: [], waypoints: [] });
  const trip = { ...result, name: 'Office & errands', waypoints: [{ ...result.waypoints[0], name: '=test', note: 'A & B' }] };
  assert.match(exportTrip('gpx', trip).data, /Office &amp; errands/);
  assert.match(exportTrip('gpx', trip).data, /<desc>A &amp; B<\/desc>/);
  assert.match(exportTrip('kml', trip).data, /<MultiGeometry>/);
  assert.equal(JSON.parse(exportTrip('geojson', trip).data).features.length, 3);
  assert.match(exportTrip('csv', trip).data, /"'=test"/);
  assert.equal(csvCell(-10), '"-10"');
  assert.equal(csvCell('+cmd'), '"\'+cmd"');
});

test('slower location refresh intervals allow connected route samples', () => {
  const settings = readTrackingSettings({ interval: 60 });
  assert.equal(trackingFixGap(settings), 72000);
  const opening = appendRouteFix([], point(0, 1000), settings, 1);
  const route = appendRouteFix(opening, point(0.003, 61000), settings, 1);
  assert.equal(route[1].startsSegment, false);
  assert.equal(routeStats(route).durationMs, 60000);
});

test('saved route retention removes expired or excess trips', () => {
  const now = 100 * 86400000;
  const trips = Array.from({ length: 25 }, (_, i) => ({ id: String(i), savedAt: now - i * 86400000 }));
  assert.equal(recentTrips(trips, 0, now).length, 20);
  assert.deepEqual(recentTrips(trips, 1, now).map(t => t.id), ['0', '1']);
});
