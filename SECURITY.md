# UFIconnect security

## Reporting a vulnerability

Report suspected vulnerabilities privately to **privacy@uficonnect.org**. Include the affected screen or endpoint, a reproducible example using a test account, and the impact. Do not send passwords, access tokens, private messages, or other members' personal data. Do not post an unpatched vulnerability or credentials in a public issue.

## Security baseline

The implementation and release checks are documented in [the September 2026 security review](docs/SECURITY-2026-09-15.md). The baseline covers passwords, session revocation, reset-token isolation, private profile fields, native secure storage, encrypted connected-account credentials, and browser protections.

Password entry supports explicit Show/Hide and password managers. Password changes require current-password verification, reject unchanged and common new passwords, and revoke earlier sessions after successful persistence. These controls follow OWASP/NIST password guidance; they do not establish parity with another platform's overall security. Local MFA/passkeys and production operational controls remain release-planning work described in the review.

Security settings describe implemented controls. A successful build, a dependency audit, or a dashboard indicator is not a penetration test or certification. Do not publish a claim that the platform is leak-proof, independently certified, or has passed a vulnerability scan without evidence for that claim.

## Development and releases

Optional Google Analytics uses consent, fixed page categories and a separate
origin that cannot read the app's content. See [analytics activation and privacy
boundaries](docs/GOOGLE-ANALYTICS.md). Keep Google scripts out of the application
document and do not add personal data to analytics events.

- Use Node.js 24 and the committed dependency lockfiles. Install with `npm ci`.
- Run the security regressions and the normal verification workflow before release.
- Keep secrets in the deployment secret store. Never put passwords, signing keys, tokens, or `.env` files in source, screenshots, logs, build arguments, or browser bundles.
- Before production deployment, complete the configuration and credential-rotation steps in the review. Roll out the backend and clients together; legacy sessions are intentionally invalidated.
- Treat a newly discovered or previously committed credential as exposed. Removing it from the current source does not revoke it or remove it from history.

## References

The baseline uses [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [browser-storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html), and [logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html). It does not assert full OWASP ASVS or regulatory compliance.
