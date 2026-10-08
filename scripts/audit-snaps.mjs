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
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: width < 600, isMobile: width < 600, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(16000);
    const errors = [], writes = [], reads = [];
    let viewerId = owner, uploadCount = 0, uploadedForm = '', held = null, holdMode = null, sourceFailures = {};
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
    const visibleRows = (mode, source) => rows.filter(item => (mode !== 'ufi' || item.source === 'uficonnect')
      && (!source || item.source === source)
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
      if (['www.youtube.com', 'mastodon.social', 'embed.bsky.app', 'www.redditmedia.com'].includes(url.hostname) && request.resourceType() === 'document') {
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Official source player fixture</title><button>Play source clip</button>' });
      }
      if (url.hostname === 'media.snaps.invalid') return;
      if (url.origin !== new URL(origin).origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const endpoint = url.pathname.replace(/^\/api/, ''), method = request.method();
      const fulfill = json => route.fulfill({ json });
      if (endpoint === '/snaps' && method === 'GET') {
        const mode = url.searchParams.get('mode') || 'home', source = url.searchParams.get('source');
        reads.push({ endpoint, mode, source, bust: url.searchParams.get('bust') });
        const sourceErrors = source ? Object.fromEntries(Object.entries(sourceFailures).filter(([key]) => key === source)) : { ...sourceFailures };
        const body = { snaps: visibleRows(mode, source), sourceErrors };
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
    assert.deepEqual(await rail.locator('.snap-source-box').evaluateAll(elements => elements.map(element => element.dataset.snapSource)), ['uficonnect', 'facebook', 'twitter']); checks++;
    const nativeBox = rail.locator('[data-snap-source="uficonnect"]');
    check(await nativeBox.getByRole('button', { name: 'Post snap', exact: true }).count() === 1
      && await rail.getByRole('button', { name: 'Post snap', exact: true }).count() === 1, 'Post snap is contained only in the first UFI box');
    check(await rail.getByRole('heading', { name: 'Snaps', exact: true }).count() === 0
      && await rail.locator('.snap-rail-heading, .snap-rail-description').count() === 0, 'The rail has no visible Snaps title or subtitle');
    check(await rail.getByRole('button', { name: /previous|next|scroll|earlier|later/i }).count() === 0, 'The source row has no navigation arrows');
    check(await rail.getByRole('button', { name: /Expired fixture/ }).count() === 0, 'Expired snaps are removed before rendering');
    const cardBoxes = await rail.locator('.snap-source-box').evaluateAll(elements => elements.map(element => ({ x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y, background: getComputedStyle(element).backgroundColor })));
    check(cardBoxes.every(box => box.background === 'rgb(8, 8, 8)'), 'Every source is contained in a black box');
    check(cardBoxes[1].x > cardBoxes[0].x && cardBoxes.every(box => Math.abs(box.y - cardBoxes[0].y) < 2), 'Source boxes sit next to each other');
    const sources = page.getByRole('group', { name: 'Home sources', exact: true }); await sources.waitFor();
    check((await rail.boundingBox()).y + (await rail.boundingBox()).height <= (await sources.boundingBox()).y + 2, 'Snaps appear above Home source selection');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Home has no page overflow');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/snaps-home-${width}.png`) });

    const feedReadCount = () => reads.filter(read => read.endpoint !== '/snaps').length;
    const refreshSource = async (label, source, mode = 'home') => {
      const beforeFeed = feedReadCount(), beforeSnaps = reads.filter(read => read.endpoint === '/snaps').length;
      const response = page.waitForResponse(result => {
        const url = new URL(result.url());
        return url.pathname === '/api/snaps' && url.searchParams.get('mode') === mode && url.searchParams.get('source') === source && url.searchParams.get('bust') === '1';
      });
      await rail.getByRole('button', { name: `Refresh ${label} snaps`, exact: true }).click();
      await response;
      await page.waitForFunction(source => document.querySelector(`[data-snap-source="${source}"] .snap-refresh-button`)?.disabled === false, source);
      const sourceReads = reads.filter(read => read.endpoint === '/snaps').slice(beforeSnaps);
      assert.deepEqual(sourceReads, [{ endpoint: '/snaps', mode, source, bust: '1' }]); checks++;
      check(feedReadCount() === beforeFeed, `${label} refresh leaves post feeds untouched`);
    };
    const reloadAllSnaps = async (mode = 'home') => {
      const response = page.waitForResponse(result => {
        const url = new URL(result.url());
        return url.pathname === '/api/snaps' && url.searchParams.get('mode') === mode && !url.searchParams.has('source');
      });
      await page.evaluate(() => window.dispatchEvent(new Event('ufi-connections-changed')));
      await response;
      await page.waitForFunction(() => document.querySelector('.snap-source-row')?.getAttribute('aria-busy') === 'false');
    };
    await refreshSource('UFI', 'uficonnect');

    const populatedRows = [...rows];
    rows = rows.filter(item => item.source !== 'uficonnect');
    await refreshSource('UFI', 'uficonnect');
    await nativeBox.getByText('No UFI snaps yet.', { exact: true }).waitFor();
    assert.deepEqual(await rail.locator('.snap-source-box').evaluateAll(elements => elements.map(element => element.dataset.snapSource)), ['uficonnect', 'facebook', 'twitter']); checks++;
    check(await nativeBox.locator('.snap-thumbnail').count() === 0 && await nativeBox.getByRole('button', { name: 'Post snap', exact: true }).isEnabled(), 'An empty UFI box stays first and permits posting without fabricated snaps');
    check(await rail.getByRole('button', { name: /facebook-fixture/ }).count() === 1 && await rail.getByRole('button', { name: /twitter-fixture/ }).count() === 1, 'An empty UFI refresh preserves other source content');
    rows = populatedRows;
    await refreshSource('UFI', 'uficonnect');

    const originalRows = [...rows];
    const publicClip = (id, source, sourceUrl, extra = {}) => snap(id, source, {
      isExternal: true, mediaType: 'video', mediaKind: 'source', mediaUrl: sourceUrl, sourceUrl, videoDurationSeconds: 42,
      createdAt: new Date(Date.now() - 3 * 86400_000).toISOString(), expiresAt: new Date(Date.now() + 4 * 86400_000).toISOString(), ...extra,
    });
    rows.push(
      publicClip('youtube-short-fixture', 'youtube', 'https://www.youtube.com/shorts/abcdefghijk', { mediaKind: 'youtube', embedId: 'abcdefghijk' }),
      publicClip('mastodon-clip-fixture', 'mastodon', 'https://mastodon.social/@clipper/98765'),
      publicClip('bluesky-clip-fixture', 'bluesky', 'https://bsky.app/profile/clipper.bsky.social/post/abc123'),
      publicClip('reddit-clip-fixture', 'reddit', 'https://www.reddit.com/r/videos/comments/abc123/source_clip/'),
      publicClip('x-clip-fixture', 'twitter', 'https://x.com/clipper/status/98765'),
      publicClip('authorized-file-fixture', 'mastodon', 'https://mastodon.social/@clipper/98766', { mediaKind: 'file', mediaUrl: 'https://media.snaps.invalid/clip.mp4', directPlaybackAuthorized: true }),
      publicClip('authorized-hls-fixture', 'mastodon', 'https://mastodon.social/@clipper/98767', { mediaKind: 'hls', mediaUrl: 'https://media.snaps.invalid/clip.m3u8', directPlaybackAuthorized: true }),
    );
    sourceFailures = { twitch: 'Clip refresh is temporarily unavailable.', twitter: 'X clips could not refresh.' };
    await reloadAllSnaps();
    await rail.getByRole('button', { name: /youtube-short-fixture/ }).waitFor();
    await rail.getByRole('status', { name: 'Snap source availability', exact: true }).getByText('Twitch', { exact: true }).waitFor();
    await rail.getByRole('status', { name: 'Snap source availability', exact: true }).getByText('X (Twitter)', { exact: true }).waitFor();
    check(await rail.locator('.snap-source-box').count() === 7, 'Each populated source has its own box while an unavailable source has no fabricated box');
    check(await rail.locator('[data-snap-source="twitch"]').count() === 0, 'Source failures leave other clips visible');
    check(await rail.getByText(/last 24 hours/i).count() === 0, 'Public source clips are not described as expiring stories');
    const expandedBoxes = await rail.locator('.snap-source-box').evaluateAll(elements => elements.map(element => ({ y: element.getBoundingClientRect().y, background: getComputedStyle(element).backgroundColor })));
    check(expandedBoxes.every(box => box.background === 'rgb(8, 8, 8)' && Math.abs(box.y - expandedBoxes[0].y) < 2), 'All populated source boxes remain black and on one horizontal row');

    const beforeScopedRows = [...rows];
    rows = rows.map(item => item.id === 'twitter-fixture' ? { ...item, caption: 'Updated X snap' }
      : item.id === 'facebook-fixture' ? { ...item, caption: 'Unrequested Facebook update' } : item);
    sourceFailures = { twitch: 'Clip refresh is temporarily unavailable.' };
    await refreshSource('X (Twitter)', 'twitter');
    await rail.getByRole('button', { name: /Updated X snap/ }).waitFor();
    check(await rail.getByRole('button', { name: /twitter-fixture/ }).count() === 0, 'A scoped refresh replaces the chosen source content');
    check(await rail.getByRole('button', { name: /facebook-fixture/ }).count() === 1
      && await rail.getByRole('button', { name: /Unrequested Facebook update/ }).count() === 0
      && await nativeBox.getByRole('button', { name: /native-public/ }).count() === 1, 'Refreshing X preserves UFI and Facebook content even when their server fixtures change');
    const availability = rail.getByRole('status', { name: 'Snap source availability', exact: true });
    check(await availability.getByText('Twitch', { exact: true }).count() === 1
      && await availability.getByText('X (Twitter)', { exact: true }).count() === 0, 'A recovered source clears only its own error and preserves unrelated source errors');
    rows = beforeScopedRows;
    await refreshSource('X (Twitter)', 'twitter');

    for (const [id, expectedHost, expectedPath] of [
      ['youtube-short-fixture', 'www.youtube.com', '/embed/abcdefghijk'],
      ['mastodon-clip-fixture', 'mastodon.social', '/@clipper/98765/embed'],
      ['bluesky-clip-fixture', 'embed.bsky.app', '/embed/clipper.bsky.social/app.bsky.feed.post/abc123'],
      ['reddit-clip-fixture', 'www.redditmedia.com', '/r/videos/comments/abc123/source_clip/'],
    ]) {
      await rail.getByRole('button', { name: new RegExp(id) }).click();
      const sourceViewer = page.locator('dialog.snap-viewer'); await sourceViewer.waitFor();
      const frameUrl = new URL(await sourceViewer.locator('iframe').getAttribute('src'));
      check(frameUrl.hostname === expectedHost && frameUrl.pathname === expectedPath, `${id} opens its fixed official player URL`);
      check(await sourceViewer.locator('video').count() === 0, 'Unapproved external files are not played directly');
      const sourceLabel = await sourceViewer.locator('.snap-viewer-source-details').innerText();
      check(sourceLabel.includes('Recent source clip') && sourceLabel.includes('42s') && !/left|Expired|24 hours/i.test(sourceLabel), 'Source viewer labels show source/date/duration without native expiry claims');
      check(await sourceViewer.locator('.snap-source-mark').count() === 1, 'Source identity is present in the viewer watermark');
      check(await sourceViewer.getByRole('link', { name: /^Open on / }).count() === 1, 'Every source player keeps its original post link');
      await sourceViewer.getByRole('button', { name: 'Close snap', exact: true }).click();
    }
    await rail.getByRole('button', { name: /x-clip-fixture/ }).click();
    const fallbackViewer = page.locator('dialog.snap-viewer'); await fallbackViewer.waitFor();
    check(await fallbackViewer.locator('iframe, video').count() === 0, 'X retains source playback instead of inventing a direct video player');
    check(await fallbackViewer.getByRole('link', { name: /^Watch on / }).getAttribute('href') === 'https://x.com/clipper/status/98765', 'Unsupported inline playback has its exact Watch on source route');
    await fallbackViewer.getByRole('button', { name: 'Close snap', exact: true }).click();
    for (const id of ['authorized-file-fixture', 'authorized-hls-fixture']) {
      await rail.getByRole('button', { name: new RegExp(id) }).click();
      const videoViewer = page.locator('dialog.snap-viewer'); await videoViewer.locator('video').waitFor();
      check(await videoViewer.locator('iframe').count() === 0 && await videoViewer.locator('video').getAttribute('loop') === null, 'Recorded authorization enables non-looping native or HLS playback');
      const selection = await videoViewer.locator('.snap-viewer-caption').innerText();
      await videoViewer.locator('video').evaluate(element => { element.dispatchEvent(new Event('ended')); element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
      check(await videoViewer.locator('.snap-viewer-caption').innerText() === selection, 'Finishing playback or seeking with arrow keys never changes the selected clip');
      await videoViewer.getByRole('button', { name: 'Close snap', exact: true }).click();
    }
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Public source clips and availability notices keep the page within the viewport');
    rows = originalRows; sourceFailures = {};
    await reloadAllSnaps();
    await page.waitForFunction(() => !document.querySelector('.snap-source-notices'));
    check(await rail.locator('.snap-source-box').count() === 3, 'Refreshing clears recovered provider notices and restores current source groups');

    await rail.getByRole('button', { name: /View Snap author's snap: other-native/ }).click();
    let viewer = page.locator('dialog.snap-viewer'); await viewer.waitFor();
    check(await viewer.getByRole('button', { name: 'Previous snap', exact: true }).count() === 1
      && await viewer.getByRole('button', { name: 'Next snap', exact: true }).count() === 1, 'Viewer navigation arrows remain available independently of the source row');
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
    await rail.getByRole('button', { name: 'Refresh UFI snaps', exact: true }).click(); await heldRequest;
    const oldHome = held; held = null;
    await auditNavigate(page, origin + '?feed=following');
    await page.locator('.snap-rail[data-snap-mode="following"]').getByRole('button', { name: /native-public/ }).waitFor();
    await oldHome.route.fulfill({ json: { snaps: [snap('late-home-fixture', 'uficonnect', { caption: 'Wrong old Home response' })], sourceErrors: {} } }).catch(() => {});
    await page.waitForTimeout(150);
    check(await rail.getByRole('button', { name: /Wrong old Home response/ }).count() === 0, 'Late Home responses never replace Following snaps');
    assert.deepEqual(await rail.locator('.snap-source-box').evaluateAll(elements => elements.map(element => element.dataset.snapSource)), ['uficonnect', 'facebook', 'twitter']); checks++;
    const followingSources = page.getByRole('group', { name: 'Following sources', exact: true }); await followingSources.waitFor();
    check((await rail.boundingBox()).y + (await rail.boundingBox()).height <= (await followingSources.boundingBox()).y + 2, 'Following snaps appear above source selection');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/snaps-following-${width}.png`) });

    heldRequest = new Promise(resolve => { heldRequestResolve = resolve; }); holdMode = 'following';
    await rail.getByRole('button', { name: 'Refresh UFI snaps', exact: true }).click(); await heldRequest;
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
    check(await nativeBox.getByRole('link', { name: 'Post snap', exact: true }).getAttribute('href') === '/login', 'Guest posting stays inside the UFI box and routes to sign-in');
    await refreshSource('UFI', 'uficonnect');
    check(await rail.locator('.snap-source-favorite').count() === 0, 'Guests have no invented favorite sources');
    await rail.getByRole('button', { name: /other-native/ }).click();
    viewer = page.locator('dialog.snap-viewer'); await viewer.waitFor();
    check(await viewer.getByRole('button', { name: 'Delete this snap', exact: true }).count() === 0 && await viewer.getByRole('button', { name: 'Report this snap', exact: true }).count() === 0, 'Guest viewer exposes no authenticated content mutations');
    await page.keyboard.press('Escape');
    await page.locator('dialog.snap-viewer').waitFor({ state: 'detached' });
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/snaps-global-${width}.png`) });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'No page overflow after dialogs, routes or account switching');
    assert.deepEqual(errors, []); checks++;
    console.log(`PASS: UFI-first Snap boxes, contained posting, scoped refresh/error isolation, source favorites, Home/Following/UFI placement, signed upload, audience, profile/report/delete, expiry, session isolation and layout at ${width}px`);
    await context.close();
  }
  console.log(`PASS: ${checks} Snap browser checks.`);
} finally { await browser?.close(); await server.close(); await app.close(); }
