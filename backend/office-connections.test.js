'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createOfficeConnections } = require('./office-connections');
const { createTokenVault } = require('./token-vault');
const { createAppHarness } = require('./test-support/app-harness');

const KEY = Buffer.alloc(32, 37).toString('base64');
const TOKEN = 'saved-credential-do-not-expose-1234567890';
const ACCOUNT = 'a'.repeat(32);
const instant = Date.parse('2026-11-03T17:00:00.000Z');
const environment = () => ({ NODE_ENV: 'production', OAUTH_TOKEN_ENCRYPTION_KEY: KEY,
  OFFICE_GITHUB_TOKEN: 'server-github-secret-123456', AUTOFIX_GITHUB_TOKEN: 'background-github-secret-123456',
  RENDER_API_KEY: 'server-render-secret-123456', RENDER_HOOK_API: 'https://api.render.com/deploy/secret',
  RENDER_SERVICE_API_ID: 'srv-1234567890abc', CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
  CLOUDFLARE_API_TOKEN: 'server-cloudflare-secret-123456', OFFICE_AI_RELAY_URL: 'https://office.owner.workers.dev', OFFICE_AI_RELAY_SECRET: 'r'.repeat(48),
  OFFICE_AI_MODEL: '@cf/google/gemma-4-26b-a4b-it', OFFICE_AI_GATEWAY: 'default',
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function provider() {
  const calls = [];
  return { calls, fetcher: async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith('https://api.github.com/')) return json({ full_name: 'UFIConnect/UFIConnect', permissions: { pull: true } });
    if (String(url).startsWith('https://api.render.com/')) return json([{ service: { id: 'srv-1234567890abc' } }]);
    if (String(url).endsWith('/health')) return json({ configured: true });
    return json({ success: true, result: [{ name: '@cf/google/gemma-4-26b-a4b-it' }] });
  } };
}
async function invoke(handler, { provider = 'github', body = {} } = {}) {
  const res = { statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; },
    status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await handler({ body, params: { provider } }, res);
  return { status: res.statusCode, data: res.body, headers: res.headers };
}
async function database(t) {
  const pg = new PGlite(); await pg.waitReady; t.after(() => pg.close());
  return { isConnected: () => true, query: (sql, params) => pg.query(sql, params) };
}
const memoryDb = () => ({ isConnected: () => true, query: async () => ({ rows: [], rowCount: 0 }) });

test('saved providers are encrypted, persist across instances, and affect only the isolated Office environment', async t => {
  const db = await database(t), env = environment(), original = { ...env }, fake = provider();
  const service = createOfficeConnections({ db, env, fetcher: fake.fetcher, now: () => instant });
  for (const [name, body] of [
    ['github', { token: TOKEN }],
    ['render', { token: TOKEN, serviceIds: { api: 'srv-1234567890xyz', office: 'srv-abcdef123456' } }],
    ['cloudflare', { token: TOKEN, accountId: ACCOUNT, model: '@cf/google/gemma-4-26b-a4b-it', gateway: 'office' }],
  ]) {
    const saved = await invoke(service.save, { provider: name, body });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.connection.source, 'saved');
    assert.ok(!JSON.stringify(saved.data).includes(TOKEN));
    assert.ok(!JSON.stringify(saved.data).includes(KEY));
    assert.equal(saved.headers['Cache-Control'], 'no-store');
  }
  const { rows } = await db.query('SELECT * FROM office_provider_connections ORDER BY provider');
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.match(row.encrypted_config, /^enc:v1:/);
    assert.ok(!row.encrypted_config.includes(TOKEN));
    const plaintext = createTokenVault(env).open(row.encrypted_config, `office:provider:${row.provider}`);
    assert.ok(plaintext.includes(TOKEN));
    assert.throws(() => createTokenVault(env).open(row.encrypted_config, 'office:provider:wrong'));
  }
  assert.deepEqual(env, original);
  assert.equal(service.env.OFFICE_GITHUB_TOKEN, TOKEN);
  assert.equal(service.env.AUTOFIX_GITHUB_TOKEN, original.AUTOFIX_GITHUB_TOKEN);
  assert.equal(service.env.RENDER_SERVICE_API_ID, 'srv-1234567890xyz');
  assert.equal(service.env.RENDER_HOOK_API, '');
  assert.equal(service.env.OFFICE_AI_GATEWAY, 'office');
  const next = createOfficeConnections({ db, env: original, fetcher: fake.fetcher });
  const listed = await invoke(next.list);
  assert.equal(listed.status, 200);
  assert.equal(listed.data.connections.filter(item => item.source === 'saved').length, 3);
  assert.equal(next.env.CLOUDFLARE_API_TOKEN, TOKEN);
  assert.equal(listed.data.connections.find(item => item.id === 'render').serviceIds.api, 'srv-1234567890xyz');
  for (const call of fake.calls) {
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.ok(call.options.signal);
    assert.ok(!call.url.includes(TOKEN));
  }
  assert.equal(fake.calls[0].options.headers['X-GitHub-Api-Version'], '2026-03-10');
  assert.equal(fake.calls[1].url, 'https://api.render.com/v1/services?limit=1');
  assert.equal(fake.calls[2].url, `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/models/search?per_page=1`);
});

