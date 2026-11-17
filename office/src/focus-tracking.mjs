import { MAX_FIX_AGE_MS, measureLocation, validCenter } from './focus-geofence.mjs';

const BALANCED = { label: 'Balanced', highAccuracy: true, maxAccuracy: 150, interval: 10 };
export const TRACKING_PROFILES = {
  balanced: BALANCED,
  precise: { label: 'Precise', highAccuracy: true, maxAccuracy: 25, interval: 5 },
  battery: { label: 'Battery saver', highAccuracy: false, maxAccuracy: 500, interval: 0 },
  custom: { ...BALANCED, label: 'Custom' },
};
export const LOCATION_INTERVALS = [0, 5, 10, 20, 30, 60];
export const MAX_ROUTE_POINTS = 500;
export const TRIP_STORAGE_KEY = 'ufi-office-focus-trips-v1';
export const TRIP_RETENTION_DAYS = [0, 1, 7, 30, 90];
export const ROUTE_FORMATS = ['csv', 'gpx', 'geojson', 'kml'];
export const TRACKING_FIELDS = {
  maxAccuracy: { initial: 150, min: 1, max: 1000 },
  minSeconds: { initial: 5, min: 1, max: 120 },
  minMeters: { initial: 5, min: 0, max: 1000 },
  stopMinutes: { initial: 0, min: 0, max: 720 },
  stopMeters: { initial: 0, min: 0, max: 1000000 },
  speedLimit: { initial: 0, min: 0, max: 350 },
  timeoutSeconds: { initial: 12, min: 3, max: 60 },
};

function trackingValue(value, { initial, min, max }) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : initial;
}

export function readTrackingSettings(input) {
  const profile = Object.hasOwn(TRACKING_PROFILES, input?.profile) ? input.profile : 'balanced';
  return {
    background: input?.background === true,
    profile,
    interval: LOCATION_INTERVALS.includes(input?.interval) ? input.interval : TRACKING_PROFILES[profile].interval,
    units: input?.units === 'imperial' ? 'imperial' : 'metric',
    minSeconds: trackingValue(input?.minSeconds, TRACKING_FIELDS.minSeconds),
    minMeters: trackingValue(input?.minMeters, TRACKING_FIELDS.minMeters),
    stopMinutes: trackingValue(input?.stopMinutes, TRACKING_FIELDS.stopMinutes),
    stopMeters: trackingValue(input?.stopMeters, TRACKING_FIELDS.stopMeters),
    speedLimit: trackingValue(input?.speedLimit, TRACKING_FIELDS.speedLimit),
    timeoutSeconds: trackingValue(input?.timeoutSeconds, TRACKING_FIELDS.timeoutSeconds),
    retentionDays: TRIP_RETENTION_DAYS.includes(input?.retentionDays) ? input.retentionDays : 0,
    custom: {
      maxAccuracy: trackingValue(input?.custom?.maxAccuracy, TRACKING_FIELDS.maxAccuracy),
      highAccuracy: input?.custom?.highAccuracy !== false,
    },
  };
}

export function trackingProfile({ profile, custom }) {
  return profile === 'custom' ? { ...TRACKING_PROFILES.custom, ...custom } : TRACKING_PROFILES[profile];
}

export function trackingFixGap(settings) {
  return Math.max(MAX_FIX_AGE_MS, (settings.interval + settings.timeoutSeconds) * 1000);
}

export function appendRouteFix(points, fix, settings, segment) {
  if (fix.accuracy > trackingProfile(settings).maxAccuracy) return points;
  const last = points.at(-1);
  const elapsed = last ? fix.timestamp - last.timestamp : Infinity;
  if (elapsed <= 0) return points;
  const startsSegment = !last || last.segment !== segment;
  if (!startsSegment && (elapsed < settings.minSeconds * 1000 ||
    measureLocation(last, fix, 0).distance < settings.minMeters)) return points;
  return [...points.slice(-(MAX_ROUTE_POINTS - 1)), { ...fix, segment, startsSegment }];
}

