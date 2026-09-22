// Geometry is illustrative; it never changes agent ownership or telemetry.
export const CITY_BLOCK_WIDTH = 360;
export const CITY_BLOCK_HEIGHT = 340;
const path = points => points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
const roundTrip = points => path([...points, ...points.slice(0, -1).reverse()]);

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
    return { ...district, x: block.x, y: block.y, block: block.index, streetY: block.bottom };
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
    const workFront = [work.x, work.y + 38];
    const commute = [front, junction, [streetX, work.streetY], [work.x, work.streetY], workFront];
    const cafe = cafes[Math.floor((work.x - 260) / 360)];
    const lunch = [workFront, [work.x, work.streetY], [work.x - 180, work.streetY], [work.x - 180, cafe.streetY], [cafe.x, cafe.streetY], [cafe.x, cafe.y + 24]];
    const placed = { ...home, index, block: block.index, x, y, work, cafe,
      driveway: path([front, junction]), commutePoints: commute, lunchPoints: lunch, commutePath: roundTrip(commute), lunchPath: roundTrip(lunch) };
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
