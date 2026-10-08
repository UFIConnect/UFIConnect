'use strict';

const assert = require('node:assert/strict');
const { before, after, beforeEach, test } = require('node:test');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { createGenerationUsage, GENERATION_LIMITS, schemaStatements } = require('./generation-usage');

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const OCTOBER = Date.parse('2026-10-07T12:00:00Z');
let pg;

async function initialize(database) {
  await database.exec('CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY)');
  for (const statement of schemaStatements) await database.exec(statement);
}

function service(overrides = {}) {
  return createGenerationUsage({ query: (sql, params) => pg.query(sql, params), connected: () => true,
    now: () => OCTOBER, ...overrides });
}

const unavailable = error => error.status === 503 && error.code === 'GENERATION_USAGE_UNAVAILABLE';

before(async () => {
  pg = new PGlite();
  await initialize(pg);
  await initialize(pg);
});
after(async () => { await pg.close(); });
beforeEach(async () => {
  await pg.exec('DELETE FROM users');
  await pg.query('INSERT INTO users(id) VALUES ($1),($2)', [A, B]);
});

test('reports fixed monthly quotas and isolates users and generation types', async () => {
  assert.deepEqual(GENERATION_LIMITS, { video: 20, image: 50, resume: 30 });
  const store = service();
  const empty = await store.usage(A);
  assert.deepEqual(empty.period, { startsAt: '2026-10-01T00:00:00.000Z', resetsAt: '2026-11-01T00:00:00.000Z' });
  assert.deepEqual(empty.limits, {
    video: { limit: 20, used: 0, remaining: 20 },
    image: { limit: 50, used: 0, remaining: 50 },
    resume: { limit: 30, used: 0, remaining: 30 },
  });
  for (const kind of Object.keys(GENERATION_LIMITS)) {
    const reservation = await store.reserve(A, kind);
    assert.equal(reservation.userId, A);
    assert.equal(reservation.kind, kind);
    assert.equal(reservation.periodStart, empty.period.startsAt);
    assert.equal(reservation.usage.limits[kind].used, 1);
  }
  assert.deepEqual((await store.usage(B)).limits, empty.limits);
  await store.reserve(B, 'image');
  await store.reserve(B, 'image');
  assert.equal((await store.usage(A)).limits.image.used, 1);
  assert.equal((await store.usage(B)).limits.image.used, 2);
  await assert.rejects(store.reserve(A, '__proto__'), error => error.status === 400);
});

test('concurrent requests from independent services cannot exceed any quota', async () => {
  const workers = [service(), service(), service()];
  // PGlite executes real PostgreSQL statements on one connection. No service
  // mutex serializes these calls; production workers use the same SQL row lock.
  await Promise.all(Object.entries(GENERATION_LIMITS).map(async ([kind, limit]) => {
    const attempts = await Promise.allSettled(Array.from({ length: limit + 12 }, (_, index) =>
      workers[index % workers.length].reserve(A, kind)));
    const accepted = attempts.filter(result => result.status === 'fulfilled');
    const rejected = attempts.filter(result => result.status === 'rejected');
    assert.equal(accepted.length, limit, kind);
    assert.equal(rejected.length, 12, kind);
    for (const { reason } of rejected) {
      assert.equal(reason.status, 429);
      assert.equal(reason.code, 'MONTHLY_GENERATION_LIMIT');
      assert.equal(reason.kind, kind);
      assert.equal(reason.resetsAt, '2026-11-01T00:00:00.000Z');
      assert.deepEqual(reason.usage.limits[kind], { limit, used: limit, remaining: 0 });
    }
    assert.equal(new Set(accepted.map(result => result.value.id)).size, limit);
  }));
  for (const [kind, limit] of Object.entries(GENERATION_LIMITS)) {
    assert.equal((await workers[0].usage(A)).limits[kind].used, limit);
  }
  const { rows } = await pg.query('SELECT COUNT(*)::integer AS count FROM generation_usage_reservations');
  assert.equal(rows[0].count, 100);
  assert.equal((await workers[1].reserve(B, 'video')).usage.limits.video.used, 1);
});

test('a failed request releases exactly once and its slot can be reused', async () => {
  const store = service();
  const reservations = await Promise.all(Array.from({ length: 20 }, () => store.reserve(A, 'video')));
  await assert.rejects(store.reserve(A, 'video'), error => error.status === 429);
  const releases = await Promise.all(Array.from({ length: 15 }, () => service().release(reservations[0])));
  assert.equal(releases.filter(Boolean).length, 1);
  assert.equal((await store.usage(A)).limits.video.used, 19);
  const replacement = await service().reserve(A, 'video');
  assert.equal(replacement.usage.limits.video.used, 20);
  assert.equal(await store.release(reservations[0]), false);
  assert.equal(await store.complete(reservations[0]), false);
  assert.equal((await store.usage(A)).limits.video.used, 20);
  const { rows } = await pg.query('SELECT state FROM generation_usage_reservations WHERE id=$1', [reservations[0].id]);
  assert.equal(rows[0].state, 'released');
});