export function routeStats(points) {
  const stats = { distance: 0, durationMs: 0, movingMs: 0, climb: null, peak: null };
  points.forEach((point, index) => {
    const last = points[index - 1];
    if (Number.isFinite(point.speed)) stats.peak = Math.max(stats.peak ?? 0, point.speed);
    if (!last || point.startsSegment) return;
    const meters = measureLocation(last, point, 0).distance;
    const elapsed = point.timestamp - last.timestamp;
    stats.distance += meters;
    stats.durationMs += elapsed;
    if (meters > Math.max(2, last.accuracy + point.accuracy)) stats.movingMs += elapsed;
    if (Number.isFinite(point.altitude) && Number.isFinite(last.altitude)) {
      stats.climb = (stats.climb ?? 0) + Math.max(0, point.altitude - last.altitude);
    }
  });
  return stats;
}

export function csvCell(value) {
  const text = String(value ?? '');
  const safe = typeof value === 'string' && /^\s*[=+@-]/.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export function trackCsv(points, waypoints = []) {
  const header = 'timestamp,latitude,longitude,accuracy_m,speed_mps,heading_deg,altitude_m,altitude_accuracy_m,new_segment,waypoint,note';
  const row = (point, segment, name, note) => [new Date(point.timestamp).toISOString(), point.latitude,
    point.longitude, point.accuracy, point.speed ?? '', point.heading ?? '', point.altitude ?? '',
    point.altitudeAccuracy ?? '', segment, name, note].map(csvCell).join(',');
  return [header, ...points.map((point, index) => row(point, index === 0 || point.startsSegment, '')),
    ...waypoints.map(point => row(point, true, point.name || 'Waypoint', point.note))].join('\n') + '\n';
}

export function routeSegments(points) {
  const segments = [];
  for (const point of points) {
    if (!segments.length || point.startsSegment) segments.push([]);
    segments.at(-1).push(point);
  }
  return segments;
}

export function redactTrip(points, waypoints, meters) {
  const start = points[0];
  const end = points.at(-1);
  if (!meters) return { points, waypoints };
  if (!start) return { points, waypoints: [] };
  const outside = point => [start, end].every(edge =>
    measureLocation(edge, point, 0).distance >= meters + edge.accuracy + point.accuracy);
  let gap = false;
  const retained = points.flatMap(point => {
    if (!outside(point)) { gap = true; return []; }
    const result = gap ? { ...point, startsSegment: true } : point;
    gap = false;
    return [result];
  });
  return { points: retained, waypoints: waypoints.filter(outside) };
}

const tripCoordinates = point => [point.longitude, point.latitude, ...(Number.isFinite(point.altitude) ? [point.altitude] : [])];
const xmlPart = text => String(text).replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
  .replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);

export function exportTrip(format, { name, points, waypoints }) {
  if (format === 'csv') {
    return { data: trackCsv(points, waypoints), mime: 'text/csv' };
  }
  const segments = routeSegments(points);
  if (format === 'geojson') {
    const pointFeature = (point, properties) => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: tripCoordinates(point) } });
    const lines = segments.filter(line => line.length > 1).map(line => line.map(tripCoordinates));
    const features = [
      ...(lines.length ? [{ type: 'Feature', properties: { name }, geometry: { type: 'MultiLineString', coordinates: lines } }] : []),
      ...segments.filter(line => line.length === 1).map(([point]) => pointFeature(point, { timestamp: point.timestamp })),
      ...waypoints.map(point => pointFeature(point, { name: point.name, note: point.note, timestamp: point.timestamp })),
    ];
    return { data: JSON.stringify({ type: 'FeatureCollection', features }, null, 2), mime: 'application/geo+json' };
  }
  const title = xmlPart(name), xml = '<?xml version="1.0" encoding="UTF-8"?>';
  if (format === 'gpx') {
    const pointTag = (tag, point) => `<${tag} lat="${point.latitude}" lon="${point.longitude}">${Number.isFinite(point.altitude)
      ? `<ele>${point.altitude}</ele>` : ''}<time>${new Date(point.timestamp).toISOString()}</time>${point.name
      ? `<name>${xmlPart(point.name)}</name>` : ''}${point.note ? `<desc>${xmlPart(point.note)}</desc>` : ''}</${tag}>`;
    const tracks = segments.map(line => `<trkseg>${line.map(point => pointTag('trkpt', point)).join('')}</trkseg>`).join('');
    return { data: `${xml}<gpx version="1.1" creator="UFIConnect Office" xmlns="http://www.topografix.com/GPX/1/1">${waypoints
      .map(point => pointTag('wpt', point)).join('')}<trk><name>${title}</name>${tracks}</trk></gpx>`, mime: 'application/gpx+xml' };
  }
  const shape = (type, coordinates) => `<${type}><coordinates>${coordinates}</coordinates></${type}>`;
  const lines = segments.map(line => shape(line.length === 1 ? 'Point' : 'LineString', line.map(point => tripCoordinates(point).join(',')).join(' '))).join('');
  const marks = waypoints.map(point => `<Placemark><name>${xmlPart(point.name)}</name>${point.note
    ? `<description>${xmlPart(point.note)}</description>` : ''}${shape('Point', tripCoordinates(point).join(','))}</Placemark>`).join('');
  return { data: `${xml}<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${title}</name><Placemark><MultiGeometry>${lines}</MultiGeometry></Placemark>${marks}</Document></kml>`, mime: 'application/vnd.google-earth.kml+xml' };
}

