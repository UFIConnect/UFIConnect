'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOfficeAIActivity, analyzeActivity } = require('./office-ai-activity');
const NOW = Date.parse('2026-11-04T20:00:00Z');
const event = (index, extra = {}) => ({ id: `event-${index}`, kind: 'execution', mode: 'office', status: 'succeeded',
  referenceId: `run:${index}`, content: 'Actual receipt', createdAt: new Date(NOW - (30 - index) * 60000).toISOString(), metadata: { tool: 'health_check', target: 'office' }, ...extra });
const baseline = () => Array.from({ length: 12 }, (_, index) => event(index));

test('a unique new action is detected from history without any known bad signature', () => {
  const unusual = event(99, { createdAt: new Date(NOW - 60000).toISOString(), metadata: { tool: 'new_custom_action_593', target: 'office' } });
  const result = analyzeActivity([...baseline(), unusual], NOW);
  assert.equal(result.findings.find(item => item.rule === 'new-action').action, 'new_custom_action_593');
  assert.equal(result.findings.find(item => item.rule === 'new-action').severity, 'info');
  assert.ok(result.findings.every(item => item.eventId === unusual.id));
  assert.equal(analyzeActivity([unusual], NOW).findings.length, 0, 'Insufficient history cannot establish first-seen novelty');
});

test('baseline bursts, new failures and destination mismatches produce evidence-based observations', () => {
  const recent = Array.from({ length: 9 }, (_, index) => event(50 + index, { createdAt: new Date(NOW - index * 10000).toISOString() }));
  const failed = event(70, { status: 'failed', createdAt: new Date(NOW).toISOString() });
  const mismatch = event(71, { createdAt: new Date(NOW - 1000).toISOString(), metadata: { target: 'hosted-web', tool: 'repo_commit' } });
  const result = analyzeActivity([...baseline(), ...recent, failed, mismatch], NOW);
  const burst = result.findings.find(item => item.rule === 'activity-burst');
  assert.equal(burst.evidence.recentEvents, 11); assert.equal(burst.evidence.baselineEvents, 12);
  assert.equal(burst.severity, 'info', 'Volume is an observation, not evidence of service instability');
  assert.ok(result.findings.some(item => item.rule === 'new-failure-class' && item.eventId === failed.id));
  assert.ok(result.findings.some(item => item.rule === 'destination-mismatch' && item.severity === 'critical'));
  const pastFailure = event(1, { status: 'failed' });
  assert.equal(analyzeActivity([pastFailure, failed], NOW).findings.some(item => item.rule === 'new-failure-class'), false);
});

test('repeated scans persist findings once and exclude activity notes from the baseline', async () => {
  const events = [...baseline(), event(99, { createdAt: new Date(NOW - 1000).toISOString(), metadata: { tool: 'unique_operation', target: 'office' } })];
  const records = new Map(); let writes = 0;
  const memory = { list: async () => ({ entries: [...events, ...records.values()], nextCursor: null }),
    record: async input => { if (!records.has(input.referenceId)) { writes++; records.set(input.referenceId, { id: `finding-${writes}`, ...input, createdAt: new Date(NOW).toISOString() }); } return records.get(input.referenceId); } };
  const activity = createOfficeAIActivity({ memory, now: () => NOW });
  const first = await activity.scan(), second = await activity.scan();
  assert.equal(first.status, 'checked'); assert.equal(first.findings.length, 1); assert.equal(second.findings.length, 1);
  assert.equal(second.baselineCount, 13); assert.equal(writes, 1);
  records.get(first.findings[0].referenceId).deleted = true;
  memory.list = async () => ({ entries: events, nextCursor: null });
  activity.invalidate();
  assert.equal((await activity.scan()).findings.length, 0, 'Forgotten findings do not reappear');
});

test('prevented destination violations never become critical executions; successful violations still do', () => {
  for (const status of ['failed', 'blocked', 'rejected', 'cancelled', 'unknown']) {
    const result = analyzeActivity([event(100, { status, createdAt: new Date(NOW - 1000).toISOString(),
      metadata: { target: 'hosted-web', tool: 'repo_edit', path: 'web/src/App.jsx' } })], NOW);
    assert.equal(result.findings.some(item => item.severity === 'critical'), false, status);
    if (status === 'failed') assert.ok(result.findings.some(item => item.rule === 'new-failure-class'));
    if (status === 'unknown') assert.ok(result.findings.some(item => item.rule === 'unconfirmed-outcome'));
  }
  for (const status of ['succeeded', 'tool-returned']) {
    const result = analyzeActivity([event(100, { status, createdAt: new Date(NOW - 1000).toISOString(),
      metadata: { target: 'hosted-web', tool: 'repo_edit', path: 'web/src/App.jsx' } })], NOW);
    assert.ok(result.findings.some(item => item.rule === 'destination-mismatch' && item.severity === 'critical'));
  }
});

