# UFIConnect managed VPN launch

Updated October 6, 2026. The approved single Germany gateway has been created and its Linux tunnel checks passed. Native client validation remains in progress.

## Approved first gateway

| Setting | Value |
| --- | --- |
| Provider | Existing Hetzner Cloud project |
| Server | One CX23: 2 x86 CPU cores, 4 GB RAM |
| Region | Falkenstein, Germany (`fsn1`) |
| Operating system | Ubuntu 24.04 |
| Network | Public IPv4, WireGuard UDP 51820 |
| Base monthly cost | $6.49 server + $0.60 IPv4 = **$7.09 USD** |
| Included traffic | 20 TiB per month, per the account API |
| Excess traffic | $1.20 per TB, per the account API |
| Scaling | No automatic server creation, upgrades or paid backups |

The owner approved the $7.09 monthly gateway. Prices were rechecked against the authenticated account API before creation; the account VAT rate was zero. The recurring charge has started. No extra server, upgrade or paid backup was created.

One gateway is shared by subscribers. Each account may enroll up to three devices; the first gateway will permit at most 100 enrolled devices. This is an enrollment limit, not a tested throughput claim. More regions require a separate capacity and cost decision.

## Subscriber experience

On iPhone and iPad, the member downloads a ready-made WireGuard profile, imports it into the official WireGuard app once, and uses that app's Connect/Disconnect switch. Germany is selected automatically. The browser generates the private key locally and places it only in the downloaded configuration file; the API receives its public key. The owner chose this flow instead of completing a custom iOS VPN extension.

The prepared Android and Windows native clients generate their own private keys and request enrollment after the server verifies an active paid VPN entitlement. The user approves the operating system VPN permission, then uses Connect and Disconnect inside the app. A browser tab cannot start a device VPN itself.

The API stores device public keys, assigned tunnel addresses and revocation state. Native client private keys stay in platform-protected local storage. Downloaded WireGuard configurations contain a private key and must be kept private; delete the downloaded copy after import. The cloud API token remains with the operator; clients and the gateway never receive it.

The gateway polls the API using a separate gateway credential. Authorized peers receive short leases. An independent watchdog removes expired peers if the API or billing checks fail. Revoked devices cannot renew themselves. Expiry enforcement is bounded by the polling and watchdog intervals.

Gateway polling uses the authenticated Render API origin
`https://uficonnect-api-708r.onrender.com`. The public API hostname encountered
a Cloudflare browser challenge on October 6, including requests from the gateway.
The direct origin was verified to return current authenticated desired state.
Gateway credentials and all peer validation remain required; redirects are rejected.
Native clients use `https://api.uficonnect.org`, whose edge policy must permit
their API requests without a browser challenge. A running timer or a successful
oneshot exit does not prove polling works: verify fresh desired-state timestamps
and the agent's `updated` outcome, because safe closure also exits successfully.

After the owner disabled the edge challenge, public API health returned HTTP 200
from both the operator network and Germany at 08:05 UTC on October 6. Protected
VPN routes again returned JSON authentication errors rather than challenge HTML.
The gateway's current authenticated desired state and active timers also passed.

## Gateway setup and checks

The reviewed cloud-init definition installs WireGuard, a private DNS resolver, a firewall and serialized synchronization/expiry timers. SSH is restricted to the operator's current IPv4 address and an Ed25519 key. Private key files and gateway credentials are readable only by root.

The firewall blocks peer-to-peer traffic, private/metadata destination networks, outbound SMTP port 25 and IPv6 forwarding. Clients route IPv4 and IPv6 into the tunnel; public IPv4 exits through the gateway. DNS queries and browsing activity are not logged by the supplied configuration.

Before enabling subscriber enrollment, verify the live Linux firewall and services, enrollment/renewal/revocation, lease expiry during an API outage, DNS, IPv6 behavior, real WireGuard handshakes and the health endpoint reachable only inside the tunnel. Validate each native client on its supported operating system. Source-level tests do not establish that a real device tunnel works.

The isolated Linux namespace check passed on October 6: a real WireGuard handshake, internal health, gateway DNS, public IPv4 egress, blocked metadata access and IPv6, and removal of an expired peer by the deployed watchdog. The test peer and namespace were removed and synchronization timers restored. No subscriber was enrolled for this test. Windows installer/device and iOS/Android device checks remain separate.

## Release dependencies

- Completed: cloud cost approval, bootstrap repair and Linux gateway validation.
- Backend routes, schema, privacy export and production gateway configuration.
- A new signed iOS build with the WireGuard profile flow; the custom Network Extension is omitted so its separate signing profiles are unnecessary. The earlier delivered IPA remains a non-VPN build.
- Android native build and device validation.
- Windows client packaging, WireGuard integration and device validation.
- Native App Store screenshots and account-owned submission fields.

No App Store submission, extra paid build plan or additional cloud resource is included in this proposal.

## One-click connection from the website

On Windows and Android, the production Vault button requests a connection link for the installed UFIConnect app. The native app signs in to the same UFI account, redeems the link, and calls its existing Connect operation. Installation, sign-in and the operating system's VPN permission are initial setup steps. The website does not report Connected; the native app verifies the actual tunnel and handshake.

Connection links contain a random, single-use code valid for at most three minutes. The API stores its hash, account, platform, originating session and expiry. Redemption requires an independently authenticated native session for the same account and platform, current paid access, and an unchanged originating account/session. Replayed, replaced, expired or mismatched links cannot connect. Private VPN keys and login tokens never appear in the link. Explicit sign-out and account-wide revocation clear the relevant authorization; account deletion removes pending links.

## Imported WireGuard profile authorization

Imported profiles have explicit persistent registrations, distinct from native clients' short-lived enrollment. The gateway checks current paid access on each poll and issues authorizations lasting no more than five minutes. It may renew a profile registration without an open UFIConnect app. It must never renew an abandoned native client this way.

Ordinary browser sign-out and temporary billing outages do not erase an imported profile. The gateway excludes it whenever payment cannot be verified; the same profile can recover after a transient outage. Explicit profile removal, password changes/reset, sign-out-all and account deletion revoke access. Registrations reserve one of the member's three slots and a gateway address until removal or security revocation. This preserves import-once behavior and means inactive profiles count toward the gateway's 100-registration limit. No automatic capacity purchase occurs.
