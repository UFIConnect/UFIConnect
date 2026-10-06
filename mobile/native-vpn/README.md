# UFIConnect native VPN

This is a native iOS/Android implementation prepared for review. **No native compilation, signed VPN build, device connection, or traffic-leak test has passed yet.** The already delivered iOS 1.0.0 (1) IPA does not contain this feature. No EAS build or paid infrastructure was launched by this work.

## Integration

- `ufi-vpn/` is a local Expo module. `package.json` sets `expo.autolinking.nativeModulesDir` to `./native-vpn`; both Apple and Android autolinking discovery were checked.
- `withUfiVpn.js` generates `UfiVpnTunnel`, bundle ID `org.uficonnect.app.vpn-tunnel`, Network Extension entitlement, shared Keychain access group, and EAS extension metadata. It preserves the main app's existing project configuration.
- Android embeds the official `com.wireguard.android:tunnel:1.0.20260102` library and runs its Go backend in a native foreground VPN service. It asks for Android VPN permission on first use.
- iOS uses `NETunnelProviderManager` and a `NEPacketTunnelProvider` with official WireGuardKit, pinned to `2fec12a6e1f6e3460b6ee483aa00ad29cddadab1`. The system asks before adding the VPN configuration.
- Profile > VPN contains Connect/Disconnect. Expo Go and web show native VPN as unavailable. Enrollment alone never means Connected: the UI requires an OS tunnel, a recent WireGuard handshake, and a valid lease.

## Data and lifecycle

Private keys are created natively and never returned to JavaScript or sent to the backend. iOS stores keys and the renewal session in a shared Keychain access group with `AfterFirstUnlockThisDeviceOnly`. Android encrypts them using an Android Keystore AES-GCM key and stores ciphertext in the app's excluded-from-backup directory. No plaintext fallback exists.

The authenticated API receives the device public key and a generic platform label. The native service renews the same key every 30 seconds while running. Revoked keys cannot be reenrolled. A native watchdog ends the tunnel at lease expiry even when renewal is blocked; the gateway must independently enforce the client's lease deadline. Renewal rejects redirects and uses the fixed HTTPS control plane `https://api.uficonnect.org`.

All IPv4 and IPv6 routes and DNS are configured inside the tunnel. The current gateway forwards IPv4 and blocks IPv6. This is not an always-on VPN or a claim that traffic remains blocked after explicit disconnection, OS revocation, or session expiry. Disconnect restores ordinary device routing. iOS includes all networks while the tunnel is active; Android advertises no always-on support.

Explicit Disconnect stops the native tunnel before removing the server registration. Sign-out and authentication rejection also stop it. Sign-out-all attempts device removal while still authenticated. The backend must revoke every enrollment on sign-out-all, password change/reset, and account deletion, covering other devices and cases where authenticated DELETE is no longer possible.

No VPN route is added to the analytics allowlist. Native configuration, keys, DNS queries, destinations, traffic, and bearer tokens are not logged by this integration. WireGuardKit's log callback discards messages. Android release minification must apply the supplied consumer rules to remove upstream diagnostic Android log calls. Verify the final binary and gateway logging configuration before claiming an operational no-logs policy.

## Local checks

From `mobile`, after installing the shared app dependencies:

```sh
npm run test:vpn
npx expo-modules-autolinking search --platform apple --project-root . --json
npx expo-modules-autolinking search --platform android --project-root . --json
```

The 22 passing tests use isolated API/native fixtures. The plugin test modifies the actual Expo SDK template, writes and reparses its Xcode project, and checks extension embedding, target dependency, signing settings, pinned package, and repeatability. AuthContext tests cover session rejection and logout failures. The Go verification test rejects modified archive bytes. Android Expo prebuild with `--no-install` also completed locally. iOS Expo prebuild explicitly refused to generate on Windows. These checks do not compile Swift/Kotlin or prove an actual tunnel.

