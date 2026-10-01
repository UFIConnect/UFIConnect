'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createUfiVault, registerUfiVaultRoutes, assertionBytes } = require('./ufi-vault');

const ORIGIN = 'https://vault.example.test';
const CREDENTIAL = 'test-device-credential-001';
const keys = crypto.generateKeyPairSync('ed25519'); // Test-only software key; never production attestation.
const PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' });
const digest = value => crypto.createHash('sha256').update(value).digest('base64url');

async function fixture(t, overrides = {}) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('alice'), ('bob')");
  let tail = Promise.resolve();
  const control = { now: Date.parse('2026-09-30T12:00:00.000Z'), connected: true, failAudit: false };
  const serial = fn => {
    const result = tail.then(fn);
    tail = result.catch(() => {});
    return result;
  };
  const query = async (sql, values) => {
    if (control.failAudit && sql.startsWith('INSERT INTO ufi_vault_security_events')) throw new Error('Simulated audit storage outage');
    return pg.query(sql, values);
  };
  const db = { isConnected: () => control.connected, query: (sql, values) => serial(() => query(sql, values)),
    withClient: fn => serial(() => fn({ query })) };
  // Explicit test stub. Production defaults have NO manufacturer attestation verifier.
  const attestationVerifier = async ({ assertion }) => ({ verified: true, credentialId: CREDENTIAL, publicKey: PUBLIC_KEY,
    model: 'test-model', firmwareMeasurement: 'test-firmware', environment: 'production', challengeHash: digest(assertion.server_challenge) });
  const vault = createUfiVault({ db, enabled: true, relyingPartyId: 'example.test', allowedOrigins: [ORIGIN],
    firmwarePolicy: [{ model: 'test-model', firmwareMeasurement: 'test-firmware', environment: 'production' }],
    now: () => control.now, attestationVerifier, ...overrides });
  await vault.initialize();
  const challenge = (action = 'verify_device', account = 'alice', origin = ORIGIN) => vault.createChallenge(account,
    { action, credentialId: action === 'enroll_device' ? null : CREDENTIAL, parameters: {} }, origin);
  function signed(challengeResult, count, changes = {}) {
    const assertion = { ...challengeResult.context, credential_id: CREDENTIAL, issued_at_rtc: control.now,
      monotonic_counter: String(count), firmware_measurement: 'test-firmware', user_presence: true, user_verification: true, ...changes };
    return { challengeId: challengeResult.challengeId, assertion,
      signature: crypto.sign(null, assertionBytes(assertion), keys.privateKey).toString('base64url'),
      ...(assertion.action_type === 'enroll_device' ? { attestation: { testOnly: true } } : {}) };
  }
  async function enroll() { const value = await challenge('enroll_device'); return vault.verifyAssertion('alice', signed(value, 1), ORIGIN); }
  return { pg, vault, db, control, challenge, signed, enroll };
}

test('Vault defaults disabled and rejects unconfigured enrollment without persisting anything', async t => {
  const unusedDB = { isConnected: () => true, query() { throw new Error('Must not read disabled storage'); } };
  const disabled = createUfiVault({ db: unusedDB });
  assert.equal(await disabled.initialize(), false);
  assert.equal((await disabled.status('alice')).state, 'disabled');
  await assert.rejects(() => disabled.createChallenge('alice', {}, ORIGIN), { status: 503 });
  const { vault, challenge } = await fixture(t, { attestationVerifier: null });
  assert.equal((await vault.status('alice')).enrollmentAvailable, false);
  await assert.rejects(() => challenge('enroll_device'), { status: 503 });
});

test('verified enrollment and assertions retain only public data and enforce one-use challenges', async t => {
  const f = await fixture(t);
  await f.enroll();
  const value = await f.challenge();
  assert.equal(Buffer.from(value.context.server_challenge, 'base64url').length, 32);
  const body = f.signed(value, 2);
  const result = await f.vault.verifyAssertion('alice', body, ORIGIN);
  assert.equal(result.verified, true);
  assert.equal(result.scope, 'device-verification-only');
  await assert.rejects(() => f.vault.verifyAssertion('alice', body, ORIGIN));
  const state = await f.vault.status('alice');
  assert.equal(state.credentials.active, 1);
  assert.equal(state.hardwareIntegrated, false);
  assert.equal(state.protectsBrowserVault, false);
  assert.equal((await f.vault.status('bob')).credentials.active, 0);
  assert.equal(JSON.stringify(state).includes(CREDENTIAL), false);
  const stored = await f.pg.query('SELECT * FROM ufi_vault_challenges WHERE id = $1', [value.challengeId]);
  assert.equal(JSON.stringify(stored.rows).includes(value.context.server_challenge), false);
  assert.match((await f.pg.query('SELECT public_key FROM ufi_vault_credentials')).rows[0].public_key, /BEGIN PUBLIC KEY/);
});

