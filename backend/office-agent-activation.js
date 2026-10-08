'use strict';

const SOURCE_KEYS = Object.freeze({ reddit: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'],
  twitter: ['TWITTER_BEARER_TOKEN'], linkedin: ['LINKEDIN_TOKEN'], facebook: ['FACEBOOK_TOKEN'],
  twitch: ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'], usajobs: ['USAJOBS_API_KEY', 'USAJOBS_USER_AGENT'] });
function officeSourceReady(id, env = {}) {
  return (Object.hasOwn(SOURCE_KEYS, id) ? SOURCE_KEYS[id] : []).every(key => Boolean(String(env[key] || '').trim()));
}

// Use the registered worker and control inventory; activation never creates
// provider accounts, purchases credits, or enables unattended code changes.
function planOfficeActivation({ role, agents = {}, sourceIds = [], sourceReady = () => true, now = Date.now(), critical = false }) {
  const sources = new Set(sourceIds);
  return Object.entries(agents).map(([id, agent]) => {
    const label = agent.name || id;
    const status = agent.observation?.status || agent.health?.status || 'unknown';
    const owner = agent.executionRole || agent.observation?.executionRole;
    const item = { id, label };
    if (sources.has(id)) {
      if (role !== 'pipeline') return { ...item, status: 'skipped', reason: 'Source work belongs to Pipeline.' };
      if (!sourceReady(id)) return { ...item, status: 'skipped', reason: 'Provider credentials or approval are required. Open Setup.' };
      if (critical) return { ...item, status: 'skipped', reason: 'Runtime protection is waiting for memory pressure to fall.' };
      if (agent.health?.paused && agent.health.pauseUntil > now) return { ...item, status: 'skipped', reason: 'Provider cooldown is active; recovery resumes when it expires.' };
      if (['healthy', 'running'].includes(status) && agent.health?.lastSuccess) return { ...item, status: 'checked', reason: 'The configured source worker is already running; no extra refresh was started.' };
      return { ...item, status: 'queue', reason: 'Refresh through the existing paced source queue.' };
    }
    if (owner === 'pipeline' && role !== 'pipeline') return { ...item, status: 'skipped', reason: 'This stage belongs to Pipeline.' };
    if (id === 'autofix') return { ...item, status: 'skipped', reason: 'Automatic code changes use their separate enable control.' };
    if (owner === 'on-demand' || ['ai', 'instagram'].includes(id)) return { ...item, status: 'skipped', reason: id === 'ai' ? 'Use Action setup to choose and run an Office task.' : 'Runs when a member connects and requests their account feed.' };
    if (['healthy', 'running', 'armed', 'contained', 'normal'].includes(status)) return { ...item, status: 'checked', reason: 'The registered agent is already enabled and observed.' };
    return { ...item, status: 'check', reason: 'Run the registered agent check.' };
  });
}

async function activateOfficeAgents({ role, plan, checks = {}, enqueue }) {
  const items = [], queued = [];
  for (const item of plan) {
    if (item.status === 'queue') { queued.push(item.id); continue; }
    if (item.status !== 'check') { items.push(item); continue; }
    const check = checks[item.id];
    if (!check) { items.push({ ...item, status: 'skipped', reason: 'This stage runs when work arrives; it has no standalone activation task.' }); continue; }
    try {
      const result = await check();
      items.push({ ...item, status: result?.skipped ? 'skipped' : result === false ? 'failed' : 'checked', reason: result?.skipped ? 'Runtime protection deferred this check.' : result === false ? 'The check reported a problem. Open its agent inspector.' : 'The registered check completed.' });
    } catch { items.push({ ...item, status: 'failed', reason: 'The check could not complete. Review the agent inspector and Setup.' }); }
  }
  if (queued.length) {
    try {
      const accepted = new Set(enqueue(queued));
      for (const id of queued) {
        const entry = plan.find(item => item.id === id);
        items.push({ ...entry, status: accepted.has(id) ? 'queued' : 'skipped', reason: accepted.has(id) ? 'Refresh queued on Pipeline. Completion appears in live telemetry.' : 'A refresh is already queued or running.' });
      }
    } catch {
      for (const id of queued) items.push({ ...plan.find(item => item.id === id), status: 'failed', reason: 'The source queue could not accept this refresh.' });
    }
  }
  return { role, ...Object.fromEntries(['queued', 'checked', 'skipped', 'failed'].map(status => [status, items.filter(item => item.status === status).length])), items };
}

module.exports = { SOURCE_KEYS, officeSourceReady, planOfficeActivation, activateOfficeAgents };
