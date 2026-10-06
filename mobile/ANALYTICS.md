# UFIConnect app analytics

## Required service metrics and optional performance insights

The **Data & privacy** screen is available from sign-in and Profile.
Every allowlisted screen visit sends only `{category}` to the first-party
`POST /analytics/pageview` endpoint. Repeated navigation state for the current
screen is deduplicated in memory. Navigation keys never leave the app.
The server stores daily aggregate counts without account or visitor identifiers.
Requests omit authorization, cookies, and referrers. Infrastructure receives
connection information when serving requests; it is not part of these counts.
The VPN screen is explicitly excluded from both screen collectors. Entering it
clears the current performance category, so VPN errors cannot be counted against
the previous screen. VPN API requests are excluded from response counters and
the shared app-activity heartbeat. Keys, connection state, DNS queries and
destinations are never analytics inputs.

Performance insights are off by default. When enabled, browser error events or
the native runtime's existing global error hook send only a fixed category,
`kind: "client_error"`, and a fixed error code to `/analytics/performance`.
Messages, stack traces, filenames, screen parameters, and private content are
excluded. Duplicate errors are limited to once per code/category per minute.
Withdrawal detaches the listener and aborts pending optional requests. The
change is applied synchronously and shared between tabs of the Expo web app.
The original native error handler still runs. Unsupported runtimes show unavailable.

Data Saver and performance preferences are stored as booleans in AsyncStorage.
Data Saver fetches only the selected Feed section instead of prefetching Groups,
Social, and Jobs together, on every connection. The current native app has text
feeds without media autoplay, so it offers no autoplay control. Roaming remains
an operating-system cellular setting. These source changes require a signed
native release; Expo exports are validation artifacts, not published binaries.

## Configured now: Expo web

The browser version of the mobile app uses GA4 web stream `G-F68DRQ6CC5`.
Google receives no requests before the visitor selects **Allow analytics**.
**Analytics preferences**, available below every screen, can stop collection.
The Google script runs inside a sandbox frame on a separate origin. Browser
same-origin protections prevent it from reading
the application's passwords, messages, session tokens, or page contents.

Twelve rendered screen names are explicitly mapped in
`analytics/screenPolicy.js`: login, registration, onboarding, opportunities,
groups, group details, feed, message list, conversation, profile,
security, and data/privacy. VPN is an explicit exclusion. Only these constant categories are forwarded. Group
names, conversation identifiers, dynamic navigation titles, query strings,
fragments, search text, user IDs, and form values are never event parameters.
Unknown new screen names are ignored until deliberately added to the allowlist.

`npm run export`, `npm start`, `npm run web`, `npm run android`, and `npm run ios`
first synchronize the reviewed controller from the main web project. The
generated copy is ignored by Git. The sandbox bridge is served separately at
`https://api.uficonnect.org/analytics-bridge.html`; deploy that backend route
with the app. A different analytics host can be supplied through
`EXPO_PUBLIC_ANALYTICS_BRIDGE_URL`; the controller requires a different origin
from the app and HTTPS, except explicit separate-port loopback development.
The backend's `ANALYTICS_PARENT_ORIGINS` must include the actual Expo web
origin; the configured `https://app.uficonnect.org` entry applies only if that
is where the exported mobile web app is hosted. Use a same-site subdomain when
possible because browser tracking protections can block cross-site analytics.
Running raw
`npx expo` commands skips this preparation; run `npm run prepare:analytics` first.

## Native iOS and Android VPN builds

Native Google collection is **disabled in this VPN build**. No Firebase SDK has been
installed or initialized, and the native analytics adapter performs no network
requests. Required first-party counts and optional error counts are separate.
The separate Expo browser app's Google consent does not enable native collection.
Do not activate a third-party analytics SDK as part of this VPN release.
Validate the final binary's network behavior and use the
[VPN privacy and store checklist](native-vpn/PRIVACY-REVIEW.md) for data disclosures.
