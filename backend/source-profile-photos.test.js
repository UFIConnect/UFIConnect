'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { authorProfilePhoto, youtubeChannelIdentity, createCachedProfileLookup,
  createYouTubeProfilePhotoHydrator, PHOTO_TTL_MS, NEGATIVE_TTL_MS } = require('./source-profile-photos');
const channel = n => 'UC' + String(n).padStart(22, '0');
const photo = n => `https://yt3.ggpht.com/author-${n}.jpg`;
const post = (n, extra = {}) => ({ id: `clip-${n}`, source: 'youtube', author: { name: 'Channel creator',
  profileUrl: `https://www.youtube.com/channel/${channel(n)}` }, thumbnailUrl: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', ...extra });

test('only safe author photo aliases are propagated, never media or profile links', () => {
  assert.equal(authorProfilePhoto({ author: { avatar_url: photo(1) } }), photo(1));
  assert.equal(authorProfilePhoto({ author: { profile_image_url: photo(2) } }), photo(2));
  assert.equal(authorProfilePhoto({ author_avatar_url: photo(3) }), photo(3));
  assert.equal(authorProfilePhoto({ mediaPoster: photo(4), thumbnailUrl: photo(5), author: { profileUrl: photo(6) } }), null);
  for (const unsafe of ['javascript:alert(1)', 'http://example.com/photo.jpg', 'https://user:password@example.com/photo.jpg', 'https://example.com:444/photo.jpg']) {
    assert.equal(authorProfilePhoto({ author: { avatarUrl: unsafe } }), null);
  }
});

test('YouTube author identity uses explicit provider IDs or exact channel URLs without guessing display names', () => {
  assert.equal(youtubeChannelIdentity(post(1)), channel(1));
  assert.equal(youtubeChannelIdentity(post(2, { author: { id: `youtube_${channel(2)}` } })), channel(2));
  assert.equal(youtubeChannelIdentity(post(2, { author: { id: `youtube_ch_${channel(2)}` } })), null);
  assert.equal(youtubeChannelIdentity(post(2, { author: { id: `youtube_channel_${channel(2)}` } })), null);
  assert.equal(youtubeChannelIdentity(post(3, { author: { channelId: channel(3) } })), channel(3));
  for (const profileUrl of ['https://youtube.com.evil.invalid/channel/' + channel(1), 'https://www.youtube.com/watch?v=abcdefghijk',
    'https://www.youtube.com/@Creator', 'http://www.youtube.com/channel/' + channel(1)]) {
    assert.equal(youtubeChannelIdentity(post(1, { author: { name: channel(1), profileUrl } })), null);
  }
  assert.equal(youtubeChannelIdentity({ source: 'mastodon', author: { channelId: channel(1) } }), null);
});

test('YouTube photos use one official channel batch, share concurrent/cache reads and preserve attribution', async () => {
  const calls = [];
  let time = 1000;
  const hydrate = createYouTubeProfilePhotoHydrator({ now: () => time, getApiKey: () => 'private-key', fetcher: async (raw, options) => {
    const url = new URL(raw); calls.push({ url, options });
    return { ok: true, async json() { return { items: [{ id: channel(1), snippet: { thumbnails: { medium: { url: photo(1) } } } },
      { id: channel(2), snippet: { thumbnails: { default: { url: photo(2) } } } }, { id: channel(99), snippet: { thumbnails: { medium: { url: photo(99) } } } }] }; } };
  } });
  const input = [post(1), post(2), post(1), post(3, { author: { name: 'Already supplied', avatarUrl: photo(3) } })];
  const [first, second] = await Promise.all([hydrate(input), hydrate(input)]);
  assert.deepEqual(first, second); assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin + calls[0].url.pathname, 'https://www.googleapis.com/youtube/v3/channels');
  assert.equal(calls[0].url.searchParams.get('part'), 'snippet');
  assert.equal(calls[0].url.searchParams.get('id'), [channel(1), channel(2)].join(','));
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(first[0].author.avatarUrl, photo(1)); assert.equal(first[1].author.avatarUrl, photo(2));
  assert.equal(first[0].author.name, input[0].author.name); assert.equal(first[0].author.profileUrl, input[0].author.profileUrl);
  assert.equal(first[3], input[3]); assert.equal(input[0].author.avatarUrl, undefined);
  assert.ok(!JSON.stringify(first).includes('private-key'));
  await hydrate(input); assert.equal(calls.length, 1);
  time += PHOTO_TTL_MS; await hydrate(input); assert.equal(calls.length, 2);
});

test('missing credentials, photos and denied lookups do not retry or hide clips', async () => {
  let calls = 0, time = 1000, key = '';
  const hydrate = createYouTubeProfilePhotoHydrator({ now: () => time, getApiKey: () => key, fetcher: async () => { calls++; return { ok: false, status: 403 }; } });
  const first = [post(1)];
  assert.equal(await hydrate(first), first); assert.equal(calls, 0);
  key = 'private-key';
  assert.deepEqual(await hydrate(first), first); assert.equal(calls, 1);
  assert.deepEqual(await hydrate([post(2)]), [post(2)]); assert.equal(calls, 1, 'Provider failure backoff also covers new authors');
  time += NEGATIVE_TTL_MS; await hydrate(first); assert.equal(calls, 2);
  let missingCalls = 0;
  const missing = createYouTubeProfilePhotoHydrator({ getApiKey: () => key, fetcher: async () => { missingCalls++; return { ok: true, json: async () => ({ items: [] }) }; } });
  await missing(first); await missing(first); assert.equal(missingCalls, 1);
});

test('supplied stale YouTube photos refresh from official channel metadata once per cached day', async () => {
  let calls = 0, time = 1000;
  const oldPhoto = 'https://yt3.ggpht.com/expired-channel-photo.jpg';
  const hydrate = createYouTubeProfilePhotoHydrator({ now: () => time, getApiKey: () => 'private-key', fetcher: async raw => {
    const url = new URL(raw); calls++;
    assert.equal(url.origin + url.pathname, 'https://www.googleapis.com/youtube/v3/channels', 'Do not probe or proxy the stale image');
    return { ok: true, json: async () => ({ items: [{ id: channel(1), snippet: { thumbnails: { medium: { url: photo(calls) } } } }] }) };
  } });
  const supplied = [post(1, { author: { name: 'Real uploader', channelId: channel(1), avatarUrl: oldPhoto } })];
  assert.equal((await hydrate(supplied))[0].author.avatarUrl, photo(1));
  assert.equal((await hydrate(supplied))[0].author.avatarUrl, photo(1)); assert.equal(calls, 1);
  time += PHOTO_TTL_MS;
  const refreshed = await hydrate(supplied);
  assert.equal(refreshed[0].author.avatarUrl, photo(2)); assert.equal(refreshed[0].author.name, 'Real uploader');
  assert.equal(supplied[0].author.avatarUrl, oldPhoto); assert.equal(calls, 2);
});

test('failed or missing official photo refresh retains a supplied YouTube photo without retries', async () => {
  const supplied = [post(1, { author: { channelId: channel(1), avatarUrl: photo('prior') } })];
  for (const response of [{ ok: false, status: 403 }, { ok: true, json: async () => ({ items: [] }) }]) {
    let calls = 0;
    const hydrate = createYouTubeProfilePhotoHydrator({ getApiKey: () => 'private-key', fetcher: async () => { calls++; return response; } });
    assert.deepEqual(await hydrate(supplied), supplied);
    assert.deepEqual(await hydrate(supplied), supplied); assert.equal(calls, 1);
  }
});

test('photo enrichment performs at most one batch per load and ignores unrelated API identities', async () => {
  const requests = [];
  const hydrate = createYouTubeProfilePhotoHydrator({ getApiKey: () => 'private-key', fetcher: async raw => {
    const ids = new URL(raw).searchParams.get('id').split(','); requests.push(ids);
    return { ok: true, json: async () => ({ items: [{ id: channel(100), snippet: { thumbnails: { medium: { url: photo(100) } } } }] }) };
  } });
  const input = Array.from({ length: 80 }, (_, n) => post(n + 1));
  const output = await hydrate(input);
  assert.equal(requests.length, 1); assert.equal(requests[0].length, 50);
  assert.deepEqual(output, input, 'An unrelated returned identity cannot become the requested author');
});

test('historical YouTube clips resolve real uploader IDs from a bounded official video batch before channel photos', async () => {
  const calls = [];
  const hydrate = createYouTubeProfilePhotoHydrator({ getApiKey: () => 'private-key', fetcher: async raw => {
    const url = new URL(raw); calls.push(url);
    if (url.pathname.endsWith('/videos')) return { ok: true, json: async () => ({ items: [
      { id: 'abcdefghijk', snippet: { channelId: channel(1), thumbnails: { default: { url: 'https://i.ytimg.com/vi/abcdefghijk/default.jpg' } } } },
      { id: 'unrequested', snippet: { channelId: channel(99) } },
    ] }) };
    return { ok: true, json: async () => ({ items: [{ id: channel(1), snippet: { thumbnails: { medium: { url: photo(1) } } } }] }) };
  } });
  const input = [{ source: 'youtube', sourceUrl: 'https://www.youtube.com/shorts/abcdefghijk', author: { name: 'Stored author', avatarUrl: photo('old') } },
    { source: 'youtube', sourceUrl: 'https://www.youtube.com/watch?v=lmnopqrstuv', author: { name: 'Another stored author' } },
    { source: 'youtube', sourceUrl: 'https://youtube.com.evil.invalid/watch?v=abcdefghijk', author: { name: 'Forged identity' } }];
  const result = await hydrate(input);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].pathname, '/youtube/v3/videos');
  assert.equal(calls[0].searchParams.get('id'), 'abcdefghijk,lmnopqrstuv');
  assert.equal(calls[1].searchParams.get('id'), channel(1));
  assert.equal(result[0].author.avatarUrl, photo(1)); assert.equal(result[0].author.name, 'Stored author');
  assert.equal(result[0].author.profileUrl, 'https://www.youtube.com/channel/' + channel(1));
  assert.equal(result[1].author.avatarUrl, undefined); assert.equal(result[2], input[2]);
  await hydrate(input); assert.equal(calls.length, 2);
});

test('profile lookup cache has bounded storage and coalesces overlapping authors', async () => {
  const reads = [];
  const lookup = createCachedProfileLookup({ maxEntries: 2, load: async keys => { reads.push(keys); return new Map(keys.map(key => [key, photo(key)])); } });
  await Promise.all([lookup.lookup(['a', 'b']), lookup.lookup(['b'])]);
  assert.equal(reads.length, 1);
  await lookup.lookup(['c']); await lookup.lookup(['a']);
  assert.equal(reads.length, 3, 'Older entries are evicted rather than growing without a bound');
});
