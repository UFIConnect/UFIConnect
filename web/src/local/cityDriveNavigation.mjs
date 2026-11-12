import { CITY_SITES, CITY_LANDMARKS, CITY_DISTRICT_ANCHOR, CITY_LOCAL_LINKS, CITY_END_ROADS,
  CITY_HIGHWAY_KINDS, CITY_FREEWAY_NAMES, CITY_FREEWAY_HEIGHT, CITY_FREEWAY_LANES, CITY_FREEWAY_CONNECTIONS,
  cityCollectorPoints, cityEndRoadPoint, cityRoadPoint, cityRoadPoints, cityRoadPosition } from './cityEngineering.mjs';
import { createTrafficPath, trafficPoint } from './cityTraffic.mjs';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
const dot = (a, b) => a[0] * b[0] + a[2] * b[2];
const cross = (a, b) => a[0] * b[2] - a[2] * b[0];
const label = site => site.label || site.id[0].toUpperCase() + site.id.slice(1);
const atHeight = ([x, z], height) => [x, height, z];
const ARTERIAL_HEIGHT = .105;

function offsetLane(points, offset) {
  return points.map(([x, y, z], index) => {
    const a = points[Math.max(0, index - 1)], b = points[Math.min(points.length - 1, index + 1)];
    const dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz) || 1;
    return [x - dz / length * offset, y, z + dx / length * offset];
  });
}

function buildStreetNetwork() {
  const nodes = new Map(), edges = [];
  const corridors = new Map();
  function addCorridor(id, kind, name, offset, pointAt, axis = 0) {
    corridors.set(id, { kind, name, offset, pointAt, axis, junctions: [] });
  }
  addCorridor('arterial', 'street', 'Main street', .9,
    x => atHeight(cityRoadPoint('arterial', cityRoadPosition('arterial', x)), ARTERIAL_HEIGHT));
  for (const id of CITY_HIGHWAY_KINDS) {
    addCorridor(id, 'freeway', CITY_FREEWAY_NAMES[id], CITY_FREEWAY_LANES.outer,
      x => atHeight(cityRoadPoint(id, cityRoadPosition(id, x)), CITY_FREEWAY_HEIGHT));
  }
  for (const road of CITY_END_ROADS) {
    addCorridor(road.id, 'connector', road.side < 0 ? 'West connector' : 'East connector', .85,
      z => cityEndRoadPoint(road.side, (z + 44) / 110), 2);
  }

  function addNode(id, position, properties = {}) {
    const node = { id, position, roads: [], ...properties };
    nodes.set(id, node);
    return node;
  }
  function addJunction(corridor, id, position) {
    const station = position[corridor.axis];
    const existing = corridor.junctions.find(node => Math.abs(node.position[corridor.axis] - station) < .0001);
    if (existing) return existing;
    const node = addNode(id, corridor.pointAt(station));
    corridor.junctions.push(node);
    return node;
  }
  function addEdge(from, to, points, group, kind, names, offset) {
    const edge = { id: edges.length, group, kind, roads: [] };
    const survey = [from.position, ...points.slice(1, -1), to.position];
    const forward = { edge, from, to, forward: true, streetLabel: names[0], path: createTrafficPath(offsetLane(survey, offset)) };
    const reverse = { edge, from: to, to: from, forward: false, streetLabel: names[1] || names[0],
      path: createTrafficPath(offsetLane([...survey].reverse(), offset)) };
    edge.roads.push(forward, reverse);
    edges.push(edge); from.roads.push(forward); to.roads.push(reverse);
  }

  for (const site of [...CITY_SITES, ...CITY_LANDMARKS]) {
    const junction = addJunction(corridors.get('arterial'), site.id + ':junction', atHeight(site.junction, ARTERIAL_HEIGHT));
    const front = addNode(site.id + ':front', atHeight(site.entrance, .105), { site, frontSite: site });
    const group = 'collector:' + site.id, name = label(site) + ' street';
    addEdge(junction, front, cityCollectorPoints(site), group, 'street', [name], .4);
    if (site.rotation != null) {
      const rear = addNode(site.id + ':rear', [site.x + Math.sin(site.rotation) * CITY_DISTRICT_ANCHOR,
        .105, site.z + Math.cos(site.rotation) * CITY_DISTRICT_ANCHOR], { site });
      addEdge(front, rear, [front.position, rear.position], group, 'street', [name], .4);
    }
  }
  const entrances = [...nodes.values()].filter(node => node.site);
  const endpoint = point => entrances.find(node => distance(node.position, [point[0], .105, point[2]]) < .05);
  for (const points of CITY_LOCAL_LINKS) {
    const from = endpoint(points[0]), to = endpoint(points.at(-1));
    const side = from.site.side;
    addEdge(from, to, points, 'local:' + side, 'street', [side < 0 ? 'Terrace street' : 'Waterfront street'], .4);
  }
  for (const connection of CITY_FREEWAY_CONNECTIONS) {
    const { id, points, from, to, corner } = connection;
    const departure = corridors.has(from) ? addJunction(corridors.get(from), id + ':start', points[0]) : nodes.get(from);
    const arrival = corridors.has(to) ? addJunction(corridors.get(to), id + ':end', points.at(-1)) : nodes.get(to);
    const streetName = roadId => {
      const name = corridors.get(roadId)?.name || label(nodes.get(roadId).site);
      if (corner) return name;
      return name + (roadId === 'arterial' || nodes.has(roadId) ? ' exit' : ' ramp');
    };
    const names = [streetName(to), streetName(from)];
    addEdge(departure, arrival, points, id, 'connector', names, corner ? .85 : .58);
  }
  for (const [id, corridor] of corridors) {
    const { axis, junctions, pointAt, kind, name, offset } = corridor;
    junctions.sort((a, b) => a.position[axis] - b.position[axis]);
    for (let i = 1; i < junctions.length; i++) {
      const from = junctions[i - 1], to = junctions[i], start = from.position[axis];
      const span = to.position[axis] - start, count = Math.ceil(span / .65);
      const points = Array.from({ length: count + 1 }, (_, j) => pointAt(start + span * j / count));
      addEdge(from, to, points, id, kind, [name], offset);
    }
  }
  return { nodes, edges };
}
const streets = buildStreetNetwork();

