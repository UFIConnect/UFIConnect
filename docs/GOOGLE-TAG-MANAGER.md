# Google Tag Manager

Container **GTM-PXQR5386** is installed in the website's existing advertising
controller, `web/src/analytics/googleAds.mjs`. It loads once in the document
head after the visitor permits advertising measurement and the session check
confirms a signed-out public homepage. Google Analytics consent alone does not
enable it. Global Privacy Control, withdrawing consent, opening a private route
and signing in keep the existing advertising restrictions.

The container uses Google's standard `dataLayer`, `gtm.start` and `gtm.js`
bootstrap. Consent and redaction settings are queued before the container loads.
The existing CSP already permits the required Google host on the eligible
homepage. No private-page or Office CSP permissions are expanded.

The unconditional inline bootstrap and no-JavaScript iframe from Google's
installation dialog are deliberately not placed in every HTML document: they
would run before the site's consent and session checks. Browsers without
JavaScript cannot grant this site's advertising consent, so no iframe fallback
loads. Other public routes, private account pages and Office remain excluded.

The existing Google Ads conversion and isolated Google Analytics integration
remain responsible for their current events. Avoid configuring duplicate Ads
conversions or the existing Analytics page views in this container. Container
publishing and receipt in the Google account require separate verification;
installing the loader does not publish tags.

Validation: build the website, then run `node scripts/audit-google-ads.mjs`.
Its intercepted browser checks verify the requested container ID, one load per
eligible document, consent, Global Privacy Control, authenticated/private
pages, and removal on navigation and withdrawal without sending real events.

Reference: [Google's web container installation guide](https://support.google.com/tagmanager/answer/14847097?hl=en).
