const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { searchMemberDirectory } = require('./member-directory');
const { OFFICE_MEMBERS_SCHEMA } = require('./office-members');
const { createAppHarness, member } = require('./test-support/app-harness');
require('./generated-media');

test('People supports production UUID accounts with text relationship IDs', async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`
    CREATE TABLE users (id UUID PRIMARY KEY, name TEXT, email TEXT, title TEXT, bio TEXT, organization TEXT,
      skills JSONB DEFAULT '[]', role TEXT, interests TEXT[] DEFAULT '{}', avatar_url TEXT,
      role_settings JSONB DEFAULT '{}', profile_hidden BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE blocks (blocker_id TEXT, blocked_id TEXT);
    CREATE TABLE follows (follower_id TEXT, following_id TEXT);
    CREATE TABLE connections (from_id TEXT, to_id TEXT, status TEXT, created_at TIMESTAMPTZ DEFAULT now());
    INSERT INTO users (id, name) VALUES
      ('00000000-0000-4000-8000-000000000001', 'Alex Morgan'),
      ('00000000-0000-4000-8000-000000000002', 'Jordan Smith');
    INSERT INTO follows VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002');
  `);
  const result = await searchMemberDirectory(pg, { myId: '00000000-0000-4000-8000-000000000001' });
  assert.equal(result.totalCount, 2);
  assert.equal(result.users.find(user => user.name === 'Jordan Smith').isFollowing, true);
  await pg.exec(`UPDATE users SET interests = ARRAY['Design', 'Music'] WHERE name = 'Alex Morgan';
    UPDATE users SET interests = ARRAY[' design ', 'Travel'] WHERE name = 'Jordan Smith';`);
  const shared = await searchMemberDirectory(pg, { myId: '00000000-0000-4000-8000-000000000001', sort: 'interests' });
  assert.deepEqual(shared.users[0].sharedInterests, ['design']);
});

