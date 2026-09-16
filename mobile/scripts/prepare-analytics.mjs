import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(mobileRoot, '..');
const assets = [
  ['web/src/analytics/googleAnalytics.mjs', 'analytics/generated/googleAnalytics.mjs'],
];
for (const [source, destination] of assets) {
  const content = await fs.readFile(path.join(projectRoot, source));
  const target = path.join(mobileRoot, destination);
  if (process.argv.includes('--check')) {
    const actual = await fs.readFile(target);
    if (!content.equals(actual)) throw new Error(`Analytics asset is stale: mobile/${destination}`);
  } else {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
}
console.log('Expo web analytics controller is synchronized.');
