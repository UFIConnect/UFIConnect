const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./test-support/app-harness');

test('member and group routes enforce their actual HTTP contracts', async t => {
  const app = await createAppHarness();
  t.after(() => app.close());
  app.seedUser(member('alice', { roleSettings: { feedLanguages: ['en'], privacy_messagePermission: 'connections' } }));
  app.seedUser(member('bob'));
  app.groups.push({ id: 'audit-private', name: 'Private', isPrivate: true, createdBy: 'bob', members: 1 });

  await t.test('static connections and blocked routes resolve before user profiles', async () => {
    for (const [url, key] of [['/users/connections', 'connections'], ['/users/blocked', 'users']]) {
      const result = await app.request(url, { userId: 'alice' });
      assert.equal(result.status, 200, url);
      assert.ok(Array.isArray(result.data[key]), url);
    }
  });
  await t.test('private groups cannot be joined or have members listed by a stranger', async () => {
    for (const [url, method] of [['/groups/audit-private/members', 'GET'], ['/groups/audit-private/join', 'POST']]) {
      assert.equal((await app.request(url, { userId: 'alice', method })).status, 404, url);
    }
    assert.deepEqual(app.users.find(user => user.id === 'alice').joinedGroups, []);
  });
  await t.test('external groups cannot receive native UFI posts', async () => {
    const external = app.groups.find(group => group.isExternal);
    assert.ok(external);
    const result = await app.request(`/groups/${external.id}/posts`, {
      userId: 'alice', method: 'POST', body: { content: 'A useful community update.' },
    });
    assert.equal(result.status, 400);
  });
  await t.test('onboarding never autojoins external or private groups', () => {
    const suggestions = app.pickOnboardingGroups({ role: 'Engineer / Developer', interests: ['Engineering'] });
    assert.ok(suggestions.every(id => {
      const group = app.groups.find(candidate => candidate.id === id);
      return !group.isExternal && !group.isPrivate;
    }));
  });
  await t.test('partial settings saves preserve other member settings', async () => {
    const result = await app.request('/profile', { userId: 'alice', method: 'PATCH', body: { roleSettings: { feedLocation: { country: 'US', city: 'San Diego' } } } });
    assert.equal(result.status, 200);
    const profile = (await app.request('/profile', { userId: 'alice' })).data;
    assert.deepEqual(profile.roleSettings.feedLanguages, ['en']);
    assert.equal(profile.roleSettings.privacy_messagePermission, 'connections');
    assert.deepEqual((await app.request('/profile', { userId: 'bob' })).data.roleSettings, {});
  });
  await t.test('three-step onboarding saves without goals and preserves existing goals', async () => {
    const alice = app.users.find(user => user.id === 'alice');
    alice.preferences.goals = ['networking'];
    for (const body of [
      { role: 'Designer', interests: ['Design Systems'], experience: 'mid' },
      { preferences: { role: 'Engineer', interests: ['Open Source'], experience: 'senior' } },
    ]) {
      const result = await app.request('/profile/onboarding', { userId: 'alice', method: 'POST', body });
      assert.equal(result.status, 200);
      const profile = (await app.request('/profile', { userId: 'alice' })).data;
      assert.deepEqual(profile.preferences.goals, ['networking']);
      assert.equal(profile.onboardingComplete, true);
      assert.equal(profile.preferences.role, (body.preferences || body).role);
    }
  });
  await t.test('malformed login and reset inputs fail promptly', async () => {
    for (const [url, body] of [
      ['/auth/login', { email: [], password: 'secret' }],
      ['/auth/login', { email: 'alice@example.invalid', password: {} }],
      ['/auth/reset-password', { token: [], password: {} }],
    ]) assert.equal((await app.request(url, { method: 'POST', body })).status, 400);
  });
  await t.test('private groups are not leaked in recommendations', async () => {
    const result = await app.request('/groups/recommend?triggerGroupId=public&count=1000', { userId: 'alice' });
    assert.equal(result.status, 200);
    assert.ok(result.data.recommended.every(group => group.id !== 'audit-private'));
  });
  await t.test('protected account routes reject guests', async () => {
    for (const url of ['/profile', '/users/connections', '/users/blocked', '/profile/attachments', '/resume-builder/draft']) {
      assert.equal((await app.request(url)).status, 401, url);
    }
  });
  await t.test('resume outages return a retryable error instead of an empty saved draft', async () => {
    app.users.find(user => user.id === 'alice').resumeBuilderAddon = true;
    assert.equal((await app.request('/resume-builder/draft', { userId: 'alice' })).status, 503);
  });
  await t.test('Office remains protected when its deployment token is missing', async () => {
    assert.equal((await app.request('/office/controls')).status, 503);
  });
  await t.test('health and public group discovery stay available', async () => {
    assert.equal((await app.request('/health')).status, 200);
    const result = await app.request('/groups?limit=100');
    assert.equal(result.status, 200);
    assert.ok(result.data.groups.every(group => !group.isPrivate));
    assert.ok(result.data.groups.filter(group => group.isExternal).every(group => !group.canJoin && !group.isJoined));
  });
});

test('registration accepts missing and blank phones, but validates supplied numbers', async t => {
  let count = 0;
  const app = await createAppHarness({ connected: true, query(sql, params) {
    if (sql.startsWith('INSERT INTO users')) return { rows: [{
      id: `a0000000-0000-4000-8000-${String(++count).padStart(12, '0')}`,
      name: params[0], email: params[1], phone: params[2], password_hash: params[3],
    }] };
    return { rows: [] };
  } });
  t.after(() => app.close());
  for (const phone of [undefined, '', '   ', '+1 619 555 0123']) {
    const result = await app.request('/auth/register', { method: 'POST', body: {
      name: ' Test Member ', email: ` MEMBER${count}@example.invalid `, password: 'test-only-password', phone,
    } });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    assert.ok(result.data.token);
    assert.equal(result.data.profile.phone, phone?.trim() ? '+16195550123' : '');
    assert.equal(result.data.profile.name, 'Test Member');
  }
  assert.equal((await app.request('/auth/register', { method: 'POST', body: {
    name: 'Member', email: 'bad-phone@example.invalid', password: 'test-only-password', phone: 'not a phone',
  } })).status, 400);
});

