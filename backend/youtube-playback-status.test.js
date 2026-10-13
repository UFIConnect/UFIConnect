'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createYouTubePlaybackStatus, KNOWN_TTL_MS, UNKNOWN_TTL_MS, MAX_CACHE_ENTRIES, MAX_IN_FLIGHT, REQUEST_TIMEOUT_MS } = require('./youtube-playback-status');
const { createCreatorAnalytics, registerCreatorAnalyticsRoutes } = require('./creator-analytics');
const { createAppHarness, member } = require('./test-support/app-harness');
const ID = 'abcdefghijk', OTHER = '01234567890';
const NOW = Date.parse('2026-10-11T12:00:00Z');
const env = () => ({ YOUTUBE_API_KEY: 'synthetic-private-key' });
const reply = (id = ID, flag = false) => Response.json({ items: [{ id, status: { madeForKids: flag } }] });

test('audience lookup accepts only one exact ID and never accepts a URL, array, or query injection', async () => {
  let calls = 0;
  const lookup = createYouTubePlaybackStatus({ env: env(), fetchImpl: async () => { calls++; return reply(); } });
  for (const id of [undefined, null, {}, [ID], `${ID},${OTHER}`, ` ${ID}`, `${ID}&key=bad`, `https://youtu.be/${ID}`, 'short']) {
    await assert.rejects(lookup(id), error => error.status === 400 && !error.message.includes(String(id)));
  }
  assert.equal(calls, 0);
});

test('official status request binds returned ID, minimizes fields, rejects redirects, and keeps credentials out of response', async () => {
  const calls = [];
  const lookup = createYouTubePlaybackStatus({ env: env(), now: () => NOW, fetchImpl: async (url, options) => { calls.push({ url: new URL(url), options }); return reply(); } });
  const result = await lookup(ID);
  assert.deepEqual(result, { videoId: ID, madeForKids: false, checkedAt: new Date(NOW).toISOString(), status: 'available' });
  const call = calls[0];
  assert.equal(call.url.origin, 'https://www.googleapis.com');
  assert.equal(call.url.pathname, '/youtube/v3/videos');
  assert.equal(call.url.searchParams.get('id'), ID);
  assert.equal(call.url.searchParams.get('part'), 'status');
  assert.equal(call.url.searchParams.get('fields'), 'items(id,status/madeForKids)');
  assert.equal(call.url.searchParams.get('key'), env().YOUTUBE_API_KEY);
  assert.equal(call.options.redirect, 'error');
  assert.ok(call.options.signal instanceof AbortSignal);
  assert.equal(JSON.stringify(result).includes(env().YOUTUBE_API_KEY), false);
  result.madeForKids = true;
  assert.equal((await lookup(ID)).madeForKids, false, 'A caller cannot mutate the cached classification');
});

test('true remains true and absent/non-boolean/current-ID mismatches remain unknown', async () => {
  const payloads = [
    { items: [{ id: ID, status: { madeForKids: true } }] },
    { items: [{ id: ID, status: { selfDeclaredMadeForKids: false } }] },
    { items: [{ id: ID, status: { madeForKids: 'false' } }] },
    { items: [{ id: OTHER, status: { madeForKids: false } }] },
    { items: [] }, { items: [{ id: ID, status: { madeForKids: false } }, { id: OTHER }] },
  ];
  for (const [index, payload] of payloads.entries()) {
    const result = await createYouTubePlaybackStatus({ env: env(), fetchImpl: async () => Response.json(payload) })(ID);
    assert.equal(result.madeForKids, index === 0 ? true : null);
    assert.equal(result.status, index === 0 ? 'available' : 'unknown');
  }
});

test('missing credentials, provider failures, invalid JSON and oversized data return no classification or secret', async () => {
  let calls = 0;
  const missing = await createYouTubePlaybackStatus({ env: {}, fetchImpl: async () => { calls++; return reply(); } })(ID);
  assert.equal(missing.madeForKids, null); assert.equal(calls, 0);
  for (const fetchImpl of [
    async () => { throw new Error('https://private.example/?key=synthetic-private-key'); },
    async () => new Response('synthetic-private-key', { status: 403 }),
    async () => new Response('not json'),
    async () => new Response(' '.repeat(17000)),
    async () => new Response('{}', { headers: { 'Content-Length': '999999' } }),
  ]) {
    const result = await createYouTubePlaybackStatus({ env: env(), fetchImpl })(ID);
    assert.equal(result.madeForKids, null); assert.equal(result.status, 'unavailable');
    assert.equal(JSON.stringify(result).includes('synthetic-private-key'), false);
  }
});

test('known classification expires at fifteen minutes; unknown is rechecked after one minute and stale false never survives an error', async () => {
  let clock = NOW, calls = 0;
  const lookup = createYouTubePlaybackStatus({ env: env(), now: () => clock, fetchImpl: async () => { calls++; return calls === 1 ? reply() : new Response('', { status: 503 }); } });
  await lookup(ID); clock += KNOWN_TTL_MS - 1;
  assert.equal((await lookup(ID)).madeForKids, false); assert.equal(calls, 1);
  clock++;
  assert.equal((await lookup(ID)).madeForKids, null); assert.equal(calls, 2);
  clock += UNKNOWN_TTL_MS - 1; await lookup(ID); assert.equal(calls, 2);
  clock++; await lookup(ID); assert.equal(calls, 3);
});

