# UFIConnect VPN

Updated October 6, 2026.

## iPhone and iPad

1. Install the official [WireGuard app](https://www.wireguard.com/install/).
2. Sign in to UFIConnect and open **Vault > VPN**.
3. Choose **Get VPN profile**. UFIConnect selects its Germany gateway automatically.
4. In WireGuard, import the downloaded configuration file once and approve the normal iOS VPN permission.
5. Use WireGuard's Connect/Disconnect switch.

There is no device-name form, location selector, terminal command, or custom Apple extension setup for subscribers. The downloaded file contains its private key: keep it private and delete the downloaded copy after import. Create a separate profile for another device.

The browser creates the key pair locally and sends only the public key to UFIConnect. It builds the downloaded file from the verified public gateway configuration. Private keys and files do not enter API storage, analytics, browser local storage, or connection links.

Imported profiles work independently of the UFIConnect app and browser. Signing out of the website does not stop WireGuard. Use WireGuard to disconnect, or revoke the profile in UFIConnect to remove its access.

## Subscription and revocation

An active paid UFI Vault membership is required to create a profile and carry traffic. Trial access does not qualify. The gateway rechecks current membership and receives short authorizations lasting at most five minutes. Failed payment verification removes access; the same imported profile can recover after a temporary verification outage.

Profile registration is persistent. It reserves a member slot and gateway address until explicitly revoked, invalidated by account security changes, or removed with the account. Password changes/reset and signing out all sessions revoke registrations. Temporary billing outages and ordinary website logout do not erase them. Members can list and remove their own registrations without an active subscription.

Each account may have three registered VPN devices/profiles. The approved gateway allows 100 registrations. No additional server, upgrade, or automatic capacity purchase occurs.

## Windows and Android

The prepared UFIConnect native clients support app Connect/Disconnect. The website opens them with a short-lived, single-use link tied to the signed-in account. Initial app installation, same-account sign-in, disclosure, and operating-system permission are required. The browser cannot confirm a tunnel; connection status belongs to the native app.

Native clients must keep renewing their short authorization. A gateway poll cannot renew an abandoned native client. This differs from the explicit imported-profile registration above.

The Windows package is an unsigned validation build; actual installer/UAC/tunnel testing remains required. Android needs the existing signing credential before a compatible signed update can be produced.

## Privacy and network behavior

The managed Germany gateway forwards public IPv4 traffic and resolves DNS. Both IP families are routed into the tunnel; IPv6 egress is blocked. Private networks, metadata addresses, peer-to-peer access and outbound SMTP port 25 are blocked by the gateway. The deployed configuration does not log browsing or DNS queries.

The service stores account-linked public keys, generic device labels, assigned addresses, gateway, registration mode/time, authorization and revocation state. These records support access management and account export/deletion. See the [privacy policy](https://uficonnect.org/privacy).

The separate local OS-profile adapter remains developer tooling. The product interface no longer exposes its device/location setup controls.

Implementation and deployment validation are documented in [Managed VPN launch](managed-vpn-launch-plan.md).