# Mobile security controls and release checks

This records controls implemented in source. It is not a certification or a claim that a deployed app has passed an independent security assessment.

## Authentication and passwords

- Native iOS and Android sessions use Expo SecureStore. iOS entries are readable only while the device is unlocked and do not migrate to another device. The old AsyncStorage token is deleted; upgrading users must sign in again. There is no plaintext fallback if secure storage fails.
- The Expo web preview keeps its bearer session in memory for the current page. Refreshing the page signs the user out. The separate `web/` application has its own session implementation.
- Sign-out attempts server revocation and always clears the active local session. The UI reports when server revocation or device storage cleanup could not be confirmed. Security settings include password changes and sign-out across existing sessions.
- New passwords require at least 12 Unicode code points and at most 72 UTF-8 bytes to match the backend password hashing limit. Security settings reject the same current and new password before sending a request, require matching confirmation, and show accessible validation and server errors. The backend independently enforces password changes. Existing-password login is unchanged.
- Password inputs are masked by default. Accessible **Show password** and **Hide password** buttons let users check what they entered. Fields conceal again on blur, submission (including failed validation), disabled state, clearing, screen navigation, and app backgrounding. On iOS and Android, the input itself always stays in secure-entry mode: Show displays a separate non-selectable **Entered password** preview. This preserves native secure-field protections against hardware-keyboard copying. Native inputs also disable autocorrection and spelling suggestions and suppress selection menus. An explicit **Paste password** action reads the clipboard only when tapped. Password manager autofill remains enabled. Expo web inputs reveal in place and block copy, cut, and drag events while permitting paste, including while revealed. Entered passwords are cleared after completed API submissions, on screen navigation, and when the app enters the background.
- These input controls reduce accidental copying; they do not make the operating system clipboard or a compromised device trustworthy. Native keyboard shortcuts, autofill, accessibility tools, and clipboard permission prompts require device testing. The app cannot erase a password previously copied by another application.
- Two-factor authentication is not implemented. Connected-account demonstrations are labelled as demonstrations and do not claim encrypted provider token storage.

## Transport, backups, and signing

- The default API endpoint uses HTTPS. Release configuration and runtime validation reject HTTP endpoints. HTTP is available only in explicitly configured development builds (`APP_ENV=development`); never use real accounts against an HTTP development API.
- Android builds disable app backup and exclude app data from Android cloud backup and device transfer. The native Expo config plugin supplies these settings and blocks cleartext traffic in release builds. iOS App Transport Security disallows arbitrary insecure network loads.
- The Android TWA applies the same app manifest restrictions. Browser-managed web data belongs to the browser; the TWA manifest does not control browser backups, extensions, or screenshots.
- Remote JavaScript updates are disabled. Re-enable them only after configuring the intended update service and signed updates; the previous configuration resolved to an anonymous Expo update endpoint. Distribute code changes through new store builds until then.
- TWA release signing requires `UFI_ANDROID_KEYSTORE_PATH`, `UFI_ANDROID_KEYSTORE_PASSWORD`, `UFI_ANDROID_KEY_ALIAS`, and `UFI_ANDROID_KEY_PASSWORD`. Keep the signing key outside the repository and supply passwords through the build environment. Previously committed signing passwords must be treated as exposed. Determine whether the associated key was distributed and rotate the applicable upload/signing credentials through the store's supported procedure before release.

## Optional analytics

The Expo web app can measure fixed screen categories with GA4 `G-F68DRQ6CC5` after explicit consent. Its Google script runs on a different origin in a sandboxed frame, without access to app passwords, messages, session storage, or form contents. Preferences remain available on every screen, and withdrawing consent stops the collector and removes its random identifier. Native iOS and Android collection is unavailable until the linked Firebase app configurations and native SDK are supplied and verified. See [app analytics configuration](ANALYTICS.md).

## Required release validation

Run `npm run test:security` in `mobile/`. All 26 security, compatibility, and analytics tests passed; Expo Doctor previously passed 21 of 21 checks, and production Android, iOS, and web exports succeeded. The exported web app also passed 106 password security browser checks and 40 analytics checks spanning all twelve screens, consent/revocation, origin isolation, and private-data canaries. The native Hermes exports exclude the web collector. See the [dependency assessment](DEPENDENCY_SECURITY.md) for the clean audit, dependency decisions, and reproduction commands. These checks do not exercise iOS Keychain, Android Keystore, native linking, or native clipboard behavior.

Before distributing a new native build:

1. Keep Expo 57 / React Native 0.86 and native modules aligned, repeat dependency and configuration checks, and monitor the narrow Xcode UUID override described in the [dependency assessment](DEPENDENCY_SECURITY.md).
2. Build release iOS and Android binaries. Inspect the merged Android manifest and backup resources, verify cleartext API rejection, and verify iOS transport settings.
3. Test real devices for default masking, show/hide, automatic concealment, denied copy/cut while hidden and revealed, explicit paste, password manager autofill, app backgrounding, storage lock/unlock, reinstall, and device restore.
4. Verify old AsyncStorage sessions disappear on upgrade. Verify sign-out, remote sign-out, expiration, and password changes revoke sessions against the deployed backend, including failure and offline cases.
5. Verify the release uses the intended HTTPS API, protected persistent backend storage, and new signing credentials where needed. Complete the repository's security release checklist before publishing.

References: [Expo SDK 57 module versions](https://github.com/expo/expo/blob/sdk-57/packages/expo/bundledNativeModules.json), [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [Android backup controls](https://developer.android.com/identity/data/autobackup).
