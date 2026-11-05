const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const STATES = { queued: 'queued', planning: 'planning', working: 'working', succeeded: 'completed', completed: 'completed', failed: 'failed', cancelled: 'cancelled', cancel_requested: 'stopping', needs_confirmation: 'waiting for your approval', needs_continuation: 'waiting to continue', needs_input: 'waiting for your input' };
const PERIODS = { past24h: 'Past 24 hours', today: 'Today', week: 'This week' };
const HEALTH_MAX_AGE = 30 * 60000;
const timestamp = value => typeof value === 'number' ? value : Date.parse(value);
const number = value => count(value) === null ? 'unavailable' : value.toLocaleString('en-US');
const label = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) : '';

function healthLine(name, samples, now) {
  const recent = samples.filter(sample => sample && Number.isFinite(timestamp(sample.lastRun))
    && timestamp(sample.lastRun) <= now + 60000 && now - timestamp(sample.lastRun) <= HEALTH_MAX_AGE)
    .sort((a, b) => timestamp(b.lastRun) - timestamp(a.lastRun))[0];
  if (!recent) return `${name} health could not be verified from a recent check.`;
  if (recent.status === 'healthy') return `${name} health is healthy.`;
  if (['degraded', 'error', 'failed', 'critical', 'unhealthy'].includes(recent.status)) return `${name} health needs attention.`;
  return `${name} health is awaiting a completed check.`;
}

// Native installed apps have no server-side probe. Their recorded telemetry —
// app opens and reported client errors in the shared past-24h analytics
// window — is the measurable native health signal, checked on every login.
function nativeAppLine(summary, valid, parts) {
  const past24h = valid && summary?.analytics?.available === true ? summary?.analytics?.windows?.past24h : null;
  const opens = count(past24h?.mobile?.views), errors = count(past24h?.mobile?.clientErrors);
  if (opens === null || errors === null) {
    parts.push('Native installed-app health could not be verified from recorded app telemetry.');
    return;
  }
  parts.push(errors > 0
    ? `Native installed-app health needs attention: ${errors.toLocaleString('en-US')} client error reports were recorded from installed apps in the past 24 hours.`
    : `Native installed-app health recorded no client errors from installed apps in the past 24 hours; ${opens.toLocaleString('en-US')} app opens were recorded.`);
  if (past24h.complete !== true) parts.push('Only recorded native app telemetry can be checked, and the past 24 hours of it is incomplete.');
}

function detailedUpdates(summary, parts) {
  const zone = summary.timeZone || 'America/Los_Angeles';
  let through;
  try { through = new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(summary.asOf)); } catch { /* invalid data is not announced */ }
  if (through) parts.push(`Counts through ${through}, ${zone === 'America/Los_Angeles' ? 'Los Angeles time' : zone.replace(/_/g, ' ')}. Today starts at midnight; this week starts Monday.`);
  const analytics = summary.analytics, period = analytics?.windows?.past24h;
  if (analytics?.available === true && period) {
    const partial = period.complete === true ? '' : 'Partial history: ';
    parts.push(`${partial}Past 24 hours: ${number(period.web?.views)} recorded web opens and ${number(period.mobile?.views)} app opens; ${number(period.clientErrors)} reported client errors.`);
    if (period.complete !== true) parts.push('Earlier activity is unavailable while the 24-hour history fills in.');
    parts.push('Opens include repeat page, screen, and tab visits; they are not unique users.');
    const collector = analytics.storage?.collector;
    if (collector && ['writeFailures', 'storageUnavailable', 'dropped', 'rateLimited'].some(key => count(collector[key]) > 0)) {
      parts.push('This service reported analytics collection failures; recorded counts may be incomplete.');
    }
  } else parts.push('Past 24-hour web and app analytics are unavailable.');
  for (const [key, title] of Object.entries(PERIODS)) {
    const values = summary.counts?.[key];
    parts.push(`${title}: ${number(values?.posts?.memberCreated)} member posts, ${number(values?.posts?.importedRetained)} retained imported posts, and ${number(values?.newUsers)} new users.`);
  }
  parts.push('Post counts cover retained posts; imported posts use their publication time.');
  const activity = summary.lastActivity;
  if (activity?.available === true && activity.latest && label(activity.latest.label)) {
    const state = STATES[activity.latest.status] || ({ running: 'running', success: 'completed', requested: 'requested', answered: 'answered' }[activity.latest.status]);
    parts.push(`Last recorded Office activity: ${label(activity.latest.label)}${state ? `; ${state}` : ''}.`);
  } else parts.push(activity?.available === true ? 'No previous activity was found in the available Office records.' : 'Your last Office activity could not be loaded.');
  if (activity?.complete === false || Object.values(activity?.sources || {}).includes('unavailable')) parts.push('Some recent Office history could not be checked.');
  parts.push('Activity history is shared across this Office.');
  const warnings = summary.warnings;
  const critical = count(warnings?.criticalActivityFindings), errors = count(warnings?.serverErrors), failed = count(warnings?.failedControls);
  if (critical !== null || errors !== null || failed !== null) {
    if (warnings.available === true && critical === 0 && errors === 0 && failed === 0) parts.push('No critical activity findings, server errors, or failed Office controls were recorded in the past 24 hours.');
    else parts.push(`Warnings in the past 24 hours: ${number(critical)} critical activity findings, ${number(errors)} recorded server errors, and ${number(failed)} failed Office controls.${critical || errors || failed ? ' Review these warnings.' : ''}`);
    if (warnings.available !== true) parts.push('The warning history could not be fully verified.');
    parts.push('Only recorded warnings can be checked.');
  } else parts.push('The past 24-hour warning history could not be fully verified.');
}

