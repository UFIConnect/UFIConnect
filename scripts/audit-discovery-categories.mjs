import { installAuditMember, auditNavigate } from './audit-session.mjs';
import assert from 'node:assert/strict';
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
app.seedUser(member('category-reader', { plan: 'pro' }));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5227, strictPort: false, proxy: { '/api': { target: app.base, rewrite: p => p.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, isMobile: width < 600, hasTouch: width < 600 });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], queries = [], published = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url()), endpoint = url.pathname.replace(/^\/api/, '');
      if (/events|stream/.test(endpoint)) return route.abort();
      if (endpoint === '/office/feed') {
        queries.push(url.searchParams);
        const mode = url.searchParams.get('mode'), q = url.searchParams.get('q') || '';
        const posts = ['Italian restaurant opens downtown', 'Japanese restaurant opens downtown'].map((title, index) => ({
          id: `category-${index}`, title, content: title, source: 'reddit', sourceUrl: 'https://www.reddit.com/r/food/',
          author: { name: 'Food circle' }, createdAt: new Date().toISOString(), topic: 'Restaurant Culture',
        })).filter(post => !q || post.title.toLowerCase().includes(q));
        return route.fulfill({ json: { mode, posts, liveFeeds: [], hasMore: false, cursor: 'category-cursor', nativeUficonnectIncluded: true } });
      }
      if (endpoint === '/social/platforms') return route.fulfill({ json: { connected: { reddit: true }, platforms: { reddit: { configured: true, crossPost: { supported: true, media: 'link' } } } } });
      if (endpoint === '/command-center/cross-post/history') return route.fulfill({ json: { posts: [] } });
      if (endpoint === '/command-center/cross-post') {
        published.push(route.request().postDataJSON());
        return route.fulfill({ json: { id: 'category-post', historySaved: true, targets: [{ platform: 'reddit', status: 'posted', postedUrl: 'https://www.reddit.com/r/food/comments/example/' }] } });
      }
      return route.continue();
    });
    await installAuditMember(page, app, 'category-reader');
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=restaurants');
    const cuisines = page.getByRole('group', { name: 'Cuisines', exact: true });
    const assertInlineActions = async (bar, label) => {
      await bar.waitFor();
      const toolbar = bar.locator('..');
      const post = toolbar.getByRole('link', { name: `Post to ${label}`, exact: true });
      const topics = toolbar.getByRole('button', { name: 'Filter feed by topic', exact: true });
      assert.equal(await post.count(), 1, 'Each category toolbar has one posting action alongside Topics');
      const [barBox, postBox, topicBox] = await Promise.all([bar.boundingBox(), post.boundingBox(), topics.boundingBox()]);
      const center = box => box.y + box.height / 2;
      assert.ok(Math.abs(center(barBox) - center(postBox)) < 2 && Math.abs(center(barBox) - center(topicBox)) < 2, `${label} chips, Post and Topics share one row`);
      assert.ok(postBox.x >= barBox.x + barBox.width - 2 && topicBox.x >= postBox.x + postBox.width - 2);
    };
    await assertInlineActions(cuisines, 'Restaurants');
    await cuisines.getByRole('button', { name: 'Italian', exact: true }).click();
    await page.getByText('Italian restaurant opens downtown', { exact: true }).first().waitFor();
    assert.ok(queries.some(query => query.get('mode') === 'restaurants' && query.get('q') === 'italian'));
    assert.equal(await page.getByText('Japanese restaurant opens downtown', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Filter feed by topic', exact: true }).click();
    await page.getByRole('button', { name: 'Restaurant Culture', exact: true }).click();
    await Promise.all([
      page.waitForResponse(response => response.url().includes('/office/feed?') && response.url().includes('topics=Restaurant') && response.url().includes('q=italian')),
      page.getByRole('button', { name: 'Apply topics', exact: true }).click(),
    ]);
    await Promise.all([
      page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname.endsWith('/office/feed') && url.searchParams.get('mode') === 'restaurants'
          && url.searchParams.get('topics') === 'Restaurant Culture' && !url.searchParams.has('q');
      }),
      cuisines.getByRole('button', { name: 'Clear cuisines', exact: true }).click(),
    ]);
    assert.equal(await cuisines.getByRole('button', { name: 'Italian', exact: true }).getAttribute('aria-pressed'), 'false');
    assert.ok(await cuisines.getByRole('button', { name: 'Clear cuisines', exact: true }).isDisabled());
    await page.getByText('Japanese restaurant opens downtown', { exact: true }).first().waitFor();
    await cuisines.getByRole('button', { name: 'Italian', exact: true }).click();
    await cuisines.locator('..').getByRole('link', { name: 'Post to Restaurants', exact: true }).click();
    await page.getByRole('heading', { name: 'Post to Restaurants', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Open Food circle', exact: true }).getAttribute('href'), 'https://www.reddit.com/r/food/');
    await page.getByRole('button', { name: /Reddit/, exact: false }).first().click();
    await page.getByPlaceholder('What would you like to share about restaurants?').fill('Our new restaurant update.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('heading', { name: 'Result', exact: true }).waitFor();
    assert.deepEqual(published[0].platforms, ['reddit']);
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=bars');
    const themes = page.getByRole('group', { name: 'Bar and club themes', exact: true });
    await assertInlineActions(themes, 'Bars and clubs');
    assert.match(await themes.locator('..').getByRole('link', { name: 'Post to Bars and clubs', exact: true }).getAttribute('href'), /command-center\?tab=crosspost&category=bars$/);
    await themes.getByRole('button', { name: 'Clubs', exact: true }).click();
    await page.waitForTimeout(100);
    assert.ok(queries.some(query => query.get('mode') === 'bars' && query.get('q') === 'club'));
    await themes.getByRole('button', { name: 'Clear bar and club themes', exact: true }).click();
    assert.equal(await themes.getByRole('button', { name: 'Clubs', exact: true }).getAttribute('aria-pressed'), 'false');
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=countries');
    const rail = page.getByRole('region', { name: 'Live travel cameras', exact: true });
    const cities = rail.getByRole('group', { name: 'Travel cities', exact: true });
    const seattle = cities.locator('[data-destination-id="US:Seattle"]');
    await seattle.waitFor({ state: 'attached' });
    assert.equal(await cities.getByRole('button').count(), 91);
    const events = page.getByRole('group', { name: 'Travel events', exact: true });
    await assertInlineActions(events, 'Travel');
    assert.ok((await events.boundingBox()).y >= (await rail.boundingBox()).y + (await rail.boundingBox()).height - 2);
    await events.getByRole('button', { name: 'Festivals', exact: true }).click();
    await page.waitForTimeout(100);
    assert.ok(queries.some(query => query.get('mode') === 'countries' && query.get('q') === 'festival'));
    await seattle.click();
    await page.waitForFunction(() => document.querySelector('[data-destination-id="US:Seattle"]')?.getAttribute('aria-pressed') === 'true');
    await events.getByRole('button', { name: 'Clear travel events', exact: true }).click();
    assert.equal(await events.getByRole('button', { name: 'Festivals', exact: true }).getAttribute('aria-pressed'), 'false');
    assert.equal(await seattle.getAttribute('aria-pressed'), 'true', 'clearing events preserves the saved city');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'category controls do not overflow the viewport');
    assert.deepEqual(errors, []);
    console.log(`PASS: cuisine/theme/event requests, Topics preservation, city placement and connected publishing at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