const startHeading = road => trafficPoint(road.path, Math.min(.8, road.path.length)).heading;
const endHeading = road => trafficPoint(road.path, Math.max(0, road.path.length - .8)).heading;
const opposite = road => road.edge.roads[road.forward ? 1 : 0];

function projection(path, point, minimum = 0) {
  let best = null;
  for (let i = 1; i < path.points.length; i++) {
    if (path.cumulative[i] < minimum) continue;
    const a = path.points[i - 1], b = path.points[i], delta = b.map((value, axis) => value - a[axis]);
    const length = path.cumulative[i] - path.cumulative[i - 1];
    const low = clamp((minimum - path.cumulative[i - 1]) / length, 0, 1);
    const t = clamp(delta.reduce((sum, value, axis) => sum + value * (point[axis] - a[axis]), 0) / length ** 2, low, 1);
    const position = a.map((value, axis) => value + delta[axis] * t);
    const separation = distance(point, position);
    if (!best || separation < best.separation) best = { separation, position, distance: path.cumulative[i - 1] + t * length };
  }
  return best;
}

function locateStreet(sample) {
  let best = null;
  for (const edge of streets.edges) for (const road of edge.roads) {
    const projected = projection(road.path, sample.position);
    if (projected.separation > 3.2 || Math.abs(projected.position[1] - sample.position[1]) > .65) continue;
    const alignment = dot(trafficPoint(road.path, projected.distance).heading, sample.heading);
    if (alignment < -.2) continue;
    const score = projected.separation + (1 - alignment) * 2;
    if (!best || score < best.score) best = { ...projected, score, road };
  }
  return best;
}

function outgoingRoads(road) {
  const heading = endHeading(road);
  // A tangential freeway merge serves the matching direction. It cannot be
  // used to turn back across the divider into opposing traffic.
  return road.to.roads.filter(next => next.edge !== road.edge &&
    (road.to.position[1] < 1 || dot(heading, startHeading(next)) > -.75));
}

function straightRoad(road) {
  const choices = outgoingRoads(road), heading = endHeading(road);
  return choices.find(next => next.edge.group === road.edge.group) ||
    choices.filter(next => dot(heading, startHeading(next)) > .8)
      .sort((a, b) => dot(heading, startHeading(b)) - dot(heading, startHeading(a)))[0] || null;
}

