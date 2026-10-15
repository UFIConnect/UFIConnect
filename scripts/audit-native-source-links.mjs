// Real shared source button and native browser adapters; all destinations are
// intercepted fixtures. No account, source, or production request is made.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureId = path.join(root, 'web', '__source-link-audit-entry.js').replaceAll('\\', '/');
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { OpenOnSource } from '/src/components/PostCardChrome.jsx';
import { configureNativeRuntime, installNativeBrowserAdapters } from '/src/nativeRuntime.mjs';
import '/src/index.css';
import '/src/components/navigation.css';
import '/src/components/VideoFeedView.css';
const root = createRoot(document.getElementById('fixture'));
let cleanup = () => {};
window.auditLinks = { opens: [], clicks: [], errors: [] };
window.addEventListener('ufi-native-error', event => window.auditLinks.errors.push(event.detail.message));
function CurrentRoute() { return React.createElement('output', { id: 'current-route' }, useLocation().pathname); }
window.renderSource = options => {
  cleanup(); configureNativeRuntime(null);
  window.auditLinks = { opens: [], clicks: [], errors: [] };
  if (options.native) {
    configureNativeRuntime({ nativePlatform: 'ios', onApiRequest: async () => { throw Error('Unexpected API call'); },
      onOpenExternal: async url => { window.auditLinks.opens.push(url); if (options.reject) throw Error('Fixture opening failed'); } });
    cleanup = installNativeBrowserAdapters();
  } else cleanup = () => {};
  const onClick = event => {
    window.auditLinks.clicks.push({ preventedBefore: event.defaultPrevented });
    if (options.handler === 'stop') event.stopPropagation();
    if (options.handler === 'cancel') event.preventDefault();
  };
  root.render(React.createElement(MemoryRouter, { key: options.name, initialEntries: ['/fixture'] },
    React.createElement('div', { 'data-case': options.name, className: 'shell shell-media-scroll' },
      React.createElement('header', { className: 'global-app-header' }, 'Navigation'),
      React.createElement('div', { className: 'post-chrome-actions' },
        React.createElement('div', { className: 'post-chrome-more' }, React.createElement('button', { className: 'post-chrome-action' }, 'More')),
        React.createElement(OpenOnSource, { post: { id: 'source-audit', source: 'mastodon', isExternal: true, sourceUrl: options.href, ...options.post }, onClick })),
      React.createElement('nav', { className: 'bottom-nav' }, 'Navigation'),
      React.createElement(CurrentRoute))));
};
`;
const server = await createServer({ root: path.join(root, 'web'), envDir: false,
  cacheDir: path.join(root, '.cache/source-link-vite'),
  plugins: [{ name: 'source-link-audit-fixture', resolveId(id) { if (id === '/__source-link-audit-entry.js') return fixtureId; },
    load(id) { if (id === fixtureId) return fixture; },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url !== '/__source-link-audit') return next();
        const html = await vite.transformIndexHtml(req.url, '<!doctype html><html><head><title>Source link fixture</title></head><body><div id="fixture"></div><script type="module" src="/__source-link-audit-entry.js"></script></body></html>');
        res.setHeader('Content-Type', 'text/html'); res.end(html);
      });
    } }],
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
});
const results = [];
let browser;
try {
  await server.listen();
  const origin = new URL(server.resolvedUrls.local[0]).origin;
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    const page = await context.newPage(), pageErrors = [], popups = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('popup', popup => popups.push(popup));
    await context.route('**/*', route => new URL(route.request().url()).origin === origin
      ? route.continue() : route.fulfill({ contentType: 'text/html', body: '<title>Intercepted source destination</title>' }));
    await page.goto(origin + '/__source-link-audit', { timeout: 120000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.renderSource === 'function', null, { timeout: 120000 });
    const href = 'https://mastodon.example/@creator/123456?ref=ufi#post';
    async function render(name, options = {}) {
      await page.evaluate(value => window.renderSource(value), { name, href, ...options });
      await page.locator('[data-case="' + name + '"]').waitFor();
      return page.locator('.post-chrome-source-link');
    }
    async function state() { return page.evaluate(() => window.auditLinks); }
    async function settled() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }

    const ordinary = await render('ordinary-browser', { handler: 'stop' });
    assert.equal(await ordinary.locator('.post-chrome-open-mark').isVisible(), true, 'The source icon stays visible on phones and desktop');
    assert.equal(await ordinary.evaluate(link => {
      const rect = link.getBoundingClientRect();
      return link.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }), true, 'More options must not cover the source link');
    assert.equal(await ordinary.locator(':scope > svg').count(), 0, 'The source icon is the link without a second arrow');
    assert.deepEqual(await page.locator('.global-app-header, .bottom-nav').evaluateAll(bars => bars.map(bar => getComputedStyle(bar).position)), ['static', 'static'], 'Media navigation bars scroll with the page');
    assert.equal(await ordinary.getAttribute('href'), href);
    assert.equal(await ordinary.getAttribute('target'), '_blank');
    assert.match(await ordinary.getAttribute('rel'), /noopener/);
    const popupEvent = page.waitForEvent('popup');
    await ordinary.click();
    const popup = await popupEvent; await popup.waitForLoadState();
    assert.equal(popup.url(), href, 'Ordinary browser click keeps the real external destination');
    assert.deepEqual((await state()).opens, []); assert.equal((await state()).clicks.length, 1);
    await popup.close();

    for (const handler of ['stop', 'none']) {
      const link = await render('native-' + handler, { native: true, handler });
      const popupCount = popups.length;
      await link.click(); await settled();
      assert.deepEqual((await state()).opens, [href], 'Native source opens exactly once with ' + handler + ' propagation');
      assert.equal((await state()).clicks.length, 1);
      assert.equal(popups.length, popupCount, 'Native source opens through the host, without a WebView popup');
      assert.equal(await page.locator('#current-route').textContent(), '/fixture');
    }
    const keyboard = await render('native-keyboard', { native: true, handler: 'stop' });
    await keyboard.focus(); await page.keyboard.press('Enter'); await settled();
    assert.deepEqual((await state()).opens, [href], 'Keyboard activation uses the same native handoff');

    for (const native of [false, true]) {
      const cancelled = await render('cancelled-' + native, { native, handler: 'cancel' });
      const popupCount = popups.length;
      await cancelled.click(); await settled();
      assert.deepEqual((await state()).opens, [], 'A caller can cancel source navigation');
      assert.equal((await state()).clicks.length, 1); assert.equal(popups.length, popupCount);
    }
    const nativePost = await render('native-member-post', { native: true, handler: 'stop', post: { source: 'uficonnect', isExternal: false } });
    assert.equal(await nativePost.getAttribute('href'), '/p/source-audit');
    await nativePost.click();
    await page.waitForFunction(() => document.querySelector('#current-route').textContent === '/p/source-audit');
    assert.deepEqual((await state()).opens, [], 'Member posts retain React Router navigation');

    for (const [index, unsafe] of ['javascript:alert(1)', 'https://name:secret@mastodon.example/@creator/123', 'data:text/html,invalid', 'not-a-url'].entries()) {
      const invalid = await render('invalid-' + index, { native: true, href: unsafe, handler: 'stop' });
      assert.equal(await invalid.getAttribute('href'), '/p/source-audit', 'Unsafe URLs keep the existing internal fallback');
      await invalid.click();
      await page.waitForFunction(() => document.querySelector('#current-route').textContent === '/p/source-audit');
      assert.deepEqual((await state()).opens, []);
    }
    const rejected = await render('native-rejection', { native: true, handler: 'stop', reject: true });
    await rejected.click();
    await page.waitForFunction(() => window.auditLinks.errors.length === 1);
    assert.deepEqual((await state()).opens, [href]);
    assert.deepEqual((await state()).errors, ['The source could not be opened. Please try again.']);
    assert.deepEqual(pageErrors, []);
    const scrolling = await page.evaluate(async () => {
      const fixture = document.createElement('section');
      fixture.innerHTML = '<div class="video-feed-view" style="height:480px;min-height:0"><div class="video-feed-frame"><div class="video-feed-body"><div class="video-feed-scroll"><div class="video-feed-snap-item"></div><div class="video-feed-snap-item"></div><div class="video-feed-snap-item"></div></div></div></div></div>';
      document.body.append(fixture);
      const scroll = fixture.querySelector('.video-feed-scroll');
      scroll.scrollTop = 117;
      await new Promise(resolve => setTimeout(resolve, 250));
      const result = { snap: getComputedStyle(scroll).scrollSnapType, position: scroll.scrollTop };
      fixture.remove();
      return result;
    });
    assert.deepEqual(scrolling, { snap: 'none', position: 117 }, 'A partial media scroll remains at the chosen position');
    if (width === 1440) {
      const rail = await page.evaluate(() => {
        const aside = document.createElement('aside');
        aside.className = 'home-feed-right-tabs';
        aside.style.height = '220px';
        aside.innerHTML = '<div class="home-feed-view-tabs">' + '<button class="home-feed-rail-tab">Navigation</button>'.repeat(8) + '</div><div class="home-feed-rail-bottom"><div class="home-feed-side-tools"><button class="home-feed-rail-tab">Tools</button></div></div>';
        document.body.append(aside);
        aside.scrollTop = aside.scrollHeight;
        const result = { overflow: getComputedStyle(aside).overflowY, moved: aside.scrollTop > 0, tabs: getComputedStyle(aside.firstElementChild).overflowY, tools: getComputedStyle(aside.querySelector('.home-feed-side-tools')).overflowY };
        aside.remove();
        return result;
      });
      assert.deepEqual(rail, { overflow: 'auto', moved: true, tabs: 'visible', tools: 'visible' }, 'The right sidebar scrolls as one panel');
    }
    results.push({ width, passed: true, ordinaryBrowser: true, nativeStoppedPropagation: true, singleHandoff: true,
      keyboard: true, cancelledHandlers: true, internalRouting: true, rejectedUnsafeUrls: 4, hostFailureFeedback: true });
    console.log('PASS: source link browser/native propagation, cancellation, single handoff, keyboard, URL safety and errors at ' + width + 'px');
    await context.close();
  }
  const output = path.join(root, '.cache', 'native-source-links-20261013');
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results, liveRequests: false }, null, 2) + '\n');
} finally { await browser?.close(); await server.close(); }
