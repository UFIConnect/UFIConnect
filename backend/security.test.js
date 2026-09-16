const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { PGlite } = require('@electric-sql/pglite');
const { createAppHarness, member } = require('./test-support/app-harness');
const { passwordPolicyError, resolveJwtSecret, publicRoleSettings } = require('./auth-security');
const { createTokenVault, migrateSocialCredentials } = require('./token-vault');
const { databaseConnectionOptions } = require('./database-security');
const { createProviderJsonClient } = require('./provider-json');
const { EventEmitter } = require('node:events');

const oldPassword = 'legacy';
const newPassword = 'a longer unique passphrase';
const bearer = token => ({ authorization: `Bearer ${token}` });

test('new passwords count Unicode characters and reject bcrypt truncation; production keys fail closed', () => {
  assert.ok(passwordPolicyError('a'.repeat(14)));
  assert.equal(passwordPolicyError('orbit maps glow'), null);
  assert.equal(passwordPolicyError('Cloud lantern maps open blue doors to the quiet winter horizon.'.padEnd(72, '!')), null);
  assert.ok(passwordPolicyError('a'.repeat(73)));
  assert.ok(passwordPolicyError('😀'.repeat(14)));
  assert.equal(passwordPolicyError(Array.from({ length: 15 }, (_, i) => String.fromCodePoint(0x1F600 + i)).join('')), null);
  assert.ok(passwordPolicyError('😀'.repeat(19)));
  assert.ok(passwordPolicyError({ length: 99 }));
  for (const JWT_SECRET of ['', 'dev-secret-key', 'replace-with-a-long-random-secret']) {
    assert.throws(() => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET }));
  }
  assert.notEqual(resolveJwtSecret({}), resolveJwtSecret({}));
  assert.throws(() => createTokenVault({ NODE_ENV: 'production' }));
});

test('reset tokens, OAuth states, legacy tokens and query credentials cannot authenticate as sessions', async t => {
  const app = await createAppHarness({ env: { OFFICE_TOKEN: 'test-office-key' } });
  t.after(() => app.close());
  const user = member('alice', { passwordHash: await bcrypt.hash(oldPassword, 4) });
  app.seedUser(user);
  for (const token of [
    app.createPasswordResetToken(user),
    jwt.sign({ id: user.id }, 'route-test-only', { expiresIn: '1h' }),
    app.createOAuthState(user.id, 'github', 'secret-pkce-verifier'),
    jwt.sign({ id: user.id, purpose: 'session', sid: 'fake', ver: 0 }, 'route-test-only', { algorithm: 'HS384', expiresIn: '1h', issuer: 'uficonnect', audience: 'uficonnect-api' }),
  ]) assert.equal((await app.request('/profile', { headers: bearer(token) })).status, 401);
  const state = app.createOAuthState(user.id, 'github', 'secret-pkce-verifier');
  assert.equal(JSON.stringify(jwt.decode(state)).includes('secret-pkce-verifier'), false);
  assert.equal(app.verifyOAuthState(state, 'github').codeVerifier, 'secret-pkce-verifier');
  assert.equal(app.verifyOAuthState(state, 'youtube'), null);
  const token = app.token(user.id);
  assert.equal((await app.request('/feed/stream?token=' + token)).status, 401);
  assert.equal((await app.request('/office/controls?token=test-office-key')).status, 401);
  const profile = await app.request('/profile', { headers: bearer(token) });
  assert.equal(profile.status, 200);
  assert.match(profile.headers.get('cache-control'), /no-store/);
  assert.equal((await app.request('/health/details')).status, 401);
});

test('logout revokes its session, logout-all revokes every session, and deleted accounts cannot use old tokens', async t => {
  const app = await createAppHarness();
  t.after(() => app.close());
  app.seedUser(member('alice'));
  const first = app.token('alice'), second = app.token('alice');
  assert.equal((await app.request('/auth/logout', { method: 'POST', headers: bearer(first) })).status, 200);
  assert.equal((await app.request('/profile', { headers: bearer(first) })).status, 401);
  assert.equal((await app.request('/profile', { headers: bearer(second) })).status, 200);
  assert.equal((await app.request('/auth/logout-all', { method: 'POST', headers: bearer(second) })).status, 200);
  assert.equal((await app.request('/profile', { headers: bearer(second) })).status, 401);
  const deleted = app.token('alice');
  app.users.splice(app.users.findIndex(user => user.id === 'alice'), 1);
  assert.equal((await app.request('/profile', { headers: bearer(deleted) })).status, 401);
});

