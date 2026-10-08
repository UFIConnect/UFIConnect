'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createTokenVault } = require('./token-vault');
const { PHONE_EMAIL_SCHEMA, createPhoneEmailSettings, emailAddress } = require('./phone-email-settings');
async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY,email TEXT UNIQUE,email_is_placeholder BOOLEAN DEFAULT true,
    auth_provider TEXT DEFAULT 'phone',auth_subject TEXT,phone TEXT,auth_version INTEGER DEFAULT 0,billing_closed BOOLEAN DEFAULT false);
    CREATE TABLE auth_sessions(id UUID PRIMARY KEY,user_id UUID,expires_at TIMESTAMPTZ);
    CREATE TABLE auth_login_identities(provider TEXT,subject TEXT,user_id UUID,PRIMARY KEY(provider,subject));`);
  for (const sql of PHONE_EMAIL_SCHEMA) await pg.exec(sql);
  const id = crypto.randomUUID(), sid = crypto.randomUUID();
  const user = { id, sid, ver: 0 }, number = '+14155550123';
  await pg.query("INSERT INTO users(id,email,phone,auth_subject) VALUES($1,'phone@identity.uficonnect.invalid',$2,$2)", [id, number]);
  await pg.query("INSERT INTO auth_sessions VALUES($1,$2,NOW()+INTERVAL '1 day')", [sid, id]);
  await pg.query("INSERT INTO auth_login_identities VALUES('phone',$1,$2)", [number, id]);
  let tail = Promise.resolve(), available = true, failDelivery = false;
  const db = { isConnected: () => true, query: (...args) => pg.query(...args), withClient(work) {
    const result = tail.then(() => work({ query: (...args) => pg.query(...args) })); tail = result.catch(() => {}); return result;
  } };
  const mail = [], env = { JWT_SECRET: 'email-test-only-secret', OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString('base64') };
  const service = createPhoneEmailSettings({ db, env, vault: createTokenVault(env), mailAvailable: () => available,
    sendMail: async message => { if (failDelivery) throw new Error('delivery failure'); mail.push(message); }, codeFactory: () => '654321',
    profileFor: row => ({ id: row.id, email: row.email_is_placeholder ? '' : row.email, hasEmail: !row.email_is_placeholder, phone: row.phone }) });
  return { pg, service, user, mail, controls: { available: value => { available = value; }, failDelivery: value => { failDelivery = value; } } };
}
test('phone accounts add an email only after verification, retaining their phone login', async t => {
  const { pg, service, user, mail } = await fixture(t);
  const pending = await service.request(user, { email: ' Member@Example.COM ' });
  assert.equal(pending.expiresIn, 600); assert.equal(pending.resendAfter, 60);
  assert.equal(mail.length, 1); assert.deepEqual(mail[0].to, { address: 'member@example.com' });
  const flow = (await pg.query('SELECT * FROM phone_email_verifications')).rows[0];
  assert.match(flow.payload, /^enc:v1:/); assert.doesNotMatch(JSON.stringify(flow), /member@example|654321/);
  assert.equal((await pg.query('SELECT email_is_placeholder FROM users')).rows[0].email_is_placeholder, true);
  const result = await service.verify(user, { verificationId: pending.verificationId, code: '654321' });
  assert.equal(result.profile.hasEmail, true); assert.equal(result.profile.email, 'member@example.com');
  assert.equal(result.profile.phone, '+14155550123');
  assert.equal((await pg.query('SELECT subject FROM auth_login_identities')).rows[0].subject, '+14155550123');
  assert.equal((await pg.query('SELECT auth_provider,auth_subject FROM users')).rows[0].auth_provider, 'phone');
  await assert.rejects(service.verify(user, { verificationId: pending.verificationId, code: '654321' }), error => error.status === 409);
});
test('email codes are session-bound, expire, and persist a five-attempt limit', async t => {
  const { pg, service, user } = await fixture(t);
  const pending = await service.request(user, { email: 'member@example.com' });
  const sid = crypto.randomUUID();
  await pg.query("INSERT INTO auth_sessions VALUES($1,$2,NOW()+INTERVAL '1 day')", [sid, user.id]);
  await assert.rejects(service.verify({ ...user, sid }, { verificationId: pending.verificationId, code: '654321' }), error => error.status === 401);
  for (let attempt = 0; attempt < 5; attempt++) await assert.rejects(service.verify(user, { verificationId: pending.verificationId, code: '000000' }), error => error.status === 400);
  assert.equal((await pg.query('SELECT attempts FROM phone_email_verifications')).rows[0].attempts, 5);
  await assert.rejects(service.verify(user, { verificationId: pending.verificationId, code: '654321' }), error => error.publicCode === 'invalid_flow');
  await pg.query("UPDATE phone_email_verifications SET attempts=0,expires_at=NOW()-INTERVAL '1 second'");
  await assert.rejects(service.verify(user, { verificationId: pending.verificationId, code: '654321' }), error => error.publicCode === 'invalid_flow');
  await pg.query('UPDATE users SET auth_version=1');
  await assert.rejects(service.verify(user, { verificationId: pending.verificationId, code: '654321' }), error => error.status === 401);
});
test('an email owned by another account cannot link or replace that account', async t => {
  const { pg, service, user } = await fixture(t);
  const pending = await service.request(user, { email: 'other@example.com' });
  const other = crypto.randomUUID();
  await pg.query("INSERT INTO users(id,email,email_is_placeholder,auth_provider) VALUES($1,'other@example.com',false,'local')", [other]);
  await assert.rejects(service.verify(user, { verificationId: pending.verificationId, code: '654321' }), error => error.status === 409 && error.publicCode === 'account_exists');
  assert.equal((await pg.query('SELECT email_is_placeholder FROM users WHERE id=$1', [user.id])).rows[0].email_is_placeholder, true);
  assert.equal((await pg.query('SELECT user_id FROM auth_login_identities')).rows[0].user_id, user.id);
  assert.equal((await pg.query('SELECT active FROM phone_email_verifications')).rows[0].active, false);
});
test('sending is bounded, delivery failures do not activate codes, and a new request invalidates old codes', async t => {
  const { pg, service, user, controls } = await fixture(t);
  controls.available(false);
  await assert.rejects(service.request(user, { email: 'member@example.com' }), error => error.status === 503);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS total FROM phone_email_verifications')).rows[0].total, 0);
  controls.available(true); controls.failDelivery(true);
  await assert.rejects(service.request(user, { email: 'member@example.com' }), error => error.status === 503);
  assert.equal((await pg.query('SELECT active FROM phone_email_verifications')).rows[0].active, false);
  await assert.rejects(service.request(user, { email: 'member@example.com' }), error => error.status === 429);
  controls.failDelivery(false);
  await pg.query("UPDATE phone_email_verifications SET created_at=NOW()-INTERVAL '61 seconds'");
  const old = await service.request(user, { email: 'member@example.com' });
  await pg.query("UPDATE phone_email_verifications SET created_at=NOW()-INTERVAL '61 seconds'");
  const newer = await service.request(user, { email: 'new@example.com' });
  await assert.rejects(service.verify(user, { verificationId: old.verificationId, code: '654321' }), error => error.publicCode === 'invalid_flow');
  assert.equal((await service.verify(user, { verificationId: newer.verificationId, code: '654321' })).profile.email, 'new@example.com');
});
test('concurrent verification creates one email update and revoked sessions cannot send codes', async t => {
  const { pg, service, user } = await fixture(t);
  const pending = await service.request(user, { email: 'member@example.com' });
  const results = await Promise.allSettled([service.verify(user, { verificationId: pending.verificationId, code: '654321' }), service.verify(user, { verificationId: pending.verificationId, code: '654321' })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  await pg.query('DELETE FROM auth_sessions');
  await assert.rejects(service.request(user, { email: 'new@example.com' }), error => error.status === 401);
});
test('email address validation rejects aliases, multiple recipients and header injection', () => {
  for (const value of ['a@identity.uficonnect.invalid', 'a@example.com\r\nBcc: other@example.com', 'a,b@example.com', 'Name <a@example.com>', '..a@example.com', 'a.@example.com', 'a@example', 'a'.repeat(65) + '@example.com']) assert.equal(emailAddress(value), null);
  assert.equal(emailAddress(' Member+tag@Example.com '), 'member+tag@example.com');
});
