# Database recovery and feed-cache troubleshooting

## What the second database contains

`DATABASE_URL` is authoritative for accounts, passwords, sessions, messages, settings, and feed data. API and pipeline must point to the intended primary database.

`DATABASE_URL_BACKUP` identifies a separate **writable feed recovery cache** used by the API. The application copies only `feed_posts_cache`: by default, posts from the past 14 days, capped at 40,000 rows, refreshed every 30 minutes. Account, message, and settings tables are not copied. Different total sizes and table counts are expected. This cache cannot restore the complete application database.

The pending synchronization fix retries failed connections or sync attempts after 60 seconds and reconciles the bounded feed snapshot in a transaction. It applies changed rows and removes rows outside the selected snapshot. The previous completed snapshot remains available if that transaction fails. This behavior must be verified on the deployed commit; writing the fix does not establish a live connection or a successful sync.

Only the API runs this loop. A pipeline health response with `dbBackup: false` is expected. Do not point the writable cache at the primary database or at a managed read-only replica.

## Current incident evidence

Public health checks on September 16, 2026 (UTC) reported `db: true` and `dbBackup: false` on the API. That establishes a working primary connection and no established backup connection; it does not identify whether the backup URL is missing, credentials are invalid, TLS failed, or older initialization code skipped the attempt. No direct database comparison, Render configuration inspection, or restore test was available in this session.

The operator subsequently confirmed `DATABASE_URL_BACKUP` is listed in Render and provided failed API/pipeline deployment logs with `DEPTH_ZERO_SELF_SIGNED_CERT` on the **primary** connection. Those attempted deployments cannot initialize the primary schema or start backup synchronization. Render's internal PostgreSQL URLs present self-signed certificates, which this application's verified TLS policy rejects. Use the primary database's full external URL for `DATABASE_URL` on both services, and the separate backup database's full external URL for the API's `DATABASE_URL_BACKUP`, with appropriate network allowlists. Preserve `DATABASE_SSL_MODE=verify-full`. An older deployment can remain live while a replacement fails; public health and deployment logs must be matched to their running commit. The precise deployed URLs and a successful retry remain unverified.

## Recover a database that cannot start because its disk is full

The newer PostgreSQL log reports recovery redo followed by `FATAL: could not write to file "pg_wal/xlogtemp.62": No space left on device` and a startup-process exit. The database cannot complete startup because its storage is full. `redo done` does not establish that the database became available. Confirm which Render database emitted this log before changing capacity; the log alone does not identify the primary or the feed recovery cache. This storage failure is separate from the earlier application TLS error.

