'use strict';

const https = require('node:https');

// This assistant can explain observations. It has no tools, database handle,
// command runner, deployment hook, or access to raw logs/customer records.
const INSTRUCTIONS = 'You explain UFIConnect service observations to its operator. '
  + 'Use only the supplied snapshot and topic codes. Explain the selected agent and local process ownership. '
  + 'Do not invent measurements, successful work, causes, fixes, or access to other processes. '
  + 'A heartbeat or sample timestamp is not evidence of completed work. Missing or unknown means unobserved. '
  + 'You are read-only and cannot execute commands or change the service. Never claim to have done so. '
  + 'Answer the current topic concisely in plain text, using prior topic codes only to understand follow-ups. '
  + 'Suggest checks an operator can make; do not output scripts, commands, URLs, credentials, or personal data.';

const STATUS = new Set(['unknown', 'unavailable', 'idle', 'running', 'healthy', 'degraded', 'paused', 'disabled', 'armed', 'contained', 'normal', 'pressure', 'critical', 'ready', 'error', 'warning', 'ok']);
const NUMBERS = ['postCount', 'fetchCount', 'consecutiveErrors', 'totalErrors', 'skippedForStability',
  'totalRuns', 'totalItems', 'lastInput', 'lastOutput', 'lastDropped', 'lastDurationMs', 'pending',
  'heapUsedMB', 'heapLimitMB', 'rssMB', 'eventLoopLagMs', 'multiplier', 'skippedFetches', 'trimCount',
  'crashEvents', 'unhandledRejections', 'lastEmptySources', 'lastTriggered', 'lastDiversified',
  'lastCheckedPools', 'lastTotalPosts', 'lastIssues', 'lastSampleSize', 'lastScoreSpread', 'lastVariance',
  'lastRankedNewestOverlap', 'totalSweeps', 'lastCount', 'totalAttempts', 'totalDeploys', 'totalReverts',
  'lastStatus', 'lastTtfbMs', 'lastTotalMs', 'lastBytes', 'sourceCaches', 'totalBuffered', 'totalDrained', 'totalAccepted',
  'totalQueueDuplicates', 'totalBackpressureDropped', 'totalInput', 'totalOutput', 'lastDroppedInvalid',
  'lastDroppedDuplicate', 'lastDroppedScreened', 'totalDroppedScreened', 'totalChecked', 'totalMismatches',
  'lastChecked', 'lastMismatches', 'totalFixed', 'lastFixed'];
const TIMES = ['lastSuccess', 'lastAttempt', 'lastFetch', 'lastRun', 'lastStarted', 'lastFinished', 'lastSweep'];
const PURPOSES = Object.freeze({
  stability: 'Observes this process memory and event-loop lag and applies refresh throttling.',
  crash_guard: 'Records runtime exceptions and rejection counters for this process.',
  refresh_queue: 'Coordinates pending source refresh work on the pipeline service.',
  feed: 'Keeps this process feed cache available to the feed serving path.',
  sort_agent: 'Deduplicates and sorts cached feed items.',
  sort_distrib: 'Checks source supply and feed distribution.',
  mix_optimizer: 'Checks the diversity and freshness of cached feed pools.',
  sort_optimizer: 'Checks rank-score spread and ranking order in a feed sample.',
  activity: 'Refreshes registry heartbeats. These are not successful fetches or completed jobs.',
  autofix: 'Observes the separately configured autofix workflow. Chat cannot run or enable it.',
  perf: 'Reports process memory, event-loop lag, and cache inventory. It does not run Lighthouse.',
  community: 'Reports local community inventory. It does not measure sentiment or perform moderation.',
  seo: 'Reports feed inventory. It does not measure browser Web Vitals or certify indexing.',
  opps: 'Reports cached job inventory. It does not verify whether positions remain open.',
  security: 'Summarizes authentication configuration and runtime counters. It is not a vulnerability scanner.',
  data: 'Observes database connectivity and local cache inventory.',
  deploy: 'Checks service reachability. Chat cannot deploy anything.',
  optimizer: 'Monitors source worker freshness and retry state.',
  cache_helper: 'Merges per-source cached posts into the global feed cache.',
  equalizer: 'Interleaves bounded source queues on the pipeline before screening. Counts describe queued, drained and accepted posts.',
  filter: 'Records aggregate ingestion screening and deduplication counts for this process.',
  topic_filter: 'Filters feed candidates by requested topics. Only aggregate counts are included, not member preferences or topics.',
  topic_audit: 'Checks sampled cached posts for topic mismatches and queues corrections. Counts do not certify every post.',
  topic_fix: 'Applies queued topic corrections to local caches and attempts database updates. Fixed counts measure local corrections, not verified database writes.',
});

