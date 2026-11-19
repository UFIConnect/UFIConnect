import { distanceToEdge, EARTH_RADIUS_METERS, MAX_FIX_AGE_MS, measureLocation, validCenter } from './focus-geofence.mjs';

export const MOVEMENT_STORAGE_KEY = 'ufi-office-focus-movement-v1';
export const VEHICLE_TYPES = {
  sedan: { label: 'Sedan', parkSeconds: 90 },
  hatchback: { label: 'Hatchback', parkSeconds: 90 },
  coupe: { label: 'Coupe', parkSeconds: 90 },
  wagon: { label: 'Wagon', parkSeconds: 90 },
  suv: { label: 'SUV / crossover', parkSeconds: 90 },
  pickup: { label: 'Pickup truck', parkSeconds: 120 },
  van: { label: 'Van / minivan', parkSeconds: 120 },
  truck: { label: 'Box truck / commercial truck', parkSeconds: 180 },
  motorcycle: { label: 'Motorcycle / scooter', parkSeconds: 60 },
  other: { label: 'Other vehicle', parkSeconds: 90 },
};
export const SOURCE_TYPES = { phone: 'Phone', computer: 'Computer', equipment: 'Equipment', bicycle: 'Bicycle', vehicle: 'Vehicle' };
export const GRID_STEPS = { detail: 0.001, neighborhood: 0.01, district: 0.1 };
export const TRAVEL_MODES = ['driving', 'walking', 'bicycling'];
export const MESSAGE_EVENTS = {
  interval: 'On a timer',
  arrival: 'Address arrival',
  departure: 'Address departure',
  dwell: 'Time at address',
  grid: 'Grid crossing',
  stop: 'Route stop reached',
  deviation: 'Outside planned route corridor',
  parked: 'Vehicle stopped',
};
export const PLACE_LIMIT = 40;
export const STOP_LIMIT = 12;
export const PROFILE_LIMIT = 24;
export const RULE_LIMIT = 20;
export const REPEAT_MINUTES = [1, 2, 5, 10, 15, 30, 60];

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const id = value => typeof value === 'string' && /^[a-z\d-]{1,64}$/i.test(value);
const clamp = (value, min, max, fallback) => Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
const radians = degrees => degrees * Math.PI / 180;
const coords = point => [point.longitude, point.latitude];
const milliseconds = minutes => minutes * 60000;

export function normalizePhone(value) {
  const number = text(value, 40).replace(/[\s().-]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(number) ? number : '';
}

export function pointFromFields(latitude, longitude) {
  if ([latitude, longitude].some(value => value == null || String(value).trim() === '')) return null;
  const point = { latitude: Number(latitude), longitude: Number(longitude), accuracy: 0 };
  return validCenter(point) ? point : null;
}

export function movementPlace(input) {
  const name = text(input?.name, 80);
  const address = text(input?.address, 180);
  const center = input?.center;
  if (!id(input?.id) || !name || !validCenter(center)) return null;
  return { id: input.id, name, address, center: { latitude: center.latitude, longitude: center.longitude, accuracy: center.accuracy },
    radius: clamp(input.radius, 20, 5000, 100), dwellMinutes: clamp(input.dwellMinutes, 1, 120, 2) };
}

export function movementProfile(input) {
  const name = text(input?.name, 80);
  if (!id(input?.id) || !name || !Object.hasOwn(SOURCE_TYPES, input.kind)) return null;
  const type = input.kind === 'vehicle' && Object.hasOwn(VEHICLE_TYPES, input.type) ? input.type : '';
  if (input.kind === 'vehicle' && !type) return null;
  const parking = validCenter(input.parking) && Number.isFinite(input.parking.timestamp)
    ? { latitude: input.parking.latitude, longitude: input.parking.longitude,
      accuracy: input.parking.accuracy, timestamp: input.parking.timestamp } : null;
  return { id: input.id, name, kind: input.kind, type, phone: normalizePhone(input.phone), parking };
}

export function messageRule(input) {
  const message = text(input?.message, 220);
  if (!id(input?.id) || !message || !Object.hasOwn(MESSAGE_EVENTS, input.event)) return null;
  const minutes = REPEAT_MINUTES.includes(input.minutes) ? input.minutes : 0;
  if (input.event === 'interval' && !minutes) return null;
  return { id: input.id, message, event: input.event,
    target: id(input.target) ? input.target : '', minutes, repeats: minutes ? clamp(input.repeats, 1, 20, 3) : 0 };
}

function readList(list, limit, parse) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.slice(0, limit).flatMap(input => {
    const item = parse(input);
    if (!item || seen.has(item.id)) return [];
    seen.add(item.id);
    return [item];
  });
}