1. Open that database's **Info** page. If Render has suspended it, click **Resume Database** at the bottom and wait 1–2 minutes.
2. Promptly open **PostgreSQL Instance → Update → Storage**, choose a higher multiple of 5 GB with enough headroom, and save. Render can suspend it again if it remains full after resuming. Follow [Render's disk-full recovery procedure](https://render.com/docs/postgresql-creating-connecting#running-out-of-storage).
3. Storage increases are permanent and affect billing; review the displayed price. Storage cannot be reduced, and another increase is blocked for six hours. Free or legacy instances may require a plan change before expansion. If the controls are unavailable or startup still fails after capacity increases, contact Render support with the instance ID and sanitized log excerpt. See [Render storage and plan controls](https://render.com/docs/postgresql-creating-connecting#adding-storage).

Do not delete `pg_wal`, reset WAL, or remove database files to make room. Redeploying the API or pipeline does not expand PostgreSQL storage. The separate feed recovery cache contains only the bounded `feed_posts_cache` snapshot described above; it cannot replace the full primary database.

### Verify recovery before declaring the incident resolved

- Confirm the database reaches **Available**, startup stops repeating the disk-full error, and its storage metrics show sustained free capacity.
- Recheck API and pipeline readiness against their running commits. A recovered primary must accept connections and complete security storage initialization; investigate any remaining TLS failure separately.
- Check the API's protected `dbBackupStatus`: `connected: true` proves connectivity only. Require a new completed `lastSyncAt` and recorded `rowCount`, then verify the next scheduled refresh. The pipeline does not own backup synchronization.
- Verify representative application reads and authorized writes, and record the recovery time. A successful feed sync is not a complete backup or a restore test; use the full recovery checks below for the primary database.

## Check the API service configuration

1. Open the **API web service** in Render and confirm it owns `api.uficonnect.org`. Record its deployed commit and inspect that deployment's status.
2. In that service's **Environment** page, verify `DATABASE_URL_BACKUP` exists and contains the complete URL for the intended separate cache database, including its database name. Keep the value in Render's secret settings. Do not paste URLs, passwords, or tokens into chat, screenshots, issues, or logs.
3. This application's production connection policy verifies TLS certificates. Use the backup database's full **external** connection URL, retaining its hostname. Primary and backup use the same `DATABASE_SSL_MODE` and optional `DATABASE_SSL_CA` policy. Render's internal TLS certificate does not support `verify-full`; adding `sslmode=require` to the URL does not override this application's explicit verification policy. [Render connection guidance](https://render.com/docs/postgresql-creating-connecting#ssl-modes-for-internal-connections)
4. Check that the database is available, credentials are current, its network allowlist permits the API service's egress addresses, and the cache user can create/update the cache schema and write its rows. Preserve certificate verification. A custom CA bundle, when needed, must validate both database endpoints.
5. Verify the API and pipeline have the **same existing** `OAUTH_TOKEN_ENCRYPTION_KEY`: a dedicated random 32-byte key encoded as base64. Retain its protected recovery copy. Do not generate a replacement to fix a database connection: replacing an encryption key can make existing encrypted credentials unreadable. Follow the coordinated rollout in [Security rollout](SECURITY-2026-09-15.md).
6. After configuration is saved and the verified release is deployed, check the diagnostics below. A successful Render build alone does not prove database initialization or synchronization succeeded.

## When Render shows no logs for 14 days

Backup connection messages are written by the **API application**, so open that web service's **Logs** page. Clear text, level, and instance filters; select **Live tail** or a recent time range. Search separately for `Backup PostgreSQL`, `DATABASE_URL_BACKUP`, and `db backup`. Check the latest entry on the service's **Deploys** page for startup/build failures. Static sites have no runtime logs. Render retains logs for 7 days on Hobby, 14 on Pro, and 30 on Scale/Enterprise; expired logs cannot establish whether a past sync ran. [Render log locations and retention](https://render.com/docs/logging)

If no backup log exists, compare the active commit with the release containing the fix and inspect startup failures. Absence of log matches is not proof that the databases are synchronized.

## Verify connection and synchronization separately

- `GET /readyz`: production security storage must finish initialization before readiness succeeds.
- `GET /health`: check the API's `db` and `dbBackup` flags. These do not compare database contents.
- `GET /health/details`: authorized operators use the existing `OFFICE_TOKEN` value in the **`X-Office-Token` request header**. Never put it in a URL. Missing server configuration returns 503; an invalid token returns 401. Inspect `dbBackupStatus` privately.
- After deploying the updated API and Office dashboard, open **Office → Command Center → Feed recovery database** for the connection state, sanitized error, last successful update, and row count. This panel uses the existing authenticated Office API.

| Diagnostic | Interpretation / next check |
| --- | --- |
| `enabled: false` | `DATABASE_URL_BACKUP` is absent from the running API process. |
| `enabled: true`, `connected: false` | Inspect `lastError`, URL, credentials, TLS, network access, and the running release. |
| `connected: true`, `lastSyncAt: null` | Connection succeeded, but no completed snapshot is recorded in this process. |
| `lastSyncAt` stops advancing | Inspect errors, pending attempts, capacity, and primary availability. |
| `rowCount` differs from the primary total | Compare only the configured recent, capped feed snapshot; the primary contains more data. |

After the fix is deployed, also inspect `lastAttemptAt`, `nextSyncAt`, `syncing`, and `capacityStatus`. Wait for a completed sync and record its timestamp and row count. Check again after the next scheduled refresh. Direct verification requires authorized database access: compare the selected feed IDs and copied values against a consistent primary snapshot, allowing for changes made after that snapshot. Counts alone cannot prove equality. Do not export customer records to investigate a feed-cache issue.

## Complete PostgreSQL recovery is a separate control

Choose and verify the recovery control for the primary database independently of the disposable feed cache:

| Control | Purpose and current Render constraints |
| --- | --- |
| Point-in-time recovery (PITR) | Paid PostgreSQL databases receive continuous recovery coverage. Workspace retention is 3 days on Hobby and 7 days on Pro or higher. Free databases have no Render recovery capability. Recovery creates a new database instance; validate it before changing service URLs. |
| Logical backup export | Paid database exports are available from the database's **Recovery** page and retained by Render for 7 days. Download to protected storage for longer retention. Free databases require an operator-managed export such as `pg_dump`. |
| Managed read replica | An asynchronous, read-only copy for read workloads. Requires at least 10 GB storage and 0.5 CPU (legacy Standard or higher); replica compute/storage matches the primary and is billed separately. Monitor **Replication Lag** on the primary's Metrics page. |

Recovery/export details: [Render recovery and backups](https://render.com/docs/postgresql-backups). Replica requirements: [Render read replicas](https://render.com/docs/postgresql-read-replicas). PostgreSQL distinguishes SQL dumps, filesystem backups, and continuous archiving in its [backup documentation](https://www.postgresql.org/docs/current/backup.html).

A replica also receives unwanted changes and deletions; it does not provide historical recovery by itself. Creating an unrelated second PostgreSQL database does not enable replication. Configuring a managed replica would require a separate connection path because this application's cache initializer writes to its target.

Before recording disaster recovery as ready, confirm the actual primary's plan and available recovery window, restore into an isolated database, verify schema and representative application behavior, and record the tested restore time and recoverable point. Retain the encryption key needed to decrypt restored credentials. No managed replica, PITR availability, complete backup, or successful restore is claimed by this source change.
