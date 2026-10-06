import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exportRoot = process.env.EXPO_EXPORT_DIR || path.join(mobileRoot, '.cache/export-sdk57');
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(exportRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(exportRoot + path.sep)) throw new Error('Outside export');
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = { id: 'self', name: 'Test Member', email: 'member@example.test', title: 'Designer', onboardingComplete: true, joinedGroups: ['g1'], skills: [], connectedPlatforms: [] };
const maya = { id: 'maya', name: 'Maya Fixture', title: 'Designer' }, sam = { id: 'sam', name: 'Sam Fixture', title: 'Engineer' };
const group = { id: 'g1', name: 'Fixture Community', category: 'Design', description: 'Fictional local test community.', members: 3 };
const posts = [maya, sam, profile].map((author, i) => ({ id: `p${i}`, author, group, content: `Fictional post from ${author.name}`, createdAt: new Date().toISOString(), likesCount: 1, commentsCount: 0, likedByMe: false }));
const conversations = [maya, sam].map(participant => ({ id: participant.id, participant, unreadCount: 0, lastMessage: { content: 'Synthetic conversation preview', createdAt: new Date().toISOString() } }));
let browser, checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const requests = [], errors = [], external = [];
let reportAttempts = 0, blockAttempts = 0, sendAttempts = 0, failBlockList = false;
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === base) return route.continue();
    if (url.origin !== 'https://api.uficonnect.org') { external.push(url.origin); return route.abort(); }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    requests.push({ method: request.method(), path: url.pathname, body: request.postDataJSON(), authorization: request.headers().authorization });
    const reply = (data, status = 200) => route.fulfill({ status, headers, json: data });
    if (url.pathname.startsWith('/analytics/')) return route.fulfill({ status: 204, headers });
    if (url.pathname === '/auth/login') return reply({ token: 'synthetic-session', profile });
    if (url.pathname === '/profile') return reply({ profile });
    if (url.pathname === '/users/blocked') return failBlockList ? reply({ message: 'Fixture outage' }, 503) : reply({ users: [] });
    if (url.pathname === '/feed') return reply({ posts });
    if (url.pathname === '/groups') return reply({ groups: [group] });
    if (url.pathname === '/groups/categories') return reply({ categories: ['Design'] });
    if (url.pathname === '/groups/g1/members') return reply({ members: [maya, sam, profile], total: 3 });
    if (url.pathname === '/messages') return reply({ conversations });
    if (url.pathname === '/messages/sam' && request.method() === 'POST') {
      sendAttempts++;
      return sendAttempts === 1 ? reply({ message: 'Fixture failure' }, 503) : reply({ message: { id: 'sent1', senderId: 'self', content: request.postDataJSON().content, createdAt: new Date().toISOString() } });
    }
    if (url.pathname.startsWith('/messages/')) return reply({ messages: [{ id: 'message1', senderId: url.pathname.split('/').at(-1), content: 'A synthetic message to test safety controls.', createdAt: new Date().toISOString() }] });
    if (url.pathname === '/reports') {
      reportAttempts++;
      return reportAttempts === 1 ? reply({ message: 'Fixture outage' }, 503) : reply({ ok: true });
    }
    if (/^\/users\/[^/]+\/block$/.test(url.pathname)) {
      blockAttempts++;
      return blockAttempts === 1 ? reply({ message: 'Fixture outage' }, 503) : reply({ ok: true, blocked: true });
    }
    return reply({ opportunities: [], categories: [], posts: [], users: [] });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  async function signIn() {
    await page.goto(base);
    const decline = page.getByRole('button', { name: 'Decline analytics', exact: true });
    if (await decline.isVisible()) await decline.click();
    await page.getByPlaceholder('you@example.com').fill(profile.email);
    await page.getByLabel('Password', { exact: true }).fill('Fictional local test passphrase');
    await page.getByText('Sign in', { exact: true }).click();
    await page.getByRole('tab', { name: 'Feed' }).click();
  }
  await signIn();
  await page.getByText(posts[0].content, { exact: true }).waitFor();
  check(await page.getByText('Share', { exact: true }).count() === 0, 'Nonfunctional Share control is removed');
  check(await page.getByRole('button', { name: `Report or block post by ${profile.name}`, exact: true }).count() === 0, 'Own-account safety controls are omitted');
  await page.getByRole('button', { name: 'Report or block post by Maya Fixture', exact: true }).click();
  await page.getByRole('button', { name: 'Report post', exact: true }).click();
  check(await page.getByRole('button', { name: 'Submit report', exact: true }).isDisabled(), 'A report requires a reason');
  await page.getByRole('radio', { name: 'Child safety concern', exact: true }).click();
  await page.getByLabel('Report details', { exact: true }).fill('Synthetic safety report details');
  await page.getByRole('button', { name: 'Submit report', exact: true }).click();
  await page.getByText('Could not submit your report. Please try again.', { exact: true }).waitFor();
  check(await page.getByLabel('Report details', { exact: true }).inputValue() === 'Synthetic safety report details', 'Failed report preserves details');
  await page.getByRole('button', { name: 'Submit report', exact: true }).click();
  await page.getByText('Report submitted. Thank you for letting us know.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  check(requests.some(value => value.path === '/reports' && value.authorization === 'Bearer synthetic-session' && value.body.targetType === 'post' && value.body.targetId === 'p0' && value.body.reason === 'child_safety'), 'Post report uses authenticated backend contract');
  async function chooseBlock() {
    await page.getByRole('button', { name: 'Report or block post by Maya Fixture', exact: true }).click();
    await page.getByRole('button', { name: 'Block user', exact: true }).click();
  }
  await chooseBlock();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  check(blockAttempts === 0, 'Cancel does not block or send a request');
  await chooseBlock();
  await page.getByRole('button', { name: 'Confirm block', exact: true }).click();
  await page.getByText('Could not block this user. Please try again.', { exact: true }).waitFor();
  check(await page.getByText(posts[0].content, { exact: true }).count() === 1, 'Failed block keeps feed content intact');
  await page.getByRole('button', { name: 'Confirm block', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByText(posts[0].content, { exact: true }).waitFor({ state: 'hidden' });
  check(await page.getByText(posts[1].content, { exact: true }).isVisible(), 'Blocking one author keeps other authors visible');
  await page.getByRole('tab', { name: 'Groups' }).click();
  await page.getByText(group.name, { exact: true }).click();
  await page.getByText(sam.name, { exact: true }).last().waitFor();
  check(await page.getByText(maya.name, { exact: true }).count() === 0, 'Blocked user disappears from group members');
  await page.getByRole('button', { name: 'Report or block Sam Fixture', exact: true }).click();
  await page.getByRole('button', { name: 'Report user', exact: true }).click();
  await page.getByRole('radio', { name: 'Spam or scam', exact: true }).click();
  await page.getByRole('button', { name: 'Submit report', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  check(requests.some(value => value.path === '/reports' && value.body.targetType === 'user' && value.body.targetId === 'sam'), 'Member report targets the user');
  await page.getByRole('tab', { name: 'Messages' }).click();
  await page.getByText(sam.name, { exact: true }).last().waitFor();
  check(await page.getByText(maya.name, { exact: true }).count() === 0, 'Blocked conversation is hidden');
  await page.getByText(sam.name, { exact: true }).last().click();
  await page.getByPlaceholder('Message...').fill('Keep this draft if sending fails.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByText('Message could not be sent. Your draft is still here.', { exact: true }).waitFor();
  check(await page.getByPlaceholder('Message...').inputValue() === 'Keep this draft if sending fails.', 'Failed send preserves the draft');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[placeholder="Message..."]')?.value === '');
  await page.getByText('Keep this draft if sending fails.', { exact: true }).waitFor();
  check(await page.getByPlaceholder('Message...').inputValue() === '', 'Confirmed send clears the draft');
  await page.getByRole('button', { name: 'Report or block Sam Fixture', exact: true }).last().click();
  await page.getByRole('button', { name: 'Block user', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm block', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByText('You blocked this user. Messages are hidden.', { exact: true }).waitFor();
  check(await page.getByPlaceholder('Message...').count() === 0 && await page.getByRole('button', { name: 'Send message', exact: true }).count() === 0, 'Blocking in chat removes the composer');
  await page.getByRole('tab', { name: 'Feed' }).click();
  await page.getByText(posts[2].content, { exact: true }).waitFor();
  check(await page.getByText(posts[1].content, { exact: true }).count() === 0, 'Blocking from chat also filters the feed');
  check(!requests.some(value => value.path.startsWith('/social/')), 'No demo provider requests');
  failBlockList = true;
  await signIn();
  await page.getByText('Could not load blocked accounts. Please retry.', { exact: true }).waitFor();
  check(await page.getByText(posts[0].content, { exact: true }).count() === 0, 'Failed initial block-list fetch does not expose posts');
  failBlockList = false;
  await page.getByRole('button', { name: 'Retry blocked accounts', exact: true }).click();
  await page.getByText(posts[0].content, { exact: true }).waitFor();
  check(errors.length === 0, `No browser runtime errors: ${errors.join('; ')}`);
  check(external.length === 0, 'All remote API responses were local fixtures; no other external requests');
  await context.close();
  console.log(`Native moderation exported-web integration: ${checks} checks passed; all API responses mocked, no production mutations.`);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
