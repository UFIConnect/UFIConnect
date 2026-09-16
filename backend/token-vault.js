'use strict';

const crypto = require('node:crypto');
const PREFIX = 'enc:v1:';

function createTokenVault(env = process.env) {
  const encoded = env.OAUTH_TOKEN_ENCRYPTION_KEY || '';
  const key = encoded ? Buffer.from(encoded, 'base64') : null;
  if ((encoded && (key.length !== 32 || key.toString('base64') !== encoded)) || (env.NODE_ENV === 'production' && !key)) {
    throw new Error('OAUTH_TOKEN_ENCRYPTION_KEY must be a dedicated random 32-byte key encoded as base64.');
  }
  const requireKey = () => { if (!key) throw new Error('Configure OAUTH_TOKEN_ENCRYPTION_KEY before connecting social accounts.'); };
  function seal(value, context) {
    requireKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  }
  function open(value, context) {
    requireKey();
    if (!value.startsWith(PREFIX)) throw new Error('Unencrypted social credentials require migration.');
    const blob = Buffer.from(value.slice(PREFIX.length), 'base64');
    if (blob.length < 29) throw new Error('Invalid encrypted social credential.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(blob.subarray(12, 28));
    return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString('utf8');
  }
  function transform(map, userId, kind, operation) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
    return Object.fromEntries(Object.entries(map).filter(([, value]) => typeof value === 'string' && value).map(([platform, value]) => [
      platform, operation(value, `${userId}:${kind}:${platform}`),
    ]));
  }
  return {
    seal, open,
    encryptMap: (map, id, kind) => transform(map, id, kind, seal),
    decryptMap: (map, id, kind) => transform(map, id, kind, open),
    migrateMap: (map, id, kind) => transform(map, id, kind, (value, context) => {
      if (value.startsWith(PREFIX)) { open(value, context); return value; }
      return seal(value, context);
    }),
  };
}

async function migrateSocialCredentials(db, vault) {
  if (!db.isConnected()) return;
  await db.withClient(async client => {
    await client.query('BEGIN');
    try {
      const { rows } = await client.query("SELECT id,social_tokens,social_refresh_tokens FROM users WHERE social_tokens <> '{}'::jsonb OR social_refresh_tokens <> '{}'::jsonb FOR UPDATE");
      for (const row of rows) {
        const access = vault.migrateMap(row.social_tokens, row.id, 'access');
        const refresh = vault.migrateMap(row.social_refresh_tokens, row.id, 'refresh');
        if (JSON.stringify(access) !== JSON.stringify(row.social_tokens || {}) || JSON.stringify(refresh) !== JSON.stringify(row.social_refresh_tokens || {})) {
          await client.query('UPDATE users SET social_tokens=$1,social_refresh_tokens=$2 WHERE id=$3', [JSON.stringify(access), JSON.stringify(refresh), row.id]);
        }
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  });
}

module.exports = { createTokenVault, migrateSocialCredentials };