test('password changes keep legacy login compatible and revoke sessions and earlier reset links', async t => {
  const app = await createAppHarness();
  t.after(() => app.close());
  const user = member('alice', { passwordHash: await bcrypt.hash(oldPassword, 4) });
  app.seedUser(user);
  const login = await app.request('/auth/login', { method: 'POST', body: { email: user.email, password: oldPassword } });
  assert.equal(login.status, 200);
  assert.equal(jwt.decode(login.data.token).exp - jwt.decode(login.data.token).iat, 43200);
  const reset = app.createPasswordResetToken(user);
  const change = await app.request('/profile/password', { method: 'POST', headers: bearer(login.data.token), body: { currentPassword: oldPassword, newPassword } });
  assert.equal(change.status, 200);
  assert.equal(change.data.requiresSignIn, true);
  assert.equal((await app.request('/profile', { headers: bearer(login.data.token) })).status, 401);
  assert.equal((await app.request('/auth/reset-password', { method: 'POST', body: { token: reset, password: newPassword } })).status, 400);
  assert.equal((await app.request('/auth/login', { method: 'POST', body: { email: user.email, password: oldPassword } })).status, 401);
  const next = await app.request('/auth/login', { method: 'POST', body: { email: user.email, password: newPassword } });
  assert.equal(next.status, 200);
  assert.equal(JSON.stringify(next.data).includes(user.passwordHash), false);
});

test('unchanged password changes require the correct current password and preserve the session for a retry', async t => {
  const app = await createAppHarness();
  t.after(() => app.close());
  const hash = await bcrypt.hash(newPassword, 4);
  const user = member('alice', { passwordHash: hash });
  app.seedUser(user);
  const token = app.token(user.id);
  const reset = app.createPasswordResetToken(user);
  const request = body => app.request('/profile/password', { method: 'POST', headers: bearer(token), body });
  const wrongCurrent = await request({ currentPassword: 'incorrect existing password', newPassword });
  assert.equal(wrongCurrent.status, 401);
  assert.equal(wrongCurrent.data.message, 'Current password is incorrect.');
  const unchanged = await request({ currentPassword: newPassword, newPassword });
  assert.equal(unchanged.status, 400);
  assert.equal(unchanged.data.code, 'PASSWORD_UNCHANGED');
  assert.match(unchanged.data.message, /different from your current password/);
  assert.equal(user.passwordHash, hash);
  assert.equal(user.authVersion || 0, 0);
  assert.equal((await app.request('/profile', { headers: bearer(token) })).status, 200);
  const replacement = 'Fresh lanterns cross quiet harbors';
  assert.equal((await request({ currentPassword: newPassword, newPassword: replacement })).status, 200);
  assert.equal((await app.request('/profile', { headers: bearer(token) })).status, 401);
  assert.equal((await app.request('/auth/reset-password', { method: 'POST', body: { token: reset, password: newPassword } })).status, 400);
  assert.equal((await app.request('/auth/login', { method: 'POST', body: { email: user.email, password: newPassword } })).status, 401);
  assert.equal((await app.request('/auth/login', { method: 'POST', body: { email: user.email, password: replacement } })).status, 200);
});