export function movementSettings(input) {
  const places = readList(input?.places, PLACE_LIMIT, movementPlace);
  const placeIds = new Set(places.map(place => place.id));
  return {
    places,
    profiles: readList(input?.profiles, PROFILE_LIMIT, movementProfile),
    rules: readList(input?.rules, RULE_LIMIT, messageRule).filter(rule => !rule.target || placeIds.has(rule.target)),
    grid: Object.hasOwn(GRID_STEPS, input?.grid) ? input.grid : 'neighborhood',
    stops: Array.isArray(input?.stops) ? input.stops.slice(0, STOP_LIMIT).filter(stop => placeIds.has(stop)) : [],
    mode: TRAVEL_MODES.includes(input?.mode) ? input.mode : 'driving',
    corridor: clamp(input?.corridor, 0, 10000, 0),
  };
}

export function directionsLink(stops, mode, origin = null) {
  if (!stops.length) return '';
  const endpoint = point => `${point.latitude},${point.longitude}`;
  // Mobile browsers support up to three intermediate waypoints.
  const leg = stops.slice(0, 4);
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('destination', endpoint(leg.at(-1)));
  url.searchParams.set('travelmode', TRAVEL_MODES.includes(mode) ? mode : 'driving');
  if (origin) url.searchParams.set('origin', endpoint(origin));
  if (leg.length > 1) url.searchParams.set('waypoints', leg.slice(0, -1).map(endpoint).join('|'));
  return url.href;
}

export function gridCell(point, step) {
  const rows = Math.round(180 / step);
  const columns = Math.round(360 / step);
  const longitude = point.longitude === 180 ? -180 : point.longitude;
  const row = Math.min(rows - 1, Math.floor(Number(((point.latitude + 90) / step).toFixed(8))));
  const column = Math.min(columns - 1, Math.floor(Number(((longitude + 180) / step).toFixed(8))));
  const south = Number((row * step - 90).toFixed(7));
  const west = Number((column * step - 180).toFixed(7));
  const latitudeGap = Math.min(point.latitude - south, south + step - point.latitude);
  const longitudeGap = Math.min(longitude - west, west + step - longitude);
  const margin = EARTH_RADIUS_METERS * Math.min(radians(latitudeGap),
    Math.asin(Math.abs(Math.cos(radians(point.latitude)) * Math.sin(radians(longitudeGap)))));
  return { id: `${row + 1}-${column + 1}`, south, west, step, reliable: margin > point.accuracy };
}

export function gridGeometry(cell, neighbors = 0) {
  const { west, south, step } = cell;
  const wrap = longitude => longitude > 180 ? longitude - 360 : longitude < -180 ? longitude + 360 : longitude;
  const left = west - neighbors * step;
  const bottom = Math.max(-90, south - neighbors * step), top = Math.min(90, south + (neighbors + 1) * step);
  const horizontal = y => Array.from({ length: 2 * neighbors + 2 }, (_, index) => [wrap(left + index * step), y]);
  const lines = [];
  for (let index = 0; index <= 2 * neighbors + 1; index++) {
    const x = wrap(left + index * step), y = south + (index - neighbors) * step;
    lines.push([[x, bottom], [x, top]]);
    if (y >= -90 && y <= 90) lines.push(horizontal(y));
  }
  return { type: 'MultiLineString', coordinates: lines };
}