test('requests coalesce, concurrent work is bounded, and expired slots recover', async () => {
  const pending = [];
  const lookup = createYouTubePlaybackStatus({ env: env(), fetchImpl: (url) => new Promise(resolve => pending.push({ id: new URL(url).searchParams.get('id'), resolve })) });
  const first = lookup(ID), second = lookup(ID);
  assert.equal(pending.length, 1);
  const requests = [first, second];
  for (let i = 1; i < MAX_IN_FLIGHT; i++) requests.push(lookup(String(i).padStart(11, '0')));
  assert.equal(pending.length, MAX_IN_FLIGHT);
  assert.equal((await lookup('99999999999')).status, 'unavailable');
  pending.forEach(item => item.resolve(reply(item.id)));
  assert.ok((await Promise.all(requests)).every(result => result.madeForKids === false));
  const next = lookup('99999999999'); pending.at(-1).resolve(reply('99999999999'));
  assert.equal((await next).madeForKids, false);
});

test('cache has a finite entry bound and configuration rotation invalidates classifications', async () => {
  const config = env(); let calls = 0;
  const lookup = createYouTubePlaybackStatus({ env: config, now: () => NOW, fetchImpl: async url => { calls++; return reply(new URL(url).searchParams.get('id')); } });
  for (let i = 0; i <= MAX_CACHE_ENTRIES; i++) await lookup(String(i).padStart(11, '0'));
  const before = calls;
  await lookup('00000000000'); assert.equal(calls, before + 1, 'Least recently used entry was evicted');
  config.YOUTUBE_API_KEY = 'replacement-synthetic-key';
  await lookup('00000000000'); assert.equal(calls, before + 2);
  delete config.YOUTUBE_API_KEY;
  assert.equal((await lookup('00000000000')).madeForKids, null);
});

test('request timeout aborts an unresponsive source and releases the concurrency slot', async () => {
  const keepAlive = setTimeout(() => {}, REQUEST_TIMEOUT_MS + 1000);
  try {
    let signal;
    const lookup = createYouTubePlaybackStatus({ env: env(), fetchImpl: (url, options) => new Promise((resolve, reject) => {
      signal = options.signal; signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }) });
    assert.equal((await lookup(ID)).madeForKids, null);
    assert.equal(signal.aborted, true);
  } finally { clearTimeout(keepAlive); }
});

test('service rejects missing members before lookup and route uses authentication then rate limiter with private caching', async () => {
  let calls = 0;
  const service = createCreatorAnalytics({ db: { isConnected: () => false }, getUser: async id => id === 'member' ? { id } : null,
    env: env(), now: () => NOW, fetchImpl: async () => { calls++; return reply(); } });
  await assert.rejects(service.playbackStatus('other', ID), error => error.status === 401);
  assert.equal(calls, 0);
  const routes = [];
  const authenticate = () => {}, limiter = () => {}, playbackLimiter = () => {};
  registerCreatorAnalyticsRoutes({ get: (...args) => routes.push(args), post: () => {} }, { service, authenticate, limiter, playbackLimiter });
  const route = routes.find(args => args[0] === '/creator-analytics/playback-status');
  assert.equal(route[1], authenticate); assert.equal(route[2], playbackLimiter);
  const response = { headers: {}, statusCode: 200, set(k, v) { this.headers[k] = v; return this; }, json(data) { this.data = data; return this; }, status(code) { this.statusCode = code; return this; } };
  await route[3]({ user: { id: 'member' }, query: { videoId: ID } }, response);
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.equal(response.data.madeForKids, false);
  await route[3]({ user: { id: 'member' }, query: { videoId: [ID, OTHER] } }, response);
  assert.equal(response.statusCode, 400);
});

test('ordinary playback browsing and content submissions have independent rate-limit quotas', async t => {
  const app = await createAppHarness({ env: { CONTENT_SUBMISSION_RATE_LIMIT: '5', CREATOR_ANALYTICS_LOCAL_PREVIEW: 'true' } });
  t.after(() => app.close()); app.seedUser(member('playback-quota'));
  assert.equal((await app.request('/creator-analytics/playback-status?videoId=' + ID)).status, 401);
  const browse = () => app.request('/creator-analytics/playback-status?videoId=' + ID, { userId: 'playback-quota' });
  for (let index = 0; index < 31; index++) assert.equal((await browse()).status, 200, 'Normal browsing must not spend posting quota');
  const submit = () => app.request('/creator-analytics/copyright-reports', { userId: 'playback-quota', method: 'POST',
    body: { source: 'youtube', sourceUrl: 'https://www.youtube.com/watch?v=' + ID, reason: 'Review this original source content.' } });
  for (let index = 0; index < 5; index++) assert.equal((await submit()).status, 200);
  assert.equal((await submit()).status, 429, 'The existing content submission quota still applies to writes');
  assert.equal((await browse()).status, 200, 'Exhausting the write quota cannot stop playback-status reads');
});
