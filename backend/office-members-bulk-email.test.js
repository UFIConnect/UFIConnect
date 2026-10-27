'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const { OFFICE_MEMBERS_SCHEMA, createOfficeMembers, registerOfficeMemberRoutes, emailEligibility } = require('./office-members');

async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW(),
    onboarding_complete BOOLEAN DEFAULT FALSE,profile_hidden BOOLEAN DEFAULT FALSE,role_settings JSONB DEFAULT '{}')`);
  for (const sql of OFFICE_MEMBERS_SCHEMA) await pg.exec(sql);
  const sent = [], queries = [];
  let serial = Promise.resolve(), time = Date.now(), connected = true;
  const query = (sql, params) => { queries.push(sql); return pg.query(sql, params); };
  const options = { db: { isConnected: () => connected, query,
    withClient(fn) { const operation = serial.then(() => fn({ query })); serial = operation.catch(() => {}); return operation; } },
    emailPreviewSecret: 'synthetic-office-preview-secret-for-unit-tests', schedule() {}, now: () => time,
    mailAvailable: () => true, sendMail: async message => { sent.push(message); return { accepted: [message.to] }; } };
  async function user(values = {}) {
    const id = values.id || randomUUID();
    await pg.query('INSERT INTO users(id,name,email,onboarding_complete,profile_hidden,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [id, values.name ?? 'Sample account', values.email ?? `${id}@unit-fixture-mail.net`, values.complete ?? false,
        values.hidden ?? false, values.createdAt ?? new Date().toISOString()]);
    return id;
  }
  return { pg, options, user, sent, queries, service: createOfficeMembers(options), advance: ms => { time += ms; }, disconnect: () => { connected = false; } };
}
const message = (preview, ids = preview.recipients.map(row => row.id), requestId = randomUUID()) => ({
  requestId, selectionToken: preview.selectionToken, userIds: ids, subject: 'Account update', message: 'Please review the update in your account.', confirmed: true,
});

test('preview selects every eligible matching account across pages without sending or writing', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 54; i++) await f.user({ name: `Member ${i}` });
  for (let i = 0; i < 14; i++) await f.user({ email: `test${i}@example.com` });
  await f.user({ email: 'phone-ref@identity.uficonnect.invalid' });
  assert.equal((await f.service.list()).recent.length, 50);
  f.queries.length = 0;
  const preview = await f.service.emailPreview({ filter: { q: '', state: 'all', days: 'all' } });
  assert.equal(preview.totalMatched, 69); assert.equal(preview.eligibleCount, 54);
  assert.equal(preview.recipients.length, 54); assert.equal(preview.batchSize, 5);
  assert.deepEqual(preview.excluded, { missingEmail: 1, reservedAddress: 14, invalidAddress: 0, duplicateAddress: 0, missingAccount: 0 });
  assert.ok(preview.selectionToken); assert.equal(f.sent.length, 0);
  assert.ok(f.queries.every(sql => /^SELECT/.test(sql)));
  assert.equal((await f.pg.query('SELECT COUNT(*)::int AS n FROM office_member_email_campaign')).rows[0].n, 0);
});

test('recipient selection uses exact account filters, explicit exclusions and address eligibility', async t => {
  const f = await fixture(t);
  const first = await f.user({ name: "A_%'literal", email: 'DUPLICATE@unit-fixture-mail.net', complete: true, hidden: true });
  await f.user({ email: 'duplicate@unit-fixture-mail.net' });
  const empty = await f.user({ email: '' }), malformed = await f.user({ email: 'bad\r\nBcc:other@unit-fixture-mail.net' });
  const old = await f.user({ createdAt: '2020-01-01T00:00:00Z' });
  const result = await f.service.emailPreview({ filter: { q: "_%'", state: 'hidden', days: '30' } });
  assert.deepEqual(result.recipients.map(row => row.id), [first]);
  assert.equal((await f.service.emailPreview({ filter: { q: "' OR 1=1 --" } })).eligibleCount, 0);
  assert.equal((await f.service.emailPreview({ filter: { state: 'complete', excludeUserIds: [first] } })).eligibleCount, 0);
  const selected = await f.service.emailPreview({ userIds: [first, empty, malformed, old, randomUUID()] });
  assert.equal(selected.totalMatched, 5); assert.equal(selected.eligibleCount, 2);
  assert.equal(selected.excluded.missingEmail, 1); assert.equal(selected.excluded.invalidAddress, 1); assert.equal(selected.excluded.missingAccount, 1);
  assert.equal((await f.service.emailPreview({ filter: {} })).excluded.duplicateAddress, 1);
  for (const address of ['a@example.org','a@sub.example.net','a@unit.test','a@localhost','a@domain.invalid','a@domain.example']) assert.ok(emailEligibility(address), address);
  assert.equal(emailEligibility('normal+member@unit-fixture-mail.net'), null);
});

test('sending requires signed selection, explicit confirmation, five-recipient limit and resolved placeholders', async t => {
  const f = await fixture(t), ids = [];
  for (let i = 0; i < 6; i++) ids.push(await f.user());
  const preview = await f.service.emailPreview({ userIds: ids }), valid = message(preview, ids.slice(0, 5));
  for (const invalid of [{ ...valid, confirmed: false }, { ...valid, confirmed: undefined }, { ...valid, to: 'forged@unit-fixture-mail.net' },
    { ...valid, userIds: ids }, { ...valid, userIds: [randomUUID()] }, { ...valid, userIds: [ids[0], ids[0]] },
    { ...valid, selectionToken: valid.selectionToken.slice(0,-1) + (valid.selectionToken.endsWith('A') ? 'B' : 'A') },
    { ...valid, subject: 'Notice [INCIDENT_DATE]' }, { ...valid, message: 'Contact [SUPPORT_EMAIL]' }, { ...valid, subject: 'Forged\nBcc: hidden' }]) {
    await assert.rejects(f.service.emailBatch(invalid), error => error.status === 400);
  }
  await assert.rejects(f.service.email(ids[0], { requestId: randomUUID(), subject: 'Notice', message: 'Replace [DETAILS]' }), error => error.status === 400);
  assert.equal(f.sent.length, 0);
  assert.equal((await f.pg.query('SELECT COUNT(*)::int AS n FROM office_member_email')).rows[0].n, 0);
});

test('individual delivery claims survive retries and restarts without disclosing other recipients', async t => {
  const f = await fixture(t), ids = [];
  for (let i = 0; i < 3; i++) ids.push(await f.user());
  const preview = await f.service.emailPreview({ userIds: ids }), body = message(preview);
  let calls = 0;
  const sender = async value => { f.sent.push(value); calls++;
    if (calls === 2) throw { responseCode: 550, command: 'RCPT TO' };
    if (calls === 3) throw { code: 'ETIMEDOUT', message: 'PRIVATE_PROVIDER_SENTINEL' };
    return { accepted: [value.to] };
  };
  const service = createOfficeMembers({ ...f.options, sendMail: sender });
  const result = await service.emailBatch(body);
  assert.deepEqual(result.results.map(row => row.status), ['accepted','failed','uncertain']);
  for (const delivered of f.sent) { assert.equal(typeof delivered.to, 'string'); assert.equal(delivered.cc, undefined); assert.equal(delivered.bcc, undefined); assert.equal(delivered.to.includes(','), false); }
  assert.equal(JSON.stringify(result).includes('PRIVATE_PROVIDER_SENTINEL'), false);
  const restarted = createOfficeMembers({ ...f.options, sendMail: sender });
  assert.deepEqual((await restarted.emailBatch(body)).results.map(row => row.status), ['accepted','failed','uncertain']);
  assert.equal(calls, 3);
  await assert.rejects(restarted.emailBatch({ ...body, message: 'Changed text' }), error => error.status === 409);
  const stored = (await f.pg.query('SELECT * FROM office_member_email')).rows;
  assert.equal(stored.length, 3); assert.ok(stored.every(row => row.message === undefined && row.email === undefined));
});

test('review freezes recipients and message while every unsent address is freshly checked', async t => {
  const f = await fixture(t), first = await f.user(), changed = await f.user(), deleted = await f.user();
  const preview = await f.service.emailPreview({ userIds: [first,changed,deleted] }), campaign = randomUUID();
  const initial = await f.service.emailBatch(message(preview, [first], campaign));
  assert.equal(initial.results[0].status, 'accepted');
  await f.pg.query('UPDATE users SET email=$2 WHERE id=$1', [changed, 'changed@unit-fixture-mail.net']);
  await f.pg.query('DELETE FROM users WHERE id=$1', [deleted]);
  const remaining = await f.service.emailBatch(message(preview, [changed,deleted], campaign));
  assert.deepEqual(remaining.results.map(row => row.status), ['skipped','skipped']);
  const newcomer = await f.user();
  await assert.rejects(f.service.emailBatch(message(preview, [newcomer], campaign)), error => error.status === 400);
  const newReview = await f.service.emailPreview({ userIds: [first,newcomer] });
  await assert.rejects(f.service.emailBatch(message(newReview, [newcomer], campaign)), error => error.status === 409);
  await f.pg.query('UPDATE users SET email=$2 WHERE id=$1', [first, 'updated@unit-fixture-mail.net']);
  assert.equal((await f.service.emailBatch(message(preview, [first], campaign))).results[0].status, 'accepted');
  assert.equal(f.sent.length, 1);
});

test('expired review cannot start a campaign; bound campaign safely continues within one day', async t => {
  const f = await fixture(t), first = await f.user(), second = await f.user();
  const preview = await f.service.emailPreview({ userIds: [first,second] }), campaign = randomUUID();
  await f.service.emailBatch(message(preview, [first], campaign));
  f.advance(31 * 60 * 1000);
  await assert.rejects(f.service.emailBatch(message(preview, [second])), error => error.status === 409 && error.code === 'selection_expired');
  assert.equal((await f.service.emailBatch(message(preview, [second], campaign))).results[0].status, 'accepted');
  f.advance(24 * 60 * 60 * 1000);
  await assert.rejects(f.service.emailBatch(message(preview, [first], campaign)), error => error.status === 409);
  assert.equal(f.sent.length, 2);
});

test('concurrent workers reuse the same sending claim and each worker runs only one batch', async t => {
  const f = await fixture(t), id = await f.user();
  const preview = await f.service.emailPreview({ userIds: [id] }), body = message(preview);
  let release, started;
  const gate = new Promise(resolve => { release = resolve; }), sending = new Promise(resolve => { started = resolve; });
  let sends = 0;
  const options = { ...f.options, sendMail: async value => { sends++; started(); await gate; return { accepted: [value.to] }; } };
  const first = createOfficeMembers(options), second = createOfficeMembers(options);
  const pending = first.emailBatch(body); await sending;
  assert.equal((await first.emailBatch(body)).results[0].status, 'limited');
  assert.equal((await second.emailBatch(body)).results[0].status, 'sending');
  assert.equal(sends, 1); release();
  assert.equal((await pending).results[0].status, 'accepted');
  assert.equal((await second.emailBatch(body)).results[0].status, 'accepted');
  assert.equal(sends, 1);
});

test('shared claim capacity limits bursts without claiming or resending deferred recipients', async t => {
  const f = await fixture(t), id = await f.user();
  const preview = await f.service.emailPreview({ userIds: [id] }), body = message(preview);
  for (let i = 0; i < 60; i++) await f.pg.query("INSERT INTO office_member_email(id,subject,payload_hash,status) VALUES($1,'Prior',$2,'accepted')", [randomUUID(),'a'.repeat(64)]);
  assert.equal((await f.service.emailBatch(body)).results[0].status, 'limited'); assert.equal(f.sent.length, 0);
  await f.pg.query("UPDATE office_member_email SET created_at=NOW()-INTERVAL '5 minutes'");
  assert.equal((await f.service.emailBatch(body)).results[0].status, 'accepted'); assert.equal(f.sent.length, 1);
  assert.equal((await f.service.emailBatch(body)).results[0].status, 'accepted'); assert.equal(f.sent.length, 1);
});

test('bulk endpoints require Office access and confirmation and retain private no-store headers', async t => {
  const f = await fixture(t), id = await f.user();
  const app = express(); app.use(express.json());
  registerOfficeMemberRoutes(app, { ...f.options, requireOfficeToken: (req,res,next) => req.get('x-office-token') === 'fixture' ? next() : res.status(401).json({ message: 'Unauthorized' }) });
  const server = app.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening',resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`, headers = { 'content-type':'application/json','x-office-token':'fixture' };
  for (const route of ['preview','batch']) {
    const denied = await fetch(base+'/office/users/email/'+route,{ method:'POST' });
    assert.equal(denied.status,401); assert.equal(denied.headers.get('cache-control'),'private, no-store');
  }
  const reviewed = await fetch(base+'/office/users/email/preview',{ method:'POST',headers,body:JSON.stringify({userIds:[id]}) });
  assert.equal(reviewed.status,200); const preview = await reviewed.json();
  assert.equal(reviewed.headers.get('cache-control'),'private, no-store'); assert.equal(f.sent.length,0);
  const unconfirmed = await fetch(base+'/office/users/email/batch',{ method:'POST',headers,body:JSON.stringify({...message(preview),confirmed:false}) });
  assert.equal(unconfirmed.status,400); assert.equal(f.sent.length,0);
  f.advance(31*60*1000);
  const expired = await fetch(base+'/office/users/email/batch',{method:'POST',headers,body:JSON.stringify(message(preview))});
  assert.equal(expired.status,409); assert.equal((await expired.json()).code,'selection_expired');
});
