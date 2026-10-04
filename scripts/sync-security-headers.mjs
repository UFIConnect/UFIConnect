import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserSecurityPolicy } from '../web/securityPolicy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const useBuild = process.argv.includes('--built');
const configPath = path.join(root, 'render.yaml');
let config = fs.readFileSync(configPath, 'utf8');
let changed = false;
for (const app of ['web', 'office']) {
  const html = fs.readFileSync(path.join(root, app, useBuild ? 'dist/index.html' : 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  // Quote the scalar: CSP contains HTTPS/blob/data schemes followed by spaces,
  // which YAML otherwise interprets as nested mappings.
  const policy = JSON.stringify(browserSecurityPolicy(html, { advertising: app === 'web', video: app === 'web' }));
  const block = new RegExp(`(name: uficonnect-${app}\\r?\\n[\\s\\S]*?name: Content-Security-Policy\\r?\\n\\s+value: )([^\\r\\n]+)`);
  if (!block.test(config)) throw new Error(`Missing ${app} CSP configuration`);
  config = config.replace(block, (whole, prefix, current) => {
    if (current !== policy) changed = true;
    return prefix + policy;
  });
}
if (check && changed) throw new Error('Browser script hashes differ from Render CSP; run node scripts/sync-security-headers.mjs after updating HTML.');
if (!check) fs.writeFileSync(configPath, config);
console.log(check ? 'PASS: browser CSP matches inline scripts' : 'Updated Render browser CSP hashes');
