'use strict';
// Task IDs come only from the existing, authenticated Office control catalog.
// Chat text cannot choose arbitrary commands. Public web edits use the separate
// reviewed file editor and the existing commit control.
const TASKS = Object.freeze({
  feed: ['feed.inspect-delivery', 'feed.refresh-all', 'feed.transfer-staging', 'feed.clear-delivery-caches'],
  refresh_queue: ['runtime.inspect-queues', 'feed.refresh-all'],
  equalizer: ['feed.equalize', 'runtime.inspect-queues'],
  filter: ['feed.inspect-delivery'], topic_filter: ['feed.inspect-delivery'],
  topic_audit: ['feed.audit-topics'], topic_fix: ['feed.apply-topic-fixes', 'feed.audit-topics'],
  sort_agent: ['feed.sort-newest'], sort_distrib: ['feed.rebalance-sources'],
  mix_optimizer: ['feed.audit-mix', 'feed.rebalance-sources'], sort_optimizer: ['feed.audit-sorting'],
  optimizer: ['feed.optimize-sources', 'runtime.inspect-queues'], cache_helper: ['feed.sync-cache', 'feed.inspect-delivery'],
  security: ['health.security', 'runtime.inspect-queues'], community: ['health.community', 'health.data'],
  perf: ['runtime.stability', 'health.performance'], seo: ['health.seo'], opps: ['jobs.audit', 'jobs.refresh'],
  data: ['health.data', 'health.database-size', 'runtime.inspect-queues'],
  deploy: ['health.deployments', 'deploy.web', 'deploy.api', 'deploy.pipeline', 'deploy.office'],
  stability: ['runtime.stability', 'runtime.inspect-queues'],
  crash_guard: ['runtime.stability', 'runtime.trim-caches'], activity: ['runtime.inspect-queues'],
  autofix: ['automation.audit', 'automation.enable', 'automation.disable'],
  web_optimizer: ['health.website'], web_perf: ['health.performance'], web_seo: ['health.seo'],
  web_cache: ['health.cache', 'feed.clear-delivery-caches'], web_storage: ['health.storage', 'health.database-size'],
  web_api: ['health.api'], web_pipeline: ['health.pipeline'], web_office: ['health.office'], web_pwa: ['health.pwa'],
});
function agentActions(snapshot, catalog = []) {
  if (!snapshot) return [];
  const ids = snapshot.diagnosticCapability === 'source-worker'
    ? [`source.refresh.${snapshot.agentId}`, 'runtime.inspect-queues']
    : Object.hasOwn(TASKS, snapshot.agentId) ? [...TASKS[snapshot.agentId]] : [];
  if (Object.hasOwn(TASKS, snapshot.agentId) || ['source-worker', 'on-demand'].includes(snapshot.diagnosticCapability)) ids.push('commit.web-frontend');
  return ids.flatMap(id => {
    const control = catalog.find(item => item.id === id && (!item.input || (item.input === 'frontend-file' && item.frontendTarget === 'web')));
    if (!control || !['api', 'pipeline', 'both'].includes(control.target)) return [];
    return [{ id: control.id, label: control.label, description: control.description, target: control.target,
      impact: control.impact, input: control.input || null, frontendTarget: control.frontendTarget || null,
      requiresConfirmation: Boolean(control.requiresConfirmation), available: control.available !== false,
      unavailableReason: control.available === false ? control.unavailableReason || 'This task needs setup.' : null }];
  });
}
function requestedActions(message, actions) {
  const text = String(message).trim().toLowerCase();
  if (!/^(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:run|check|inspect|audit|refresh|sync|merge|sort|rebalance|heal|optimize|apply|transfer|clear|trim|clean|enable|disable|deploy|drain|do|fetch|pull|edit|change|update|fix|add|remove|style|improve)\b/.test(text)) return null;
  const matches = actions.filter(action => {
    const id = action.id;
    if (id === 'commit.web-frontend') return /\b(edit|change|update|fix|add|remove|style|improve)\b.*\b(homepage|website|public\s+web|web\s+(?:page|file)|web\/)\b/.test(text);
    if (id.startsWith('source.refresh.')) return /\b(refresh|fetch|pull)\b/.test(text);
    if (id === 'runtime.inspect-queues') return /\b(queues?|pending|backlog)\b/.test(text);
    if (id === 'automation.enable') return /\benable\b.*\b(auto\s*fix|automation)\b/.test(text);
    if (id === 'automation.disable') return /\bdisable\b.*\b(auto\s*fix|automation)\b/.test(text);
    if (id === 'automation.audit') return /\b(audit|check)\b.*\b(auto\s*fix|automation|errors?)\b/.test(text);
    if (id.startsWith('deploy.')) return /\bdeploy\b/.test(text) && new RegExp('\\b'+id.slice(7)+'\\b').test(text.replace(/\bwebsite\b/g,'web').replace(/\bbackend\b/g,'api'));
    if (id === 'health.deployments') return /\b(check|inspect|audit)\b.*\b(deployments?|services?|reachability)\b/.test(text);
    if (id === 'feed.clear-delivery-caches') return /\b(clear|expire|clean)\b.*\bcaches?\b/.test(text);
    if (id === 'runtime.trim-caches') return /\btrim\b.*\b(cache|memory)\b/.test(text);
    if (id === 'feed.transfer-staging') return /\btransfer\b.*\b(staged|staging|posts|content)\b/.test(text);
    if (id === 'feed.refresh-all') return /\b(refresh|fetch|pull)\b/.test(text);
    if (id === 'feed.apply-topic-fixes') return /\bapply\b.*\b(topic|correction|fix)\w*\b/.test(text);
    if (id === 'feed.audit-topics') return /\b(audit|check)\b.*\btopics?\b/.test(text);
    if (id === 'health.storage') return /\b(storage|persist|persistence)\b/.test(text);
    if (id === 'health.database-size') return /\b(capacity|size|space)\b/.test(text);
    const words = { 'feed.equalize':'equalizer|balance|drain', 'feed.sync-cache':'sync|merge', 'feed.sort-newest':'sort|sorting',
      'feed.rebalance-sources':'rebalance|distribution|supply', 'feed.optimize-sources':'heal|optimize|workers',
      'feed.audit-mix':'mix|diversity', 'feed.audit-sorting':'sort|ranking', 'feed.inspect-delivery':'delivery|feed',
      'runtime.stability':'stability|memory|performance', 'jobs.audit':'jobs|career', 'jobs.refresh':'refresh|career',
      'health.security':'security|authentication', 'health.community':'community|groups', 'health.data':'data|counts|database',
      'health.website':'website|health', 'health.performance':'performance|speed', 'health.seo':'seo|metadata',
      'health.cache':'cache', 'health.api':'api|backend', 'health.pipeline':'pipeline', 'health.office':'office', 'health.pwa':'pwa|assets' };
    return Object.hasOwn(words,id) && new RegExp('\\b(?:'+words[id]+')\\b').test(text);
  });
  if (matches.length) return matches;
  return /^(?:please\s+)?(?:run|do)\s+(?:your\s+)?(?:main\s+)?(?:check|task|audit)(?:\s+now)?[.!]?$/.test(text) ? actions.slice(0,1) : [];
}
module.exports = { agentActions, requestedActions };
