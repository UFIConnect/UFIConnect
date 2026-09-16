# UFIConnect app analytics

## Configured now: Expo web

The browser version of the mobile app uses GA4 web stream `G-F68DRQ6CC5`.
Google receives no requests before the visitor selects **Allow analytics**.
**Analytics preferences**, available below every screen, can stop collection.
The Google script runs inside a sandbox frame on a separate origin. Browser
same-origin protections prevent it from reading
the application's passwords, messages, session tokens, or page contents.

All twelve rendered screen names are explicitly mapped in
`analytics/screenPolicy.js`: login, registration, onboarding, opportunities,
groups, group details, feed, message list, conversation, profile, connected
accounts, and security. Only these constant categories are forwarded. Group
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

## Native iOS and Android activation requirements

Native collection is **unavailable in this build**. No Firebase SDK has been
installed or initialized, and the native analytics adapter performs no network
requests. The provided `G-` identifier configures a web stream; it cannot
identify native Android and iOS app streams.

To activate native analytics, the Firebase project must be connected to the
same Google Analytics property as the web stream, with these registered apps:

| Platform | Existing UFIConnect identifier | Required Firebase app file |
| --- | --- | --- |
| Android | `org.uficonnect.app` | `google-services.json` |
| iOS | `org.uficonnect.app` | `GoogleService-Info.plist` |

Once that project and its platform configurations are supplied, complete and
verify a native build with `@react-native-firebase/app` and
`@react-native-firebase/analytics`, the Expo config plugins, and the files above.
The Expo Firebase JS SDK does not provide native Analytics, and Expo Go cannot
run the native Firebase Analytics module. Do not place a Measurement Protocol
API secret, service account key, or administrative credential in either app.

Required native integration behavior:

- Start with `analytics_auto_collection_enabled: false` and
  `google_analytics_automatic_screen_reporting_enabled: false` in `firebase.json`.
- Default analytics consent to denied until the visitor explicitly allows it.
  Keep advertising storage, ad user data, and ad personalization denied.
- Disable advertising identifier integration; do not add IDFA/AdSupport or the
  Android advertising ID permission to measure ordinary screen usage.
- Use the existing screen allowlist and React Navigation hook with manual
  `logScreenView`. Pass fixed names only, with no user ID or user properties.
- On withdrawal, disable collection, deny consent, and reset analytics data.
  Recheck persisted consent before enabling collection after an app restart.
- Validate actual iOS/Android network traffic and Firebase DebugView, the
  pre-consent/revoked states, and app store data disclosures before release.

References: [Expo Firebase guidance](https://docs.expo.dev/guides/using-firebase/),
[React Native Firebase setup](https://rnfirebase.io/),
[Analytics consent and automatic collection](https://rnfirebase.io/analytics/usage),
[React Navigation screen tracking](https://rnfirebase.io/analytics/screen-tracking).
