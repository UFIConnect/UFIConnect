import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs/promises';
import { canonicalPage, createAnalyticsController, PAGE_CATEGORIES, ANALYTICS_CONSENT_KEY,
  ANALYTICS_CLIENT_KEY, ANALYTICS_CLIENT_LIFETIME_MS } from '../web/src/analytics/googleAnalytics.mjs';
import { analyticsBridgeHtml } from '../web/analyticsBridge.mjs';

function fixture(entries = []) {
  const storage = new Map(entries);
  const events = new Map();
  const frames = [];
  const window = {
    crypto: webcrypto, location: { origin: 'https://uficonnect.org' },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    addEventListener: (key, handler) => events.set(key, handler), removeEventListener: key => events.delete(key),
    setTimeout() {},
  };
  const document = {
    createElement(tag) {
      assert.equal(tag, 'iframe');
      const frame = { attributes: {}, messages: [], contentWindow: { postMessage(message) { frame.messages.push(message); } },
        setAttribute(key, value) { this.attributes[key] = value; }, remove() { this.removed = true; } };
      return frame;
    },
    body: { appendChild: frame => frames.push(frame) },
  };
  const controller = createAnalyticsController({ window, document, bridgeUrl: 'https://api.uficonnect.org/analytics-bridge.html' });
  function ready(frame = frames.at(-1), options = {}) {
    events.get('message')({ source: frame?.contentWindow, origin: 'https://api.uficonnect.org', data: { type: 'ufi-analytics-ready', version: 1 }, ...options });
  }
  return { controller, frames, storage, window, document, events, ready };
}

test('all page categories are constants; secret dynamic route values, queries and fragments never become metadata', () => {
  for (const page of Object.values(PAGE_CATEGORIES)) assert.equal(canonicalPage(page.path), page);
  for (const [path, category] of [
    ['/messages/private-email@example.invalid?token=secret#passphrase', 'conversation'],
    ['/groups/private-membership', 'group'], ['/opportunities/private-id', 'opportunity'],
    ['/p/private-post', 'post'], ['/u/private-member', 'member'],
    ['/reset-password?token=reset-secret#secret', 'reset_password'],
    ['/search?q=private-search', 'search'], ['/unknown/private', 'other'],
    ['https://example.org/private', 'other'], ['//evil.example/private', 'other'],
  ]) {
    const page = canonicalPage(path);
    assert.equal(page.category, category);
    assert.ok(!JSON.stringify(page).includes('private'));
    assert.ok(!JSON.stringify(page).includes('secret'));
  }
});

test('unknown and declined consent create neither a bridge nor analytics identifiers', () => {
  const { controller, frames, storage } = fixture();
  controller.trackPage('/login');
  assert.equal(controller.getConsent(), null);
  assert.equal(frames.length, 0);
  assert.equal(storage.size, 0);
  controller.setConsent('denied');
  controller.trackPage('/settings');
  assert.equal(frames.length, 0);
  assert.equal(storage.get(ANALYTICS_CLIENT_KEY), undefined);
  assert.equal(storage.get(ANALYTICS_CONSENT_KEY), 'denied');
});

test('opt-in sends only the latest page once, through a separate-origin frame and a fixed payload', () => {
  const { controller, frames, ready, storage } = fixture();
  controller.trackPage('/login?password=synthetic-secret', 'first');
  controller.trackPage('/messages/private-member', 'second');
  controller.setConsent('granted');
  const frame = frames[0];
  assert.equal(frame.attributes.sandbox, 'allow-scripts allow-same-origin');
  assert.equal(frame.attributes.referrerpolicy, 'no-referrer');
  assert.equal(frame.src, 'https://api.uficonnect.org/analytics-bridge.html');
  assert.equal(frame.messages.length, 0);
  ready(frame, { source: {} });
  ready(frame, { origin: 'https://uficonnect.org' });
  assert.equal(frame.messages.length, 0);
  ready(); ready();
  assert.equal(frame.messages.length, 1);
  const message = frame.messages[0];
  assert.deepEqual(Object.keys(message).sort(), ['category', 'clientId', 'type', 'version', 'visit']);
  assert.equal(message.category, 'conversation');
  assert.match(message.clientId, /^[0-9a-f]{32}$/);
  assert.ok(!JSON.stringify(message).includes('private-member'));
  assert.ok(!JSON.stringify(message).includes('synthetic-secret'));
  assert.equal(JSON.parse(storage.get(ANALYTICS_CLIENT_KEY)).id, message.clientId);
});

