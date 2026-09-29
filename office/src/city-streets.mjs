// Geometry is illustrative; it never changes agent ownership or telemetry.
export const CITY_BLOCK_WIDTH = 360;
export const CITY_BLOCK_HEIGHT = 340;
const path = points => points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
const roundTrip = points => path([...points, ...points.slice(0, -1).reverse()]);
const distance = points => points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point[0] - points[index][0], point[1] - points[index][1]), 0);
// Keep opposing traffic on opposite sides of each street. Endpoints remain at
// their driveways and arrival bays; adjacent lane offsets meet inside the road.
function drivingLane(points) {
  const clean = points.filter((point, index) => !index || point.some((value, axis) => value !== points[index - 1][axis]));
  const normals = clean.slice(1).map(([x, y], index) => {
    const dx = x - clean[index][0], dy = y - clean[index][1], length = Math.hypot(dx, dy);
    return [-dy / length * 6, dx / length * 6];
  });
  return [clean[0], ...clean.map(([x, y], index) => {
    const before = normals[Math.max(0, index - 1)], after = normals[Math.min(normals.length - 1, index)];
    return [x + (before[0] + after[0]) / 2, y + (before[1] + after[1]) / 2];
  }), clean.at(-1)];
}

const ramp = (phase, start, end) => Math.max(0, Math.min(1, (phase - start) / (end - start)));

export function cityJourney(phase) {
  // Residents park inside their workplace and enter the cafe during breaks,
  // rather than leaving every car and pedestrian stacked at one doorway.
  // At home they walk between the front door and the car parked on the
  // driveway; the door opens only while someone passes through it.
  const leaving = phase >= .05 && phase < .08, arriving = phase >= .88 && phase < .92;
  const doorOpen = phase < .5
    ? Math.min(ramp(phase, .05, .054), 1 - ramp(phase, .062, .068))
    : Math.min(ramp(phase, .895, .9), 1 - ramp(phase, .91, .918));
  return { carVisible: phase < .24 || phase >= .68, returning: phase >= .68,
    walkerVisible: (phase >= .36 && phase < .46) || (phase >= .55 && phase < .65),
    homeWalk: leaving && phase >= .052 && phase < .075 ? { leaving: true, progress: ramp(phase, .052, .075) }
      : arriving && phase < .905 ? { leaving: false, progress: ramp(phase, .88, .905) } : null,
    doorOpen: Math.max(0, doorOpen), home: phase < .052 || phase >= .905 };
}

// Downtown keeps the original 4 × 3 grid of blocks, one stage building per block.
// Homes live in separate towns around it, grouped by the building their agents
// work in, and every town joins downtown through the beltway.
export const TOWN_BLOCK_WIDTH = 280;
const DOWNTOWN = { width: 1600, height: 1340, left: 40, top: 40, right: 1560, bottom: 1300, blocksBottom: 1100 };
const TOWN_GAP = 300, TOWN_MARGIN = 40, BELTWAY = TOWN_GAP / 2, HOMES_PER_BLOCK = 6;
const TOWN_NAMES = ['Maple Grove', 'Cedar Falls', 'Riverside', 'Oak Ridge', 'Willow Creek', 'Pine Hollow', 'Aspen Park',
  'Birch Valley', 'Elm Heights', 'Harbor View', 'Lakeside', 'Spruce Hill', 'Fairview', 'Summit', 'Brookside', 'Hillcrest'];
const near = (a, b) => Math.abs(a - b) < .01;
const between = (value, a, b) => value >= Math.min(a, b) - .01 && value <= Math.max(a, b) + .01;