test('the baseline excludes old/future/duplicate records and uses observed time rather than a fictitious hour', () => {
  const recent = Array.from({ length: 9 }, (_, index) => event(100 + index, { createdAt: new Date(NOW - index * 1000).toISOString() }));
  const compressed = baseline().map((entry, index) => ({ ...entry, createdAt: new Date(NOW - (6 * 60000 + index * 1000)).toISOString() }));
  const invalid = [event(500, { createdAt: new Date(NOW - 2 * 3600000).toISOString() }), event(501, { createdAt: new Date(NOW + 1000).toISOString() })];
  const result = analyzeActivity([...compressed, ...recent, ...recent, ...invalid], NOW, { truncated: true });
  assert.equal(result.baselineCount, 21);
  assert.equal(result.recentCount, 9);
  assert.equal(result.baselineSufficient, false);
  assert.equal(result.findings.some(item => item.rule === 'activity-burst'), false, 'A one-minute baseline cannot establish a 55-minute rate');
});

test('tool/control/task receipts from the same task do not manufacture a volume burst or hide failures', () => {
  const receipts = Array.from({ length: 25 }, (_, index) => event(100 + index, { createdAt: new Date(NOW - index * 1000).toISOString(),
    metadata: { target: 'office', tool: 'health_check', taskId: 'one-task' } }));
  receipts.push(event(130, { status: 'tool-returned', createdAt: new Date(NOW).toISOString(),
    metadata: { target: 'office', tool: 'office_command', controlId: 'control.health', taskId: 'one-task', receipts: [{ runId: 'same-control', ok: false }] } }));
  receipts.push(event(131, { status: 'failed', createdAt: new Date(NOW).toISOString(),
    metadata: { target: 'office', controlId: 'control.health', runId: 'same-control' } }));
  const result = analyzeActivity([...baseline(), ...receipts], NOW);
  assert.equal(result.independentRecentEvents, 1);
  assert.equal(result.findings.some(item => item.rule === 'activity-burst'), false);
  assert.ok(result.findings.some(item => item.severity === 'warning'), 'Correlated failures remain visible');
});

test('known recurrent failures remain actionable and a different destination has a distinct failure baseline', () => {
  const old = event(1, { status: 'failed' });
  const failed = event(101, { status: 'failed', createdAt: new Date(NOW - 1000).toISOString() });
  const result = analyzeActivity([old, failed], NOW);
  assert.equal(result.findings.find(item => item.eventId === failed.id).rule, 'execution-failure');
  assert.equal(result.findings[0].severity, 'warning');
  const other = { ...failed, metadata: { tool: 'health_check', target: 'self-update' } };
  assert.equal(analyzeActivity([old, other], NOW).findings[0].rule, 'new-failure-class');
});

test('a recovery resolves a failed action, while unrelated successes cannot confirm uncertain side effects', () => {
  const failed = event(101, { status: 'failed', createdAt: new Date(NOW - 2000).toISOString() });
  const success = event(102, { createdAt: new Date(NOW - 1000).toISOString() });
  assert.equal(analyzeActivity([failed, success], NOW).findings.length, 0);
  const uncertain = { ...failed, status: 'unknown', metadata: { ...failed.metadata, taskId: 'task-one' } };
  assert.ok(analyzeActivity([uncertain, success], NOW).findings.some(item => item.rule === 'unconfirmed-outcome'));
  const sameTask = { ...success, metadata: { ...success.metadata, taskId: 'task-one' } };
  assert.ok(analyzeActivity([uncertain, sameTask], NOW).findings.some(item => item.rule === 'unconfirmed-outcome'));
  assert.equal(analyzeActivity([uncertain, { ...sameTask, referenceId: uncertain.referenceId }], NOW).findings.length, 0);
  const knownTask = { ...failed, metadata: { ...failed.metadata, taskId: 'failed-task' } };
  assert.ok(analyzeActivity([knownTask, sameTask], NOW).findings.some(item => item.rule === 'new-failure-class'));
  assert.equal(analyzeActivity([knownTask, { ...sameTask, metadata: { ...sameTask.metadata, taskId: 'failed-task' } }], NOW).findings.length, 0);
});

test('stale and recovered persisted notes are history, never replayed as current alerts', async () => {
  const failed = event(101, { status: 'failed', createdAt: new Date(NOW - 2000).toISOString() });
  const historical = { id: 'old-note', kind: 'note', mode: 'activity', referenceId: 'anomaly:old:destination-mismatch', content: 'Old route observation',
    createdAt: new Date(NOW - 20 * 60000).toISOString(), metadata: { detector: 'office-recorded-activity-v1', rule: 'destination-mismatch', severity: 'critical',
      eventId: 'old', observedAt: new Date(NOW - 20 * 60000).toISOString() } };
  const records = new Map([[historical.referenceId, historical]]); let current = [failed];
  const memory = { list: async () => ({ entries: [...current, ...records.values()], nextCursor: null }), record: async input => {
    const note = { id: 'failure-note', ...input, createdAt: new Date(NOW).toISOString() }; records.set(input.referenceId, note); return note;
  } };
  const activity = createOfficeAIActivity({ memory, now: () => NOW });
  const first = await activity.scan();
  assert.equal(first.findings.length, 1); assert.equal(first.history.length, 1);
  current.push(event(102, { createdAt: new Date(NOW - 1000).toISOString() })); activity.invalidate();
  const second = await activity.scan();
  assert.equal(second.findings.length, 0); assert.equal(second.history.length, 2);
  assert.ok(second.history.some(item => item.state === 'resolved'));
});

