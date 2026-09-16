import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { analyticsBridgeHtml } from '../web/analyticsBridge.mjs';

const target = fileURLToPath(new URL('../backend/public/analytics-bridge.html', import.meta.url));
const expected = analyticsBridgeHtml();
if (process.argv.includes('--check')) {
  if ((await fs.readFile(target, 'utf8')).replace(/\r\n/g, '\n') !== expected) {
    throw new Error('Analytics bridge is stale. Run node scripts/sync-analytics-bridge.mjs.');
  }
} else {
  await fs.mkdir(fileURLToPath(new URL('../backend/public/', import.meta.url)), { recursive: true });
  await fs.writeFile(target, expected, 'utf8');
}
console.log('Analytics bridge is synchronized.');
