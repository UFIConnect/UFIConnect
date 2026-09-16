const validRoles = new Set(['api', 'pipeline']);
const timestamp = value => {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export function observeAgentPayload(payload, role, receivedAt = Date.now()) {
  if (!validRoles.has(role) || !payload?.agents || typeof payload.agents !== 'object' || Array.isArray(payload.agents)) {
    throw new Error('Agent telemetry unavailable');
  }
  // Legacy responses omit roles. An explicit contradiction invalidates the
  // whole snapshot so the caller retains its last valid service observation.
  if (Object.hasOwn(payload, 'serviceRole') && payload.serviceRole !== role) {
    throw new Error('Agent telemetry unavailable');
  }
  const observed = Object.create(null);
  for (const [id, agent] of Object.entries(payload.agents)) {
    if (!agent || typeof agent !== 'object' || Array.isArray(agent)) continue;
    if (Object.hasOwn(agent, 'serviceRole') && agent.serviceRole !== role) {
      throw new Error('Agent telemetry unavailable');
    }
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id)) continue;
    observed[id] = { ...agent, id, serviceRole: role, receivedAt,
      observedAt: timestamp(agent.observedAt || payload.observedAt)
        ? agent.observedAt || payload.observedAt : new Date(receivedAt).toISOString(),
    };
  }
  return observed;
}

// Prefer the process that actually owns the work. A more recent API heartbeat
// cannot replace the source fetcher's pipeline state. Keep both observations
// available so a shared guard can be inspected separately in each process.
export function mergeObservedAgents(api = {}, pipeline = {}) {
  const result = Object.create(null);
  for (const id of new Set([...Object.keys(api), ...Object.keys(pipeline)])) {
    const instances = { ...(api[id] ? { api: api[id] } : {}), ...(pipeline[id] ? { pipeline: pipeline[id] } : {}) };
    const owner = pipeline[id]?.executionRole || api[id]?.executionRole;
    let selected = validRoles.has(owner) ? instances[owner] : null;
    if (!selected) selected = Object.values(instances).sort((a, b) => {
      // Older deployments do not include ownership. Prefer actual work over
      // presence heartbeats, without converting either into a healthy status.
      const lastWork = entry => Math.max(timestamp(entry.health?.lastSuccess), timestamp(entry.lastFetch));
      return lastWork(b) - lastWork(a)
        || timestamp(b.lastAction?.ts) - timestamp(a.lastAction?.ts)
        || (b.receivedAt || 0) - (a.receivedAt || 0);
    })[0];
    if (selected) result[id] = { ...selected, instances,
      ownerAvailable: !validRoles.has(owner) || Boolean(instances[owner]),
    };
  }
  return result;
}
