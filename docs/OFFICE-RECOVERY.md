# Office recovery

## What is protected

Office code drafts retain the current encrypted draft and up to ten earlier versions. Production code recovery points are a separate manifest of exact source commits, successful verification receipts, and successful deployments across API, pipeline, Office, and web.

The operator recovery tool captures all `public.office_*` tables in one consistent PostgreSQL snapshot. This includes task state, conversations, memory, tools, provider connections, device state, topic controls, and Office audit history. Existing encrypted fields remain encrypted inside an additional authenticated encrypted archive.

The archive excludes the main application's account, message, feed-cache, and other non-Office tables. User UUIDs are included only as foreign-key dependency placeholders for the isolated drill; they do not restore member accounts. Full primary-database recovery remains a separate managed PostgreSQL procedure.

## Capture an encrypted Office snapshot

Use Node24 and install the backend dependencies. Load `DATABASE_URL` and `OAUTH_TOKEN_ENCRYPTION_KEY` through the existing protected operator environment. Preserve the encryption key in the established secrets manager; never paste it into commands, logs, source, or reports.

```sh
node scripts/office-ai-recovery-drill.mjs capture
```

Optional settings:

| Variable                                     | Meaning                                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `OFFICE_RECOVERY_DIRECTORY`                  | Protected archive/report directory; defaults to `.cache/office-recovery`                                                                    |
| `OFFICE_PG_DUMP_PATH`                        | PostgreSQL18-or-compatible `pg_dump` binary; Windows defaults to the existing local PostgreSQL18 tools, other systems use `pg_dump` on PATH |
| `DATABASE_PRIMARY_SSL_CA`, `DATABASE_SSL_CA` | Existing trusted database CA settings                                                                                                       |
| `DATABASE_PRIMARY_SSL_SERVERNAME`            | Existing verified database TLS hostname when connecting through an IP                                                                       |

The capture uses a read-only, repeatable-read exported snapshot and certificate-verified TLS. The dump has a three-minute deadline, database statements have a three-minute timeout and five-second lock timeout, and snapshot size is bounded to256MiB. The dump is compressed and encrypted with AES-256-GCM using a purpose-specific HKDF key, unique salt and nonce, and authenticated metadata. SQL and encryption keys are not written as plaintext. The private directory is restricted to the current Windows identity, SYSTEM and administrators, or mode0700 on POSIX. Keep the encrypted archive separate from its key.

Up to ten real snapshots are retained; older matching Office archives are removed only from the explicitly configured private archive directory. The directory is under the ignored `.cache` tree by default. Do not commit backup files.

## Run an isolated restore drill

Install backend development dependencies so PGlite is available. Supply the archive's original protected encryption key. Database connectivity is not required for verification.

```sh
node scripts/office-ai-recovery-drill.mjs verify office-<saved-timestamp-and-id>.ufirec
```

Verification decrypts the archive in memory, restores Office tables into a new in-memory PGlite database, and compares every table's row count and order-independent checksum plus all Office constraint definitions. It also verifies that damaged ciphertext and a wrong key are rejected. Temporary user UUID placeholders permit Office foreign-key validation without copying account data. No production restore command is implemented by this tool.

Native Windows plain-dump stdout uses CRLF text transport. The verifier removes that transport mapping once, preserving both original LF and original CRLF values. Psql-only `\restrict`/`\unrestrict` wrappers are removed before executing the SQL through the isolated JavaScript client. No business rows or constraints are omitted to make a drill pass.

## Production code recovery

Refresh the ten-point source/deployment manifest using protected `RENDER_API_KEY`, optional GitHub read credential (`OFFICE_GITHUB_TOKEN` or `AUTOFIX_GITHUB_TOKEN`), and the four `RENDER_SERVICE_{API,PIPELINE,OFFICE,WEB}_ID` settings:

```sh
node scripts/office-ai-recovery-history.mjs
```

This read-only command requires ten distinct exact commits with successful Verify runs and successful historical deployment receipts across all four services, verifies their immutable GitHub source trees remain accessible, and records the evidence with a SHA-256 manifest digest. It does not initiate a build, rollback, database change, or provider-plan change.