test('completed and accepted jobs stay counted across duplicate terminal transitions', async () => {
  const store = service();
  const successful = await store.reserve(A, 'image');
  assert.equal(await store.complete(successful), true);
  assert.equal(await service().complete(successful), false);
  assert.equal(await service().release(successful), false);
  const acceptedAsyncJob = await store.reserve(A, 'video');
  await store.complete(acceptedAsyncJob);
  assert.equal(await service().release(acceptedAsyncJob), false);
  const raced = await store.reserve(A, 'resume');
  const transitions = await Promise.all([store.complete(raced), service().release(raced)]);
  assert.equal(transitions.filter(Boolean).length, 1);
  assert.equal(await store.release(raced), false);
  const { rows } = await pg.query('SELECT state FROM generation_usage_reservations WHERE id=$1', [raced.id]);
  const usage = await store.usage(A);
  assert.equal(usage.limits.image.used, 1);
  assert.equal(usage.limits.video.used, 1);
  assert.equal(usage.limits.resume.used, rows[0].state === 'completed' ? 1 : 0);
  assert.equal(await store.release({ ...successful, userId: B }), false);
});

test('UTC calendar months reset at the boundary and late release changes only its original month', async () => {
  let clock = Date.parse('2028-01-31T23:59:59.999Z');
  const store = service({ now: () => clock });
  const oldReservations = await Promise.all(Array.from({ length: 20 }, () => store.reserve(A, 'video')));
  assert.equal((await store.usage(A)).period.resetsAt, '2028-02-01T00:00:00.000Z');
  clock += 1;
  assert.equal((await store.usage(A)).limits.video.used, 0);
  assert.equal((await store.usage(A)).period.resetsAt, '2028-03-01T00:00:00.000Z');
  const current = await store.reserve(A, 'video');
  assert.equal(current.periodStart, '2028-02-01T00:00:00.000Z');
  await store.release(oldReservations[0]);
  assert.equal((await store.usage(A)).limits.video.used, 1);
  const { rows } = await pg.query("SELECT used FROM generation_usage WHERE user_id=$1 AND kind='video' AND period_start='2028-01-01'", [A]);
  assert.equal(rows[0].used, 19);
  clock = Date.parse('2028-12-31T23:59:59.999Z');
  assert.equal((await store.usage(A)).period.resetsAt, '2029-01-01T00:00:00.000Z');
  clock += 1;
  assert.equal((await store.usage(A)).period.startsAt, '2029-01-01T00:00:00.000Z');
});

test('database outages fail closed and cannot change durable usage', async () => {
  let connected = true;
  let failQueries = false;
  let queryCalls = 0;
  const store = service({ connected: () => connected, query: (sql, params) => {
    queryCalls++;
    if (failQueries) throw new Error('database connection secret should not reach response');
    return pg.query(sql, params);
  } });
  const reservation = await store.reserve(A, 'resume');
  for (const mode of ['disconnected', 'query failure']) {
    connected = mode !== 'disconnected';
    failQueries = mode === 'query failure';
    const callsBefore = queryCalls;
    for (const action of [() => store.usage(A), () => store.reserve(A, 'resume'),
      () => store.complete(reservation), () => store.release(reservation)]) {
      await assert.rejects(action(), error => unavailable(error) && !error.message.includes('secret'));
    }
    if (!connected) assert.equal(queryCalls, callsBefore);
  }
  connected = true; failQueries = false;
  assert.equal((await store.usage(A)).limits.resume.used, 1);
  assert.equal(await store.release(reservation), true);
  assert.equal((await store.usage(A)).limits.resume.used, 0);
});

test('reservation insert failure rolls back the counter in the same statement', async () => {
  await pg.exec(`CREATE FUNCTION reject_generation_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'simulated reservation write failure'; END $$;
    CREATE TRIGGER reject_generation_reservation BEFORE INSERT ON generation_usage_reservations
    FOR EACH ROW EXECUTE FUNCTION reject_generation_reservation()`);
  try {
    await assert.rejects(service().reserve(A, 'image'), unavailable);
    assert.equal((await service().usage(A)).limits.image.used, 0);
  } finally {
    await pg.exec('DROP TRIGGER reject_generation_reservation ON generation_usage_reservations; DROP FUNCTION reject_generation_reservation()');
  }
  assert.equal((await service().reserve(A, 'image')).usage.limits.image.used, 1);
});

test('account deletion cascades through counters and reservations', async () => {
  await service().reserve(A, 'image');
  await service().reserve(B, 'image');
  await pg.query('DELETE FROM users WHERE id=$1', [A]);
  for (const table of ['generation_usage', 'generation_usage_reservations']) {
    const { rows } = await pg.query(`SELECT user_id FROM ${table}`);
    assert.deepEqual(rows.map(row => row.user_id), [B]);
  }
});

test('reservations and terminal states survive closing and reopening the database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'generation-usage-'));
  let database;
  const open = () => {
    database = new PGlite(directory);
    return createGenerationUsage({ query: (sql, params) => database.query(sql, params),
      connected: () => true, now: () => OCTOBER });
  };
  try {
    let store = open();
    await initialize(database);
    await database.query('INSERT INTO users(id) VALUES ($1)', [A]);
    const pending = await store.reserve(A, 'video');
    const completed = await store.reserve(A, 'video');
    const released = await store.reserve(A, 'video');
    await store.complete(completed);
    await store.release(released);
    await database.close(); database = null;
    store = open();
    assert.equal((await store.usage(A)).limits.video.used, 2);
    assert.equal(await store.release(completed), false);
    assert.equal(await store.release(released), false);
    assert.equal(await store.release(pending), true);
    assert.equal((await store.usage(A)).limits.video.used, 1);
  } finally {
    if (database) await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
