# Google Tag Manager

Container **GTM-PXQR5386** is installed in the website's existing advertising
controller, `web/src/analytics/googleAds.mjs`. It loads once in the document
head after the visitor permits advertising measurement and the session check
confirms a signed-out public homepage. Google Analytics consent alone does not
enable it. Global Privacy Control, withdrawing consent, opening a private route
and signing in keep the existing advertising restrictions.

The container uses Google's standard `dataLayer`, `gtm.start` and `gtm.js`
bootstrap. Consent and redaction settings are queued before the container loads.
The advertising homepage CSP permits the Google script and style origins
required for Tag Assistant preview. No private-page or Office CSP permissions
are expanded. Homepage URL sanitization preserves only a single numeric
`gtm_debug` value (1–20 digits) and `_dbg=1` alongside the existing attribution
identifiers; these flags do not grant consent. Other query values and private
fragments are removed before either advertising SDK loads.

The advertising homepage also permits scripts from the exact
`https://googleads.g.doubleclick.net` origin reported by Google Tag Diagnostics.
This permission must be present in both the deployed HTTP policy and the
generated homepage meta policy. Private pages, Office and the isolated
Analytics frame do not receive this advertising script permission. The browser
audit fulfills a harmless script from this host locally to exercise the policy
without sending conversion events.

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
pages, bounded debug flags, preview CSP permissions, and removal on navigation
and withdrawal without sending real events.

For a live preview, open `https://uficonnect.org/#analytics` signed out, allow
Google Ads measurement, then connect that homepage in Tag Assistant and retry
if it connected before consent. Global Privacy Control must be off in this
test browser. The installation auto-check can report no tag before advertising
consent, on another route, or while signed in because the container does not
load in those states. Tag Assistant also offers an option to omit its URL debug
signal. Verify the expected container and preview connection after consent;
successful installation does not confirm any tags have been published.

On October 13, 2026, a real Google Tag Assistant session detected
`GTM-PXQR5386` and the existing Ads tag after the homepage's advertising consent
was granted. It reported that this container had not been published. In the
container's Google account, review the workspace through **Preview**, then use
**Submit > Publish and Create Version > Publish** when the configuration is
ready. Website deployment does not publish the Google account's container.

Reference: [Google's web container installation guide](https://support.google.com/tagmanager/answer/14847097?hl=en).
See also [Google's preview CSP requirements](https://developers.google.com/tag-platform/security/guides/csp)
and [Tag Assistant connection troubleshooting](https://support.google.com/tagassistant/answer/10039345?hl=en).
For account-side publishing, see [Verify and publish tags](https://support.google.com/tagmanager/answer/14842769?hl=en).