function findRoute(start, { goal, viaFreeway = false, local = false } = {}) {
  const queue = [{ road: start, cost: 0, roads: [start], freeway: start.edge.kind === 'freeway' }], visited = new Set();
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const candidate = queue.shift(), { road, freeway } = candidate;
    const key = road.edge.id + ':' + road.forward + ':' + freeway;
    if (visited.has(key)) continue;
    visited.add(key);
    if ((goal ? road.to === goal : road.to.frontSite) && (!viaFreeway || freeway)) return candidate;
    const forward = outgoingRoads(road);
    const choices = forward.length ? forward : road.to.position[1] < 1 ? [opposite(road)] : [];
    for (const next of choices) {
      if (local && road.edge.kind === 'street' && next.edge.kind !== 'street') continue;
      const turn = 3 * (1 - dot(endHeading(road), startHeading(next)));
      const length = next.path.length * (viaFreeway && next.edge.kind === 'freeway' ? .72 : 1);
      queue.push({ road: next, cost: candidate.cost + length + turn, roads: [...candidate.roads, next],
        freeway: freeway || next.edge.kind === 'freeway' });
    }
  }
  return null;
}

function cutPath(path, start, end) {
  return [trafficPoint(path, start).position,
    ...path.points.filter((_, i) => path.cumulative[i] > start + .000001 && path.cumulative[i] < end - .000001),
    trafficPoint(path, end).position];
}

function cubicJoin(start, end, startHeading, endHeading) {
  const reach = Math.min(3, Math.max(.2, distance(start, end) * .45));
  const first = start.map((value, axis) => value + startHeading[axis] * reach);
  const second = end.map((value, axis) => value - endHeading[axis] * reach);
  return Array.from({ length: 17 }, (_, index) => {
    const t = index / 16, u = 1 - t;
    return start.map((value, axis) => u ** 3 * value + 3 * u * u * t * first[axis]
      + 3 * u * t * t * second[axis] + t ** 3 * end[axis]);
  });
}

function routeLane(roads, start = 0) {
  const points = [];
  for (let i = 0; i < roads.length; i++) {
    const road = roads[i], next = roads[i + 1], length = road.path.length;
    if (!next || (next.edge.group === road.edge.group && next.edge !== road.edge &&
      distance(road.path.points.at(-1), next.path.points[0]) < .05)) {
      points.push(...cutPath(road.path, start, length));
      start = 0;
      continue;
    }
    const wideMerge = road.to.position[1] > 1 && dot(endHeading(road), startHeading(next)) > .75;
    const reach = wideMerge ? 4.5 : 1.4;
    const before = length - Math.min(reach, (length - start) / 2);
    const after = Math.min(reach, next.path.length / 3);
    const a = trafficPoint(road.path, before), b = trafficPoint(next.path, after);
    points.push(...cutPath(road.path, start, before), ...cubicJoin(a.position, b.position, a.heading, b.heading).slice(1));
    start = after;
  }
  return points;
}

function installStreetRoute(vehicle, points, junction) {
  const currentDistance = clamp(vehicle.distance || 0, 0, vehicle.path.length);
  if (!points.some(point => distance(point, points[0]) > .000001)) {
    return currentDistance > .000001
      ? { path: createTrafficPath(cutPath(vehicle.path, 0, currentDistance)), distance: currentDistance }
      : null;
  }
  const lane = createTrafficPath(points);
  const crossing = projection(lane, junction);
  let spliceDistance = currentDistance;
  let joinDistance = Math.min(.8, lane.length / 3, Math.max(.1, crossing.distance / 2));
  const existingCrossing = projection(vehicle.path, junction, currentDistance);
  // Retain the scheduled approach when the route is already following it.
  if (existingCrossing?.separation < 3 && Math.abs(existingCrossing.distance - currentDistance - crossing.distance) < 2) {
    const followsStreet = [.25, .5, .75].every(portion => {
      const sample = trafficPoint(vehicle.path, currentDistance + (existingCrossing.distance - currentDistance) * portion);
      const match = projection(lane, sample.position);
      return match.separation < .7 && dot(sample.heading, trafficPoint(lane, match.distance).heading) > .8;
    });
    if (followsStreet) {
      spliceDistance = Math.max(currentDistance, existingCrossing.distance - 1.4);
      joinDistance = Math.min(lane.length, crossing.distance + 1.6);
    }
  }
  const a = trafficPoint(vehicle.path, spliceDistance), b = trafficPoint(lane, joinDistance);
  const join = cubicJoin(a.position, b.position, a.heading, b.heading);
  const path = createTrafficPath([...cutPath(vehicle.path, 0, spliceDistance), ...join.slice(1), ...cutPath(lane, joinDistance, lane.length).slice(1)]);
  return { path, distance: currentDistance, turnDistance: projection(path, junction, spliceDistance).distance };
}

