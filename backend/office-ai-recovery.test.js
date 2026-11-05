'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskRecovery, RECOVERY_ATTEMPTS } = require('./office-ai-recovery');

test('ten recovery attempts use short bounded delays and reset only after confirmed progress', () => {
  assert.equal(RECOVERY_ATTEMPTS, 10);
  const recovery = createTaskRecovery({ now: () => 1000 });
  const task = { internal: {} };
  const delays = Array.from({ length: 10 }, () => recovery.retry(task, 'phase:model', 'Model'));
  assert.deepEqual(delays, [1000, 2000, 3000, 4000, 5000, 5000, 5000, 5000, 5000, 5000]);
  assert.equal(recovery.retry(task, 'phase:model', 'Model'), null);
  assert.equal(task.recovery.currentAttempt, 10); assert.equal(task.recovery.totalAttempts, 10);
  assert.equal(recovery.retry(task, 'tool:other', 'Other step'), 1000);
  recovery.clear(task, 'phase:model');
  assert.equal(recovery.retry(task, 'phase:model', 'Model'), 1000);
  assert.equal(task.recovery.totalAttempts, 12);
});
