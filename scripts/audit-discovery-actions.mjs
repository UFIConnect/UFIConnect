import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate } from './audit-session.mjs';

const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-ui');
await fs.mkdir(output, { recursive: true });
const app = await createAppHarness();
const proxy = prefix => ({ target: app.base, rewrite: value => value.replace(prefix, '') });
const server = await createServer({
  root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/fallback') },
  server: { host: '127.0.0.1', port: 5278, strictPort: false,
    proxy: { '/api': proxy(/^\/api/), '/fallback': proxy(/^\/fallback/) } },
});
let browser, checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const selectedSources = params => (params.get('sources') || params.get('source') || '').split(',').filter(Boolean).sort();
async function closeContext(context) {
  // Finish response overrides before closing their APIRequestContext. A late
  // catalog fetch may still be reading its body after the final UI assertion.
  await Promise.all([
    context.unrouteAll({ behavior: 'wait' }),
    ...context.pages().map(page => page.unrouteAll({ behavior: 'wait' })),
  ]);
  await context.close();
}
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [1440, 390, 320]) {
    const userId = `discovery-actions-audit-${width}`;
    app.seedUser(member(userId, { preferences: { interests: [] } }));
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
      const endpoint = url.pathname.replace(/^\/(api|fallback)/, '');
      if (/events|stream/.test(endpoint) && /^\/(api|fallback)\//.test(url.pathname)) return route.abort();
      if (endpoint === '/social/platforms') {
        const response = await route.fetch(), catalog = await response.json();
        return route.fulfill({ response, json: { ...catalog, connected: { ...catalog.connected, reddit: true, github: true } } });
      }
      if (endpoint !== '/office/feed') return route.continue();
      const params = new URLSearchParams(url.searchParams);
      requests.push(params);
      const chosen = selectedSources(params), mode = params.get('mode');
      const sources = chosen.length ? chosen : mode === 'groups' ? ['uficonnect'] : mode === 'following' ? ['reddit', 'github'] : ['reddit', 'hackernews'];
      return route.fulfill({ json: { mode,
        posts: Array.from({ length: 4 }, (_, index) => ({
          id: `${mode}-${chosen.join('-') || 'all'}-${index}`, source: sources[index % sources.length],
          title: `Discovery audit ${mode} story ${index}`, topic: 'Open Source',
          content: 'An open source community discussion with useful technical details.',
          sourceUrl: 'https://example.invalid/discovery/' + index,
          createdAt: new Date(Date.now() - index * 1000).toISOString(), likesCount: 0, commentsCount: 0,
          ...(mode === 'groups' ? { groupId: 'joined-group', group: { id: 'joined-group', name: 'Audit community' } } : {}),
        })), nativeUficonnectIncluded: true, hasMore: false, cursor: '',
      } });
    });
    await installAuditMember(page, app, userId);
    await auditNavigate(page, base + '?feed=feed');
    await page.getByText('Discovery audit feed story 0', { exact: true }).waitFor();
    const trigger = page.getByRole('button', { name: 'Filter feed by topic', exact: true });
    const popup = page.locator('.feed-topic-filter-popover');
    const category = name => popup.getByRole('group', { name: 'Filter categories', exact: true }).getByRole('button', { name: new RegExp('^' + name + '(?: \\(\\d+\\))?$') });
    const sources = () => popup.getByRole('group', { name: 'Sources', exact: true });
    async function openSources() {
      if (!await popup.isVisible()) await trigger.click();
      await category('Sources').click();
    }
    async function chooseSource(label, query = label) {
      await popup.getByRole('searchbox', { name: 'Search sources', exact: true }).fill(query);
      await sources().getByRole('button', { name: label, exact: true }).click();
    }
    async function chooseTopic() {
      await category('Topics').click();
      await popup.getByRole('searchbox', { name: 'Search topics', exact: true }).fill('Open Source');
      await popup.getByRole('group', { name: 'Topics', exact: true }).getByRole('button', { name: 'Open Source', exact: true }).click();
    }
    async function applyAndWait(predicate) {
      const result = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname.endsWith('/office/feed') && predicate(url.searchParams);
      });
      await popup.getByRole('button', { name: 'Apply filters', exact: true }).click();
      check((await result).ok(), 'Filter request succeeds');
      await popup.waitFor({ state: 'hidden' });
    }

    await trigger.click();
    check(await popup.getByRole('group', { name: 'Filter categories', exact: true }).count() === 0, 'Home Topics has no source category');
    await popup.getByRole('group', { name: 'Topics', exact: true }).getByRole('button', { name: 'Open Source', exact: true }).click();
    await popup.getByRole('button', { name: 'Apply topics', exact: true }).click();
    const homeSources = page.getByRole('group', { name: 'Home sources', exact: true });
    await homeSources.getByRole('button', { name: 'Reddit', exact: true }).click();
    await trigger.click();
    check(await popup.getByRole('group', { name: 'Sources', exact: true }).count() === 0, 'Home source choices stay outside Topics');
    await popup.getByRole('button', { name: 'Clear', exact: true }).click();
    const homeApplied = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/office/feed') && url.searchParams.get('mode') === 'feed' && url.searchParams.get('source') === 'reddit' && !url.searchParams.has('topics');
    });
    await popup.getByRole('button', { name: 'Apply topics', exact: true }).click();
    check((await homeApplied).ok(), 'Home topic clear preserves quick-source choice');
    await homeSources.getByRole('button', { name: 'Clear sources', exact: true }).click();
    await auditNavigate(page, base + '?feed=groups&groupScope=public');
    await page.getByText('Discovery audit groups story 0', { exact: true }).waitFor();
    await openSources();
    await chooseSource('Reddit', 'Red');
    check(await sources().getByRole('button', { name: 'Reddit', exact: true }).getAttribute('aria-pressed') === 'true', 'Source draft selects searched provider');
    check(await sources().getByRole('button', { name: 'Hacker News', exact: true }).count() === 0, 'Source search narrows choices');
    await chooseTopic();
    await category('Sources').click();
    check(await sources().getByRole('button', { name: 'Reddit', exact: true }).getAttribute('aria-pressed') === 'true', 'Switching categories retains source draft');
    await trigger.click();
    await openSources();
    await popup.getByRole('searchbox', { name: 'Search sources', exact: true }).fill('Red');
    check(await sources().getByRole('button', { name: 'Reddit', exact: true }).getAttribute('aria-pressed') === 'false', 'Closing without Apply discards draft selection');
    await chooseSource('Reddit', 'Red');
    await chooseSource('Hacker News', 'Hacker');
    await chooseTopic();
    await applyAndWait(params => params.get('mode') === 'groups' && params.get('topics') === 'Open Source' && selectedSources(params).join(',') === 'hackernews,reddit');
    check(requests.some(params => params.get('topics') === 'Open Source' && selectedSources(params).join(',') === 'hackernews,reddit'), 'Topic and multiple source choices reach one feed request');
    await openSources();
    await popup.getByRole('searchbox', { name: 'Search sources', exact: true }).fill('Red');
    check(await sources().getByRole('button', { name: 'Reddit', exact: true }).getAttribute('aria-pressed') === 'true', 'Applied source survives reopening');
    await popup.getByRole('button', { name: 'Clear', exact: true }).click();
    await applyAndWait(params => params.get('mode') === 'groups' && !params.has('topics') && selectedSources(params).length === 0);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Feed fits ${width}px`);

    await auditNavigate(page, base + '?feed=following');
    await page.getByText('Discovery audit following story 0', { exact: true }).waitFor();
    await page.getByRole('group', { name: 'Following sources', exact: true })
      .getByRole('button', { name: 'GitHub', exact: true }).waitFor();
    await openSources();
    await chooseSource('GitHub', 'GitHub');
    await chooseTopic();
    await applyAndWait(params => params.get('mode') === 'following' && params.get('topics') === 'Open Source' && selectedSources(params).join(',') === 'github');
    await openSources();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Open topic/source filter fits ${width}px`);
    const bounds = await popup.boundingBox();
    check(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, `Popup remains inside ${width}px viewport`);
    await page.screenshot({ path: path.join(output, `topic-sources-${width}.png`), fullPage: true });
    await trigger.click();

    await auditNavigate(page, base + '?feed=groups');
    await page.getByRole('tab', { name: 'Your groups', exact: true }).waitFor();
    check(await page.locator('.feed-group-filter-row').getByRole('link', { name: 'Create a group', exact: true }).count() === 0, 'Groups feed omits create action');
    await auditNavigate(page, base + 'groups');
    await page.getByRole('heading', { name: 'Discover Groups', exact: true }).waitFor();
    check(await page.locator('.groups-page-actions').getByRole('button', { name: 'Create a group', exact: true }).count() === 0, 'Discover Groups omits create action');
    await auditNavigate(page, base + 'search?tab=groups');
    await page.locator('.search-group-filters').waitFor();
    check(await page.locator('.search-group-actions').getByRole('button', { name: 'Create a group', exact: true }).count() === 0, 'Groups search omits create action');
    assert.deepEqual(errors, []); checks++;
    await closeContext(context);
    console.log(`PASS: combined topic/source filters and group browsing at ${width}px`);
  }
  await fs.writeFile(path.join(output, 'discovery-actions-results.json'), JSON.stringify({ passed: true, checks, widths: [1440, 390, 320], productionWrites: 0 }, null, 2) + '\n');
} catch (error) {
  const page = browser?.contexts().at(-1)?.pages().at(-1);
  if (page) {
    await page.screenshot({ path: path.join(output, 'discovery-actions-failure.png'), fullPage: true });
    console.error((await page.locator('body').innerText()).slice(-3500));
  }
  throw error;
} finally {
  for (const context of browser?.contexts() || []) await closeContext(context);
  await browser?.close(); await server.close(); await app.close();
}
