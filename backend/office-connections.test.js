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
const modelReply = () => json({ choices: [{ message: { content: 'OK' } }] });
function provider() {
  const calls = [];
  return { calls, fetcher: async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith('https://api.github.com/')) return json({ full_name: 'UFIConnect/UFIConnect', permissions: { pull: true } });
    if (String(url).startsWith('https://api.render.com/')) return json([{ service: { id: 'srv-1234567890abc' } }]);
    if (String(url).endsWith('/health')) return json({ configured: true });
    if (String(url).endsWith('/websearch/')) return json({ items: [{ title: 'Cloudflare', url: 'https://developers.cloudflare.com/' }] });
    return modelReply();
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

test('Expo migrates existing connections and encrypts, verifies, persists, and independently disconnects its token', async t => {
  const db = await database(t), env = { ...environment(), EXPO_TOKEN: 'baseline-expo-token-1234567890' };
  const fetcher = async () => json({ data: { app: { byId: { id: '230828f2-53a3-4f87-a262-f2946e821eeb', fullName: '@uficonnect/ufic',
    githubRepository: { githubRepositoryIdentifier: 1249535414 }, githubRepositorySettings: { baseDirectory: '/mobile' } } } } });
  const service = createOfficeConnections({ db, env, fetcher });
  const saved = await invoke(service.save, { provider: 'expo', body: { token: TOKEN } });
  assert.equal(saved.status, 200); assert.equal(saved.data.buildConfigured, true);
  assert.equal(saved.data.connection.configured, true); assert.ok(!JSON.stringify(saved.data).includes(TOKEN));
  const row = (await db.query("SELECT encrypted_config FROM office_provider_connections WHERE provider='expo'")).rows[0];
  assert.match(row.encrypted_config, /^enc:v1:/); assert.ok(!row.encrypted_config.includes(TOKEN));
  const restarted = createOfficeConnections({ db, env, fetcher }); await restarted.refresh();
  assert.equal(restarted.env.EXPO_TOKEN, TOKEN);
  assert.equal((await invoke(restarted.disconnect, { provider: 'expo', body: { confirmed: true } })).status, 200);
  const disconnected = createOfficeConnections({ db, env, fetcher }); await disconnected.refresh();
  assert.equal(disconnected.env.EXPO_TOKEN, ''); assert.equal(env.EXPO_TOKEN, 'baseline-expo-token-1234567890');
  assert.equal(disconnected.env.OFFICE_GITHUB_TOKEN, env.OFFICE_GITHUB_TOKEN);
});

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
  for (const [index, call] of fake.calls.entries()) {
    assert.equal(call.options.method, index < 2 ? 'GET' : 'POST');
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.ok(call.options.signal);
    assert.ok(!call.url.includes(TOKEN));
  }
  assert.equal(fake.calls[0].options.headers['X-GitHub-Api-Version'], '2026-03-10');
  assert.equal(fake.calls[1].url, 'https://api.render.com/v1/services?limit=1');
  const inference = fake.calls.find(call => call.url.endsWith('/v1/chat/completions'));
  assert.equal(inference.url, `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/v1/chat/completions`);
  assert.equal(inference.options.headers['cf-aig-gateway-id'], 'office');
  assert.equal(inference.options.headers['cf-aig-collect-log'], 'false');
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

test('deployment-only Cloudflare save preserves the server AI relay without copying its secret into storage', async t => {
  const db = await database(t), account = 'edc675f01dd686d29d7a2e447bc04a8b', deploymentToken = 'workers-deployment-scoped-credential-123456';
  const env = { ...environment(), CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: '' }, original = { ...env }, calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/health')) return json({ configured: true });
    assert.ok(String(url).endsWith('/settings'));
    return json({ success: true, result: { bindings: [] } });
  };
  const service = createOfficeConnections({ db, env, fetcher });
  const result = await invoke(service.save, { provider: 'cloudflare', body: { deploymentToken, accountId: account } });
  assert.equal(result.status, 200); assert.equal(result.data.aiVerified, true); assert.equal(result.data.deploymentVerified, true);
  assert.equal(result.data.connection.mode, 'worker-binding'); assert.equal(result.data.connection.deploymentConfigured, true);
  assert.equal(service.env.OFFICE_AI_RELAY_SECRET, original.OFFICE_AI_RELAY_SECRET); assert.equal(service.env.CLOUDFLARE_DEPLOY_API_TOKEN, deploymentToken);
  assert.deepEqual(env, original); assert.ok(!JSON.stringify(result.data).includes(deploymentToken));
  const row = (await db.query("SELECT * FROM office_provider_connections WHERE provider='cloudflare'")).rows[0];
  const saved = JSON.parse(createTokenVault(env).open(row.encrypted_config, 'office:provider:cloudflare'));
  assert.equal(saved.CLOUDFLARE_DEPLOY_API_TOKEN, deploymentToken); assert.equal(saved.OFFICE_AI_RELAY_SECRET, undefined); assert.equal(saved.CLOUDFLARE_API_TOKEN, undefined);
  assert.ok(calls.every(call => call.options.method === 'GET')); assert.equal(calls.length, 3);
  assert.equal(calls.find(call => call.url.endsWith('/health')).options.headers.Authorization, `Bearer ${original.OFFICE_AI_RELAY_SECRET}`);
  assert.ok(calls.filter(call => call.url.endsWith('/settings')).every(call => call.options.headers.Authorization === `Bearer ${deploymentToken}`));
  const restarted = createOfficeConnections({ db, env: original, fetcher }); await restarted.refresh();
  assert.equal(restarted.env.OFFICE_AI_RELAY_SECRET, original.OFFICE_AI_RELAY_SECRET); assert.equal(restarted.env.CLOUDFLARE_DEPLOY_API_TOKEN, deploymentToken);
  const listed = await invoke(restarted.list); assert.equal(listed.data.connections.find(item => item.id === 'cloudflare').deploymentConfigured, true);
});

