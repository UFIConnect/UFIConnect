'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { welcomeWindows, createOfficeWelcome } = require('./office-welcome');
const { createAppHarness } = require('./test-support/app-harness');
const NOW = Date.parse('2026-11-04T19:23:47Z');

test('welcome windows use local midnight, Monday week start and completed minutes', () => {
  const result = welcomeWindows(NOW, 'America/Los_Angeles');
  assert.equal(result.asOf, '2026-11-04T19:23:00.000Z');
  assert.deepEqual(result.windows, {
    past24h: { from: '2026-11-03T19:23:00.000Z', to: result.asOf },
    today: { from: '2026-11-04T08:00:00.000Z', to: result.asOf },
    week: { from: '2026-11-02T08:00:00.000Z', to: result.asOf },
  });
  const midnight = welcomeWindows(Date.parse('2026-11-02T08:00:18Z'), 'America/Los_Angeles');
  assert.equal(midnight.windows.today.from, midnight.asOf);
  assert.equal(midnight.windows.week.from, midnight.asOf);
  const sunday = welcomeWindows(Date.parse('2026-11-02T07:59:59Z'), 'America/Los_Angeles');
  assert.equal(sunday.windows.week.from, '2026-10-26T07:00:00.000Z');
  assert.throws(() => welcomeWindows(NOW, 'Not/AZone'), RangeError);
});

test('calendar windows handle spring-forward and fall-back DST without shifting the rolling 24 hours', () => {
  const spring = welcomeWindows(Date.parse('2026-03-09T06:59:40Z'), 'America/Los_Angeles');
  assert.equal(spring.windows.today.from, '2026-03-08T08:00:00.000Z');
  assert.equal(Date.parse(spring.asOf) - Date.parse(spring.windows.past24h.from), 86400000);
  const fall = welcomeWindows(Date.parse('2026-11-02T07:59:40Z'), 'America/Los_Angeles');
  assert.equal(fall.windows.today.from, '2026-11-01T07:00:00.000Z');
  assert.equal(Date.parse(fall.asOf) - Date.parse(fall.windows.today.from), (25 * 60 - 1) * 60000);
  const midnightShift = welcomeWindows(Date.parse('2026-09-06T17:00:00Z'), 'America/Santiago');
  assert.equal(midnightShift.windows.today.from, '2026-09-06T04:00:00.000Z');
});