test('resetting to the existing password preserves the reset link and active sessions until a real change succeeds', async t => {
  const app = await createAppHarness();
  t.after(() => app.close());
  const hash = await bcrypt.hash(newPassword, 4);
  const user = member('alice', { passwordHash: hash });
  app.seedUser(user);
  const session = app.token(user.id);
  const token = app.createPasswordResetToken(user);
  const request = password => app.request('/auth/reset-password', { method: 'POST', body: { token, password } });
  const unchanged = await request(newPassword);
  assert.equal(unchanged.status, 400);
  assert.equal(unchanged.data.code, 'PASSWORD_UNCHANGED');
  assert.equal(user.passwordHash, hash);
  assert.equal(user.authVersion || 0, 0);
  assert.equal((await app.request('/profile', { headers: bearer(session) })).status, 200);
  const replacement = 'Fresh lanterns cross quiet harbors';
  assert.equal((await request(replacement)).status, 200);
  assert.equal((await request('Another unique orchard passphrase')).status, 400);
  assert.equal((await app.request('/profile', { headers: bearer(session) })).status, 401);
  assert.equal((await app.request('/auth/login', { method: 'POST', body: { email: user.email, password: newPassword } })).status, 401);
  assert.equal((await app.request('/auth/login', { method: 'POST', body: { email: user.email, password: replacement } })).status, 200);
});

test('unchanged password checks compare the stored hash, including equivalent legacy bcrypt inputs', async t => {
  const app = await createAppHarness();
  t.after(() => app.close());
  const prefix = 'Cloud lantern maps open blue doors to the quiet winter horizon.'.padEnd(72, '!');
  const legacyPassword = prefix + 'historically ignored suffix';
  const user = member('alice', { passwordHash: await bcrypt.hash(legacyPassword, 4) });
  app.seedUser(user);
  const session = app.token(user.id);
  const change = await app.request('/profile/password', { method: 'POST', headers: bearer(session), body: { currentPassword: legacyPassword, newPassword: prefix } });
  assert.equal(change.status, 400);
  assert.equal(change.data.code, 'PASSWORD_UNCHANGED');
  const reset = await app.request('/auth/reset-password', { method: 'POST', body: { token: app.createPasswordResetToken(user), password: prefix } });
  assert.equal(reset.status, 400);
  assert.equal(reset.data.code, 'PASSWORD_UNCHANGED');
});

test('common new passwords are rejected consistently without changing credentials, sessions, or reset links', async t => {
  const app = await createAppHarness();
  t.after(() => app.close());
  const hash = await bcrypt.hash(newPassword, 4);
  const user = member('alice', { passwordHash: hash });
  app.seedUser(user);
  const token = app.token(user.id);
  const reset = app.createPasswordResetToken(user);
  const common = '123456789012345';
  const register = await app.request('/auth/register', { method: 'POST', body: { name: 'New member', email: 'new@example.invalid', password: common } });
  const change = await app.request('/profile/password', { method: 'POST', headers: bearer(token), body: { currentPassword: newPassword, newPassword: common } });
  const resetAttempt = await app.request('/auth/reset-password', { method: 'POST', body: { token: reset, password: common } });
  for (const attempt of [register, change, resetAttempt]) {
    assert.equal(attempt.status, 400);
    assert.match(attempt.data.message, /too common or predictable/);
  }
  assert.equal(app.users.length, 1);
  assert.equal(user.passwordHash, hash);
  assert.equal(user.authVersion || 0, 0);
  assert.equal((await app.request('/profile', { headers: bearer(token) })).status, 200);
  assert.equal((await app.request('/auth/login', { method: 'POST', body: { email: user.email, password: newPassword } })).status, 200);
  assert.equal((await app.request('/auth/reset-password', { method: 'POST', body: { token: reset, password: 'Fresh lanterns cross quiet harbors' } })).status, 200);

  // Existing weak credentials remain usable for sign-in while their owner
  // upgrades them; trying to save that existing password is still a no-op error.
  const legacy = member('legacy', { passwordHash: await bcrypt.hash(common, 4) });
  app.seedUser(legacy);
  const legacyLogin = await app.request('/auth/login', { method: 'POST', body: { email: legacy.email, password: common } });
  assert.equal(legacyLogin.status, 200);
  const unchanged = await app.request('/profile/password', { method: 'POST', headers: bearer(legacyLogin.data.token), body: { currentPassword: common, newPassword: common } });
  assert.equal(unchanged.status, 400);
  assert.equal(unchanged.data.code, 'PASSWORD_UNCHANGED');
});

