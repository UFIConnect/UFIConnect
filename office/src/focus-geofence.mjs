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

export function fenceProfile({ profile, custom }) {
  return profile === 'custom' ? { ...FENCE_PROFILES.custom, ...custom } : FENCE_PROFILES[profile];
}

export function locationOptions(highAccuracy = true) {
  return { enableHighAccuracy: highAccuracy, maximumAge: 0, timeout: 12000 };
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

export function readLocationFix(position, now) {
  if (!position?.coords) return null;
  const { latitude, longitude, accuracy } = position.coords;
  const point = { latitude, longitude, accuracy, timestamp: position.timestamp };
  return validCenter(point) && Number.isFinite(point.timestamp)
    && point.timestamp > now - MAX_FIX_AGE_MS && point.timestamp <= now + 2000 ? point : null;
}

export function checkFence(zones, fix, profile) {
  const measurements = zones.map(zone => {
    const measure = measureLocation(zone.center, fix, zone.radius, Math.min(profile.buffer, zone.radius * 0.2));
    const relation = fix.accuracy <= profile.maxAccuracy ? measure.relation : 'weak';
    return { ...measure, relation, id: zone.id };
  });
  const inside = measurements.find(item => item.relation === 'inside');
  if (inside) return { relation: 'inside', measurements };
  if (measurements.some(item => item.relation === 'weak')) return { relation: 'weak', measurements };
  if (measurements.some(item => item.relation === 'edge')) return { relation: 'edge', measurements };
  return { relation: 'outside', measurements };
}

export function clearFenceCandidate(state) {
  return state.candidate === null ? state : { ...state, candidate: null, since: 0 };
}

// Only a fresh, second fix past the dwell time can confirm a crossing.
export function advanceFence(previous, relation, timestamp, dwellMs) {
  if (timestamp <= previous.timestamp) return { state: previous, transition: null };
  const state = { ...previous, timestamp };
  if ((relation !== 'inside' && relation !== 'outside') || relation === state.confirmed) {
    return { state: clearFenceCandidate(state), transition: null };
  }
  if (state.candidate !== relation) return { state: { ...state, candidate: relation, since: timestamp }, transition: null };
  if (timestamp - state.since < dwellMs) return { state, transition: null };
  return {
    state: clearFenceCandidate({ ...state, confirmed: relation }),
    transition: previous.confirmed ? relation === 'inside' ? 'enter' : 'exit' : null,
  };
}

export function advanceZoneFences(previous, measurements, timestamp, dwellMs) {
  const states = new Map();
  const transitions = [];
  const readings = measurements.map(measurement => {
    const { id, relation } = measurement;
    const { state, transition } = advanceFence(previous.get(id) ?? EMPTY_FENCE, relation, timestamp, dwellMs);
    states.set(id, state);
    if (transition) transitions.push({ type: transition, zoneId: id });
    return { ...measurement, confirmed: state.confirmed, checking: state.candidate };
  });
  return { states, readings, transitions };
}
