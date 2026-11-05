import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate, auditReload } from '../../scripts/audit-session.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../../backend/test-support/app-harness');
const app = await createAppHarness();
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5253, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [1440, 390]) {
    const id = `source-navigation-${width}`;
    app.seedUser(member(id));
    const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width < 600 });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(120000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await installAuditMember(page, app, id);
    await page.route('**/api/office/feed?*', route => route.fulfill({ json: { posts: [], hasMore: false } }));
    const base = server.resolvedUrls.local[0];
    async function navigateFeed(query, source, mode = 'feed', action) {
      const request = page.waitForRequest(request => {
        const url = new URL(request.url());
        return url.pathname === '/api/office/feed' && url.searchParams.get('mode') === mode
          && url.searchParams.get('source') === source && !url.searchParams.has('bust');
      });
      if (action) await action();
      else await auditNavigate(page, `${base}?${query}`);
      await request;
    }
    await navigateFeed('feed=feed&source=github', 'github');
    // A new source query must update the already mounted feed component.
    await navigateFeed('feed=feed&source=bluesky', 'bluesky');
    // Refresh must keep the deep link even if the browser holds a feed cache.
    await navigateFeed('', 'bluesky', 'feed', () => auditReload(page));
    await navigateFeed('feed=following&source=youtube', 'youtube', 'following');
    await navigateFeed('feed=feed&all=1&source=github', null);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Source deep links, query navigation, reload and Home reset verified at ${width}px`);
  }
} finally {
  await browser?.close(); await server.close(); await app.close();
}