test('member directory paginates all public accounts without leaking private account fields', async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, title TEXT, bio TEXT, organization TEXT,
      skills JSONB DEFAULT '[]', role TEXT, interests JSONB DEFAULT '[]', avatar_url TEXT,
      role_settings JSONB DEFAULT '{}', profile_hidden BOOLEAN DEFAULT false,
      password_hash TEXT DEFAULT 'SECRET', created_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE blocks (blocker_id TEXT, blocked_id TEXT);
    CREATE TABLE follows (follower_id TEXT, following_id TEXT);
    CREATE TABLE connections (from_id TEXT, to_id TEXT, status TEXT, created_at TIMESTAMPTZ DEFAULT now());
    INSERT INTO users (id, name, email, created_at)
      SELECT 'member-' || n, 'Member ' || n, 'member' || n || '@example.invalid', now() - n * interval '1 second'
      FROM generate_series(1, 605) AS n;
    INSERT INTO users (id, name, email, profile_hidden) VALUES ('private', 'Private member', 'private@example.invalid', true);
    INSERT INTO users (id, name, role_settings) VALUES ('private-setting', 'Hidden member', '{"privacy_publicProfile":false}');
    INSERT INTO users (id, name) VALUES ('no-email', 'New social member');
    INSERT INTO users (id, name) VALUES ('blocked', 'Blocked member');
    INSERT INTO blocks VALUES ('member-1', 'blocked');
    INSERT INTO follows VALUES ('member-1', 'member-605'), ('member-2', 'member-605');
  `);
  const search = options => searchMemberDirectory(pg, { myId: 'member-1', ...options });
  const seen = new Set();
  for (let offset = 0; ; offset += 100) {
    const page = await search({ offset, limit: 100 });
    assert.equal(page.registeredCount, 609);
    assert.equal(page.discoverableCount, 607);
    assert.equal(page.totalCount, 606);
    for (const u of page.users) {
      assert.ok(!seen.has(u.id)); seen.add(u.id);
      assert.ok(!('email' in u) && !('password_hash' in u) && !('role_settings' in u));
    }
    if (!page.hasMore) break;
  }
  assert.equal(seen.size, 606);
  assert.ok(seen.has('member-605') && seen.has('no-email'));
  assert.ok(!seen.has('private') && !seen.has('private-setting') && !seen.has('blocked'));
  assert.equal((await search({ q: 'member605@example.invalid' })).totalCount, 0);
  await pg.query('UPDATE users SET role_settings=$1 WHERE id=$2', [{ privacy_showEmail: true }, 'member-605']);
  assert.equal((await search({ q: 'member605@example.invalid' })).users[0].id, 'member-605');
  assert.equal((await search({ sort: 'followers' })).users[0].id, 'member-605');
  assert.equal((await search({ q: 'private@example.invalid' })).totalCount, 0);
  assert.equal((await searchMemberDirectory(pg, { myId: 'private', q: 'Private member' })).users[0].id, 'private');
  await pg.query('INSERT INTO users (id, name, bio, role) VALUES ($1,$2,$3,$4)', ['long', 'A', 'x'.repeat(1100000) + ' needle', 'engineer']);
  assert.equal((await search({ q: 'needle', role: 'engineer' })).users[0].id, 'long');
  assert.ok((await search({ q: 'A' })).users.some(u => u.id === 'long'));
  await pg.query('INSERT INTO users (id, name, title) VALUES ($1,$2,$3)', ['word-match', 'Jordan', 'Architecture specialist']);
  assert.equal((await search({ q: 'art' })).users.some(u => u.id === 'word-match'), false);
  assert.equal((await search({ q: 'specialist garden' })).users.some(u => u.id === 'word-match'), false);
  assert.equal((await search({ q: "' OR 1=1 --" })).users.some(u => u.id === 'private'), false);
  // Older databases keep interests as JSONB; shared interests must still work and tolerate non-array values.
  await pg.exec(`UPDATE users SET interests = '["Design", "Music"]' WHERE id = 'member-1';
    UPDATE users SET interests = '["design", "Travel"]' WHERE id = 'member-2';
    UPDATE users SET interests = '{"not": "a list"}' WHERE id = 'member-3';`);
  const shared = await search({ sort: 'interests', limit: 3 });
  assert.equal(shared.users[0].id, 'member-2');
  assert.deepEqual(shared.users[0].sharedInterests, ['design']);
});

test('search reports database failure instead of a misleading partial cache', async t => {
  const app = await createAppHarness({ connected: true, query: async () => { throw Error('database unavailable'); } });
  t.after(() => app.close());
  app.seedUser(member('member-1'));
  assert.equal((await app.request('/users/search', { userId: 'member-1' })).status, 503);
  assert.equal((await app.request('/users/search?q=' + 'x'.repeat(501), { userId: 'member-1' })).status, 400);
  assert.equal((await app.request('/users/search?q[]=a', { userId: 'member-1' })).status, 400);
});

test('Office reports registered accounts without reading legacy visitor or sign-in histories', async t => {
  const pg = new PGlite();
  await pg.exec(`CREATE TABLE users (
    id UUID PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), onboarding_complete BOOLEAN NOT NULL DEFAULT false,
    profile_hidden BOOLEAN NOT NULL DEFAULT false, role_settings JSONB NOT NULL DEFAULT '{}');`);
  for (const sql of OFFICE_MEMBERS_SCHEMA) await pg.exec(sql);
  for (let index = 1; index <= 7; index++) {
    await pg.query('INSERT INTO users(id,name,email,onboarding_complete,profile_hidden) VALUES($1,$2,$3,$4,$5)',
      [`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, `Registered member ${index}`, `member${index}@example.invalid`, index <= 5, index === 7]);
  }
  const app = await createAppHarness({ connected: true, env: { OFFICE_TOKEN: 'office-audit-only' }, query: async (sql, params) => {
    if (/FROM (page_views|user_sign_in_events)/.test(sql)) throw Error('Legacy activity histories must not be queried');
    if (/\b(users|signup_daily_counts|office_member_email|office_user_cache_epoch)\b/.test(sql)) return pg.query(sql, params);
    return { rows: [], rowCount: 0 };
  } });
  t.after(async () => { await app.close(); await pg.close(); });
  assert.equal((await app.request('/office/users')).status, 401);
  const response = await app.request('/office/users', { headers: { 'x-office-token': 'office-audit-only' } });
  assert.equal(response.status, 200);
  assert.equal(response.data.total, 7);
  assert.equal(response.data.discoverable, 6);
  assert.equal(response.data.onboarded, 5);
  assert.equal(response.data.hidden, 1);
  assert.equal(response.data.countSource, 'database');
  assert.equal(response.data.cacheUsed, false);
  assert.equal(response.data.recent.length, 7);
  assert.equal(Object.hasOwn(response.data, 'active'), false);
  assert.equal(response.data.activeAvailable, false);
  assert.equal(Object.hasOwn(response.data, 'signIns'), false);
  assert.equal(response.data.signInsAvailable, false);
  assert.equal(app.queries.some(({ sql }) => /FROM (page_views|user_sign_in_events)/.test(sql)), false);
});
