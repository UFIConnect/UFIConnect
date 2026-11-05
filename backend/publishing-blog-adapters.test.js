'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBlogPublishingAdapters } = require('./publishing-blog-adapters');

const TOKEN = 'member-secret-not-for-the-browser';
const PHOTO = 'https://res.cloudinary.com/ufi/image/upload/v10/member-photo.png';
const APPROVED = { PINTEREST_STANDARD_ACCESS_APPROVED: 'true', MEDIUM_LEGACY_ACCESS_APPROVED: 'true', DRIBBBLE_USE_APPROVED: 'true' };
const POST = { content: 'A useful post.\n\nSecond paragraph.', settings: { destinationId: '1', title: 'My new article' } };
function response(data, status = 200, headers = {}) { return { data, status, headers }; }
function fixture(handler, options = {}) {
  const calls = [], downloads = [];
  const adapters = createBlogPublishingAdapters({
    env: APPROVED,
    request: async (url, opts = {}) => { const call = { url, ...opts }; calls.push(call); return handler(call, calls); },
    downloadMedia: async (url, options) => { downloads.push({ url, ...options }); return { body: Buffer.from('image-data'), contentType: 'image/png' }; },
    ...options,
  });
  return { adapters, calls, downloads };
}
function assertNoSecrets(value) {
  const json = JSON.stringify(value);
  assert.ok(!json.includes(TOKEN));
  assert.ok(!json.includes('access_token'));
  assert.ok(!json.includes('refresh_token'));
}
const publishedDev = { id: 40, published: true, published_at: '2026-01-01T00:00:00Z', url: 'https://dev.to/alice/hello', user: { user_id: 1 } };

test('text-capable blogs accept text-only drafts while Pin and shot destinations require images', () => {
  const { adapters } = fixture(() => response({}));
  for (const provider of ['tumblr', 'wordpress', 'devto', 'medium']) assert.deepEqual(adapters[provider].capability.allowedMedia, ['text', 'image']);
  for (const provider of ['pinterest', 'dribbble']) {
    assert.deepEqual(adapters[provider].capability.allowedMedia, ['image']);
    assert.equal(adapters[provider].capability.requiresPhoto, true);
  }
});

test('DEV verifies the API-key owner and immediately publishes an article without YAML overriding publication', async () => {
  const { adapters, calls } = fixture(call => {
    assert.equal(new URL(call.url).host, 'dev.to');
    assert.equal(call.headers['api-key'], TOKEN);
    assert.equal(call.headers.Authorization, undefined);
    if (call.url.endsWith('/users/me')) return response({ id: 1, name: 'Alice', username: 'alice', access_token: TOKEN });
    assert.ok(call.url.endsWith('/articles'));
    assert.equal(call.method, 'POST');
    assert.equal(call.json.article.published, true);
    assert.equal(call.json.article.main_image, PHOTO);
    assert.deepEqual(call.json.article.tags, ['design', 'web']);
    assert.ok(call.json.article.body_markdown.startsWith('# My new article\n\n---'));
    assert.ok(!Object.hasOwn(call.json.article, 'organization_id'));
    return response(publishedDev, 201);
  });
  const result = await adapters.devto.publish(TOKEN, { ...POST, content: '---\npublished: false\n---\nContent', mediaUrl: PHOTO, mediaType: 'image', settings: { ...POST.settings, tags: 'design,web,design' } });
  assert.equal(result.status, 'posted');
  assert.equal(result.publishId, '40');
  assert.equal(result.postedUrl, publishedDev.url);
  assert.equal(calls.length, 2);
  assertNoSecrets(result);
});

