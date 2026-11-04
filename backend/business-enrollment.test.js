'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { BUSINESS_ACCOUNT_SCHEMA, accountTypeOf, registrationDetails, businessAccountOptions } = require('./business-enrollment');
const { BUSINESS_TEAM_SCHEMA } = require('./business-teams');
const { BILLING_SCHEMA } = require('./billing');
const { OFFICE_MEMBERS_SCHEMA } = require('./office-members');
const { createAppHarness } = require('./test-support/app-harness');
const { SCHEMA: DEVICE_SCHEMA } = require('./suspicious-devices');
const signup = { name: 'Recruiting member', email: 'recruiter@example.invalid', password: 'Cobalt-rain-sky7',
  accountType: 'business', organization: 'Sample recruiting', businessIndustryId: 'technology' };

test('registration accepts only a known account track and a real recruiting organization and industry', () => {
  assert.deepEqual(registrationDetails({}), { accountType: 'personal', organization: '', industryId: '' });
  assert.equal(registrationDetails({ ...signup, organization: '  Sample recruiting  ' }).organization, 'Sample recruiting');
  for (const body of [null, [], { accountType: 'Business' }, { ...signup, organization: '' }, { ...signup, organization: 'x'.repeat(121) }, { ...signup, businessIndustryId: 'custom-untrusted' }]) {
    assert.throws(() => registrationDetails(body), { status: 400 });
  }
  assert.equal(accountTypeOf({ accountType: 'personal', plan: 'business' }), 'personal');
  assert.equal(accountTypeOf({ account_type: 'personal', accountType: 'business', plan: 'business' }), 'personal');
  assert.equal(accountTypeOf({ account_type: 'business', plan: 'free' }), 'business');
  assert.equal(accountTypeOf({ plan: 'business' }), 'business');
});

test('migration preserves paid Business membership and establishes an immutable personal default for new accounts', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec("CREATE TABLE users(id TEXT PRIMARY KEY,plan TEXT DEFAULT 'free'); INSERT INTO users VALUES('existing-business','business'),('existing-personal','free')");
  for (const sql of BUSINESS_ACCOUNT_SCHEMA) await pg.exec(sql);
  const prior = (await pg.query('SELECT * FROM users ORDER BY id')).rows;
  assert.deepEqual(prior.map(row => row.account_type), ['business', 'personal']);
  assert.ok(prior.every(row => row.business_enrollment_cutoff));
  await pg.exec("UPDATE users SET plan='free' WHERE id='existing-business'; INSERT INTO users(id,plan) VALUES('new-personal','business')");
  for (const sql of BUSINESS_ACCOUNT_SCHEMA) await pg.exec(sql);
  const next = (await pg.query('SELECT * FROM users ORDER BY id')).rows;
  assert.deepEqual(next.map(row => row.account_type), ['business', 'personal', 'personal']);
  assert.equal(next[0].business_enrollment_cutoff.toISOString(), prior[0].business_enrollment_cutoff.toISOString());
  assert.equal(next[2].business_enrollment_cutoff, null);
  await assert.rejects(pg.exec("UPDATE users SET account_type='enterprise' WHERE id='new-personal'"));
});

