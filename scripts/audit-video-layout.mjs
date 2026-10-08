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
const hnOnly = process.argv.includes('--hn-only');
const cleanOnly = process.argv.includes('--clean-only');
const menusOnly = process.argv.includes('--menus-only');
const app = await createAppHarness();
app.seedUser(member('video-layout-audit'));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 5247, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } } });
let browser;
const channelId = 'UCabcdefghijklmnopqrstuv';
const avatarUrl = 'https://media.example.invalid/avatar.svg';
const post = (id, extra = {}) => ({ id, source: 'reddit', title: `Video ${id}`, content: 'Details belong below the video.',
  author: extra.source === 'youtube'
    ? { id: `youtube_${channelId}`, name: 'Audit channel', channelId, avatarUrl }
    : { id: 'reddit_audit_creator', name: 'audit_creator', avatarUrl },
  mediaType: 'video', mediaUrl: 'https://media.example.invalid/fixture.mp4',
  sourceUrl: extra.source === 'youtube' ? `https://www.youtube.com/watch?v=${extra.embedId}` : 'https://www.reddit.com/r/audit/comments/abcd/fixture/',
  // Synthetic media is fulfilled locally; this fixture grants its playback rights explicitly.
  directPlaybackAuthorized: true,
  isExternal: true, createdAt: '2026-09-22T12:00:00Z', ...extra });
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of hnOnly || cleanOnly || menusOnly ? [390, 1440] : [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, hasTouch: width < 600, isMobile: width < 600 });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], embedRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await installAuditMember(page, app, 'video-layout-audit');
    // Provider APIs are deterministic fixtures. No public videos are scanned
    // or downloaded; the actual iframe request still exercises referrer policy.
    await page.addInitScript(() => {
      window.__videoLayoutPlayers = new Set();
      window.__videoLayoutRateRequests = [];
      window.__videoLayoutHoldRateChange = false;
      window.YT = { PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 }, Player: class {
        constructor(frame, config) {
          this.frame = frame; this.config = config; this.state = 1; this.rate = 1;
          this.id = new URL(frame.src).pathname.split('/').pop();
          window.__videoLayoutPlayers.add(this);
          setTimeout(() => config.events?.onReady?.({ target: this }), 20);
        }
        getIframe() { return this.frame; }
        getVideoData() { return { video_id: this.id }; }
        getDuration() { return this.id === 'short000001' ? 3 : 30; }
        getCurrentTime() { return 1; }
        getPlayerState() { return this.state; }
        getAvailablePlaybackRates() { return [0.5, 1, 1.5, 2]; }
        getPlaybackRate() { return this.rate; }
        getOptions() { return []; }
        setPlaybackRate(rate) {
          window.__videoLayoutRateRequests.push(rate);
          const confirm = () => { this.rate = rate; this.config.events?.onPlaybackRateChange?.({ target: this, data: rate }); };
          if (window.__videoLayoutHoldRateChange) window.__videoLayoutConfirmRate = confirm;
          else setTimeout(confirm, 20);
        }
        loadVideoById(id) { this.id = id; const url = new URL(this.frame.src); url.pathname = `/embed/${id}`; this.frame.src = url.href; }
        playVideo() { this.state = 1; }
        pauseVideo() { this.state = 2; }
        mute() {} unMute() {} seekTo() {} destroy() { window.__videoLayoutPlayers.delete(this); this.frame.remove(); }
      } };
    });
    await page.route('https://www.youtube.com/embed/**', async route => {
      embedRequests.push({ url: route.request().url(), headers: await route.request().allHeaders() });
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0;background:#172554;color:white"><button>Provider controls</button></body></html>' });
    });
    await page.route('https://player.vimeo.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><button>Vimeo controls</button>' }));
    await page.route('https://vimeo.com/api/oembed.json?*', route => route.fulfill({ json: { duration: 3, thumbnail_url: null } }));
    await page.route('https://media.example.invalid/**', route => route.request().url() === avatarUrl
      ? route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#315299"/></svg>' })
      : route.fulfill({ status: 404, body: '' }));
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
    const assertInViewport = async (locator, message) => {
      assert.ok(await locator.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
      }), message);
    };
    if (!hnOnly) {
      const saved = new Set(); let likeWrites = 0;
      await page.route(/\/api\/(?:office\/)?feed\/menu-native-[^/?]+\/like$/, async route => {
        likeWrites += 1;
        await new Promise(resolve => setTimeout(resolve, 300));
        await route.fulfill({ json: { likedByMe: true, likesCount: 1 } });
      });
      await page.route(/\/api\/(?:office\/)?saved\/posts(?:\/[^?]+)?(?:\?.*)?$/, async route => {
        const request = route.request();
        if (request.method() === 'POST') saved.add(request.postDataJSON().post.id);
        if (request.method() === 'DELETE') saved.delete(decodeURIComponent(new URL(request.url()).pathname.split('/').pop()));
        await route.fulfill({ json: { postIds: [...saved] } });
      });
      for (const surface of ['videos', 'music']) {
        const id = `menu-native-${surface}`;
        await visit(surface, [post(id, { source: 'uficonnect', isExternal: false, sourceUrl: null,
          authorId: 'other-member', author: { id: 'other-member', name: 'Member', avatarUrl },
          likesCount: 0, likedByMe: false, videoDurationSeconds: 30 })]);
        const slide = page.locator(`[data-post-id="${id}"]`); await slide.waitFor();
        const actions = slide.getByRole('group', { name: 'Post actions', exact: true });
        assert.equal(await actions.getByRole('button').count(), 4);
        assert.equal(await actions.getByRole('link', { name: 'Open post', exact: true }).getAttribute('href'), `/p/${id}`);
        const more = slide.getByRole('button', { name: 'More options', exact: true });
        await actions.getByRole('button', { name: 'Like, 0 likes', exact: true }).click();
        await actions.getByRole('button', { name: 'Unlike, 1 likes', exact: true }).waitFor();
        assert.equal(likeWrites, surface === 'videos' ? 1 : 2, 'Visible likes use the real native reaction endpoint');
        await actions.getByRole('button', { name: 'Save post', exact: true }).click();
        await actions.getByRole('button', { name: 'Remove saved post', exact: true }).waitFor();
        assert.ok(saved.has(id), 'Visible Save writes the real post identity');
        await actions.getByRole('button', { name: 'Remove saved post', exact: true }).click();
        await actions.getByRole('button', { name: 'Save post', exact: true }).waitFor();
        assert.equal(saved.has(id), false);
        await actions.getByRole('button', { name: 'Comments', exact: true }).click();
        await page.getByRole('dialog', { name: 'Comments', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Close comments', exact: true }).click();
        await page.getByRole('dialog', { name: 'Comments', exact: true }).waitFor({ state: 'hidden' });
        const playback = slide.getByRole('group', { name: 'Playback controls', exact: true });
        const placement = await playback.evaluate(element => {
          const controls = element.getBoundingClientRect();
          const media = element.closest('.video-feed-slide').querySelector('[data-video-media]').getBoundingClientRect();
          return controls.top >= media.bottom && controls.left <= media.left + 25 && getComputedStyle(element).position === 'static';
        });
        assert.ok(placement, 'Playback controls sit under the video on the left');
        assert.equal(await playback.locator('.video-feed-playback-time').textContent(), '0:00 / 0:30');
        await slide.locator('video').evaluate(video => {
          Object.defineProperty(video, 'duration', { configurable: true, value: 3661 });
          Object.defineProperty(video, 'currentTime', { configurable: true, value: 12 });
          video.dispatchEvent(new Event('loadedmetadata')); video.dispatchEvent(new Event('timeupdate'));
        });
        await page.waitForFunction(() => document.querySelector('.video-feed-playback-time')?.textContent === '0:12 / 1:01:01');
        await more.click(); const menu = page.getByRole('menu');
        assert.equal(await menu.locator('.video-feed-menu-action').count(), 0, 'Visible engagement actions are not duplicated in the menu');
        await page.keyboard.press('Escape'); await menu.waitFor({ state: 'detached' });
        const bounds = await slide.locator('[data-video-media]').boundingBox();
        await page.mouse.move(bounds.x + 12, bounds.y + 12);
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.video-feed-playback-controls')).opacity === '0');
        assert.equal(await slide.locator('video').evaluate(video => getComputedStyle(video).cursor), 'none');
        assert.equal(await playback.evaluate(element => getComputedStyle(element).pointerEvents), 'none');
        assert.ok(await actions.isVisible(), 'Likes, Comments, Save and source navigation remain available on idle');
        await page.mouse.move(bounds.x + 22, bounds.y + 22);
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.video-feed-playback-controls')).opacity === '1');
        if (width < 600) {
          await page.touchscreen.tap(bounds.x + 32, bounds.y + 32);
          await page.waitForFunction(() => getComputedStyle(document.querySelector('.video-feed-playback-controls')).opacity === '0');
          await page.touchscreen.tap(bounds.x + 42, bounds.y + 42);
          await page.waitForFunction(() => getComputedStyle(document.querySelector('.video-feed-playback-controls')).opacity === '1');
        }
        await page.keyboard.press('Tab');
        await playback.getByRole('button', { name: /^(?:Play|Pause) video$/ }).focus();
        await page.waitForFunction(() => document.querySelector('.video-feed-slide')?.dataset.cursorIdle === 'true');
        assert.equal(await playback.evaluate(element => getComputedStyle(element).opacity), '1', 'Keyboard focus keeps playback controls visible');
        await page.mouse.move(bounds.x + 52, bounds.y + 52);
        await page.screenshot({ path: path.join(root, '.cache', `controls-below-${surface}-${width}.png`) });
      }
      console.log(`PASS playback below left, time, visible Like/Comments/Save, post link and accessible idle fade in Videos + Music at ${width}px`);
      if (menusOnly) { assert.deepEqual(errors, []); await context.close(); continue; }
    }
    const checkFullScreen = async slide => {
      const routeBefore = page.url();
      const more = slide.getByRole('button', { name: 'More options', exact: true });
      await more.click();
      await page.getByRole('menuitem', { name: 'Full screen', exact: true }).click();
      await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
      assert.ok(await slide.getByRole('group', { name: 'Playback controls', exact: true }).isVisible());
      await more.click();
      await assertInViewport(page.getByRole('menu'), 'The menu remains reachable in full screen');
      await page.getByRole('menuitem', { name: 'Exit full screen', exact: true }).click();
      await page.waitForFunction(() => !document.fullscreenElement);
      assert.equal(page.url(), routeBefore, 'Exiting full screen keeps the feed route');
      await more.click();
      await page.getByRole('menuitem', { name: 'Full screen', exact: true }).click();
      await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
      await page.keyboard.press('Escape');
      assert.equal(page.url(), routeBefore, 'Escape in full screen does not navigate away from the video');
      // Some headless browsers leave native full-screen dismissal to browser
      // chrome; explicitly exit any remaining session before the next check.
      await page.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen(); });
      await page.waitForFunction(() => !document.fullscreenElement);
    };
    const checkPostActions = async (slide, profileHref, youtube = false, invalidSource = false) => {
      const actions = slide.getByRole('group', { name: 'Post actions', exact: true });
      assert.ok(await actions.isVisible());
      assert.equal(await actions.getByRole('button', { name: /^Comments(?: |$)/ }).count(), 1);
      assert.equal(await actions.getByRole('button', { name: 'Save post', exact: true }).count(), 1);
      assert.equal(await actions.locator('.post-chrome-like').count(), invalidSource ? 0 : 1);
      assert.equal(await slide.locator('input[type="range"], .video-feed-action-rail, .video-feed-scrubber, .video-feed-progress').count(), 0,
        'App playback rails and scrubbers are absent');
      const playback = slide.getByRole('group', { name: 'Playback controls', exact: true });
      await slide.locator('[data-video-media]').hover({ position: { x: 12, y: 12 } });
      assert.ok(await playback.isVisible(), 'Playback controls reveal on activity');
      assert.equal(await playback.getByRole('button', { name: /^(?:Play|Pause) video$/ }).count(), 1,
        'Play and pause stay visible beside mute');
      const sound = playback.getByRole('button', { name: /^(?:Mute|Unmute) video$/ });
      assert.equal(await sound.count(), 1);
      assert.ok(await sound.evaluate(button => {
        const rect = button.getBoundingClientRect();
        const media = button.closest('.video-feed-slide').querySelector('[data-video-media]').getBoundingClientRect();
        const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return rect.top >= media.bottom && rect.x <= media.left + 80 && rect.right <= media.right
          && button.contains(target);
      }), 'Mute sits below the video on the left beside play');
      assert.equal(await actions.locator('.post-chrome-source-link').count(), 1, 'The post link stays visible');
      const more = actions.getByRole('button', { name: 'More options', exact: true });
      assert.ok(await more.isVisible());
      assert.equal(await actions.evaluate(element => element.lastElementChild.classList.contains('post-chrome-source-link') && element.lastElementChild.previousElementSibling.classList.contains('post-chrome-more')), true,
        'The post link follows the three-dot menu');
      assert.ok(await actions.evaluate(element => {
        const more = element.querySelector('.post-chrome-more').getBoundingClientRect();
        const link = element.querySelector('.post-chrome-source-link').getBoundingClientRect();
        return link.left >= more.right && Math.abs(link.top - more.top) < 1;
      }), 'The post link sits to the right of three dots in the same row');
      assert.equal(await slide.locator('.post-chrome-identity').getAttribute('href'), profileHref,
        'The author name links to its real source profile');
      const routeBefore = page.url();
      const scrollBefore = await page.locator('[data-video-feed-scroll]').evaluate(el => el.scrollTop);
      await more.click();
      const menu = page.getByRole('menu');
      await menu.waitFor({ state: 'visible' });
      assert.equal(await menu.evaluate(el => el.parentElement === document.body), true,
        'The menu escapes the caption scroll container');
      await assertInViewport(menu, 'The complete menu stays inside the viewport');
      assert.equal(await menu.getByRole('menuitem', { name: 'Full screen', exact: true }).count(), 1,
        'Full screen is available from the source menu');
      assert.equal(await menu.getByRole('menuitem', { name: /^(?:Play|Pause|Mute|Unmute) video$/ }).count(), 0,
        'The source menu does not duplicate visible playback controls');
      assert.ok(await menu.getByRole('menuitem', { name: /^(?:Open on |Open original post|Open (?:Reddit|Hacker News) discussion|Watch on )/ }).count() > 0,
        'The original-post link is restored inside the menu');
      assert.equal(await menu.locator('.video-feed-menu-action').count(), 0, 'Like and Save are visible in the layout');
      if (!youtube) assert.equal(await menu.getByRole('menuitem', { name: /YouTube/i }).count(), 0,
        'Videos without a playable YouTube URL have no YouTube options: ' + JSON.stringify(await menu.getByRole('menuitem').allTextContents()));
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached' });
      assert.equal(page.url(), routeBefore, 'Escape closes the menu without leaving the video route');
      assert.equal(await more.evaluate(el => document.activeElement === el), true, 'Escape restores menu-button focus');
      assert.equal(await page.locator('[data-video-feed-scroll]').evaluate(el => el.scrollTop), scrollBefore,
        'Menu dismissal does not advance the video');
      const photo = slide.getByRole('button', { name: /profile photo$/ });
      await photo.click();
      const viewer = page.getByRole('dialog', { name: /profile photo$/ });
      await viewer.waitFor();
      assert.equal(await viewer.locator('img').getAttribute('src'), avatarUrl);
      assert.equal(await viewer.getByRole('link', { name: 'Go to profile', exact: true }).getAttribute('href'), profileHref);
      await page.keyboard.press('Escape');
      await viewer.waitFor({ state: 'detached' });
      assert.equal(page.url(), routeBefore, 'Escape dismisses the photo without leaving the video route');
    };
    const hnAuthor = { id: 'hn_audit_creator', name: 'audit_creator', avatarUrl };
    const hnProfile = 'https://news.ycombinator.com/user?id=audit_creator';
    const beforeHnRequests = embedRequests.length;
    await visit('videos', [post('hn-native-stale', { source: 'hackernews', author: hnAuthor,
      sourceUrl: 'https://news.ycombinator.com/item?id=123456', embedId: 'stalehn0001', videoDurationSeconds: 30 })]);
    const hnNative = page.locator('[data-post-id="hn-native-stale"]');
    await hnNative.locator('video').waitFor();
    assert.equal(await hnNative.locator('video').evaluate(video => video.controls), false,
      'Hacker News direct video hides the native toolbar while retaining app playback buttons');
    assert.equal(await page.locator('.video-feed-youtube-player iframe').count(), 0,
      'A stale embedId on a Hacker News direct video never creates a YouTube player');
    await checkPostActions(hnNative, hnProfile);
    assert.equal(await page.getByRole('dialog', { name: 'YouTube settings', exact: true }).count(), 0);
    assert.equal(embedRequests.length, beforeHnRequests, 'A Hacker News direct video makes no YouTube embed requests');

    await visit('videos', [post('hn-youtube-article', { source: 'hackernews', author: hnAuthor,
      sourceUrl: 'https://news.ycombinator.com/item?id=123457', mediaUrl: 'https://www.youtube.com/watch?v=hnvideo0001',
      embedId: 'stalehn0002', videoDurationSeconds: 30 })]);
    const hnYoutube = page.locator('[data-post-id="hn-youtube-article"]');
    const hnFrame = page.locator('.video-feed-youtube-player iframe');
    await hnFrame.waitFor({ state: 'visible' });
    assert.equal(new URL(await hnFrame.getAttribute('src')).pathname, '/embed/hnvideo0001',
      'A Hacker News article plays its actual official YouTube URL instead of a stale embedId');
    assert.equal(new URL(await hnFrame.getAttribute('src')).searchParams.get('controls'), '0');
    assert.equal(await hnYoutube.locator('video').count(), 0);
    await checkPostActions(hnYoutube, hnProfile, true);
    await hnYoutube.getByRole('button', { name: 'More options', exact: true }).click();
    const hnMenu = page.getByRole('menu');
    await hnMenu.waitFor({ state: 'visible' });
    assert.equal(await hnMenu.getByRole('menuitem', { name: /^YouTube settings\b/ }).count(), 1,
      'A real YouTube video embedded in a Hacker News article offers YouTube settings');
    assert.equal(await hnMenu.getByRole('menuitem', { name: /^Likes on Hacker News/ }).count(), 1,
      'The article retains its Hacker News source actions');
    assert.equal(await hnMenu.getByRole('menuitem', { name: /Likes on YouTube|Watch later on YouTube|channel playlists on YouTube/ }).count(), 0,
      'An embedded video does not turn the Hacker News article into a YouTube source post');
    await hnMenu.getByRole('menuitem', { name: /^YouTube settings\b/ }).click();
    const hnSettings = page.getByRole('dialog', { name: 'YouTube settings', exact: true });
    await hnSettings.waitFor({ state: 'visible' });
    const hnRate = hnSettings.getByRole('radiogroup', { name: 'Playback speed', exact: true }).getByRole('radio', { name: '1.5×', exact: true });
    await hnRate.click();
    await page.waitForFunction(() => [...window.__videoLayoutPlayers].some(player => player.id === 'hnvideo0001' && player.getPlaybackRate() === 1.5));
    await page.waitForFunction(() => document.querySelector('[role="radio"][aria-label="1.5×"]')?.getAttribute('aria-checked') === 'true');
    await page.keyboard.press('Escape'); await hnSettings.waitFor({ state: 'detached' });
    assert.ok(embedRequests.slice(beforeHnRequests).every(request => new URL(request.url).pathname === '/embed/hnvideo0001'),
      'Only the actual Hacker News embedded YouTube video is requested');
    console.log(`PASS Hacker News video controls: correct source settings, visible post link, playback below video at ${width}px`);
    if (hnOnly) { assert.deepEqual(errors, []); await context.close(); continue; }
    for (const surface of ['videos', 'music']) {
      await visit(surface, [post('below-five', { videoDurationSeconds: 4.99 }), post('unsupported', { mediaUrl: 'https://example.com/article' }), post('exactly-five', { videoDurationSeconds: 5, embedId: 'stale000001' })]);
      const accepted = page.locator('[data-post-id="exactly-five"]');
      await accepted.waitFor();
      assert.equal(await page.locator('[data-post-id="below-five"], [data-post-id="unsupported"]').count(), 0);
      const headerControls = page.locator('.video-feed-top-controls');
      assert.equal(await headerControls.getByRole('button', { name: /Show video controls|Hide video controls/ }).count(), 0);
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
      assert.equal(await accepted.locator('video').evaluate(video => video.controls), false, 'Native toolbar is hidden by default');
      await checkPostActions(accepted, 'https://www.reddit.com/user/audit_creator/');
      if (width === 1440) await checkFullScreen(accepted);
      assert.equal(await page.getByRole('button', { name: /^(Previous|Next) video$/ }).count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    await visit('videos', [post('native-short'), post('native-long', { mediaUrl: 'https://media.example.invalid/long.mp4', videoDurationSeconds: 20 })]);
    await page.locator('[data-post-id="native-short"] video').evaluate(video => {
      Object.defineProperty(video, 'duration', { configurable: true, value: 3 });
      video.dispatchEvent(new Event('loadedmetadata'));
    });
    await page.locator('[data-post-id="native-short"]').waitFor({ state: 'detached' });
    await page.locator('[data-post-id="native-long"]').waitFor();
    await visit('videos', [post('vimeo-short', { mediaUrl: 'https://vimeo.com/123456', embedId: 'stale000004' }), post('vimeo-next', { videoDurationSeconds: 20 })]);
    await page.locator('[data-post-id="vimeo-next"]').waitFor();
    await page.locator('[data-post-id="vimeo-short"]').waitFor({ state: 'detached' });
    await visit('videos', [post('youtube-labelled-native', { source: 'youtube', embedId: 'stale000002',
      sourceUrl: `https://www.youtube.com/channel/${channelId}`, videoDurationSeconds: 30 })]);
    const labelledNative = page.locator('[data-post-id="youtube-labelled-native"]');
    await labelledNative.locator('video').waitFor();
    assert.equal(await page.locator('.video-feed-youtube-player iframe').count(), 0,
      'A YouTube label and stale embedId do not turn a direct file into a YouTube video');
    await checkPostActions(labelledNative, `https://www.youtube.com/channel/${channelId}`, false, true);

    await visit('videos', [post('youtube-short', { source: 'youtube', embedId: 'short000001' }),
      post('youtube-long', { source: 'youtube', embedId: 'stale000003', sourceUrl: 'https://www.youtube.com/watch?v=long0000001' })]);
    await page.locator('[data-post-id="youtube-long"]').waitFor();
    await page.locator('[data-post-id="youtube-short"]').waitFor({ state: 'detached' });
    const frame = page.locator('.video-feed-youtube-player iframe').first();
    await frame.waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const src = document.querySelector('.video-feed-youtube-player iframe')?.src;
      return src && new URL(src).pathname === '/embed/long0000001';
    });
    const frameInfo = await frame.evaluate(element => ({ policy: element.referrerPolicy, src: element.src,
      pointerEvents: getComputedStyle(element).pointerEvents, tabIndex: element.tabIndex, width: element.getBoundingClientRect().width }));
    assert.equal(frameInfo.policy, 'strict-origin-when-cross-origin');
    assert.equal(new URL(frameInfo.src).pathname, '/embed/long0000001', 'The playable URL overrides a stale embedId');
    assert.equal(new URL(frameInfo.src).searchParams.get('origin'), new URL(origin).origin);
    assert.equal(new URL(frameInfo.src).searchParams.get('controls'), '0');
    assert.equal(frameInfo.pointerEvents, 'auto');
    assert.ok(frameInfo.tabIndex >= 0 && frameInfo.width > 100, 'Provider controls remain reachable at useful size');
    const providerFrame = page.frameLocator('.video-feed-youtube-player iframe').first();
    await providerFrame.getByRole('button', { name: 'Provider controls' }).click();
    await frame.focus();
    assert.equal(await frame.evaluate(element => document.activeElement === element), true, 'Keyboard users can focus the provider frame');
    const youtubePost = page.locator('[data-post-id="youtube-long"]');
    await youtubePost.locator('[data-video-actions]').waitFor({ state: 'visible' });
    await checkPostActions(youtubePost, `https://www.youtube.com/channel/${channelId}`, true);
    if (width === 1440) await checkFullScreen(youtubePost);
    const checkYouTubeSettings = async () => {
      const routeBefore = page.url();
      const more = youtubePost.getByRole('button', { name: 'More options', exact: true });
      await more.click();
      await assertInViewport(page.getByRole('menu'), 'YouTube options fit the viewport');
      await page.getByRole('menuitem', { name: /^YouTube settings\b/ }).click();
      const dialog = page.getByRole('dialog', { name: 'YouTube settings', exact: true });
      await dialog.waitFor({ state: 'visible' });
      await assertInViewport(dialog, 'YouTube settings fit the viewport');
      const speeds = dialog.getByRole('radiogroup', { name: 'Playback speed', exact: true });
      assert.deepEqual(await speeds.getByRole('radio').allTextContents(), ['0.5×', '1×', '1.5×', '2×'],
        'Only playback rates exposed by the actual player are offered');
      const rateBefore = await page.evaluate(() => [...window.__videoLayoutPlayers].find(player => player.id === 'long0000001').getPlaybackRate());
      const nextRate = rateBefore === 1.5 ? 2 : 1.5;
      const nextControl = speeds.getByRole('radio', { name: `${nextRate}×`, exact: true });
      await page.evaluate(() => { window.__videoLayoutHoldRateChange = true; window.__videoLayoutRateRequests = []; });
      await nextControl.click();
      await page.waitForFunction(rate => window.__videoLayoutRateRequests.at(-1) === rate, nextRate);
      assert.equal(await nextControl.getAttribute('aria-checked'), 'false', 'An unconfirmed rate request does not change the selected setting');
      assert.equal(await speeds.getByRole('radio', { name: `${rateBefore}×`, exact: true }).getAttribute('aria-checked'), 'true');
      await page.evaluate(() => { window.__videoLayoutConfirmRate(); window.__videoLayoutHoldRateChange = false; });
      await page.waitForFunction(rate => document.querySelector(`[role="radio"][aria-label="${rate}×"]`)?.getAttribute('aria-checked') === 'true'
        || [...document.querySelectorAll('[role="radio"]')].some(el => el.textContent.trim() === `${rate}×` && el.getAttribute('aria-checked') === 'true'), nextRate);
      assert.equal(await nextControl.getAttribute('aria-checked'), 'true', 'The setting updates after the provider confirms the rate');
      await dialog.getByRole('button', { name: 'Use YouTube player controls', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.querySelector('.video-feed-youtube-player iframe')?.src.includes('controls=1'));
      await page.waitForFunction(() => document.activeElement === document.querySelector('.video-feed-youtube-player iframe'));
      assert.equal(await frame.evaluate(el => document.activeElement === el), true, 'Quality and captions hand off to the official player controls');
      await providerFrame.getByRole('button', { name: 'Provider controls' }).click();
      await more.click();
      await page.getByRole('menuitem', { name: /^YouTube settings\b/ }).click();
      await dialog.waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      assert.equal(page.url(), routeBefore, 'Escape closes YouTube settings without leaving the feed');
      assert.equal(await more.evaluate(el => document.activeElement === el), true, 'Settings dismissal restores the menu trigger');
    };
    await checkYouTubeSettings();
    if (width === 390) {
      await page.setViewportSize({ width: 844, height: 390 });
      await checkYouTubeSettings();
      await page.setViewportSize({ width, height: 850 });
    }
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
      await page.getByRole('button', { name: 'Filter videos', exact: true }).click();
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
    console.log(`PASS: playback below left, visible post actions/link, YouTube settings and explicit player controls, engagement, full screen, media bounds, metadata filtering, touch/wheel browsing, persistent player and refresh at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }

// Settings races run after the layout browser and server have closed.
if (!hnOnly && !cleanOnly && !menusOnly) await import('./audit-video-settings.mjs');
