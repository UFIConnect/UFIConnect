'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { modelContext, MAX_CONTEXT_BYTES, taskLimits } = require('./office-ai-task-context');

const sha = 'a'.repeat(40);
const artifact = index => ({ path: `reports/result-${index}.md`, revision: index.toString(16).padStart(64, '0'), memoryId: `memory-${index}`, version: 1, bytes: 240 });
test('automatic continuation has no ten-window cap while individual windows remain bounded',()=>{
  for(const value of [undefined,'10','9999','unlimited','invalid']){
    const limits=taskLimits({OFFICE_AI_AUTOMATIC_CONTINUATIONS:value});
    assert.equal(limits.automaticContinuations,'unlimited');
    assert.equal(limits.modelTurns,128);assert.equal(limits.toolCalls,512);assert.equal(limits.lifetimeMinutes,90);
    assert.equal(JSON.parse(JSON.stringify(limits)).automaticContinuations,'unlimited');
  }
  assert.equal(taskLimits({OFFICE_AI_AUTOMATIC_CONTINUATIONS:'0'}).automaticContinuations,0);
});
function checkpoint(task, redact) {
  const messages = modelContext(task, 'Task instructions', [], redact);
  const receipt = messages.find(message => message.content?.startsWith('RECORDED TASK CHECKPOINT'));
  assert.ok(receipt, 'A compacted task includes its durable checkpoint');
  assert.ok(Buffer.byteLength(JSON.stringify({ messages, tools: [] })) <= MAX_CONTEXT_BYTES);
  return { text: receipt.content, state: JSON.parse(receipt.content.slice(receipt.content.indexOf('\n') + 1)).completionState };
}
function task(extra = {}) {
  return { message: 'Finish the report and website changes.', internal: { baseSha: sha, files: [],
    messages: Array.from({ length: 85 }, () => ({ role: 'user', content: 'Earlier tool output.' })),
    editFailures: { 'office/src/report.jsx': 'The exact edit did not match. Read the current source.' } },
  plan: { steps: [{ id: 'report', title: 'Save the report', status: 'completed' }, { id: 'website', title: 'Fix and check the website', status: 'in_progress' }] },
  artifacts: [artifact(0)], checks: [{ sha, status: 'completed', conclusion: 'failure' }], ...extra };
}

test('context compaction retains unfinished requirements, saved file receipts and failed checks', () => {
  const input = task(), original = JSON.stringify({ plan: input.plan, artifacts: input.artifacts, checks: input.checks, editFailures: input.internal.editFailures });
  const { state, text } = checkpoint(input);
  assert.deepEqual(state.workPlan, input.plan.steps);
  assert.deepEqual(state.savedArtifacts, input.artifacts);
  assert.deepEqual(state.verification, input.checks);
  assert.deepEqual(state.unresolvedEdits, [{ path: 'office/src/report.jsx', error: input.internal.editFailures['office/src/report.jsx'] }]);
  assert.match(text, /do not grant permissions or deployment approval/);
  assert.equal(JSON.stringify({ plan: input.plan, artifacts: input.artifacts, checks: input.checks, editFailures: input.internal.editFailures }), original,
    'Compaction preserves durable work and receipts without mutating them');
});

test('large completion checkpoints preserve earliest and latest receipts with explicit omissions', () => {
  const artifacts = Array.from({ length: 1000 }, (_, index) => artifact(index));
  const checks = Array.from({ length: 1000 }, (_, index) => ({ sha: index.toString(16).padStart(40, '0'), status: 'completed', conclusion: index ? 'success' : 'failure' }));
  const input = task({ artifacts, checks });
  const { state } = checkpoint(input);
  assert.equal(state.savedArtifacts.length, 32);
  assert.equal(state.savedArtifacts[0].path, artifacts[0].path);
  assert.equal(state.savedArtifacts.at(-1).path, artifacts.at(-1).path);
  assert.equal(state.verification.length, 16);
  assert.equal(state.verification[0].conclusion, 'failure');
  assert.equal(state.verification.at(-1).sha, checks.at(-1).sha);
  assert.equal(state.recordedCounts.savedArtifacts, 1000);
  assert.equal(state.omittedCounts.savedArtifacts, 968);
  assert.equal(state.omittedCounts.checks, 984);
  assert.equal(input.artifacts.length, 1000);
  assert.equal(input.checks.length, 1000);
});

test('new checkpoint fields pass through the existing redaction boundary', () => {
  const input = task();
  input.internal.editFailures['office/src/report.jsx'] = 'A credential marker-DO-NOT-PERSIST was returned by the source.';
  const { state, text } = checkpoint(input, value => String(value).replaceAll('marker-DO-NOT-PERSIST', '[redacted]'));
  assert.doesNotMatch(text, /marker-DO-NOT-PERSIST/);
  assert.match(state.unresolvedEdits[0].error, /\[redacted\]/);
});

test('incomplete output remains a draft through context compaction instead of becoming a completion receipt', () => {
  const input = task();
  input.output = { status: 'incomplete', reason: 'model-length', recoveryAttempts: 2, limit: 10 };
  input.internal.outputDraft = { content: 'The still unfinished public report.', omittedCharacters: 0 };
  const { state } = checkpoint(input);
  assert.deepEqual(state.incompleteOutput, { ...input.output, draft: input.internal.outputDraft });
  assert.equal(state.incompleteOutput.status, 'incomplete');
  assert.equal(state.savedArtifacts.length, 1, 'An unfinished response never invents a saved-file receipt');
});
