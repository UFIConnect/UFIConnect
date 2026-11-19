import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  advanceMovement, advancePlannedRoute, advanceVehicle, directionsLink, emptyMovement, gridCell, gridGeometry, gridVisitors,
  matchMessage, messageRule, movementPlace, movementSettings, nextMessage, normalizePhone, pointFromFields, startPlannedRoute,
} from './focus-movement.mjs';
import {
  adjacentGridCell, exportGridHistory, filterGridHistory, GRID_STEPS, gridCellFromId, gridCellInfo, gridOptions,
  gridPolygon, gridStep, savedGridCells, selectGridVisitors,
} from './focus-grid.mjs';

const fix = (longitude, timestamp, extra = {}) => ({ latitude: 0.0005, longitude, accuracy: 2, timestamp, ...extra });
const office = movementPlace({ id: 'office', name: 'Office', address: '10 Example Street',
  center: fix(0.0025, 0), radius: 30, dwellMinutes: 1 });

test('grid visitors come only from fresh shared-device observations and retain uncertainty', () => {
  const now = 100000;
  const source = { id: 'phone', name: 'My phone', kind: 'phone', fix: fix(0.0005, now) };
  const sources = [source, { ...source, id: 'expired', fix: fix(0.0005, now - 25000) },
    { ...source, id: 'invalid', fix: { ...source.fix, longitude: NaN } },
    { ...source, id: 'edge', fix: fix(0.000001, now) },
    { ...source, id: 'other', fix: fix(0.0025, now) }];
  const visitors = gridVisitors(sources, 0.001, now, gridCell(source.fix, 0.001).id);
  assert.deepEqual(visitors.map(item => item.id), ['phone', 'edge']);
  assert.equal(visitors[0].cell.reliable, true);
  assert.equal(visitors[1].cell.reliable, false);
  assert.equal(visitors[0].identity, undefined, 'a device label does not identify a person');
  assert.equal(visitors[0].ageSeconds, 0);
  let movement = advanceMovement(emptyMovement(), source.fix, [], 0.001).movement;
  movement = advanceMovement(movement, { ...source.fix, timestamp: now + 5000 }, [], 0.001).movement;
  assert.equal(movement.cellVisits.length, 1);
  assert.equal(movement.cellVisits[0].firstAt, now);
  assert.equal(movement.cellVisits[0].lastAt, now + 5000);
  assert.equal(movement.cellVisits[0].samples, 2);
  movement = advanceMovement(movement, fix(0.0025, now + 10000), [], 0.001).movement;
  assert.equal(movement.cellVisits.length, 1, 'pending crossings are not recorded as visits');
});

test('phone identifiers and saved locations retain only valid fields', () => {
  assert.equal(normalizePhone('+1 (555) 010-0123'), '+15550100123');
  assert.equal(normalizePhone('555-010-0123'), '');
  assert.equal(pointFromFields('', '0'), null);
  assert.equal(pointFromFields(null, '0'), null);
  assert.deepEqual(pointFromFields('0', '180'), { latitude: 0, longitude: 180, accuracy: 0 });
  const settings = movementSettings({ places: [office, { ...office }, { ...office, id: 'invalid', center: { latitude: 100 } }],
    profiles: [{ id: 'one', name: 'Delivery van', kind: 'vehicle', type: 'van', phone: '+15550100123', rawLocation: {} }],
    stops: ['office', 'unknown', 'office'] });
  assert.deepEqual(settings.places, [office]);
  assert.deepEqual(settings.stops, ['office', 'office']);
  assert.equal(settings.profiles[0].rawLocation, undefined);
  assert.equal(settings.profiles[0].phone, '+15550100123');
});

test('address arrival, dwell, and departure use confirmed live positions', () => {
  let state = emptyMovement();
  const sample = fix => {
    const result = advanceMovement(state, fix, [office], 0.001);
    state = result.movement;
    return result.events.map(event => event.kind);
  };
  assert.deepEqual(sample(fix(0.0005, 10_000)), []);
  assert.equal(state.places.office.relation, 'outside');
  assert.deepEqual(sample(fix(0.0025, 20_000, { accuracy: 100 })), []);
  assert.equal(state.places.office.relation, 'edge');
  assert.deepEqual(sample(fix(0.0025, 30_000)), ['arrival']);
  for (const timestamp of [40_000, 60_000, 80_000]) sample(fix(0.0025, timestamp));
  assert.ok(sample(fix(0.0025, 90_000)).includes('dwell'));
  assert.deepEqual(sample(fix(0.0025, 100_000)), []);
  assert.ok(sample(fix(0.0005, 110_000)).includes('departure'));
  assert.ok(!sample(fix(0.0025, 150_000)).includes('arrival'), 'a signal gap starts a new baseline');
  assert.deepEqual(sample(fix(0.0005, 130_000)), [], 'out-of-order GPS is ignored');
});

