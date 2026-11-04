const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const STATES = { queued: 'queued', planning: 'planning', working: 'working', succeeded: 'completed', completed: 'completed', failed: 'failed', cancelled: 'cancelled', cancel_requested: 'stopping', needs_confirmation: 'waiting for your approval', needs_continuation: 'waiting to continue', needs_input: 'waiting for your input' };

// Announce measured fields only; exclude raw logs, instructions and errors.
export function officeWelcome({ services = [], tasks = null, checkedAt = new Date().toISOString() } = {}) {
  const parts = ['Welcome back. Here are the latest Office updates.'];
  let observed = false;
  for (const { role, data } of services) {
    const label = role === 'pipeline' ? 'Pipeline' : 'API';
    if (!data?.server || data.server.serviceRole !== role) {
      parts.push(`${label} status could not be verified.`); continue;
    }
    observed = true;
    parts.push(data.server.db === 'connected' ? `${label} database is connected.` : `${label} database connection is not confirmed.`);
    if (role === 'api' && count(data.feed?.postCount) !== null) parts.push(`The API feed currently has ${data.feed.postCount.toLocaleString('en-US')} posts.`);
    if (role === 'pipeline') {
      const degraded = count(data.sources?.degraded), paused = count(data.sources?.paused);
      if (degraded !== null && paused !== null) parts.push(`${degraded} sources are degraded and ${paused} are paused.`);
    }
    if (['pressure', 'critical'].includes(data.stability?.mode)) parts.push(`${label} is reporting memory ${data.stability.mode}.`);
  }
  if (!services.length) parts.push('Service status is currently unavailable.');
  if (Array.isArray(tasks)) {
    observed = true;
    const latest = [...tasks].filter(task => Number.isFinite(Date.parse(task?.updatedAt || task?.createdAt)))
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))[0];
    if (latest && Object.hasOwn(STATES, latest.status)) parts.push(`Your most recently updated Work task is ${STATES[latest.status]}.`);
    else if (!tasks.length) parts.push('No recent Work tasks were returned.');
  } else parts.push('Recent Work updates could not be loaded.');
  parts.push('Do you need anything?');
  return { text: parts.join(' '), checkedAt, observed };
}
