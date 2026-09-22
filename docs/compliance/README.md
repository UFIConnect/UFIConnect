# UFIConnect compliance readiness

Prepared September 22, 2026. **Status: readiness work in progress; management approval pending.** This package is an engineering baseline and operating plan. It is not a SOC report, ISO certificate, completed PCI assessment, or determination that a privacy law applies.

The initial source review used commit `b5942d68ca0a90fdd6509ae2f36375996f11c266`. Code observations are identified separately from production settings, operational records, and external assessments that have not been inspected. Changes made after that snapshot need their own release and evidence records. No customer data or credentials belong in these files.

The owner confirmed **UFIConnect, California, United States**, subscriptions/memberships as the payment model, no current EU serving/targeting, and no Vanta workspace. Keep GDPR as a documented future-market trigger while also checking whether any actual EU behavior monitoring or establishment changes that conclusion. Exact legal form/address, accountable people and policy approvals remain outstanding. This package is usable before buying a compliance platform.

The release operator's Stripe check reported a US account with charges, payouts and submitted details enabled; an active live Pro price of **USD $19.94/month at quantity 1** using volume tiers; an enabled webhook; and portal cancellation/payment-method updates enabled. The owner subsequently approved **Business at USD $199.94/month**; that recurring price was created and configured alongside the existing **Resume Builder at USD $149.94 per six months**. Checkout availability still requires validated backend configuration. No customer was charged during setup. These observations do not prove an end-to-end successful payment or completed PCI validation. The owner also reported Tap to Pay enabled: in-person/card-present acceptance is a separate channel and is not covered by the website's hosted-Checkout scope.

## Order of work

| Workstream | Work to start | Completion requires |
| --- | --- | --- |
| SOC 2 | Define the system boundary and service commitments; start with Security, then agree any additional trust services categories with customers and the auditor. Implement the access, incident, recovery, vendor and change procedures below. | Management ownership, evidence that controls operate, and an independent CPA examination. SOC 2 is an assurance report, not a software certification. A compliance platform helps collect evidence; it does not issue the auditor's opinion. [AICPA](https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services) |
| US privacy | Inventory processing and establish rights handling, retention, consent and vendor oversight now. Have the owner and privacy counsel record which state and sector rules apply. | Actual entity, geography, volume, revenue, data-use and age facts. Collecting US data does not automatically make every comprehensive state law applicable. Vanta currently advertises support for 19 state laws; that product coverage is not an applicability decision. [Vanta USDP](https://www.vanta.com/products/usdp), [California regulator](https://cppa.ca.gov/faq.html) |
| GDPR | Perform the scope assessment now if EU establishment, EU offerings or behavior monitoring may exist; do not wait for paid EU subscriptions to investigate. | If applicable: processing records, lawful bases and notices, processor terms, transfer assessment, rights operations, and risk-based assessments. Offering free services or monitoring people in the EU can be relevant. [European Commission](https://commission.europa.eu/law/law-topic/data-protection/reform/rules-business-and-organisations/application-regulation/who-does-data-protection-law-apply_en) |
| ISO/IEC 27001 | Reuse the same inventory, risk register, access reviews and incident evidence. Later formalize the ISMS scope, risk treatment and Statement of Applicability, internal audit and management review. | An operating information security management system; certification, if pursued, requires a separate certification-body assessment. SOC evidence can support this work but does not automatically satisfy it. [ISO/IEC 27001:2022](https://www.iso.org/standard/27001) |
| PCI DSS / payments | Keep card collection on Stripe-hosted Checkout and customer portal pages. Secure the app that creates those sessions and processes billing events. | Confirm the actual payment flow, Stripe account readiness, current provider compliance evidence and the validation method required by the acquirer/processor. Redirecting payment collection reduces exposure; it does not remove merchant responsibilities. [PCI SSC FAQ 1588](https://www.pcisecuritystandards.org/faqs/1588/), [FAQ 1439](https://www.pcisecuritystandards.org/faqs/1439/) |

Do not add compliance badges or claim “SOC 2 certified,” “GDPR certified,” or “PCI compliant” from this package. An auditor should agree the SOC report type, criteria, system description and evidence period before a completion date is promised.

## Working package

- [Engineering changes and verification](ENGINEERING-RELEASE.md): implemented subscription/privacy controls, local checks and remaining operating evidence.
- [Control and evidence register](CONTROLS.md): source-supported controls, gaps, shared framework coverage and acceptance evidence.
- [Processing and vendor inventory](DATA-AND-VENDORS.md): draft records to reconcile with actual deployments, contracts and account settings.
- [Operating procedures](OPERATIONS.md): actionable drafts for access, incidents, releases, recovery, privacy requests and suppliers.
- [Action register](actions.csv): prioritized work with proposed accountable roles, dependencies and objective closure requirements. No person has yet accepted those roles.

Start with actions `GOV-01`, `ACC-01`, `REC-01`, `PRI-01` and `PAY-01`. Run privacy scoping alongside SOC preparation. Use one restricted evidence repository with links from the action register, rather than copying raw user records into Git or a compliance tool.

## Decisions the owner must supply

1. Exact legal entity/form and business address behind the confirmed UFIConnect name in California; intended customer states; and the person accountable for security and privacy. Confirm the privacy mailbox is monitored and who covers absences.
2. Actual employees/contractors and their systems; cloud/GitHub/Stripe administrator list; whether MFA and device protections are enforced. The 71 software agents displayed in Office are not evidence of 71 employees or individual administrators.
3. Customer promises, target audit date/report type, budget and independent auditor selection. There is no Vanta workspace yet. This package does not create an account, purchase frameworks or connect employee systems.
4. Annual revenue, state-level consumer/household processing volumes, sale/sharing/targeted advertising practices, precise location or other sensitive data, intended age range, and any EU establishment/offering/monitoring. Document each decision with the applicable law and date; do not infer a person's jurisdiction solely from IP.
5. Approved retention periods; acceptable data loss (RPO) and recovery time (RTO); backup/provider plans and regions; signed vendor agreements and transfer terms.
6. Accountable Stripe operator, approval of configured products/prices, currencies/markets, refund/cancellation/tax rules and customer support contact. The requested scope is UFIConnect subscriptions/memberships; paying third-party sellers and operating Tap to Pay are separate payment channels requiring their own design and validation.

For example, California's current general business thresholds include prior-year gross revenue of at least $26.625 million, buying/selling/sharing information of 100,000 California residents or households, or at least 50% of annual revenue from selling/sharing California residents' information; other coverage rules and processor obligations also exist. Other states use different tests and exemptions. Record the assessment instead of assuming “small business” means exempt. [CPPA applicability FAQ](https://cppa.ca.gov/faq.html)

## Evidence handling and review

An evidence entry needs: control ID, system, period or collection time in UTC, source/commit or account identifier, collector, reviewer, result, exceptions and a restricted link. Use redacted access lists, configuration exports and test records; never secrets, full payment details or copied private messages. Obtain approval before granting an external compliance platform access to production or personnel data.

Statuses mean: **source-supported** (implementation inspected), **unverified** (operating evidence missing), **gap** (specific issue observed), **draft** (requires owner adoption), **verified operation** (only after linked evidence and reviewer sign-off). A passing build is evidence about that build, not about a year of operation. A historical security review is not a fresh penetration test.

Review this package at least quarterly and whenever a new market, payment channel, vendor, data category, material feature or incident changes the scope. These are proposed operating cadences, not claims that reviews have already occurred.
