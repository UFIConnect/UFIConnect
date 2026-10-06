# VPN privacy and store metadata

Reviewed October 6, 2026 against the source implementation. This records the
release's data flows; it is not an App Review approval or a device test result.

## Apple requirements and release checks

[Apple's VPN guideline 5.4](https://developer.apple.com/app-store/review/guidelines/#vpn-apps)
requires organization enrollment, the Network Extension API, a clear data-use
disclosure before purchase or use, and a privacy-policy commitment concerning
sale, use and third-party disclosure. It also requires appropriate licenses for
territories where those are necessary.

- Organization enrollment is user-confirmed. Verify both signed targets' Network
  Extension and shared Keychain entitlements in the submitted archive.
- The VPN screen shows collection, purpose, retention, provider processing and
  the privacy commitment before Connect. No VPN purchase button is present.
  Keep this disclosure ahead of any future purchase flow.
- Publish the matching policy at [uficonnect.org/privacy](https://uficonnect.org/privacy)
  and use that public URL in App Store Connect. Include the VPN screen location
  and working review-account access in review notes.
- Do not claim that hosting providers or network operators receive no information.
  The API/database runs on Render, the gateway on Hetzner, and membership
  verification uses Stripe. No VPN keys, tunnel addresses, traffic or DNS queries
  are sent to Stripe by VPN membership verification.
- The implementation excludes VPN data from advertising, analytics, profiling
  and model training. The policy promises no sale or independent third-party
  use. Apple's 5.4 wording is broader than a ban on advertising: review the
  disclosed operational provider processing against that rule before submission.
  Do not replace the actual data flows with a blanket no-third-party-data claim
  or describe this checklist as establishing Apple's acceptance.
- Verify the final binary and live provider settings, supported territories and
  any required licenses before submission. A passing source test is insufficient.

## Data recorded by this implementation

| Data | Handling |
| --- | --- |
| Account ID, device ID, generic device label, public WireGuard key, assigned tunnel address and gateway | Stored with the account to authorize and route the connection. |
| Registration time, access expiry and revocation state | Stored to enforce access. Device records remain until account deletion and appear in account exports. Revoking a device stops access; it does not erase the record. |
| Device private key and renewal session | Kept in protected local device storage. The private key never enters the API or JavaScript. The session authorizes control-plane requests. |
| Network traffic and DNS requests | Processed to forward the connection. The supplied gateway configuration disables DNS query/reply logs and does not record browsing activity. Hosting/network operators still process connection information. |
| VPN screen visits, connect/disconnect state, native VPN errors, keys and destinations | Not sent to app analytics. VPN API requests do not enter aggregate response counters or the app-activity heartbeat. |

## App Store privacy answers to update

Use [Apple's App Privacy Details definitions](https://developer.apple.com/app-store/app-privacy-details/)
and the complete app inventory. These additions do not replace the social app's
existing contact, content, messaging, purchase and other disclosures.

- **User ID:** the account ID is linked to the user and used for App Functionality.
- **Device ID:** the server device ID and public connection key identify a VPN
  enrollment, are linked to the account, and serve App Functionality.
- Review **Other Data Types** for the tunnel address, gateway, device label and
  authorization records. Classify retained IP data by its actual purpose;
  an assigned tunnel address does not establish physical location.
- Do not mark the app as collecting no data. Account-linked VPN device records
  persist beyond a request, even though traffic payloads are forwarded in real time.
- The VPN integration supplies no data for tracking. Retain this answer only if
  final app and provider behavior continue to match it. Device-only private keys
  are not transmitted collection; provider retention must be checked separately.

## Verification

`node --test analytics/screenPolicy.test.js analytics/serviceMetrics.test.js`
checks the explicit VPN exclusion, no events before or after normal navigation,
and no inherited error category. Backend aggregate analytics tests check VPN
request-counter and activity-heartbeat exclusions. Native adapter tests confirm
Google collection remains inactive. Real-device network/log inspection and the
final archive's privacy manifests remain release checks.