export function recentTrips(trips, retentionDays, now = Date.now()) {
  return trips.filter(trip => !retentionDays || trip.savedAt >= now - retentionDays * 86400000).slice(0, 20);
}

export function readTrips() {
  try {
    const stored = JSON.parse(localStorage.getItem(TRIP_STORAGE_KEY));
    if (!Array.isArray(stored)) return [];
    return stored.slice(0, 20).flatMap(trip => {
      if (typeof trip?.id !== 'string' || typeof trip.name !== 'string' || !validTimestamp(trip.savedAt)) return [];
      return [{ id: trip.id, name: trip.name.slice(0, 80), savedAt: trip.savedAt,
        points: savedPoints(trip.points, MAX_ROUTE_POINTS), waypoints: savedPoints(trip.waypoints, 50) }];
    });
  } catch { return []; }
}

function validTimestamp(value) {
  return Number.isFinite(value) && value > 0 && value < 8640000000000000;
}

function savedPoints(points, limit) {
  if (!Array.isArray(points)) return [];
  return points.slice(0, limit).flatMap(point => {
    if (!validCenter(point) || !validTimestamp(point.timestamp)) return [];
    const { latitude, longitude, accuracy, timestamp, altitude, altitudeAccuracy, speed, heading } = point;
    return [{
      latitude, longitude, accuracy, timestamp, startsSegment: point.startsSegment === true,
      ...(Number.isFinite(altitude) ? { altitude } : {}),
      ...(Number.isFinite(altitudeAccuracy) && altitudeAccuracy >= 0 ? { altitudeAccuracy } : {}),
      ...(Number.isFinite(speed) && speed >= 0 ? { speed } : {}),
      ...(Number.isFinite(heading) && heading >= 0 && heading < 360 ? { heading } : {}),
      ...(typeof point.id === 'string' ? { id: point.id } : {}),
      ...(typeof point.name === 'string' ? { name: point.name.slice(0, 80) } : {}),
      ...(typeof point.note === 'string' ? { note: point.note.slice(0, 160) } : {}),
    }];
  }).sort((first, second) => first.timestamp - second.timestamp);
}

export function downloadFocusFile(data, filename, mime) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function locationLength(meters, units, { large = false } = {}) {
  if (units === 'imperial') {
    return large && meters >= 1609.344 ? `${(meters / 1609.344).toFixed(2)} mi`
      : `${Math.round(meters / 0.3048).toLocaleString()} ft`;
  }
  return large && meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters).toLocaleString()} m`;
}

export function locationSpeed(speed, units) {
  return units === 'imperial' ? `${(speed * 2.236936).toFixed(1)} mph` : `${(speed * 3.6).toFixed(1)} km/h`;
}
