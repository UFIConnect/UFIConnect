// Survey-style centerlines supply geometry, junctions, traffic and drive routes.
// District collectors join the arterial at right angles. Separate open highway
// and tram alignments follow the valley, with branches into staggered districts.
export function cityRoadPoint(kind, position, offset = 0) {
  const evaluate = a => {
    const valley = 23 + 8 * Math.sin((a - .5) * Math.PI * 1.6) + 3 * Math.sin((a - .5) * Math.PI * 3);
    if (kind === 'highway') return [(a - .5) * 260, -47 + 5 * Math.sin(a * Math.PI) + 2 * Math.sin(a * Math.PI * 3)];
    if (kind === 'highway-return') return [(a - .5) * 260, 16 + 1.5 * Math.sin((a - .5) * Math.PI)];
    if (kind === 'transit') return [(a - .5) * 232, valley + 8];
    if (kind === 'promenade') return [(a - .5) * 32.4, -18 + 1.8 * Math.sin(a * Math.PI * 2)];
    return [(a - .5) * 232, valley];
  };
  const point = evaluate(position), before = evaluate(position - .0001), after = evaluate(position + .0001);
  const dx = after[0] - before[0], dz = after[1] - before[1], length = Math.hypot(dx, dz);
  return [point[0] + dz / length * offset, point[1] - dx / length * offset];
}
export const cityRoadPoints = (kind, offset = 0, height = .075, segments = 384) => Array.from({ length: segments + 1 }, (_, i) => {
  const bounds = kind === 'arterial' ? CITY_ARTERIAL_BOUNDS : [0, 1];
  const point = cityRoadPoint(kind, bounds[0] + (bounds[1] - bounds[0]) * i / segments, offset);
  return [point[0], height, point[1]];
});
export const CITY_SITES = Array.from({ length: 16 }, (_, i) => {
  const station = Math.floor(i / 2), side = i % 2 ? 1 : -1, x = [-106, -78, -50, -22, 22, 50, 78, 106][station] + side * 2;
  const setback = (side < 0 ? 32 : 24) + station % 3 * 2, z = cityRoadPoint('arterial', .5 + x / 232)[1] + side * setback;
  const nearest = nearestCityArterial([x, z]), angle = nearest.angle, junction = nearest.point;
  const distance = Math.hypot(x - junction[0], z - junction[1]), nx = (x - junction[0]) / distance, nz = (z - junction[1]) / distance;
  return { x, z, angle, rotation: Math.atan2(nx, nz), junction,
    // Compact districts use scale .58, two six-unit rows, and mid = 6.5.
    entrance: [x - nx * 11.5 * .58, z - nz * 11.5 * .58] };
});
export function nearestCityArterial(point) {
  let best = 0, distance = Infinity;
  for (let i = 0; i < 384; i++) {
    const angle = i / 384, candidate = cityRoadPoint('arterial', angle);
    const next = Math.hypot(candidate[0] - point[0], candidate[1] - point[1]);
    if (next < distance) { distance = next; best = angle; }
  }
  let step = 1 / 384;
  for (let i = 0; i < 16; i++) {
    for (const angle of [best - step, best + step]) {
      const candidate = cityRoadPoint('arterial', angle), next = Math.hypot(candidate[0] - point[0], candidate[1] - point[1]);
      if (next < distance) { distance = next; best = angle; }
    }
    step /= 2;
  }
  return { angle: best, point: cityRoadPoint('arterial', best) };
}
// Tangential expressway departures curve into gaps between districts. Elevation
// changes along distance with zero grade at either end, avoiding abrupt crests.
export const CITY_AIRPORT = { id: 'airport', label: 'Airport', to: '/?feed=countries', focus: [-99, 72], camera: [20, 35, 44], entrance: [-90, 60], junction: cityRoadPoint('arterial', .5 - 90 / 232), angle: .5 - 90 / 232 };
export const CITY_SHOPPING = { id: 'shopping', label: 'Shopping center', to: '/?feed=ufi&channel=shop', focus: [44, 89], camera: [22, 29, -40], entrance: [64, 83], junction: cityRoadPoint('arterial', .5 + 64 / 232), angle: .5 + 64 / 232 };
export const CITY_LANDMARKS = [CITY_AIRPORT, CITY_SHOPPING];
export const CITY_ARTERIAL_BOUNDS = [Math.min(...[...CITY_SITES, ...CITY_LANDMARKS].map(site => site.angle)), Math.max(...[...CITY_SITES, ...CITY_LANDMARKS].map(site => site.angle))];
export function citySegmentDistance(point, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], squared = dx * dx + dz * dz;
  const t = squared ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / squared)) : 0;
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz);
}
export function cityCollectorPoints(site, segments = 48) {
  if (site.collector) return site.collector;
  const a = site.junction, d = site.entrance, dx = d[0] - a[0], dz = d[1] - a[1], length = Math.hypot(dx, dz) || 1;
  if (site.id) return [a, d].map(([x, z]) => [x, .11, z]);
  const next = cityRoadPoint('arterial', site.angle + .001), tx = next[0] - a[0], tz = next[1] - a[1], tangent = Math.hypot(tx, tz), bend = Math.min(5, length * .3) * (dz > 0 ? 1 : -1);
  const b = [a[0] + tx / tangent * bend + dx / length * 2, a[1] + tz / tangent * bend + dz / length * 2];
  const c = [d[0] - dx / length * 5 + tx / tangent * bend * .5, d[1] - dz / length * 5 + tz / tangent * bend * .5];
  return Array.from({ length: segments + 1 }, (_, i) => {
    const t = i / segments, u = 1 - t;
    return [u ** 3 * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t ** 3 * d[0], .11,
      u ** 3 * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t ** 3 * d[1]];
  });
}
export function cityDriveOrigin(point) {
  const nearest = nearestCityArterial(point);
  let distance = Math.hypot(point[0] - nearest.point[0], point[1] - nearest.point[1]);
  let origin = { entrance: nearest.point, junction: nearest.point, angle: nearest.angle, collector: [[nearest.point[0], .11, nearest.point[1]]] };
  for (const site of [...CITY_SITES, ...CITY_LANDMARKS]) {
    const points = cityCollectorPoints(site);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], dx = b[0] - a[0], dz = b[2] - a[2], squared = dx * dx + dz * dz;
      const t = squared ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[2]) * dz) / squared)) : 0;
      const projected = [a[0] + t * dx, .11, a[2] + t * dz], next = Math.hypot(point[0] - projected[0], point[1] - projected[2]);
      if (next < distance) {
        distance = next;
        origin = { ...site, entrance: [projected[0], projected[2]], collector: [...points.slice(0, i), projected] };
      }
    }
  }
  return origin;
}
export const CITY_GROUND_ROADS = [
  ...['arterial', 'transit'].flatMap(kind => {
    const points = cityRoadPoints(kind).map(([x, , z]) => [x, z]);
    return points.slice(1).map((point, i) => [points[i], point]);
  }),
  ...[...CITY_SITES, ...CITY_LANDMARKS].flatMap(site => {
    const points = cityCollectorPoints(site).map(([x, , z]) => [x, z]);
    return points.slice(1).map((point, i) => [points[i], point]);
  }),
];
// Bridge piers skip at-grade roads and rail. Longer spans carry the deck across
// these junctions so a collector never drives into a support column.
export const CITY_HIGHWAY_KINDS = ['highway', 'highway-return'];
function highwayConnector(x, fromKind, toKind, endHeight) {
  const upper = fromKind === 'highway';
  const position = .5 + x / (toKind === 'arterial' ? 232 : 260);
  const departure = .5 + (x - (upper ? 32 : 64)) / 260, a = cityRoadPoint(fromKind, departure), d = cityRoadPoint(toKind, position);
  const ahead = cityRoadPoint(fromKind, departure + .001), tangent = [ahead[0] - a[0], ahead[1] - a[1]], magnitude = Math.hypot(...tangent);
  const before = cityRoadPoint(toKind, position - .001), dx = d[0] - before[0], dz = d[1] - before[1], length = Math.hypot(dx, dz);
  const b = [a[0] + tangent[0] / magnitude * (upper ? 12 : 22), a[1] + tangent[1] / magnitude * (upper ? 12 : 22)], middle = [x, d[1] - 20];
  const legs = upper ? [[a, b, [x, a[1]], middle], [middle, [x, middle[1] + 10], [d[0] - dx / length * 8, d[1] - dz / length * 8], d]]
    : [[a, b, [d[0] - dx / length * 22, d[1] - dz / length * 22], d]];
  const plan = legs.flatMap(([start, first, second, end], leg) => Array.from({ length: leg ? 80 : 81 }, (_, j) => {
    const t = (j + (leg ? 1 : 0)) / 80, u = 1 - t;
    return [u ** 3 * start[0] + 3 * u * u * t * first[0] + 3 * u * t * t * second[0] + t ** 3 * end[0], u ** 3 * start[1] + 3 * u * u * t * first[1] + 3 * u * t * t * second[1] + t ** 3 * end[1]];
  }));
  const distances = [0];
  for (let j = 1; j < plan.length; j++) distances.push(distances[j - 1] + Math.hypot(plan[j][0] - plan[j - 1][0], plan[j][1] - plan[j - 1][1]));
  return plan.map(([x, z], j) => {
    const t = distances[j] / distances.at(-1), eased = t * t * (3 - 2 * t);
    return [x, 2.9 + (endHeight - 2.9) * eased, z];
  });
}
export const CITY_HIGHWAY_LINKS = [-36, 90].map(x => highwayConnector(x, 'highway', 'highway-return', 2.9));
export function cityEndRoadPoint(side, position) {
  return [side * (137 + 2 * Math.sin(position * Math.PI) + Math.sin(position * Math.PI * 2)), 2.9, -54 + 98 * position];
}
export const CITY_END_JUNCTIONS = [-1, 1].flatMap(side => CITY_HIGHWAY_KINDS.map(kind => {
  const position = side > 0 ? 1 : 0, end = cityRoadPoint(kind, position), junction = cityEndRoadPoint(side, (end[1] + 54) / 98);
  return { kind, side, points: [[end[0], 2.9, end[1]], junction] };
}));
export const CITY_SIDE_EXITS = [{ index: 0, side: -1 }, { index: 1, side: -1 }, { index: 14, side: 1 }, { index: 15, side: 1 }].map(exit => {
  const site = CITY_SITES[exit.index], d = site.entrance, nx = Math.sin(site.rotation), nz = Math.cos(site.rotation);
  const startPosition = (d[1] - 42 + 54) / 98, a = cityEndRoadPoint(exit.side, startPosition), b = [a[0], a[2] + 35], c = [d[0] - nx * 12, d[1] - nz * 12];
  const plan = Array.from({ length: 97 }, (_, i) => {
    const t = i / 96, u = 1 - t;
    return [u ** 3 * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t ** 3 * d[0],
      u ** 3 * a[2] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t ** 3 * d[1]];
  });
  const distances = [0];
  for (let i = 1; i < plan.length; i++) distances.push(distances[i - 1] + Math.hypot(plan[i][0] - plan[i - 1][0], plan[i][1] - plan[i - 1][1]));
  return { ...exit, points: plan.map(([x, z], i) => { const t = distances[i] / distances.at(-1); return [x, 2.9 - 2.825 * t * t * (3 - 2 * t), z]; }) };
});
export const CITY_END_ROADS = [-1, 1].map(side => {
  const joins = [...CITY_END_JUNCTIONS.filter(junction => junction.side === side).map(junction => junction.points.at(-1)), ...CITY_SIDE_EXITS.filter(exit => exit.side === side).map(exit => exit.points[0])];
  const first = Math.min(...joins.map(point => point[2])), last = Math.max(...joins.map(point => point[2])), segments = Math.ceil(last - first);
  return { side, points: Array.from({ length: segments + 1 }, (_, i) => cityEndRoadPoint(side, (first + (last - first) * i / segments + 54) / 98)) };
});
// Neighborhood streets meet the back of the boulevard. Northern links remain
// clear of the lake, airport and shopping center in the southern waterfront.
export const CITY_LOCAL_LINKS = Array.from({ length: 7 }, (_, i) => {
  const first = CITY_SITES[i * 2], second = CITY_SITES[(i + 1) * 2];
  const rear = site => [site.x + Math.sin(site.rotation) * 6.67, site.z + Math.cos(site.rotation) * 6.67];
  const a = rear(first), d = rear(second), b = [a[0] + Math.sin(first.rotation) * 6, a[1] + Math.cos(first.rotation) * 6], c = [d[0] + Math.sin(second.rotation) * 6, d[1] + Math.cos(second.rotation) * 6];
  return Array.from({ length: 65 }, (_, j) => {
    const t = j / 64, u = 1 - t;
    return [u ** 3 * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t ** 3 * d[0], .075,
      u ** 3 * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t ** 3 * d[1]];
  });
});
for (const road of CITY_LOCAL_LINKS) for (let i = 1; i < road.length; i++) {
  CITY_GROUND_ROADS.push([[road[i - 1][0], road[i - 1][2]], [road[i][0], road[i][2]]]);
}
export const CITY_HIGHWAY_PIERS = Object.fromEntries(CITY_HIGHWAY_KINDS.map(kind => [kind,
  cityRoadPoints(kind).filter(([x, , z], i) => i < 384 && i % 12 === 0
    && CITY_GROUND_ROADS.every(([a, b]) => citySegmentDistance([x, z], a, b) > 3))]));
