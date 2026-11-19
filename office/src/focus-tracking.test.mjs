import { automaticCommandAllowed, readFocusSettings } from './focus-studio-model.mjs';
import { selectPhoneConfig } from './useOfficeFocus.js';
import { addPageStalls, deviceBattery, deviceConnection, diagnosticOptions, diagnosticReport, requestDiagnosticResponse, storageEstimate } from './focus-device-health.mjs';
import { livePinTargets, LOCAL_PIN_SOURCE, nextPinExpiry, readLivePins, resolveLivePin } from './focus-live-pins.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geoAzimuthalEquidistant, geoOrthographic } from 'd3-geo';
import { dragMap, GLOBE_RADIUS, MAP_CENTER, screenBasis } from './focus-map.mjs';
import { appendWalkFix, createWalk, interruptWalk, reviewWalk } from './focus-walk.mjs';
import { appendRouteFix, assessTrackingFix, csvCell, exportTrip, readTrackingSettings, recentTrips, redactTrip, routeStats, trackingFixGap } from './focus-tracking.mjs';

const point = (longitude, timestamp, overrides = {}) => ({ latitude: 0, longitude, timestamp, accuracy: 3, ...overrides });

test('ground-travel checks reject jumps and bad data without inventing a route across a gap', () => {
  const now = 100000;
  const last = point(-122, now - 5000);
  assert.equal(assessTrackingFix(last, point(-121.999, now), 150, now), '');
  assert.equal(assessTrackingFix(last, point(151, now), 150, now), 'jump');
  assert.equal(assessTrackingFix(last, point(-122, now, { accuracy: 151 }), 150, now), 'accuracy');
  assert.equal(assessTrackingFix(last, point(-122, last.timestamp), 150, now), 'order');
  assert.equal(assessTrackingFix(last, point(-122, now - 25000), 150, now), 'invalid');
  assert.equal(assessTrackingFix(last, point(-122, now + 3000), 150, now), 'invalid');
  assert.equal(assessTrackingFix(last, { ...point(-122, now), latitude: NaN }, 150, now), 'invalid');
  assert.equal(assessTrackingFix(point(179.9999, now - 5000), point(-179.9999, now), 150, now), '');
  assert.equal(assessTrackingFix(point(-122, now - 30000), point(151, now), 150, now), '', 'a gap establishes a new baseline');
  const settings = readTrackingSettings({ minMeters: 0, minSeconds: 1 });
  const route = appendRouteFix([], point(0, now - 5000, { accuracy: 20 }), settings, 1);
  assert.equal(appendRouteFix(route, point(0.0001, now, { accuracy: 20 }), settings, 1), route,
    'stationary uncertainty must not inflate recorded distance');
});

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

test('guided walks start from a precise live fix within the GPS pin uncertainty', () => {
  const pin = point(0.0002, 0, { accuracy: 25 });
  const fix = point(0, 4000);
  for (const mode of ['route', 'boundary']) {
    const walk = { ...createWalk(mode), phase: 'walking', startedAt: 1000, pin };
    const coarse = appendWalkFix(walk, point(0.0005, 2000, { accuracy: 80 }));
    assert.equal(coarse.signal, 'accuracy');
    assert.equal(coarse.points.length, 0);
    const distant = appendWalkFix(coarse, point(0.001, 3000));
    assert.equal(distant.signal, 'start');
    assert.equal(distant.points.length, 0);
    const started = appendWalkFix(distant, fix);
    assert.equal(started.signal, '');
    assert.deepEqual(started.points, [{ ...fix, segment: 1, startsSegment: true }]);

    const manual = appendWalkFix({ ...walk, pin: { ...pin, accuracy: 0 } }, fix);
    assert.equal(manual.signal, 'start');
    assert.equal(manual.points.length, 0);
    const wide = appendWalkFix({ ...walk, pin: { ...pin, accuracy: 80 } }, point(0.0007, 4000));
    assert.equal(wide.signal, 'start');
    assert.equal(wide.points.length, 0);
  }
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
  assert.equal(older.timeStop, false);
  assert.equal(older.distanceStop, false);
  assert.equal(readTrackingSettings({ stopMinutes: 15, stopMeters: 100 }).timeStop, false,
    'old numeric limits do not silently opt a session into automatic stops');
  const custom = readTrackingSettings({ profile: 'custom', interval: 60, timeoutSeconds: 99, stopMinutes: -5,
    minSeconds: '8', minMeters: 0, custom: { maxAccuracy: 0, highAccuracy: false } });
  assert.equal(custom.interval, 60);
  assert.equal(custom.timeoutSeconds, 60);
  assert.equal(custom.stopMinutes, 0);
  assert.equal(custom.minSeconds, 5);
  assert.equal(custom.minMeters, 0);
  assert.deepEqual(custom.custom, { maxAccuracy: 1, highAccuracy: false });
});

