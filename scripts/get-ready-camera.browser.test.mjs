import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, devices } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';

const member = { id: 'camera-audit-member', name: 'Camera Audit', onboardingComplete: true, preferences: {} };
const privacyKey = `ufi:media-permissions:v1:${member.id}`;
const live = '/get-ready-with-us';
const inviteToken = `v2.${'A'.repeat(43)}`;
let server;

before(async () => {
  server = await startBuiltServer({ root: process.env.GET_READY_WEB_DIST });
});

after(async () => {
  await server?.close();
});

async function setup(t, { browserCamera = true, device = {} } = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  t.after(() => browser.close());
  const context = await browser.newContext({ ...device, serviceWorkers: 'block' });
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
        canvas.width = 160;
        canvas.height = 90;
        const frame = canvas.getContext('2d');
        const [track] = canvas.captureStream(15).getVideoTracks();
        // Repaint an asymmetric frame so a live viewer's orientation can be checked.
        const paint = setInterval(() => {
          if (track.readyState === 'ended') { clearInterval(paint); return; }
          frame.fillStyle = 'red';
          frame.fillRect(0, 0, 80, 90);
          frame.fillStyle = 'blue';
          frame.fillRect(80, 0, 80, 90);
        }, 67);
        tracks.push(track);
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

  const session = { requests: [], offer: '', answer: '', admitted: false };
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
      session.details = { id: sessionId, title: title || 'Test live session', viewerLimit: 6, requiresApproval: supportsApproval, hostName: member.name };
      return json({ session: session.details, inviteToken, iceServers: [] });
    }
    if (endpoint === `${live}/invite`) return json({ session: session.details });
    if (endpoint === `${live}/join`) {
      session.viewerId = request.postDataJSON().viewerId;
      return json({ admission: session.admitted ? 'approved' : 'pending', iceServers: [] });
    }
    if (endpoint.endsWith('/host')) {
      const guests = session.viewerId ? [{ id: session.viewerId, name: 'Guest', admission: session.admitted ? 'approved' : 'pending' }] : [];
      const viewers = session.admitted && session.offer ? [{ id: session.viewerId, offer: session.offer, answered: Boolean(session.answer) }] : [];
      return json({ guests, viewers });
    }
    if (method === 'PUT' && endpoint === `${live}/sessions/${session.details?.id}/viewers/${session.viewerId}`) {
      const { offer } = request.postDataJSON();
      if (offer) session.offer = offer;
      return json({ admission: session.admitted ? 'approved' : 'pending', answer: session.answer });
    }
    if (endpoint.endsWith('/admission')) session.admitted = request.postDataJSON().decision === 'approve';
    if (endpoint.endsWith('/answer')) session.answer = request.postDataJSON().answer;
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
const hostVideo = page => page.getByLabel('Your camera preview', { exact: true });
const mirrorButton = page => button(page, 'Mirror preview');

async function preview(page) {
  await button(page, 'Preview camera').click();
  await page.waitForFunction(() => document.querySelector('video[aria-label="Your camera preview"]')?.srcObject?.active);
}

async function assertPreviewMirroring(page, mirrored) {
  assert.equal(await mirrorButton(page).getAttribute('aria-pressed', { timeout: 3000 }), String(mirrored));
  assert.equal(await hostVideo(page).evaluate(video => getComputedStyle(video).transform), mirrored ? 'matrix(-1, 0, 0, 1, 0, 0)' : 'none');
}

async function assertViewerOrientation(video) {
  assert.equal(await video.evaluate(element => getComputedStyle(element).transform), 'none', 'The viewer element renders without a mirror');
  const correctFrame = await video.evaluate(element => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    context.drawImage(element, 0, 0, 4, 1);
    const [leftRed, , leftBlue] = context.getImageData(0, 0, 1, 1).data;
    const [rightRed, , rightBlue] = context.getImageData(3, 0, 1, 1).data;
    return leftRed > leftBlue && rightBlue > rightRed;
  });
  assert.equal(correctFrame, true, 'The viewer receives red on the left and blue on the right');
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