test('Cloudflare deployment-only updates preserve an existing encrypted AI token and disconnect disables both', async t => {
  const db = await database(t), account = 'edc675f01dd686d29d7a2e447bc04a8b', deploymentToken = 'workers-deployment-scoped-credential-123456';
  const env = { ...environment(), CLOUDFLARE_ACCOUNT_ID: account };
  const fetcher = async url => String(url).endsWith('/settings') ? json({ success: true, result: { bindings: [] } })
    : String(url).endsWith('/websearch/') ? json({ items: [] }) : modelReply();
  const service = createOfficeConnections({ db, env, fetcher });
  assert.equal((await invoke(service.save, { provider: 'cloudflare', body: { token: TOKEN, accountId: account, gateway: 'saved-gateway' } })).status, 200);
  assert.equal((await invoke(service.save, { provider: 'cloudflare', body: { deploymentToken, accountId: account } })).status, 200);
  assert.equal(service.env.CLOUDFLARE_API_TOKEN, TOKEN); assert.equal(service.env.OFFICE_AI_GATEWAY, 'saved-gateway');
  const row = (await db.query("SELECT * FROM office_provider_connections WHERE provider='cloudflare'")).rows[0];
  const saved = JSON.parse(createTokenVault(env).open(row.encrypted_config, 'office:provider:cloudflare'));
  assert.equal(saved.CLOUDFLARE_API_TOKEN, TOKEN); assert.equal(saved.CLOUDFLARE_DEPLOY_API_TOKEN, deploymentToken);
  assert.equal((await invoke(service.disconnect, { provider: 'cloudflare', body: { confirmed: true } })).status, 200);
  const restarted = createOfficeConnections({ db, env: { ...env, CLOUDFLARE_DEPLOY_API_TOKEN: 'server-deployment-token-123456' }, fetcher });
  await restarted.refresh(); assert.equal(restarted.env.CLOUDFLARE_DEPLOY_API_TOKEN, ''); assert.equal(restarted.env.CLOUDFLARE_API_TOKEN, ''); assert.equal(restarted.env.OFFICE_AI_RELAY_SECRET, '');
  assert.equal((await invoke(restarted.save, { provider: 'cloudflare', body: { deploymentToken, accountId: account } })).status, 400);
});