test('grid crossings require two reliable fixes and wrap across the date line', () => {
  const east = fix(179.9995, 1), west = fix(-179.9995, 2);
  let result = advanceMovement(emptyMovement(), east, [], 0.001);
  const initial = result.movement.grid.id;
  result = advanceMovement(result.movement, fix(-179.99999, 2), [], 0.001);
  assert.equal(result.movement.grid.id, initial);
  assert.equal(result.movement.pendingGrid, null);
  result = advanceMovement(result.movement, { ...west, timestamp: 3 }, [], 0.001);
  assert.equal(result.movement.grid.id, initial);
  assert.equal(result.events.length, 0);
  result = advanceMovement(result.movement, { ...west, timestamp: 4 }, [], 0.001);
  assert.equal(result.movement.grid.id, gridCell(west, 0.001).id);
  assert.equal(result.movement.crossings, 1);
  assert.equal(result.movement.visited.length, 2);
  assert.equal(result.events[0].kind, 'grid');
  assert.equal(gridCell(fix(180, 10), 0.001).id, gridCell(fix(-180, 100), 0.001).id);
  assert.ok(gridGeometry(gridCell(east, 0.001), 2).coordinates.flat().every(([lon]) => Math.abs(lon) <= 180));
});

test('grid options migrate existing settings, reject invalid values and retain saved cells safely', () => {
  const old = movementSettings({ grid: 'detail' });
  assert.equal(gridStep(old), 0.001);
  assert.equal(old.gridOptions.confirmations, 2);
  assert.equal(old.gridOptions.enabled, true);
  assert.deepEqual(old.savedCells, []);
  const cell = gridCell(fix(0.0005, 1), 0.001);
  const saved = { cellId: cell.id, step: cell.step, name: ' Home ', note: ' Entrance ', token: 'secret' };
  const custom = movementSettings({ grid: 'custom', gridOptions: { customStep: 0.007, confirmations: 5, showLines: false }, savedCells: [saved, saved] });
  assert.equal(gridStep(custom), 0.007);
  assert.equal(custom.gridOptions.confirmations, 5);
  assert.equal(custom.gridOptions.showLines, false);
  assert.deepEqual(custom.savedCells, [{ cellId: cell.id, step: 0.001, name: 'Home', note: 'Entrance' }]);
  assert.deepEqual(savedGridCells([{ ...saved, cellId: '0-1' }, { ...saved, step: NaN }, { ...saved, name: '' }]), []);
  assert.deepEqual(gridOptions({ customStep: 0, color: 'unknown', confirmations: 1, neighbors: Infinity }), gridOptions());
});

test('all grid sizes and custom partial cells stay in world bounds at the poles and date line', () => {
  for (const step of [...Object.values(GRID_STEPS), 0.007]) {
    for (const latitude of [-90, -89.999999, 0.0005, 89.999999, 90]) {
      for (const longitude of [-180, -179.999999, 0.0005, 179.999999, 180]) {
        const cell = gridCell({ latitude, longitude, accuracy: 0 }, step);
        const parsed = gridCellFromId(cell.id, step);
        assert.equal(parsed.south, cell.south);
        assert.equal(parsed.west, cell.west);
        const info = gridCellInfo(cell);
        assert.ok(info.north <= 90 && info.east <= 180);
        assert.ok(info.width >= 0 && info.height > 0);
        const points = gridGeometry(cell, 11).coordinates.flat();
        assert.ok(points.every(([lon, lat]) => lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90));
        assert.ok(points.every(([lon]) => Math.abs((lon + 180) / step - Math.round((lon + 180) / step)) < 0.00001));
        assert.ok(gridPolygon(cell).coordinates[0].every(([lon, lat]) => lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90));
      }
    }
  }
  assert.equal(gridCell(fix(0, 1), 0), null);
  assert.equal(gridCell(fix(0, 1, { latitude: 91 }), 0.001), null);
  assert.equal(gridCellFromId('9999999-1', 0.001), null);
  assert.equal(gridCellFromId('1-0', 0.001), null);
  assert.equal(gridCellFromId('1-1.5', 0.001), null);
  assert.equal(gridCellFromId('1-1', Infinity), null);
  const equator = gridCellInfo(gridCell(fix(0.0005, 1), 0.001));
  const north = gridCellInfo(gridCell(fix(0.0005, 1, { latitude: 60.0005 }), 0.001));
  assert.ok(north.width < equator.width * 0.51 && north.width > equator.width * 0.49);
});