for (const [layout, device] of [
  ['desktop', { viewport: { width: 1440, height: 900 } }],
  ['mobile', { ...devices['iPhone SE'], viewport: { width: 320, height: 640 } }],
]) {
  test(`the ${layout} host preview mirrors by default and has an accessible toggle`, async t => {
    const { open } = await setup(t, { device });
    const settings = await open('/settings?tab=privacy');
    await cameraChoice(settings).selectOption('allow');
    const studio = await open(live);
    await button(studio, 'Preview camera').waitFor();
    const mirror = mirrorButton(studio);
    assert.equal(await mirror.count(), 0);
    await preview(studio);
    await assertPreviewMirroring(studio, true);

    const bounds = await mirror.evaluate(element => {
      const [card, panel] = element.closest('.get-ready-studio').children;
      const videoCard = card.getBoundingClientRect();
      const control = element.getBoundingClientRect();
      return {
        touchTarget: control.width >= 44 && control.height >= 44,
        fits: control.left >= videoCard.left && control.right <= videoCard.right && control.bottom <= videoCard.bottom
          && control.left >= 0 && control.right <= document.documentElement.clientWidth
          && document.documentElement.scrollWidth === document.documentElement.clientWidth,
        stacked: panel.getBoundingClientRect().top >= videoCard.bottom,
      };
    });
    assert.equal(bounds.fits, true, `${layout}: mirror control fits inside the camera card and viewport`);
    assert.equal(bounds.stacked, Boolean(device.hasTouch));
    if (device.hasTouch) {
      assert.equal(bounds.touchTarget, true);
      await mirror.tap();
    } else {
      await mirror.press('Space');
    }
    await assertPreviewMirroring(studio, false);
    await button(studio, 'Turn camera off').click();
    await button(studio, 'Turn camera on').click();
    await assertPreviewMirroring(studio, false);
    assert.equal(await cameraCalls(studio), 1);
  });
}

test('an invited viewer sees the original camera orientation while the host changes their live preview', async t => {
  const { open } = await setup(t);
  const settings = await open('/settings?tab=privacy');
  await cameraChoice(settings).selectOption('allow');
  const studio = await open(live);
  await preview(studio);
  await button(studio, 'Go live').click();
  await button(studio, 'Invite people').click();
  const inviteLink = new URL(await studio.getByRole('textbox', { name: 'Invite link' }).inputValue());
  const guest = await open(`${inviteLink.pathname}${inviteLink.hash}`);
  await button(guest, 'Request to join').click();
  await button(studio, 'Admit Guest').click();
  await guest.getByRole('status').filter({ hasText: 'Watching live' }).waitFor();
  await guest.waitForFunction(() => document.querySelector('video[aria-label="Live video"]')?.readyState >= 2);

  const guestVideo = guest.getByLabel('Live video', { exact: true });
  await assertViewerOrientation(guestVideo);
  assert.equal(await mirrorButton(guest).count(), 0);
  await assertPreviewMirroring(studio, true);

  await mirrorButton(studio).click();
  await assertPreviewMirroring(studio, false);
  await assertViewerOrientation(guestVideo);
  assert.equal(await studio.evaluate(() => {
    const [videoTrack] = window.cameraRequests[0].stream.getVideoTracks();
    return window.hostPeers[0].getSenders().some(sender => sender.track === videoTrack);
  }), true, 'WebRTC keeps sending the original camera track');
  assert.equal(await cameraCalls(studio), 1);
});

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
  session.viewerId = 'approved-guest';
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
  const closed = studio.waitForRequest(request => request.method() === 'DELETE' && new URL(request.url()).pathname === `/api${live}/sessions/${session.details.id}`);
  await cameraChoice(settings).selectOption('block');
  await closed;
  await accountError(studio).waitFor();
  await studio.getByLabel('Your camera preview', { exact: true }).waitFor({ state: 'detached' });
  assert.equal(await mirrorButton(studio).count(), 0);
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
