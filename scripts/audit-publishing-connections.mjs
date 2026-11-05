// Real built pages and real backend catalog metadata, using synthetic credentials.
// Consent endpoints and every publication are intercepted; no provider is contacted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';
import { SOURCE_META } from '../web/src/components/sourceMeta.js';
import { installAuditMember, auditNavigate, auditReload } from './audit-session.mjs';

const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const fixtureEnv = { OFFICE_TOKEN: 'fixture-office', PUBLIC_API_URL: 'https://api.fixture.invalid', FRONTEND_URL: 'https://frontend.fixture.invalid' };
const bootstrap = await createAppHarness({ env: fixtureEnv });
let metadata;
try {
  const response = await bootstrap.request('/office/oauth-status', { headers: { 'x-office-token': fixtureEnv.OFFICE_TOKEN } });
  assert.equal(response.status, 200);
  metadata = response.data.platforms;
} finally { await bootstrap.close(); }
// Discover the actual registered adapters instead of maintaining a second provider list.
for (const provider of Object.values(metadata)) for (const name of provider.requiredEnv || []) fixtureEnv[name] = 'synthetic-' + name.toLowerCase();
fixtureEnv.BLUESKY_SIGNING_KEY = JSON.stringify(generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' }));
const app = await createAppHarness({ env: fixtureEnv });
let server, browser;
try {
const viewer = member('configured-provider-matrix', { plan: 'pro', onboardingComplete: true, joinedGroups: ['fixture-group'], roleSettings: { feedSourceFavorites: { feed: [], following: ['youtube'] } } });
app.seedUser(viewer);
const response = await app.request('/social/platforms', { userId: viewer.id });
assert.equal(response.status, 200);
const originalCatalog = response.data.platforms;
const configured = Object.entries(originalCatalog).filter(([, provider]) => provider.configured === true && provider.canStartAuthorization === true && provider.connectionMode !== 'external');
assert.ok(configured.length >= 17, 'The backend fixture configures the full installed adapter catalog');
for (const id of ['youtube', 'github', 'discord', 'figma', 'bluesky', 'mastodon', 'devto', 'hashnode_blog']) assert.ok(configured.some(([key]) => key === id), id + ' must be covered');
console.log('Configured adapter matrix:', configured.map(([key]) => key).join(', '));

server = await startBuiltServer({ port: 0 });
browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
const report = { providers: configured.map(([key]) => key), surfaces: [], checks: 0, productionWrites: 'none' };
const check = (value, message) => { assert.ok(value, message); report.checks++; };
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function bounded(promise, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 15000); })]); }
  finally { clearTimeout(timer); }
}
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], consent = [], writes = [], feedReads = [], unexpectedNavigations = [];
    let catalog = originalCatalog, heldConsent = null;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const headers = { 'Access-Control-Allow-Origin': server.origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*' };
      const reply = (json, status = 200) => route.fulfill({ headers, json, status });
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (!['xhr', 'fetch'].includes(request.resourceType())) {
        if (url.origin === server.origin) return route.continue();
        if (request.resourceType() === 'document') unexpectedNavigations.push(url.href);
        return route.abort();
      }
      const endpoint = url.pathname.replace(/^\/(api|fallback)/, '');
      if (endpoint === '/profile') return reply(app.fullProfile(viewer));
      if (endpoint === '/auth/session') return reply({ token: app.token(viewer.id), profile: app.fullProfile(viewer) });
      if (endpoint === '/billing/status') return reply({ plan: 'pro' });
      if (endpoint === '/social/platforms') return reply({ platforms: catalog, connected: {} });
      if (endpoint === '/groups/internal') return reply({ groups: [{ id: 'fixture-group', name: 'Fixture group', isJoined: true }] });
      if (endpoint === '/office/feed' || endpoint === '/feed') {
        feedReads.push(Object.fromEntries(url.searchParams));
        return reply({ posts: [], hasMore: false, nativeUficonnectIncluded: true });
      }
      if (endpoint.startsWith('/auth/social/') && endpoint.endsWith('/start')) {
        consent.push({ endpoint, publishing: url.searchParams.get('publishing'), returnTo: url.searchParams.get('returnTo') });
        const held = heldConsent;
        if (held) {
          held.started.resolve(); await held.release.promise;
          try { await reply({ url: 'https://provider-consent.invalid/late-response' }); } catch { /* The component may already have aborted its request. */ }
          finally { held.completed.resolve(); }
          return;
        }
        return reply({ message: 'Synthetic provider consent was not completed.', error: 'Synthetic provider consent was not completed.' }, 400);
      }
      if (request.method() === 'POST' && (endpoint === '/command-center/cross-post' || /^\/groups\/[^/]+\/posts$/.test(endpoint) || endpoint.startsWith('/social/connect/'))) {
        writes.push(endpoint); return reply({ message: 'This audit cannot publish or save an account credential.' }, 400);
      }
      return reply({ posts: [], sources: [], groups: [], items: [], notifications: [], conversations: [] });
    });
    await installAuditMember(page, app, viewer.id);
    for (const [surface, target] of [['crosspost', '/command-center?tab=crosspost'], ['inline', '/groups/post?group=fixture-group']]) {
      catalog = originalCatalog;
      await auditNavigate(page, server.origin + target);
      const scope = surface === 'crosspost' ? page.getByRole('tabpanel', { name: 'Cross-Post', exact: true }) : page.getByRole('group', { name: 'Post to', exact: true });
      await scope.waitFor();
      async function expandSources() {
        if (surface === 'crosspost') await scope.getByRole('combobox', { name: 'Publishing category', exact: true }).waitFor();
        else await scope.getByRole('link', { name: 'Manage connected accounts', exact: true }).waitFor();
        const closed = scope.locator('details:not([open]) > summary');
        while (await closed.count()) await closed.first().click();
      }
      await expandSources();
      for (const [key, provider] of configured) {
        const name = SOURCE_META[key]?.label || provider.name || key;
        const action = scope.getByRole('button', { name: new RegExp('^(?:Connect|Manage(?: account)?) ' + escape(name) + '(?:: Connected)?$') });
        check(await action.count() === 1 && await action.isEnabled(), `${surface}/${width}: configured ${key} exposes an actionable provider control`);
        check(!await action.evaluate(button => button.classList.contains('is-locked')), `${surface}/${width}: configured ${key} has no misleading lock`);
      }
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${surface}/${width}: adapter actions fit the viewport`);
      if (width === 390) {
        const before = consent.length;
        if (surface === 'inline') {
          await page.getByLabel('Your post', { exact: true }).fill('Keep this inline draft while I connect YouTube.');
          const opened = context.waitForEvent('page');
          await scope.getByRole('button', { name: 'Connect YouTube', exact: true }).click();
          const accountPage = await opened;
          await accountPage.getByText('Synthetic provider consent was not completed.', { exact: true }).waitFor();
          check(new URL(page.url()).pathname === '/groups/post' && await page.getByLabel('Your post', { exact: true }).inputValue() === 'Keep this inline draft while I connect YouTube.', 'Inline consent opens separately and preserves the draft');
          await accountPage.close(); await page.bringToFront();
        } else {
          await scope.getByRole('button', { name: 'Connect YouTube', exact: true }).click();
          await page.getByText('Synthetic provider consent was not completed.', { exact: true }).waitFor();
        }
        check(consent.length === before + 1, `${surface}: one explicit click starts exactly one consent request`);
        assert.deepEqual(consent.at(-1), { endpoint: '/auth/social/youtube/start', publishing: '1', returnTo: 'command-center' });
        check(writes.length === 0 && Object.keys(viewer.socialTokens).length === 0, `${surface}: starting consent does not create a grant or publish`);
      }
      for (const [state, override] of [
        ['setup', { configured: false, canStartAuthorization: false }],
        ['approval', { authorizationAvailable: false, authorizationReason: 'Provider approval is required.' }],
        ['server-denial', { canStartAuthorization: false }],
      ]) {
        catalog = { ...originalCatalog, youtube: { ...originalCatalog.youtube, ...override } };
        await auditNavigate(page, server.origin + target); await auditReload(page); await scope.waitFor(); await expandSources();
        const before = consent.length;
        const controls = scope.getByRole('button', { name: /^(?:Connect |Manage(?: account)? |Select |Remove )?YouTube(?::.*)?$/ });
        check(await controls.count() > 0, `${surface}/${width}: ${state} remains visible with an explanation`);
        for (const button of await controls.all()) {
          check(await button.isDisabled(), `${surface}/${width}: ${state} cannot start authorization`);
          await button.evaluate(element => element.click());
        }
        check(consent.length === before && writes.length === 0, `${surface}/${width}: ${state} cannot create consent or publishing requests`);
      }
      report.surfaces.push({ surface, width, configuredAdapters: configured.length, passed: true });
    }
    if (width === 390) {
      catalog = originalCatalog;
      await auditNavigate(page, server.origin + '/?feed=following&all=1');
      const following = page.getByRole('group', { name: 'Following sources', exact: true });
      const connect = following.getByRole('button', { name: 'Connect YouTube to use Following', exact: true });
      await connect.waitFor();
      check(await connect.isEnabled() && await connect.getAttribute('aria-pressed') === 'false', 'Following offers configured connection without selecting an unconnected feed');
      await connect.click();
      await page.getByText('Synthetic provider consent was not completed.', { exact: true }).waitFor();
      assert.deepEqual(consent.at(-1), { endpoint: '/auth/social/youtube/start', publishing: null, returnTo: null });
      catalog = { ...originalCatalog, youtube: { ...originalCatalog.youtube, canStartAuthorization: false } };
      await auditNavigate(page, server.origin + '/?feed=following&all=1'); await auditReload(page);
      const denied = following.getByRole('button', { name: 'YouTube', exact: true });
      await denied.waitFor();
      const before = consent.length;
      check(await denied.isDisabled() && await denied.getAttribute('aria-pressed') === 'false', 'Following preserves explicit server authorization denial');
      await denied.evaluate(element => element.click());
      check(consent.length === before && !feedReads.some(read => read.mode === 'following' && (read.source === 'youtube' || read.sources?.split(',').includes('youtube'))), 'Unconnected or denied Following source never requests a personal source feed');
      report.surfaces.push({ surface: 'following', width, passed: true });
      catalog = originalCatalog;
      await auditNavigate(page, server.origin + '/command-center?tab=crosspost'); await auditReload(page);
      const crosspost = page.getByRole('tabpanel', { name: 'Cross-Post', exact: true });
      await crosspost.getByRole('combobox', { name: 'Publishing category', exact: true }).waitFor();
      const closed = crosspost.locator('details:not([open]) > summary');
      while (await closed.count()) await closed.first().click();
      heldConsent = { started: deferred(), release: deferred(), completed: deferred() };
      const held = heldConsent, beforeHeld = consent.length;
      await crosspost.getByRole('button', { name: 'Connect YouTube', exact: true }).click();
      await bounded(held.started.promise, 'The explicit YouTube action did not start its consent request');
      await auditNavigate(page, server.origin + '/groups/post?group=fixture-group');
      await page.getByLabel('Your post', { exact: true }).waitFor();
      held.release.resolve(); await bounded(held.completed.promise, 'The held authorization response did not finish');
      // Let an erroneous late window.location.assign reach the intercepted document route.
      await page.waitForTimeout(150);
      check(new URL(page.url()).pathname === '/groups/post' && unexpectedNavigations.length === 0, 'A late authorization response cannot navigate after the account page unmounts');
      check(consent.length === beforeHeld + 1 && writes.length === 0, 'Unmounted authorization does not start another consent request or publish');
      heldConsent = null;
      report.surfaces.push({ surface: 'authorization-unmount', width, passed: true });
    }
    check(errors.length === 0, `No runtime errors at ${width}px: ${errors.join('; ')}`);
    await context.close();
  }
  const business = member('configured-business-matrix', { plan: 'business', accountType: 'business', organization: 'Fixture Company', businessIndustryId: 'technology' });
  app.seedUser(business);
  const businessCatalog = (await app.request('/social/platforms', { userId: business.id })).data;
  assert.equal(businessCatalog.platforms?.linkedin?.canStartAuthorization, true, 'Business fixture has configured LinkedIn authorization');
  const businessContext = await browser.newContext({ viewport: { width: 390, height: 1000 }, serviceWorkers: 'block' });
  const businessPage = await businessContext.newPage(); businessPage.setDefaultTimeout(15000);
  const businessConsent = [], businessWrites = [], businessErrors = [];
  const workspace = { id: 'a0000000-0000-4000-8000-000000000001', name: 'Fixture industry', industryId: 'technology', sourceIds: ['github'] };
  businessPage.on('pageerror', error => businessErrors.push(error.message));
  await businessContext.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const headers = { 'Access-Control-Allow-Origin': server.origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*' };
    const reply = (json, status = 200) => route.fulfill({ headers, json, status });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (!['xhr', 'fetch'].includes(request.resourceType())) return url.origin === server.origin ? route.continue() : route.abort();
    const endpoint = url.pathname.replace(/^\/(api|fallback)/, '');
    if (endpoint === '/profile') return reply(app.fullProfile(business));
    if (endpoint === '/billing/status') return reply({ plan: 'business', businessSeats: 1 });
    if (endpoint === '/social/platforms') return reply(businessCatalog);
    if (endpoint === '/business/industries') return reply({ workspaces: [workspace], canManage: true });
    if (endpoint === `/business/industries/${workspace.id}/posts`) return reply({ workspace, posts: [], page: 1, hasMore: false });
    if (endpoint === '/auth/social/linkedin/start') { businessConsent.push(Object.fromEntries(url.searchParams)); return reply({ error: 'Synthetic LinkedIn consent was not completed.' }, 400); }
    if (request.method() === 'POST' && /^\/business\/(?:posts|industries\/.*\/posts)/.test(endpoint)) { businessWrites.push(endpoint); return reply({ message: 'No publication is allowed in this fixture.' }, 400); }
    return reply({ posts: [], items: [], sources: [], members: [], invitations: [] });
  });
  await installAuditMember(businessPage, app, business.id);
  await auditNavigate(businessPage, server.origin + '/recruiting');
  await businessPage.getByRole('heading', { name: 'Fixture Company recruiting', exact: true }).waitFor();
  for (const [surface, target, actionRole] of [['business-hiring', '/career-posts', 'button'], ['business-industry', '/business/cross-post', 'link']]) {
    await businessPage.getByRole('navigation', { name: 'Business workspace', exact: true }).getByRole('link', { name: surface === 'business-hiring' ? 'Hiring cross-post' : 'Cross Post', exact: true }).click();
    await businessPage.waitForURL(url => url.pathname === target);
    const connect = businessPage.getByRole(actionRole, { name: 'Connect LinkedIn', exact: true });
    await connect.waitFor(); check(await connect.isEnabled(), `${surface}: configured LinkedIn offers connection instead of a lock`);
    if (surface === 'business-industry') check(await businessPage.getByRole('checkbox', { name: /^LinkedIn/ }).isDisabled(), 'Business destination cannot be selected before consent');
    await connect.click(); await businessPage.getByText('Synthetic LinkedIn consent was not completed.', { exact: true }).waitFor();
    check(businessConsent.at(-1)?.publishing === '1' && businessWrites.length === 0 && !business.socialTokens.linkedin, `${surface}: publishing consent starts without manufacturing a grant or post`);
    report.surfaces.push({ surface, width: 390, passed: true });
  }
  check(businessErrors.length === 0, `Business flows have no runtime errors: ${businessErrors.join('; ')}`);
  await businessContext.close();
  await fs.mkdir('.cache/audit-ui', { recursive: true });
  await fs.writeFile('.cache/audit-ui/publishing-connections.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} catch (error) {
  const page = browser?.contexts().at(-1)?.pages().at(-1);
  if (page) {
    await fs.mkdir('.cache/audit-ui', { recursive: true });
    await page.screenshot({ path: '.cache/audit-ui/publishing-connections-failure.png', fullPage: true });
    console.error(page.url(), (await page.locator('body').innerText()).slice(-5000));
  }
  throw error;
} finally { await browser?.close(); await server?.close(); await app.close(); }
