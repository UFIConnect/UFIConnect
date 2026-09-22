import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';
import { installAuditMember, auditNavigate } from './audit-session.mjs';

const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const app = await createAppHarness();
app.seedUser(member('confirmation-audit', { name: 'Confirmation test member' }));
const server = await startBuiltServer({ port: 0 });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };

try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const requests = [];
    let pendingDelete;
    async function waitForDelete() {
      const deadline = Date.now() + 5000;
      while (!pendingDelete && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      assert.ok(pendingDelete, 'Expected an intercepted deletion request within five seconds');
    }
    let groupOwner = 'confirmation-audit';
    let profileWrites = 0;
    const group = () => ({ id: 'confirmation-group', name: 'Confirmation audit group', createdBy: groupOwner, description: 'A synthetic group for interface checks.', category: 'Engineering', members: 1, isJoined: true });
    await context.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url());
      const headers = { 'Access-Control-Allow-Origin': server.origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (!['fetch', 'xhr'].includes(request.resourceType())) return url.origin === server.origin ? route.continue() : route.abort();
      const endpoint = url.pathname.replace(/^\/(api|fallback)/, '');
      const fulfill = json => route.fulfill({ json, headers });
      if (request.method() === 'DELETE') {
        requests.push({ endpoint, authorized: /^Bearer /i.test(request.headers().authorization || '') });
        const result = await new Promise(resolve => { pendingDelete = resolve; });
        return route.fulfill({ ...result, headers });
      }
      if (endpoint === '/profile' && request.method() !== 'GET') profileWrites++;
      if (endpoint === '/profile') return fulfill(app.fullProfile(app.users[0]));
      if (endpoint === '/billing/config') return fulfill({ paymentsReady: false, tiers: {}, pricing: {} });
      if (endpoint === '/billing/status') return fulfill({ plan: 'free', subscriptions: [] });
      if (endpoint === '/groups/confirmation-group') return fulfill({ group: group() });
      if (endpoint === '/groups/confirmation-group/members') return fulfill({ members: [] });
      if (endpoint === '/feed' || endpoint.endsWith('/posts')) return fulfill({ posts: [], hasMore: false });
      if (endpoint === '/notifications') return fulfill({ notifications: [], unreadCount: 0 });
      return fulfill({ sources: [], groups: [], items: [], connected: {} });
    });
    await installAuditMember(page, app, 'confirmation-audit');

    async function exerciseDialog({ path, triggerName, title, endpoint, successPath }) {
      await auditNavigate(page, server.origin + path);
      const trigger = page.getByRole('button', { name: triggerName, exact: true });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      await dialog.waitFor();
      const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
      const confirm = dialog.getByRole('button', { name: 'Confirm delete', exact: true });
      check(await dialog.locator('input, textarea').count() === 0, `${title}: no command typing`);
      check(await cancel.evaluate(element => element === document.activeElement), `${title}: Cancel has initial keyboard focus`);
      check(await dialog.getByText('cannot be undone', { exact: false }).isVisible(), `${title}: consequences are visible`);
      check(await confirm.isEnabled(), `${title}: an explicit choice can confirm`);
      await page.keyboard.press('Tab');
      check(await confirm.evaluate(element => element === document.activeElement), `${title}: confirmation is keyboard reachable`);
      await page.keyboard.press('Shift+Tab');
      check(await cancel.evaluate(element => element === document.activeElement), `${title}: cancellation is keyboard reachable`);
      const rect = await dialog.boundingBox();
      check(rect.x >= 0 && rect.x + rect.width <= width && rect.y >= 0 && rect.y + rect.height <= 844, `${title}: modal fits ${width}px`);
      check((await cancel.boundingBox()).height >= 44 && (await confirm.boundingBox()).height >= 44, `${title}: actions have mobile touch targets`);
      const before = requests.length;
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      check(await trigger.evaluate(element => element === document.activeElement), `${title}: dismissal restores focus`);
      check(requests.length === before, `${title}: Escape cannot delete`);
      await trigger.click(); await cancel.click();
      await dialog.waitFor({ state: 'hidden' });
      check(requests.length === before, `${title}: Cancel cannot delete`);
      await trigger.click();
      // Two same-task clicks exercise the synchronous guard, before a render.
      await confirm.evaluate(element => { element.click(); element.click(); });
      await dialog.getByRole('button', { name: 'Deleting…', exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('dialog[aria-busy="true"]'));
      await waitForDelete();
      check(requests.length === before + 1, `${title}: duplicate clicks submit only once`);
      check(requests.at(-1).endpoint === endpoint && requests.at(-1).authorized, `${title}: authenticated endpoint is unchanged`);
      check(await cancel.isDisabled(), `${title}: in-flight operation cannot be dismissed`);
      await page.keyboard.press('Escape');
      check(await dialog.isVisible(), `${title}: Escape cannot hide an in-flight operation`);
      pendingDelete({ status: 409, json: { message: 'This action did not finish. Please try again.' } }); pendingDelete = null;
      await dialog.getByRole('alert').waitFor();
      check(await dialog.getByRole('alert').innerText() === 'This action did not finish. Please try again.', `${title}: failure remains visible for recovery`);
      check(await confirm.isEnabled() && await cancel.isEnabled(), `${title}: failed deletion permits retry or cancel`);
      check(new URL(page.url()).pathname === path, `${title}: failure does not navigate or sign out`);
      await fs.mkdir('.cache/audit-ui', { recursive: true });
      await page.screenshot({ path: `.cache/audit-ui/confirmation-${triggerName.startsWith('Delete account') ? 'account' : 'group'}-${width}.png` });
      await confirm.click();
      await waitForDelete();
      pendingDelete({ status: 200, json: { ok: true } }); pendingDelete = null;
      await dialog.waitFor({ state: 'hidden' });
      await page.waitForURL(url => url.pathname === successPath);
      check(requests.length === before + 2, `${title}: retry submits only one additional request`);
    }

    await exerciseDialog({ path: '/groups/confirmation-group', triggerName: 'Delete group', title: 'Delete Confirmation audit group?', endpoint: '/groups/confirmation-group', successPath: '/' });
    groupOwner = 'someone-else';
    await auditNavigate(page, server.origin + '/groups/confirmation-group');
    await page.getByRole('heading', { name: 'Confirmation audit group', exact: true }).waitFor();
    check(await page.getByRole('button', { name: 'Delete group', exact: true }).count() === 0, 'Another member cannot see the group deletion action');
    await exerciseDialog({ path: '/settings', triggerName: 'Delete account', title: 'Delete your account?', endpoint: '/profile', successPath: '/login' });
    check(profileWrites === 0, 'Confirmation buttons cannot submit the enclosing account settings form');
    check(errors.length === 0, `No browser errors at ${width}px: ${errors.join('; ')}`);
    await context.close();
  }
  await fs.writeFile('.cache/audit-ui/confirmation-results.json', JSON.stringify({ checks, widths: [1440, 390, 320], passed: true, liveDeletions: 'none; all DELETE requests intercepted' }, null, 2));
  console.log(`PASS: ${checks} selectable confirmation browser checks.`);
} finally { await browser.close(); await server.close(); await app.close(); }
