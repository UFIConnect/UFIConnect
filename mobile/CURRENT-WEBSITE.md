# Shared website interface on iPhone, Android, and Expo web

The iPhone, Android, and Expo browser entries render the maintained website components from `web/src`. `App.ios.js` and `App.android.js` open the same bundled DOM runtime; `App.web.js` renders the same React website directly. The previous five-tab interface remains in `App.js` as historical source.

The website's routes, styles, navigation, Home feed, Videos, Groups, Jobs, Profile, Map, settings and account tools come from one source. `current-site/Website.jsx` supplies the website providers and uses a memory router inside the native document. Browser URLs continue to use the browser router. Public assets are copied from `web/public` during preparation and EAS builds. New website code becomes part of the next signed native build; remote JavaScript updates remain disabled.

## Native boundaries

- API requests pass through a bounded native transport pinned to `https://api.uficonnect.org`, with redirects rejected. Native credentials remain in the platform secure store; the shared React application keeps its active bearer only in memory. Ordinary website authentication is unchanged.
- Google and Apple account sign-in, signup and linking use the system authentication browser, a Keychain-held verifier and the existing one-time native return code. Social connection setup opens the main website in the system browser because those providers use browser-bound OAuth state.
- Location requests use the foreground operating-system permission prompt. Feed code retains its existing coarse location handling and limited request headers.
- Uploads and downloads are limited to 25 MB per native bridge operation. Downloaded files open the system share sheet; temporary copies are removed afterward. Clipboard actions use the native clipboard.
- The native document stays inside its bundled directory. External HTTPS links open the system browser. Every privileged native action requires an unpredictable capability supplied only to the trusted top document, so embedded media frames cannot invoke native actions.
- The broad Expo modules bridge is disabled. Read access is limited to the bundled website directory. Native billing entry actions retain the existing restriction on in-app external checkout.
- Android verifies the `asset:///www.bundle/` APK directory before mapping its one hashed page to WebView's `file:///android_asset/www.bundle/` URL. iOS retains its verified native file directory. Neither platform opens a remote application document.
- Existing one-time Android VPN links still open the native disclosure, permission, and connection screen. Signing out or changing accounts stops the old tunnel. Vault retains the shared website protection interface. The Android VPN templates remain part of the managed build; generated `mobile/android` projects and signing files remain excluded from EAS archives.

## Review limits

The browser preview demonstrates the current interface and API connectivity. It does not establish installed device behavior. Validate provider cancellation/return, permissions, file selection/sharing, video playback, app recovery, session persistence, and Android VPN permission on devices before submission.

Website Vault data and passkeys belong to their original browser storage/origin. They are not automatically migrated to the native application; use supported encrypted export/import and recovery flows. A bundled website does not imply support for browser-origin WebAuthn passkeys on either native platform.

Vault's shared web protection is not a device VPN. This release adds no native iOS VPN. Existing native Android VPN access remains available through its one-time connection links.

The shared interface uses the current API authentication routes. Browser app return links use the configured app origin; corresponding API changes are deployed separately from signed native binaries.
