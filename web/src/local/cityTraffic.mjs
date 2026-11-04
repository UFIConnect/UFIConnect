// Deterministic decorative traffic. Distances and speed use city model units.
export const TRAFFIC_GREEN_SECONDS = 14;
export const TRAFFIC_CYCLE_SECONDS = 32;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
const dot = (a, b) => a[0] * b[0] + a[2] * b[2];

export function createTrafficPath(points, { loop = false } = {}) {
  const vertices = points.map(point => point.length === 2 ? [point[0], .08, point[1]] : [...point]);
  const clean = vertices.filter((point, index) => point.every(Number.isFinite) && (!index || distance(point, vertices[index - 1]) > .000001));
  if (clean.length < 2) throw new Error('Traffic paths need two distinct positions.');
  const cumulative = [0];
  for (let i = 1; i < clean.length; i++) cumulative.push(cumulative[i - 1] + distance(clean[i - 1], clean[i]));
  return { points: clean, cumulative, length: cumulative.at(-1), loop };
}

export function trafficPoint(path, travelled = 0) {
  const location = clamp(travelled, 0, path.length);
  let low = 1, high = path.cumulative.length - 1;
  while (low < high) { const mid = (low + high) >> 1; if (path.cumulative[mid] < location) low = mid + 1; else high = mid; }
  const a = path.points[low - 1], b = path.points[low], segment = path.cumulative[low] - path.cumulative[low - 1];
  const t = (location - path.cumulative[low - 1]) / segment;
  const position = a.map((value, axis) => value + (b[axis] - value) * t);
  const flat = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
  return { position, heading: [(b[0] - a[0]) / flat, 0, (b[2] - a[2]) / flat] };
}

export function createDriveTrafficPath(points, arterialPoints) {
  const vertices = points.map(point => point.length === 2 ? [point[0], .08, point[1]] : point);
  const arterial = arterialPoints.map(point => point.length === 2 ? [point[0], .08, point[1]] : point);
  return createTrafficPath(vertices.map((point, index) => {
    let separation = Infinity;
    for (let i = 1; i < arterial.length; i++) {
      const a = arterial[i - 1], b = arterial[i], dx = b[0] - a[0], dz = b[2] - a[2], squared = dx * dx + dz * dz;
      const t = squared ? clamp(((point[0] - a[0]) * dx + (point[2] - a[2]) * dz) / squared, 0, 1) : 0;
      separation = Math.min(separation, Math.hypot(point[0] - a[0] - t * dx, point[2] - a[2] - t * dz));
    }
    const before = vertices[Math.max(0, index - 1)], after = vertices[Math.min(vertices.length - 1, index + 1)];
    const dx = after[0] - before[0], dz = after[2] - before[2], magnitude = Math.hypot(dx, dz) || 1;
    // Stay in the same arterial lane as ambient traffic, easing into narrower
    // collector lanes rather than jumping sideways at the junction.
    const lane = .35 + .55 * (1 - clamp((separation - .5) / 2.5, 0, 1));
    return [point[0] - dz / magnitude * lane, point[1], point[2] + dx / magnitude * lane];
  }));
}

export function continueTrafficPath(path, origin) {
  if (!origin?.position || !origin?.heading) return path;
  const start = origin.position, end = path.points[0];
  const heading = trafficPoint(path, 0).heading;
  const reach = Math.min(1, Math.max(.35, distance(start, end) * .55));
  const a = start.map((value, axis) => value + origin.heading[axis] * reach);
  const b = end.map((value, axis) => value - heading[axis] * reach);
  const join = Array.from({ length: 13 }, (_, index) => {
    const t = index / 12, u = 1 - t;
    return start.map((value, axis) => u ** 3 * value + 3 * u * u * t * a[axis] + 3 * u * t * t * b[axis] + t ** 3 * end[axis]);
  });
  return createTrafficPath([...join, ...path.points.slice(1)], { loop: path.loop });
}

