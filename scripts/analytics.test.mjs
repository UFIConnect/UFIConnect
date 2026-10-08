import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { canonicalPage, createAnalyticsController, PAGE_CATEGORIES, ANALYTICS_CONSENT_KEY,
  ANALYTICS_CLIENT_KEY, ANALYTICS_CLIENT_LIFETIME_MS } from '../web/src/analytics/googleAnalytics.mjs';
import { analyticsBridgeHtml } from '../web/analyticsBridge.mjs';
import { isPrivateTelemetryPath, setTelemetryRoute, subscribeTelemetryPrivacy, telemetrySuppressed } from '../web/src/analytics/telemetryPrivacy.mjs';
import { HOME_FEED_SOURCE_IDS, FOLLOWING_FEED_SOURCE_IDS, CONNECTED_SOCIAL_PLATFORMS } from '../web/src/components/sourceMeta.js';

const require = createRequire(import.meta.url);
const { PAGE_CATEGORIES: BACKEND_CATEGORIES, createAggregateAnalytics } = require('../backend/aggregate-analytics');
const { SCREEN_PATHS } = require('../mobile/analytics/screenPolicy');
const { createServiceMetrics } = require('../mobile/analytics/serviceMetrics');

test('every source selector uses registered fixed categories and private data cannot become a category', () => {
  for (const value of ['github', 'gitlab', 'youtube', 'reddit', 'twitch', 'instagram', 'tiktok', 'threads', 'bluesky', 'mastodon']) {
    assert.equal(PAGE_CATEGORIES[`command_center_yourfeed_source_${value}`]?.viewType, 'tab');
  }
  const selections = { home_source: HOME_FEED_SOURCE_IDS, following_source: FOLLOWING_FEED_SOURCE_IDS,
    video_source: [...HOME_FEED_SOURCE_IDS, 'uficonnect', ...CONNECTED_SOCIAL_PLATFORMS],
    music_source: [...HOME_FEED_SOURCE_IDS, 'uficonnect', ...CONNECTED_SOCIAL_PLATFORMS],
    notification_source: ['ufi', ...CONNECTED_SOCIAL_PLATFORMS], message_source: ['ufi', ...CONNECTED_SOCIAL_PLATFORMS] };
  for (const [group, values] of Object.entries(selections)) {
    for (const value of ['all', ...values]) assert.equal(PAGE_CATEGORIES[`${group}_${value}`]?.viewType, 'tab', `${group}_${value}`);
    for (const value of ['private@example.invalid', 'https://private.mastodon.invalid', 'private-account-id']) assert.equal(PAGE_CATEGORIES[`${group}_${value}`], undefined);
  }
  for (const category of ['video_mode_following', 'music_mode_feed', 'notification_filter_unread', 'notification_filter_requests', 'connected_accounts_category_social', 'home_panel_accounts', 'workspace_writing']) assert.ok(PAGE_CATEGORIES[category], category);
});

test('all rendered web routes resolve to a fixed category or an explicit private exclusion', async () => {
  const app = await fs.readFile(new URL('../web/src/App.jsx', import.meta.url), 'utf8');
  for (const [, route] of app.matchAll(/<Route\s+path="([^"]+)"/g)) {
    if (route === '*') continue;
    const example = route.replace(':kind', route.startsWith('/saved/') ? 'posts' : 'writing').replace(/:\w+/g, 'SYNTHETIC_PRIVATE_ID');
    if (isPrivateTelemetryPath(example)) continue;
    const result = canonicalPage(`${example}?secret=SYNTHETIC_PRIVATE_VALUE#SYNTHETIC_PRIVATE_HASH`);
    assert.notEqual(result.category, 'other', route);
    assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE'));
    assert.equal(canonicalPage(example.endsWith('/') ? example : `${example}/`).category, result.category);
  }
  for (const path of ['/auth/social/mastodon/callback?code=private', '/oauth/callback', '/vault/device']) assert.equal(isPrivateTelemetryPath(path), true);
});

test('every web and native screen category is accepted by the required aggregate endpoint contract', async () => {
  assert.deepEqual([...BACKEND_CATEGORIES].sort(), Object.keys(PAGE_CATEGORIES).sort());
  const backend = createAggregateAnalytics({ db: { isConnected: () => true, query: async () => ({ rows: [] }) }, schedule() {} });
  const categories = [];
  for (const category of Object.keys(PAGE_CATEGORIES)) {
    const response = { statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; },
      json() { return this; }, end() { return this; } };
    await backend.pageview({ body: { category }, originalUrl: '/analytics/pageview' }, response);
    assert.equal(response.statusCode, 204, `Backend must accept the fixed category ${category}`);
  }
  const mobile = createServiceMetrics({ apiBase: 'https://api.example.invalid', fetcher(url, options) {
    assert.equal(url, 'https://api.example.invalid/analytics/pageview');
    const payload = JSON.parse(options.body);
    assert.deepEqual(Object.keys(payload), ['category']);
    categories.push(payload.category);
  } });
  try {
    for (const name of Object.keys(SCREEN_PATHS)) mobile.trackScreen(name, `private-navigation-key-${name}`);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(categories, Object.values(SCREEN_PATHS).map(path => canonicalPage(path).category));
    assert.equal(categories.length, Object.keys(SCREEN_PATHS).length);
    assert.ok(categories.includes('app_privacy'));
    assert.ok(categories.every(category => BACKEND_CATEGORIES.includes(category)));
  } finally { mobile.dispose(); }
});

