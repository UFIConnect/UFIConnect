'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./test-support/app-harness');

async function publisher(t, options = {}) {
  const calls = [];
  const state = { error: null };
  const service = {
    has: platform => ['github', 'youtube'].includes(platform),
    capability: platform => platform === 'github' ? { supported: true, delivery: 'direct', media: 'link', settingsRequired: true, label: 'GitHub release' }
      : platform === 'youtube' ? { supported: true, delivery: 'direct', media: 'video', allowedMedia: ['video'], requiresVideo: true, settingsRequired: true, label: 'YouTube video' } : null,
    async destinations(platform, token, query) {
      calls.push({ kind: 'destinations', platform, token, query });
      if (state.error) throw state.error;
      return { label: 'GitHub release', destinationLabel: 'Public repository', destinations: [{ id: 'member/project', label: 'member/project' }], fields: [{ key: 'tagName', type: 'select', options: [{ value: 'v1.0', label: 'v1.0' }] }] };
    },
    async publish(platform, token, input) {
      calls.push({ kind: 'publish', platform, token, input });
      if (state.error) throw state.error;
      return platform === 'youtube'
        ? { status: 'processing', delivery: 'direct', publishId: 'video123456', providerId: 'video123456', destinationId: input.settings.destinationId, privacyStatus: input.settings.privacyStatus }
        : { status: 'posted', delivery: 'direct', publishId: 'release-1', providerId: 'release-1', destinationId: input.settings.destinationId, postedUrl: 'https://github.com/member/project/releases/tag/v1.0' };
    },
    canSync: platform => platform === 'youtube',
    async sync(_platform, _token, target) { return { ...target, status: 'posted' }; },
  };
  const app = await createAppHarness({ connected: true, env: { GITHUB_CLIENT_ID: 'synthetic-client', GITHUB_CLIENT_SECRET: 'synthetic-secret', CLOUDINARY_CLOUD_NAME: 'synthetic-cloud' }, ...options,
    modules: { './publishing-targets': { createPublishingTargets: () => service }, ...options.modules },
  });
  t.after(() => app.close());
  const user = member('account-publisher', { plan: 'pro', socialTokens: { github: 'synthetic-access', youtube: 'synthetic-youtube' } });
  app.seedUser(user);
  app.setContentScreening(async ({ content }) => ({ allowed: true, content }));
  return { app, user, calls, state };
}

test('publishing destination routes require authentication, eligible plan and the member connection', { timeout: 30000 }, async t => {
  const { app, user, calls } = await publisher(t);
  const route = '/command-center/cross-post/github/destinations';
  assert.equal((await app.request(route)).status, 401);
  for (const plan of ['free', 'business']) {
    user.plan = plan;
    assert.equal((await app.request(route, { userId: user.id })).status, 403);
  }
  user.plan = 'pro';
  delete user.socialTokens.github;
  const missing = await app.request(route, { userId: user.id });
  assert.equal(missing.status, 409);
  assert.equal(missing.data.reconnectRequired, true);
  assert.equal(calls.length, 0);
  user.socialTokens.github = 'synthetic-access';
  assert.equal((await app.request('/command-center/cross-post/unknown/destinations', { userId: user.id })).status, 404);
});

test('destination routes pass selected repository for tag lookup and never return the access token', { timeout: 30000 }, async t => {
  const { app, user, calls } = await publisher(t);
  const response = await app.request('/command-center/cross-post/github/destinations?destinationId=member%2Fproject', { userId: user.id });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.data.label, 'GitHub release');
  assert.equal(response.data.destinations[0].id, 'member/project');
  assert.equal(JSON.stringify(response.data).includes('synthetic-access'), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].token, 'synthetic-access');
  assert.equal(calls[0].query.destinationId, 'member/project');
});

test('POST cross-post passes only each selected platform settings after preparing durable history', { timeout: 30000 }, async t => {
  let savedId;
  const { app, user, calls } = await publisher(t, { query: async (sql, params) => {
    if (sql.includes('INSERT INTO cross_posts')) savedId = params[0];
    return { rows: [], rowCount: 1 };
  } });
  const settings = { destinationId: 'member/project', title: 'Release 1', tagName: 'v1.0' };
  const response = await app.request('/command-center/cross-post', { userId: user.id, method: 'POST', body: {
    content: 'Reviewed release notes', platforms: ['github'], publisherSettings: { github: settings, figma: { destinationId: 'unselected-file' } },
  } });
  assert.equal(response.status, 200);
  assert.equal(response.data.targets[0].status, 'posted');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'publish');
  assert.equal(calls[0].platform, 'github');
  assert.deepEqual(calls[0].input.settings, settings);
  assert.equal(calls[0].input.content, 'Reviewed release notes');
  assert.equal(calls[0].input.crossPostId, savedId);
  assert.equal(response.data.targets[0].destinationId, settings.destinationId);
  assert.equal(response.data.historySaved, true);
});

