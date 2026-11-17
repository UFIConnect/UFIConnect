import { installAuditMember, auditNavigate } from './audit-session.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
const require=createRequire(import.meta.url);
const {createAppHarness,member}=require('../backend/test-support/app-harness');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=await createAppHarness();
const server=await createServer({root:path.join(root,'web'),configFile:path.join(root,'web/vite.config.js'),envDir:false,
  define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},
  server:{host:'127.0.0.1',port:5248,strictPort:false,proxy:{'/api':{target:app.base,rewrite:p=>p.replace(/^\/api/,'')}}}});

async function checkCompactBanner(notice, snaps, width, sourceName) {
  const summary = notice.locator('summary');
  const status = summary.getByText('Sync issue', { exact: true });
  const sources = summary.getByText(sourceName);
  await status.waitFor();
  await sources.waitFor();
  assert.equal(await notice.locator('details[open]').count(), 0, 'Details start collapsed');
  const bounds = await notice.boundingBox();
  const snapProfiles = await snaps.getByRole('region', { name: 'Snap source profiles', exact: true }).boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.height <= 32,
    'The collapsed banner fits within 32 pixels');
  assert.ok((await summary.boundingBox()).height >= 30, 'The full row is a tap target');
  assert.ok(Math.abs((await status.boundingBox()).y - (await sources.boundingBox()).y) < 2,
    'The status and affected sources stay on the same line');
  assert.ok(bounds.y + bounds.height <= snapProfiles.y, 'The banner sits above the Snap profiles');
}

const fixturePoster = 'https://following-media.example.test/preview.png';
const fixtureMedia = 'https://following-media.example.test/clip.mp4';
const fixtureHls = 'https://following-media.example.test/clip.m3u8';
const mixedVideos = {
  youtube: { sourceUrl: 'https://www.youtube.com/watch?v=aqa4ImSdzoY' },
  twitch: { sourceUrl: 'https://clips.twitch.tv/AuditFollowedClip', mediaPoster: 'https://static-cdn.jtvnw.net/preview.jpg' },
  mastodon: { sourceUrl: 'https://mastodon.social/@followed/123456', mediaUrl: fixtureMedia, mediaPoster: fixturePoster },
  bluesky: { sourceUrl: 'https://bsky.app/profile/followed.bsky.social/post/3auditclip', mediaUrl: fixtureHls, mediaPoster: fixturePoster },
  reddit: { sourceUrl: 'https://www.reddit.com/r/videos/comments/abc123/followed_clip/', mediaUrl: 'https://v.redd.it/abc123/DASH_720.mp4', mediaPoster: fixturePoster },
  twitter: { sourceUrl: 'https://x.com/followed/status/123456', mediaPoster: fixturePoster, visibility: 'followers' },
};
const preparedMedia = name => path.join(root, 'web/public/media/preparation', `professional-introduction.${name}`);