test('signature failure consumes a challenge and cannot quarantine the device', async t => {
  const f = await fixture(t); await f.enroll();
  const value = await f.challenge();
  const original = f.signed(value, 2);
  await assert.rejects(() => f.vault.verifyAssertion('alice', { ...original, signature: 'A'.repeat(86) }, ORIGIN));
  await assert.rejects(() => f.vault.verifyAssertion('alice', original, ORIGIN));
  assert.equal((await f.vault.status('alice')).credentials.active, 1);
  assert.equal((await f.pg.query('SELECT last_counter FROM ufi_vault_credentials')).rows[0].last_counter, '1');
});

test('origin, account, action, parameter hash, presence, verification, and version bindings reject substitutions', async t => {
  const f = await fixture(t); await f.enroll();
  for (const changes of [{ origin_hash: digest('https://evil.example.test') }, { account_binding: digest('bob') },
    { action_type: 'export_vault' }, { action_parameters_hash: digest('{"all":true}') }, { user_presence: false },
    { user_verification: false }, { protocol_version: 'older-version' }, { relying_party_id: 'evil.example.test' }]) {
    const value = await f.challenge();
    await assert.rejects(() => f.vault.verifyAssertion('alice', f.signed(value, 2, changes), ORIGIN));
  }
  const value = await f.challenge();
  const valid = f.signed(value, 2);
  await assert.rejects(() => f.vault.verifyAssertion('bob', valid, ORIGIN));
  assert.equal((await f.vault.verifyAssertion('alice', valid, ORIGIN)).verified, true);
  const other = await f.challenge();
  await assert.rejects(() => f.vault.verifyAssertion('alice', f.signed(other, 3), 'https://evil.example.test'));
  await assert.rejects(() => f.vault.verifyAssertion('alice', f.signed(other, 3), ORIGIN));
});

test('server expiry and signed RTC are authoritative; malformed assertions remain spent', async t => {
  const f = await fixture(t); await f.enroll();
  let value = await f.challenge();
  let body = f.signed(value, 2);
  f.control.now += 60_001;
  await assert.rejects(() => f.vault.verifyAssertion('alice', body, ORIGIN));
  value = await f.challenge();
  body = f.signed(value, 2, { issued_at_rtc: f.control.now + 60_001 });
  await assert.rejects(() => f.vault.verifyAssertion('alice', body, ORIGIN));
  value = await f.challenge();
  body = f.signed(value, 2);
  await assert.rejects(() => f.vault.verifyAssertion('alice', { ...body, unexpected: 'field' }, ORIGIN));
  await assert.rejects(() => f.vault.verifyAssertion('alice', body, ORIGIN));
});

test('one pending ceremony prevents counter races; repeated signed counter quarantines only that credential', async t => {
  const f = await fixture(t); await f.enroll();
  const value = await f.challenge();
  await assert.rejects(() => f.challenge(), { status: 409 });
  const body = f.signed(value, 2);
  const concurrent = await Promise.allSettled([f.vault.verifyAssertion('alice', body, ORIGIN), f.vault.verifyAssertion('alice', body, ORIGIN)]);
  assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal((await f.vault.status('alice')).credentials.active, 1);
  const next = await f.challenge();
  await assert.rejects(() => f.vault.verifyAssertion('alice', f.signed(next, 2), ORIGIN), { code: 'device_check_required' });
  assert.equal((await f.vault.status('alice')).credentials.quarantined, 1);
  await assert.rejects(() => f.challenge());
});