test('Cloudflare settings can update the gateway with the current AI token and report search and deploy failures separately', async t => {
  const db = await database(t), deploymentToken = 'workers-deployment-scoped-credential-123456';
  const env = { ...environment(), OFFICE_AI_TRANSPORT: 'direct', CLOUDFLARE_ACCOUNT_ID: 'edc675f01dd686d29d7a2e447bc04a8b',
    CLOUDFLARE_DEPLOY_API_TOKEN: deploymentToken };
  const calls = [];
  const service = createOfficeConnections({ db, env, fetcher: async (url, options) => {
    calls.push({ url: String(url), ...options });
    if (String(url).endsWith('/settings')) return json({ errors: [{ message: deploymentToken }] }, 403);
    if (String(url).endsWith('/websearch/')) return json({ errors: [{ message: env.CLOUDFLARE_API_TOKEN }] }, 402);
    return modelReply();
  } });
  const result = await invoke(service.save, { provider: 'cloudflare', body: { gateway: 'pip-office', searchProvider: 'exa' } });
  assert.equal(result.status, 200);
  assert.equal(result.data.aiVerified, true);
  assert.equal(result.data.researchVerified, false);
  assert.equal(result.data.deploymentVerified, false);
  assert.equal(result.data.connection.gateway, 'pip-office');
  assert.match(result.data.detail, /needs available AI Gateway credits/);
  assert.ok(!JSON.stringify(result.data).includes(deploymentToken));
  assert.ok(!JSON.stringify(result.data).includes(env.CLOUDFLARE_API_TOKEN));
  assert.ok(calls.every(call => call.url.startsWith('https://api.cloudflare.com/')));
  const search = calls.find(call => call.url.endsWith('/websearch/'));
  assert.equal(search.headers.Authorization, `Bearer ${env.CLOUDFLARE_API_TOKEN}`);
  assert.deepEqual(JSON.parse(search.body).options, { gateway: { id: 'pip-office' } });
  assert.equal(JSON.parse(search.body).provider, 'exa');
  assert.ok(calls.filter(call => call.url.endsWith('/settings')).every(call => call.headers.Authorization === `Bearer ${deploymentToken}`));
  const fresh = createOfficeConnections({ db, env });
  await fresh.refresh();
  assert.equal(fresh.env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_API_TOKEN);
  assert.equal(fresh.env.OFFICE_AI_GATEWAY, 'pip-office');
  assert.equal(fresh.env.OFFICE_AI_SEARCH_PROVIDER, 'exa');
});

