# Expo app connection

Office Connections includes Expo for `@uficonnect/ufic`, project `230828f2-53a3-4f87-a262-f2946e821eeb`. Connect with an Expo access token limited to the `uficonnect` account with Developer access. Office verifies project access before storing the token in the existing encrypted connection database. Disconnect removes the saved credential and disables inherited Expo access for Office; revoke the token in Expo to revoke it at the provider.

In Expo, link `UFIConnect/UFIConnect` and set the app directory to `/mobile`. The workflow is `mobile/.eas/workflows/office-build.yml`. The connection uses the same server-side credential for Expo verification and builds; it does not depend on a separate GitHub `EXPO_TOKEN` secret.

Use **Tasks → Mobile apps** to edit app code and publish verified changes. Choose the **Mobile app** deployment target when requesting a build. Work also recognizes requests such as “Update the mobile app sign-in screen.” The existing **Build mobile app** Office command is available through the Expo card's build-controls link. A build retains the existing deployment confirmation.

Office checks the verified main commit and dispatches the workflow using that immutable SHA. Expo checks app security, dependency advisories, and Expo configuration before queueing production iOS and Android builds. A returned workflow URL means the run is queued; inspect that URL for completion. An interrupted or unconfirmed provider write must be reconciled through Expo history before retrying.

Native build versions must be increased for new store releases. App store submission remains a separate step. Over-the-air updates remain disabled in this app's existing configuration, so updating the connection does not change installed apps.

Provider references: [Expo access tokens](https://docs.expo.dev/accounts/programmatic-access/), [Workflows REST API](https://docs.expo.dev/eas/workflows/rest-api/), [workflow syntax](https://docs.expo.dev/eas/workflows/syntax/).
