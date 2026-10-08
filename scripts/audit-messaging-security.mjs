// Synthetic browser fixtures only; no production accounts or storage writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-messaging-security');
const fixture = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, Routes, Route, useNavigate} from 'react-router-dom';
import {AuthProvider} from '/src/contexts/AuthContext.jsx';
import {setAccessToken, clearSession} from '/src/auth/session.js';
import Conversation from '/src/pages/Conversation.jsx';
import Messages from '/src/pages/Messages.jsx';
import '/src/index.css';
setAccessToken('fixture-account-a');
function Fixture() {
  const navigate=useNavigate();
  window.__messageAudit={navigate, switchAccount:()=>setAccessToken('fixture-account-b'), logout:clearSession};
  return React.createElement(React.Fragment,null,
    React.createElement('nav',null,...[['Bob','/messages/bob'],['Carol','/messages/carol'],['inbox','/messages']].map(([label,to])=>
      React.createElement('button',{key:to,onClick:()=>navigate(to)},'Open '+label))),
    React.createElement(Routes,null,
      React.createElement(Route,{path:'/messages/:userId',element:React.createElement(Conversation)}),
      React.createElement(Route,{path:'/messages',element:React.createElement(Messages,{embedded:true})})));
}
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,
  React.createElement(BrowserRouter,null,React.createElement(AuthProvider,null,React.createElement(Fixture)))));`;
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/api'),
    'import.meta.env.VITE_AUTH0_DOMAIN': JSON.stringify(''), 'import.meta.env.VITE_AUTH0_CLIENT_ID': JSON.stringify('') },
  plugins: [{ name: 'messaging-security-fixture',
    resolveId(id) { if (id === 'virtual:messaging-security-audit.jsx') return '\0virtual:messaging-security-audit.jsx'; },
    load(id) { if (id === '\0virtual:messaging-security-audit.jsx') return fixture; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (!new URL(req.url, 'http://fixture.invalid').pathname.startsWith('/messages')) return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Messaging security audit</title></head><body><div id="root"></div><script type="module" src="/@id/virtual:messaging-security-audit.jsx"></script></body></html>'));
    }); },
  }], server: { host: '127.0.0.1', port: 5271, strictPort: false } });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=', 'base64');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let browser, checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
try {
  await fs.mkdir(output, { recursive: true });
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], external = [], posts = [], attachmentReads = [];
    let holdRead = null, holdSend = null, holdUpload = null, signatures = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      window.__messageBlobUrls = { created: [], revoked: [] };
      URL.createObjectURL = value => { const url = create(value); window.__messageBlobUrls.created.push(url); return url; };
      URL.revokeObjectURL = url => { window.__messageBlobUrls.revoked.push(url); revoke(url); };
    });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const reply = (json, status = 200) => route.fulfill({ status, json }).catch(() => {});
      if (url.hostname === 'api.cloudinary.com' && request.method() === 'POST') {
        check(request.postData()?.includes('authenticated'), 'Message upload pins authenticated delivery');
        const held = holdUpload; holdUpload = null;
        if (held) { held.started.resolve(); await held.release.promise; }
        return reply({ resource_type: 'image', type: 'authenticated', public_id: 'uficonnect-messages/fixture-owned-upload', version: 1,
          signature: 'fixture-proof', secure_url: 'https://res.cloudinary.com/fixture-cloud/image/authenticated/fixture.jpg' });
      }
      if (url.origin !== new URL(base).origin) {
        external.push(request.url()); return route.fulfill({ status: 403, body: 'External requests disabled.' }).catch(() => {});
      }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const endpoint = url.pathname.slice(4), owner = request.headers().authorization?.replace('Bearer fixture-', '') || 'account-a';
      if (endpoint === '/profile') return reply({ id: owner, name: owner, email: `${owner}@example.invalid`, preferences: {}, roleSettings: {} });
      if (endpoint === '/auth/session') return reply({});
      if (endpoint === '/media/upload-signature') {
        signatures++; return reply({ cloudName: 'fixture-cloud', apiKey: 'fixture-key', timestamp: 1000, signature: 'fixture-signature',
          folder: 'uficonnect-messages', publicId: 'fixture-owned-upload', overwrite: false, deliveryType: 'authenticated' });
      }
      if (/^\/messages\/(bob|carol)\/attachments\/photo$/.test(endpoint)) {
        attachmentReads.push(endpoint);
        return route.fulfill({ contentType: 'image/png', body: png }).catch(() => {});
      }
      if (endpoint === '/messages/bob' || endpoint === '/messages/carol') {
        const recipient = endpoint.split('/').at(-1);
        if (request.method() === 'POST') {
          posts.push({ owner, recipient, body: request.postDataJSON() });
          const held = holdSend; holdSend = null;
          if (held) { held.started.resolve(); await held.release.promise; }
          return reply({ message: { id: 'sent', senderId: owner, content: 'Delayed Bob reply', createdAt: new Date().toISOString() } });
        }
        const held = recipient === 'bob' ? holdRead : null;
        if (held) { holdRead = null; held.started.resolve(); await held.release.promise; }
        return reply({ participant: { id: recipient, name: recipient === 'bob' ? 'Bob' : 'Carol' }, messages: [
          { id: 'text', senderId: recipient, content: `${owner} ${recipient} private message`, createdAt: new Date().toISOString() },
          { id: 'xss', senderId: recipient, content: '<img src="https://attacker.invalid/pixel" onerror="window.__xss=true">', createdAt: new Date().toISOString(),
            attachment: { type: 'image', url: 'javascript:alert(1)' } },
          { id: 'photo', senderId: recipient, content: '', createdAt: new Date().toISOString(),
            attachment: { type: 'image', bytes: png.length, accessPath: `/messages/${recipient}/attachments/photo` } },
        ] });
      }
      if (endpoint === '/messages') return reply({ conversations: [{ id: 'native', participant: { id: 'bob', name: 'Bob' }, lastMessage: { content: `${owner} inbox preview` }, unreadCount: 0 }] });
      if (endpoint === '/connected-inbox/messages') return reply({ conversations: [], sources: [] });
      return reply({ users: [], posts: [], notifications: [], conversations: [], sources: [] });
    });
    await page.goto(base + 'messages/bob');
    await page.getByText('account-a bob private message', { exact: true }).waitFor();
    check(attachmentReads.length === 0, 'Private attachments are not fetched automatically');
    check(await page.getByText('Attachment unavailable', { exact: true }).count() === 1, 'Unsafe message attachment is blocked');
    check(!(await page.evaluate(() => window.__xss)), 'Message HTML remains text');
    await page.getByRole('button', { name: 'View photo', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.msg-bubble img')?.naturalWidth === 1);
    check(attachmentReads.length === 1, 'Viewing attachment makes one authenticated relative request');
    await page.locator('.msg-input').fill('Draft for Bob');
    await page.getByRole('button', { name: 'Open Carol', exact: true }).click();
    await page.getByText('account-a carol private message', { exact: true }).waitFor();
    check(await page.locator('.msg-input').inputValue() === '', 'Changing recipient clears the draft');
    check(!(await page.getByText('account-a bob private message', { exact: true }).count()), 'Changing recipient clears old messages');
    check(await page.evaluate(() => window.__messageBlobUrls.created.every(url => window.__messageBlobUrls.revoked.includes(url))), 'Recipient navigation revokes private Blob URLs');

    holdRead = { started: deferred(), release: deferred() };
    const delayedRead = holdRead;
    await page.getByRole('button', { name: 'Open Bob', exact: true }).click();
    await delayedRead.started.promise;
    await page.getByRole('button', { name: 'Open Carol', exact: true }).click();
    await page.getByText('account-a carol private message', { exact: true }).waitFor();
    delayedRead.release.resolve(); await page.waitForTimeout(150);
    check(!(await page.getByText('account-a bob private message', { exact: true }).count()), 'Late read response cannot enter another recipient thread');

    await page.locator('input[type=file]').first().setInputFiles({ name: 'active.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg onload="alert(1)"/>') });
    await page.getByText('Choose a JPEG, PNG, WebP or GIF photo, or an MP4, WebM or MOV video.', { exact: false }).waitFor();
    check(signatures === 0, 'Active SVG is rejected before requesting an upload signature');
    holdUpload = { started: deferred(), release: deferred() };
    const delayedUpload = holdUpload;
    await page.locator('input[type=file]').first().setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
    await delayedUpload.started.promise;
    await page.getByRole('button', { name: 'Open Bob', exact: true }).click();
    await page.getByText('account-a bob private message', { exact: true }).waitFor();
    delayedUpload.release.resolve(); await page.waitForTimeout(150);
    check(!(await page.getByRole('button', { name: 'Remove attachment', exact: true }).count()), 'Late upload response cannot attach to a new recipient');

    holdSend = { started: deferred(), release: deferred() };
    const delayedSend = holdSend;
    await page.locator('.msg-input').fill('First member draft');
    await page.locator('.msg-input').press('Enter');
    await delayedSend.started.promise;
    await page.locator('.msg-input').press('Enter');
    check(posts.length === 1, 'A pending message cannot be submitted twice');
    await page.evaluate(() => window.__messageAudit.switchAccount());
    await page.getByText('account-b bob private message', { exact: true }).waitFor();
    delayedSend.release.resolve(); await page.waitForTimeout(150);
    check(await page.locator('.msg-input').inputValue() === '', 'Changing account clears the message draft');
    check(!(await page.getByText('Delayed Bob reply', { exact: true }).count()), 'Old account send response is discarded');
    check(posts[0].owner === 'account-a' && posts[0].recipient === 'bob', 'Message is sent only under its captured account and recipient');
    await page.getByRole('button', { name: 'Open inbox', exact: true }).click();
    await page.getByText('account-b inbox preview', { exact: true }).waitFor();
    check(!external.length, 'Messages do not load sender-selected external tracking URLs');
    check(!errors.length, 'Messaging renders without browser errors');
    await page.screenshot({ path: path.join(output, `messages-${width}.png`), fullPage: true });
    await context.close();
  }
  await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify({ checks, devices: [1440,390], result: 'passed' }, null, 2));
  console.log(`Messaging security browser audit passed (${checks} checks, desktop and phone).`);
} finally { await browser?.close(); await server.close(); }
