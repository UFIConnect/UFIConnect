'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { OFFICE_MEMBERS_SCHEMA } = require('./office-members');
const { BUSINESS_TEAM_SCHEMA } = require('./business-teams');
const { createAppHarness, member } = require('./test-support/app-harness');
const office = { 'x-office-token':'office-route-fixture' };
const signup = { name:'Synthetic private member',email:'synthetic-private@example.invalid',password:'cobalt-rain7' };

async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,
    phone TEXT,password_hash TEXT,title TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),organization TEXT,
    plan TEXT NOT NULL DEFAULT 'free',business_seats INTEGER NOT NULL DEFAULT 0,billing_closed BOOLEAN NOT NULL DEFAULT false,
    auth_version INTEGER NOT NULL DEFAULT 0,onboarding_complete BOOLEAN NOT NULL DEFAULT false,profile_hidden BOOLEAN NOT NULL DEFAULT false,
    role_settings JSONB NOT NULL DEFAULT '{}');
    CREATE TABLE auth_sessions(id UUID PRIMARY KEY,user_id UUID REFERENCES users(id),expires_at TIMESTAMPTZ);`);
  for (const sql of [...OFFICE_MEMBERS_SCHEMA,...BUSINESS_TEAM_SCHEMA]) await pg.exec(sql);
  let failAccountRead = false, failSignupWrite = false;
  const sent = [];
  const app = await createAppHarness({ connected:true,
    env:{ OFFICE_TOKEN:'office-route-fixture',SMTP_HOST:'smtp.example.invalid',SMTP_USER:'fixture',SMTP_PASS:'fixture' },
    modules:{ nodemailer:{ createTransport:() => ({ sendMail:async message => { sent.push(message); return { accepted:[message.to] }; } }) } },
    query(sql,params) {
      if (failAccountRead && /\b(?:FROM|INTO) users\b/.test(sql)) throw new Error('Synthetic private storage error');
      if (failSignupWrite && sql.startsWith('INSERT INTO users')) throw new Error('Synthetic private storage error');
      if (sql.includes('site_activity_heartbeat')) return { rows:[],rowCount:0 };
      return pg.query(sql,params.map(value => Object.prototype.toString.call(value) === '[object Date]' ? value.toISOString() : value));
    },
  });
  t.after(() => app.close());
  return { pg,app,sent,failAccountRead:() => { failAccountRead=true; },failSignupWrite:() => { failSignupWrite=true; } };
}

test('real signup routes record success, invalid, duplicate, failure and rate-limit outcomes without submitted data', async t => {
  const { app,pg,sent,failSignupWrite } = await fixture(t);
  const created = await app.request('/auth/register',{ method:'POST',body:signup });
  assert.equal(created.status,201);
  assert.equal((await app.request('/auth/register',{ method:'POST',body:{ ...signup,password:'short' } })).status,400);
  assert.equal((await app.request('/auth/register',{ method:'POST',body:signup })).status,409);
  failSignupWrite();
  assert.equal((await app.request('/auth/register',{ method:'POST',body:{ ...signup,email:'other@example.invalid' } })).status,500);
  for (let i=0;i<6;i++) assert.equal((await app.request('/auth/register',{ method:'POST',body:{} })).status,400);
  assert.equal((await app.request('/auth/register',{ method:'POST',body:{} })).status,429);
  const accounts = await app.request('/office/users',{ headers:office });
  assert.equal(accounts.status,200);
  assert.equal(accounts.data.total,1);
  assert.equal(accounts.data.recent[0].id,created.data.profile.id);
  assert.equal(accounts.data.incomplete,1);
  assert.equal(accounts.data.signupRequests.available,true);
  assert.deepEqual(accounts.data.signupRequests.outcomes.map(row => row.requests),[1,7,1,1,0,1]);
  const rows = (await pg.query('SELECT * FROM signup_daily_counts')).rows;
  assert.doesNotMatch(JSON.stringify(rows),/Synthetic private member|synthetic-private|cobalt-rain7|Bearer/);
  assert.ok(app.queries.filter(query => query.sql.startsWith('INSERT INTO signup_daily_counts')).every(query => query.params.length===1));
  assert.equal(sent.length,0); // Registration diagnostics never use SMTP.
});

test('real Office account and cache routes use authoritative records, exclude cached orphans, and preserve sessions after clear', async t => {
  const { app,pg,failAccountRead } = await fixture(t);
  const created = await app.request('/auth/register',{ method:'POST',body:signup });
  assert.equal(created.status,201);
  app.seedUser(member('cache-only-orphan'));
  assert.equal((await app.request('/office/users')).status,401);
  const list = await app.request('/office/users',{ headers:office });
  assert.equal(list.status,200);
  assert.equal(list.headers.get('cache-control'),'private, no-store');
  assert.equal(list.data.total,1);
  assert.equal(list.data.cacheUsed,false);
  assert.equal(list.data.recent.some(user => user.id==='cache-only-orphan'),false);
  const cache = await app.request('/office/users/cache',{ headers:office });
  assert.deepEqual([cache.data.database,cache.data.cached,cache.data.matched,cache.data.cacheOnly],[1,2,1,1]);
  assert.equal((await app.request('/office/users/cache/clear',{ method:'POST',headers:office,body:{} })).status,400);
  const cleared = await app.request('/office/users/cache/clear',{ method:'POST',headers:office,body:{ confirmed:true } });
  assert.equal(cleared.status,200); assert.equal(cleared.data.cleared,2); assert.equal(cleared.data.cached,0);
  assert.equal((await pg.query('SELECT count(*)::int AS count FROM users')).rows[0].count,1);
  const session = await app.request('/auth/me',{ headers:{ authorization:`Bearer ${created.data.token}` } });
  assert.equal(session.status,200); assert.equal(session.data.profile.id,created.data.profile.id);
  const loaded = await app.request('/office/users/cache',{ headers:office });
  assert.equal(loaded.data.matched,1);
  failAccountRead();
  assert.equal((await app.request('/office/users',{ headers:office })).status,503);
  const rejected = await app.request('/office/users/cache/clear',{ method:'POST',headers:office,body:{ confirmed:true } });
  assert.equal(rejected.status,503);
  assert.doesNotMatch(JSON.stringify(rejected.data),/Synthetic private storage/);
  assert.equal((await pg.query('SELECT version FROM office_user_cache_epoch')).rows[0].version,1);
});

test('real Office email routes send only to the registered address and do not resend or expose message content in history', async t => {
  const { app,pg,sent } = await fixture(t);
  const id=randomUUID();
  await pg.query('INSERT INTO users(id,name,email) VALUES($1,$2,$3)',[id,'Synthetic recipient','stored-recipient@example.invalid']);
  const path=`/office/users/${id}/email`;
  const body={ requestId:randomUUID(),subject:'Support follow-up',message:'Synthetic sensitive plain-text message' };
  assert.equal((await app.request(path,{ method:'POST',body })).status,401); assert.equal(sent.length,0);
  assert.equal((await app.request(path,{ method:'POST',headers:office,body:{ ...body,to:'forged@example.invalid' } })).status,400);
  const first=await app.request(path,{ method:'POST',headers:office,body });
  assert.equal(first.status,200); assert.equal(first.data.status,'accepted');
  assert.equal(first.headers.get('cache-control'),'private, no-store');
  const retry=await app.request(path,{ method:'POST',headers:office,body });
  assert.equal(retry.data.status,'accepted'); assert.equal(sent.length,1);
  assert.equal(sent[0].to,'stored-recipient@example.invalid');
  assert.equal((await app.request(path,{ method:'POST',headers:office,body:{ ...body,message:'Changed message' } })).status,409);
  const history=await app.request(path,{ headers:office });
  assert.equal(history.status,200); assert.equal(history.data.messages[0].status,'accepted');
  assert.doesNotMatch(JSON.stringify(history.data),/Synthetic sensitive|stored-recipient@example|forged@example/);
  assert.equal((await pg.query('SELECT count(*)::int AS count FROM office_member_email')).rows[0].count,1);
});

test('real signup route refuses disconnected account storage without making a cache-only account', async t => {
  const app=await createAppHarness(); t.after(() => app.close());
  const result=await app.request('/auth/register',{ method:'POST',body:signup });
  assert.equal(result.status,503); assert.equal(app.users.length,0);
  assert.equal(app.queries.some(query => query.sql.startsWith('INSERT INTO users')),false);
});
