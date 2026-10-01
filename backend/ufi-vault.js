'use strict';

// Optional server prototype for the supplied UFI Vault Security Architecture v0.1.
// Hardware, NFC pairing, recovery, and production attestation are separate release gates.
const crypto = require('node:crypto');

const PROTOCOL = 'ufi-vault-admin-v1';
const MAX_COUNTER = 18446744073709551615n;
const CHALLENGE_LIFETIME_MS = 60_000;
const RTC_WINDOW_MS = 60_000;
const INPUT_LIMIT_BYTES = 16_384;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9_-]{16,128}$/;
const ASSERTION_FIELDS = ['protocol_version', 'credential_id', 'account_binding', 'relying_party_id',
  'origin_hash', 'action_type', 'action_parameters_hash', 'server_challenge', 'expires_at',
  'issued_at_rtc', 'monotonic_counter', 'firmware_measurement', 'user_presence', 'user_verification'];

const UFI_VAULT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ufi_vault_credentials (
    credential_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    public_key TEXT NOT NULL,
    model TEXT NOT NULL,
    firmware_measurement TEXT NOT NULL,
    environment TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'quarantined', 'revoked')),
    last_counter NUMERIC(20,0) NOT NULL CHECK (last_counter >= 0 AND last_counter <= 18446744073709551615),
    last_rtc TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ufi_vault_credentials_account ON ufi_vault_credentials (account_id)`,
  `CREATE TABLE IF NOT EXISTS ufi_vault_challenges (
    id UUID PRIMARY KEY,
    account_id TEXT NOT NULL,
    credential_id TEXT,
    challenge_hash TEXT NOT NULL UNIQUE,
    context JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ufi_vault_one_pending_credential
    ON ufi_vault_challenges (credential_id) WHERE credential_id IS NOT NULL AND finished_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS ufi_vault_challenges_account ON ufi_vault_challenges (account_id, expires_at)`,
  `CREATE TABLE IF NOT EXISTS ufi_vault_security_events (
    id UUID PRIMARY KEY,
    account_id TEXT NOT NULL,
    event_class TEXT NOT NULL,
    result_code TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL
  )`,
];

function failure(code = 'verification_failed', status = 400) {
  const error = new Error(status === 503 ? 'Vault verification is unavailable.' : 'Vault verification could not be completed.');
  error.code = code;
  error.status = status;
  return error;
}
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exactFields(value, keys) { return plain(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('base64url'); }
function accountBinding(accountId) { return hash(`${PROTOCOL}\0account\0${accountId}`); }
function canonical(value, depth = 0) {
  if (depth > 8) throw failure();
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(item => canonical(item, depth + 1)).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(',')}}`;
  throw failure();
}
function assertionBytes(assertion) {
  if (!exactFields(assertion, ASSERTION_FIELDS)) throw failure();
  return Buffer.from(`${PROTOCOL}\0assertion\0${canonical(assertion)}`, 'utf8');
}
function counter(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value)) throw failure();
  const parsed = BigInt(value);
  if (parsed > MAX_COUNTER) throw failure();
  return parsed;
}
function publicKey(pem) {
  if (typeof pem !== 'string' || pem.length > 4096 || !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(pem)) throw failure();
  const key = crypto.createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw failure();
  return key;
}
function checkSignature(assertion, signature, pem) {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(signature)) throw failure();
  const bytes = Buffer.from(signature, 'base64url');
  if (bytes.toString('base64url') !== signature || !crypto.verify(null, assertionBytes(assertion), publicKey(pem), bytes)) throw failure();
}

