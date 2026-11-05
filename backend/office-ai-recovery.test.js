'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskRecovery, RECOVERY_ATTEMPTS, MODEL_ATTEMPTS_PER_REQUEST, recoveryLimitReached } = require('./office-ai-recovery');

test('durable recovery continues past ten and a thousand attempts with bounded backoff', () => {
  assert.equal(RECOVERY_ATTEMPTS, 'unlimited');
  const recovery = createTaskRecovery({ now: () => 1000 });
  const task = { internal: {} };
  const delays = Array.from({ length: 10 }, () => recovery.retry(task, 'phase:model', 'Model'));
  assert.deepEqual(delays, [1000, 2000, 3000, 4000, 5000, 5000, 5000, 5000, 5000, 5000]);
  for(let attempt=11;attempt<=1001;attempt++)assert.equal(recovery.retry(task, 'phase:model', 'Model'),5000);
  assert.equal(task.recovery.currentAttempt, 1001); assert.equal(task.recovery.totalAttempts, 1001);
  assert.equal(task.recovery.limit,'unlimited');
  assert.equal(JSON.parse(JSON.stringify(task.recovery)).limit,'unlimited');
  assert.equal(recovery.retry(task, 'tool:other', 'Other step'), 1000);
  recovery.clear(task, 'phase:model');
  assert.equal(recovery.retry(task, 'phase:model', 'Model'), 1000);
  assert.equal(task.recovery.totalAttempts, 1003);
});

test('unlimited total recovery is separate from finite manual budgets and per-request inference fan-out',()=>{
  assert.equal(recoveryLimitReached(1000000),false);
  assert.equal(recoveryLimitReached(0,0),true);
  assert.equal(recoveryLimitReached(10,11),false);
  assert.equal(recoveryLimitReached(11,11),true);
  assert.ok(Number.isSafeInteger(MODEL_ATTEMPTS_PER_REQUEST));
  assert.ok(MODEL_ATTEMPTS_PER_REQUEST>0);
});