test('uncertain provider writes become handoff and are never retried automatically', { timeout: 30000 }, async t => {
  const { app, user, calls, state } = await publisher(t);
  state.error = Object.assign(new Error('The provider did not confirm delivery. Check the destination before retrying.'), { status: 502, deliveryUncertain: true });
  const response = await app.request('/command-center/cross-post', { userId: user.id, method: 'POST', body: { content: 'Reviewed release notes', platforms: ['github'], publisherSettings: { github: { destinationId: 'member/project', title: 'Release 1', tagName: 'v1.0' } } } });
  assert.equal(response.status, 200);
  assert.equal(response.data.targets[0].status, 'handoff');
  assert.equal(response.data.targets[0].deliveryUncertain, true);
  assert.equal(response.data.targets[0].delivery, 'direct');
  assert.equal(calls.filter(call => call.kind === 'publish').length, 1);
});

test('YouTube accepted receipts preserve channel and chosen privacy in saved history', { timeout: 30000 }, async t => {
  let savedTargets;
  const { app, user } = await publisher(t, { query: async (sql, params) => {
    if (sql.includes('UPDATE cross_posts SET targets')) savedTargets = JSON.parse(params[0]);
    return { rows: [], rowCount: 1 };
  } });
  const response = await app.request('/command-center/cross-post', { userId: user.id, method: 'POST', body: {
    content: 'A reviewed video', platforms: ['youtube'], mediaType: 'video', mediaUrl: 'https://res.cloudinary.com/synthetic-cloud/video/upload/video.mp4',
    publisherSettings: { youtube: { destinationId: 'UC-member', title: 'Reviewed video', privacyStatus: 'unlisted', madeForKids: 'no' } },
  } });
  assert.equal(response.status, 200);
  assert.equal(response.data.targets[0].status, 'processing');
  assert.equal(savedTargets[0].destinationId, 'UC-member');
  assert.equal(savedTargets[0].privacyStatus, 'unlisted');
  assert.equal(savedTargets[0].publishId, 'video123456');
});

test('history sync saves a provider receipt before exposing it and retains old state if persistence fails', { timeout: 30000 }, async t => {
  let failSave = false;
  const writes = [];
  const pending = { platform: 'youtube', status: 'processing', delivery: 'direct', publishId: 'video123456', destinationId: 'UC-member', privacyStatus: 'private' };
  const { app, user } = await publisher(t, { query: async (sql, params) => {
    if (sql.includes('FROM cross_posts')) return { rows: [{ id: 'owned-video', content: 'Video', targets: [pending], created_at: new Date().toISOString() }], rowCount: 1 };
    if (sql.includes('UPDATE cross_posts SET targets')) {
      writes.push(params);
      if (failSave) throw new Error('Synthetic persistence failure');
    }
    return { rows: [], rowCount: 1 };
  } });
  const synced = await app.request('/command-center/cross-post/sync', { userId: user.id, method: 'POST', body: {} });
  assert.equal(synced.status, 200);
  assert.equal(synced.data.updated, 1);
  assert.equal(synced.data.posts[0].targets[0].status, 'posted');
  assert.equal(synced.data.posts[0].targets[0].privacyStatus, 'private');
  assert.equal(writes[0][1], 'owned-video');
  assert.equal(writes[0][2], user.id);
  assert.equal(JSON.parse(writes[0][0])[0].status, 'posted');
  failSave = true;
  const failed = await app.request('/command-center/cross-post/sync', { userId: user.id, method: 'POST', body: {} });
  assert.equal(failed.status, 200);
  assert.equal(failed.data.updated, 0);
  assert.equal(failed.data.posts[0].targets[0].status, 'processing');
});

