import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate } from './audit-session.mjs';

const require = createRequire(import.meta.url);
require('../backend/generated-media');
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-ui/map-settings');
await fs.mkdir(output, { recursive: true });
const app = await createAppHarness();
const userId = 'maps-settings-audit';
app.seedUser(member(userId, { plan: 'pro' }));
const workspaceKey = 'ufi:local-workspace:' + userId + ':city';
const baseline = {
  enabled: ['community', 'technology'],
  sourceSelections: { community: ['uficonnect', 'reddit'], technology: ['github'] },
  topicSelections: {},
  selected: [{ key: 'legacy:1', id: '1', source: 'uficonnect', title: 'Previously saved map post' }],
};
const server = await createServer({
  root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envFile: false,
  plugins: [{
    name: 'map-account-audit-fixture', enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/contexts/AuthContext.jsx')) return null;
      // Exercise a profile change without remounting Maps. This hook exists only
      // in this audit's Vite server; the production provider remains unchanged.
      const provider = '  return (\n    <AuthContext.Provider';
      assert.ok(code.includes(provider), 'The map audit must install its profile change fixture');
      return code.replace(provider, `  globalThis.__mapAuditUpdateProfile = updateProfileLocally;\n${provider}`);
    },
  }],
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5233, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen();
  const forceSoftwareGpu = process.argv.includes('--software-gpu');
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined,
    ...(forceSoftwareGpu ? { args: ['--use-angle=swiftshader'] } : {}) });
  for (const width of [1440, 390]) {
    // This audit exercises settings and real pointer clicks. Pause through the
    // supported preference, verify the desktop Maximum default, then use the
    // Automatic option for repeated settings and route changes. CI's software
    // GPU otherwise blocks Apply's request lifecycle while rebuilding SSAO.
    const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width < 600, hasTouch: width < 600, reducedMotion: 'reduce' });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [], requests = [];
    let feedAccount = userId, holdNext = false, releaseHeld = null;
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ key, initial }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(initial));
    }, { key: workspaceKey, initial: baseline });
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (/events|stream/.test(url.pathname)) return route.abort();
      if (url.pathname === '/api/office/feed') {
        requests.push(Object.fromEntries(url.searchParams));
        const sources = (url.searchParams.get('sources') || '').split(',').filter(Boolean);
        const account = feedAccount;
        if (holdNext) { holdNext = false; await new Promise(resolve => { releaseHeld = resolve; }); }
        return route.fulfill({ json: { posts: sources.map(source => ({
          id: account + '-' + source + '-map-post', source, title: (account === userId ? '' : 'Second account ') + source + ' map post', content: 'A source result fixture.',
          topic: 'Community', sourceUrl: 'https://example.com/' + source,
        })), hasMore: false, cursor: '' } }).catch(() => {});
      }
      return route.continue();
    });
    await installAuditMember(page, app, userId);
    await auditNavigate(page, server.resolvedUrls.local[0] + 'maps');
    const actions = page.getByRole('group', { name: 'Map actions', exact: true });
    const state = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), workspaceKey);
    const openTools = async (section) => {
      if (width < 600 && !await page.locator('#map-mobile-menu').count()) await page.getByRole('button', { name: 'Open map menu', exact: true }).click();
      if (width >= 600 && !await page.locator('.map-customization-rail').count()) await actions.getByRole('button', { name: 'Open map menu', exact: true }).click();
      const tools = width < 600 ? page.locator('#map-mobile-menu') : page.locator('.map-customization-rail');
      if (section) await tools.getByRole('navigation', { name: 'Map settings pages' }).getByRole('button', { name: section, exact: true }).click();
      return tools;
    };
    const closeTools = async () => {
      if (width < 600 && await page.locator('#map-mobile-menu').count()) await page.getByRole('button', { name: 'Close map menu', exact: true }).click();
      if (width >= 600 && await page.locator('.map-customization-rail').count()) await actions.getByRole('button', { name: 'Close map menu', exact: true }).click();
    };
    const apply = async tools => {
      await (width < 600 ? tools : actions).getByRole('button', { name: 'Apply changes', exact: true }).click();
    };
    try {
      // Initial navigation also initializes the scene on software-rendered CI.
      await page.getByText('reddit map post', { exact: true }).waitFor({ timeout: 30000 });
      assert.equal(await actions.locator('xpath=ancestor::*[contains(@class,"map-city-card")]').count(), 1, 'Apply, Source feed and Refresh belong inside the map');
      assert.equal(await page.getByRole('button', { name: /^Your selection/ }).count(), 0);
      assert.equal(await page.locator('.city-post input[type="checkbox"]').count(), 0);
      assert.equal(await actions.getByRole('button', { name: 'Apply changes', exact: true }).isDisabled(), true);
      assert.equal(await page.getByText('All 16 nature cities', { exact: true }).count(), 0);
      assert.equal(await page.locator('.map-city-footer').count(), 0);
      assert.ok(await page.locator('.map-post-feed > article, .map-post-feed > .card').count() > 0, 'Map posts use the full feed card');

      const renderingQuality = page.getByRole('combobox', { name: 'Rendering quality', exact: true });
      let softwareRenderer = false;
      const useAutomaticRendering = async () => {
        if (await renderingQuality.inputValue() !== 'auto') await renderingQuality.selectOption('auto');
        await page.waitForFunction(() => Number(document.querySelector('.map-city-scene canvas')?.dataset.instances) > 3000,
          undefined, { timeout: 30000 });
        const gpu = await page.locator('.map-city-scene canvas').evaluate(canvas => {
          const context = canvas.getContext('webgl2'), debug = context?.getExtension('WEBGL_debug_renderer_info');
          return { renderer: context ? String(context.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : context.RENDERER)) : '', instances: Number(canvas.dataset.instances) };
        });
        const software = /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(gpu.renderer);
        softwareRenderer = software;
        if (forceSoftwareGpu) assert.ok(software, 'The requested software-GPU reproduction must use a software renderer');
        console.log('MAP_AUTOMATIC_GPU ' + JSON.stringify({ width, ...gpu, software }));
        if (!software) return;
        // Automatic measures frame cost; a software driver can legitimately
        // keep physical materials when fast enough. Advance at least 12 real
        // frames (simulation delta is capped at .05s), then verify rendering
        // and pause behavior without requiring a hardware-name-based tier.
        // CI software frames exceeded 4.9s each; retain the .6s simulation
        // threshold and allow 90s for those real clamped-delta frames.
        const canvas = page.locator('.map-city-scene canvas');
        await canvas.scrollIntoViewIfNeeded();
        const before = await canvas.evaluate(element => ({ ...element.dataset }));
        await page.getByRole('button', { name: 'Play animation', exact: true }).click();
        await page.waitForFunction(start => Number(document.querySelector('.map-city-scene canvas')?.dataset.trafficTime) - start >= .6,
          Number(before.trafficTime), { timeout: 90000 });
        await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
        await page.getByRole('button', { name: 'Play animation', exact: true }).waitFor();
        const adaptive = await canvas.evaluate(element => ({ ...element.dataset }));
        assert.ok(['physical', 'balanced', 'basic'].includes(adaptive.renderQuality), 'Automatic chooses a supported measured quality tier');
        assert.equal(Number(adaptive.instances), gpu.instances, 'Adaptive software rendering preserves the full instanced city model');
        assert.ok(Number(adaptive.drawCalls) > 0 && Number(adaptive.drawCalls) < gpu.instances, 'Automatic renders the instanced city in fewer calls than model instances');
        assert.ok(Number(adaptive.pixelRatio) > 0, 'Automatic preserves a positive rendering resolution');
        await page.waitForTimeout(200);
        assert.equal(await canvas.getAttribute('data-traffic-time'), adaptive.trafficTime, 'Pause stops the software-rendered animation');
        console.log('MAP_AUTOMATIC_READY ' + JSON.stringify({ width, fromTrafficTime: before.trafficTime, fromQuality: before.renderQuality, ...adaptive }));
      };
      if (width === 1440) {
        assert.equal(await renderingQuality.inputValue(), 'maximum', 'Desktop opens at Maximum detail');
        await page.waitForFunction(() => {
          const data = document.querySelector('.map-city-scene canvas')?.dataset;
          return data?.renderQuality === 'physical' && Number(data.instances) > 3000;
        }, undefined, { timeout: 30000 });
        const maximum = await page.locator('.map-city-scene canvas').evaluate(canvas => ({ ...canvas.dataset }));
        assert.ok(Number(maximum.drawCalls) < 80, 'Maximum city geometry remains instanced');
        console.log('MAP_MAXIMUM_RENDERING ' + JSON.stringify(maximum));
      }
      await useAutomaticRendering();

      let tools = await openTools();
      const sourcePages = tools.getByRole('navigation', { name: 'Source option pages' });
      await sourcePages.getByRole('button', { name: 'Next', exact: true }).click();
      assert.equal(await tools.getByRole('button', { name: 'Reddit', exact: true }).count(), 0, 'Source options are paginated');
      await sourcePages.getByRole('button', { name: 'Previous', exact: true }).click();
      const redditSource = tools.getByRole('group', { name: 'Community sources', exact: true }).getByRole('button', { name: 'Reddit', exact: true });
      // Read geometry without changing scroll position, focus, or click behavior.
      const readClickDiagnostics = () => redditSource.evaluate(button => {
        const describe = element => {
          if (!element) return null;
          const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
          return {
            tag: element.tagName, id: element.id, className: element.getAttribute('class'),
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            scroll: { left: element.scrollLeft, top: element.scrollTop, width: element.scrollWidth, height: element.scrollHeight, clientWidth: element.clientWidth, clientHeight: element.clientHeight },
            style: { position: style.position, overflowX: style.overflowX, overflowY: style.overflowY, display: style.display, visibility: style.visibility, transform: style.transform },
          };
        };
        const ancestors = [];
        for (let element = button.parentElement; element; element = element.parentElement) ancestors.push(describe(element));
        const rect = button.getBoundingClientRect();
        const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        const hit = document.elementFromPoint(point.x, point.y);
        return {
          viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY, devicePixelRatio, visualViewport: window.visualViewport ? { width: visualViewport.width, height: visualViewport.height, offsetLeft: visualViewport.offsetLeft, offsetTop: visualViewport.offsetTop, scale: visualViewport.scale } : null },
          button: describe(button), ancestors,
          hitTest: { point, insideViewport: point.x >= 0 && point.y >= 0 && point.x < innerWidth && point.y < innerHeight, hitsButton: hit === button || button.contains(hit), element: describe(hit) },
        };
      });
      let clickDiagnostics = await readClickDiagnostics();
      if (width >= 600) {
        console.log('MAP_SOURCE_REVEAL_START ' + JSON.stringify({ width, ...clickDiagnostics }));
        const railFor = diagnostics => diagnostics.ancestors.find(element => element.className?.split(/\s+/).includes('map-customization-rail'));
        const clipFor = diagnostics => {
          const rail = railFor(diagnostics)?.rect;
          assert.ok(rail, 'The source button must belong to the settings rail');
          return { left: Math.max(0, rail.x), top: Math.max(0, rail.y), right: Math.min(diagnostics.viewport.width, rail.x + rail.width), bottom: Math.min(diagnostics.viewport.height, rail.y + rail.height) };
        };
        const isRevealed = diagnostics => {
          const rect = diagnostics.button.rect, clip = clipFor(diagnostics);
          return rect.width > 0 && rect.height > 0 && rect.x >= clip.left && rect.y >= clip.top
            && rect.x + rect.width <= clip.right && rect.y + rect.height <= clip.bottom && diagnostics.hitTest.hitsButton;
        };
        const clip = clipFor(clickDiagnostics), initialWindowScroll = clickDiagnostics.viewport.scrollY;
        assert.ok(clip.right > clip.left && clip.bottom > clip.top, 'The settings rail must intersect the viewport');
        // Scroll the visible nested rail as a user would. locator.hover() would
        // itself auto-scroll, so move the pointer within the measured viewport.
        await page.mouse.move((clip.left + clip.right) / 2, (clip.top + clip.bottom) / 2);
        const revealDeadline = Date.now() + 5000;
        for (let attempt = 0; attempt < 6 && !isRevealed(clickDiagnostics) && Date.now() < revealDeadline; attempt++) {
          const previousScroll = railFor(clickDiagnostics).scroll.top;
          await page.mouse.wheel(0, 160);
          for (let poll = 0; poll < 10 && Date.now() < revealDeadline; poll++) {
            await page.waitForTimeout(50);
            clickDiagnostics = await readClickDiagnostics();
            if (isRevealed(clickDiagnostics)) break;
          }
          if (railFor(clickDiagnostics).scroll.top === previousScroll) break;
        }
        assert.ok(isRevealed(clickDiagnostics), 'Reddit source must be revealed by bounded rail scrolling: ' + JSON.stringify(clickDiagnostics));
        assert.equal(clickDiagnostics.viewport.scrollY, initialWindowScroll, 'Revealing a source must scroll the settings rail without moving the page');
      }
      console.log('MAP_FIRST_SOURCE_CLICK_DIAGNOSTICS ' + JSON.stringify({ width, ...clickDiagnostics }));
      const before = JSON.stringify(await state()), beforeRequests = requests.length;
      await redditSource.click();
      await page.waitForTimeout(350);
      assert.equal(JSON.stringify(await state()), before, 'Draft source edits must not save');
      assert.equal(requests.length, beforeRequests, 'Draft source edits must not refetch');
      await closeTools();
      assert.ok((await actions.getByRole('link', { name: 'Source feed', exact: true }).getAttribute('href')).includes('reddit'), 'Source feed uses applied sources');
      await Promise.all([
        page.waitForResponse(response => response.url().includes('/office/feed?')),
        actions.getByRole('button', { name: 'Refresh', exact: true }).click(),
      ]);
      assert.ok(requests.at(-1).sources.includes('reddit'), 'Refresh must not apply drafts');
      assert.equal(JSON.stringify(await state()), before);
      tools = await openTools();
      assert.equal(await tools.getByRole('group', { name: 'Community sources', exact: true }).getByRole('button', { name: 'Reddit', exact: true }).getAttribute('aria-pressed'), 'false', 'Closing the menu retains the draft');
      await Promise.all([
        page.waitForResponse(response => response.url().includes('/office/feed?') && new URL(response.url()).searchParams.get('sources') === 'uficonnect'),
        apply(tools),
      ]);
      await closeTools();
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).sourceSelections.community.length === 1, workspaceKey);
      await page.waitForFunction(() => !document.querySelector('.city-post-grid')?.textContent.includes('reddit map post'));
      assert.deepEqual((await state()).selected, baseline.selected, 'Removing collection UI must preserve existing stored posts');
      assert.equal(requests.at(-1).sources, 'uficonnect');

      tools = await openTools('Topics');
      await tools.getByRole('button', { name: '+ Community', exact: true }).click();
      await page.waitForTimeout(300);
      assert.equal(requests.at(-1).topics, undefined, 'Draft topic edits must not filter applied posts');
      const slider = tools.getByRole('slider', { name: 'Community post count', exact: true });
      assert.equal(await slider.getAttribute('min'), '20'); assert.equal(await slider.getAttribute('max'), '500');
      await slider.press('End');
      await Promise.all([
        page.waitForResponse(response => response.url().includes('/office/feed?') && JSON.parse(new URL(response.url()).searchParams.get('mapTopics')).uficonnect?.includes('community')),
        apply(tools),
      ]);
      await closeTools();
      assert.deepEqual((await state()).topicSelections['community:city'], ['Community']);
      assert.equal((await state()).topicTargets['community:city'].Community, 500);

      tools = await openTools('Topics');
      await tools.getByRole('button', { name: 'Clear topics', exact: true }).click();
      await (width < 600 ? tools : actions).getByRole('button', { name: 'Discard changes', exact: true }).click();
      assert.equal(await tools.getByRole('heading', { name: 'Selected topics (1)', exact: true }).count(), 1);
      assert.deepEqual((await state()).topicSelections['community:city'], ['Community']);

      await tools.getByRole('button', { name: 'Clear topics', exact: true }).click();
      await page.evaluate(key => {
        const original = Storage.prototype.setItem;
        window.restoreMapStorage = () => { Storage.prototype.setItem = original; };
        Storage.prototype.setItem = function (name, value) { if (name === key) throw new DOMException('Storage unavailable', 'QuotaExceededError'); return original.call(this, name, value); };
      }, workspaceKey);
      await apply(tools);
      if (width < 600) assert.equal(await tools.getByRole('alert').isVisible(), true, 'Storage errors must be visible inside the mobile dialog');
      assert.deepEqual((await state()).topicSelections['community:city'], ['Community'], 'Failed saves must not change applied settings');
      assert.equal(await (width < 600 ? tools : actions).getByRole('button', { name: 'Apply changes', exact: true }).isEnabled(), true, 'Failed saves retain the draft for retry');
      await page.evaluate(() => window.restoreMapStorage());
      await (width < 600 ? tools : actions).getByRole('button', { name: 'Discard changes', exact: true }).click();
      await closeTools();

      await page.reload();
      // A full reload restores auth and initializes the 3D scene again. The CI
      // trace shows software rendering can take about 20 seconds here; keep
      // the normal 15-second action limit and allow 30 seconds for this startup.
      await page.getByText('uficonnect map post', { exact: true }).waitFor({ timeout: 30000 });
      assert.deepEqual((await state()).sourceSelections.community, ['uficonnect']);
      assert.deepEqual((await state()).topicSelections['community:city'], ['Community']);
      if (width === 1440) {
        assert.equal(await renderingQuality.inputValue(), 'maximum', 'Reload preserves the desktop Maximum default');
      }
      await useAutomaticRendering();

      tools = await openTools('Topics');
      await tools.getByRole('button', { name: 'Clear topics', exact: true }).click();
      await closeTools();
      holdNext = true;
      await Promise.all([
        page.waitForRequest(request => request.url().includes('/office/feed?')),
        actions.getByRole('button', { name: 'Refresh', exact: true }).click(),
      ]);
      for (let attempt = 0; !releaseHeld && attempt < 200; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(releaseHeld, 'The previous account request must be held before switching accounts');
      const secondKey = 'ufi:local-workspace:maps-second-account:city';
      const sameSettings = await state();
      feedAccount = 'maps-second-account';
      await page.evaluate(({ key, settings }) => {
        localStorage.setItem(key, JSON.stringify(settings));
        window.__mapAuditUpdateProfile({ id: 'maps-second-account' });
      }, { key: secondKey, settings: sameSettings });
      await page.getByText('uficonnect map post', { exact: true }).waitFor({ state: 'hidden' });
      await page.getByText('Second account uficonnect map post', { exact: true }).waitFor();
      releaseHeld();
      releaseHeld = null;
      await page.waitForTimeout(250);
      assert.equal(await page.getByText('uficonnect map post', { exact: true }).count(), 0, 'Old account requests cannot replace new account posts');
      assert.equal(await actions.getByRole('button', { name: 'Apply changes', exact: true }).isDisabled(), true, 'Account changes discard the previous account draft');
      assert.ok(JSON.parse(requests.at(-1).mapTopics).uficonnect.includes('community'), 'Matching account filters still load a fresh account scope');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Map controls must fit the viewport');
      await page.screenshot({ path: path.join(output, `map-settings-${width}.png`), fullPage: true });
      if (width === 1440) {
        assert.equal(await renderingQuality.inputValue(), 'auto', 'Drive checks use the supported adaptive renderer');
        assert.equal(await renderingQuality.locator('option[value="maximum"]').count(), 1, 'Maximum detail remains selectable');
        await page.getByRole('button', { name: 'Drive mode', exact: true }).click();
        await page.waitForFunction(() => Number(document.querySelector('.map-city-scene canvas')?.dataset.driveProgress) > .005, undefined, { timeout: 30000 });
        const drive = page.getByRole('group', { name: 'Drive between cities', exact: true });
        assert.equal(await drive.getByRole('combobox').locator('option').count(), 18);
        await drive.getByRole('button', { name: 'Pause drive', exact: true }).click();
        const paused = await page.locator('.map-city-scene canvas').getAttribute('data-drive-progress');
        await page.waitForTimeout(200);
        assert.equal(await page.locator('.map-city-scene canvas').getAttribute('data-drive-progress'), paused, 'Pause stops the vehicle');
        const rendering = await page.locator('.map-city-scene canvas').evaluate(canvas => ({ ...canvas.dataset }));
        assert.ok(['physical', 'balanced', 'basic'].includes(rendering.renderQuality), 'Automatic rendering keeps a supported quality tier');
        assert.ok(Number(rendering.instances) > 3000, 'Automatic keeps the detailed instanced city model');
        // The direct renderer counts city draws; Maximum's composer reports its
        // last output pass. Compare model instances rather than those counters.
        assert.ok(Number(rendering.drawCalls) > 0, 'Automatic renders the city');
        await page.screenshot({ path: path.join(output, 'map-drive-desktop.png') });
        console.log('MAP_RENDERING ' + JSON.stringify(rendering));
        for (const id of ['airport', 'shopping']) {
          await drive.getByRole('combobox').selectOption(id);
          await page.waitForFunction(destination => {
            const data = document.querySelector('.map-city-scene canvas')?.dataset;
            return data?.driveDestination === destination && Number(data.driveProgress) > .001;
          }, id, { timeout: softwareRenderer ? 90000 : 15000 });
        }
        await page.getByRole('button', { name: 'Exit drive mode', exact: true }).click();
        assert.equal(await page.getByRole('group', { name: 'Travel and Shop landmarks', exact: true }).count(), 0,
          'Map does not show the removed airport and shopping center shortcuts');
        // Restore the actual Maximum choice after the settings and drive checks.
        // Measure one physical scene without forcing every refetch to rebuild it.
        await renderingQuality.selectOption('maximum');
        await page.waitForFunction(() => {
          const data = document.querySelector('.map-city-scene canvas')?.dataset;
          return data?.renderQuality === 'physical' && Number(data.instances) > 3000;
        }, undefined, { timeout: 30000 });
        const maximum = await page.locator('.map-city-scene canvas').evaluate(canvas => ({ ...canvas.dataset }));
        assert.ok(Number(maximum.drawCalls) < 80, 'Maximum remains instanced after settings and driving');
        await page.screenshot({ path: path.join(output, 'map-maximum-desktop.png') });
        console.log('MAP_MAXIMUM_FINAL_RENDERING ' + JSON.stringify(maximum));
      }
      if (width < 600) {
        tools = await openTools('Topics');
        await tools.getByRole('button', { name: 'Clear topics', exact: true }).click();
        const applyBox = await tools.getByRole('button', { name: 'Apply changes', exact: true }).boundingBox();
        assert.ok(applyBox.height >= 44 && applyBox.y + applyBox.height <= 1000, 'Mobile Apply remains visible and has a usable touch target');
        await page.screenshot({ path: path.join(output, 'map-settings-mobile-menu.png') });
      }
      assert.deepEqual(errors, []);
      await context.tracing.stop();
      console.log(`PASS: Maps Apply, Refresh, Discard, storage failure, saved settings and responsive controls at ${width}px`);
    } catch (error) {
      const captures = await Promise.allSettled([
        context.tracing.stop({ path: path.join(output, `map-settings-failure-${width}.zip`) }),
        page.screenshot({ path: path.join(output, `map-settings-failure-${width}.png`), fullPage: true }),
      ]);
      captures.forEach((capture, index) => {
        if (capture.status === 'rejected') console.error(`Map ${index === 0 ? 'trace' : 'screenshot'} capture failed at ${width}px:`, capture.reason?.message);
      });
      throw error;
    } finally { releaseHeld?.(); await context.close(); }
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