// Announce measured fields only; exclude raw logs, instructions and errors.
export function officeWelcome({ services = [], tasks = null, summary = null, checkedAt = new Date().toISOString() } = {}) {
  const parts = ['Welcome back. I am Pip. Here are the latest Office updates.'];
  const now = timestamp(checkedAt), validSummary = summary?.schemaVersion === 1 && Number.isFinite(timestamp(summary.asOf))
    && timestamp(summary.asOf) <= now + 60000 && now - timestamp(summary.asOf) <= 5 * 60000;
  let observed = validSummary;
  const optimizers = [];
  for (const { role, data } of services) {
    const label = role === 'pipeline' ? 'Pipeline' : 'API';
    if (!data?.server || data.server.serviceRole !== role) {
      parts.push(`${label} status could not be verified.`); continue;
    }
    observed = true;
    if (data.websiteOptimizer) optimizers.push(data.websiteOptimizer);
    parts.push(data.server.db === 'connected' ? `${label} database is connected.` : `${label} database connection is not confirmed.`);
    if (role === 'api' && count(data.feed?.postCount) !== null) parts.push(`The API feed currently has ${data.feed.postCount.toLocaleString('en-US')} posts.`);
    if (role === 'pipeline') {
      const degraded = count(data.sources?.degraded), paused = count(data.sources?.paused);
      if (degraded !== null && paused !== null) parts.push(`${degraded} sources are degraded and ${paused} are paused.`);
    }
    if (['pressure', 'critical'].includes(data.stability?.mode)) parts.push(`${label} is reporting memory ${data.stability.mode}.`);
    if (data.dbSize?.status === 'critical') parts.push(`${label} reports critical database storage pressure.`);
  }
  if (!services.length) parts.push('Service status is currently unavailable.');
  parts.push(healthLine('Web', optimizers, now));
  parts.push(healthLine('App web shell', optimizers.map(item => item.subAgents?.web_pwa), now));
  nativeAppLine(summary, validSummary, parts);
  if (validSummary) detailedUpdates(summary, parts);
  else {
    parts.push('Past 24-hour analytics, daily and weekly post and new-user counts, and warning history are unavailable.');
    if (Array.isArray(tasks)) {
      observed = true;
      const latest = [...tasks].filter(task => Number.isFinite(Date.parse(task?.updatedAt || task?.createdAt)))
        .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))[0];
      if (latest && Object.hasOwn(STATES, latest.status)) parts.push(`Your most recently updated Work task is ${STATES[latest.status]}.`);
      else if (!tasks.length) parts.push('No recent Work tasks were returned.');
    } else parts.push('Recent Work updates could not be loaded.');
  }
  parts.push('Do you need anything?');
  return { text: parts.join(' '), checkedAt, observed };
}
