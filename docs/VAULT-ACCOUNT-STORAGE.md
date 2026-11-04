# Encrypted Vault account storage

Vault passphrases and plaintext entries remain on the client. The existing
PBKDF2/SHA-256 (600,000 iterations) and AES-GCM format is unchanged.
`account_vaults` stores one portable encrypted envelope per authenticated user,
with a revision and timestamp. Device/Face ID wrappers are not uploaded.

Render remains the primary PostgreSQL database. This change does not alter
database routing, Cloudflare configuration, or Google replication. Runtime
migration creates the table after `users`; no existing vault is reset. Database
outages return 503 rather than an empty vault or an in-memory successful save.

`GET /vault/storage` reads only the signed-in user's row. `PUT /vault/storage`
accepts only a bounded encrypted envelope and expected revision. Authentication
(including the existing cookie-origin protection) precedes body parsing. Atomic
revision comparisons reject stale writes with 409. Exact ciphertext retries
are idempotent after a lost response. Requests and errors do not log envelopes.
Responses are private/no-store. Account deletion cascades; the encrypted record
is included in the owner's account export, never Office analytics.

The shared website/native Vault checks account storage before creating a vault.
A missing device copy is restored from the account. An existing device-only
record is uploaded only after successful passphrase or device verification.
Never silently claim the legacy unscoped vault or another account's storage.
Device storage remains available for offline reads and encrypted export.
Writes require a confirmed database commit; a pending journal of ciphertext
hashes covers lost responses without duplicating large vaults in browser storage.
Only a previously synchronized, unchanged local copy follows a
newer server revision automatically. Divergent copies require the user to save
the device copy and explicitly choose the account copy. Restoring a backup
replaces the account copy only after successful decryption and the existing
backup/confirmation flow. Keep downloaded backups independently.

Roll out the backend/schema before the website. Website updates do not update
an installed native binary; ship a signed app built from this shared source.
Old app versions still save only locally and can diverge from the account copy;
the updated client preserves those copies rather than silently overwriting them.
Rollback must retain `account_vaults`: older clients cannot fetch it, but the
encrypted account data remains available for a forward fix. Never drop the
table or clear local storage as a rollback step.

Existing undecryptable records cannot be repaired by adding server storage.
This change does not recover a forgotten passphrase or manufacture a lost key.

Validation includes PostgreSQL compare-and-swap, account isolation/deletion,
strict envelope/body validation, offline reads, failed and lost-response saves,
cache eviction, second-device reads, stale/conflicting writes, backup restore,
session changes, and browser autofill/recovery/file/privacy regressions. All
fixtures use synthetic accounts and records; no user passphrases are collected.
