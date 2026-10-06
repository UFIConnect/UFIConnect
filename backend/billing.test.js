const assert = require('node:assert/strict');
const { before, after, beforeEach, test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { BILLING_SCHEMA, createBilling, quantityOneAmount, validRecurringPrice } = require('./billing');
const { createAppHarness, member } = require('./test-support/app-harness');

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
let pg;
before(async () => {
  pg = new PGlite();
  await pg.exec(`CREATE TABLE users (id UUID PRIMARY KEY, name TEXT, email TEXT,
    plan TEXT NOT NULL DEFAULT 'free', stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT, resume_builder_addon BOOLEAN DEFAULT false,
    resume_builder_subscription_id TEXT)`);
  for (const statement of BILLING_SCHEMA) await pg.exec(statement);
});
after(async () => { await pg.close(); });
beforeEach(async () => {
  await pg.exec('TRUNCATE billing_webhook_events, billing_checkout_attempts, users CASCADE');
  await pg.query("INSERT INTO users(id,name,email,stripe_customer_id) VALUES($1,'Alice','alice@example.invalid','cus_a'),($2,'Bob','bob@example.invalid','cus_b')", [A, B]);
});

function setup() {
  const subscriptions = new Map();
  const sessions = new Map();
  const idempotency = new Map();
  const creates = [];
  const portalCustomers = [];
  let failWrite = false;
  let failProvider = false;
  let tail = Promise.resolve();
  const db = {
    isConnected: () => true,
    query: (sql, params) => pg.query(sql, params),
    // PGlite is one real PostgreSQL connection. Queue transactions, as a
    // production connection/row lock does, while testing actual SQL writes,
    // unique constraints, rollback, and conflict handling.
    withClient(work) {
      const result = tail.then(() => work({ query: async (sql, params) => {
        if (failWrite && sql.startsWith('UPDATE billing_checkout_attempts SET session_id')) { failWrite = false; throw new Error('simulated DB write failure'); }
        return pg.query(sql, params);
      } }));
      tail = result.catch(() => {});
      return result;
    },
  };
  const stripe = {
    customers: {
      async retrieve(id) { return { id, metadata: { uficonnect_user_id: id === 'cus_a' ? A : B } }; },
      async create(data) { return { id: 'cus_new', ...data }; },
    },
    checkout: { sessions: {
      async retrieve(id) { if (failProvider) throw new Error('provider outage'); assert.ok(sessions.has(id), id); return structuredClone(sessions.get(id)); },
      async listLineItems(id) { return { data: sessions.get(id).line_items.map(item => ({ ...item, price: { id: item.price } })) }; },
      async create(data, options) {
        creates.push({ data, options });
        if (!idempotency.has(options.idempotencyKey)) {
          const id = `cs_${idempotency.size + 1}`;
          const result = { ...data, id, status: 'open', payment_status: 'unpaid', url: `https://checkout.stripe.com/${id}` };
          sessions.set(id, result); idempotency.set(options.idempotencyKey, result);
        }
        return idempotency.get(options.idempotencyKey);
      },
      async *list({ customer, status }) { if (failProvider) throw new Error('provider outage'); for (const value of sessions.values()) if (value.customer === customer && (!status || value.status === status)) yield value; },
      async expire(id) { if (failProvider) throw new Error('provider outage'); sessions.get(id).status = 'expired'; },
    } },
    subscriptions: {
      async retrieve(id) { if (failProvider) throw new Error('provider outage'); assert.ok(subscriptions.has(id), id); return structuredClone(subscriptions.get(id)); },
      async *list({ customer }) { for (const value of subscriptions.values()) if (value.customer === customer) yield value; },
      async cancel(id, options) { assert.equal(options.prorate, false); assert.equal(options.invoice_now, false); if (failProvider) throw new Error('provider outage'); subscriptions.get(id).status = 'canceled'; },
    },
    billingPortal: { sessions: { async create(data) { portalCustomers.push(data.customer); return { url: 'https://billing.stripe.com/test' }; } } },
  };
  const catalog = { allowedPrices: new Map([['price_pro', 'pro'], ['price_business', 'business'], ['price_business_team', 'business_team'], ['price_resume', 'resume_builder'], ['price_resume_monthly', 'resume_builder_monthly'], ['price_vpn', 'vpn_connector']]),
    tiers: Object.fromEntries([['pro', 'price_pro'], ['business', 'price_business'], ['business_team', 'price_business_team'], ['resume_builder', 'price_resume'], ['resume_builder_monthly', 'price_resume_monthly'], ['vpn_connector', 'price_vpn']].map(([tier, priceId]) => [tier, { available: true, priceId }])) };
  const service = createBilling({ db, stripe, getCatalog: async () => catalog, frontendBase: 'https://uficonnect.org' });
  const sub = (id = 'sub_a', overrides = {}) => {
    const value = { id, customer: 'cus_a', status: 'active', latest_invoice: { status: 'paid' },
      metadata: { tier: 'pro', uficonnect_user_id: A }, cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_pro' }, quantity: 1, current_period_end: 1900000000 }] }, ...overrides };
    subscriptions.set(id, value); return value;
  };
  const session = (id = 'cs_paid', subscription = 'sub_a', overrides = {}) => {
    const value = { id, mode: 'subscription', customer: 'cus_a', client_reference_id: A,
      status: 'complete', payment_status: 'paid', subscription, metadata: { tier: 'pro', uficonnect_user_id: A }, ...overrides };
    sessions.set(id, value); return value;
  };
  const event = (id = 'evt_1', type = 'checkout.session.completed', object = { id: 'cs_paid', customer: 'cus_a' }) => ({ id, type, data: { object } });
  return { service, stripe, db, catalog, sub, session, event, creates, sessions, subscriptions, portalCustomers,
    failWrite() { failWrite = true; }, providerOutage() { failProvider = true; } };
}
async function alice() { return (await pg.query('SELECT * FROM users WHERE id=$1', [A])).rows[0]; }

function rejectedCheckout(replayed = true, overrides = {}) {
  return Object.assign(new Error('Product configuration rejected'), {
    type: 'StripeInvalidRequestError', statusCode: 400,
    headers: { 'idempotent-replayed': String(replayed) }, ...overrides,
  });
}

for (const [tier, quantity] of [['vpn_connector', 1], ['business', 1], ['business', 3]]) {
  test(`${tier} quantity ${quantity} recovers a cached rejection after configuration repair without duplicate checkout`, async () => {
    const f = setup();
    const create = f.stripe.checkout.sessions.create;
    const keys = [];
    f.stripe.checkout.sessions.create = async (data, options) => {
      keys.push(options.idempotencyKey);
      if (keys.length === 1) throw rejectedCheckout(false);
      if (options.idempotencyKey === keys[0]) throw rejectedCheckout();
      return create(data, options);
    };
    await assert.rejects(f.service.createCheckout(A, tier, quantity), /configuration rejected/);
    const results = await Promise.all([f.service.createCheckout(A, tier, quantity), f.service.createCheckout(A, tier, quantity)]);
    assert.equal(results[0].url, results[1].url);
    assert.equal(keys[0], keys[1]);
    assert.notEqual(keys[1], keys[2]);
    assert.equal(f.sessions.size, 1);
    assert.equal(f.creates[0].data.line_items[0].quantity, quantity);
    assert.equal((await alice()).plan, 'free');
    assert.equal((await alice()).vpn_connector_addon, false);
  });
}

test('uncertain provider errors preserve the durable checkout key', async () => {
  const f = setup();
  const keys = [];
  const errors = [rejectedCheckout(false), rejectedCheckout(true, { statusCode: 500 }),
    rejectedCheckout(true, { type: 'StripeConnectionError' })];
  f.stripe.checkout.sessions.create = async (data, options) => {
    keys.push(options.idempotencyKey);
    throw errors.shift();
  };
  for (let i = 0; i < 3; i++) await assert.rejects(f.service.createCheckout(A, 'business'));
  assert.equal(new Set(keys).size, 1);
  assert.equal(f.sessions.size, 0);
});

test('cached rejection recovery stops when provider history fails or another checkout remains payable', async () => {
  const f = setup();
  f.stripe.checkout.sessions.create = async () => { throw rejectedCheckout(false); };
  await assert.rejects(f.service.createCheckout(A, 'business'));
  const original = (await pg.query('SELECT attempt_id FROM billing_checkout_attempts WHERE user_id=$1', [A])).rows[0].attempt_id;
  f.stripe.checkout.sessions.create = async () => { throw rejectedCheckout(); };
  f.session('cs_other', null, { status: 'open', line_items: [{ price: 'price_business', quantity: 1 }] });
  await assert.rejects(f.service.createCheckout(A, 'business'), { status: 409 });
  f.sessions.clear();
  f.providerOutage();
  await assert.rejects(f.service.createCheckout(A, 'business'), /provider outage/);
  assert.equal((await pg.query('SELECT attempt_id FROM billing_checkout_attempts WHERE user_id=$1', [A])).rows[0].attempt_id, original);
});

test('cached rejection recovery rotates at most once per request', async () => {
  const f = setup();
  const keys = [];
  f.stripe.checkout.sessions.create = async (data, options) => {
    keys.push(options.idempotencyKey);
    throw rejectedCheckout();
  };
  await assert.rejects(f.service.createCheckout(A, 'business'), /configuration rejected/);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  assert.equal(f.sessions.size, 0);
});

test('billing schema reruns preserve valid checkout slots and reject unsupported slots', async () => {
  for (let pass = 0; pass < 2; pass++) for (const statement of BILLING_SCHEMA) await pg.exec(statement);
  const f = setup();
  await f.service.createCheckout(A, 'vpn_connector');
  const { rows: [attempt] } = await pg.query('SELECT slot FROM billing_checkout_attempts WHERE user_id=$1', [A]);
  assert.equal(attempt.slot, 'vpn_connector');
  await assert.rejects(pg.query("UPDATE billing_checkout_attempts SET slot='unsupported' WHERE user_id=$1", [A]), error => error.code === '23514');
  assert.equal((await pg.query('SELECT slot FROM billing_checkout_attempts WHERE user_id=$1', [A])).rows[0].slot, 'vpn_connector');
});

test('VPN is an independent paid add-on, rejects duplicate checkout and revokes only its own slot', async () => {
  const f = setup(); f.sub(); f.session(); await f.service.handleEvent(f.event());
  const checkout = await f.service.createCheckout(A, 'vpn_connector');
  assert.match(checkout.url, /^https:\/\/checkout.stripe.com\//);
  assert.equal((await f.service.createCheckout(A, 'vpn_connector')).url, checkout.url);
  const call = f.creates.find(item => item.data.metadata.tier === 'vpn_connector');
  assert.equal(call.data.line_items[0].price, 'price_vpn'); assert.equal(call.data.line_items[0].quantity, 1);
  assert.match(call.data.success_url, /\/vault\?upgrade=success$/);
  const overrides = { metadata: { tier: 'vpn_connector', uficonnect_user_id: A }, items: { data: [{ price: { id: 'price_vpn' }, quantity: 1 }] } };
  f.sub('sub_vpn', { ...overrides, latest_invoice: { status: 'open' } });
  await f.service.handleEvent(f.event('evt_vpn_unpaid', 'customer.subscription.created', { id: 'sub_vpn', customer: 'cus_a' }));
  assert.equal((await alice()).vpn_connector_addon, false);
  f.sub('sub_vpn', overrides);
  await f.service.handleEvent(f.event('evt_vpn_paid', 'invoice.paid', { subscription: 'sub_vpn', customer: 'cus_a' }));
  assert.equal((await f.service.status(A)).vpnConnectorAddon, true);
  assert.equal((await alice()).plan, 'pro'); assert.equal((await f.service.status(B)).vpnConnectorAddon, false);
  await assert.rejects(f.service.createCheckout(A, 'vpn_connector'), { status: 409 });
  for (const status of ['past_due', 'unpaid', 'canceled', 'incomplete_expired']) {
    f.sub('sub_vpn', { ...overrides, status });
    await f.service.handleEvent(f.event(`evt_vpn_${status}`, 'customer.subscription.updated', { id: 'sub_vpn', customer: 'cus_a' }));
    assert.equal((await alice()).vpn_connector_addon, false);
    assert.equal((await alice()).plan, 'pro');
  }
});

test('VPN price grants cannot be forged by metadata, quantity or a different owner', async () => {
  const f = setup();
  for (const [id, overrides] of [
    ['wrong_price', { items: { data: [{ price: { id: 'price_unapproved' }, quantity: 1 }] } }],
    ['wrong_quantity', { items: { data: [{ price: { id: 'price_vpn' }, quantity: 2 }] } }],
    ['wrong_owner', { customer: 'cus_b', items: { data: [{ price: { id: 'price_vpn' }, quantity: 1 }] } }],
  ]) {
    f.sub(id, { metadata: { tier: 'vpn_connector', uficonnect_user_id: A }, ...overrides });
    await f.service.handleEvent(f.event(`evt_${id}`, 'customer.subscription.created', { id, customer: 'cus_a' }));
    assert.equal((await alice()).vpn_connector_addon, false);
  }
});

test('changing a linked VPN subscription to a plan price revokes the old entitlement without granting a plan', async () => {
  const f = setup();
  const original = { metadata: { tier: 'vpn_connector', uficonnect_user_id: A }, items: { data: [{ price: { id: 'price_vpn' }, quantity: 1 }] } };
  f.sub('sub_vpn', original);
  await f.service.handleEvent(f.event('evt_initial_vpn', 'customer.subscription.created', { id: 'sub_vpn', customer: 'cus_a' }));
  assert.equal((await alice()).vpn_connector_addon, true);
  f.sub('sub_vpn', { items: { data: [{ price: { id: 'price_pro' }, quantity: 1 }] } });
  await f.service.handleEvent(f.event('evt_changed_kind', 'customer.subscription.updated', { id: 'sub_vpn', customer: 'cus_a' }));
  const row = await alice();
  assert.equal(row.vpn_connector_addon, false); assert.equal(row.vpn_connector_subscription_id, 'sub_vpn');
  assert.equal(row.plan, 'free'); assert.equal(row.stripe_subscription_id, null);
  const status = await f.service.status(A);
  assert.equal(status.plan, 'free'); assert.equal(status.vpnConnectorAddon, false);
});

test('VPN location metadata is gated, isolated by owner, bounded, exportable and deletable after cancellation', async () => {
  const f = setup();
  const { createVpnLocations } = require('./vpn-locations');
  const locations = createVpnLocations({ db: f.db, billing: f.service });
  const label = { platform: 'ios', name: 'Personal Proton', country: 'Canada' };
  await assert.rejects(locations.add(A, label), { status: 403 });
  f.sub('sub_vpn', { metadata: { tier: 'vpn_connector', uficonnect_user_id: A }, items: { data: [{ price: { id: 'price_vpn' }, quantity: 1 }] } });
  const saved = await locations.add(A, label);
  assert.equal((await locations.list(A)).locations[0].name, label.name);
  assert.equal((await locations.list(B)).locations.length, 0);
  await locations.remove(B, saved.location.id);
  assert.equal((await locations.list(A)).locations.length, 1);
  await assert.rejects(locations.add(A, { ...label, password: 'must-not-store' }), { status: 400 });
  await assert.rejects(locations.add(A, { ...label, name: 'a'.repeat(81) }), { status: 400 });
  await pg.query('INSERT INTO vault_vpn_locations(id,user_id,platform,name,country) SELECT gen_random_uuid(),$1,\'ios\',\'Profile\',\'Country\' FROM generate_series(1,39)', [A]);
  await assert.rejects(locations.add(A, label), { status: 409 });
  f.sub('sub_vpn', { status: 'canceled', metadata: { tier: 'vpn_connector', uficonnect_user_id: A }, items: { data: [{ price: { id: 'price_vpn' }, quantity: 1 }] } });
  await assert.rejects(locations.add(A, label), { status: 403 });
  assert.equal((await locations.list(A)).locations.length, 40);
  await locations.remove(A, saved.location.id);
  assert.equal((await locations.list(A)).locations.length, 39);
});

test('Vault enables hosted checkout only for the active USD 3.94 monthly price', async t => {
  for (const override of [{}, { currency: 'eur' }, { unit_amount: 395 }, { active: false }, { recurring: { interval: 'month', interval_count: 2 } }, { recurring: { interval: 'month', interval_count: 1, usage_type: 'metered' } }]) {
    const f = setup();
    const available = Object.keys(override).length === 0;
    const app = await createAppHarness({ connected: true,
      query: (sql, params) => sql.startsWith('SELECT id FROM auth_sessions')
        ? { rows: [{ id: params[0] }] } : pg.query(sql, params),
      env: { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_VPN_CONNECTOR_PRICE_ID: 'price_vpn' },
      modules: { stripe: () => ({ ...f.stripe, prices: { async retrieve() { return { id: 'price_vpn', type: 'recurring', active: true, currency: 'usd', unit_amount: 394, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }, ...override }; } } }) },
    });
    t.after(() => app.close());
    app.seedUser(member(A));
    const result = await app.request('/billing/config');
    assert.equal(result.status, 200); assert.equal(result.data.tiers.vpn_connector, available);
    assert.equal(result.data.paymentsReady, available);
    assert.equal(result.data.pricing.vpn_connector.matchesRequiredPrice, Object.keys(override).length === 0 || Object.keys(override).every(key => key === 'active'));
    const checkout = await app.request('/billing/create-checkout-session', { method: 'POST', userId: A, body: { tier: 'vpn_connector' } });
    if (available) {
      assert.equal(checkout.status, 200, JSON.stringify({ response: checkout.data, errors: app.errors }));
      assert.match(checkout.data.url, /^https:\/\/checkout.stripe.com\//);
      assert.equal(f.creates[0].data.line_items[0].price, 'price_vpn');
      assert.equal(f.creates[0].data.line_items[0].quantity, 1);
      assert.match(f.creates[0].data.success_url, /\/vault\?upgrade=success$/);
      assert.equal((await alice()).vpn_connector_addon, false, 'Opening checkout does not activate unpaid membership');
    } else {
      assert.equal(checkout.status, 503); assert.match(checkout.data.message, /Vault checkout is temporarily unavailable/);
      assert.equal(f.creates.length, 0);
    }
    assert.equal((await app.request('/vault/vpn/locations')).status, 401);
  }
});

test('Vault checkout remains unavailable without webhook, database or configured price', async t => {
  for (const missing of ['webhook', 'database', 'price']) {
    const app = await createAppHarness({ connected: missing !== 'database',
      env: { STRIPE_SECRET_KEY: 'sk_test_fixture', ...(missing === 'webhook' ? {} : { STRIPE_WEBHOOK_SECRET: 'whsec_fixture' }),
        ...(missing === 'price' ? {} : { STRIPE_VPN_CONNECTOR_PRICE_ID: 'price_vpn' }) },
      modules: { stripe: () => ({ prices: { async retrieve() { return { id: 'price_vpn', type: 'recurring', active: true, currency: 'usd', unit_amount: 394, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } }; } } }) },
    });
    t.after(() => app.close());
    app.seedUser(member('vault-buyer'));
    const result = await app.request('/billing/config');
    assert.equal(result.status, 200);
    assert.equal(result.data.tiers.vpn_connector, false);
    assert.equal(result.data.paymentsReady, false);
    const checkout = await app.request('/billing/create-checkout-session', { method: 'POST', userId: 'vault-buyer', body: { tier: 'vpn_connector' } });
    assert.equal(checkout.status, 503);
  }
});

test('status recovers a paid legacy subscription without a checkout attempt', async () => {
  const f = setup(); f.sub();
  assert.equal((await f.service.status(A)).plan, 'pro');
  assert.equal((await alice()).stripe_subscription_id, 'sub_a');
  assert.equal((await f.service.status(B)).plan, 'free');
});

test('legacy recovery rejects ambiguous subscriptions and rolls back', async () => {
  const f = setup(); f.sub(); f.sub('sub_duplicate');
  await assert.rejects(f.service.status(A), { status: 409 });
  assert.equal((await alice()).plan, 'free');
  assert.equal((await alice()).stripe_subscription_id, null);
});

test('legacy recovery cannot grant unpaid, foreign, unknown-price or canceled memberships', async () => {
  const f = setup();
  f.sub('sub_unpaid', { latest_invoice: { status: 'open', billing_reason: 'subscription_create' } });
  f.sub('sub_foreign', { metadata: { uficonnect_user_id: B } });
  f.sub('sub_unknown', { items: { data: [{ price: { id: 'price_unknown' }, quantity: 1 }] } });
  f.sub('sub_canceled', { status: 'canceled' });
  assert.equal((await f.service.status(A)).plan, 'free');
  assert.equal((await alice()).stripe_subscription_id, null);
});

test('quantity-one tiered Pro price is validated and accurately displayed', () => {
  const price = { id: 'price_tiered', type: 'recurring', active: true, currency: 'usd', unit_amount: null,
    billing_scheme: 'tiered', tiers_mode: 'volume', recurring: { interval: 'month', interval_count: 1 },
    tiers: [{ up_to: 1, unit_amount: 1994, flat_amount: null }, { up_to: null, unit_amount: 1994 }] };
  assert.equal(quantityOneAmount(price), 1994);
  assert.equal(validRecurringPrice(price), true);
  assert.equal(validRecurringPrice({ ...price, tiers: undefined }), false);
  assert.equal(validRecurringPrice({ ...price, transform_quantity: { divide_by: 10 } }), false);
});

test('checkout grants only a paid current subscription on its saved customer, once', async () => {
  const f = setup(); f.sub(); f.session();
  await f.service.handleEvent(f.event());
  assert.equal((await alice()).plan, 'pro');
  assert.equal((await alice()).stripe_subscription_id, 'sub_a');
  assert.equal((await f.service.handleEvent(f.event())).duplicate, true);
  assert.equal((await pg.query('SELECT * FROM billing_webhook_events')).rows.length, 1);
});

test('unpaid checkout and active subscription with unpaid invoice never unlock membership', async () => {
  const f = setup(); f.sub('sub_a', { latest_invoice: { status: 'open' } }); f.session('cs_paid', 'sub_a', { payment_status: 'unpaid' });
  await f.service.handleEvent(f.event());
  assert.equal((await alice()).plan, 'free');
  await f.service.handleEvent(f.event('evt_sub', 'customer.subscription.created', { id: 'sub_a', customer: 'cus_a' }));
  assert.equal((await alice()).plan, 'free');
  f.sub(); f.session();
  await f.service.handleEvent(f.event('evt_async', 'checkout.session.async_payment_succeeded'));
  assert.equal((await alice()).plan, 'pro');
});

test('an active membership stays unlocked while its renewal invoice is drafted or collected', async () => {
  const f = setup(); f.sub(); f.session();
  await f.service.handleEvent(f.event());
  assert.equal((await alice()).plan, 'pro');
  for (const [index, status] of ['draft', 'open'].entries()) {
    f.sub('sub_a', { latest_invoice: { status, billing_reason: 'subscription_cycle' } });
    await f.service.handleEvent(f.event(`evt_renew_${index}`, 'customer.subscription.updated', { id: 'sub_a', customer: 'cus_a' }));
    assert.equal((await alice()).plan, 'pro', `A ${status} renewal invoice keeps the active membership`);
  }
  f.sub('sub_a', { collection_method: 'send_invoice', latest_invoice: { status: 'open', billing_reason: 'subscription_cycle' } });
  await f.service.handleEvent(f.event('evt_manual', 'customer.subscription.updated', { id: 'sub_a', customer: 'cus_a' }));
  assert.equal((await alice()).plan, 'free', 'Invoices sent for manual payment must be paid first');
  f.sub('sub_a', { latest_invoice: { status: 'open', billing_reason: 'subscription_create' } });
  await f.service.handleEvent(f.event('evt_first', 'customer.subscription.updated', { id: 'sub_a', customer: 'cus_a' }));
  assert.equal((await alice()).plan, 'free', 'A first invoice must be paid before access');
  f.sub('sub_a', { status: 'past_due', latest_invoice: { status: 'open', billing_reason: 'subscription_cycle' } });
  await f.service.handleEvent(f.event('evt_failed', 'customer.subscription.updated', { id: 'sub_a', customer: 'cus_a' }));
  assert.equal((await alice()).plan, 'free', 'A failed renewal still pauses access');
});

test('metadata cannot redirect another customer or upgrade an unapproved price', async () => {
  const f = setup(); f.sub(); f.session('cs_paid', 'sub_a', { client_reference_id: B, metadata: { uficonnect_user_id: B } });
  await f.service.handleEvent(f.event());
  assert.equal((await alice()).plan, 'free');
  assert.equal((await pg.query('SELECT plan FROM users WHERE id=$1', [B])).rows[0].plan, 'free');
  f.session(); f.sub('sub_a', { items: { data: [{ price: { id: 'price_unknown' }, quantity: 1 }] } });
  await f.service.handleEvent(f.event('evt_unknown'));
  assert.equal((await alice()).plan, 'free');
  assert.equal((await alice()).stripe_subscription_id, null);
});

test('late checkout reads current cancellation and cannot resurrect paid access', async () => {
  const f = setup(); f.sub('sub_a', { status: 'canceled' }); f.session();
  await f.service.handleEvent(f.event());
  assert.equal((await alice()).plan, 'free');
  assert.equal((await alice()).stripe_subscription_id, null);
});

test('old checkout and cancellation cannot replace or revoke a newer subscription', async () => {
  const f = setup(); f.sub('sub_new'); f.sub('sub_old', { status: 'canceled' }); f.session('cs_paid', 'sub_old');
  await pg.query("UPDATE users SET plan='pro',stripe_subscription_id='sub_new' WHERE id=$1", [A]);
  await f.service.handleEvent(f.event());
  await f.service.handleEvent(f.event('evt_deleted', 'customer.subscription.deleted', { id: 'sub_old', customer: 'cus_a' }));
  assert.equal((await alice()).plan, 'pro');
  assert.equal((await alice()).stripe_subscription_id, 'sub_new');
});

test('temporary payment failures retain the subscription and recover through authoritative invoice events', async () => {
  const f = setup(); f.sub(); f.session(); await f.service.handleEvent(f.event());
  f.sub('sub_a', { status: 'past_due', latest_invoice: { status: 'open' } });
  await f.service.handleEvent(f.event('evt_failed', 'invoice.payment_failed', { id: 'in_1', customer: 'cus_a', parent: { subscription_details: { subscription: 'sub_a' } } }));
  assert.equal((await alice()).plan, 'free'); assert.equal((await alice()).stripe_subscription_id, 'sub_a');
  await assert.rejects(f.service.createCheckout(A, 'pro'), { status: 409 });
  f.sub(); await f.service.handleEvent(f.event('evt_recovered', 'invoice.paid', { id: 'in_1', customer: 'cus_a', subscription: 'sub_a' }));
  assert.equal((await alice()).plan, 'pro');
});

test('add-on cancellation does not affect an independent Pro membership', async () => {
  const f = setup(); f.sub(); f.session(); await f.service.handleEvent(f.event());
  const addon = { metadata: { tier: 'resume_builder', uficonnect_user_id: A }, items: { data: [{ price: { id: 'price_resume' }, quantity: 1 }] } };
  f.sub('sub_addon', addon); f.session('cs_addon', 'sub_addon');
  await f.service.handleEvent(f.event('evt_addon', 'checkout.session.completed', { id: 'cs_addon', customer: 'cus_a' }));
  assert.equal((await alice()).resume_builder_addon, true);
  f.sub('sub_addon', { ...addon, status: 'canceled' });
  await f.service.handleEvent(f.event('evt_end_addon', 'customer.subscription.deleted', { id: 'sub_addon', customer: 'cus_a' }));
  const user = await alice(); assert.equal(user.plan, 'pro'); assert.equal(user.resume_builder_addon, false); assert.equal(user.resume_builder_subscription_id, null);
});

test('Business checkout selects its approved price and signed webhooks grant only paid access', async t => {
  const f = setup();
  await f.service.createCheckout(A, 'business');
  assert.equal(f.creates[0].data.line_items[0].price, 'price_business');
  assert.equal(f.creates[0].data.subscription_data.metadata.tier, 'business');
  const business = { metadata: { tier: 'business', uficonnect_user_id: A },
    items: { data: [{ price: { id: 'price_business' }, quantity: 1 }] } };
  f.sub('sub_business', { ...business, latest_invoice: { status: 'open' } });
  f.session('cs_business', 'sub_business', { payment_status: 'unpaid', metadata: { tier: 'business', uficonnect_user_id: A } });
  const sdk = require('stripe')('sk_test_fixture');
  const app = await createAppHarness({ connected: true, query: (sql, params) => pg.query(sql, params),
    env: { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_PRICE_ID_BUSINESS: 'price_business' },
    modules: { stripe: () => ({ ...f.stripe, webhooks: sdk.webhooks, prices: { async retrieve(id) {
      assert.equal(id, 'price_business');
      return { id, type: 'recurring', active: true, currency: 'usd', unit_amount: 5994,
        recurring: { interval: 'month', interval_count: 1 } };
    } } }) },
  });
  t.after(() => app.close());
  const body = f.event('evt_business_pending', 'checkout.session.completed', { id: 'cs_business', customer: 'cus_a' });
  const signed = payload => ({ 'stripe-signature': sdk.webhooks.generateTestHeaderString({ payload: JSON.stringify(payload), secret: 'whsec_fixture' }) });
  assert.equal((await app.request('/billing/webhook', { method: 'POST', body, headers: signed(body) })).status, 200);
  assert.equal((await alice()).plan, 'free');
  f.sub('sub_business', business);
  f.session('cs_business', 'sub_business', { metadata: { tier: 'business', uficonnect_user_id: A } });
  const paid = f.event('evt_business_paid', 'checkout.session.async_payment_succeeded', body.data.object);
  assert.equal((await app.request('/billing/webhook', { method: 'POST', body: paid, headers: signed(body) })).status, 400);
  assert.equal((await alice()).plan, 'free');
  assert.equal((await app.request('/billing/webhook', { method: 'POST', body: paid, headers: signed(paid) })).status, 200);
  assert.equal((await alice()).plan, 'business');
  assert.equal((await alice()).stripe_subscription_id, 'sub_business');
});

test('Business team checkout persists quantities and rejects changed, fractional, and non-Business quantities', async () => {
  const f = setup();
  for (const quantity of [0, -1, 1.5, 101, '2', null]) await assert.rejects(f.service.createCheckout(A, 'business', quantity), { status: 400 });
  await assert.rejects(f.service.createCheckout(A, 'pro', 2), { status: 400 });
  const result = await f.service.createCheckout(A, 'business', 3);
  assert.equal(f.creates[0].data.line_items[0].price, 'price_business_team');
  assert.equal(f.creates[0].data.line_items[0].quantity, 3);
  assert.equal((await f.service.createCheckout(A, 'business', 3)).url, result.url);
  await f.service.createCheckout(A, 'business', 4);
  await f.service.createCheckout(A, 'business', 1);
  assert.equal([...f.sessions.values()].filter(item => item.status === 'open').length, 1);
  const pending = (await pg.query('SELECT quantity FROM billing_checkout_attempts WHERE user_id=$1', [A])).rows[0];
  assert.equal(pending.quantity, 1);
});

test('paid Business team quantities control access and invoice failure clears all seats', async () => {
  const f = setup();
  const business = { metadata: { tier: 'business', quantity: '100', uficonnect_user_id: A },
    items: { data: [{ price: { id: 'price_business_team' }, quantity: 3 }] } };
  f.sub('sub_business_team', { ...business, latest_invoice: { status: 'open' } });
  await f.service.handleEvent(f.event('evt_team_unpaid', 'customer.subscription.created', { id: 'sub_business_team', customer: 'cus_a' }));
  assert.equal((await alice()).business_seats, 0);
  f.sub('sub_business_team', business);
  await f.service.handleEvent(f.event('evt_team_paid', 'invoice.paid', { subscription: 'sub_business_team', customer: 'cus_a' }));
  assert.equal((await alice()).plan, 'business');
  assert.equal((await f.service.status(A)).businessSeats, 3);
  f.sub('sub_business_team', { ...business, items: { data: [{ price: { id: 'price_business_team' }, quantity: 1 }] } });
  await f.service.handleEvent(f.event('evt_team_too_small', 'customer.subscription.updated', { id: 'sub_business_team', customer: 'cus_a' }));
  assert.equal((await alice()).plan, 'free'); assert.equal((await alice()).business_seats, 0);
  f.sub('sub_business_team', business);
  await f.service.handleEvent(f.event('evt_team_restored', 'invoice.paid', { subscription: 'sub_business_team', customer: 'cus_a' }));
  f.sub('sub_business_team', { ...business, status: 'past_due', latest_invoice: { status: 'open' } });
  await f.service.handleEvent(f.event('evt_team_failed', 'invoice.payment_failed', { subscription: 'sub_business_team', customer: 'cus_a' }));
  assert.equal((await alice()).plan, 'free'); assert.equal((await alice()).business_seats, 0);
});

test('new Business checkout rejects wrong amount, currency, cadence, or tiered price', async t => {
  const invalid = [
    { unit_amount: 5994 }, { currency: 'eur' },
    { recurring: { interval: 'year', interval_count: 1 } },
    { recurring: { interval: 'month', interval_count: 2 } },
    { billing_scheme: 'tiered', tiers_mode: 'volume', tiers: [{ up_to: null, unit_amount: 19994 }] },
  ];
  for (const override of invalid) {
    const app = await createAppHarness({ connected: true,
      env: { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_PRICE_ID_BUSINESS: 'price_wrong' },
      modules: { stripe: () => ({ prices: { async retrieve(id) { return { id, type: 'recurring', active: true, currency: 'usd', unit_amount: 19994, recurring: { interval: 'month', interval_count: 1 }, ...override }; } } }) },
    });
    try { const config = await app.request('/billing/config'); assert.equal(config.status, 200); assert.equal(config.data.tiers.business, false); }
    finally { await app.close(); }
  }
});

test('a portal seat increase keeps paid seats until the proration invoice is paid', async () => {
  const f = setup();
  const business = { metadata: { tier: 'business', uficonnect_user_id: A },
    items: { data: [{ price: { id: 'price_business_team' }, quantity: 2 }] } };
  f.sub('sub_team', business);
  await f.service.handleEvent(f.event('evt_team_initial', 'customer.subscription.created', { id: 'sub_team', customer: 'cus_a' }));
  assert.equal((await alice()).business_seats, 2);
  const expanded = { ...business, items: { data: [{ price: { id: 'price_business_team' }, quantity: 5 }] } };
  f.sub('sub_team', { ...expanded, latest_invoice: { status: 'open', billing_reason: 'subscription_update' } });
  await f.service.handleEvent(f.event('evt_team_expanding', 'customer.subscription.updated', { id: 'sub_team', customer: 'cus_a' }));
  assert.equal((await alice()).plan, 'business'); assert.equal((await alice()).business_seats, 2);
  f.sub('sub_team', expanded);
  await f.service.handleEvent(f.event('evt_team_expanded', 'invoice.paid', { subscription: 'sub_team', customer: 'cus_a' }));
  assert.equal((await alice()).business_seats, 5);
});

test('Pro and Resume Builder have independent durable checkout slots and repeat requests reuse each', async () => {
  const f = setup();
  const [plan, addon] = await Promise.all([f.service.createCheckout(A, 'pro'), f.service.createCheckout(A, 'resume_builder')]);
  assert.notEqual(plan.url, addon.url);
  assert.equal(f.creates.length, 2);
  assert.deepEqual(new Set(f.creates.map(call => call.data.line_items[0].price)), new Set(['price_pro', 'price_resume']));
  const attempts = (await pg.query('SELECT slot,attempt_id,session_id FROM billing_checkout_attempts WHERE user_id=$1 ORDER BY slot', [A])).rows;
  assert.deepEqual(attempts.map(attempt => attempt.slot), ['plan', 'resume_builder']);
  assert.notEqual(attempts[0].attempt_id, attempts[1].attempt_id);
  assert.equal((await f.service.createCheckout(A, 'pro')).url, plan.url);
  assert.equal((await f.service.createCheckout(A, 'resume_builder')).url, addon.url);
  assert.equal(f.creates.length, 2);
  assert.ok(f.creates.find(call => call.data.metadata.tier === 'resume_builder').data.success_url.endsWith('/resume-builder?upgrade=success'));
});

test('current approved price upgrades Pro to Business despite stale metadata and preserves the resume add-on', async () => {
  const f = setup(); f.sub(); f.session(); await f.service.handleEvent(f.event());
  const addon = { metadata: { tier: 'resume_builder', uficonnect_user_id: A },
    items: { data: [{ price: { id: 'price_resume' }, quantity: 1 }] } };
  f.sub('sub_addon', addon); f.session('cs_addon', 'sub_addon');
  await f.service.handleEvent(f.event('evt_addon', 'checkout.session.completed', { id: 'cs_addon', customer: 'cus_a' }));
  // Provider plan changes do not necessarily rewrite Checkout's old metadata.
  f.sub('sub_a', { items: { data: [{ price: { id: 'price_business' }, quantity: 1 }] } });
  await f.service.handleEvent(f.event('evt_upgrade', 'customer.subscription.updated', { id: 'sub_a', customer: 'cus_a', metadata: { tier: 'pro' } }));
  const user = await alice();
  assert.equal(user.plan, 'business'); assert.equal(user.stripe_subscription_id, 'sub_a');
  assert.equal(user.resume_builder_addon, true); assert.equal(user.resume_builder_subscription_id, 'sub_addon');
  f.sub('sub_addon', { ...addon, status: 'canceled' });
  await f.service.handleEvent(f.event('evt_addon_end', 'customer.subscription.deleted', { id: 'sub_addon', customer: 'cus_a' }));
  assert.equal((await alice()).plan, 'business'); assert.equal((await alice()).resume_builder_addon, false);
});

test('Business payment failure, recovery and cancellation change only the membership slot', async () => {
  const f = setup();
  const business = { metadata: { tier: 'business', uficonnect_user_id: A },
    items: { data: [{ price: { id: 'price_business' }, quantity: 1 }] } };
  f.sub('sub_business', business);
  f.sub('sub_addon', { metadata: { tier: 'resume_builder', uficonnect_user_id: A },
    items: { data: [{ price: { id: 'price_resume' }, quantity: 1 }] } });
  await f.service.handleEvent(f.event('evt_business', 'customer.subscription.created', { id: 'sub_business', customer: 'cus_a' }));
  await f.service.handleEvent(f.event('evt_addon', 'customer.subscription.created', { id: 'sub_addon', customer: 'cus_a' }));
  f.sub('sub_business', { ...business, status: 'past_due', latest_invoice: { status: 'open' } });
  await f.service.handleEvent(f.event('evt_failed_business', 'invoice.payment_failed', { subscription: 'sub_business', customer: 'cus_a' }));
  assert.equal((await alice()).plan, 'free'); assert.equal((await alice()).stripe_subscription_id, 'sub_business');
  assert.equal((await alice()).resume_builder_addon, true);
  await assert.rejects(f.service.createCheckout(A, 'business'), { status: 409 });
  f.sub('sub_business', business);
  await f.service.handleEvent(f.event('evt_recovered_business', 'invoice.paid', { subscription: 'sub_business', customer: 'cus_a' }));
  assert.equal((await alice()).plan, 'business'); assert.equal((await alice()).resume_builder_addon, true);
  f.sub('sub_business', { ...business, status: 'canceled' });
  await f.service.handleEvent(f.event('evt_ended_business', 'customer.subscription.deleted', { id: 'sub_business', customer: 'cus_a' }));
  const user = await alice();
  assert.equal(user.plan, 'free'); assert.equal(user.stripe_subscription_id, null);
  assert.equal(user.resume_builder_addon, true); assert.equal(user.resume_builder_subscription_id, 'sub_addon');
});

test('failed reconciliation rolls back its event record so Stripe can retry', async () => {
  const f = setup(); f.sub(); f.session(); f.providerOutage();
  await assert.rejects(f.service.handleEvent(f.event()), /provider outage/);
  assert.equal((await pg.query('SELECT * FROM billing_webhook_events')).rows.length, 0);
  assert.equal((await alice()).plan, 'free');
});

test('simultaneous checkout requests reuse one durable hosted Checkout', async () => {
  const f = setup();
  const results = await Promise.all([f.service.createCheckout(A, 'pro'), f.service.createCheckout(A, 'pro')]);
  assert.equal(results[0].url, results[1].url); assert.equal(f.creates.length, 1);
  assert.equal(f.creates[0].data.line_items[0].price, 'price_pro');
  assert.equal(f.creates[0].data.client_reference_id, A);
  assert.equal(f.creates[0].data.phone_number_collection.enabled, false);
  assert.equal((await f.service.createCheckout(A, 'business')).url, 'https://checkout.stripe.com/cs_2');
  assert.equal(f.sessions.get('cs_1').status, 'expired');
});

test('crash after Stripe accepts Checkout reuses the persisted idempotency key', async () => {
  const f = setup(); f.failWrite();
  await assert.rejects(f.service.createCheckout(A, 'pro'), /simulated DB/);
  assert.equal((await pg.query('SELECT * FROM billing_checkout_attempts')).rows[0].session_id, null);
  const result = await f.service.createCheckout(A, 'pro');
  assert.equal(result.url, 'https://checkout.stripe.com/cs_1');
  assert.equal(f.creates.length, 2);
  assert.equal(f.creates[0].options.idempotencyKey, f.creates[1].options.idempotencyKey);
  assert.equal(f.sessions.size, 1);
});

test('expired checkout starts a new attempt; aged unresolved attempts recover the existing session', async () => {
  const f = setup(); await f.service.createCheckout(A, 'pro');
  f.sessions.get('cs_1').status = 'expired';
  assert.equal((await f.service.createCheckout(A, 'pro')).url, 'https://checkout.stripe.com/cs_2');
  await pg.query("UPDATE billing_checkout_attempts SET session_id=NULL,created_at=NOW()-INTERVAL '25 hours' WHERE user_id=$1", [A]);
  assert.equal((await f.service.createCheckout(A, 'pro')).url, 'https://checkout.stripe.com/cs_2');
  assert.equal(f.creates.length, 2, 'Recovering the accepted session never replays the old key');
});

test('aged checkout without any accepted session rotates only after complete provider history', async () => {
  const f = setup(); f.failWrite();
  await assert.rejects(f.service.createCheckout(A, 'pro'), /simulated DB/);
  const previous = (await pg.query('SELECT * FROM billing_checkout_attempts WHERE user_id=$1', [A])).rows[0];
  f.sessions.clear();
  await pg.query("UPDATE billing_checkout_attempts SET created_at=NOW()-INTERVAL '25 hours' WHERE user_id=$1", [A]);
  const results = await Promise.all([f.service.createCheckout(A, 'business'), f.service.createCheckout(A, 'business')]);
  assert.equal(results[0].url, results[1].url);
  const pending = (await pg.query('SELECT * FROM billing_checkout_attempts WHERE user_id=$1', [A])).rows[0];
  assert.notEqual(pending.attempt_id, previous.attempt_id);
  assert.equal(pending.tier, 'business');
  assert.equal(f.creates.length, 2, 'Only one replacement checkout is opened across simultaneous requests');
  assert.notEqual(f.creates[0].options.idempotencyKey, f.creates[1].options.idempotencyKey);
  assert.equal((await alice()).plan, 'free');
});

test('aged checkout recovers a completed payment instead of starting another purchase', async () => {
  const f = setup(); f.failWrite();
  await assert.rejects(f.service.createCheckout(A, 'pro'), /simulated DB/);
  const pending = (await pg.query('SELECT * FROM billing_checkout_attempts WHERE user_id=$1', [A])).rows[0];
  f.sub();
  f.session('cs_1', 'sub_a', { metadata: { tier: 'pro', uficonnect_user_id: A, uficonnect_attempt_id: pending.attempt_id } });
  // First subscription-list snapshot can lag behind checkout completion.
  f.stripe.subscriptions.list = async function* () {};
  await pg.query("UPDATE billing_checkout_attempts SET created_at=NOW()-INTERVAL '25 hours' WHERE user_id=$1", [A]);
  await assert.rejects(f.service.createCheckout(A, 'pro'), /Checkout is complete/);
  assert.equal((await alice()).plan, 'pro');
  assert.equal((await alice()).stripe_subscription_id, 'sub_a');
  assert.equal(f.creates.length, 1);
});

test('aged checkout stays blocked when provider history fails or another checkout may be payable', async () => {
  for (const scenario of ['outage', 'other_open', 'wrong_owner', 'duplicate_attempt', 'too_much_history']) {
    const f = setup(); f.failWrite();
    await assert.rejects(f.service.createCheckout(A, 'pro'), /simulated DB/);
    const pending = (await pg.query('SELECT * FROM billing_checkout_attempts WHERE user_id=$1', [A])).rows[0];
    await pg.query("UPDATE billing_checkout_attempts SET created_at=NOW()-INTERVAL '25 hours' WHERE user_id=$1", [A]);
    if (scenario === 'outage') f.providerOutage();
    if (scenario === 'other_open') f.sessions.get('cs_1').metadata.uficonnect_attempt_id = 'older-attempt';
    if (scenario === 'wrong_owner') f.sessions.get('cs_1').client_reference_id = B;
    if (scenario === 'duplicate_attempt') f.sessions.set('cs_duplicate', { ...f.sessions.get('cs_1'), id: 'cs_duplicate' });
    if (scenario === 'too_much_history') {
      f.sessions.clear();
      for (let i=0; i<1001; i++) f.session('cs_history_'+i, null, { status: 'expired', payment_status: 'unpaid' });
    }
    await assert.rejects(f.service.createCheckout(A, 'pro'), scenario === 'outage' ? /provider outage/ : { status: 409 });
    const next = (await pg.query('SELECT * FROM billing_checkout_attempts WHERE user_id=$1', [A])).rows[0];
    assert.equal(next.attempt_id, pending.attempt_id, scenario);
    assert.equal(next.session_id, null, scenario);
    assert.equal(f.creates.length, 1, scenario);
    assert.equal((await alice()).plan, 'free', scenario);
    await pg.query('DELETE FROM billing_checkout_attempts WHERE user_id=$1', [A]);
  }
});

test('switching an uncertain checkout recovers its original request before replacing it', async () => {
  const f = setup(); f.failWrite();
  await assert.rejects(f.service.createCheckout(A, 'resume_builder'), /simulated DB/);
  const result = await f.service.createCheckout(A, 'resume_builder_monthly');
  assert.equal(result.url, 'https://checkout.stripe.com/cs_2');
  assert.equal(f.sessions.get('cs_1').status, 'expired');
  assert.equal(f.creates[0].options.idempotencyKey, f.creates[1].options.idempotencyKey);
  assert.deepEqual(f.creates[0].data, f.creates[1].data);
  assert.equal(f.creates.at(-1).data.metadata.tier, 'resume_builder_monthly');
});

test('changing checkout stops if expiry fails or payment wins the race', async () => {
  for (const paid of [false, true]) {
    const f = setup();
    await f.service.createCheckout(A, 'pro');
    f.stripe.checkout.sessions.expire = async id => {
      if (paid) f.sessions.get(id).status = 'complete';
      throw new Error(paid ? 'checkout completed' : 'provider outage');
    };
    await assert.rejects(f.service.createCheckout(A, 'business'));
    assert.equal(f.creates.length, 1, 'No second payable checkout is created');
    await pg.query('DELETE FROM billing_checkout_attempts WHERE user_id=$1', [A]);
  }
});

test('billing rejects invalid tiers and volatile storage before contacting Stripe', async () => {
  const f = setup(); await assert.rejects(f.service.createCheckout(A, 'admin'), { status: 400 });
  f.db.isConnected = () => false;
  await assert.rejects(f.service.createCheckout(A, 'pro'), { status: 503 });
  assert.equal(f.creates.length, 0);
});

test('legacy open checkouts are adopted, but different prices and unrecorded subscriptions cannot be charged twice', async () => {
  const f = setup();
  f.session('cs_legacy', null, { status: 'open', payment_status: 'unpaid',
    line_items: [{ price: 'price_pro', quantity: 1 }], url: 'https://checkout.stripe.com/legacy' });
  assert.equal((await f.service.createCheckout(A, 'pro')).url, 'https://checkout.stripe.com/legacy');
  assert.equal(f.creates.length, 0);
  await pg.query('DELETE FROM billing_checkout_attempts WHERE user_id=$1', [A]);
  f.sessions.get('cs_legacy').line_items[0].price = 'price_retired';
  await f.service.createCheckout(A, 'pro');
  assert.equal(f.sessions.get('cs_legacy').status, 'expired');
  f.sessions.clear(); f.sub();
  await assert.rejects(f.service.createCheckout(A, 'pro'), { status: 409 });
  assert.equal(f.creates.length, 1);
});

test('status and portal use only the authenticated customer; status catches up delayed webhooks', async () => {
  const f = setup(); await f.service.createCheckout(A, 'pro'); f.sub(); f.session('cs_1');
  const status = await f.service.status(A);
  assert.equal(status.plan, 'pro'); assert.equal(status.subscriptions[0].currentPeriodEnd, 1900000000);
  assert.equal(JSON.stringify(status).includes('cus_a'), false);
  assert.equal(JSON.stringify(status).includes('sub_a'), false);
  await f.service.portal(B); assert.deepEqual(f.portalCustomers, ['cus_b']);
  assert.equal((await f.service.status(B)).plan, 'free');
});

test('deletion closes billing, expires open checkout and cancels only managed subscriptions', async () => {
  const f = setup(); await f.service.createCheckout(A, 'pro'); f.sub(); f.sub('sub_b', { customer: 'cus_b', metadata: { uficonnect_user_id: B } });
  await f.service.prepareAccountDeletion(A);
  assert.equal((await alice()).billing_closed, true);
  assert.equal(f.sessions.get('cs_1').status, 'expired');
  assert.equal(f.subscriptions.get('sub_a').status, 'canceled');
  assert.equal(f.subscriptions.get('sub_b').status, 'active');
  await assert.rejects(f.service.createCheckout(A, 'pro'), { status: 409 });
});

test('failed cancellation preserves the account and keeps checkout closed until deletion can retry', async () => {
  const f = setup(); await f.service.createCheckout(A, 'pro'); f.sub(); f.providerOutage();
  await assert.rejects(f.service.prepareAccountDeletion(A), /provider outage/);
  assert.equal((await alice()).billing_closed, true);
  await assert.rejects(f.service.createCheckout(A, 'pro'), { status: 409 });
});

test('actual webhook route rejects invalid and tampered Stripe signatures without leaking payloads', async t => {
  const sdk = require('stripe')('sk_test_fixture');
  const app = await createAppHarness({ env: { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture' }, modules: { stripe: () => ({ webhooks: sdk.webhooks }) } });
  t.after(() => app.close());
  const body = { id: 'evt_signed', type: 'unhandled.event', data: { object: {} } };
  const signature = sdk.webhooks.generateTestHeaderString({ payload: JSON.stringify(body), secret: 'whsec_fixture' });
  assert.equal((await app.request('/billing/webhook', { method: 'POST', body, headers: { 'stripe-signature': signature } })).status, 200);
  assert.equal((await app.request('/billing/webhook', { method: 'POST', body: { ...body, sensitive: 'never-log-this' }, headers: { 'stripe-signature': signature } })).status, 400);
  assert.equal((await app.request('/billing/webhook', { method: 'POST', body })).status, 400);
  assert.equal(app.errors.some(error => error.includes('never-log-this')), false);
});

test('public billing config reports the verified tiered Pro price and authenticated routes reject guests', async t => {
  const price = { id: 'price_pro', type: 'recurring', active: true, currency: 'usd', unit_amount: null,
    billing_scheme: 'tiered', tiers_mode: 'volume', recurring: { interval: 'month', interval_count: 1 },
    tiers: [{ up_to: 1, unit_amount: 1994, flat_amount: null }] };
  const app = await createAppHarness({ connected: true,
    env: { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_PRICE_ID: 'price_pro' },
    modules: { stripe: () => ({ prices: { async retrieve(id, options) { assert.equal(id, 'price_pro'); assert.deepEqual(Array.from(options.expand), ['tiers']); return price; } } }) },
  });
  t.after(() => app.close());
  const config = await app.request('/billing/config');
  assert.equal(config.status, 200); assert.equal(config.data.pricing.pro.display, '$19.94');
  assert.equal(config.data.pricing.pro.unitAmount, 1994); assert.equal(config.data.pricing.pro.interval, 'month');
  assert.equal(config.data.paymentsReady, true); assert.equal(config.data.tiers.pro, true); assert.equal(config.data.tiers.business, false);
  assert.equal(config.headers.get('cache-control'), 'no-store');
  assert.equal((await app.request('/billing/status')).status, 401);
  assert.equal((await app.request('/billing/create-checkout-session', { method: 'POST', body: { tier: 'pro' } })).status, 401);
  assert.equal((await app.request('/billing/create-portal-session', { method: 'POST', body: {} })).status, 401);
});

test('public config enables exact Business prices and both Resume Builder billing cadences', async t => {
  const prices = {
    price_business: { unit_amount: 19994, recurring: { interval: 'month', interval_count: 1 } },
    price_business_team: { unit_amount: 1994, recurring: { interval: 'month', interval_count: 1 } },
    price_resume: { unit_amount: 14994, recurring: { interval: 'month', interval_count: 6 } },
    price_resume_monthly: { unit_amount: 3000, recurring: { interval: 'month', interval_count: 1 } },
  };
  const app = await createAppHarness({ connected: true,
    env: { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
      STRIPE_PRICE_ID_BUSINESS: 'price_business', STRIPE_PRICE_ID_BUSINESS_TEAM: 'price_business_team', STRIPE_RESUME_BUILDER_PRICE_ID: 'price_resume',
      STRIPE_RESUME_BUILDER_MONTHLY_PRICE_ID: 'price_resume_monthly' },
    modules: { stripe: () => ({ prices: { async retrieve(id, options) {
      assert.ok(prices[id]); assert.deepEqual(Array.from(options.expand), ['tiers']);
      return { id, type: 'recurring', active: true, currency: 'usd', ...prices[id] };
    } } }) },
  });
  t.after(() => app.close());
  const config = await app.request('/billing/config');
  assert.equal(config.status, 200); assert.equal(config.data.paymentsReady, true);
  assert.equal(config.data.tiers.pro, false); assert.equal(config.data.tiers.business, true);
  assert.equal(config.data.pricing.business.unitAmount, 19994);
  assert.equal(config.data.tiers.business_team, true);
  assert.equal(config.data.pricing.business_team.unitAmount, 1994);
  assert.equal(config.data.tiers.resume_builder, true);
  assert.equal(config.data.pricing.resume_builder.unitAmount, 14994);
  assert.equal(config.data.pricing.resume_builder.interval, 'month');
  assert.equal(config.data.pricing.resume_builder.intervalCount, 6);
  assert.equal(config.data.pricing.resume_builder.matchesRequiredPrice, true);
  assert.equal(config.data.tiers.resume_builder_monthly, true);
  assert.equal(config.data.pricing.resume_builder_monthly.unitAmount, 3000);
  assert.equal(config.data.pricing.resume_builder_monthly.display, '$30.00');
  assert.equal(config.data.pricing.resume_builder_monthly.interval, 'month');
  assert.equal(config.data.pricing.resume_builder_monthly.intervalCount, 1);
  assert.equal(config.data.pricing.resume_builder_monthly.matchesRequiredPrice, true);
});

test('Resume Builder monthly checkout requires an active fixed USD 30 monthly licensed price', async () => {
  const invalid = [
    { currency: 'eur' }, { unit_amount: 2999 }, { active: false },
    { recurring: { interval: 'year', interval_count: 1 } },
    { recurring: { interval: 'month', interval_count: 6 } },
    { recurring: { interval: 'month', interval_count: 1, usage_type: 'metered' } },
    { transform_quantity: { divide_by: 2, round: 'up' } },
    { billing_scheme: 'tiered', tiers_mode: 'volume', tiers: [{ up_to: null, unit_amount: 3000 }] },
  ];
  for (const override of [{}, ...invalid]) {
    const f = setup();
    const available = Object.keys(override).length === 0;
    const app = await createAppHarness({ connected: true,
      query: (sql, params) => sql.startsWith('SELECT id FROM auth_sessions')
        ? { rows: [{ id: params[0] }] } : pg.query(sql, params),
      env: { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
        STRIPE_RESUME_BUILDER_MONTHLY_PRICE_ID: 'price_resume_monthly' },
      modules: { stripe: () => ({ ...f.stripe, prices: { async retrieve(id) {
        assert.equal(id, 'price_resume_monthly');
        return { id, type: 'recurring', active: true, currency: 'usd', unit_amount: 3000,
          recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }, ...override };
      } } }) },
    });
    try {
      app.seedUser(member(A));
      const config = await app.request('/billing/config');
      assert.equal(config.status, 200);
      assert.equal(config.data.tiers.resume_builder_monthly, available);
      assert.equal(config.data.tiers.resume_builder, false, 'A monthly setting does not silently enable six-month checkout');
      const checkout = await app.request('/billing/create-checkout-session', { method: 'POST', userId: A, body: { tier: 'resume_builder_monthly' } });
      assert.equal(checkout.status, available ? 200 : 503, JSON.stringify(checkout.data));
      assert.equal(f.creates.length, available ? 1 : 0);
      if (available) {
        assert.deepEqual(f.creates[0].data.line_items, [{ price: 'price_resume_monthly', quantity: 1 }]);
        assert.match(f.creates[0].data.success_url, /\/resume-builder\?upgrade=success$/);
        assert.equal((await alice()).resume_builder_addon, false, 'Opening checkout cannot grant unpaid access');
      }
    } finally { await app.close(); }
  }
});

test('Resume Builder choices replace unpaid checkout across concurrent requests and process restarts', async () => {
  const f = setup();
  await Promise.all([f.service.createCheckout(A, 'resume_builder_monthly'), f.service.createCheckout(A, 'resume_builder')]);
  assert.equal([...f.sessions.values()].filter(item => item.status === 'open').length, 1);
  const attempts = (await pg.query('SELECT * FROM billing_checkout_attempts WHERE user_id=$1', [A])).rows;
  assert.equal(attempts.length, 1); assert.equal(attempts[0].slot, 'resume_builder');
  const chosen = attempts[0].tier;
  const other = chosen === 'resume_builder' ? 'resume_builder_monthly' : 'resume_builder';
  const restarted = createBilling({ db: f.db, stripe: f.stripe, getCatalog: async () => f.catalog, frontendBase: 'https://uficonnect.org' });
  await restarted.createCheckout(A, other);
  assert.equal(f.sessions.get(attempts[0].session_id).status, 'expired');
  assert.equal([...f.sessions.values()].filter(item => item.status === 'open').length, 1);
  const changed = (await pg.query('SELECT slot,tier FROM billing_checkout_attempts WHERE user_id=$1', [A])).rows;
  assert.deepEqual(changed, [{ slot: 'resume_builder', tier: other }]);
});

test('monthly Resume Builder payment, cadence changes and cancellation preserve Business and Vault memberships', async () => {
  const f = setup();
  f.sub('sub_business', { metadata: { tier: 'business', uficonnect_user_id: A },
    items: { data: [{ price: { id: 'price_business_team' }, quantity: 3 }] } });
  f.sub('sub_vault', { metadata: { tier: 'vpn_connector', uficonnect_user_id: A },
    items: { data: [{ price: { id: 'price_vpn' }, quantity: 1 }] } });
  for (const id of ['sub_business', 'sub_vault']) {
    await f.service.handleEvent(f.event(`evt_${id}`, 'customer.subscription.created', { id, customer: 'cus_a' }));
  }
  const addon = { metadata: { tier: 'resume_builder_monthly', uficonnect_user_id: A },
    items: { data: [{ price: { id: 'price_resume_monthly' }, quantity: 1 }] } };
  f.sub('sub_resume', { ...addon, latest_invoice: { status: 'open' } });
  await f.service.handleEvent(f.event('evt_resume_unpaid', 'customer.subscription.created', { id: 'sub_resume', customer: 'cus_a' }));
  assert.equal((await alice()).resume_builder_addon, false);
  f.sub('sub_resume', addon);
  await f.service.handleEvent(f.event('evt_resume_paid', 'invoice.paid', { subscription: 'sub_resume', customer: 'cus_a' }));
  assert.equal((await f.service.status(A)).resumeBuilderAddon, true);
  for (const tier of ['resume_builder', 'resume_builder_monthly']) await assert.rejects(f.service.createCheckout(A, tier), { status: 409 });
  // Price changes on the same subscription need not refresh its metadata.
  f.sub('sub_resume', { ...addon, items: { data: [{ price: { id: 'price_resume' }, quantity: 1 }] } });
  await f.service.handleEvent(f.event('evt_resume_cadence', 'customer.subscription.updated', { id: 'sub_resume', customer: 'cus_a' }));
  assert.equal((await alice()).resume_builder_addon, true);
  assert.equal((await alice()).resume_builder_subscription_id, 'sub_resume');
  f.sub('sub_resume', { ...addon, status: 'canceled' });
  await f.service.handleEvent(f.event('evt_resume_cancelled', 'customer.subscription.deleted', { id: 'sub_resume', customer: 'cus_a' }));
  const user = await alice();
  assert.equal(user.resume_builder_addon, false); assert.equal(user.resume_builder_subscription_id, null);
  assert.equal(user.plan, 'business'); assert.equal(user.business_seats, 3);
  assert.equal(user.stripe_subscription_id, 'sub_business');
  assert.equal(user.vpn_connector_addon, true); assert.equal(user.vpn_connector_subscription_id, 'sub_vault');
});

test('signed monthly webhooks reconcile a retired configured price without changing the personal plan', async t => {
  const f = setup();
  await pg.query("UPDATE users SET plan='pro',stripe_subscription_id='sub_personal' WHERE id=$1", [A]);
  const addon = { metadata: { tier: 'resume_builder_monthly', uficonnect_user_id: A },
    items: { data: [{ price: { id: 'price_resume_monthly' }, quantity: 1 }] } };
  f.sub('sub_monthly', addon);
  const sdk = require('stripe')('sk_test_fixture');
  const app = await createAppHarness({ connected: true, query: (sql, params) => pg.query(sql, params),
    env: { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
      STRIPE_PRICE_ID_RESUME_BUILDER_MONTHLY: 'price_resume_monthly' },
    modules: { stripe: () => ({ ...f.stripe, webhooks: sdk.webhooks, prices: { async retrieve(id) {
      return { id, type: 'recurring', active: false, currency: 'usd', unit_amount: 3000,
        recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } };
    } } }) },
  });
  t.after(() => app.close());
  assert.equal((await app.request('/billing/config')).data.tiers.resume_builder_monthly, false);
  const paid = f.event('evt_monthly_signed', 'invoice.paid', { subscription: 'sub_monthly', customer: 'cus_a' });
  const signed = payload => ({ 'stripe-signature': sdk.webhooks.generateTestHeaderString({ payload: JSON.stringify(payload), secret: 'whsec_fixture' }) });
  assert.equal((await app.request('/billing/webhook', { method: 'POST', body: paid })).status, 400);
  assert.equal((await alice()).resume_builder_addon, false);
  assert.equal((await app.request('/billing/webhook', { method: 'POST', body: paid, headers: signed(paid) })).status, 200);
  assert.equal((await alice()).resume_builder_addon, true);
  f.sub('sub_monthly', { ...addon, status: 'canceled' });
  const cancelled = f.event('evt_monthly_cancel_signed', 'customer.subscription.deleted', { id: 'sub_monthly', customer: 'cus_a' });
  assert.equal((await app.request('/billing/webhook', { method: 'POST', body: cancelled, headers: signed(cancelled) })).status, 200);
  const user = await alice();
  assert.equal(user.resume_builder_addon, false); assert.equal(user.resume_builder_subscription_id, null);
  assert.equal(user.plan, 'pro'); assert.equal(user.stripe_subscription_id, 'sub_personal');
});