test('signed clock rollback quarantines and revocation invalidates outstanding approvals', async t => {
  const f = await fixture(t); await f.enroll();
  let value = await f.challenge();
  await assert.rejects(() => f.vault.verifyAssertion('alice', f.signed(value, 2, { issued_at_rtc: f.control.now - 1 }), ORIGIN), { code: 'device_check_required' });
  await f.vault.revokeCredential('alice', CREDENTIAL);
  assert.equal((await f.vault.status('alice')).credentials.revoked, 1);
  await assert.rejects(() => f.challenge());
});

test('revocation consumes issued challenges and never affects another account', async t => {
  const f = await fixture(t); await f.enroll();
  const value = await f.challenge();
  await assert.rejects(() => f.vault.revokeCredential('bob', CREDENTIAL));
  await f.vault.revokeCredential('alice', CREDENTIAL);
  await assert.rejects(() => f.vault.verifyAssertion('alice', f.signed(value, 2), ORIGIN));
  const rows = await f.pg.query('SELECT consumed_at FROM ufi_vault_challenges WHERE id = $1', [value.challengeId]);
  assert.ok(rows.rows[0].consumed_at);
});

test('counter and audit changes roll back together while challenge consumption survives failure', async t => {
  const f = await fixture(t); await f.enroll();
  const value = await f.challenge();
  const body = f.signed(value, 2);
  f.control.failAudit = true;
  await assert.rejects(() => f.vault.verifyAssertion('alice', body, ORIGIN));
  f.control.failAudit = false;
  assert.equal((await f.pg.query('SELECT last_counter FROM ufi_vault_credentials')).rows[0].last_counter, '1');
  await assert.rejects(() => f.vault.verifyAssertion('alice', body, ORIGIN));
});

test('attestation failure, wrong firmware, and private key import cannot activate a credential', async t => {
  for (const change of [{ verified: false }, { firmwareMeasurement: 'unapproved-firmware' }, { environment: 'development' },
    { publicKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) }]) {
    const f = await fixture(t, { attestationVerifier: async ({ assertion }) => ({ verified: true, credentialId: CREDENTIAL,
      publicKey: PUBLIC_KEY, model: 'test-model', firmwareMeasurement: 'test-firmware', environment: 'production',
      challengeHash: digest(assertion.server_challenge), ...change }) });
    await assert.rejects(() => f.enroll());
    assert.equal((await f.vault.status('alice')).credentials.active, 0);
  }
});

test('database loss fails closed; challenge and audit retention remove old metadata', async t => {
  const f = await fixture(t); await f.enroll();
  f.control.connected = false;
  await assert.rejects(() => f.challenge(), { status: 503 });
  assert.equal((await f.vault.status('alice')).available, false);
  f.control.connected = true;
  f.control.now += 31 * 86400_000;
  await f.vault.prune();
  assert.equal((await f.pg.query('SELECT COUNT(*)::integer AS total FROM ufi_vault_challenges')).rows[0].total, 0);
  assert.equal((await f.pg.query('SELECT COUNT(*)::integer AS total FROM ufi_vault_security_events')).rows[0].total, 0);
  assert.equal((await f.vault.status('alice')).credentials.active, 1);
});

test('route registration requires authentication and rate limits on every endpoint', () => {
  const routes = [];
  const app = { get: (...args) => routes.push(args), post: (...args) => routes.push(args) };
  const authenticate = () => {}; const limiter = () => {};
  assert.throws(() => registerUfiVaultRoutes(app, { vault: {}, authenticate }));
  registerUfiVaultRoutes(app, { vault: {}, authenticate, limiter });
  assert.equal(routes.length, 3);
  for (const route of routes) { assert.equal(route[1], authenticate); assert.equal(route[2], limiter); }
});

test('enrollment delayed across account deletion cannot recreate an orphan credential', async t => {
  const f = await fixture(t);
  const value = await f.challenge('enroll_device');
  await f.pg.query("DELETE FROM users WHERE id = 'alice'");
  await assert.rejects(() => f.vault.verifyAssertion('alice', f.signed(value, 1), ORIGIN), { status: 401 });
  assert.equal((await f.pg.query('SELECT COUNT(*)::integer AS total FROM ufi_vault_credentials')).rows[0].total, 0);
  assert.equal((await f.pg.query('SELECT COUNT(*)::integer AS total FROM ufi_vault_security_events')).rows[0].total, 0);
  await assert.rejects(() => f.challenge('enroll_device'), { status: 401 });
});
