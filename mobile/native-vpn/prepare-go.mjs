import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
// Published https://go.dev/dl/?mode=json&include=all; reviewed 2026-10-05.
export const GO_ARCHIVES = Object.freeze({
  x64: { name: 'go1.19.13.darwin-amd64.tar.gz', sha256: '1b4329dc9e73def7f894ca71fce78bb9f3f5c4c8671b6c7e4f363a3f47e88325' },
  arm64: { name: 'go1.19.13.darwin-arm64.tar.gz', sha256: '022b35fa9c79b9457fa4a14fd9c4cf5f8ea315a8f2e3b3cd949fea55e11a7d7b' },
});
export async function verifyArchive(file, expected) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== expected) throw new Error('Go archive checksum mismatch; refusing to extract');
}
export async function prepareGo() {
  if (process.env.EAS_BUILD_PLATFORM && process.env.EAS_BUILD_PLATFORM !== 'ios') return;
  if (process.platform !== 'darwin') {
    if (process.env.EAS_BUILD_PLATFORM === 'ios') throw new Error('The iOS Go bridge requires a macOS builder');
    console.log('Go bridge setup skipped: this host does not build iOS.');
    return;
  }
  const release = GO_ARCHIVES[process.arch];
  if (!release) throw new Error('Unsupported macOS builder architecture');
  const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const cache = path.join(mobile, '.cache', 'wireguard-toolchain');
  await fs.mkdir(cache, { recursive: true });
  const archive = path.join(cache, release.name);
  // Every run verifies the official archive; cached executable bytes are never trusted.
  try { await verifyArchive(archive, release.sha256); }
  catch {
    const response = await fetch(`https://go.dev/dl/${release.name}`, { signal: AbortSignal.timeout(300000) });
    if (!response.ok || !response.body) throw new Error('Could not download the pinned Go toolchain');
    await pipeline(response.body, createWriteStream(archive));
    await verifyArchive(archive, release.sha256);
  }
  const destination = await fs.mkdtemp(path.join(cache, 'verified-'));
  await run('/usr/bin/tar', ['-xzf', archive, '-C', destination]);
  const binary = path.join(destination, 'go', 'bin', 'go');
  const { stdout } = await run(binary, ['version']);
  if (!/^go version go1\.19\.13 darwin\/(?:amd64|arm64)\s*$/.test(stdout)) throw new Error('Unexpected Go version');
  // Xcode phases read this project-local pointer; hook PATH changes would not persist.
  await fs.writeFile(path.join(cache, 'go-bin-path'), path.dirname(binary) + '\n', { mode: 0o600 });
  console.log('Verified Go 1.19.13 is ready for the official WireGuardKit bridge.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareGo();
}