const fresh = (fix, now) => validCenter(fix) && Number.isFinite(fix.timestamp) &&
  fix.timestamp > now - MAX_FIX_AGE_MS && fix.timestamp <= now + 2000;
export { fresh as liveMovementFix };

export function gridVisitors(sources, step, now, cellId = '') {
  return sources.flatMap(source => {
    if (!movementProfile(source) || !fresh(source.fix, now)) return [];
    const cell = gridCell(source.fix, step);
    if (cellId && cell.id !== cellId) return [];
    return [{ ...source, cell, ageSeconds: Math.max(0, Math.floor((now - source.fix.timestamp) / 1000)) }];
  });
}

export function emptyMovement() {
  return { last: null, places: {}, grid: null, crossings: 0, visited: [], cellVisits: [], pendingGrid: null };
}

function nextPlace(previous, place, fix, continuous, emit) {
  const { relation, distance } = measureLocation(place.center, fix, place.radius);
  if (relation === 'edge') {
    return { relation, distance, confirmed: previous?.confirmed, enteredAt: null, dwelled: previous?.dwelled };
  }
  const changed = continuous && previous?.confirmed && previous.confirmed !== relation;
  const inside = relation === 'inside';
  const enteredAt = inside ? (continuous ? previous?.enteredAt : null) ?? fix.timestamp : null;
  const dwelled = inside && (continuous && previous?.confirmed === 'inside' && previous?.dwelled ||
    fix.timestamp - enteredAt >= milliseconds(place.dwellMinutes));
  if (changed) emit(inside ? 'arrival' : 'departure', place, inside ? `Arrived at ${place.name}` : `Left ${place.name}`);
  if (dwelled && !previous?.dwelled) emit('dwell', place, `Spent ${place.dwellMinutes} min at ${place.name}`);
  return { relation, distance, confirmed: relation, enteredAt, dwelled };
}

export function advanceMovement(previous, fix, places, gridStep) {
  if (previous.last && fix.timestamp <= previous.last.timestamp) return { movement: previous, events: [] };
  const continuous = previous.last && fix.timestamp - previous.last.timestamp < MAX_FIX_AGE_MS;
  const events = [];
  const emit = (kind, item, title) => events.push({ kind, target: item.id, title, at: fix.timestamp });
  const placeStates = Object.fromEntries(places.map(place =>
    [place.id, nextPlace(previous.places[place.id], place, fix, continuous, emit)]));
  const candidate = gridCell(fix, gridStep);
  let grid = previous.grid, pendingGrid = null, crossings = previous.crossings, visited = previous.visited;
  let cellVisits = previous.cellVisits ?? [];
  if (candidate.reliable) {
    if (!continuous || !grid || grid.id === candidate.id || previous.pendingGrid === candidate.id) {
      if (continuous && grid && grid.id !== candidate.id) {
        crossings++;
        emit('grid', candidate, `Entered grid cell ${candidate.id}`);
      }
      if (!visited.includes(candidate.id)) visited = [...visited.slice(-199), candidate.id];
      const recorded = cellVisits.find(visit => visit.cell.id === candidate.id);
      const visit = { cell: candidate, firstAt: recorded?.firstAt ?? fix.timestamp, lastAt: fix.timestamp,
        samples: (recorded?.samples ?? 0) + 1, fix };
      cellVisits = [visit, ...cellVisits.filter(item => item.cell.id !== candidate.id)].slice(0, 50);
      grid = candidate;
    } else pendingGrid = candidate.id;
  }
  return { movement: { last: fix, places: placeStates, grid, visited, cellVisits, crossings, pendingGrid }, events };
}

