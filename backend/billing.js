const { randomUUID } = require('node:crypto');
const { isDeliverableEmail } = require('./auth-signin');

// Store identifiers and reconciliation outcomes only, never Stripe payloads,
// payment credentials, card numbers, CVCs, or billing addresses.
const BILLING_SCHEMA = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_closed BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS business_seats INTEGER NOT NULL DEFAULT 0 CHECK (business_seats BETWEEN 0 AND 100)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS vpn_connector_addon BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS vpn_connector_subscription_id TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_vpn_connector_sub_idx ON users(vpn_connector_subscription_id) WHERE vpn_connector_subscription_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS vault_vpn_locations (
    id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('windows','linux','ios','android')),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    country TEXT NOT NULL CHECK (length(country) BETWEEN 1 AND 80)
  )`,
  `CREATE INDEX IF NOT EXISTS vault_vpn_locations_user_idx ON vault_vpn_locations(user_id)`,
  `CREATE TABLE IF NOT EXISTS billing_webhook_events (
    event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL,
    outcome TEXT NOT NULL, processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS billing_checkout_attempts (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slot TEXT NOT NULL CHECK (slot IN ('plan', 'resume_builder', 'vpn_connector')),
    attempt_id UUID NOT NULL, tier TEXT NOT NULL, price_id TEXT NOT NULL,
    customer_id TEXT NOT NULL, session_id TEXT, return_base TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (user_id, slot)
  )`,
  // One table lock covers the complete upgrade when API/pipeline workers start
  // together; separate DROP and ADD statements can race between processes.
  `ALTER TABLE billing_checkout_attempts
    DROP CONSTRAINT IF EXISTS billing_checkout_attempts_slot_check,
    ADD CONSTRAINT billing_checkout_attempts_slot_check CHECK (slot IN ('plan', 'resume_builder', 'vpn_connector'))`,
  `ALTER TABLE billing_checkout_attempts ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 100)`,
];
const EVENT_TYPES = new Set([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'customer.subscription.created',
  'customer.subscription.updated', 'customer.subscription.deleted',
  'customer.subscription.paused', 'customer.subscription.resumed',
  'invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required',
]);
const TIERS = ['pro', 'business', 'resume_builder', 'resume_builder_monthly', 'vpn_connector'];
const SLOTS = { plan: 'stripe_subscription_id', resume_builder: 'resume_builder_subscription_id', vpn_connector: 'vpn_connector_subscription_id' };
const slotFor = tier => tier === 'resume_builder_monthly' ? 'resume_builder'
  : ['resume_builder', 'vpn_connector'].includes(tier) ? tier : 'plan';
const ACTIVE = new Set(['active', 'trialing']);
const ENDED = new Set(['canceled', 'incomplete_expired']);
const RENEWALS = new Set(['subscription_cycle', 'subscription_update', 'subscription_threshold']);
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
    if (items.length !== 1) return null;
    const tier = catalog.allowedPrices.get(idOf(items[0].price));
    const quantity = items[0].quantity;
    if (tier === 'business_team') return Number.isInteger(quantity) && quantity >= 2 && quantity <= 100 ? 'business' : null;
    return quantity === 1 ? tier || null : null;
  }
  const readSubscription = id => stripe.subscriptions.retrieve(id, { expand: ['latest_invoice'] });
  async function hasPaidInvoice(subscription) {
    if (subscription.status === 'trialing') return true;
    const invoice = typeof subscription.latest_invoice === 'string'
      ? await stripe.invoices.retrieve(subscription.latest_invoice) : subscription.latest_invoice;
    // Stripe opens each renewal as a draft or open invoice while the
    // subscription stays active; a failed renewal moves it to past_due. Only a
    // first invoice (or an invoice sent for manual payment) must be paid first.
    const renewing = subscription.status === 'active' && subscription.collection_method !== 'send_invoice'
      && ['draft', 'open'].includes(invoice?.status) && RENEWALS.has(invoice?.billing_reason);
    return subscription.status === 'trialing' || invoice?.status === 'paid' || renewing;
  }
  async function applySubscription(client, row, subscription, catalog, { allowLink = false } = {}) {
    if (!checkOwner(subscription, row)) return 'customer_mismatch';
    const tier = tierFor(subscription, catalog);
    const knownSlot = Object.keys(SLOTS).find(slot => row[SLOTS[slot]] === subscription.id);
    if (!knownSlot && (!allowLink || !tier)) return 'unlinked_subscription';
    const slot = knownSlot || slotFor(tier);
    const wrongKind = knownSlot && tier && knownSlot !== slotFor(tier);
    const current = row[SLOTS[slot]];
    // A delayed checkout/cancellation for an old subscription must never
    // replace or revoke the newer subscription in the same membership slot.
    if (current && current !== subscription.id) return 'different_subscription';
    const paid = await hasPaidInvoice(subscription);
    const active = !row.billing_closed && !!tier && !wrongKind && ACTIVE.has(subscription.status) && paid;
    const linkedId = ENDED.has(subscription.status) ? null : subscription.id;
    let result;
    if (slot === 'vpn_connector') {
      result = await client.query('UPDATE users SET vpn_connector_addon=$1, vpn_connector_subscription_id=$2 WHERE id=$3 RETURNING *', [active, linkedId, row.id]);
    } else if (slot === 'resume_builder') {
      result = await client.query('UPDATE users SET resume_builder_addon=$1, resume_builder_subscription_id=$2 WHERE id=$3 RETURNING *', [active, linkedId, row.id]);
    } else {
      let plan = active ? tier : 'free';
      let seats = active && tier === 'business' ? subscription.items.data[0].quantity : 0;
      if (active && tier === 'business' && (row.plan !== 'business' || seats > row.business_seats) && subscription.status !== 'trialing') {
        const invoice = typeof subscription.latest_invoice === 'string'
          ? await stripe.invoices.retrieve(subscription.latest_invoice) : subscription.latest_invoice;
        // An active subscription can have an open proration invoice while a
        // portal upgrade is awaiting payment. Keep the previously paid plan
        // and seats until the invoice confirms the expanded membership.
        if (invoice?.status !== 'paid') { plan = row.plan || 'free'; seats = row.business_seats || 0; }
      }
      result = await client.query('UPDATE users SET plan=$1, stripe_subscription_id=$2, business_seats=$4 WHERE id=$3 RETURNING *', [plan, linkedId, row.id, seats]);
    }
    Object.assign(row, result.rows[0]);
    return wrongKind ? 'wrong_subscription_kind' : tier ? 'reconciled' : 'unsupported_price';
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
      ...(!row.email_is_placeholder && isDeliverableEmail(row.email) ? { email: row.email } : {}), name: row.name || undefined,
      metadata: { uficonnect_user_id: row.id },
    }, { idempotencyKey: `ufi-customer:${row.id}:${row.stripe_customer_id || 'initial'}` });
    const { rows } = await client.query('UPDATE users SET stripe_customer_id=$1 WHERE id=$2 RETURNING *', [created.id, row.id]);
    Object.assign(row, rows[0]);
    return created.id;
  }
  function checkCheckoutAllowed(row, slot) {
    if (!row) throw fault(404, 'Profile record not found.');
    if (row.billing_closed) throw fault(409, 'Billing is closed while account deletion is being completed.');
    if (row[SLOTS[slot]] || (slot === 'plan' ? ['pro', 'business'].includes(row.plan) : row[`${slot}_addon`])) {
      throw fault(409, 'A subscription already exists. Use Manage billing to update it or recover a failed payment.');
    }
  }
  async function recoverUnresolvedCheckout(client, row, pending, catalog) {
    let recovered = null;
    let inspected = 0;
    // Use the complete customer list, not eventually consistent metadata
    // search. A missing local session ID can mean Stripe accepted the request
    // before the response/database write failed. Never replay an expired key.
    for await (const session of stripe.checkout.sessions.list({ customer: pending.customer_id, limit: 100 })) {
      if (++inspected > 1000) throw fault(409, 'Checkout history needs review. Please contact support.');
      if (session.metadata?.uficonnect_attempt_id === pending.attempt_id) {
        if (recovered || session.mode !== 'subscription' || !checkOwner(session, row, true)) {
          throw fault(409, 'Checkout ownership needs review.');
        }
        recovered = session;
        continue;
      }
      if (session.mode !== 'subscription' || session.status === 'expired') continue;
      // An older checkout without attempt metadata may still be payable.
      // Resolve its actual price before deciding it belongs to another slot.
      const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 2 });
      const otherTier = items.data.length === 1 && !items.has_more
        ? catalog.allowedPrices.get(idOf(items.data[0].price)) : null;
      if (otherTier && slotFor(otherTier) !== pending.slot) continue;
      if (session.status === 'complete' && idOf(session.subscription)) {
        const subscription = await readSubscription(idOf(session.subscription));
        if (checkOwner(subscription, row) && ENDED.has(subscription.status)) continue;
      }
      throw fault(409, 'Another checkout or subscription needs review. Check billing status or use Manage billing.');
    }
    if (recovered) {
      await client.query('UPDATE billing_checkout_attempts SET session_id=$1 WHERE user_id=$2 AND slot=$3', [recovered.id, row.id, pending.slot]);
      pending.session_id = recovered.id;
      return;
    }
    // Check subscriptions again under this row lock before rotating a key.
    // This covers a completed payment whose webhook has not reached us yet.
    inspected = 0;
    for await (const subscription of stripe.subscriptions.list({ customer: pending.customer_id, status: 'all', limit: 100 })) {
      if (++inspected > 1000) throw fault(409, 'Subscription history needs review. Please contact support.');
      const tier = tierFor(subscription, catalog);
      if (!ENDED.has(subscription.status) && (!tier || slotFor(tier) === pending.slot)) {
        throw fault(409, 'A subscription already exists. Use Manage billing to update it or recover a failed payment.');
      }
    }
    // Exhaustive successful provider reads prove no accepted/payable checkout
    // remains. Keep the caller's transaction/row lock while replacing the key.
  }
  async function createCheckout(userId, tier, quantity = 1) {
    if (!TIERS.includes(tier)) throw fault(400, 'Choose a valid subscription tier.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100 || (tier !== 'business' && quantity !== 1)) {
      throw fault(400, 'Business supports 1 to 100 people. Other memberships are for one person.');
    }
    available();
    const catalog = await getCatalog();
    const priceTier = tier === 'business' && quantity >= 2 ? 'business_team' : tier;
    const priceId = catalog.tiers[priceTier]?.available && catalog.tiers[priceTier].priceId;
    if (!priceId) throw fault(503, catalog.tiers[priceTier]?.unavailableMessage || 'This subscription is not available yet.');
    const slot = slotFor(tier);
    // Persist the attempt BEFORE the remote API call. A crash after Stripe
    // accepts a request reuses this key, including on a different API worker.
    await transaction(async client => {
      const row = await lockUser(client, userId);
      checkCheckoutAllowed(row, slot);
      const customer = await getOrCreateCustomer(client, row);
      const { rows: priorAttempts } = await client.query('SELECT * FROM billing_checkout_attempts WHERE user_id=$1 AND slot=$2', [userId, slot]);
      // Covers subscriptions and open checkouts created before the durable
      // attempt table was introduced, or before an initial webhook arrived.
      for await (const existing of stripe.subscriptions.list({ customer, status: 'all', limit: 100 })) {
        const existingTier = tierFor(existing, catalog);
        if (!ENDED.has(existing.status) && existingTier && slotFor(existingTier) === slot) {
          throw fault(409, 'A subscription already exists. Use Manage billing to update it or recover a failed payment.');
        }
      }
      let legacySession = null;
      if (!priorAttempts.length) {
        for await (const existing of stripe.checkout.sessions.list({ customer, status: 'open', limit: 100 })) {
          if (existing.client_reference_id === row.id && existing.mode === 'subscription'
            && TIERS.includes(existing.metadata?.tier)
            && slotFor(existing.metadata.tier) === slot) {
            const items = await stripe.checkout.sessions.listLineItems(existing.id, { limit: 2 });
            if (existing.metadata.tier !== tier || items.data.length !== 1
              || items.data[0].quantity !== quantity || idOf(items.data[0].price) !== priceId) {
              if (!checkOwner(existing, row, true)) throw fault(409, 'Checkout ownership needs review.');
              await stripe.checkout.sessions.expire(existing.id);
              const expired = await stripe.checkout.sessions.retrieve(existing.id);
              if (expired.status !== 'expired') throw fault(409, 'The previous checkout could not be closed. Refresh your membership status.');
              continue;
            }
            legacySession = existing.id;
            break;
          }
        }
      }
      await client.query(`INSERT INTO billing_checkout_attempts(user_id,slot,attempt_id,tier,price_id,customer_id,return_base,quantity)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (user_id,slot) DO NOTHING`,
      [row.id, slot, randomUUID(), tier, priceId, customer, frontendBase, quantity]);
      if (legacySession) await client.query('UPDATE billing_checkout_attempts SET session_id=$1 WHERE user_id=$2 AND slot=$3 AND session_id IS NULL', [legacySession, row.id, slot]);
    });
    let recoveredRejectedAttempt = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      let renewed = false;
      let changed;
      const session = await transaction(async client => {
        const row = await lockUser(client, userId);
        checkCheckoutAllowed(row, slot);
        const { rows: [pending] } = await client.query('SELECT * FROM billing_checkout_attempts WHERE user_id=$1 AND slot=$2 FOR UPDATE', [userId, slot]);
        if (!pending || pending.customer_id !== row.stripe_customer_id) throw fault(409, 'Billing account changed. Please contact support.');
        if (!pending.session_id && Date.now() - new Date(pending.created_at).getTime() >= 23 * 3600000) {
          await recoverUnresolvedCheckout(client, row, pending, catalog);
          if (!pending.session_id) {
            await client.query(`UPDATE billing_checkout_attempts SET attempt_id=$1,tier=$2,price_id=$3,
              session_id=NULL,return_base=$4,created_at=NOW(),quantity=$7 WHERE user_id=$5 AND slot=$6`,
            [randomUUID(), tier, priceId, frontendBase, userId, slot, quantity]);
            renewed = true;
            return null;
          }
        }
        if (pending.session_id) {
          let existing = await stripe.checkout.sessions.retrieve(pending.session_id);
          if (!checkOwner(existing, row, true)) throw fault(409, 'Checkout ownership needs review.');
          if (existing.status === 'complete') {
            await reconcileSession(client, row, existing, catalog);
            changed = row;
            return { complete: true };
          }
          if (existing.status === 'open') {
            if (pending.tier === tier && pending.price_id === priceId && pending.quantity === quantity) return existing;
            // Close the unpaid checkout before creating a different option.
            // A completion race or provider failure stops here, so two links
            // can never remain payable for the same membership slot.
            await stripe.checkout.sessions.expire(existing.id);
            existing = await stripe.checkout.sessions.retrieve(existing.id);
          }
          if (existing.status !== 'expired') throw fault(409, 'Checkout status needs review.');
          await client.query(`UPDATE billing_checkout_attempts SET attempt_id=$1,tier=$2,price_id=$3,
            session_id=NULL,return_base=$4,created_at=NOW(),quantity=$7 WHERE user_id=$5 AND slot=$6`,
          [randomUUID(), tier, priceId, frontendBase, userId, slot, quantity]);
          renewed = true;
          return null;
        }
        const changedSelection = pending.tier !== tier || pending.price_id !== priceId || pending.quantity !== quantity;
        const path = slot === 'vpn_connector' ? '/vault' : slot === 'resume_builder' ? '/resume-builder' : '/settings';
        let created;
        try {
          created = await stripe.checkout.sessions.create({
            mode: 'subscription', customer: pending.customer_id,
            line_items: [{ price: pending.price_id, quantity: pending.quantity }],
            metadata: { tier: pending.tier, quantity: String(pending.quantity), uficonnect_user_id: userId, uficonnect_attempt_id: pending.attempt_id },
            subscription_data: { metadata: { tier: pending.tier, quantity: String(pending.quantity), uficonnect_user_id: userId } },
            phone_number_collection: { enabled: false }, client_reference_id: userId,
            success_url: `${pending.return_base}${path}?upgrade=success`,
            cancel_url: `${pending.return_base}${path}?upgrade=cancelled`,
          }, { idempotencyKey: `ufi-checkout:${pending.attempt_id}` });
        } catch (error) {
          // Stripe also caches rejected requests. After a product configuration
          // repair, retrying that key still returns the original rejection.
          // Recover only a confirmed replayed validation error, once per call;
          // network failures and uncertain outcomes must retain their key.
          if (recoveredRejectedAttempt || error.type !== 'StripeInvalidRequestError'
            || error.statusCode !== 400 || error.headers?.['idempotent-replayed'] !== 'true') throw error;
          recoveredRejectedAttempt = true;
          await recoverUnresolvedCheckout(client, row, pending, catalog);
          if (!pending.session_id) {
            await client.query(`UPDATE billing_checkout_attempts SET attempt_id=$1,tier=$2,price_id=$3,
              session_id=NULL,return_base=$4,created_at=NOW(),quantity=$7 WHERE user_id=$5 AND slot=$6`,
            [randomUUID(), tier, priceId, frontendBase, userId, slot, quantity]);
          }
          renewed = true;
          return null;
        }
        await client.query('UPDATE billing_checkout_attempts SET session_id=$1 WHERE user_id=$2 AND slot=$3', [created.id, userId, slot]);
        // Recover the original idempotent request first, including after a
        // crash, then let the next locked iteration close it safely.
        if (changedSelection) { renewed = true; return null; }
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
        if (attempt.session_id && !row[SLOTS[attempt.slot]]) {
          await reconcileSession(client, row, await stripe.checkout.sessions.retrieve(attempt.session_id), catalog);
        }
      }
      const subscriptions = [];
      for (const [kind, column] of Object.entries(SLOTS)) {
        const subId = row[column];
        if (!subId) continue;
        const sub = await readSubscription(subId);
        if (!checkOwner(sub, row)) throw fault(409, 'Billing account ownership needs review.');
        await applySubscription(client, row, sub, catalog);
        subscriptions.push({ kind, tier: tierFor(sub, catalog), status: sub.status,
          cancelAtPeriodEnd: sub.cancel_at_period_end === true,
          currentPeriodEnd: sub.current_period_end || sub.items?.data?.[0]?.current_period_end || null });
      }
      // Older checkouts predate our durable attempt records. A missed webhook
      // must not leave their paying customer permanently on Free. Recover only
      // current, paid subscriptions on this member's persisted Stripe customer;
      // a plan label, email match, or subscription supplied by the browser is
      // never enough to grant access.
      if (row.stripe_customer_id && !row.billing_closed
        && Object.values(SLOTS).some(column => !row[column])) {
        const customer = await stripe.customers.retrieve(row.stripe_customer_id);
        if (customer.deleted || (customer.metadata?.uficonnect_user_id && customer.metadata.uficonnect_user_id !== row.id)) {
          throw fault(409, 'Billing account ownership needs review.');
        }
        const recovered = new Map();
        let inspected = 0;
        for await (const candidate of stripe.subscriptions.list({ customer: row.stripe_customer_id, status: 'all', limit: 100 })) {
          if (++inspected > 100) throw fault(409, 'Subscription history needs review. Use Manage billing for help.');
          const candidateTier = tierFor(candidate, catalog);
          if (!candidateTier || !ACTIVE.has(candidate.status) || !checkOwner(candidate, row)) continue;
          const kind = slotFor(candidateTier);
          if (row[SLOTS[kind]]) continue;
          // Read current state, including the invoice, rather than trusting the
          // list snapshot if a cancellation or payment update is in progress.
          const sub = await readSubscription(candidate.id);
          const tier = tierFor(sub, catalog);
          if (!tier || slotFor(tier) !== kind
            || !checkOwner(sub, row) || !ACTIVE.has(sub.status) || !await hasPaidInvoice(sub)) continue;
          if (recovered.has(kind) && recovered.get(kind).id !== sub.id) {
            throw fault(409, 'Multiple active subscriptions need review. Use Manage billing before starting another checkout.');
          }
          recovered.set(kind, sub);
        }
        for (const [kind, sub] of recovered) {
          await applySubscription(client, row, sub, catalog, { allowLink: true });
          // Replace a just-ended membership's summary with its recovered one.
          const previous = subscriptions.findIndex(item => item.kind === kind);
          if (previous !== -1) subscriptions.splice(previous, 1);
          subscriptions.push({ kind, tier: tierFor(sub, catalog), status: sub.status,
            cancelAtPeriodEnd: sub.cancel_at_period_end === true,
            currentPeriodEnd: sub.current_period_end || sub.items?.data?.[0]?.current_period_end || null });
        }
      }
      updated = row;
      return { plan: row.plan || 'free', businessSeats: row.business_seats || 0, resumeBuilderAddon: !!row.resume_builder_addon, vpnConnectorAddon: !!row.vpn_connector_addon,
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
      if (sub.metadata?.uficonnect_user_id === userId || Object.values(SLOTS).some(column => row[column] === sub.id)) {
        if (!ENDED.has(sub.status)) await stripe.subscriptions.cancel(sub.id, { prorate: false, invoice_now: false });
      }
    }
  }
  return { handleEvent, createCheckout, status, portal, prepareAccountDeletion };
}

module.exports = { BILLING_SCHEMA, EVENT_TYPES, TIERS, quantityOneAmount, validRecurringPrice, createBilling };