For each retained source-rebuild recovery point, retain the full commit SHA, tree SHA, exact successful Verify run, and each service's successful deployment receipt. The operator must check current database compatibility and preserve required secrets/environment settings before a real restore. GitHub source availability and historical deployment receipts prove a rebuild source exists; they do not prove Render still retains a fast-rollback artifact.

Render's fast rollback uses a retained build artifact; retention depends on the workspace plan. Its rollback API does not disable automatic deployments, so the normal main release flow can otherwise deploy the undesired code again. Never perform a live rollback merely as a drill. An emergency rollback is a separate operator action; this verification tool never submits it.

Render reports the primary database's current PITR availability independently. A configured recovery window does not prove that a complete database restore was exercised. Restore full primary data into a new isolated instance and validate it before directing production traffic to it.

References: [Render rollbacks](https://render.com/docs/rollbacks), [Render PostgreSQL recovery](https://render.com/docs/postgresql-backups), [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html).

## Authenticated offsite copy

The existing Cloudinary account can hold encrypted Office archives as `raw` assets with `authenticated` delivery. The operator helper splits an archive into parts of at most8MiB so the existing10MiB raw-file limit is respected. Each part has a deterministic archive-specific identifier under `office-recovery/`, `overwrite:false`, its own SHA-256 metadata, and the complete archive's SHA-256 identity. The helper checks quota before writing; it never changes an account plan, creates a storage account, uploads SQL, or uploads a decryption key.

```sh
# Plan only; no upload is performed.
node scripts/office-ai-recovery-offsite.mjs office-<saved-timestamp-and-id>.ufirec
# Upload ciphertext, reject unsigned access, re-download and verify the restore.
node scripts/office-ai-recovery-offsite.mjs office-<saved-timestamp-and-id>.ufirec --upload
```

Load the existing protected Cloudinary connection (`CLOUDINARY_URL`, or `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`) in the operator environment. Uploaded parts must report `raw/authenticated`; unsigned requests must be denied with401,403 or404. After signed re-download, the tool verifies every part, the full ciphertext SHA-256, AES-GCM authentication, and a complete isolated Office restore. Signed delivery URLs and API credentials are never written into the report. An interrupted upload is reconciled by a read of its unique object identity, without blindly repeating the write.

The account's existing customer/media assets are unaffected. Offsite objects are not deleted automatically by this helper. Snapshot creation and offsite upload are explicit operator actions; the tools do not install a scheduler.

## Archive-specific Windows key escrow

Preserve the global application encryption key in the existing protected secrets manager. For an additional recovery path during a Render API/key-vault outage, a Windows operator can escrow only the selected archive's derived key:

```sh
# Requires the existing protected global key only during creation.
node scripts/office-ai-recovery-key.mjs create office-<saved-timestamp-and-id>.ufirec
# Requires the original Windows user profile; does not need the global key.
node scripts/office-ai-recovery-key.mjs verify office-<saved-timestamp-and-id>.ufirec office-<saved-timestamp-and-id>.ufirec.key.dpapi.json
# Retrieve the authenticated offsite copy and restore in memory without Render,
# the global key, database connectivity, or the original local archive.
node scripts/office-ai-recovery-key.mjs restore-offsite office-<saved-timestamp-and-id>.ufirec office-<saved-timestamp-and-id>.ufirec.key.dpapi.json
```

The escrow contains a DPAPI CurrentUser ciphertext of the existing HKDF-derived per-archive key, bound to that archive's SHA-256 identity. It does not persist the global `OAUTH_TOKEN_ENCRYPTION_KEY`. The wrapped key stays in the owner-restricted local private directory and is not uploaded with the archive. Offsite retrieval still requires the Cloudinary account owner's protected credentials. A separate-process drill confirmed restoration with no Render API credential, no database URL, and no global encryption key present.

DPAPI custody depends on the original Windows user profile and its DPAPI material. Losing that profile and the global-key secrets manager can make recovery impossible; moving the wrapped file to another Windows account alone does not grant decryption. Preserve the recovery package and Windows profile through the owner's established secure recovery process. This feature does not create a portable public recovery key or bypass the Office owner's account access.