function createUfiVault({ db, enabled = false, relyingPartyId = '', allowedOrigins = [], firmwarePolicy = [],
  environment = 'production', attestationVerifier = null, now = Date.now } = {}) {
  let initialized = false;
  const origins = new Set();
  const policy = new Set();
  for (const origin of allowedOrigins) {
    try {
      const parsed = new URL(origin);
      const local = environment === 'development' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
      if (parsed.origin !== origin || (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) || parsed.username || parsed.password) continue;
      if (parsed.hostname !== relyingPartyId && !parsed.hostname.endsWith(`.${relyingPartyId}`)) continue;
      origins.add(origin);
    } catch { /* Invalid configuration keeps verification disabled. */ }
  }
  for (const item of firmwarePolicy) {
    if (plain(item) && ['model', 'firmwareMeasurement', 'environment'].every(key => typeof item[key] === 'string' && item[key].length > 0 && item[key].length <= 256)) {
      policy.add(JSON.stringify([item.model, item.firmwareMeasurement, item.environment]));
    }
  }
  const configured = enabled === true && typeof relyingPartyId === 'string' && relyingPartyId.length > 0
    && ['development', 'production'].includes(environment) && origins.size > 0 && policy.size > 0;
  function ready() {
    if (!configured || !initialized || !db?.isConnected?.()) throw failure('unavailable', 503);
  }
  function identity(accountId) {
    if (typeof accountId !== 'string' || !accountId || accountId.length > 128) throw failure('unauthorized', 401);
  }
  function allowedFirmware(model, firmware, deviceEnvironment) {
    return deviceEnvironment === environment && policy.has(JSON.stringify([model, firmware, deviceEnvironment]));
  }
  async function transaction(work) {
    return db.withClient(async client => {
      await client.query('BEGIN');
      try { const result = await work(client); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
    });
  }
  async function event(client, accountId, result, at) {
    await client.query(`INSERT INTO ufi_vault_security_events (id, account_id, event_class, result_code, occurred_at)
      VALUES ($1, $2, 'device_verification', $3, $4)`, [crypto.randomUUID(), accountId, result, new Date(at).toISOString()]);
  }
  async function lockAccount(client, accountId, required = true) {
    // Account deletion first locks this same user row FOR UPDATE. Hold a
    // conflicting key-share lock through credential/challenge creation so an
    // assertion that outlives its account cannot recreate orphaned records.
    const result = await client.query('SELECT id FROM users WHERE id::text = $1 FOR KEY SHARE', [accountId]);
    if (!result.rows.length && required) throw failure('unauthorized', 401);
    return result.rows.length > 0;
  }
  async function initialize() {
    if (!enabled || !db?.isConnected?.()) return false;
    for (const sql of UFI_VAULT_SCHEMA) await db.query(sql);
    initialized = true;
    return configured;
  }
  async function status(accountId) {
    identity(accountId);
    const available = configured && initialized && !!db?.isConnected?.();
    const result = { architecture: 'UFI Vault Security Architecture v0.1', phase: 'software-prototype',
      enabled: enabled === true, available, state: !enabled ? 'disabled' : available ? 'configured' : 'unavailable',
      enrollmentAvailable: available && typeof attestationVerifier === 'function',
      credentials: { active: 0, quarantined: 0, revoked: 0 }, lastVerifiedAt: null,
      hardwareIntegrated: false, protectsBrowserVault: false,
      pending: ['secure_element', 'attestation_adapter', 'nfc_pairing', 'independent_recovery', 'hardware_vpn_keys', 'independent_security_review'] };
    if (available) {
      try {
        const { rows } = await db.query(`SELECT status, COUNT(*)::integer AS total, MAX(verified_at) AS verified_at
          FROM ufi_vault_credentials WHERE account_id = $1 GROUP BY status`, [accountId]);
        for (const row of rows) {
          if (Object.hasOwn(result.credentials, row.status)) result.credentials[row.status] = Number(row.total);
          const date = new Date(row.verified_at);
          if (Number.isFinite(date.getTime()) && (!result.lastVerifiedAt || date > new Date(result.lastVerifiedAt))) result.lastVerifiedAt = date.toISOString();
        }
      } catch { result.available = false; result.state = 'unavailable'; result.enrollmentAvailable = false; }
    }
    return result;
  }
  async function createChallenge(accountId, input, origin) {
    identity(accountId); ready();
    if (!origins.has(origin) || !exactFields(input, ['action', 'credentialId', 'parameters']) ||
      !['enroll_device', 'verify_device'].includes(input.action) || !exactFields(input.parameters, [])) throw failure();
    const enrolling = input.action === 'enroll_device';
    if (enrolling && typeof attestationVerifier !== 'function') throw failure('enrollment_unavailable', 503);
    if (enrolling ? input.credentialId !== null : typeof input.credentialId !== 'string' || !ID.test(input.credentialId)) throw failure();
    const issued = now();
    const nonce = crypto.randomBytes(32).toString('base64url');
    const context = { protocol_version: PROTOCOL, credential_id: input.credentialId,
      account_binding: accountBinding(accountId), relying_party_id: relyingPartyId,
      origin_hash: hash(origin), action_type: input.action, action_parameters_hash: hash(canonical(input.parameters)),
      server_challenge: nonce, expires_at: new Date(issued + CHALLENGE_LIFETIME_MS).toISOString() };
    const id = crypto.randomUUID();
    await transaction(async client => {
      // One ceremony per account prevents concurrent device responses from creating false clone alerts.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${PROTOCOL}:${accountId}`]);
      await lockAccount(client, accountId);
      if (!enrolling) {
        const { rows } = await client.query('SELECT * FROM ufi_vault_credentials WHERE credential_id = $1 AND account_id = $2 FOR UPDATE', [input.credentialId, accountId]);
        const credential = rows[0];
        if (!credential || credential.status !== 'active' || !allowedFirmware(credential.model, credential.firmware_measurement, credential.environment)) throw failure();
      }
      await client.query('UPDATE ufi_vault_challenges SET consumed_at = COALESCE(consumed_at, $2), finished_at = $2 WHERE account_id = $1 AND expires_at <= $2 AND finished_at IS NULL', [accountId, new Date(issued).toISOString()]);
      const pending = await client.query('SELECT id FROM ufi_vault_challenges WHERE account_id = $1 AND finished_at IS NULL LIMIT 1', [accountId]);
      if (pending.rows.length) throw failure('pending_challenge', 409);
      // Retain only one day of spent challenge metadata; never store the challenge nonce.
      await client.query("DELETE FROM ufi_vault_challenges WHERE account_id = $1 AND expires_at < $2::timestamptz - INTERVAL '1 day'", [accountId, new Date(issued).toISOString()]);
      const storedContext = { ...context }; delete storedContext.server_challenge;
      await client.query(`INSERT INTO ufi_vault_challenges (id, account_id, credential_id, challenge_hash, context, created_at, expires_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`, [id, accountId, input.credentialId, hash(nonce), JSON.stringify(storedContext), new Date(issued).toISOString(), context.expires_at]);
    });
    return { challengeId: id, context, serverTime: new Date(issued).toISOString() };
  }
  async function verifyAssertion(accountId, input, origin) {
    identity(accountId); ready();
    if (!plain(input) || typeof input.challengeId !== 'string' || !UUID.test(input.challengeId)) throw failure();
    const received = now();
    // Commit consumption BEFORE validation/transactions. Failure, rollback, and concurrent replay
    // cannot make a recognized account-owned challenge usable again.
    const claim = await db.query(`UPDATE ufi_vault_challenges SET consumed_at = $3
      WHERE id = $1 AND account_id = $2 AND consumed_at IS NULL RETURNING *`, [input.challengeId, accountId, new Date(received).toISOString()]);
    const challenge = claim.rows[0];
    if (!challenge) throw failure();
    let completed = false;
    try {
      const enrolling = challenge.context.action_type === 'enroll_device';
      if (!exactFields(input, enrolling ? ['challengeId', 'assertion', 'signature', 'attestation'] : ['challengeId', 'assertion', 'signature']) ||
        Buffer.byteLength(canonical(input), 'utf8') > INPUT_LIMIT_BYTES || !origins.has(origin) ||
        received >= new Date(challenge.expires_at).getTime()) throw failure();
      const assertion = input.assertion;
      assertionBytes(assertion);
      if (typeof assertion.credential_id !== 'string' || !ID.test(assertion.credential_id) || typeof assertion.server_challenge !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(assertion.server_challenge) || hash(assertion.server_challenge) !== challenge.challenge_hash ||
        assertion.origin_hash !== hash(origin) || assertion.user_presence !== true || assertion.user_verification !== true ||
        typeof assertion.firmware_measurement !== 'string' || assertion.firmware_measurement.length > 256 ||
        !Number.isSafeInteger(assertion.issued_at_rtc) || Math.abs(received - assertion.issued_at_rtc) > RTC_WINDOW_MS) throw failure();
      for (const [key, value] of Object.entries(challenge.context)) {
        if (!(enrolling && key === 'credential_id') && assertion[key] !== value) throw failure();
      }
      const signedCounter = counter(assertion.monotonic_counter);
      let attested;
      if (enrolling) {
        if (typeof attestationVerifier !== 'function') throw failure('enrollment_unavailable', 503);
        // Adapter MUST validate manufacturer roots, revocation, firmware evidence, environment,
        // and the full challenge binding. There is deliberately no permissive fallback.
        attested = await attestationVerifier({ evidence: input.attestation, assertion: Object.freeze({ ...assertion }),
          context: Object.freeze({ ...challenge.context, server_challenge: assertion.server_challenge }), environment });
        if (!plain(attested) || attested.verified !== true || attested.credentialId !== assertion.credential_id ||
          attested.challengeHash !== challenge.challenge_hash || attested.firmwareMeasurement !== assertion.firmware_measurement ||
          !allowedFirmware(attested.model, attested.firmwareMeasurement, attested.environment)) throw failure();
        checkSignature(assertion, input.signature, attested.publicKey);
      }
      const result = await transaction(async client => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${PROTOCOL}:${accountId}`]);
        await lockAccount(client, accountId);
        let credential;
        if (!enrolling) {
          const { rows } = await client.query('SELECT * FROM ufi_vault_credentials WHERE credential_id = $1 AND account_id = $2 FOR UPDATE', [assertion.credential_id, accountId]);
          credential = rows[0];
          if (!credential || credential.status !== 'active' || !allowedFirmware(credential.model, assertion.firmware_measurement, credential.environment) ||
            assertion.firmware_measurement !== credential.firmware_measurement) throw failure();
          checkSignature(assertion, input.signature, credential.public_key);
        }
        const committedAt = now();
        if (committedAt >= new Date(challenge.expires_at).getTime() || Math.abs(committedAt - assertion.issued_at_rtc) > RTC_WINDOW_MS) throw failure();
        const badState = signedCounter <= BigInt(credential?.last_counter || '0') ||
          (credential && assertion.issued_at_rtc < new Date(credential.last_rtc).getTime());
        if (badState) {
          // Only a valid, bound signature can quarantine a credential.
          if (credential) await client.query("UPDATE ufi_vault_credentials SET status = 'quarantined' WHERE credential_id = $1 AND account_id = $2", [assertion.credential_id, accountId]);
          await event(client, accountId, 'device_check_required', committedAt);
          await client.query('UPDATE ufi_vault_challenges SET finished_at = $2 WHERE id = $1', [input.challengeId, new Date(committedAt).toISOString()]);
          return { checkRequired: true };
        }
        if (enrolling) {
          const count = await client.query('SELECT COUNT(*)::integer AS total FROM ufi_vault_credentials WHERE account_id = $1', [accountId]);
          if (count.rows[0].total >= 10) throw failure();
          await client.query(`INSERT INTO ufi_vault_credentials
            (credential_id, account_id, public_key, model, firmware_measurement, environment, status, last_counter, last_rtc, created_at, verified_at)
            VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, $9)`,
          [attested.credentialId, accountId, publicKey(attested.publicKey).export({ type: 'spki', format: 'pem' }), attested.model,
            attested.firmwareMeasurement, attested.environment, assertion.monotonic_counter, new Date(assertion.issued_at_rtc).toISOString(), new Date(committedAt).toISOString()]);
        } else {
          await client.query(`UPDATE ufi_vault_credentials SET last_counter = $3, last_rtc = $4, verified_at = $5
            WHERE credential_id = $1 AND account_id = $2`, [assertion.credential_id, accountId, assertion.monotonic_counter,
            new Date(assertion.issued_at_rtc).toISOString(), new Date(committedAt).toISOString()]);
        }
        await event(client, accountId, enrolling ? 'enrolled' : 'verified', committedAt);
        await client.query('UPDATE ufi_vault_challenges SET finished_at = $2 WHERE id = $1', [input.challengeId, new Date(committedAt).toISOString()]);
        return { verified: true, action: challenge.context.action_type, verifiedAt: new Date(committedAt).toISOString(), scope: 'device-verification-only' };
      });
      completed = true;
      if (result.checkRequired) throw failure('device_check_required');
      return result;
    } finally {
      if (!completed) {
        // The challenge stays spent even if this cleanup fails. An in-flight ceremony
        // blocks new challenges until it finishes or its server deadline expires.
        await transaction(async client => {
          if (!await lockAccount(client, accountId, false)) return;
          await event(client, accountId, 'rejected', now());
          await client.query('UPDATE ufi_vault_challenges SET finished_at = $2 WHERE id = $1', [input.challengeId, new Date(now()).toISOString()]);
        });
      }
    }
  }
  // Trusted administrative integration only. No public revocation/recovery shortcut.
  async function revokeCredential(accountId, credentialId) {
    identity(accountId); ready();
    if (typeof credentialId !== 'string' || !ID.test(credentialId)) throw failure();
    await transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${PROTOCOL}:${accountId}`]);
      const result = await client.query("UPDATE ufi_vault_credentials SET status = 'revoked' WHERE account_id = $1 AND credential_id = $2 RETURNING credential_id", [accountId, credentialId]);
      if (!result.rows.length) throw failure();
      const at = new Date(now()).toISOString();
      await client.query('UPDATE ufi_vault_challenges SET consumed_at = COALESCE(consumed_at, $3), finished_at = $3 WHERE account_id = $1 AND credential_id = $2 AND finished_at IS NULL', [accountId, credentialId, at]);
      await event(client, accountId, 'revoked', now());
    });
  }
  async function prune() {
    ready();
    const at = new Date(now()).toISOString();
    await db.query("DELETE FROM ufi_vault_challenges WHERE expires_at < $1::timestamptz - INTERVAL '1 day'", [at]);
    await db.query("DELETE FROM ufi_vault_security_events WHERE occurred_at < $1::timestamptz - INTERVAL '30 days'", [at]);
  }
  return { initialize, status, createChallenge, verifyAssertion, revokeCredential, prune };
}

function registerUfiVaultRoutes(app, { vault, authenticate, limiter }) {
  if (!vault || typeof authenticate !== 'function' || typeof limiter !== 'function') throw new TypeError('Vault routes require authentication and rate limiting.');
  const wrap = handler => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!req.user?.id) throw failure('unauthorized', 401);
      return res.json(await handler(req));
    } catch (error) {
      const status = [400, 401, 409, 503].includes(error.status) ? error.status : 503;
      // Never return raw DB, crypto, attestation, key, account, or counter details.
      return res.status(status).json({ error: status === 503 ? 'Vault verification is unavailable.' : 'Vault verification could not be completed.' });
    }
  };
  app.get('/security/vault/status', authenticate, limiter, wrap(req => vault.status(req.user.id)));
  app.post('/security/vault/challenges', authenticate, limiter, wrap(req => vault.createChallenge(req.user.id, req.body, req.get('origin'))));
  app.post('/security/vault/assertions', authenticate, limiter, wrap(req => vault.verifyAssertion(req.user.id, req.body, req.get('origin'))));
}

module.exports = { createUfiVault, registerUfiVaultRoutes, UFI_VAULT_SCHEMA, PROTOCOL, assertionBytes };
