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
const avatarUrl = 'https://profiles.snaps.invalid/profile-photo.png';
const brokenAvatarUrl = 'https://profiles.snaps.invalid/missing-photo.png';
const cameraTileName = 'Post snap \u2014 open camera';
for (const [id, name] of [[owner, 'Snap owner'], [author, 'Snap author'], [nextOwner, 'Next member']]) {
  app.seedUser(member(id, { name, avatarUrl, plan: 'pro', roleSettings: { feedSourceFavorites: favorites } }));
}
const photo = await fs.readFile(path.join(root, 'web/public/media/preparation/professional-introduction.png'));
const photoUrl = 'https://res.cloudinary.com/snaps-fixture/image/upload/v1/uficonnect-snaps/audit-photo.png';
const proof = { publicId: `uficonnect-snaps/snap-${owner}-audit`, version: 1, signature: 'a'.repeat(40) };
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5274, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } },
});
let browser, activePage, checks = 0;
const fixtureTime = Date.now();
function check(condition, message) { assert.ok(condition, message); checks++; }
function snap(id, source = 'uficonnect', extra = {}) {
  return { id, source, caption: id, mediaUrl: photoUrl, thumbnailUrl: photoUrl, mediaType: 'image',
    visibility: 'public', createdAt: new Date(fixtureTime - 1000).toISOString(), expiresAt: new Date(fixtureTime + 23 * 3600_000).toISOString(),
    author: { id: author, name: 'Snap author', avatarUrl }, ...extra };
}
await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  const origin = server.resolvedUrls.local[0];
  const widths = [1440, 390, 320].filter(width => !process.env.SNAP_AUDIT_WIDTH || width === Number(process.env.SNAP_AUDIT_WIDTH));
  assert.ok(widths.length, 'SNAP_AUDIT_WIDTH must be 1440, 390 or 320');
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: width < 600, isMobile: width < 600, serviceWorkers: 'block' });
    // Exercise the gallery flow after deterministic camera denial. Camera
    // capture/recording permissions have their own focused browser audit.
    await context.addInitScript(() => {
      window.__snapAuditCameraRequests = 0;
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { window.__snapAuditCameraRequests++; throw new DOMException('Camera denied by fixture', 'NotAllowedError'); };
    });
    const page = await context.newPage(); page.setDefaultTimeout(16000);
    activePage = page;
    // A cold Vite dependency scan may outlast the interaction deadline on
    // Windows. Keep assertions bounded while allowing initial page loading.
    page.setDefaultNavigationTimeout(60000);
    const errors = [], writes = [], reads = [], imageRequests = [];
    let viewerId = owner, uploadCount = 0, uploadedForm = '', held = null, holdMode = null, sourceFailures = {}, recoverImage = false;
    let heldRequestResolve;
    let heldRequest = new Promise(resolve => { heldRequestResolve = resolve; });
    // Three source rows exercise grouping/ranking only. The audit does not
    // claim that these synthetic providers expose Stories to UFIConnect.
    let rows = [
      snap('native-public', 'uficonnect', { owned: true, author: { id: owner, name: 'Snap owner', avatarUrl }, createdAt: new Date().toISOString() }),
      snap('native-private', 'uficonnect', { visibility: 'followers', owned: true, caption: 'Private first account snap', author: { id: owner, name: 'Snap owner', avatarUrl } }),
      snap('other-native', 'uficonnect'),
      snap('facebook-fixture', 'facebook', { author: { id: 'facebook-author', name: 'Facebook fixture', avatarUrl, profileUrl: 'https://www.facebook.com/example' }, sourceUrl: 'https://www.facebook.com/stories/example' }),
      snap('facebook-fixture-older', 'facebook', { caption: 'Second moment from the same author', author: { id: 'facebook-author', name: 'Facebook fixture', avatarUrl, profileUrl: 'https://www.facebook.com/example' }, sourceUrl: 'https://www.facebook.com/stories/example/older', createdAt: new Date(fixtureTime - 2000).toISOString() }),
      ...Array.from({ length: 9 }, (_, index) => snap(`facebook-profile-${index}`, 'facebook', {
        author: { id: `facebook-profile-${index}`, name: `Community profile ${index + 1}`, ...(index !== 8 ? { avatarUrl } : {}) },
      })),
      snap('twitter-fixture', 'twitter', { author: { id: 'twitter-author', name: 'X fixture', avatarUrl: brokenAvatarUrl, profileUrl: 'https://x.com/example' }, sourceUrl: 'https://x.com/example/status/123' }),
      snap('expired-fixture', 'instagram', { caption: 'Expired fixture', expiresAt: new Date(Date.now() - 1000).toISOString() }),
    ];
    const visibleRows = (mode, source) => rows.filter(item => (mode !== 'ufi' || item.source === 'uficonnect')
      && (!source || item.source === source)
      && (item.visibility !== 'followers' || item.author.id === viewerId));
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const headers = { 'Access-Control-Allow-Origin': new URL(origin).origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*' };
      if (url.hostname === 'profiles.snaps.invalid') {
        imageRequests.push(url.href);
        return url.href === avatarUrl || url.href === brokenAvatarUrl && recoverImage
          ? route.fulfill({ body: photo, contentType: 'image/png' }) : route.fulfill({ status: 404, body: 'Missing fixture' });
      }
      if (url.hostname === 'res.cloudinary.com') { imageRequests.push(url.href); return route.fulfill({ body: photo, contentType: 'image/png' }); }
      if (url.hostname === 'api.cloudinary.com') {
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        uploadCount++; uploadedForm = request.postData() || '';
        return route.fulfill({ headers, json: { secure_url: photoUrl, resource_type: 'image', public_id: proof.publicId, version: proof.version, signature: proof.signature } });
      }
      if (['www.youtube.com', 'mastodon.social', 'embed.bsky.app', 'www.redditmedia.com', 'clips.twitch.tv'].includes(url.hostname) && request.resourceType() === 'document') {
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
        const item = snap('posted-native', 'uficonnect', { ...body, owned: true, author: { id: viewerId, name: 'Snap owner', avatarUrl }, createdAt: new Date().toISOString() });
        rows.unshift(item); return fulfill({ snap: item });
      }
      // These synthetic Snap/member IDs are browser fixtures. Their real API
      // audience and UUID authorization are covered by the backend suite;
      // do not send fixture engagement reads to those authenticated routes.
      if (/^\/snaps\/[^/]+\/engagement$/.test(endpoint) && method === 'GET') {
        return fulfill({ likesCount: 0, commentsCount: 0, likedByMe: false });
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
    const profileForSnap = id => {
      assert.match(id, /^[a-z0-9-]+$/);
      return rail.locator(`.snap-profile-button[data-snap-ids*='"${id}"']`);
    };
    const settleCube = () => page.waitForFunction(() => !document.querySelector('.snap-viewer-cube-outgoing'));
    const closeViewer = async () => { await page.locator('dialog.snap-viewer').getByRole('button', { name: 'Close snap', exact: true }).click(); };
    const openSnap = async (id, caption = rows.find(item => item.id === id)?.caption) => {
      const profileButton = profileForSnap(id);
      await profileButton.waitFor();
      const ids = JSON.parse(await profileButton.getAttribute('data-snap-ids'));
      check(ids.includes(id) && new Set(ids).size === ids.length, 'A profile button identifies its real, unique snaps');
      await profileButton.click();
      const viewer = page.locator('dialog.snap-viewer'); await viewer.waitFor();
      for (let position = 0; position < ids.indexOf(id); position++) {
        const previousCaption = await viewer.locator('.snap-viewer-caption').innerText();
        await viewer.getByRole('region', { name: 'Snap media', exact: true }).focus();
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(previous => document.querySelector('.snap-viewer-caption')?.textContent !== previous, previousCaption);
      }
      await page.waitForFunction(expected => document.querySelector('.snap-viewer-caption')?.textContent === expected, caption);
      await settleCube();
      return viewer;
    };
    const themedCards = async locator => locator.evaluateAll(elements => elements.every(element => {
      const probe = document.createElement('span'); probe.style.backgroundColor = 'var(--card)'; element.append(probe);
      const expected = getComputedStyle(probe).backgroundColor; probe.remove();
      return getComputedStyle(element).backgroundColor === expected;
    }));
    await profileForSnap('facebook-fixture').waitFor();
    check((await rail.getAttribute('data-snap-mode')) === 'home', 'Home reads its own Snap mode');
    await page.waitForFunction(() => { const image = document.querySelector('.snap-profile-avatar img'); return image?.complete && image.naturalWidth > 0; });
    check(await profileForSnap('facebook-fixture').locator('img').getAttribute('src') === avatarUrl, 'Snap profile tiles use the author photo instead of the snap image');
    check(!imageRequests.includes(photoUrl), 'The rail does not request snap media or thumbnails before a viewer opens');
    check(await rail.locator('.snap-thumbnail').count() === 0, 'Rectangular snap thumbnails are removed');
    await profileForSnap('twitter-fixture').scrollIntoViewIfNeeded();
    await profileForSnap('twitter-fixture').locator('.snap-profile-avatar img[data-snap-avatar="default"]').waitFor();
    check(await profileForSnap('twitter-fixture').locator('img').count() === 1 && await profileForSnap('twitter-fixture').locator('.snap-profile-avatar b').count() === 0, 'Broken author photos use a local profile image instead of initials or snap artwork');
    await profileForSnap('facebook-profile-8').scrollIntoViewIfNeeded();
    check(await profileForSnap('facebook-profile-8').locator('img[data-snap-avatar="default"]').count() === 1, 'An author without a photo has a local profile image instead of media artwork');
    const facebookProfiles = rail.locator('[data-snap-source="facebook"] .snap-source-items');
    check(await facebookProfiles.getAttribute('aria-label') === 'Facebook snap profiles' && await facebookProfiles.locator(':scope > li.snap-profile-item').count() === 10, 'Snaps form a semantic profile list with one tile per distinct author');
    const facebookIds = JSON.parse(await profileForSnap('facebook-fixture').getAttribute('data-snap-ids'));
    assert.deepEqual(facebookIds, ['facebook-fixture', 'facebook-fixture-older']); checks++;
    check(await profileForSnap('facebook-fixture').getAttribute('aria-label') === "View Facebook fixture's 2 snaps"
      && await profileForSnap('facebook-fixture').locator('.snap-profile-count').innerText() === '2', 'Same-author snaps share one tile with their actual snap count');
    const profilePositions = await facebookProfiles.locator('.snap-profile-button').evaluateAll(elements => elements.map(element => ({ x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y })));
    check(new Set(profilePositions.map(position => Math.round(position.x))).size === 3
      && new Set(profilePositions.map(position => Math.round(position.y))).size === 4, 'Ten author tiles form three columns with more rows below');
    check(await facebookProfiles.evaluate(element => element.scrollHeight > element.clientHeight && element.scrollWidth <= element.clientWidth
      && element.clientHeight <= 182), 'Only two compact profile rows fit in Home source boxes and extra rows scroll vertically');
    await facebookProfiles.evaluate(element => { element.scrollTop = 0; });
    await facebookProfiles.hover(); await page.mouse.wheel(0, 150);
    await page.waitForFunction(() => document.querySelector('[data-snap-source="facebook"] .snap-source-items')?.scrollTop > 0);
    await page.waitForFunction(() => {
      const element = document.querySelector('.snap-profile-button[data-snap-ids*="facebook-profile-8"]');
      const bounds = element?.getBoundingClientRect(), parent = element?.closest('.snap-source-items').getBoundingClientRect();
      return bounds && parent && bounds.y >= parent.y && bounds.bottom <= parent.bottom;
    });
    check(await profileForSnap('facebook-profile-8').evaluate(element => {
      const bounds = element.getBoundingClientRect(), parent = element.closest('.snap-source-items').getBoundingClientRect();
      return bounds.y >= parent.y && bounds.bottom <= parent.bottom;
    }), 'Scrolling down reveals the last profile without opening a snap or scrolling sideways');
    check(await rail.locator('.snap-profile-button').evaluateAll(elements => elements.every(element => element.querySelectorAll('.snap-profile-avatar img').length === 1)), 'Every author tile contains a profile image');
    check(await rail.locator('.snap-profile-ring, .snap-profile-avatar').evaluateAll(elements => elements.every(element => {
      const bounds = element.getBoundingClientRect(), radius = Number.parseFloat(getComputedStyle(element).borderRadius);
      return bounds.width <= 54 && Math.abs(bounds.width - bounds.height) < 2 && radius > 0 && radius < bounds.width / 2;
    })), 'Compact profile frames and photos are square with rounded corners and at most 54 pixels wide');
    await openSnap('facebook-fixture-older');
    check(await page.locator('dialog.snap-viewer').getByRole('link', { name: 'Facebook fixture', exact: true }).getAttribute('href') === 'https://www.facebook.com/example', 'Grouped snaps retain their actual posting profile');
    await closeViewer();
    assert.deepEqual(await rail.locator('.snap-source-box').evaluateAll(elements => elements.map(element => element.dataset.snapSource)), ['facebook', 'twitter']); checks++;
    const nativeBox = rail.locator('[data-snap-source="uficonnect"]');
    check(await nativeBox.count() === 0 && await rail.getByRole('button', { name: cameraTileName, exact: true }).count() === 0
      && await profileForSnap('native-public').count() === 0 && await profileForSnap('native-private').count() === 0 && await profileForSnap('other-native').count() === 0, 'Home excludes native snaps and native posting, including rows from a stale response');
    check(await rail.getByRole('heading', { name: 'Snaps', exact: true }).count() === 0
      && await rail.locator('.snap-rail-heading, .snap-rail-description').count() === 0, 'The rail has no visible Snaps title or subtitle');
    check(await rail.getByRole('button', { name: /previous|next|scroll|earlier|later/i }).count() === 0, 'The source row has no navigation arrows');
    check(await profileForSnap('expired-fixture').count() === 0, 'Expired snaps are removed before rendering');
    const cardBoxes = await rail.locator('.snap-source-box').evaluateAll(elements => elements.map(element => ({ x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y, background: getComputedStyle(element).backgroundColor })));
    check(await themedCards(rail.locator('.snap-source-box')), 'Source boxes use the current page card theme');
    check(cardBoxes[1].x > cardBoxes[0].x && Math.abs(cardBoxes[1].y - cardBoxes[0].y) < 2, 'Themed source boxes stay next to each other horizontally at every width');
    const sources = page.getByRole('group', { name: 'Home sources', exact: true }); await sources.waitFor();
    check((await rail.boundingBox()).y + (await rail.boundingBox()).height <= (await sources.boundingBox()).y + 2, 'Snaps appear above Home source selection');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Home has no page overflow');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/snaps-home-${width}.png`) });

    const feedReadCount = () => reads.filter(read => read.endpoint !== '/snaps').length;
    const refreshSource = async (label, source, mode) => {
      mode ||= await rail.getAttribute('data-snap-mode');
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
    const reloadAllSnaps = async (mode) => {
      mode ||= await rail.getAttribute('data-snap-mode');
      const response = page.waitForResponse(result => {
        const url = new URL(result.url());
        return url.pathname === '/api/snaps' && url.searchParams.get('mode') === mode && !url.searchParams.has('source');
      });
      await page.evaluate(() => window.dispatchEvent(new Event('ufi-connections-changed')));
      await response;
      await page.waitForFunction(() => document.querySelector('.snap-source-row')?.getAttribute('aria-busy') === 'false');
    };
    const failedPhotoRequests = imageRequests.filter(url => url === brokenAvatarUrl).length;
    recoverImage = true;
    await refreshSource('X (Twitter)', 'twitter');
    await profileForSnap('twitter-fixture').scrollIntoViewIfNeeded();
    await page.waitForFunction(expected => {
      const image = document.querySelector('.snap-profile-button[data-snap-id="twitter-fixture"] img');
      return image?.dataset.snapAvatar === 'profile' && image.src === expected && image.complete && image.naturalWidth > 0;
    }, brokenAvatarUrl);
    check(imageRequests.filter(url => url === brokenAvatarUrl).length === failedPhotoRequests + 1, 'Explicit source refresh retries the same failed author photo once and renders its recovered image');
    check(await nativeBox.count() === 0, 'Refreshing a Home source never adds the UFI box');
    await auditNavigate(page, origin + '?feed=following');
    await profileForSnap('native-public').waitFor();
    check(await nativeBox.getByRole('button', { name: cameraTileName, exact: true }).count() === 1
      && await rail.getByRole('button', { name: cameraTileName, exact: true }).count() === 1, 'Following retains one camera tile only inside its UFI section');
    check(await nativeBox.evaluate(element => getComputedStyle(element).backgroundColor === 'rgba(0, 0, 0, 0)'
      && getComputedStyle(element).borderTopColor === 'rgba(0, 0, 0, 0)'), 'The native UFI section blends into the page without a separate box');
    check(await nativeBox.locator('.snap-source-items').evaluate(element => {
      const tiles = [...element.querySelectorAll('.snap-profile-button')];
      const top = tiles[0]?.getBoundingClientRect().top;
      return tiles[0]?.classList.contains('snap-create-button') && tiles.every(tile => Math.abs(tile.getBoundingClientRect().top - top) < 2)
        && element.scrollHeight <= element.clientHeight + 2;
    }), 'Following keeps the camera first and all UFI profile tiles on one horizontal row');
    await refreshSource('UFI', 'uficonnect');

    const populatedRows = [...rows];
    rows = rows.filter(item => item.source !== 'uficonnect');
    await refreshSource('UFI', 'uficonnect');
    await nativeBox.getByText('Share your first moment.', { exact: true }).waitFor();
    assert.deepEqual(await rail.locator('.snap-source-box').evaluateAll(elements => elements.map(element => element.dataset.snapSource)), ['uficonnect', 'facebook', 'twitter']); checks++;
    check(await nativeBox.locator('.snap-profile-button:not(.snap-create-button)').count() === 0 && await nativeBox.getByRole('button', { name: cameraTileName, exact: true }).isEnabled(), 'An empty UFI section stays first with an enabled camera tile and no fabricated snaps');
    check(await profileForSnap('facebook-fixture').count() === 1 && await profileForSnap('twitter-fixture').count() === 1, 'An empty UFI refresh preserves other source content');
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
    await profileForSnap('youtube-short-fixture').waitFor();
    await rail.getByRole('status', { name: 'Snap source availability', exact: true }).getByText('Twitch', { exact: true }).waitFor();
    await rail.getByRole('status', { name: 'Snap source availability', exact: true }).getByText('X (Twitter)', { exact: true }).waitFor();
    check(await rail.locator('.snap-source-box').count() === 7, 'Each populated source has its own box while an unavailable source has no fabricated box');
    check(await rail.locator('[data-snap-source="twitch"]').count() === 0, 'Source failures leave other clips visible');
    check(await rail.getByText(/last 24 hours/i).count() === 0, 'Public source clips are not described as expiring stories');
    const expandedBoxes = await rail.locator('.snap-source-box').evaluateAll(elements => elements.map(element => ({ y: element.getBoundingClientRect().y })));
    check(expandedBoxes.every(box => Math.abs(box.y - expandedBoxes[0].y) < 2), 'Additional source sections stay on the horizontal rail');

    const beforeScopedRows = [...rows];
    rows = rows.map(item => item.id === 'twitter-fixture' ? { ...item, caption: 'Updated X snap' }
      : item.id === 'facebook-fixture' ? { ...item, caption: 'Unrequested Facebook update' } : item);
    sourceFailures = { twitch: 'Clip refresh is temporarily unavailable.' };
    await refreshSource('X (Twitter)', 'twitter');
    await openSnap('twitter-fixture', 'Updated X snap');
    check(await page.locator('.snap-viewer-caption').innerText() === 'Updated X snap', 'A scoped refresh replaces the chosen source content');
    await closeViewer();
    await openSnap('facebook-fixture', 'facebook-fixture');
    check(await page.locator('.snap-viewer-caption').innerText() === 'facebook-fixture'
      && await profileForSnap('native-public').count() === 1, 'Refreshing X preserves UFI and Facebook content even when their server fixtures change');
    await closeViewer();
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
      await openSnap(id);
      const sourceViewer = page.locator('dialog.snap-viewer'); await sourceViewer.waitFor();
      const frameUrl = new URL(await sourceViewer.locator('iframe').getAttribute('src'));
      check(frameUrl.hostname === expectedHost && frameUrl.pathname === expectedPath, `${id} opens its fixed official player URL`);
      check(await sourceViewer.locator('video').count() === 0, 'Unapproved external files are not played directly');
      const sourceLabel = await sourceViewer.locator('.snap-viewer-source-details').innerText();
      check(sourceLabel.includes('Recent source clip') && sourceLabel.includes('42s') && !/left|Expired|24 hours/i.test(sourceLabel), 'Source viewer labels show source/date/duration without native expiry claims');
      check(await sourceViewer.locator('.snap-source-mark').count() === 1, 'Source identity is present in the viewer watermark');
      const originalLink = sourceViewer.locator('a.post-chrome-source-link');
      check(await originalLink.count() === 1
        && await originalLink.getAttribute('href') === rows.find(item => item.id === id).sourceUrl
        && Boolean(await originalLink.getAttribute('aria-label')), 'Every source player keeps its exact original post link and accessible label');
      await sourceViewer.getByRole('button', { name: 'Close snap', exact: true }).click();
    }
    await openSnap('x-clip-fixture');
    const fallbackViewer = page.locator('dialog.snap-viewer'); await fallbackViewer.waitFor();
    check(await fallbackViewer.locator('iframe, video').count() === 0, 'X retains source playback instead of inventing a direct video player');
    check(await fallbackViewer.locator('a.post-chrome-source-link').getAttribute('href') === 'https://x.com/clipper/status/98765', 'Unsupported inline playback retains its exact source route');
    await fallbackViewer.getByRole('button', { name: 'Close snap', exact: true }).click();
    for (const id of ['authorized-file-fixture', 'authorized-hls-fixture']) {
      await openSnap(id);
      const videoViewer = page.locator('dialog.snap-viewer'); await videoViewer.locator('video').waitFor();
      check(await videoViewer.locator('iframe').count() === 0 && await videoViewer.locator('video').getAttribute('loop') === null, 'Recorded authorization enables non-looping native or HLS playback');
      const selection = await videoViewer.locator('.snap-viewer-caption').innerText();
      await videoViewer.locator('video').evaluate(element => {
        element.dispatchEvent(new Event('ended'));
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        element.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
        element.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', pointerId: 5, button: 0, clientX: 200, clientY: 100, bubbles: true }));
        element.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse', pointerId: 5, button: 0, clientX: 60, clientY: 100, bubbles: true }));
      });
      check(await videoViewer.locator('.snap-viewer-caption').innerText() === selection, 'Playback, seeking, vertical scrolling and mouse drags on native video controls never change the clip');
      await videoViewer.getByRole('button', { name: 'Close snap', exact: true }).click();
    }
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Public source clips and availability notices keep the page within the viewport');
    rows = originalRows; sourceFailures = {};
    await reloadAllSnaps();
    await page.waitForFunction(() => !document.querySelector('.snap-source-notices'));
    check(await rail.locator('.snap-source-box').count() === 3, 'Refreshing clears recovered provider notices and restores current source groups');

    await openSnap('twitter-fixture');
    const connectedViewer = page.locator('dialog.snap-viewer');
    const swipeConnected = async direction => {
      await connectedViewer.locator('.snap-viewer-topbar').evaluate((element, direction) => {
        const bounds = element.getBoundingClientRect(), x = bounds.x + 80, y = bounds.y + 20;
        const makeTouch = clientX => new Touch({ identifier: 55, target: element, clientX, clientY: y });
        element.dispatchEvent(new TouchEvent('touchstart', { touches: [makeTouch(x)], bubbles: true }));
        element.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [makeTouch(x - direction * 65)], bubbles: true }));
      }, direction);
    };
    await swipeConnected(1);
    await page.waitForFunction(() => document.querySelector('.snap-viewer-caption')?.textContent === 'native-public');
    check(await connectedViewer.locator('.snap-viewer-cube').getAttribute('data-cube-direction') === 'forward', 'Left swipe connects the last source to the first available profile with the correct cube direction');
    await settleCube();
    await swipeConnected(-1);
    await page.waitForFunction(() => document.querySelector('.snap-viewer-caption')?.textContent === 'twitter-fixture');
    check(await connectedViewer.locator('.snap-viewer-cube').getAttribute('data-cube-direction') === 'backward', 'Right swipe connects the first profile back to the last source');
    await settleCube(); await closeViewer();

    await openSnap('other-native');
    let viewer = page.locator('dialog.snap-viewer'); await viewer.waitFor();
    check(await viewer.locator('.snap-viewer-details footer').count() === 0
      && await viewer.getByRole('group', { name: 'Snap navigation', exact: true }).getByRole('button', { name: 'Previous snap', exact: true }).isEnabled()
      && await viewer.getByRole('group', { name: 'Snap navigation', exact: true }).getByRole('button', { name: 'Next snap', exact: true }).isEnabled(), 'Accessible previous/next navigation stays in the top bar without a duplicate bottom toolbar');
    await page.waitForFunction(() => { const image = document.querySelector('.snap-viewer-media img'); return image?.complete && image.naturalWidth > 0; });
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/snaps-viewer-${width}.png`) });
    check(await viewer.getByRole('link', { name: 'Snap author', exact: true }).getAttribute('href') === `/u/${author}`, 'Snap author routes to the posting profile');
    const viewerBounds = await viewer.boundingBox();
    check(Math.abs(viewerBounds.width - width) < 2 && Math.abs(viewerBounds.height - 1000) < 2
      && await viewer.locator('.post-chrome-avatar img').getAttribute('src') === avatarUrl
      && await viewer.locator('.snap-social-meta[datetime]').count() === 1, 'Viewing fills the screen like Videos and Music, with the author profile and original time');
    const mediaStage = viewer.getByRole('region', { name: 'Snap media', exact: true });
    await mediaStage.focus();
    await page.keyboard.press('ArrowRight');
    check(await viewer.locator('.snap-viewer-caption').innerText() !== 'other-native', 'ArrowRight advances from the full-screen media stage');
    check(await viewer.locator('.snap-viewer-cube').getAttribute('data-cube-direction') === 'forward'
      && await viewer.locator('.snap-viewer-cube-outgoing[aria-hidden="true"][inert]').count() === 1
      && await viewer.locator('.snap-viewer-cube-outgoing video, .snap-viewer-cube-outgoing iframe').count() === 0
      && await viewer.evaluate(element => getComputedStyle(element).perspective !== 'none')
      && await viewer.locator('.snap-viewer-cube-current .snap-viewer-details').count() === 1
      && await viewer.locator('.snap-viewer-cube-current .snap-viewer-topbar').count() === 1
      && await viewer.locator(':scope > .snap-viewer-close').count() === 1
      && await viewer.getByRole('button', { name: 'Close snap', exact: true }).isEnabled()
      && await viewer.locator('.snap-viewer-cube').evaluate(element => element.clientWidth === innerWidth && element.clientHeight === innerHeight && getComputedStyle(element).transformStyle === 'preserve-3d' && element.getAnimations().length > 0), 'Snap navigation turns the whole screen including its profile and actions as two cube faces without a second live player');
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/snaps-cube-${width}.png`) });
    await settleCube();
    await page.keyboard.press('ArrowLeft');
    check(await viewer.locator('.snap-viewer-caption').innerText() === 'other-native', 'ArrowLeft restores the previous snap');
    await settleCube();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp');
    check(await viewer.locator('.snap-viewer-caption').innerText() === 'other-native', 'Vertical arrow keys do not navigate horizontally arranged snaps');
    await mediaStage.hover(); await page.mouse.wheel(120, 0);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    check(await viewer.locator('.snap-viewer-caption').innerText() === 'other-native', 'Horizontal trackpad scrolling does not navigate snaps');
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(() => {
      const caption = document.querySelector('.snap-viewer-caption'); return caption && caption.textContent !== 'other-native';
    });
    check(await viewer.locator('.snap-viewer-caption').innerText() !== 'other-native', 'Vertical wheel and trackpad scrolling advances one snap');
    const horizontalCaption = await viewer.locator('.snap-viewer-caption').innerText();
    await mediaStage.dispatchEvent('wheel', { deltaY: 120, deltaX: 0, bubbles: true, cancelable: true });
    check(await viewer.locator('.snap-viewer-caption').innerText() === horizontalCaption, 'A trackpad burst does not skip through multiple snaps');
    await settleCube();
    await mediaStage.dispatchEvent('wheel', { deltaY: -120, deltaX: 0, bubbles: true, cancelable: true });
    await page.waitForFunction(() => document.querySelector('.snap-viewer-caption')?.textContent === 'other-native');
    check(await viewer.locator('.snap-viewer-caption').innerText() === 'other-native', 'Scrolling up restores the previous snap');
    await settleCube();
    await mediaStage.dispatchEvent('wheel', { deltaY: 120, deltaX: 40, bubbles: true });
    await page.waitForFunction(() => {
      const caption = document.querySelector('.snap-viewer-caption'); return caption && caption.textContent !== 'other-native';
    });
    check(await viewer.locator('.snap-viewer-caption').innerText() !== 'other-native', 'Dominant vertical scrolling supports diagonal trackpad input');
    await mediaStage.focus(); await page.keyboard.press('ArrowLeft');
    await settleCube();
    await viewer.locator('.snap-viewer-details').dispatchEvent('wheel', { deltaY: 120, bubbles: true });
    await viewer.locator('.snap-viewer-details').dispatchEvent('wheel', { deltaX: 120, bubbles: true });
    check(await viewer.locator('.snap-viewer-caption').innerText() === 'other-native', 'Scrolling profile details on either axis does not change the snap');
    if (width < 600) {
      await page.waitForTimeout(550);
      await mediaStage.evaluate(element => {
        const bounds = element.getBoundingClientRect(), x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
        const touch = clientY => new Touch({ identifier: 1, target: element, clientX: x, clientY });
        element.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(y + 60)], bubbles: true }));
        element.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch(y - 60)], bubbles: true }));
      });
      check(await viewer.locator('.snap-viewer-caption').innerText() === 'other-native', 'A vertical phone swipe does not advance snaps');
      await mediaStage.evaluate(element => {
        const bounds = element.getBoundingClientRect(), x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
        const touch = clientX => new Touch({ identifier: 2, target: element, clientX, clientY: y });
        element.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(x + 60)], bubbles: true }));
        element.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch(x - 60)], bubbles: true }));
      });
      check(await viewer.locator('.snap-viewer-caption').innerText() !== 'other-native', 'Swiping left advances the full-screen snap on phones');
      await settleCube();
      if (await viewer.getByRole('button', { name: 'Snap details', exact: true }).getAttribute('aria-expanded') !== 'true') {
        await viewer.getByRole('button', { name: 'Snap details', exact: true }).click();
      }
      await viewer.locator('.snap-viewer-caption').evaluate(element => {
        const bounds = element.getBoundingClientRect(), x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
        const touch = clientX => new Touch({ identifier: 3, target: element, clientX, clientY: y });
        element.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(x - 60)], bubbles: true }));
        element.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch(x + 60)], bubbles: true }));
      });
      check(await viewer.locator('.snap-viewer-caption').innerText() === 'other-native', 'Swiping right over the caption restores the previous snap on phones');
      await settleCube();
    } else {
      const bounds = await mediaStage.boundingBox(), x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
      await page.mouse.move(x + 80, y); await page.mouse.down(); await page.mouse.move(x - 80, y, { steps: 5 }); await page.mouse.up();
      check(await viewer.locator('.snap-viewer-caption').innerText() !== 'other-native', 'Dragging the media stage left advances a desktop snap');
      await settleCube();
      await page.mouse.move(x - 80, y); await page.mouse.down(); await page.mouse.move(x + 80, y, { steps: 5 }); await page.mouse.up();
      check(await viewer.locator('.snap-viewer-caption').innerText() === 'other-native', 'Dragging the media stage right restores the previous desktop snap');
      await settleCube();
    }
    await viewer.getByRole('button', { name: 'Snap options', exact: true }).click();
    check(await viewer.getByRole('group', { name: 'Snap options', exact: true }).getByRole('button', { name: 'Previous snap', exact: true }).count() === 0, 'Snap settings contain no previous-snap command');
    const optionsBounds = await viewer.getByRole('group', { name: 'Snap options', exact: true }).boundingBox();
    check(optionsBounds.x >= 0 && optionsBounds.x + optionsBounds.width <= width + 2, 'The Videos-style snap options menu stays inside the viewport');
    check(await viewer.getByRole('group', { name: 'Snap options', exact: true }).getByRole('slider').count() === 0
      && await viewer.getByText('Snap position', { exact: true }).count() === 0, 'Snap position sliders and labels are removed from the options');
    await page.keyboard.press('ArrowRight');
    check(await viewer.locator('.snap-viewer-caption').innerText() === 'other-native', 'Arrow keys inside the options menu do not navigate snaps');
    await page.keyboard.press('Escape');
    check(await viewer.getByRole('group', { name: 'Snap options', exact: true }).count() === 0
      && await viewer.count() === 1, 'Escape closes snap options while keeping the viewer open');
    await viewer.getByRole('button', { name: 'Snap options', exact: true }).click();
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
    await openSnap('other-native');
    await page.locator('dialog.snap-viewer').getByRole('link', { name: 'Snap author', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/u/${author}`);
    await auditNavigate(page, origin + '?feed=following');
    await profileForSnap('native-public').waitFor();

    await rail.getByRole('button', { name: cameraTileName, exact: true }).click();
    const composer = page.getByRole('dialog', { name: 'Post a snap', exact: true }); await composer.waitFor();
    await page.getByRole('heading', { name: 'Allow camera access?', exact: true }).waitFor();
    check(await page.evaluate(() => window.__snapAuditCameraRequests) === 0, 'The account camera choice is requested before browser device access');
    await page.getByRole('button', { name: 'Allow camera', exact: true }).click();
    check(await themedCards(composer) && await composer.locator('.snap-composer-owner .post-chrome-name').innerText() === 'Snap owner'
      && await composer.locator('.snap-composer-owner .post-chrome-avatar img').getAttribute('src') === avatarUrl, 'Posting uses the social card theme and the signed-in profile');
    await composer.getByRole('alert').waitFor();
    check(uploadCount === 0, 'Opening a denied camera does not upload media');
    const galleryChooser = page.waitForEvent('filechooser');
    await composer.getByRole('button', { name: 'Gallery', exact: true }).click();
    await page.getByRole('heading', { name: 'Allow photos and videos?', exact: true }).waitFor();
    check(uploadCount === 0, 'The account photo choice is requested before gallery selection or upload');
    await page.getByRole('button', { name: 'Choose photos', exact: true }).click();
    await (await galleryChooser).setFiles({ name: 'snap-photo.png', mimeType: 'image/png', buffer: photo });
    await composer.getByLabel('Description (optional)').fill('Fresh photo snap');
    await composer.getByRole('button', { name: 'Vivid', exact: true }).click();
    await composer.getByLabel('Text on your snap', { exact: true }).fill('Fresh moment');
    await composer.getByRole('radio', { name: /Followers/ }).check();
    check((await composer.locator('.snap-composer-owner').innerText()).includes('Followers'), 'Posting identity reflects the selected audience');
    await composer.getByRole('button', { name: 'Post snap', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('dialog.snap-composer button[type="submit"]')?.disabled);
    check(uploadCount === 0 && writes.filter(write => write.endpoint === '/snaps' && write.method === 'POST').length === 0,
      'Selecting and editing a gallery draft keeps media local until Post snap');
    check(await composer.locator('.snap-text-overlay').innerText() === 'Fresh moment'
      && await composer.locator('img[alt="Your snap preview"]').evaluate(element => getComputedStyle(element).filter.includes('saturate')),
      'The draft preview displays its selected filter and overlay text');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/snaps-composer-${width}.png`) });
    await composer.getByRole('button', { name: 'Post snap', exact: true }).click();
    await profileForSnap('posted-native').waitFor();
    const published = writes.find(write => write.endpoint === '/snaps' && write.method === 'POST');
    assert.deepEqual(published.body, { mediaUrl: photoUrl, mediaType: 'image', caption: 'Fresh photo snap', visibility: 'followers', upload: proof, filter: 'vivid', overlayText: 'Fresh moment' }); checks++;
    check(uploadCount === 1 && uploadedForm.includes('name="public_id"') && uploadedForm.includes(proof.publicId.split('/').at(-1)), 'Signed upload identity reaches Cloudinary before publication');
    await openSnap('posted-native');
    viewer = page.locator('dialog.snap-viewer');
    check(await viewer.locator('.snap-text-overlay').innerText() === 'Fresh moment', 'Published native Snaps retain their saved text overlay');
    await viewer.getByRole('button', { name: 'Snap details', exact: true }).click();
    await viewer.getByText('Followers only', { exact: true }).waitFor();
    await viewer.getByRole('button', { name: 'Snap options', exact: true }).click();
    await viewer.getByRole('button', { name: 'Delete this snap', exact: true }).click();
    check(writes.filter(write => write.method === 'DELETE').length === 0, 'Deleting requires a second deliberate action');
    await viewer.getByRole('button', { name: 'Delete snap', exact: true }).click();
    await page.locator('dialog.snap-viewer').waitFor({ state: 'detached' });
    check(await profileForSnap('posted-native').count() === 0 && await profileForSnap('native-public').count() === 1
      && writes.filter(write => write.method === 'DELETE').length === 1, 'Owner deletion removes only that snap and preserves the profile tile with remaining snaps');

    await auditNavigate(page, origin + '?feed=ufi');
    await page.locator('.snap-rail[data-snap-mode="ufi"]').waitFor();
    await profileForSnap('native-public').waitFor();
    assert.deepEqual(await rail.locator('.snap-source-box').evaluateAll(elements => elements.map(element => element.dataset.snapSource)), ['uficonnect']); checks++;
    check((await rail.boundingBox()).y + (await rail.boundingBox()).height <= (await page.locator('.ufi-feed-toolbar').boundingBox()).y + 2, 'UFI snaps appear above its posting/topic toolbar');
    const beforeHorizontalRows = rows;
    rows = [...rows, ...Array.from({ length: 12 }, (_, index) => snap(`ufi-horizontal-${index}`, 'uficonnect', {
      author: { id: `ufi-horizontal-author-${index}`, name: `Horizontal member ${index + 1}`, avatarUrl },
    }))];
    await refreshSource('UFI', 'uficonnect');
    const nativeProfiles = nativeBox.locator('.snap-source-items');
    check(await nativeProfiles.evaluate(element => {
      const tiles = [...element.querySelectorAll('.snap-profile-button')], top = tiles[0].getBoundingClientRect().top;
      return tiles[0].classList.contains('snap-create-button') && tiles.every(tile => Math.abs(tile.getBoundingClientRect().top - top) < 2)
        && element.scrollWidth > element.clientWidth && element.scrollHeight <= element.clientHeight + 2;
    }), 'A crowded UFI rail stays on one horizontal row and scrolls sideways without wrapping');
    await profileForSnap('ufi-horizontal-11').scrollIntoViewIfNeeded();
    check(await profileForSnap('ufi-horizontal-11').evaluate(element => {
      const tile = element.getBoundingClientRect(), list = element.closest('.snap-source-items').getBoundingClientRect();
      return tile.left >= list.left - 2 && tile.right <= list.right + 2;
    }) && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'The last UFI tile is reachable horizontally without widening the page');
    rows = beforeHorizontalRows;
    await refreshSource('UFI', 'uficonnect');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/snaps-ufi-${width}.png`) });
    await auditNavigate(page, origin + 'post');
    await profileForSnap('native-public').waitFor();
    check(await rail.getAttribute('data-snap-mode') === 'ufi', 'Standalone UFI also includes the native Snap rail');

    await auditNavigate(page, origin + '?feed=feed');
    await profileForSnap('twitter-fixture').waitFor();
    holdMode = 'home';
    await rail.getByRole('button', { name: 'Refresh X (Twitter) snaps', exact: true }).click(); await heldRequest;
    const oldHome = held; held = null;
    await auditNavigate(page, origin + '?feed=following');
    await page.locator('.snap-rail[data-snap-mode="following"]').waitFor(); await profileForSnap('native-public').waitFor();
    await oldHome.route.fulfill({ json: { snaps: [snap('late-home-fixture', 'twitter', { caption: 'Wrong old Home response' })], sourceErrors: {} } }).catch(() => {});
    await page.waitForTimeout(150);
    check(await profileForSnap('late-home-fixture').count() === 0, 'Late Home responses never replace Following snaps');
    assert.deepEqual(await rail.locator('.snap-source-box').evaluateAll(elements => elements.map(element => element.dataset.snapSource)), ['uficonnect', 'facebook', 'twitter']); checks++;
    const followingSources = page.getByRole('group', { name: 'Following sources', exact: true }); await followingSources.waitFor();
    check(await rail.locator('.snap-source-items').evaluateAll(elements => elements.every(element => element.clientHeight <= 182)),
      'Following source boxes also show at most two compact profile rows');
    check((await rail.boundingBox()).y + (await rail.boundingBox()).height <= (await followingSources.boundingBox()).y + 2, 'Following snaps appear above source selection');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/snaps-following-${width}.png`) });

    heldRequest = new Promise(resolve => { heldRequestResolve = resolve; }); holdMode = 'following';
    await rail.getByRole('button', { name: 'Refresh UFI snaps', exact: true }).click(); await heldRequest;
    const oldAccount = held;
    viewerId = nextOwner;
    rows.push(snap('next-account-fixture', 'uficonnect', { owned: true, author: { id: nextOwner, name: 'Next member', avatarUrl } }));
    await installAuditMember(page, app, nextOwner);
    await auditNavigate(page, origin + '?feed=following');
    await profileForSnap('next-account-fixture').waitFor();
    await oldAccount.route.fulfill({ json: oldAccount.body }).catch(() => {});
    await page.waitForTimeout(150);
    check(await profileForSnap('native-private').count() === 0, 'Switching accounts clears private snap state and rejects the previous account response');
    viewerId = null;
    await auditNavigate(page, origin + 'global?audit-public=1');
    await profileForSnap('facebook-fixture').waitFor();
    check(await profileForSnap('native-private').count() === 0, 'Public Snap discovery excludes followers-only snaps');
    check(await nativeBox.count() === 0 && await rail.locator('.snap-create-button').count() === 0, 'Guest Home excludes UFI snaps and native posting');
    await refreshSource('X (Twitter)', 'twitter');
    check(await rail.locator('.snap-source-favorite').count() === 0, 'Guests have no invented favorite sources');
    await openSnap('facebook-fixture');
    viewer = page.locator('dialog.snap-viewer'); await viewer.waitFor();
    await viewer.getByRole('button', { name: 'Snap options', exact: true }).click();
    check(await viewer.getByRole('button', { name: 'Delete this snap', exact: true }).count() === 0 && await viewer.getByRole('button', { name: 'Report this snap', exact: true }).count() === 0, 'Guest viewer exposes no authenticated content mutations');
    await page.keyboard.press('Escape');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await viewer.getByRole('region', { name: 'Snap media', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    check(await viewer.locator('.snap-viewer-cube-outgoing').count() === 0
      && await viewer.locator('.snap-viewer-cube').evaluate(element => getComputedStyle(element).animationName === 'none'), 'Reduced-motion users change snaps immediately without a cube animation');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.keyboard.press('Escape');
    await page.locator('dialog.snap-viewer').waitFor({ state: 'detached' });
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/snaps-global-${width}.png`) });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'No page overflow after dialogs, routes or account switching');
    if (width === 1440) {
      rows.push(snap('twitch-landscape-fixture', 'twitch', { mediaType: 'video', mediaKind: 'source', mediaUrl: 'https://clips.twitch.tv/AwkwardHelplessSalamanderSwiftRage', thumbnailUrl: photoUrl, sourceUrl: 'https://clips.twitch.tv/AwkwardHelplessSalamanderSwiftRage', author: { id: 'twitch-landscape-author', name: 'Twitch landscape', avatarUrl } }));
      await page.setViewportSize({ width: 844, height: 390 });
      await auditNavigate(page, origin + 'global?audit-public=landscape');
      await openSnap('twitch-landscape-fixture');
      const landscape = page.locator('dialog.snap-viewer');
      const frame = landscape.locator('iframe'); await frame.waitFor();
      check(new URL(await frame.getAttribute('src')).searchParams.get('autoplay') === 'true', 'Eligible Twitch snaps request autoplay');
      const stage = landscape.locator('.snap-viewer-media');
      check((await frame.boundingBox()).height >= 300 && await stage.evaluate(element => element.scrollHeight > element.clientHeight), 'The Twitch landscape player keeps its required height and scrolls instead of clipping');
      await stage.evaluate(element => { element.scrollTop = element.scrollHeight; });
      const controlGroup = landscape.getByRole('group', { name: 'Twitch clip controls', exact: true });
      const controls = await controlGroup.boundingBox(), dialogBounds = await landscape.boundingBox();
      check(await controlGroup.getByRole('button').isVisible() && controls.y >= dialogBounds.y && controls.y + controls.height <= dialogBounds.y + dialogBounds.height + 2,
        `Twitch controls stay reachable in the viewer toolbar after scrolling the short landscape stage: ${JSON.stringify({ controls, dialog: dialogBounds, scroll: await stage.evaluate(element => ({ top: element.scrollTop, height: element.scrollHeight, client: element.clientHeight })) })}`);
      const selected = await landscape.locator('.snap-viewer-caption').innerText();
      await page.waitForTimeout(550);
      await landscape.locator('.snap-viewer-topbar').dispatchEvent('wheel', { deltaY: 120, deltaX: 0, bubbles: true, cancelable: true });
      await page.waitForFunction(previous => {
        const caption = document.querySelector('.snap-viewer-caption'); return caption && caption.textContent !== previous;
      }, selected);
      check(await landscape.locator('.snap-viewer-caption').innerText() !== selected && await landscape.locator('iframe').count() <= 1, 'Vertical topbar scrolling advances an embedded snap while retaining only one live player');
      await closeViewer();
    }
    assert.deepEqual(errors, []); checks++;
    console.log(`PASS: grouped square profile tiles, themed source sections, full-screen cube navigation, external-only Home Snaps, UFI/Following camera tile and local drafts, scoped refresh/error isolation, source favorites, signed upload, saved effects, audience, profile/report/delete, expiry and session isolation at ${width}px`);
    await context.close(); activePage = null;
  }
  console.log(`PASS: ${checks} Snap browser checks.`);
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: path.join(root, '.cache/audit-ui/snaps-failure.png'), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(root, '.cache/audit-ui/snaps-failure.json'), JSON.stringify({ url: activePage.url(), checks, error: error.message,
      visibleText: await activePage.locator('body').innerText().catch(() => '') }, null, 2) + '\n');
  }
  throw error;
} finally { await browser?.close(); await server.close(); await app.close(); }
