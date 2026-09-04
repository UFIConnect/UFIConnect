const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_OFFICE_WORKSPACE_BYTES,
  normalizeOfficeWorkspaceKey,
  validateOfficeWorkspacePayload,
} = require('./office-workspace');

test('only allowlisted Office workspaces are accepted', () => {
  assert.equal(normalizeOfficeWorkspaceKey('Decision-Foundry'), 'decision-foundry');
  assert.equal(normalizeOfficeWorkspaceKey('pipeline'), null);
  assert.equal(normalizeOfficeWorkspaceKey('../decision-foundry'), null);
});

test('Decision Foundry payload requires an object with decisions', () => {
  assert.equal(validateOfficeWorkspacePayload(null).valid, false);
  assert.equal(validateOfficeWorkspacePayload([]).valid, false);
  assert.equal(validateOfficeWorkspacePayload({}).valid, false);
  assert.deepEqual(validateOfficeWorkspacePayload({ decisions: [] }), { valid: true, bytes: 16 });
  assert.equal(validateOfficeWorkspacePayload({ decisions: [{ id: 'one' }] }).valid, false);
});

test('workspace payload size is bounded', () => {
  const result = validateOfficeWorkspacePayload({
    decisions: [{
      id: 'oversized',
      criteria: [],
      options: [],
      context: 'x'.repeat(MAX_OFFICE_WORKSPACE_BYTES),
    }],
  });
  assert.equal(result.valid, false);
  assert.match(result.error, /exceeds/);
});
