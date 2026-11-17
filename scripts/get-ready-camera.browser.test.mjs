import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';

const member = { id: 'camera-audit-member', name: 'Camera Audit', onboardingComplete: true, preferences: {} };
const privacyKey = `ufi:media-permissions:v1:${member.id}`;
const live = '/get-ready-with-us';
const inviteToken = `v2.${'A'.repeat(43)}`;
const guestId = 'approved-guest';
let server;

before(async () => {
  server = await startBuiltServer({ root: process.env.GET_READY_WEB_DIST });
});

after(async () => {
  await server?.close();
});

async function setup(t, { browserCamera = true } = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.grantPermissions(browserCamera ? ['camera', 'microphone'] : ['microphone'], { origin: server.origin });
  await context.addInitScript(origin => {
    if (window !== window.top || location.origin !== origin) return;
    localStorage.setItem('uficonnect.analytics.consent.v1', 'denied');
    localStorage.setItem('uficonnect.ads.consent.v1', 'denied');
    window.cameraRequests = [];
    let audioContext;
    // Use real MediaStreamTracks while controlling when the device request settles.
    navigator.mediaDevices.getUserMedia = async constraints => {
      const request = { constraints };
      window.cameraRequests.push(request);
      if (window.holdCameraRequest) {
        window.holdCameraRequest = false;
        await new Promise(resolve => { request.resume = resolve; });
      }
      if ((await navigator.permissions.query({ name: 'camera' })).state !== 'granted') {
        throw new DOMException('Browser camera permission denied', 'NotAllowedError');
      }
      const tracks = [];
      if (constraints.video) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 16;
        canvas.getContext('2d').fillRect(0, 0, 16, 16);
        tracks.push(...canvas.captureStream().getVideoTracks());
      }
      if (constraints.audio) {
        audioContext ||= new AudioContext();
        tracks.push(...audioContext.createMediaStreamDestination().stream.getAudioTracks());
      }
      request.stream = new MediaStream(tracks);
      return request.stream;
    };
    window.hostPeers = [];
    const Peer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer {
      addTrack(...args) {
        if (!window.hostPeers.includes(this)) window.hostPeers.push(this);
        return super.addTrack(...args);
      }
    };
  }, server.origin);

  const session = { requests: [], offer: '', admitted: false };
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== server.origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const endpoint = url.pathname.slice(4);
    const method = request.method();
    const json = data => route.fulfill({ json: data });
    if (endpoint === '/auth/session') return json({ token: 'camera-audit-token', profile: member });
    if (endpoint === '/profile' || endpoint === '/auth/me') return json(member);
    if (!endpoint.startsWith(live)) return json({ users: [], posts: [], notifications: [], postIds: [], jobs: [], groups: [] });

    session.requests.push({ method, endpoint });
    if (endpoint === `${live}/sessions` && method === 'POST') {
      const { sessionId, title, supportsApproval } = request.postDataJSON();
      session.id = sessionId;
      return json({ session: { id: sessionId, title: title || 'Test live session', viewerLimit: 6, requiresApproval: supportsApproval }, inviteToken, iceServers: [] });
    }
    if (endpoint.endsWith('/host')) {
      const guests = session.offer ? [{ id: guestId, name: 'Guest', admission: session.admitted ? 'approved' : 'pending' }] : [];
      const viewers = session.admitted ? [{ id: guestId, offer: session.offer, answered: session.answered }] : [];
      return json({ guests, viewers });
    }
    if (endpoint.endsWith('/admission')) session.admitted = request.postDataJSON().decision === 'approve';
    if (endpoint.endsWith('/answer')) session.answered = true;
    return route.fulfill({ status: 204 });
  });

  async function open(path) {
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    await page.goto(`${server.origin}${path}`, { waitUntil: 'domcontentloaded' });
    return page;
  }
  return { open, session };
}

const button = (page, name) => page.getByRole('button', { name, exact: true });
const cameraChoice = settings => settings.getByRole('combobox', { name: 'Camera permission', exact: true });
const consent = page => page.getByRole('dialog', { name: 'Allow camera access?' });
const accountError = page => page.getByRole('alert').filter({ hasText: 'Camera access is off for this account' });
const cameraCalls = page => page.evaluate(() => window.cameraRequests.length);

async function preview(page) {
  await button(page, 'Preview camera').click();
  await page.waitForFunction(() => document.querySelector('video[aria-label="Your camera preview"]')?.srcObject?.active);
}

async function holdBrowserRequest(page) {
  await page.evaluate(() => { window.holdCameraRequest = true; });
  await button(page, 'Preview camera').click();
  await page.waitForFunction(() => window.cameraRequests[0]?.resume);
}

