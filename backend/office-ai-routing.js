'use strict';

// Destinations describe where an operator wants work to happen. They never
// grant capabilities: the task's explicitly selected permissions still apply.
const DESTINATIONS = Object.freeze(['auto', 'general', 'office', 'hosted-web', 'local-web', 'public-web', 'mobile-app', 'self-update', 'project']);
const labels = { project: 'UFIConnect project', general: 'General request', office: 'Office operations', 'hosted-web': 'Hosted website draft',
  'public-web': 'Public website', 'mobile-app': 'Mobile apps', 'self-update': 'UFIConnect AI upgrade' };
const fail = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });
const normalized = value => String(value || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();
const idle = /^(?:hi|hello|hey|hi there|hello there|good morning|good afternoon|good evening|thanks|thank you|ok|okay|yes|no|go|start|run|help|help me|do something|do anything|anything|start (?:a |the )?task|run (?:a |the )?task|cancel|stop|never mind|nevermind|no task|do nothing|what can you do|what do you do|how can you help(?: me)?|what are your capabilities)[.!?]*$/;

function hasTaskObjective(message, history = []) {
  const value = normalized(message);
  if (!value || /^(?:cancel|stop|never mind|nevermind|no task|do nothing)[.!?]*$/.test(value)) return false;
  if (!idle.test(value)) return true;
  // Acknowledgment can continue a concrete earlier request, but an exchange
  // consisting entirely of greetings and capability questions is still idle.
  return /^(?:yes|ok|okay|go|start|run)[.!?]*$/.test(value)
    && history.some(item => item?.role === 'user' && normalized(item.content) && !idle.test(normalized(item.content)));
}

function classifyDestination(message, requested = 'auto') {
  if (!DESTINATIONS.includes(requested)) throw fail(400, 'Choose a supported task destination.');
  if (requested === 'local-web') requested = 'hosted-web';
  const value = normalized(message);
  const hosted = /\b(?:local (?:web(?:site)?|site|page|preview)|localhost|127\.0\.0\.1|local-web|hosted (?:web(?:site)?|draft|preview)|private (?:web(?:site)?|draft|preview))\b/.test(value);
  const self = /\b(?:upgrad(?:e|ing)|updat(?:e|ing)|improv(?:e|ing)|fix|extend|repair|enhance|change)\b[\s\S]{0,100}\b(?:yourself|itself|office ai|uficonnect\.ai|pip|the ai|ai assistant)\b/.test(value)
    || /\b(?:your|its|the ai's|office ai's) (?:own )?(?:code|capabilities|memory|tools|reasoning|task engine)\b/.test(value);
  // Explicit negation must not become permission to publish.
  const publicText = value.replace(/\b(?:do not|don't|never|without|not)\s+(?:publish|deploy|release|public|live|production)(?:\s+\w+){0,3}/g, '');
  const publicWeb = /\buficonnect\.org\b|\b(?:fix|repair|update|change|improve|edit|redesign)\b[\s\S]{0,80}\b(?:web(?:site)?|home ?page|landing page)\b|\b(?:public|live|production) (?:web(?:site)?|site|page|home ?page)\b|\b(?:publish|deploy|release)\b[\s\S]{0,80}\b(?:web(?:site)?|site|home ?page)\b/.test(publicText);
  const office = /\b(?:office (?:controls?|operations?|agents?)|feed|pipeline|source workers?|service health|security check|agent status)\b/.test(value);
  const mobile = /\b(?:mobile apps?|ios apps?|android apps?|iphone apps?|ipad apps?|expo apps?)\b/.test(value)
    || /\b(?:build|update|fix|deploy|release|publish)\b[\s\S]{0,60}\b(?:the |our |uficonnect )apps?\b/.test(value);
  if (hosted && requested !== 'auto' && requested !== 'hosted-web' && requested !== 'general')
    throw fail(409, 'This request names a private website draft. Choose Hosted website draft so it cannot publish to production.');
  if (requested !== 'auto') return { target: requested, label: labels[requested], source: 'selected',
    reason: 'The operator selected this destination.', hosted: requested === 'hosted-web' };
  const project = /\b(?:fix|repair|debug|implement|edit|update|change|improve|broken|not working|doesn't work|does not work)\b/.test(value) && /\b(?:uficonnect|button|code|bug|error|endpoint|api|backend|frontend|login|sign.in|screen|component)\b/.test(value);
  const target = hosted ? 'hosted-web' : self ? 'self-update' : publicWeb ? 'public-web' : mobile ? 'mobile-app' : office ? 'office' : project ? 'project' : 'general';
  return { target, label: labels[target], source: 'request', hosted: target === 'hosted-web',
    reason: target === 'general' ? 'No external destination was specified. General work stays separate from publishing.'
      : `The current request explicitly refers to ${labels[target].toLowerCase()}.` };
}

function routeTaskRequest(input) {
  const route = classifyDestination(input.message, input.target || 'auto');
  const permissions = { editCode: input.permissions?.editCode === true, publish: input.permissions?.publish === true,
    deploy: input.permissions?.deploy === true, operate: input.permissions?.operate === true };
  let deployTargets = [...(input.deployTargets || [])];
  if (route.target === 'hosted-web') {
    permissions.publish = false; permissions.deploy = false; permissions.operate = false;
    // Files are written to the encrypted hosted workspace. Repository edits,
    // terminal execution and public publication are separate capabilities.
    deployTargets = [];
  } else if (route.target === 'office') {
    permissions.editCode = false; permissions.publish = false;
  } else if (route.target === 'public-web') {
    permissions.operate = false; deployTargets = deployTargets.filter(target => target === 'web');
  } else if (route.target === 'mobile-app') {
    permissions.operate = false; deployTargets = deployTargets.filter(target => target === 'mobile');
  } else if (route.target === 'self-update') {
    permissions.operate = false;
    deployTargets = deployTargets.filter(target => ['api', 'pipeline', 'office', 'cloudflare-ai', 'cloudflare-site'].includes(target));
  } else if (route.target === 'project') {
    permissions.operate = false;
  } else {
    // A generic task may prepare repository code if explicitly permitted, but
    // choosing Auto without a public destination cannot silently publish it.
    permissions.publish = false; permissions.deploy = false; permissions.operate = false; deployTargets = [];
  }
  if (/\b(?:do not|don't|never)\s+(?:publish|deploy|release)\b|\bwithout\s+(?:publishing|deploying|releasing)\b/i.test(input.message)) {
    permissions.publish = false; permissions.deploy = false; deployTargets = [];
  }
  return { route, permissions, deployTargets };
}

function pathAllowedForRoute(route, filePath) {
  if (!route) return true; // Preserve already-created legacy task scope.
  if (typeof filePath !== 'string' || filePath.includes('..') || filePath.includes('\\')) return false;
  if (route.target === 'hosted-web' || route.target === 'office') return false;
  if (route.target === 'public-web') return /^web\//.test(filePath);
  if (route.target === 'mobile-app') return /^mobile\//.test(filePath);
  if (route.target === 'self-update') return /^office\/|^backend\/(?:office-ai[^/]*|office-connections[^/]*|index\.js)$|^infra\/office-ai[^/]*\/|^scripts\/(?:audit-office-ai|office-command-city)[^/]*$|^docs\/OFFICE-AI\.md$/.test(filePath);
  return true;
}

function toolAllowedForRoute(route, name) {
  if (!route) return true;
  if (route.target === 'hosted-web') return ['repo_list', 'repo_read', 'repo_search', 'web_read', 'web_search', 'workspace_search', 'memory_search', 'memory_remember', 'workspace_list', 'workspace_read', 'workspace_write'].includes(name);
  if (name === 'office_command') return route.target === 'office';
  if (name === 'cloudflare_deploy') return route.target === 'self-update';
  return true;
}

module.exports = { DESTINATIONS, classifyDestination, routeTaskRequest, hasTaskObjective, pathAllowedForRoute, toolAllowedForRoute };
