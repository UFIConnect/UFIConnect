import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { verifyOfficeSnapshot } from './office-ai-recovery-drill.mjs';
const require = createRequire(import.meta.url);
const { openSnapshot, openSnapshotWithRecoveryKey } = require('../backend/office-ai-production-recovery');
const {
  planArchiveParts,
  validatePartReceipt,
  verifyReassembled,
} = require('../backend/office-ai-recovery-offsite');
const cloudinary = require('../backend/node_modules/cloudinary').v2;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.resolve(
  process.env.OFFICE_RECOVERY_DIRECTORY || path.join(projectRoot, '.cache/office-recovery'),
);
const privateDirectory = path.join(base, 'private');
const statusOf = (error) => Number(error?.http_code || error?.status || error?.error?.http_code || 0);
export async function download(url, maximumBytes) {
  let current = new URL(url);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (
      current.protocol !== 'https:' ||
      !['api.cloudinary.com', 'res.cloudinary.com'].includes(current.hostname) ||
      current.username ||
      current.password
    )
      throw Error('Offsite download left the authenticated provider');
    const response = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
      cache: 'no-store',
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw Error('Offsite provider returned an invalid redirect');
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw Error('Authenticated offsite download failed HTTP ' + response.status);
    }
    if (Number(response.headers.get('content-length')) > maximumBytes) {
      await response.body?.cancel();
      throw Error('Offsite download exceeded archive part size');
    }
    const reader = response.body.getReader(),
      chunks = [];
    let size = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.length;
        if (size > maximumBytes) {
          await reader.cancel();
          throw Error('Offsite download exceeded archive part size');
        }
        chunks.push(Buffer.from(item.value));
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks);
  }
  throw Error('Offsite provider exceeded the redirect bound');
}
export async function uploadEncryptedOfficeArchive(
  env,
  filename,
  { upload = false, downloadExisting = false, recoveryKey, expectedArchiveSha256 } = {},
) {
  if (path.basename(filename) !== filename) throw Error('Choose a saved encrypted Office archive');
  const source = path.resolve(privateDirectory, filename);
  if (path.dirname(source) !== privateDirectory) throw Error('Archive outside private directory');
  const encrypted = await fs.readFile(source),
    master = Buffer.from(env.OAUTH_TOKEN_ENCRYPTION_KEY || '', 'base64');
  const open = (bytes) =>
    recoveryKey
      ? openSnapshotWithRecoveryKey(bytes, recoveryKey, expectedArchiveSha256)
      : openSnapshot(bytes, master);
  const inspected = open(encrypted);
  inspected.sql = ''; // Authenticate before any provider operation.
  const plan = planArchiveParts(filename, encrypted);
  let config;
  if (env.CLOUDINARY_URL) {
    const url = new URL(env.CLOUDINARY_URL);
    config = {
      cloud_name: url.hostname,
      api_key: decodeURIComponent(url.username),
      api_secret: decodeURIComponent(url.password),
    };
  } else
    config = {
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
    };
  if (!config.cloud_name || !config.api_key || !config.api_secret)
    throw Error('Load the existing protected Cloudinary account connection');
  cloudinary.config({ ...config, secure: true });
  const usage = await cloudinary.api.usage();
  if (usage.media_limits?.raw_max_size_bytes < Math.max(...plan.parts.map((part) => part.bytes)))
    throw Error('Existing Cloudinary raw-file limit is too small');
  if (!Number.isFinite(usage.credits?.limit) || usage.credits.limit - usage.credits.usage < 0.1)
    throw Error('Existing offsite account quota needs review');
  const report = {
    at: new Date().toISOString(),
    provider: 'Cloudinary existing account',
    deliveryType: 'authenticated',
    resourceType: 'raw',
    snapshot: filename,
    encryptedBytes: plan.encryptedBytes,
    archiveSha256: plan.archiveSha256,
    prefix: plan.prefix,
    uploadRequested: upload,
    downloadExisting,
    parts: [],
    planChanged: false,
    sourcePlaintextUploaded: false,
    decryptionKeyUploaded: false,
  };
  if (!upload && !downloadExisting)
    return {
      ...report,
      plannedParts: plan.parts.map(({ publicId, bytes, sha256, index, count }) => ({
        publicId,
        bytes,
        sha256,
        index,
        count,
      })),
    };
  const pieces = [];
  for (const part of plan.parts) {
    let receipt;
    try {
      receipt = await cloudinary.api.resource(part.publicId, { resource_type: 'raw', type: 'authenticated' });
    } catch (error) {
      if (statusOf(error) !== 404)
        throw Error('Could not reconcile the unique offsite part HTTP ' + statusOf(error));
    }
    const reused = !!receipt;
    if (!receipt && downloadExisting)
      throw Error('Existing offsite part is missing; download-only mode cannot upload');
    if (!receipt) {
      try {
        receipt = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              resource_type: 'raw',
              type: 'authenticated',
              public_id: part.publicId,
              overwrite: false,
              unique_filename: false,
              timeout: 45000,
              tags: ['office-recovery', 'encrypted'],
              context: {
                archive_sha256: plan.archiveSha256,
                part_sha256: part.sha256,
                part_index: String(part.index),
                part_count: String(part.count),
                snapshot_file: filename,
              },
            },
            (error, result) => (error ? reject(error) : resolve(result)),
          );
          stream.end(encrypted.subarray(part.start, part.end));
        });
      } catch (error) {
        // A response timeout is reconciled by read, never by another upload.
        try {
          receipt = await cloudinary.api.resource(part.publicId, {
            resource_type: 'raw',
            type: 'authenticated',
          });
        } catch {
          throw Error(
            'Offsite upload outcome is unconfirmed HTTP ' +
              statusOf(error) +
              '; unique part was not replayed',
          );
        }
      }
    }
    validatePartReceipt(part, receipt);
    const unsigned = cloudinary.url(part.publicId, {
      resource_type: 'raw',
      type: 'authenticated',
      secure: true,
      version: receipt.version,
    });
    const publicResponse = await fetch(unsigned, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    await publicResponse.body?.cancel();
    if (![401, 403, 404].includes(publicResponse.status))
      throw Error('Offsite object was not confirmed private to unauthenticated requests');
    const signed = cloudinary.utils.private_download_url(part.publicId, '', {
      resource_type: 'raw',
      type: 'authenticated',
      expires_at: Math.floor(Date.now() / 1000) + 60,
      attachment: false,
    });
    pieces.push(await download(signed, part.bytes));
    report.parts.push({
      index: part.index,
      count: part.count,
      publicId: part.publicId,
      assetId: receipt.asset_id,
      version: receipt.version,
      bytes: part.bytes,
      sha256: part.sha256,
      unauthenticatedStatus: publicResponse.status,
      reused,
    });
  }
  const recovered = verifyReassembled(plan, pieces);
  const validated = open(recovered);
  validated.sql = '';
  const temporaryName = 'offsite-restore-' + filename,
    temporaryPath = path.resolve(privateDirectory, temporaryName);
  if (path.dirname(temporaryPath) !== privateDirectory) throw Error('Invalid verification path');
  try {
    await fs.writeFile(temporaryPath, recovered, { mode: 0o600 });
    const restored = await verifyOfficeSnapshot(env, temporaryName, { recoveryKey, expectedArchiveSha256 });
    report.downloadVerified = true;
    report.aesAuthenticationVerified = true;
    report.restore = {
      tables: restored.restoredTables,
      rows: restored.restoredRows,
      constraints: restored.constraintsVerified,
      restoreMs: restored.restoreMs,
      productionWrites: restored.productionWrites,
      inMemoryRestore: restored.inMemoryRestore,
      checksumsVerified: restored.tables.every((table) => table.checksumMatches),
    };
  } finally {
    await fs.unlink(temporaryPath).catch(() => {});
  }
  await fs.writeFile(path.join(base, 'offsite-copy.json'), JSON.stringify(report, null, 2));
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  uploadEncryptedOfficeArchive(process.env, process.argv[2], { upload: process.argv.includes('--upload') })
    .then((report) => console.log(JSON.stringify(report)))
    .catch((error) => {
      console.error(error.message || 'Offsite backup did not complete');
      process.exitCode = 1;
    });
}
