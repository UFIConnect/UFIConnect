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

let browser;
try {
  await server.listen(); browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
  for(const width of [390,320,1440]) {
    const memberId = `following-browser-${width}`;
    app.seedUser(member(memberId, { socialTokens: { github: 'fixture-following-token' } }));
    const mobile = width < 600;
    const context=await browser.newContext({viewport:{width,height:850},isMobile:mobile,hasTouch:mobile,colorScheme:mobile?'dark':'light'});
    const page=await context.newPage(); page.setDefaultTimeout(20000); const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    let recovered = false;
    let homeRecovered = false;
    let snapStatus = 'provider-errors';
    let videoRefreshed = false;
    const sourceErrors = { github: 'HTTP 401 from https://provider.example.test/feed?key=fixture-secret' };
    const blueskyError = 'Bluesky access expired. Reconnect Bluesky.';
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
    assert.deepEqual(errors,[]);
    console.log(`PASS Home and Following source failure and recovery at ${width}px`); await context.close();
  }
} finally {await browser?.close();await server.close();await app.close();}
