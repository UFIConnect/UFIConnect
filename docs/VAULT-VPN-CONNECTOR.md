# Your Vault VPN connector

Your Vault uses a VPN app or profile you already configured. The VPN settings built into an operating system are clients: they need a trusted provider or organization’s server, profile, and credentials. They do not provide country endpoints by themselves.

## Public website

Open **Your Vault → Your VPN** and use its top connection button. On Windows it opens system VPN controls; on other public-web platforms it reveals the connection steps for your existing app. The local companion can connect or disconnect an existing profile with the top button. **Device, locations and setup** holds the platform selector, optional profile labels and provider guidance. No unsupported private settings URL schemes or invented connected states are used.

The public website does not claim to create a tunnel or detect VPN status. It does not probe localhost or expose the local companion to public origins. Country selection is based only on existing profile locations confirmed by the user. Choosing a country prepares the matching profile instructions; switch the actual connection in the VPN app/settings.

### Device imports and local Vault storage

Vault Home includes Passwords, Documents and Keys. **Import from this device** opens the current phone or computer's native picker for documents and key files. Browsers cannot bulk-read the operating system's password store; passwords can be added manually. Nothing in this import flow reads another device or the pending UFI hardware.

Files are limited to 512 KiB each and share the existing 2 MiB encoded Vault payload limit with passwords. Filenames and file bytes stay inside the authenticated encrypted record in browser storage. Locking hides all collections. Downloads require a user action, and encrypted backup/restore includes all three collections. Storage-quota or validation errors preserve the previous record. Imported files are not rendered or executed, and are never uploaded to the API.

The Device page presents the planned one-step experience: choose your app and continue while the device handles authentication for supported integrations. Hardware pairing, automatic sign-in and ordering remain unavailable until the hardware integration is ready.

### UFI Vault membership and pending VPN setup

The **UFI Vault membership at $3.94 USD per month** enables encrypted passwords, documents and keys now. **Subscribe for $3.94 USD / month** opens the existing Stripe checkout from **A space that’s yours**, including after the local Vault is unlocked. UFI VPN is included when service setup is complete; its panel shows **UFI VPN · setup pending** until hosting, gateways and supported client connections are available. No IP-address detection or provider provisioning has been implemented. Existing Proton/other-provider apps use their own accounts and do not activate UFI VPN.

Public creation, additions, content edits and file imports require the confirmed shared entitlement. A single billing state drives both Vault and VPN controls and is refreshed on focus and while visible. Existing owners can always unlock, read, copy, launch, export, download, restore and delete their encrypted items without an active subscription. These recovery rights are never paywalled. Passwords/files/keys remain encrypted locally and are not sent to the billing service. The synthetic local review keeps all sample controls usable and shows the disabled Subscribe button; it never grants a paid entitlement.

Billing uses the existing Stripe integration with the independent `vpn_connector` subscription slot. `STRIPE_VPN_CONNECTOR_PRICE_ID` must identify an active licensed flat USD 394-cent monthly price. Checkout also requires Stripe, webhook configuration and database availability; missing or mismatched configuration leaves checkout unavailable. Only reconciled Stripe state grants entitlement, and a success return URL does not activate membership. Reconciliation, cancellation, saved-label ownership checks and account deletion remain enabled. No existing users are automatically enrolled. Subscription management remains available in Settings. Profile labels are separate account metadata and do not establish VPN connectivity.

The owner will set up the VPN hosting account. The remaining service work is a running gateway with DNS and secured management, authenticated device enrollment and paid access provisioning, supported client setup, and verification of actual connections, cancellation/expiry and leak protection. No hosting purchase or VPN deployment is performed by this membership change. See [UFI VPN service](UFI-VPN-SERVICE.md) for the implementation proposal.

`GET /vault/vpn/locations`, `POST /vault/vpn/locations` and `DELETE /vault/vpn/locations/:id` require the signed-in account. Creating labels additionally requires the active subscription and enforces the per-user limit in a transaction. Neither API accepts VPN credentials, traffic, IP addresses or native profile IDs. Labels never enter the timestamp-only connection activity log. Production websites still do not access the synthetic local companion or claim it has a verified paid account.

### Use an existing Proton VPN subscription

