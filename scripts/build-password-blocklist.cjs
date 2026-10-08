'use strict';

// Offline maintainer tool. Never give this script real user passwords.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const sourceFile = path.join(root, '.cache/common-passwords-source.txt');
const sourceCommit = fs.readFileSync(path.join(root, '.cache/common-passwords-source-sha.txt'), 'utf8').trim();
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('A pinned source commit is required');
const source = fs.readFileSync(sourceFile);
const entries = source.toString('utf8').split(/\r?\n/).filter(Boolean);
const hashes = [...new Set(entries
  .filter(value => [...value].length >= 12 && Buffer.byteLength(value, 'utf8') <= 72)
  .map(value => crypto.createHash('sha256').update(value.normalize('NFKC').toLowerCase(), 'utf8').digest('hex')))].sort();
if (entries.length < 90000 || hashes.length < 100) throw new Error('Source corpus is unexpectedly small');
const target = path.join(root, 'backend/security-data');
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'common-passwords.json'), JSON.stringify({
  source: `https://github.com/danielmiessler/SecLists/blob/${sourceCommit}/Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt`,
  sourceCommit,
  sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
  sourceEntryCount: entries.length,
  minimumCodePoints: 12,
  maximumUtf8Bytes: 72,
  normalization: 'NFKC then lowercase, for blocklist matching only',
  hashes,
}, null, 2) + '\n');
fs.copyFileSync(path.join(root, '.cache/common-passwords-LICENSE.txt'), path.join(target, 'LICENSE-SecLists.txt'));
console.log(`Created local blocklist: ${hashes.length} eligible fingerprints from ${entries.length} source entries`);