function iso(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() > 0 ? date.toISOString() : null;
}

function sanitizeSnapshot(input) {
  if (!input || !/^[a-z][a-z0-9_]{0,40}$/.test(input.agentId || '')) return null;
  const serviceRole = input.serviceRole === 'pipeline' ? 'pipeline' : 'api';
  const executionRole = ['api', 'pipeline', 'both', 'on-demand'].includes(input.executionRole) ? input.executionRole : 'both';
  const diagnosticCapability = ['source-worker', 'runtime-metrics', 'summary-only', 'on-demand'].includes(input.diagnosticCapability)
    ? input.diagnosticCapability : 'summary-only';
  const metrics = {};
  for (const key of NUMBERS) {
    const n = input.metrics?.[key];
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER) metrics[key] = Math.round(n * 1000) / 1000;
  }
  for (const key of TIMES) { const value = iso(input.metrics?.[key]); if (value) metrics[key] = value; }
  for (const key of ['paused', 'enabled', 'databaseConnected', 'backupConnected']) {
    if (typeof input.metrics?.[key] === 'boolean') metrics[key] = input.metrics[key];
  }
  return {
    agentId: input.agentId, serviceRole, executionRole, diagnosticCapability,
    observedAt: iso(input.observedAt) || new Date().toISOString(),
    status: STATUS.has(input.status) ? input.status : 'unknown',
    cadence: typeof input.cadence === 'string' && /^[\da-z /+.,-]{1,60}$/i.test(input.cadence) ? input.cadence : null,
    purpose: diagnosticCapability === 'source-worker' ? 'Fetches public source content on the pipeline service and stages it for transfer to the API feed.'
      : diagnosticCapability === 'on-demand' ? 'Provides connected-account content on demand. A registry heartbeat does not verify connection or fetch success.'
        : PURPOSES[input.agentId] || (input.agentId.startsWith('web_') ? 'Observes the configured website or service checks. Only the listed measurements are available.' : 'Reports local operational observations.'),
    metrics,
  };
}

function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['message', 'history'].includes(k))) return { status: 400, error: 'Send a message and an optional conversation history.' };
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 8000) return { status: 413, error: 'Conversation is too large. Clear older messages and try again.' };
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 1200) return { status: 400, error: 'Message must contain 1 to 1200 characters.' };
  const history = body.history ?? [];
  if (!Array.isArray(history) || history.length > 8 || history.some(item => !item || typeof item !== 'object' || Array.isArray(item)
    || Object.keys(item).some(k => !['role', 'content'].includes(k)) || !['user', 'assistant'].includes(item.role)
    || typeof item.content !== 'string' || !item.content.trim() || item.content.length > 1200)) return { status: 400, error: 'History may contain up to 8 user or assistant messages, each at most 1200 characters.' };
  return { message: body.message.trim(), history };
}

// Only these fixed topic labels may cross the provider boundary. In particular,
// names, pasted secrets, prompt injection and earlier assistant replies cannot.
function topicFor(text) {
  if (/\b(restart|deploy|delete|remove|execute|trigger|pause|resume|disable|enable|change|fix)\b/i.test(text)
    && /^(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:restart|deploy|delete|remove|execute|trigger|pause|resume|disable|enable|change|fix)\b/i.test(text)) return 'action_request';
  if (/\b(error|fail|broken|stuck|problem|degraded|paused)\b/i.test(text)) return 'errors';
  if (/\b(speed|slow|latency|performance|memory|heap|lag|bottleneck)\b/i.test(text)) return 'performance';
  if (/\b(cadence|often|interval|schedule|frequency|refresh)\b/i.test(text)) return 'cadence';
  if (/\b(pipeline|dependenc\w*|transfer|stage|flow|database|db|cache)\b/i.test(text)) return 'dependencies';
  if (/\b(next|check|recommend|investigate|help|why)\b/i.test(text)) return 'next_steps';
  if (/\b(purpose|responsib\w*|role|what.*do|who.*you|explain|work)\b/i.test(text)) return 'purpose';
  if (/\b(status|health|state|count|fetch|latest|last|hello|hi|doing|ready)\b/i.test(text)) return 'status';
  if (/\b(more|that|it|detail|continue|and|yes)\b/i.test(text)) return 'follow_up';
  return 'unsupported';
}

