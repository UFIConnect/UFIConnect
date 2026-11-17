import { geoArea, geoContains } from 'd3-geo';

export const EARTH_RADIUS_METERS = 6371008.8;
export const MAX_SURFACE_DISTANCE_METERS = Math.PI * EARTH_RADIUS_METERS;
export const MAX_FIX_AGE_MS = 25000;
const BALANCED_PROFILE = { label: 'Balanced', buffer: 10, maxAccuracy: 150, defaultSeconds: 8, highAccuracy: true };
export const FENCE_PROFILES = {
  battery: { label: 'Battery saver', buffer: 25, maxAccuracy: 500, defaultSeconds: 15, highAccuracy: false },
  balanced: BALANCED_PROFILE,
  strict: { label: 'Strict', buffer: 25, maxAccuracy: 50, defaultSeconds: 15, highAccuracy: true },
  precise: { label: 'Precise', buffer: 3, maxAccuracy: 15, defaultSeconds: 6, highAccuracy: true },
  custom: { ...BALANCED_PROFILE, label: 'Custom' },
};
export const FENCE_CUSTOM_FIELDS = {
  maxAccuracy: { label: 'Maximum device uncertainty (m)', min: 1, max: 1000 },
  buffer: { label: 'Boundary margin (m)', min: 0, max: 100 },
};
export const EMPTY_FENCE = { confirmed: null, candidate: null, since: 0, timestamp: -Infinity };
export const EMPTY_STAY = { since: null, fired: false };
export const ZONE_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const ZONE_SHAPES = [
  { id: 'circle', label: 'Circle' }, { id: 'rectangle', label: 'Rectangle' },
  { id: 'polygon', label: 'Polygon' }, { id: 'corridor', label: 'Route corridor' },
];
const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const scheduleClocks = new Map();

function scheduleClock(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 80) return null;
  if (scheduleClocks.has(timeZone)) return scheduleClocks.get(timeZone);
  try {
    const clock = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    if (scheduleClocks.size < 32) scheduleClocks.set(timeZone, clock);
    return clock;
  } catch {
    return null;
  }
}

export function normalizeScheduleTimeZone(value) {
  return typeof value === 'string' ? scheduleClock(value.trim())?.resolvedOptions().timeZone ?? '' : '';
}

export function zoneSchedule(schedule) {
  return {
    enabled: schedule?.enabled === true,
    days: Array.isArray(schedule?.days) ? [...new Set(schedule.days.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))] : [1, 2, 3, 4, 5],
    start: CLOCK_TIME.test(schedule?.start) ? schedule.start : '09:00',
    end: CLOCK_TIME.test(schedule?.end) ? schedule.end : '17:00',
    timeZone: normalizeScheduleTimeZone(schedule?.timeZone),
  };
}

