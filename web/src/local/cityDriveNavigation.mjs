import { CITY_SITES, CITY_LANDMARKS, CITY_DISTRICT_ANCHOR, CITY_LOCAL_LINKS,
  cityCollectorPoints, cityRoadPoint, cityRoadPoints } from './cityEngineering.mjs';
import { createTrafficPath, createDriveTrafficPath, trafficPoint } from './cityTraffic.mjs';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
const dot = (a, b) => a[0] * b[0] + a[2] * b[2];
const cross = (a, b) => a[0] * b[2] - a[2] * b[0];
const label = site => site.label || site.id[0].toUpperCase() + site.id.slice(1);
const ground = points => points.map(point => [point[0], .08, point.length === 2 ? point[1] : point[2]]);
const arterialSurvey = cityRoadPoints('arterial');

// These are the same surveyed street centerlines that the city renders. The
// district spine connects its front entrance with the local street at the rear.
function buildStreetNetwork() {
  const nodes = new Map(), edges = [];
  const addNode = (id, position, properties = {}) => {
    const node = { id, position, edges: [], ...properties };
    nodes.set(id, node);
    return node;
  };
  const addEdge = (from, to, points, group, kind, streetLabel) => {
    const edge = { from, to, path: createTrafficPath(ground(points)), group, kind, streetLabel };
    edges.push(edge); from.edges.push(edge); to.edges.push(edge);
  };
  const sites = [...CITY_SITES, ...CITY_LANDMARKS].sort((a, b) => a.angle - b.angle);
  for (const site of sites) {
    const junction = addNode(`${site.id}:junction`, ground([site.junction])[0], { site, junction: true });
    const front = addNode(`${site.id}:front`, ground([site.entrance])[0], { frontSite: site });
    addEdge(junction, front, cityCollectorPoints(site), `collector:${site.id}`, 'collector', `${label(site)} street`);
    if (site.rotation != null) {
      const rear = addNode(`${site.id}:rear`, [site.x + Math.sin(site.rotation) * CITY_DISTRICT_ANCHOR,
        .08, site.z + Math.cos(site.rotation) * CITY_DISTRICT_ANCHOR], { rearSite: site });
      addEdge(front, rear, [front.position, rear.position], `collector:${site.id}`, 'district', `${label(site)} street`);
    }
  }
  for (let i = 1; i < sites.length; i++) {
    const from = sites[i - 1], to = sites[i], count = Math.max(2, Math.ceil((to.angle - from.angle) / .002));
    const points = Array.from({ length: count + 1 }, (_, j) => cityRoadPoint('arterial', from.angle + (to.angle - from.angle) * j / count));
    addEdge(nodes.get(`${from.id}:junction`), nodes.get(`${to.id}:junction`), points, 'arterial', 'arterial', 'Main street');
  }
  const entrances = [...nodes.values()].filter(node => node.frontSite || node.rearSite);
  const endpoint = point => entrances.find(node => distance(node.position, [point[0], .08, point[2]]) < .05);
  for (const points of CITY_LOCAL_LINKS) {
    const from = endpoint(points[0]), to = endpoint(points.at(-1));
    if (from && to) {
      const side = (from.frontSite || from.rearSite).side;
      addEdge(from, to, points, `local:${side}`, 'local', side < 0 ? 'Terrace street' : 'Waterfront street');
    }
  }
  return { nodes, edges };
}
const streets = buildStreetNetwork();