function fixture(entries = [], navigator = {}) {
  const storage = new Map(entries);
  const events = new Map();
  const frames = [];
  const window = {
    navigator,
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

test('Vault privacy policy covers route variants and notifies pending metrics only at route boundaries', () => {
  for (const path of ['/vault', '/vault/', '/VAULT', '/vault?secret=private#value', '/%76ault', '/UFIConnect/vault']) {
    assert.equal(isPrivateTelemetryPath(path), true, path);
  }
  for (const path of ['/', '/vaulting', '/music', undefined]) assert.equal(isPrivateTelemetryPath(path), false);
  const changes = [];
  setTelemetryRoute('/');
  const unsubscribe = subscribeTelemetryPrivacy(value => changes.push(value));
  try {
    setTelemetryRoute('/vault'); setTelemetryRoute('/vault/');
    assert.equal(telemetrySuppressed('/music'), true, 'Background errors remain suppressed while Vault is active');
    setTelemetryRoute('/music');
    assert.equal(telemetrySuppressed('/music'), false);
    assert.equal(telemetrySuppressed('/vault'), true);
    assert.deepEqual(changes, [true, false]);
  } finally { unsubscribe(); setTelemetryRoute('/'); }
});

test('opening Vault with granted consent creates no bridge or identifier and resumes normally after leaving', () => {
  const { controller, frames, storage, ready } = fixture([[ANALYTICS_CONSENT_KEY, 'granted']]);
  controller.trackPage('/vault');
  controller.setConsent('granted');
  assert.equal(frames.length, 0);
  assert.equal(storage.has(ANALYTICS_CLIENT_KEY), false);
  assert.equal(controller.getConsent(), 'granted');
  controller.trackPage('/music'); ready();
  assert.deepEqual(frames[0].messages.map(message => message.category), ['music']);
  controller.dispose();
});

test('entering Vault removes a live bridge without changing consent and drops pending pageviews', () => {
  const { controller, frames, storage, ready, events } = fixture([[ANALYTICS_CONSENT_KEY, 'granted']]);
  controller.trackPage('/settings'); ready();
  const original = frames[0];
  const identifier = storage.get(ANALYTICS_CLIENT_KEY);
  controller.trackPage('/vault');
  assert.equal(original.removed, true);
  assert.equal(original.messages.length, 1);
  assert.equal(storage.get(ANALYTICS_CONSENT_KEY), 'granted');
  assert.equal(storage.get(ANALYTICS_CLIENT_KEY), identifier);
  events.get('storage')({ key: ANALYTICS_CONSENT_KEY, newValue: 'granted' });
  ready(original);
  assert.equal(frames.length, 1, 'Late bridge readiness and consent events cannot resume tracking in Vault');
  controller.trackPage('/music');
  controller.trackPage('/groups');
  const pending = frames[1];
  controller.trackPage('/vault?private=value');
  assert.equal(pending.removed, true);
  ready(pending);
  assert.equal(pending.messages.length, 0);
  controller.trackPage('/videos'); ready();
  assert.deepEqual(frames[2].messages.map(message => message.category), ['videos']);
  controller.dispose();
});

test('the browser URL blocks delayed bridge events even before the route effect runs', () => {
  const { controller, frames, ready, window } = fixture([[ANALYTICS_CONSENT_KEY, 'granted']]);
  controller.trackPage('/settings');
  window.location.pathname = '/vault';
  ready();
  assert.equal(frames[0].removed, true);
  assert.equal(frames[0].messages.length, 0);
  window.location.pathname = '/music';
  controller.trackPage('/music'); ready();
  assert.deepEqual(frames[1].messages.map(message => message.category), ['music']);
  controller.dispose();
});

test('entering Vault also removes retiring analytics frames waiting for an opt-out acknowledgement', () => {
  const { controller, frames, ready } = fixture([[ANALYTICS_CONSENT_KEY, 'granted']]);
  controller.trackPage('/settings'); ready();
  controller.setConsent('denied');
  assert.notEqual(frames[0].removed, true);
  controller.trackPage('/vault');
  assert.equal(frames[0].removed, true);
  assert.equal(controller.getConsent(), 'denied');
  controller.trackPage('/music');
  assert.equal(frames.length, 1);
  controller.dispose();
});

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

test('Global Privacy Control overrides an earlier opt-in and prevents new collection', () => {
  const { controller, frames, storage, events, window } = fixture([
    [ANALYTICS_CONSENT_KEY, 'granted'], [ANALYTICS_CLIENT_KEY, 'old-identifier'],
  ], { globalPrivacyControl: true });
  controller.trackPage('/settings');
  controller.setConsent('granted');
  events.get('storage')({ key: ANALYTICS_CONSENT_KEY, newValue: 'granted' });
  assert.equal(controller.getPrivacySignal(), true);
  assert.equal(controller.getConsent(), 'denied');
  assert.equal(frames.length, 0);
  assert.equal(storage.has(ANALYTICS_CLIENT_KEY), false);
  window.navigator.globalPrivacyControl = false;
  events.get('focus')();
  assert.equal(controller.getConsent(), 'denied', 'disabling GPC must not restore an old grant');
  controller.setConsent('granted');
  assert.equal(frames.length, 1, 'a fresh opt-in is required after disabling the signal');
});

test('enabling Global Privacy Control stops an already active analytics bridge', () => {
  const { controller, frames, ready, storage, events, window } = fixture([[ANALYTICS_CONSENT_KEY, 'granted']]);
  controller.trackPage('/settings');
  ready();
  const messages = frames[0].messages.length;
  window.navigator.globalPrivacyControl = true;
  events.get('focus')();
  controller.trackPage('/privacy');
  assert.equal(controller.getConsent(), 'denied');
  assert.equal(storage.has(ANALYTICS_CLIENT_KEY), false);
  assert.equal(frames[0].messages.length, messages + 1);
  assert.equal(frames[0].messages.at(-1).type, 'ufi-analytics-stop');
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

test('withdrawal stops collection immediately even when a saved grant cannot be overwritten or removed', () => {
  const { controller, window, document, frames, ready, storage } = fixture([[ANALYTICS_CONSENT_KEY, 'granted']]);
  controller.trackPage('/messages/private-one'); ready();
  const frame = frames[0];
  const originalStorage = window.localStorage;
  window.localStorage = {
    getItem: originalStorage.getItem,
    setItem() { throw Error('writes blocked'); },
    removeItem() { throw Error('removal blocked'); },
  };
  controller.setConsent('denied');
  assert.equal(controller.getConsent(), 'denied');
  assert.ok(controller.getPersistenceError());
  assert.equal(frame.messages.at(-1).type, 'ufi-analytics-stop');
  controller.trackPage('/settings');
  assert.equal(frame.messages.filter(message => message.type === 'ufi-analytics-page').length, 1);
  assert.equal(storage.get(ANALYTICS_CONSENT_KEY), 'granted', 'The failure fixture retains the stale old grant');
  controller.dispose();
  const reloaded = createAnalyticsController({ window, document, bridgeUrl: 'https://api.uficonnect.org/analytics-bridge.html' });
  reloaded.trackPage('/profile');
  assert.equal(reloaded.getConsent(), 'denied');
  assert.ok(reloaded.getPersistenceError());
  assert.equal(frames.length, 1, 'Reload must not create another Google frame from the stale grant');
  reloaded.dispose();
});

test('failed consent writes remove an old grant when possible and never enable Google in unwritable storage', () => {
  const { controller, window, document, storage, frames } = fixture([[ANALYTICS_CONSENT_KEY, 'granted']]);
  window.localStorage.setItem = () => { throw Error('quota exceeded'); };
  controller.setConsent('denied');
  assert.equal(storage.has(ANALYTICS_CONSENT_KEY), false);
  assert.ok(controller.getPersistenceError());
  controller.dispose();
  const reloaded = createAnalyticsController({ window, document, bridgeUrl: 'https://api.uficonnect.org/analytics-bridge.html' });
  reloaded.trackPage('/'); reloaded.setConsent('granted');
  assert.equal(reloaded.getConsent(), 'denied');
  assert.equal(frames.length, 0);
  assert.ok(reloaded.getPersistenceError());
  reloaded.dispose();
});

test('silently ignored storage writes cannot validate a saved or new Google grant', () => {
  const { controller, window, document, frames, storage } = fixture(); controller.dispose();
  storage.set(ANALYTICS_CONSENT_KEY, 'granted');
  window.localStorage.setItem = () => {};
  window.localStorage.removeItem = () => {};
  const reloaded = createAnalyticsController({ window, document, bridgeUrl: 'https://api.uficonnect.org/analytics-bridge.html' });
  reloaded.trackPage('/'); reloaded.setConsent('granted');
  assert.equal(reloaded.getConsent(), 'denied');
  assert.equal(frames.length, 0);
  assert.ok(reloaded.getPersistenceError());
  reloaded.dispose();
});

test('the bridge must remain a static, separate-origin URL and its generated allowlist/CSP stay synchronized', async () => {
  const { window, document } = fixture();
  for (const bridgeUrl of ['https://uficonnect.org/analytics-bridge.html', '/analytics-bridge.html?token=secret', '/analytics-bridge.html#secret', '/profile']) {
    assert.throws(() => createAnalyticsController({ window, document, bridgeUrl }));
  }
  const bridge = await fs.readFile(new URL('../backend/public/analytics-bridge.html', import.meta.url), 'utf8');
  assert.equal(bridge.replace(/\r\n/g, '\n'), analyticsBridgeHtml().replace(/\r\n/g, '\n'));
  assert.match(bridge, /name="referrer" content="no-referrer"/);
  assert.match(bridge, /default-src 'none'/);
  assert.doesNotMatch(bridge, /unsafe-inline|unsafe-eval/);
});