test('configurable crossings need consecutive reliable readings and never bridge a signal gap', () => {
  const options = gridOptions({ confirmations: 3 });
  let movement = emptyMovement();
  const sample = (longitude, timestamp, accuracy = 2) => {
    const result = advanceMovement(movement, fix(longitude, timestamp, { accuracy }), [], 0.001, options);
    movement = result.movement;
    return result.events;
  };
  sample(0.0005, 1000);
  sample(0.0015, 2000);
  assert.equal(movement.pendingSamples, 1);
  sample(0.0015, 3000);
  assert.equal(movement.pendingSamples, 2);
  sample(0.001001, 4000);
  assert.equal(movement.pendingSamples, 0, 'uncertain membership breaks confirmation');
  sample(0.0015, 5000);
  sample(0.0015, 6000);
  assert.equal(sample(0.0015, 7000)[0].kind, 'grid');
  assert.equal(movement.crossings, 1);
  sample(0.0025, 8000);
  sample(0.0025, 9000);
  assert.deepEqual(sample(0.0025, 40000), [], 'a gap establishes a baseline without a crossing');
  assert.equal(movement.crossings, 1);
});

test('grid switches leave address monitoring intact and observed time excludes uncertainty and gaps', () => {
  let movement = emptyMovement();
  const sample = (point, options = gridOptions()) => {
    const result = advanceMovement(movement, point, [office], 0.001, options);
    movement = result.movement;
    return result.events;
  };
  sample(fix(0.0005, 1000));
  sample(fix(0.0005, 6000));
  assert.equal(movement.cellVisits[0].observedMs, 5000);
  sample(fix(0.000001, 7000));
  sample(fix(0.0005, 8000));
  sample(fix(0.0005, 40000));
  assert.equal(movement.cellVisits[0].observedMs, 5000);
  const muted = gridOptions({ events: false });
  sample(fix(0.0015, 41000), muted);
  assert.deepEqual(sample(fix(0.0015, 42000), muted), []);
  assert.equal(movement.crossings, 1, 'event switch does not disable counting');
  const count = movement.cellVisits.length;
  const events = sample(fix(0.0025, 43000), gridOptions({ enabled: false }));
  assert.equal(movement.cellVisits.length, count);
  assert.ok(events.some(event => event.kind === 'arrival'), 'address tracking is independent of grid tracking');
});

test('visitor filters wrap neighboring columns and sort only accepted shared sources', () => {
  const now = 100000;
  const source = (id, longitude, extra = {}) => ({ id, name: id, kind: 'phone', fix: fix(longitude, now, extra) });
  const raw = [source('Alpha', 179.9995), source('Beta', -179.9995, { timestamp: now - 1000 }),
    source('Edge', -179.999999), { ...source('Computer', -179.9995), kind: 'computer' }, source('Far', -179.9975)];
  const target = gridCell(raw[0].fix, 0.001);
  const sources = gridVisitors(raw, 0.001, now);
  assert.equal(adjacentGridCell(sources[1].cell, target), true);
  const options = gridOptions({ visitorScope: 'neighbors', visitorKind: 'phone', visitorCertainty: 'reliable', visitorSort: 'name' });
  assert.deepEqual(selectGridVisitors(sources, options, target).map(item => item.name), ['Alpha', 'Beta']);
  assert.deepEqual(selectGridVisitors(sources, options, target, 'beta').map(item => item.name), ['Beta']);
  assert.deepEqual(selectGridVisitors(sources, gridOptions({ visitorScope: 'all', visitorSort: 'distance' }), null, '', raw[1].fix).map(item => item.name).slice(0, 2), ['Beta', 'Computer']);
  assert.deepEqual(gridVisitors(raw, 0.001, now + 25000), [], 'expired devices cannot reappear through a filter');
});

