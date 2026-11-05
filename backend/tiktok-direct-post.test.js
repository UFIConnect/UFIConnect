const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./test-support/app-harness');

const env = { TIKTOK_CLIENT_KEY: 'synthetic-client', TIKTOK_CLIENT_SECRET: 'synthetic-secret', CLOUDINARY_CLOUD_NAME: 'synthetic-cloud' };
const creator = { creator_username: 'test_creator', creator_nickname: 'Test Creator',
  privacy_level_options: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'], comment_disabled: false };
const settings = { creatorUsername: creator.creator_username, privacyLevel: 'SELF_ONLY', consent: true, disableComment: true };
const photo = 'https://res.cloudinary.com/synthetic-cloud/image/upload/test.jpg';
const ok = data => ({ status: 200, data: { data, error: { code: 'ok' } } });

async function publisher(t, options = {}) {
  const app = await createAppHarness({ env, ...options });
  t.after(() => app.close());
  const user = member('tiktok-direct-owner', { plan: 'pro', socialTokens: { tiktok: 'synthetic-access' } });
  app.seedUser(user);
  const calls = [];
  app.setPostJSONWithMeta(async (url, body, headers) => {
    calls.push({ url, body, headers });
    return url.endsWith('/creator_info/query/') ? ok(creator) : ok({ publish_id: 'direct-post-id' });
  });
  return { app, user, calls, publish: extra => app.publishCrossPostTarget(user, 'tiktok', {
    content: 'My original photo', mediaUrl: photo, mediaType: 'image', tiktok: { ...settings }, ...extra,
  }) };
}

test('TikTok photo publishing uses DIRECT_POST with explicit creator, privacy and disclosure choices', async t => {
  const { publish, calls } = await publisher(t);
  const result = await publish({ tiktok: { ...settings, privacyLevel: 'PUBLIC_TO_EVERYONE', disableComment: false,
    autoAddMusic: true, isAigc: true, brandContent: true, brandOrganic: true } });
  assert.equal(result.status, 'processing');
  assert.equal(result.delivery, 'direct');
  assert.equal(result.publishId, 'direct-post-id');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /creator_info\/query\/$/);
  const post = calls[1];
  assert.equal(post.headers.Authorization, 'Bearer synthetic-access');
  assert.equal(post.body.post_mode, 'DIRECT_POST');
  assert.equal(post.body.media_type, 'PHOTO');
  assert.equal(post.body.post_info.privacy_level, 'PUBLIC_TO_EVERYONE');
  assert.equal(post.body.post_info.disable_comment, false);
  assert.equal(post.body.post_info.auto_add_music, true);
  assert.equal(post.body.post_info.brand_content_toggle, true);
  assert.equal(post.body.post_info.brand_organic_toggle, true);
  assert.equal(post.body.is_aigc, true);
  assert.equal(post.body.source_info.photo_images[0], photo);
});

test('TikTok never invents consent, privacy or interaction settings and blocks private paid partnerships', async t => {
  const { publish, calls } = await publisher(t);
  for (const tiktok of [null, {}, { ...settings, consent: false }, { ...settings, privacyLevel: '' },
    { ...settings, disableComment: undefined }, { ...settings, creatorUsername: 'another_creator' },
    { ...settings, privacyLevel: 'FOLLOWER_OF_CREATOR' }, { ...settings, brandContent: true }]) {
    const result = await publish({ tiktok });
    assert.equal(result.status, 'failed');
  }
  assert.equal(calls.some(call => call.url.endsWith('/content/init/')), false);
});

test('TikTok revalidates account comment restrictions immediately before sending', async t => {
  const { app, publish } = await publisher(t);
  const calls = [];
  app.setPostJSONWithMeta(async url => { calls.push(url); return ok({ ...creator, comment_disabled: true }); });
  const result = await publish({ tiktok: { ...settings, disableComment: false } });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /disabled comments/);
  assert.equal(calls.length, 1);
});

test('creator-info exposes only rendering fields and reports upload-only authorization as reconnect required', async t => {
  const { app, user, calls } = await publisher(t);
  const info = await app.request('/command-center/cross-post/tiktok/creator-info', { userId: user.id });
  assert.equal(info.status, 200);
  assert.equal(info.data.creator.creatorUsername, creator.creator_username);
  assert.equal(info.data.creator.creatorNickname, creator.creator_nickname);
  assert.deepEqual(info.data.creator.privacyLevelOptions, creator.privacy_level_options);
  assert.equal(info.data.creator.commentDisabled, false);
  assert.equal(info.headers.get('cache-control'), 'private, no-store');
  assert.equal(JSON.stringify(info.data).includes('synthetic-access'), false);
  app.setPostJSONWithMeta(async () => ({ status: 401, data: { error: { code: 'scope_not_authorized', message: 'Do not expose synthetic-secret' } } }));
  const denied = await app.request('/command-center/cross-post/tiktok/creator-info', { userId: user.id });
  assert.equal(denied.status, 409);
  assert.equal(denied.data.reconnectRequired, true);
  assert.match(denied.data.message, /Reconnect TikTok/);
  assert.equal(denied.data.message.includes('synthetic-secret'), false);
  assert.equal((await app.request('/command-center/cross-post/tiktok/creator-info')).status, 401);
  user.plan = 'free';
  assert.equal((await app.request('/command-center/cross-post/tiktok/creator-info', { userId: user.id })).status, 403);
  assert.equal(calls.length, 1);
});