function conversationTopics(message, history) {
  const previousTopics = history.filter(item => item.role === 'user').map(item => topicFor(item.content))
    .filter(topic => !['unsupported', 'action_request', 'follow_up'].includes(topic)).slice(-4);
  const requested = topicFor(message);
  return { topic: requested === 'follow_up' ? previousTopics.at(-1) || 'status' : requested, previousTopics };
}

function diagnostics(snapshot, topic, reason) {
  const prefix = reason === 'unconfigured' ? 'AI conversation is not configured; this is a local diagnostics summary. '
    : reason === 'unavailable' ? 'AI conversation is temporarily unavailable; this is a local diagnostics summary. ' : 'Local diagnostics: ';
  const ownership = `The ${snapshot.agentId} observation comes from the ${snapshot.serviceRole} service. `
    + (snapshot.executionRole === 'pipeline' ? 'This worker runs on the pipeline service. ' : snapshot.executionRole === 'on-demand' ? 'This integration runs on demand. ' : 'Counters describe this service process only. ');
  let detail;
  if (topic === 'action_request') detail = 'Chat is read-only. No command was executed and no setting was changed. Use the separate authorized Office controls for operational actions.';
  else if (topic === 'unsupported') detail = 'I can explain this agent’s status, purpose, cadence, errors, performance, dependencies, and next checks. Your message is not sent to the AI provider.';
  else if (topic === 'purpose') detail = snapshot.purpose;
  else if (topic === 'cadence') detail = snapshot.cadence ? `Configured cadence: ${snapshot.cadence}. This describes scheduling, not proof that a fetch completed.` : 'No scheduling measurement is available for this observation.';
  else if (topic === 'dependencies') detail = 'Public source workers fetch into pipeline staging; API transfer reads staged posts into the feed cache. This snapshot cannot prove that a separate service or database is synchronized.';
  else if (topic === 'performance') {
    const measured = ['heapUsedMB', 'rssMB', 'eventLoopLagMs', 'lastDurationMs', 'lastTtfbMs'].filter(key => key in snapshot.metrics);
    detail = measured.length ? `Measured values: ${measured.map(key => `${key}: ${snapshot.metrics[key]}`).join(', ')}.` : 'No measured performance values are available for this agent. Browser Web Vitals and Lighthouse scores are not inferred.';
  } else if (topic === 'errors') detail = 'consecutiveErrors' in snapshot.metrics
    ? `Recorded consecutive errors: ${snapshot.metrics.consecutiveErrors}; total errors: ${snapshot.metrics.totalErrors ?? 'unavailable'}. Raw error text is excluded. Check the owning service’s protected logs for the cause.`
    : 'No structured error counter is available for this agent. A missing counter does not establish that there are no errors.';
  else if (topic === 'next_steps') detail = 'Compare the owning service’s last successful work with its configured cadence, then inspect its protected error logs if stale. Verify pipeline staging and API transfer separately. This chat makes no changes.';
  else detail = `Observed status: ${snapshot.status}. ` + (snapshot.metrics.lastSuccess ? `Last successful work: ${snapshot.metrics.lastSuccess}. ` : 'No verified successful-work timestamp is available. ')
    + ('postCount' in snapshot.metrics ? `Local cached posts: ${snapshot.metrics.postCount}. ` : '') + 'Sample times and registry heartbeats do not prove work completed.';
  return prefix + ownership + detail;
}

