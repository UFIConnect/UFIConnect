const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const { REPORT_SCHEMA, createContentReports, registerContentReportRoutes, reportInput, createReportVisibilityFilter, reportSuppressionPredicate } = require('./content-reports');
const input = { targetType: 'post', targetId: 'youtube-example', reason: 'copyright', details: 'Private report evidence', source: 'youtube', sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk' };

async function fixture(t) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE reports(id TEXT PRIMARY KEY,reporter_id TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,
    reason TEXT NOT NULL,details TEXT,status TEXT NOT NULL DEFAULT 'open',created_at TIMESTAMPTZ DEFAULT NOW(),resolved_at TIMESTAMPTZ,resolved_by TEXT)`);
  await pg.exec(`CREATE TABLE creator_copyright_reports(id UUID PRIMARY KEY, status TEXT NOT NULL)`);
  await pg.exec('CREATE TABLE users(id UUID PRIMARY KEY)');
  await pg.exec(`CREATE TABLE community_posts(id TEXT PRIMARY KEY,source TEXT DEFAULT 'uficonnect',comments_count INTEGER DEFAULT 0);
    CREATE TABLE post_comments(id TEXT PRIMARY KEY,post_id TEXT NOT NULL);
    CREATE TABLE feed_posts_cache(id TEXT PRIMARY KEY,source TEXT NOT NULL,source_url TEXT);
    CREATE TABLE feed_posts_staging(LIKE feed_posts_cache INCLUDING ALL);
    CREATE TABLE feed_posts_archive(LIKE feed_posts_cache INCLUDING ALL);`);
  for (const sql of REPORT_SCHEMA) await pg.exec(sql);
  const alerts = [];
  const db = { isConnected: () => true, query: (...args) => pg.query(...args), withClient: fn => fn(pg) };
  const removed = [];
  const service = createContentReports({ db, notifyChildSafety: async value => alerts.push(value), onRemoved: value => removed.push(value) });
  return { pg, db, service, alerts, removed };
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
  for (const [path, method] of [['/reports', 'POST'], ['/office/reports', 'GET'], [`/office/reports/${id}`, 'PATCH'], [`/office/reports/${id}/history`, 'GET'], [`/office/reports/${id}/actions`, 'GET'], [`/office/reports/${id}/actions`, 'POST']]) {
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

const action = (name, key = 'request-reference-0001', note = 'Reviewed the stored target and supporting evidence.') => ({ action: name, note, confirmed: true, idempotencyKey: key });
async function cacheTarget(pg, id = input.targetId, url = input.sourceUrl, source = input.source) {
  await pg.query('INSERT INTO feed_posts_cache(id,source,source_url) VALUES($1,$2,$3)', [id, source, url]);
}

test('external removal commits durable suppression, all cached copies, report status and one idempotent audit', async t => {
  const { pg, service, removed } = await fixture(t);
  await cacheTarget(pg);
  await pg.query('INSERT INTO feed_posts_staging VALUES($1,$2,$3)', ['other-source-id', input.source, input.sourceUrl]);
  await pg.query('INSERT INTO feed_posts_archive VALUES($1,$2,$3)', [input.targetId, input.source, input.sourceUrl]);
  await cacheTarget(pg, 'unrelated-post', 'https://www.youtube.com/watch?v=zzzzzzzzzzz');
  const { id } = await service.submit('member', input);
  const choices = await service.actions(id);
  assert.equal(choices.removal.available, true);
  const result = await service.act(id, action('remove_uficonnect'));
  assert.equal(result.removed, true);
  assert.equal(result.kind, 'external_post');
  assert.equal((await pg.query('SELECT id FROM feed_posts_cache')).rows[0].id, 'unrelated-post');
  for (const table of ['feed_posts_staging', 'feed_posts_archive']) assert.equal((await pg.query(`SELECT * FROM ${table}`)).rows.length, 0);
  assert.equal((await pg.query('SELECT * FROM report_content_suppressions')).rows.length, 1);
  assert.equal((await service.list('resolved')).reports[0].id, id);
  assert.equal((await service.actions(id)).removal.removed, true);
  assert.equal((await service.act(id, action('remove_uficonnect'))).replayed, true);
  assert.equal((await service.history(id)).events.length, 1);
  assert.equal(removed.length, 1);
  await assert.rejects(service.act(id, action('remove_uficonnect', 'request-reference-0001', 'Changed the original action note.')), error => error.status === 409);
  await pg.query('DELETE FROM reports WHERE id=$1', [id]);
  assert.equal((await pg.query('SELECT * FROM report_review_events')).rows.length, 0);
  assert.equal((await pg.query('SELECT * FROM report_content_suppressions')).rows.length, 1, 'Reporter deletion cannot restore removed content');
});

test('native removal deletes stored posts and discussions or a comment and its count', async t => {
  const { pg, service } = await fixture(t);
  await pg.exec("INSERT INTO community_posts(id,comments_count) VALUES('native-post',2); INSERT INTO post_comments VALUES('comment-a','native-post'),('comment-b','native-post')");
  const comment = await service.submit('member', { targetType: 'comment', targetId: 'comment-a', reason: 'harassment' });
  await service.act(comment.id, action('remove_uficonnect'));
  assert.equal((await pg.query("SELECT comments_count FROM community_posts WHERE id='native-post'")).rows[0].comments_count, 1);
  assert.equal((await pg.query('SELECT id FROM post_comments')).rows[0].id, 'comment-b');
  const post = await service.submit('member', { targetType: 'post', targetId: 'native-post', source: 'uficonnect', reason: 'spam' });
  await service.act(post.id, action('remove_uficonnect'));
  assert.equal((await pg.query('SELECT * FROM community_posts')).rows.length, 0);
  assert.equal((await pg.query('SELECT * FROM post_comments')).rows.length, 0);
  assert.equal((await pg.query('SELECT * FROM report_content_suppressions')).rows.length, 2);
});

test('forged report identity and missing targets cannot authorize removal or source reporting', async t => {
  const { pg, service } = await fixture(t);
  await cacheTarget(pg);
  const forged = await service.submit('member', { ...input, sourceUrl: 'https://www.youtube.com/watch?v=zzzzzzzzzzz' });
  assert.equal((await service.actions(forged.id)).removal.available, false);
  for (const name of ['remove_uficonnect', 'source_handoff']) await assert.rejects(service.act(forged.id, action(name)), error => error.status === 409);
  const wrongSource = await service.submit('member', { ...input, source: 'github', sourceUrl: 'https://github.com/example/project' });
  await assert.rejects(service.act(wrongSource.id, action('remove_uficonnect')), error => error.status === 409);
  const missing = await service.submit('member', { ...input, targetId: 'missing-post' });
  await assert.rejects(service.act(missing.id, action('remove_uficonnect')), error => error.status === 409);
  assert.equal((await pg.query('SELECT * FROM feed_posts_cache')).rows.length, 1);
  assert.equal((await pg.query('SELECT * FROM report_content_suppressions')).rows.length, 0);
  assert.equal((await pg.query('SELECT * FROM report_review_events')).rows.length, 0);
});

test('audit failure rolls back removal and suppression; actions require explicit confirmation and a note', async t => {
  const { pg, service } = await fixture(t);
  await cacheTarget(pg);
  const { id } = await service.submit('member', input);
  await pg.exec("ALTER TABLE report_review_events ADD CONSTRAINT action_audit_failure CHECK(note <> 'simulate action failure')");
  await assert.rejects(service.act(id, action('remove_uficonnect', 'request-reference-0001', 'simulate action failure')));
  assert.equal((await pg.query('SELECT * FROM feed_posts_cache')).rows.length, 1);
  assert.equal((await pg.query('SELECT * FROM report_content_suppressions')).rows.length, 0);
  assert.equal((await service.list('open')).reports[0].id, id);
  for (const body of [{ ...action('remove_uficonnect'), confirmed: false }, { ...action('remove_uficonnect'), note: 'no' }, { ...action('remove_uficonnect'), targetId: 'forged' }]) {
    await assert.rejects(service.act(id, body), error => error.status === 400);
  }
});

test('source and support handoffs record manual submission only and never use supplied URLs as destinations', async t => {
  const { pg, service } = await fixture(t);
  await cacheTarget(pg);
  const { id } = await service.submit('member', input);
  const source = await service.act(id, action('source_handoff'));
  assert.equal(source.handoff.url, input.sourceUrl);
  assert.equal(source.handoff.helpUrl, 'https://support.google.com/youtube/answer/2802027');
  assert.equal(source.handoff.deliveryStatus, 'manual_submission_required');
  assert.equal(source.status, 'open');
  const support = await service.act(id, action('support_handoff', 'request-reference-0002'));
  assert.match(support.handoff.url, /^mailto:support@uficonnect\.org\?/);
  assert.doesNotMatch(decodeURIComponent(support.handoff.url), /Private report evidence/);
  assert.equal((await service.history(id)).events.length, 2);
  assert.equal((await pg.query('SELECT * FROM feed_posts_cache')).rows.length, 1);
  await cacheTarget(pg, 'unsafe-stored-post', 'https://youtube.com.evil.example/watch', 'youtube');
  const unsafe = await service.submit('member', { ...input, targetId: 'unsafe-stored-post', sourceUrl: undefined });
  assert.equal((await service.actions(unsafe.id)).source.available, false);
  await assert.rejects(service.act(unsafe.id, action('source_handoff')), error => error.status === 409);
});

test('primary visibility checks suppress reingested IDs and originals, fail closed, and expose safe SQL predicate', async t => {
  const { pg, db, service } = await fixture(t);
  await cacheTarget(pg);
  const { id } = await service.submit('member', input);
  await service.act(id, action('remove_uficonnect'));
  await cacheTarget(pg, 'new-ingestion-id');
  const filter = createReportVisibilityFilter({ db });
  const candidates = [{ id: input.targetId }, { id: 'new-ingestion-id', source: 'youtube', sourceUrl: input.sourceUrl }, { id: 'safe-post', source: 'github', sourceUrl: input.sourceUrl }];
  assert.deepEqual(await filter(candidates), [candidates[2]]);
  assert.equal((await pg.query(`SELECT * FROM feed_posts_cache fp WHERE ${reportSuppressionPredicate('fp')}`)).rows.length, 0);
  assert.throws(() => reportSuppressionPredicate('fp; DELETE FROM reports'));
  db.isConnected = () => false;
  await assert.rejects(filter(candidates), error => error.status === 503);
});

test('reported accounts link to account management only after verifying a real stored account', async t => {
  const { pg, service } = await fixture(t);
  const accountId='a0000000-0000-4000-8000-000000000001';
  await pg.query('INSERT INTO users(id) VALUES($1)',[accountId]);
  const report=await service.submit('member',{targetType:'user',targetId:accountId,reason:'harassment'});
  assert.deepEqual((await service.actions(report.id)).account,{available:true,id:accountId,url:`?account=${accountId}#analytics`});
  for(const targetId of ['missing-account','b0000000-0000-4000-8000-000000000002']) {
    const forged=await service.submit('member',{targetType:'user',targetId,reason:'spam'});
    assert.equal((await service.actions(forged.id)).account,null);
  }
});

test('Mastodon handoff validates the stored federated status and uses official reporting instructions',async t=>{
  const { pg, service }=await fixture(t);
  const sourceUrl='https://mastodon.social/@synthetic/123456789012345678';
  await cacheTarget(pg,'mastodon-verified',sourceUrl,'mastodon');
  const report=await service.submit('member',{targetType:'post',targetId:'mastodon-verified',source:'mastodon',sourceUrl,reason:'harassment'});
  const result=await service.act(report.id,action('source_handoff'));
  assert.equal(result.handoff.url,sourceUrl);
  assert.equal(result.handoff.helpUrl,'https://docs.joinmastodon.org/user/moderating/');
  assert.equal(result.handoff.deliveryStatus,'manual_submission_required');
});
