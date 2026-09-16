// This view models observations, never an inferred job scheduler or a post ledger.
export const CITY_FRESH_MS = 30_000;
export const CITY_DISTRICTS = Object.freeze([
  { id: 'sources', label: 'Source collection', short: 'COLLECT', role: 'pipeline', color: '#38bdf8', x: 190, y: 220, height: 86, link: 'sources', description: 'External source workers gather content. A recorded successful fetch is distinct from an agent heartbeat.' },
  { id: 'equalizer', label: 'Equalizer', short: 'BALANCE', role: 'pipeline', color: '#22d3ee', x: 430, y: 220, height: 66, link: 'pipeline', description: 'Buffers source output and balances accepted content before persistence.' },
  { id: 'filter', label: 'Content filter', short: 'SCREEN', role: 'pipeline', color: '#a78bfa', x: 670, y: 220, height: 96, link: 'pipeline', description: 'Screens invalid, duplicate, and rejected content. Input and output counts describe the last reported run.' },
  { id: 'sort', label: 'Sort and rank', short: 'ORDER', role: 'pipeline', color: '#c084fc', x: 910, y: 220, height: 76, link: 'pipeline', description: 'Orders and deduplicates feed results. This stage can also run during requests; the map is a logical overview.' },
  { id: 'staging', label: 'Staging depot', short: 'QUEUE', role: 'api', color: '#fbbf24', x: 910, y: 490, height: 54, link: 'post-pipeline', description: 'Fetched content waits in feed_posts_staging. A queued post has not necessarily reached the live feed.' },
  { id: 'transfer', label: 'Transfer station', short: 'PROMOTE', role: 'api', color: '#fb923c', x: 670, y: 490, height: 74, link: 'post-pipeline', description: 'The API promotes staged rows into the live cache. This is separate from the source refresh queue.' },
  { id: 'database', label: 'Primary database', short: 'STORE', role: 'api', color: '#60a5fa', x: 430, y: 490, height: 110, link: 'overview', description: 'Primary PostgreSQL storage and its reported capacity. Connection status is not a verification of every stored record.' },
  { id: 'topics', label: 'Topic filter', short: 'MATCH', role: 'api', color: '#2dd4bf', x: 190, y: 490, height: 67, link: 'pipeline', description: 'Filters the requested feed for selected topics after storage. Only aggregate run counts are shown here.' },
  { id: 'feed', label: 'Live feed', short: 'DELIVER', role: 'api', color: '#4ade80', x: 190, y: 760, height: 85, link: 'post-pipeline', description: 'The API’s in-memory feed cache and connected feed streams. Connected clients do not prove that a post was delivered.' },
  { id: 'backup', label: 'Feed recovery', short: 'RECOVER', role: 'api', color: '#818cf8', x: 430, y: 760, height: 58, link: 'overview', description: 'A bounded recent-feed recovery snapshot. This is not a complete backup of accounts, messages, or settings.' },
  { id: 'security', label: 'Security watch', short: 'PROTECT', role: 'api', color: '#f472b6', x: 670, y: 760, height: 95, link: 'agents', description: 'Reported security-agent activity and runtime counters. This dashboard does not certify security or run a vulnerability scan.' },
  { id: 'runtime', label: 'Runtime control', short: 'OPERATE', role: 'pipeline', color: '#94a3b8', x: 910, y: 760, height: 114, link: 'controls', description: 'Observed stability, memory pressure, and event-loop delay for each process. Open Controls to review operational settings.' },
]);

export function cityTimestamp(value) {
  if (value == null || value === '') return null;
  const time = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(time) && time > 0 ? time : null;
}
export function observationState(observation, now = Date.now(), available = true) {
  if (observation?.error) return 'unavailable';
  const time = cityTimestamp(observation?.updatedAt);
  if (!available || time == null) return observation?.loading ? 'loading' : 'unknown';
  return now - time >= CITY_FRESH_MS || time - now > 5_000 ? 'stale' : 'fresh';
}
export function recentWork(value, now = Date.now()) {
  const time = cityTimestamp(value);
  return time != null && time <= now + 5_000 && now - time < CITY_FRESH_MS;
}
export const cityNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const sum = value => {
  const values = Object.values(value || {}).map(cityNumber).filter(item => item != null);
  return values.length ? values.reduce((total, item) => total + item, 0) : null;
};
const metric = (label, value, unit = '') => ({ label, value: cityNumber(value), unit });
const textMetric = (label, value) => ({ label, value: typeof value === 'string' && value ? value.slice(0, 120) : null, text: true });
const timeMetric = (label, value) => ({ label, value: cityTimestamp(value), time: true });
const boolMetric = (label, value) => textMetric(label, typeof value === 'boolean' ? value ? 'Yes' : 'No' : null);
const degraded = value => ['degraded', 'error', 'critical', 'warn', 'warning', 'emergency'].includes(value);

