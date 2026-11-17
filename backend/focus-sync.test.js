'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { hkdfSync, randomUUID } = require('node:crypto');
const { FOCUS_SCHEMA, createFocusSync } = require('./focus-sync');
const { ACTION_MAX_AGE, FIX_MAX_AGE, LEASE_DURATION, focusTransitions } = require('./focus-rules.mjs');
const { createTokenVault } = require('./token-vault');

const database = new PGlite();
const BASE = Date.UTC(2026, 10, 15);
const encryptionKey = Buffer.alloc(32, 7).toString('base64');
const zone = (id, rules = {}) => ({ id, name: id, enabled: true,
  center: { latitude: 10, longitude: 20, accuracy: 0 }, radius: 250, rules });
const config = (scope = 'individual') => ({ zones: [zone('home', { enter: 'startWithSound' }), zone('work', { enter: 'quiet' })],
  activeZoneId: 'home', minutes: 25, fence: { scope, enter: 'start', exit: 'pauseTimer', combination: 'any', duringFocus: false } });

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
  const service = createFocusSync({ db, encryptionKey, now: () => time });
  const pair = async (definition = config()) => {
    await service.save(owner, 0, definition);
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

test('combined intersection needs a complete baseline and crosses only when every zone matches', async () => {
  const f = await fixture();
  const combined = config('all');
  Object.assign(combined.fence, { combination: 'every', enter: 'start', exit: 'quiet' });
  const { token } = await f.pair(combined);
  const granted = await f.service.consent(token, { version: 0, zones: true, precision: null });
  assert.equal(granted.config.fence.combination, 'every');
  const send = (sequence, states, baseline = false, registered = ['home', 'work']) =>
    f.service.report(token, { revision: 1, version: granted.consentVersion, status: 'monitoring',
      registered, reports: [{ sequence, at: f.now(), states, baseline }] });

  await send(1, { home: false }, true);
  assert.equal((await f.service.read(f.owner)).phone.states.home, undefined);
  await send(2, { home: true, work: false });
  assert.deepEqual((await f.service.read(f.owner)).session, {});
  await send(3, { work: true });
  assert.deepEqual((await f.service.read(f.owner)).session, {});
  await send(4, { home: true, work: true }, false, ['work', 'home']);
  const active = await f.service.read(f.owner);
  assert.equal(active.session.deadline, f.now() + 25 * 60_000);
  await send(4, { home: false, work: true });
  await send(5, { home: true, work: true });
  assert.deepEqual((await f.service.read(f.owner)).session, active.session);
  f.advance(1000);
  await send(6, { home: false, work: true });
  const departed = await f.service.read(f.owner);
  assert.equal(departed.session.deadline, null);
  assert.equal(departed.session.quiet, true);
  await send(7, { home: true }, false, ['home']);
  await send(8, { home: true, work: true });
  assert.deepEqual((await f.service.read(f.owner)).session, departed.session);
});

test('Focus-only rules check the current running interval and baseline ignored crossings', async () => {
  const f = await fixture();
  const definition = config('selected');
  definition.fence.duringFocus = true;
  definition.zones[0].rules.enter = 'quiet';
  const { token } = await f.pair(definition);
  const granted = await f.service.consent(token, { version: 0, zones: true, precision: null });
  assert.equal(granted.config.fence.duringFocus, true);
  const send = (sequence, inside, at = f.now()) => f.service.report(token, {
    revision: 1, version: granted.consentVersion, status: 'monitoring', registered: ['home'],
    reports: [{ sequence, at, states: { home: inside }, baseline: sequence === 1 }],
  });
  await send(1, false);
  await send(2, true);
  await send(3, false);
  assert.deepEqual((await f.service.read(f.owner)).session, {});
  const beforeStart = f.now();
  f.advance(1000);
  await f.service.command(f.owner, 'start');
  await send(4, true, beforeStart);
  assert.equal((await f.service.read(f.owner)).session.quiet, undefined);
  f.advance(1000);
  await send(5, false);
  assert.equal((await f.service.read(f.owner)).session.deadline, null);
  await f.service.command(f.owner, 'start');
  await send(6, true);
  assert.equal((await f.service.read(f.owner)).session.quiet, true);

  await f.service.command(f.owner, 'quietOff');
  f.advance(25 * 60_000 + 1);
  await send(7, false);
  await send(8, true);
  assert.equal((await f.service.read(f.owner)).session.quiet, false);
});

test('the API rejects unsupported advanced settings instead of dropping their conditions', async () => {
  const { service, owner } = await fixture();
  for (const settings of [{ separateExit: true }, { fireOnStart: true }, { group: 'office' }, { seconds: 20 },
    { cooldownSeconds: 60 }, { stay: 'quiet' }, { approach: 'start' }, { duringFocus: undefined }, { combination: 'unknown' }]) {
    const input = config();
    Object.assign(input.fence, settings);
    await assert.rejects(service.save(owner, 0, input), { status: 400 });
  }
  for (const settings of [{ shape: 'polygon' }, { schedule: { enabled: true } }, { until: BASE + 1000 },
    { snoozedUntil: BASE + 1000 }, { exclude: true }, { overrides: { buffer: 12 } }, { rules: { stay: 'quiet' } }]) {
    const input = config();
    Object.assign(input.zones[0], settings);
    await assert.rejects(service.save(owner, 0, input), { status: 400 });
  }
  assert.equal((await service.read(owner)).config, null);
});

test('legacy saved rules pause zones until review while separate last-location consent still works', async () => {
  const f = await fixture();
  const { token } = await f.pair();
  await f.service.consent(token, { version: 0, zones: true, precision: null });
  await f.service.consent(token, { version: 1, zones: true, precision: 'approximate' });
  const stale = config();
  delete stale.fence.duringFocus;
  delete stale.fence.combination;
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(encryptionKey, 'base64'),
    Buffer.from('uficonnect'), Buffer.from('focus-sync-v1'), 32)).toString('base64');
  const vault = createTokenVault({ OAUTH_TOKEN_ENCRYPTION_KEY: key });
  await database.query('UPDATE focus_settings SET config=$2 WHERE owner_id=$1',
    [f.owner, vault.seal(JSON.stringify(stale), `focus:${f.owner}:config`)]);
  const pulled = await f.service.pull(token);
  assert.equal(pulled.zoneReviewRequired, true);
  assert.deepEqual(pulled.scopes, { zones: false, precision: 'approximate' });
  assert.equal((await f.service.read(f.owner)).zoneReviewRequired, true);
  const payload = { revision: 1, version: 2, status: 'monitoring', registered: [], reports: [] };
  await assert.rejects(f.service.report(token, { ...payload, registered: ['home'] }), { status: 403 });
  await assert.rejects(f.service.consent(token, { version: 2, zones: true, precision: 'approximate' }), { status: 409 });
  await f.service.report(token, { ...payload, fix: { latitude: 12, longitude: 34, accuracy: 5, timestamp: f.now() } });
  assert.equal((await f.service.read(f.owner)).phone.fix.accuracy, 150);
  const reviewed = await f.service.save(f.owner, 1, config());
  assert.equal(reviewed.zoneReviewRequired, false);
  assert.equal(reviewed.phone.scopes.zones, true);
  const paused = await f.service.save(f.owner, 2, { ...config(), zones: [] });
  assert.deepEqual(paused.phone.scopes, { zones: false, precision: 'approximate' });
});

