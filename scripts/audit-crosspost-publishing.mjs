import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';
import { installAuditMember, auditNavigate } from './audit-session.mjs';

// All API routes below are intercepted. Keep this browser fixture independent
// of the backend VM, whose adapters have their own route tests.
const profile = { id: 'publishing-direct', name: 'Publishing fixture', email: 'publishing@example.invalid',
  plan: 'pro', onboardingComplete: true, joinedGroups: [], skills: [], socialAccounts: {},
  preferences: { interests: [], goals: [] }, roleSettings: {}, links: {} };
const app = { users: [profile], fullProfile: value => value, request: async () => ({ status: 200, data: profile }),
  token: () => Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ id: profile.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.synthetic-ui-fixture', close: async () => {} };
const server = await startBuiltServer({ port: 0 });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
const photo = await fs.readFile('web/public/media/preparation/professional-introduction.png');
const photoUrl = 'https://res.cloudinary.com/publishing-fixture/image/upload/photo.png';
const writes = [], errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const headers = { 'Access-Control-Allow-Origin': server.origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*' };
    const fulfill = json => route.fulfill({ headers, json });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (request.resourceType() === 'image' && url.hostname === 'res.cloudinary.com') return route.fulfill({ body: photo, contentType: 'image/png' });
    if (url.hostname === 'api.cloudinary.com') return fulfill({ secure_url: photoUrl, resource_type: 'image' });
    if (!['xhr', 'fetch'].includes(request.resourceType())) return url.origin === server.origin ? route.continue() : route.abort();
    const endpoint = url.pathname.replace(/^\/(api|fallback)/, '');
    if (endpoint === '/profile') return fulfill(app.fullProfile(app.users[0]));
    if (endpoint === '/billing/status') return fulfill({ plan: 'pro' });
    if (endpoint === '/social/platforms') return fulfill({ connected: { linkedin: true, tiktok: true, github: true }, platforms: {
      linkedin: { name: 'LinkedIn', configured: true, crossPost: { supported: true, media: 'native-image' } },
      tiktok: { name: 'TikTok', configured: true, crossPost: { supported: true, requiresPhoto: true, media: 'native-image', delivery: 'direct' } },
      github: { name: 'GitHub', configured: true, crossPost: { supported: false } },
      bluesky: { name: 'Bluesky', configured: true, crossPost: { supported: true, media: 'native-image' } },
    } });
    if (endpoint === '/media/upload-signature') return fulfill({ apiKey: 'fixture', timestamp: 1, signature: 'fixture', folder: 'crossposts', cloudName: 'publishing-fixture' });
    if (endpoint === '/command-center/cross-post/tiktok/creator-info') return fulfill({ creator: { creatorUsername: 'fixture_creator', creatorNickname: 'Fixture creator', privacyLevelOptions: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], commentDisabled: true } });
    if (endpoint === '/command-center/cross-post' && request.method() === 'POST') {
      const body = request.postDataJSON(); writes.push(body);
      return fulfill({ id: `delivery-${writes.length}`, historySaved: true, mediaUrl: body.mediaUrl, targets: body.platforms.map(platform => platform === 'tiktok' ? { platform, status: 'processing', publishId: 'direct-fixture' }
        : writes.length === 1 ? { platform, status: 'failed', error: 'Synthetic provider decline' } : { platform, status: 'posted', postedUrl: 'https://www.linkedin.com/feed/update/fixture' }) });
    }
    return fulfill({ posts: [], sources: [], items: [], members: [], invitations: [] });
  });
  await installAuditMember(page, app, 'publishing-direct');
  await auditNavigate(page, server.origin + '/command-center?tab=crosspost');
  const editor = page.getByRole('textbox', { name: 'Post draft', exact: true });
  await editor.fill('A photo for my connected accounts.');
  const github = page.getByRole('button', { name: 'Manage GitHub: Connected', exact: true });
  assert.equal(await github.isEnabled(), true, 'Connected accounts without publishing support remain manageable');
  assert.equal(await github.getAttribute('aria-pressed'), 'false', 'Account management does not select an unsupported publishing destination');
  assert.equal(await page.getByRole('button', { name: /Bluesky:/, includeHidden: true }).count(), 0, 'Disconnected accounts are omitted from Cross-Post');
  assert.equal(await page.getByText(/^Other sources/).count(), 0, 'Cross-Post omits Other sources groups');
  assert.equal(await page.getByRole('button', { name: 'Copy draft', exact: true }).count(), 0);
  await page.locator('.publish-photo input[type=file]').first().setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: photo });
  await page.getByAltText('Selected for cross-posting', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'TikTok: Connected', exact: true }).click();
  await page.getByText('Account: Fixture creator (@fixture_creator)', { exact: true }).waitFor();
  const visibility = page.getByRole('combobox', { name: /Who can view this post/ });
  const publish = page.getByRole('button', { name: /^Publish to \d+ ready destinations?$/ });
  const consent = page.getByRole('checkbox', { name: /I authorize this post/ });
  assert.equal(await visibility.inputValue(), '');
  assert.equal(await publish.isDisabled(), true);
  assert.equal(await page.getByRole('checkbox', { name: /Allow comments/ }).isDisabled(), true);
  await visibility.selectOption('PUBLIC_TO_EVERYONE');
  await consent.check();
  await editor.fill('A revised photo for my connected accounts.');
  assert.equal(await consent.isChecked(), false, 'Editing the draft resets TikTok consent');
  await consent.check();
  await page.getByRole('button', { name: 'LinkedIn: Connected', exact: true }).click();
  await fs.mkdir('.cache/audit-ui', { recursive: true });
  await page.screenshot({ path: '.cache/audit-ui/crosspost-tiktok-consent-390.png', fullPage: true });
  await publish.click();
  await page.getByRole('heading', { name: 'Result', exact: true }).waitFor();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].platforms, ['tiktok', 'linkedin'], 'Only selected ready publishing destinations are sent');
  assert.equal(writes[0].tiktok.creatorUsername, 'fixture_creator');
  assert.equal(writes[0].tiktok.privacyLevel, 'PUBLIC_TO_EVERYONE');
  assert.equal(writes[0].tiktok.disableComment, true);
  assert.equal(writes[0].tiktok.consent, true);
  assert.equal(writes[0].tiktok.autoAddMusic, false);
  assert.equal(writes[0].mediaUrl, photoUrl);
  assert.equal(await editor.inputValue(), 'A revised photo for my connected accounts.');
  assert.equal(await page.getByRole('button', { name: 'TikTok: Connected', exact: true }).getAttribute('aria-pressed'), 'false');
  assert.equal(await page.getByRole('button', { name: 'LinkedIn: Connected', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.ok(await page.getByText('Processing', { exact: true }).first().isVisible());
  await publish.click();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Post draft"]')?.value === '');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].platforms, ['linkedin'], 'Retry sends only the failed destination');
  assert.equal(writes[1].tiktok, undefined);
  assert.deepEqual(errors, []);
  console.log('PASS: connected-source locks, TikTok privacy/consent/payload, processing status, retained failed draft and duplicate-safe retry. No production writes.');
  await context.close();
} finally { await browser.close(); await server.close(); await app.close(); }
