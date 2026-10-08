'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { createAppHarness, member } = require('./test-support/app-harness');
const { createSourceImageDownloader } = require('./source-image-download');

const now = Date.now();
const today = new Date(now).toISOString().slice(0, 10) + 'T00:00:00.000Z';
const yesterday = new Date(now - 86400000).toISOString().slice(0, 10) + 'T00:00:00.000Z';
const recent = new Date(now - 1000).toISOString();
const old = new Date(now - 3 * 86400000).toISOString();
const endpoint = '/command-center/your-content?platform=dribbble';
const env = {
  DRIBBBLE_CLIENT_ID: 'synthetic-client', DRIBBBLE_CLIENT_SECRET: 'synthetic-secret',
  OFFICE_TOKEN: 'synthetic-office', PUBLIC_API_URL: 'https://api.uficonnect.org',
};
function shot(id, overrides = {}) {
  return {
    id, title: 'Portfolio concept', description: '<p>A design study with accessible navigation.</p>',
    published_at: recent, html_url: `https://dribbble.com/shots/${id}-portfolio`,
    images: { hidpi: `https://cdn.dribbble.com/userupload/${id}/design.png`, normal: null },
    ...overrides,
  };
}
async function fixture(t, fetchShots, overrides = {}) {
  const calls = [];
  const app = await createAppHarness({
    ...overrides,
    env: { ...env, ...overrides.env },
    modules: {
      './provider-json': { createProviderJsonClient: () => ({
        fetchJSON: async () => { throw new Error('Unexpected external JSON request'); },
        fetchJSONWithHeaders: async (url, headers) => {
          calls.push({ url, headers });
          assert.equal(new URL(url).origin, 'https://api.dribbble.com');
          assert.equal(new URL(url).pathname, '/v2/user/shots');
          assert.equal(url.includes('synthetic-token'), false);
          return fetchShots(url, headers, calls.length);
        },
      }) },
      ...overrides.modules,
    },
  });
  t.after(() => app.close());
  const alice = member('alice', { plan: 'pro', socialTokens: { dribbble: 'synthetic-token-alice' }, socialConnectedAt: { dribbble: yesterday } });
  const bob = member('bob', { plan: 'pro', socialTokens: { dribbble: 'synthetic-token-bob' }, socialConnectedAt: { dribbble: yesterday } });
  app.seedUser(alice); app.seedUser(bob);
  return { app, calls, alice, bob };
}

test('catalog and protected diagnostics expose real own-content support while preserving OAuth and membership boundaries', async t => {
  const { app, calls } = await fixture(t, () => { throw new Error('Catalog must not fetch member content'); });
  const catalog = await app.request('/social/platforms', { userId: 'alice' });
  assert.equal(catalog.status, 200);
  for (const platform of ['dribbble', 'twitch', 'github']) assert.equal(catalog.data.platforms[platform].ownContent.supported, true);
  for (const platform of ['discord', 'figma']) assert.equal(catalog.data.platforms[platform].ownContent.supported, false);
  assert.equal(catalog.data.platforms.dribbble.configured, true);
  assert.equal(catalog.data.platforms.dribbble.forceComingSoon, false);
  assert.equal(catalog.data.platforms.dribbble.crossPost.supported, false);
  assert.equal(JSON.stringify(catalog.data).includes('synthetic-token'), false);
  assert.equal((await app.request('/office/oauth-status')).status, 401);
  const diagnostics = await app.request('/office/oauth-status', { headers: { 'x-office-token': env.OFFICE_TOKEN } });
  assert.equal(diagnostics.status, 200);
  assert.deepEqual(diagnostics.data.platforms.dribbble.ownContent, { supported: true });
  assert.equal(JSON.stringify(diagnostics.data).includes('synthetic-secret'), false);
  const start = await app.request('/auth/social/dribbble/start?returnTo=command-center', { userId: 'alice' });
  assert.equal(start.status, 200);
  const url = new URL(start.data.url);
  assert.equal(url.origin, 'https://dribbble.com');
  assert.equal(url.searchParams.get('scope'), 'public');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://api.uficonnect.org/auth/social/dribbble/callback');
  app.seedUser(member('business', { plan: 'business' }));
  const business = await app.request('/social/platforms', { userId: 'business' });
  assert.equal(business.data.platforms.dribbble, undefined);
  assert.equal((await app.request('/auth/social/dribbble/start', { userId: 'business' })).status, 403);
  assert.equal((await app.request(endpoint)).status, 401);
  app.seedUser(member('free'));
  assert.equal((await app.request(endpoint, { userId: 'free' })).status, 403);
  assert.equal(calls.length, 0);
});

