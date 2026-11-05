// Real browser form -> real API route -> real provider adapter. Provider HTTP,
// local-post receipts and uploads are synthetic; remote publication is impossible.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate } from './audit-session.mjs';

const require = createRequire(import.meta.url);
const { createActivePublishingFixture } = require('../backend/test-support/active-publishing-fixture');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-ui');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const report = { widths: [], checks: 0, remoteWrites: 'none; provider transport is intercepted in the real backend harness' };
const check = (value, label) => { assert.ok(value, label); report.checks++; };
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  cacheDir: path.join(root, '.cache/vite-active-publishing'),
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
try {
  await fs.mkdir(output, { recursive: true });
  await server.listen();
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [1440, 390]) {
    const fixture = await createActivePublishingFixture();
    const { app, owner, state, writes } = fixture;
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], externalRequests = [], nativeRequests = [], consentRequests = [];
    let activeOwner = owner.id, nativeHold = null, nativeConfirmed = true, nativeAbort = false, uploadKind = 'video';
    page.on('pageerror', error => errors.push(error.message));
    try {
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        const reply = (json, status = 200) => route.fulfill({ json, status });
        if (url.hostname === 'api.cloudinary.com') return reply({ secure_url: uploadKind === 'video' ? 'https://res.cloudinary.com/fixture/video/upload/video.mp4' : 'https://res.cloudinary.com/fixture/image/upload/photo.png', resource_type: uploadKind });
        if (!['xhr', 'fetch'].includes(request.resourceType())) return url.origin === origin ? route.continue() : route.abort();
        const endpoint = url.pathname.replace(/^\/(api|fallback)/, '');
        const requestOwner = activeOwner;
        if (endpoint === '/auth/session') return reply({ token: app.token(requestOwner), profile: app.fullProfile(app.users.find(user => user.id === requestOwner)) });
        if (endpoint === '/profile') return reply(app.fullProfile(app.users.find(user => user.id === requestOwner)));
        if (endpoint === '/billing/status') return reply({ plan: 'pro' });
        if (endpoint === '/media/upload-signature') return reply({ apiKey: 'fixture', timestamp: 1, signature: 'fixture', folder: 'crossposts', cloudName: 'fixture' });
        if (endpoint === '/social/platforms') {
          const result = await app.request(endpoint, { userId: requestOwner });
          result.data.platforms = Object.fromEntries(Object.entries(result.data.platforms).filter(([key]) => ['github', 'gitlab', 'youtube', 'tiktok'].includes(key)));
          return reply(result.data, result.status);
        }
        if (endpoint === '/groups/ufi-general/posts' && request.method() === 'POST') {
          nativeRequests.push({ owner: requestOwner, body: request.postDataJSON() });
          if (nativeAbort) return route.abort('failed');
          if (nativeHold) { const hold = nativeHold; hold.started.resolve(); await hold.release.promise; }
          try { return await reply(nativeConfirmed ? { post: { id: 'native-' + nativeRequests.length } } : {}); } catch { return; }
        }
        if (endpoint === '/auth/social/youtube/start') { consentRequests.push(Object.fromEntries(url.searchParams)); return reply({ error: 'Synthetic YouTube consent was not completed.' }, 400); }
        if (endpoint === '/command-center/cross-post/tiktok/creator-info') return reply({ creator: { creatorUsername: 'fixture_creator', creatorNickname: 'Fixture creator', privacyLevelOptions: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], commentDisabled: true } });
        if (endpoint === '/command-center/cross-post' || endpoint.startsWith('/command-center/cross-post/')) {
          const body = request.method() === 'POST' ? request.postDataJSON() : undefined;
          if (endpoint === '/command-center/cross-post' && body) externalRequests.push({ owner: requestOwner, body });
          const result = await app.request(endpoint + url.search, { userId: requestOwner, method: request.method(), body });
          try { return await reply(result.data, result.status); } catch { return; }
        }
        return reply({ posts: [], groups: [], sources: [], items: [], notifications: [] });
      });
      await installAuditMember(page, app, owner.id);
      await auditNavigate(page, origin + '/command-center?tab=crosspost');
      const section = page.getByRole('tabpanel', { name: 'Cross-Post', exact: true });
      const editor = section.getByRole('textbox', { name: 'Post draft', exact: true });
      await editor.waitFor();
      async function expand() {
        const closed = section.locator('details:not([open]) > summary');
        while (await closed.count()) await closed.first().click();
      }
      await section.getByRole('combobox', { name: 'Publishing category', exact: true }).selectOption('all');
      await expand();
      const target = key => key === 'YouTube'
        ? section.getByLabel('YouTube destination', { exact: true }).getByRole('button', { name: /^(YouTube: Connected|Connect YouTube)$/ })
        : section.getByRole('button', { name: key + ': Connected', exact: true });
      const primary = count => section.getByRole('button', { name: new RegExp('^Publish to ' + count + ' ready destinations?$') });
      const release = source => section.getByRole('group', { name: source + ' release', exact: true });
      const releaseTitle = () => section.getByRole('textbox', { name: /^Release title(?:\s|$)/ });

      await editor.fill('One reviewed draft for my active destinations.');
      for (const name of ['UFIConnect', 'GitHub', 'GitLab', 'YouTube']) await target(name).click();
      const sharedRelease = section.getByRole('group', { name: 'Release publishing template', exact: true });
      await sharedRelease.getByText('Shared by GitHub and GitLab.', { exact: true }).waitFor();
      check(await releaseTitle().count() === 1 && await releaseTitle().getAttribute('maxlength') === '200', 'Matching release formats expose one shared title with the provider length limit');
      await releaseTitle().fill('Shared reviewed release');
      check(await release('GitHub').getByRole('combobox', { name: 'Public repository', exact: true }).inputValue() === 'member/project'
        && await release('GitLab').getByRole('combobox', { name: 'Project', exact: true }).inputValue() === '12', 'Each provider can preselect its sole currently verified destination');
      await release('GitHub').getByRole('combobox', { name: 'Existing release tag', exact: true }).selectOption('v1.0');
      await release('GitLab').getByRole('combobox', { name: 'Existing release tag', exact: true }).selectOption('v2.0');
      await primary(3).waitFor();
      check(await primary(3).isEnabled(), 'Ready native and release destinations can publish alongside read-only YouTube');
      check(await section.getByRole('region', { name: 'Pending destinations', exact: true }).getByText(/YouTube/).count() > 0, 'The pending YouTube destination is identified before submission');
      const opened = context.waitForEvent('page');
      await section.getByRole('button', { name: 'Connect YouTube', exact: true }).click();
      const accountPage = await opened;
      await accountPage.getByText('Synthetic YouTube consent was not completed.', { exact: true }).waitFor();
      check(consentRequests.length === 1 && consentRequests[0].publishing === '1', 'Connect requests YouTube upload permission');
      check(await editor.inputValue() === 'One reviewed draft for my active destinations.' && await target('YouTube').getAttribute('aria-pressed') === 'true', 'The original Cross-Post draft and pending destination survive separate consent');
      const refreshedCatalog = page.waitForResponse(response => new URL(response.url()).pathname === '/api/social/platforms');
      await accountPage.close(); await page.bringToFront(); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await refreshedCatalog;
      check(await releaseTitle().inputValue() === 'Shared reviewed release'
        && await release('GitHub').getByRole('combobox', { name: 'Existing release tag', exact: true }).inputValue() === 'v1.0'
        && await release('GitLab').getByRole('combobox', { name: 'Existing release tag', exact: true }).inputValue() === 'v2.0', 'Returning from consent refreshes accounts without erasing reviewed provider settings');
      await page.screenshot({ path: path.join(output, 'active-publishing-pending-' + width + '.png'), fullPage: true });
      const held = deferred(); state.holdWrite = held.promise;
      // A real button click invokes native form validation and submit dispatch.
      // Holding the provider response makes the duplicate-click assertion meaningful.
      await primary(3).evaluate(button => { button.click(); button.click(); });
      await page.waitForFunction(() => document.querySelector('button[form="ufi-crosspost-compose"]')?.disabled === true);
      held.resolve(); state.holdWrite = null;
      await section.getByRole('heading', { name: 'Result', exact: true }).waitFor();
      await primary(0).waitFor();
      check(externalRequests.length === 1 && nativeRequests.length === 1 && writes.length === 2, 'Double submit sends one external batch and one native post');
      assert.deepEqual(externalRequests[0].body.platforms, ['github', 'gitlab']); report.checks++;
      check(writes.find(write => write.url.startsWith('https://api.github.com/'))?.json.name === 'Shared reviewed release' && writes.find(write => write.url.startsWith('https://gitlab.com/'))?.json.name === 'Shared reviewed release', 'The shared release title reaches both real provider adapters');
      check(writes[0].json.tag_name !== writes[1].json.tag_name, 'Provider destinations and tags remain independent within the shared template');
      check(await target('YouTube').getAttribute('aria-pressed') === 'true' && await target('GitHub').getAttribute('aria-pressed') === 'false' && await target('UFIConnect').getAttribute('aria-pressed') === 'false', 'Pending destination remains selected; accepted native and external destinations are deselected');
      check(await editor.inputValue() === 'One reviewed draft for my active destinations.', 'The pending destination retains the original draft');

      state.youtubeDenied = false;
      await page.evaluate(() => window.dispatchEvent(new Event('ufi-connections-changed')));
      const video = section.getByRole('group', { name: 'YouTube video', exact: true });
      await video.getByRole('combobox', { name: 'Video visibility', exact: true }).waitFor();
      check(await video.getByRole('combobox', { name: 'Video visibility', exact: true }).inputValue() === '' && await video.getByRole('combobox', { name: 'Is this video made for kids?', exact: true }).inputValue() === '', 'Provider context never preselects privacy or audience');
      await section.locator('.publish-photo input[type=file]').first().setInputFiles({ name: 'video.mp4', mimeType: 'video/mp4', buffer: Buffer.from('synthetic video bytes') });
      await section.getByText('Attached video', { exact: true }).waitFor();
      await video.getByRole('combobox', { name: 'YouTube channel', exact: true }).selectOption('UCfixturechannel');
      await video.getByRole('textbox', { name: 'Video title', exact: true }).fill('Reviewed YouTube upload');
      await video.getByRole('combobox', { name: 'Video visibility', exact: true }).selectOption('unlisted');
      check(await primary(0).isDisabled(), 'YouTube remains pending until its explicit audience choice');
      await video.getByRole('combobox', { name: 'Is this video made for kids?', exact: true }).selectOption('no');
      await primary(1).click();
      await editor.waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.querySelector('textarea[aria-label="Post draft"]')?.value === '');
      assert.deepEqual(externalRequests[1].body.platforms, ['youtube']); report.checks++;
      check(nativeRequests.length === 1 && writes.filter(write => write.url.includes('/releases')).length === 2, 'A later ready batch cannot repeat accepted native or release destinations');
      check(fixture.history[0].targets[0].status === 'processing' && fixture.history[0].targets[0].privacyStatus === 'unlisted', 'A real accepted video upload is processing with its chosen privacy');

      await editor.fill('Native can send while the selected release is incomplete.');
      await target('UFIConnect').click(); await target('GitHub').click();
      await release('GitHub').getByText(/Your last successful publication here:/).waitFor();
      check(await release('GitHub').getByText(/From your UFIConnect publishing history/).isVisible(), 'Usage guidance comes from the signed-in member successful publishing history');
      const clearedRepository = page.waitForResponse(response => /\/cross-post\/github\/destinations$/.test(new URL(response.url()).pathname));
      await release('GitHub').getByRole('combobox', { name: 'Public repository', exact: true }).selectOption('');
      await clearedRepository;
      check(await release('GitHub').getByRole('combobox', { name: 'Public repository', exact: true }).inputValue() === '', 'An explicitly cleared destination stays empty after refreshed provider metadata');
      await target('YouTube').click();
      uploadKind = 'image';
      await section.locator('.publish-photo input[type=file]').first().setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: await fs.readFile(path.join(root, 'web/public/media/preparation/professional-introduction.png')) });
      await section.getByAltText('Selected for cross-posting', { exact: true }).waitFor();
      await target('TikTok').click();
      const tiktokConsent = section.getByRole('checkbox', { name: /I authorize this post/ });
      await tiktokConsent.waitFor();
      check(!await tiktokConsent.isChecked(), 'TikTok consent remains explicit while other selected destinations can be ready');
      await releaseTitle().fill('');
      await release('GitHub').getByRole('combobox', { name: 'Existing release tag', exact: true }).selectOption('');
      await primary(1).click();
      await primary(0).waitFor();
      check(nativeRequests.length === 2 && externalRequests.length === 2, 'Pending YouTube, incomplete release fields and required TikTok consent do not block a ready native form submission');
      check(await target('GitHub').getAttribute('aria-pressed') === 'true' && await editor.inputValue() !== '', 'The incomplete release and its draft remain after the native receipt');
      await releaseTitle().fill('Follow-up release');
      await release('GitHub').getByRole('combobox', { name: 'Public repository', exact: true }).selectOption('member/project');
      await release('GitHub').getByRole('combobox', { name: 'Existing release tag', exact: true }).selectOption('v3.0');
      await primary(1).click();
      await primary(0).waitFor();
      check(nativeRequests.length === 2 && externalRequests.length === 3, 'Completing the pending release never resends the already accepted native destination');
      await target('YouTube').click(); await target('TikTok').click();
      await section.getByRole('button', { name: 'Remove photo', exact: true }).click();

      state.githubReceipt = false;
      await editor.fill('This receipt will be deliberately unconfirmed.'); await target('GitHub').click();
      await releaseTitle().fill('Unconfirmed release');
      await release('GitHub').getByRole('combobox', { name: 'Existing release tag', exact: true }).selectOption('v2.0');
      await primary(1).click();
      await page.waitForFunction(() => document.querySelector('textarea[aria-label="Post draft"]')?.value === '');
      check(fixture.history[0].targets[0].status === 'handoff' && fixture.history[0].targets[0].deliveryUncertain === true, 'An absent provider receipt is an uncertain handoff, never posted');
      check(await target('GitHub').getAttribute('aria-pressed') === 'false', 'Uncertain provider writes are deselected to prevent an automatic duplicate');

      nativeConfirmed = false;
      await editor.fill('A native response without a receipt is unconfirmed.'); await target('UFIConnect').click();
      const nativeBeforeUnknown = nativeRequests.length;
      await primary(1).click(); await primary(0).waitFor();
      const unknownResult = section.getByRole('heading', { name: 'Result', exact: true }).locator('..');
      check(!/\bPosted\b/.test(await unknownResult.innerText()), 'A missing native receipt cannot display Posted');
      check(await primary(0).isDisabled() && nativeRequests.length === nativeBeforeUnknown + 1, 'An unconfirmed native request cannot immediately be sent again');
      nativeConfirmed = true;

      state.githubReceipt = true; nativeAbort = true;
      await editor.fill('A failed native request must not hold an unsent ready provider.');
      if (await target('UFIConnect').getAttribute('aria-pressed') !== 'true') await target('UFIConnect').click();
      await target('GitHub').click(); await releaseTitle().fill('Independent external delivery');
      await release('GitHub').getByRole('combobox', { name: 'Existing release tag', exact: true }).selectOption('v4.0');
      const beforeNativeFailure = nativeRequests.length, beforeExternalFailure = externalRequests.length;
      await primary(2).click(); await primary(0).waitFor(); nativeAbort = false;
      check(nativeRequests.length === beforeNativeFailure + 1 && externalRequests.length === beforeExternalFailure + 1, 'A native network failure holds only the uncertain native delivery while sending the other ready provider once');
      check(fixture.history[0].targets[0].platform === 'github' && fixture.history[0].targets[0].status === 'posted', 'The independent external delivery is backed by its actual provider receipt');
      check(await primary(0).isDisabled(), 'The possibly committed native request cannot be duplicated immediately');

      await auditNavigate(page, origin + '/command-center?tab=accounts');
      await page.getByRole('heading', { name: 'Account connections', exact: true }).waitFor();
      await page.evaluate(async userId => {
        const { privateSessionStorage } = await import('/src/auth/session.js');
        const key = 'ufi_crosspost_draft:' + userId;
        privateSessionStorage.setItem(key, JSON.stringify({ content: 'Recover this interrupted draft.', media: null, selected: ['github'] }));
        privateSessionStorage.setItem(key + ':sending', '1');
      }, owner.id);
      const beforeRecovery = externalRequests.length, beforeRecoveryWrites = writes.length;
      await auditNavigate(page, origin + '/command-center?tab=crosspost'); await editor.waitFor(); await expand();
      check(await editor.inputValue() === 'Recover this interrupted draft.' && await section.getByRole('button', { name: 'Publishing…', exact: true }).count() === 0, 'An orphan sending marker recovers the draft without a permanent Publishing state');
      check(await primary(0).isDisabled() && externalRequests.length === beforeRecovery && writes.length === beforeRecoveryWrites, 'Interrupted destinations are held for review without an automatic retry');
      await target('GitLab').click();
      await section.getByRole('group', { name: 'Release publishing template', exact: true }).getByText('Shared by GitHub and GitLab.', { exact: true }).waitFor();
      await releaseTitle().fill('A new ready destination');
      await release('GitLab').getByRole('combobox', { name: 'Existing release tag', exact: true }).selectOption('v1.0');
      await primary(1).click(); await primary(0).waitFor();
      assert.deepEqual(externalRequests.at(-1).body.platforms, ['gitlab']); report.checks++;
      check(externalRequests.length === beforeRecovery + 1 && writes.length === beforeRecoveryWrites + 1 && await target('GitHub').getAttribute('aria-pressed') === 'true', 'A new ready destination can publish while the interrupted target stays held');

      await editor.fill('Old-account native response must not send external destinations.');
      if (await target('UFIConnect').getAttribute('aria-pressed') !== 'true') await target('UFIConnect').click();
      if (await target('GitHub').getAttribute('aria-pressed') !== 'true') await target('GitHub').click();
      await releaseTitle().fill('Account switch guard');
      await release('GitHub').getByRole('combobox', { name: 'Existing release tag', exact: true }).selectOption('v1.0');
      nativeHold = { started: deferred(), release: deferred() };
      const hold = nativeHold, beforeExternal = externalRequests.length, beforeWrites = writes.length;
      await primary(2).click(); await hold.started.promise;
      activeOwner = 'other-publisher'; await installAuditMember(page, app, activeOwner);
      await auditNavigate(page, origin + '/command-center?tab=crosspost');
      await editor.waitFor(); hold.release.resolve(); nativeHold = null;
      await page.waitForTimeout(150);
      check(externalRequests.length === beforeExternal && writes.length === beforeWrites, 'A late local receipt cannot send external publications after the member changes');
      check(await editor.inputValue() === '', 'Old-member pending work cannot replace the next member draft');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Publishing templates and pending states fit ' + width + 'px');
      check(errors.length === 0, 'No runtime errors: ' + errors.join('; '));
      await page.screenshot({ path: path.join(output, 'active-publishing-' + width + '.png'), fullPage: true });
      report.widths.push({ width, passed: true, externalBatches: externalRequests.length, nativePosts: nativeRequests.length, providerWrites: writes.length });
      console.log('PASS: real active publishing at ' + width + 'px');
    } catch (error) {
      await page.screenshot({ path: path.join(output, 'active-publishing-failure-' + width + '.png'), fullPage: true });
      console.error(page.url(), (await page.locator('body').innerText()).slice(-7000));
      console.error(await page.getByRole('tabpanel', { name: 'Cross-Post', exact: true }).ariaSnapshot());
      throw error;
    } finally { await context.close(); await app.close(); }
  }
  await fs.writeFile(path.join(output, 'active-publishing-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally { await browser?.close(); await server.close(); }