// Big workplaces get towns of their own; small ones share a town in pipeline order.
// Homes that name a group (such as a source category) live together in that group's town instead.
function groupTowns(homes, districts, capacity) {
  const towns = []; let shared = null;
  if (homes.some(resident => resident.home.group)) {
    const groups = new Map();
    homes.forEach(resident => {
      const key = resident.home.group || 'other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(resident);
    });
    for (const [group, residents] of groups) {
      const parts = Math.ceil(residents.length / capacity);
      for (let part = 0; part < parts; part++) {
        const members = residents.slice(part * capacity, (part + 1) * capacity);
        towns.push({ group, part: parts > 1 ? part + 1 : 0, workplaces: [...new Set(members.map(member => member.work.id))], homes: members });
      }
    }
    return towns;
  }
  for (const district of districts) {
    const residents = homes.filter(home => home.work.id === district.id);
    if (!residents.length) continue;
    if (residents.length * 2 >= capacity) {
      const count = Math.ceil(residents.length / capacity), size = Math.floor(residents.length / count), extra = residents.length % count;
      for (let i = 0, start = 0; i < count; i++) {
        const end = start + size + (i < extra ? 1 : 0);
        towns.push({ workplaces: [district.id], homes: residents.slice(start, end) }); start = end;
      }
    } else {
      if (!shared || shared.homes.length + residents.length > capacity) { shared = { workplaces: [], homes: [] }; towns.push(shared); }
      shared.workplaces.push(district.id); shared.homes.push(...residents);
    }
  }
  return towns;
}

// Town sites ring downtown: two across the top and bottom, the corners, and a column on each side.
function townSites(siteWidth, siteHeight) {
  const { width, height } = DOWNTOWN;
  const across = Math.max(1, Math.floor(width / siteWidth)), down = Math.max(1, Math.floor((height + 40) / (siteHeight + 40)));
  const top = -TOWN_GAP - siteHeight / 2, bottom = height + TOWN_GAP + siteHeight / 2;
  const left = -TOWN_GAP - siteWidth / 2, right = width + TOWN_GAP + siteWidth / 2;
  const row = y => Array.from({ length: across }, (_, i) => ({ x: Math.round(width * (i + .5) / across), y, side: y < 0 ? 'top' : 'bottom' }));
  const column = (x, side) => Array.from({ length: down }, (_, i) => ({ x, y: Math.round(height * (i + .5) / down), side }));
  return [...row(top), ...row(bottom), ...column(left, 'left'), ...column(right, 'right'),
    { x: left, y: top, side: 'top' }, { x: right, y: top, side: 'top' }, { x: left, y: bottom, side: 'bottom' }, { x: right, y: bottom, side: 'bottom' }];
}

