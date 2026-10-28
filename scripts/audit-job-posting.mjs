import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';
import { installAuditMember, auditNavigate, auditReload } from './audit-session.mjs';
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const { normalizeDetails } = require('../backend/business-posts');
const app = await createAppHarness();
app.seedUser(member('job-publisher-audit', { plan: 'business', name: 'Audit publisher', organization: 'Example employer' }));
app.seedUser(member('job-reader-audit', { plan: 'free', name: 'Audit reader' }));
const server = await startBuiltServer({ port: 0 });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
await fs.mkdir('.cache/audit-ui', { recursive: true });
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const errors = [], writes = [], listRequests = [], published = new Map();
    let nativeHidden = false, detailReads = 0, nativeOutage = false, currentUser = app.users[0];
    page.on('pageerror', error => errors.push(error.message));
    const common = { type: 'job', org: 'Example employer', content: 'Build accessible interfaces and review keyboard support.', description: 'Build accessible interfaces and review keyboard support.', location: 'Remote', remote: true, posted: new Date().toISOString(), isLive: true, tags: [] };
    const native = { ...common, id: 'bp_browser_audit', title: 'Accessibility engineer', source: 'UFIConnect', sourceUrl: 'https://uficonnect.org/opportunities/bp_browser_audit', nativeJob: true, author: { id: 'job-publisher-audit', name: 'Audit publisher' }, applyUrl: null };
    const external = Array.from({ length: 22 }, (_, index) => ({ ...common, id: 'external_' + index, title: 'External role ' + index, source: 'Remotive', sourceUrl: 'https://example.invalid/job/' + index }));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const headers = { 'Access-Control-Allow-Origin': server.origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (!['xhr', 'fetch'].includes(request.resourceType())) return url.origin === server.origin ? route.continue() : route.abort();
      const endpoint = url.pathname.replace(/^\/(api|fallback)/, '');
      const fulfill = (data, status = 200) => route.fulfill({ status, json: data, headers });
      if (endpoint === '/profile') return fulfill(app.fullProfile(currentUser));
      if (endpoint === '/billing/status') return fulfill({ plan: currentUser.plan, businessSeats: currentUser.plan === 'business' ? 1 : 0 });
      if (endpoint === '/jobs/posts' && request.method() === 'POST') {
        const body = request.postDataJSON(); writes.push(body);
        const details = normalizeDetails(body.details);
        if (!published.has(body.requestId)) {
          published.set(body.requestId, { post: { ...details, id: native.id, nativePostId: native.id, status: 'published', targets: [{ platform: 'uficonnect', status: 'posted' }] }, job: native });
          return fulfill({ message: 'Publication could not be confirmed. Retry this unchanged draft to check its status.' }, 503);
        }
        return fulfill(published.get(body.requestId));
      }
      if (endpoint === '/opportunities/' + native.id) {
        detailReads++;
        return nativeHidden ? fulfill({ message: 'Job listing not found.' }, 404) : fulfill({ job: native });
      }
      if (endpoint === '/opportunities') {
        listRequests.push(Object.fromEntries(url.searchParams));
        let list = [...(nativeHidden || nativeOutage ? [] : [native]), ...external];
        const source = url.searchParams.get('sources'), query = url.searchParams.get('search');
        if (source) list = list.filter(job => source.split(',').includes(job.source));
        if (query) list = list.filter(job => `${job.title} ${job.content}`.toLowerCase().includes(query.toLowerCase()));
        const offset = Number(url.searchParams.get('offset')) || 0, limit = Number(url.searchParams.get('limit')) || list.length;
        return fulfill({ opportunities: list.slice(offset, offset + limit), totalCount: list.length, hasMore: offset + limit < list.length, availableSources: ['UFIConnect', 'Remotive'], liveCount: list.length, nativeJobsWarning: nativeOutage ? 'UFIConnect job listings are temporarily unavailable. Refresh to try again.' : null });
      }
      return fulfill({ posts: [], items: [], sources: [], members: [], invitations: [], role: 'owner', active: true, seats: 1, used: 1, owner: { name: 'Audit publisher' } });
    });
    await installAuditMember(page, app, 'job-publisher-audit');
    await auditNavigate(page, server.origin + '/recruiting');
    await page.getByRole('heading', { name: 'Example employer recruiting', exact: true }).waitFor();
    await page.getByRole('navigation', { name: 'Business workspace' }).getByRole('link', { name: 'Jobs', exact: true }).click();
    await page.getByRole('list', { name: 'Live jobs' }).getByRole('listitem').first().waitFor();
    if (width < 769) await page.locator('.jobs-business-mobile-controls > summary').click();
    const jobTools = page.locator(width < 769 ? '.jobs-business-mobile-controls' : '.jobs-page-right-tabs');
    const nativeSource = jobTools.getByRole('radiogroup', { name: 'Career sites', exact: true }).getByRole('radio', { name: 'UFIConnect', exact: true });
    check(await nativeSource.count() === 1, 'Native career source is available once in the real sidebar');
    await nativeSource.click();
    if (width < 769) check(!await page.locator('.jobs-business-mobile-controls').evaluate(element => element.open), 'Business mobile filters close after choosing a source');
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="Live jobs"] [role="listitem"]').length === 1);
    check(listRequests.some(query => query.sources === 'UFIConnect'), 'Choosing the native career site uses its real source filter');
    await page.getByLabel('Job keywords', { exact: true }).fill('Accessibility');
    const searched = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/opportunities') && url.searchParams.get('sources') === 'UFIConnect' && url.searchParams.get('search') === 'Accessibility';
    });
    await page.getByRole('button', { name: 'Search jobs', exact: true }).click();
    await searched;
    await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'Accessibility');
    await page.getByRole('button', { name: 'Open Accessibility engineer at Example employer', exact: true }).waitFor();
    check(listRequests.some(query => query.sources === 'UFIConnect' && query.search === 'Accessibility'), 'Business search remains available alongside career-site filtering');
    await page.locator('.jobs-post-entry').getByRole('link', { name: 'Post a job', exact: true }).click();
    await page.getByRole('heading', { name: 'Post a job', exact: true }).waitFor();
    check(await page.getByRole('button', { name: 'Publish job', exact: true }).isDisabled(), 'Empty form cannot publish');
    await page.getByLabel('Role title', { exact: true }).fill(native.title);
    await page.getByLabel('Role description', { exact: true }).fill(native.description);
    check(await page.getByLabel('External application link (optional)', { exact: true }).inputValue() === '', 'Application link is optional');
    check(await page.getByRole('button', { name: 'Publish job', exact: true }).isEnabled(), 'Valid details enable publishing without an external application link');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Composer fits ${width}px`);
    await page.screenshot({ path: `.cache/audit-ui/job-compose-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Publish job', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Publication could not be confirmed' }).waitFor();
    await page.getByRole('link', { name: 'Back to jobs', exact: true }).click();
    await page.locator('.jobs-post-entry').getByRole('link', { name: 'Post a job', exact: true }).click();
    check(await page.getByLabel('Role title', { exact: true }).inputValue() === native.title, 'SPA navigation preserves the private draft');
    await page.getByRole('button', { name: 'Publish job', exact: true }).click();
    await page.getByRole('heading', { name: 'Your job is published', exact: true }).waitFor();
    check(published.size === 1 && new Set(writes.map(write => write.requestId)).size === 1, 'Uncertain response and route navigation retry the same publication');
    check(writes.every(write => !Object.hasOwn(write, 'targets') && !Object.hasOwn(write, 'userId')), 'Client sends no external target or spoofed owner');
    check(await page.getByRole('button', { name: 'Publish job', exact: true }).isDisabled(), 'Confirmed publication cannot be submitted twice');
    await page.getByRole('link', { name: 'View job listing', exact: true }).click();
    await page.locator('.job-detail-panel').getByRole('heading', { name: native.title, exact: true }).waitFor();
    check(detailReads > 0, 'Native navigation validates visibility using the durable endpoint');
    check(await page.getByRole('link', { name: 'Posted by Audit publisher', exact: true }).getAttribute('href') === '/u/job-publisher-audit', 'Publisher attribution is stable');
    check(await page.getByText(/No external application link was supplied/).isVisible(), 'Missing application link is described accurately');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Native detail fits ${width}px`);
    native.applyUrl = 'https://example.invalid/careers/accessibility';
    const previousReads = detailReads;
    await auditReload(page);
    await page.getByRole('link', { name: 'Open application link', exact: true }).waitFor();
    check(detailReads > previousReads, 'Direct reload reads persisted native detail again');
    check(await page.getByRole('link', { name: 'Open application link', exact: true }).getAttribute('href') === native.applyUrl, 'Optional application link retains its destination');
    nativeHidden = true;
    await auditReload(page);
    await page.getByText('This listing is no longer in the live job feed.', { exact: true }).waitFor();
    check(await page.locator('.job-detail-panel').count() === 0, 'Removed native listing never renders from a cached navigation snapshot');
    nativeHidden = false;
    await auditNavigate(page, server.origin + '/opportunities');
    await page.getByRole('list', { name: 'Live jobs' }).getByRole('listitem').first().waitFor();
    check(await page.getByRole('list', { name: 'Live jobs' }).getByRole('listitem').count() === 20, 'First combined page has twenty jobs');
    await page.getByRole('navigation', { name: 'Job results pages' }).getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByText('Page 2 of 2', { exact: true }).waitFor();
    check(await page.getByRole('list', { name: 'Live jobs' }).getByRole('listitem').count() === 3, 'Combined next page contains the remaining jobs');
    await auditNavigate(page, server.origin + '/opportunities?sources=UFIConnect&q=Accessibility');
    await page.getByRole('button', { name: 'Open Accessibility engineer at Example employer', exact: true }).waitFor();
    check(await page.getByRole('list', { name: 'Live jobs' }).getByRole('listitem').count() === 1, 'Source and search filters expose only matching native jobs');
    check(listRequests.some(query => query.sources === 'UFIConnect' && query.search === 'Accessibility'), 'Native source and search reach the API');
    await auditNavigate(page, server.origin + '/opportunities?sources=Remotive');
    await page.getByRole('button', { name: 'Open External role 0 at Example employer', exact: true }).waitFor();
    check(await page.getByRole('button', { name: 'Open Accessibility engineer at Example employer', exact: true }).count() === 0, 'External-only filter excludes native listings');
    await page.getByRole('button', { name: 'Open External role 0 at Example employer', exact: true }).click();
    await page.getByRole('link', { name: 'View full position on Remotive', exact: true }).waitFor();
    check(await page.getByRole('link', { name: 'View full position on Remotive', exact: true }).getAttribute('href') === external[0].sourceUrl, 'Existing external detail fallback retains its source link');
    nativeOutage = true;
    await auditNavigate(page, server.origin + '/opportunities');
    await page.getByText('UFIConnect job listings are temporarily unavailable. Refresh to try again.', { exact: true }).waitFor();
    check(await page.getByRole('list', { name: 'Live jobs' }).getByRole('listitem').count() > 0, 'Native outage warning leaves external results usable');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Jobs list fits ${width}px`);
    await page.screenshot({ path: `.cache/audit-ui/jobs-list-${width}.png`, fullPage: true });
    currentUser = app.users[1];
    await installAuditMember(page, app, 'job-reader-audit');
    await auditNavigate(page, server.origin + '/jobs/new');
    await page.getByRole('heading', { name: 'Post a job', exact: true }).waitFor();
    await page.getByText('Business accounts are created through the public Business registration before signing in. Your personal account cannot be converted into a Business account.', { exact: true }).waitFor();
    check(await page.getByRole('button', { name: 'Publish job', exact: true }).count() === 0, 'Non-Business member receives a membership gate');
    check(await page.getByRole('link', { name: 'Continue Business membership', exact: true }).count() === 0, 'Personal accounts cannot enroll in Business from job posting');
    check(await page.getByRole('link', { name: 'Browse jobs', exact: true }).isVisible(), 'Membership gate retains access to browsing');
    await page.getByRole('link', { name: 'Browse jobs', exact: true }).click();
    await page.getByRole('list', { name: 'Live jobs' }).getByRole('listitem').first().waitFor();
    if (width < 769) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    const readerTools = page.locator(width < 769 ? '#mobile-feed-drawer' : '.jobs-page-right-tabs');
    check(await readerTools.getByRole('radiogroup', { name: 'Career sites', exact: true }).getByRole('radio', { name: 'UFIConnect', exact: true }).isVisible(), 'Personal members retain the native source in their sidebar');
    assert.deepEqual(errors, []); checks++;
    await context.close();
  }
  await fs.writeFile('.cache/audit-ui/job-posting-results.json', JSON.stringify({ passed: true, checks, widths: [1440, 390, 320], productionWrites: 'none; all API traffic uses synthetic responses', optionalMeasurement: 'denied and external resources blocked' }, null, 2));
  console.log(`PASS: ${checks} Jobs posting, visibility, filtering and pagination browser checks.`);
} catch (error) {
  console.error(error.stack || error.message);
  const page = browser.contexts().at(-1)?.pages().at(-1);
  if (page) { await page.screenshot({ path: '.cache/audit-ui/job-posting-failure.png', fullPage: true }); console.error((await page.locator('body').innerText()).slice(-4000)); }
  throw error;
} finally { await browser.close(); await server.close(); await app.close(); }
