// Reviewed backports, applied only to the exact npm files in the manifest.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const manifest = require('./patches/manifest.json');
const root = path.resolve(__dirname, '..');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

function patchText(text, file) {
  if (hash(text) === file.afterSha256) return text;
  if (hash(text) !== file.beforeSha256) throw new Error(`Unrecognized upstream file: ${file.path}`);
  for (const hunk of [...file.hunks].sort((a, b) => b.offset - a.offset)) {
    if (text.slice(hunk.offset, hunk.offset + hunk.before.length) !== hunk.before) throw new Error(`Patch context mismatch: ${file.path}`);
    text = text.slice(0, hunk.offset) + hunk.after + text.slice(hunk.offset + hunk.before.length);
  }
  if (hash(text) !== file.afterSha256) throw new Error(`Patch result mismatch: ${file.path}`);
  return text;
}

function processPatches({ apply = false, directory = root } = {}) {
  const lock = JSON.parse(fs.readFileSync(path.join(directory, 'package-lock.json'), 'utf8'));
  const verified = new Map();
  // Discover every installed copy, including dependencies nested under another package.
  for (const entry of manifest.packages) {
    const locations = Object.entries(lock.packages).filter(([location]) => location.endsWith(`node_modules/${entry.name}`));
    if (!locations.length) throw new Error(`Missing locked dependency: ${entry.name}; review the patch manifest`);
    const nodes = new Set();
    for (const [location, locked] of locations) {
      if (locked.version !== entry.version || locked.link) throw new Error(`Unexpected dependency version: ${location}`);
      const installed = path.resolve(directory, location);
      if (!installed.startsWith(path.resolve(directory, 'node_modules') + path.sep)) throw new Error('Dependency outside node_modules');
      const pkg = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
      if (pkg.name !== entry.name || pkg.version !== entry.version) throw new Error(`Installed dependency mismatch: ${location}`);
      for (const file of entry.files) {
        const target = path.join(installed, file.path);
        const text = fs.readFileSync(target, 'utf8');
        if (apply) {
          const next = patchText(text, file);
          if (next !== text) fs.writeFileSync(target, next);
        } else if (hash(text) !== file.afterSha256) throw new Error(`Security patch missing or modified: ${location}/${file.path}`);
      }
      nodes.add(location);
    }
    verified.set(entry.name, { advisory: entry.advisory, nodes });
  }
  return verified;
}

module.exports = { processPatches, patchText, manifest };
if (require.main === module) {
  processPatches({ apply: !process.argv.includes('--check') });
  console.log('Verified pinned braces and node-forge security backports.');
}
