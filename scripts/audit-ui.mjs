import { installAuditMember, auditNavigate, auditReload } from './audit-session.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { HOME_FEED_SOURCE_IDS, FOLLOWING_FEED_SOURCE_IDS, SOURCE_META } from '../web/src/components/sourceMeta.js';

const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-ui');
await fs.mkdir(output, { recursive: true });
const app = await createAppHarness();
app.seedUser(member('preview-member', { name: 'UFIconnect Member', resumeBuilderAddon: true, plan: 'pro', skills: ['Product design'] }));
app.seedUser(member('other-member', { roleSettings: { feedSourceFavorites: { feed: ['github'], following: ['reddit'] } } }));
const server = await createServer({
  root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/fallback') },
  server: { host: '127.0.0.1', port: 5190, strictPort: false,
    proxy: {
      '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') },
      '/fallback': { target: app.base, rewrite: value => value.replace(/^\/fallback/, '') },
    } },
});
let browser;
let checks = 0;
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  console.log(`UI audit server ready: ${base}`);
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  console.log('UI audit browser ready');
  const sources = ['bluesky', 'mastodon', 'devto', 'github', 'hackernews', 'reddit'];
  let feed = Array.from({ length: 30 }, (_, i) => ({
    id: `audit-post-${i}`, source: sources[i % sources.length],
    title: `Community update ${i + 1}`, content: 'A useful conversation about learning, building, and connecting with people.',
    author: 'Community member', authorName: 'Community member', topic: 'Open Source',
    sourceUrl: 'https://example.org/community', createdAt: new Date(Date.now() - i * 60000).toISOString(),
    likesCount: 0, commentsCount: 0,
  }));
  if (process.argv.includes('--update-homepage')) {
    const response = await fetch('https://api.uficonnect.org/feed/guest?sort=newest&limit=30', { signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.ok(data.posts?.length, 'The homepage preview must contain actual public posts');
    feed = data.posts.filter(post => post.mediaType !== 'video' && post.source !== 'mastodon' && !/crypto|token|solana/i.test(`${post.title || ''} ${post.author || ''}`));
    assert.ok(feed.length, 'Need healthy public posts for the homepage preview');
  }
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    app.users.find(user => user.id === 'preview-member').roleSettings = {
      feedLanguages: ['en'],
      feedSourceFavorites: { feed: ['mastodon', 'reddit'], following: ['bluesky', 'uficonnect'] },
    };
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 900 });
    const errors = [];
    const requests = [];
    await context.addInitScript(() => {
      window.__auditYouTubePlayers = [];
      window.YT = { PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 }, Player: class {
        constructor(host, options) {
          window.__auditYouTubePlayers.push(this);
          this.options = options;
          this.frame = document.createElement('iframe');
          this.frame.style.cssText = 'width:100%;height:100%;border:0';
          this.frame.srcdoc = '<body style="margin:0;background:#102A6B;color:white;display:grid;place-items:center;height:100vh">Video test frame</body>';
          host.replaceWith(this.frame);
          setTimeout(() => options.events.onReady({ target: this }), 10);
        }
        getIframe() { return this.frame; }
        loadVideoById() {}
        mute() {}
        unMute() {}
        playVideo() { this.state = 1; }
        pauseVideo() { this.state = 2; }
        getPlayerState() { return this.state; }
        getDuration() { return 45; }
        getCurrentTime() { return 2; }
        seekTo() {}
        destroy() { this.frame.remove(); }
      } };
    });
    const routeApi = async route => {
      const url = new URL(route.request().url());
      const endpoint = url.pathname.replace(/^\/(api|fallback)/, '');
      requests.push(endpoint);
      if (endpoint === '/office/feed') return route.fulfill({ json: { posts: feed, total: feed.length, hasMore: true, nextCursor: 'audit-next' } });
      if (endpoint.startsWith('/office/feed/videos')) return route.fulfill({ json: {
        posts: ['youtube', 'mastodon', 'reddit', 'devto'].map((source, i) => ({
          id: `audit-video-${i}`, source, title: `Preparation clip ${i + 1}`,
          content: 'Practical advice for preparing a clear professional introduction. '.repeat(8),
          sourceUrl: i % 3 === 0 ? 'https://www.youtube.com/watch?v=aaaaaaaaaaa' : 'https://example.org/clip',
          mediaType: 'video', mediaUrl: i % 3 === 0 ? 'https://www.youtube.com/watch?v=aaaaaaaaaaa' : base + 'media/preparation/professional-introduction.mp4',
          duration: 45, likesCount: 3, commentsCount: 1,
        })), hasMore: false,
      } });
      if (/^\/feed\/audit-video-\d+\/comments$/.test(endpoint)) return route.fulfill({ json: { comments: [], hasMore: false, live: false } });
      if (/events|stream/.test(endpoint)) return route.abort();
      if (endpoint === '/resume-builder/draft') return route.fulfill({ status: 503, json: { message: 'Storage temporarily unavailable' } });
      return route.continue();
    };
    await context.route('**/api/**', routeApi);
    await context.route('**/fallback/**', routeApi);
    const page = await context.newPage();
    await installAuditMember(page, app, 'preview-member');
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message));
    await auditNavigate(page, base);
    await page.locator('.feed-source-option').first().waitFor();
    await page.waitForFunction(() => !document.querySelector('.splash'));
    const buttons = page.locator('.feed-source-tabs--compact .feed-source-option');
    assert.equal(await buttons.count(), HOME_FEED_SOURCE_IDS.length);
    const visible = await buttons.evaluateAll(elements => {
      const parent = elements[0].parentElement.getBoundingClientRect();
      return elements.filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= parent.left - 1 && r.right <= parent.right + 1; }).length;
    });
    assert.ok(visible >= 3, `${viewport.width}: only ${visible} sources are visible`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), `Home overflows at ${viewport.width}`);
    await page.screenshot({ path: path.join(output, `home-${viewport.width}.png`) });
    if (process.argv.includes('--update-homepage') && viewport.width === 1440) {
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(root, 'web/public/homepage-feed-2026-09.png') });
      await context.close();
      console.log('Updated homepage preview from the current Home UI and public feed posts.');
      break;
    }
    checks += 3;

    async function checkSourceFavorites(feedName, sourceIds) {
      const mode = feedName === 'home' ? 'feed' : 'following';
      const otherMode = mode === 'feed' ? 'following' : 'feed';
      const before = (await app.request('/profile', { userId: 'preview-member' })).data;
      const expectedLabels = sourceIds.map(key => SOURCE_META[key]?.label || key).sort();
      assert.deepEqual((await buttons.evaluateAll(elements => elements.map(el => el.getAttribute('aria-label')))).sort(), expectedLabels);
      const favoriteLabels = before.roleSettings.feedSourceFavorites[mode].map(key => SOURCE_META[key]?.label || key);
      assert.deepEqual((await buttons.evaluateAll(elements => elements.map(el => el.getAttribute('aria-label')))).slice(0, favoriteLabels.length), favoriteLabels);
      await buttons.last().scrollIntoViewIfNeeded();
      assert.ok(await buttons.last().evaluate(el => {
        const bounds = el.getBoundingClientRect();
        const parent = el.parentElement.getBoundingClientRect();
        return bounds.left >= parent.left - 1 && bounds.right <= parent.right + 1;
      }), `Last ${feedName} source cannot be reached at ${viewport.width}`);
      await page.locator('.feed-source-tabs--compact').evaluate(el => { el.scrollLeft = 0; });
      // Fixed-size circles may all fit in a wide row; do not stretch them to
      // consume spare width. After scrolling back, the first must be reachable.
      assert.ok(await buttons.first().evaluate(el => {
        const bounds = el.getBoundingClientRect(), parent = el.parentElement.getBoundingClientRect();
        return bounds.left >= parent.left - 1 && bounds.right <= parent.right + 1;
      }), 'First source is clipped after resetting the source bar');
      const sourceMenu = page.getByRole('button', { name: 'View all feed sources', exact: true });
      await sourceMenu.click();
      const menuLabels = await page.locator('.feed-source-menu-item:not(.aggregate) .feed-source-option-label').allTextContents();
      assert.deepEqual(menuLabels.sort(), expectedLabels);
      const favorite = page.locator('.feed-source-favorite-button:not(.active)').first();
      const label = await favorite.getAttribute('aria-label');
      await favorite.hover();
      assert.equal(await favorite.evaluate(el => getComputedStyle(el).color), 'rgb(16, 42, 107)');
      await favorite.focus();
      assert.equal(await favorite.evaluate(el => getComputedStyle(el).borderTopColor), 'rgb(16, 42, 107)');
      await favorite.click();
      const selected = page.getByRole('button', { name: label.replace('Add to', 'Remove from'), exact: true });
      assert.equal(await selected.getAttribute('aria-pressed'), 'true');
      assert.deepEqual(await selected.evaluate(el => {
        const style = getComputedStyle(el);
        return [style.color, style.backgroundColor, style.borderTopColor];
      }), ['rgb(16, 42, 107)', 'rgb(232, 238, 249)', 'rgb(16, 42, 107)']);
      await page.screenshot({ path: path.join(output, `favorites-${feedName}-${viewport.width}.png`) });
      await selected.click();
      assert.equal(await page.getByRole('button', { name: label, exact: true }).getAttribute('aria-pressed'), 'false');
      await page.getByRole('button', { name: 'Clear favorites', exact: true }).click();
      assert.equal(await page.locator('.feed-source-favorite-button.active').count(), 0);
      assert.ok(await page.getByRole('button', { name: 'Clear favorites', exact: true }).isDisabled());
      const saved = page.waitForResponse(response => response.url().endsWith('/profile') && response.request().method() === 'PATCH');
      await page.getByRole('button', { name: 'Save favorites', exact: true }).click();
      assert.equal((await saved).status(), 200);
      await page.locator('.feed-source-menu').waitFor({ state: 'hidden' });
      // Feed selection now lives in memory. Preserve the requested route in
      // the URL while verifying that server-side favorites survive sign-in.
      await auditNavigate(page, base + `?feed=${mode}`);
      await auditReload(page);
      await buttons.first().waitFor();
      assert.equal(await buttons.count(), sourceIds.length);
      assert.equal(await page.locator('.feed-source-compact-favorite').count(), 0);
      const after = (await app.request('/profile', { userId: 'preview-member' })).data;
      assert.deepEqual(after.roleSettings.feedSourceFavorites[mode], []);
      assert.deepEqual(after.roleSettings.feedSourceFavorites[otherMode], before.roleSettings.feedSourceFavorites[otherMode]);
      assert.deepEqual(after.roleSettings.feedLanguages, ['en']);
      assert.deepEqual((await app.request('/profile', { userId: 'other-member' })).data.roleSettings.feedSourceFavorites, { feed: ['github'], following: ['reddit'] });
      await sourceMenu.click();
      assert.ok(await page.getByRole('button', { name: 'Clear favorites', exact: true }).isDisabled());
      assert.ok(await page.getByRole('button', { name: 'Save favorites', exact: true }).isDisabled());
      await page.screenshot({ path: path.join(output, `favorites-cleared-${feedName}-${viewport.width}.png`) });
      await sourceMenu.click();
      checks += 21;
    }
    await checkSourceFavorites('home', HOME_FEED_SOURCE_IDS);

    const menu = page.getByRole('button', { name: 'Open menu', exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole('button', { name: 'Following', exact: true }).filter({ visible: true }).first().click();
    await page.waitForFunction(count => document.querySelectorAll('.feed-source-tabs--compact .feed-source-option').length === count, FOLLOWING_FEED_SOURCE_IDS.length);
    assert.equal(await buttons.count(), FOLLOWING_FEED_SOURCE_IDS.length);
    checks++;
    await checkSourceFavorites('following', FOLLOWING_FEED_SOURCE_IDS);
    if (process.argv.includes('--favorites-only')) {
      assert.deepEqual(errors, [], `${viewport.width}: browser runtime errors`);
      await context.close();
      console.log(`PASS: source favorites at ${viewport.width}px`);
      continue;
    }
    await page.mouse.move(0, 0);
    await auditNavigate(page, base + 'videos');
    const videoScroll = page.locator('.video-feed-scroll');
    await page.locator('[data-post-id="audit-video-0"]').waitFor();
    const frame = await page.locator('.video-feed-frame').boundingBox();
    await page.locator('.video-feed-youtube-player iframe').waitFor();
    await page.waitForFunction(() => window.__auditYouTubePlayers.some(player => player.getPlayerState() === 1));
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 3);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    assert.ok(await page.evaluate(() => window.__auditYouTubePlayers.some(player => player.getPlayerState() === 1)), 'YouTube in Videos keeps playing after the pointer leaves');
    assert.equal(await page.locator('.video-feed-youtube-player iframe').evaluate(el => getComputedStyle(el).pointerEvents), 'auto', 'Official player controls remain usable inside the media area');
    const firstSlide = page.locator('[data-post-id="audit-video-0"]');
    assert.ok(await firstSlide.getByRole('group', { name: 'Video engagement' }).isVisible());
    const original = firstSlide.getByRole('link', { name: /View original post/ });
    assert.ok(await original.isVisible());
    const clickable = await original.evaluate(el => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    assert.ok(clickable, `Original link is covered at ${viewport.width}`);
    await firstSlide.getByRole('button', { name: /Comments/ }).click();
    await page.getByRole('button', { name: 'Close comments' }).click();
    await firstSlide.getByRole('button', { name: 'Next video', exact: true }).click();
    try {
      await page.waitForFunction(() => document.querySelector('.video-feed-scroll').scrollTop > 100);
    } catch (error) {
      await page.screenshot({ path: path.join(output, `video-scroll-failure-${viewport.width}.png`) });
      throw error;
    }
    await videoScroll.evaluate(el => el.scrollTo(0, el.clientHeight));
    const native = page.locator('[data-post-id="audit-video-1"] video');
    await native.waitFor();
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => {
      const video = document.querySelector('[data-post-id="audit-video-1"] video');
      return video && !video.paused && video.currentTime > 0;
    });
    assert.ok(await page.evaluate(() => window.__auditYouTubePlayers.every(player => player.getPlayerState() !== 1)), 'The previous YouTube slide pauses after scrolling');
    assert.equal(await native.evaluate(el => getComputedStyle(el).objectFit), 'contain');
    await page.screenshot({ path: path.join(output, `videos-${viewport.width}.png`) });
    checks += 5;
    await page.screenshot({ path: path.join(output, `following-${viewport.width}.png`) });

    await auditNavigate(page, base + 'onboarding');
    await page.getByRole('heading', { name: 'What best describes you?' }).waitFor();
    assert.equal(await page.getByText('Goals', { exact: true }).count(), 0);
    await page.getByRole('button', { name: /Software Engineer/ }).first().click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('heading', { name: "What's your experience level?" }).waitFor();
    await page.getByRole('button', { name: /Mid-level/ }).click();
    await page.getByRole('button', { name: 'Finish setup' }).click();
    await page.locator('.feed-source-tabs--compact').waitFor();
    checks++;

    await auditNavigate(page, base + 'resume-builder');
    await page.getByRole('button', { name: 'Try again', exact: true }).waitFor({ timeout: 20000 });
    assert.equal(await page.getByRole('button', { name: /Save all changes/i }).count(), 0);
    checks++;
    for (const route of ['profile', 'settings', 'connected-accounts', 'command-center', 'groups', 'search', 'opportunities']) {
      await auditNavigate(page, base + route);
      await page.waitForTimeout(450);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), `${route} overflows at ${viewport.width}`);
      checks++;
    }
    await auditNavigate(page, base + 'register');
    await page.locator('input[name="name"]').fill('Test Member');
    await page.locator('input[name="email"]').fill('member@example.invalid');
    await page.locator('input[name="password"]').fill('test-only-password');
    await page.locator('input[name="confirmPassword"]').fill('test-only-password');
    assert.equal(await page.locator('input[name="phone"]').inputValue(), '');
    await page.getByRole('button', { name: /^Continue/ }).click();
    await page.getByRole('heading', { name: 'Who are you professionally?' }).waitFor();
    checks++;
    await auditNavigate(page, base + '?audit-public=1');
    const homepageImage = page.locator('.landing-product-shot img');
    await homepageImage.scrollIntoViewIfNeeded();
    const dimensions = await homepageImage.evaluate(async image => {
      await image.decode();
      const box = image.getBoundingClientRect();
      return { rendered: box.width / box.height, original: image.naturalWidth / image.naturalHeight };
    });
    assert.ok(Math.abs(dimensions.rendered - dimensions.original) < 0.01, `Homepage image stretched at ${viewport.width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await page.screenshot({ path: path.join(output, `landing-${viewport.width}.png`) });
    checks += 2;
    assert.deepEqual(errors, [], `${viewport.width}: browser runtime errors`);
    await context.close();
    console.log(`PASS: responsive flows at ${viewport.width}px`);
  }
  if (!process.argv.includes('--update-homepage')) console.log(`PASS: ${checks} UI checks across desktop, tablet, and mobile; screenshots in .cache/audit-ui`);
} finally {
  await browser?.close();
  await server.close();
  await app.close();
}