test('warm scans avoid reads and encryption writes; memory changes and expiry invalidate the cache', async () => {
  let reads = 0, writes = 0, revision = 0, at = NOW;
  const entries = [...baseline(), event(100, { status: 'failed', createdAt: new Date(NOW - 1000).toISOString() })];
  const memory = { version: () => revision, list: async () => { throw Error('Unfiltered memory must not be used'); },
    listActivity: async () => { reads++; return { entries, nextCursor: null }; }, record: async input => {
      writes++; revision++; const record = { id: 'finding', ...input, createdAt: new Date(NOW).toISOString() }; entries.push(record); return record;
    } };
  const activity = createOfficeAIActivity({ memory, now: () => at });
  const first = await activity.scan(); assert.equal(writes, 1);
  assert.equal(await activity.scan(), first); assert.equal(reads, 1); assert.equal(writes, 1);
  revision++; await activity.scan(); assert.equal(reads, 2); assert.equal(writes, 1);
  at += 15001; await activity.scan(); assert.equal(reads, 3); assert.equal(writes, 1);
});

test('burst notes share a stable bounded reference rather than writing a note per newest receipt', async () => {
  const entries = [...baseline(), ...Array.from({ length: 12 }, (_, index) => event(100 + index, { createdAt: new Date(NOW - index * 1000).toISOString() }))];
  let at = NOW, writes = 0;
  const memory = { list: async () => ({ entries, nextCursor: null }), record: async input => { writes++;
    const note = { id: 'burst-note', ...input, createdAt: new Date(at).toISOString() }; entries.push(note); return note;
  } };
  const activity = createOfficeAIActivity({ memory, now: () => at });
  const first = await activity.scan(); assert.equal(writes, 1);
  at += 60000; entries.push(event(120, { createdAt: new Date(at).toISOString() }));
  const second = await activity.scan();
  assert.equal(writes, 1); assert.equal(second.findings[0].referenceId, first.findings[0].referenceId);
});

test('cold scan writes are capped and urgent findings precede informational novelty', async () => {
  const entries = [...baseline(), ...Array.from({ length: 30 }, (_, index) => event(100 + index, { createdAt: new Date(NOW - index * 1000).toISOString(),
    metadata: { target: 'hosted-web', tool: index === 29 ? 'repo_commit' : 'action_' + index } }))];
  let writes = 0;
  const memory = { list: async () => ({ entries, nextCursor: null }), record: async input => { writes++; return { id: 'note-' + writes, ...input }; } };
  const report = await createOfficeAIActivity({ memory, now: () => NOW }).scan();
  assert.equal(writes, 20); assert.equal(report.findings[0].severity, 'critical');
  assert.equal(report.coverage.findingsTruncated, true); assert.ok(report.coverage.findingsDetected > report.findings.length);
});

test('a scan requested after forgetting during an in-flight check waits for fresh records', async () => {
  let release, reads = 0;
  const paused = new Promise(resolve => { release = resolve; });
  const memory = { list: async () => { reads++; if (reads === 1) await paused; return { entries: [], nextCursor: null }; } };
  const activity = createOfficeAIActivity({ memory, now: () => NOW });
  const old = activity.scan(); activity.invalidate(); const fresh = activity.scan();
  release(); await Promise.all([old, fresh]);
  assert.equal(reads, 2);
});

test('persistence failure cannot masquerade as a complete check with no observations', async () => {
  const memory = { list: async () => ({ entries: [event(101, { status: 'failed', createdAt: new Date(NOW).toISOString() })], nextCursor: null }),
    record: async () => { throw Error('Database temporarily unavailable'); } };
  const report = await createOfficeAIActivity({ memory, now: () => NOW }).scan();
  assert.equal(report.coverage.findingsDetected, 1); assert.equal(report.coverage.persistenceFailures, 1);
  assert.equal(report.coverage.findingsTruncated, true); assert.equal(report.findings.length, 0);
});

test('scanning is bounded, single-flight, and missing memory never reports a normal state', async () => {
  let reads = 0;
  const memory = { list: async ({ before }) => { reads++; await new Promise(resolve => setImmediate(resolve));
    return { entries: Array.from({ length: 50 }, (_, index) => ({ id: `${reads}-${index}`, kind: 'note', mode: 'activity' })), nextCursor: `page-${before || reads}` }; }, record: async () => { throw Error('No writes expected'); } };
  const activity = createOfficeAIActivity({ memory, now: () => NOW });
  const [left, right] = await Promise.all([activity.scan(), activity.scan()]);
  assert.equal(left, right); assert.equal(reads, 4); assert.equal(left.coverage.scannedEntries, 200); assert.equal(left.coverage.exhaustive, false);
  assert.equal((await createOfficeAIActivity({ memory: { list: async () => { throw Error('private secret'); } }, now: () => NOW }).scan()).status, 'unavailable');
});
