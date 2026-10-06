const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const { REPORT_SCHEMA, createContentReports, registerContentReportRoutes, reportInput } = require('./content-reports');
const input = { targetType: 'post', targetId: 'youtube-example', reason: 'copyright', details: 'Private report evidence', source: 'youtube', sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk' };

async function fixture(t) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE reports(id TEXT PRIMARY KEY,reporter_id TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,
    reason TEXT NOT NULL,details TEXT,status TEXT NOT NULL DEFAULT 'open',created_at TIMESTAMPTZ DEFAULT NOW(),resolved_at TIMESTAMPTZ,resolved_by TEXT)`);
  await pg.exec(`CREATE TABLE creator_copyright_reports(id UUID PRIMARY KEY, status TEXT NOT NULL)`);
  for (const sql of REPORT_SCHEMA) await pg.exec(sql);
  const alerts = [];
  const db = { isConnected: () => true, query: (...args) => pg.query(...args) };
  const service = createContentReports({ db, notifyChildSafety: async value => alerts.push(value) });
  return { pg, db, service, alerts };
}

test('copyright and intimate-image reports persist without triggering source actions or sanctions', async t => {
  const { pg, service, alerts } = await fixture(t);
  const report = await service.submit('member-a', input);
  assert.equal(report.status, 'open');
  const intimate = await service.submit('member-b', { ...input, reason: 'nonconsensual_intimate' });
  assert.equal(intimate.status, 'open');
  assert.equal((await service.list('open')).reports.length, 2);
  assert.deepEqual((await service.history(report.id)).events, []);
  const stored = (await pg.query('SELECT * FROM reports WHERE id=$1', [report.id])).rows[0];
  assert.equal(stored.source_url, input.sourceUrl);
  assert.equal(stored.details, input.details);
  assert.equal(stored.resolved_at, null);
  assert.deepEqual(alerts, []);
  const safety = await service.submit('member-c', { ...input, reason: 'child_safety' });
  await Promise.resolve();
  assert.deepEqual(alerts, [{ id: safety.id }], 'Alert excludes report details and reporter identity');
  assert.equal((await service.list('open')).reports[0].id, safety.id);
});

test('review decisions and history commit together, fail closed, and never invent reviewer identity', async t => {
  const { pg, service } = await fixture(t);
  const { id } = await service.submit('member', input);
  await assert.rejects(service.review(id, { status: 'resolved' }), error => error.status === 400);
  await service.review(id, { status: 'resolved', note: 'Reviewed source and requested formal notice.' });
  let history = (await service.history(id)).events;
  assert.equal(history.length, 1);
  assert.deepEqual([history[0].previousStatus, history[0].status, history[0].actor], ['open', 'resolved', 'office']);
  await pg.exec(`ALTER TABLE report_review_events ADD CONSTRAINT reject_test_note CHECK(note <> 'simulate storage failure')`);
  await assert.rejects(service.review(id, { status: 'open', note: 'simulate storage failure' }));
  assert.equal((await service.list('resolved')).reports[0].id, id, 'Audit failure rolls back status');
  assert.equal((await service.history(id)).events.length, 1);
  await service.review(id, { status: 'open', note: 'New counter-notice requires review.' });
  history = (await service.history(id)).events;
  assert.equal(history.length, 2);
  await assert.rejects(service.review('missing', { status: 'resolved', note: 'A review note.' }), error => error.status === 404);
  await assert.rejects(service.history('missing'), error => error.status === 404);
  await pg.query('DELETE FROM reports WHERE reporter_id=$1', ['member']);
  assert.equal((await pg.query('SELECT * FROM report_review_events')).rows.length, 0, 'Account report deletion cascades private notes');
});

test('report input rejects unbounded details and forged source links while reports remain independent of source availability', () => {
  for (const body of [{ ...input, targetId: 'a'.repeat(301) }, { ...input, details: 'a'.repeat(1001) }, { ...input, reason: 'ban_user' }, { ...input, sourceUrl: 'https://youtube.com.evil.example/video' }, { ...input, sourceUrl: 'https://secret@youtube.com/watch?v=abcdefghijk' }, { ...input, sourceUrl: 'javascript:alert(1)' }, { ...input, role: 'admin' }]) {
    assert.throws(() => reportInput(body), error => error.status === 400);
  }
  const old = process.env.SOURCE_YOUTUBE_ENABLED;
  process.env.SOURCE_YOUTUBE_ENABLED = 'false';
  try { assert.equal(reportInput(input).source, 'youtube'); }
  finally { if (old === undefined) delete process.env.SOURCE_YOUTUBE_ENABLED; else process.env.SOURCE_YOUTUBE_ENABLED = old; }
});

test('report and evidence routes enforce authentication, private caching, durable storage and strict review status', async t => {
  const { db, service } = await fixture(t);
  const { id } = await service.submit('member-a', input);
  const app = express(); app.use(express.json());
  const authenticate = (req, res, next) => { if (req.get('x-member') !== 'member-a') return res.status(401).json({ message: 'Sign in' }); req.user = { id: 'member-a' }; next(); };
  const requireOfficeToken = (req, res, next) => req.get('x-office-token') === 'operator' ? next() : res.status(401).json({ message: 'Unauthorized' });
  registerContentReportRoutes(app, { db, authenticate, requireOfficeToken });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [path, method] of [['/reports', 'POST'], ['/office/reports', 'GET'], [`/office/reports/${id}`, 'PATCH'], [`/office/reports/${id}/history`, 'GET']]) {
    const response = await fetch(base + path, { method });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.doesNotMatch(await response.text(), /Private report evidence|member-a/);
  }
  const headers = { 'content-type': 'application/json', 'x-member': 'member-a' };
  let response = await fetch(base + '/reports', { method: 'POST', headers, body: JSON.stringify(input) });
  assert.equal(response.status, 200);
  assert.match((await response.json()).id, /^report_/);
  response = await fetch(base + '/office/reports', { headers });
  assert.equal(response.status, 401, 'An ordinary reporter cannot see the review queue');
  response = await fetch(base + `/office/reports/${id}`, { method: 'PATCH', headers: { ...headers, 'x-office-token': 'operator' }, body: JSON.stringify({ status: 'anything', note: 'A review note.' }) });
  assert.equal(response.status, 400);
  db.isConnected = () => false;
  response = await fetch(base + '/reports', { method: 'POST', headers, body: JSON.stringify(input) });
  assert.equal(response.status, 503);
  response = await fetch(base + '/office/reports', { headers: { 'x-office-token': 'operator' } });
  assert.equal(response.status, 503, 'An outage cannot look like an empty queue');
  db.isConnected = () => true;
  db.query = async () => { throw new Error('private database details and credentials'); };
  response = await fetch(base + '/reports', { method: 'POST', headers, body: JSON.stringify(input) });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private database|credentials/);
});