test('Cloudflare deployment account mismatch and failed Worker verification cannot change credentials', async t => {
  const db = await database(t), account = 'edc675f01dd686d29d7a2e447bc04a8b', deploymentToken = 'workers-deployment-scoped-credential-123456';
  const env = { ...environment(), CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: '' }; let calls = 0;
  const service = createOfficeConnections({ db, env, fetcher: async url => { calls++; return String(url).endsWith('/health') ? json({ configured: true }) : json({ error: deploymentToken }, 403); } });
  assert.equal((await invoke(service.save, { provider: 'cloudflare', body: { deploymentToken, accountId: 'b'.repeat(32) } })).status, 400); assert.equal(calls, 0);
  const result = await invoke(service.save, { provider: 'cloudflare', body: { deploymentToken, accountId: account } });
  assert.equal(result.status, 422); assert.ok(!JSON.stringify(result.data).includes(deploymentToken));
  assert.equal(service.env.CLOUDFLARE_DEPLOY_API_TOKEN, undefined); assert.equal(service.env.OFFICE_AI_RELAY_SECRET, env.OFFICE_AI_RELAY_SECRET);
  assert.equal((await db.query('SELECT * FROM office_provider_connections')).rows.length, 0);
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

test('workspace sources migrate the existing provider constraint, encrypt credentials, persist, and disconnect independently', async t => {
  const db = await database(t), env = { ...environment(), OFFICE_NOTION_TOKEN: 'baseline-notion-credential-123456789',
    OFFICE_SLACK_TOKEN: 'xoxp-baseline-slack-credential-123456789', OFFICE_LINEAR_TOKEN: 'baseline-linear-credential-123456789' };
  const original = { ...env }, calls = [];
  await db.query(`CREATE TABLE office_provider_connections (
    provider TEXT PRIMARY KEY CHECK(provider IN ('github','render','cloudflare')), enabled BOOLEAN NOT NULL,
    encrypted_config TEXT, verified_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/users/me')) return json({ object: 'user', id: 'bot-user' });
    if (url.endsWith('/v1/search')) return json({ results: [] });
    if (url.endsWith('/auth.test')) return json({ ok: true, user_id: 'U1', team_id: 'T1' });
    if (url.endsWith('/assistant.search.context')) return json({ ok: true, results: { messages: [] } });
    if (url.endsWith('/graphql')) return json({ data: { viewer: { id: 'user-1' }, issues: { nodes: [] } } });
    return provider().fetcher(url, options);
  };
  const service = createOfficeConnections({ db, env, fetcher });
  assert.equal((await invoke(service.save, { provider: 'github', body: { token: TOKEN } })).status, 200);
  const github = (await db.query("SELECT encrypted_config FROM office_provider_connections WHERE provider='github'")).rows[0].encrypted_config;
  for (const [id, token] of [['notion', TOKEN], ['slack', `xoxp-${TOKEN}`], ['linear', TOKEN]]) {
    const saved = await invoke(service.save, { provider: id, body: { token } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.connection.chatSource, true);
    assert.equal(saved.data.connection.configured, true);
    assert.ok(!JSON.stringify(saved.data).includes(TOKEN));
    const row = (await db.query('SELECT encrypted_config FROM office_provider_connections WHERE provider=$1', [id])).rows[0];
    assert.match(row.encrypted_config, /^enc:v1:/);
    assert.ok(!row.encrypted_config.includes(token));
    assert.ok(createTokenVault(env).open(row.encrypted_config, `office:provider:${id}`).includes(token));
  }
  assert.equal((await db.query("SELECT encrypted_config FROM office_provider_connections WHERE provider='github'")).rows[0].encrypted_config, github);
  const restarted = createOfficeConnections({ db, env, fetcher });
  await restarted.refresh();
  assert.equal(restarted.env.OFFICE_NOTION_TOKEN, TOKEN);
  assert.equal(restarted.env.OFFICE_SLACK_TOKEN, `xoxp-${TOKEN}`);
  assert.equal(restarted.env.OFFICE_LINEAR_TOKEN, TOKEN);
  for (const id of ['notion', 'slack', 'linear']) {
    const result = await invoke(restarted.disconnect, { provider: id, body: { confirmed: true } });
    assert.equal(result.status, 200); assert.equal(result.data.connection.configured, false);
  }
  const disconnected = createOfficeConnections({ db, env, fetcher });
  await disconnected.refresh();
  assert.equal(disconnected.env.OFFICE_NOTION_TOKEN, '');
  assert.equal(disconnected.env.OFFICE_SLACK_TOKEN, '');
  assert.equal(disconnected.env.OFFICE_LINEAR_TOKEN, '');
  assert.equal(disconnected.env.OFFICE_GITHUB_TOKEN, TOKEN);
  assert.deepEqual(env, original);
  await assert.rejects(db.query("INSERT INTO office_provider_connections(provider,enabled) VALUES('unknown',false)"), /check constraint/);
  assert.ok(calls.every(call => call.options.redirect === 'error'));
});
