# UFI Vault server verification prototype

This implementation follows **Security Architecture.pdf**, UFI Vault Security Architecture v0.1, prepared 27 September 2026. The supplied design is a build baseline. It does not certify the software or demonstrate that secure hardware is connected.

The existing `/vault` page continues to store encrypted passwords in the account's browser storage. Its passphrase, optional browser device unlock, encrypted backup, automatic lock, and local Windows VPN companion keep their existing behavior. The new hardware status panel reports the optional server verifier's availability. Browser vault contents are never sent to this verifier, analytics, monetization, or learning services.

## Implemented server controls

`backend/ufi-vault.js` is an optional, disabled-by-default device verification prototype:

- Generates a fresh 32-byte challenge with a 60-second server deadline. Stores its hash and bound context, without the raw nonce.
- Binds assertions to protocol, account, relying party, allowed origin, action, parameter hash, credential, challenge, and expiration. Both signed user presence and user verification are required.
- Supports only `enroll_device` and `verify_device`, with empty parameters. A successful response reports device verification; it issues no login session, reusable action receipt, VPN authorization, or permission to decrypt browser data.
- Verifies Ed25519 signatures using a public key. Algorithm and protocol versions are fixed. This suite is a prototype choice pending secure-element capability and independent cryptographic review; it is not WebAuthn or CTAP.
- Requires an injected attestation verifier for enrollment, plus an exact model, firmware measurement, and environment allowlist. There is no development bypass or permissive attestation implementation.
- Accepts only SPKI public-key PEM. Private-key PEM is rejected. No production private key is generated or persisted by this module.
- Consumes account-owned challenges in a committed SQL statement before validation. Signature, origin, schema, expiry, audit, transaction, and attestation failures cannot restore a spent challenge.
- Serializes ceremonies by account using PostgreSQL advisory locks. Only one unfinished ceremony per account is permitted. This avoids interpreting concurrent approved responses as clone signals.
- Locks credentials and commits counter, signed RTC, verification time, and audit event changes together. Counters are unsigned 64-bit decimal strings, preserving precision above JavaScript's integer limit.
- Rechecks and locks the authoritative account row during challenge creation and verification, preventing a delayed enrollment from recreating credentials after account deletion.
- Rejects signed RTC values more than 60 seconds from server receipt/commit time. A valid, correctly bound signature with a repeated/lower counter or RTC rollback quarantines the credential. Invalid signatures cannot quarantine a device.
- Rejects revoked, quarantined, unapproved-model, unapproved-firmware, wrong-environment, and other-account credentials. A trusted administrative revocation method consumes outstanding challenges.
- Requires authentication and rate limiting on every registered endpoint. Errors omit cryptographic material, counter values, credential existence, database messages, and attestation details.
- Stores only public verification material and bounded security metadata. It does not store vault ciphertext or plaintext, PINs, device keys, recovery material, NFC transcripts, or VPN history.

## Integration

```js
const { createUfiVault, registerUfiVaultRoutes } = require('./ufi-vault');
const vault = createUfiVault({
  db,
  enabled: process.env.UFI_VAULT_ENABLED === 'true',
  relyingPartyId: 'uficonnect.org',
  allowedOrigins: ['https://uficonnect.org'],
  environment: 'production',
  firmwarePolicy: [], // Empty until reviewed hardware builds are approved.
  // attestationVerifier: reviewedManufacturerAdapter,
});
await vault.initialize(); // After the primary database connects; never uses memory fallback.
registerUfiVaultRoutes(app, { vault, authenticate: requireAuth, limiter: vaultLimiter });
```

Use account and network rate limits appropriate to the deployment. Request parsing at the API edge must also cap JSON body size. Assertion validation limits the recognized body to 16 KiB and eight nested levels. Origins must be HTTPS and match the relying party hostname or its subdomains. HTTP loopback origins are accepted only with the explicit `development` environment.

Initialization creates the three exported `UFI_VAULT_SCHEMA` tables only when enabled and the database is connected. An empty policy, missing origin/RP configuration, missing database, or failed initialization leaves verification unavailable. Missing attestation verification always blocks enrollment.