export function agentDistrict(agent, workers = []) {
  const id = agent.id;
  if (workers.some(worker => worker.id === id)) return 'sources';
  if (id === 'equalizer') return 'equalizer';
  if (['filter', 'filter_agent'].includes(id)) return 'filter';
  if (['sort_agent', 'sort_distrib', 'sort_optimizer', 'mix_optimizer'].includes(id)) return 'sort';
  if (['topic_audit', 'topic_fix', 'topic_filter'].includes(id)) return 'topics';
  if (['data', 'web_storage'].includes(id)) return 'database';
  if (['feed', 'cache_helper', 'web_cache'].includes(id)) return 'feed';
  if (id === 'security') return 'security';
  if (['refresh_queue', 'optimizer'].includes(id)) return 'sources';
  if (agent.executionRole === 'pipeline' && agent.health?.fetchCount != null) return 'sources';
  return 'runtime';
}

export function buildCityModel({ status, pipelineStatus, agents = {}, log = [], telemetry = {}, now = Date.now() } = {}) {
  // Explicit role mismatches are not usable snapshots of the requested process.
  // Old deployments that omit serviceRole remain readable without invented roles.
  const apiPayload = status?.server?.serviceRole === 'pipeline' ? null : status;
  const pipelinePayload = pipelineStatus?.server?.serviceRole === 'api' ? null : pipelineStatus;
  const api = apiPayload || {}, pipeline = pipelinePayload || {};
  const apiObservation = { ...telemetry.api, error: telemetry.api?.error || (status && !apiPayload ? 'The API address returned pipeline process telemetry' : '') };
  const pipelineObservation = { ...telemetry.pipeline, error: telemetry.pipeline?.error || (pipelineStatus && !pipelinePayload ? 'The pipeline address returned API process telemetry' : '') };
  const observations = {
    api: { ...apiObservation, state: observationState(apiObservation, now, Boolean(apiPayload)) },
    pipeline: { ...pipelineObservation, state: observationState(pipelineObservation, now, Boolean(pipelinePayload)) },
  };
  const workers = Array.isArray(pipeline.sources?.workers) ? pipeline.sources.workers : [];
  const seen = new Set();
  const roster = Object.values(agents || {}).flatMap(agent => {
    if (!agent || typeof agent !== 'object') return [];
    return agent.instances ? Object.values(agent.instances) : [agent];
  }).filter(agent => {
    if (!agent || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(agent.id || '')) return false;
    const key = `${agent.serviceRole || 'unknown'}:${agent.id}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).map(agent => {
    const role = ['api', 'pipeline'].includes(agent.serviceRole) ? agent.serviceRole : 'unknown';
    const observed = telemetry.agents?.byService?.[role] || telemetry.agents || {};
    const state = observationState({ ...observed, updatedAt: agent.receivedAt || observed.updatedAt }, now);
    return { ...agent, key: `${role}:${agent.id}`, serviceRole: role, observation: state,
      district: agentDistrict(agent, workers), name: String(agent.name || agent.id).slice(0, 100) };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.serviceRole.localeCompare(b.serviceRole));
  const equalizer = pipeline.equalizer || {}, filter = pipeline.filterAgent || {}, sort = pipeline.sortAgent || {};
  const stage = api.staging || {}, db = api.dbSize || {}, topics = api.topicFilterAgent || {}, backup = api.server?.dbBackupStatus || {};
  const securityAgent = roster.find(agent => agent.id === 'security' && agent.serviceRole === 'api');
  const details = {
    sources: { present: Boolean(pipeline.sources), health: pipeline.sources?.degraded > 0 ? 'degraded' : 'observed',
      active: workers.some(worker => !worker.paused && !degraded(worker.status) && recentWork(worker.lastSuccess, now)),
      metrics: [metric('Registered sources', pipeline.sources?.total), metric('Healthy sources', pipeline.sources?.healthy), metric('Degraded sources', pipeline.sources?.degraded), metric('Paused sources', pipeline.sources?.paused), metric('Sources starting', pipeline.sources?.starting), metric('Refresh queue pending', pipeline.refreshQueue?.pending)],
      breakdown: workers.map(worker => ({ label: worker.name || worker.id, value: worker.status || 'Not reported', detail: cityNumber(worker.postCount) == null ? 'Post count not reported' : `${worker.postCount.toLocaleString()} reported posts` })) },
    equalizer: { present: Boolean(pipeline.equalizer), active: equalizer.persistenceInFlight === true || (recentWork(equalizer.lastRun, now) && (sum(equalizer.lastDrainedBySource) > 0 || sum(equalizer.lastAcceptedBySource) > 0)),
      metrics: [metric('Buffered now', equalizer.pendingTotal), metric('Persistence queue', equalizer.persistencePendingTotal), metric('Accepted total', equalizer.totalAccepted), metric('Drained total', equalizer.totalDrained), metric('Backpressure drops', equalizer.totalBackpressureDropped), timeMetric('Last run', equalizer.lastRun), metric('Last duration', equalizer.lastDurationMs, 'ms')],
      breakdown: Object.entries(equalizer.bufferedBySource || {}).map(([label, value]) => ({ label, value: cityNumber(value), detail: 'buffered posts' })) },
    filter: { present: Boolean(pipeline.filterAgent), error: Boolean(filter.lastError), health: filter.status, active: recentWork(filter.lastRun, now) && filter.lastInput > 0,
      metrics: [metric('Last input', filter.lastInput), metric('Last output', filter.lastOutput), metric('Invalid removed', filter.lastDroppedInvalid), metric('Duplicates removed', filter.lastDroppedDuplicate), metric('Screened out', filter.lastDroppedScreened), metric('Total runs', filter.totalRuns), timeMetric('Last run', filter.lastRun), metric('Last duration', filter.lastDurationMs, 'ms')] },
    sort: { present: Boolean(pipeline.sortAgent), error: Boolean(sort.lastError), health: sort.status, active: recentWork(sort.lastRun, now) && sort.lastInput > 0,
      metrics: [metric('Last input', sort.lastInput), metric('Last output', sort.lastOutput), metric('Last dropped', sort.lastDropped), metric('Total runs', sort.totalRuns), metric('Last duration', sort.lastDurationMs, 'ms'), timeMetric('Last run', sort.lastRun)] },
    staging: { present: Boolean(api.staging), error: Boolean(stage.lastError), active: stage.inFlight === true,
      metrics: [metric('Waiting for promotion', stage.pendingCount), timeMetric('Oldest fetched row', stage.oldestFetchedAt), timeMetric('Newest fetched row', stage.newestFetchedAt), timeMetric('Queue checked', stage.lastCheckedAt), metric('Batch size limit', stage.transferProcess?.batchSize)],
      breakdown: Object.entries(stage.bySource || {}).map(([label, value]) => ({ label, value: cityNumber(value), detail: 'staged posts' })) },
    transfer: { present: Boolean(api.staging), error: Boolean(stage.lastError), active: stage.inFlight === true || (recentWork(stage.lastRun, now) && stage.lastSavedCount > 0),
      metrics: [boolMetric('Transfer in flight', stage.inFlight), metric('Current batch', stage.currentBatch), metric('Current batch size', stage.currentBatchSize), metric('Last saved', stage.lastSavedCount), metric('Last staging rows cleared', stage.lastDeletedCount), metric('Total transferred', stage.totalTransferred), metric('Last duration', stage.lastDurationMs, 'ms'), timeMetric('Last run', stage.lastRun)],
      history: Array.isArray(stage.recentRuns) ? stage.recentRuns.slice(0, 8).map(run => ({ ts: run.finishedAt || run.startedAt, msg: `${run.status || 'Reported'} · ${run.reason || 'Transfer run'} · ${cityNumber(run.movedCount) == null ? 'count not reported' : `${run.movedCount.toLocaleString()} moved`}` })) : [] },
    database: { present: Boolean(api.server), error: api.server?.db === 'fallback', health: db.status, active: false,
      metrics: [textMetric('Primary connection', api.server?.db), metric('Live storage rows', stage.liveCachePostCount), metric('Database size', db.mb, 'MB'), metric('Capacity used', db.usedPct, '%'), metric('Configured limit', db.limitMb, 'MB'), boolMetric('Read failover active', api.server?.dbReadFailoverActive), timeMetric('Size checked', db.lastCheckedAt)] },
    topics: { present: Boolean(api.topicFilterAgent), error: Boolean(topics.lastError), health: topics.status, active: recentWork(topics.lastRun, now) && topics.lastInput > 0,
      metrics: [metric('Last input', topics.lastInput), metric('Last output', topics.lastOutput), metric('Last filtered out', topics.lastDropped), metric('Total requests', topics.totalRuns), metric('Last duration', topics.lastDurationMs, 'ms'), timeMetric('Last run', topics.lastRun)] },
    feed: { present: Boolean(api.feed), active: false,
      metrics: [metric('Posts in memory', api.feed?.postCount), metric('Feed stream connections', api.feed?.sseClients), metric('Tracked post IDs', api.feed?.seenIds), timeMetric('Cache refreshed', api.feed?.refreshedAt), timeMetric('Newest stored fetch', api.feedStorage?.cache?.newestFetchedAt)],
      breakdown: (Array.isArray(api.feed?.composition) ? api.feed.composition : []).map(item => ({ label: item.source, value: cityNumber(item.count), detail: 'cached posts' })) },
    backup: { present: Boolean(api.server?.dbBackupStatus), error: Boolean(backup.lastError) || backup.enabled === true && backup.connected === false, health: backup.enabled === false ? 'disabled' : backup.capacityStatus,
      active: backup.syncing === true,
      metrics: [boolMetric('Configured', backup.enabled), boolMetric('Connected', backup.connected ?? api.server?.dbBackup), textMetric('Latest recovery result', backup.lastError ? 'Last attempt failed' : backup.lastSyncAt ? 'Successful sync recorded' : api.server?.dbBackupStatus ? 'No successful sync reported' : null), boolMetric('Sync in progress', backup.syncing), metric('Snapshot rows', backup.rowCount), metric('Retention', backup.retentionDays, 'days'), metric('Maximum rows', backup.maxRows), timeMetric('Last attempted sync', backup.lastAttemptAt), timeMetric('Last successful sync', backup.lastSyncAt), timeMetric('Next sync', backup.nextSyncAt)] },
    security: { present: Boolean(securityAgent), health: securityAgent?.health?.status, active: false,
      metrics: [textMetric('Reported agent state', securityAgent?.health?.status), timeMetric('Last reported activity', securityAgent?.lastAction?.ts), metric('API recorded crash events', api.stability?.crashEvents), metric('API unhandled rejections', api.stability?.unhandledRejections)],
      history: Array.isArray(securityAgent?.logs) ? securityAgent.logs.slice(0, 6) : [] },
    runtime: { present: Boolean(pipeline.stability), health: pipeline.stability?.mode, active: false,
      metrics: [textMetric('Pipeline stability mode', pipeline.stability?.mode), metric('Pipeline heap used', pipeline.stability?.heapUsedMB, 'MB'), metric('Pipeline RSS', pipeline.stability?.rssMB, 'MB'), metric('Pipeline event-loop lag', pipeline.stability?.eventLoopLagMs, 'ms'), metric('Pipeline skipped fetches', pipeline.stability?.skippedFetches), metric('Pipeline uptime', pipeline.server?.uptime, 'ms'),
        ...(observations.api.state === 'fresh' ? [textMetric('API stability mode', api.stability?.mode), metric('API heap used', api.stability?.heapUsedMB, 'MB'), metric('API event-loop lag', api.stability?.eventLoopLagMs, 'ms')] : [textMetric('API observation', observations.api.state)])] },
  };
  const districts = CITY_DISTRICTS.map(def => {
    const detail = details[def.id];
    const freshness = def.id === 'security' && securityAgent?.observation !== 'fresh' && securityAgent?.observation
      ? securityAgent.observation : observations[def.role].state;
    const health = !detail.present ? 'unknown' : detail.error || degraded(detail.health) ? 'degraded' : detail.health === 'paused' || detail.health === 'disabled' ? detail.health : 'observed';
    const state = freshness !== 'fresh' ? freshness : health;
    return { ...def, ...detail, health, state, observation: observations[def.role],
      active: freshness === 'fresh' && detail.present && !detail.error && !['degraded', 'paused', 'disabled'].includes(health) && Boolean(detail.active),
      agents: roster.filter(agent => agent.district === def.id),
      history: detail.history || [], breakdown: detail.breakdown || [] };
  });
  const byId = Object.fromEntries(districts.map(district => [district.id, district]));
  const edges = [['sources', 'equalizer'], ['equalizer', 'filter'], ['filter', 'sort'], ['sort', 'staging'], ['staging', 'transfer'], ['transfer', 'database'], ['database', 'topics'], ['topics', 'feed'], ['database', 'backup']].map(([from, to]) => ({ from, to,
    active: observations[byId[from].role].state === 'fresh' && observations[byId[to].role].state === 'fresh'
      && (from === 'database' ? byId[to].active : byId[from].active) && byId[to].present && !['degraded', 'paused', 'disabled'].includes(byId[to].health)
      && (from !== 'filter' || filter.lastOutput > 0) && (from !== 'sort' || sort.lastOutput > 0) && (from !== 'topics' || topics.lastOutput > 0) }));
  return { districts, byId, edges, agents: roster, observations,
    streamConnected: telemetry.streamConnected === true,
    log: Array.isArray(log) ? log.slice(0, 20) : [], now };
}
