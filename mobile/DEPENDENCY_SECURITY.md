# Mobile dependency assessment — 2026-09-15

The mobile application now uses **Expo SDK 57.0.23, React Native 0.86.3, React 19.2.3, and React Navigation 7**. Expo's SDK 57 module versions define the native dependency set. Use Node `^22.13.0 || >=24.3.0`; the validation below used Node 24.21.0.

The final `npm audit --json` reports **zero vulnerabilities across all severities**, including development dependencies. The local report is `.cache/audit-mobile-sdk57.json` at the repository root. Re-run the audit during release preparation because advisory data changes; a clean audit does not establish the absence of security flaws.

## Migration and dependency decisions

- Replaced Expo 48 / React Native 0.71 and the obsolete webpack integration with the supported Expo 57 Metro configuration and matching native modules. Removed unused direct packages and the earlier `semver`, `@xmldom/xmldom`, `xml2js`, and `send` overrides; upstream versions now supply these fixes.
- Updated navigation to version 7 and adjusted registration back-navigation and safe-area handling.
- Retained one narrow override: `xcode > uuid@11.1.1`. The installed Xcode project generator otherwise resolves vulnerable UUID 7. Its implementation uses the CommonJS `v4()` API, which UUID 11 preserves. Compatibility tests exercise generated Xcode identifiers and the patched undersized-buffer behavior. Remove this override when Xcode's upstream dependency is patched. [UUID advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
- Preserved SecureStore sessions, HTTPS checks, password controls, backup exclusions, server session revocation, and disabled remote JavaScript updates.
- Updated document-picker handling and allowlisted shared file metadata to name, size, and media type. Device-local URIs, file objects, and encoded file content are not sent. The UI explicitly identifies this feature as sharing file details.

## Completed validation

- **22 security and compatibility tests passed**, covering session storage failure/cleanup, password boundaries, release configuration, file metadata privacy, Android XML, iOS plist handling, and the remaining dependency override.
- **Expo Doctor: 21 of 21 checks passed**, including dependency alignment and app configuration.
- Production Metro exports succeeded for **Android, iOS, and web**, including Hermes bytecode compilation for both native platforms. These exports are not installable APK/IPA binaries.
- The exported web app passed **106 browser checks** at 390px and 1280px widths: legacy token removal, default password masking, show/hide across all five fields, keyboard accessibility, real keyboard copy/cut restrictions while revealed, paste compatibility, automatic concealment and clearing, login, Security navigation, current-password reuse and confirmation rejection before API requests, valid password changes, sign-out, and absence of persistent bearer storage or runtime errors. Requests use synthetic local fixtures; they do not access production account data.
- Production configuration introspection confirmed disabled Android backup/cleartext traffic, backup/transfer exclusions, iOS transport restrictions, and disabled remote JavaScript updates.

## Reproduce

From `mobile/`, after installing a supported Node version:

```sh
npm ci
npm run test:security
npm run doctor -- --verbose
npm audit --audit-level=high
APP_ENV=production CI=1 EXPO_NO_TELEMETRY=1 npm run export -- --output-dir .cache/export-sdk57
```

The environment-variable syntax above is for POSIX shells; use the equivalent environment assignment in PowerShell. For the exported-web checks, install the repository root development dependencies and a Playwright Chromium browser (`npx playwright install --with-deps chromium` from the root on Linux CI), then run `npm run test:export` in `mobile/`. On Windows the script uses installed Microsoft Edge. The browser checks expect the export at `mobile/.cache/export-sdk57`.

## Remaining release gates

Complete the real-device and signed-binary checks in [SECURITY.md](SECURITY.md). Native linking, Keychain/Keystore behavior, native clipboard/autofill behavior, merged release manifests, store signing, and upgrade/restore behavior require Android/iOS builds and devices. No native store build, publication, signing-key rotation, or remote update deployment was performed during this migration.

References: [Expo SDK 57 release](https://expo.dev/changelog/sdk-57), [Expo SDK upgrade workflow](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/), [SDK 57 native module versions](https://github.com/expo/expo/blob/sdk-57/packages/expo/bundledNativeModules.json), [React Navigation 7 migration](https://reactnavigation.org/docs/upgrading-from-6.x/).
