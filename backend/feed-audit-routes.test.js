'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const auditModule = require('./feed-audit');
const { createAppHarness } = require('./test-support/app-harness');

test('audit review and source controls require Office access, confirmation, and durable audit runs', async t => {
  const pg = new PGlite();
  const db = { isConnected: () => true, query: (...args) => pg.query(...args) };
  const audit = auditModule.createFeedAudit(db, { schedule: () => null });
  await audit.initialize();
  await pg.query(`CREATE TABLE office_control_runs(id TEXT PRIMARY KEY,control_id TEXT,control_label TEXT,category TEXT,target_role TEXT,decision_id TEXT,decision_title TEXT,status TEXT,result JSONB,started_at TIMESTAMPTZ,finished_at TIMESTAMPTZ,error TEXT,duration_ms INTEGER)`);
  const app = await createAppHarness({ connected: true, env: { OFFICE_TOKEN: 'audit-test-secret' },
    query: (sql, params) => pg.query(sql, params.map(value => typeof value?.toISOString === 'function' ? value.toISOString() : value)),
    modules: { './feed-audit': { ...auditModule, createFeedAudit: () => audit } } });
  t.after(async () => { await app.close(); await pg.close(); });
  assert.equal((await app.request('/office/feed-audit')).status, 401);
  assert.equal((await app.request('/office/feed-audit/items/anything')).status, 401);
  const headers = { 'x-office-token': 'audit-test-secret' };
  const execute = (id, body) => app.request(`/office/controls/${id}/execute`, { method: 'POST', headers, body });
  assert.equal((await execute('source.block.hackernews', { reason: 'Breach' })).status, 400);
  assert.equal((await execute('source.block.nonexistent', { confirmed: true, reason: 'Breach' })).status, 404);
  const blocked = await execute('source.block.hackernews', { confirmed: true, reason: 'Verified source breach' });
  assert.equal(blocked.status, 200, JSON.stringify(blocked.data));
  assert.equal(blocked.data.result.policy.blockedSources[0].source, 'hackernews');
  assert.equal(audit.access({ source: 'hn' }).allowed, false);
  const after = await app.request('/office/feed-audit?status=rejected', { headers });
  assert.equal(after.status, 200); assert.equal(after.data.policy.blockedSources[0].reason, 'Verified source breach');
  assert.equal(after.headers.get('cache-control'), 'no-store');
  const history = await pg.query("SELECT * FROM office_control_runs WHERE control_id='source.block.hn'");
  assert.equal(history.rows.length, 1); assert.equal(history.rows[0].status, 'succeeded');
  const unblocked = await execute('source.unblock.hackernews', { confirmed: true });
  assert.equal(unblocked.status, 200); assert.equal(audit.access({ source: 'hn' }).allowed, true);
});
test('staged transfer rolls back without deleting posts when policy becomes unavailable', async t => {
  const audit = auditModule.createFeedAudit({ isConnected: () => false }, { schedule: () => null });
  audit.reload = async () => {};
  audit.access = () => ({ allowed: false, reason: 'policy_unavailable' });
  const app = await createAppHarness({ connected: true, modules: { './feed-audit': { ...auditModule, createFeedAudit: () => audit } },
    query: async sql => sql.includes('WITH picked AS') ? { rows: [{ id: 'staged-one', source: 'reddit', title: 'Example article', content: 'A valid long article description.', source_url: 'https://example.org/post', post_created_at: new Date().toISOString() }] } : { rows: [], rowCount: 0 } });
  t.after(() => app.close());
  await app.transferStagedPosts({ maxBatches: 1, reason: 'test' });
  assert.ok(app.queries.some(({ sql }) => sql === 'ROLLBACK'));
  assert.equal(app.queries.some(({ sql }) => /DELETE FROM feed_posts_staging WHERE id = ANY/.test(sql)), false);
  assert.equal(app.queries.some(({ sql }) => /INSERT INTO feed_posts_cache/.test(sql)), false);
});