async function resolveAndCheckStopped(page) {
  await page.evaluate(() => window.cameraRequests[0].resume());
  await page.waitForFunction(() => window.cameraRequests[0].stream?.getTracks().every(track => track.readyState === 'ended'));
}

test('a saved denial blocks capture even when browser camera access is already granted', async t => {
  const { open } = await setup(t);
  const settings = await open('/settings?tab=privacy');
  await cameraChoice(settings).selectOption('block');
  const studio = await open(live);
  assert.equal(await studio.evaluate(async () => (await navigator.permissions.query({ name: 'camera' })).state), 'granted');
  await button(studio, 'Preview camera').click();
  assert.equal(await cameraCalls(studio), 0);
  await accountError(studio).waitFor();
  await studio.reload({ waitUntil: 'domcontentloaded' });
  await button(studio, 'Preview camera').click();
  await accountError(studio).waitFor();
  assert.equal(await cameraCalls(studio), 0);
});

test('the first preview waits for an account choice and saves an explicit denial', async t => {
  const { open } = await setup(t);
  const studio = await open(live);
  await button(studio, 'Preview camera').click();
  await consent(studio).getByText('Preview your camera and microphone', { exact: false }).waitFor();
  assert.equal(await cameraCalls(studio), 0);
  await consent(studio).getByRole('button', { name: 'Don’t allow', exact: true }).click();
  await consent(studio).waitFor({ state: 'hidden' });
  await accountError(studio).waitFor();
  assert.equal(await cameraCalls(studio), 0);
  const settings = await open('/settings?tab=privacy');
  assert.equal(await cameraChoice(settings).inputValue(), 'block');
});

test('cancelling the account prompt allows a fresh request without starting capture', async t => {
  const { open } = await setup(t);
  const studio = await open(live);
  await button(studio, 'Preview camera').click();
  await consent(studio).waitFor();
  await studio.keyboard.press('Escape');
  await consent(studio).waitFor({ state: 'hidden' });
  assert.equal(await cameraCalls(studio), 0);
  await button(studio, 'Preview camera').click();
  await button(studio, 'Allow camera').click();
  await studio.getByLabel('Your camera preview', { exact: true }).waitFor();
  assert.equal(await cameraCalls(studio), 1);
});

test('a cross-tab denial ends a broadcast and closes its peer immediately', async t => {
  const { open, session } = await setup(t);
  const settings = await open('/settings?tab=privacy');
  await cameraChoice(settings).selectOption('allow');
  const studio = await open(live);
  await preview(studio);
  await button(studio, 'Mute mic').click();
  assert.equal(await studio.evaluate(() => window.cameraRequests[0].stream.getAudioTracks()[0].enabled), false);
  await button(studio, 'Unmute mic').click();
  assert.equal(await studio.evaluate(() => window.cameraRequests[0].stream.getAudioTracks()[0].enabled), true);
  await button(studio, 'Turn camera off').click();
  assert.equal(await studio.evaluate(() => window.cameraRequests[0].stream.getVideoTracks()[0].enabled), false);
  await button(studio, 'Turn camera on').click();
  assert.equal(await studio.evaluate(() => window.cameraRequests[0].stream.getVideoTracks()[0].enabled), true);
  session.offer = await studio.evaluate(async () => {
    const guest = new RTCPeerConnection({ iceServers: [] });
    try {
      guest.addTransceiver('video', { direction: 'recvonly' });
      guest.addTransceiver('audio', { direction: 'recvonly' });
      return (await guest.createOffer()).sdp;
    } finally { guest.close(); }
  });
  await button(studio, 'Go live').click();
  await button(studio, 'Invite people').click();
  assert.equal(new URL(await studio.getByRole('textbox', { name: 'Invite link' }).inputValue()).hash, `#join=${inviteToken}`);
  await button(studio, 'Admit Guest').click();
  await button(studio, 'Remove Guest').waitFor();
  assert.equal(session.admitted, true);
  await studio.waitForFunction(() => window.hostPeers[0]?.getSenders().length === 2);

  await studio.evaluate(key => {
    window.addEventListener('storage', event => {
      if (event.key === key && JSON.parse(event.newValue)?.camera === 'block') {
        window.revoked = {
          tracks: window.cameraRequests[0].stream.getTracks().map(track => track.readyState),
          peer: window.hostPeers[0].signalingState,
        };
      }
    });
  }, privacyKey);
  const closed = studio.waitForRequest(request => request.method() === 'DELETE' && new URL(request.url()).pathname === `/api${live}/sessions/${session.id}`);
  await cameraChoice(settings).selectOption('block');
  await closed;
  await accountError(studio).waitFor();
  await studio.getByLabel('Your camera preview', { exact: true }).waitFor({ state: 'detached' });
  assert.deepEqual(await studio.evaluate(() => window.revoked), { tracks: ['ended', 'ended'], peer: 'closed' });
  assert.equal(await button(studio, 'End live session').count(), 0);
});

