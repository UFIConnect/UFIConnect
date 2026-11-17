'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { randomUUID } = require('node:crypto');
const { FOCUS_SCHEMA, createFocusSync } = require('./focus-sync');
const { ACTION_MAX_AGE, FIX_MAX_AGE, LEASE_DURATION, focusTransitions } = require('./focus-rules.mjs');

const database = new PGlite();
const BASE = Date.UTC(2026, 10, 15);
const zone = (id, rules = {}) => ({ id, name: id, enabled: true,
  center: { latitude: 10, longitude: 20, accuracy: 0 }, radius: 250, rules });
const config = (scope = 'individual') => ({ zones: [zone('home', { enter: 'startWithSound' }), zone('work', { enter: 'quiet' })],
  activeZoneId: 'home', minutes: 25, fence: { scope, enter: 'start', exit: 'pauseTimer' } });

before(async () => {
  await database.exec(`CREATE TABLE users (id UUID PRIMARY KEY, auth_version INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE auth_sessions (id UUID PRIMARY KEY, user_id UUID REFERENCES users(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ);`);
  for (const sql of FOCUS_SCHEMA) await database.query(sql);
});
after(() => database.close());

async function fixture() {
  let time = BASE;
  const owner = randomUUID(), sid = randomUUID();
  await database.query('INSERT INTO users (id) VALUES ($1)', [owner]);
  await database.query('INSERT INTO auth_sessions (id,user_id,expires_at) VALUES ($1,$2,$3)',
    [sid, owner, new Date(BASE + LEASE_DURATION * 3)]);
  const db = { query: database.query.bind(database), withClient: async fn => {
    // serialize the single PGlite connection, which models the same committed
    // transactions as the API pool for the sequential retry assertions below.
    return fn(database);
  } };
  const service = createFocusSync({ db, encryptionKey: Buffer.alloc(32, 7).toString('base64'), now: () => time });
  const pair = async () => {
    await service.save(owner, 0, config());
    const { code } = await service.issueCode(owner, sid, 0);
    const phone = await service.pair({ code, platform: 'ios' });
    await service.confirm(owner, phone.id, phone.confirmation);
    return phone;
  };
  return { owner, sid, service, pair, advance: ms => { time += ms; }, now: () => time };
}

test('pairing is single-use, account-bound, and grants no sharing', async () => {
  const { owner, sid, service } = await fixture();
  const other = await fixture();
  await service.save(owner, 0, config());
  assert.equal((await service.read(other.owner)).config, null);
  await assert.rejects(service.save(owner, 0, config()), { status: 409 });
  const { code } = await service.issueCode(owner, sid, 0);
  await service.save(other.owner, 0, config());
  const pair = await service.pair({ code, platform: 'ios' });
  assert.equal(pair.awaitingConfirmation, true);
  assert.equal((await service.pull(pair.token)).config, null);
  await assert.rejects(service.consent(pair.token, { version: 0, zones: true, precision: null }), { status: 403 });
  await assert.rejects(service.confirm(other.owner, pair.id, pair.confirmation), { status: 403 });
  await assert.rejects(service.confirm(owner, pair.id, '12345678'), { status: 403 });
  await service.confirm(owner, pair.id, pair.confirmation);
  assert.equal((await service.pull(pair.token)).config.zones.length, 2);
  assert.deepEqual(pair.scopes, { zones: false, precision: null });
  await assert.rejects(service.pair({ code, platform: 'ios' }), { status: 403 });
  await assert.rejects(service.report(pair.token, { revision: 1, version: 0, status: 'monitoring',
    registered: [], reports: [], fix: { latitude: 1, longitude: 2, accuracy: 5, timestamp: BASE } }), { status: 403 });
  const { rows } = await database.query('SELECT config FROM focus_settings WHERE owner_id=$1', [owner]);
  assert.match(rows[0].config, /^enc:v1:/);
  assert.ok(!rows[0].config.includes('home'));
});