Install the [official Proton VPN app](https://protonvpn.com/download) for Windows, Linux, iOS, or Android and sign in directly with Proton using your existing subscription. Choose the desired country in Proton's app and connect there. Following these links and instructions does not need a UFI subscription. Your Vault does not receive your Proton credentials or keys and cannot verify your Proton plan or connection. The official app manages Proton's country selection; the separate paid UFI Connector saves optional labels for profiles you already configured.

Enable Proton's [kill switch](https://protonvpn.com/support/what-is-kill-switch) using its platform-specific instructions. Windows and Linux GUI apps support Advanced mode for blocking traffic even after a deliberate disconnect. Android uses its Always-on VPN and Block connections without VPN settings. iOS offers a kill switch, but some Apple DNS traffic can bypass the VPN; follow Proton's documented limits. Do not assume every platform or mode behaves identically.

Proton's apps include [DNS leak protection](https://protonvpn.com/support/dns-leaks-privacy). Custom DNS settings may interfere with it. Manage protection and verify connection status in Proton's official app; UFIconnect cannot enforce or audit these settings. No unsupported Proton URL schemes or unofficial control APIs are used, and the Windows built-in IKEv2/SSTP adapter is not presented as a Proton app controller.

## Local desktop companion

This repository's local review launcher provides actual existing-profile controls. It uses a synthetic review account, not your public UFIconnect account. Your public encrypted Vault is not copied into it. Keep the companion bound to loopback; never forward its port or expose it to a LAN or the internet.

From a trusted clone of this repository with Node.js and the repository's web and backend dependencies installed:

```sh
node scripts/start-vault-review.mjs
```

Open the exact localhost URL printed by the launcher, then `/vault`. This opens a separate local review. Choose a configured profile under **Device, locations and setup**, then press the top **Connect VPN** button. No VPN is connected automatically.

- Windows: controls existing IKEv2/SSTP profiles using Windows' saved credentials and scope-specific phonebooks. Automatic, PPTP, and L2TP profiles cannot be activated here.
- Linux: requires NetworkManager and `/usr/bin/nmcli`. Controls existing WireGuard and OpenVPN profiles using UUIDs. Required VPN plugins and credentials must already be configured through the operating system. Other types remain visible but unavailable for activation.
- iOS/Android: use the installed app or operating-system profile. No native tunnel entitlement or device-management profile is supplied by this website.

Country labels map only to profiles returned by the local operating system. No country is inferred from a profile name, and no IP/geolocation lookup is performed. To change countries, disconnect the current profile, select the configured target, and connect it. The connector refuses to activate a second profile while another enumerated VPN is active or transitioning. Enable the VPN provider's kill switch before switching; this application cannot enforce it or audit routing/DNS rules.

## Request protection and privacy

The companion validates loopback Host, same-origin requests, Fetch Metadata, and a random CSRF token. Each action additionally needs a 256-bit random nonce bound to the origin, profile ID, and connect/disconnect action. Nonces expire after 30 seconds and are consumed on first use, including mismatched attempts. Pending nonces are bounded. A timestamp alone is not an anti-cloning credential.

The adapter executes fixed OS binaries without a shell, resolves each profile from a fresh OS snapshot, and confirms the resulting state from the OS. It does not accept commands, passwords, endpoints, or file paths from the browser. Linux enumeration is bounded and incomplete reads fail closed.

Connection activity is an in-memory list of at most 50 connect/disconnect request timestamps. It contains no account, country, profile name, IP address, destination, browsing data, password, or command diagnostics. It is cleared when the companion stops. This policy describes UFIconnect's connector, not logging performed by the operating system or VPN provider. Reported connection status is not an anonymity guarantee.

Hardware cloning resistance requires secure device keys and verified challenge responses; the VPN helper cannot provide it. No real VPN was activated during automated tests: OS commands were injected test doubles.

Official references: [Windows VPN](https://support.microsoft.com/windows/connect-to-a-vpn-in-windows-3d29aeb1-f497-f6b7-7633-115722c1009c), [NetworkManager nmcli](https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/nmcli.html), [Apple VPN configuration](https://developer.apple.com/documentation/networkextension/nevpnmanager), [Android VPN](https://developer.android.com/develop/connectivity/vpn), [Android existing VPN settings](https://support.google.com/android/answer/9089766).
