import { createTrafficPath, trafficPoint } from './cityTraffic.mjs';

// Pedestrians cover distance at a steady pace on the sidewalk and turn in
// place at its ends. Their gait follows their travel distance.
export function pedestrianPose(path, time, speed, startFraction) {
  const travelTime = path.length / speed, turnTime = .7, legTime = travelTime + turnTime;
  const clock = time + startFraction * legTime * 2;
  const leg = Math.floor(clock / legTime), elapsed = clock - leg * legTime;
  const walked = Math.min(path.length, elapsed * speed), reverse = leg % 2 !== 0;
  const sample = trafficPoint(path, reverse ? path.length - walked : walked);
  const turn = Math.max(0, (elapsed - travelTime) / turnTime);
  const yaw = Math.atan2(sample.heading[0], sample.heading[2]) + (reverse ? Math.PI : 0)
    + Math.PI * turn * turn * (3 - 2 * turn);
  const stride = Math.min(1, walked * 4, (path.length - walked) * 4);
  const step = (leg * path.length + walked) * Math.PI * 2 / .76;
  return { position: sample.position, yaw, step, stride };
}

export function createPedestrianCircuit(points, crossingIndices) {
  const path = createTrafficPath(points, { loop: true });
  const crossings = crossingIndices.map(index => {
    const start = path.cumulative[index], end = path.cumulative[index + 1];
    return { start, end, center: trafficPoint(path, (start + end) / 2).position };
  });
  return { path, crossings };
}

function crossingIsClear(crossing, vehicles) {
  const [x, y, z] = crossing.center;
  return !vehicles.some(({ active, position, heading, speed }) => {
    if (!active || Math.abs(position[1] - y) > .65) return false;
    const dx = x - position[0], dz = z - position[2];
    const ahead = dx * heading[0] + dz * heading[2];
    const sideways = Math.abs(dx * heading[2] - dz * heading[0]);
    return ahead > -1.35 && ahead < 1.65 + .95 * speed && sideways < 2.15;
  });
}

export function advancePedestrianCircuit(circuit, walker, delta, speed, vehicles) {
  const { path, crossings } = circuit;
  const start = walker.distance, target = start + speed * Math.max(0, Math.min(.05, delta));
  const crossing = crossings.find(item => start <= item.start && target > item.start);
  const end = crossing && !crossingIsClear(crossing, vehicles) ? crossing.start : target;
  const distance = end % path.length, walked = walker.walked + end - start;
  const sample = trafficPoint(path, distance);
  const before = trafficPoint(path, (distance - .16 + path.length) % path.length).position;
  const after = trafficPoint(path, (distance + .16) % path.length).position;
  const yaw = Math.atan2(after[0] - before[0], after[2] - before[2]);
  return { distance, walked, position: sample.position, yaw, step: walked * Math.PI * 2 / .76,
    stride: end > start ? 1 : 0,
    crossing: crossings.some(item => distance > item.start + .03 && distance < item.end - .03) };
}