// Axis-aligned road network with shortest routes between any two points on it.
function roadNetwork(segments) {
  const points = segments.map(segment => [segment.a, segment.b]);
  const horizontal = segment => near(segment.a[1], segment.b[1]);
  const on = (segment, [x, y]) => horizontal(segment)
    ? near(y, segment.a[1]) && between(x, segment.a[0], segment.b[0])
    : near(x, segment.a[0]) && between(y, segment.a[1], segment.b[1]);
  segments.forEach((a, i) => segments.forEach((b, j) => {
    if (j <= i) return;
    if (horizontal(a) !== horizontal(b)) {
      const [h, v, hi, vi] = horizontal(a) ? [a, b, i, j] : [b, a, j, i];
      const cross = [v.a[0], h.a[1]];
      if (on(h, cross) && on(v, cross)) { points[hi].push(cross); points[vi].push(cross); }
    } else {
      [b.a, b.b].forEach(point => { if (on(a, point)) points[i].push(point); });
      [a.a, a.b].forEach(point => { if (on(b, point)) points[j].push(point); });
    }
  }));
  const junctions = new Map();
  points.forEach(list => list.forEach(point => { const key = point.join(','); junctions.set(key, (junctions.get(key) || 0) + 1); }));
  let adjacency = null;
  const build = () => {
    adjacency = new Map();
    const link = (a, b) => {
      const ka = a.join(','), kb = b.join(','); if (ka === kb) return;
      const length = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (!adjacency.has(ka)) adjacency.set(ka, { point: a, edges: [] });
      if (!adjacency.has(kb)) adjacency.set(kb, { point: b, edges: [] });
      adjacency.get(ka).edges.push([kb, length]); adjacency.get(kb).edges.push([ka, length]);
    };
    segments.forEach((segment, i) => {
      const axis = horizontal(segment) ? 0 : 1;
      const sorted = [...new Map(points[i].map(point => [point.join(','), point])).values()].sort((a, b) => a[axis] - b[axis]);
      sorted.slice(1).forEach((point, k) => link(sorted[k], point));
    });
  };
  const trees = new Map();
  // Dijkstra from one point; the tree answers every route that ends there.
  function tree(origin) {
    const key = origin.join(',');
    if (trees.has(key)) return trees.get(key);
    const distances = new Map([[key, 0]]), previous = new Map(), heap = [[0, key]];
    while (heap.length) {
      let best = 0; heap.forEach((item, i) => { if (item[0] < heap[best][0]) best = i; });
      const [cost, current] = heap.splice(best, 1)[0];
      if (cost > (distances.get(current) ?? Infinity)) continue;
      for (const [next, length] of adjacency.get(current)?.edges || []) {
        const total = cost + length;
        if (total < (distances.get(next) ?? Infinity) - 1e-9) { distances.set(next, total); previous.set(next, current); heap.push([total, next]); }
      }
    }
    const result = { distances, previous }; trees.set(key, result); return result;
  }
  return {
    // Waypoints (driveway junctions, building entrances) become nodes of every road they lie on.
    add(point) { segments.forEach((segment, i) => { if (on(segment, point)) points[i].push(point); }); adjacency = null; trees.clear(); },
    junctions: () => [...junctions.entries()].filter(([, count]) => count > 1).map(([key]) => key.split(',').map(Number)),
    // Route from `from` to `to`, as corner points only.
    route(from, to) {
      if (!adjacency) build();
      const { previous, distances } = tree(to.map(Number));
      const start = from.join(',');
      if (!distances.has(start)) return [from, to];
      const route = [from];
      for (let key = start; key !== to.join(',');) { key = previous.get(key); route.push(adjacency.get(key).point); }
      return route.filter((point, i) => i === 0 || i === route.length - 1
        || !((near(route[i - 1][0], point[0]) && near(point[0], route[i + 1][0])) || (near(route[i - 1][1], point[1]) && near(point[1], route[i + 1][1]))));
    },
    distance(from, to) { if (!adjacency) build(); return tree(to).distances.get(from.join(',')) ?? Infinity; },
  };
}

