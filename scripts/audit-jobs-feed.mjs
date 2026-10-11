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
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5202, strictPort: false, proxy: { '/api': { target: app.base, rewrite: p => p.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  for (const width of [1440, 768, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, timezoneId: 'America/Los_Angeles', hasTouch: width < 1000, isMobile: width < 600 });
    const page = await context.newPage();
    const requests = [];
    const jobs = Array.from({ length: 65 }, (_, i) => ({ id: `job-${i}`, title: `Engineer ${i}`, org: 'Example', source: 'Remotive', sourceUrl: `https://example.com/jobs/${i}`, content: 'Build and maintain products with an experienced team. Review the role and requirements.', fullDescription: '<p>Join our engineering team to build reliable products.</p><h2>Main responsibilities</h2><p>Build and maintain products with an experienced team.</p><h2>Required qualifications</h2><p>Experience delivering accessible web applications.</p><h2>Benefits</h2><p>Paid leave as described by the employer.</p><script>window.untrustedListing = true</script>', remote: i % 2 === 1, location: i % 2 ? 'Remote' : 'San Diego', posted: i === 0 ? null : '2025-02-03T00:00:00Z', isLive: true, tags: [] }));
    jobs[2].sourceUrl = 'javascript:window.untrustedJobLink=true';
    await page.route('**/api/opportunities?*', async route => {
      const p = new URL(route.request().url()).searchParams;
      const offset = Number(p.get('offset') || 0);
      requests.push({ offset, bust: p.get('bust'), postedWithin: p.get('postedWithin'), refresh: p.get('refresh'), exclude: p.get('exclude'), search: p.get('search') });
      const rows = p.get('refresh') ? jobs.map(job => ({ ...job, id: job.id + '-fresh', title: job.title + ' refreshed' })) : jobs;
      await route.fulfill({ json: { opportunities: rows.slice(offset, offset + 20).map(job => p.get('postedWithin') ? { ...job, id: `${job.id}-date-${p.get('postedWithin')}` } : job), hasMore: offset + 20 < jobs.length, totalCount: jobs.length, availableSources: ['Remotive'], refreshMode: p.get('refresh') ? 'unseen' : null } });
    });
    await auditNavigate(page, server.resolvedUrls.local[0]);
    await installAuditMember(page, app, 'jobs-audit');
    await auditNavigate(page, server.resolvedUrls.local[0] + 'opportunities');
    await page.locator('.job-result-tab').first().waitFor();
    if (width <= 768) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    const jobTools = page.locator(width <= 768 ? '#mobile-feed-drawer' : '.jobs-page-right-tabs');
    const jobSources = jobTools.getByRole('radiogroup', { name: 'Career sites', exact: true });
    for (const source of ['Indeed', 'Remote OK', 'Remotive', 'The Muse', 'USAJobs', 'We Work Remotely']) {
      assert.equal(await jobSources.getByRole('radio', { name: source, exact: true }).count(), 1);
    }
    const careerWebsites = jobTools.locator('.jobs-career-websites');
    await careerWebsites.locator('summary').click();
    const glassdoor = careerWebsites.getByRole('link', { name: 'Visit Glassdoor website', exact: true });
    assert.match(await glassdoor.getAttribute('href'), /^https:\/\//);
    assert.equal(await glassdoor.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(await jobSources.getByRole('radio', { name: 'Glassdoor', exact: true }).count(), 0, 'Website-only sites do not become feed filters');
    await careerWebsites.locator('summary').click();
    if (width <= 768) await page.keyboard.press('Escape');
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
    // Real trackpads return gradually; no single final scroll delta exceeds
    // the old refresh threshold. Remember the excursion until reaching top.
    await page.evaluate(async () => {
      for (const y of [600, 180, 50, 35, 20, 8, 0]) {
        window.scrollTo(0, y);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
    });
    await page.waitForFunction(() => document.querySelectorAll('.job-result-tab').length === 20);
    assert.ok(requests.some(r => r.bust === '1' && r.offset === 0));
    assert.match(await page.locator('.job-result-tab').first().textContent(), /Engineer 0 refreshed/);
    const freshRequest = requests.find(r => r.refresh && r.offset === 0);
    assert.ok(freshRequest.exclude.includes('job-0'), 'Refresh excludes the previously shown jobs');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForFunction(() => document.querySelectorAll('.job-result-tab').length > 20);
    assert.ok(requests.some(r => r.offset === 20 && r.refresh === freshRequest.refresh && r.exclude === freshRequest.exclude), 'Pagination keeps the refresh cohort');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/jobs-feed-${width}.png`) });
    await page.getByRole('button', { name: 'Open Engineer 1 refreshed at Example', exact: true }).click();
    await page.getByRole('heading', { name: 'Engineer 1 refreshed', exact: true }).waitFor();
    assert.match(await page.locator('.job-detail-facts').textContent(), /Feb 3, 2025/);
    const listingOpener = page.getByRole('button', { name: 'Read the full supplied listing', exact: true });
    await listingOpener.click();
    const listing = page.getByRole('dialog', { name: 'Engineer 1 refreshed', exact: true });
    await listing.waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent.includes('Close listing'));
    const panel = listing.getByRole('tabpanel');
    assert.match(await panel.textContent(), /Join our engineering team to build reliable products\./);
    assert.match(await panel.textContent(), /Experience delivering accessible web applications\./);
    assert.match(await panel.textContent(), /Paid leave as described by the employer\./);
    assert.equal(await listing.locator('script').count(), 0);
    assert.equal(await page.evaluate(() => window.untrustedListing), undefined);
    assert.match(await listing.locator('footer').textContent(), /Listing supplied by Remotive/);
    assert.equal(await listing.getByRole('link', { name: 'Open the original job listing' }).getAttribute('href'), 'https://example.com/jobs/1');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/career-listing-full-${width}.png`) });
    await listing.getByRole('tab', { name: 'Main responsibilities', exact: true }).click();
    assert.match(await panel.textContent(), /Build and maintain products with an experienced team\./);
    assert.doesNotMatch(await panel.textContent(), /Experience delivering accessible web applications/);
    await page.keyboard.press('ArrowRight');
    assert.equal(await listing.getByRole('tab', { name: 'Required qualifications', exact: true }).getAttribute('aria-selected'), 'true');
    assert.match(await panel.textContent(), /Experience delivering accessible web applications\./);
    await page.keyboard.press('End');
    assert.equal(await listing.getByRole('tab', { name: 'Benefits', exact: true }).getAttribute('aria-selected'), 'true');
    assert.match(await panel.textContent(), /Paid leave as described by the employer\./);
    assert.ok(await listing.evaluate(element => {
      const box = element.getBoundingClientRect();
      return box.left > 0 && box.right < innerWidth && box.top >= 0 && box.bottom <= innerHeight;
    }));
    assert.ok(await listing.getByRole('tablist').evaluate(element => {
      const buttons = [...element.querySelectorAll('[role="tab"]')];
      return buttons.every(button => Math.abs(button.getBoundingClientRect().top - buttons[0].getBoundingClientRect().top) < 2);
    }));
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/career-listing-${width}.png`) });
    await page.keyboard.press('Escape');
    await listing.waitFor({ state: 'detached' });
    assert.equal(await listingOpener.evaluate(element => document.activeElement === element), true);
    await listingOpener.click();
    await listing.getByRole('button', { name: 'Close listing', exact: true }).click();
    await listing.waitFor({ state: 'detached' });
    assert.equal(await listingOpener.evaluate(element => document.activeElement === element), true);
    await page.getByRole('link', { name: /Back to jobs/ }).click();
    await page.getByRole('button', { name: 'Open Engineer 2 at Example', exact: true }).click();
    await listingOpener.click();
    const unsafeSourceListing = page.getByRole('dialog', { name: 'Engineer 2', exact: true });
    await unsafeSourceListing.waitFor();
    assert.equal(await unsafeSourceListing.getByRole('link', { name: 'Open the original job listing' }).count(), 0);
    assert.match(await unsafeSourceListing.getByRole('tabpanel').textContent(), /Join our engineering team to build reliable products\./);
    assert.match(await unsafeSourceListing.locator('footer').textContent(), /Listing supplied by Remotive/);
    assert.equal(await page.evaluate(() => window.untrustedJobLink), undefined);
    await page.keyboard.press('Escape');
    await unsafeSourceListing.waitFor({ state: 'detached' });
    await auditNavigate(page, server.resolvedUrls.local[0] + 'opportunities?postedWithin=7');
    await page.locator('.job-result-tab').first().waitFor().catch(async error => {
      console.error(page.url(), await page.locator('body').innerText(), requests.slice(-5));
      throw error;
    });
    assert.ok(requests.some(r => r.postedWithin === '7' && r.offset === 0));
    const jobSearch = page.locator('.global-search-bar input');
    await jobSearch.fill('Engineer');
    const searched = page.waitForResponse(r => r.url().includes('/opportunities?') && new URL(r.url()).searchParams.get('search') === 'Engineer');
    await jobSearch.press('Enter');
    await searched;
    assert.equal(new URL(page.url()).searchParams.get('q'), 'Engineer');
    assert.equal(new URL(page.url()).searchParams.get('postedWithin'), '7');
    if (width === 1440) {
      const response = page.waitForResponse(r => r.url().includes('/opportunities?') && new URL(r.url()).searchParams.get('postedWithin') === '1');
      await page.getByRole('radio', { name: 'Today', exact: true }).click();
      await response;
      assert.equal(await page.locator('.jobs-page-rail a').filter({ hasText: /^Saved$/ }).count(), 0);
    }
    console.log(`PASS: jobs feed, listing dialog, pagination, refresh and dates at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