// Freeway exits begin tangentially. Look down the branch to find which side
// it opens on, comparing with the continued lane on a curved mainline.
function turnSide(road, next, through) {
  const heading = endHeading(road);
  const sample = Math.min(12, next.path.length);
  const along = candidate => {
    const point = trafficPoint(candidate.path, sample), start = candidate.path.points[0];
    return point.position.map((value, axis) => value - start[axis] + point.heading[axis] * Math.max(0, sample - candidate.path.length));
  };
  const straight = through && through.edge.group === road.edge.group ? along(through) : heading.map(value => value * sample);
  return cross(heading, along(next).map((value, axis) => value - straight[axis])) / sample;
}

export function planNextStreetTurn(vehicle, direction) {
  if (!vehicle?.path || (direction !== -1 && direction !== 1)) return null;
  const located = locateStreet(trafficPoint(vehicle.path, vehicle.distance));
  if (!located) return null;
  const approach = [], visited = new Set();
  let road = located.road;
  while (road && !visited.has(road.edge)) {
    visited.add(road.edge); approach.push(road);
    const through = straightRoad(road);
    const turns = outgoingRoads(road).filter(next => next.edge.group !== road.edge.group && dot(endHeading(road), startHeading(next)) > -.8)
      .map(next => ({ road: next, side: turnSide(road, next, through) * direction }))
      .filter(candidate => candidate.side > .045).sort((a, b) => b.side - a.side);
    for (const { road: selected } of turns) {
      const route = findRoute(selected, { viaFreeway: road.edge.kind === 'street' && selected.edge.kind !== 'street' });
      if (!route) continue;
      const installed = installStreetRoute(vehicle, routeLane([...approach, ...route.roads], located.distance), road.to.position);
      if (installed) return { ...installed, direction, destinationId: route.road.to.frontSite.id, streetLabel: selected.streetLabel };
    }
    road = through;
  }
  return null;
}

export function planDriveDestination(vehicle, destinationId, { viaFreeway = false } = {}) {
  if (!vehicle?.path) return null;
  const goal = streets.nodes.get(destinationId + ':front');
  const located = locateStreet(trafficPoint(vehicle.path, vehicle.distance));
  if (!goal || !located) return null;
  const route = findRoute(located.road, { goal, viaFreeway, local: !viaFreeway });
  if (!route) return null;
  return installStreetRoute(vehicle, routeLane(route.roads, located.distance), located.road.to.position);
}

export function startCityDrive(destinationId, options) {
  const destination = streets.nodes.get(destinationId + ':front')?.frontSite;
  if (!destination) return null;
  const preferredDirection = destination.angle >= .5;
  let best = null;
  for (const forward of options?.viaFreeway ? [preferredDirection, !preferredDirection] : [preferredDirection]) {
    const offset = forward ? -.9 : .9;
    const points = cityRoadPoints('arterial', offset, ARTERIAL_HEIGHT);
    const road = createTrafficPath(forward ? points : points.reverse());
    const spawn = projection(road, atHeight(cityRoadPoint('arterial', .5, offset), ARTERIAL_HEIGHT));
    const start = Math.max(0, spawn.distance - 20);
    const approach = createTrafficPath(cutPath(road, start, Math.min(road.length, spawn.distance + 20)));
    const route = planDriveDestination({ path: approach, distance: spawn.distance - start }, destinationId, options);
    if (route && (!best || route.path.length - route.distance < best.path.length - best.distance)) best = route;
  }
  return best;
}

export function freewayTrafficPath(index) {
  const edge = streets.edges.find(road => road.group === 'interchange-' + index);
  const [link] = edge.roads;
  const forward = startHeading(link)[0] > 0;
  function follow(node, group, forward) {
    const roads = [];
    for (let road = node.roads.find(item => item.edge.group === group && item.forward === forward); road;
      road = road.to.roads.find(item => item.edge.group === group && item.forward === forward)) roads.push(road);
    return roads;
  }
  const approach = follow(link.from, 'highway', !forward).reverse().map(opposite);
  const departure = follow(link.to, 'highway-return', forward);
  return createTrafficPath(routeLane([...approach, link, ...departure]), { loop: true });
}
