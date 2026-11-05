import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-ui');
const API = 'https://office-navigation.invalid';
const filePath = 'web/src/NavigationFixture.jsx';
const original = 'export const label = "Before";\n';
const server = await createServer({ root: path.join(root, 'office'),
  configFile: path.join(root, 'office/vite.config.js'), envDir: false,
  define: { 'import.meta.env.MODE': JSON.stringify('release-local'),
    'import.meta.env.VITE_API_URL': JSON.stringify(API), 'import.meta.env.VITE_PIPELINE_API_URL': JSON.stringify(API) },
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});
let browser;
try {
  await server.listen();
  await fs.mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const width of [1440, 768, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 } });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [], writes = [];
    let failSection = false;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.port === '4173') return route.fulfill({ contentType: 'text/html', body: '<h1>Website preview</h1>' });
      if (url.pathname.startsWith('/__local-web/')) {
        assert.equal(request.headers()['x-office-token'], undefined);
        if (request.method() !== 'GET') { writes.push(url.pathname); return route.abort(); }
        if (url.pathname.endsWith('/status')) return route.fulfill({ json: { previewUrl: 'http://127.0.0.1:4173' } });
        if (url.pathname.endsWith('/files')) return route.fulfill({ json: { files: [{ path: filePath }] } });
        return route.fulfill({ json: { path: filePath, content: original, revision: 'fixture-revision' } });
      }
      if (url.origin !== API) return route.continue();
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-office-token,content-type,accept',
        'Access-Control-Allow-Methods': 'GET,OPTIONS' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (request.method() !== 'GET') { writes.push(url.pathname); return route.abort(); }
      if (request.headers()['x-office-token'] !== 'navigation-fixture') return route.fulfill({ status: 401, headers, json: {} });
      if (url.pathname.endsWith('/stream')) return route.fulfill({ headers, contentType: 'text/event-stream', body: 'data: {"backlog":[]}\n\n' });
      if (url.pathname === '/office/feed-audit') return route.fulfill({ headers, json: { sources: failSection ? {} : [], items: [], reasons: [], commands: [], policy: {} } });
      return route.fulfill({ headers, json: { server: { uptime: 120, db: 'connected' }, agents: {}, sources: { total: 0, workers: [] },
        items: [], reasons: [], commands: [], history: [], controls: [], versions: [], policy: {} } });
    });
    await page.goto(server.resolvedUrls.local[0] + '#overview', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Access token', { exact: true }).fill('navigation-fixture');
    await page.getByRole('button', { name: 'Unlock Office', exact: true }).click();
    const nav = page.getByRole('navigation', { name: 'Office sections' });
    const choose = name => nav.getByRole('button', { name, exact: true }).click();
    const active = async (id, label) => {
      await page.waitForFunction(hash => location.hash === hash, '#' + id);
      await nav.locator('[aria-current="page"]').filter({ hasText: label }).waitFor();
      assert.equal(await nav.getByRole('button', { name: label, exact: true }).getAttribute('aria-current'), 'page');
    };
    await choose('Live Sources'); await active('sources', 'Live Sources');
    await choose('Local web'); await active('local-web', 'Local web');
    const localUrl = page.url();
    const toggle = nav.locator('.office-nav-toggle');
    await toggle.click();
    const search = nav.getByRole('searchbox', { name: 'Find an Office tool' });
    await search.fill('flood');
    assert.equal(await nav.locator('.office-nav-more button').count(), 1);
    await choose('Feed Audit'); await active('feed-audit', 'Feed Audit');
    await page.goBack(); await active('local-web', 'Local web');
    await page.goForward(); await active('feed-audit', 'Feed Audit');
    await page.evaluate(() => { location.hash = 'sources'; }); await active('sources', 'Live Sources');
    await page.goBack(); await active('feed-audit', 'Feed Audit');
    await search.fill('no-match-fixture');
    await nav.getByRole('status').waitFor();
    assert.equal(await nav.locator('.office-nav-more button').count(), 0);
    await search.press('Escape');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await toggle.evaluate(element => element === document.activeElement), true);
    await toggle.click(); await search.fill('');
    for (const group of ['Content flow', 'People and insights', 'Operations']) {
      assert.equal(await nav.getByRole('region', { name: group, exact: true }).count(), 1);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: navigation fits viewport`);
    await page.screenshot({ path: path.join(output, `office-navigation-${width}.png`) });

    // Use the real Local web editor guard; navigation must preserve dirty text and history.
    await search.fill('preview and edit');
    await nav.locator('.office-nav-more').getByRole('button', { name: 'Local web', exact: true }).click();
    assert.equal(await nav.locator('.office-nav-primary [data-office-view="local-web"]').evaluate(element => element === document.activeElement), true);
    await page.getByLabel('Website file', { exact: true }).waitFor();
    await choose('Live Sources');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByLabel('Access token', { exact: true }).fill('navigation-fixture');
    await page.getByRole('button', { name: 'Unlock Office', exact: true }).click();
    await page.goBack(); await active('local-web', 'Local web');
    await page.getByLabel('Website file', { exact: true }).selectOption(filePath);
    const editor = page.locator('#local-web-content');
    await editor.fill(original + '// Unsaved edit\n');
    let dialogs = 0;
    const dismiss = async dialog => { dialogs++; await dialog.dismiss(); };
    page.on('dialog', dismiss);
    await choose('Live Sources'); await active('local-web', 'Local web');
    await page.goBack();
    await page.waitForFunction(expected => location.href === expected, localUrl);
    await page.goForward();
    await page.waitForFunction(expected => location.href === expected, localUrl);
    assert.equal(await editor.inputValue(), original + '// Unsaved edit\n');
    assert.equal(dialogs, 3, `${width}: click, Back and Forward after reload each prompt once`);
    // Cancelled Back preserves the entry so a later confirmed Back/Forward still works.
    page.off('dialog', dismiss);
    page.once('dialog', dialog => dialog.accept());
    await page.goBack(); await active('feed-audit', 'Feed Audit');
    await page.goForward(); await active('local-web', 'Local web');
    failSection = true;
    await choose('Feed Audit');
    await page.getByRole('heading', { name: 'This section couldn’t open', exact: true }).waitFor();
    assert.equal(await nav.isVisible(), true, `${width}: section failure leaves navigation usable`);
    failSection = false;
    await page.getByRole('button', { name: 'Try this section again', exact: true }).click();
    await page.getByRole('heading', { name: 'Feed Audit', exact: true }).waitFor();
    await choose('Local web'); await active('local-web', 'Local web');
    assert.deepEqual(errors, [], `${width}: no browser exceptions`);
    assert.deepEqual(writes, [], `${width}: navigation performs no writes`);
    await context.close();
    console.log(`Office navigation ${width}px: grouped search, direct links, Back/Forward, Escape, unsaved edits, section recovery and responsive layout passed`);
  }
} finally { await browser?.close(); await server.close(); }