test('DEV connection uses a verified personal key and publishing rejects a different profile destination', { timeout: 30000 }, async t => {
  const providerCalls = [];
  const app = await createAppHarness({ connected: true, modules: {
    './publishing-http': { createPublishingHttp: () => ({ request: async (url, options) => {
      providerCalls.push({ url, options });
      assert.equal(url, 'https://dev.to/api/users/me');
      assert.equal(options.headers.Accept, 'application/vnd.forem.api-v1+json');
      return options.headers['api-key'] === 'actual-owner-key' ? { status: 200, data: { id: 77, name: 'Key Owner', username: 'key-owner' } } : { status: 401, data: { error: 'invalid key' } };
    } }) },
  } });
  t.after(() => app.close());
  const user = member('dev-key-owner', { plan: 'pro' });
  app.seedUser(user);
  app.setContentScreening(async ({ content }) => ({ allowed: true, content }));
  assert.equal((await app.request('/social/connect/devto', { method: 'POST', body: { apiKey: 'actual-owner-key' } })).status, 401);
  assert.equal((await app.request('/social/connect/devto', { userId: user.id, method: 'POST', body: { apiKey: 'invalid-owner-key' } })).status, 422);
  assert.equal(user.socialTokens.devto, undefined);
  const connected = await app.request('/social/connect/devto', { userId: user.id, method: 'POST', body: { apiKey: 'actual-owner-key' } });
  assert.equal(connected.status, 200);
  assert.equal(user.socialTokens.devto, 'actual-owner-key');
  assert.equal(JSON.stringify(connected.data).includes('actual-owner-key'), false);
  const sources = await app.request('/social/platforms', { userId: user.id });
  assert.equal(sources.data.platforms.devto.connected, true);
  const denied = await app.request('/command-center/cross-post', { userId: user.id, method: 'POST', body: {
    content: 'Reviewed article', platforms: ['devto'], publisherSettings: { devto: { destinationId: 'someone-else', title: 'A reviewed article' } },
  } });
  assert.equal(denied.status, 200);
  assert.equal(denied.data.targets[0].status, 'failed');
  assert.match(denied.data.targets[0].error, /profile connected by your API key/);
  assert.equal(providerCalls.length, 3);
  assert.ok(providerCalls.every(call => !call.options.method || call.options.method === 'GET'));
});

test('Hashnode privately connects verified editors with no owned publications under its canonical account ID', { timeout: 30000 }, async t => {
  const publicationId = '0123456789abcdef01234567';
  const calls = [];
  const publication = { id: publicationId, title: 'Edited publication', url: 'https://writing.example/', author: { id: 'another-owner' }, isHeadless: false };
  const app = await createAppHarness({ connected: true, modules: {
    './publishing-http': { createPublishingHttp: () => ({ request: async (url, options) => {
      assert.equal(url, 'https://gql-beta.hashnode.com/');
      calls.push(options.json.operationName);
      if (options.headers.Authorization !== 'Bearer verified-editor-key') return { status: 401, data: {} };
      const responses = {
        UfiHashnodePublications: { me: { id: 'editor-7', publications: { edges: [], pageInfo: { hasNextPage: false } } } },
        UfiHashnodeDestination: { me: { id: 'editor-7' }, publication },
        UfiHashnodeMembers: { publication: { id: publicationId, members: { edges: [{ node: { role: 'EDITOR', user: { id: 'editor-7' } } }], pageInfo: { hasNextPage: false } } } },
        UfiHashnodePublish: { publishPost: { post: { id: 'hashnode-post-1', url: 'https://writing.example/reviewed', author: { id: 'editor-7' }, publication: { id: publicationId }, publishedAt: null, preferences: { isDelisted: false } } } },
      };
      assert.ok(responses[options.json.operationName], 'Unexpected Hashnode operation');
      return { status: 200, data: { data: responses[options.json.operationName] } };
    } }) },
  } });
  t.after(() => app.close());
  const user = member('hashnode-editor', { plan: 'pro' });
  app.seedUser(user);
  app.setContentScreening(async ({ content }) => ({ allowed: true, content }));
  const connected = await app.request('/social/connect/hashnode_blog', { userId: user.id, method: 'POST', body: { apiKey: 'verified-editor-key' } });
  assert.equal(connected.status, 200);
  assert.equal(connected.data.connected, 'hashnode_blog');
  assert.equal(user.socialTokens.hashnode_blog, 'verified-editor-key');
  assert.equal(JSON.stringify(connected.data).includes('verified-editor-key'), false);
  const invalid = await app.request('/social/connect/hashnode_blog', { userId: user.id, method: 'POST', body: { apiKey: 'invalid-editor-key' } });
  assert.equal(invalid.status, 422);
  assert.equal(user.socialTokens.hashnode_blog, 'verified-editor-key', 'A failed replacement must preserve the verified key');
  const catalog = await app.request('/social/platforms', { userId: user.id });
  assert.equal(catalog.data.platforms.hashnode_blog.name, 'Hashnode');
  assert.equal(catalog.data.platforms.hashnode_blog.connectionMode, 'api-key');
  assert.equal(catalog.data.platforms.hashnode_blog.connected, true);
  assert.equal(catalog.data.platforms.hashnode_blog.crossPost.label, 'Hashnode article');
  assert.equal(catalog.data.platforms.hashnode_blog.feed.home, false);
  assert.equal(JSON.stringify(catalog.data).includes('verified-editor-key'), false);
  assert.ok(app.SOURCE_CONFIG.hashnode, 'The existing feed collector keeps its historical key');
  assert.equal(app.SOURCE_CONFIG.hashnode_blog, undefined);
  const destinations = await app.request(`/command-center/cross-post/hashnode_blog/destinations?destinationId=${publicationId}`, { userId: user.id });
  assert.equal(destinations.status, 200);
  assert.equal(destinations.data.accountVerified, true);
  assert.equal(destinations.data.allowCustomDestination, true);
  assert.equal(destinations.data.destinations[0].id, publicationId);
  const published = await app.request('/command-center/cross-post', { userId: user.id, method: 'POST', body: { content: 'A reviewed article', platforms: ['hashnode_blog'], publisherSettings: { hashnode_blog: { destinationId: publicationId, title: 'Reviewed article' } } } });
  assert.equal(published.status, 200);
  assert.equal(published.data.targets[0].status, 'processing');
  assert.equal(published.data.targets[0].destinationId, publicationId);
  assert.equal(published.data.targets[0].authorId, 'editor-7');
  assert.equal(calls.filter(operation => operation === 'UfiHashnodePublish').length, 1);
  assert.equal(JSON.stringify(published.data).includes('verified-editor-key'), false);
});

