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
      async *list({ customer }) { for (const value of sessions.values()) if (value.customer === customer && value.status === 'open') yield value; },
      async expire(id) { if (failProvider) throw new Error('provider outage'); sessions.get(id).status = 'expired'; },
    } },
    subscriptions: {
      async retrieve(id) { if (failProvider) throw new Error('provider outage'); assert.ok(subscriptions.has(id), id); return structuredClone(subscriptions.get(id)); },
      async *list({ customer }) { for (const value of subscriptions.values()) if (value.customer === customer) yield value; },
      async cancel(id, options) { assert.equal(options.prorate, false); assert.equal(options.invoice_now, false); if (failProvider) throw new Error('provider outage'); subscriptions.get(id).status = 'canceled'; },
    },
    billingPortal: { sessions: { async create(data) { portalCustomers.push(data.customer); return { url: 'https://billing.stripe.com/test' }; } } },
  };
  const catalog = { allowedPrices: new Map([['price_pro', 'pro'], ['price_business', 'business'], ['price_resume', 'resume_builder'], ['price_vpn', 'vpn_connector']]),
    tiers: Object.fromEntries([['pro', 'price_pro'], ['business', 'price_business'], ['resume_builder', 'price_resume'], ['vpn_connector', 'price_vpn']].map(([tier, priceId]) => [tier, { available: true, priceId }])) };
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

test('VPN validates USD 3.94 monthly pricing but new checkout stays locked until connection service is ready', async t => {
  for (const override of [{}, { currency: 'eur' }, { unit_amount: 395 }, { active: false }, { recurring: { interval: 'month', interval_count: 2 } }, { recurring: { interval: 'month', interval_count: 1, usage_type: 'metered' } }]) {
    const app = await createAppHarness({ connected: true,
      env: { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_VPN_CONNECTOR_PRICE_ID: 'price_vpn' },
      modules: { stripe: () => ({ prices: { async retrieve() { return { id: 'price_vpn', type: 'recurring', active: true, currency: 'usd', unit_amount: 394, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }, ...override }; } } }) },
    });
    t.after(() => app.close());
    app.seedUser(member('vpn-buyer'));
    const result = await app.request('/billing/config');
    assert.equal(result.status, 200); assert.equal(result.data.tiers.vpn_connector, false);
    assert.equal(result.data.pricing.vpn_connector.matchesRequiredPrice, Object.keys(override).length === 0 || Object.keys(override).every(key => key === 'active'));
    assert.equal(result.data.pricing.vpn_connector.comingSoon, true);
    const checkout = await app.request('/billing/create-checkout-session', { method: 'POST', userId: 'vpn-buyer', body: { tier: 'vpn_connector' } });
    assert.equal(checkout.status, 503); assert.match(checkout.data.message, /coming soon/);
    assert.equal((await app.request('/vault/vpn/locations')).status, 401);
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
  await assert.rejects(f.service.createCheckout(A, 'business'), { status: 409 });
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

test('expired checkout starts a new attempt; aged unresolved attempts fail closed', async () => {
  const f = setup(); await f.service.createCheckout(A, 'pro');
  f.sessions.get('cs_1').status = 'expired';
  assert.equal((await f.service.createCheckout(A, 'pro')).url, 'https://checkout.stripe.com/cs_2');
  await pg.query("UPDATE billing_checkout_attempts SET session_id=NULL,created_at=NOW()-INTERVAL '25 hours' WHERE user_id=$1", [A]);
  await assert.rejects(f.service.createCheckout(A, 'pro'), { status: 409 });
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
  await assert.rejects(f.service.createCheckout(A, 'pro'), { status: 409 });
  f.sessions.clear(); f.sub();
  await assert.rejects(f.service.createCheckout(A, 'pro'), { status: 409 });
  assert.equal(f.creates.length, 0);
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

test('public config enables configured Business and exactly priced six-month Resume Builder', async t => {
  const prices = {
    price_business: { unit_amount: 5994, recurring: { interval: 'month', interval_count: 1 } },
    price_resume: { unit_amount: 14994, recurring: { interval: 'month', interval_count: 6 } },
  };
  const app = await createAppHarness({ connected: true,
    env: { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
      STRIPE_PRICE_ID_BUSINESS: 'price_business', STRIPE_RESUME_BUILDER_PRICE_ID: 'price_resume' },
    modules: { stripe: () => ({ prices: { async retrieve(id, options) {
      assert.ok(prices[id]); assert.deepEqual(Array.from(options.expand), ['tiers']);
      return { id, type: 'recurring', active: true, currency: 'usd', ...prices[id] };
    } } }) },
  });
  t.after(() => app.close());
  const config = await app.request('/billing/config');
  assert.equal(config.status, 200); assert.equal(config.data.paymentsReady, true);
  assert.equal(config.data.tiers.pro, false); assert.equal(config.data.tiers.business, true);
  assert.equal(config.data.pricing.business.unitAmount, 5994);
  assert.equal(config.data.tiers.resume_builder, true);
  assert.equal(config.data.pricing.resume_builder.unitAmount, 14994);
  assert.equal(config.data.pricing.resume_builder.interval, 'month');
  assert.equal(config.data.pricing.resume_builder.intervalCount, 6);
  assert.equal(config.data.pricing.resume_builder.matchesRequiredPrice, true);
});