for (const type of ['enter', 'exit']) {
  test(`Stop Geofencing on ${type} retires the zone grant and rejects later reports`, async () => {
    const f = await fixture();
    const definition = config('individual');
    definition.zones[0].rules = { [type]: 'stopTracking' };
    definition.zones[1].rules = { enter: 'playSound', exit: 'quiet' };
    const inside = type === 'enter';
    const precision = inside ? null : 'approximate';
    const { token, id } = await f.pair(definition);
    let grant = await f.service.consent(token, { version: 0, zones: true, precision: null });
    if (precision) grant = await f.service.consent(token, { version: grant.consentVersion, zones: true, precision });
    const payload = { revision: 1, version: grant.consentVersion, status: 'monitoring', registered: ['home', 'work'] };
    const observation = (sequence, states, baseline = false) => ({ sequence, at: f.now(), states, baseline });
    await f.service.report(token, { ...payload, reports: [
      observation(1, { home: !inside, work: false }, true), observation(2, { work: true }),
    ] });
    const { session } = await f.service.command(f.owner, 'start');
    const pendingAudio = (await f.service.read(f.owner)).audio;
    assert.equal(pendingAudio.action, 'playSound');
    const fix = precision ? { latitude: 15.12345, longitude: 20, accuracy: 5, timestamp: f.now() } : null;
    const stop = { ...payload, fix, reports: [observation(3, { home: inside }), observation(4, { work: false })] };
    const stopped = await f.service.report(token, stop);
    assert.equal(stopped.accepted, 3);
    assert.equal(stopped.phone.id, id);
    assert.equal(stopped.phone.consentVersion, grant.consentVersion + 1);
    assert.deepEqual(stopped.phone.scopes, { zones: false, precision });
    assert.equal(stopped.phone.leaseUntil > f.now(), Boolean(precision));
    const snapshot = await f.service.read(f.owner);
    assert.deepEqual(snapshot.session, session);
    assert.equal(snapshot.audio, null);
    assert.equal(await f.service.claimAudio(f.owner, pendingAudio.id), null);
    assert.deepEqual(snapshot.phone.registered, []);
    assert.equal(snapshot.phone.states, null);
    assert.equal(snapshot.phone.fix?.latitude, precision ? 15.123 : undefined);
    assert.deepEqual((await f.service.pull(token)).scopes, stopped.phone.scopes);
    await assert.rejects(f.service.report(token, stop), { status: 409 });
    await assert.rejects(f.service.report(token, { ...stop, version: stopped.phone.consentVersion }), { status: 403 });
    await assert.rejects(f.service.consent(token, { version: stopped.phone.consentVersion, zones: true, precision: 'precise' }), { status: 409 });
    const restarted = await f.service.consent(token, { version: stopped.phone.consentVersion, zones: true, precision });
    assert.equal(restarted.scopes.zones, true);
    await f.service.report(token, { ...payload, version: restarted.consentVersion, reports: [observation(4, { home: inside })] });
    assert.equal((await f.service.read(f.owner)).phone.scopes.zones, true);
  });
}