function oriented(edge, forward) {
  return { edge, forward, from: forward ? edge.from : edge.to, to: forward ? edge.to : edge.from,
    points: forward ? edge.path.points : [...edge.path.points].reverse() };
}
function leaving(edge, node) { return oriented(edge, edge.from === node); }
function directionAtStart(road) {
  const path = road.edge.path;
  const sample = trafficPoint(path, road.forward ? Math.min(1, path.length) : Math.max(0, path.length - 1));
  return sample.heading.map(value => value * (road.forward ? 1 : -1));
}
function directionAtEnd(road) {
  const path = road.edge.path;
  const sample = trafficPoint(path, road.forward ? Math.max(0, path.length - 1) : Math.min(1, path.length));
  return sample.heading.map(value => value * (road.forward ? 1 : -1));
}
function projection(path, point, minimum = 0) {
  let best = null;
  for (let i = 1; i < path.points.length; i++) {
    if (path.cumulative[i] < minimum) continue;
    const a = path.points[i - 1], b = path.points[i], dx = b[0] - a[0], dz = b[2] - a[2], squared = dx * dx + dz * dz;
    const low = clamp((minimum - path.cumulative[i - 1]) / (path.cumulative[i] - path.cumulative[i - 1]), 0, 1);
    const t = squared ? clamp(((point[0] - a[0]) * dx + (point[2] - a[2]) * dz) / squared, low, 1) : low;
    const position = a.map((value, axis) => value + (b[axis] - value) * t);
    const separation = distance(point, position);
    if (!best || separation < best.separation) best = { separation, position,
      distance: path.cumulative[i - 1] + t * (path.cumulative[i] - path.cumulative[i - 1]) };
  }
  return best;
}
function locateStreet(sample) {
  let best = null;
  for (const edge of streets.edges) {
    const projected = projection(edge.path, sample.position);
    if (projected.separation > 2.6) continue;
    const alignment = dot(trafficPoint(edge.path, projected.distance).heading, sample.heading);
    const score = projected.separation + (1 - Math.abs(alignment)) * 2;
    if (!best || score < best.score) best = { ...projected, score, road: oriented(edge, alignment >= 0) };
  }
  return best;
}
function remainingRoad(located) {
  const { edge, forward } = located.road;
  const points = forward
    ? edge.path.points.filter((_, i) => edge.path.cumulative[i] > located.distance + .000001)
    : edge.path.points.filter((_, i) => edge.path.cumulative[i] < located.distance - .000001).reverse();
  return [located.position, ...points];
}
function straightRoad(road) {
  const heading = directionAtEnd(road), choices = road.to.edges.filter(edge => edge !== road.edge).map(edge => leaving(edge, road.to));
  const sameStreet = choices.find(next => next.edge.group === road.edge.group);
  if (sameStreet) return sameStreet;
  return choices.filter(next => dot(heading, directionAtStart(next)) > .8)
    .sort((a, b) => dot(heading, directionAtStart(b)) - dot(heading, directionAtStart(a)))[0] || null;
}
function appendRoad(points, road) { points.push(...road.points.slice(1)); }

