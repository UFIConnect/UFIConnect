import { measureLocation, zoneGeometry } from './focus-geofence.mjs';
import { MAX_ROUTE_POINTS, routeSegments } from './focus-tracking.mjs';

export const MAX_WALK_ACCURACY = 25;
const GPS_GAP_MS = 25_000;
const MAX_BOUNDARY_VERTICES = 100;
const MAX_BOUNDARY_SPAN = 20_000;
const distance = (start, end) => measureLocation(start, end, 0).distance;
const coordinate = ({ latitude, longitude, accuracy }) => ({ latitude, longitude, accuracy });

export function createWalk(mode) {
  return { mode, phase: 'ready', pin: null, points: [], lastFix: null, signal: '' };
}

export function interruptWalk(walk, signal) {
  return walk?.phase === 'walking' ? { ...walk, phase: 'paused', lastFix: null, signal } : walk;
}

export function appendWalkFix(walk, fix) {
  if (walk?.phase !== 'walking' || walk.signal === 'limit') return walk;
  if (fix.timestamp < walk.startedAt) return walk;
  const last = walk.points.at(-1);
  if (fix.timestamp <= (walk.lastFix ?? last?.timestamp ?? -Infinity)) return walk;
  if (fix.accuracy > MAX_WALK_ACCURACY) return walk.signal === 'accuracy' ? walk : { ...walk, signal: 'accuracy' };
  if (!last && walk.pin) {
    // GPS start pins carry their capture uncertainty. Manually placed pins have zero uncertainty.
    const pinAccuracy = Math.min(walk.pin.accuracy ?? 0, MAX_WALK_ACCURACY);
    if (distance(walk.pin, fix) > Math.max(15, pinAccuracy + fix.accuracy)) {
      return walk.signal === 'start' ? walk : { ...walk, signal: 'start' };
    }
  }

  const gap = last && (walk.lastFix === null || fix.timestamp - walk.lastFix >= GPS_GAP_MS);
  const movement = last ? distance(last, fix) : Infinity;
  if (gap && walk.mode === 'boundary' && movement > Math.max(10, Math.min(20, last.accuracy + fix.accuracy))) {
    return walk.signal === 'rejoin' ? walk : { ...walk, signal: 'rejoin', lastFix: null };
  }
  const report = { ...walk, lastFix: fix.timestamp, signal: '' };
  const startsSegment = !last || Boolean(gap && walk.mode === 'route');
  const returned = walk.mode === 'boundary' && walk.points.length >= 3 && distance(walk.points[0], fix) <= 10;
  if (last && !startsSegment && (fix.timestamp - last.timestamp < 2000
    || movement < (returned ? 3 : Math.max(4, (last.accuracy + fix.accuracy) / 2)))) return report;
  const point = { ...fix, segment: (last?.segment ?? 0) + Number(startsSegment), startsSegment };
  const points = [...walk.points, point];
  if (points.length >= MAX_ROUTE_POINTS) return { ...report, points, phase: 'review', signal: 'limit' };
  return { ...report, points };
}

function squaredDistance(point, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const length = dx * dx + dy * dy;
  const along = length ? Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / length)) : 0;
  return (point[0] - ax - dx * along) ** 2 + (point[1] - ay - dy * along) ** 2;
}

function simplify(points, tolerance) {
  const keep = new Set([0, points.length - 1]);
  const arcs = [[0, points.length - 1]];
  while (arcs.length) {
    const [start, end] = arcs.pop();
    let farthest = tolerance ** 2;
    let corner = null;
    for (let index = start + 1; index < end; index++) {
      const offset = squaredDistance(points[index], points[start], points[end]);
      if (offset <= farthest) continue;
      farthest = offset;
      corner = index;
    }
    if (corner === null) continue;
    keep.add(corner);
    arcs.push([start, corner], [corner, end]);
  }
  return [...keep].sort((a, b) => a - b);
}

function crossing(a, b, c, d) {
  const side = ([ax, ay], [bx, by], [cx, cy]) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  const intersects = (x, y, p, q) => Math.max(Math.min(x, y), Math.min(p, q)) <= Math.min(Math.max(x, y), Math.max(p, q));
  return intersects(a[0], b[0], c[0], d[0]) && intersects(a[1], b[1], c[1], d[1])
    && side(a, b, c) * side(a, b, d) <= 0 && side(c, d, a) * side(c, d, b) <= 0;
}

function selfIntersects(nodes) {
  return nodes.some((point, i) => nodes.some((other, j) => j > i + 1 && (i > 0 || j < nodes.length - 1)
    && crossing(point, nodes[(i + 1) % nodes.length], other, nodes[(j + 1) % nodes.length])));
}

export function reviewWalk({ mode, points }) {
  if (mode === 'route') return routeSegments(points).some(segment => segment.length >= 2)
    ? { points } : { error: 'Walk farther so the map can record a continuous stretch.' };
  if (points.length < 4) return { error: 'Walk around the area, record at least three corners, and return to the start.' };
  const [start] = points;
  const end = points.at(-1);
  if (distance(start, end) > Math.max(10, Math.min(20, start.accuracy + end.accuracy))) {
    return { error: 'Return to the starting point to close the boundary.' };
  }
  const open = points.slice(0, -1);
  // Working in local meters keeps small boundaries continuous at the date line.
  const planar = open.map(point => {
    const { distance: meters, bearing } = measureLocation(start, point, 0);
    return [meters * Math.sin(bearing), meters * Math.cos(bearing)];
  });
  if (planar.some(point => Math.hypot(...point) > MAX_BOUNDARY_SPAN)) {
    return { error: 'Choose a smaller area to walk around.' };
  }
  if (selfIntersects(planar)) return { error: 'The outline crosses itself. Walk around the outside of the area.' };
  let indices = open.map((_, index) => index);
  for (let tolerance = 2; indices.length > MAX_BOUNDARY_VERTICES && tolerance <= 12; tolerance *= 2) {
    indices = simplify(planar, tolerance);
  }
  if (indices.length > MAX_BOUNDARY_VERTICES) return { error: 'The outline has too many turns. Try walking a smaller area.' };
  const vertices = indices.map(index => coordinate(open[index]));
  const shape = { shape: 'polygon', center: vertices[0], vertices };
  if (selfIntersects(indices.map(index => planar[index])) || !zoneGeometry(shape)) {
    return { error: 'The outline needs at least three corners around an area.' };
  }
  return shape;
}
