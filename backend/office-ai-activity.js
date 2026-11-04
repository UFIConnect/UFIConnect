'use strict';

const { pathAllowedForRoute } = require('./office-ai-routing');
const WINDOW_MS = 5 * 60000, BASELINE_MS = 60 * 60000, MAX_ENTRIES = 200;
const FAILURE = /^(?:failed|failure|error|unknown|outcome-unknown|timed-out|timed_out)$/;
const text = (value, length = 240) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, length) : '';
const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function eventOf(entry) {
  if (!entry || entry.kind !== 'execution' || entry.mode === 'activity' || !date(entry.createdAt)) return null;
  const metadata = object(entry.metadata) ? entry.metadata : {};
  const target = text(metadata.route?.target || metadata.target || entry.mode, 48);
  const action = text(metadata.controlId || metadata.tool || metadata.action || (metadata.taskId ? 'task-result' : `execution:${entry.mode || 'unknown'}`), 120);
  return { id: text(entry.id, 64), referenceId: text(entry.referenceId, 128), at: new Date(entry.createdAt).getTime(),
    createdAt: date(entry.createdAt), target, action, status: text(entry.status, 48), metadata };
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

function analyzeActivity(entries, now = Date.now()) {
  const events = entries.map(eventOf).filter(Boolean).filter(event => event.at <= now + 60000)
    .sort((left, right) => left.at - right.at || left.id.localeCompare(right.id));
  const recentStart = now - WINDOW_MS, findings = [], priorActions = new Set(), priorDestinations = new Set(), priorFailures = new Set();
  for (const [index, event] of events.entries()) {
    const recent = event.at >= recentStart;
    const evidence = { eventId: event.id, referenceId: event.referenceId, action: event.action, target: event.target, observedAt: event.createdAt };
    const add = (rule, severity, reason, extra = {}) => findings.push({ rule, severity, reason, ...evidence, evidence: { ...evidence, ...extra } });
    if (recent) {
      const mismatch = boundaryMismatch(event);
      if (mismatch) add('destination-mismatch', 'critical', mismatch);
      if (index >= 10 && !priorActions.has(event.action)) add('new-action', 'info',
        `The action ${event.action} has not appeared in the earlier recorded baseline.`, { priorEvents: index });
      if (index >= 10 && event.target && !['legacy', 'unknown'].includes(event.target) && !priorDestinations.has(event.target)) add('new-destination', 'warning',
        `The destination ${event.target} has not appeared in the earlier recorded baseline.`, { priorEvents: index });
      if (FAILURE.test(event.status) && !priorFailures.has(event.action)) add('new-failure-class', 'warning',
        `A failure was recorded for ${event.action}; this action had no earlier failure in the available baseline.`, { status: event.status, priorEvents: index });
    }
    priorActions.add(event.action); priorDestinations.add(event.target);
    if (FAILURE.test(event.status)) priorFailures.add(event.action);
  }
  const recent = events.filter(event => event.at >= recentStart), baseline = events.filter(event => event.at >= now - BASELINE_MS && event.at < recentStart);
  const expected = baseline.length * WINDOW_MS / (BASELINE_MS - WINDOW_MS);
  const threshold = Math.max(8, Math.ceil(expected * 4));
  if (baseline.length >= 10 && recent.length >= threshold) {
    const event = recent.at(-1), evidence = { eventId: event.id, referenceId: event.referenceId, observedAt: event.createdAt,
      recentEvents: recent.length, recentMinutes: 5, baselineEvents: baseline.length, baselineMinutes: 55, threshold };
    findings.push({ rule: 'activity-burst', severity: 'warning', eventId: event.id, referenceId: event.referenceId,
      action: event.action, target: event.target, observedAt: event.createdAt, evidence,
      reason: `${recent.length} execution events were recorded in five minutes, above the available baseline threshold of ${threshold}.` });
  }
  return { findings, baselineCount: events.length, recentCount: recent.length };
}

function createOfficeAIActivity({ memory, now = Date.now } = {}) {
  let pending;
  async function inspect() {
    const checkedAt = new Date(now()).toISOString(), entries = [];
    let before, exhausted = false;
    try {
      for (let page = 0; page < 4; page++) {
        const result = await memory.list({ limit: 50, ...(before ? { before } : {}) });
        if (!Array.isArray(result.entries)) throw new Error('Invalid memory page');
        entries.push(...result.entries.slice(0, MAX_ENTRIES - entries.length));
        if (!result.nextCursor) { exhausted = true; break; }
        if (before === result.nextCursor || entries.length >= MAX_ENTRIES) break;
        before = result.nextCursor;
      }
      const analyzed = analyzeActivity(entries, now()), findings = [];
      for (const finding of analyzed.findings.slice(-80)) {
        const referenceId = `anomaly:${finding.eventId}:${finding.rule}`;
        try {
          const entry = await memory.record({ kind: 'note', mode: 'activity', role: 'system', status: finding.severity,
            title: `Activity observation: ${finding.rule}`, referenceId, content: finding.reason,
            metadata: { detector: 'office-recorded-activity-v1', ...finding } });
          // A forgotten finding stays forgotten even when its event is scanned again.
          if (!entry.deleted) findings.push({ ...finding, eventReferenceId: finding.referenceId, id: entry.id, referenceId });
        } catch { findings.push({ ...finding, persistent: false }); }
      }
      const existing = entries.filter(entry => entry.kind === 'note' && entry.mode === 'activity'
        && entry.metadata?.detector === 'office-recorded-activity-v1').map(entry => ({ ...entry.metadata, id: entry.id, referenceId: entry.referenceId,
          eventReferenceId: entry.metadata.referenceId, reason: entry.content, recordedAt: entry.createdAt }));
      const unique = new Map();
      for (const finding of [...existing, ...findings]) unique.set(finding.referenceId || `${finding.eventId}:${finding.rule}`, finding);
      return { status: 'checked', findings: [...unique.values()].sort((left, right) => String(right.observedAt || '').localeCompare(String(left.observedAt || ''))).slice(0, 80),
        checkedAt, baselineCount: analyzed.baselineCount, scope: 'Office recorded activity',
        coverage: { scannedEntries: entries.length, executionEvents: analyzed.baselineCount, recentEvents: analyzed.recentCount,
          exhaustive: exhausted, note: 'Observations use the available recorded baseline. New behavior can be legitimate; activity outside Office and unrecorded events are not observed.' } };
    } catch {
      return { status: 'unavailable', findings: [], checkedAt, baselineCount: 0, scope: 'Office recorded activity',
        coverage: { scannedEntries: entries.length, exhaustive: false, note: 'Recorded activity could not be inspected. This result does not establish that activity is normal.' } };
    }
  }
  function scan() {
    if (!pending) pending = inspect().finally(() => { pending = null; });
    return pending;
  }
  return { scan };
}

module.exports = { createOfficeAIActivity, analyzeActivity };
