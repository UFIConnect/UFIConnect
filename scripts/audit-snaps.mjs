import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate } from './audit-session.mjs';

const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = await createAppHarness();
// File-backed test identities avoid requiring a live account database. Native
// production UUID validation is covered by the backend's Snap route tests.
const owner = 'snap-owner';
const author = 'snap-author';
const nextOwner = 'snap-next-member';
const favorites = { feed: ['facebook', 'twitter'], following: ['uficonnect', 'facebook'] };
for (const [id, name] of [[owner, 'Snap owner'], [author, 'Snap author'], [nextOwner, 'Next member']]) {
  app.seedUser(member(id, { name, plan: 'pro', roleSettings: { feedSourceFavorites: favorites } }));
}
const photo = await fs.readFile(path.join(root, 'web/public/media/preparation/professional-introduction.png'));
const photoUrl = 'https://res.cloudinary.com/snaps-fixture/image/upload/v1/uficonnect-snaps/audit-photo.png';
const proof = { publicId: `uficonnect-snaps/snap-${owner}-audit`, version: 1, signature: 'a'.repeat(40) };
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5274, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } },
});
let browser, checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }
function snap(id, source = 'uficonnect', extra = {}) {
  return { id, source, caption: id, mediaUrl: photoUrl, thumbnailUrl: photoUrl, mediaType: 'image',
    visibility: 'public', createdAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 23 * 3600_000).toISOString(),
    author: { id: author, name: 'Snap author' }, ...extra };
}
await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  const origin = server.resolvedUrls.local[0];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: width < 600, isMobile: width < 600, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(16000);
    const errors = [], writes = [], reads = [];
    let viewerId = owner, uploadCount = 0, uploadedForm = '', held = null, holdMode = null;
    let heldRequestResolve;
    let heldRequest = new Promise(resolve => { heldRequestResolve = resolve; });
    // Three source rows exercise grouping/ranking only. The audit does not
    // claim that these synthetic providers expose Stories to UFIConnect.
    let rows = [
      snap('native-public', 'uficonnect', { owned: true, author: { id: owner, name: 'Snap owner' }, createdAt: new Date().toISOString() }),
      snap('native-private', 'uficonnect', { visibility: 'followers', owned: true, caption: 'Private first account snap', author: { id: owner, name: 'Snap owner' } }),
      snap('other-native', 'uficonnect'),
      snap('facebook-fixture', 'facebook', { author: { id: 'facebook-author', name: 'Facebook fixture', profileUrl: 'https://www.facebook.com/example' }, sourceUrl: 'https://www.facebook.com/stories/example' }),
      snap('twitter-fixture', 'twitter', { author: { id: 'twitter-author', name: 'X fixture', profileUrl: 'https://x.com/example' }, sourceUrl: 'https://x.com/example/status/123' }),
      snap('expired-fixture', 'instagram', { caption: 'Expired fixture', expiresAt: new Date(Date.now() - 1000).toISOString() }),
    ];
    const visibleRows = mode => rows.filter(item => (mode !== 'ufi' || item.source === 'uficonnect')
      && (item.visibility !== 'followers' || item.author.id === viewerId));
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const headers = { 'Access-Control-Allow-Origin': new URL(origin).origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*' };
      if (url.hostname === 'res.cloudinary.com') return route.fulfill({ body: photo, contentType: 'image/png' });
      if (url.hostname === 'api.cloudinary.com') {
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        uploadCount++; uploadedForm = request.postData() || '';
        return route.fulfill({ headers, json: { secure_url: photoUrl, resource_type: 'image', public_id: proof.publicId, version: proof.version, signature: proof.signature } });
      }
      if (url.origin !== new URL(origin).origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const endpoint = url.pathname.replace(/^\/api/, ''), method = request.method();
      const fulfill = json => route.fulfill({ json });
      if (endpoint === '/snaps' && method === 'GET') {
        const mode = url.searchParams.get('mode') || 'home'; reads.push({ endpoint, mode });
        const body = { snaps: visibleRows(mode), sourceErrors: {} };
        if (holdMode === mode) {
          holdMode = null; held = { route, body }; heldRequestResolve(); return;
        }
        return fulfill(body);
      }
      if (endpoint === '/snaps' && method === 'POST') {
        const body = request.postDataJSON(); writes.push({ endpoint, method, body });
        const item = snap('posted-native', 'uficonnect', { ...body, owned: true, author: { id: viewerId, name: 'Snap owner' }, createdAt: new Date().toISOString() });
        rows.unshift(item); return fulfill({ snap: item });
      }
      if (endpoint.startsWith('/snaps/') && method === 'DELETE') {
        writes.push({ endpoint, method }); rows = rows.filter(item => item.id !== endpoint.slice('/snaps/'.length));
        return fulfill({ deleted: true });
      }
      if (endpoint === '/reports' && method === 'POST') { writes.push({ endpoint, method, body: request.postDataJSON() }); return fulfill({ ok: true, id: 'report-snap-fixture' }); }
      if (endpoint === '/media/upload-signature') {
        check(url.searchParams.get('folder') === 'snaps', 'Snap composer requests its owned upload folder');
        return fulfill({ apiKey: 'fixture', timestamp: 1, signature: 'fixture', folder: 'uficonnect-snaps', publicId: proof.publicId.split('/').at(-1), cloudName: 'snaps-fixture' });
      }
      if (['/office/feed', '/feed', '/posts'].includes(endpoint)) {
        reads.push({ endpoint }); return fulfill({ posts: [], hasMore: false, nativeUficonnectIncluded: true });
      }
      if (/events|stream/.test(endpoint)) return route.abort();
      return route.continue();
    });
    await installAuditMember(page, app, owner);
    await auditNavigate(page, origin + '?feed=feed');
    const rail = page.locator('.snap-rail');
    await rail.getByRole('button', { name: /View Snap owner's snap: native-public/ }).waitFor();
    check((await rail.getAttribute('data-snap-mode')) === 'home', 'Home reads its own Snap mode');
    await page.waitForFunction(() => { const image = document.querySelector('.snap-thumbnail img'); return image?.complete && image.naturalWidth > 0; });
    check(true, 'Snap thumbnails load actual media before opening the viewer');
    assert.deepEqual(await rail.locator('.snap-source-box').evaluateAll(elements => elements.map(element => element.dataset.snapSource)), ['facebook', 'twitter', 'uficonnect']); checks++;
    check(await rail.getByRole('button', { name: /Expired fixture/ }).count() === 0, 'Expired snaps are removed before rendering');
    const cardBoxes = await rail.locator('.snap-source-box').evaluateAll(elements => elements.map(element => ({ x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y, background: getComputedStyle(element).backgroundColor })));
    check(cardBoxes.every(box => box.background === 'rgb(8, 8, 8)'), 'Every source is contained in a black box');
    check(cardBoxes[1].x > cardBoxes[0].x && cardBoxes.every(box => Math.abs(box.y - cardBoxes[0].y) < 2), 'Source boxes sit next to each other');
    const sources = page.getByRole('group', { name: 'Home sources', exact: true }); await sources.waitFor();
    check((await rail.boundingBox()).y + (await rail.boundingBox()).height <= (await sources.boundingBox()).y + 2, 'Snaps appear above Home source selection');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Home has no page overflow');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/snaps-home-${width}.png`) });

    const feedReadCount = () => reads.filter(read => read.endpoint !== '/snaps').length;
    const beforeFeed = feedReadCount(), beforeSnaps = reads.filter(read => read.endpoint === '/snaps').length;
    await rail.getByRole('button', { name: 'Refresh snaps', exact: true }).click();
    await rail.getByRole('button', { name: 'Refresh snaps', exact: true }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('.snap-refresh-button')?.disabled);
    check(reads.filter(read => read.endpoint === '/snaps').length === beforeSnaps + 1 && feedReadCount() === beforeFeed, 'Snap refresh does not consume or reload post feeds');

    await rail.getByRole('button', { name: /View Snap author's snap: other-native/ }).click();
    let viewer = page.locator('dialog.snap-viewer'); await viewer.waitFor();
    await page.waitForFunction(() => { const image = document.querySelector('.snap-viewer-media img'); return image?.complete && image.naturalWidth > 0; });
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/snaps-viewer-${width}.png`) });
    check(await viewer.getByRole('link', { name: 'Snap author', exact: true }).getAttribute('href') === `/u/${author}`, 'Snap author routes to the posting profile');
    await viewer.getByRole('button', { name: 'Report this snap', exact: true }).click();
    const report = page.getByRole('dialog', { name: 'Report snap', exact: true }); await report.waitFor();
    check(await page.locator('dialog.snap-viewer').count() === 0, 'Native viewer closes before the report dialog');
    await report.getByRole('radio', { name: 'Other', exact: true }).check();
    await report.getByLabel('Additional details (optional)').fill('Synthetic UI audit report.');
    await report.getByRole('button', { name: 'Submit report', exact: true }).click();
    const receipt = page.getByRole('dialog', { name: 'Report submitted', exact: true });
    await receipt.getByRole('heading', { name: 'Report submitted', exact: true }).waitFor();
    check(writes.at(-1).body.targetId === 'other-native' && writes.at(-1).body.targetType === 'post', 'Snap reports identify their actual content');
    await receipt.getByRole('button', { name: 'Done', exact: true }).click();
    await rail.getByRole('button', { name: /View Snap author's snap: other-native/ }).click();
    await page.locator('dialog.snap-viewer').getByRole('link', { name: 'Snap author', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/u/${author}`);
    await auditNavigate(page, origin + '?feed=feed');
    await rail.getByRole('button', { name: /View Snap owner's snap: native-public/ }).waitFor();

    await rail.getByRole('button', { name: 'Post snap', exact: true }).click();
    const composer = page.getByRole('dialog', { name: 'Post a snap', exact: true }); await composer.waitFor();
    await composer.locator('input[type="file"]').first().setInputFiles({ name: 'snap-photo.png', mimeType: 'image/png', buffer: photo });
    await composer.getByLabel('Caption (optional)').fill('Fresh photo snap');
    await composer.getByRole('radio', { name: /Followers/ }).check();
    await composer.getByRole('button', { name: 'Post snap', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('dialog.snap-composer button[type="submit"]')?.disabled);
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/snaps-composer-${width}.png`) });
    await composer.getByRole('button', { name: 'Post snap', exact: true }).click();
    await rail.getByRole('button', { name: /View Snap owner's snap: Fresh photo snap/ }).waitFor();
    const published = writes.find(write => write.endpoint === '/snaps' && write.method === 'POST');
    assert.deepEqual(published.body, { mediaUrl: photoUrl, mediaType: 'image', caption: 'Fresh photo snap', visibility: 'followers', upload: proof }); checks++;
    check(uploadCount === 1 && uploadedForm.includes('name="public_id"') && uploadedForm.includes(proof.publicId.split('/').at(-1)), 'Signed upload identity reaches Cloudinary before publication');
    await rail.getByRole('button', { name: /View Snap owner's snap: Fresh photo snap/ }).click();
    viewer = page.locator('dialog.snap-viewer');
    await viewer.getByText('Followers only', { exact: true }).waitFor();
    await viewer.getByRole('button', { name: 'Delete this snap', exact: true }).click();
    check(writes.filter(write => write.method === 'DELETE').length === 0, 'Deleting requires a second deliberate action');
    await viewer.getByRole('button', { name: 'Delete snap', exact: true }).click();
    await page.locator('dialog.snap-viewer').waitFor({ state: 'detached' });
    check(await rail.getByRole('button', { name: /Fresh photo snap/ }).count() === 0 && writes.filter(write => write.method === 'DELETE').length === 1, 'Owner deletion removes the snap from the rail');

    await auditNavigate(page, origin + '?feed=ufi');
    await page.locator('.snap-rail[data-snap-mode="ufi"]').waitFor();
    await rail.getByRole('button', { name: /native-public/ }).waitFor();
    assert.deepEqual(await rail.locator('.snap-source-box').evaluateAll(elements => elements.map(element => element.dataset.snapSource)), ['uficonnect']); checks++;
    check((await rail.boundingBox()).y + (await rail.boundingBox()).height <= (await page.locator('.ufi-feed-toolbar').boundingBox()).y + 2, 'UFI snaps appear above its posting/topic toolbar');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/snaps-ufi-${width}.png`) });
    await auditNavigate(page, origin + 'post');
    await rail.getByRole('button', { name: /native-public/ }).waitFor();
    check(await rail.getAttribute('data-snap-mode') === 'ufi', 'Standalone UFI also includes the native Snap rail');

    await auditNavigate(page, origin + '?feed=feed');
    await rail.getByRole('button', { name: /native-public/ }).waitFor();
    holdMode = 'home';
    await rail.getByRole('button', { name: 'Refresh snaps', exact: true }).click(); await heldRequest;
    const oldHome = held; held = null;
    await auditNavigate(page, origin + '?feed=following');
    await page.locator('.snap-rail[data-snap-mode="following"]').getByRole('button', { name: /native-public/ }).waitFor();
    await oldHome.route.fulfill({ json: { snaps: [snap('late-home-fixture', 'facebook', { caption: 'Wrong old Home response' })], sourceErrors: {} } }).catch(() => {});
    await page.waitForTimeout(150);
    check(await rail.getByRole('button', { name: /Wrong old Home response/ }).count() === 0, 'Late Home responses never replace Following snaps');
    assert.deepEqual(await rail.locator('.snap-source-box').evaluateAll(elements => elements.map(element => element.dataset.snapSource)), ['uficonnect', 'facebook', 'twitter']); checks++;
    const followingSources = page.getByRole('group', { name: 'Following sources', exact: true }); await followingSources.waitFor();
    check((await rail.boundingBox()).y + (await rail.boundingBox()).height <= (await followingSources.boundingBox()).y + 2, 'Following snaps appear above source selection');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/snaps-following-${width}.png`) });

    heldRequest = new Promise(resolve => { heldRequestResolve = resolve; }); holdMode = 'following';
    await rail.getByRole('button', { name: 'Refresh snaps', exact: true }).click(); await heldRequest;
    const oldAccount = held;
    viewerId = nextOwner;
    rows.push(snap('next-account-fixture', 'uficonnect', { owned: true, author: { id: nextOwner, name: 'Next member' } }));
    await installAuditMember(page, app, nextOwner);
    await auditNavigate(page, origin + '?feed=following');
    await rail.getByRole('button', { name: /View Next member's snap/ }).waitFor();
    await oldAccount.route.fulfill({ json: oldAccount.body }).catch(() => {});
    await page.waitForTimeout(150);
    check(await rail.getByRole('button', { name: /Private first account snap/ }).count() === 0, 'Switching accounts clears private snap state and rejects the previous account response');
    viewerId = null;
    await auditNavigate(page, origin + 'global?audit-public=1');
    await rail.getByRole('button', { name: /other-native/ }).waitFor();
    check(await rail.getByRole('button', { name: /Private first account snap/ }).count() === 0, 'Public Snap discovery excludes followers-only snaps');
    check(await rail.getByRole('link', { name: 'Post snap', exact: true }).getAttribute('href') === '/login', 'Guest posting routes to sign-in');
    check(await rail.locator('.snap-source-favorite').count() === 0, 'Guests have no invented favorite sources');
    await rail.getByRole('button', { name: /other-native/ }).click();
    viewer = page.locator('dialog.snap-viewer'); await viewer.waitFor();
    check(await viewer.getByRole('button', { name: 'Delete this snap', exact: true }).count() === 0 && await viewer.getByRole('button', { name: 'Report this snap', exact: true }).count() === 0, 'Guest viewer exposes no authenticated content mutations');
    await page.keyboard.press('Escape');
    await page.locator('dialog.snap-viewer').waitFor({ state: 'detached' });
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/snaps-global-${width}.png`) });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'No page overflow after dialogs, routes or account switching');
    assert.deepEqual(errors, []); checks++;
    console.log(`PASS: Snap grouping, favorites, Home/Following/UFI placement, refresh, signed upload, audience, profile/report/delete, expiry, session isolation and layout at ${width}px`);
    await context.close();
  }
  console.log(`PASS: ${checks} Snap browser checks.`);
} finally { await browser?.close(); await server.close(); await app.close(); }