export function trafficLightPhase(signal, time, approach = 'arterial') {
  const phase = ((time + (signal.offset || 0)) % TRAFFIC_CYCLE_SECONDS + TRAFFIC_CYCLE_SECONDS) % TRAFFIC_CYCLE_SECONDS;
  if (approach === 'arterial') return phase < 14 ? 'green' : phase < 16 ? 'yellow' : 'red';
  return phase >= 17 && phase < 29 ? 'green' : phase >= 29 && phase < 31 ? 'yellow' : 'red';
}

// Compile crossings once rather than projecting every intersection every frame.
// Multiple encounters on an out-and-back route are kept separate.
export function trafficPathSignals(path, signals) {
  const encounters = [];
  for (const signal of signals) {
    let closest = null;
    const finish = () => {
      if (closest && closest.distance > 3 && (path.loop || closest.distance < path.length - 1)) {
        const sample = trafficPoint(path, Math.max(0, closest.distance - 2));
        encounters.push({ signal, distance: closest.distance,
          approach: Math.abs(dot(sample.heading, signal.axis)) > .7 ? 'arterial' : 'collector' });
      }
      closest = null;
    };
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i], dx = b[0] - a[0], dz = b[2] - a[2], span = dx * dx + dz * dz;
      const portion = span ? clamp(((signal.position[0] - a[0]) * dx + (signal.position[2] - a[2]) * dz) / span, 0, 1) : 0;
      const projected = [a[0] + portion * dx, a[1] + portion * (b[1] - a[1]), a[2] + portion * dz];
      const separation = distance(projected, signal.position);
      if (separation <= 2.4) {
        if (!closest || separation < closest.separation) closest = { separation, distance: path.cumulative[i - 1] + portion * (path.cumulative[i] - path.cumulative[i - 1]) };
      } else finish();
    }
    finish();
  }
  return encounters.sort((a, b) => a.distance - b.distance);
}

export function trafficTurnSpeed(path, travelled, cruise = 5.5) {
  const current = trafficPoint(path, travelled).heading;
  let severity = 0;
  for (const ahead of [2, 4, 7, 10]) {
    const heading = trafficPoint(path, travelled + ahead).heading;
    severity = Math.max(severity, Math.acos(clamp(dot(current, heading), -1, 1)) * (ahead <= 4 ? 1 : .7));
  }
  return clamp(cruise / (1 + severity * 1.7), Math.min(cruise, 1.7), cruise);
}

export function trafficVehiclePoint(vehicle) {
  const sample = trafficPoint(vehicle.path, vehicle.distance);
  const offset = Number(vehicle.lateralOffset) || 0;
  sample.position[0] -= sample.heading[2] * offset;
  sample.position[2] += sample.heading[0] * offset;
  return sample;
}

export function trafficSnapshot(vehicle) {
  const sample = trafficVehiclePoint(vehicle);
  const speed = Number(vehicle.speed) || 0;
  // Traffic predicts motion, while the renderer uses the unchanged body heading.
  if (speed < 0) sample.heading = sample.heading.map(value => -value);
  return { id: vehicle.id, priority: vehicle.priority || 0, speed: Math.abs(speed),
    ...sample, active: vehicle.active !== false };
}

function crossingAhead(ego, other) {
  const determinant = ego.heading[0] * other.heading[2] - ego.heading[2] * other.heading[0];
  if (Math.abs(determinant) < .3) return null;
  const dx = other.position[0] - ego.position[0], dz = other.position[2] - ego.position[2];
  const ours = (dx * other.heading[2] - dz * other.heading[0]) / determinant;
  const theirs = (dx * ego.heading[2] - dz * ego.heading[0]) / determinant;
  if (ours < 0 || ours > 12 || theirs < -1.5 || theirs > 10) return null;
  if (other.speed < .15 && Math.abs(theirs) > 1.5) return null;
  const ourTime = ours / Math.max(ego.speed, 1.7), theirTime = Math.max(0, theirs) / Math.max(other.speed, 1.7);
  const clearing = Math.abs(theirs) < 1.8;
  const otherFirst = other.priority < ego.priority || (other.priority === ego.priority && String(other.id) < String(ego.id));
  if (ours < 2.8 && clearing) return otherFirst ? 0 : null;
  return clearing || (Math.abs(ourTime - theirTime) < 2 && otherFirst) ? Math.max(0, ours - 2.8) : null;
}

