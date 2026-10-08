import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(mobileRoot, '..');
const assets = [
  ['web/src/analytics/googleAnalytics.mjs', 'analytics/generated/googleAnalytics.mjs'],
  ['web/src/analytics/telemetryPrivacy.mjs', 'analytics/generated/telemetryPrivacy.mjs'],
  ['shared/analytics-categories.json', 'analytics/generated/analytics-categories.json'],
];
for (const [source, destination] of assets) {
  let content = await fs.readFile(path.join(projectRoot, source));
  if (source === 'web/src/analytics/googleAnalytics.mjs') {
    // Metro resolves the generated controller inside the mobile project. Keep
    // its catalog beside it rather than importing outside that project root.
    const sharedImport = "'../../../shared/analytics-categories.json'";
    if (!content.toString('utf8').includes(sharedImport)) throw new Error('The shared analytics catalog import changed. Update mobile preparation.');
    content = Buffer.from(content.toString('utf8').replace(sharedImport, "'./analytics-categories.json'"));
  }
  const target = path.join(mobileRoot, destination);
  if (process.argv.includes('--check')) {
    const actual = await fs.readFile(target);
    if (!content.equals(actual)) throw new Error(`Analytics asset is stale: mobile/${destination}`);
  } else {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
}
// Resolve the generated module graph now so missing shared dependencies fail
// during preparation, before Metro starts an Android, iOS, or web export.
await import(pathToFileURL(path.join(mobileRoot, 'analytics/generated/googleAnalytics.mjs')).href);
console.log('Expo web analytics controller and privacy filter are synchronized.');
