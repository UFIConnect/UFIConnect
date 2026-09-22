const test = require('node:test');
const assert = require('node:assert/strict');
const { createManagedRecovery } = require('./managed-recovery');
const { createAppHarness } = require('./test-support/app-harness');

const env = { RENDER_API_KEY: 'private-provider-key', RENDER_DATABASE_ID: 'dpg-primary123-a', RENDER_BACKUP_DATABASE_ID: 'dpg-feedcopy123-a' };
const startsAt = '2026-09-20T12:00:00.000Z';
const nowAt = Date.parse('2026-09-22T12:00:00.000Z');
function provider(counter = []) {
  return async (url, options) => {
    counter.push({ url, options });
    const value = url.endsWith('/recovery') ? { recoveryStatus: 'AVAILABLE', startsAt, privateField: 'private-raw-response' }
      : url.endsWith('/export') ? [{ createdAt: startsAt, url: 'https://private-export.invalid/signed-secret' }]
        : { status: url.includes('feedcopy') ? 'suspended' : 'available', connectionString: 'postgres://private-password' };
    return { ok: true, json: async () => value };
  };
}

test('managed recovery reports primary recovery separately from suspended feed copy and strips provider secrets', async () => {
  const requests = [];
  const recovery = createManagedRecovery({ env, fetcher: provider(requests), now: () => nowAt });
  const result = await recovery.read();
  assert.equal(result.status, 'available');
  assert.equal(result.primary.recovery.status, 'available');
  assert.equal(result.primary.recovery.startsAt, startsAt);
  assert.deepEqual(result.primary.latestExport, { createdAt: startsAt, available: true });
  assert.equal(result.feedReplica.state, 'suspended');
  assert.equal(result.refreshing, false);
  assert.doesNotMatch(JSON.stringify(result), /private-|postgres:|signed-secret|dpg-/);
  assert.equal(requests.length, 4);
  for (const request of requests) {
    assert.equal(request.options.method, undefined, 'Provider calls use GET only');
    assert.equal(request.options.redirect, 'error');
    assert.ok(request.options.signal instanceof AbortSignal);
  }
});

test('concurrent reads and frequent status polls share one request batch; expired evidence is not green', async () => {
  let now = nowAt;
  const requests = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let blocked = true;
  const recovery = createManagedRecovery({ env, now: () => now, fetcher: async (...args) => { if (blocked) await gate; return provider(requests)(...args); } });
  const first = recovery.peek();
  assert.equal(first.status, 'unknown');
  assert.equal(first.refreshing, true);
  const pending = Promise.all([recovery.read(), recovery.read()]);
  release(); blocked = false;
  await pending;
  for (let index = 0; index < 10; index++) assert.equal(recovery.peek().status, 'available');
  assert.equal(requests.length, 4);
  now += 60_001;
  assert.equal(recovery.peek().status, 'stale');
  await recovery.read();
  assert.equal(requests.length, 8);
});

test('provider failures replace prior green evidence with unknown and expose only fixed error codes', async () => {
  let failed = false;
  let now = nowAt;
  const recovery = createManagedRecovery({ env, now: () => now, fetcher: async (...args) => {
    if (failed) throw new Error('private-key postgres://private-provider-error');
    return provider()(...args);
  } });
  assert.equal((await recovery.read()).status, 'available');
  failed = true; now += 60_001;
  const result = await recovery.read();
  assert.equal(result.status, 'unknown');
  assert.equal(result.primary.recovery.status, 'unknown');
  assert.equal(result.primary.latestExport, null);
  assert.equal(result.issues.length, 4);
  assert.doesNotMatch(JSON.stringify(result), /private-|postgres:/);
});

test('verified primary PITR stays available when independent feed or export metadata cannot be read', async () => {
  for (const component of ['feedReplica', 'exports']) {
    const recovery = createManagedRecovery({ env, now: () => nowAt, fetcher: async (...args) => {
      if (component === 'feedReplica' ? args[0].includes('feedcopy') : args[0].endsWith('/export')) return { ok: false, status: 403 };
      return provider()(...args);
    } });
    const result = await recovery.read();
    assert.equal(result.status, 'available', `${component} cannot change the verified primary recovery result`);
    assert.equal(result.primary.recovery.status, 'available');
    assert.deepEqual(result.issues, [{ component, code: 'access_denied' }]);
    if (component === 'feedReplica') assert.equal(result.feedReplica.state, 'unknown');
    else {
      assert.equal(result.primary.exportsChecked, false);
      assert.equal(result.primary.latestExport, null);
    }
  }
});

test('malformed responses, unavailable recovery and missing configuration never imply availability', async () => {
  const invalid = createManagedRecovery({ env, fetcher: async () => ({ ok: true, json: async () => ({ private: 'private-raw-value' }) }) });
  assert.equal((await invalid.read()).status, 'unknown');
  const unavailable = createManagedRecovery({ env, fetcher: async (...args) => args[0].endsWith('/recovery')
    ? { ok: true, json: async () => ({ recoveryStatus: 'BACKUP_NOT_READY' }) } : provider()(...args) });
  assert.equal((await unavailable.read()).status, 'unavailable');
  const missing = createManagedRecovery({ env: { ...env, RENDER_DATABASE_ID: '../private-path' }, fetcher: () => { throw new Error('Must not fetch'); } });
  assert.equal((await missing.read()).status, 'not_configured');
  const denied = createManagedRecovery({ env, fetcher: async () => ({ ok: false, status: 403, json: () => { throw new Error('Must not read provider error'); } }) });
  assert.ok((await denied.read()).issues.every(issue => issue.code === 'access_denied'));
});

test('provider timeout aborts pending network requests without exposing a raw error', async () => {
  const recovery = createManagedRecovery({ env, timeoutMs: 15, fetcher: (_, options) => new Promise((_, reject) => {
    const keepAlive = setTimeout(() => reject(new Error('Timeout did not abort')), 1000);
    options.signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(options.signal.reason); }, { once: true });
  }) });
  assert.equal((await recovery.read()).status, 'unknown');
});

test('Office recovery endpoint requires Office authorization and prevents pipeline provider polling', async t => {
  let reads = 0;
  const app = await createAppHarness({ env: { OFFICE_TOKEN: 'recovery-audit-token' }, modules: {
    './managed-recovery': { createManagedRecovery: () => ({ read: async () => { reads++; return { status: 'available' }; }, peek: () => ({ status: 'unknown' }) }) },
  } });
  t.after(() => app.close());
  assert.equal((await app.request('/office/recovery')).status, 401);
  assert.equal((await app.request('/office/recovery', { headers: { 'x-office-token': 'wrong' } })).status, 401);
  assert.equal(reads, 0);
  const response = await app.request('/office/recovery', { headers: { 'x-office-token': 'recovery-audit-token' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(reads, 1);
  const pipeline = await createAppHarness({ env: { SERVICE_ROLE: 'pipeline', OFFICE_TOKEN: 'recovery-audit-token' }, modules: {
    './managed-recovery': { createManagedRecovery: () => ({ read: async () => { throw new Error('Pipeline must not poll'); }, peek: () => { throw new Error('Pipeline must not poll'); } }) },
  } });
  t.after(() => pipeline.close());
  assert.equal((await pipeline.request('/office/recovery', { headers: { 'x-office-token': 'recovery-audit-token' } })).status, 409);
});
