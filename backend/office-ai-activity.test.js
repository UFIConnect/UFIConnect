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
  const failed = event(70, { status: 'failed', createdAt: new Date(NOW - 5000).toISOString() });
  const mismatch = event(71, { createdAt: new Date(NOW - 1000).toISOString(), metadata: { target: 'hosted-web', tool: 'repo_commit' } });
  const result = analyzeActivity([...baseline(), ...recent, failed, mismatch], NOW);
  const burst = result.findings.find(item => item.rule === 'activity-burst');
  assert.equal(burst.evidence.recentEvents, 11); assert.equal(burst.evidence.baselineEvents, 12);
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
  assert.equal((await activity.scan()).findings.length, 0, 'Forgotten findings do not reappear');
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