test('reset links are single-use even when two reset requests race', async t => {
  const app = await createAppHarness();
  t.after(() => app.close());
  const user = member('alice', { passwordHash: await bcrypt.hash(oldPassword, 4) });
  app.seedUser(user);
  const oldSession = app.token(user.id);
  const token = app.createPasswordResetToken(user);
  const results = await Promise.all([newPassword, 'another unique passphrase'].map(password => app.request('/auth/reset-password', { method: 'POST', body: { token, password } })));
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.equal((await app.request('/auth/reset-password', { method: 'POST', body: { token, password: newPassword } })).status, 400);
  assert.equal((await app.request('/profile', { headers: bearer(oldSession) })).status, 401);
});

test('password and session changes are authoritative across workers and database outages fail closed', async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users (id UUID PRIMARY KEY, name TEXT, email TEXT UNIQUE, password_hash TEXT, auth_version INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE auth_sessions (id UUID PRIMARY KEY, user_id UUID, expires_at TIMESTAMPTZ);`);
  const id = crypto.randomUUID();
  const hash = await bcrypt.hash(oldPassword, 4);
  await pg.query('INSERT INTO users VALUES ($1,$2,$3,$4,0)', [id, 'Alice', 'alice@example.invalid', hash]);
  let outage = false;
  let sessionOutage = false;
  const app = await createAppHarness({ connected: true, query: (sql, params) => {
    if (outage) throw new Error('Database unavailable');
    if (sessionOutage && sql.startsWith('SELECT id FROM auth_sessions')) throw new Error('Session database unavailable');
    return pg.query(sql, params.map(value => Object.prototype.toString.call(value) === '[object Date]' ? value.toISOString() : value));
  } });
  t.after(() => app.close());
  const login = await app.request('/auth/login', { method: 'POST', body: { email: 'alice@example.invalid', password: oldPassword } });
  assert.equal(login.status, 200);
  const first = login.data.token;
  assert.equal((await app.request('/profile', { headers: bearer(first) })).status, 200);
  const updatedHash = await bcrypt.hash(newPassword, 4);
  await pg.query('UPDATE users SET password_hash=$1,auth_version=auth_version+1 WHERE id=$2', [updatedHash, id]);
  assert.equal((await app.request('/profile', { headers: bearer(first) })).status, 401);
  app.users.find(user => user.id === id).passwordHash = hash; // stale worker cache
  assert.equal((await app.request('/auth/login', { method: 'POST', body: { email: 'alice@example.invalid', password: oldPassword } })).status, 401);
  const second = await app.request('/auth/login', { method: 'POST', body: { email: 'alice@example.invalid', password: newPassword } });
  assert.equal(second.status, 200);
  sessionOutage = true;
  assert.equal((await app.request('/profile', { headers: bearer(second.data.token) })).status, 503);
  sessionOutage = false;
  outage = true;
  assert.equal((await app.request('/profile', { headers: bearer(second.data.token) })).status, 503);
  assert.equal((await app.request('/auth/login', { method: 'POST', body: { email: 'alice@example.invalid', password: newPassword } })).status, 503);
});

test('database password updates reject concurrent changes and never report success for a failed write', async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users (id UUID PRIMARY KEY, name TEXT, email TEXT UNIQUE, password_hash TEXT, auth_version INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE auth_sessions (id UUID PRIMARY KEY, user_id UUID, expires_at TIMESTAMPTZ);`);
  const id = crypto.randomUUID();
  const email = 'alice@example.invalid';
  await pg.query('INSERT INTO users VALUES ($1,$2,$3,$4,0)', [id, 'Alice', email, await bcrypt.hash(newPassword, 4)]);
  let failPasswordWrite = false;
  let revokeOnAccountRead = 0;
  const query = async (sql, params) => {
    if (sql === 'SELECT * FROM users WHERE id=$1' && revokeOnAccountRead > 0 && --revokeOnAccountRead === 0) {
      await pg.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1', [id]);
    }
    if (failPasswordWrite && sql.startsWith('UPDATE users SET password_hash=')) throw new Error('Account write unavailable');
    return pg.query(sql, params.map(value => Object.prototype.toString.call(value) === '[object Date]' ? value.toISOString() : value));
  };
  const workers = await Promise.all([createAppHarness({ connected: true, query }), createAppHarness({ connected: true, query })]);
  for (const app of workers) t.after(() => app.close());
  const login = (app, password) => app.request('/auth/login', { method: 'POST', body: { email, password } });
  const sessions = await Promise.all(workers.map(app => login(app, newPassword)));
  for (const session of sessions) assert.equal(session.status, 200);
  const unchanged = await workers[0].request('/profile/password', {
    method: 'POST', headers: bearer(sessions[0].data.token), body: { currentPassword: newPassword, newPassword },
  });
  assert.equal(unchanged.status, 400);
  assert.equal(unchanged.data.code, 'PASSWORD_UNCHANGED');
  assert.equal(workers[0].queries.filter(({ sql }) => sql.startsWith('UPDATE users SET password_hash=')).length, 0);
  const proposed = ['Fresh lanterns cross quiet harbors', 'Copper owls gather beside rivers'];
  const changes = await Promise.all(workers.map((app, i) => app.request('/profile/password', {
    method: 'POST', headers: bearer(sessions[i].data.token), body: { currentPassword: newPassword, newPassword: proposed[i] },
  })));
  assert.equal(changes.filter(change => change.status === 200).length, 1);
  assert.ok(changes.some(change => change.status === 409 || change.status === 401));
  const winner = changes.findIndex(change => change.status === 200);
  const currentPassword = proposed[winner];
  const row = (await pg.query('SELECT password_hash,auth_version FROM users WHERE id=$1', [id])).rows[0];
  assert.equal(row.auth_version, 1);
  assert.equal(await bcrypt.compare(currentPassword, row.password_hash), true);
  for (let i = 0; i < workers.length; i++) {
    assert.equal((await workers[i].request('/profile', { headers: bearer(sessions[i].data.token) })).status, 401);
  }
  assert.equal((await login(workers[0], newPassword)).status, 401);
  assert.equal((await login(workers[0], proposed[1 - winner])).status, 401);
  const valid = await login(workers[0], currentPassword);
  assert.equal(valid.status, 200);
  failPasswordWrite = true;
  const failed = await workers[0].request('/profile/password', {
    method: 'POST', headers: bearer(valid.data.token), body: { currentPassword, newPassword: 'Other lanterns follow distant stars' },
  });
  assert.equal(failed.status, 500);
  failPasswordWrite = false;
  assert.deepEqual((await pg.query('SELECT password_hash,auth_version FROM users WHERE id=$1', [id])).rows[0], row);
  assert.equal((await workers[0].request('/profile', { headers: bearer(valid.data.token) })).status, 200);
  assert.equal((await login(workers[0], currentPassword)).status, 200);
  // The first read authorizes the session; revoke it immediately before the
  // change route's second authoritative read to exercise the reauthentication guard.
  revokeOnAccountRead = 2;
  const revoked = await workers[0].request('/profile/password', {
    method: 'POST', headers: bearer(valid.data.token), body: { currentPassword, newPassword: 'Other lanterns follow distant stars' },
  });
  assert.equal(revoked.status, 401);
  assert.match(revoked.data.message, /Sign in again/);
  assert.equal((await pg.query('SELECT password_hash FROM users WHERE id=$1', [id])).rows[0].password_hash, row.password_hash);
});

