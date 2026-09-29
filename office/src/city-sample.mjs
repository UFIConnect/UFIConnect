// Sample observations for reviewing the Live City map without the Office
// services: the local website preview's Maps page draws the city from these.
// The agents are the 71 registered agents (names, badges and colours as the
// API registers them); their states, counts and times are illustrative only.
const SOURCE_AGENTS = [
  ['reddit', 'Reddit Agent', 'RD', '#FF6347'], ['hn', 'HackerNews Agent', 'HN', '#FF6600'],
  ['github', 'GitHub Agent', 'GH', '#94A3B8'], ['devto', 'DEV.to Agent', 'DEV', '#8B5CF6'],
  ['medium', 'Medium Agent', 'MED', '#10B981'], ['youtube', 'YouTube Agent', 'YT', '#EF4444'],
  ['stackoverflow', 'StackOverflow Agent', 'SO', '#F59E0B'], ['mastodon', 'Mastodon Agent', 'MAS', '#6366F1'],
  ['lobsters', 'Lobsters Agent', 'LOB', '#DC2626'], ['arxiv', 'arXiv Agent', 'ARX', '#3B82F6'],
  ['indeed', 'Indeed Agent', 'JOB', '#2557A7'], ['producthunt', 'Product Hunt Agent', 'PH', '#DA552F'],
  ['techcrunch', 'TechCrunch Agent', 'TC', '#0D9F3F'], ['theverge', 'The Verge Agent', 'TV', '#FF3333'],
  ['indiehackers', 'Indie Hackers Agent', 'IH', '#0E2150'], ['hashnode', 'freeCodeCamp Agent', 'FCC', '#006400'],
  ['bluesky', 'Bluesky Agent', 'BS', '#0085FF'], ['arstechnica', 'Ars Technica Agent', 'ARS', '#FF6600'],
  ['wired', 'WIRED Agent', 'WI', '#111111'], ['theregister', 'The Register Agent', 'REG', '#CC0000'],
  ['venturebeat', 'VentureBeat Agent', 'VB', '#1E6FBF'], ['smashing', 'Smashing Magazine Agent', 'SM', '#E9620A'],
  ['phoronix', 'Phoronix Agent', 'PHX', '#2B7BB9'], ['infoq', 'InfoQ Agent', 'IQ', '#67B346'],
  ['mittr', 'MIT Tech Review Agent', 'MIT', '#A31F34'], ['gitlab', 'GitLab Agent', 'GL', '#FC6D26'],
  ['remoteok', 'Remote OK Agent', 'RO', '#10B981'], ['yc', 'Y Combinator Agent', 'YC', '#FF6600'],
  ['crunchbase', 'Crunchbase News Agent', 'CB', '#146AFF'], ['behance', 'Behance Agent', 'BE', '#053EFF'],
  ['designweb', 'Design Web Agent', 'UX', '#DB2777'], ['usajobs', 'USAJobs Agent', 'USA', '#005EA8'],
  ['remotive', 'Remotive Agent', 'REM', '#00A876'], ['muse', 'The Muse Agent', 'MUSE', '#8A2BE2'],
  ['linkedin', 'LinkedIn Agent', 'IN', '#0A66C2'], ['twitter', 'Twitter/X Agent', 'X', '#1DA1F2'],
  ['instagram', 'Instagram Agent', 'IG', '#E1306C'], ['facebook', 'Facebook Agent', 'FB', '#1877F2'],
];
const PIPELINE_AGENTS = [
  ['optimizer', 'Feed Optimizer', 'OPT', '#F59E0B'], ['refresh_queue', 'Refresh Queue Agent', 'RQ', '#38BDF8'],
  ['equalizer', 'Equalizer', 'EQ', '#38BDF8'], ['filter', 'Ingestion Filter', 'FLT', '#4ADE80'],
];
const API_AGENTS = [
  ['topic_filter', 'Topic Filter', 'TOP', '#22D3EE'], ['topic_audit', 'Topic Audit', 'TOP', '#A78BFA'],
  ['topic_fix', 'Topic Correction', 'FIX', '#818CF8'], ['feed', 'Feed Cache Agent', 'FEED', '#60A5FA'],
  ['web_optimizer', 'Website Optimizer', 'WEB', '#14B8A6'], ['web_perf', 'Web Performance Sub-Agent', 'PERF', '#FBBF24'],
  ['web_seo', 'Web SEO Sub-Agent', 'SEO', '#34D399'], ['web_cache', 'Web Cache Sub-Agent', 'CACHE', '#6366F1'],
  ['web_storage', 'Fast Storage Sub-Agent', 'STORE', '#FB7185'], ['web_api', 'API Optimizer Sub-Agent', 'API', '#0EA5E9'],
  ['web_pipeline', 'Pipeline Optimizer Sub-Agent', 'PIPE', '#22C55E'], ['web_office', 'Office Optimizer Sub-Agent', 'OFF', '#A855F7'],
  ['web_pwa', 'PWA/App Optimizer Sub-Agent', 'PWA', '#06B6D4'], ['security', 'Security Agent', 'SEC', '#4ADE80'],
  ['perf', 'Performance Agent', 'PERF', '#FBBF24'], ['community', 'Community Agent', 'COM', '#A78BFA'],
  ['seo', 'SEO Agent', 'SEO', '#34D399'], ['opps', 'Opportunities Agent', 'JOBS', '#F97316'],
  ['deploy', 'Deploy Agent', 'DEP', '#38BDF8'], ['data', 'Data Agent', 'DATA', '#FB7185'],
  ['sort_agent', 'Sort Agent', 'SORT', '#A78BFA'], ['activity', 'Activity Agent', 'ACT', '#22D3EE'],
  ['stability', 'Stability Guard', 'STAB', '#22C55E'], ['crash_guard', 'Crash Guard', 'CG', '#F87171'],
  ['cache_helper', 'Cache Merge Agent', 'MERGE', '#6366F1'], ['sort_distrib', 'Distribution Agent', 'DIST', '#818CF8'],
  ['mix_optimizer', 'Mix Optimizer Agent', 'MIX', '#22D3EE'], ['sort_optimizer', 'Sort Optimizer Agent', 'RANK', '#A78BFA'],
  ['autofix', 'Autofix Agent', 'FIX', '#F472B6'],
];
export const SAMPLE_CITY_AGENTS = Object.freeze([
  ...SOURCE_AGENTS.map(agent => [...agent, 'pipeline', true]),
  ...PIPELINE_AGENTS.map(agent => [...agent, 'pipeline', false]),
  ...API_AGENTS.map(agent => [...agent, 'api', false]),
]);
// A few homes in each light state, so every legend entry appears on the map.
const PAUSED = new Set(['instagram', 'facebook', 'linkedin', 'usajobs']);
const NEEDS_ATTENTION = new Set(['web_pwa', 'seo']);
const UNOBSERVED = new Set(['autofix']);

