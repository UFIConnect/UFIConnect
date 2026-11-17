import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { auditNavigate, installAuditMember } from './audit-session.mjs';

const { createAppHarness, member } = createRequire(import.meta.url)('../backend/test-support/app-harness');
const app = await createAppHarness();
const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
const server = await createServer({
  root: webRoot, envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 0, hmr: false, proxy: { '/api': { target: app.base, rewrite: path => path.slice(4) } } },
});
const sources = ['mastodon', 'bluesky'];
const sourceUrls = {
  mastodon: 'https://mastodon.social/@creator/123',
  bluesky: 'https://bsky.app/profile/creator.bsky.social/post/clip1',
};
function sourcePost(source, revision, clip = false) {
  return { id: `${source}-${revision}-${clip ? 'clip' : 'post'}`, source, sourceUrl: sourceUrls[source],
    authorId: `${source}-author`, author: { name: `${source} author` },
    title: `${revision} ${source} update`, content: 'A useful update from a followed account.',
    createdAt: new Date(Date.now() - 1000).toISOString(), isExternal: true,
    ...(clip ? { mediaType: 'video', mediaUrl: 'https://media.example.com/clip.mp4', videoDurationSeconds: 30 } : {}) };
}

async function gesture(rail, mobile) {
  await rail.locator('.snap-source-heading').first().evaluate((target, touch) => {
    if (!touch) {
      target.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
      return;
    }
    const at = y => new Touch({ identifier: 1, target, clientX: 60, clientY: y });
    target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [at(100)] }));
    target.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [at(182)] }));
    target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [at(182)] }));
  }, mobile);
}

let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [1440, 390]) {
    const mobile = width < 600;
    const viewerId = `snap-refresh-${width}`;
    app.seedUser(member(viewerId, { socialTokens: { mastodon: 'fixture', bluesky: 'fixture' } }));
    const counts = { mastodon: 0, bluesky: 0 };
    const started = Promise.withResolvers(), release = Promise.withResolvers();
    let failed = true;
    for (const source of sources) {
      app.seedFollowingCache(viewerId, source, { fetchedAt: Date.now(),
        posts: [sourcePost(source, 'old'), sourcePost(source, 'old', true)] });
      app.setFollowingFetcher(source, async (_token, { bust }) => {
        assert.equal(bust, true);
        counts[source]++;
        if (sources.every(key => counts[key] > 0)) started.resolve();
        await release.promise;
        if (source === 'bluesky' && failed) throw new Error('Bluesky is temporarily unavailable.');
        return [sourcePost(source, 'fresh'), sourcePost(source, 'fresh', true)];
      });
    }
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: mobile, isMobile: mobile, serviceWorkers: 'block' });
    try {
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(origin).origin || /\/(feed\/stream|notifications\/stream)$/.test(url.pathname)) return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      await installAuditMember(page, app, viewerId);
      const forcedReads = [];
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.searchParams.get('bust') === '1') forcedReads.push(url);
      });
      await auditNavigate(page, new URL('?feed=following&source=mastodon', origin).href);
      const rail = page.locator('.snap-rail[data-snap-mode="following"]');
      const tile = id => rail.locator(`[data-snap-ids*='"${id}"']`);
      const indicator = page.getByRole('status', { name: 'Refreshing feed', exact: true });
      const notice = rail.getByRole('status', { name: 'Snap source availability' });
      await tile('mastodon-old-clip').waitFor();
      await tile('bluesky-old-clip').waitFor();
      await page.getByRole('link', { name: /old mastodon update/i }).first().waitFor();
      assert.deepEqual(counts, { mastodon: 0, bluesky: 0 });
      assert.equal(await rail.getByRole('button', { name: /^Refresh .* snaps$/i }).count(), 0);

      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await gesture(rail, mobile);
      await indicator.waitFor();
      await Promise.race([started.promise, page.waitForTimeout(10000).then(() => assert.fail('Both providers did not start'))]);
      assert.equal(await rail.getByRole('region', { name: 'Snap source profiles' }).getAttribute('aria-busy'), 'true');
      await gesture(rail, mobile);
      await gesture(rail, mobile);
      await page.evaluate(() => window.dispatchEvent(new Event('ufi:refresh-selected-feed')));
      assert.equal(forcedReads.length, 1);
      assert.equal(forcedReads[0].pathname, '/api/office/feed');
      assert.equal(forcedReads[0].searchParams.get('includeSnaps'), '1');
      assert.equal(forcedReads[0].searchParams.get('source'), 'mastodon');
      assert.deepEqual(counts, { mastodon: 1, bluesky: 1 });
      assert.equal(await indicator.isVisible(), true);

      const filteredRead = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api/office/feed' && url.searchParams.get('mode') === 'following'
          && url.searchParams.get('source') === 'bluesky' && !url.searchParams.has('bust');
      });
      await auditNavigate(page, new URL('?feed=following&source=bluesky', origin).href);
      await filteredRead;
      await page.getByRole('link', { name: /old bluesky update/i }).first().waitFor();
      assert.equal(await rail.getByRole('region', { name: 'Snap source profiles' }).getAttribute('aria-busy'), 'true');
      release.resolve();
      await tile('mastodon-fresh-clip').waitFor();
      assert.equal(await page.getByRole('link', { name: /fresh mastodon update/i }).count(), 0);
      assert.equal(await tile('bluesky-old-clip').count(), 1);
      await notice.getByText('Bluesky', { exact: true }).first().waitFor();
      await indicator.waitFor({ state: 'hidden' });

      failed = false;
      await page.waitForTimeout(1600);
      await gesture(rail, mobile);
      await tile('bluesky-fresh-clip').waitFor();
      await page.getByRole('link', { name: /fresh bluesky update/i }).first().waitFor();
      await notice.waitFor({ state: 'detached' });
      assert.equal(forcedReads.length, 2);
      assert.ok(forcedReads.every(url => url.pathname === '/api/office/feed' && url.searchParams.get('includeSnaps') === '1'));
      assert.equal(forcedReads[1].searchParams.get('source'), 'bluesky');
      assert.deepEqual(counts, { mastodon: 2, bluesky: 2 });
      console.log(`PASS Following Snap refresh at ${width}px (${mobile ? 'touch' : 'wheel'})`);
    } finally {
      release.resolve();
      await context.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
  await app.close();
}
