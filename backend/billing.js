const { randomUUID } = require('node:crypto');

// Store identifiers and reconciliation outcomes only, never Stripe payloads,
// payment credentials, card numbers, CVCs, or billing addresses.
const BILLING_SCHEMA = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_closed BOOLEAN NOT NULL DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS billing_webhook_events (
    event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL,
    outcome TEXT NOT NULL, processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS billing_checkout_attempts (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slot TEXT NOT NULL CHECK (slot IN ('plan', 'resume_builder')),
    attempt_id UUID NOT NULL, tier TEXT NOT NULL, price_id TEXT NOT NULL,
    customer_id TEXT NOT NULL, session_id TEXT, return_base TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (user_id, slot)
  )`,
];
const EVENT_TYPES = new Set([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'customer.subscription.created',
  'customer.subscription.updated', 'customer.subscription.deleted',
  'customer.subscription.paused', 'customer.subscription.resumed',
  'invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required',
]);
const TIERS = ['pro', 'business', 'resume_builder'];
const ACTIVE = new Set(['active', 'trialing']);
const ENDED = new Set(['canceled', 'incomplete_expired']);
const idOf = value => typeof value === 'string' ? value : value?.id;
const fault = (status, message) => Object.assign(new Error(message), { status });

function validRecurringPrice(price) {
  return !!price && typeof price.id === 'string' && price.type === 'recurring'
    && !price.transform_quantity && (!price.recurring?.usage_type || price.recurring.usage_type === 'licensed')
    && Number.isInteger(quantityOneAmount(price)) && quantityOneAmount(price) > 0
    && /^[a-z]{3}$/i.test(price.currency || '')
    && ['day', 'week', 'month', 'year'].includes(price.recurring?.interval)
    && Number.isInteger(price.recurring?.interval_count) && price.recurring.interval_count > 0;
}

function quantityOneAmount(price) {
  if (price?.billing_scheme !== 'tiered') return price?.unit_amount;
  if (price.transform_quantity || !['volume', 'graduated'].includes(price.tiers_mode)) return null;
  const firstTier = price.tiers?.find(tier => tier.up_to === null || Number(tier.up_to) >= 1);
  if (!firstTier) return null;
  const unit = firstTier.unit_amount ?? (firstTier.unit_amount_decimal == null || firstTier.unit_amount_decimal === '0' ? 0 : null);
  const flat = firstTier.flat_amount ?? (firstTier.flat_amount_decimal == null || firstTier.flat_amount_decimal === '0' ? 0 : null);
  return Number.isInteger(unit) && Number.isInteger(flat) ? unit + flat : null;
}

function createBilling({ db, stripe, getCatalog, frontendBase, onUserUpdated = () => {} }) {
  const available = () => {
    if (!stripe) throw fault(503, 'Billing is not configured yet.');
    if (!db.isConnected()) throw fault(503, 'Billing persistence is temporarily unavailable.');
  };
  async function transaction(work) {
    return db.withClient(async client => {
      await client.query('BEGIN');
      try {
        const value = await work(client);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }
  async function lockUser(client, id, byCustomer = false) {
    const { rows } = await client.query(`SELECT * FROM users WHERE ${byCustomer ? 'stripe_customer_id' : 'id'}=$1 FOR UPDATE`, [id]);
    return rows[0];
  }
  function checkOwner(object, row, session = false) {
    return idOf(object.customer) === row.stripe_customer_id
      && (!object.metadata?.uficonnect_user_id || object.metadata.uficonnect_user_id === row.id)
      && (!session || object.client_reference_id === row.id);
  }
  function tierFor(subscription, catalog) {
    const items = subscription.items?.data || [];
    if (items.length !== 1 || items[0].quantity !== 1) return null;
    return catalog.allowedPrices.get(idOf(items[0].price)) || null;
  }
  const readSubscription = id => stripe.subscriptions.retrieve(id, { expand: ['latest_invoice'] });
  async function applySubscription(client, row, subscription, catalog, { allowLink = false } = {}) {
    if (!checkOwner(subscription, row)) return 'customer_mismatch';
    const tier = tierFor(subscription, catalog);
    const knownPlan = row.stripe_subscription_id === subscription.id;
    const knownAddon = row.resume_builder_subscription_id === subscription.id;
    if (!knownPlan && !knownAddon && (!allowLink || !tier)) return 'unlinked_subscription';
    const addon = knownAddon || (!knownPlan && tier === 'resume_builder');
    if ((knownPlan && tier === 'resume_builder') || (knownAddon && tier && tier !== 'resume_builder')) return 'wrong_subscription_kind';
    const current = addon ? row.resume_builder_subscription_id : row.stripe_subscription_id;
    // A delayed checkout/cancellation for an old subscription must never
    // replace or revoke the newer subscription in the same membership slot.
    if (current && current !== subscription.id) return 'different_subscription';
    const invoice = typeof subscription.latest_invoice === 'string'
      ? await stripe.invoices.retrieve(subscription.latest_invoice) : subscription.latest_invoice;
    const paid = subscription.status === 'trialing' || invoice?.status === 'paid';
    const active = !row.billing_closed && !!tier && ACTIVE.has(subscription.status) && paid;
    const linkedId = ENDED.has(subscription.status) ? null : subscription.id;
    let result;
    if (addon) {
      result = await client.query('UPDATE users SET resume_builder_addon=$1, resume_builder_subscription_id=$2 WHERE id=$3 RETURNING *', [active, linkedId, row.id]);
    } else {
      result = await client.query('UPDATE users SET plan=$1, stripe_subscription_id=$2 WHERE id=$3 RETURNING *', [active ? tier : 'free', linkedId, row.id]);
    }
    Object.assign(row, result.rows[0]);
    return tier ? 'reconciled' : 'unsupported_price';
  }
  async function reconcileSession(client, row, session, catalog) {
    if (session.mode !== 'subscription' || !checkOwner(session, row, true)) return 'customer_mismatch';
    if (session.status !== 'complete' || !['paid', 'no_payment_required'].includes(session.payment_status)) return 'payment_pending';
    const subId = idOf(session.subscription);
    if (!subId) return 'missing_subscription';
    const subscription = await readSubscription(subId);
    return applySubscription(client, row, subscription, catalog, { allowLink: true });
  }
  async function handleEvent(event) {
    if (!EVENT_TYPES.has(event.type)) return { received: true, ignored: true };
    available();
    if (!event.id || !event.data?.object) throw fault(400, 'Invalid billing event.');
    const object = event.data.object;
    const catalog = await getCatalog();
    let updated;
    const result = await transaction(async client => {
      // Lock first, then retrieve current Stripe state. This also serializes
      // different event IDs for the same customer across API workers.
      const customer = idOf(object.customer);
      const row = customer ? await lockUser(client, customer, true) : null;
      const inserted = await client.query(`INSERT INTO billing_webhook_events(event_id,event_type,outcome)
        VALUES ($1,$2,'processing') ON CONFLICT (event_id) DO NOTHING RETURNING event_id`, [event.id, event.type]);
      if (!inserted.rows.length) return { received: true, duplicate: true };
      let outcome = 'unknown_customer';
      if (row) {
        if (event.type.startsWith('checkout.session.')) {
          const session = await stripe.checkout.sessions.retrieve(object.id);
          outcome = await reconcileSession(client, row, session, catalog);
        } else {
          const subscriptionId = event.type.startsWith('customer.subscription.') ? object.id
            : idOf(object.subscription) || idOf(object.parent?.subscription_details?.subscription);
          if (subscriptionId) {
            const subscription = await readSubscription(subscriptionId);
            // A created event can arrive before checkout completion. Only a
            // server-tagged subscription on its persisted customer may link.
            outcome = await applySubscription(client, row, subscription, catalog, {
              allowLink: subscription.metadata?.uficonnect_user_id === row.id,
            });
          } else outcome = 'unrelated_invoice';
        }
        updated = row;
      }
      await client.query('UPDATE billing_webhook_events SET outcome=$1 WHERE event_id=$2', [outcome, event.id]);
      return { received: true };
    });
    if (updated) onUserUpdated(updated);
    return result;
  }
  async function getOrCreateCustomer(client, row) {
    if (row.stripe_customer_id) {
      const current = await stripe.customers.retrieve(row.stripe_customer_id);
      if (!current.deleted) {
        if (current.metadata?.uficonnect_user_id && current.metadata.uficonnect_user_id !== row.id) throw fault(409, 'Billing account ownership needs review.');
        return row.stripe_customer_id;
      }
    }
    const created = await stripe.customers.create({
      email: row.email, name: row.name || undefined,
      metadata: { uficonnect_user_id: row.id },
    }, { idempotencyKey: `ufi-customer:${row.id}:${row.stripe_customer_id || 'initial'}` });
    const { rows } = await client.query('UPDATE users SET stripe_customer_id=$1 WHERE id=$2 RETURNING *', [created.id, row.id]);
    Object.assign(row, rows[0]);
    return created.id;
  }
  function checkCheckoutAllowed(row, addon) {
    if (!row) throw fault(404, 'Profile record not found.');
    if (row.billing_closed) throw fault(409, 'Billing is closed while account deletion is being completed.');
    if (addon ? row.resume_builder_addon || row.resume_builder_subscription_id
      : ['pro', 'business'].includes(row.plan) || row.stripe_subscription_id) {
      throw fault(409, 'A subscription already exists. Use Manage billing to update it or recover a failed payment.');
    }
  }
  async function createCheckout(userId, tier) {
    if (!TIERS.includes(tier)) throw fault(400, 'Choose a valid subscription tier.');
    available();
    const catalog = await getCatalog();
    const priceId = catalog.tiers[tier]?.available && catalog.tiers[tier].priceId;
    if (!priceId) throw fault(503, 'This subscription is not available yet.');
    const slot = tier === 'resume_builder' ? tier : 'plan';
    // Persist the attempt BEFORE the remote API call. A crash after Stripe
    // accepts a request reuses this key, including on a different API worker.
    await transaction(async client => {
      const row = await lockUser(client, userId);
      checkCheckoutAllowed(row, slot === 'resume_builder');
      const customer = await getOrCreateCustomer(client, row);
      const { rows: priorAttempts } = await client.query('SELECT * FROM billing_checkout_attempts WHERE user_id=$1 AND slot=$2', [userId, slot]);
      // Covers subscriptions and open checkouts created before the durable
      // attempt table was introduced, or before an initial webhook arrived.
      for await (const existing of stripe.subscriptions.list({ customer, status: 'all', limit: 100 })) {
        const existingTier = tierFor(existing, catalog);
        if (!ENDED.has(existing.status) && existingTier && (existingTier === 'resume_builder') === (slot === 'resume_builder')) {
          throw fault(409, 'A subscription already exists. Use Manage billing to update it or recover a failed payment.');
        }
      }
      let legacySession = null;
      if (!priorAttempts.length) {
        for await (const existing of stripe.checkout.sessions.list({ customer, status: 'open', limit: 100 })) {
          if (existing.client_reference_id === row.id && existing.mode === 'subscription'
            && TIERS.includes(existing.metadata?.tier)
            && (existing.metadata.tier === 'resume_builder') === (slot === 'resume_builder')) {
            const items = await stripe.checkout.sessions.listLineItems(existing.id, { limit: 2 });
            if (existing.metadata.tier !== tier || items.data.length !== 1
              || items.data[0].quantity !== 1 || idOf(items.data[0].price) !== priceId) {
              throw fault(409, 'An existing checkout is open for another plan or price. Finish it or wait for it to expire before changing plans.');
            }
            legacySession = existing.id;
            break;
          }
        }
      }
      await client.query(`INSERT INTO billing_checkout_attempts(user_id,slot,attempt_id,tier,price_id,customer_id,return_base)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (user_id,slot) DO NOTHING`,
      [row.id, slot, randomUUID(), tier, priceId, customer, frontendBase]);
      if (legacySession) await client.query('UPDATE billing_checkout_attempts SET session_id=$1 WHERE user_id=$2 AND slot=$3 AND session_id IS NULL', [legacySession, row.id, slot]);
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      let renewed = false;
      let changed;
      const session = await transaction(async client => {
        const row = await lockUser(client, userId);
        checkCheckoutAllowed(row, slot === 'resume_builder');
        const { rows: [pending] } = await client.query('SELECT * FROM billing_checkout_attempts WHERE user_id=$1 AND slot=$2 FOR UPDATE', [userId, slot]);
        if (!pending || pending.customer_id !== row.stripe_customer_id) throw fault(409, 'Billing account changed. Please contact support.');
        if (pending.session_id) {
          const existing = await stripe.checkout.sessions.retrieve(pending.session_id);
          if (!checkOwner(existing, row, true)) throw fault(409, 'Checkout ownership needs review.');
          if (existing.status === 'complete') {
            await reconcileSession(client, row, existing, catalog);
            changed = row;
            return { complete: true };
          }
          if (existing.status === 'open') {
            if (pending.tier !== tier || pending.price_id !== priceId) throw fault(409, 'An existing checkout is open for another plan. Finish it or wait for it to expire before changing plans.');
            return existing;
          }
          if (existing.status !== 'expired') throw fault(409, 'Checkout status needs review.');
          await client.query(`UPDATE billing_checkout_attempts SET attempt_id=$1,tier=$2,price_id=$3,
            session_id=NULL,return_base=$4,created_at=NOW() WHERE user_id=$5 AND slot=$6`,
          [randomUUID(), tier, priceId, frontendBase, userId, slot]);
          renewed = true;
          return null;
        }
        // Stripe may prune idempotency keys after 24 hours. An unresolved
        // older attempt needs reconciliation, never a speculative new charge.
        if (Date.now() - new Date(pending.created_at).getTime() >= 23 * 3600000) throw fault(409, 'An earlier checkout needs reconciliation. Please contact support before starting another payment.');
        if (pending.tier !== tier || pending.price_id !== priceId) throw fault(409, 'An earlier checkout is pending for another plan.');
        const path = slot === 'resume_builder' ? '/resume-builder' : '/settings';
        const created = await stripe.checkout.sessions.create({
          mode: 'subscription', customer: pending.customer_id,
          line_items: [{ price: pending.price_id, quantity: 1 }],
          metadata: { tier, uficonnect_user_id: userId, uficonnect_attempt_id: pending.attempt_id },
          subscription_data: { metadata: { tier, uficonnect_user_id: userId } },
          phone_number_collection: { enabled: false }, client_reference_id: userId,
          success_url: `${pending.return_base}${path}?upgrade=success`,
          cancel_url: `${pending.return_base}${path}?upgrade=cancelled`,
        }, { idempotencyKey: `ufi-checkout:${pending.attempt_id}` });
        await client.query('UPDATE billing_checkout_attempts SET session_id=$1 WHERE user_id=$2 AND slot=$3', [created.id, userId, slot]);
        return created;
      });
      if (changed) onUserUpdated(changed);
      if (renewed) continue;
      if (session.complete) throw fault(409, 'Checkout is complete. Refresh your membership status or use Manage billing.');
      if (!session.url?.startsWith('https://checkout.stripe.com/')) throw fault(502, 'The payment provider did not return a hosted checkout.');
      return { url: session.url };
    }
    throw fault(409, 'Please retry checkout.');
  }
  async function status(userId) {
    available();
    const catalog = await getCatalog();
    let updated;
    const result = await transaction(async client => {
      const row = await lockUser(client, userId);
      if (!row) throw fault(404, 'Profile record not found.');
      const { rows: attempts } = await client.query('SELECT * FROM billing_checkout_attempts WHERE user_id=$1', [userId]);
      for (const attempt of attempts) {
        if (attempt.session_id && !(attempt.slot === 'plan' ? row.stripe_subscription_id : row.resume_builder_subscription_id)) {
          await reconcileSession(client, row, await stripe.checkout.sessions.retrieve(attempt.session_id), catalog);
        }
      }
      const subscriptions = [];
      for (const [kind, subId] of [['plan', row.stripe_subscription_id], ['resume_builder', row.resume_builder_subscription_id]]) {
        if (!subId) continue;
        const sub = await readSubscription(subId);
        if (!checkOwner(sub, row)) throw fault(409, 'Billing account ownership needs review.');
        await applySubscription(client, row, sub, catalog);
        subscriptions.push({ kind, tier: tierFor(sub, catalog), status: sub.status,
          cancelAtPeriodEnd: sub.cancel_at_period_end === true,
          currentPeriodEnd: sub.current_period_end || sub.items?.data?.[0]?.current_period_end || null });
      }
      updated = row;
      return { plan: row.plan || 'free', resumeBuilderAddon: !!row.resume_builder_addon,
        hasBillingAccount: !!row.stripe_customer_id, subscriptions,
        paymentProvider: 'stripe', management: 'hosted_portal' };
    });
    onUserUpdated(updated);
    return result;
  }
  async function portal(userId) {
    available();
    const { rows: [row] } = await db.query('SELECT * FROM users WHERE id=$1', [userId]);
    if (!row?.stripe_customer_id) throw fault(400, 'No billing account found.');
    const customer = await stripe.customers.retrieve(row.stripe_customer_id);
    if (customer.deleted || (customer.metadata?.uficonnect_user_id && customer.metadata.uficonnect_user_id !== row.id)) throw fault(409, 'Billing account ownership needs review.');
    const session = await stripe.billingPortal.sessions.create({ customer: row.stripe_customer_id, return_url: `${frontendBase}/settings` });
    return { url: session.url };
  }
  async function prepareAccountDeletion(userId) {
    // Close billing durably before external cancellation so concurrent
    // checkout requests cannot create a new subscription during deletion.
    if (!db.isConnected()) throw fault(503, 'Billing persistence is temporarily unavailable.');
    const row = await transaction(async client => {
      const user = await lockUser(client, userId);
      if (!user) return null;
      await client.query('UPDATE users SET billing_closed=true WHERE id=$1', [userId]);
      return user;
    });
    if (!row?.stripe_customer_id) return;
    if (!stripe) throw fault(503, 'Billing must be available to cancel subscriptions before deleting this account.');
    const customer = row.stripe_customer_id;
    const owner = await stripe.customers.retrieve(customer);
    if (owner.metadata?.uficonnect_user_id && owner.metadata.uficonnect_user_id !== userId) throw fault(409, 'Billing account ownership needs review before deletion.');
    if (owner.deleted) return;
    for await (const session of stripe.checkout.sessions.list({ customer, status: 'open', limit: 100 })) {
      if (session.client_reference_id === userId) await stripe.checkout.sessions.expire(session.id);
    }
    for await (const sub of stripe.subscriptions.list({ customer, status: 'all', limit: 100 })) {
      if (sub.metadata?.uficonnect_user_id === userId || [row.stripe_subscription_id, row.resume_builder_subscription_id].includes(sub.id)) {
        if (!ENDED.has(sub.status)) await stripe.subscriptions.cancel(sub.id, { prorate: false, invoice_now: false });
      }
    }
  }
  return { handleEvent, createCheckout, status, portal, prepareAccountDeletion };
}

module.exports = { BILLING_SCHEMA, EVENT_TYPES, TIERS, quantityOneAmount, validRecurringPrice, createBilling };