test('a same-tab reset to Ask next time stops an open preview and asks again', async t => {
  const { open } = await setup(t);
  const settings = await open('/settings?tab=privacy');
  await cameraChoice(settings).selectOption('allow');
  const studio = await open(live);
  await preview(studio);
  await studio.evaluate(({ id, key }) => {
    localStorage.setItem(key, JSON.stringify({ camera: 'ask' }));
    dispatchEvent(new CustomEvent('ufi-media-permission-changed', { detail: { accountId: id } }));
  }, { id: member.id, key: privacyKey });
  await accountError(studio).waitFor();
  assert.equal(await studio.evaluate(() => window.cameraRequests[0].stream.getTracks().every(track => track.readyState === 'ended')), true);
  await button(studio, 'Preview camera').click();
  await consent(studio).waitFor();
  assert.equal(await cameraCalls(studio), 1);
});

test('revocation still stops capture when another tab immediately allows access again', async t => {
  const { open } = await setup(t);
  const settings = await open('/settings?tab=privacy');
  await cameraChoice(settings).selectOption('allow');
  const studio = await open(live);
  await preview(studio);
  await settings.evaluate(key => {
    localStorage.setItem(key, JSON.stringify({ camera: 'block' }));
    localStorage.setItem(key, JSON.stringify({ camera: 'allow' }));
  }, privacyKey);
  await accountError(studio).waitFor();
  assert.equal(await studio.evaluate(() => window.cameraRequests[0].stream.active), false);
  assert.equal(await cameraCalls(studio), 1);
  await preview(studio);
  assert.equal(await cameraCalls(studio), 2);
});

test('a saved denial supersedes a camera grant remembered only in the studio tab', async t => {
  const { open } = await setup(t);
  const studio = await open(live);
  await studio.evaluate(key => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      return setItem.call(this, name, value);
    };
  }, privacyKey);
  await button(studio, 'Preview camera').click();
  await button(studio, 'Allow camera').click();
  await studio.getByLabel('Your camera preview', { exact: true }).waitFor();

  const settings = await open('/settings?tab=privacy');
  await cameraChoice(settings).selectOption('block');
  await accountError(studio).waitFor();
  assert.equal(await studio.evaluate(() => window.cameraRequests[0].stream.active), false);
  await button(studio, 'Preview camera').click();
  await accountError(studio).waitFor();
  assert.equal(await cameraCalls(studio), 1);
});

test('a delayed browser request stops its tracks if another tab revokes permission', async t => {
  const { open, session } = await setup(t);
  const settings = await open('/settings?tab=privacy');
  await cameraChoice(settings).selectOption('allow');
  const studio = await open(live);
  await holdBrowserRequest(studio);
  await cameraChoice(settings).selectOption('block');
  await accountError(studio).waitFor();
  await resolveAndCheckStopped(studio);
  assert.equal(await studio.getByLabel('Your camera preview', { exact: true }).count(), 0);
  assert.deepEqual(session.requests, []);
});

test('cancelling browser permission keeps a late stream out of a new preview', async t => {
  const { open } = await setup(t);
  const settings = await open('/settings?tab=privacy');
  await cameraChoice(settings).selectOption('allow');
  const studio = await open(live);
  await holdBrowserRequest(studio);
  await button(studio, 'Cancel preview').click();
  await preview(studio);
  await resolveAndCheckStopped(studio);
  assert.equal(await studio.evaluate(() => document.querySelector('video[aria-label="Your camera preview"]').srcObject === window.cameraRequests[1].stream), true);
});

test('browser denial still blocks a camera the account has allowed', async t => {
  const { open } = await setup(t, { browserCamera: false });
  const settings = await open('/settings?tab=privacy');
  await cameraChoice(settings).selectOption('allow');
  const studio = await open(live);
  await button(studio, 'Preview camera').click();
  await studio.getByRole('alert').filter({ hasText: 'Allow camera and microphone access in your browser' }).waitFor();
  assert.equal(await cameraCalls(studio), 1);
  assert.equal(await studio.getByLabel('Your camera preview', { exact: true }).count(), 0);
});
