'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDevToProfilePhotoHydrator, PHOTO_TTL_MS, NEGATIVE_TTL_MS } = require('./source-profile-photos');
const photo = id => `https://res.cloudinary.com/practicaldev/image/upload/user-${id}.jpg`;
const clip = (id, extra = {}) => ({ id: `devto_video_${id}`, source: 'devto', sourceUrl: 'https://dev.to/devteam/a-video',
  mediaUrl: `https://player.cloudinary.com/video-${id}.mp4`, durationSeconds: 30,
  author: { name: 'Stored author' }, ...extra });
const article = (id, extra = {}) => ({ id: Number(id), user: { id: 2882, name: 'Actual creator', username: 'actual_creator',
  profile_image_90: photo(id), ...extra }, organization: { username: 'devteam', profile_image: photo('organization') },
  cover_image: photo('thumbnail'), body_html: '<p>Not author metadata</p>' });
const response = data => ({ ok: true, json: async () => data });

test('DEV legacy clips use exact official article author metadata, cache concurrent loads and refresh stale photos', async () => {
  let time = 1000;
  const calls = [];
  const hydrate = createDevToProfilePhotoHydrator({ now: () => time, fetcher: async (url, options) => {
    calls.push({ url, options });
    return response(article(150589, { profile_image_90: photo(calls.length) }));
  } });
  const input = [clip(150589, { authorId: 'devto_Display Name', author: { name: 'Wrong path owner', avatarUrl: photo('expired') } }), clip(150589)];
  const [first, second] = await Promise.all([hydrate(input), hydrate(input)]);
  assert.deepEqual(first, second); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://dev.to/api/articles/150589');
  assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.credentials, 'omit');
  assert.match(calls[0].options.headers['User-Agent'], /^UFIConnect/);
  assert.equal(calls[0].options.signal.aborted, false);
  assert.equal(first[0].author.avatarUrl, photo(1));
  assert.equal(first[0].author.name, 'Actual creator'); assert.equal(first[0].author.providerId, '2882');
  assert.equal(first[0].authorId, 'devto_user_2882'); assert.equal(first[0].author.id, first[0].authorId);
  assert.equal(first[0].author.profileUrl, 'https://dev.to/actual_creator', 'Organization in article path is not the author');
  assert.equal(first[0].mediaUrl, input[0].mediaUrl); assert.equal(first[0].durationSeconds, input[0].durationSeconds);
  assert.equal(input[0].author.avatarUrl, photo('expired'), 'Input is not mutated');
  assert.ok(!JSON.stringify(first).includes('body_html')); assert.ok(!JSON.stringify(first).includes('organization.jpg'));
  await hydrate(input); assert.equal(calls.length, 1);
  time += PHOTO_TTL_MS;
  assert.equal((await hydrate(input))[0].author.avatarUrl, photo(2)); assert.equal(calls.length, 2);
});

test('DEV identities require selected numeric video IDs, exact response ID and safe author metadata', async () => {
  const calls = [];
  const hydrate = createDevToProfilePhotoHydrator({ fetcher: async url => {
    calls.push(url);
    const id = Number(url.split('/').pop());
    if (id === 1) return response(article(999));
    if (id === 2) return response(article(2, { profile_image_90: 'javascript:alert(1)', profile_image: 'http://example.com/unsafe.jpg' }));
    return response(article(3, { id: '2882/evil', username: '../org', name: 'bad\nname', profile_image_90: 'https://user:password@example.com/photo.jpg', profile_image: photo(3) }));
  } });
  const unchanged = [clip(1), clip(2), clip('1?url=https://evil.invalid'), clip('1234567890123456'),
    clip(5, { source: 'youtube' }), clip(6, { id: 'devto_6' }), { source: 'devto', sourceUrl: 'https://dev.to/some_person/post', author: { name: 'Guess me' } }];
  const input = [...unchanged, clip(3)];
  const output = await hydrate(input);
  assert.deepEqual(output.slice(0, unchanged.length), unchanged);
  assert.equal(calls.length, 3);
  assert.equal(output.at(-1).author.avatarUrl, photo(3));
  assert.equal(output.at(-1).author.name, 'Stored author');
  assert.equal(output.at(-1).author.providerId, undefined); assert.equal(output.at(-1).author.profileUrl, undefined);
  assert.equal(output.at(-1).authorId, undefined, 'Malformed API metadata cannot become a fabricated identity');
});

test('DEV enrichment caps reads at 16 IDs and four concurrent requests, sharing duplicate identity reads', async () => {
  let active = 0, maxActive = 0;
  const requested = [];
  const hydrate = createDevToProfilePhotoHydrator({ fetcher: async url => {
    const id = url.split('/').pop(); requested.push(id); active++; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setImmediate(resolve)); active--;
    return response(article(id));
  } });
  const input = [clip(1), ...Array.from({ length: 25 }, (_, n) => clip(n + 1))];
  const output = await hydrate(input);
  assert.equal(requested.length, 16); assert.equal(new Set(requested).size, 16);
  assert.equal(maxActive, 4);
  assert.equal(output[0].author.avatarUrl, photo(1)); assert.equal(output[1].author.avatarUrl, photo(1));
  assert.equal(output[17], input[17], 'Unselected IDs are not looked up');
});

test('DEV missing profiles are cached briefly while provider failures back off across new IDs and preserve old photos', async () => {
  let calls = 0, time = 1000;
  const missing = createDevToProfilePhotoHydrator({ now: () => time, fetcher: async () => { calls++; return { ok: false, status: 404 }; } });
  const supplied = [clip(1, { author: { name: 'Stored creator', avatarUrl: photo('prior') } })];
  assert.deepEqual(await missing(supplied), supplied); assert.deepEqual(await missing(supplied), supplied); assert.equal(calls, 1);
  time += NEGATIVE_TTL_MS; await missing(supplied); assert.equal(calls, 2);
  for (const failure of [async () => ({ ok: false, status: 429 }), async () => { throw new Error('Offline'); }]) {
    let reads = 0, clock = 1000;
    const hydrate = createDevToProfilePhotoHydrator({ now: () => clock, fetcher: async () => { reads++; return failure(); } });
    assert.deepEqual(await hydrate(supplied), supplied); assert.deepEqual(await hydrate(supplied), supplied);
    assert.deepEqual(await hydrate([clip(2)]), [clip(2)]); assert.equal(reads, 1, 'No retries or new-identity reads during provider backoff');
    clock += NEGATIVE_TTL_MS; await hydrate(supplied); assert.equal(reads, 2);
  }
});

test('DEV total deadline aborts pending reads, stops queued calls, preserves successful photos and ignores late responses', async () => {
  const calls = [], late = [];
  const hydrate = createDevToProfilePhotoHydrator({ timeoutMs: 20, fetcher: async (url, options) => {
    calls.push({ url, signal: options.signal });
    const id = url.split('/').pop();
    if (id === '1') return response(article(1));
    return new Promise(resolve => late.push(() => resolve(response(article(id)))));
  } });
  const input = Array.from({ length: 16 }, (_, n) => clip(n + 1));
  const output = await hydrate(input);
  assert.equal(output[0].author.avatarUrl, photo(1)); assert.equal(output[1], input[1]);
  assert.equal(calls.length, 5, 'Four workers share the total deadline instead of 16 separate timeouts');
  assert.ok(calls.every(call => call.signal.aborted));
  late.forEach(resolve => resolve()); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await hydrate([clip(2)]), [clip(2)], 'Late metadata cannot mutate cached results after deadline');
  assert.equal(calls.length, 5);
});
