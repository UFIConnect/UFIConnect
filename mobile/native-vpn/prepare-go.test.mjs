import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { GO_ARCHIVES, verifyArchive, prepareGo } from './prepare-go.mjs';

test('official WireGuard iOS mode skips the Go hook before requiring a macOS host or network',async()=>{
  const previous=process.env.EAS_BUILD_PLATFORM;
  process.env.EAS_BUILD_PLATFORM='ios';
  try {await prepareGo();} finally {
    if(previous===undefined) delete process.env.EAS_BUILD_PLATFORM;
    else process.env.EAS_BUILD_PLATFORM=previous;
  }
});

test('toolchain verification rejects a modified archive before extraction', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ufi-go-verify-'));
  const file = path.join(dir, 'archive');
  try {
    await fs.writeFile(file, 'abc');
    await verifyArchive(file, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    await fs.appendFile(file, 'modified');
    await assert.rejects(verifyArchive(file, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'), /checksum mismatch/);
    assert.equal(Object.keys(GO_ARCHIVES).length, 2);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('ufi-go-verify-'));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