test('published own shots retain links and media, follow short-page pagination, and stay outside Following/public posts', async t => {
  const { app, calls } = await fixture(t, async url => {
    if (new URL(url).searchParams.get('page') === '1') return {
      data: [shot(100, { description: '<p>See <a href="https://example.org/design?a=1&amp;b=2">design notes</a>.</p><script>hidden()</script>' }),
        shot(101, { video: { url: 'https://cdn.dribbble.com/users/1/videos/101/movie.webm' } }),
        shot(102, { published_at: null, scheduled_for: new Date(now + 86400000).toISOString() })],
      headers: { link: '<https://api.dribbble.com/v2/user/shots?page=2&per_page=100>; rel="next"' },
    };
    return {
      data: [shot(100), shot(103, { images: { hidpi: null, normal: 'https://d13yacurqjgara.cloudfront.net/users/1/screenshots/103/design.jpg' }, published_at: new Date(now - 2000).toISOString() }), shot(104, { published_at: old })],
      headers: { link: '<https://api.dribbble.com/v2/user/shots?page=3>; rel="next"' },
    };
  });
  const own = await app.request(endpoint, { userId: 'alice' });
  assert.equal(own.status, 200);
  assert.deepEqual(own.data.posts.map(post => post.id).sort(), ['dribbble_own_100', 'dribbble_own_101', 'dribbble_own_103']);
  const image = own.data.posts.find(post => post.id === 'dribbble_own_100');
  assert.match(image.content, /design notes \(https:\/\/example.org\/design\?a=1&b=2\)/);
  assert.equal(image.content.includes('hidden()'), false);
  assert.equal(image.mediaType, 'image');
  assert.equal(image.sourceUrl, 'https://dribbble.com/shots/100-portfolio');
  assert.equal(image.authorId, 'dribbble_alice');
  assert.equal(own.data.posts.find(post => post.id === 'dribbble_own_101').mediaType, 'video_thumbnail_only');
  assert.equal(own.data.syncStartAt, yesterday);
  assert.match(own.headers.get('cache-control'), /private.*no-store/);
  assert.equal(calls.length, 2);
  assert.equal(calls.every(call => call.headers.Authorization === 'Bearer synthetic-token-alice'), true);
  const combined = await app.request('/command-center/your-content/feed', { userId: 'alice' });
  assert.equal(combined.status, 200);
  assert.equal(combined.data.sources.dribbble, 3);
  assert.deepEqual(combined.data.connectedPlatforms, ['dribbble']);
  const following = await app.getFollowingFeedPosts('alice', 'dribbble', { bust: true, surface: 'feed' });
  assert.equal(following.posts.some(post => post.source === 'dribbble'), false);
  assert.equal(app.posts.some(post => post.source === 'dribbble'), false);
  assert.equal(calls.length, 2, 'Following never requests Dribbble own shots');
});

test('own-shot caches isolate member, token, and connection-day changes', async t => {
  const { app, calls, alice, bob } = await fixture(t, async (_url, headers) => ({
    data: [shot(headers.Authorization.endsWith('bob') ? 200 : 100)], headers: {},
  }));
  assert.equal((await app.request(endpoint, { userId: alice.id })).data.posts[0].id, 'dribbble_own_100');
  await app.request(endpoint, { userId: alice.id });
  assert.equal(calls.length, 1);
  assert.equal((await app.request(endpoint, { userId: bob.id })).data.posts[0].id, 'dribbble_own_200');
  bob.socialTokens.dribbble = alice.socialTokens.dribbble;
  await app.request(endpoint, { userId: bob.id });
  assert.equal(calls.length, 3, 'Even a shared token does not share member cache entries');
  alice.socialTokens.dribbble = 'synthetic-token-new';
  await app.request(endpoint, { userId: alice.id });
  assert.equal(calls.length, 4);
  alice.socialConnectedAt.dribbble = today;
  await app.request(endpoint, { userId: alice.id });
  assert.equal(calls.length, 5);
  delete alice.socialTokens.dribbble;
  assert.equal((await app.request(endpoint, { userId: alice.id })).status, 400);
  assert.equal(calls.length, 5, 'Disconnected account cannot reuse content');
});

test('provider pagination cannot forward tokens to another host, credentials URL, or API resource', async t => {
  for (const destination of ['https://attacker.invalid/v2/user/shots?page=2', 'https://api.dribbble.com.attacker.invalid/v2/user/shots', 'https://alice:secret@api.dribbble.com/v2/user/shots', 'https://api.dribbble.com/v2/user', 'http://api.dribbble.com/v2/user/shots', 'https://api.dribbble.com:444/v2/user/shots']) {
    await t.test(destination, async sub => {
      const { app, calls } = await fixture(sub, async () => ({ data: [shot(100)], headers: { link: `<${destination}>; rel="next"` } }));
      const own = await app.request(endpoint, { userId: 'alice' });
      assert.equal(own.status, 200);
      assert.equal(own.data.posts.length, 1);
      assert.equal(calls.length, 1);
    });
  }
});