test('production billing then team migration order safely backfills existing accepted seats and is repeatable', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  const ids = [1, 2, 3, 4].map(number => `a0000000-0000-4000-8000-${String(number).padStart(12, '0')}`);
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY,name TEXT,email TEXT,plan TEXT DEFAULT 'free',
    stripe_customer_id TEXT,stripe_subscription_id TEXT,resume_builder_addon BOOLEAN DEFAULT false,resume_builder_subscription_id TEXT)`);
  for (const id of ids.slice(0, 3)) await pg.query('INSERT INTO users(id,plan) VALUES($1,$2)', [id, id === ids[0] ? 'business' : 'free']);
  // These accepted seats already exist in production before this enrollment policy.
  await pg.exec(BUSINESS_TEAM_SCHEMA.find(sql => sql.startsWith('CREATE TABLE IF NOT EXISTS business_team_members')));
  await pg.query('INSERT INTO business_team_members(owner_id,member_id) VALUES($1,$2)', [ids[0], ids[1]]);
  for (const sql of [...BILLING_SCHEMA, ...BUSINESS_TEAM_SCHEMA]) await pg.exec(sql);
  assert.deepEqual((await pg.query('SELECT account_type FROM users ORDER BY id')).rows.map(row => row.account_type), ['business', 'business', 'personal']);
  await pg.query("UPDATE users SET plan='free' WHERE id=$1", [ids[0]]);
  await pg.query('INSERT INTO users(id) VALUES($1)', [ids[3]]);
  // Even an unexpected later row cannot reopen the one-time legacy backfill.
  await pg.query('INSERT INTO business_team_members(owner_id,member_id) VALUES($1,$2)', [ids[0], ids[3]]);
  for (const sql of [...BILLING_SCHEMA, ...BUSINESS_TEAM_SCHEMA]) await pg.exec(sql);
  const rows = (await pg.query('SELECT account_type,business_enrollment_cutoff FROM users ORDER BY id')).rows;
  assert.deepEqual(rows.map(row => row.account_type), ['business', 'business', 'personal', 'personal']);
  assert.equal(rows[3].business_enrollment_cutoff, null);
});

async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,
    phone TEXT,password_hash TEXT,title TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),organization TEXT,
    plan TEXT NOT NULL DEFAULT 'free',business_seats INTEGER NOT NULL DEFAULT 0,billing_closed BOOLEAN NOT NULL DEFAULT false,
    auth_version INTEGER NOT NULL DEFAULT 0,onboarding_complete BOOLEAN NOT NULL DEFAULT false,profile_hidden BOOLEAN NOT NULL DEFAULT false,
    role_settings JSONB NOT NULL DEFAULT '{}');
    CREATE TABLE auth_sessions(id UUID PRIMARY KEY,user_id UUID REFERENCES users(id),expires_at TIMESTAMPTZ);`);
  for (const sql of [...OFFICE_MEMBERS_SCHEMA, ...BUSINESS_TEAM_SCHEMA, ...DEVICE_SCHEMA]) await pg.exec(sql);
  const app = await createAppHarness({ connected: true, query(sql, params) {
    if (sql.includes('site_activity_heartbeat')) return { rows: [], rowCount: 0 };
    return pg.query(sql, params.map(value => Object.prototype.toString.call(value) === '[object Date]' ? value.toISOString() : value));
  } });
  t.after(() => app.close());
  return { pg, app };
}

test('public Business registration creates a durable free recruiting account before billing and exposes the shared catalog', async t => {
  const { pg, app } = await fixture(t);
  const options = await app.request('/auth/business-options');
  assert.equal(options.status, 200); assert.deepEqual(options.data, businessAccountOptions());
  const created = await app.request('/auth/register', { method: 'POST', body: signup });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.profile.accountType, 'business');
  assert.equal(created.data.profile.plan, 'free'); assert.equal(created.data.profile.onboardingComplete, true);
  assert.deepEqual(created.data.profile.businessEnrollment, { industryId: 'technology' });
  assert.equal(created.data.profile.organization, signup.organization);
  const row = (await pg.query('SELECT * FROM users WHERE email=$1', [signup.email])).rows[0];
  assert.equal(row.account_type, 'business'); assert.equal(row.business_enrollment_cutoff, null);
  assert.equal(row.plan, 'free'); assert.equal(row.business_seats, 0);
  assert.ok(!app.queries.some(item => /INSERT INTO billing_checkout_attempts/.test(item.sql)));
  assert.equal((await app.request('/auth/register', { method: 'POST', body: signup })).status, 409);
});

test('ordinary signup stays personal and authenticated registration or profile edits cannot convert that account', async t => {
  const { pg, app } = await fixture(t);
  const ordinary = { name: 'Personal member', email: 'personal@example.invalid', password: signup.password,
    organization: signup.organization, businessIndustryId: signup.businessIndustryId };
  const created = await app.request('/auth/register', { method: 'POST', body: ordinary });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.profile.accountType, 'personal'); assert.equal(created.data.profile.onboardingComplete, false);
  assert.equal(created.data.profile.businessEnrollment, null);
  const headers = { authorization: `Bearer ${created.data.token}` };
  const blocked = await app.request('/auth/register', { method: 'POST', headers, body: signup });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
  assert.equal(blocked.data.code, 'business_registration_required');
  const cookie = created.headers.get('set-cookie').split(';')[0];
  assert.equal((await app.request('/auth/register', { method: 'POST', headers: { cookie }, body: signup })).status, 409);
  assert.equal((await app.request('/auth/register', { method: 'POST', headers: { cookie, authorization: 'Bearer expired' }, body: signup })).status, 409);
  for (const key of ['accountType', 'account_type', 'businessEnrollment', 'businessIndustryId', 'business_industry_id']) {
    assert.equal((await app.request('/profile', { method: 'PATCH', headers, body: { [key]: 'business' } })).status, 400);
  }
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n, 1);
  assert.equal((await pg.query('SELECT account_type FROM users')).rows[0].account_type, 'personal');
  const duplicate = await app.request('/auth/register', { method: 'POST', body: { ...signup, email: ordinary.email } });
  assert.equal(duplicate.status, 409);
});
