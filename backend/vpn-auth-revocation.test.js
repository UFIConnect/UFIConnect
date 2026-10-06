'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { MANAGED_VPN_SCHEMA } = require('./managed-vpn-schema');
const { mutateAccountAndRevokeVpn } = require('./vpn-auth-revocation');
const userId = '11111111-1111-4111-8111-111111111111';

test('account revocation commits with VPN revocation and rolls back on failure', async () => {
  const pg = new PGlite();
  try {
    await pg.exec('CREATE TABLE users(id UUID PRIMARY KEY,auth_version INTEGER NOT NULL DEFAULT 0)');
    await pg.exec('CREATE TABLE auth_sessions(id UUID PRIMARY KEY,user_id UUID REFERENCES users(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL)');
    for (const statement of MANAGED_VPN_SCHEMA) await pg.exec(statement);
    await pg.query('INSERT INTO users(id) VALUES($1)', [userId]);
    await pg.query(`INSERT INTO managed_vpn_launches(token_hash,user_id,platform,auth_version,expires_at)
      VALUES($1,$2,'windows',0,NOW()+interval '3 minutes')`, ['a'.repeat(64), userId]);
    await pg.query(`INSERT INTO managed_vpn_devices(id,user_id,gateway_id,public_key,label,tunnel_address,lease_expires_at)
      VALUES($1,$1,'gateway',$2,'Phone','10.80.0.2',NOW()+interval '5 minutes')`, [userId, Buffer.alloc(32, 1).toString('base64')]);
    const db = { withClient: fn => fn(pg) };
    const change = async client => {
      await client.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1', [userId]);
      return 'changed';
    };
    await assert.rejects(mutateAccountAndRevokeVpn(db, userId, async client => { await change(client); throw new Error('failed'); }), /failed/);
    assert.equal((await pg.query('SELECT auth_version FROM users')).rows[0].auth_version, 0);
    assert.equal((await pg.query('SELECT revoked_at FROM managed_vpn_devices')).rows[0].revoked_at, null);
    assert.equal((await pg.query('SELECT * FROM managed_vpn_launches')).rows.length, 1);
    assert.equal(await mutateAccountAndRevokeVpn(db, userId, change), 'changed');
    assert.equal((await pg.query('SELECT auth_version FROM users')).rows[0].auth_version, 1);
    assert.ok((await pg.query('SELECT revoked_at FROM managed_vpn_devices')).rows[0].revoked_at);
    assert.equal((await pg.query('SELECT * FROM managed_vpn_launches')).rows.length, 0);
  } finally { await pg.close(); }
});
