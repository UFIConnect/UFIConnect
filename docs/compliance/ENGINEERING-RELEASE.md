# Subscription and privacy engineering evidence

Prepared September 22, 2026. This records the engineering work for the initial readiness program. It does not approve policies, establish legal applicability, or attest to compliance.

## Implemented controls

- **Hosted payments:** Stripe collects card details. The backend selects an approved recurring price, verifies the persisted customer, and stores a durable checkout attempt before creating a Stripe session. Retries reuse Stripe idempotency keys. The existing quantity-one Pro price is $19.94 USD/month; Business remains unavailable.
- **Membership integrity:** Signed webhooks reconcile current Stripe subscription/invoice state under database locks. Event deduplication and entitlement updates commit together. Unpaid, canceled, mismatched and unsupported-price subscriptions cannot grant access. A return URL cannot confirm payment.
- **Member billing:** Desktop and phone settings display current status and cancellation information. Existing or overdue subscribers can open Stripe's portal. The price, renewal interval and cancellation route appear before checkout. Payment destinations are restricted to the expected HTTPS Stripe hosts.
- **Privacy signals:** Global Privacy Control overrides a saved analytics opt-in, clears the integration's browser identifier and blocks optional analytics. Header-only GPC requests receive no analytics bridge. Security and identifier-free aggregate metrics continue.
- **Account rights:** Exports read a consistent database snapshot, including member messages, resume files and preferences, and omit authentication secrets. Deletion closes billing, expires open checkouts and cancels managed subscriptions before an atomic database deletion. Local data is cleared after commit; shared communities and other members' posts remain.
- **Deletion boundaries:** Final attachment and message writes lock and recheck the relevant accounts. Public durable member lookups consult the database so an old worker cache cannot keep exposing a deleted profile. Other write paths, remote copies and content caches remain on the follow-up register.

## Local verification

The final backend suite passed **222 tests**, including real PostgreSQL-engine billing/privacy tests, real Stripe signature checks, delayed-operation races, rollback, cross-account isolation and stale-profile behavior. No production account was deleted or real payment created.

The production frontend build and **53 membership/privacy browser checks** passed at 1440, 390 and 320 pixels. All billing requests in those browser tests were intercepted. Existing **295 public SEO checks**, **84 analytics browser checks**, and syntax/deployment-header checks passed. Source references:

- `backend/billing.js`, `backend/billing.test.js`
- `backend/privacy-data.js`, `backend/privacy-data.test.js`
- `backend/member-write.js`, `backend/member-write.test.js`
- `backend/analytics-bridge.js`, `scripts/analytics.test.mjs`
- `scripts/audit-memberships.mjs`, `scripts/audit-public-seo.mjs`, `scripts/audit-analytics.mjs`

Release CI must pass for the exact deployed commit. Production confirmation must record the commit, health/readiness responses, public billing configuration, and webhook configuration without secrets. Source observations and local tests must not be substituted for production or operating-period evidence.

## Still required

Run an owner-controlled Stripe sandbox purchase, renewal/failure/recovery and cancellation exercise, then reconcile Stripe and application records. Read-only live configuration showed charges and payouts enabled, but no live charge was used as a test. Tap to Pay is a separate payment channel.

An unresolved checkout attempt older than 23 hours intentionally requires operator reconciliation before another checkout, because Stripe can prune old idempotency keys. Database/processor outages fail closed; retry account deletion after fixing the failure. Cancellation and database deletion are separate systems: a failed later step can leave billing stopped while account deletion still needs retry. Do not promise atomic rollback across Stripe and PostgreSQL or an automatic refund.

Processor/media copies, backup deletion replay, legal retention, broader concurrent-write/content-cache handling, individual administrator MFA, recovery drills, vendor contracts, privacy request operations and independent assessments remain open in [actions.csv](actions.csv). A Vanta account and integrations have not been created.
