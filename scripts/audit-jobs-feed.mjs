import { installAuditMember, auditNavigate } from './audit-session.mjs';
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
const app = await createAppHarness({ connected: true });
app.seedUser(member('jobs-audit'));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5202, strictPort: false, proxy: { '/api': { target: app.base, rewrite: p => p.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  for (const width of [1440, 768, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, timezoneId: 'America/Los_Angeles', hasTouch: width < 1000, isMobile: width < 600 });
    const page = await context.newPage();
    const requests = [];
    const jobs = Array.from({ length: 65 }, (_, i) => ({ id: `job-${i}`, title: `Engineer ${i}`, org: 'Example', source: 'Remotive', sourceUrl: `https://example.com/jobs/${i}`, content: 'Build and maintain products with an experienced team. Review the role and requirements.', remote: i % 2 === 1, location: i % 2 ? 'Remote' : 'San Diego', posted: i === 0 ? null : '2025-02-03T00:00:00Z', isLive: true, tags: [] }));
    await page.route('**/api/opportunities?*', async route => {
      const p = new URL(route.request().url()).searchParams;
      const offset = Number(p.get('offset') || 0);
      requests.push({ offset, bust: p.get('bust'), postedWithin: p.get('postedWithin') });
      await route.fulfill({ json: { opportunities: jobs.slice(offset, offset + 20).map(job => p.get('postedWithin') ? { ...job, id: `${job.id}-date-${p.get('postedWithin')}` } : job), hasMore: offset + 20 < jobs.length, totalCount: jobs.length, availableSources: ['Remotive'] } });
    });
    await auditNavigate(page, server.resolvedUrls.local[0]);
    await installAuditMember(page, app, 'jobs-audit');
    await auditNavigate(page, server.resolvedUrls.local[0] + 'opportunities');
    await page.locator('.job-result-tab').first().waitFor();
    assert.equal(await page.locator('.opportunities-page-header, .jobs-personalization-status, .job-result-section-heading').count(), 0);
    assert.match(await page.locator('.job-result-tab').first().textContent(), /Posting date unavailable/);
    assert.match(await page.locator('.job-result-tab').nth(1).textContent(), /Feb 3, 2025/);
    assert.match(await page.locator('.job-result-tab').first().textContent(), /Engineer 0/);
    for (let i = 0; i < 12 && await page.locator('.job-result-tab').count() < 65; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(250);
    }
    assert.equal(await page.locator('.job-result-tab').count(), 65);
    assert.deepEqual([...new Set(requests.map(r => r.offset))], [0, 20, 40, 60]);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => document.querySelectorAll('.job-result-tab').length === 20);
    assert.ok(requests.some(r => r.bust === '1' && r.offset === 0));
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/jobs-feed-${width}.png`) });
    await page.getByRole('button', { name: 'Open Engineer 1 at Example', exact: true }).click();
    await page.getByRole('heading', { name: 'Engineer 1', exact: true }).waitFor();
    assert.match(await page.locator('.job-detail-facts').textContent(), /Feb 3, 2025/);
    await auditNavigate(page, server.resolvedUrls.local[0] + 'opportunities?postedWithin=7');
    await page.locator('.job-result-tab').first().waitFor().catch(async error => {
      console.error(page.url(), await page.locator('body').innerText(), requests.slice(-5));
      throw error;
    });
    assert.ok(requests.some(r => r.postedWithin === '7' && r.offset === 0));
    if (width === 1440) {
      const response = page.waitForResponse(r => r.url().includes('/opportunities?') && new URL(r.url()).searchParams.get('postedWithin') === '1');
      await page.getByRole('radio', { name: 'Today', exact: true }).click();
      await response;
      assert.equal(await page.locator('.jobs-page-rail a').filter({ hasText: /^Saved$/ }).count(), 0);
    }
    console.log(`PASS: jobs feed, pagination, refresh and dates at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
