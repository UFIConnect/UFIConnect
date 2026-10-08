'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { randomUUID } = require('node:crypto');
const { ANALYTICS_SCHEMA, createAggregateAnalytics } = require('./aggregate-analytics');
const { OFFICE_MEMBERS_SCHEMA, createOfficeMembers } = require('./office-members');
const { LEGACY_PAGEVIEW_CATALOG, LEGACY_PAGEVIEW_QUERY, HISTORY_ANALYTICS_UPSERT, HISTORY_REGISTRATION_UPSERT } = require('./analytics-history');
const response = () => ({ set() { return this; }, status() { return this; }, json(body) { this.body = body; } });

test('legacy recovery classifies public routes inside SQL without returning paths, queries or private activity', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec('CREATE TABLE page_views(path TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL)');
  for (const path of ['/?token=SENSITIVE','/UFIConnect/maps?email=SENSITIVE','/groups/SENSITIVE#secret','/global-scroll',
    '/vault/device','/UFIConnect/vault','/oauth/callback?code=SENSITIVE','/%76ault','/app/vpn','/unknown-private']) {
    await pg.query("INSERT INTO page_views VALUES($1,'2026-08-11T12:00:00Z')", [path]);
  }
  await pg.exec("INSERT INTO page_views VALUES('/','2026-09-17T00:00:00Z')");
  const { rows } = await pg.query(LEGACY_PAGEVIEW_QUERY, ['2026-05-01T00:00:00Z','2026-09-17T00:00:00Z',LEGACY_PAGEVIEW_CATALOG]);
  assert.deepEqual(rows.map(row => [row.category,Number(row.event_count)]).sort(), [['global',1],['group',1],['home',1],['maps',1]]);
  assert.ok(rows.every(row => row.day === '2026-08-11'));
  assert.doesNotMatch(JSON.stringify(rows), /SENSITIVE|\/vault|private|token|email/);
});

test('idempotent provenance recovery restores older daily views while preserving recent window totals', async t => {
  const pg = new PGlite(); t.after(() => pg.close()); await pg.exec(ANALYTICS_SCHEMA);
  await pg.exec("INSERT INTO analytics_daily_counts VALUES ('2026-10-08','home','page_view','',3)");
  const restored = JSON.stringify([{ day:'2026-08-11',category:'home',event_count:4 }]);
  await pg.query(HISTORY_ANALYTICS_UPSERT, ['legacy_page_views_backup',restored]);
  await pg.query(HISTORY_ANALYTICS_UPSERT, ['legacy_page_views_backup',restored]);
  await pg.query(HISTORY_ANALYTICS_UPSERT, ['legacy_page_views_primary',JSON.stringify([{ day:'2026-08-14',category:'home',event_count:5 }])]);
  const metrics = createAggregateAnalytics({ db: { isConnected: () => true, query: (...args) => pg.query(...args) },
    now: () => Date.parse('2026-10-08T12:00:00Z'), schedule() {} });
  const res = response(); await metrics.report({},res);
  assert.equal(res.body.history.firstRecordedDay,'2026-08-11');
  assert.equal(res.body.history.restoredViews,9); assert.equal(res.body.history.sources.length,3);
  assert.equal(res.body.daily.find(row => row.day === '2026-08-11').views,4);
  assert.deepEqual([res.body.today,res.body.last7,res.body.last30],[3,3,3]);
  assert.equal((await pg.query('SELECT count(*)::int AS total FROM analytics_history_daily_counts')).rows[0].total,2);
});

test('registration recovery shows authentic May date without recreating accounts or counting a matched identity twice', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec("CREATE TABLE users(id UUID PRIMARY KEY,name TEXT,email TEXT,created_at TIMESTAMPTZ,onboarding_complete BOOLEAN,profile_hidden BOOLEAN,role_settings JSONB)");
  for (const sql of OFFICE_MEMBERS_SCHEMA) await pg.exec(sql);
  const id = randomUUID();
  await pg.query("INSERT INTO users VALUES($1,'Current member','member@example.invalid','2026-10-08T00:00:00Z',false,false,'{}')",[id]);
  await pg.query("INSERT INTO registration_history_date_corrections(user_id,registered_day,source) VALUES($1,'2026-05-31','database_backup_20261008')",[id]);
  const restored = JSON.stringify([{ day:'2026-08-12',event_count:14 }]);
  await pg.query(HISTORY_REGISTRATION_UPSERT,[restored]); await pg.query(HISTORY_REGISTRATION_UPSERT,[restored]);
  const service = createOfficeMembers({ db: { isConnected: () => true, query: (...args) => pg.query(...args) }, schedule() {} });
  const result = await service.list({ days:'since_may' });
  assert.equal(result.total,1); assert.equal(result.recent.length,1);
  assert.equal(result.recent[0].registeredDay,'2026-05-31');
  assert.equal(Date.parse(result.recent[0].createdAt),Date.parse('2026-10-08T00:00:00Z'));
  assert.equal(result.knownRegistrationsSinceMay,15); assert.equal(result.recoveredRegistrations,14);
  assert.equal(result.registrationHistory.earlierRegistrationDates,1);
  assert.deepEqual(result.registrationHistory.daily.map(row => [row.day,row.currentRegistrations,row.recoveredRegistrations]),[['2026-05-31',1,0],['2026-08-12',0,14]]);
  assert.equal((await pg.query('SELECT count(*)::int AS total FROM users')).rows[0].total,1);
});