test('StrictMode duplicates deduplicate while separate member pages and return visits count separately', () => {
  const { controller, frames, ready } = fixture([[ANALYTICS_CONSENT_KEY, 'granted']]);
  controller.trackPage('/u/person-one', 'first');
  controller.trackPage('/u/person-one', 'first');
  ready();
  controller.trackPage('/u/person-two', 'second');
  controller.trackPage('/u/person-one', 'third');
  assert.deepEqual(frames[0].messages.map(message => message.category), ['member', 'member', 'member']);
  assert.deepEqual(frames[0].messages.map(message => message.visit), [1, 2, 3]);
});

test('consented navigation queues safely while the bridge loads without retaining preconsent history', () => {
  const { controller, frames, ready } = fixture();
  controller.trackPage('/login', 'before');
  controller.trackPage('/register', 'current');
  controller.setConsent('granted');
  controller.trackPage('/settings', 'one');
  controller.trackPage('/messages/private-member', 'two');
  assert.equal(frames[0].messages.length, 0);
  ready();
  assert.deepEqual(frames[0].messages.map(message => message.category), ['register', 'settings', 'conversation']);
  assert.ok(!JSON.stringify(frames[0].messages).includes('private-member'));
});

test('revocation stops the frame and removes the client identifier, including other-tab changes', () => {
  const { controller, frames, ready, storage, events } = fixture([[ANALYTICS_CONSENT_KEY, 'granted']]);
  controller.trackPage('/settings'); ready();
  const originalId = frames[0].messages[0].clientId;
  controller.setConsent('denied');
  events.get('message')({ source: frames[0].contentWindow, origin: 'https://api.uficonnect.org', data: { type: 'ufi-analytics-stopped', version: 1 } });
  assert.equal(frames[0].removed, true);
  assert.equal(storage.has(ANALYTICS_CLIENT_KEY), false);
  controller.trackPage('/messages/private');
  assert.equal(frames.length, 1);
  controller.setConsent('granted'); ready();
  assert.notEqual(frames[1].messages[0].clientId, originalId);
  events.get('storage')({ key: ANALYTICS_CONSENT_KEY, newValue: 'denied' });
  events.get('message')({ source: frames[1].contentWindow, origin: 'https://api.uficonnect.org', data: { type: 'ufi-analytics-stopped', version: 1 } });
  assert.equal(controller.getConsent(), 'denied');
  assert.equal(frames[1].removed, true);
  assert.equal(storage.has(ANALYTICS_CLIENT_KEY), false);
});

test('a consented random identifier is reused for at most 30 days and rejects attacker-provided strings', () => {
  const id = '1234567890abcdef1234567890abcdef';
  for (const [stored, expected] of [
    [{ id, expiresAt: Date.now() + 60_000 }, id],
    [{ id, expiresAt: Date.now() - 1 }, null],
    [{ id, expiresAt: Date.now() + ANALYTICS_CLIENT_LIFETIME_MS * 2 }, null],
    [{ id: 'person@example.invalid', expiresAt: Date.now() + 60_000 }, null],
  ]) {
    const { controller, frames, ready } = fixture([[ANALYTICS_CONSENT_KEY, 'granted'], [ANALYTICS_CLIENT_KEY, JSON.stringify(stored)]]);
    controller.trackPage('/'); ready();
    if (expected) assert.equal(frames[0].messages[0].clientId, expected);
    else assert.notEqual(frames[0].messages[0].clientId, stored.id);
  }
});

test('storage and randomness failure fail safely without reading authentication state', () => {
  const { window, document, frames } = fixture();
  window.localStorage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  window.crypto = null;
  const controller = createAnalyticsController({ window, document, bridgeUrl: 'https://api.uficonnect.org/analytics-bridge.html' });
  controller.trackPage('/'); controller.setConsent('granted');
  assert.equal(frames.length, 0);
  controller.dispose();
});

test('the bridge must remain a static, separate-origin URL and its generated allowlist/CSP stay synchronized', async () => {
  const { window, document } = fixture();
  for (const bridgeUrl of ['https://uficonnect.org/analytics-bridge.html', '/analytics-bridge.html?token=secret', '/analytics-bridge.html#secret', '/profile']) {
    assert.throws(() => createAnalyticsController({ window, document, bridgeUrl }));
  }
  const bridge = await fs.readFile(new URL('../backend/public/analytics-bridge.html', import.meta.url), 'utf8');
  assert.equal(bridge.replace(/\r\n/g, '\n'), analyticsBridgeHtml());
  assert.match(bridge, /name="referrer" content="no-referrer"/);
  assert.match(bridge, /default-src 'none'/);
  assert.doesNotMatch(bridge, /unsafe-inline|unsafe-eval/);
});