async function checkMixedVideos(page, videos, mobile) {
  for (const source of Object.keys(mixedVideos)) {
    await videos.locator(`[data-post-id="following-video-${source}"]`).waitFor({ state: 'attached' });
  }
  let selection = null;
  async function filterSource(label, source) {
    await videos.getByRole('button', { name: 'Filter videos', exact: true }).click();
    if (selection) await videos.getByRole('button', { name: 'Clear platforms', exact: true }).click();
    selection = label;
    const selectedPage = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/office/feed/videos/following' && url.searchParams.get('source') === source;
    });
    await videos.getByRole('button', { name: `${label}: Connected`, exact: true }).click();
    await videos.getByRole('button', { name: 'Done', exact: true }).first().click();
    const response = await selectedPage;
    assert.equal(response.status(), 200, label);
    assert.deepEqual((await response.json()).posts.map(post => post.id), [`following-video-${source}`], label);
    const slide = videos.locator(`[data-idx="0"][data-post-id="following-video-${source}"]`);
    await slide.waitFor({ state: 'attached' });
    return slide;
  }
  const twitch = await filterSource('Twitch', 'twitch');
  if (mobile) {
    const play = twitch.getByRole('link', { name: 'Play Twitch clip', exact: true });
    assert.match(await play.getAttribute('href'), /\/twitch-player\.html\?clip=AuditFollowedClip$/);
    assert.equal(await twitch.locator('iframe').count(), 0);
  } else {
    // The active desktop clip opens automatically. Its Play button can
    // appear briefly before the provider frame replaces it.
    const iframe = twitch.locator('iframe');
    await iframe.waitFor();
    const src = new URL(await iframe.getAttribute('src'));
    assert.equal(src.origin, 'https://clips.twitch.tv');
    assert.equal(src.searchParams.get('parent'), '127.0.0.1');
    const bounds = await iframe.boundingBox();
    assert.ok(bounds.width >= 400 && bounds.height >= 300, 'Twitch controls fit at their required size');
  }
  const mastodon = await filterSource('Mastodon', 'mastodon');
  const player = mastodon.locator('video');
  await player.waitFor();
  assert.equal(await player.getAttribute('src'), fixtureMedia);
  await page.waitForFunction(() => document.querySelector('[data-idx="0"] video')?.readyState >= 2);
  assert.equal(await videos.locator('iframe[src^="https://clips.twitch.tv"]').count(), 0);
  const reddit = await filterSource('Reddit', 'reddit');
  const watchOnReddit = reddit.getByRole('link', { name: /Watch on Reddit/ });
  assert.equal(await watchOnReddit.getAttribute('href'), mixedVideos.reddit.sourceUrl);
  await reddit.getByRole('button', { name: 'Load Reddit player', exact: true }).click();
  await reddit.locator('iframe[src^="https://www.redditmedia.com/"]').waitFor();
  await reddit.getByRole('button', { name: 'Close Reddit player', exact: true }).click();
  await watchOnReddit.waitFor();
  const twitter = await filterSource('X (Twitter)', 'twitter');
  const watchOnX = twitter.getByRole('link', { name: /Watch on X/ });
  assert.equal(await watchOnX.getAttribute('href'), mixedVideos.twitter.sourceUrl);
  assert.equal(await watchOnX.locator('img').getAttribute('src'), fixturePoster);
  assert.equal(await twitter.locator('video, iframe').count(), 0);
  const failedBlueskyRead = page.waitForResponse(response => response.url() === fixtureHls && response.status() === 410);
  const bluesky = await filterSource('Bluesky', 'bluesky');
  await failedBlueskyRead;
  const watchOnBluesky = bluesky.getByRole('link', { name: /Watch on Bluesky/ });
  assert.equal(await watchOnBluesky.getAttribute('href'), mixedVideos.bluesky.sourceUrl);
}

