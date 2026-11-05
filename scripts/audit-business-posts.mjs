import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';
import { installAuditMember, auditNavigate } from './audit-session.mjs';
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const { normalizeDetails } = require('../backend/business-posts');
const directory = require('../backend/account-directory.json');
const app = await createAppHarness();
app.seedUser(member('business-publishing-audit', { plan: 'business', organization: 'Talent Company', socialTokens: { linkedin: 'synthetic' } }));
const server = await startBuiltServer({ port: 0 });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
await fs.mkdir('.cache/audit-ui', { recursive: true });
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const errors = [], writes = [], posts = [];
    let connected = true;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const headers = { 'Access-Control-Allow-Origin': server.origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (!['xhr','fetch'].includes(request.resourceType())) return url.origin === server.origin ? route.continue() : route.abort();
      const endpoint = url.pathname.replace(/^\/(api|fallback)/, '');
      const fulfill = data => route.fulfill({ json: data, headers });
      if (endpoint === '/profile') return fulfill(app.fullProfile(app.users[0]));
      if (endpoint === '/billing/status') return fulfill({ plan: 'business', businessSeats: 1 });
      if (endpoint === '/social/platforms') return fulfill({ careerOnly: true, connected: { linkedin: connected }, platforms: { ...directory, linkedin: { name: 'LinkedIn', configured: true, crossPost: { supported: true } } } });
      if (endpoint === '/business/posts' && request.method() === 'POST') {
        const body = request.postDataJSON(); writes.push(body);
        const normalized = normalizeDetails(body.details);
        const post = { id: `audit-${posts.length}`, ...normalized, status: body.targets.length ? 'published' : 'draft', createdAt: '2026-10-08T09:00:00Z',
          targets: body.targets.map(platform => ({ platform, status: 'posted', postedUrl: platform === 'linkedin' ? 'https://www.linkedin.com/feed/update/urn:li:share:123' : 'https://uficonnect.org/p/test' })),
          metrics: body.targets.includes('uficonnect') ? { likes: 5, comments: 2, views: null } : { likes: null, comments: null, views: null },
          metricScope: 'Current UFIConnect totals. Website and LinkedIn engagement counts are unavailable.' };
        posts.unshift(post); return fulfill(post);
      }
      if (endpoint === '/business/posts') return fulfill({ posts, page: 1, hasMore: false });
      if (/^\/business\/posts\/[^/]+\/similar$/.test(endpoint)) {
        const post = posts.find(post => post.id === endpoint.split('/')[3]);
        return fulfill({ post, total: 2, page: 1, hasMore: false, posts: [
          { id: 'other-hiring', title: 'Software engineer', company: 'Peer company', source: 'UFIConnect', content: 'Build reliable services.\nResponsibilities\n- Design APIs\nRequirements\n- JavaScript', location: 'Remote', pay: '$130,000/year', createdAt: '2026-10-07T09:00:00Z', metrics: { likes: 12, comments: 3, views: null }, metricScope: 'Current UFIConnect likes and comments on this post.', match: { titleTerms: ['software','engineer'], sharedTerms: ['build','services','apis'] } },
          { id: 'external-role', title: 'Senior software engineer', company: 'Remote company', source: 'Remotive', sourceUrl: 'https://remotive.com/remote-jobs/software-dev/test',
            content: 'Build software for remote teams.\nResponsibilities\n- Design APIs\nRequirements\n- JavaScript\n' + 'Complete job description. '.repeat(400) + 'Final requirement at the end.', location: 'Remote', pay: '', createdAt: '2026-10-06T09:00:00Z', metrics: { likes: null, comments: null, views: null }, metricScope: 'This job board does not provide public engagement counts to UFIConnect.', match: { titleTerms: ['software','engineer'], sharedTerms: ['build','apis'] } },
        ] });
      }
      return fulfill({ posts: [], items: [], sources: [], members: [], invitations: [], role: 'owner', active: true, seats: 1, used: 1, owner: { name: 'Recruiting owner' } });
    });
    await installAuditMember(page, app, 'business-publishing-audit');
    await auditNavigate(page, server.origin + '/recruiting');
    await page.getByRole('heading', { name: 'Talent Company recruiting' }).waitFor();
    const navigation = page.getByRole('navigation', { name: 'Business workspace' });
    await navigation.getByRole('link', { name: 'Hiring cross-post', exact: true }).click();
    await page.getByRole('heading', { name: 'Cross Post', exact: true }).waitFor();
    check(await page.getByRole('button', { name: 'UFIConnect: Connected', exact: true }).getAttribute('aria-pressed') === 'true', 'Native hiring publishing is selected');
    await page.getByLabel('Role title', { exact: true }).fill('Senior software engineer');
    await page.getByLabel('Location & work arrangement').fill('Los Angeles, CA · Hybrid');
    await page.getByLabel('Pay range').fill('$120,000–$160,000/year');
    await page.getByLabel('Role description', { exact: true }).fill('Build reliable software and APIs for recruiting teams.');
    await page.getByRole('textbox', { name: 'Responsibilities — one per line', exact: true }).fill('Design APIs\nMaintain services');
    await page.getByRole('textbox', { name: 'Requirements — one per line', exact: true }).fill('JavaScript\nPostgreSQL');
    await page.getByRole('button', { name: 'LinkedIn: Connected', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Find a career site' }).fill('indeed');
    check(await page.getByRole('link', { name: 'Visit Indeed website', exact: true }).getAttribute('href') === directory.indeed.siteUrl, 'Indeed uses its official website link');
    check(await page.locator('.business-career-list > div').count() === 1, 'Career source search reduces the list');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Cross Post fits ${width}px`);
    await page.screenshot({ path: `.cache/audit-ui/business-crosspost-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Publish hiring post', exact: true }).click();
    await page.getByRole('status').getByText('Your hiring post was published.', { exact: false }).waitFor();
    assert.deepEqual(writes[0].targets, ['uficonnect','linkedin']); checks++;
    check(await page.getByRole('button', { name: 'Publish hiring post', exact: true }).isDisabled(), 'Published request cannot be sent twice');
    await page.getByRole('link', { name: 'View this post and compare similar roles' }).click();
    await page.getByRole('heading', { name: 'Similar roles (2)', exact: true }).waitFor();
    check(await page.locator('.business-comparison-card').count() === 2, 'Own and similar posts are visible together');
    check(await page.locator('.business-comparison-card').first().getByText('5', { exact: true }).isVisible(), 'Own native like count is shown');
    check(await page.locator('.business-comparison-card').last().getByText('12', { exact: true }).isVisible(), 'Similar native like count is shown');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Comparison fits ${width}px`);
    await page.screenshot({ path: `.cache/audit-ui/business-post-comparison-${width}.png`, fullPage: true });
    await page.getByRole('combobox', { name: 'Compare with' }).selectOption('external-role');
    const external = page.locator('.business-comparison-card').last();
    check(await external.getByText('Unavailable', { exact: true }).count() === 3, 'Missing source engagement is unavailable rather than zero');
    check(await external.getByRole('link', { name: 'Open original job listing' }).getAttribute('href') === 'https://remotive.com/remote-jobs/software-dev/test', 'Original listing URL is retained');
    await external.getByText('Read complete post', { exact: true }).click();
    check(await external.locator('pre').innerText().then(value => value.endsWith('Final requirement at the end.')), 'Complete job description is readable through its last requirement');
    await page.getByRole('button', { name: 'All your posts' }).click();
    await page.getByRole('button', { name: 'View & compare' }).waitFor();
    await page.getByRole('link', { name: 'Use as new draft' }).click();
    check(await page.getByLabel('Role title', { exact: true }).inputValue() === 'Senior software engineer', 'Published post can become a new draft');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.getByText('Draft saved. You can find it in Posts & comparisons.', { exact: true }).waitFor();
    check(writes[1].targets.length === 0, 'Saving a draft sends no external post');
    connected = false;
    await page.goto(server.origin + '/career-posts');
    await page.getByRole('heading', { name: 'Cross Post', exact: true }).waitFor();
    check(await page.getByRole('button', { name: 'Connect LinkedIn', exact: true }).isEnabled(), 'Configured LinkedIn can start consent while disconnected');
    check(await page.getByRole('button', { name: 'Connect LinkedIn', exact: true }).getAttribute('aria-pressed') === 'false', 'Offering account consent does not select an unconnected publishing destination');
    for (const path of ['/command-center','/music','/global']) { await auditNavigate(page, server.origin + path); await page.waitForURL('**/recruiting'); checks++; }
    assert.deepEqual(errors, []); checks++;
    await context.close();
  }
  await fs.writeFile('.cache/audit-ui/business-posts-results.json', JSON.stringify({ passed: true, checks, widths: [1440,390,320], productionWrites: 'none; synthetic publishing and comparison responses' }, null, 2));
  console.log(`PASS: ${checks} Business publishing and comparison browser checks.`);
} catch (error) {
  const page = browser.contexts().at(-1)?.pages().at(-1);
  if (page) { await page.screenshot({ path: '.cache/audit-ui/business-posts-failure.png', fullPage: true }); console.error((await page.locator('body').innerText()).slice(-4000)); }
  throw error;
} finally { await browser.close(); await server.close(); await app.close(); }