test('cached Auth0 identities refresh from the primary database and reject deletion, relinking, and outages', async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users (id UUID PRIMARY KEY, name TEXT, email TEXT UNIQUE, password_hash TEXT,
    auth_version INTEGER NOT NULL DEFAULT 0, auth_provider TEXT, auth_subject TEXT, title TEXT);`);
  const id = crypto.randomUUID();
  const subject = 'auth0|cached-identity-test';
  const payload = { sub: subject, email: 'auth0-member@example.invalid' };
  await pg.query('INSERT INTO users (id,name,email,password_hash,auth_provider,auth_subject,title) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, 'Member', payload.email, 'provider-managed', 'auth0', subject, 'Old title']);
  let outage = false;
  const app = await createAppHarness({ connected: true, query: (sql, params) => {
    if (outage) throw new Error('Primary database unavailable');
    return pg.query(sql, params);
  } });
  t.after(() => app.close());
  assert.equal((await app.provisionAuth0User(payload)).id, id);
  await pg.query('UPDATE users SET title=$1 WHERE id=$2', ['Current title', id]);
  assert.equal((await app.provisionAuth0User(payload)).title, 'Current title');
  outage = true;
  await assert.rejects(app.provisionAuth0User(payload), { status: 503 });
  outage = false;
  await pg.query('UPDATE users SET auth_subject=$1 WHERE id=$2', ['auth0|different-identity', id]);
  await assert.rejects(app.provisionAuth0User(payload), { status: 401 });
  await pg.query('UPDATE users SET auth_subject=$1 WHERE id=$2', [subject, id]);
  assert.equal((await app.provisionAuth0User(payload)).id, id);
  await pg.query('DELETE FROM users WHERE id=$1', [id]);
  await assert.rejects(app.provisionAuth0User(payload), { status: 401 });

  const disconnected = await createAppHarness();
  t.after(() => disconnected.close());
  disconnected.seedUser(member(id, { authProvider: 'auth0', authSubject: subject }));
  await assert.rejects(disconnected.provisionAuth0User(payload), { status: 503 });
});

test('private settings and hidden skills do not escape through member profiles or discovery', async t => {
  const app = await createAppHarness();
  t.after(() => app.close());
  app.seedUser(member('viewer'));
  app.seedUser(member('private', {
    skills: ['PrivateSkillMarker'], passwordHash: 'hash-secret', phone: '+15555550123',
    socialTokens: { github: 'access-secret' }, socialRefreshTokens: { github: 'refresh-secret' },
    roleSettings: { privacy_showSkills: false, privacy_showConnections: false, feedLocation: { city: 'PrivatePlace' }, notifs_mentions: false, primaryStack: 'JavaScript', openToWork: true },
  }));
  const profile = await app.request('/users/private', { userId: 'viewer' });
  assert.equal(profile.status, 200);
  assert.deepEqual(profile.data.skills, []);
  assert.deepEqual(profile.data.roleSettings, { openToWork: true, primaryStack: 'JavaScript' });
  for (const secret of ['PrivatePlace', 'access-secret', 'refresh-secret', 'hash-secret', '+15555550123', 'private@example.invalid']) {
    assert.equal(JSON.stringify(profile.data).includes(secret), false, secret);
  }
  assert.equal((await app.request('/users/search?q=PrivateSkillMarker', { userId: 'viewer' })).data.users.length, 0);
  assert.equal((await app.request('/users/search?q=private@example.invalid', { userId: 'viewer' })).data.users.length, 0);
  assert.equal((await app.request('/users/private/followers', { userId: 'viewer' })).data.restricted, true);
  assert.deepEqual(publicRoleSettings({ password: 'secret', feedLocation: 'secret' }), {});
});

test('spoofed forwarding headers cannot bypass login limits', async t => {
  const app = await createAppHarness();
  t.after(() => app.close());
  for (let i = 0; i < 21; i++) {
    const result = await app.request('/auth/login', { method: 'POST', headers: {
      'cf-connecting-ip': `198.51.100.${i}`, 'x-forwarded-for': `198.51.100.${i}`, 'x-real-ip': `198.51.100.${i}`,
    }, body: { email: 'missing@example.invalid', password: 'invalid' } });
    assert.equal(result.status, i < 20 ? 401 : 429);
  }
});

test('social credentials use authenticated encryption, bind to account/platform/type, and migrate atomically', async t => {
  const env = { OAUTH_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64') };
  const vault = createTokenVault(env);
  const encrypted = vault.encryptMap({ github: 'access-secret' }, 'alice', 'access');
  assert.equal(JSON.stringify(encrypted).includes('access-secret'), false);
  assert.deepEqual(vault.decryptMap(encrypted, 'alice', 'access'), { github: 'access-secret' });
  assert.throws(() => vault.decryptMap(encrypted, 'bob', 'access'));
  assert.throws(() => vault.decryptMap(encrypted, 'alice', 'refresh'));
  assert.throws(() => vault.decryptMap({ youtube: encrypted.github }, 'alice', 'access'));
  assert.throws(() => vault.decryptMap({ github: 'plaintext' }, 'alice', 'access'));
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, social_tokens JSONB DEFAULT '{}', social_refresh_tokens JSONB DEFAULT '{}');`);
  await pg.query('INSERT INTO users (id,social_tokens) VALUES ($1,$2)', ['alice', { github: 'access-secret' }]);
  const db = { isConnected: () => true, withClient: fn => fn(pg) };
  await migrateSocialCredentials(db, vault);
  const before = (await pg.query('SELECT * FROM users')).rows;
  assert.equal(JSON.stringify(before).includes('access-secret'), false);
  await migrateSocialCredentials(db, vault);
  assert.deepEqual((await pg.query('SELECT * FROM users')).rows, before);
  await pg.query('INSERT INTO users (id,social_tokens) VALUES ($1,$2)', ['broken', { github: 'enc:v1:invalid' }]);
  await pg.query('UPDATE users SET social_tokens=$1 WHERE id=$2', [{ github: 'legacy-token' }, 'alice']);
  await assert.rejects(migrateSocialCredentials(db, vault));
  assert.equal((await pg.query('SELECT social_tokens FROM users WHERE id=$1', ['alice'])).rows[0].social_tokens.github, 'legacy-token');
});

