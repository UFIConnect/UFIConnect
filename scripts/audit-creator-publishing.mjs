import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';
import { installAuditMember, auditNavigate } from './audit-session.mjs';

// Every API and provider request is intercepted. The intentional 16-second
// responses verify that video publication survives the former 15-second limit.
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const waitFor = async (condition, label, timeout = 20000) => {
  const until = Date.now() + timeout;
  while (!await condition()) { if (Date.now() > until) throw Error(label); await delay(25); }
};
const profiles = ['creator-a', 'creator-b'].map(id => ({ id, name: id, email: `${id}@example.invalid`, plan: 'pro', onboardingComplete: true,
  joinedGroups: ['creator-group'], skills: [], socialAccounts: {}, preferences: { interests: [], goals: [] }, roleSettings: {}, links: {} }));
const app = { request: async (_path, { userId } = {}) => ({ status: 200, data: profiles.find(profile => profile.id === userId) || profiles[0] }),
  token: userId => Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ id: userId || profiles[0].id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.synthetic-creator-audit' };
const server = await startBuiltServer({ port: 0 });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
const report = { checks: 0, publishingRequests: 0, videoResponseDelaysMs: [], providerWrites: false, passed: false };
const check = (value, label) => { assert.ok(value, label); report.checks++; };
let context, page;
try {
  context = await browser.newContext({ viewport: { width: 390, height: 1000 }, serviceWorkers: 'block' });
  page = await context.newPage(); page.setDefaultTimeout(30000);
  const errors = [], writes = [], syncs = [], histories = new Map(profiles.map(profile => [profile.id, []]));
  let owner = profiles[0].id, mode = 'main', modeChecks = 0, syncHold = null, abortedSync = false;
  await context.exposeBinding('__creatorAuditSyncAbort', () => { abortedSync = true; });
  await context.addInitScript(() => {
    const originalFetch = window.fetch;
    window.fetch = function(input, options) {
      const rawUrl = typeof input === 'string' ? input : input?.url;
      if (rawUrl && new URL(rawUrl, location.href).pathname.endsWith('/cross-post/sync')) {
        const signal = options?.signal || input?.signal;
        signal?.addEventListener('abort', () => { void window.__creatorAuditSyncAbort(); }, { once: true });
      }
      return originalFetch.apply(this, arguments);
    };
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => { if (new URL(request.url()).pathname.endsWith('/cross-post/sync')) abortedSync = true; });
  const youtube = status => ({ platform: 'youtube', status, publishId: 'synthetic-video-123', providerId: 'synthetic-video-123',
    destinationId: 'creator-channel', privacyStatus: 'unlisted', postedUrl: 'https://www.youtube.com/watch?v=synthetic-video-123',
    ...(status === 'processing' ? { processingProgress: 28 } : { providerStatus: 'processed', processingProgress: 100, statusCheckedAt: new Date().toISOString() }) });
  const unrelated = { id: 'unrelated-batch', content: 'Unrelated completed creator upload.', createdAt: '2026-11-04T12:00:00Z', targets: [{ ...youtube('posted'), publishId: 'other-video-456', providerId: 'other-video-456' }] };
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), requestOwner = owner;
    const headers = { 'Access-Control-Allow-Origin': server.origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*' };
    const reply = async (json, status = 200) => { try { await route.fulfill({ headers, status, json }); } catch {} };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.hostname === 'api.cloudinary.com') return reply({ secure_url: 'https://res.cloudinary.com/fixture/video/upload/creator.mp4', resource_type: 'video' });
    if (!['xhr', 'fetch'].includes(request.resourceType())) return url.origin === server.origin ? route.continue() : route.abort();
    const endpoint = url.pathname.replace(/^\/(api|fallback)/, '');
    if (endpoint === '/profile') return reply(profiles.find(profile => profile.id === requestOwner));
    if (endpoint === '/auth/session') return reply({ token: app.token(requestOwner), profile: profiles.find(profile => profile.id === requestOwner) });
    if (endpoint === '/billing/status') return reply({ plan: 'pro' });
    if (endpoint === '/groups/internal') return reply({ groups: [{ id: 'creator-group', name: 'Creator group', isJoined: true }] });
    if (endpoint === '/social/platforms') return reply({ connected: { youtube: true, linkedin: true }, platforms: {
      youtube: { name: 'YouTube', configured: true, connectionMode: 'oauth', category: 'video', crossPost: { supported: true, media: 'video', allowedMedia: ['video'], requiresVideo: true, settingsRequired: true } },
      linkedin: { name: 'LinkedIn', configured: true, connectionMode: 'oauth', category: 'social', crossPost: { supported: true, media: 'link' } },
    } });
    if (endpoint === '/media/upload-signature') return reply({ apiKey: 'fixture', timestamp: 1, signature: 'fixture', folder: 'crossposts', cloudName: 'fixture' });
    if (endpoint === '/command-center/cross-post/youtube/destinations') return reply({ label: 'YouTube video', destinationLabel: 'YouTube channel', destinations: [{ id: 'creator-channel', label: 'My creator channel' }],
      fields: [{ key: 'title', label: 'Video title', type: 'text', required: true },
        { key: 'privacyStatus', label: 'Video visibility', type: 'select', required: true, options: [{ value: 'unlisted', label: 'Unlisted' }] },
        { key: 'madeForKids', label: 'Is this video made for kids?', type: 'select', required: true, options: [{ value: 'no', label: 'No, not made for kids' }] }] });
    if (endpoint === '/command-center/cross-post/history') return reply({ posts: histories.get(requestOwner) });
    if (endpoint === '/command-center/cross-post' && request.method() === 'POST') {
      const body = request.postDataJSON(); writes.push({ owner: requestOwner, body });
      const started = Date.now();
      await delay(16000); report.videoResponseDelaysMs.push(Date.now() - started);
      const row = { id: `creator-batch-${writes.length}`, content: body.content, mediaUrl: body.mediaUrl, createdAt: new Date().toISOString(),
        targets: body.platforms.map(platform => platform === 'youtube' ? youtube('processing') : { platform, status: 'posted', postedUrl: 'https://www.linkedin.com/feed/update/creator-fixture' }) };
      histories.get(requestOwner).unshift(row);
      return reply({ id: row.id, historySaved: true, mediaUrl: row.mediaUrl, targets: row.targets });
    }
    if (endpoint === '/command-center/cross-post/sync' && request.method() === 'POST') {
      syncs.push({ owner: requestOwner, mode, time: Date.now() }); modeChecks++;
      const rows = histories.get(requestOwner);
      if (mode === 'main' && modeChecks === 1) return reply({ message: 'Synthetic status transport outage.' }, 503);
      if (mode === 'owner' && syncHold) { syncHold.started.resolve(); await syncHold.release.promise; return reply({ posts: rows, updated: 1 }); }
      if (mode === 'main' && modeChecks === 2 || mode === 'inline' && modeChecks === 1) return reply({ posts: mode === 'inline' ? [unrelated] : [...rows, unrelated], updated: 0 });
      const next = rows.map(row => ({ ...row, targets: row.targets.map(target => target.platform === 'youtube' ? { ...target, ...youtube('posted') } : target) }));
      histories.set(requestOwner, next);
      return reply({ posts: [...next, unrelated], updated: 1 });
    }
    return reply({ posts: [], groups: [], items: [], sources: [], members: [], invitations: [] });
  });
  await installAuditMember(page, app, owner);
  await auditNavigate(page, server.origin + '/command-center?tab=crosspost');
  const section = page.getByRole('tabpanel', { name: 'Cross-Post', exact: true });
  const editor = section.getByRole('textbox', { name: 'Post draft', exact: true });
  const primary = count => page.getByRole('button', { name: new RegExp(`^Publish to ${count} ready destinations?$`) });
  const settings = page.getByRole('group', { name: 'YouTube video', exact: true });
  const fillVideoSettings = async title => {
    await settings.getByRole('combobox', { name: 'YouTube channel', exact: true }).selectOption('creator-channel');
    await settings.getByRole('textbox', { name: 'Video title', exact: true }).fill(title);
    await settings.getByRole('combobox', { name: 'Video visibility', exact: true }).selectOption('unlisted');
    await settings.getByRole('combobox', { name: 'Is this video made for kids?', exact: true }).selectOption('no');
  };
  console.log('Creator audit: 16-second main video publication and independent ready destinations');
  const mainContent = 'A reviewed creator video.';
  await editor.fill(mainContent);
  await section.getByRole('button', { name: 'YouTube: Connected', exact: true }).click();
  await section.getByRole('button', { name: 'LinkedIn: Connected', exact: true }).click();
  await section.getByLabel('Add video for YouTube', { exact: true }).setInputFiles({ name: 'creator.mp4', mimeType: 'video/mp4', buffer: Buffer.from('synthetic creator video') });
  await fillVideoSettings('Creator video');
  await primary(2).click();
  const result = section.getByRole('heading', { name: 'Result', exact: true }).locator('..');
  await result.getByRole('link', { name: 'View on YouTube', exact: true }).waitFor();
  check(report.videoResponseDelaysMs[0] > 15000, 'Main video publication survives a response beyond fifteen seconds');
  check(writes.length === 1 && writes[0].body.mediaType === 'video' && writes[0].body.platforms.includes('linkedin'), 'The other ready provider shares one publication request');
  check((await result.innerText()).includes('Uploaded to YouTube. Processing (28%).'), 'Accepted upload shows actual provider processing progress and a direct link');
  await editor.fill('My next draft stays intact while the uploaded video is checked.');
  await section.getByRole('button', { name: 'LinkedIn: Connected', exact: true }).click();
  await section.getByText(/Status updates are delayed/).waitFor();
  check(await primary(1).isEnabled(), 'A processing video and temporary status failure do not block another ready draft');
  const beforeHidden = syncs.length;
  await page.evaluate(() => {
    window.__creatorAuditHidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__creatorAuditHidden });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  console.log('Creator audit: hidden pause, transient-error backoff and exact batch merge');
  await delay(11000);
  check(syncs.length === beforeHidden, 'Hidden pages do not keep polling during backoff');
  await page.evaluate(() => { window.__creatorAuditHidden = false; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  await waitFor(() => syncs.length >= 2, 'Visible status checking did not resume');
  await result.getByRole('link', { name: 'View on YouTube', exact: true }).waitFor();
  check((await result.innerText()).includes('Processing'), 'An unrelated completed batch does not complete the current upload');
  await result.locator('a[href*="youtube.com/watch"]').filter({ hasText: 'View post' }).waitFor();
  const historyRow = section.getByText(mainContent, { exact: true }).locator('..');
  await historyRow.locator('a[href*="youtube.com/watch"]').filter({ hasText: 'View' }).waitFor();
  check(!(await historyRow.innerText()).includes('Processing'), 'Automatic completion reaches matching history and the current result');
  check(await editor.inputValue() === 'My next draft stays intact while the uploaded video is checked.', 'Status updates preserve the new draft');
  check(await section.getByRole('button', { name: 'LinkedIn: Connected', exact: true }).getAttribute('aria-pressed') === 'true', 'Status updates preserve the next selected destination');
  check(writes.length === 1, 'Status polling never resends the publication');
  await fs.mkdir('.cache/audit-ui', { recursive: true });
  await page.screenshot({ path: '.cache/audit-ui/creator-status-main-390.png', fullPage: true });
  console.log('Creator audit: 16-second inline video publication and exact current result');
  mode = 'inline'; modeChecks = 0;
  await auditNavigate(page, server.origin + '/groups/post?group=creator-group');
  const inlineEditor = page.getByLabel('Your post', { exact: true });
  await inlineEditor.fill('An inline creator video.');
  await page.getByRole('button', { name: 'This group: Connected', exact: true }).click();
  await page.getByRole('button', { name: 'Select YouTube', exact: true }).click();
  await page.getByLabel('Add video for YouTube', { exact: true }).setInputFiles({ name: 'inline.mp4', mimeType: 'video/mp4', buffer: Buffer.from('synthetic inline video') });
  await fillVideoSettings('Inline creator video');
  await primary(1).click();
  const inlineResults = page.getByRole('region', { name: 'Publishing results', exact: true });
  await inlineResults.getByText(/YouTube: Processing/).waitFor();
  check(report.videoResponseDelaysMs[1] > 15000, 'Inline video publication also survives a response beyond fifteen seconds');
  await inlineEditor.fill('The next inline draft.');
  await waitFor(() => syncs.some(value => value.mode === 'inline'), 'Inline status polling did not run');
  check((await inlineResults.innerText()).includes('YouTube: Processing'), 'The inline result ignores unrelated matching-platform history');
  await inlineResults.getByText('YouTube: Published', { exact: false }).waitFor();
  check(await inlineEditor.inputValue() === 'The next inline draft.', 'Inline completion preserves the next draft');
  check(writes.length === 2, 'Exactly one publication request was sent from each composer');
  await page.screenshot({ path: '.cache/audit-ui/creator-status-inline-390.png', fullPage: true });
  console.log('Creator audit: in-flight status cancellation on member replacement');
  histories.get(owner).unshift({ id: 'owner-guard-pending', content: 'Previous member pending receipt.', createdAt: new Date().toISOString(), targets: [youtube('processing')] });
  mode = 'owner'; modeChecks = 0; syncHold = { started: deferred(), release: deferred() };
  const hold = syncHold;
  await auditNavigate(page, server.origin + '/command-center?tab=crosspost');
  await editor.waitFor(); await waitFor(() => syncs.some(value => value.mode === 'owner'), 'The owner-guard status request did not start');
  const beforeOwnerSwitch = syncs.length;
  await page.getByRole('button', { name: 'Open account menu', exact: true }).click();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await waitFor(() => abortedSync, 'Signing out did not abort the previous status request', 5000);
  owner = profiles[1].id;
  await installAuditMember(page, app, owner);
  await auditNavigate(page, server.origin + '/command-center?tab=crosspost');
  await editor.waitFor(); hold.release.resolve(); syncHold = null;
  await delay(250);
  check(abortedSync, 'Replacing the member aborts the previous status request');
  check(await editor.inputValue() === '', 'An old status response cannot replace the next member draft');
  check(await section.getByText('Previous member pending receipt.', { exact: true }).count() === 0, 'Old-member receipts cannot appear in the next member history');
  check(!syncs.slice(beforeOwnerSwitch).some(value => value.owner === profiles[0].id), 'The old member polling loop stops after replacement');
  check(writes.length === 2, 'Navigation and member replacement do not publish');
  check(errors.length === 0, `No browser runtime errors: ${errors.join('; ')}`);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), `Creator composer fits ${width}px`);
  }
  report.publishingRequests = writes.length; report.statusRequests = syncs.length; report.passed = true;
  console.log(`PASS: creator publication/status lifecycle (${report.checks} checks); two slow synthetic videos, no provider writes.`);
} catch (error) {
  if (page) { await fs.mkdir('.cache/audit-ui', { recursive: true }); await page.screenshot({ path: '.cache/audit-ui/creator-status-failure.png', fullPage: true }); }
  throw error;
} finally {
  await fs.mkdir('.cache/audit-ui', { recursive: true });
  await fs.writeFile('.cache/audit-ui/creator-publishing-report.json', JSON.stringify(report, null, 2) + '\n');
  await context?.close(); await browser.close(); await server.close();
}
