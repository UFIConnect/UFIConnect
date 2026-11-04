const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAppHarness } = require('./test-support/app-harness');
const token = 'synthetic-private-office-access';
test('conversations, tasks, terminal and capability routes remain private to Office', async t => {
  const app = await createAppHarness({ env: { OFFICE_TOKEN: token } }); t.after(() => app.close());
  const routes = [
    ['GET', '/office/ai/conversations'], ['POST', '/office/ai/conversations'],
    ['GET', '/office/ai/conversations/10000000-0000-4000-8000-000000000001'],
    ['PATCH', '/office/ai/conversations/10000000-0000-4000-8000-000000000001'],
    ['DELETE', '/office/ai/conversations/10000000-0000-4000-8000-000000000001'],
    ['GET', '/office/ai/tasks'], ['POST', '/office/ai/tasks'], ['POST', '/office/ai/tasks/10000000-0000-4000-8000-000000000001/confirm'],
    ['GET', '/office/ai/terminal'], ['POST', '/office/ai/terminal'], ['POST', '/office/ai/terminal/10000000-0000-4000-8000-000000000001/cancel'],
    ['GET', '/office/ai/capabilities'],
  ];
  for (const [method, path] of routes) {
    const response = await app.request(path, { method, ...(method === 'GET' ? {} : { body: {} }) });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
  const offline = await app.request('/office/ai/conversations', { headers: { 'x-office-token': token } });
  assert.equal(offline.status, 503, 'Disconnected storage cannot be reported as saved history');
});
test('protected saved-history routes use the API role and never start pipeline task execution', async t => {
  const app = await createAppHarness({ connected: true, env: { OFFICE_TOKEN: token, SERVICE_ROLE: 'pipeline' } }); t.after(() => app.close());
  const result = await app.request('/office/ai/tasks', { headers: { 'x-office-token': token } });
  assert.equal(result.status, 409); assert.match(result.data.error, /API service/);
});

async function executionFixture(t, extra = {}) {
  let execute;
  const requests = [], sha = 'a'.repeat(40);
  const request = (options, callback) => {
    const req = new EventEmitter(), response = new EventEmitter(); let body = '';
    req.setTimeout = () => {}; req.write = value => { body += value; }; req.end = () => queueMicrotask(() => {
      requests.push({ ...options, body: body ? JSON.parse(body) : null });
      response.statusCode = options.hostname === 'api.github.com' ? 204 : 201;
      response.setEncoding = () => {}; callback(response);
      if (response.statusCode === 201) response.emit('data', JSON.stringify({ id: 'dep-synthetic' }));
      response.emit('end');
    }); return req;
  };
  const app = await createAppHarness({ connected: true, env: { OFFICE_TOKEN: token, OFFICE_GITHUB_TOKEN: 'synthetic-github-write-token', ...extra },
    modules: {
      https: { ...require('node:https'), request, get: request },
      './office-ai-repository': { createOfficeAIRepository: () => ({ verifiedHead: async () => ({ sha }) }) },
      './office-ai-tasks': { createOfficeAITasks: options => {
        execute = options.executeControl;
        const handler = (_req, res) => res.json({});
        return { list: handler, create: handler, detail: handler, cancel: handler, confirm: handler, start() {}, stop() {}, capabilities: () => ({}) };
      } },
    },
  }); t.after(() => app.close());
  return { app, requests, sha, execute: (...args) => execute(...args) };
}
test('a partial multi-service command preserves completed audit receipts and forbids blind replay', async t => {
  const f = await executionFixture(t);
  await assert.rejects(f.execute('feed.clear-delivery-caches', { confirmed: true }), error => {
    assert.equal(error.outcomeUnknown, true);
    assert.match(error.publicMessage, /Already completed: api \(control_/);
    assert.equal(error.receipts.length, 1); assert.equal(error.receipts[0].service, 'api');
    return true;
  });
  assert.equal(f.app.queries.filter(query => query.sql.includes('INSERT INTO office_control_runs')).length, 1);
});
test('task deployment refuses a moved verified head and pins workflow dispatch to the checked SHA', async t => {
  const f = await executionFixture(t);
  await assert.rejects(f.execute('deploy.office', { confirmed: true }, { expectedSha: 'b'.repeat(40) }));
  assert.equal(f.requests.length, 0, 'A mismatched verification never reaches a provider write');
  const result = await f.execute('deploy.office', { confirmed: true }, { expectedSha: f.sha });
  assert.equal(f.requests[0].body.inputs.expected_sha, f.sha); assert.equal(f.requests[0].body.ref, 'main');
  assert.equal(result.results[0].result.status, 'queued'); assert.equal(result.results[0].result.sha, f.sha);
  await f.execute('deploy.mobile', { confirmed: true }, { expectedSha: f.sha });
  assert.equal(f.requests[1].body.inputs.expected_sha, f.sha);
});
test('direct Render deployment pins the verified commit instead of following a moving main branch', async t => {
  const f = await executionFixture(t, { OFFICE_GITHUB_TOKEN: '', AUTOFIX_GITHUB_TOKEN: '', RENDER_API_KEY: 'synthetic-render-api-key', RENDER_SERVICE_OFFICE_ID: 'srv-synthetic-office' });
  const result = await f.execute('deploy.office', { confirmed: true }, { expectedSha: f.sha });
  assert.equal(f.requests[0].hostname, 'api.render.com'); assert.equal(f.requests[0].body.commitId, f.sha);
  assert.equal(result.results[0].result.deployId, 'dep-synthetic'); assert.equal(result.results[0].result.status, 'queued');
});