// After the requested turn, finish at an entrance on the selected street. The
// next turn request can extend that route through the next connected junction.
function finishRoute(points, selected) {
  let road = selected;
  const visited = new Set();
  for (let i = 0; i < streets.edges.length; i++) {
    if (road.to.frontSite) return road.to.frontSite;
    if (visited.has(road.edge)) return null;
    visited.add(road.edge);
    const choices = road.to.edges.filter(edge => edge !== road.edge).map(edge => leaving(edge, road.to));
    let next = choices.find(candidate => candidate.to.frontSite);
    if (!next) next = straightRoad(road);
    if (!next) next = choices.sort((a, b) => dot(directionAtEnd(road), directionAtStart(b)) - dot(directionAtEnd(road), directionAtStart(a)))[0];
    if (!next) return null;
    appendRoad(points, next); road = next;
  }
  return null;
}
function cutPath(path, start, end) {
  return [trafficPoint(path, start).position,
    ...path.points.filter((_, i) => path.cumulative[i] > start + .000001 && path.cumulative[i] < end - .000001),
    trafficPoint(path, end).position];
}
function cubicJoin(start, end, startHeading, endHeading) {
  const reach = Math.min(2.4, Math.max(.2, distance(start, end) * .45));
  const first = start.map((value, axis) => value + startHeading[axis] * reach);
  const second = end.map((value, axis) => value - endHeading[axis] * reach);
  return Array.from({ length: 17 }, (_, index) => {
    const t = index / 16, u = 1 - t;
    return start.map((value, axis) => u ** 3 * value + 3 * u * u * t * first[axis]
      + 3 * u * t * t * second[axis] + t ** 3 * end[axis]);
  });
}
function roundedLane(points) {
  const clean = createTrafficPath(points).points, rounded = [clean[0]];
  for (let i = 1; i < clean.length - 1; i++) {
    const a = clean[i - 1], b = clean[i], c = clean[i + 1];
    const beforeLength = distance(a, b), afterLength = distance(b, c), radius = Math.min(.6, beforeLength / 3, afterLength / 3);
    const before = b.map((value, axis) => value + (a[axis] - value) * radius / beforeLength);
    const after = b.map((value, axis) => value + (c[axis] - value) * radius / afterLength);
    rounded.push(before);
    for (let j = 1; j <= 4; j++) {
      const t = j / 4, u = 1 - t;
      rounded.push(b.map((value, axis) => u * u * before[axis] + 2 * u * t * value + t * t * after[axis]));
    }
  }
  rounded.push(clean.at(-1));
  return createDriveTrafficPath(rounded, arterialSurvey);
}

function installStreetRoute(vehicle, points, junction) {
  const currentDistance = clamp(vehicle.distance || 0, 0, vehicle.path.length);
  const lane = roundedLane(points);
  const crossing = projection(lane, junction);
  let spliceDistance = currentDistance;
  let joinDistance = Math.min(.8, lane.length / 3, Math.max(.1, crossing.distance / 2));
  const existingCrossing = projection(vehicle.path, junction, currentDistance);
  // Keep the already scheduled approach unchanged when it reaches this same
  // junction. Only replace its turn; a route ending earlier uses the survey.
  if (existingCrossing?.separation < 2.6 && Math.abs(existingCrossing.distance - currentDistance - crossing.distance) < 2) {
    const followsStreet = [.25, .5, .75].every(portion => {
      const sample = trafficPoint(vehicle.path, currentDistance + (existingCrossing.distance - currentDistance) * portion);
      const match = projection(lane, sample.position);
      return match.separation < .8 && dot(sample.heading, trafficPoint(lane, match.distance).heading) > .75;
    });
    if (followsStreet) {
      spliceDistance = Math.max(currentDistance, existingCrossing.distance - 1.4);
      joinDistance = Math.min(lane.length, crossing.distance + 1.6);
    }
  }
  const beforeJoin = trafficPoint(vehicle.path, spliceDistance);
  const afterJoin = trafficPoint(lane, joinDistance);
  const join = cubicJoin(beforeJoin.position, afterJoin.position, beforeJoin.heading, afterJoin.heading);
  const prefix = cutPath(vehicle.path, 0, spliceDistance);
  const tail = cutPath(lane, joinDistance, lane.length);
  const path = createTrafficPath([...prefix, ...join.slice(1), ...tail.slice(1)]);
  const turnDistance = projection(path, junction, spliceDistance).distance;
  return { path, distance: currentDistance, turnDistance };
}

