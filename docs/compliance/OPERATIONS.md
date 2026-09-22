# Security and privacy operating procedures

**Draft for owner approval.** No procedure, cadence or service target below is represented as adopted or already performed. The owner must assign people and backups, approve resources and record exceptions before starting an evidence period. Roles can be held by the same person in a small team, but record independent review where available and compensating review where separation is impractical.

## Access and personnel

1. Maintain a restricted roster of people and service identities for GitHub, Render/DB, DNS/edge, Stripe, email, analytics, identity providers and Office. Record role, need, owner, approver and expiry; keep tokens out of the roster.
2. For new access, approve the specific role, use an individual account, require MFA for privileged cloud accounts, and verify device encryption, updates and screen lock. Issue service credentials with minimum scope and named custodians. The shared Office token is an interim gap; do not label it individual SSO/RBAC.
3. On role change or departure, revoke unnecessary roles, active sessions and provider access promptly; rotate any shared credential the person knew and transfer ownership. Confirm completion in each system instead of relying on deleting an app account.
4. Proposed cadence: review privileged access monthly and all access quarterly; review emergency access after each use. Save the redacted roster, reviewer decision, removals and exceptions with dates. Staff/contractors acknowledge security and incident-reporting expectations at onboarding and refresh training annually.

Evidence: approved request, provider access/MFA export, device attestation, completed revocation test, review sign-off. Names, staffing levels and tooling remain to be supplied.

## Incident response

1. Assign an incident lead and alternate, engineering responder, privacy/legal decision maker, and customer/provider communication owner. Confirm `privacy@uficonnect.org` reaches a monitored channel; do not assume a policy email address proves delivery.
2. Open a restricted incident record with detection and awareness times in UTC, facts, affected systems, severity and reporter. Suspected credential exposure, unauthorized access, user-data loss and payment tampering require urgent triage; ordinary defects still receive tracked owners.
3. Preserve necessary logs and timeline with access controls and integrity metadata. Avoid posting user content, passwords, reset links or card information in tickets. Contain using the least disruptive effective step: revoke sessions/keys, disable the affected capability, restrict access, or isolate the service. Rotate credentials using a documented recovery plan for encrypted data.
4. Determine scope and whether personal data or payment data is involved. Contact relevant providers through verified channels. Privacy/legal owners decide regulator, customer, individual, insurer and processor notifications and document the basis and deadline. Do not wait for certainty to track a legal clock.
5. Recover from a verified release/backup, test core and security behavior, monitor for recurrence, and record the authorization to resume. Complete a post-incident review with contributing causes, corrective owners/dates and evidence of closure; preserve necessary material under approved retention/legal holds.

When GDPR applies, qualifying supervisory-authority notification is required without undue delay and, where feasible, within 72 hours of awareness; risk exceptions and separate individual notification duties require assessment. This is not a universal deadline for every country or incident. Use current jurisdiction-specific law and contractual terms. [GDPR Articles 33-34](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng)

