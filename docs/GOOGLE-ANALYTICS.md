# Google Analytics activation

## What is configured

Web stream **G-F68DRQ6CC5** is configured in the source for the main website,
installed website/PWA (including its Android web wrapper), and Expo web app.
Every rendered website route produces a manual page view after consent; dynamic
routes use generic categories such as Conversation, Group, and Member profile.
Expo web maps all twelve current screens to fixed `/app/` categories. Native
iOS/Android app streams require Firebase configuration as described below.

The consent-based website integration and API bridge were verified live on
September 16, 2026 (UTC). Receipt in your Google Analytics account has not been verified. The measurement
ID is public configuration; it does not grant access to the account or verify
which Gmail address owns it. The new core metrics and data preferences described
below require their own verified release; preparing code does not deploy it.

## Core metrics and optional insights

Core service metrics and first-party aggregate page/screen counts stay active
independently of Google consent. New counters contain a UTC date, a fixed page
category, an event category and a count. They do not store account IDs, visitor
IDs, IP addresses, full URLs, referrers, messages, passwords or search text.
Request outcomes and duration buckets are counted separately in bounded process
memory. Network addresses can still be processed by hosting and abuse controls;
this is not a claim of anonymous networking.

Optional performance insights default off and send only reviewed error codes
and fixed categories, never raw error messages or stack traces. Data and privacy
settings control this reporting independently of Google Analytics. Declining
Google Analytics continues to prevent Google requests; it does not disable
first-party aggregate counters, account security or requested feed features.

Office's analytics report shows aggregate views, optional diagnostic counts and
the current API process's response buckets. A view is not a unique person.
Existing identified analytics history is not deleted by this release and is
not included in the new aggregate report. See [Data and privacy controls](DATA-PRIVACY.md)
for persistence, retention, data-saving behavior and rollout checks.

## Activate the website and browser apps

1. Deploy the backend and website from the verified source. Deploy the updated
   Expo web export if you host that app separately. The API must serve
   `https://api.uficonnect.org/analytics-bridge.html` before clients can measure.
2. In the API environment, set `ANALYTICS_PARENT_ORIGINS` to the exact HTTPS
   origins of your frontends. The Render blueprint includes the main domains,
   Render web host, GitHub Pages origin and `https://app.uficonnect.org`. Add the
   actual Expo web origin if it differs. This is an embedding allowlist, not a
   change to API CORS or account permissions.
3. Clients default to that API bridge. Only override `VITE_ANALYTICS_BRIDGE_URL`
   (website) or `EXPO_PUBLIC_ANALYTICS_BRIDGE_URL` (Expo web) when changing its
   host. It must be a **different origin** from the client, use HTTPS, have the
   exact path `/analytics-bridge.html`, and contain no query or fragment.
4. Sign in to Google Analytics using the support account. Open **Admin → Data
   streams**, select the web stream, and confirm its measurement ID is
   **G-F68DRQ6CC5**. Turn **Enhanced measurement off** for this integration: the
   app supplies manual page views and intentionally excludes automatic form,
   search, link and history measurement. Do not add a second Google tag snippet
   or Tag Manager container to the application pages.
5. Keep Google signals, advertising personalization, and user-provided data
   collection disabled in the property. Review its data retention and sharing
   settings for your published privacy policy. The code's browser identifier
   lifetime does not configure Google's server-side retention.
6. Open the deployed website, choose **Accept analytics**, and navigate between
   pages. In **Reports → Realtime**, confirm page views reach this property with
   generic page titles. For Expo web, choose **Allow analytics** and navigate
   its screens. A visitor who declines is intentionally absent from GA.
7. Open **Analytics privacy** on the website or **Analytics preferences** in
   Expo web and decline. Confirm Google requests stop, including after reload.

Google's setup scanner may not recognize a tag that loads only after consent
inside a separate document. Inspect actual page-view requests and Realtime
receipt after opting in; a scanner warning alone is not a collection test.
Browser content blockers or cookie restrictions can prevent measurement.

## Privacy and measurement boundaries

- No Google document or script loads before explicit browser consent. Decline
  keeps the app usable. The saved choice can be changed from every page.
- Google runs in a sandboxed iframe on the API origin. Browser origin isolation
  prevents it reading the parent app's DOM, storage, title, URL, or form fields.
  The main app's Content Security Policy still blocks Google scripts entirely.
- Only allowlisted page categories and a random analytics identifier cross to
  the iframe. No passwords, messages, account IDs, profile names, search text,
  dynamic route IDs, query strings, fragments or referrer are forwarded.
- Google also receives ordinary browser/device and SDK lifecycle metadata, and
  an IP address when the browser connects. This is not anonymous networking.
  Advertising storage, signals, personalization and advertising user data stay
  disabled. No Measurement Protocol secret is included in a client.
- A random identifier, separate from the account, is stored for up to 30 days
  without sliding renewal. The Google tag uses host/path-scoped session cookies
  with `SameSite=None; Secure; Partitioned`. Supporting browsers partition them
  by the top-level site. Unsupported browsers may block cross-site collection.
- Withdrawal disables collection, removes the iframe and deletes the local
  identifier and scoped analytics cookies. Consent changes propagate to other
  open tabs on the same origin. Withdrawal does not erase historical GA reports.
- Canonical URLs use `https://uficonnect.org` plus a constant category. Referrers,
  campaign query parameters, individual content IDs and account linkage are
  deliberately unavailable in reports. Consent and identifiers are separate for
  each browser origin. The hidden measurement document does not measure actual
  app scrolling, clicks or time spent reliably; use page counts as the metric.
- The administrative Office dashboard retains its own operational tools and
  does not send its private administrative pages to Google Analytics.

## Standalone iPhone and Android apps

A web measurement ID cannot configure native app streams. Supply the Firebase
project linked to this GA property and register both apps as
`org.uficonnect.app`, then obtain Android `google-services.json` and iOS
`GoogleService-Info.plist`. Native collection remains disabled until the native
SDK integration and consent behavior are implemented and tested in real builds.
See [mobile activation requirements](../mobile/ANALYTICS.md). No service-account
key or administrative password is needed in an app.

## Verification and maintenance

```sh
node --test scripts/analytics.test.mjs
node --test backend/analytics-bridge.test.js
node scripts/sync-analytics-bridge.mjs --check
npm run build --prefix web
node scripts/audit-analytics.mjs
node scripts/audit-csp.mjs
npm run export --prefix mobile -- --output-dir .cache/export-sdk57
npm run test:analytics --prefix mobile
```

Regenerate the committed bridge with `node scripts/sync-analytics-bridge.mjs`
after changing its program or page categories. CI checks it for drift. Google
permissions exist only on this generated document; its API response also sets
an explicit `frame-ancestors` allowlist. Browser audits use local collection
interception and synthetic data, so they do not populate live analytics.

References: [GA configuration](https://developers.google.com/analytics/devguides/collection/ga4/reference/config),
[manual SPA measurement](https://developers.google.com/analytics/devguides/collection/ga4/single-page-applications),
[consent mode](https://developers.google.com/tag-platform/security/concepts/consent-mode),
[partitioned cookies](https://privacysandbox.google.com/cookies/chips), and
[Firebase Analytics setup](https://firebase.google.com/docs/analytics/get-started).
