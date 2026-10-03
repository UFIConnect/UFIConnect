'use strict';

const assert = require('node:assert/strict');
const { before, after, beforeEach, test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { BUSINESS_TEAM_SCHEMA, createBusinessTeams } = require('./business-teams');
const { createAppHarness, member } = require('./test-support/app-harness');

const OWNER = 'a0000000-0000-4000-8000-000000000001';
const ALICE = 'a0000000-0000-4000-8000-000000000002';
const BOB = 'a0000000-0000-4000-8000-000000000003';
const OTHER = 'a0000000-0000-4000-8000-000000000004';
let pg;
before(async () => {
  pg = new PGlite();
  await pg.exec(`CREATE TABLE users (id UUID PRIMARY KEY, name TEXT, email TEXT UNIQUE,
    organization TEXT, plan TEXT NOT NULL DEFAULT 'free', business_seats INTEGER NOT NULL DEFAULT 0,
    billing_closed BOOLEAN NOT NULL DEFAULT false)`);
  for (const sql of BUSINESS_TEAM_SCHEMA) await pg.exec(sql);
});
after(async () => { await pg.close(); });
beforeEach(async () => {
  await pg.exec('TRUNCATE users CASCADE');
  for (const [id, name, plan, seats] of [[OWNER, 'Owner', 'business', 3], [ALICE, 'Alice', 'pro', 0], [BOB, 'Bob', 'free', 0], [OTHER, 'Other', 'business', 2]]) {
    await pg.query('INSERT INTO users(id,name,email,organization,plan,business_seats) VALUES($1,$2,$3,$4,$5,$6)', [id, name, `${name.toLowerCase()}@example.invalid`, `${name} company`, plan, seats]);
  }
});

function fixture() {
  let connected = true;
  let billingAvailable = true;
  let clock = Date.now();
  let tail = Promise.resolve();
  const db = { isConnected: () => connected, query: (sql, params) => pg.query(sql, params),
    // One PostgreSQL connection; serialize transactions just as row locks do
    // across actual pooled connections, retaining constraints and rollback.
    withClient(work) {
      const current = tail.then(() => work({ query: db.query }));
      tail = current.catch(() => {});
      return current;
    } };
  const billing = { async status(id) {
    if (!billingAvailable) throw Object.assign(new Error('Billing unavailable.'), { status: 503 });
    const { rows: [row] } = await pg.query('SELECT plan,business_seats FROM users WHERE id=$1', [id]);
    return { plan: row?.plan, businessSeats: row?.business_seats };
  } };
  return { db, teams: createBusinessTeams({ db, billing, now: () => clock }),
    offline() { connected = false; }, billingOffline() { billingAvailable = false; },
    advance(ms) { clock += ms; } };
}
const tokenOf = value => value.invitePath.split('#invite=')[1];
async function invite(teams, id = ALICE) {
  return teams.invite(OWNER, { email: id === ALICE ? 'alice@example.invalid' : 'bob@example.invalid' });
}

test('only the invited registered account can accept its single-use seat; personal billing stays independent', async () => {
  const { teams } = fixture();
  await assert.rejects(teams.invite(ALICE, { email: 'bob@example.invalid' }), { status: 403 });
  await assert.rejects(teams.invite(OWNER, { email: 'unknown@example.invalid' }), { status: 400 });
  await assert.rejects(teams.invite(OWNER, { email: 'owner@example.invalid' }), { status: 400 });
  const invitation = await teams.invite(OWNER, { email: ' ALICE@example.invalid ' });
  const token = tokenOf(invitation);
  const stored = (await pg.query('SELECT * FROM business_team_invitations')).rows[0];
  assert.equal(JSON.stringify(stored).includes(token), false, 'Only the token hash is stored');
  assert.equal(await teams.effectiveMembership(ALICE), null);
  assert.equal((await teams.inspectInvitation(ALICE, { token })).owner.id, OWNER);
  await assert.rejects(teams.inspectInvitation(BOB, { token }), { status: 404 });
  await assert.rejects(teams.accept(BOB, { token }), { status: 404 });
  assert.equal((await teams.accept(ALICE, { token })).joined, true);
  assert.equal((await teams.effectiveMembership(ALICE)).active, true);
  assert.equal((await pg.query('SELECT plan FROM users WHERE id=$1', [ALICE])).rows[0].plan, 'pro');
  await assert.rejects(teams.accept(ALICE, { token }), { status: 404 });
  await assert.rejects(teams.invite(OTHER, { email: 'alice@example.invalid' }), { status: 409 });
  assert.equal((await teams.list(ALICE)).role, 'member');
});

test('invitations reserve available seats and concurrent acceptance cannot exceed reduced paid capacity', async () => {
  const { teams } = fixture();
  const [alice, bob] = await Promise.all([invite(teams, ALICE), invite(teams, BOB)]);
  assert.equal((await teams.list(OWNER)).invitations.length, 2);
  await pg.query("UPDATE users SET plan='free' WHERE id=$1", [OTHER]);
  await assert.rejects(teams.invite(OWNER, { email: 'other@example.invalid' }), { status: 409 });
  await pg.query('UPDATE users SET business_seats=2 WHERE id=$1', [OWNER]);
  const attempts = await Promise.allSettled([teams.accept(ALICE, { token: tokenOf(alice) }), teams.accept(BOB, { token: tokenOf(bob) })]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal((await teams.list(OWNER)).used, 2, 'Owner always reserves one paid seat');
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM business_team_members')).rows[0].n, 1);
});

test('seat reduction and cancellation revoke derived access while existing personal plans remain intact', async () => {
  const { teams } = fixture();
  const a = await invite(teams, ALICE); await teams.accept(ALICE, { token: tokenOf(a) });
  const b = await invite(teams, BOB); await teams.accept(BOB, { token: tokenOf(b) });
  await pg.query('UPDATE users SET business_seats=2 WHERE id=$1', [OWNER]);
  assert.equal((await teams.effectiveMembership(ALICE)).active, true);
  assert.equal((await teams.effectiveMembership(BOB)).active, false);
  assert.deepEqual((await teams.list(OWNER)).members.map(row => row.active), [true, false]);
  await pg.query("UPDATE users SET plan='free',business_seats=0 WHERE id=$1", [OWNER]);
  assert.equal((await teams.effectiveMembership(ALICE)).active, false);
  assert.equal((await teams.list(OWNER)).active, false);
  assert.equal((await pg.query('SELECT plan FROM users WHERE id=$1', [ALICE])).rows[0].plan, 'pro');
  await teams.remove(OWNER, BOB);
  await teams.leave(ALICE);
  assert.equal(await teams.effectiveMembership(ALICE), null);
  assert.equal(await teams.effectiveMembership(BOB), null);
});

test('reissued, expired, revoked or email-changed invitations never grant membership', async () => {
  const f = fixture();
  const original = await invite(f.teams);
  const replacement = await invite(f.teams);
  assert.equal((await f.teams.list(OWNER)).invitations.length, 1);
  await assert.rejects(f.teams.accept(ALICE, { token: tokenOf(original) }), { status: 404 });
  f.advance(8 * 24 * 60 * 60 * 1000);
  await assert.rejects(f.teams.accept(ALICE, { token: tokenOf(replacement) }), { status: 404 });
  const current = await invite(f.teams);
  await pg.query("UPDATE users SET email='new-alice@example.invalid' WHERE id=$1", [ALICE]);
  await assert.rejects(f.teams.accept(ALICE, { token: tokenOf(current) }), { status: 404 });
  await pg.query("UPDATE users SET email='alice@example.invalid' WHERE id=$1", [ALICE]);
  await f.teams.revoke(OTHER, current.invitation.id);
  assert.equal((await f.teams.inspectInvitation(ALICE, { token: tokenOf(current) })).email, 'alice@example.invalid');
  await f.teams.revoke(OWNER, current.invitation.id);
  await assert.rejects(f.teams.accept(ALICE, { token: tokenOf(current) }), { status: 404 });
});

test('team removal is owner-bound, users can leave, and deletion cascades without orphaned access', async () => {
  const { teams } = fixture();
  const a = await invite(teams); await teams.accept(ALICE, { token: tokenOf(a) });
  await teams.remove(OTHER, ALICE);
  assert.equal((await teams.effectiveMembership(ALICE)).active, true);
  await teams.leave(ALICE);
  assert.equal(await teams.effectiveMembership(ALICE), null);
  const another = await teams.invite(OTHER, { email: 'alice@example.invalid' });
  await teams.accept(ALICE, { token: tokenOf(another) });
  await pg.query('DELETE FROM users WHERE id=$1', [OTHER]);
  assert.equal(await teams.effectiveMembership(ALICE), null);
  const pending = await invite(teams, BOB);
  await pg.query('DELETE FROM users WHERE id=$1', [BOB]);
  assert.equal((await pg.query('SELECT id FROM business_team_invitations WHERE id=$1', [pending.invitation.id])).rows.length, 0);
});

test('unavailable storage or billing fails closed and cannot grant a new seat', async () => {
  const f = fixture();
  const a = await invite(f.teams);
  f.billingOffline();
  await assert.rejects(f.teams.accept(ALICE, { token: tokenOf(a) }), { status: 503 });
  assert.equal(await f.teams.effectiveMembership(ALICE), null);
  f.offline();
  await assert.rejects(f.teams.effectiveMembership(ALICE), { status: 503 });
  await assert.rejects(f.teams.list(OWNER), { status: 503 });
});

test('authenticated profiles and career catalog derive team access without overwriting personal plan', async t => {
  const { teams } = fixture();
  const a = await invite(teams); await teams.accept(ALICE, { token: tokenOf(a) });
  const app = await createAppHarness({ connected: true, env: { STRIPE_WEBHOOK_SECRET: 'whsec_fixture' }, query: (sql, params) => sql.startsWith('SELECT id FROM auth_sessions')
    ? { rows: [{ id: params[0] }] } : pg.query(sql, params) });
  t.after(() => app.close());
  app.seedUser(member(ALICE));
  let result = await app.request('/profile', { userId: ALICE });
  assert.equal(result.status, 200); assert.equal(result.data.plan, 'business');
  assert.equal(result.data.personalPlan, 'pro'); assert.equal(result.data.businessTeam.active, true);
  assert.equal((await app.request('/social/platforms', { userId: ALICE })).data.careerOnly, true);
  assert.equal((await app.request('/business/team')).status, 401);
  assert.equal((await app.request('/business/team', { userId: ALICE })).data.role, 'member');
  const checkout = await app.request('/billing/create-checkout-session', { userId: ALICE, method: 'POST', body: { tier: 'business', quantity: 2 } });
  assert.equal(checkout.status, 409);
  assert.match(checkout.data.message, /Leave your current Business team/);
  await pg.query("UPDATE users SET plan='business',business_seats=4 WHERE id=$1", [ALICE]);
  result = await app.request('/profile', { userId: ALICE });
  assert.equal(result.data.businessSeats, 4, 'An independently owned Business plan takes precedence over a borrowed seat');
  await pg.query("UPDATE users SET plan='pro',business_seats=0 WHERE id=$1", [ALICE]);
  await pg.query("UPDATE users SET plan='free',business_seats=0 WHERE id=$1", [OWNER]);
  result = await app.request('/profile', { userId: ALICE });
  assert.equal(result.status, 200); assert.equal(result.data.plan, 'pro');
  assert.equal(result.data.businessTeam.active, false);
  assert.equal((await app.request('/social/platforms', { userId: ALICE })).data.careerOnly, false);
  await pg.exec('DROP TABLE business_team_members CASCADE');
  assert.equal((await app.request('/profile', { userId: ALICE })).status, 503);
  for (const sql of BUSINESS_TEAM_SCHEMA) await pg.exec(sql);
});
