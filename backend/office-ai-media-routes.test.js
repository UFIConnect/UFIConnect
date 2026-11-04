'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness } = require('./test-support/app-harness');
const officeAI = require('./office-ai');
const tasks = require('./office-ai-tasks');
const headers = { 'x-office-token': 'office-media-route-fixture' };

test('real Office routing authenticates uploads before parsing and scopes larger bodies to AI routes', async t => {
  let handled = 0;
  const receive = (req, res) => { handled++; return res.json({ bytes: Buffer.byteLength(JSON.stringify(req.body)) }); };
  const app = await createAppHarness({ connected: true, env: { OFFICE_TOKEN: headers['x-office-token'] }, modules: {
    './office-ai': { ...officeAI, createOfficeAI: options => ({ ...officeAI.createOfficeAI(options), chat: receive }) },
    './office-ai-tasks': { ...tasks, createOfficeAITasks: options => ({ ...tasks.createOfficeAITasks(options), create: receive, start() {} }) },
  } });
  t.after(() => app.close());
  const large = { message: 'x'.repeat(600000) };
  for (const path of ['/office/ai/chat', '/office/ai/tasks']) {
    const unauthorized = await fetch(app.base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    assert.equal(unauthorized.status, 401, 'Authentication precedes JSON parsing');
    const accepted = await app.request(path, { method: 'POST', headers, body: large });
    assert.equal(accepted.status, 200);
    assert.ok(accepted.data.bytes > 512 * 1024);
    const rejected = await app.request(path, { method: 'POST', headers, body: { message: 'x'.repeat(3 * 1024 * 1024) } });
    assert.equal(rejected.status, 413);
    assert.equal(rejected.headers.get('cache-control'), 'no-store');
  }
  const ordinary = await app.request('/office/ai/tools', { method: 'POST', headers, body: large });
  assert.equal(ordinary.status, 413, 'Other Office requests retain the normal smaller parser');
  assert.equal(handled, 2);
});
