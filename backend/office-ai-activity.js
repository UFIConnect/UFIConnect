'use strict';

const { pathAllowedForRoute } = require('./office-ai-routing');
const WINDOW_MS = 5 * 60000, BASELINE_MS = 60 * 60000, MAX_ENTRIES = 200;
const CACHE_MS = 15000, MAX_FINDINGS = 80, MAX_WRITES = 20;
const FAILURE = /^(?:failed|failure|error|timed-out|timed_out)$/;
const UNKNOWN = /^(?:unknown|outcome-unknown|dispatch_uncertain)$/;
const SUCCESS = /^(?:succeeded|success|completed|ok|tool-returned)$/;
const text = (value, length = 240) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, length) : '';
const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const priority = finding => ({ critical: 0, warning: 1, info: 2 }[finding.severity] ?? 3);
const newestFirst = (left, right) => String(right.observedAt || '').localeCompare(String(left.observedAt || ''));

function eventOf(entry) {
  if (!entry || entry.kind !== 'execution' || entry.mode === 'activity' || !date(entry.createdAt)) return null;
  const metadata = object(entry.metadata) ? entry.metadata : {};
  const target = text(metadata.route?.target || metadata.target || entry.mode, 48);
  const action = text(metadata.controlId || metadata.tool || metadata.action || (metadata.taskId ? 'task-result' : 'execution:' + (entry.mode || 'unknown')), 120);
  let status = text(entry.status, 48).toLowerCase();
  // A successful wrapper does not turn a failed control receipt into success.
  if (SUCCESS.test(status) && Array.isArray(metadata.receipts) && metadata.receipts.some(receipt => receipt?.ok === false)) status = 'failed';
  const id = text(entry.id, 64), referenceId = text(entry.referenceId, 128);
  if (!id && !referenceId) return null;
  const service = text(metadata.serviceRole, 48);
  const taskId = text(metadata.taskId, 128), runId = text(metadata.runId, 128);
  return { id, referenceId, at: new Date(entry.createdAt).getTime(), createdAt: date(entry.createdAt), target, action, status, metadata,
    key: [target, action, service].join('\0'), correlation: taskId ? 'task:' + taskId : runId ? 'run:' + runId : 'event:' + (referenceId || id) };
}

function boundaryMismatch(event) {
  const { target, action, metadata } = event;
  const operation = text(metadata.tool, 120) || action;
  if (['hosted-web', 'local-web'].includes(target) && ['repo_edit', 'repo_commit', 'terminal_run', 'office_command', 'cloudflare_deploy'].includes(operation))
    return 'A private hosted draft recorded a repository, terminal, Office, or deployment action outside its destination.';
  if (target === 'public-web' && ['office_command', 'cloudflare_deploy'].includes(operation))
    return 'A public website task recorded an Office or AI infrastructure operation outside its destination.';
  if (['public-web', 'self-update'].includes(target) && operation === 'repo_edit' && typeof metadata.path === 'string'
    && !pathAllowedForRoute({ target }, metadata.path)) return 'A code edit was recorded outside the task destination file scope.';
  const actual = text(metadata.actualTarget || metadata.destination, 48);
  if (['hosted-web', 'local-web', 'general'].includes(target) && ['public-web', 'production', 'live', 'public'].includes(actual))
    return 'A private or general request recorded a public destination.';
  return null;
}

function eventsOf(entries, now) {
  const unique = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const event = eventOf(entry);
    if (event && event.at >= now - BASELINE_MS && event.at <= now) unique.set(event.id || event.referenceId, event);
  }
  const events = [...unique.values()].sort((left, right) => left.at - right.at || left.id.localeCompare(right.id));
  const aliases = new Map();
  for (const event of events) {
    if (!event.metadata.taskId) continue;
    for (const receipt of (Array.isArray(event.metadata.receipts) ? event.metadata.receipts : []).slice(0, 24)) {
      const runId = text(receipt?.runId, 128);
      if (runId) aliases.set('run:' + runId, event.correlation);
    }
    for (const runId of (Array.isArray(event.metadata.receiptIds) ? event.metadata.receiptIds : []).slice(0, 24)) {
      if (text(runId, 128)) aliases.set('run:' + text(runId, 128), event.correlation);
    }
  }
  for (const event of events) event.correlation = aliases.get(event.correlation) || event.correlation;
  return events;
}

function recovered(event, events) {
  return events.some(later => later.at > event.at && later.key === event.key && SUCCESS.test(later.status)
    // A successful call in another task cannot resolve this task's failed work.
    && (!(event.metadata.taskId || event.metadata.runId) || later.correlation === event.correlation)
    // Unknown side effects require the same invocation, not just another call in the same task.
    && (!(UNKNOWN.test(event.status) || event.metadata.outcomeUnknown === true)
      || event.referenceId && later.referenceId === event.referenceId.replace(/:(?:unknown|failed)$/, '')));
}