test('page limits and repeated provider links bound the number of external requests', async t => {
  const { app, calls } = await fixture(t, async (_url, _headers, number) => ({
    data: [shot(number)], headers: { link: `<https://api.dribbble.com/v2/user/shots?page=${number + 1}>; rel="next"` },
  }), { env: { CONNECTED_ACCOUNT_HISTORY_MAX_PAGES: '2' } });
  assert.equal((await app.request(endpoint, { userId: 'alice' })).data.posts.length, 2);
  assert.equal(calls.length, 2);
  const repeated = await fixture(t, async () => ({ data: [shot(100)], headers: { link: '<https://api.dribbble.com/v2/user/shots?per_page=100&page=1>; rel="next"' } }));
  assert.equal((await repeated.app.request(endpoint, { userId: 'alice' })).status, 200);
  assert.equal(repeated.calls.length, 1);
});

test('revoked Dribbble access clears cached shots and requests reconnect instead of returning stale success', async t => {
  let revoked = false;
  const { app, calls } = await fixture(t, async () => {
    if (revoked) throw new Error('HTTP 401 for https://api.dribbble.com');
    return { data: [shot(100)], headers: {} };
  });
  assert.equal((await app.request(endpoint, { userId: 'alice' })).status, 200);
  revoked = true;
  const failed = await app.request(endpoint + '&bust=1', { userId: 'alice' });
  assert.equal(failed.status, 502);
  assert.equal(failed.data.reconnectRequired, true);
  assert.match(failed.data.message, /Reconnect Dribbble/);
  assert.equal((await app.request(endpoint, { userId: 'alice' })).status, 502);
  assert.equal(calls.length, 3);
  const combined = await app.request('/command-center/your-content/feed', { userId: 'alice' });
  assert.equal(combined.data.posts.length, 0);
  assert.match(combined.data.sourceErrors.dribbble, /Reconnect Dribbble/);
  assert.equal(JSON.stringify(combined.data).includes('synthetic-token'), false);
});

test('malformed upstream data is surfaced as a fetch error, not an empty successful feed', async t => {
  const { app } = await fixture(t, async () => ({ data: { message: 'upstream-error' }, headers: {} }));
  assert.equal((await app.request(endpoint, { userId: 'alice' })).status, 502);
  const combined = await app.request('/command-center/your-content/feed', { userId: 'alice' });
  assert.match(combined.data.sourceErrors.dribbble, /Invalid Dribbble/);
});

test('downloads allow only Dribbble shot-image paths on exact CDNs and never video or lookalike hosts', async t => {
  const downloaded = [];
  const images = [
    { url: 'https://d13yacurqjgara.cloudfront.net/users/1/screenshots/100/design.png', mimeType: 'image/png', extension: 'png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') },
    { url: 'https://cdn.dribbble.com/userupload/100/design.webp?resize=800x600', mimeType: 'image/webp', extension: 'webp',
      body: Buffer.from('UklGRhwAAABXRUJQVlA4TA8AAAAvAUAAAAcQ9Y/+ByKi/wEA', 'base64') },
  ];
  let spoofedImage = false;
  const { app } = await fixture(t, async () => ({ data: [], headers: {} }), { modules: {
    './source-image-download': { createSourceImageDownloader: options => createSourceImageDownloader({ ...options,
      get(target, requestOptions, handler) {
        downloaded.push(target.href);
        assert.equal(requestOptions.headers['Accept-Encoding'], 'identity');
        const image = images.find(image => image.url === target.href);
        assert.ok(image, 'Only a declared synthetic image may be requested');
        const body = spoofedImage ? Buffer.from('synthetic image') : image.body;
        const response = Readable.from([body]);
        response.statusCode = 200; response.headers = { 'content-type': image.mimeType, 'content-length': String(body.length) };
        const request = new EventEmitter(); request.destroy = () => response.destroy();
        queueMicrotask(() => handler(response));
        return request;
      },
    }) },
  } });
  for (const image of images) {
    const result = await fetch(app.base + '/command-center/your-content/download?' + new URLSearchParams({ url: image.url }), {
      headers: { authorization: `Bearer ${app.token('alice')}` },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), image.body);
    assert.equal(result.headers.get('content-disposition'), `attachment; filename="content.${image.extension}"`);
    assert.equal(result.headers.get('content-type'), 'application/octet-stream');
    assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  }
  for (const url of ['https://cdn.dribbble.com/users/1/videos/100/movie.webm', 'https://cdn.dribbble.com/userupload/100/page.html', 'https://cdn.dribbble.com.attacker.invalid/userupload/100/image.png', 'https://another.cloudfront.net/users/1/screenshots/100/image.png', 'https://cdn.dribbble.com:444/userupload/100/image.png', 'https://alice:secret@cdn.dribbble.com/userupload/100/image.png', 'http://cdn.dribbble.com/userupload/100/image.png']) {
    const result = await app.request('/command-center/your-content/download?' + new URLSearchParams({ url }), { userId: 'alice' });
    assert.equal(result.status, 400, url);
  }
  assert.equal(downloaded.length, 2);
  spoofedImage = true;
  const rejected = await app.request('/command-center/your-content/download?' + new URLSearchParams({ url: images[0].url }), { userId: 'alice' });
  assert.equal(rejected.status, 502, 'Plain text advertised as PNG must fail production validation');
  assert.equal(downloaded.length, 3);
});