test('history exports honor the filtered cells and include bounded geometry without credentials', () => {
  let movement = emptyMovement();
  for (const [longitude, timestamp] of [[0.0005, 1000], [0.0005, 6000], [0.0015, 7000], [0.0015, 8000]]) {
    movement = advanceMovement(movement, fix(longitude, timestamp), [], 0.001).movement;
  }
  const history = filterGridHistory(movement.cellVisits, { search: '', sort: 'time', now: 9000 });
  assert.equal(history[0].observedMs, 5000);
  assert.deepEqual(filterGridHistory(history, { minutes: 5, now: 400000 }), []);
  const selected = filterGridHistory(history, { search: history[1].cell.id, now: 9000 });
  assert.equal(selected.length, 1);
  const metadata = { source: 'this-device', step: 0.001, now: 9000 };
  const json = JSON.parse(exportGridHistory(selected, { ...metadata, format: 'json' }).data);
  assert.equal(json.cells[0].cell, selected[0].cell.id);
  assert.equal(json.cells[0].accuracyMeters, 2);
  assert.ok(!JSON.stringify(json).includes('token'));
  const csv = exportGridHistory(selected, { ...metadata, format: 'csv' }).data.split('\r\n');
  assert.equal(csv.length, 2);
  assert.equal(csv[0].split(',').length, csv[1].split(',').length);
  const geojson = JSON.parse(exportGridHistory(selected, { ...metadata, format: 'geojson' }).data);
  assert.equal(geojson.features.length, 1);
  assert.equal(geojson.features[0].geometry.type, 'Polygon');
  assert.deepEqual(geojson.features[0].geometry.coordinates[0][0], geojson.features[0].geometry.coordinates[0].at(-1));
});

test('route follows ordered stops, confirms a deviation twice, and builds a mobile-safe directions link', () => {
  const start = fix(0.0005, 10_000);
  const store = { ...office, id: 'store', name: 'Store', center: fix(0.0055, 10_000) };
  let route = startPlannedRoute(start, [office, store], 25);
  const first = advancePlannedRoute(route, fix(0.0015, 20_000, { latitude: 0.0025 }));
  assert.equal(first.route.deviating, false);
  const second = advancePlannedRoute(first.route, fix(0.0015, 25_000, { latitude: 0.0025 }));
  assert.equal(second.events[0].kind, 'deviation');
  const arrival = advancePlannedRoute(second.route, { ...office.center, timestamp: 30_000 });
  assert.equal(arrival.route.next, 1);
  assert.equal(arrival.events[0].title, 'Reached Office');
  const last = advancePlannedRoute(arrival.route, { ...store.center, timestamp: 40_000 });
  assert.equal(last.route.next, 2);
  route = advancePlannedRoute(last.route, fix(0.0055, 50_000)).route;
  assert.equal(route, last.route);
  const longRoute = Array.from({ length: 10 }, (_, n) => fix(n, 1));
  const url = new URL(directionsLink(longRoute, 'bicycling', start));
  assert.equal(url.searchParams.get('travelmode'), 'bicycling');
  assert.equal(url.searchParams.get('waypoints').split('|').length, 3);
  assert.equal(url.searchParams.get('destination'), '0.0005,3');
});

test('vehicle types use their own stop threshold and a signal gap does not add distance', () => {
  function drive(type) {
    const profile = { id: type, type, name: 'Vehicle' };
    let vehicle = { distance: 0 }, events = [];
    for (let elapsed = 0; elapsed <= 80_000; elapsed += 10_000) {
      const result = advanceVehicle(vehicle, fix(elapsed ? 0.0015 : 0.0005, 10_000 + elapsed,
        { speed: elapsed <= 10_000 ? 12 : 0 }), profile);
      vehicle = result.vehicle;
      events = [...events, ...result.events];
    }
    const afterGap = advanceVehicle(vehicle, fix(2, 160_000, { speed: 12 }), profile);
    assert.equal(afterGap.vehicle.distance, vehicle.distance);
    assert.equal(afterGap.vehicle.state, 'Moving');
    assert.ok(vehicle.distance > 100 && vehicle.distance < 120);
    return events;
  }
  assert.deepEqual(drive('motorcycle').map(event => event.kind), ['parked']);
  assert.deepEqual(drive('truck'), []);
});

test('message rules fire once per event and resume a missed cadence without a backlog', () => {
  const at = 100_000;
  const rule = messageRule({ id: 'repeat', event: 'grid', message: 'Check the route', minutes: 1, repeats: 2 });
  const start = nextMessage(undefined, rule, at, true);
  assert.deepEqual(start, { notify: true, schedule: { at: at + 60_000, left: 2 } });
  const disabled = { ...rule, enabled: false };
  assert.equal(matchMessage(disabled, [{ kind: 'grid' }]), undefined);
  assert.deepEqual(nextMessage(start.schedule, disabled, at + 240_000, true), { notify: false, schedule: null });
  assert.equal(nextMessage(start.schedule, rule, at + 20_000).notify, false);
  const follow = nextMessage(start.schedule, rule, at + 240_000);
  assert.deepEqual(follow, { notify: true, schedule: { at: at + 300_000, left: 1 } });
  assert.deepEqual(nextMessage(follow.schedule, rule, at + 300_000), { notify: true, schedule: null });
  const once = messageRule({ id: 'once', event: 'arrival', message: 'Arrived', minutes: 0 });
  assert.deepEqual(nextMessage(undefined, once, at, true), { notify: true, schedule: null });
});