| Endpoint | Behavior |
| --- | --- |
| `GET /security/vault/status` | Authenticated account's coarse status/counts; no keys, counters, nonce, attestation serial, or credential identifier |
| `POST /security/vault/challenges` | Accepts exactly `{ action, credentialId, parameters: {} }`; enrollment uses `credentialId: null` |
| `POST /security/vault/assertions` | Accepts exactly `{ challengeId, assertion, signature }`; enrollment also requires `attestation` |

The assertion is the returned context plus `issued_at_rtc` (integer Unix milliseconds), `monotonic_counter` (canonical decimal string), `firmware_measurement`, `user_presence: true`, and `user_verification: true`. For enrollment, replace the null `credential_id` with the identity proved by the manufacturer's attestation. Sign the bytes returned by `assertionBytes(assertion)` and encode the 64-byte signature as unpadded base64url. The helper uses sorted JSON fields and domain separation. Unknown fields and protocol versions are rejected. The server's displayed `serverTime` is informational; signed hardware clock calibration is still pending.

The `attestationVerifier` adapter receives `{ evidence, assertion, context, environment }`. Before returning, it must verify the manufacturer's trust chain or equivalent proof, manufacturer/model revocation, firmware evidence, production environment, non-exportable key identity, fresh nonce, full enrollment context, and enrollment confirmation. It must apply bounded parsing, deadlines, and network limits internally. On failure it must throw or return an unverified result. Only after all checks may it return:

```js
{
  verified: true,
  credentialId, publicKey, model, firmwareMeasurement, environment,
  challengeHash, // SHA-256(base64url server_challenge string), encoded as base64url
}
```

The server separately verifies proof of possession with that public key. Supplying a caller-controlled `verified: true` or accepting unvalidated manufacturer evidence is prohibited. The repository intentionally includes no adapter that would make such a claim. Test fixtures use explicitly labeled software keys and mocks.

## Operations and privacy

Call `vault.prune()` from the primary database maintenance job when the verifier is enabled/configured. It deletes challenges more than one day beyond their expiry and security events older than 30 days. Credentials remain until account deletion or an approved lifecycle procedure. Export/deletion integrations must cover `ufi_vault_credentials`, `ufi_vault_challenges`, and `ufi_vault_security_events`, scoped by `account_id`. Keep security event access separate from product analytics; never join credential material into model training or advertising reports. These prototype retention defaults require review before hardware launch.

`vault.revokeCredential(accountId, credentialId)` is an internal administration integration point, not a public recovery bypass. Call it only after independent authorization. Revocation immediately blocks new assertions and consumes outstanding challenges. The module issues no sessions; a future session issuer must explicitly link and invalidate device sessions on revocation, key rotation, or recovery.

Audit inserts share the credential transaction; failed audit writes abort verification. Database role restrictions and export to independently controlled append-only storage remain operational work. Firmware policy changes require configuring/restarting the verifier. A production revocation feed must be added before any hardware rollout.

## Release gates still pending

Physical secure-element selection and review; non-exportable device keys; secure boot and signed firmware with rollback protection; actual manufacturer attestation and model revocation; trusted user confirmation; authenticated/encrypted NFC pairing and bounded messages; per-device VPN keys and VPN leak tests; signed RTC calibration; independent recovery and lost-device response; HSM-backed server signing; device session revocation; independently protected security audit export; and independent protocol, mobile, backend, and hardware assessments.

The existing browser vault must not be represented as satisfying these hardware guarantees. Do not enforce this prototype on existing logins until devices, enrollment, independent recovery, and incident exercises are complete. Keep `UFI_VAULT_ENABLED` off in public deployment until its configuration and adapters are reviewed.

## Validation

`node --test ufi-vault.test.js` runs cryptographic assertions against the actual PostgreSQL schema using PGlite. Tests cover disabled defaults, verified enrollment, replay, failed-attempt consumption, signature tampering, all approval bindings, account isolation, expiry, signed RTC, unknown fields, concurrent replay, one pending ceremony, counter/clock quarantine, revocation, atomic rollback, invalid attestation/firmware/private keys, database failure, metadata retention, and authentication/rate-limit registration. In environments that prohibit test subprocesses, use `node --test --test-isolation=none ufi-vault.test.js`.