export function zoneInSchedule(schedule, timestamp) {
  if (!schedule?.enabled) return true;
  const time = new Date(timestamp);
  const formatter = scheduleClock(schedule.timeZone);
  const regional = formatter && Object.fromEntries(formatter.formatToParts(time).map(part => [part.type, part.value]));
  const day = regional ? ZONE_DAYS.indexOf(regional.weekday) : time.getDay();
  const clock = regional ? `${regional.hour}:${regional.minute}`
    : `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  const { days, start, end } = schedule;
  if (start === end) return days.includes(day);
  if (start < end) return days.includes(day) && clock >= start && clock < end;
  return (days.includes(day) && clock >= start) || (days.includes((day + 6) % 7) && clock < end);
}

export function zoneAvailable(zone, timestamp) {
  return (!zone.until || timestamp < zone.until)
    && (!zone.snoozedUntil || timestamp >= zone.snoozedUntil)
    && zoneInSchedule(zone.schedule, timestamp);
}

export function fenceProfile({ profile, custom }) {
  return profile === 'custom' ? { ...FENCE_PROFILES.custom, ...custom } : FENCE_PROFILES[profile];
}

export function locationOptions(highAccuracy = true, timeout = 12000) {
  return { enableHighAccuracy: highAccuracy, maximumAge: 0, timeout };
}

export function validCenter(center) {
  return center && Number.isFinite(center.latitude) && Math.abs(center.latitude) <= 90
    && Number.isFinite(center.longitude) && Math.abs(center.longitude) <= 180
    && Number.isFinite(center.accuracy) && center.accuracy >= 0;
}

function radians(degrees) {
  return degrees * Math.PI / 180;
}

export function measureLocation(center, fix, radius, buffer = 0) {
  const origin = radians(center.latitude);
  const latitude = radians(fix.latitude);
  const longitudeDelta = radians(fix.longitude - center.longitude);
  const halfChord = Math.sin((latitude - origin) / 2) ** 2
    + Math.cos(origin) * Math.cos(latitude) * Math.sin(longitudeDelta / 2) ** 2;
  const distance = 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, halfChord)));
  const bearing = Math.atan2(
    Math.sin(longitudeDelta) * Math.cos(latitude),
    Math.cos(origin) * Math.sin(latitude) - Math.sin(origin) * Math.cos(latitude) * Math.cos(longitudeDelta),
  );
  const uncertainty = center.accuracy + fix.accuracy;
  let relation = 'edge';
  if (radius >= MAX_SURFACE_DISTANCE_METERS || distance + uncertainty <= radius - buffer) relation = 'inside';
  else if (distance - uncertainty > radius + buffer) relation = 'outside';
  return { distance, bearing, uncertainty, relation };
}

const pair = point => [point.longitude, point.latitude];

export function zoneGeometry({ shape, vertices = [] }) {
  if (shape === 'corridor') return vertices.length > 1 ? { type: 'LineString', coordinates: vertices.map(pair) } : null;
  let ring;
  if (shape === 'rectangle' && vertices.length === 2) {
    const [a, b] = vertices;
    if (a.latitude === b.latitude || a.longitude === b.longitude) return null;
    ring = [pair(a), [a.longitude, b.latitude], pair(b), [b.longitude, a.latitude], pair(a)];
  } else if (shape === 'polygon' && vertices.length >= 3) {
    ring = [...vertices.map(pair), pair(vertices[0])];
  } else return null;
  const polygon = { type: 'Polygon', coordinates: [ring] };
  const area = geoArea(polygon);
  if (area > 2 * Math.PI) ring.reverse();
  return Math.min(area, 4 * Math.PI - area) > 1e-15 ? polygon : null;
}

export function distanceToEdge(point, a, b) {
  const start = { longitude: a[0], latitude: a[1], accuracy: 0 };
  const end = { longitude: b[0], latitude: b[1], accuracy: 0 };
  const edge = measureLocation(start, end, 0);
  const fromStart = measureLocation(start, point, 0);
  if (!edge.distance) return fromStart.distance;
  const angular = fromStart.distance / EARTH_RADIUS_METERS;
  const direction = fromStart.bearing - edge.bearing;
  const along = Math.atan2(Math.sin(angular) * Math.cos(direction), Math.cos(angular));
  if (along < 0 || along * EARTH_RADIUS_METERS > edge.distance) {
    return Math.min(fromStart.distance, measureLocation(end, point, 0).distance);
  }
  return Math.abs(Math.asin(Math.sin(angular) * Math.sin(direction))) * EARTH_RADIUS_METERS;
}

function measureZone(zone, fix, profile) {
  const shape = zoneGeometry(zone);
  const margin = shape?.type === 'Polygon' ? profile.buffer : Math.min(profile.buffer, zone.radius * 0.2);
  const reading = measureLocation(zone.center, fix, zone.radius, margin);
  let boundaryDistance = reading.distance - zone.radius;
  if (shape) {
    const line = shape.type === 'Polygon' ? shape.coordinates[0] : shape.coordinates;
    const edge = Math.min(...line.slice(1).map((point, index) => distanceToEdge(fix, line[index], point)));
    boundaryDistance = shape.type === 'LineString' ? edge - zone.radius : geoContains(shape, pair(fix)) ? -edge : edge;
    reading.relation = boundaryDistance + reading.uncertainty <= -margin ? 'inside'
      : boundaryDistance - reading.uncertainty > margin ? 'outside' : 'edge';
  }
  return { ...reading, boundaryDistance };
}

export function readLocationFix(position, now) {
  if (!position?.coords) return null;
  const { latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed } = position.coords;
  const point = { latitude, longitude, accuracy, timestamp: position.timestamp };
  if (Number.isFinite(altitude)) point.altitude = altitude;
  if (Number.isFinite(altitudeAccuracy) && altitudeAccuracy >= 0) point.altitudeAccuracy = altitudeAccuracy;
  if (Number.isFinite(heading) && heading >= 0 && heading < 360) point.heading = heading;
  if (Number.isFinite(speed) && speed >= 0) point.speed = speed;
  return validCenter(point) && Number.isFinite(point.timestamp)
    && point.timestamp > now - MAX_FIX_AGE_MS && point.timestamp <= now + 2000 ? point : null;
}

function combineReadings(readings, every) {
  if (!readings.length) return 'outside';
  if (every ? readings.some(item => item.relation === 'outside') : readings.every(item => item.relation === 'outside')) return 'outside';
  if (every ? readings.every(item => item.relation === 'inside') : readings.some(item => item.relation === 'inside')) return 'inside';
  return readings.some(item => item.relation === 'weak') ? 'weak' : 'edge';
}

export function checkFence(zones, fix, profile, { combination, useExclusions = false } = {}) {
  const measurements = zones.map(zone => {
    const effective = { ...profile, ...zone.overrides };
    const measure = measureZone(zone, fix, effective);
    const relation = fix.accuracy <= effective.maxAccuracy ? measure.relation : 'weak';
    return { ...measure, relation, id: zone.id, excluded: useExclusions && zone.exclude === true,
      enterMs: zone.overrides?.enterSeconds * 1000 || undefined, exitMs: zone.overrides?.exitSeconds * 1000 || undefined };
  });
  const included = measurements.filter(item => !item.excluded);
  const excluded = measurements.filter(item => item.excluded);
  let relation = combineReadings(included, combination === 'every');
  const exclusion = combineReadings(excluded, false);
  if (exclusion === 'inside') relation = 'outside';
  else if (relation === 'inside' && exclusion !== 'outside') relation = exclusion;
  return { relation, measurements };
}

export function clearFenceCandidate(state) {
  return state.candidate === null ? state : { ...state, candidate: null, since: 0 };
}

// Only a fresh, second fix past the dwell time can confirm a crossing.
export function advanceFence(previous, relation, timestamp, enterMs, exitMs = enterMs, fireOnStart = false) {
  if (timestamp <= previous.timestamp) return { state: previous, transition: null };
  const state = { ...previous, timestamp };
  if ((relation !== 'inside' && relation !== 'outside') || relation === state.confirmed) {
    return { state: clearFenceCandidate(state), transition: null };
  }
  if (state.candidate !== relation) return { state: { ...state, candidate: relation, since: timestamp }, transition: null };
  if (timestamp - state.since < (relation === 'inside' ? enterMs : exitMs)) return { state, transition: null };
  return {
    state: clearFenceCandidate({ ...state, confirmed: relation }),
    transition: previous.confirmed || (fireOnStart && relation === 'inside')
      ? relation === 'inside' ? 'enter' : 'exit' : null,
  };
}

export function advanceZoneFences(previous, measurements, timestamp, enterMs, exitMs = enterMs, fireOnStart = false) {
  const states = new Map();
  const transitions = [];
  const readings = measurements.map(measurement => {
    const { id, relation } = measurement;
    const { state, transition } = advanceFence(previous.get(id) ?? EMPTY_FENCE, relation, timestamp,
      measurement.enterMs ?? enterMs, measurement.exitMs ?? exitMs, fireOnStart);
    states.set(id, state);
    if (transition) transitions.push({ type: transition, zoneId: id });
    return { ...measurement, confirmed: state.confirmed, checking: state.candidate };
  });
  return { states, readings, transitions };
}

export function interruptStay(previous) {
  return previous.since === null ? previous : { ...previous, since: null };
}

// A stay fires once per confirmed visit. Poor or interrupted readings restart
// confirmation for an unfinished stay, while only an exit allows a second one.
export function advanceStay(previous, { confirmed, relation }, timestamp, stayMs) {
  if (confirmed === 'outside') return { state: EMPTY_STAY, transition: false };
  if (confirmed !== 'inside' || relation !== 'inside') return { state: interruptStay(previous), transition: false };
  if (previous.fired) return { state: previous, transition: false };
  if (previous.since === null) return { state: { ...previous, since: timestamp }, transition: false };
  if (timestamp - previous.since < stayMs) return { state: previous, transition: false };
  return { state: { ...previous, fired: true }, transition: true };
}