let browser;
try {
  await server.listen(); browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
  for(const width of [390,320,1440]) {
    const memberId = `following-browser-${width}`;
    app.seedUser(member(memberId, { socialTokens: { github: 'fixture-following-token',
      ...Object.fromEntries(Object.keys(mixedVideos).map(source => [source, `fixture-${source}`])) } }));
    const mobile = width < 600;
    const context=await browser.newContext({viewport:{width,height:850},isMobile:mobile,hasTouch:mobile,colorScheme:mobile?'dark':'light'});
    const page=await context.newPage(); page.setDefaultTimeout(20000); const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    let recovered = false;
    let homeRecovered = false;
    let snapStatus = 'provider-errors';
    let videoRefreshed = false;
    let checkSourceMix = false;
    const sourceErrors = { github: 'HTTP 401 from https://provider.example.test/feed?key=fixture-secret' };
    const blueskyError = 'Bluesky access expired. Reconnect Bluesky.';
    await context.route('https://following-media.example.test/**', route => {
      const url = route.request().url();
      if (url === fixtureHls) return route.fulfill({ status: 410, headers: { 'access-control-allow-origin': '*' } });
      return route.fulfill({ path: preparedMedia(url === fixtureMedia ? 'mp4' : 'png') });
    });
    await context.route(/https:\/\/(clips\.twitch\.tv|www\.redditmedia\.com)\//, route =>
      route.fulfill({ contentType: 'text/html', body: '<p>Synthetic provider player</p>' }));
    await context.route('**/api/**',async route=>{
      const url=new URL(route.request().url()),endpoint=url.pathname.replace(/^\/api/,'');
      if(/events|stream/.test(endpoint))return route.abort();
      const mode = url.searchParams.get('mode');
      if (endpoint === '/snaps' && (mode === 'following' || mode === 'home')) {
        if (mode === 'following' && snapStatus === 'offline') {
          return route.fulfill({ status: 503, json: { message: 'Snaps are unavailable.' } });
        }
        const errors = mode === 'home'
          ? homeRecovered ? {} : { twitch: 'Public clips are temporarily unavailable.' }
          : snapStatus === 'provider-errors' ? { bluesky: blueskyError, twitch: 'Refresh to try again.' } : {};
        return route.fulfill({ json: {
          snaps: [{ id: 'surviving-snap', source: 'youtube', author: { name: 'Followed channel' }, mediaType: 'video',
            mediaUrl: 'https://www.youtube.com/watch?v=aqa4ImSdzoY', expiresAt: new Date(Date.now() + 3600000).toISOString() }],
          sourceErrors: errors,
        } });
      }
      if (endpoint === '/office/feed/videos/following') {
        if (checkSourceMix) return route.continue();
        if (url.searchParams.get('bust') === '1') videoRefreshed = true;
        return route.fulfill({ json: {
          posts: videoRefreshed ? [{
            id: 'followed-video', source: 'uficonnect', title: 'A followed video', mediaType: 'video',
            mediaUrl: `${url.origin}/media/preparation/professional-introduction.mp4`, duration: 27,
          }] : [],
          hasMore: false, sourceErrors: { bluesky: blueskyError },
        } });
      }
      if (endpoint === '/feed/refresh') return route.fulfill({ json: { ok: true } });
      if(endpoint!=='/office/feed')return route.continue();
      if (mode === 'feed') return route.fulfill({
        json: { posts: [], hasMore: false, sourceErrors: homeRecovered ? {} : { reddit: 'Timed out.', twitch: 'Timed out.' } },
      });
      const following = mode === 'following';
      const selected = url.searchParams.has('source');
      const posts = following && (recovered || !selected) ? [{
        id: recovered ? 'recovered-post' : 'surviving-post', source: 'github',
        title: recovered ? 'Recovered followed account update' : 'An available followed post',
        content: 'An update from a developer you follow.', author: { name: 'Followed developer' },
        createdAt: new Date().toISOString(), sourceUrl: 'https://github.com/UFIConnect/UFIConnect',
      }] : [];
      return route.fulfill({ json: { posts, hasMore: false, nativeUficonnectIncluded: true,
        sourceErrors: following && !recovered ? (selected ? sourceErrors : { ...sourceErrors, bluesky: 'HTTP 401: expired token' }) : {} } });
    });
    await installAuditMember(page,app,memberId);
    await auditNavigate(page,server.resolvedUrls.local[0]+'?feed=following');
    const snaps = page.getByRole('region', { name: 'Snaps', exact: true });
    const allNotices = page.getByRole('status', { name: 'Snap source availability', exact: true });
    const notice = snaps.getByRole('status', { name: 'Snap source availability', exact: true });
    const summary = notice.locator('summary');
    const borderedCard = page.getByText('Some connected feeds could not sync', { exact: true });
    await page.getByText('An available followed post', { exact: true }).first().waitFor();
    assert.equal(await borderedCard.count(), 0, 'Following never renders the bordered sync card');
    await checkCompactBanner(notice, snaps, width, /Twitch/);
    assert.equal(await allNotices.count(), 1, 'Post and Snap failures use a single notice');
    if (mobile) await summary.tap();
    else {
      await summary.focus();
      await page.keyboard.press('Enter');
    }
    const reasons = notice.locator('ul');
    await reasons.waitFor();
    assert.equal(await reasons.locator('li').count(), 3);
    assert.equal(await reasons.getByText('Bluesky', { exact: true }).count(), 1, 'Bluesky appears once across both APIs');
    assert.match(await notice.innerText(), /Bluesky access expired\. Reconnect Bluesky\./);
    assert.equal(await notice.getByRole('link',{name:'Manage connected accounts'}).getAttribute('href'),'/connected-accounts');
    await notice.getByText(/GitHub.*Reconnect this account to resume syncing/).waitFor();
    assert.doesNotMatch(await notice.innerText(), /fixture-secret|provider\.example\.test/);
    assert.equal(await page.getByText('No posts from people you follow yet',{exact:true}).count(),0);
    assert.ok(await notice.evaluate(element => element.scrollWidth <= element.clientWidth + 1),
      'Expanded details stay within the banner');
    await page.getByRole('group',{name:'Following sources',exact:true}).getByRole('button',{name:'GitHub',exact:true}).click();
    await page.getByText('An available followed post', { exact: true }).first().waitFor({ state: 'detached' });
    await notice.waitFor();
    assert.equal(await allNotices.count(),1);
    assert.equal(await borderedCard.count(), 0);
    assert.equal(await page.getByText(/Couldn't load GitHub|No posts from GitHub yet/).count(),0);
    recovered = true;
    snapStatus = 'offline';
    const isRetry = (requestUrl, endpoint, mode = 'following') => {
      const url = new URL(requestUrl);
      return url.pathname === `/api/${endpoint}` && url.searchParams.get('mode') === mode && url.searchParams.get('bust') === '1';
    };
    const retrySync = notice.getByRole('button', { name: 'Retry sync', exact: true });
    await Promise.all([
      page.waitForRequest(request => isRetry(request.url(), 'office/feed')),
      page.waitForRequest(request => isRetry(request.url(), 'snaps')),
      retrySync.click(),
    ]);
    await page.getByText('Recovered followed account update',{exact:true}).first().waitFor();
    await summary.getByText('Snaps', { exact: true }).waitFor();
    assert.equal(await allNotices.count(), 1, 'A full Snap outage also uses the top notice');
    assert.equal(await snaps.getByRole('alert').count(), 0);
    assert.equal(await snaps.getByText(/UFI snaps could not load/).count(), 0);
    snapStatus = 'ready';
    if (!(await retrySync.isVisible())) await summary.click();
    await Promise.all([
      page.waitForResponse(response => response.ok() && isRetry(response.url(), 'snaps')),
      retrySync.click(),
    ]);
    await notice.waitFor({ state: 'detached' });

    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=feed');
    await page.getByRole('group', { name: 'Home sources', exact: true }).waitFor();
    await checkCompactBanner(notice, snaps, width, /Reddit, Twitch/);
    assert.equal(await allNotices.count(), 1, 'Home also combines post and Snap failures');
    await summary.click();
    await notice.getByText(/Twitch.*Public clips are temporarily unavailable/).waitFor();
    assert.equal(await reasons.locator('li').count(), 2, 'Home shows each affected source once');
    assert.equal(await notice.getByRole('link', { name: 'Manage connected accounts' }).count(), 0);
    homeRecovered = true;
    await Promise.all([
      page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.ok() && url.pathname === '/api/office/feed' && url.searchParams.get('mode') === 'feed';
      }),
      page.waitForResponse(response => response.ok() && isRetry(response.url(), 'snaps', 'home')),
      retrySync.click(),
    ]);
    await notice.waitFor({ state: 'detached' });

    await auditNavigate(page,server.resolvedUrls.local[0]+'videos');
    const videos = page.locator('.video-feed-view');
    const following = videos.getByRole('button', { name: 'Following', exact: true, pressed: true });
    await videos.getByRole('button', { name: 'Following', exact: true }).click();
    await following.waitFor();
    await videos.getByText(/No playable videos of at least 5 seconds found/).waitFor();
    assert.equal(await borderedCard.count(), 0, 'Empty Following Videos uses the normal empty state');

    await videos.getByRole('button', { name: 'Refresh videos', exact: true }).click();
    await videos.locator('[data-post-id="followed-video"] video').waitFor();
    assert.equal(await borderedCard.count(), 0, 'Available videos render without a sync banner');
    for (const [source, media] of Object.entries(mixedVideos)) {
      app.setFollowingFetcher(source, async token => {
        assert.equal(token, `fixture-${source}`);
        return [{
          source, id: `following-video-${source}`, authorId: `followed-${source}`,
          title: `A followed ${source} video`, content: 'A short update from a followed creator.',
          author: { id: `followed-${source}`, name: 'Followed creator' },
          mediaType: 'video', videoDurationSeconds: 45, isExternal: true, visibility: 'public',
          createdAt: new Date(Date.now() - 60000).toISOString(), ...media,
        }];
      });
    }
    checkSourceMix = true;
    await videos.getByRole('button', { name: 'Videos', exact: true }).click();
    const mixedPage = page.waitForResponse(response => new URL(response.url()).pathname === '/api/office/feed/videos/following');
    await videos.getByRole('button', { name: 'Following', exact: true }).click();
    const response = await mixedPage;
    assert.equal(response.status(), 200);
    const mixedResult = await response.json();
    assert.deepEqual(mixedResult.posts.map(post => post.source).sort(), Object.keys(mixedVideos).sort());
    await checkMixedVideos(page, videos, mobile);
    assert.deepEqual(errors,[]);
    console.log(`PASS Home and Following source recovery and mixed video playback at ${width}px`); await context.close();
  }
} finally {await browser?.close();await server.close();await app.close();}