function analyzeActivity(entries, now = Date.now(), { truncated = false } = {}) {
  const events = eventsOf(entries, now), recentStart = now - WINDOW_MS;
  const recent = events.filter(event => event.at >= recentStart), baseline = events.filter(event => event.at < recentStart);
  const findings = [], priorActions = new Set(), priorDestinations = new Set(), priorFailures = new Set(), activeFailures = new Set(), priorRuns = new Set();
  for (const [index, event] of events.entries()) {
    const evidence = { eventId: event.id, referenceId: event.referenceId, action: event.action, target: event.target, observedAt: event.createdAt };
    const add = (rule, severity, reason, extra = {}) => findings.push({ rule, severity, reason, ...evidence, state: 'active', evidence: { ...evidence, ...extra } });
    const failureKey = event.key + '\0' + event.status;
    if (event.at >= recentStart) {
      const mismatch = boundaryMismatch(event);
      // Failed/blocked/rejected attempts do not prove the forbidden operation ran.
      if (mismatch && SUCCESS.test(event.status)) add('destination-mismatch', 'critical', mismatch, { status: event.status, executionConfirmed: true });
      if (priorRuns.size >= 10 && !priorActions.has(event.action)) add('new-action', 'info',
        'The action ' + event.action + ' first appeared in the available recorded baseline. A new action alone does not establish a problem.', { priorEvents: index });
      if (priorRuns.size >= 10 && event.target && !['legacy', 'unknown'].includes(event.target) && !priorDestinations.has(event.target)) add('new-destination', 'info',
        'The destination ' + event.target + ' first appeared in the available recorded baseline. A new destination alone does not establish a problem.', { priorEvents: index });
      const uncertain = UNKNOWN.test(event.status) || event.metadata.outcomeUnknown === true;
      if ((FAILURE.test(event.status) || uncertain) && !recovered(event, events) && !activeFailures.has(failureKey)) {
        const first = !priorFailures.has(failureKey);
        add(uncertain ? 'unconfirmed-outcome' : first ? 'new-failure-class' : 'execution-failure', 'warning',
          uncertain ? 'The outcome of ' + event.action + ' is unconfirmed. Check the original receipt before retrying an operation with side effects.'
            : 'A ' + event.status + ' result was recorded for ' + event.action + (first ? '; no earlier matching failure appears in the available baseline' : '; this failure also appears earlier in the available baseline') + '.',
          { status: event.status, priorEvents: index, firstObservedInAvailableBaseline: first, executionConfirmed: false,
            ...(mismatch ? { destinationCheck: 'No successful out-of-scope execution was confirmed.' } : {}) });
        activeFailures.add(failureKey);
      }
    }
    priorActions.add(event.action); priorDestinations.add(event.target); priorRuns.add(event.correlation);
    if (FAILURE.test(event.status) || UNKNOWN.test(event.status)) priorFailures.add(failureKey);
  }
  const independent = list => new Map(list.map(event => [event.correlation, event]));
  const recentRuns = independent(recent), baselineRuns = independent(baseline);
  // A task spanning both windows is one continuing task, not another new task.
  for (const key of baselineRuns.keys()) recentRuns.delete(key);
  const baselineMinutes = baseline.length ? Math.max(1, Math.min(55, (recentStart - baseline[0].at) / 60000)) : 0;
  const baselineSufficient = baselineRuns.size >= 10 && baselineMinutes >= 10;
  const expected = baselineMinutes ? baselineRuns.size * 5 / baselineMinutes : 0;
  const threshold = Math.max(8, Math.ceil(expected * 4));
  if (baselineSufficient && recentRuns.size >= threshold) {
    const event = [...recentRuns.values()].at(-1);
    const evidence = { eventId: event.id, referenceId: event.referenceId, observedAt: event.createdAt,
      recentEvents: recent.length, independentRecentEvents: recentRuns.size, recentMinutes: 5,
      baselineEvents: baseline.length, independentBaselineEvents: baselineRuns.size, baselineMinutes, threshold, truncated };
    findings.push({ rule: 'activity-burst', severity: 'info', state: 'active', eventId: event.id, referenceId: event.referenceId,
      action: event.action, target: event.target, observedAt: event.createdAt, evidence,
      // One volume note per quarter-hour avoids a new row for every poll/event.
      observationReference: 'anomaly:burst:' + Math.floor(now / (15 * 60000)),
      reason: recentRuns.size + ' independent tasks or runs were recorded in five minutes, above the available baseline threshold of ' + threshold + '. Volume alone does not establish a storage or stability problem.' });
  }
  return { findings, baselineCount: events.length, recentCount: recent.length,
    independentRecentEvents: recentRuns.size, baselineEvents: baseline.length, baselineMinutes, baselineSufficient };
}

