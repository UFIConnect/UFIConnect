import { advanceTrafficVehicle, trafficVehiclePoint } from './cityTraffic.mjs';

// Driving is part of the decorative city simulation; reports stay in this scene.
export const DRIVE_ACCIDENT_PAUSE_SECONDS = 4;
export const DRIVE_MAX_LATERAL_OFFSET = 1.5;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const dot = (a, b) => a[0] * b[0] + a[2] * b[2];
const right = heading => [-heading[2], 0, heading[0]];

export function drivenVehiclePoint(vehicle) {
  return trafficVehiclePoint(vehicle);
}

function overlaps(ours, other, padding = 0) {
  if (!other.active || Math.abs(ours.position[1] - other.position[1]) > .75) return false;
  const separation = other.position.map((value, axis) => value - ours.position[axis]);
  const ourRight = right(ours.heading), theirRight = right(other.heading);
  // Oriented footprints match the rendered cars, including opposing and crossing traffic.
  return [ours.heading, ourRight, other.heading, theirRight].every(axis => {
    const ourRadius = .975 * Math.abs(dot(ours.heading, axis)) + .475 * Math.abs(dot(ourRight, axis));
    const theirRadius = .975 * Math.abs(dot(other.heading, axis)) + .475 * Math.abs(dot(theirRight, axis));
    return Math.abs(dot(separation, axis)) < ourRadius + theirRadius + padding;
  });
}

function collisionBetween(before, after, others, ignored) {
  const travel = Math.hypot(...after.position.map((value, axis) => value - before.position[axis]));
  const steps = Math.max(1, Math.ceil(travel / .25));
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const sample = { heading: after.heading, position: before.position.map((value, axis) => value + (after.position[axis] - value) * t) };
    const other = others.find(item => !ignored.includes(item.id) && overlaps(sample, item));
    if (other) return other;
  }
  return null;
}

export function advanceDrivenVehicle(vehicle, { delta = 0, time = 0, now = time, others = [], paused = false, input = {}, skip = false } = {}) {
  if (skip || vehicle.distance >= vehicle.path.length) {
    return { ...vehicle, distance: vehicle.path.length, speed: 0, lateralOffset: 0, status: 'arrived', signal: null, gap: null,
      accidentUntil: 0, accidentContacts: [] };
  }
  if ((vehicle.accidentUntil || 0) > now) return { ...vehicle, speed: 0, status: 'accident' };
  const resumed = { ...vehicle, accidentUntil: 0 };
  if (paused) return advanceTrafficVehicle(resumed, { delta: 0, time, paused: true });

  const dt = clamp(Number(delta) || 0, 0, .05);
  const current = drivenVehiclePoint(resumed);
  const neighbors = others.filter(other => other.id !== vehicle.id);
  // Keep an already reported contact suppressed until both footprints have cleared.
  // It also stops the following controller trapping the car inside that contact.
  const contacts = (vehicle.accidentContacts || []).filter(id => neighbors.some(other => other.id === id && overlaps(current, other, .25)));
  const steer = clamp(Number(input.steer) || 0, -1, 1);
  const remaining = Math.max(0, vehicle.path.length - vehicle.distance);
  const limit = DRIVE_MAX_LATERAL_OFFSET * clamp(remaining / 6, 0, 1);
  const lateralOffset = clamp((Number(vehicle.lateralOffset) || 0) + steer * 2.4 * dt, -limit, limit);
  const cruise = vehicle.cruise ?? 5.5;
  let next = advanceTrafficVehicle({ ...resumed, lateralOffset, cruise: input.brake ? 0 : input.throttle ? cruise * 1.6 : cruise },
    { delta: dt, time, others: neighbors.filter(other => !contacts.includes(other.id)) });
  next = { ...next, cruise, accidentContacts: contacts };
  if (next.status === 'arrived') return { ...next, lateralOffset: 0 };
  const collision = collisionBetween(current, drivenVehiclePoint(next), neighbors, contacts);
  if (collision) {
    return { ...next, speed: 0, status: 'accident', signal: null, gap: null,
      accidentUntil: now + DRIVE_ACCIDENT_PAUSE_SECONDS, accidentCount: (vehicle.accidentCount || 0) + 1,
      accidentOtherId: collision.id, accidentContacts: [...contacts, collision.id] };
  }
  if (input.brake && ['driving', 'turning'].includes(next.status)) next.status = 'braking';
  return next;
}
