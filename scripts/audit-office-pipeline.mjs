import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: path.join(root, 'office'), configFile: path.join(root, 'office/vite.config.js'), envFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify(''), 'import.meta.env.VITE_PIPELINE_API_URL': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 5213, strictPort: false },
});
const now = new Date().toISOString();
const posts = Array.from({ length: 45 }, (_, i) => ({ id: `audit-post-${i}`, title: i === 0 ? 'Python engineering opportunities across global research teams' : `Pipeline item ${i}`,
  source: i % 2 ? 'news' : 'youtube', stage: i === 1 ? 'rejected' : 'staging', reason: i === 1 ? 'Content screening failed' : 'Awaiting transfer', updated_at: now, topic: 'Engineering', media_type: 'video' }));
let browser;
try {
  await server.listen();
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [1440, 768, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, isMobile: width < 600, hasTouch: width < 600 });
    await context.addInitScript(() => localStorage.setItem('ufi_office_token', 'legacy-must-be-deleted'));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let failList = false, failDetail = false, controlRequests = 0, executions = 0;
    await page.route(url => url.pathname.startsWith('/office/'), async route => {
      const url = new URL(route.request().url());
      assert.equal(url.searchParams.has('token'), false, 'Office tokens never appear in URLs');
      if (route.request().headers()['x-office-token'] !== 'audit-only') {
        return route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
      }
      if (url.pathname.endsWith('/post-pipeline/detail')) {
        if (failDetail) return route.fulfill({ status: 503, json: { error: 'History temporarily unavailable' } });
        const post = posts.find(row => row.id === url.searchParams.get('id'));
        return route.fulfill({ json: { id: post.id, snapshots: [{ ...post, fetched_at: now, content: 'A complete source post', source_url: 'https://example.com/post' }],
          events: [{ event_id: 'event-2', post_id: post.id, ...post, stage: 'staging', role: 'pipeline', reason: 'Persistence completed', occurred_at: now },
            { event_id: 'event-1', post_id: post.id, stage: 'retrying', role: 'pipeline', reason: 'Persistence failed; retained in retry queue', occurred_at: now }],
          queuePosition: 12, fetchedAt: now, retentionDays: 7, historyTruncated: false } });
      }
      if (url.pathname.endsWith('/post-pipeline')) {
        if (failList) return route.fulfill({ status: 503, json: { error: 'Post pipeline could not be loaded. Please retry.' } });
        const query = url.searchParams.get('q')?.toLowerCase(), source = url.searchParams.get('source'), stage = url.searchParams.get('stage');
        const matches = posts.filter(post => (!query || `${post.id} ${post.title}`.toLowerCase().includes(query)) && (!source || post.source === source) && (!stage || stage === 'all' || post.stage === stage));
        const offset = Number(url.searchParams.get('offset')) || 0;
        return route.fulfill({ json: { posts: matches.slice(offset, offset + 40), offset, limit: 40, hasMore: matches.length > offset + 40,
          stats: { staging: 44, live: 103000, archived: 50000, retained_events: 1100, oldest_staged_at: now, history_starts_at: now }, fetchedAt: now,
          coverage: { retentionDays: 7, maxEvents: 100000 }, tracker: { pendingEvents: 0, droppedEvents: 0, lastPersistedAt: now }, serviceRole: 'api' } });
      }
      if (url.pathname.endsWith('/status')) return route.fulfill({ json: { server: { uptime: 12000, db: 'connected' }, postPipeline: { pendingEvents: 0, droppedEvents: 0, lastPersistedAt: now } } });
      if (url.pathname.endsWith('/controls')) { controlRequests++; return route.fulfill({ json: { controls: [{ id: 'health.test', label: 'Refresh source status', category: 'Diagnostics', target: 'api', available: true }], history: [] } }); }
      if (url.pathname.endsWith('/execute')) { executions++; return route.fulfill({ json: { result: { ok: true } } }); }
      if (url.pathname.endsWith('/stream')) return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"backlog":[]}\n\n' });
      return route.fulfill({ json: { agents: {} } });
    });
    await page.goto(server.resolvedUrls.local[0] + '#post-pipeline', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.getByLabel('Access token', { exact: true }).fill('audit-only');
    assert.equal(await page.getByLabel('Access token', { exact: true }).getAttribute('type'), 'password');
    await page.getByRole('button', { name: 'Show access token', exact: true }).click();
    assert.equal(await page.getByLabel('Access token', { exact: true }).getAttribute('type'), 'text');
    const accessBounds = await page.getByRole('dialog').boundingBox();
    assert.ok(accessBounds.x >= 0 && accessBounds.x + accessBounds.width <= width, 'Access dialog fits the viewport');
    assert.equal(await page.getByRole('button', { name: 'Hide access token', exact: true }).getAttribute('aria-pressed'), 'true');
    const protection = await page.getByLabel('Access token', { exact: true }).evaluate(element => {
      return ['copy', 'cut', 'dragstart'].every(type => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      });
    });
    assert.equal(protection, true, 'Revealed Office credentials still reject clipboard export');
    await page.getByRole('button', { name: 'Unlock Office', exact: true }).focus();
    assert.equal(await page.getByLabel('Access token', { exact: true }).getAttribute('type'), 'password');
    await page.getByRole('button', { name: 'Show access token', exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(await page.getByLabel('Access token', { exact: true }).getAttribute('type'), 'password');
    await page.getByRole('button', { name: 'Show access token', exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    assert.equal(await page.getByLabel('Access token', { exact: true }).getAttribute('type'), 'password');
    await page.getByRole('button', { name: 'Unlock Office', exact: true }).click();
    assert.equal(await page.locator('#office-access-token').inputValue(), '', 'Submission clears the entered credential');
    assert.equal(await page.evaluate(() => localStorage.getItem('ufi_office_token')), null);
    await page.getByRole('button', { name: posts[0].title, exact: true }).waitFor();
    await page.getByLabel('Auto-refresh').uncheck();
    assert.equal(await page.locator('.pp-list tbody tr').count(), 40);
    await page.getByRole('button', { name: 'Next pipeline page' }).click();
    await page.getByRole('button', { name: 'Pipeline item 44', exact: true }).waitFor();
    assert.equal(await page.locator('.pp-list tbody tr').count(), 5);
    await page.getByRole('button', { name: 'Previous pipeline page' }).click();
    await page.getByRole('button', { name: posts[0].title, exact: true }).click();
    await page.getByText('Persistence completed', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Storage & Metadata' }).click();
    await page.getByText('A complete source post', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Event History' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download post history' }).click();
    assert.equal((await download).suggestedFilename(), 'post-pipeline-history.json');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/office-pipeline-${width}.png`), fullPage: false });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Office overflow at ${width}`);
    assert.ok((await page.getByLabel('Stage', { exact: true }).boundingBox()).width >= 110, `Readable stage filter at ${width}`);
    failDetail = true;
    await page.getByRole('button', { name: 'Refresh post details' }).click();
    await page.getByText('History temporarily unavailable', { exact: true }).waitFor();
    assert.equal(await page.getByText('Persistence completed', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Close post details' }).click();
    await page.getByLabel('Stage', { exact: true }).selectOption('rejected');
    // The selected post also exists in the old unfiltered page. Wait for the
    // filtered row count before using its title as proof that loading finished.
    await page.waitForFunction(() => document.querySelectorAll('.pp-list tbody tr').length === 1);
    await page.getByRole('button', { name: 'Pipeline item 1', exact: true }).waitFor();
    assert.equal(await page.locator('.pp-list tbody tr').count(), 1);
    await page.getByRole('button', { name: 'Clear pipeline filters' }).click();
    await page.getByRole('searchbox', { name: 'Search pipeline posts' }).fill('no such post');
    await page.getByText('No posts match these filters.').waitFor();
    failList = true;
    await page.getByRole('button', { name: 'Refresh pipeline', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Post pipeline could not be loaded' }).waitFor();
    failList = false;
    await page.getByRole('button', { name: 'Clear pipeline filters' }).click();
    await page.getByRole('button', { name: posts[0].title, exact: true }).waitFor();
    await page.getByRole('button', { name: 'Controls', exact: true }).click();
    await page.getByText(/^1 controls ready\./).waitFor();
    assert.ok(controlRequests > 0, 'same-origin Office controls load');
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.getByText('Refresh source status completed.', { exact: true }).waitFor();
    assert.equal(executions, 1, 'same-origin controls execute exactly once');
    assert.deepEqual(errors, []);
    console.log(`Office post pipeline ${width}px: pagination, detail, export, filters, outages, controls, layout passed`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); }