test('TikTok rejects provider semantic errors and does not report an unconfirmed request as posted', async t => {
  const { app, publish } = await publisher(t);
  for (const response of [ok({}), { status: 200, data: { error: { code: 'spam_risk_too_many_posts' } } }]) {
    app.setPostJSONWithMeta(async url => url.endsWith('/creator_info/query/') ? ok(creator) : response);
    const result = await publish();
    assert.equal(result.status, 'failed');
  }
});

test('history sync tracks new direct processing and old inbox handoffs until provider confirmation', async t => {
  const rows = [{ id: 'direct-history', content: 'Test photo', media_url: photo, created_at: new Date().toISOString(),
    targets: [{ platform: 'tiktok', status: 'processing', delivery: 'direct', mediaType: 'image', publishId: 'direct-post-id' }] },
  { id: 'old-history', content: 'Old photo', targets: [{ platform: 'tiktok', status: 'handoff', publishId: 'old-upload-id' }] }];
  const { app, user } = await publisher(t, { connected: true,
    query: async sql => ({ rows: sql.includes('FROM cross_posts') ? rows : [], rowCount: 1 }),
  });
  let state = 'PROCESSING_DOWNLOAD';
  app.setPostJSONWithMeta(async (_url, body) => ok({ status: body.publish_id === 'old-upload-id' ? 'SEND_TO_USER_INBOX' : state,
    publicaly_available_post_id: ['123'], creator_username: creator.creator_username }));
  const pending = await app.request('/command-center/cross-post/sync', { userId: user.id, method: 'POST', body: {} });
  assert.equal(pending.status, 200);
  assert.equal(pending.data.posts[0].targets[0].status, 'processing');
  assert.equal(pending.data.posts[1].targets[0].status, 'handoff');
  state = 'PUBLISH_COMPLETE';
  const completed = await app.request('/command-center/cross-post/sync', { userId: user.id, method: 'POST', body: {} });
  assert.equal(completed.data.posts[0].targets[0].status, 'posted');
  assert.equal(completed.data.posts[0].targets[0].postedUrl, 'https://www.tiktok.com/@test_creator/photo/123');
  state = 'FAILED';
  const failed = await app.request('/command-center/cross-post/sync', { userId: user.id, method: 'POST', body: {} });
  assert.equal(failed.data.posts[0].targets[0].status, 'failed');
});

test('Cross-Post retains legacy and new destinations without truncation or duplicate TikTok delivery', async t => {
  const { app, user, calls } = await publisher(t, { connected: true });
  app.setContentScreening(async ({ content }) => ({ allowed: true, content }));
  const platforms = ['bluesky', 'reddit', 'twitter', 'linkedin', 'threads', 'instagram', 'tiktok', 'mastodon', 'github'];
  const payload = { content: 'An original photo', mediaUrl: photo, mediaType: 'image', platforms: [...platforms, 'tiktok', 'github'], tiktok: settings };
  const response = await app.request('/command-center/cross-post', { userId: user.id, method: 'POST', body: payload });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.targets.map(target => target.platform), platforms);
  assert.equal(response.data.targets.find(target => target.platform === 'tiktok').status, 'processing');
  const disconnected = response.data.targets.find(target => target.platform === 'github');
  assert.equal(disconnected.status, 'failed');
  assert.equal(disconnected.error, 'Not connected.');
  assert.equal(calls.filter(call => call.url.endsWith('/content/init/')).length, 1);
});

test('Bluesky requires a confirmed record for the connected account before reporting publication', async t => {
  const { app } = await publisher(t);
  const user = member('bluesky-publisher', { plan: 'pro', socialTokens: { bluesky: JSON.stringify({
    accessToken: 'synthetic-bsky', did: 'did:plc:author', pdsUrl: 'https://pds.example',
  }) } });
  for (const response of [{ status: 200, data: {} }, { status: 200, data: { uri: 'at://did:plc:other/app.bsky.feed.post/123' } },
    { status: 202, data: { uri: 'at://did:plc:author/app.bsky.feed.post/' } }]) {
    app.setPostJSONWithMeta(async () => response);
    assert.equal((await app.publishCrossPostTarget(user, 'bluesky', { content: 'Synthetic original text' })).status, 'failed');
  }
});