export function planNextStreetTurn(vehicle, direction) {
  if (!vehicle?.path || (direction !== -1 && direction !== 1)) return null;
  const currentDistance = clamp(vehicle.distance || 0, 0, vehicle.path.length);
  const current = trafficPoint(vehicle.path, currentDistance), located = locateStreet(current);
  if (!located) return null;
  const points = remainingRoad(located), visited = new Set();
  let road = located.road, selected = null, junction = null;
  for (let i = 0; i < streets.edges.length; i++) {
    if (visited.has(road.edge)) break;
    visited.add(road.edge);
    const heading = directionAtEnd(road);
    const turns = road.to.edges.filter(edge => edge !== road.edge).map(edge => leaving(edge, road.to))
      .filter(next => next.edge.group !== road.edge.group && cross(heading, directionAtStart(next)) * direction > .22
        && dot(heading, directionAtStart(next)) > -.8)
      .sort((a, b) => Math.abs(cross(heading, directionAtStart(b))) - Math.abs(cross(heading, directionAtStart(a))));
    if (turns.length) { selected = turns[0]; junction = road.to.position; break; }
    const next = straightRoad(road);
    if (!next) break;
    appendRoad(points, next); road = next;
  }
  if (!selected) return null;
  appendRoad(points, selected);
  const destination = finishRoute(points, selected);
  return { ...installStreetRoute(vehicle, points, junction), direction,
    destinationId: destination?.id, streetLabel: selected.edge.streetLabel };
}

export function planDriveDestination(vehicle, destinationId) {
  if (!vehicle?.path) return null;
  const goal = streets.nodes.get(`${destinationId}:front`);
  const currentDistance = clamp(vehicle.distance || 0, 0, vehicle.path.length);
  const located = locateStreet(trafficPoint(vehicle.path, currentDistance));
  if (!goal || !located) return null;
  // Start at the junction ahead, so changing a destination never flips the car
  // around mid-street. Only a road end permits retracing the incoming street.
  const queue = [{ road: located.road, cost: 0, route: [] }], best = new Map();
  let route = null;
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const candidate = queue.shift(), { road } = candidate;
    const key = `${road.to.id}:${streets.edges.indexOf(road.edge)}`;
    if ((best.get(key) ?? Infinity) <= candidate.cost) continue;
    best.set(key, candidate.cost);
    if (road.to === goal) { route = candidate.route; break; }
    const forward = road.to.edges.filter(edge => edge !== road.edge);
    const choices = forward.length ? forward : [road.edge];
    for (const edge of choices) {
      const next = leaving(edge, road.to);
      const turn = 2 * (1 - dot(directionAtEnd(road), directionAtStart(next)));
      queue.push({ road: next, cost: candidate.cost + edge.path.length + turn, route: [...candidate.route, next] });
    }
  }
  if (!route) return null;
  const points = remainingRoad(located);
  for (const road of route) appendRoad(points, road);
  if (!points.some(point => distance(point, points[0]) > .000001)) {
    return currentDistance > .000001
      ? { path: createTrafficPath(cutPath(vehicle.path, 0, currentDistance)), distance: currentDistance }
      : null;
  }
  const { path, distance: position } = installStreetRoute(vehicle, points, located.road.to.position);
  return { path, distance: position };
}

// A drive starts partway along a road, with surveyed pavement behind the car.
// Store that approach in its path so holding the brake can reverse from spawn.
export function prependDriveApproach(path, length = 20) {
  const start = trafficPoint(path, 0), located = locateStreet(start);
  if (!located) return { path, distance: 0 };
  const backward = { ...located, road: oriented(located.road.edge, !located.road.forward) };
  const points = remainingRoad(backward), visited = new Set();
  let road = backward.road;
  let available = points.length > 1 ? createTrafficPath(points).length : 0;
  while (available < length && !visited.has(road.edge)) {
    visited.add(road.edge);
    const next = straightRoad(road);
    if (!next) break;
    appendRoad(points, next); road = next;
    available = createTrafficPath(points).length;
  }
  if (available < .1) return { path, distance: 0 };
  const behind = createTrafficPath(points), approach = roundedLane(cutPath(behind, 0, Math.min(length, available)).reverse());
  const splice = Math.max(0, approach.length - .8), beforeJoin = trafficPoint(approach, splice);
  const join = cubicJoin(beforeJoin.position, start.position, beforeJoin.heading, start.heading);
  const lead = createTrafficPath([...cutPath(approach, 0, splice), ...join.slice(1)]);
  return { path: createTrafficPath([...lead.points, ...path.points.slice(1)]), distance: lead.length };
}
