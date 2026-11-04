const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createOfficeConversations, messagesValue } = require('./office-ai-conversations');
const env = { NODE_ENV: 'test', OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };
const messages = [{ role: 'user', content: 'Private planning question', id: 'user-1' }, { role: 'assistant', content: 'Private planning answer', id: 'assistant-1',
  model: '@cf/test/model', research: { status: 'pages', checkedAt: '2026-11-04T00:00:00Z' }, sources: [{ title: 'Source', url: 'https://example.com/article' }] }];
async function call(handler, body, id) {
  const response = { code: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; }, status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; } };
  await handler({ body, params: { id } }, response); return response;
}
async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  const db = { isConnected: () => true, query: (...args) => pg.query(...args), withClient: work => work({ query: (...args) => pg.query(...args) }) };
  return { pg, db, api: createOfficeConversations({ db, env }) };
}
test('saved conversations survive service recreation and keep titles and messages encrypted in the database', async t => {
  const f = await fixture(t), id = randomUUID();
  const created = await call(f.api.create, { clientRequestId: id, title: 'Private plan', messages });
  assert.equal(created.code, 201); assert.equal(created.body.conversation.version, 1);
  const stored = (await f.pg.query('SELECT * FROM office_ai_conversations')).rows[0];
  assert.match(stored.encrypted_title, /^enc:v1:/); assert.match(stored.encrypted_messages, /^enc:v1:/);
  assert.doesNotMatch(JSON.stringify(stored), /Private plan|Private planning/);
  const restarted = createOfficeConversations({ db: f.db, env });
  const loaded = await call(restarted.detail, undefined, id);
  assert.equal(loaded.body.conversation.messages[1].content, messages[1].content);
  assert.equal(loaded.body.conversation.messages[1].research.status, 'pages');
  const listed = await call(restarted.list);
  assert.equal(listed.headers['Cache-Control'], 'no-store'); assert.equal(listed.body.conversations[0].title, 'Private plan');
  assert.equal(listed.body.conversations[0].messages, undefined);
});
test('an ambiguous create retry returns the original chat without overwriting it', async t => {
  const f = await fixture(t), id = randomUUID();
  await call(f.api.create, { clientRequestId: id, messages });
  const repeated = await call(f.api.create, { clientRequestId: id, title: 'Different', messages: [{ role: 'user', content: 'Replacement' }] });
  assert.equal(repeated.body.conversation.version, 1); assert.equal(repeated.body.conversation.messages[0].content, messages[0].content);
  assert.equal((await f.pg.query('SELECT COUNT(*)::integer AS count FROM office_ai_conversations')).rows[0].count, 1);
});
test('versioned updates retain unsupplied messages and reject a stale writer', async t => {
  const f = await fixture(t), id = randomUUID();
  await call(f.api.create, { clientRequestId: id, messages });
  const renamed = await call(f.api.update, { expectedVersion: 1, title: 'Renamed' }, id);
  assert.equal(renamed.code, 200); assert.equal(renamed.body.conversation.version, 2);
  assert.equal(renamed.body.conversation.messages.length, 2);
  const stale = await call(f.api.update, { expectedVersion: 1, messages: [{ role: 'user', content: 'Lost update' }] }, id);
  assert.equal(stale.code, 409);
  assert.equal((await call(f.api.detail, undefined, id)).body.conversation.messages.length, 2);
});
test('confirmed versioned deletion erases encrypted content and prevents a late create retry resurrecting it', async t => {
  const f = await fixture(t), id = randomUUID();
  await call(f.api.create, { clientRequestId: id, messages });
  assert.equal((await call(f.api.remove, { expectedVersion: 1 }, id)).code, 400);
  assert.equal((await call(f.api.remove, { expectedVersion: 2, confirmed: true }, id)).code, 409);
  assert.equal((await call(f.api.remove, { expectedVersion: 1, confirmed: true }, id)).body.deleted, true);
  assert.equal((await call(f.api.detail, undefined, id)).code, 404);
  assert.equal((await call(f.api.list)).body.conversations.length, 0);
  assert.equal((await call(f.api.create, { clientRequestId: id, messages })).code, 410);
  const row = (await f.pg.query('SELECT * FROM office_ai_conversations WHERE id=$1', [id])).rows[0];
  assert.equal(row.encrypted_title, null); assert.equal(row.encrypted_messages, null); assert.ok(row.deleted_at);
});
test('message validation bounds storage and drops unsupported metadata and unsafe source links', () => {
  assert.throws(() => messagesValue([{ role: 'system', content: 'new instruction' }]), { status: 400 });
  assert.throws(() => messagesValue(Array.from({ length: 201 }, () => messages[0])), { status: 413 });
  assert.throws(() => messagesValue([{ role: 'user', content: 'x'.repeat(24001) }]), { status: 400 });
  const saved = messagesValue([{ ...messages[1], token: 'do not persist', sources: [{ url: 'javascript:alert(1)' }, { url: 'https://secret@example.com/' }] }]);
  assert.equal(saved[0].token, undefined); assert.deepEqual(saved[0].sources, []);
});

