# Public pages and compliance controls — October 5, 2026

This release responds to the six screenshots supplied by the owner. It updates public explanations and engineering controls. Publishing policies, passing software checks or submitting an OAuth review does not establish legal certification, source licensing or Google approval.

## Operator identity

The owner identified the business as **UFIConnect**, operating under a doing-business-as name in **California, United States**, and reported filing a DBA statement. This release does not represent UFIConnect as a corporation or independently verify that filing. A legal owner name, business postal address and registered DMCA agent contact have not been confirmed.

Existing contact addresses used by the site are `support@uficonnect.org` and `privacy@uficonnect.org`. Their delivery and monitoring need operational confirmation; including a mail link does not verify a mailbox.

## Screenshot coverage

| Screenshot | Request or issue | Pages and controls |
| --- | --- | --- |
| 1: separate source adapters | Preserve provider-specific permissions, attribution, actions, caching, deletion and analytics rules. | `/policies#connected-services` explains permissions and source ownership. The existing backend source capability registry and provider handlers remain separate, with display/access controls, authorized interaction checks, original-link validation and official-player restrictions. The homepage qualifies source availability and makes no partnership claim. This is not a completed legal or retention audit of every connector. |
| 2: copyright/DMCA system | Notice, counter-notice, repeat infringement, reports and evidence. | `/copyright` provides a no-account complaint contact, notice contents, counter-notice instructions, repeat-infringement policy and records disclosure. The shared Report menu includes copyright and non-consensual intimate imagery categories; backend report storage and the restricted Office queue support operator review. Quick reports are explicitly distinguished from formal DMCA notices. Agent designation and legal case operations remain owner actions below. |
| 3: adapter boundaries and final policy items | Source-specific rules plus retention, incidents, age and advertising. | `/policies` links the full set of policies, with dedicated anchors for retention, security, age and advertising. `/privacy` describes the actual storage lifecycle and separates Google Analytics consent from homepage Google Ads consent. Global Privacy Control keeps both optional integrations off. |
| 4: fifteen-document checklist | Terms, privacy, community, copyright, acceptable use, developer/API, cookies, connections, trademarks, legal requests, moderation, retention, security, age and sponsored content. | Existing `/terms`, `/privacy` and `/child-safety` are updated. `/copyright` covers copyright requests. `/policies` covers community, acceptable use, reports/appeals, connections/attribution, developer/API access, legal requests, retention, incidents, age and advertising. These are public without signing in. |
| 5: privacy and connected data | Explain accessed data, uses, sharing, choices and deletion. | `/privacy` covers account and provider sign-in data, encrypted connection credentials, requested YouTube scopes and metrics, member content, AI inputs, reports, billing, local Vault storage, tracking choices, access/export/deletion and California rights where applicable. Auth0 sign-in is conditional and separate from authorizing YouTube features. `/policies#retention` corrects the previous unsupported universal cache, log and deletion deadlines. |
| 6: Google OAuth verification rejection | Explain the app's purpose, prohibit AI-generated non-consensual intimate imagery, and use a distinct brand. | The homepage explains social/professional discovery, optional connections and Google data use, links Terms/Privacy, identifies the operator location and explicitly prohibits non-consensual intimate imagery. New UFIConnect brand assets include the downloadable OAuth logo below. Updating the Google Console and requesting re-verification remain owner actions. |

Public product additions are `/vault-device`, which separates the available browser Vault from the planned hardware and unavailable VPN connections, and `/how-office-works`, which illustrates restricted Office operations without exposing live internal data. A Business membership does not grant Office access.

## Google OAuth Console: owner steps after deployment

1. Open the Google Cloud project containing the OAuth client shown in the rejection. In **Google Auth Platform → Branding** (or the project's **OAuth consent screen** branding settings), set the app name to **UFIConnect**. Select the monitored support email and confirm developer contact addresses.
2. Download [the UFIConnect OAuth logo](https://uficonnect.org/uficonnect-oauth-logo.png). Upload this **512 × 512 PNG** as the app logo. It replaces the former blue UFI badge; do not upload the page screenshot or a third-party source mark.
3. Enter the public application URLs exactly:
   - Homepage: `https://uficonnect.org`
   - Privacy Policy: `https://uficonnect.org/privacy`
   - Terms of Service: `https://uficonnect.org/terms`
4. Confirm `uficonnect.org` is an authorized domain and complete any ownership verification requested for the project. Keep the app name, logo and domain consistent across the website and consent screen. Do not change OAuth redirect URIs without checking the configured callbacks.
5. Review **Data Access** against the scopes the app actually requests. Ordinary sign-in and optional YouTube read, interaction and analytics authorizations are distinct. Remove unused requested scopes; do not claim Google has approved a feature merely because its code is installed.
6. Save the branding changes. Return to the verification issue, choose **I have fixed the issues**, and submit the requested re-verification materials. Use the public homepage and policies to explain the real features and data flows. Provide a demonstration or test access if Google requests it.
7. Wait for Google's review and respond to its findings. Deployment and an accepted Analytics/Ads request do not approve OAuth branding or sensitive scopes. Google Ads conversion counts are unrelated to this branding decision.

No Console update or verification submission is performed by adding this document. The owner must complete and confirm those steps in the correct project.

## Operational work still required

- **DMCA designation and legal identity:** Confirm the responsible legal owner and postal contact. If relying on the relevant U.S. safe-harbor process, appoint and register the designated agent, then publish matching agent contact details and keep the registration current. The website does not claim that an agent has been registered.
- **Complaint handling:** Assign reviewers and a mailbox/Office queue review cadence. Decide how notices, counter-notices, correspondence, evidence, actions and reversals are recorded, how claimants and affected members are contacted, and how repeat infringement is assessed. An in-app report or a resolved status alone does not establish the complete statutory notice-and-takedown workflow.
- **Retention and preservation:** Confirm production hosting logs, backups, provider records, archive settings and deletion procedures. The stated default feed/archive periods are engineering defaults, not a verified snapshot of every production setting. Define retention for safety reports, formal legal cases and support correspondence. Establish legal-hold authorization, access restrictions, expiry/review and release procedures; a policy paragraph does not implement preservation across databases, backups and mailboxes.
- **Source approvals and adapters:** Record approved provider products, scopes, allowed uses and current agreements per connector. Audit each provider's caching, removal, display, safety-label and analytics requirements. Registry switches and source-specific handlers do not themselves grant platform access or prove every lifecycle obligation is implemented.
- **Age eligibility:** The published rule is 13+, or 16+ in the EU/EEA/UK, and any higher applicable local minimum. Age eligibility is a user declaration, not verified age. Existing signup has no enforced age-verification system; policy text or a checkbox must not be represented as identity or age verification. Decide the appropriate registration safeguards and handling of known underage accounts.
- **Privacy and incidents:** Verify support/privacy email delivery, reviewer access and incident escalation. Validate provider agreements and actual deployment settings against the disclosures, including separate tracking choices. Determine applicable legal obligations with qualified advice; the pages do not certify CCPA, GDPR, COPPA or any other legal regime.

## References used for the wording

- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
- [Google APIs Terms of Service](https://developers.google.com/terms)
- [U.S. Copyright Office: section 512 resources](https://www.copyright.gov/512/index.html)
- [17 U.S.C. § 512](https://www.govinfo.gov/content/pkg/USCODE-2024-title17/html/USCODE-2024-title17-chap5-sec512.htm)
- [California Attorney General: CCPA information](https://oag.ca.gov/privacy/ccpa)
