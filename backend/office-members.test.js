const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const { OFFICE_MEMBERS_SCHEMA, createOfficeMembers, registerOfficeMemberRoutes } = require('./office-members');

async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW(),
    onboarding_complete BOOLEAN DEFAULT FALSE,profile_hidden BOOLEAN DEFAULT FALSE,role_settings JSONB DEFAULT '{}')`);
  for (const sql of OFFICE_MEMBERS_SCHEMA) await pg.exec(sql);
  let connected = true, cached = [];
  const sent = [];
  const options = { db: { isConnected: () => connected, query: (...args) => pg.query(...args) }, schedule: () => null,
    getCachedUserIds: () => cached, clearUserCache: () => { const n = cached.length; cached = []; return n; },
    mailAvailable: () => true, sendMail: async message => { sent.push(message); return { accepted: [message.to] }; } };
  return { pg, options, service: createOfficeMembers(options), sent, cache: value => { cached = value; }, disconnect: () => { connected = false; } };
}
async function user(pg, id = randomUUID(), values = {}) {
  await pg.query('INSERT INTO users(id,name,email,onboarding_complete,profile_hidden,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [id, values.name || 'Sample account', values.email || `${id}@example.invalid`, values.complete || false, values.hidden || false, values.createdAt || new Date().toISOString()]);
  return id;
}

test('authoritative account pages include completed, incomplete and hidden accounts without cached identities', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 55; i++) await user(f.pg, undefined, { complete: i < 30, hidden: i < 5 });
  f.cache(['cached-but-not-registered']);
  const first = await f.service.list();
  assert.equal(first.total, 55); assert.equal(first.onboarded, 30); assert.equal(first.incomplete, 25);
  assert.equal(first.hidden, 5); assert.equal(first.recent.length, 50); assert.equal(first.pagination.pages, 2); assert.equal(first.cacheUsed, false);
  const second = await f.service.list({ page: 2 });
  assert.equal(second.recent.length, 5);
  assert.equal(new Set([...first.recent,...second.recent].map(row => row.id)).size, 55);
  assert.equal((await f.service.list({ state: 'incomplete' })).pagination.total, 25);
  assert.equal((await f.service.list({ state: 'hidden' })).pagination.total, 5);
  await assert.rejects(f.service.list({ page: 'NaN' }), error => error.status === 400);
  await assert.rejects(f.service.list({ state: 'fake' }), error => error.status === 400);
});

test('account search treats wildcard and SQL syntax as literal text and calendar totals use UTC', async t => {
  const f = await fixture(t);
  const id = await user(f.pg, undefined, { name: "A_%'literal", email: 'literal@example.invalid' });
  await user(f.pg, undefined, { createdAt: '2020-01-01T00:00:00Z' });
  const result = await f.service.list({ q: "_%'" });
  assert.equal(result.pagination.total, 1); assert.equal(result.recent[0].id, id);
  assert.equal((await f.service.list({ q: id })).recent[0].id, id, 'Verified report account links find the exact account');
  assert.equal(result.today, 1); assert.equal(result.last7, 1); assert.equal(result.last30, 1);
  assert.equal((await f.service.list({ q: "' OR 1=1 --" })).pagination.total, 0);
});

test('phone-only account aliases remain internal and cannot receive Office email', async t => {
  const f = await fixture(t);
  const id = await user(f.pg, undefined, { email: 'random-account-reference@identity.uficonnect.invalid' });
  const list = await f.service.list({ q: id });
  assert.equal(list.recent[0].email, '');
  await assert.rejects(f.service.email(id, { requestId: randomUUID(), subject: 'Support', message: 'A message.' }), error => error.status === 422);
  assert.equal(f.sent.length, 0);
  assert.equal((await f.pg.query('SELECT COUNT(*)::int AS total FROM office_member_email')).rows[0].total, 0);
});

test('cache reconciliation clears transient entries across workers without creating or deleting accounts', async t => {
  const f = await fixture(t), id = await user(f.pg);
  f.cache([id, 'orphan']);
  const check = await f.service.inspectCache();
  assert.deepEqual([check.database, check.cached, check.matched, check.notCached, check.cacheOnly], [1,2,1,0,1]);
  await assert.rejects(f.service.clearCache({}), error => error.status === 400);
  const cleared = await f.service.clearCache({ confirmed: true });
  assert.equal(cleared.cleared, 2); assert.equal(cleared.notCached, 1); assert.equal((await f.service.list()).total, 1);
  let otherCache = [id];
  const other = createOfficeMembers({ ...f.options, getCachedUserIds: () => otherCache, clearUserCache: () => { otherCache = []; } });
  await other.refreshCacheEpoch();
  assert.deepEqual(otherCache, []);
  f.cache(['orphan']); f.disconnect();
  await assert.rejects(f.service.clearCache({ confirmed: true }), error => error.status === 503);
});

test('120-day registration audit includes incomplete older signups and excludes records outside the selected UTC window', async t => {
  const f = await fixture(t);
  const day = offset => new Date(Date.now() - offset * 86400000).toISOString();
  await user(f.pg, undefined, { createdAt: day(5), complete: true });
  const missed = await user(f.pg, undefined, { createdAt: day(90) });
  const older = await user(f.pg, undefined, { createdAt: day(121) });
  const audit = await f.service.list({ days: '120', state: 'incomplete' });
  assert.equal(audit.total, 3); assert.equal(audit.last120, 2); assert.equal(audit.incomplete120, 1);
  assert.equal(audit.pagination.total, 1); assert.equal(audit.recent[0].id, missed);
  assert.equal((await f.service.list({ days: '30' })).pagination.total, 1);
  assert.equal((await f.service.list({ days: 'all', q: older })).recent[0].id, older);
  await assert.rejects(f.service.list({ days: '365' }), error => error.status === 400);
});

test('signup request diagnostics count fixed outcomes without submitted personal fields', async t => {
  const f = await fixture(t);
  for (const status of [201,400,400,409,429,503,500]) await f.service.recordSignup(status);
  const result = await f.service.list();
  assert.equal(result.total, 0);
  assert.deepEqual(result.signupRequests.outcomes.map(row => row.requests), [1,2,1,1,1,1]);
  assert.deepEqual((await f.pg.query('SELECT * FROM signup_daily_counts')).fields.map(field => field.name), ['day','outcome','event_count']);
});

test('email uses stored recipient and repeated/concurrent submissions send once with durable status', async t => {
  const f = await fixture(t), id = await user(f.pg, undefined, { email: 'stored@example.invalid' });
  const body = { requestId: randomUUID(), subject: 'Account support', message: 'Plain text support message' };
  const results = await Promise.all([f.service.email(id, body), f.service.email(id, body)]);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].to, 'stored@example.invalid');
  assert.ok(results.some(result => result.status === 'accepted'));
  assert.equal((await f.service.email(id, body)).status, 'accepted'); assert.equal(f.sent.length, 1);
  await assert.rejects(f.service.email(id, { ...body, message: 'Different text' }), error => error.status === 409);
  for (const bad of [{ ...body, to: 'forged@example.invalid' }, { ...body, subject: 'Fake\r\nBcc: outsider' }, { ...body, requestId: 'bad' }]) {
    await assert.rejects(f.service.email(id, bad), error => error.status === 400);
  }
  assert.equal((await f.service.emailHistory(id)).messages[0].status, 'accepted');
  const stored = (await f.pg.query('SELECT * FROM office_member_email')).rows[0];
  assert.equal(stored.message, undefined); assert.equal(stored.email, undefined);
  await f.pg.query('DELETE FROM users WHERE id=$1', [id]);
  assert.equal((await f.pg.query('SELECT user_id FROM office_member_email')).rows[0].user_id, null);
});

test('SMTP rejection, failure after DATA and ambiguous delivery remain recorded without duplicate retries', async t => {
  const f = await fixture(t), id = await user(f.pg);
  for (const [error, expected] of [[{ responseCode: 550, command:'DATA' },'failed'], [{ code:'EAUTH' },'failed'],
    [{ responseCode:550,command:'QUIT' },'uncertain'], [{ responseCode:550 },'uncertain'], [{ code: 'ETIMEDOUT' },'uncertain']]) {
    let sends = 0;
    const service = createOfficeMembers({ ...f.options, sendMail: async () => { sends++; throw error; } });
    const body = { requestId: randomUUID(), subject: 'Support', message: 'Support message' };
    assert.equal((await service.email(id, body)).status, expected);
    assert.equal((await service.email(id, body)).status, expected); assert.equal(sends, 1);
  }
  const unconfigured = createOfficeMembers({ ...f.options, mailAvailable: () => false });
  await assert.rejects(unconfigured.email(id, { requestId: randomUUID(), subject: 'Support', message: 'Body' }), error => error.status === 503);
});

test('email receipt classification checks the stored recipient and treats missing provider evidence as uncertain', async t => {
  const f = await fixture(t), id = await user(f.pg, undefined, { email:'stored@example.invalid' });
  for (const [receipt,expected] of [[undefined,'uncertain'],[{},'uncertain'],[{ accepted:['other@example.invalid'] },'uncertain'],
    [{ rejected:['stored@example.invalid'] },'failed'],[{ accepted:['STORED@example.invalid'] },'accepted']]) {
    let sends = 0;
    const service = createOfficeMembers({ ...f.options, sendMail:async () => { sends++; return receipt; } });
    const body = { requestId:randomUUID(),subject:'Support',message:'Support message' };
    assert.equal((await service.email(id,body)).status,expected);
    assert.equal((await service.email(id,body)).status,expected);
    assert.equal(sends,1);
  }
});

test('stale sending claims are exposed as uncertain after a worker restart and never resent', async t => {
  const f = await fixture(t), id = await user(f.pg);
  const body = { requestId:randomUUID(),subject:'Support',message:'Support message' };
  await f.service.email(id,body);
  await f.pg.query("UPDATE office_member_email SET status='sending',updated_at=NOW()-INTERVAL '3 minutes' WHERE id=$1",[body.requestId]);
  const restarted = createOfficeMembers(f.options);
  assert.equal((await restarted.email(id,body)).status,'uncertain');
  assert.equal((await restarted.emailHistory(id)).messages[0].status,'uncertain');
  assert.equal(f.sent.length,1);
  await f.pg.query("UPDATE office_member_email SET updated_at=NOW() WHERE id=$1",[body.requestId]);
  assert.equal((await restarted.email(id,body)).status,'sending');
});

test('cache clear fails before mutating transient records if the shared epoch row is unavailable', async t => {
  const f = await fixture(t), id = await user(f.pg);
  f.cache([id,'orphan']);
  await f.pg.exec('DELETE FROM office_user_cache_epoch');
  await assert.rejects(f.service.clearCache({ confirmed:true }),error => error.status === 503);
  assert.equal((await f.service.inspectCache()).cached,2);
  assert.equal((await f.service.list()).total,1);
});

test('Office user, cache and email tools enforce authorization and no-store responses', async t => {
  const f = await fixture(t), id = await user(f.pg);
  const app = express(); app.use(express.json());
  registerOfficeMemberRoutes(app, { ...f.options, requireOfficeToken: (req,res,next) => req.get('x-office-token') === 'fixture' ? next() : res.status(401).json({ message: 'Unauthorized' }) });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [path,method] of [['/office/users','GET'],['/office/users/cache','GET'],['/office/users/cache/clear','POST'],[`/office/users/${id}/email`,'GET'],[`/office/users/${id}/email`,'POST']]) {
    const response = await fetch(base+path,{method}); assert.equal(response.status,401); assert.equal(response.headers.get('cache-control'),'private, no-store');
  }
  const response = await fetch(base+'/office/users',{headers:{'x-office-token':'fixture'}});
  assert.equal(response.status,200); assert.equal((await response.json()).total,1); assert.equal(f.sent.length,0);
});