test('automatic command permissions persist and disabled phone rules remain excluded from arbitration', () => {
  const load = input => readFocusSettings({ getItem: () => JSON.stringify(input) });
  const settings = load({ commands: { enabled: true, actions: { stopTracking: false } },
    zones: [{ id: 'home', name: 'Home', center: { latitude: 0, longitude: 0, accuracy: 0 }, radius: 250,
      enabled: true, rules: { exit: 'stopTracking' } }], fence: { enter: 'start', exit: 'quiet' } });
  assert.equal(automaticCommandAllowed(settings, 'stopTracking'), false);
  assert.equal(automaticCommandAllowed(settings, 'start'), true);
  let config = selectPhoneConfig(settings).config;
  assert.equal(config.zones[0].rules.exit, 'off');
  assert.equal(config.zones[0].rules.enter, 'start');
  const disabled = load({ ...settings, commands: { ...settings.commands, enabled: false } });
  config = selectPhoneConfig(disabled).config;
  assert.equal(config.fence.enter, 'off');
  assert.equal(config.fence.exit, 'off');
  assert.deepEqual(config.zones[0].rules, { enter: 'off', exit: 'off' });
  assert.equal(disabled.zones[0].rules.exit, 'stopTracking', 'saved rules remain available to re-enable');
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

test('device reports retain browser estimates and treat unavailable readings as unknown', () => {
  assert.equal(deviceConnection(null), null);
  assert.deepEqual(deviceConnection({ effectiveType: '4g', rtt: 0, downlink: 15, saveData: true }, 100),
    { type: '4g', rtt: 0, downlink: 15, saveData: true, observedAt: 100 });
  assert.deepEqual(deviceConnection({ effectiveType: 'tracking', rtt: NaN, downlink: -3 }, 100),
    { type: 'Unavailable', rtt: null, downlink: null, saveData: false, observedAt: 100 });
  assert.equal(deviceBattery({ level: -1 }), null);
  assert.equal(deviceBattery({ level: NaN }), null);
  assert.deepEqual(deviceBattery({ level: 0, charging: false }, 100), { percent: 0, charging: false, observedAt: 100 });
  assert.deepEqual(deviceBattery({ level: 0.42, charging: true }, 100), { percent: 42, charging: true, observedAt: 100 });
  assert.deepEqual(addPageStalls({ count: 1, totalMs: 50, worstMs: 50 },
    [{ duration: 20 }, { duration: NaN }, { duration: 80 }, { duration: 120 }]), { count: 3, totalMs: 250, worstMs: 120 });
});

test('diagnostic exports exclude location coordinates and authentication credentials', () => {
  const report = diagnosticReport({ active: true, visible: true, lastAcceptedAt: 100,
    liveFix: { latitude: 35.1234, longitude: -80.1234 }, diagnostics: {
      online: false, permissions: { geolocation: 'denied' }, events: [{ at: 100, code: 'GPS_ERROR_1', message: 'Permission denied.', token: 'secret' }],
    } }, { sharing: 'Sharing live GPS', publisher: 'secret', connection: { status: 503, latency: 150, successAt: 99, attemptedAt: 100, token: 'secret' } }, {
      options: { network: true, battery: false, performance: true }, performanceSupported: true,
      connection: { type: '4g', rtt: 100, downlink: 10, observedAt: 100 },
      stalls: { count: 2, totalMs: 150, worstMs: 100, token: 'secret' },
    }, 1000);
  assert.equal(report.permissions.microphone, 'unknown');
  assert.equal(report.officeConnection.status, 503);
  assert.equal(report.browserNetworkEstimate.type, '4g');
  assert.equal(report.batteryReport, null);
  assert.equal(report.deviceReportsOnline, false);
  assert.equal(report.sharing, true);
  const serialized = JSON.stringify(report);
  for (const forbidden of ['35.1234', '-80.1234', 'secret', 'publisher', 'token']) assert.ok(!serialized.includes(forbidden), forbidden);
});

test('live pins follow source IDs across movement and never switch to another device with the same label', () => {
  const now = 100000, fix = longitude => ({ latitude: 0, longitude, accuracy: 2, timestamp: now });
  const tracking = { active: true, visible: true, liveFix: fix(1) };
  const devices = { viewing: true, sources: [
    { id: 'car-a', name: 'Car phone', fix: fix(2) }, { id: 'car-b', name: 'Car phone', fix: fix(3) },
  ] };
  const pin = { id: 'pin-a', sourceId: 'car-a', name: 'Car phone', paused: false };
  assert.equal(resolveLivePin(pin, livePinTargets(tracking, devices, now), tracking, devices, now).fix.longitude, 2);
  devices.sources[0].fix = fix(2.001);
  assert.equal(resolveLivePin(pin, livePinTargets(tracking, devices, now), tracking, devices, now).fix.longitude, 2.001);
  devices.sources.shift();
  const missing = resolveLivePin(pin, livePinTargets(tracking, devices, now), tracking, devices, now);
  assert.equal(missing.fix, null);
  assert.equal(missing.status, 'Waiting for fresh GPS');
});

test('live pins stop displaying current positions on pause, hidden pages, expiry and revoked viewing', () => {
  const now = 100000, fix = { latitude: 0, longitude: 0, accuracy: 2, timestamp: now };
  const tracking = { active: true, visible: true, liveFix: fix };
  const devices = { viewing: true, sources: [{ id: 'phone', name: 'Phone', fix }] };
  const pin = { id: 'pin', sourceId: 'phone', paused: false };
  const resolve = (candidate = pin, at = now) => resolveLivePin(candidate, livePinTargets(tracking, devices, at), tracking, devices, at);
  assert.equal(nextPinExpiry(livePinTargets(tracking, devices, now), now), now + 25000);
  assert.equal(resolve({ ...pin, paused: true }).status, 'Paused');
  assert.equal(resolve(pin, now + 25000).fix, null);
  tracking.visible = false;
  assert.equal(resolve().status, 'Page hidden');
  assert.equal(resolve().fix, null);
  tracking.visible = true; devices.viewing = false;
  assert.equal(resolve().status, 'Shared viewing off');
  assert.equal(resolve().fix, null);
  devices.viewing = true; tracking.paused = true;
  assert.equal(resolve({ ...pin, sourceId: LOCAL_PIN_SOURCE }).status, 'GPS paused');
  tracking.paused = false; tracking.active = false;
  assert.equal(resolve({ ...pin, sourceId: LOCAL_PIN_SOURCE }).status, 'GPS off');
});

test('saved live pin bindings restore paused without coordinates or credentials', () => {
  const pins = readLivePins([{ id: 'p', sourceId: 's', name: 'Phone', paused: false,
    fix: { latitude: 10 }, token: 'secret' }, { id: 'p', sourceId: 'duplicate' }, null]);
  assert.deepEqual(pins, [{ id: 'p', sourceId: 's', name: 'Phone', paused: true }]);
  assert.deepEqual(readLivePins({}), []);
});

test('storage and diagnostic choices keep unknown values distinct and exports exclude page error details', () => {
  assert.deepEqual(diagnosticOptions({ battery: 'yes', storage: true }), {
    network: true, battery: false, performance: false, storage: true, errors: false,
  });
  assert.equal(storageEstimate({ usage: 100, quota: 0 }), null);
  assert.equal(storageEstimate({ usage: 1000, quota: 100 }), null);
  assert.deepEqual(storageEstimate({ usage: 0, quota: 1024 }, undefined, 100), {
    usage: 0, quota: 1024, percent: 0, persisted: null, observedAt: 100,
  });
  const report = diagnosticReport({}, {}, { options: { storage: true, errors: true },
    storage: { usage: 10, quota: 100, percent: 10, persisted: false, observedAt: 1, secret: 'private' },
    errors: { script: 1, promise: 2, lastAt: 1, stack: 'private' },
  });
  assert.equal(report.pageErrors.promise, 2);
  assert.equal(report.siteStorage.percent, 10);
  assert.ok(!JSON.stringify(report).includes('private'));
});

test('diagnostic deadlines bound a transport that ignores abort and discard its late response', async () => {
  let resolveRequest, options, cancelled = 0;
  const request = (_url, value) => { options = value; return new Promise(resolve => { resolveRequest = resolve; }); };
  await assert.rejects(requestDiagnosticResponse(request, '/office/focus/live', { timeoutMs: 20 }), /timed out/);
  assert.equal(options.reauthorize, false);
  assert.equal(options.signal.aborted, true);
  resolveRequest({ body: { cancel: async () => { cancelled++; } } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(cancelled, 1);
  const controller = new AbortController();
  controller.abort(new Error('Cancelled by caller'));
  let calls = 0;
  await assert.rejects(requestDiagnosticResponse(() => { calls++; }, '/office/focus/live', { signal: controller.signal }), /Cancelled by caller/);
  assert.equal(calls, 0);
});