function requestAnswer({ apiKey, model, snapshot, topics, signal, timeoutMs = 15000, request = https.request }) {
  const payload = JSON.stringify({ model, instructions: INSTRUCTIONS, input: JSON.stringify({ snapshot, ...topics }), store: false, tools: [], max_output_tokens: 1200,
    ...(/^gpt-5(?:-mini|-nano)?(?:-\d{4}-\d{2}-\d{2})?$/.test(model) ? { reasoning: { effort: 'minimal' }, text: { verbosity: 'low' } } : {}),
  });
  return new Promise((resolve, reject) => {
    let done = false;
    let timer;
    let req;
    const finish = (error, answer) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(new Error('AI response unavailable.')); else resolve(answer);
    };
    const stop = () => { finish(true); req?.destroy(); };
    const onAbort = () => stop();
    if (signal?.aborted) return finish(true);
    try {
      req = request('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, response => {
        if (response.statusCode !== 200) { response.destroy(); return stop(); }
        const chunks = []; let bytes = 0;
        response.on('data', chunk => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > 65536) { response.destroy(); stop(); } else chunks.push(Buffer.from(chunk));
        });
        response.on('error', () => stop());
        response.on('end', () => {
          if (done) return;
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (data.status && data.status !== 'completed') return finish(true);
            const answer = (data.output_text || (Array.isArray(data.output) ? data.output : [])
              .flatMap(item => Array.isArray(item.content) ? item.content : []).filter(item => item.type === 'output_text').map(item => item.text).join('\n')).trim();
            if (!answer || answer.length > 4000 || /https?:\/\/|\bBearer\s|\bsk-[a-zA-Z0-9_-]+|-----BEGIN|[\w.+-]+@[\w.-]+\.[a-z]{2,}|```|\b(?:password|secret|token|api[_ -]?key)\s*[:=]\s*\S+/i.test(answer)) return finish(true);
            finish(false, answer);
          } catch { finish(true); }
        });
      });
      req.on('error', () => finish(true));
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(stop, timeoutMs);
      timer.unref?.();
      req.end(payload);
    } catch { finish(true); }
  });
}

function createOfficeAgentChat({ getAgentSnapshot, apiKey = '', model = 'gpt-5-mini', request, timeoutMs, now = Date.now }) {
  const key = String(apiKey).trim();
  const selectedModel = /^[a-zA-Z0-9_.:-]{1,80}$/.test(model) ? model : 'gpt-5-mini';
  let inFlight = 0, windowStarted = now(), requests = 0;
  return async function officeAgentChat(req, res) {
    const validated = validateBody(req.body);
    if (validated.error) return res.status(validated.status).json({ error: validated.error });
    let snapshot;
    try { snapshot = sanitizeSnapshot(getAgentSnapshot(req.params.id)); }
    catch { return res.status(503).json({ error: 'Agent observation is temporarily unavailable.' }); }
    if (!snapshot) return res.status(404).json({ error: 'Unknown agent.' });
    if (now() - windowStarted >= 60000) { windowStarted = now(); requests = 0; }
    if (++requests > 40 || inFlight >= 2) return res.status(429).set('Retry-After', '60').json({ error: 'Agent chat is busy. Try again shortly.' });
    const topics = conversationTopics(validated.message, validated.history);
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', cancel);
    let mode = 'diagnostics';
    let reply;
    const localOnly = ['action_request', 'unsupported'].includes(topics.topic);
    inFlight++;
    try {
      if (key && !localOnly) {
        try { reply = await requestAnswer({ apiKey: key, model: selectedModel, snapshot, topics, signal: controller.signal, request, timeoutMs }); mode = 'ai'; }
        catch { reply = diagnostics(snapshot, topics.topic, 'unavailable'); }
      } else reply = diagnostics(snapshot, topics.topic, localOnly ? 'local' : 'unconfigured');
      if (!res.destroyed && !controller.signal.aborted) res.json({ agentId: snapshot.agentId, serviceRole: snapshot.serviceRole, mode, reply,
        observedAt: snapshot.observedAt, suggestions: ['What is your status?', 'What do you do?', 'How often do you refresh?', 'What should I check next?'] });
    } finally { inFlight--; res.removeListener('close', cancel); }
  };
}

module.exports = { createOfficeAgentChat, sanitizeSnapshot, requestAnswer };