async function fixture(t) {
  const pg = new PGlite(); await pg.waitReady;
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE community_posts (id TEXT,source TEXT,created_at TIMESTAMPTZ);
    CREATE TABLE feed_posts_cache (id TEXT,source TEXT,post_created_at TIMESTAMPTZ);
    CREATE TABLE users (id TEXT,created_at TIMESTAMPTZ);
    CREATE TABLE registration_history_date_corrections (user_id TEXT,registered_day DATE);
    CREATE TABLE server_error_events (id TEXT,message TEXT,created_at TIMESTAMPTZ);
    CREATE TABLE office_control_runs (id TEXT,control_label TEXT,status TEXT,started_at TIMESTAMPTZ,finished_at TIMESTAMPTZ);
    CREATE TABLE office_ai_tasks (id TEXT,data JSONB,status TEXT,updated_at TIMESTAMPTZ);
    CREATE TABLE office_ai_memory (id TEXT,scope TEXT,deleted_at TIMESTAMPTZ,kind TEXT,role TEXT,created_at TIMESTAMPTZ,mode TEXT,status TEXT);`);
  const db = { isConnected: () => true, query: (...args) => pg.query(...args) };
  return { pg, db };
}

test('welcome counts honor boundaries, exclude restored accounts, redact latest activity and persist warning evidence', async t => {
  const { pg, db } = await fixture(t);
  await pg.exec(`INSERT INTO community_posts VALUES
    ('1','uficonnect','2026-11-04T08:00Z'),('2','uficonnect','2026-11-03T20:00Z'),('3','uficonnect','2026-11-02T09:00Z'),
    ('4','uficonnect','2026-11-04T19:23Z'),('5','live_camera','2026-11-04T09:00Z');
    INSERT INTO feed_posts_cache VALUES ('i1','reddit','2026-11-04T09:00Z'),('i2','uficonnect','2026-11-04T09:00Z');
    INSERT INTO users VALUES ('u1','2026-11-04T08:00Z'),('u2','2026-11-03T20:00Z'),('restored','2026-11-04T08:00Z'),('future','2026-11-04T19:23Z');
    INSERT INTO registration_history_date_corrections VALUES ('restored','2026-07-01');
    INSERT INTO server_error_events VALUES ('e1','secret-stack','2026-11-03T19:23Z'),('e2','next-minute','2026-11-04T19:23Z');
    INSERT INTO office_control_runs VALUES ('c1','Refresh sources','failed','2026-11-04T08:00Z','2026-11-04T08:02Z');
    INSERT INTO office_ai_tasks VALUES ('t1','{"message":"Update homepage secret-provider-key"}','succeeded','2026-11-04T19:23:20Z');
    INSERT INTO office_ai_memory(id,scope,deleted_at,kind,role,created_at) VALUES ('m1','office',NULL,'conversation','user','2026-11-04T19:23:30Z'),
      ('deleted','office','2026-11-04T19:23:32Z','conversation','user','2026-11-04T19:23:31Z'),
      ('file','office',NULL,'note','system','2026-11-04T19:23:35Z');
    INSERT INTO office_ai_memory VALUES ('critical','office',NULL,'note','system','2026-11-04T08:30Z','activity','critical'),
      ('forgotten-critical','office','2026-11-04T08:33Z','note','system','2026-11-04T08:31Z','activity','critical');`);
  let analyticsInput, memoryId;
  const service = createOfficeWelcome({ db, now: () => NOW, env: { PROVIDER_API_KEY: 'secret-provider-key' },
    memory: { get: async id => { memoryId = id; return { kind: 'conversation',role:'user',title:'Discuss secret-provider-key next steps',createdAt:'2026-11-04T19:23:30Z' }; } },
    analytics: { welcomeSnapshot: async input => { analyticsInput = input; return { available: true, windows: {} }; } } });
  const report = await service.readSummary({ timeZone: 'America/Los_Angeles' });
  assert.deepEqual(report.counts, {
    past24h: { posts: { memberCreated: 2, importedRetained: 1 }, newUsers: 2 },
    today: { posts: { memberCreated: 1, importedRetained: 1 }, newUsers: 1 },
    week: { posts: { memberCreated: 3, importedRetained: 1 }, newUsers: 2 },
  });
  assert.equal(report.definitions.registrationCorrections, 'applied');
  assert.equal(report.warnings.serverErrors, 1);
  assert.equal(report.warnings.failedControls, 1);
  assert.equal(report.warnings.criticalActivityFindings, 1);
  assert.equal(report.warnings.coverage.exhaustive, false);
  assert.equal(report.warnings.available, true);
  assert.equal(report.lastActivity.latest.kind, 'conversation');
  assert.equal(report.lastActivity.latest.at, '2026-11-04T19:23:30.000Z');
  assert.equal(memoryId, 'm1', 'Only the newest relevant record is decrypted');
  assert.ok(!JSON.stringify(report).includes('secret-provider-key'));
  assert.ok(!JSON.stringify(report).includes('secret-stack'));
  assert.deepEqual(analyticsInput, { windows: report.windows, asOf: report.asOf });
});

test('failed sources remain unavailable while independent counts and last actions survive', async t => {
  const { pg, db } = await fixture(t);
  await pg.exec("DROP TABLE feed_posts_cache; DROP TABLE server_error_events; INSERT INTO office_control_runs VALUES ('c1','Health check','succeeded','2026-11-04T11:00Z','2026-11-04T11:01Z');");
  const service = createOfficeWelcome({ db, now: () => NOW, memory: { get: async () => null }, analytics: { welcomeSnapshot: async () => { throw Error('private connection string'); } } });
  const report = await service.readSummary({ timeZone: 'America/Los_Angeles' });
  assert.equal(report.counts.today.posts.importedRetained, null);
  assert.equal(report.counts.today.posts.memberCreated, 0);
  assert.equal(report.counts.today.newUsers, 0);
  assert.equal(report.sources.importedPosts, 'unavailable');
  assert.equal(report.warnings.available, false);
  assert.equal(report.warnings.serverErrors, null);
  assert.equal(report.warnings.failedControls, 0);
  assert.equal(report.lastActivity.latest.label, 'Health check');
  assert.equal(report.lastActivity.available, true);
  assert.equal(report.lastActivity.complete, true);
  assert.equal(report.analytics.available, false);
  assert.ok(!JSON.stringify(report).includes('private connection'));
  const offline = await createOfficeWelcome({ db: { isConnected: () => false }, now: () => NOW }).readSummary();
  assert.equal(offline.counts.today.newUsers, null);
  assert.equal(offline.lastActivity.available, false);
  assert.equal(offline.lastActivity.complete, false);
  assert.equal(offline.lastActivity.latest, null);
});

test('registration correction failures never turn restored accounts into new users', async t => {
  const { pg, db } = await fixture(t);
  await pg.exec("INSERT INTO users VALUES ('restored','2026-11-04T08:00Z'); INSERT INTO registration_history_date_corrections VALUES ('restored','2026-07-01');");
  const broken = { ...db, query: (sql, params) => {
    if (sql.includes('FROM users u')) throw Error('Correction read failed');
    return db.query(sql, params);
  } };
  const report = await createOfficeWelcome({ db: broken, now: () => NOW }).readSummary({ timeZone: 'America/Los_Angeles' });
  assert.equal(report.counts.today.newUsers, null);
  assert.equal(report.sources.newUsers, 'unavailable');
  assert.equal(report.counts.today.posts.memberCreated, 0);
});

test('partial activity sources preserve available latest actions with incomplete coverage', async t => {
  const { pg, db } = await fixture(t);
  await pg.exec("DROP TABLE office_ai_memory; DROP TABLE office_ai_tasks; INSERT INTO office_control_runs VALUES ('c1','Refresh the feed','succeeded','2026-11-04T11:00Z','2026-11-04T11:01Z');");
  const report = await createOfficeWelcome({ db, now: () => NOW }).readSummary({ timeZone: 'America/Los_Angeles' });
  assert.equal(report.lastActivity.available, true);
  assert.equal(report.lastActivity.complete, false);
  assert.equal(report.lastActivity.latest.label, 'Refresh the feed');
  assert.deepEqual(report.lastActivity.sources, { memory: 'unavailable', controls: 'available', tasks: 'unavailable' });
});

test('missing or malformed database counts are unavailable instead of zero', async () => {
  const db = { isConnected: () => true, query: async () => ({ rows: [{ past24h: null, week: 'NaN', count: null }] }) };
  const report = await createOfficeWelcome({ db, now: () => NOW }).readSummary();
  for (const window of Object.values(report.counts)) assert.deepEqual(window, { posts: { memberCreated: null, importedRetained: null }, newUsers: null });
  assert.deepEqual(report.sources, { memberPosts: 'unavailable', importedPosts: 'unavailable', newUsers: 'unavailable' });
  assert.equal(report.warnings.serverErrors, null);
  assert.equal(report.warnings.failedControls, null);
  assert.equal(report.warnings.criticalActivityFindings, null);
  assert.equal(report.warnings.available, false);
});

test('welcome handler rejects unsupported services and malformed time zones without leaking errors', async () => {
  const response = () => ({ statusCode: 200, headers: {}, set(name, value) { this.headers[name] = value; return this; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } });
  const api = createOfficeWelcome({ db: { isConnected: () => false }, now: () => NOW });
  const invalid = response(); await api.report({ query: { timeZone: ['UTC', 'America/Los_Angeles'] } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.headers['Cache-Control'], /private, no-store/);
  const offline = response(); await api.report({ query: { timeZone: 'America/Los_Angeles' } }, offline);
  assert.equal(offline.statusCode, 200);
  assert.equal(offline.body.counts.today.newUsers, null);
  const pipeline = response(); await createOfficeWelcome({ serviceRole: 'pipeline' }).report({ query: {} }, pipeline);
  assert.equal(pipeline.statusCode, 409);
});

test('welcome route requires Office auth, rejects invalid zones, is private and API-only', async t => {
  const app = await createAppHarness({ env: { OFFICE_TOKEN: 'welcome-test-token' }, clock: () => NOW });
  t.after(() => app.close());
  assert.equal((await app.request('/office/welcome')).status, 401);
  const headers = { 'x-office-token': 'welcome-test-token' };
  const response = await app.request('/office/welcome?timeZone=America%2FLos_Angeles', { headers });
  assert.equal(response.status, 200);
  assert.equal(response.data.schemaVersion, 1);
  assert.equal(response.data.timeZone, 'America/Los_Angeles');
  assert.match(response.headers.get('cache-control'), /private.*no-store/);
  assert.equal((await app.request('/office/welcome?timeZone=Invalid%2FZone', { headers })).status, 400);
  const pipeline = await createAppHarness({ env: { OFFICE_TOKEN: 'welcome-test-token', SERVICE_ROLE: 'pipeline' } });
  t.after(() => pipeline.close());
  assert.equal((await pipeline.request('/office/welcome', { headers })).status, 409);
});