test('a Focus-only stop is server-authoritative and cannot stop monitoring outside work', async () => {
  const f = await fixture();
  const definition = config('all');
  Object.assign(definition.fence, { duringFocus: true, combination: 'every', enter: 'stopTracking', exit: 'status' });
  definition.zones[0].rules.exit = 'stopTracking';
  const { token } = await f.pair(definition);
  const grant = await f.service.consent(token, { version: 0, zones: true, precision: null });
  assert.equal(grant.config.fence.enter, 'status');
  assert.equal(grant.config.zones[0].rules.exit, 'status');
  assert.equal((await f.service.read(f.owner)).config.fence.enter, 'stopTracking');
  const send = (sequence, states) => f.service.report(token, {
    revision: 1, version: grant.consentVersion, status: 'monitoring', registered: ['home', 'work'],
    reports: [{ sequence, at: f.now(), states, baseline: sequence === 1 }],
  });
  await send(1, { home: true, work: false });
  await send(2, { home: true, work: true });
  assert.equal((await f.service.pull(token)).scopes.zones, true);
  await f.service.command(f.owner, 'start');
  await send(3, { home: true, work: false });
  const stopped = await send(4, { home: true, work: true });
  assert.equal(stopped.phone.scopes.zones, false);
});

test('a stop preserves a timer action from an earlier crossing in the same report batch', async () => {
  const f = await fixture();
  const definition = config();
  definition.zones[0].rules = { enter: 'start' };
  definition.zones[1].rules = { enter: 'stopTracking' };
  const { token } = await f.pair(definition);
  const grant = await f.service.consent(token, { version: 0, zones: true, precision: null });
  const at = f.now();
  await f.service.report(token, { revision: 1, version: grant.consentVersion, status: 'monitoring', registered: ['home', 'work'],
    reports: [
      { sequence: 1, at, baseline: true, states: { home: false, work: false } },
      { sequence: 2, at, baseline: false, states: { home: true } },
      { sequence: 3, at, baseline: false, states: { work: true } },
    ],
  });
  const snapshot = await f.service.read(f.owner);
  assert.equal(snapshot.phone.scopes.zones, false);
  assert.equal(snapshot.session.deadline, at + 25 * 60_000);
});
