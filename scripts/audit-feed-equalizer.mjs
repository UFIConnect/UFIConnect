import { installAuditMember, auditNavigate, auditReload } from './audit-session.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
const require = createRequire(import.meta.url);
require('../backend/generated-media');
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = await createAppHarness();
app.seedUser(member('equalizer-browser', { preferences: { interests: ['Open Source', 'AI & Machine Learning'] } }));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5233, strictPort: false, proxy: { '/api': { target: app.base, rewrite: p => p.replace(/^\/api/, '') } } } });
let browser;
try {
  await server.listen();
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, isMobile: width < 600, hasTouch: width < 600 });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    let revision = 0;
    let holdNextPage = false, pageHeld, resumePage, heldPageRequest;
    const paginationHeld = new Promise(resolve => { pageHeld = resolve; });
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url()), endpoint = url.pathname.replace(/^\/api/, '');
      if (/events|stream/.test(endpoint)) return route.abort();
      if (endpoint === '/social/platforms') {
        const response = await route.fetch(), catalog = await response.json();
        // Following selections require the fixture member to have these connections.
        return route.fulfill({ response, json: { ...catalog, connected: { ...catalog.connected, reddit: true, github: true } } });
      }
      if (endpoint !== '/office/feed') return route.continue();
      const params = url.searchParams;
      requests.push(params);
      const sources = (params.get('sources') || params.get('source') || (params.get('mode') === 'following' ? 'reddit,github' : 'reddit,hackernews')).split(',');
      const batch = params.get('cursor') ? 1 : 0;
      const key = `${sources.join('-')}-${revision}-${batch}`;
      const posts = Array.from({ length: 4 }, (_, i) => ({
        id: `${key}-${i}`, source: sources[i % sources.length],
        title: `Equalizer story ${key}-${i}`,
        content: 'A detailed discussion of useful open source software and community projects.',
        topic: i % 2 ? 'AI & Machine Learning' : 'Open Source',
        // Server order deliberately differs from global date order, including
        // for one source's topics and newly delivered refresh/pagination rows.
        createdAt: new Date(Date.now() - ((i % 2 ? 120 : 5) + i) * 60000).toISOString(),
        author: { id: 'other', name: 'Community developer' },
        sourceUrl: `https://example.org/articles/${key}/${i}`,
      }));
      if (batch && holdNextPage && params.get('mode') === 'feed' && sources.join(',') === 'reddit,hackernews' && revision === 0) {
        holdNextPage = false;
        heldPageRequest = route.request();
        await new Promise(resolve => { resumePage = resolve; pageHeld(); });
      }
      return route.fulfill({ json: { posts, cursor: 'audit-page-2', hasMore: !batch, nativeUficonnectIncluded: true } });
    });
    const titles = () => page.locator('[data-feed-position]').evaluateAll(elements => elements.map(element => element.textContent.match(/Equalizer story [a-z0-9-]+/)?.[0]).filter(Boolean));
    const expected = (sources, version, batch) => Array.from({ length: 4 }, (_, i) => `Equalizer story ${sources}-${version}-${batch}-${i}`);
    async function checkStart(sources, version = revision) {
      await page.getByText(expected(sources, version, 0)[3], { exact: true }).waitFor();
      assert.deepEqual((await titles()).slice(0, 4), expected(sources, version, 0));
    }
    await installAuditMember(page, app, 'equalizer-browser');
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=feed');
    await checkStart('reddit-hackernews');
    const sources = page.getByRole('group', { name: 'Home sources', exact: true });
    await sources.getByRole('button', { name: 'Reddit', exact: true }).click();
    await checkStart('reddit');
    // Arm before rendering the selected feed: the endless-feed observer may
    // prefetch immediately when the first batch fits near the viewport tail.
    holdNextPage = true;
    await sources.getByRole('button', { name: 'Hacker News', exact: true }).click();
    await checkStart('reddit-hackernews');
    assert.ok(requests.some(params => params.get('sources')?.split(',').length === 2));
    // Explicit refresh supersedes a pending cursor page. Already visible
    // cards stay behind the fresh balanced batch; late cursor rows stay out.
    assert.equal(await page.getByRole('navigation', { name: 'Feed pages', exact: true }).count(), 0);
    await page.locator('[data-feed-scroll-sentinel]').scrollIntoViewIfNeeded();
    await Promise.race([paginationHeld, new Promise((_, reject) => setTimeout(() => reject(new Error('Pagination never started')), 10000))]);
    revision = 1;
    const supersededPage = page.waitForEvent('requestfailed', request => request === heldPageRequest);
    await page.evaluate(() => window.dispatchEvent(new Event('ufi:refresh-selected-feed')));
    await supersededPage;
    resumePage();
    await page.getByText(expected('reddit-hackernews', 1, 0)[3], { exact: true }).waitFor().catch(async error => {
      console.log('Equalizer failure context', JSON.stringify({ requests: requests.map(params => params.toString()), titles: await titles(), errors }));
      throw error;
    });
    assert.deepEqual((await titles()).slice(0, 8), [...expected('reddit-hackernews', 1, 0), ...expected('reddit-hackernews', 0, 0)], 'Refresh promotes the fresh balanced batch ahead of already loaded cards');
    assert.equal(await page.getByText(expected('reddit-hackernews', 0, 1)[3], { exact: true }).count(), 0, 'The superseded cursor page cannot append after refresh');
    await page.locator('[data-feed-scroll-sentinel]').scrollIntoViewIfNeeded();
    await page.getByText(expected('reddit-hackernews', 1, 1)[3], { exact: true }).waitFor();
    assert.deepEqual((await titles()).slice(0, 12), [...expected('reddit-hackernews', 1, 0), ...expected('reddit-hackernews', 0, 0), ...expected('reddit-hackernews', 1, 1)], 'A current cursor can append the next balanced batch after refresh');
    assert.equal(await page.getByText(expected('reddit-hackernews', 0, 1)[3], { exact: true }).count(), 0, 'Late rows from the cancelled cursor remain absent after new pagination');
    await auditReload(page);
    await checkStart('reddit-hackernews');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/equalizer-${width}.png`) });
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=following');
    await checkStart('reddit-github');
    const followingSources = page.getByRole('group', { name: 'Following sources', exact: true });
    await followingSources.getByRole('button', { name: 'Reddit', exact: true }).click();
    await checkStart('reddit');
    await followingSources.getByRole('button', { name: 'GitHub', exact: true }).click();
    await checkStart('reddit-github');
    const [clearedSourceResponse] = await Promise.all([
      page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname.endsWith('/office/feed') && url.searchParams.get('mode') === 'following'
          && !url.searchParams.has('source') && !url.searchParams.has('sources');
      }),
      followingSources.getByRole('button', { name: 'Clear sources', exact: true }).click(),
    ]);
    assert.ok(clearedSourceResponse.ok());
    assert.ok(await followingSources.getByRole('button', { name: 'Clear sources', exact: true }).isDisabled());
    await followingSources.getByRole('button', { name: 'Reddit', exact: true }).click();
    await checkStart('reddit');
    await page.getByRole('button', { name: 'Filter feed by topic', exact: true }).click();
    await page.getByRole('button', { name: 'Open Source', exact: true }).click();
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    const [allSourcesResponse] = await Promise.all([
      page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname.endsWith('/office/feed') && url.searchParams.get('mode') === 'following'
          && url.searchParams.get('topics') === 'Open Source'
          && !url.searchParams.has('source') && !url.searchParams.has('sources');
      }),
      followingSources.getByRole('button', { name: 'Clear sources', exact: true }).click(),
    ]);
    assert.ok(allSourcesResponse.ok(), 'Clearing sources preserves topic filters and the equalized request path');
    assert.ok(await followingSources.getByRole('button', { name: 'Clear sources', exact: true }).isDisabled());
    assert.equal(await followingSources.getByRole('button', { name: 'All sources', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS: equalized Home/Following, single/multiple selections, pagination, refresh and reload at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }

