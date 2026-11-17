import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geoAzimuthalEquidistant, geoOrthographic } from 'd3-geo';
import { GLOBE_RADIUS, MAP_CENTER } from './focus-map.mjs';
import { streetViewZoom, visibleStreetTiles } from './focus-streets.mjs';

function mapProjection([longitude, latitude, roll = 0], zoom, flat = false) {
  return (flat ? geoAzimuthalEquidistant() : geoOrthographic())
    .translate(MAP_CENTER)
    .rotate([-longitude, -latitude, roll])
    .scale(GLOBE_RADIUS * zoom * (flat ? 2 / Math.PI : 1));
}

test('street tiles project onto the same points as location overlays in both modes', () => {
  const center = [-122.4194, 37.7749, 37];
  for (const flat of [false, true]) {
    const zoom = streetViewZoom(center[1], flat);
    const projection = mapProjection(center, zoom, flat);
    const tiles = visibleStreetTiles(projection, center, zoom, flat);
    assert.ok(tiles.length >= 2 && tiles.length <= 12);
    for (const tile of tiles) {
      const [level, x, y] = tile.path.split('/').map(Number);
      assert.equal(level, 16);
      const count = 2 ** level;
      const streetMidpoint = [(x + 0.5) / count * 360 - 180,
        Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / count))) * 180 / Math.PI];
      const [a, b, c, d, e, f] = tile.transform.slice(7, -1).split(' ').map(Number);
      const [screenX, screenY] = projection(streetMidpoint);
      assert.ok(Math.hypot(screenX - ((a + c) * 128 + e), screenY - ((b + d) * 128 + f)) < 0.15);
    }
  }
});

test('street tiles wrap at the date line and keep valid row numbers near the poles', () => {
  for (const latitude of [0, 85.05, -85.05]) {
    const center = [179.999999, latitude, 18];
    const zoom = streetViewZoom(latitude, false);
    const tiles = visibleStreetTiles(mapProjection(center, zoom), center, zoom, false);
    const indices = tiles.map(tile => tile.path.split('/').map(Number));
    assert.ok(indices.some(([level, column]) => column === 2 ** level - 1));
    assert.ok(indices.some(([, column]) => column === 0));
    assert.ok(indices.every(([level, column, row]) => column >= 0 && row >= 0 && row < 2 ** level));
    assert.equal(new Set(tiles.map(tile => tile.path)).size, tiles.length);
  }
});

test('the globe skips street tiles at world scale and outside Mercator coverage', () => {
  const world = [0, 0];
  assert.deepEqual(visibleStreetTiles(mapProjection(world, 1), world, 1, false), []);
  const polar = [0, 88];
  const zoom = streetViewZoom(polar[1], false);
  assert.deepEqual(visibleStreetTiles(mapProjection(polar, zoom), polar, zoom, false), []);
  const closeZoom = zoom * 10;
  const detail = visibleStreetTiles(mapProjection(world, closeZoom), world, closeZoom, false);
  assert.ok(detail.length > 0);
  assert.ok(detail.every(tile => tile.path.startsWith('19/')));
});