## Native build prerequisites and remaining checks

**iOS:** Use a Mac with current Xcode, CocoaPods, and an iOS device. The inspected official WireGuardKit build uses Go 1.19 and patches its runtime. `eas-build-post-install` runs `node native-vpn/prepare-go.mjs`, which downloads the official Go 1.19.13 archive for the Mac architecture, verifies its pinned SHA256, and extracts fresh executable bytes. The bridge phase reads its project-local path, builds the official pinned WireGuardKit Go bridge, and fails if the verified toolchain is missing. The upstream runtime patch was checked against the exact Go 1.19.13 source and applies cleanly. No Mac execution or Xcode compilation has run here, so current Xcode/SDK compatibility remains unproven. Go 1.19 is the old upstream requirement, not a claim of current Go security support. Do not substitute an unreviewed WireGuard fork or prebuilt library.

For a local Mac build: install app dependencies, run `node native-vpn/prepare-go.mjs`, generate the project using `npx expo prebuild --platform ios --no-install`, install pods, then build the app/extension in Xcode. Both targets need signing profiles with Network Extension and the same shared Keychain entitlement. Organization Apple Developer enrollment is user-confirmed; the additional extension profile/capability still needs verification. A working simulator UI is insufficient to validate VPN routing. No EAS build was launched to test these changes.

**Android:** The project was generated with `npx expo prebuild --platform android --no-install`. Portable JDK 17, official SDK platform 36, build tools 36.0.0, NDK 27.1.12297006, and CMake 3.22.1 are installed locally. A local Gradle debug compilation is in progress; no APK or device validation result is established yet. To reproduce with those prerequisites, run `android/gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a`, then use `npx expo run:android --device` with a physical test device. Confirm foreground-service permission/type handling, notification behavior, library packaging for all release ABIs, and release minification. This Windows session has no connected mobile device or Xcode.

Before generating store artifacts, test on both platforms: first-use permission accept/decline; UDP blocked/no network; a real handshake and gateway reachability; IPv4 egress/DNS; absence of IPv6 leaks; Wi-Fi/cellular transitions; screen lock/background renewal; expired membership/lease and remote device revocation; rapid Connect/Disconnect; OS VPN revocation; logout/password change/account deletion; process termination/relaunch; and behavior when secure storage fails. Check that errors never expose keys or tokens. Capture native screenshots from the resulting verified build.

App Store guideline 5.4 requires an organization developer account for VPN services and a pre-use data disclosure. The user confirmed Organization enrollment. The screen includes the concrete data-use disclosure; confirm the published privacy policy, permitted territories, any required licenses, and store payment/access rules before submission. Google Play's VPN/foreground-service declarations also need review for this new capability. Keep store descriptions accurate until native validation is complete.

Use the [VPN privacy and store metadata checklist](PRIVACY-REVIEW.md) for the
actual collection inventory, analytics exclusions, policy publication and App
Store privacy answers. Native third-party analytics stays disabled in this build.

## Primary references

- [Official WireGuardKit integration and Go bridge](https://git.zx2c4.com/wireguard-apple/about/)
- [Official Go archive checksums](https://go.dev/dl/?mode=json&include=all)
- [Expo build lifecycle hooks](https://docs.expo.dev/build-reference/npm-hooks/)
- [Official Android tunnel embedding](https://git.zx2c4.com/wireguard-android/about/)
- [Android VPN lifecycle and permission](https://developer.android.com/develop/connectivity/vpn)
- [Apple NETunnelProviderManager](https://developer.apple.com/documentation/networkextension/netunnelprovidermanager)
- [Expo local modules and config plugins](https://docs.expo.dev/modules/config-plugin-and-native-module-tutorial/)
- [Expo app-extension signing configuration](https://docs.expo.dev/build-reference/app-extensions/)
- [Apple VPN review rules, 5.4](https://developer.apple.com/app-store/review/guidelines/#vpn-apps)
