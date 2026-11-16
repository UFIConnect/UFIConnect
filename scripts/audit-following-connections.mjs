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
const app=await createAppHarness(); app.seedUser(member('following-browser', { socialTokens: { github: 'fixture-following-token' } }));
const server=await createServer({root:path.join(root,'web'),configFile:path.join(root,'web/vite.config.js'),envDir:false,
  define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},
  server:{host:'127.0.0.1',port:5248,strictPort:false,proxy:{'/api':{target:app.base,rewrite:p=>p.replace(/^\/api/,'')}}}});
let browser;
try {
  await server.listen(); browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
  for(const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:850},isMobile:width<600,hasTouch:width<600});
    const page=await context.newPage(); page.setDefaultTimeout(20000); const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    let recovered = false;
    let snapStatus = 'provider-errors';
    let videoRetries = 0;
    const sourceErrors = { github: 'HTTP 401 from https://provider.example.test/feed?key=fixture-secret' };
    await context.route('**/api/**',async route=>{
      const url=new URL(route.request().url()),endpoint=url.pathname.replace(/^\/api/,'');
      if(/events|stream/.test(endpoint))return route.abort();
      if (endpoint === '/snaps' && url.searchParams.get('mode') === 'following') {
        if (snapStatus === 'offline') return route.fulfill({ status: 503, json: { message: 'Snaps are unavailable.' } });
        return route.fulfill({ json: {
          snaps: [],
          sourceErrors: snapStatus === 'provider-errors' ? { github: 'Reconnect this account.', twitch: 'Refresh to try again.' } : {},
        } });
      }
      if (endpoint === '/office/feed/videos/following') {
        if (url.searchParams.get('bust') === '1') videoRetries++;
        return route.fulfill({ json: {
          posts: videoRetries ? [{
            id: 'followed-video', source: 'uficonnect', title: 'A followed video', mediaType: 'video',
            mediaUrl: `${url.origin}/media/preparation/professional-introduction.mp4`, duration: 27,
          }] : [],
          hasMore: false, sourceErrors: videoRetries < 2 ? sourceErrors : {},
        } });
      }
      if(endpoint!=='/office/feed')return route.continue();
      return route.fulfill({json:{posts:recovered?[{id:'recovered-post',source:'github',title:'Recovered followed account update',content:'An update from a developer you follow.',author:{name:'Followed developer'},createdAt:new Date().toISOString(),sourceUrl:'https://github.com/UFIConnect/UFIConnect'}]:[],hasMore:false,nativeUficonnectIncluded:true,sourceErrors:recovered?{}:{ ...sourceErrors, youtube: 'Reconnect this account.' }}});
    });
    await installAuditMember(page,app,'following-browser');
    await auditNavigate(page,server.resolvedUrls.local[0]+'?feed=following');
    const notice=page.getByRole('status').filter({hasText:'Some connected feeds could not sync'});
    const providers = notice.locator('p').filter({ hasText: 'GitHub' }).filter({ hasText: 'Twitch' }).filter({ hasText: 'YouTube' });
    await providers.waitFor();
    const snaps = page.getByRole('region', { name: 'Snaps', exact: true });
    assert.equal(await notice.count(), 1, 'Post and Snap failures use a single notice');
    assert.equal((await providers.innerText()).match(/GitHub/g).length, 1, 'A provider appears once');
    assert.equal(await page.getByRole('status', { name: 'Snap source availability' }).count(), 0);
    assert.equal(await notice.getByRole('link',{name:'Manage connected accounts'}).getAttribute('href'),'/connected-accounts');
    await notice.getByText('Sync details', { exact: true }).click();
    await notice.getByText(/GitHub.*Reconnect this account to resume syncing/).waitFor();
    assert.doesNotMatch(await notice.innerText(), /fixture-secret|provider\.example\.test/);
    assert.equal(await page.getByText('No posts from people you follow yet',{exact:true}).count(),0);
    const bounds=await notice.boundingBox(); assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);
    assert.ok(bounds.y + bounds.height <= (await snaps.boundingBox()).y, 'The sync notice stays above Snaps');
    await page.getByRole('group',{name:'Following sources',exact:true}).getByRole('button',{name:'GitHub',exact:true}).click();
    await notice.waitFor();
    assert.equal(await notice.count(),1);
    assert.equal(await page.getByText(/Couldn't load GitHub|No posts from GitHub yet/).count(),0);
    recovered = true;
    snapStatus = 'offline';
    const isRetry = (requestUrl, endpoint) => {
      const url = new URL(requestUrl);
      return url.pathname === `/api/${endpoint}` && url.searchParams.get('mode') === 'following' && url.searchParams.get('bust') === '1';
    };
    const retrySync = notice.getByRole('button', { name: 'Retry sync', exact: true });
    await Promise.all([
      page.waitForRequest(request => isRetry(request.url(), 'office/feed')),
      page.waitForRequest(request => isRetry(request.url(), 'snaps')),
      retrySync.click(),
    ]);
    await page.getByText('Recovered followed account update',{exact:true}).first().waitFor();
    await notice.locator('p').filter({ hasText: /^Snaps$/ }).waitFor();
    assert.equal(await notice.count(), 1, 'A full Snap outage also uses the top notice');
    assert.equal(await snaps.getByRole('alert').count(), 0);
    assert.equal(await snaps.getByText(/UFI snaps could not load/).count(), 0);
    snapStatus = 'ready';
    await Promise.all([
      page.waitForResponse(response => response.ok() && isRetry(response.url(), 'snaps')),
      retrySync.click(),
    ]);
    await notice.waitFor({ state: 'detached' });
    await auditNavigate(page,server.resolvedUrls.local[0]+'videos');
    const videos=page.locator('.video-feed-view');
    await videos.getByRole('button',{name:'Following',exact:true}).click();
    await videos.getByText('Some connected feeds could not sync',{exact:true}).waitFor();
    assert.equal(await videos.getByText('Some connected feeds could not sync',{exact:true}).count(),1);
    assert.equal(await videos.locator('.video-feed-empty').count(),0);
    const videoNotice = videos.getByRole('status').filter({ hasText: 'Some connected feeds could not sync' });
    await videoNotice.getByRole('button', { name: 'Retry sync', exact: true }).click();
    await videos.locator('[data-post-id="followed-video"]').waitFor();
    await videoNotice.waitFor();
    assert.equal(await videoNotice.count(), 1, 'Partial sync failures are visible alongside playable videos');
    await videoNotice.getByRole('button', { name: 'Retry sync', exact: true }).click();
    await videoNotice.waitFor({ state: 'detached' });
    assert.deepEqual(errors,[]);
    console.log(`PASS Following failure and recovery at ${width}px`); await context.close();
  }
} finally {await browser?.close();await server.close();await app.close();}