test('checkout requires durable storage and billing outages are retryable', async t => {
  const customers = [];
  const sessions = [];
  let event = { type: 'checkout.session.completed', data: { object: {} } };
  const stripe = {
    customers: { async create(data) { customers.push(data); return { id: 'cus_fixture' }; } },
    checkout: { sessions: { async create(data) { sessions.push(data); return { url: 'https://checkout.stripe.com/test-fixture' }; } } },
    webhooks: { constructEvent() { return event; } },
  };
  const app = await createAppHarness({
    env: { STRIPE_SECRET_KEY: 'test-only', STRIPE_WEBHOOK_SECRET: 'test-only', STRIPE_PRICE_ID: 'price_fixture' },
    modules: { stripe: () => stripe },
  });
  t.after(() => app.close());
  app.seedUser(member('buyer', { phone: '' }));
  const result = await app.request('/billing/create-checkout-session', { method: 'POST', userId: 'buyer', body: { tier: 'pro' } });
  assert.equal(result.status, 503, JSON.stringify(result.data));
  assert.equal(customers.length, 0);
  assert.equal(sessions.length, 0);
  assert.equal((await app.request('/billing/create-checkout-session', { method: 'POST', userId: 'buyer', body: { tier: 'invalid' } })).status, 400);
  for (const type of ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted']) {
    event = { ...event, type };
    assert.equal((await app.request('/billing/webhook', { method: 'POST', body: {} })).status, 503);
  }
});

test('resume selection commits atomically and rolls back failed writes', async t => {
  let fail = false;
  const app = await createAppHarness({ connected: true, query(sql, params) {
    if (sql.startsWith('SELECT id, name, billing_closed FROM users')) return { rows: [{ id: 'alice', name: 'Alice', billing_closed: false }] };
    if (sql.startsWith('SELECT id FROM attachments')) return { rows: params[0] === 'own' && params[1] === 'alice' ? [{ id: 'own' }] : [] };
    if (fail && sql.startsWith('UPDATE attachments SET is_primary=true')) throw new Error('DB write failed');
    return { rows: [] };
  } });
  t.after(() => app.close());
  app.seedUser(member('alice'));
  const select = id => app.request(`/profile/attachments/${id}/select`, { method: 'POST', userId: 'alice', body: {} });
  assert.equal((await select('own')).status, 200);
  assert.equal(app.queries.at(-1).sql, 'COMMIT');
  assert.ok(app.queries.some(q => q.sql.includes('FOR UPDATE')));
  fail = true;
  assert.equal((await select('own')).status, 500);
  assert.equal(app.queries.at(-1).sql, 'ROLLBACK');
  const before = app.queries.length;
  assert.equal((await select('someone-elses')).status, 404);
  assert.equal(app.queries.slice(before).some(q => q.sql.startsWith('UPDATE attachments')), false);
});

test('Auth0 cannot claim an existing email or create a volatile account during an outage', async t => {
  const offline = await createAppHarness();
  t.after(() => offline.close());
  await assert.rejects(offline.provisionAuth0User({ sub: 'auth0|new', email: 'new@example.invalid' }), { status: 503 });
  assert.equal(offline.users.length, 0);
  const app = await createAppHarness({ connected: true, query(sql) {
    return { rows: sql.includes('WHERE email') ? [{ id: 'existing', email: 'existing@example.invalid', auth_provider: 'local' }] : [] };
  } });
  t.after(() => app.close());
  for (const email_verified of [false, true]) {
    await assert.rejects(app.provisionAuth0User({ sub: 'auth0|different', email: 'existing@example.invalid', email_verified }), { status: 409 });
  }
  assert.equal(app.queries.some(q => /^(UPDATE|INSERT)/.test(q.sql)), false);
});

test('a failed member preference write rolls back without changing another account', async t => {
  const id = 'a0000000-0000-4000-8000-000000000088';
  const app = await createAppHarness({ connected: true, query(sql) {
    if (sql.startsWith('UPDATE users')) throw new Error('Simulated storage failure');
    if (sql.startsWith('SELECT * FROM users WHERE id')) return { rows: [{ id, name: 'Test Member', email: 'member@example.invalid', role: 'Designer', interests: ['Design Systems'], goals: ['networking'], experience: 'mid' }] };
    if (sql.startsWith('SELECT id FROM auth_sessions')) return { rows: [{ id: 'active-session' }] };
    return { rows: [] };
  } });
  t.after(() => app.close());
  app.seedUser(member(id, { preferences: { role: 'Designer', interests: ['Design Systems'], goals: ['networking'], experience: 'mid' } }));
  app.seedUser(member('bob'));
  await app.request('/profile', { userId: id });
  const before = JSON.stringify(app.users.find(user => user.id === id));
  const result = await app.request('/profile/onboarding', { method: 'POST', userId: id, body: { role: 'Engineer', interests: ['Open Source'], experience: 'senior' } });
  assert.equal(result.status, 500);
  assert.equal(JSON.stringify(app.users.find(user => user.id === id)), before);
  assert.equal(app.queries.filter(q => q.sql.startsWith('UPDATE users')).length, 1);
  assert.deepEqual(app.users.find(user => user.id === 'bob').roleSettings, {});
});