test('Tumblr read-only connections can list blogs and require an explicit publishing upgrade after denied writes', { timeout: 30000 }, async t => {
  const calls = [];
  let refreshes = 0;
  const app = await createAppHarness({ connected: true, env: { TUMBLR_CLIENT_ID: 'tumblr-client', TUMBLR_CLIENT_SECRET: 'tumblr-secret' }, modules: {
    './publishing-http': { createPublishingHttp: () => ({ request: async (url, options) => {
      calls.push({ url, method: options.method || 'GET' });
      assert.equal(options.headers.Authorization, 'Bearer read-only-tumblr-token');
      if (url === 'https://api.tumblr.com/v2/user/info' && !options.method) return { status: 200, data: { response: { user: { blogs: [{ name: 'member-blog', title: 'Member blog', type: 'public' }] } } } };
      assert.equal(url, 'https://api.tumblr.com/v2/blog/member-blog/posts');
      assert.equal(options.method, 'POST');
      return { status: 403, data: { error: 'missing write scope; provider-secret-details' } };
    } }) },
  } });
  t.after(() => app.close());
  const user = member('tumblr-read-only-owner', { plan: 'pro', socialTokens: { tumblr: 'read-only-tumblr-token' }, socialRefreshTokens: { tumblr: 'synthetic-refresh-token' } });
  app.seedUser(user);
  app.setContentScreening(async ({ content }) => ({ allowed: true, content }));
  app.setTokenExchange(async () => { refreshes++; throw new Error('A publishing denial must not cause a write retry.'); });
  const authorization = await app.request('/auth/social/tumblr/start', { userId: user.id });
  assert.equal(authorization.status, 200);
  assert.equal(new URL(authorization.data.url).searchParams.get('scope'), 'basic offline_access');
  const destinations = await app.request('/command-center/cross-post/tumblr/destinations', { userId: user.id });
  assert.equal(destinations.status, 200);
  assert.equal(destinations.data.destinations[0].id, 'member-blog');
  const response = await app.request('/command-center/cross-post', { userId: user.id, method: 'POST', body: { content: 'A reviewed post', platforms: ['tumblr'], publisherSettings: { tumblr: { destinationId: 'member-blog' } } } });
  assert.equal(response.status, 200);
  assert.equal(response.data.targets[0].status, 'failed');
  assert.equal(response.data.targets[0].reconnectRequired, true);
  assert.equal(response.data.targets[0].deliveryUncertain, undefined);
  assert.match(response.data.targets[0].error, /Reconnect Tumblr and grant publishing access/);
  assert.equal(JSON.stringify(response.data).includes('provider-secret-details'), false);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(refreshes, 0);
  assert.deepEqual(calls.map(call => call.method), ['GET', 'GET', 'POST']);
});