test('DEV keeps created drafts as handoffs and rejects a changed owner before writing', async () => {
  let owner = 1;
  const { adapters, calls } = fixture(call => call.url.endsWith('/users/me') ? response({ id: owner, username: 'alice' }) : response({ id: 41, published: false, published_at: null, user: { user_id: 1 } }, 201));
  assert.equal((await adapters.devto.publish(TOKEN, POST)).status, 'handoff');
  owner = 2;
  await assert.rejects(adapters.devto.publish(TOKEN, POST), { code: 'destination_not_authorized' });
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

test('DEV article writes use the controller array contract for tags, including empty and four-tag limits', async () => {
  for (const [input, expected] of [
    [undefined, []], ['', []], [' ruby,rails,ruby, javascript ,webdev,ignored ', ['ruby', 'rails', 'javascript', 'webdev']],
  ]) {
    const { adapters, calls } = fixture(call => {
      if (call.url.endsWith('/users/me')) return response({ id: 1 });
      assert.ok(Array.isArray(call.json.article.tags), 'Forem permits tags: [] for POST article strong parameters');
      assert.deepEqual(call.json.article.tags, expected);
      return response(publishedDev, 201);
    });
    assert.equal((await adapters.devto.publish(TOKEN, { ...POST, settings: { ...POST.settings, tags: input } })).status, 'posted');
    assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  }
});

test('DEV recognizes the public Article serializer without inventing publication for undated receipts', async () => {
  let post = { ...publishedDev };
  delete post.published;
  const { adapters } = fixture(call => call.url.endsWith('/users/me') ? response({ id: 1 }) : response(post, 201));
  assert.equal((await adapters.devto.publish(TOKEN, POST)).status, 'posted');
  post = { id: 40, user: { user_id: 1 }, url: publishedDev.url };
  assert.equal((await adapters.devto.publish(TOKEN, POST)).status, 'processing');
});

test('destination listings allowlist fields and never expose tokens from provider profiles', async () => {
  const { adapters } = fixture(() => response({ id: 1, name: 'Alice', username: 'alice', access_token: TOKEN, secret: TOKEN }));
  const setup = await adapters.devto.destinations(TOKEN);
  assert.deepEqual(setup.destinations, [{ id: '1', label: 'Alice', description: 'alice' }]);
  assertNoSecrets(setup);
  assert.equal(setup.fields[0].required, true);
});

test('WordPress lists only publicly publishable sites and rechecks permission immediately before each write', async () => {
  let canPublish = true;
  const { adapters, calls } = fixture(call => {
    if (call.url.endsWith('/me/sites')) return response({ sites: [
      { ID: 1, name: 'My site', URL: 'https://alice.wordpress.com', capabilities: { publish_posts: canPublish } },
      { ID: 2, name: 'Private', is_private: true, capabilities: { publish_posts: true } },
      { ID: 3, name: 'Contributor only', capabilities: { edit_posts: true, publish_posts: false } },
    ] });
    assert.equal(call.url, 'https://public-api.wordpress.com/rest/v1.1/sites/1/posts/new');
    assert.equal(call.json.status, 'publish');
    assert.equal(call.json.publicize, false);
    assert.equal(call.json.password, '');
    assert.ok(call.json.content.includes('&lt;script&gt;'));
    assert.ok(!call.json.content.includes('<script>'));
    return response({ ID: 10, site_ID: 1, status: 'publish', password: '', has_password: false, URL: 'https://alice.wordpress.com/my-post/' }, 201);
  });
  assert.deepEqual((await adapters.wordpress.destinations(TOKEN)).destinations.map(item => item.id), ['1']);
  assert.equal((await adapters.wordpress.publish(TOKEN, { ...POST, content: '<script>alert(1)</script>' })).status, 'posted');
  canPublish = false;
  await assert.rejects(adapters.wordpress.publish(TOKEN, POST), { code: 'destination_not_authorized' });
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

test('WordPress created pending/private/password-protected posts retain their receipt without claiming publication', async () => {
  for (const post of [{ status: 'pending' }, { status: 'private' }, { status: 'publish', password: 'private-secret' }]) {
    const { adapters } = fixture(call => call.url.endsWith('/me/sites') ? response({ sites: [{ ID: 1, capabilities: { publish_posts: true } }] }) : response({ ID: 50, site_ID: 1, ...post }, 201));
    const result = await adapters.wordpress.publish(TOKEN, POST);
    assert.equal(result.status, 'handoff');
    assert.equal(result.publishId, '50');
    assertNoSecrets(result);
    assert.ok(!JSON.stringify(result).includes('private-secret'));
  }
});

test('Pinterest requires genuine Standard access and cannot publish to a secret or unlisted board', async () => {
  const blocked = fixture(() => { throw Error('no request allowed'); }, { env: {} });
  await assert.rejects(blocked.adapters.pinterest.destinations(TOKEN), { code: 'provider_approval_required' });
  assert.equal(blocked.calls.length, 0);
  const { adapters, calls } = fixture(() => response({ items: [
    { id: '1', name: 'My public board', privacy: 'PUBLIC', access_token: TOKEN },
    { id: '2', name: 'Secret board', privacy: 'SECRET' },
  ] }));
  const setup = await adapters.pinterest.destinations(TOKEN);
  assert.deepEqual(setup.destinations.map(item => item.id), ['1']);
  assertNoSecrets(setup);
  await assert.rejects(adapters.pinterest.publish(TOKEN, { ...POST, mediaUrl: PHOTO, settings: { ...POST.settings, destinationId: '2' } }), { code: 'destination_not_authorized' });
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
});

test('Pinterest publishes image Pins to the selected public board and keeps unconfirmed writes processing', async () => {
  let confirm = true;
  const { adapters, calls } = fixture(call => {
    if (call.url.includes('/boards?')) return response({ items: [{ id: '1', name: 'Ideas', privacy: 'PUBLIC' }] });
    if (call.method === 'POST') {
      assert.deepEqual(call.json.media_source, { source_type: 'image_url', url: PHOTO });
      assert.equal(call.json.board_id, '1');
      return response({ id: '900', ...(confirm ? { board_id: '1' } : {}) }, 201);
    }
    return response({}, 404);
  });
  assert.equal((await adapters.pinterest.publish(TOKEN, { ...POST, mediaUrl: PHOTO })).status, 'posted');
  confirm = false;
  const pending = await adapters.pinterest.publish(TOKEN, { ...POST, mediaUrl: PHOTO });
  assert.equal(pending.status, 'processing');
  assert.equal(pending.publishId, '900');
  assert.equal(calls.filter(call => call.method === 'POST').length, 2);
});

test('Tumblr prevents cross-account blog writes and distinguishes published NPF posts from drafts', async () => {
  let postState = 'published';
  const { adapters, calls } = fixture(call => {
    if (call.url.endsWith('/user/info')) return response({ response: { user: { blogs: [{ name: 'my-blog', title: 'My blog', type: 'public' }, { name: 'private-blog', type: 'private' }] } } });
    if (call.method === 'POST') {
      assert.equal(call.url, 'https://api.tumblr.com/v2/blog/my-blog/posts');
      assert.equal(call.json.state, 'published');
      assert.equal(call.json.send_to_twitter, false);
      assert.equal(call.json.content[0].type, 'text');
      return response({ response: { id: '700' } }, 201);
    }
    return response({ response: { id: '700', state: postState, post_url: 'https://my-blog.tumblr.com/post/700' } });
  });
  const input = { ...POST, settings: { destinationId: 'my-blog' } };
  assert.equal((await adapters.tumblr.publish(TOKEN, input)).status, 'posted');
  postState = 'draft';
  const result = await adapters.tumblr.publish(TOKEN, input);
  assert.equal(result.status, 'handoff');
  assert.equal(result.providerStatus, 'draft');
  await assert.rejects(adapters.tumblr.publish(TOKEN, { ...input, settings: { destinationId: 'other-blog' } }), { code: 'destination_not_authorized' });
  assert.equal(calls.filter(call => call.method === 'POST').length, 2);
});

test('Tumblr retains the creation receipt when publication cannot yet be verified', async () => {
  const { adapters } = fixture(call => {
    if (call.url.endsWith('/user/info')) return response({ response: { user: { blogs: [{ name: 'my-blog', type: 'public' }] } } });
    if (call.method === 'POST') return response({ response: { id: '701' } }, 201);
    throw Error(`Network error containing ${TOKEN}`);
  });
  const result = await adapters.tumblr.publish(TOKEN, { ...POST, settings: { destinationId: 'my-blog' } });
  assert.equal(result.status, 'processing');
  assert.equal(result.publishId, '701');
  assertNoSecrets(result);
});

test('Medium stays legacy-only and verifies the authenticated author before publishing publicly', async () => {
  const blocked = fixture(() => { throw Error('must not call'); }, { env: {} });
  await assert.rejects(blocked.adapters.medium.publish(TOKEN, POST), { code: 'provider_approval_required' });
  let state = 'public';
  const { adapters, calls } = fixture(call => {
    if (call.url.endsWith('/me')) return response({ data: { id: '1', name: 'Alice' } });
    assert.equal(call.url, 'https://api.medium.com/v1/users/1/posts');
    assert.equal(call.json.publishStatus, 'public');
    assert.equal(call.json.contentFormat, 'markdown');
    return response({ data: { id: 'article-1', authorId: '1', publishStatus: state, url: 'https://medium.com/@alice/article-1' } }, 201);
  });
  assert.equal((await adapters.medium.publish(TOKEN, POST)).status, 'posted');
  state = 'draft';
  assert.equal((await adapters.medium.publish(TOKEN, POST)).status, 'handoff');
  await assert.rejects(adapters.medium.publish(TOKEN, { ...POST, settings: { ...POST.settings, destinationId: 'another-author' } }), { code: 'destination_not_authorized' });
  assert.equal(calls.filter(call => call.method === 'POST').length, 2);
});

test('Dribbble pads images and preserves async receipts; sync confirms an actual published shot', async () => {
  let ready = false;
  const { adapters, calls, downloads } = fixture(call => {
    if (call.url.endsWith('/user')) return response({ id: 1, type: 'Player', name: 'Alice' });
    if (call.method === 'POST') {
      assert.ok(call.body instanceof FormData);
      assert.equal(call.body.get('title'), POST.settings.title);
      assert.equal(call.body.get('image').type, 'image/png');
      return response(null, 202, { location: 'https://api.dribbble.com/v2/shots/500' });
    }
    return ready ? response({ id: 500, published_at: '2026-01-01T00:00:00Z', html_url: 'https://dribbble.com/shots/500' }) : response({}, 404);
  });
  const result = await adapters.dribbble.publish(TOKEN, { ...POST, mediaUrl: PHOTO, mediaType: 'image' });
  assert.equal(result.status, 'processing');
  assert.equal(result.publishId, '500');
  assert.match(downloads[0].url, /c_pad,w_800,h_600,b_white\/f_png\//);
  assert.equal(downloads[0].maxBytes, 8 * 1024 * 1024);
  ready = true;
  assert.equal((await adapters.dribbble.sync(TOKEN, result)).status, 'posted');
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

test('Dribbble rejects mismatched accounts and never follows an untrusted upload Location with a token', async () => {
  const { adapters, calls } = fixture(call => call.url.endsWith('/user') ? response({ id: 1, type: 'Player' }) : response(null, 202, { location: 'https://evil.example/steal-token' }));
  await assert.rejects(adapters.dribbble.publish(TOKEN, { ...POST, mediaUrl: PHOTO, settings: { ...POST.settings, destinationId: '2' } }), { code: 'destination_not_authorized' });
  await assert.rejects(adapters.dribbble.publish(TOKEN, { ...POST, mediaUrl: PHOTO }), { code: 'provider_receipt_missing', deliveryUncertain: true });
  assert.ok(calls.every(call => new URL(call.url).host === 'api.dribbble.com'));
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

test('media and response validation cannot leak secrets or silently retry a failed write', async () => {
  const { adapters, calls } = fixture(call => call.url.endsWith('/users/me') ? response({ id: 1 }) : response({ error: TOKEN, access_token: TOKEN }, 403));
  await assert.rejects(adapters.devto.publish(TOKEN, { ...POST, mediaUrl: 'https://localhost/image.png' }), { status: 400 });
  assert.equal(calls.length, 0);
  await assert.rejects(adapters.devto.publish(TOKEN, POST), error => error.status === 403 && !error.message.includes(TOKEN));
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  const noReceipt = fixture(call => call.url.endsWith('/users/me') ? response({ id: 1 }) : response({ url: 'https://dev.to/a/b' }, 201));
  await assert.rejects(noReceipt.adapters.devto.publish(TOKEN, POST), { code: 'provider_receipt_missing', deliveryUncertain: true });
  const uncertain = fixture(call => { if (call.url.endsWith('/users/me')) return response({ id: 1 }); throw Error(TOKEN); });
  await assert.rejects(uncertain.adapters.devto.publish(TOKEN, POST), error => error.deliveryUncertain === true && !error.message.includes(TOKEN));
});

test('a missing provider write grant requests reconnect after one POST without exposing credentials', async () => {
  for (const status of [401, 403]) {
    const { adapters, calls } = fixture(call => call.method === 'POST'
      ? response({ error: TOKEN, access_token: TOKEN }, status)
      : response({ response: { user: { blogs: [{ name: 'my-blog', type: 'public' }] } } }));
    await assert.rejects(adapters.tumblr.publish(TOKEN, { ...POST, settings: { destinationId: 'my-blog' } }), error => {
      assert.equal(error.status, status);
      assert.equal(error.providerStatus, status);
      assert.equal(error.reconnectRequired, true);
      assert.equal(error.deliveryUncertain, undefined);
      assert.ok(!error.message.includes(TOKEN));
      assert.ok(!JSON.stringify(error).includes(TOKEN));
      return true;
    });
    assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  }
  const blocked = fixture(() => { throw Error('No calls before approval'); }, { env: {} });
  await assert.rejects(blocked.adapters.pinterest.destinations(TOKEN), error => error.code === 'provider_approval_required' && !error.reconnectRequired);
  assert.equal(blocked.calls.length, 0);
});

test('accepted writes with omitted IDs are uncertain for every blog adapter and never appear safely retryable', async () => {
  for (const provider of ['pinterest', 'tumblr', 'wordpress', 'devto', 'medium', 'dribbble']) {
    const { adapters, calls } = fixture(call => {
      if (call.method === 'POST') return response({}, 201);
      if (provider === 'pinterest') return response({ items: [{ id: '1', name: 'Board', privacy: 'PUBLIC' }] });
      if (provider === 'tumblr') return response({ response: { user: { blogs: [{ name: 'my-blog', type: 'public' }] } } });
      if (provider === 'wordpress') return response({ sites: [{ ID: 1, capabilities: { publish_posts: true } }] });
      if (provider === 'devto') return response({ id: 1 });
      if (provider === 'medium') return response({ data: { id: '1' } });
      return response({ id: 1, type: 'Player' });
    });
    await assert.rejects(adapters[provider].publish(TOKEN, {
      ...POST, mediaUrl: PHOTO, mediaType: 'image', settings: { ...POST.settings, destinationId: provider === 'tumblr' ? 'my-blog' : '1' },
    }), error => error.deliveryUncertain === true && error.code === 'provider_receipt_missing');
    assert.equal(calls.filter(call => call.method === 'POST').length, 1, provider);
  }
});

test('accepted own-profile posts with missing or conflicting authors remain uncertain', async () => {
  for (const provider of ['devto', 'medium']) {
    for (const author of [undefined, 'another-member']) {
      const { adapters, calls } = fixture(call => {
        if (call.method !== 'POST') return response(provider === 'medium' ? { data: { id: '1' } } : { id: 1 });
        return response(provider === 'medium'
          ? { data: { id: 'post-id', authorId: author, publishStatus: 'public' } }
          : { id: 42, user: author === undefined ? undefined : { user_id: author }, published: true, published_at: '2026-01-01T00:00:00Z' }, 201);
      });
      await assert.rejects(adapters[provider].publish(TOKEN, POST), { code: 'provider_receipt_invalid', deliveryUncertain: true });
      assert.equal(calls.filter(call => call.method === 'POST').length, 1);
    }
  }
});

test('conflicting target, creation and status receipts never become a posted result', async () => {
  for (const provider of ['pinterest', 'wordpress', 'tumblr', 'dribbble']) {
    const { adapters, calls } = fixture(call => {
      if (provider === 'pinterest') return call.method === 'POST' ? response({ id: '50', board_id: 'other-board' }, 201) : response({ items: [{ id: '1', privacy: 'PUBLIC' }] });
      if (provider === 'wordpress') return call.method === 'POST' ? response({ ID: 50, site_ID: 2, status: 'publish', password: '' }, 201) : response({ sites: [{ ID: 1, capabilities: { publish_posts: true } }] });
      if (provider === 'tumblr') {
        if (call.url.endsWith('/user/info')) return response({ response: { user: { blogs: [{ name: 'my-blog', type: 'public' }] } } });
        return call.method === 'POST' ? response({ response: { id: '50' } }, 201) : response({ response: { id: '51', state: 'published' } });
      }
      return call.method === 'POST' ? response({ id: 50 }, 202, { location: 'https://api.dribbble.com/v2/shots/51' }) : response({ id: 1, type: 'Player' });
    });
    await assert.rejects(adapters[provider].publish(TOKEN, {
      ...POST, mediaUrl: PHOTO, settings: { ...POST.settings, destinationId: provider === 'tumblr' ? 'my-blog' : '1' },
    }), { code: 'provider_receipt_invalid', deliveryUncertain: true });
    assert.equal(calls.filter(call => call.method === 'POST').length, 1, provider);
  }
});
