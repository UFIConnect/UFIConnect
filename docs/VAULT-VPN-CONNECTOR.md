# Your Vault VPN connector

Your Vault uses a VPN app or profile you already configured. The VPN settings built into an operating system are clients: they need a trusted provider or organization’s server, profile, and credentials. They do not provide country endpoints by themselves.

## Public website

Open **Your Vault → Your VPN**, choose Windows, Linux, iOS, or Android, then use **Connect using device settings**. Windows also has a direct system-settings link. iOS, Android, and Linux show the correct settings/app steps and official platform guidance. No unsupported private settings URL schemes are used.

The public website does not claim to create a tunnel or detect VPN status. It does not probe localhost or expose the local companion to public origins. Country selection is based only on existing profile locations confirmed by the user. Choosing a country prepares the matching profile instructions; switch the actual connection in the VPN app/settings. Labels stay in memory for the visit and are not transmitted or persisted.

### Use an existing Proton VPN subscription

Install the [official Proton VPN app](https://protonvpn.com/download) for Windows, Linux, iOS, or Android and sign in directly with Proton using your existing subscription. Choose the desired country in Proton's app and connect there. Your Vault does not need another subscription, does not receive your Proton credentials or keys, and cannot verify your Proton plan or connection. The official app manages Proton's country selection; Vault's optional country labels are only shortcuts to the instructions for profiles you already configured.

Enable Proton's [kill switch](https://protonvpn.com/support/what-is-kill-switch) using its platform-specific instructions. Windows and Linux GUI apps support Advanced mode for blocking traffic even after a deliberate disconnect. Android uses its Always-on VPN and Block connections without VPN settings. iOS offers a kill switch, but some Apple DNS traffic can bypass the VPN; follow Proton's documented limits. Do not assume every platform or mode behaves identically.

Proton's apps include [DNS leak protection](https://protonvpn.com/support/dns-leaks-privacy). Custom DNS settings may interfere with it. Manage protection and verify connection status in Proton's official app; UFIconnect cannot enforce or audit these settings. No unsupported Proton URL schemes or unofficial control APIs are used, and the Windows built-in IKEv2/SSTP adapter is not presented as a Proton app controller.

## Local desktop companion

This repository's local review launcher provides actual existing-profile controls. It uses a synthetic review account, not your public UFIconnect account. Your public encrypted Vault is not copied into it. Keep the companion bound to loopback; never forward its port or expose it to a LAN or the internet.

From a trusted clone of this repository with Node.js and the repository's web and backend dependencies installed:

```sh
node scripts/start-vault-review.mjs
```

Open the exact localhost URL printed by the launcher, then `/vault`. This opens a separate local review. It does not connect any VPN until you select a currently configured profile and press **Connect selected profile**.

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
