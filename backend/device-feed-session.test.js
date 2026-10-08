'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

async function fixture(t, state = 'granted') {
  const module = await import('../web/src/utils/deviceFeedLocation.mjs');
  module.clearDeviceFeedLocation(); t.after(() => module.clearDeviceFeedLocation());
  let time = Date.now(), callback, failure, options, change, tick, visibility, requests = 0;
  const permission = { state, addEventListener(type, fn) { change = fn; }, removeEventListener() { change = null; } };
  const page = { hidden: false, addEventListener(type, fn) { visibility = fn; }, removeEventListener() { visibility = null; } };
  const browser = { permissions: { query: async () => permission }, geolocation: { getCurrentPosition(success, error, config) {
    requests++; callback = success; failure = error; options = config;
  } } };
  const events = [];
  const start = token => module.startDeviceFeedLocation({ token, onChange: () => events.push(module.deviceFeedLocationHeader(token, time)),
    navigator: browser, document: page, now: () => time, schedule: fn => { tick = fn; return 1; }, unschedule() { tick = null; } });
  const position = () => ({ coords: { latitude: 34.052235, longitude: -118.243683, accuracy: 15 }, timestamp: time });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return { module, permission, page, start, position, settle, events, get options() { return options; }, get requests() { return requests; },
    success(value = position()) { callback(value); }, fail() { failure(new Error('Denied or unavailable')); },
    moveTime(ms) { time += ms; }, change() { change?.(); }, tick() { return tick?.(); }, visible() { visibility?.(); }, get callback() { return callback; } };
}

test('browser asks for high accuracy, rounds coordinates, and sends them only to the current member feed GET', async t => {
  const f = await fixture(t); const stop = f.start('alice-token'); t.after(stop); await f.settle();
  assert.deepEqual(f.options, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  f.success();
  assert.deepEqual(JSON.parse(f.module.deviceFeedLocationHeader('alice-token')).slice(0, 3), [34.052, -118.244, 95]);
  assert.equal(f.module.deviceFeedLocationHeader('bob-token'), null);
  const config = url => ({ url, headers: { Authorization: 'Bearer alice-token' } });
  for (const url of ['/feed/location', '/office/feed?source=youtube', '/office/feed/videos', '/office/feed/music']) {
    assert.ok(f.module.deviceFeedRequestHeader(config(url), 'alice-token'), url);
  }
  for (const url of ['/feed/guest', '/feed/guest?limit=10', '/profile', '/billing/status', '/auth/login',
    'https://example.com/office/feed', '//example.com/feed', '/source/youtube', '/feed/post-id/likes', '/feed/stats', '/feed/sources', '/feed/stream']) {
    assert.equal(f.module.deviceFeedRequestHeader(config(url), 'alice-token'), null, url);
  }
  assert.equal(f.module.deviceFeedRequestHeader({ ...config('/office/feed'), method: 'post' }, 'alice-token'), null);
  assert.equal(f.module.deviceFeedRequestHeader(config('/office/feed'), 'bob-token'), null);
  f.moveTime(16 * 60000);
  assert.equal(f.module.deviceFeedLocationHeader('alice-token', Date.now() + 16 * 60000), null);
});

test('permission denial, revocation during acquisition and location failure all fall back without stale coordinates', async t => {
  const f = await fixture(t, 'denied'); const stop = f.start('alice-token'); t.after(stop); await f.settle();
  assert.equal(f.requests, 0);
  f.permission.state = 'granted'; f.change(); await f.settle(); assert.equal(f.requests, 1);
  f.permission.state = 'denied'; f.change(); f.success();
  assert.equal(f.module.deviceFeedLocationHeader('alice-token'), null, 'late success cannot undo a permission revocation');
  f.permission.state = 'granted'; f.change(); await f.settle(); f.success();
  assert.ok(f.module.deviceFeedLocationHeader('alice-token'));
  f.tick(); await f.settle(); f.fail();
  assert.equal(f.module.deviceFeedLocationHeader('alice-token'), null);
});

test('logout and account changes invalidate late callbacks; hidden pages do not acquire location', async t => {
  const f = await fixture(t); const stop = f.start('alice-token'); await f.settle();
  const lateAlice = f.callback; stop(); const stopBob = f.start('bob-token'); t.after(stopBob); await f.settle();
  lateAlice(f.position());
  assert.equal(f.module.deviceFeedLocationHeader('alice-token'), null);
  assert.equal(f.module.deviceFeedLocationHeader('bob-token'), null);
  f.success(); assert.ok(f.module.deviceFeedLocationHeader('bob-token'));
  const count = f.requests; f.page.hidden = true; f.tick(); await f.settle(); assert.equal(f.requests, count);
  f.page.hidden = false; f.visible(); await f.settle(); assert.equal(f.requests, count + 1);
  const lateBob = f.callback; f.module.clearDeviceFeedLocation(); lateBob(f.position());
  assert.equal(f.module.deviceFeedLocationHeader('bob-token'), null);
});
