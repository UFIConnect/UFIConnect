import { GLOBE_RADIUS, MAP_HEIGHT, MAP_WIDTH } from './focus-map.mjs';

export const STREET_TILE_SIZE = 256;
export const MAX_STREET_LATITUDE = Math.atan(Math.sinh(Math.PI)) * 180 / Math.PI;
const MIN_TILE_LEVEL = 12;
const MAX_TILE_LEVEL = 19;
const RADIANS = Math.PI / 180;
const VIEWPORT_CORNERS = [[0, 0], [MAP_WIDTH, 0], [0, MAP_HEIGHT], [MAP_WIDTH, MAP_HEIGHT]];
const circumference = flat => GLOBE_RADIUS * (flat ? 4 : 2 * Math.PI);
const wrap = (value, limit) => ((value % limit) + limit) % limit;

export function streetViewZoom(latitude, flat) {
  const localScale = Math.max(0.087, Math.cos(latitude * RADIANS));
  return 1.1 * STREET_TILE_SIZE * 2 ** 16 / (circumference(flat) * localScale);
}

function tileCoordinates([longitude, latitude], centerLongitude, count) {
  const unwrapped = centerLongitude + wrap(longitude - centerLongitude + 180, 360) - 180;
  const bounded = Math.max(-MAX_STREET_LATITUDE, Math.min(MAX_STREET_LATITUDE, latitude));
  const x = (unwrapped + 180) / 360 * count;
  const y = (1 - Math.asinh(Math.tan(bounded * RADIANS)) / Math.PI) * count / 2;
  return [x, Math.max(0, Math.min(count - 1e-9, y))];
}

function tileCorner(x, y, count) {
  const longitude = wrap(x, count) / count * 360 - 180;
  const latitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / count))) / RADIANS;
  return [longitude, latitude];
}

export function visibleStreetTiles(projection, [longitude, latitude], zoom, flat) {
  if (Math.abs(latitude) > MAX_STREET_LATITUDE) return [];
  const pixels = zoom * circumference(flat) * Math.cos(latitude * RADIANS);
  const level = Math.min(MAX_TILE_LEVEL, Math.floor(Math.log2(pixels / STREET_TILE_SIZE)));
  if (level < MIN_TILE_LEVEL) return [];

  const count = 2 ** level;
  const corners = VIEWPORT_CORNERS.map(point => tileCoordinates(projection.invert(point), longitude, count));
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const left = Math.floor(Math.min(...xs));
  const right = Math.floor(Math.max(...xs));
  const top = Math.floor(Math.min(...ys));
  const bottom = Math.floor(Math.max(...ys));
  if ((right - left + 1) * (bottom - top + 1) > 25) return [];

  const tiles = [];
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const [origin, east, south, opposite] = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]
        .map(([column, row]) => projection(tileCorner(column, row, count)));
      const corners = [origin, east, south, opposite];
      if (corners.every(([x]) => x < 0) || corners.every(([x]) => x > MAP_WIDTH)
        || corners.every(([, y]) => y < 0) || corners.every(([, y]) => y > MAP_HEIGHT)) continue;

      // At street zooms the projected tile is locally affine. Project all tiles in
      // the same frame as routes and geofences so panning and rotation stay aligned.
      const [a, b] = east.map((coordinate, axis) => (coordinate - origin[axis]) / STREET_TILE_SIZE);
      const [c, d] = south.map((coordinate, axis) => (coordinate - origin[axis]) / STREET_TILE_SIZE);
      tiles.push({
        path: `${level}/${wrap(x, count)}/${y}`,
        transform: `matrix(${[a, b, c, d, ...origin].join(' ')})`,
      });
    }
  }
  return tiles;
}
