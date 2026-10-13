# Current website in the Apple app

`Website.jsx` is an Expo DOM component that imports the maintained `web/src/App`
and its providers and styles. The Apple app uses a bundled local document and
MemoryRouter; Expo browser hosting uses the same component and BrowserRouter.
Android uses the same bundled interface through `App.android.js`; `App.js`
retains the historical native interface. Android's verified APK asset directory
is mapped to WebView's packaged `android_asset` URL, while iOS retains its native
file directory. Existing Android VPN connection links open its native disclosure
screen, with account changes and logout disconnecting the previous tunnel.

Native API access, secure session persistence, system browser sign-in, location,
clipboard and file sharing use explicitly scoped native actions. Each action
requires the current WebView's capability. Provider pages open in the system
browser. The DOM document is not a remote iframe.

YouTube videos use a separate, credential-free native WebView. Its small local
player document is loaded with `baseUrl: https://org.uficonnect.app`, the app's
registered bundle identity, so YouTube receives the required HTTP Referer.
Only validated video IDs, playback commands, geometry and playback state cross
this bridge. The player never receives the app session or general API access.
The DOM adapter keeps it aligned with the shared interface, hides it behind
dialogs, and releases offscreen players. Supported `controls=0` keeps playback
buttons in the app's separate bar below the video.

Native safe-area chrome follows the displayed media surface and selected theme.
The native container owns safe-area padding; automatic WebView insets are off.

Shared page links use React Router state, search and hash so native navigation
preserves tabs, return destinations and section links inside MemoryRouter.
Public post and invitation links use the canonical website address.
Native API requests preserve the caller's timeout up to four minutes for media
generation. Canceled file preparation never starts a subsequent upload, and
account changes invalidate prepared uploads and responses before delivery.

Run `npm run export -- --output-dir .cache/export-sdk57` from `mobile` for the
browser/CI export, or add `--platform android`, `--platform ios`, or
`--platform all` for native output. `test:export` exercises the current compiled
shared interface and `test:analytics` checks its consent and privacy controls.
Both accept `EXPO_EXPORT_DIR` or `EXPO_AUDIT_EXPORT_DIR`. The runner and
Metro configuration set `EXPO_NO_BUNDLE_SPLITTING=1`: SDK 57's DOM export otherwise
renames chunks without rewriting their HTML dependency references. The EAS
production environment uses the same setting. This can be reviewed when Expo
fixes that exporter behavior.

The EAS source must include sibling `web/src`, `web/public`, and `shared`.
`prepare:website` copies current public images, fonts and media before local
exports and EAS builds. It excludes website service workers and desktop
installers. Small CSS fonts are embedded by the Metro transform. Root-relative
asset references use Expo's document base, including the native `./` base.

The Babel adapter admits only explicitly public client configuration and uses
`EXPO_PUBLIC_API_URL` (default `https://api.uficonnect.org`). Optional Auth0
configuration uses `EXPO_PUBLIC_AUTH0_DOMAIN`, `EXPO_PUBLIC_AUTH0_CLIENT_ID` and
`EXPO_PUBLIC_AUTH0_AUDIENCE`. Metro resolves shared UI dependencies against the
mobile lockfile so Expo's React and React DOM versions remain identical.

Local browser fixture screenshots demonstrate the current shared UI. They do
not replace screenshots captured from an installed native Apple build.