export function sampleCityObservations(now = Date.now()) {
  const at = offset => new Date(now - offset).toISOString();
  const recent = at(4_000);
  const agents = Object.fromEntries(SAMPLE_CITY_AGENTS.map(([id, name, emoji, color, serviceRole, source], index) => {
    const status = PAUSED.has(id) ? 'paused' : NEEDS_ATTENTION.has(id) ? 'degraded' : 'healthy';
    const working = status === 'healthy';
    return [id, { id, name, emoji, color, serviceRole, executionRole: serviceRole, receivedAt: recent,
      ownerAvailable: !UNOBSERVED.has(id), description: 'Sample agent for the local map preview.',
      ...(source ? { postCount: 120 + index * 9, lastFetch: working ? recent : at(900_000) } : {}),
      health: { status, lastSuccess: working ? recent : at(900_000), lastAttempt: recent, consecutiveErrors: status === 'degraded' ? 3 : 0,
        totalErrors: status === 'degraded' ? 7 : 0, paused: status === 'paused', ...(source ? { fetchCount: 40 + index } : {}) },
      lastAction: { agentId: id, ts: recent, msg: 'Sample activity' }, logs: [] }];
  }));
  const workers = SOURCE_AGENTS.map(([id, name], index) => ({ id, name,
    status: PAUSED.has(id) ? 'paused' : NEEDS_ATTENTION.has(id) ? 'degraded' : 'healthy',
    paused: PAUSED.has(id), lastSuccess: PAUSED.has(id) ? at(900_000) : recent, postCount: 120 + index * 9 }));
  const server = serviceRole => ({ serviceRole, uptime: 3_600_000, db: 'connected', dbBackup: true,
    dbBackupStatus: { enabled: true, configured: true, connected: true, syncing: true, lastSyncAt: at(60_000), lastAttemptAt: at(60_000), lastError: null, rowCount: 4000 },
    managedRecovery: { configured: true, status: 'available', checkedAt: recent, issues: [], feedReplica: { configured: true, state: 'available' },
      primary: { state: 'available', recovery: { status: 'available', startsAt: at(86_400_000) }, exportsChecked: true, latestExport: { createdAt: at(3_600_000), available: true } } } });
  const status = {
    server: server('api'),
    feed: { postCount: 4000, sseClients: 3, refreshedAt: recent },
    staging: { pendingCount: 37, inFlight: true, lastRun: recent, lastSavedCount: 17, totalTransferred: 1234, lastError: null },
    topicFilterAgent: { status: 'healthy', lastRun: recent, totalRuns: 20, lastInput: 17, lastOutput: 12 },
    dbSize: { mb: 120, limitMb: 5120, status: 'ok', usedPct: 2 },
    stability: { mode: 'normal', heapUsedMB: 180, eventLoopLagMs: 12 },
  };
  const pipelineStatus = {
    server: server('pipeline'),
    sources: { total: workers.length, healthy: workers.filter(worker => worker.status === 'healthy').length,
      degraded: workers.filter(worker => worker.status === 'degraded').length, paused: PAUSED.size, starting: 0, workers },
    refreshQueue: { running: true, pending: 5 },
    equalizer: { pendingTotal: 12, lastRun: recent, lastDrainedBySource: { reddit: 6, hn: 4, youtube: 3 }, totalRuns: 7, totalDrained: 180, totalAccepted: 160 },
    filterAgent: { status: 'running', lastRun: recent, lastInput: 19, lastOutput: 17 },
    sortAgent: { status: 'running', lastRun: recent, lastInput: 17, lastOutput: 16 },
    stability: { mode: 'normal', heapUsedMB: 210, rssMB: 320, eventLoopLagMs: 9 },
  };
  const observed = { updatedAt: at(2_000) };
  return { status, pipelineStatus, agents, telemetry: { api: observed, pipeline: observed, agents: observed, streamConnected: false } };
}
