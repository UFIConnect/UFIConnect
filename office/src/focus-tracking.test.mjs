import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendRouteFix, csvCell, exportTrip, readTrackingSettings, recentTrips, redactTrip, routeStats, trackingFixGap } from './focus-tracking.mjs';

const point = (longitude, timestamp, overrides = {}) => ({ latitude: 0, longitude, timestamp, accuracy: 3, ...overrides });

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