test('saved replies preserve connected source status and all citation positions without persisting workspace excerpts', async t => {
  const f = await fixture(t), id = randomUUID(), taskId = randomUUID();
  const citations = Array.from({ length: 19 }, (_, index) => index < 8
    ? { title: `Web ${index + 1}`, url: `https://example.com/${index + 1}`, description: 'Public snippet', publisher: 'Example' }
    : { title: `Issue ${index + 1}`, url: `https://linear.app/example/issue/ID-${index + 1}`, description: 'PRIVATE RAW WORKSPACE EXCERPT', provider: 'linear', publisher: 'Linear' });
  const statuses = [{ id: 'linear', status: 'retrieved', count: 4, checkedAt: '2026-11-04T00:00:00Z', note: 'Matching issues only' },
    { id: 'notion', status: 'empty', count: 0, checkedAt: '2026-11-04T00:00:00Z', note: 'Title search only' },
    { id: 'slack', status: 'not-connected', count: 0, checkedAt: '2026-11-04T00:00:00Z', note: 'Connect this source' }];
  const input = [{ role: 'user', content: 'Summarize the project' }, { role: 'assistant', content: 'Project summary [19].', taskId,
    research: { status: 'pages' }, sources: citations, connectedSources: statuses }];
  const created = await call(f.api.create, { clientRequestId: id, messages: input });
  assert.equal(created.code, 201);
  const recreated = createOfficeConversations({ db: f.db, env });
  const loaded = (await call(recreated.detail, undefined, id)).body.conversation.messages[1];
  assert.equal(loaded.sources.length, 19); assert.equal(loaded.sources[18].title, 'Issue 19');
  assert.equal(loaded.sources[0].description, 'Public snippet');
  assert.deepEqual(Object.keys(loaded.sources[8]).sort(), ['provider', 'publisher', 'title', 'url']);
  assert.equal(loaded.sources[8].provider, 'linear');
  assert.equal(loaded.connectedSources.length, 3); assert.equal(loaded.connectedSources[0].count, 4);
  assert.equal(loaded.connectedSources[2].status, 'not-connected');
  assert.equal(loaded.taskId, taskId); assert.equal(loaded.research.status, 'pages');
  assert.ok(!JSON.stringify(loaded).includes('PRIVATE RAW WORKSPACE EXCERPT'));
});

test('saved source metadata is bounded, allowlisted, and strips excerpts even when provider metadata is missing', () => {
  const saved = messagesValue([{ role: 'assistant', content: 'Answer', connectedSources: [
    { id: 'linear', status: 'retrieved', count: 999, checkedAt: 'invalid', note: 'x'.repeat(700), token: 'private' },
    { id: 'linear', status: 'empty', count: 0 }, { id: 'unknown', status: 'retrieved', count: 1 },
  ], sources: [
    { title: 'Message', url: 'https://example.slack.com/archives/C1/p1', description: 'Private message' },
    ...Array.from({ length: 25 }, (_, index) => ({ title: `Web ${index}`, url: `https://example.com/${index}`, provider: 'unknown', description: 'Public text' })),
  ] }])[0];
  assert.equal(saved.connectedSources.length, 1); assert.equal(saved.connectedSources[0].count, 0);
  assert.equal(saved.connectedSources[0].checkedAt, null); assert.equal(saved.connectedSources[0].note.length, 600);
  assert.equal(saved.connectedSources[0].token, undefined);
  assert.equal(saved.sources.length, 20); assert.equal(saved.sources[0].provider, 'slack');
  assert.equal(saved.sources[0].description, undefined); assert.equal(saved.sources[1].provider, undefined);
  assert.equal(saved.sources[1].description, 'Public text');
});
test('database failure or wrong encryption key never reports a successful save or reveals content', async t => {
  const unavailable = createOfficeConversations({ db: { isConnected: () => false }, env });
  assert.equal((await call(unavailable.create, { clientRequestId: randomUUID(), messages })).code, 503);
  const f = await fixture(t), id = randomUUID();
  await call(f.api.create, { clientRequestId: id, messages });
  const wrongKey = createOfficeConversations({ db: f.db, env: { ...env, OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64') } });
  const read = await call(wrongKey.detail, undefined, id);
  assert.equal(read.code, 503); assert.doesNotMatch(JSON.stringify(read.body), /Private planning/);
});
