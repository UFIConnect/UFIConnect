import { geoRotation } from 'd3-geo';

export const MAP_WIDTH = 460;
export const MAP_HEIGHT = 292;
export const MAP_CENTER = [MAP_WIDTH / 2, MAP_HEIGHT / 2];
export const GLOBE_RADIUS = 121;
const TO_RADIANS = Math.PI / 180;
const TO_DEGREES = 180 / Math.PI;
const cross = ([ax, ay, az], [bx, by, bz]) => [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
const unit = value => Math.max(-1, Math.min(1, value));
const spherical = ([x, y, z]) => [Math.atan2(x, z) * TO_DEGREES, Math.asin(unit(y)) * TO_DEGREES];

export function screenBasis([longitude, latitude, roll]) {
  const lon = longitude * TO_RADIANS, lat = latitude * TO_RADIANS, spin = roll * TO_RADIANS;
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.cos(lon) * Math.sin(lat), -Math.sin(lon) * Math.sin(lat), Math.cos(lat)];
  const forward = [Math.cos(lon) * Math.cos(lat), Math.sin(lon) * Math.cos(lat), Math.sin(lat)];
  const right = east.map((value, index) => value * Math.cos(spin) - north[index] * Math.sin(spin));
  const up = north.map((value, index) => value * Math.cos(spin) + east[index] * Math.sin(spin));
  return [right, up, forward];
}

function surfaceVector([x, y], scale, flat) {
  const dx = x - MAP_CENTER[0], dy = MAP_CENTER[1] - y;
  const length = Math.hypot(dx, dy);
  const radius = Math.min(0.9999, length / scale);
  const angle = flat ? radius * Math.PI / 2 : Math.asin(radius);
  const factor = length > 0 ? Math.sin(angle) / length : 0;
  return [dx * factor, dy * factor, Math.cos(angle)];
}

// Rotate the body under the pointer, including across both poles and the antimeridian.
export function dragMap(camera, start, end, startScale, endScale, flat) {
  const from = surfaceVector(start, startScale, flat);
  const to = surfaceVector(end, endScale, flat);
  const dot = from.reduce((sum, entry, index) => sum + entry * to[index], 0);
  if (dot > 1 - 1e-14 || dot < -1 + 1e-7) return camera;
  const axis = cross(to, from);
  function inverseRotate(vector) {
    const turn = cross(axis, vector);
    const correction = cross(axis, turn);
    return vector.map((value, index) => value + turn[index] + correction[index] / (1 + dot));
  }
  const oldFrame = geoRotation([-camera[0], -camera[1], camera[2]]);
  const [longitude, latitude] = oldFrame.invert(spherical(inverseRotate([0, 0, 1])));
  const newNorth = oldFrame.invert(spherical(inverseRotate([0, 1, 0])));
  const [northLon, northLat] = geoRotation([-longitude, -latitude])(newNorth).map(degrees => degrees * TO_RADIANS);
  const roll = Math.atan2(Math.sin(northLon) * Math.cos(northLat), Math.sin(northLat)) * TO_DEGREES;
  return [longitude, latitude, roll];
}

export function headingPoint([longitude, latitude], heading) {
  const lon = longitude * TO_RADIANS, lat = latitude * TO_RADIANS, bearing = heading * TO_RADIANS;
  const step = 1e-5;
  const nextLat = Math.asin(Math.sin(lat) * Math.cos(step) + Math.cos(lat) * Math.sin(step) * Math.cos(bearing));
  const nextLon = lon + Math.atan2(Math.sin(bearing) * Math.sin(step) * Math.cos(lat),
    Math.cos(step) - Math.sin(lat) * Math.sin(nextLat));
  return [nextLon * TO_DEGREES, nextLat * TO_DEGREES];
}