test('disconnect clears baseline fallback credentials and persists its disabled state across recreation', async t => {
  const db = await database(t), env = environment(), original = { ...env }, fake = provider();
  const service = createOfficeConnections({ db, env, fetcher: fake.fetcher });
  assert.equal((await invoke(service.disconnect, { body: {} })).status, 400);
  for (const name of ['github', 'render', 'cloudflare']) {
    const result = await invoke(service.disconnect, { provider: name, body: { confirmed: true } });
    assert.equal(result.status, 200);
    assert.equal(result.data.connection.configured, false);
    assert.equal(result.data.connection.source, 'disconnected');
  }
  const next = createOfficeConnections({ db, env, fetcher: fake.fetcher });
  await next.refresh();
  for (const key of ['OFFICE_GITHUB_TOKEN', 'AUTOFIX_GITHUB_TOKEN', 'RENDER_API_KEY', 'RENDER_HOOK_API', 'RENDER_SERVICE_API_ID',
    'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'OFFICE_AI_RELAY_URL', 'OFFICE_AI_RELAY_SECRET']) assert.equal(next.env[key], '');
  const { rows } = await db.query('SELECT enabled,encrypted_config FROM office_provider_connections');
  assert.ok(rows.every(row => row.enabled === false && row.encrypted_config === null));
  assert.deepEqual(env, original);
  assert.equal(fake.calls.length, 0);
});

test('other Office instances observe a disconnect after the bounded refresh interval', async t => {
  const db = await database(t); let time = instant;
  const first = createOfficeConnections({ db, env: environment(), now: () => time });
  const second = createOfficeConnections({ db, env: environment(), now: () => time });
  await first.refresh(); await second.refresh();
  await invoke(first.disconnect, { body: { confirmed: true } });
  time += 15001;
  await second.refresh();
  assert.equal(second.env.OFFICE_GITHUB_TOKEN, '');
  assert.equal(second.env.AUTOFIX_GITHUB_TOKEN, '');
});

test('verification is read-only and never returns credentials or changes a saved configuration', async t => {
  const db = await database(t), fake = provider();
  const service = createOfficeConnections({ db, env: environment(), fetcher: fake.fetcher });
  await invoke(service.save, { body: { token: TOKEN } });
  const before = (await db.query('SELECT * FROM office_provider_connections')).rows;
  const checked = await invoke(service.verify);
  assert.equal(checked.status, 200);
  assert.match(checked.data.detail, /write permissions are checked when used/);
  assert.deepEqual((await db.query('SELECT * FROM office_provider_connections')).rows, before);
  assert.ok(!JSON.stringify(checked.data).includes(TOKEN));
  assert.ok(fake.calls.every(call => call.options.method === 'GET'));
});

test('hostile provider inputs are rejected before any external credential check or database write', async () => {
  const fake = provider(), queries = [];
  const db = memoryDb(); db.query = async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; };
  const service = createOfficeConnections({ db, env: environment(), fetcher: fake.fetcher });
  const malformed = [
    ['github', { token: `${TOKEN}\r\nX-Hijack: true` }],
    ['github', { token: TOKEN, accountId: ACCOUNT }],
    ['github', { token: TOKEN, url: 'https://attacker.example' }],
    ['render', { token: TOKEN, serviceIds: { unrelated: 'srv-1234567890' } }],
    ['render', { token: TOKEN, serviceIds: { api: ['srv-1234567890'] } }],
    ['render', { token: TOKEN, serviceIds: { api: '../../secrets' } }],
    ['cloudflare', { token: TOKEN, accountId: [ACCOUNT] }],
    ['cloudflare', { token: TOKEN, accountId: ACCOUNT, model: ['@cf/google/gemma-4-26b-a4b-it'] }],
    ['cloudflare', { token: TOKEN, accountId: ACCOUNT, gateway: ['default'] }],
    ['cloudflare', { token: TOKEN, accountId: ACCOUNT, serviceIds: {} }],
    ['github', { token: 'x'.repeat(9000) }],
  ];
  for (const [name, body] of malformed) assert.equal((await invoke(service.save, { provider: name, body })).status, 400);
  assert.equal((await invoke(service.save, { provider: 'unknown', body: { token: TOKEN } })).status, 404);
  assert.equal(fake.calls.length, 0);
  assert.ok(!queries.some(query => /INSERT|UPDATE|DELETE/.test(query.sql)));
});

test('provider failures, redirects and network errors cannot leak credentials or replace an existing connection', async t => {
  const db = await database(t), good = provider(); let mode = 'ok';
  const service = createOfficeConnections({ db, env: environment(), fetcher: async (url, options) => {
    if (mode === 'ok') return good.fetcher(url, options);
    if (mode === 'rejected') return json({ errors: [{ message: TOKEN }] }, 403);
    if (mode === 'redirect') return new Response(null, { status: 302, headers: { Location: `https://attacker.example/${TOKEN}` } });
    throw Object.assign(new Error(`Network failure with credential ${TOKEN}`), { status: 400 });
  } });
  assert.equal((await invoke(service.save, { body: { token: TOKEN } })).status, 200);
  const original = (await db.query('SELECT encrypted_config FROM office_provider_connections')).rows[0].encrypted_config;
  for (const kind of ['rejected', 'redirect', 'network']) {
    mode = kind;
    const response = await invoke(service.save, { body: { token: 'replacement-private-token-123456789' } });
    assert.equal(response.status, kind === 'network' ? 503 : 422);
    assert.ok(!JSON.stringify(response.data).includes(TOKEN));
    assert.equal(service.env.OFFICE_GITHUB_TOKEN, TOKEN);
    assert.equal((await db.query('SELECT encrypted_config FROM office_provider_connections')).rows[0].encrypted_config, original);
  }
});

test('tampered encrypted records fail closed in middleware and expose no ciphertext or provider secrets', async t => {
  const db = await database(t), env = environment(), fake = provider();
  const service = createOfficeConnections({ db, env, fetcher: fake.fetcher });
  await invoke(service.save, { body: { token: TOKEN } });
  await db.query("UPDATE office_provider_connections SET encrypted_config=encrypted_config || 'tampered' WHERE provider='github'");
  const restarted = createOfficeConnections({ db, env, fetcher: fake.fetcher });
  let advanced = false;
  const res = { statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; } };
  await restarted.middleware({}, res, () => { advanced = true; });
  assert.equal(advanced, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.ok(!JSON.stringify(res.body).includes(TOKEN));
});

test('missing encryption key and unavailable database prevent credential writes and external verification', async () => {
  const fake = provider();
  const noKey = createOfficeConnections({ db: memoryDb(), env: {}, fetcher: fake.fetcher });
  assert.equal((await invoke(noKey.save, { body: { token: TOKEN } })).status, 503);
  const unavailable = createOfficeConnections({ db: { isConnected: () => false }, env: environment(), fetcher: fake.fetcher });
  assert.equal((await invoke(unavailable.list)).status, 503);
  assert.equal((await invoke(unavailable.save, { body: { token: TOKEN } })).status, 503);
  assert.equal(fake.calls.length, 0);
  let next = false;
  const res = { set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  await unavailable.middleware({}, res, () => { next = true; });
  assert.equal(next, false); assert.equal(res.statusCode, 503);
});

test('provider verification has bounded response capacity and sanitizes malformed JSON', async () => {
  let large = true;
  const service = createOfficeConnections({ db: memoryDb(), env: environment(), fetcher: async () => large
    ? json({ full_name: 'x'.repeat(262145) }) : new Response(`not-json ${TOKEN}`, { status: 200 }) });
  const oversized = await invoke(service.verify);
  assert.equal(oversized.status, 502);
  large = false;
  const malformed = await invoke(service.verify);
  assert.equal(malformed.status, 503);
  assert.ok(!JSON.stringify(malformed.data).includes(TOKEN));
});

test('per-provider concurrency and minute budgets bound external credential checks and reset', async () => {
  let release, clock = instant, calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const service = createOfficeConnections({ db: memoryDb(), env: environment(), now: () => clock, fetcher: async () => {
    calls++; await pending; return json({ full_name: 'UFIConnect/UFIConnect' });
  } });
  await service.refresh();
  const first = invoke(service.verify);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await invoke(service.verify)).status, 429);
  release(); assert.equal((await first).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await invoke(service.verify)).status, 200);
  assert.equal((await invoke(service.verify)).status, 429);
  assert.equal(calls, 6);
  clock += 60001;
  assert.equal((await invoke(service.verify)).status, 200);
  assert.equal(calls, 7);
});

