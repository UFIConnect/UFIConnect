'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createAppHarness, member } = require('./test-support/app-harness');
const { BUSINESS_TEAM_SCHEMA } = require('./business-teams');
const id = '33333333-1111-4111-8111-111111111111';
async function fixture(t, verified = true) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY,name TEXT,email TEXT,email_is_placeholder BOOLEAN DEFAULT false,
    phone TEXT,title TEXT,bio TEXT,skills TEXT[],organization TEXT,links JSONB,role_settings JSONB DEFAULT '{}',
    profile_hidden BOOLEAN DEFAULT false,avatar_url TEXT,cover_url TEXT,auth_provider TEXT DEFAULT 'local',auth_subject TEXT,
    auth_version INTEGER DEFAULT 0,billing_closed BOOLEAN DEFAULT false,plan TEXT DEFAULT 'free',business_seats INTEGER DEFAULT 0);
    CREATE TABLE auth_login_identities(provider TEXT,subject TEXT,user_id UUID);`);
  for (const sql of BUSINESS_TEAM_SCHEMA) await pg.exec(sql);
  await pg.query("INSERT INTO users(id,name,email,phone,auth_provider) VALUES($1,'Member','member@example.invalid','+14155550123',$2)", [id, verified ? 'phone' : 'local']);
  if (verified) await pg.query("INSERT INTO auth_login_identities VALUES('phone','+14155550123',$1)", [id]);
  let tail = Promise.resolve();
  const app = await createAppHarness({ connected: true,
    query: async (sql, params) => {
      if (sql.startsWith('SELECT id FROM auth_sessions')) return { rows: [{ id: params[0] }] };
      if (/\busers\b|auth_login_identities|^BEGIN$|^COMMIT$|^ROLLBACK$/.test(sql)) return pg.query(sql, params);
      return { rows: [], rowCount: 0 };
    },
    withClient: (work, query) => { const result = tail.then(() => work({ query })); tail = result.catch(() => {}); return result; },
  });
  t.after(() => app.close());
  app.seedUser(member(id, { phone: '+14155550000', authProvider: verified ? 'phone' : 'local' }));
  return { pg, app };
}
test('a stale profile cannot overwrite a verified sign-in number, including through general saves', async t => {
  const { pg, app } = await fixture(t);
  const rejected = await app.request('/profile', { method: 'PATCH', userId: id, body: { phone: '+14155550000' } });
  assert.equal(rejected.status, 409); assert.equal(rejected.data.code, 'phone_verification_required');
  const saved = await app.request('/profile', { method: 'PATCH', userId: id, body: { title: 'Updated role' } });
  assert.equal(saved.status, 200, app.errors.join('\n')); assert.equal(saved.data.phone, '+14155550123');
  assert.equal((await pg.query('SELECT phone FROM users')).rows[0].phone, '+14155550123');
  const unchanged = await app.request('/profile', { method: 'PATCH', userId: id, body: { phone: '+14155550123', bio: 'Updated bio' } });
  assert.equal(unchanged.status, 200); assert.equal(unchanged.data.phone, '+14155550123');
  assert.equal((await pg.query('SELECT subject FROM auth_login_identities')).rows[0].subject, '+14155550123');
});
test('members without a verified phone login retain their existing contact-phone editor', async t => {
  const { app } = await fixture(t, false);
  const saved = await app.request('/profile', { method: 'PATCH', userId: id, body: { phone: '+14155550999' } });
  assert.equal(saved.status, 200, app.errors.join('\n')); assert.equal(saved.data.phone, '+14155550999');
});
