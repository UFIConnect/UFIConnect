import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';
import { installAuditMember, auditNavigate } from './audit-session.mjs';

// Real built UI; every API response and publication receipt is synthetic.
// Only local GET/HEAD documents/assets may reach a server. Provider pages,
// consent, clipboard and website handoffs remain inside this browser fixture.
const profile = (id, plan, extra = {}) => ({ id, name: id, email: `${id}@example.invalid`, plan,
  accountType: plan === 'business' ? 'business' : 'personal', onboardingComplete: true,
  title: 'Browser fixture', organization: '', joinedGroups: [], skills: [], socialAccounts: {},
  preferences: { interests: [], goals: [] }, roleSettings: {}, links: {}, ...extra });
const members = {
  'job-source-pro': profile('job-source-pro', 'pro'),
  'job-source-free': profile('job-source-free', 'free'),
  'job-source-business': profile('job-source-business', 'business', { organization: 'Fixture employer' }),
};
const app = {
  request: async (_path, { userId } = {}) => ({ status: 200, data: members[userId] }),
  token: id => Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url') + '.'
    + Buffer.from(JSON.stringify({ id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.synthetic-job-source-fixture',
};
const provider = (name, crossPost = {}, extra = {}) => ({ name, configured: true, connectionMode: 'oauth',
  authorizationAvailable: true, canStartAuthorization: true, category: 'social',
  crossPost: { supported: true, allowedMedia: ['text'], settingsRequired: false, ...crossPost }, ...extra });
const catalogs = {
  linkedin: provider('LinkedIn'),
  reddit: provider('Reddit', { settingsRequired: true }),
  mastodon: provider('Mastodon'),
  wordpress: provider('WordPress', {}, { configured: false, canStartAuthorization: false }),
  youtube: provider('YouTube', { requiresVideo: true, allowedMedia: ['video'] }),
};
const redditSchema = { label: 'Reddit job post', destinationLabel: 'Subreddit',
  destinations: [{ id: 'careers', label: 'Careers' }, { id: 'engineering', label: 'Engineering jobs' }],
  fields: [{ key: 'title', label: 'Reddit title', type: 'text', required: true, maxLength: 300 }] };
const server = await startBuiltServer({ port: 0 });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
await fs.mkdir('.cache/audit-ui', { recursive: true });
const report = { passed: false, checks: 0, widths: [], productionWrites: 0, method: 'Real built frontend; synthetic API, account and provider receipts; all external traffic blocked.' };
const check = (condition, message) => { assert.ok(condition, message); report.checks++; };
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      window.__jobAuditCopied = []; window.__jobAuditOpened = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__jobAuditCopied.push(String(text)); } } });
      window.open = (url, target, features) => { window.__jobAuditOpened.push({ url: String(url), target, features }); return null; };
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], writes = [], reservations = new Map(), attempts = new Map(), destinationReads = [];
    let current = members['job-source-pro'], catalogFailure = false;
    const connected = { linkedin: true, reddit: true, mastodon: false, wordpress: false, youtube: true };
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      const headers = { 'Access-Control-Allow-Origin': server.origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS' };
      const reply = (json, status = 200) => route.fulfill({ headers, json, status });
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (!['xhr', 'fetch', 'eventsource', 'ping'].includes(request.resourceType())) {
        return ['GET', 'HEAD'].includes(method) && url.origin === server.origin ? route.continue() : route.abort();
      }
      const endpoint = url.pathname.replace(/^\/(api|fallback)/, '');
      if (endpoint === '/profile' || endpoint === '/auth/me') return reply(current);
      if (endpoint === '/billing/status') return reply({ plan: current.plan, businessSeats: current.plan === 'business' ? 1 : 0 });
      if (endpoint === '/social/platforms') return catalogFailure
        ? reply({ message: 'Synthetic source catalog outage.' }, 503)
        : reply({ platforms: catalogs, connected: { ...connected } });
      if (endpoint === '/command-center/cross-post/reddit/destinations') { destinationReads.push(endpoint); return reply(redditSchema); }
      if (endpoint.startsWith('/command-center/cross-post/') && endpoint.endsWith('/destinations')) return reply({ label: 'Synthetic publishing options', fields: [] });
      if (endpoint === '/jobs/posts' && method === 'POST') {
        const body = request.postDataJSON(); writes.push(body);
        const canonical = JSON.stringify({ details: body.details, targets: body.targets, publisherSettings: body.publisherSettings || {} });
        attempts.set(body.requestId, (attempts.get(body.requestId) || 0) + 1);
        if (!reservations.has(body.requestId)) {
          const id = 'bp_' + current.id + '_' + reservations.size;
          const job = { id, title: body.details.title, type: 'job', org: body.details.company || current.name,
            source: 'UFIConnect', sourceId: 'uficonnect', sourceUrl: server.origin + '/opportunities/' + id,
            description: body.details.description, content: body.details.description, posted: new Date().toISOString(),
            authorId: current.id, author: { id: current.id, name: current.name }, nativeJob: true, isLive: true, tags: [] };
          const post = { id, nativePostId: id, status: 'published', details: body.details, content: body.details.description,
            targets: (body.targets || ['uficonnect']).map(platform => ({ platform, status: platform === 'reddit' ? 'unconfirmed' : 'posted',
              ...(platform === 'reddit' ? { error: 'Synthetic Reddit outcome is not yet confirmed.' } : { postedUrl: server.origin + '/p/' + id }) })) };
          reservations.set(body.requestId, { fingerprint: canonical, post, job });
          if (current.plan === 'pro') return reply({ message: 'Publication could not be confirmed. Check the unchanged publication status.' }, 503);
        }
        const saved = reservations.get(body.requestId);
        if (canonical !== saved.fingerprint) return reply({ message: 'The request ID was reused for changed details or destinations.' }, 409);
        const targets = saved.post.targets.map(target => target.platform === 'reddit' && attempts.get(body.requestId) >= 3
          ? { ...target, status: 'failed', error: 'Synthetic Reddit declined the listing. The native job remains published.' } : target);
        return reply({ post: { ...saved.post, targets }, job: saved.job });
      }
      if (endpoint === '/opportunities') return reply({ opportunities: [], totalCount: 0, hasMore: false, availableSources: ['UFIConnect'] });
      if (/events|stream/.test(endpoint)) return route.abort();
      return reply({ posts: [], items: [], sources: [], users: [], groups: [], members: [], invitations: [], notifications: [], messages: [], conversations: [], count: 0 });
    });
    await installAuditMember(page, app, current.id);
    await auditNavigate(page, server.origin + '/jobs/new');
    await page.getByRole('heading', { name: 'Post a job', exact: true }).waitFor();
    const sources = page.getByRole('group', { name: 'Job publishing sources', exact: true });
    await sources.waitFor();
    const source = name => sources.getByRole('button', { name: new RegExp('^(?:Select|Remove) ' + escape(name) + '$') });
    const sourceSearch = sources.getByRole('searchbox', { name: 'Find a publishing source', exact: true });
    const publish = () => page.getByRole('button', { name: /^(?:Publish job|Check publication status)$/ });
    const expand = async () => { const closed = page.locator('.job-compose-page details:not([open]) > summary'); while (await closed.count()) await closed.first().click(); };
    const setSource = async (name, selected = true) => {
      await sourceSearch.fill(''); await expand();
      const button = source(name); await button.waitFor();
      if ((await button.getAttribute('aria-pressed') === 'true') !== selected) await button.click();
    };
    const fill = async title => {
      await page.getByLabel('Role title', { exact: true }).fill(title);
      await page.getByLabel('Role description', { exact: true }).fill('Build accessible software, discuss requirements, and support the team.');
    };
    const native = sources.getByRole('button', { name: /^UFIConnect Jobs(?:: Connected)?$/ });
    check(await native.isDisabled() && await native.getAttribute('aria-pressed') === 'true', 'Native UFIConnect job destination is required and selected');
    await sourceSearch.fill('Red');
    await source('Reddit').waitFor();
    check(!await source('LinkedIn').isVisible(), 'Publishing source search narrows source choices');
    await sourceSearch.fill(''); await expand();
    check(await source('WordPress.com').isDisabled(), 'An unconfigured source cannot be selected');
    check(await sources.getByRole('button', { name: 'Connect Mastodon', exact: true }).isEnabled(), 'A configured disconnected source offers an explicit connection action');
    check(await source('YouTube').count() === 0 || await source('YouTube').isDisabled(), 'A video-only source cannot receive the text-only job draft');
    await fill('Accessibility engineer');
    await setSource('LinkedIn'); await setSource('Reddit');
    await page.getByRole('combobox', { name: 'Subreddit', exact: true }).waitFor();
    check(await publish().isDisabled(), 'Required source-specific options must be completed before publication');
    await page.getByRole('combobox', { name: 'Subreddit', exact: true }).selectOption('careers');
    await page.getByRole('textbox', { name: 'Reddit title', exact: true }).fill('Accessibility engineer opening');
    await publish().click();
    await page.getByRole('alert').filter({ hasText: 'Publication could not be confirmed' }).waitFor();
    check(writes.length === 1, 'One publish click sends one durable Jobs request');
    assert.deepEqual(writes[0].targets, ['uficonnect', 'linkedin', 'reddit']); report.checks++;
    assert.deepEqual(writes[0].publisherSettings.reddit, { destinationId: 'careers', title: 'Accessibility engineer opening' }); report.checks++;
    check(!Object.hasOwn(writes[0], 'userId') && !writes[0].targets.includes('youtube'), 'Publication payload has no spoofed owner or incompatible video destination');
    const submitted = structuredClone(writes[0]);
    await page.getByRole('link', { name: 'Back to jobs', exact: true }).click();
    await auditNavigate(page, server.origin + '/jobs/new');
    await page.getByRole('heading', { name: 'Post a job', exact: true }).waitFor();
    check(await page.getByLabel('Role title', { exact: true }).inputValue() === 'Accessibility engineer', 'The account-private draft survives SPA navigation');
    connected.reddit = false;
    const disconnectedCatalog = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/social/platforms'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    check((await (await disconnectedCatalog).json()).connected.reddit === false, 'The source catalog confirms disconnection before the status check');
    await page.getByRole('button', { name: 'Check publication status', exact: true }).waitFor();
    check(await publish().isEnabled(), 'A stored publication can be checked after its source disconnects');
    await publish().click();
    await page.getByRole('heading', { name: 'Your job is published', exact: true }).waitFor();
    const result = page.getByRole('region', { name: 'Job publishing results', exact: true });
    await result.waitFor();
    check((await result.innerText()).includes('LinkedIn') && (await result.innerText()).includes('Reddit'), 'Every external destination has a visible receipt beside the native result');
    check((await result.innerText()).includes('Synthetic Reddit outcome is not yet confirmed.'), 'External uncertainty remains visible after native publication succeeds');
    check(await page.getByRole('link', { name: 'View job listing', exact: true }).isVisible(), 'Partial external failure retains the native job listing');
    await publish().click();
    await result.getByText('Synthetic Reddit declined the listing. The native job remains published.', { exact: true }).waitFor();
    check(writes.slice(0, 3).every(body => JSON.stringify(body) === JSON.stringify(submitted)), 'Uncertain response and disconnect retries retain the original complete payload and request ID');
    check(reservations.size === 1, 'Status checks do not reserve or resend another publication');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Job sources and results fit ${width}px`);
    await page.screenshot({ path: `.cache/audit-ui/job-sources-${width}.png`, fullPage: true });

    // Explicit draft edits are a new publication, including source settings.
    connected.reddit = true;
    await page.getByRole('button', { name: 'Start a new job', exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await fill('Platform engineer');
    await setSource('Reddit');
    await page.getByRole('textbox', { name: 'Reddit title', exact: true }).waitFor();
    check(await page.getByRole('textbox', { name: 'Reddit title', exact: true }).inputValue() === '', 'Starting a new job clears the previous job provider title');
    await page.getByRole('combobox', { name: 'Subreddit', exact: true }).selectOption('careers');
    await page.getByRole('textbox', { name: 'Reddit title', exact: true }).fill('Platform engineer opening');
    await publish().click();
    await page.getByRole('alert').filter({ hasText: 'Publication could not be confirmed' }).waitFor();
    const beforeEdit = writes.at(-1);
    await page.getByRole('combobox', { name: 'Subreddit', exact: true }).selectOption('engineering');
    const settingsPublication = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/jobs/posts')
      && response.request().postDataJSON()?.publisherSettings?.reddit?.destinationId === 'engineering');
    await publish().click();
    await settingsPublication;
    check(writes.at(-1).requestId !== beforeEdit.requestId, 'A settings-only edit invalidates the captured publication request');
    assert.deepEqual(writes.at(-1).details, beforeEdit.details, 'Settings-only publication retains unchanged job details'); report.checks++;
    check(writes.at(-1).publisherSettings.reddit.destinationId === 'engineering', 'The changed source destination is included in the new publication');
    const beforeDetailsEdit = writes.at(-1);
    await page.getByLabel('Role title', { exact: true }).fill('Senior platform engineer');
    const detailsPublication = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/jobs/posts')
      && response.request().postDataJSON()?.details?.title === 'Senior platform engineer');
    await publish().click();
    await detailsPublication;
    check(writes.at(-1).requestId !== beforeDetailsEdit.requestId, 'A details-only edit independently invalidates the captured publication request');
    assert.deepEqual(writes.at(-1).publisherSettings, beforeDetailsEdit.publisherSettings, 'Details-only publication retains unchanged source settings'); report.checks++;

    await expand();
    await page.getByRole('searchbox', { name: 'Find a career site', exact: true }).fill('Indeed');
    const writeCount = writes.length;
    await page.getByRole('button', { name: 'Copy and open Indeed', exact: true }).click();
    await page.waitForFunction(() => window.__jobAuditOpened.length > 0);
    const handoff = await page.evaluate(() => ({ copied: window.__jobAuditCopied, opened: window.__jobAuditOpened }));
    check(handoff.copied.at(-1)?.includes('Senior platform engineer'), 'Career-site handoff copies the current complete hiring draft');
    const opened = new URL(handoff.opened.at(-1)?.url);
    check(opened.protocol === 'https:' && /(^|\.)indeed\.com$/.test(opened.hostname), 'Career-site handoff opens the official HTTPS employer website');
    check(writes.length === writeCount, 'A manual career-site handoff is not reported or sent as a publication');

    // A failed refresh must not trap a valid native draft behind hidden sources.
    await page.getByRole('button', { name: 'Start a new job', exact: true }).click();
    await fill('Support engineer'); await setSource('Reddit');
    await page.getByRole('combobox', { name: 'Subreddit', exact: true }).selectOption('careers');
    await page.getByRole('textbox', { name: 'Reddit title', exact: true }).fill('Support engineer opening');
    const descriptionBeforeFailure = await page.getByLabel('Role description', { exact: true }).inputValue();
    catalogFailure = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await sources.getByRole('alert').filter({ hasText: 'Publishing sources could not load.' }).waitFor();
    check(await publish().isDisabled(), 'A failed catalog refresh blocks an unverified selected external source');
    const clearSharing = sources.getByRole('button', { name: 'Clear other sources', exact: true });
    check(await clearSharing.isEnabled(), 'A selected source can still be cleared when the refreshed catalog is empty');
    await clearSharing.click();
    check(await page.getByLabel('Role title', { exact: true }).inputValue() === 'Support engineer', 'Clearing unavailable sources preserves the role title');
    check(await page.getByLabel('Role description', { exact: true }).inputValue() === descriptionBeforeFailure, 'Clearing unavailable sources preserves the full job description');
    check(await publish().isEnabled(), 'Native job publication remains available after clearing unavailable sharing sources');
    const nativeOnlyPublication = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/jobs/posts')
      && response.request().postDataJSON()?.details?.title === 'Support engineer');
    await publish().click(); await nativeOnlyPublication;
    assert.deepEqual(writes.at(-1).targets, ['uficonnect']); report.checks++;
    check(!Object.hasOwn(writes.at(-1).publisherSettings || {}, 'reddit'), 'Cleared external settings are absent from the native-only request');
    catalogFailure = false;

    current = members['job-source-free'];
    await installAuditMember(page, app, current.id);
    await auditNavigate(page, server.origin + '/jobs/new');
    await sources.waitFor();
    check(await page.getByLabel('Role title', { exact: true }).inputValue() === '', 'Switching accounts does not expose the previous hiring draft');
    await sourceSearch.fill(''); await expand();
    check(await source('LinkedIn').isDisabled(), 'A free member cannot select paid external direct publishing');
    await fill('Community coordinator');
    await publish().click();
    await page.getByRole('heading', { name: 'Your job is published', exact: true }).waitFor();
    assert.deepEqual(writes.at(-1).targets, ['uficonnect']); report.checks++;
    check(await page.getByRole('link', { name: 'View job listing', exact: true }).isVisible(), 'Free members retain native job publishing');

    current = members['job-source-business'];
    await installAuditMember(page, app, current.id);
    await auditNavigate(page, server.origin + '/recruiting');
    await page.getByRole('heading', { name: 'Fixture employer recruiting', exact: true }).waitFor();
    await page.getByRole('navigation', { name: 'Business workspace', exact: true }).getByRole('link', { name: 'Post a job', exact: true }).click();
    await page.getByRole('heading', { name: 'Post a job', exact: true }).waitFor();
    await sources.waitFor(); await sourceSearch.fill(''); await expand();
    check(await source('Reddit').count() === 0 || await source('Reddit').isDisabled(), 'Business publishing cannot select personal social destinations');
    await fill('Recruiting coordinator'); await setSource('LinkedIn');
    await publish().click();
    await page.getByRole('heading', { name: 'Your job is published', exact: true }).waitFor();
    assert.deepEqual(writes.at(-1).targets, ['uficonnect', 'linkedin']); report.checks++;
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Business job sources fit ${width}px`);
    check(destinationReads.length > 0, 'Selected source settings are loaded through the real publishing-options contract');
    assert.deepEqual(errors, []); report.checks++;
    report.widths.push({ width, passed: true, writes: writes.length, durableReservations: reservations.size, pageErrors: errors });
    await context.close();
    console.log(`PASS: job source selection, durable retries, outcomes and career handoffs at ${width}px`);
  }
  report.passed = true;
  await fs.writeFile('.cache/audit-ui/job-sources-results.json', JSON.stringify(report, null, 2) + '\n');
  console.log(`PASS: ${report.checks} multi-source job browser checks.`);
} catch (error) {
  const page = browser.contexts().at(-1)?.pages().at(-1);
  report.error = error.message;
  await fs.writeFile('.cache/audit-ui/job-sources-results.json', JSON.stringify(report, null, 2) + '\n');
  if (page) { await page.screenshot({ path: '.cache/audit-ui/job-sources-failure.png', fullPage: true }); console.error((await page.locator('body').innerText()).slice(-3500)); }
  throw error;
} finally { await browser.close(); await server.close(); }
