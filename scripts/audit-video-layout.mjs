import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate } from './audit-session.mjs';
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = await createAppHarness();
app.seedUser(member('video-layout-audit'));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 5247, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } } });
let browser;
const post = (id, extra = {}) => ({ id, source: 'reddit', title: `Video ${id}`, content: 'Details belong below the video.',
  mediaType: 'video', mediaUrl: 'https://media.example.invalid/fixture.mp4', sourceUrl: 'https://example.com/original',
  isExternal: true, createdAt: '2026-09-22T12:00:00Z', ...extra });
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, hasTouch: width < 600, isMobile: width < 600 });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], embedRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await installAuditMember(page, app, 'video-layout-audit');
    // Provider APIs are deterministic fixtures. No public videos are scanned
    // or downloaded; the actual iframe request still exercises referrer policy.
    await page.addInitScript(() => {
      window.YT = { PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 }, Player: class {
        constructor(frame, config) {
          this.frame = frame; this.config = config; this.state = 1;
          this.id = new URL(frame.src).pathname.split('/').pop();
          setTimeout(() => config.events?.onReady?.({ target: this }), 20);
        }
        getIframe() { return this.frame; }
        getVideoData() { return { video_id: this.id }; }
        getDuration() { return this.id === 'short000001' ? 3 : 30; }
        getCurrentTime() { return 1; }
        getPlayerState() { return this.state; }
        loadVideoById(id) { this.id = id; const url = new URL(this.frame.src); url.pathname = `/embed/${id}`; this.frame.src = url.href; }
        playVideo() { this.state = 1; }
        pauseVideo() { this.state = 2; }
        mute() {} unMute() {} seekTo() {} destroy() { this.frame.remove(); }
      } };
    });
    await page.route('https://www.youtube.com/embed/**', async route => {
      embedRequests.push({ url: route.request().url(), headers: await route.request().allHeaders() });
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0;background:#172554;color:white"><button>Provider controls</button></body></html>' });
    });
    await page.route('https://player.vimeo.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><button>Vimeo controls</button>' }));
    await page.route('https://vimeo.com/api/oembed.json?*', route => route.fulfill({ json: { duration: 3, thumbnail_url: null } }));
    await page.route('https://media.example.invalid/**', route => route.fulfill({ status: 404, body: '' }));
    let posts = [];
    const feedRequests = [];
    await page.route(/\/api\/office\/feed\/(?:videos|music)(?:\/following)?\?/, route => {
      feedRequests.push(new URL(route.request().url()));
      return route.fulfill({ json: { posts, hasMore: false, waitingForNew: true } });
    });
    const origin = server.resolvedUrls.local[0];
    const visit = async (surface, nextPosts) => {
      posts = nextPosts;
      // Leave the route first so queue and remembered durations start fresh.
      await auditNavigate(page, origin + 'saved');
      await page.locator('.video-feed-view').waitFor({ state: 'detached' });
      await auditNavigate(page, origin + surface);
    };
    for (const surface of ['videos', 'music']) {
      await visit(surface, [post('below-five', { videoDurationSeconds: 4.99 }), post('unsupported', { mediaUrl: 'https://example.com/article' }), post('exactly-five', { videoDurationSeconds: 5 })]);
      const accepted = page.locator('[data-post-id="exactly-five"]');
      await accepted.waitFor();
      assert.equal(await page.locator('[data-post-id="below-five"], [data-post-id="unsupported"]').count(), 0);
      const headerControls = page.locator('.video-feed-top-controls');
      const showControls = headerControls.getByRole('button', { name: 'Show video controls', exact: true });
      await showControls.waitFor({ state: 'visible' });
      assert.equal(await showControls.getAttribute('aria-expanded'), 'false');
      assert.equal(await accepted.locator('[data-video-actions]').isVisible(), false, 'Video opens with app commands collapsed');
      const collapsedMedia = await accepted.locator('[data-video-media]').boundingBox();
      // The surrounding app controls remain operable with a keyboard, without
      // intercepting pointer input intended for the provider's own frame.
      await showControls.focus();
      await page.keyboard.press('Enter');
      const hideControls = headerControls.getByRole('button', { name: 'Hide video controls', exact: true });
      await hideControls.waitFor({ state: 'visible' });
      assert.equal(await hideControls.getAttribute('aria-expanded'), 'true');
      await accepted.locator('[data-video-actions]').waitFor({ state: 'visible' });
      const rectangles = await accepted.evaluate(element => {
        const box = selector => { const r = element.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; };
        const header = document.querySelector('.video-feed-top-controls').getBoundingClientRect();
        return { headerBottom: header.bottom, media: box('[data-video-media]'), details: box('[data-video-details]'), actions: box('[data-video-actions]'), fit: getComputedStyle(element.querySelector('video')).objectFit };
      });
      assert.ok(rectangles.media.height > 100, 'Media retains visible space');
      assert.ok(rectangles.headerBottom <= rectangles.media.top + 1, 'Header stays above video');
      assert.ok(rectangles.media.bottom <= rectangles.details.top + 1, 'App commands and details stay below video');
      const mediaOverlapsActions = rectangles.media.left < rectangles.actions.right - 1
        && rectangles.media.right > rectangles.actions.left + 1
        && rectangles.media.top < rectangles.actions.bottom - 1
        && rectangles.media.bottom > rectangles.actions.top + 1;
      assert.equal(mediaOverlapsActions, false, 'Commands stay outside the full video frame');
      assert.equal(rectangles.fit, 'contain', 'Native video preserves the full frame');
      assert.ok(collapsedMedia.height >= rectangles.media.height - 1, 'Collapsed commands preserve space for the video');
      await hideControls.focus();
      await page.keyboard.press('Space');
      await showControls.waitFor({ state: 'visible' });
      assert.equal(await accepted.locator('[data-video-actions]').isVisible(), false, 'Keyboard users can collapse app commands again');
      assert.equal(await page.locator('[data-video-details] .lucide-sliders-horizontal, [data-video-details] [aria-label="Show video controls"], [data-video-details] [aria-label="Hide video controls"]').count(), 0,
        'No bottom sliders or controls toggle remains in the video caption');
      assert.equal(await showControls.locator('.lucide-ellipsis').count(), 1, 'Playback commands have a distinct ellipsis in the header');
      assert.equal(await showControls.evaluate(element => document.activeElement === element), true, 'Collapsing controls retains keyboard focus on the toggle');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    await visit('videos', [post('native-short'), post('native-long', { mediaUrl: 'https://media.example.invalid/long.mp4', videoDurationSeconds: 20 })]);
    await page.locator('[data-post-id="native-short"] video').evaluate(video => {
      Object.defineProperty(video, 'duration', { configurable: true, value: 3 });
      video.dispatchEvent(new Event('loadedmetadata'));
    });
    await page.locator('[data-post-id="native-short"]').waitFor({ state: 'detached' });
    await page.locator('[data-post-id="native-long"]').waitFor();
    await visit('videos', [post('vimeo-short', { mediaUrl: 'https://vimeo.com/123456' }), post('vimeo-next', { videoDurationSeconds: 20 })]);
    await page.locator('[data-post-id="vimeo-next"]').waitFor();
    await page.locator('[data-post-id="vimeo-short"]').waitFor({ state: 'detached' });
    await visit('videos', [post('youtube-short', { source: 'youtube', embedId: 'short000001' }), post('youtube-long', { source: 'youtube', embedId: 'long0000001' })]);
    await page.locator('[data-post-id="youtube-long"]').waitFor();
    await page.locator('[data-post-id="youtube-short"]').waitFor({ state: 'detached' });
    const frame = page.locator('.video-feed-youtube-player iframe').first();
    await frame.waitFor({ state: 'visible' });
    const frameInfo = await frame.evaluate(element => ({ policy: element.referrerPolicy, src: element.src,
      pointerEvents: getComputedStyle(element).pointerEvents, tabIndex: element.tabIndex, width: element.getBoundingClientRect().width }));
    assert.equal(frameInfo.policy, 'strict-origin-when-cross-origin');
    assert.equal(new URL(frameInfo.src).searchParams.get('origin'), new URL(origin).origin);
    assert.equal(new URL(frameInfo.src).searchParams.get('controls'), '1');
    assert.equal(frameInfo.pointerEvents, 'auto');
    assert.ok(frameInfo.tabIndex >= 0 && frameInfo.width > 100, 'Provider controls remain reachable at useful size');
    const providerFrame = page.frameLocator('.video-feed-youtube-player iframe').first();
    await providerFrame.getByRole('button', { name: 'Provider controls' }).click();
    await frame.focus();
    assert.equal(await frame.evaluate(element => document.activeElement === element), true, 'Keyboard users can focus the provider frame');
    const youtubePost = page.locator('[data-post-id="youtube-long"]');
    await page.locator('.video-feed-top-controls').getByRole('button', { name: 'Show video controls', exact: true }).click();
    await youtubePost.locator('[data-video-actions]').waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const frame = document.querySelector('.video-feed-youtube-player iframe')?.getBoundingClientRect();
      const media = document.querySelector('[data-post-id="youtube-long"] [data-video-media]')?.getBoundingClientRect();
      return frame && media && frame.x >= media.x - 1 && frame.y >= media.y - 1
        && frame.right <= media.right + 1 && frame.bottom <= media.bottom + 1;
    });
    const providerBounds = await frame.boundingBox();
    const mediaBounds = await youtubePost.locator('[data-video-media]').boundingBox();
    const actionBounds = await youtubePost.locator('[data-video-actions]').boundingBox();
    assert.ok(providerBounds.x >= mediaBounds.x - 1 && providerBounds.y >= mediaBounds.y - 1
      && providerBounds.x + providerBounds.width <= mediaBounds.x + mediaBounds.width + 1
      && providerBounds.y + providerBounds.height <= mediaBounds.y + mediaBounds.height + 1,
    'The entire provider frame fits inside the available media rectangle');
    assert.ok(providerBounds.y + providerBounds.height <= actionBounds.y + 1,
      'Revealed app commands remain below the actual provider frame');
    await providerFrame.getByRole('button', { name: 'Provider controls' }).click();
    assert.ok(embedRequests.some(request => request.headers.referer === new URL(origin).origin + '/'), 'First provider request includes the real origin referrer');
    for (const surface of ['videos', 'music']) {
      const nextPosts = Array.from({ length: 8 }, (_, index) => post(`scroll-${surface}-${index}`, {
        source: 'youtube', embedId: `scroll0000${index}`, sourceUrl: `https://youtube.com/shorts/scroll0000${index}`,
      }));
      await visit(surface, nextPosts);
      const scroll = page.locator('[data-video-feed-scroll]');
      const sharedFrame = page.locator('.video-feed-youtube-player iframe');
      await sharedFrame.waitFor({ state: 'visible' });
      assert.equal(await sharedFrame.evaluate(element => Boolean(element.closest('[data-video-feed-scroll]'))), true,
        'Cross-origin player belongs to the native scrolling region');
      await sharedFrame.evaluate(element => { element.dataset.stablePlayer = 'true'; });
      const rect = await sharedFrame.boundingBox();
      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;
      if (width < 600) {
        const cdp = await context.newCDPSession(page);
        const startY = rect.y + rect.height * .92;
        const endY = rect.y + rect.height * .06;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: centerX, y: startY }] });
        for (let step = 1; step <= 8; step += 1) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: centerX, y: startY + (endY - startY) * step / 8 }] });
          await page.waitForTimeout(25);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
      } else {
        await page.mouse.move(centerX, centerY);
        await page.mouse.wheel(0, 650);
      }
      await page.waitForFunction(() => {
        const scroll = document.querySelector('[data-video-feed-scroll]');
        return scroll && scroll.scrollTop >= scroll.clientHeight * .9;
      });
      await page.waitForFunction(() => document.querySelector('.video-feed-youtube-player')?.getAttribute('aria-hidden') === 'false');
      assert.equal(await sharedFrame.getAttribute('data-stable-player'), 'true', 'Scrolling reuses the original provider iframe');
      await page.frameLocator('.video-feed-youtube-player iframe').getByRole('button', { name: 'Provider controls' }).click();
      assert.equal(await sharedFrame.count(), 1, 'Only one YouTube player stays mounted');
      // Refresh must request a fresh batch and display genuinely new IDs.
      posts = [post(`fresh-${surface}`, { source: 'youtube', embedId: 'fresh000001', sourceUrl: 'https://youtube.com/shorts/fresh000001' })];
      await page.getByRole('button', { name: 'Refresh videos', exact: true }).click();
      await page.locator(`[data-post-id="fresh-${surface}"]`).waitFor();
      assert.equal(feedRequests.at(-1).searchParams.get('bust'), '1');
      assert.equal(await scroll.locator('[data-post-id^="scroll-"]').count(), 0, 'Refresh replaces the old batch with new videos');
      // An upstream pool with nothing newer must not blank the existing video.
      await page.getByRole('button', { name: 'Refresh videos', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh videos"]').disabled);
      assert.equal(await page.locator(`[data-post-id="fresh-${surface}"]`).count(), 1, 'No-new-content refresh preserves the current queue');
      await page.getByRole('button', { name: 'YouTube', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[data-post-id^="fresh-"]'));
      await page.getByRole('button', { name: 'Clear platforms', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Clear platforms"]').disabled);
      assert.equal(await page.getByRole('button', { name: 'YouTube', exact: true }).getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator(`[data-post-id="fresh-${surface}"]`).count(), 1,
        'Selecting and clearing a source retains matching videos that have not been watched');
      assert.equal(await page.getByRole('button', { name: 'Clear platforms', exact: true }).evaluate(el => el.classList.contains('ufi-clear-control')), true);
      if (surface === 'music') {
        assert.equal(await page.getByRole('button', { name: 'All genres', exact: true }).count(), 0);
        await page.getByRole('button', { name: 'Pop', exact: true }).click();
        await page.getByRole('button', { name: 'Clear genres', exact: true }).click();
        assert.equal(await page.getByRole('button', { name: 'Pop', exact: true }).getAttribute('aria-pressed'), 'false');
      }
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: collapsed/revealed controls, full media, 5-second boundary, metadata filtering, cross-origin wheel/touch browsing in Videos + Music, one persistent interactive iframe, fresh-batch refresh at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