export function advanceVehicle(previous, fix, profile) {
  const last = previous.last;
  if (last && fix.timestamp <= last.timestamp) return { vehicle: previous, events: [] };
  if (fix.accuracy > 50) return { vehicle: previous, events: [] };
  const continuous = last && fix.timestamp - last.timestamp < MAX_FIX_AGE_MS;
  const elapsed = continuous ? (fix.timestamp - last.timestamp) / 1000 : 0;
  const distance = continuous ? measureLocation(last, fix, 0).distance : 0;
  const minimum = Math.max(4, (last?.accuracy ?? 0) + fix.accuracy);
  const speed = fix.speed ?? (continuous ? Math.max(0, distance - minimum) / elapsed : null);
  const still = speed !== null && speed <= 0.8 && distance <= minimum;
  const moving = speed !== null && speed >= 2;
  const stoppedAt = still ? (continuous ? previous.stoppedAt : null) ?? fix.timestamp : null;
  const parked = stoppedAt !== null && fix.timestamp - stoppedAt >= VEHICLE_TYPES[profile.type].parkSeconds * 1000;
  const state = parked ? 'Stopped' : moving ? 'Moving' : still ? 'Stationary' : 'Checking motion';
  // Suppress a stop event before observing movement in a trip.
  const events = parked && previous.moved && previous.state !== 'Stopped' ? [
    { kind: 'parked', target: profile.id, title: `${profile.name} stopped`, at: fix.timestamp },
  ] : [];
  const anchor = continuous && previous.anchor ? previous.anchor : fix;
  const movedMeters = measureLocation(anchor, fix, 0).distance;
  const addDistance = movedMeters > Math.max(4, anchor.accuracy + fix.accuracy) &&
    movedMeters / Math.max(1, (fix.timestamp - anchor.timestamp) / 1000) < 100;
  return { vehicle: { ...previous, last: fix, speed, speedSource: fix.speed != null ? 'device-reported' : speed != null ? 'estimated from GPS' : 'unavailable',
    state, stoppedAt, moved: previous.moved || moving,
    anchor: addDistance ? fix : anchor, distance: previous.distance + (addDistance ? movedMeters : 0) }, events };
}

export function startPlannedRoute(fix, stops, corridor) {
  return { origin: fix, stops, corridor, next: 0, deviating: false, pendingDeviation: false, last: null };
}

export function advancePlannedRoute(route, fix) {
  if (!route || route.next >= route.stops.length || route.last && fix.timestamp <= route.last.timestamp) return { route, events: [] };
  const stop = route.stops[route.next];
  const from = route.next ? route.stops[route.next - 1].center : route.origin;
  const events = [];
  const reached = measureLocation(stop.center, fix, stop.radius).relation === 'inside';
  if (reached) events.push({ kind: 'stop', target: stop.id, title: `Reached ${stop.name}`, at: fix.timestamp });
  const gap = route.last && fix.timestamp - route.last.timestamp >= MAX_FIX_AGE_MS;
  const offset = route.corridor ? distanceToEdge(fix, coords(from), coords(stop.center)) : 0;
  const outside = !reached && route.corridor > 0 && offset - fix.accuracy > route.corridor;
  const deviating = outside && !gap && (route.deviating || route.pendingDeviation);
  if (deviating && !route.deviating) events.push({ kind: 'deviation', target: stop.id, title: 'Outside planned route corridor', at: fix.timestamp });
  return { route: { ...route, last: fix, next: route.next + Number(reached), pendingDeviation: outside, deviating }, events };
}

export function plannedDistance(fix, stops) {
  return stops.reduce((distance, stop, index) => {
    const origin = index ? stops[index - 1].center : fix;
    return distance + (origin ? measureLocation(origin, stop.center, 0).distance : 0);
  }, 0);
}

export function matchMessage(rule, events) {
  return events.find(item => item.kind === rule.event && (!rule.target || item.target === rule.target));
}

export function nextMessage(running, rule, now, trigger) {
  if (trigger && rule.event !== 'interval') {
    return { notify: true, schedule: rule.minutes ? { at: now + milliseconds(rule.minutes), left: rule.repeats } : null };
  }
  if (!running || now < running.at) return { notify: false, schedule: running };
  return { notify: true, schedule: running.left > 1 ? { at: now + milliseconds(rule.minutes), left: running.left - 1 } : null };
}
