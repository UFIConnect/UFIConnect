'use strict';

// Only client-encrypted envelopes belong here. Never accept passphrases,
// plaintext entries, device credentials, or a client-supplied account identity.
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
const VAULT_STORAGE_SCHEMA = [`CREATE TABLE IF NOT EXISTS account_vaults (
  account_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  record JSONB NOT NULL CHECK (octet_length(record::text) <= 4194304),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`];
const failure = (status, message) => Object.assign(new Error(message), { status });
function fields(value, names) {
  return value && !Array.isArray(value) && typeof value === 'object'
    && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}
function base64(value, min, max = min) {
  if (typeof value !== 'string' || value.length > MAX_RECORD_BYTES || value.length % 4
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length >= min && bytes.length <= max && bytes.toString('base64') === value;
}
function box(value, min, max = min) {
  return fields(value, ['iv', 'data']) && base64(value.iv, 12) && base64(value.data, min, max);
}
function validateRecord(value) {
  if (!fields(value, ['version', 'kdf', 'wrappedKey', 'content']) || value.version !== 1
    || !fields(value.kdf, ['salt', 'iterations']) || value.kdf.iterations !== 600000
    || !base64(value.kdf.salt, 16) || !box(value.wrappedKey, 48)
    || !box(value.content, 16, 2 * 1024 * 1024 + 16)
    || Buffer.byteLength(JSON.stringify(value)) > MAX_RECORD_BYTES) {
    throw failure(400, 'A supported encrypted vault record is required.');
  }
  return value;
}
function createVaultStorage(db) {
  const available = () => { if (!db.isConnected()) throw failure(503, 'Vault account storage is unavailable. Your saved vault has not been replaced.'); };
  const get = async accountId => {
    available();
    const { rows } = await db.query('SELECT revision,record,updated_at AS "updatedAt" FROM account_vaults WHERE account_id=$1', [accountId]);
    return { accountId, ...(rows[0] || { revision: 0, record: null, updatedAt: null }) };
  };
  return { get, async put(accountId, input) {
    available();
    if (!fields(input, ['revision', 'record']) || !Number.isSafeInteger(input.revision)
      || input.revision < 0 || input.revision >= 2147483647) throw failure(400, 'A valid vault revision is required.');
    const record = validateRecord(input.record);
    const result = input.revision === 0
      ? await db.query(`INSERT INTO account_vaults(account_id,revision,record) VALUES($1,1,$2::jsonb)
          ON CONFLICT(account_id) DO NOTHING RETURNING revision,record,updated_at AS "updatedAt"`, [accountId, JSON.stringify(record)])
      : await db.query(`UPDATE account_vaults SET record=$2::jsonb,revision=revision+1,updated_at=NOW()
          WHERE account_id=$1 AND revision=$3 RETURNING revision,record,updated_at AS "updatedAt"`, [accountId, JSON.stringify(record), input.revision]);
    if (result.rows[0]) return { accountId, ...result.rows[0] };
    // A response may be lost after commit. An exact ciphertext retry is safe;
    // different stale writes must never silently replace the winner.
    const { rows } = await db.query(`SELECT revision,record,updated_at AS "updatedAt" FROM account_vaults
      WHERE account_id=$1 AND record=$2::jsonb`, [accountId, JSON.stringify(record)]);
    if (rows[0]) return { accountId, ...rows[0] };
    throw failure(409, 'Your account vault changed on another device. Save an encrypted copy before choosing which vault to use.');
  } };
}
function registerVaultStorageRoutes(app, { db, authenticate, limiter, json }) {
  const service = createVaultStorage(db);
  const noStore = (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); };
  const handler = work => async (req, res) => {
    try { res.json(await work(req)); }
    catch (error) {
      const status = [400, 409, 503].includes(error.status) ? error.status : 503;
      // Do not log driver errors: they can include the encrypted record/query.
      res.status(status).json({ message: error.status ? error.message : 'Vault account storage is unavailable. Try again before making changes.' });
    }
  };
  app.get('/vault/storage', noStore, authenticate, limiter, handler(req => service.get(req.user.id)));
  app.put('/vault/storage', noStore, authenticate, limiter, json({ limit: '4mb', strict: true }), handler(req => service.put(req.user.id, req.body)));
  app.use('/vault/storage', (error, _req, res, _next) => {
    res.status(error.type === 'entity.too.large' ? 413 : 400).json({ message: 'The encrypted vault request is invalid or too large.' });
  });
}
module.exports = { VAULT_STORAGE_SCHEMA, createVaultStorage, registerVaultStorageRoutes, validateRecord };