export function advanceTrafficVehicle(vehicle, { delta, time = 0, others = [], paused = false } = {}) {
  if (paused) {
    const approached = (vehicle.signals || []).find(crossing => crossing.distance - 3.5 - vehicle.distance >= -.03
      && crossing.distance - 3.5 - vehicle.distance <= 18);
    return { ...vehicle, speed: 0, status: 'paused',
      signal: approached ? trafficLightPhase(approached.signal, time, approached.approach) : null, gap: null };
  }
  const dt = clamp(Number(delta) || 0, 0, .05), cruise = Math.max(0, vehicle.cruise ?? 5.5), brake = 5.5;
  const ego = trafficSnapshot(vehicle), remaining = vehicle.path.length - vehicle.distance;
  let target = trafficTurnSpeed(vehicle.path, vehicle.distance, cruise), obstruction = Infinity;
  let status = target < cruise - .3 ? 'turning' : 'driving', signal = null, gap = null;
  for (const crossing of vehicle.signals || []) {
    const stop = crossing.distance - 3.5, ahead = stop - vehicle.distance;
    if (ahead < -.03 || ahead > 18) continue; // Once over the line, clear the intersection.
    const phase = trafficLightPhase(crossing.signal, time, crossing.approach);
    const amberMustStop = phase === 'yellow' && ahead > ego.speed * ego.speed / (2 * brake) + .3;
    if (phase === 'red' || amberMustStop) {
      if (ahead < obstruction) { obstruction = Math.max(0, ahead); status = 'red-light'; signal = phase; }
    } else if (signal == null) signal = phase;
  }
  for (const other of others) {
    if (!other.active || other.id === ego.id || Math.abs(other.position[1] - ego.position[1]) > .8) continue;
    const dx = other.position[0] - ego.position[0], dz = other.position[2] - ego.position[2];
    const ahead = dx * ego.heading[0] + dz * ego.heading[2], lateral = Math.abs(dx * ego.heading[2] - dz * ego.heading[0]);
    if (ahead > 0 && ahead < 20 && lateral < 1.05 && dot(ego.heading, other.heading) > .72) {
      const bumperGap = ahead - 2;
      if (gap == null || bumperGap < gap) gap = Math.max(0, bumperGap);
      const available = Math.max(0, bumperGap - .8);
      target = Math.min(target, Math.max(0, other.speed + (available - ego.speed * 1.05) / 1.1));
      if (available < obstruction) { obstruction = available; status = 'traffic'; }
      if (other.speed < .1 && available < .12) { target = 0; obstruction = 0; }
    } else {
      const yieldDistance = crossingAhead(ego, other);
      if (yieldDistance != null && yieldDistance < obstruction) { obstruction = yieldDistance; status = 'traffic'; }
    }
  }
  if (!vehicle.path.loop) target = Math.min(target, Math.sqrt(2 * brake * Math.max(0, remaining)));
  if (Number.isFinite(obstruction)) target = Math.min(target, Math.sqrt(2 * brake * obstruction));
  const speed = target > ego.speed ? Math.min(target, ego.speed + 2.4 * dt) : Math.max(target, ego.speed - brake * dt);
  const step = Math.min((ego.speed + speed) / 2 * dt, obstruction);
  let next = vehicle.distance + Math.max(0, step), actualSpeed = step < (ego.speed + speed) / 2 * dt ? 0 : speed;
  if (vehicle.path.loop && next >= vehicle.path.length) next %= vehicle.path.length;
  else if (!vehicle.path.loop && (next >= vehicle.path.length || remaining < .015)) { next = vehicle.path.length; actualSpeed = 0; status = 'arrived'; }
  return { ...vehicle, distance: next, speed: actualSpeed, status, signal, gap };
}

export function cityResidentCount({ overview = true, mobile = false } = {}) {
  return overview ? mobile ? 72 : 108 : mobile ? 30 : 42;
}