test('Cloudflare relay verification rejects foreign hosts, credentials and non-root paths without sending its secret', async () => {
  for (const relayUrl of ['https://attacker.example', 'https://owner.workers.dev.evil.example', 'http://owner.workers.dev',
    'https://username:password@owner.workers.dev', 'https://owner.workers.dev/path', 'https://owner.workers.dev/?token=x']) {
    const fake = provider(), env = { ...environment(), CLOUDFLARE_API_TOKEN: '', OFFICE_AI_RELAY_URL: relayUrl };
    const service = createOfficeConnections({ db: memoryDb(), env, fetcher: fake.fetcher });
    assert.equal((await invoke(service.verify, { provider: 'cloudflare' })).status, 422);
    assert.equal(fake.calls.length, 0);
  }
  const fake = provider(), env = { ...environment(), CLOUDFLARE_API_TOKEN: '' };
  const service = createOfficeConnections({ db: memoryDb(), env, fetcher: fake.fetcher });
  assert.equal((await invoke(service.verify, { provider: 'cloudflare' })).status, 200);
  assert.equal(fake.calls[0].url, 'https://office.owner.workers.dev/health');
});

test('real Office AI and connection routes require authorization before database or provider access', async t => {
  const app = await createAppHarness({ env: { OFFICE_TOKEN: 'office-connections-test' } });
  t.after(() => app.close());
  for (const [url, method, body] of [
    ['/office/ai', 'GET'], ['/office/ai/chat', 'POST', { message: 'Hi' }], ['/office/ai/tools', 'GET'],
    ['/office/ai/tools', 'POST', { name: 'Test', kind: 'prompt', instructions: 'Hello' }],
    ['/office/connections', 'GET'], ['/office/connections/github', 'POST', { token: TOKEN }],
    ['/office/connections/github/verify', 'POST', {}], ['/office/connections/github', 'DELETE', { confirmed: true }],
  ]) assert.equal((await app.request(url, { method, body })).status, 401);
  assert.equal(app.queries.length, 0);
  const authorized = await app.request('/office/ai', { headers: { 'x-office-token': 'office-connections-test' } });
  assert.equal(authorized.status, 503);
  assert.match(authorized.data.error, /storage is unavailable/);
  assert.equal(authorized.headers.get('cache-control'), 'no-store');
});