Proposed cadence: test the alert route immediately after setup, run a tabletop at least annually and after material changes, and exercise a credential-exposure scenario before relying on the process. The preparation/detection/response/recovery approach is informed by [NIST SP 800-61 Rev. 3](https://csrc.nist.gov/pubs/sp/800/61/r3/final).

## Changes, vulnerabilities and releases

Record purpose, risk, data/privacy/payment impact, reviewer, tests, intended commit, rollout and rollback in the change/PR. Use locked dependencies and successful verification for the exact release. Confirm deployment completion, SHA and service health; triggering a hook is insufficient. Restrict manual Office/hosting deployment rights and record the same evidence for those releases. Emergency releases record the reason and receive a retrospective review.

Triage dependency, application and exposed-secret findings by exploitability and impact; the security owner approves remediation deadlines and temporary controls. Rotate exposed credentials, not merely remove them from source. Obtain an independent test appropriate to the system and track findings to verified closure. PCI-specific patching/scanning duties are set with the acquirer/assessor; a dependency audit is not an ASV scan.

Evidence: issue/PR, reviewer, CI run, deployment result, redacted health checks, rollback record when used, finding and retest links. Proposed cadence: review unresolved security findings weekly and after important advisories.

## Backup and recovery

1. Approve RPO/RTO for accounts, messages, resumes, billing references and public feeds separately. Inventory actual provider backups/point-in-time recovery, encryption keys, retention, access and region.
2. Configure and monitor complete database backups plus required object/media/configuration recovery. The application's optional `feed_posts_cache` snapshot does not cover the rest of the system. Keep recovery credentials separately controlled and test they can be obtained during an outage.
3. Restore into an isolated environment with email, payments, external publishing and scheduled jobs disabled. Do not restore a backup over production as a test. Check schema, representative synthetic records, authentication/revocation, token decryption, media references and billing reconciliation without creating charges.
4. Measure actual restore time and data loss against the approved targets. Reapply completed deletion/consent actions that occurred after the backup so recovery does not silently resurrect deleted accounts or permissions. Obtain review, record failures and securely remove temporary restored data under the approved plan.

Proposed cadence: monitor backup success daily; restore at least quarterly and after major storage/key changes. Evidence: backup job record, restricted snapshot reference, restore run, elapsed time/data loss, validation and owner sign-off. A green connection indicator is not a restore test.

## Privacy requests, retention and vendor changes

1. Open a restricted request record with reference, received date, request type, relevant jurisdiction/role, verification method, deadlines, owner and current status. Support access, correction, deletion, consent withdrawal and applicable opt-outs, restrictions and appeals. Do not demand identity documents where proportionate account verification will suffice; do not add verification barriers to opt-outs where prohibited.
2. Acknowledge and calculate the applicable deadline immediately. Proposed internal target: triage within two business days. GDPR generally uses one month; CCPA uses different acknowledgement, substantive-response and opt-out periods. Extensions and denials need an applicable basis and timely notice. The public policy's promises may be shorter and must also be honored. [GDPR Article 12](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng), [CPPA rights timing](https://cppa.ca.gov/faq.html)
3. Use [the inventory](DATA-AND-VENDORS.md) to locate all relevant stores. The prepared self-service download takes one database snapshot and includes owned/participant records, including attachment bytes and resume drafts; it explicitly excludes credential fields, raw security logs, browser-only preferences and independent provider records. Complete any additional legally required access through a reviewed process and protect other people's data before secure delivery. Never export password hashes, session tokens or provider secrets.
4. For deletion, check documented exceptions/legal holds, revoke access, remove eligible production records and media, notify relevant processors and address active subscription/cancellation obligations without silently continuing unwanted billing. Track retained records, purpose, access limits and expiry. Record deletion markers for backup recovery; do not promise immediate erasure of every provider backup.
5. For consent withdrawal or opt-outs, stop the relevant future processing and propagate the preference to applicable systems. Browser preferences are not automatically account-wide. Review recognized browser opt-out signals where required. Respond with completed actions and any lawful limits, and provide an appeal route where required.
6. Close only after verification, provider follow-up and response. Retain the minimum request/audit record under an approved schedule. Test with a synthetic account after relevant changes; do not exercise production erasure on real users as a smoke test.

Before a new supplier, feature or market launches, update purpose/data flow, minimum fields, rights coverage, retention, contract/DPA, security review and transfer assessment. Assess the need for a privacy/data-protection impact assessment where risk or law requires it. Reassess active critical suppliers at least annually as a proposed cadence.

## Billing operations

Use Stripe-hosted Checkout/portal; never ask support to collect card numbers or CVC. Keep test/live modes separate, use fixed server-approved prices and return origins, verify webhook signatures over the raw body, handle duplicate/out-of-order delivery, reconcile with the processor, and grant entitlements from verified server state. Restrict dashboard/refund permissions and require review for product/price changes.

Before live activation, test checkout, customer portal, renewal, failure, cancellation, retry and dispute/refund effects in Stripe's test environment; verify mobile return/navigation. Configure real webhook destinations and an alert for failed delivery, confirm support/refund/cancellation/tax terms, and complete the processor/acquirer-required validation. Keep only redacted event IDs and outcomes in evidence. A signed webhook proves its origin, not that every requested subscription has been paid.

PCI scope and SAQ selection remain decisions for the compliance-accepting entity. PCI SSC distinguishes embedded forms from redirects for a specific SAQ A script eligibility condition; this distinction does not remove other requirements from a redirecting merchant website. [PCI SSC FAQ 1588](https://www.pcisecuritystandards.org/faqs/1588/)