export const CITY_RAMPS = [highwayConnector(-36, 'highway-return', 'arterial', .075), highwayConnector(90, 'highway-return', 'arterial', .075)];
export const CITY_TOP_EXITS = [{ index: 4, id: 'travel', label: 'Travel' }, { index: 12, id: 'business', label: 'Business' }].map(exit => {
  const site = CITY_SITES[exit.index], nx = Math.sin(site.rotation), nz = Math.cos(site.rotation);
  const rear = [site.x + nx * 6.67, site.z + nz * 6.67], departure = .5 + (rear[0] - 64) / 260;
  const a = cityRoadPoint('highway', departure), ahead = cityRoadPoint('highway', departure + .001), length = Math.hypot(ahead[0] - a[0], ahead[1] - a[1]);
  const b = [a[0] + (ahead[0] - a[0]) / length * 22, a[1] + (ahead[1] - a[1]) / length * 22], c = [rear[0] + nx * 12, rear[1] + nz * 12];
  const plan = Array.from({ length: 97 }, (_, i) => {
    const t = i / 96, u = 1 - t;
    return [u ** 3 * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t ** 3 * rear[0],
      u ** 3 * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t ** 3 * rear[1]];
  });
  const distances = [0];
  for (let i = 1; i < plan.length; i++) distances.push(distances[i - 1] + Math.hypot(plan[i][0] - plan[i - 1][0], plan[i][1] - plan[i - 1][1]));
  return { ...exit, rear, points: plan.map(([x, z], i) => { const t = distances[i] / distances.at(-1); return [x, 2.9 - 2.825 * t * t * (3 - 2 * t), z]; }) };
});
export function cityHighwayJourney(index = 0) {
  const link = CITY_HIGHWAY_LINKS[index % CITY_HIGHWAY_LINKS.length];
  const departure = .5 + link[0][0] / 260, arrival = .5 + link.at(-1)[0] / 260;
  const upper = Array.from({ length: 100 }, (_, i) => { const [x, z] = cityRoadPoint('highway', departure * i / 100); return [x, 2.9, z]; });
  const middle = Array.from({ length: 100 }, (_, i) => { const [x, z] = cityRoadPoint('highway-return', arrival + (1 - arrival) * (i + 1) / 100); return [x, 2.9, z]; });
  return [...upper, ...link, ...middle];
}
export const CITY_ARCHITECTURE = {
  community: { floors: 2, facade: '#d6b99b', roof: 'pitched' },
  technology: { floors: 5, facade: '#b3c3ca', roof: 'solar', typology: 'office' },
  science: { floors: 3, facade: '#d4ded6', roof: 'solar', typology: 'campus' },
  writing: { floors: 2, facade: '#ddd2c0', roof: 'pitched' },
  travel: { floors: 4, facade: '#eadbc5', roof: 'terrace' },
  restaurants: { floors: 2, facade: '#cfa78d', roof: 'pitched' },
  nightlife: { floors: 4, facade: '#a8adc1', roof: 'terrace' },
  cooking: { floors: 2, facade: '#d9c8a8', roof: 'solar' },
  music: { floors: 3, facade: '#c6bba9', roof: 'terrace' },
  video: { floors: 4, facade: '#d4b3a5', roof: 'solar' },
  sports: { floors: 2, facade: '#c0c9bb', roof: 'pitched' },
  gaming: { floors: 4, facade: '#aebdaf', roof: 'solar' },
  business: { floors: 6, facade: '#bfc8cd', roof: 'terrace', typology: 'office' },
  design: { floors: 3, facade: '#dfcdc3', roof: 'terrace' },
  careers: { floors: 4, facade: '#bcbcaf', roof: 'solar', typology: 'office' },
  people: { floors: 2, facade: '#dec4bd', roof: 'pitched' },
};
export function cityDriveWaypoints(from, destination) {
  const startAngle = from?.angle ?? .5, startJunction = from?.junction || cityRoadPoint('arterial', startAngle);
  const route = from ? cityCollectorPoints(from).map(([x, , z]) => [x, z]).reverse() : [startJunction];
  const difference = destination.angle - startAngle;
  const steps = Math.max(1, Math.ceil(Math.abs(difference) / .005));
  for (let i = 1; i <= steps; i++) route.push(cityRoadPoint('arterial', startAngle + difference * i / steps));
  route.push(...cityCollectorPoints(destination).map(([x, , z]) => [x, z]));
  return route.filter((point, index) => !index || point[0] !== route[index - 1][0] || point[1] !== route[index - 1][1]);
}
