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

export function cityJourney(phase) {
  // Residents park inside their workplace and enter the cafe during breaks,
  // rather than leaving every car and pedestrian stacked at one doorway.
  return { carVisible: phase < .24 || phase >= .68, returning: phase >= .68,
    walkerVisible: (phase >= .36 && phase < .46) || (phase >= .55 && phase < .65) };
}

export function buildCityStreets(model) {
  const rows = Math.max(3, Math.ceil(model.homes.length / 24));
  const width = 1600, bottom = 80 + rows * CITY_BLOCK_HEIGHT, height = bottom + 240;
  const blocks = Array.from({ length: rows * 4 }, (_, index) => {
    const col = index % 4, row = Math.floor(index / 4);
    return { id: `block-${index}`, index, col, row, x: 260 + col * 360, y: 250 + row * 340, bottom: 420 + row * 340, homes: [] };
  });
  const districts = model.districts.map(district => {
    const col = Math.round((district.x - 190) / 240), row = Math.round((district.y - 220) / 270);
    const block = blocks[row * 4 + col];
    const bays = Array.from({ length: 8 }, (_, index) => [block.x - 63 + index * 18, block.y + 119]);
    const arrivalRoad = [[block.x - 82, block.bottom], [block.x - 82, block.y + 138], [block.x + 82, block.y + 138], [block.x + 82, block.bottom]];
    return { ...district, x: block.x, y: block.y, block: block.index, streetY: block.bottom, bays, arrivalRoad, arrivalPath: path(arrivalRoad), residents: 0 };
  });
  const byId = Object.fromEntries(districts.map(district => [district.id, district]));
  const cafes = Array.from({ length: 4 }, (_, col) => ({ x: 260 + col * 360, y: bottom + 92, streetY: bottom + 160, label: ['Corner Cafe', 'Garden Kitchen', 'Market Square', 'Riverside Deli'][col] }));
  const homes = model.homes.map((home, index) => {
    const work = byId[home.district] || byId.runtime || districts[0];
    // Prefer a nearby block, spilling into adjacent mixed-use blocks rather
    // than stacking every source worker into a separate residential district.
    const block = blocks.filter(item => item.homes.length < 6).sort((a, b) =>
      (Math.abs(a.x - work.x) + Math.abs(a.y - work.y)) - (Math.abs(b.x - work.x) + Math.abs(b.y - work.y)) || a.index - b.index)[0];
    const slot = block.homes.length, side = slot % 2 ? 1 : -1;
    const x = block.x + side * 126, y = block.y - 98 + Math.floor(slot / 2) * 100;
    const streetX = block.x + side * 180;
    const front = [x, y + 20], junction = [streetX, y + 20];
    const arrivalBay = work.bays[work.residents++ % work.bays.length];
    const inbound = [front, junction, [streetX, work.streetY], [work.x - 82, work.streetY], [work.x - 82, work.y + 138], [arrivalBay[0], work.y + 138], arrivalBay];
    const outbound = [arrivalBay, [arrivalBay[0], work.y + 138], [work.x + 82, work.y + 138], [work.x + 82, work.streetY], [streetX, work.streetY], junction, front];
    const commute = drivingLane(inbound), returning = drivingLane(outbound);
    const commuteStop = distance(commute) / (distance(commute) + distance(returning)) * 100;
    const workFront = [work.x - 42 + index % 8 * 12, work.y + 52];
    const cafe = cafes[Math.floor((work.x - 260) / 360)];
    const lunch = [workFront, [work.x - 94, work.y + 52], [work.x - 94, work.streetY - 20], [work.x - 160, work.streetY - 20], [work.x - 160, cafe.streetY - 20], [cafe.x, cafe.streetY - 20], [cafe.x, cafe.y + 24]];
    const placed = { ...home, index, block: block.index, x, y, work, cafe,
      arrivalBay, driveway: path([front, junction]), commutePoints: commute, returnPoints: returning, commuteStop, lunchPoints: lunch,
      commutePath: path([...commute, ...returning.slice(1)]), lunchPath: roundTrip(lunch) };
    block.homes.push(placed);
    return placed;
  });
  const roads = [
    ...Array.from({ length: 5 }, (_, col) => `M${80 + col * 360} 40V${height - 40}`),
    ...Array.from({ length: rows + 1 }, (_, row) => `M40 ${80 + row * 340}H1560`),
    `M40 ${bottom + 160}H1560`,
  ];
  const highway = `M80 40H1520Q1560 40 1560 80V${height - 80}Q1560 ${height - 40} 1520 ${height - 40}H80Q40 ${height - 40} 40 ${height - 80}V80Q40 40 80 40Z`;
  const bounds = items => {
    if (!items.length) return `0 0 ${width} ${height}`;
    const left = Math.max(0, Math.min(...items.map(item => item.x)) - 100), top = Math.max(0, Math.min(...items.map(item => item.y)) - 180);
    return `${left} ${top} ${Math.min(width, Math.max(...items.map(item => item.x)) + 100) - left} ${Math.min(height, Math.max(...items.map(item => item.y)) + 130) - top}`;
  };
  return { width, height, bottom, blocks, districts, byId, homes, cafes, roads, highway,
    homesView: bounds(homes), buildingsView: bounds(districts),
    servicePath(from, to) {
      const a = byId[from], b = byId[to];
      return path([[a.x, a.y + 38], [a.x, a.streetY], [a.x + 180, a.streetY], [a.x + 180, b.streetY], [b.x, b.streetY], [b.x, b.y + 38]]);
    },
  };
}
