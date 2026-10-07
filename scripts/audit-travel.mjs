import { installAuditMember, auditNavigate, auditReload } from './audit-session.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
const require = createRequire(import.meta.url);
require('../backend/generated-media');
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const providers = require('../backend/travel-providers');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let app;
app = await createAppHarness({ env: { YOUTUBE_API_KEY: 'travel-ui-test' }, modules: { './travel-providers': {
  ...providers,
  fetchTravelResource: async (url, options) => {
    if (url.includes('/w/api.php?')) return {query:{pages:[{ns:0,title:new URL(url).searchParams.get('titles'),extract:'A city introduction.\n\n== Get around ==\nUse local transit and walking routes.\n\n== See ==\nExplore the waterfront. <script>window.__guideInjected=true</script>'}]}};
    if (url.includes('/videos?')) {
      app.setYouTubeCallReady();
      return { items: ['rnXIjl_Rzy4', 'j9Sa4uBGGQ0', 'r74OyneNmg8'].map(id => ({
        id, liveStreamingDetails: { actualStartTime: '2026-09-01T00:00:00Z' }, status: { privacyStatus: 'public', embeddable: true },
      })) };
    }
    if (options?.json === false) return '<rss><channel></channel></rss>';
    throw new Error('Guide provider unavailable in UI fixture');
  },
} } });
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5214, strictPort: false, proxy: { '/api': { target: app.base, rewrite: p => p.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  for (const width of [1440, 768, 390, 320]) {
    const id = `travel-${width}`;
    app.seedUser(member(id));
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width <= 768, isMobile: width < 600 });
    await context.addInitScript(token => {
      window.__travelPlayers = [];
      // Exercise the real player lifecycle without depending on third-party
      // ads, region restrictions, or autoplay permissions in CI.
      window.YT = { Player: class {
        constructor(mount, options) {
          this.frame = document.createElement('iframe');
          this.frame.title = 'Camera provider fixture';
          this.frame.style.cssText = 'width:100%;height:100%;min-height:180px;border:0;position:absolute;inset:0';
          this.frame.srcdoc = '<body style="margin:0;background:#244b3d;color:white;display:grid;place-items:center;height:100vh;font:16px sans-serif">Camera provider fixture</body>';
          mount.replaceWith(this.frame);
          this.id = options.videoId;
          this.playing = false;
          this.options = options;
          window.__travelPlayers.push(this);
          setTimeout(() => options.events.onReady({ target: this }), 0);
        }
        getIframe() { return this.frame; }
        playVideo() { this.playing = true; }
        pauseVideo() { this.playing = false; }
        mute() {}
        unMute() {}
        destroy() { this.playing = false; this.frame.remove(); }
      } };
    }, app.token(id));
    const page = await context.newPage();
    await installAuditMember(page, app, id);
    const errors = [];
    let failSave = false;
    let failFeed = false;
    let failPagination = false;
    let hideCameras = false;
    let failDestinations = width === 1440;
    let failGuide = width === 1440;
    let profileWrites = 0;
    let feedRequests = 0;
    const feedPages = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/travel/guides/*', route => failGuide
      ? route.fulfill({status:503,json:{message:'Guide fixture outage'}}) : route.continue());
    await page.route('**/api/travel/destinations', route => failDestinations
      ? route.fulfill({ status: 503, json: { error: 'Test catalog failure' } }) : route.continue());
    await page.route('**/api/profile', async route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      profileWrites++;
      if (failSave) return route.fulfill({ status: 503, json: { error: 'Test save failure' } });
      await new Promise(resolve => setTimeout(resolve, 120));
      return route.continue();
    });
    await page.route('**/api/office/feed?*', async route => {
      feedRequests++;
      if (failFeed) return route.fulfill({ status: 503, json: { error: 'Test feed failure' } });
      const query = new URL(route.request().url()).searchParams;
      if (failPagination && (query.has('cursor') || Number(query.get('page')) > 1)) return route.fulfill({ status: 503, json: { error: 'Test pagination failure' } });
      if (!hideCameras) return route.continue();
      const response = await route.fetch();
      const data = await response.json();
      const params = new URL(route.request().url()).searchParams;
      feedPages.push({ page: params.get('page'), cursor: Boolean(params.get('cursor')), count: data.posts?.length, hasMore: data.hasMore });
      await route.fulfill({ json: { ...data, liveFeeds: [], travel: { ...data.travel, cameraStatus: 'degraded', camerasChecking: false } } });
    });
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=countries');
    const rail = page.getByRole('region', { name: 'Live travel cameras' });
    const cities = rail.getByRole('group', { name: 'Travel cities', exact: true });
    const cityChoice = id => cities.locator(`[data-destination-id="${id}"]`);
    const waitForCitySave = () => page.waitForFunction(() => !document.querySelector('[data-destination-id="US:Seattle"]')?.disabled);
    if (failDestinations) {
      await rail.getByText('Cities are temporarily unavailable.').waitFor();
      assert.equal(await rail.getByRole('button', { name: 'Next city', exact: true }).count(), 0);
      failDestinations = false;
      await rail.getByRole('button', { name: 'Retry destinations', exact: true }).click();
    }
    await cityChoice('US:Seattle').waitFor({ state: 'attached' });
    assert.equal(await cities.getByRole('button').count(), 91, 'all 91 cities share the Live Travel rail');
    const citySearch = rail.getByRole('searchbox', {name:'Search cities',exact:true});
    const beforeSearch = profileWrites;
    await citySearch.fill('nEw yo');
    assert.equal(await cities.getByRole('button').count(),1,'city search ignores case');
    assert.match(await cities.textContent(),/New York/);
    await citySearch.fill('japan');
    assert.ok(await cities.getByRole('button').count() >= 2,'country search includes multiple cities');
    await citySearch.fill('páris');
    assert.equal(await cities.getByRole('button').count(),1,'city search ignores accents');
    await citySearch.fill('no matching city');
    await rail.getByText('No cities match your search.').waitFor();
    assert.equal(await cities.getByRole('button').count(),0);
    assert.equal(profileWrites,beforeSearch,'searching never changes the saved feed location');
    await rail.getByRole('button',{name:'Clear city search',exact:true}).click();
    assert.equal(await cities.getByRole('button').count(),91,'clear restores the entire catalog');
    assert.equal(await rail.getByRole('combobox', { name: 'Travel destination', exact: true }).count(), 0, 'the separate city dropdown is removed');
    assert.equal(await page.locator('.feed-specialized-toolbar [aria-label="Travel destination"]').count(), 0, 'the old separate city selector is removed');
    const eventBar = page.getByRole('group', { name: 'Travel events', exact: true });
    await eventBar.waitFor();
    await rail.locator('.travel-live-loop-choice').first().waitFor();
    assert.equal(await rail.locator('.travel-city-live-badge').count(), 3, 'only verified camera cities receive live badges');
    const cityIds = await cities.getByRole('button').evaluateAll(buttons => buttons.map(button => button.dataset.destinationId));
    assert.equal(new Set(cityIds).size, 91);
    const navigation = rail.getByRole('group', { name: 'City navigation', exact: true });
    await navigation.getByText('City 1 of 91', { exact: true }).waitFor();
    await navigation.getByRole('button', { name: 'Previous city', exact: true }).click();
    await waitForCitySave();
    await navigation.getByText('City 91 of 91', { exact: true }).waitFor();
    assert.equal(await cityChoice(cityIds[90]).getAttribute('aria-pressed'), 'true', 'Previous wraps to the final catalog city');
    await navigation.getByRole('button', { name: 'Next city', exact: true }).click();
    await waitForCitySave();
    const steps = width === 1440 && !process.env.TRAVEL_AUDIT_QUICK ? 91 : 2;
    for (let step = 1; step <= steps; step++) {
      await navigation.getByRole('button', { name: 'Next city', exact: true }).click();
      await waitForCitySave();
      const index = step % 91;
      assert.equal(await cityChoice(cityIds[index]).getAttribute('aria-pressed'), 'true', 'Next follows the complete catalog, including cities without cameras');
      await navigation.getByText(`City ${index + 1} of 91`, { exact: true }).waitFor();
      assert.ok(await rail.locator('iframe').count() <= 1, 'Only the current city can mount a player');
    }
    const beforeCameraChoices = profileWrites;
    await cityChoice('GB:London').click();
    await waitForCitySave();
    await rail.scrollIntoViewIfNeeded();
    await rail.locator('.travel-live-loop-stage').hover();
    await page.waitForFunction(() => window.__travelPlayers.some(player => player.playing));
    const frameBox = await rail.locator('iframe').boundingBox();
    const copyBox = await rail.locator('.travel-live-loop-overlay').boundingBox();
    assert.ok(copyBox.y >= frameBox.y + frameBox.height - 2, 'camera controls and description stay below the picture');
    const travelUrl = page.url();
    const pageCount = context.pages().length;
    await rail.getByRole('button', { name: 'Watch live', exact: true }).click();
    const player = page.getByRole('dialog', {name:'Live Travel',exact:true});
    await player.waitFor();
    await player.locator('iframe').waitFor();
    assert.equal(page.url(), travelUrl, 'Watch live keeps the member on UFIConnect');
    assert.equal(context.pages().length, pageCount, 'Watch live does not open another site or tab');
    assert.equal(await rail.getByRole('link', { name: 'Watch live', exact: true }).count(), 0);
    await page.waitForFunction(() => {
      const players = window.__travelPlayers.filter(item => item.frame.isConnected);
      return players.length === 1 && players[0].frame.closest('.travel-viewer-dialog') && players[0].playing;
    });
    assert.equal(await player.getByRole('group',{name:'Travel cities',exact:true}).getByRole('button').count(),91,'Expanded Live Travel retains all 91 cities');
    assert.ok(await player.evaluate(element=>element.scrollWidth<=element.clientWidth+2),'Expanded viewer fits the viewport');
    await player.getByRole('searchbox',{name:'Search cities',exact:true}).fill('London');
    assert.equal(await player.getByRole('group',{name:'Travel cities',exact:true}).getByRole('button').count(),1,'expanded city search works');
    await player.getByRole('button',{name:'Clear city search',exact:true}).click();
    await player.getByRole('button',{name:'Next city',exact:true}).click();
    await waitForCitySave();
    await player.locator('iframe').waitFor();
    await player.locator('.travel-camera-fallback').waitFor();
    assert.equal(await player.locator('iframe').count(),1,'A city without a camera retains one verified live fallback');
    await player.getByRole('button',{name:'City guide',exact:true}).click();
    const nestedGuide=page.locator('.travel-guide-dialog');
    await nestedGuide.waitFor();
    await nestedGuide.getByRole('button',{name:'Back to Travel',exact:true}).click();
    await nestedGuide.waitFor({state:'detached'});
    assert.ok(await player.isVisible(),'Closing a guide returns to the expanded viewer');
    await player.getByRole('button',{name:'Previous city',exact:true}).click();
    await waitForCitySave();
    await player.locator('iframe').waitFor();
    await player.screenshot({ path: path.join(root, `.cache/audit-ui/travel-in-app-${width}.png`) });
    await player.getByRole('button', { name: 'Back to Travel feed', exact: true }).click();
    await player.waitFor({ state: 'detached' });
    await rail.locator('.travel-live-loop-stage').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => window.__travelPlayers.filter(item => item.frame.isConnected).length === 1);
    for (const city of ['New York', 'Tokyo', 'London']) {
      await cityChoice(({ 'New York': 'US:New_York_City', Tokyo: 'JP:Tokyo', London: 'GB:London' })[city]).click();
      await waitForCitySave();
      await page.waitForFunction(city => document.querySelector('.travel-live-loop-choice.active')?.textContent.includes(city), city);
      assert.equal(await page.getByRole('searchbox', { name: 'Travel city', exact: true }).inputValue(), city);
      assert.match(await rail.locator('.travel-live-loop-choice.active').textContent(), new RegExp(city));
    }
    assert.equal(profileWrites - beforeCameraChoices, 6, 'one save per city selection in the inline and expanded viewers');
    await cityChoice('US:Seattle').click();
    await waitForCitySave();
    await rail.locator('.travel-camera-fallback').getByText(/No live camera is available in Seattle\. Watching .+ live\./).waitFor();
    await rail.locator('.travel-live-loop-stage').scrollIntoViewIfNeeded();
    await rail.locator('iframe').waitFor();
    assert.equal(await rail.locator('iframe').count(), 1, 'A city without a camera plays a labeled verified fallback');
    await rail.getByRole('button', { name: 'City guide', exact: true }).click();
    const guide = page.getByRole('dialog', { name: 'Seattle city guide', exact: true });
    await guide.waitFor();
    if (failGuide) {
      await guide.getByText('The detailed guide is temporarily unavailable.').waitFor();
      failGuide = false;
      await guide.getByRole('button', { name: 'Retry city guide', exact: true }).click();
    }
    const topics=guide.getByRole('tablist',{name:'Guide topics',exact:true});
    await topics.getByRole('tab',{name:'Get around',exact:true}).click();
    await guide.getByRole('heading', { name: 'Get around', exact: true }).waitFor();
    assert.equal(await guide.getByText('Use local transit and walking routes.').count(),1);
    assert.equal(await guide.getByRole('tabpanel').count(),1,'only the selected topic content is shown');
    const topicRows=await topics.getByRole('tab').evaluateAll(tabs=>new Set(tabs.map(tab=>Math.round(tab.getBoundingClientRect().top))).size);
    assert.equal(topicRows,1,'all topic tabs stay on one horizontal line');
    await page.keyboard.press('ArrowRight');
    assert.equal(await topics.getByRole('tab',{name:'See',exact:true}).getAttribute('aria-selected'),'true');
    assert.equal(await guide.getByText('Use local transit and walking routes.').count(),0);
    await guide.getByText('Explore the waterfront. <script>window.__guideInjected=true</script>',{exact:true}).waitFor();
    assert.match(await guide.getByRole('link', {name:'Original article',exact:true}).getAttribute('href'),/\/Seattle$/);
    assert.equal(await page.evaluate(() => window.__guideInjected),undefined,'Guide text cannot execute provider markup');
    assert.equal(await guide.locator('iframe,script').count(),0,'Guide content is rendered inside UFIConnect without embedding another website');
    assert.equal(context.pages().length,pageCount);
    assert.equal(new URL(page.url()).origin,new URL(travelUrl).origin);
    assert.ok(await guide.evaluate(element => element.scrollWidth <= element.clientWidth+2),'Guide fits the viewport');
    await guide.screenshot({ path: path.join(root, `.cache/audit-ui/travel-in-app-guide-${width}.png`) });
    await page.keyboard.press('Home');
    assert.equal(await topics.getByRole('tab',{name:'Overview',exact:true}).getAttribute('aria-selected'),'true');
    await guide.getByRole('button', {name:'Back to Travel',exact:true}).click();
    await guide.waitFor({state:'detached'});
    assert.equal(await rail.getByRole('button', {name:'City guide',exact:true}).evaluate(element => element===document.activeElement),true);
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/travel-guide-${width}.png`) });
    await rail.getByRole('button', { name: 'City guide', exact: true }).click();
    await guide.waitFor();
    await page.keyboard.press('Escape');
    await guide.waitFor({state:'detached'});
    const heading = page.locator('.travel-content-heading');
    await page.getByRole('searchbox', { name: 'Travel city', exact: true }).fill('Not saved yet');
    await rail.locator('.travel-camera-fallback').getByText(/No live camera is available in Seattle\./).waitFor();
    assert.equal(await cityChoice('US:Seattle').getAttribute('aria-pressed'), 'true', 'Unsaved input cannot change the city player or guide');
    assert.match(await heading.textContent(), /Seattle/);
    assert.doesNotMatch(await heading.textContent(), /Not saved yet/);
    await auditReload(page);
    await cityChoice('US:Seattle').waitFor({ state: 'attached' });
    await page.waitForFunction(() => document.querySelector('[data-destination-id="US:Seattle"]')?.getAttribute('aria-pressed') === 'true');
    failSave = true;
    await cityChoice('JP:Osaka').click();
    await page.getByText('Could not save this location. Your previous feed location is still active.').waitFor();
    assert.equal(await cityChoice('US:Seattle').getAttribute('aria-pressed'), 'true');
    failSave = false;
    await cityChoice('JP:Tokyo').click();
    await waitForCitySave();
    await rail.scrollIntoViewIfNeeded();
    await rail.locator('.travel-live-loop-stage').hover();
    await page.waitForFunction(() => window.__travelPlayers.some(player => player.frame.isConnected && player.playing));
    await page.evaluate(() => window.__travelPlayers.find(player => player.frame.isConnected).options.events.onError({ data: 100 }));
    await page.waitForFunction(() => window.__travelPlayers.some(player => player.frame.isConnected && player.playing && player.id !== 'r74OyneNmg8'));
    await rail.getByText(/No live camera is available in Tokyo\. Watching .+ live\./).waitFor();
    const fallbackId=await page.evaluate(()=>window.__travelPlayers.find(player=>player.frame.isConnected).id);
    await page.evaluate(() => window.__travelPlayers.find(player => player.frame.isConnected).options.events.onStateChange({ data: 0 }));
    await page.waitForFunction(previous => window.__travelPlayers.some(player => player.frame.isConnected && player.playing && player.id !== previous && player.id !== 'r74OyneNmg8'),fallbackId);
    assert.equal(await rail.locator('iframe').count(),1,'ended live streams switch to another verified camera');
    await page.evaluate(() => window.__travelPlayers.find(player => player.frame.isConnected).options.events.onError({ data: 100 }));
    await rail.getByText('Live cameras are temporarily unavailable. Check again shortly.').waitFor();
    assert.equal(await rail.locator('iframe').count(),0,'exhausted streams stop instead of looping');
    await rail.getByRole('button',{name:'Refresh live cameras',exact:true}).click();
    await page.waitForFunction(() => window.__travelPlayers.some(player=>player.frame.isConnected && player.playing));
    await cityChoice('GB:London').click();
    await waitForCitySave();
    await rail.scrollIntoViewIfNeeded();
    await rail.locator('.travel-live-loop-stage').hover();
    await page.waitForFunction(() => window.__travelPlayers.filter(player => player.frame.isConnected).length === 1).catch(async error => {
      console.log(await page.evaluate(() => ({ players: window.__travelPlayers.map(player => ({ id: player.id, connected: player.frame.isConnected, playing: player.playing })), active: document.querySelector('.travel-live-loop-choice.active')?.textContent, frames: document.querySelectorAll('iframe').length, rail: document.querySelector('.travel-live-loop')?.textContent })));
      await page.screenshot({ path: path.join(root, '.cache/audit-ui/travel-failure.png') });
      throw error;
    });
    assert.equal(await rail.getByText('This stream cannot play here.').count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'no horizontal overflow');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/travel-${width}.png`) });
    hideCameras = true;
    failPagination = true;
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await rail.getByText('Live camera checks are temporarily unavailable.').waitFor();
    assert.equal(await page.getByRole('searchbox', { name: 'Travel city', exact: true }).inputValue(), '');
    assert.equal(await cities.getByRole('button').count(), 91, 'city choices remain available without live cameras');
    assert.equal(await rail.locator('iframe').count(), 0);
    await page.locator('[data-feed-has-more]').first().evaluate(element => element.scrollIntoView({ block: 'end' }));
    await page.getByText('More destinations could not load.').waitFor();
    const failedPageRequests = feedRequests;
    await page.waitForTimeout(700);
    assert.equal(feedRequests, failedPageRequests, 'paging failures do not cause an automatic retry loop');
    assert.ok(await page.locator('.post-card').count() > 0, 'loaded posts survive a paging outage');
    failPagination = false;
    await page.getByRole('button', { name: 'Retry more destinations', exact: true }).click();
    // Exhaust the actual API pagination and make sure the UI stops asking.
    for (let attempt = 0; attempt < 15; attempt++) {
      const feed = page.locator('[data-feed-has-more]').first();
      if (await feed.getAttribute('data-feed-has-more') === 'false') break;
      await feed.evaluate(element => element.scrollIntoView({ block: 'end' }));
      await page.waitForTimeout(500);
    }
    if (await page.locator('[data-feed-has-more]').first().getAttribute('data-feed-has-more') !== 'false') {
      console.log(JSON.stringify({ feedPages, state: await page.locator('[data-feed-has-more]').evaluate(el => ({ dataset: { ...el.dataset }, rect: el.getBoundingClientRect().toJSON(), scroll: document.scrollingElement.scrollTop, height: document.scrollingElement.scrollHeight, innerHeight })) }));
    }
    assert.equal(await page.locator('[data-feed-has-more]').first().getAttribute('data-feed-has-more'), 'false');
    const before = feedRequests;
    await page.waitForTimeout(700);
    assert.equal(feedRequests, before, 'no repeated exhausted-page requests');
    failFeed = true;
    await cityChoice('US:Seattle').click();
    await page.getByText('The feed request failed with HTTP 503.').waitFor();
    assert.equal(await rail.locator('iframe').count(), 0, 'a failed location change cannot leave an old camera under the new location');
    assert.equal(await rail.locator('.travel-city-live-badge').count(), 0, 'a failed location change does not retain stale live badges');
    assert.equal(await cities.getByRole('button').count(), 91, 'city selection remains available after a feed failure');
    failFeed = false;
    await page.getByRole('button', { name: /Try again|Retry/i }).first().click();
    await rail.getByText('Live camera checks are temporarily unavailable.').waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS: Travel city catalog, playback, selection, save failure, reload, clear, pagination and retry at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