function createOfficeAIActivity({ memory, now = Date.now } = {}) {
  let pending, pendingGeneration, cached, cachedAt = 0, cachedVersion, generation = 0;
  async function inspect() {
    const at = now(), checkedAt = new Date(at).toISOString(), entries = [];
    let before, exhausted = false;
    try {
      for (let page = 0; page < 4; page++) {
        const list = memory.listActivity || memory.list;
        const result = await list.call(memory, { limit: 50, ...(before ? { before } : {}) });
        if (!Array.isArray(result.entries)) throw new Error('Invalid memory page');
        entries.push(...result.entries.slice(0, MAX_ENTRIES - entries.length));
        if (!result.nextCursor) { exhausted = true; break; }
        if (before === result.nextCursor || entries.length >= MAX_ENTRIES) break;
        before = result.nextCursor;
      }
      const analyzed = analyzeActivity(entries, at, { truncated: !exhausted }), findings = [];
      const existing = new Map(entries.filter(entry => entry.kind === 'note' && entry.mode === 'activity'
        && /^office-recorded-activity-v[12]$/.test(entry.metadata?.detector || '')).map(entry => [entry.referenceId, entry]));
      let writes = 0, persistenceFailures = 0, deferred = 0;
      for (const finding of analyzed.findings.sort((left, right) => priority(left) - priority(right) || newestFirst(left, right)).slice(0, MAX_FINDINGS)) {
        const referenceId = finding.observationReference || 'anomaly:' + finding.eventId + ':' + finding.rule;
        let entry = existing.get(referenceId);
        try {
          if (!entry && writes < MAX_WRITES) {
            writes++;
            entry = await memory.record({ kind: 'note', mode: 'activity', role: 'system', status: finding.severity,
              title: 'Activity observation: ' + finding.rule, referenceId, content: finding.reason,
              metadata: { detector: 'office-recorded-activity-v2', ...finding } });
          }
          // Unique references also return tombstones: forgotten findings stay forgotten.
          if (!entry) deferred++;
          else if (!entry.deleted) findings.push({ ...finding, eventReferenceId: finding.referenceId, referenceId, id: entry.id });
        } catch { persistenceFailures++; }
      }
      const activeReferences = new Set(findings.map(finding => finding.referenceId)), events = eventsOf(entries, at);
      const history = [...existing.values()].filter(entry => !activeReferences.has(entry.referenceId)).map(entry => {
        const event = events.find(item => item.id === entry.metadata.eventId);
        const resolved = event && (FAILURE.test(event.status) || UNKNOWN.test(event.status)) && recovered(event, events);
        return { ...entry.metadata, id: entry.id, referenceId: entry.referenceId, eventReferenceId: entry.metadata.referenceId,
          reason: entry.content, recordedAt: entry.createdAt, state: resolved ? 'resolved' : 'historical' };
      }).sort(newestFirst).slice(0, MAX_FINDINGS);
      return { status: 'checked', findings, history, checkedAt, baselineCount: analyzed.baselineCount, scope: 'Office recorded activity',
        coverage: { scannedEntries: entries.length, executionEvents: analyzed.baselineCount, recentEvents: analyzed.recentCount,
          independentRecentEvents: analyzed.independentRecentEvents, baselineEvents: analyzed.baselineEvents,
          baselineMinutes: analyzed.baselineMinutes, baselineSufficient: analyzed.baselineSufficient,
          exhaustive: exhausted, truncated: !exhausted, findingsDetected: analyzed.findings.length, findingsReturned: findings.length,
          findingsTruncated: deferred > 0 || persistenceFailures > 0 || analyzed.findings.length > MAX_FINDINGS, persistenceFailures,
          note: 'Current observations cover the last five minutes of available Office records. Historical findings are separate. Correlated tool receipts count as one task or run for volume. Storage and stability require their own service measurements.' } };
    } catch {
      return { status: 'unavailable', findings: [], history: [], checkedAt, baselineCount: 0, scope: 'Office recorded activity',
        coverage: { scannedEntries: entries.length, exhaustive: false, truncated: true, baselineSufficient: false,
          note: 'Recorded activity could not be inspected. This result does not establish that activity is normal.' } };
    }
  }
  function scan() {
    if (pending) return pendingGeneration === generation ? pending : pending.then(() => scan());
    const version = typeof memory?.version === 'function' ? memory.version() : undefined;
    if (cached && cachedVersion === version && now() >= cachedAt && now() - cachedAt < CACHE_MS) return Promise.resolve(cached);
    const startedGeneration = generation;
    pendingGeneration = startedGeneration;
    pending = inspect().then(result => {
      if (generation === startedGeneration) { cached = result; cachedAt = now(); cachedVersion = typeof memory?.version === 'function' ? memory.version() : undefined; }
      return result;
    }).finally(() => { pending = null; });
    return pending;
  }
  // Deletion and clear routes invalidate the cache immediately after forgetting.
  function invalidate() { generation++; cached = null; }
  return { scan, invalidate };
}

module.exports = { createOfficeAIActivity, analyzeActivity };
