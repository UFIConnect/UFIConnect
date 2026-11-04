import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate, auditReload } from '../../scripts/audit-session.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../../backend/test-support/app-harness');
const app = await createAppHarness({ connected: true });
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5252, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  for (const width of [1440, 390]) {
    const id = `source-collection-${width}`;
    app.seedUser(member(id));
    const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width < 600 });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(120000);
    await installAuditMember(page, app, id);
    let tightened = false;
    await page.route('**/api/feed/sources?*', route => route.fulfill({ json: {
      sourceCatalog: [
        { id: 'bluesky', pullLimit: tightened ? { maxPulls: 1, windowSeconds: 120, minSpacingMs: 120000 } : { maxPulls: 12, windowSeconds: 30, minSpacingMs: 2500 }, collectionIntervalMs: 300000 },
        { id: 'hackernews', workerId: 'hn', pullLimit: { maxPulls: 10, windowSeconds: 20, minSpacingMs: 2000 } },
        { id: 'medium', postCount: 0, pullLimit: { maxPulls: 14, windowSeconds: 90, minSpacingMs: 6429 }, collection: { enabled: true, pauseReason: 'source_blocked' } },
        { id: 'openalex', postCount: 0, pullLimit: { maxPulls: 1, windowSeconds: 300, minSpacingMs: 300000 } },
        { id: 'future_source', postCount: 0, pullLimit: { maxPulls: 1, windowSeconds: 300, minSpacingMs: 300000 } },
      ],
      sources: [{ id: 'hn', postCount: 3, lastFetch: Date.now() }, { id: 'bluesky', postCount: 5, lastFetch: Date.now() }],
      totalSources: 2, configuredSourceCount: 5,
    } }));
    await auditNavigate(page, server.resolvedUrls.local[0] + 'sources');
    await page.getByText('6 of 6 sources selected', { exact: true }).waitFor();
    await page.getByText('12 pulls / 30s', { exact: true }).waitFor();
    assert.equal(await page.getByRole('switch', { name: 'Turn off Hacker News', exact: true }).count(), 1);
    assert.equal(await page.getByRole('switch', { name: 'Turn off future_source', exact: true }).count(), 1);
    await page.getByText('2 sources with available posts', { exact: true }).waitFor();
    await page.getByText('Scheduled interval: 5m', { exact: true }).waitFor();
    await page.getByText('Source blocked', { exact: true }).waitFor();
    assert.equal(await page.getByText(/fetching live right now|sources active/).count(), 0);
    tightened = true;
    await auditReload(page);
    await page.getByText('1 pull / 120s', { exact: true }).waitFor();
    assert.equal(await page.getByText('12 pulls / 30s', { exact: true }).count(), 0);
    await page.getByText('Scheduled interval: 5m', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/source-pull-limits-${width}.png`), fullPage: true });
    await context.close();
    console.log(`Source collection metadata verified at ${width}px`);
  }
} finally {
  await browser?.close(); await server.close(); await app.close();
}