test('production database TLS verifies certificates and connection URLs cannot override it', () => {
  const options = databaseConnectionOptions('postgres://user:pass@db.invalid/database?sslmode=no-verify&ssl=false', { NODE_ENV: 'production' });
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.connectionString.includes('sslmode'), false);
  assert.throws(() => databaseConnectionOptions('postgres://db.invalid/database', { NODE_ENV: 'production', DATABASE_SSL_MODE: 'disable' }));
  assert.equal(databaseConnectionOptions('postgres://db.invalid/database', { NODE_ENV: 'production', DATABASE_SSL_MODE: 'disable', DATABASE_ALLOW_PLAINTEXT_INTERNAL: 'true' }).ssl, false);
});

test('provider redirects drop credentials across origins and errors never include URL secrets or response bodies', async () => {
  const requests = [];
  const client = createProviderJsonClient({ get(url, options, callback) {
    requests.push({ url: String(url), headers: options.headers });
    const request = new EventEmitter();
    request.setTimeout = () => request;
    setImmediate(() => {
      const response = new EventEmitter();
      response.resume = () => {};
      response.headers = {};
      if (requests.length === 1) {
        response.statusCode = 302;
        response.headers.location = 'https://other.invalid/private?access_token=redirect-secret';
      } else response.statusCode = 401;
      callback(response);
      response.emit('data', 'secret-body-with-access-token');
      response.emit('end');
    });
    return request;
  } });
  await assert.rejects(client.fetchJSON('https://provider.invalid/path?client_secret=top-secret', { Authorization: 'Bearer access-secret', 'X-Api-Key': 'key-secret' }), error => {
    assert.equal(error.message, 'HTTP 401 for https://other.invalid');
    return true;
  });
  assert.equal(requests[0].headers.Authorization, 'Bearer access-secret');
  assert.equal(requests[1].headers.Authorization, undefined);
  assert.equal(requests[1].headers['X-Api-Key'], undefined);
  await assert.rejects(client.fetchJSON('http://insecure.invalid/token'), /Unsafe provider URL/);
});

test('production auth and readiness remain closed until security storage initializes', async t => {
  const app = await createAppHarness({ env: { NODE_ENV: 'production', JWT_SECRET: crypto.randomBytes(48).toString('base64') } });
  t.after(() => app.close());
  assert.equal((await app.request('/readyz')).status, 503);
  assert.equal((await app.request('/health')).status, 503);
  assert.equal((await app.request('/auth/login', { method: 'POST', body: { email: 'member@example.invalid', password: 'legacy' } })).status, 503);
});
