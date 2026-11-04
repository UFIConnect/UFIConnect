'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PGlite } = require('@electric-sql/pglite');
const { createOfficeWebDraft, generateDraft, applyEdits } = require('./office-web-draft');
const { createAppHarness } = require('./test-support/app-harness');
const sha = 'a'.repeat(40), source = '<h1>Welcome to UFIConnect</h1>', change = { summary: 'Improve public homepage heading', edits: [{ find: source, replace: '<h1>Your connected feed</h1>' }] };
function provider({ raw, status = 200, hold = false } = {}) {
  const calls = [];
  const request = (url, options, callback) => {
    const req = new EventEmitter(), call = { url, options, destroyed: false }; calls.push(call);
    req.destroy = () => { call.destroyed = true; };
    call.respond = () => { const res = new EventEmitter(); res.statusCode = status; res.destroy = () => {}; callback(res);
      res.emit('data', Buffer.from(raw ?? JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(change) }] }] }))); res.emit('end'); };
    req.end = payload => { call.payload = JSON.parse(payload); if (!hold) queueMicrotask(call.respond); };
    return req;
  };
  return { request, calls };
}
test('web edits require exact unique text and preserve literal code characters', () => {
  assert.equal(applyEdits('price: $20', { summary: 'Adjust price', edits: [{ find: '$20', replace: '$& $` $1' }] }), 'price: $& $` $1');
  assert.throws(() => applyEdits('heading heading', { ...change, edits: [{ find: 'heading', replace: 'title' }] }), /unique section/);
  assert.throws(() => applyEdits(source, { ...change, edits: [{ find: 'missing', replace: 'text' }] }), /unique section/);
  assert.throws(() => applyEdits(source, { ...change, edits: [{ find: source, replace: source }] }), /invalid edit/);
  assert.throws(() => applyEdits(source, { summary: 'No change', edits: [] }), /bounded edit/);
  assert.throws(() => applyEdits(source, { ...change, edits: [{ find: source, replace: 'OPENAI_API_KEY = "private-value"' }] }), /cannot be committed/);
});
test('draft generation uses structured outputs without tools or provider storage', async () => {
  const fake = provider();
  const result = await generateDraft({ apiKey: 'fixture-only', model: 'gpt-5-mini', filePath: 'web/index.html', content: source, message: 'Improve heading', request: fake.request });
  assert.deepEqual(result, change); assert.equal(fake.calls.length, 1);
  const call = fake.calls[0]; assert.equal(call.url, 'https://api.openai.com/v1/responses');
  assert.equal(call.payload.store, false); assert.deepEqual(call.payload.tools, []);
  assert.equal(call.payload.text.format.type, 'json_schema'); assert.equal(call.payload.text.format.strict, true);
  assert.deepEqual(JSON.parse(call.payload.input), { filePath: 'web/index.html', operatorRequest: 'Improve heading', fileContent: source });
});
test('refusals, incomplete outputs and provider errors never produce a draft', async () => {
  for (const option of [{ raw: '{invalid' }, { status: 429 }, { raw: JSON.stringify({ status: 'incomplete', output_text: JSON.stringify(change) }) },
    { raw: JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'Cannot help' }] }] }) }]) {
    const fake = provider(option); await assert.rejects(generateDraft({ apiKey: 'fixture', model: 'gpt-5-mini', request: fake.request }), /could not prepare/);
    assert.equal(fake.calls.length, 1, 'Provider failures are not automatically retried');
  }
});
test('cancelled requests stop generation without producing a change', async () => {
  const fake = provider({ hold: true }), controller = new AbortController();
  const pending = generateDraft({ apiKey: 'fixture', model: 'gpt-5-mini', request: fake.request, signal: controller.signal }); controller.abort();
  await assert.rejects(pending, /could not prepare/); assert.equal(fake.calls[0].destroyed, true);
});
test('authenticated real web draft route checks paths and revisions before generation and never commits', async t => {
  const fake = provider(); let file = { sha, content: source }, loads = 0;
  // Office connections use real fixture storage; provider traffic stays mocked.
  const pg = new PGlite(); t.after(() => pg.close());
  const app = await createAppHarness({ connected: true, query: (sql, params) => pg.query(sql, params), env: { OFFICE_TOKEN: 'web-draft-test', OPENAI_API_KEY: 'fixture-only' }, modules: {
    './office-web-draft': { createOfficeWebDraft: options => createOfficeWebDraft({ ...options, request: fake.request, getFile: async () => { loads++; return file; } }) },
  } }); t.after(() => app.close());
  const headers = { 'x-office-token': 'web-draft-test' }, body = { message: 'Improve heading', filePath: 'web/index.html', expectedSha: sha };
  const send = extra => app.request('/office/agents/web_optimizer/web-draft', { method: 'POST', headers, body: { ...body, ...extra } });
  assert.equal((await app.request('/office/agents/web_optimizer/web-draft', { method: 'POST', body })).status, 401);
  for (const filePath of ['backend/index.js', 'web/src/../../backend/index.js', 'web/.env', 'office/src/App.jsx', 'web/public/secret.key']) assert.equal((await send({ filePath })).status, 400);
  assert.equal(loads, 0); assert.equal(fake.calls.length, 0);
  assert.equal((await send({ expectedSha: 'b'.repeat(40) })).status, 409); assert.equal(fake.calls.length, 0);
  const queryCount = app.queries.length, prepared = await send({});
  assert.equal(prepared.status, 200); assert.equal(prepared.headers.get('cache-control'), 'no-store');
  assert.equal(prepared.data.original, source); assert.equal(prepared.data.content, change.edits[0].replace);
  assert.equal(prepared.data.filePath, body.filePath); assert.equal(app.queries.length, queryCount, 'Draft generation never writes a control run or a commit');
  file = { sha, content: 'OPENAI_API_KEY = "private-value"' }; assert.equal((await send({})).status, 413); assert.equal(fake.calls.length, 1);
  file = { sha, content: 'x'.repeat(90 * 1024) }; assert.equal((await send({})).status, 413); assert.equal(fake.calls.length, 1);
  assert.equal((await app.request('/office/agents/unknown/web-draft', { method: 'POST', headers, body })).status, 404);
});
test('unconfigured editing and incorrect service ownership do not call the provider', async () => {
  for (const options of [{ apiKey: '' }, { apiKey: 'fixture-only', serviceRole: 'pipeline' }]) {
    const handler = createOfficeWebDraft({ getAgentSnapshot: () => ({}), getFile: () => { throw Error('Should not read'); }, ...options });
    const res = { set() { return this; }, status(status) { this.statusCode = status; return this; }, json(data) { this.data = data; return this; } };
    await handler({ params: { id: 'security' }, body: { message: 'Update homepage', filePath: 'web/index.html', expectedSha: sha } }, res);
    assert.equal(res.statusCode, options.serviceRole === 'pipeline' ? 409 : 503);
  }
});