test('baseline and duplicate reports do not fire, but fresh crossing rules persist and audio is claimed once', async () => {
  const { owner, service, pair, now, advance } = await fixture();
  const { token } = await pair();
  const grant = await service.consent(token, { version: 0, zones: true, precision: null });
  const report = reports => service.report(token, { revision: 1, version: grant.consentVersion,
    registered: ['home', 'work'], status: 'monitoring', reports });
  await report([{ sequence: 1, at: now(), states: { home: false, work: false }, baseline: true }]);
  assert.deepEqual((await service.read(owner)).session, {});
  advance(1000);
  const arrival = { sequence: 2, at: now(), states: { home: true }, baseline: false };
  await report([arrival]);
  const first = await service.read(owner);
  assert.equal(first.session.deadline, now() + 25 * 60_000);
  assert.equal(first.audio.action, 'playSound');
  advance(1000);
  await report([arrival]);
  assert.equal((await service.read(owner)).audio.id, first.audio.id);
  assert.equal((await service.claimAudio(owner, first.audio.id)).action, 'playSound');
  assert.equal(await service.claimAudio(owner, first.audio.id), null);
  await report([{ sequence: 3, at: now() - ACTION_MAX_AGE - 100, states: { work: true }, baseline: false }]);
  assert.equal((await service.read(owner)).session.quiet, undefined);
  await report([{ sequence: 4, at: now(), states: { work: false }, baseline: false }]);
  await report([{ sequence: 5, at: now(), states: { work: true }, baseline: false }]);
  assert.equal((await service.read(owner)).session.quiet, true);
});

test('a new revision rejects old reports and consent is revoked with the named account session', async () => {
  const { owner, service, pair } = await fixture();
  const phone = await pair();
  await service.consent(phone.token, { version: 0, zones: true, precision: null });
  await service.save(owner, 1, config());
  await assert.rejects(service.report(phone.token, { revision: 1, version: 1 }), { status: 409 });
  await database.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1', [owner]);
  await assert.rejects(service.pull(phone.token), { status: 401 });
  assert.equal((await service.read(owner)).phone, null);
  await service.prune();
  assert.equal((await database.query('SELECT id FROM focus_devices WHERE owner_id=$1', [owner])).rows.length, 0);
});

test('approximate fix retention and explicit revocation clear shared locations', async () => {
  const { owner, service, pair, now, advance } = await fixture();
  const { token, revokeToken } = await pair();
  await service.consent(token, { version: 0, zones: false, precision: 'approximate' });
  const send = version => service.report(token, { revision: 1, version, registered: [], reports: [], status: 'monitoring',
    fix: { latitude: 12.34567, longitude: 34.56789, accuracy: 1, timestamp: now() } });
  await send(1);
  const snapshot = await service.read(owner);
  assert.deepEqual(snapshot.phone.fix, { latitude: 12.346, longitude: 34.568, accuracy: 150, timestamp: now() });
  advance(FIX_MAX_AGE + 1);
  assert.equal((await service.read(owner)).phone.fix, null);
  await service.prune();
  assert.equal((await database.query('SELECT fix FROM focus_devices WHERE owner_id=$1', [owner])).rows[0].fix, null);
  await service.consent(token, { version: 1, zones: false, precision: null });
  await assert.rejects(send(2), { status: 403 });
  await service.revoke(revokeToken);
  assert.equal((await service.read(owner)).phone, null);
  await assert.rejects(service.pull(token), { status: 401 });
});

test('all-zones rules require full coverage and treat overlapping zones as one area', () => {
  const together = config('all'), registered = ['home', 'work'];
  const previous = { home: true, work: false };
  assert.deepEqual(focusTransitions(together, registered, previous, { states: { home: false, work: true } }).events, []);
  assert.deepEqual(focusTransitions(together, registered, previous, { states: { home: false, work: false } }).events,
    [{ zoneId: null, type: 'exit' }]);
  assert.deepEqual(focusTransitions(together, ['home'], previous, { states: { home: false } }).events, []);
  assert.deepEqual(focusTransitions(together, registered, previous, { states: { home: false } }).events, []);
});