export function buildCityStreets(model) {
  const blocks = Array.from({ length: 12 }, (_, index) => {
    const col = index % 4, row = Math.floor(index / 4);
    return { id: `block-${index}`, index, kind: 'downtown', col, row, x: 260 + col * 360, y: 250 + row * 340, bottom: 420 + row * 340,
      lawn: [302, 282], homes: [],
      trees: [-1, 1].flatMap(side => [-120, -58, 4, 66].map(dy => [260 + col * 360 + side * 134, 250 + row * 340 + dy])) };
  });
  const districts = model.districts.map(district => {
    const col = Math.round((district.x - 190) / 240), row = Math.round((district.y - 220) / 270);
    const block = blocks[row * 4 + col];
    const bays = Array.from({ length: 8 }, (_, index) => [block.x - 63 + index * 18, block.y + 119]);
    const throughAccess = district.id === 'sources';
    const entry = throughAccess ? [block.x - 180, block.y + 138] : [block.x - 82, block.bottom];
    const exit = throughAccess ? [block.x + 180, block.y + 138] : [block.x + 82, block.bottom];
    const arrivalRoad = [entry, [block.x - 82, block.y + 138], [block.x + 82, block.y + 138], exit];
    const accessRoutes = throughAccess ? [
      { id: 'in', label: 'SOURCE IN', color: '#38bdf8', points: [entry, [block.x - 82, block.y + 138]] },
      { id: 'out', label: 'SOURCE OUT', color: '#4ade80', points: [[block.x + 82, block.y + 138], exit] },
    ].map(route => ({ ...route, path: path(route.points) })) : [];
    return { ...district, x: block.x, y: block.y, block: block.index, streetY: block.bottom, bays, entry, exit, accessRoutes, arrivalRoad, arrivalPath: path(arrivalRoad), residents: 0 };
  });
  const byId = Object.fromEntries(districts.map(district => [district.id, district]));
  const cafes = Array.from({ length: 4 }, (_, col) => ({ x: 260 + col * 360, y: DOWNTOWN.blocksBottom + 92, streetY: DOWNTOWN.blocksBottom + 160, label: ['Corner Cafe', 'Garden Kitchen', 'Market Square', 'Riverside Deli'][col] }));
  const residents = model.homes.map((home, index) => ({ home, index, work: byId[home.district] || byId.runtime || districts[0] }));

  // Towns hold up to twelve homes (two blocks); larger rosters grow the towns rather than the ring.
  let capacity = 12, groups, sites, shape;
  for (;;) {
    groups = groupTowns(residents, districts, capacity);
    const blocksPerTown = Math.ceil(capacity / HOMES_PER_BLOCK), cols = Math.min(2, blocksPerTown), rows = Math.ceil(blocksPerTown / cols);
    shape = { cols, rows };
    sites = townSites(cols * TOWN_BLOCK_WIDTH + TOWN_MARGIN * 2, rows * CITY_BLOCK_HEIGHT + TOWN_MARGIN * 2);
    if (groups.length <= sites.length) break;
    capacity += HOMES_PER_BLOCK;
  }
  // The busiest towns claim the sites nearest their workplaces.
  const taken = new Set();
  const anchor = group => {
    const places = group.workplaces.map(id => byId[id]);
    return [places.reduce((sum, place) => sum + place.x, 0) / places.length, places.reduce((sum, place) => sum + place.y, 0) / places.length];
  };
  [...groups].sort((a, b) => b.homes.length - a.homes.length || districts.findIndex(d => d.id === a.workplaces[0]) - districts.findIndex(d => d.id === b.workplaces[0])).forEach(group => {
    const [ax, ay] = anchor(group);
    const site = sites.map((item, index) => ({ item, index })).filter(({ index }) => !taken.has(index))
      .sort((a, b) => Math.hypot(a.item.x - ax, a.item.y - ay) - Math.hypot(b.item.x - ax, b.item.y - ay) || a.index - b.index)[0];
    taken.add(site.index); group.site = site.item;
  });

  // Roads: downtown's avenues, streets, boulevard and ring; each town's own grid; spurs, beltway and connectors.
  const segments = [];
  const road = (a, b, kind, town) => segments.push({ a, b, kind, town });
  for (let col = 0; col < 5; col++) road([80 + col * 360, DOWNTOWN.top], [80 + col * 360, DOWNTOWN.bottom], col === 2 ? 'expressway' : 'avenue');
  for (let row = 0; row < 4; row++) road([DOWNTOWN.left, 80 + row * 340], [DOWNTOWN.right, 80 + row * 340], 'street');
  road([DOWNTOWN.left, DOWNTOWN.blocksBottom + 160], [DOWNTOWN.right, DOWNTOWN.blocksBottom + 160], 'street');
  const ring = [[DOWNTOWN.left, DOWNTOWN.top], [DOWNTOWN.right, DOWNTOWN.top], [DOWNTOWN.right, DOWNTOWN.bottom], [DOWNTOWN.left, DOWNTOWN.bottom]];
  ring.forEach((point, i) => road(point, ring[(i + 1) % 4], 'ring'));

  const towns = groups.map((group, index) => {
    const { cols, rows } = shape, used = Math.ceil(group.homes.length / HOMES_PER_BLOCK);
    const townCols = Math.min(cols, used), townRows = Math.ceil(used / townCols);
    const width = townCols * TOWN_BLOCK_WIDTH, height = townRows * CITY_BLOCK_HEIGHT;
    const left = group.site.x - width / 2, top = group.site.y - height / 2;
    const id = `town-${index}`;
    const labels = group.workplaces.map(workplace => byId[workplace].label);
    const theme = group.group ? group.homes[0].home : null;
    const town = { id, index, workplaces: group.workplaces, color: theme?.townColor,
      name: theme ? `${theme.townName || group.group}${group.part ? ` ${group.part}` : ''}` : TOWN_NAMES[index % TOWN_NAMES.length],
      label: theme ? theme.townLabel || group.group : `Works at ${labels.length > 2 ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}` : labels.join(' and ')}`,
      side: group.site.side, x: group.site.x, y: group.site.y, left, top, right: left + width, bottom: top + height, cols: townCols, rows: townRows, homes: [], blocks: [] };
    for (let col = 0; col <= townCols; col++) road([left + col * TOWN_BLOCK_WIDTH, top], [left + col * TOWN_BLOCK_WIDTH, top + height], 'town-avenue', id);
    for (let row = 0; row <= townRows; row++) road([left, top + row * CITY_BLOCK_HEIGHT], [left + width, top + row * CITY_BLOCK_HEIGHT], 'town-street', id);
    for (let cell = 0; cell < used; cell++) {
      const col = cell % townCols, row = Math.floor(cell / townCols);
      const x = left + TOWN_BLOCK_WIDTH / 2 + col * TOWN_BLOCK_WIDTH, y = top + CITY_BLOCK_HEIGHT / 2 + row * CITY_BLOCK_HEIGHT;
      const block = { id: `${id}-block-${cell}`, index: blocks.length, kind: 'town', town: id, col, row, x, y, bottom: y + 170, lawn: [222, 282], homes: [],
        trees: [[x, y - 66], [x, y + 34], [x, y + 128]] };
      blocks.push(block); town.blocks.push(block.index);
    }
    // The gate faces downtown; a spur runs from it to the beltway.
    const gate = town.side === 'top' ? [town.x, town.bottom] : town.side === 'bottom' ? [town.x, town.top]
      : town.side === 'left' ? [town.right, town.y] : [town.left, town.y];
    const beltwayPoint = town.side === 'top' ? [gate[0], -BELTWAY] : town.side === 'bottom' ? [gate[0], DOWNTOWN.height + BELTWAY]
      : town.side === 'left' ? [-BELTWAY, gate[1]] : [DOWNTOWN.width + BELTWAY, gate[1]];
    road(gate, beltwayPoint, 'spur', id);
    return { ...town, gate, spur: [gate, beltwayPoint] };
  });
  const spurX = towns.filter(town => ['top', 'bottom'].includes(town.side)).map(town => town.gate[0]);
  const beltLeft = Math.min(-BELTWAY, ...spurX), beltRight = Math.max(DOWNTOWN.width + BELTWAY, ...spurX);
  const beltTop = -BELTWAY, beltBottom = DOWNTOWN.height + BELTWAY;
  road([beltLeft, beltTop], [beltRight, beltTop], 'beltway'); road([beltLeft, beltBottom], [beltRight, beltBottom], 'beltway');
  road([-BELTWAY, beltTop], [-BELTWAY, beltBottom], 'beltway'); road([DOWNTOWN.width + BELTWAY, beltTop], [DOWNTOWN.width + BELTWAY, beltBottom], 'beltway');
  const connectors = [[[800, beltTop], [800, DOWNTOWN.top]], [[800, DOWNTOWN.bottom], [800, beltBottom]],
    ...[420, 760].flatMap(y => [[[-BELTWAY, y], [DOWNTOWN.left, y]], [[DOWNTOWN.right, y], [DOWNTOWN.width + BELTWAY, y]]])];
  connectors.forEach(([a, b]) => road(a, b, 'connector'));

  const network = roadNetwork(segments);
  districts.forEach(district => { network.add(district.entry); network.add(district.exit); });

  const homes = residents.map(({ home, index, work }) => {
    const town = towns.find(item => groups[item.index].homes.some(entry => entry.home === home));
    const block = blocks[town.blocks[Math.floor(town.homes.length / HOMES_PER_BLOCK)]];
    const slot = block.homes.length, side = slot % 2 ? 1 : -1;
    const x = block.x + side * 80, y = block.y - 98 + Math.floor(slot / 2) * 100;
    const streetX = block.x + side * TOWN_BLOCK_WIDTH / 2;
    const front = [x, y + 20], junction = [streetX, y + 20];
    network.add(junction);
    const arrivalBay = work.bays[work.residents++ % work.bays.length];
    const placed = { ...home, index, block: block.index, town: town.id, x, y, work, front, junction, arrivalBay };
    block.homes.push(placed); town.homes.push(home.id);
    return placed;
  });
  // Commutes follow the shortest roads: out of town, along the beltway and into downtown.
  homes.forEach(home => {
    const { work, front, junction, arrivalBay, index, x, y } = home;
    const inbound = [front, ...network.route(junction, work.entry), [work.x - 82, work.y + 138], [arrivalBay[0], work.y + 138], arrivalBay];
    const outbound = [arrivalBay, [arrivalBay[0], work.y + 138], [work.x + 82, work.y + 138], ...network.route(work.exit, junction), front];
    const commute = drivingLane(inbound), returning = drivingLane(outbound);
    const commuteStop = distance(commute) / (distance(commute) + distance(returning)) * 100;
    const workFront = [work.x - 42 + index % 8 * 12, work.y + 52];
    const cafe = cafes[Math.floor((work.x - 260) / 360)];
    const lunch = [workFront, [work.x - 94, work.y + 52], [work.x - 94, work.streetY - 20], [work.x - 160, work.streetY - 20], [work.x - 160, cafe.streetY - 20], [cafe.x, cafe.streetY - 20], [cafe.x, cafe.y + 24]];
    // The house sits behind its lot's driveway; its door faces the street-side lawn.
    const house = { x, y: y - 18, width: 56, depth: 46 };
    Object.assign(home, { cafe, house, door: [x, house.y + house.depth / 2], driveway: path([front, junction]),
      commutePoints: commute, returnPoints: returning, commuteStop, lunchPoints: lunch,
      commutePath: path([...commute, ...returning.slice(1)]), lunchPath: roundTrip(lunch) });
  });
  // Power reaches each town from downtown along its roads.
  const ringTaps = connectors.map(ends => ends.find(([x, y]) => between(x, 0, DOWNTOWN.width) && between(y, 0, DOWNTOWN.height)));
  towns.forEach(town => {
    const tap = [...ringTaps].sort((a, b) => network.distance(town.gate, a) - network.distance(town.gate, b))[0];
    town.powerRoute = network.route(tap, town.gate);
  });

  const minX = Math.min(beltLeft, ...towns.map(town => town.left)) - 140, maxX = Math.max(beltRight, ...towns.map(town => town.right)) + 140;
  const minY = Math.min(beltTop, ...towns.map(town => town.top)) - 180, maxY = Math.max(beltBottom, ...towns.map(town => town.bottom)) + 140;
  const width = maxX - minX, height = maxY - minY;
  const line = ({ a, b }) => `M${a[0]} ${a[1]}${near(a[1], b[1]) ? `H${b[0]}` : `V${b[1]}`}`;
  const roads = segments.filter(segment => ['avenue', 'street', 'town-avenue', 'town-street', 'spur', 'connector'].includes(segment.kind)).map(line);
  const highway = `M80 40H1520Q1560 40 1560 80V1260Q1560 1300 1520 1300H80Q40 1300 40 1260V80Q40 40 80 40Z`;
  const beltway = segments.filter(segment => segment.kind === 'beltway').map(line);
  const bounds = items => {
    if (!items.length) return `${minX} ${minY} ${width} ${height}`;
    const left = Math.max(minX, Math.min(...items.map(item => item.x)) - 100), top = Math.max(minY, Math.min(...items.map(item => item.y)) - 180);
    return `${left} ${top} ${Math.min(maxX, Math.max(...items.map(item => item.x)) + 100) - left} ${Math.min(maxY, Math.max(...items.map(item => item.y)) + 130) - top}`;
  };
  const serviceRoute = (from, to) => {
    const a = byId[from], b = byId[to];
    return [[a.x, a.y + 38], [a.x, a.streetY], [a.x + 180, a.streetY], [a.x + 180, b.streetY], [b.x, b.streetY], [b.x, b.y + 38]];
  };
  return { minX, minY, width, height, bottom: DOWNTOWN.blocksBottom, downtown: { ...DOWNTOWN, avenueX: [80, 440, 800, 1160, 1520], streetY: [80, 420, 760, 1100, 1260] },
    blocks, districts, byId, homes, towns, cafes, segments, junctions: network.junctions(), roads, highway, beltway,
    beltwayLoop: [[beltLeft, beltTop], [beltRight, beltTop], [beltRight, beltBottom], [beltLeft, beltBottom]],
    viewBox: `${minX} ${minY} ${width} ${height}`, homesView: bounds(homes), buildingsView: bounds(districts),
    serviceRoute, servicePath: (from, to) => path(serviceRoute(from, to)),
  };
}

// The utility grid follows the streets: a backbone links stage buildings in
// pipeline order, a trunk line runs from downtown to each town, each town
// avenue carries a feeder along the side its homes face, and every home has a
// service drop from the feeder pole at its driveway.
// Like the traffic, it is a map of relationships, not a packet capture.
export const GRID_POLE_OFFSET = 20;
export function buildCityGrid(city, edges = []) {
  const links = edges.filter(edge => city.byId[edge.from] && city.byId[edge.to]).map((edge, index) => ({
    from: edge.from, to: edge.to, active: Boolean(edge.active), lane: index % 3,
    points: offsetRoute(city.serviceRoute(edge.from, edge.to), GRID_POLE_OFFSET),
  }));
  const feeders = new Map(), drops = [];
  for (const home of city.homes) {
    // side -1: the home is west of its avenue, so its feeder runs on the avenue's west sidewalk.
    const side = home.x < home.junction[0] ? -1 : 1;
    const poleX = home.junction[0] + side * GRID_POLE_OFFSET, block = city.blocks[home.block];
    const key = `${home.town}:${poleX}`;
    if (!feeders.has(key)) feeders.set(key, { id: key, town: home.town, x: poleX, avenue: home.junction[0], side, homes: [], above: [], below: [] });
    const feeder = feeders.get(key);
    // Each feeder ties into the cross streets above and below its homes' blocks.
    feeder.homes.push(home.id); feeder.above.push(block.y - 170); feeder.below.push(block.y + 170);
    drops.push({ homeId: home.id, feeder: key, pole: [poleX, home.junction[1]], house: [home.x - side * home.house.width / 2, home.house.y] });
  }
  const feederLines = [...feeders.values()].map(feeder => ({ id: feeder.id, town: feeder.town, x: feeder.x, avenue: feeder.avenue, side: feeder.side, homes: feeder.homes,
    points: [[feeder.x, Math.min(...feeder.above)], [feeder.x, Math.max(...feeder.below)]] }));
  // Trunk lines carry power from downtown to each town beside the roads that lead there.
  const trunks = (city.towns || []).map(town => ({ town: town.id, points: offsetRoute(town.powerRoute, GRID_POLE_OFFSET) }));
  return { links, feeders: feederLines, drops, trunks };
}

// Shift a street route to one side so overhead lines run beside the road, not over its center line.
function offsetRoute(points, offset) {
  const clean = points.filter((point, index) => !index || point.some((value, axis) => value !== points[index - 1][axis]));
  if (clean.length < 2) return clean;
  const normals = clean.slice(1).map(([x, y], index) => {
    const dx = x - clean[index][0], dy = y - clean[index][1], length = Math.hypot(dx, dy);
    return [-dy / length * offset, dx / length * offset];
  });
  return clean.map(([x, y], index) => {
    const before = normals[Math.max(0, index - 1)], after = normals[Math.min(normals.length - 1, index)];
    // Corners keep both offsets so the line turns around the outside of the curb.
    const nx = index === 0 ? after[0] : index === clean.length - 1 ? before[0] : before[0] + after[0];
    const ny = index === 0 ? after[1] : index === clean.length - 1 ? before[1] : before[1] + after[1];
    return [x + nx, y + ny];
  });
}
