import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-scroll-refresh');
await fs.mkdir(output, { recursive: true });
const harness = path.join(output, 'harness.jsx');
await fs.writeFile(harness, `
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useScrollToRefresh } from '/src/hooks/useScrollToRefresh.js';
const h = React.createElement;
function Audit() {
  const [mode, setMode] = useState('document');
  const [enabled, setEnabled] = useState(true);
  const [outcome, setOutcome] = useState('pending');
  const [calls, setCalls] = useState(0);
  const ref = useRef(null);
  const state = useScrollToRefresh(() => {
    setCalls(value => value + 1);
    if (outcome === 'throw') throw new Error('Audit synchronous failure');
    if (outcome === 'reject') return Promise.reject(new Error('Audit rejected request'));
    return new Promise(resolve => { window.__resolveRefresh = resolve; });
  }, { containerRef: mode === 'document' ? null : ref, enabled, cooldownMs: 0 });
  window.__refreshAudit = { state, calls, enabled, mode };
  window.__refreshControl = { setMode, setEnabled, setOutcome };
  const block = (id, props, text) => h('div', { id, ...props }, text || id);
  return h(React.Fragment, null,
    h('output', { id: 'result' }, JSON.stringify(window.__refreshAudit)),
    h('main', { id: 'surface', ref, style: { height: mode === 'nested' ? 220 : 'auto', overflowY: mode === 'nested' ? 'auto' : 'visible', marginTop: 10, background: '#eee' } },
      block('plain', { style: { height: 100 } }),
      h('input', { id: 'input', placeholder: 'Composer input' }),
      h('form', { id: 'composer' }, block('composer-body', {})),
      block('editable', { contentEditable: true, suppressContentEditableWarning: true }),
      block('source-rail', { className: 'feed-source-tabs' }),
      block('snaps', { className: 'snap-rail' }),
      block('dialog', { role: 'dialog' }),
      block('opt-out', { 'data-scroll-refresh': 'ignore' }),
      block('comments', { style: { overflowY: 'auto', height: 50 } }, h('div', { id: 'comments-body', style: { height: 300 } }, 'Nested comments')),
      block('spacer', { style: { height: 1800 } })
    )
  );
}
createRoot(document.getElementById('root')).render(h(React.StrictMode, null, h(Audit)));
`);
const server = await createServer({
  root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  cacheDir: path.join(output, 'vite'),
  server: { host: '127.0.0.1', port: 5289, strictPort: false, fs: { allow: [root] } },
  plugins: [{ name: 'scroll-refresh-audit', configureServer(vite) {
    vite.middlewares.use('/__scroll-refresh-audit', async (_request, response, next) => {
      try {
        const html = await vite.transformIndexHtml('/__scroll-refresh-audit', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:10px;font:16px sans-serif;overscroll-behavior:none}output{display:block;position:sticky;top:0;background:white;z-index:2;overflow-wrap:anywhere}input{display:block}#surface>div,#surface>form{padding:8px;box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/@fs/' + harness.replaceAll('\\', '/') + '"></script></body></html>');
        response.setHeader('Content-Type', 'text/html');
        response.end(html);
      } catch (error) { next(error); }
    });
  } }],
});
let browser;
let checks = 0;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }].filter(viewport => !process.argv.includes('--mobile-only') || viewport.width === 390);
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: viewport.width < 600 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL('__scroll-refresh-audit', server.resolvedUrls.local[0]).href);
    await page.waitForFunction(() => window.__refreshAudit);
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const calls = () => page.evaluate(() => window.__refreshAudit.calls);
    const expectCalls = async (expected, label) => { await settle(); assert.equal(await calls(), expected, label); checks += 1; };
    const wheel = async (selector = '#plain', deltaY = -120, options = {}) => {
      await page.locator(selector).evaluate((element, data) => element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: data.deltaY, ...data.options })), { deltaY, options });
      await settle();
    };
    const pull = async (selector = '#plain', options = {}) => {
      await page.locator(selector).evaluate((element, options) => {
        const { dx = 0, dy = 80, cancel = false, horizontalFirst = false } = options;
        const send = (type, x, y, count = 1) => {
          const point = new Touch({ identifier: 1, target: element, clientX: x, clientY: y });
          const points = type === 'touchend' || type === 'touchcancel' ? [] : Array.from({ length: count }, () => point);
          element.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: points, changedTouches: [point] }));
        };
        send('touchstart', 120, 100);
        if (horizontalFirst) send('touchmove', 200, 105);
        send('touchmove', 120 + dx, 100 + dy, options.multi ? 2 : 1);
        send(cancel ? 'touchcancel' : 'touchend', 120 + dx, 100 + dy);
      }, options);
      await settle();
    };
    const finish = async () => {
      await page.evaluate(() => window.__resolveRefresh());
      await page.waitForFunction(() => !window.__refreshAudit.state.refreshing);
      checks += 1;
    };
    const mode = async value => {
      await page.evaluate(value => window.__refreshControl.setMode(value), value);
      await page.waitForFunction(value => window.__refreshAudit.mode === value, value);
      await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('#surface').scrollTop = 0; });
      await settle();
    };

    // Ordinary native scrolling and navigation to the top are not a pull.
    await page.evaluate(() => window.scrollTo(0, 250));
    await settle();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectCalls(0, 'Programmatic return to the top does not refresh');
    if (viewport.width >= 600) {
      await page.locator('#plain').hover();
      await page.mouse.wheel(0, 160);
      await page.waitForFunction(() => window.scrollY > 0);
      await expectCalls(0, 'Native downward scrolling remains available');
      await page.mouse.wheel(0, -500);
      await page.waitForFunction(() => window.scrollY === 0);
      await expectCalls(0, 'A wheel returning from below the top does not refresh twice');
      await page.waitForTimeout(150);
      await page.mouse.wheel(0, -120);
    } else {
      const touchSession = await context.newCDPSession(page);
      await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 155 }] });
      for (const y of [125, 95, 60, 20]) {
        await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y }] });
        await settle();
      }
      await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(() => window.scrollY > 0);
      await expectCalls(0, 'Native touch scrolling remains available');
      await page.evaluate(() => window.scrollTo(0, 0));
      await settle();
      await pull();
      await touchSession.detach();
    }
    await page.waitForFunction(() => window.__refreshAudit.state.refreshing);
    await expectCalls(1, 'A deliberate gesture at the document top refreshes');
    await wheel();
    await pull();
    assert.equal(await page.evaluate(() => window.__refreshAudit.state.refreshing), true, 'A new touch cannot hide an active request'); checks += 1;
    await expectCalls(1, 'Multiple gestures share one request');

    // A temporarily disabled surface keeps its lock and pending indicator.
    await page.evaluate(() => window.__refreshControl.setEnabled(false));
    await page.waitForFunction(() => !window.__refreshAudit.enabled);
    await page.evaluate(() => window.__refreshControl.setEnabled(true));
    await page.waitForFunction(() => window.__refreshAudit.enabled && window.__refreshAudit.state.refreshing);
    await wheel();
    await expectCalls(1, 'Re-enabling a busy surface keeps the in-flight lock');
    await finish();

    for (const selector of ['#input', '#composer-body', '#editable', '#source-rail', '#snaps', '#dialog', '#opt-out', '#comments-body']) {
      await pull(selector);
      await wheel(selector);
      await expectCalls(1, selector + ' keeps its own gestures');
    }
    await pull('#plain', { cancel: true });
    await pull('#plain', { dx: 120, dy: 30 });
    await pull('#plain', { horizontalFirst: true });
    await pull('#plain', { multi: true });
    await wheel('#plain', -120, { deltaX: 150 });
    await wheel('#plain', -120, { ctrlKey: true });
    await expectCalls(1, 'Cancelled, horizontal, multi-touch, and zoom gestures never refresh');
    await pull();
    await expectCalls(2, 'A deliberate document pull refreshes');
    await finish();

    await mode('nested');
    await page.evaluate(() => { document.querySelector('#surface').scrollTop = 140; });
    await page.waitForFunction(() => document.querySelector('#surface').scrollTop > 0);
    await wheel();
    await expectCalls(2, 'A nested feed must reach its own top before refresh');
    await page.evaluate(() => { document.querySelector('#surface').scrollTop = 0; });
    await pull();
    await expectCalls(3, 'Nested feed pull uses its own scroll root');
    await finish();
    await wheel('#comments-body');
    await expectCalls(3, 'Nested comments do not refresh their containing feed');

    await mode('flow');
    await page.evaluate(() => window.scrollTo(0, 180));
    await wheel();
    await expectCalls(3, 'Responsive document-flow container uses document position');
    await page.evaluate(() => window.scrollTo(0, 0));
    await pull();
    await expectCalls(4, 'Responsive document-flow container can refresh at document top');
    await finish();
    await page.waitForTimeout(150);

    await page.evaluate(() => window.__refreshControl.setOutcome('reject'));
    await settle();
    await wheel();
    await expectCalls(5, 'Rejected refresh was attempted');
    assert.equal(await page.evaluate(() => window.__refreshAudit.state.refreshing), false, 'Rejected refresh clears its indicator'); checks += 1;
    await page.evaluate(() => window.__refreshControl.setOutcome('throw'));
    await settle();
    await pull();
    await expectCalls(6, 'Synchronous failure does not leave refresh locked');
    await page.evaluate(() => window.__refreshControl.setOutcome('pending'));
    await settle();
    await pull();
    await expectCalls(7, 'A successful refresh remains possible after errors');
    await finish();
    assert.deepEqual(errors, [], 'No uncaught browser errors'); checks += 1;
    await page.screenshot({ path: path.join(output, 'refresh-' + viewport.width + '.png') });
    await context.close();
    console.log('PASS scroll refresh at ' + viewport.width + 'px');
  }
  console.log(checks + ' scroll-refresh checks passed.');
} finally {
  await browser?.close();
  await server.close();
}
