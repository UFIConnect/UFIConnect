import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ensurePrivateDirectory, verifyOfficeSnapshot } from './office-ai-recovery-drill.mjs';
import { download } from './office-ai-recovery-offsite.mjs';
const require = createRequire(import.meta.url),
  {
    deriveSnapshotRecoveryKey,
    openSnapshotWithRecoveryKey,
    digest,
  } = require('../backend/office-ai-production-recovery');
const { validatePartReceipt, verifyReassembled } = require('../backend/office-ai-recovery-offsite'),
  cloudinary = require('../backend/node_modules/cloudinary').v2;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  base = path.resolve(process.env.OFFICE_RECOVERY_DIRECTORY || path.join(root, '.cache/office-recovery')),
  privateDir = path.join(base, 'private');
function privateFile(filename) {
  if (typeof filename !== 'string' || path.basename(filename) !== filename)
    throw Error('Choose a private recovery filename');
  const target = path.resolve(privateDir, filename);
  if (path.dirname(target) !== privateDir) throw Error('Recovery file outside private directory');
  return target;
}
async function dpapi(bytes, archiveSha256, mode) {
  if (process.platform !== 'win32')
    throw Error('This archive key escrow requires its original Windows user profile');
  const script = `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$v=[Convert]::FromBase64String($env:UFI_DPAPI_PAYLOAD);$e=[Convert]::FromBase64String($env:UFI_DPAPI_ENTROPY);if($env:UFI_DPAPI_MODE -eq 'protect'){$r=[Security.Cryptography.ProtectedData]::Protect($v,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser)}elseif($env:UFI_DPAPI_MODE -eq 'unprotect'){$r=[Security.Cryptography.ProtectedData]::Unprotect($v,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser)}else{throw 'Invalid operation'};[Console]::Out.Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: {
          SystemRoot: process.env.SystemRoot || 'C:/Windows',
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
          UFI_DPAPI_MODE: mode,
          UFI_DPAPI_PAYLOAD: bytes.toString('base64'),
          UFI_DPAPI_ENTROPY: Buffer.from('ufi-office-archive-recovery/v1/' + archiveSha256).toString(
            'base64',
          ),
        },
      },
    );
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('Windows archive-key protection timed out'));
    }, 10000);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 16384) {
        child.kill();
        reject(Error('Invalid Windows key-protection result'));
      } else chunks.push(chunk);
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(Error('Windows archive-key protection unavailable'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(Buffer.from(Buffer.concat(chunks).toString().trim(), 'base64'))
        : reject(Error('This Windows profile cannot authenticate the archive recovery key'));
    });
  });
}
export async function createArchiveKeyEscrow(env, filename) {
  await ensurePrivateDirectory();
  const bytes = await fs.readFile(privateFile(filename)),
    master = Buffer.from(env.OAUTH_TOKEN_ENCRYPTION_KEY || '', 'base64'),
    archiveSha256 = digest(bytes),
    key = deriveSnapshotRecoveryKey(bytes, master),
    escrowFilename = filename + '.key.dpapi.json';
  master.fill(0);
  try {
    const existing = await fs
      .readFile(privateFile(escrowFilename), 'utf8')
      .then(JSON.parse)
      .catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    if (existing) {
      const recovered = await readArchiveRecoveryKey(filename, escrowFilename);
      recovered.recoveryKey.fill(0);
      return { escrowFilename, archiveSha256, reused: true, masterKeyPersisted: false };
    }
    const protectedKey = await dpapi(key, archiveSha256, 'protect');
    const record = {
      version: 1,
      createdAt: new Date().toISOString(),
      archiveFilename: filename,
      archiveSha256,
      encryptedBytes: bytes.length,
      custody: 'Windows DPAPI CurrentUser',
      protectedDerivedKey: protectedKey.toString('base64'),
    };
    await fs.writeFile(privateFile(escrowFilename), JSON.stringify(record, null, 2), {
      mode: 0o600,
      flag: 'wx',
    });
    const unwrapped = await dpapi(protectedKey, archiveSha256, 'unprotect');
    try {
      const value = openSnapshotWithRecoveryKey(bytes, unwrapped, archiveSha256);
      value.sql = '';
    } finally {
      unwrapped.fill(0);
    }
    return { escrowFilename, archiveSha256, reused: false, masterKeyPersisted: false };
  } finally {
    key.fill(0);
  }
}
export async function readArchiveRecoveryKey(filename, escrowFilename, { verifyLocalArchive = true } = {}) {
  if (escrowFilename !== filename + '.key.dpapi.json')
    throw Error('Escrow filename does not match the selected archive');
  const record = JSON.parse(await fs.readFile(privateFile(escrowFilename), 'utf8'));
  if (
    record.version !== 1 ||
    record.archiveFilename !== filename ||
    record.custody !== 'Windows DPAPI CurrentUser' ||
    !/^[a-f0-9]{64}$/.test(record.archiveSha256) ||
    !Number.isSafeInteger(record.encryptedBytes) ||
    record.encryptedBytes < 64 ||
    record.encryptedBytes > 256 * 1024 * 1024
  )
    throw Error('Invalid archive-key escrow metadata');
  const recoveryKey = await dpapi(
    Buffer.from(record.protectedDerivedKey, 'base64'),
    record.archiveSha256,
    'unprotect',
  );
  if (recoveryKey.length !== 32) throw Error('Invalid archive-specific recovery key');
  try {
    if (verifyLocalArchive) {
      const value = openSnapshotWithRecoveryKey(
        await fs.readFile(privateFile(filename)),
        recoveryKey,
        record.archiveSha256,
      );
      value.sql = '';
    }
  } catch (error) {
    recoveryKey.fill(0);
    throw error;
  }
  return { recoveryKey, expectedArchiveSha256: record.archiveSha256, record };
}
export async function restoreOffsiteWithEscrow(env, filename, escrowFilename) {
  await ensurePrivateDirectory();
  const state = await readArchiveRecoveryKey(filename, escrowFilename, { verifyLocalArchive: false });
  const { record, recoveryKey, expectedArchiveSha256 } = state;
  const prefix = 'office-recovery/' + filename.slice(0, -7) + '/' + record.archiveSha256.slice(0, 16),
    count = Math.ceil(record.encryptedBytes / (8 * 1024 * 1024)),
    plan = {
      filename,
      prefix,
      archiveSha256: record.archiveSha256,
      encryptedBytes: record.encryptedBytes,
      parts: [],
    };
  let config;
  if (env.CLOUDINARY_URL) {
    const u = new URL(env.CLOUDINARY_URL);
    config = {
      cloud_name: u.hostname,
      api_key: decodeURIComponent(u.username),
      api_secret: decodeURIComponent(u.password),
    };
  } else
    config = {
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
    };
  if (!config.cloud_name || !config.api_key || !config.api_secret)
    throw Error('Cloudinary account-owner credentials are required for authenticated offsite retrieval');
  cloudinary.config({ ...config, secure: true });
  const pieces = [],
    temporaryName = 'escrow-offsite-' + filename,
    target = privateFile(temporaryName);
  try {
    for (let index = 1; index <= count; index++) {
      const publicId =
          prefix +
          '/part-' +
          String(index).padStart(2, '0') +
          '-of-' +
          String(count).padStart(2, '0') +
          '.ufirec',
        receipt = await cloudinary.api.resource(publicId, {
          resource_type: 'raw',
          type: 'authenticated',
          context: true,
        });
      const custom = receipt.context?.custom || {};
      const size = Math.min(8 * 1024 * 1024, record.encryptedBytes - (index - 1) * 8 * 1024 * 1024),
        part = { index, count, publicId, bytes: size, sha256: custom.part_sha256 };
      if (
        custom.archive_sha256 !== record.archiveSha256 ||
        custom.snapshot_file !== filename ||
        Number(custom.part_index) !== index ||
        Number(custom.part_count) !== count ||
        !/^[a-f0-9]{64}$/.test(part.sha256)
      )
        throw Error('Offsite archive part metadata does not match the escrowed identity');
      validatePartReceipt(part, { ...receipt, etag: undefined });
      plan.parts.push(part);
      const signed = cloudinary.utils.private_download_url(publicId, '', {
        resource_type: 'raw',
        type: 'authenticated',
        expires_at: Math.floor(Date.now() / 1000) + 60,
        attachment: false,
      });
      pieces.push(await download(signed, size));
    }
    const recovered = verifyReassembled(plan, pieces),
      value = openSnapshotWithRecoveryKey(recovered, recoveryKey, expectedArchiveSha256);
    value.sql = '';
    await fs.writeFile(target, recovered, { mode: 0o600 });
    const restored = await verifyOfficeSnapshot({}, temporaryName, { recoveryKey, expectedArchiveSha256 });
    const report = {
      at: new Date().toISOString(),
      archiveFilename: filename,
      archiveSha256: expectedArchiveSha256,
      escrowFilename,
      custody: 'Windows DPAPI CurrentUser',
      renderApiRequired: false,
      globalMasterKeyRequired: false,
      localSourceArchiveRequired: false,
      offsiteParts: count,
      restoredTables: restored.restoredTables,
      restoredRows: restored.restoredRows,
      constraintsVerified: restored.constraintsVerified,
      restoreMs: restored.restoreMs,
      allChecksumsVerified: restored.tables.every((t) => t.checksumMatches),
      productionWrites: 0,
      keyUploaded: false,
    };
    await fs.writeFile(path.join(base, 'escrow-offsite-restore.json'), JSON.stringify(report, null, 2));
    return report;
  } finally {
    recoveryKey.fill(0);
    await fs.unlink(target).catch(() => {});
  }
}
async function main() {
  const [mode, filename, escrowFilename] = process.argv.slice(2);
  let result;
  if (mode === 'create') result = await createArchiveKeyEscrow(process.env, filename);
  else if (mode === 'verify') {
    const state = await readArchiveRecoveryKey(filename, escrowFilename);
    try {
      const r = await verifyOfficeSnapshot({}, filename, state);
      result = {
        restoredTables: r.restoredTables,
        restoredRows: r.restoredRows,
        constraintsVerified: r.constraintsVerified,
        globalMasterKeyRequired: false,
      };
    } finally {
      state.recoveryKey.fill(0);
    }
  } else if (mode === 'restore-offsite')
    result = await restoreOffsiteWithEscrow(process.env, filename, escrowFilename);
  else
    throw Error(
      'Usage: office-ai-recovery-key.mjs create <archive> | verify <archive> <escrow-file> | restore-offsite <archive> <escrow-file>',
    );
  console.log(JSON.stringify(result));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => {
    console.error(
      'Archive-key recovery failed; no production restore or plaintext-key persistence was performed.',
    );
    process.exitCode = 1;
  });
