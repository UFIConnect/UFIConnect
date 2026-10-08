'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createTwitchFeed, clipPost, streamPost, LOOKBACK_MS } = require('./twitch-feed');
const NOW = Date.parse('2026-10-08T18:00:00Z');
const channel = { id: '101', login: 'followed_creator', name: 'Followed Creator', category: 'Software and Game Development' };
const clip = (overrides = {}) => ({ id: 'RealClip-Ab12', broadcaster_id: channel.id, broadcaster_name: channel.name,
  creator_id: '222', creator_name: 'Clip Creator', url: 'https://clips.twitch.tv/RealClip-Ab12', title: 'Building a useful application',
  created_at: new Date(NOW - 60000).toISOString(), duration: 45.1, view_count: 123,
  thumbnail_url: 'https://clips-media-assets2.twitch.tv/test-preview.jpg', language: 'en', ...overrides });
const stream = (overrides = {}) => ({ id: '9001', user_id: channel.id, user_login: channel.login, user_name: channel.name,
  title: 'Building open source software', game_name: channel.category, started_at: new Date(NOW - 3600000).toISOString(),
  viewer_count: 120, is_mature: false, thumbnail_url: 'https://static-cdn.jtvnw.net/previews/live_user_test-{width}x{height}.jpg', ...overrides });
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return value; } });
function fixture({ config = { clientId: 'app-client-id', clientSecret: 'private-app-secret' }, handler = null } = {}) {
  const calls = [], control = { now: NOW, config, held: null, status: null };
  const feed = createTwitchFeed({ now: () => control.now, getConfig: () => control.config, fetcher: async (raw, options) => {
    const url = new URL(raw), call = { url, options }; calls.push(call);
    if (control.held) await control.held;
    if (handler) { const handled = await handler(call); if (handled) return handled; }
    if (url.hostname === 'id.twitch.tv') return response({ access_token: 'synthetic-app-token', expires_in: 3600 });
    if (control.status) return response({ message: 'raw sensitive provider diagnostic must stay private' }, control.status);
    if (url.pathname === '/helix/users') return response({ data: [{ id: '888' }] });
    if (url.pathname === '/helix/streams' || url.pathname === '/helix/streams/followed') return response({ data: [stream()] });
    if (url.pathname === '/helix/channels/followed') return response({ data: [{ broadcaster_id: channel.id, broadcaster_login: channel.login, broadcaster_name: channel.name }] });
    if (url.pathname === '/helix/clips') return response({ data: [clip()] });
    throw new Error('Unexpected endpoint');
  } });
  return { feed, control, calls };
}

test('clips preserve canonical identity, attribution, duration and views without inventing likes', () => {
  const result = clipPost(clip(), channel, NOW);
  assert.equal(result.id, 'twitch_clip_RealClip-Ab12');
  assert.equal(result.sourceUrl, 'https://clips.twitch.tv/RealClip-Ab12');
  assert.equal(result.mediaUrl, result.sourceUrl);
  assert.equal(result.sourceEmbedUrl, 'https://clips.twitch.tv/embed?clip=RealClip-Ab12');
  assert.equal(result.authorUrl, 'https://www.twitch.tv/followed_creator');
  assert.equal(result.videoDurationSeconds, 45.1);
  assert.equal(result.createdAt, clip().created_at);
  assert.equal(result.viewsCount, 123);
  assert.equal(result.likesCount, 0);
  assert.equal(result.visibility, 'public');
  assert.equal(streamPost(stream()).likesCount, 0);
  assert.equal(streamPost(stream()).viewsCount, 120);
  const channelPhoto = 'https://static-cdn.jtvnw.net/jtv_user_pictures/broadcaster.png';
  assert.equal(clipPost(clip(), { ...channel, profile_image_url: channelPhoto }, NOW).author.avatarUrl, channelPhoto);
  assert.equal(result.author.id, 'twitch_101');
  assert.equal(result.author.avatarUrl, undefined, 'The clip preview is never used as the broadcaster photo');
});

test('clips reject unrelated channels, forged links, unsupported durations and stale timestamps', () => {
  for (const overrides of [{ broadcaster_id: '202' }, { id: '../other' }, { url: 'https://attacker.invalid/RealClip-Ab12' },
    { url: 'https://clips.twitch.tv/WrongClip' }, { url: 'https://user@clips.twitch.tv/RealClip-Ab12' },
    { duration: 0 }, { duration: 181 }, { duration: null }, { created_at: new Date(NOW + 1).toISOString() },
    { created_at: new Date(NOW - LOOKBACK_MS).toISOString() }, { created_at: 'invalid' }]) {
    assert.equal(clipPost(clip(overrides), channel, NOW), null, JSON.stringify(overrides));
  }
  assert.equal(clipPost(clip({ duration: 180 }), channel, NOW).videoDurationSeconds, 180);
  assert.equal(clipPost(clip({ thumbnail_url: 'https://private.invalid/image' }), channel, NOW).mediaPoster, null);
});

test('public clips use only app credentials, omit mature channels and share cached requests across topic workers', async () => {
  const f = fixture({ handler: ({ url }) => url.pathname === '/helix/streams'
    ? response({ data: [stream(), stream({ user_id: '202', user_login: 'mature_creator', is_mature: true })] }) : null });
  const [first, concurrent] = await Promise.all([f.feed.publicClips(), f.feed.publicClips()]);
  assert.deepEqual(first, concurrent);
  assert.equal(first.length, 1);
  assert.equal(f.calls.length, 3);
  const tokenRequest = f.calls[0];
  assert.equal(tokenRequest.url.href, 'https://id.twitch.tv/oauth2/token');
  assert.equal(tokenRequest.options.method, 'POST');
  assert.equal(new URLSearchParams(tokenRequest.options.body).get('grant_type'), 'client_credentials');
  assert.equal(tokenRequest.url.href.includes('private-app-secret'), false);
  assert.ok(f.calls.slice(1).every(call => call.options.headers.Authorization === 'Bearer synthetic-app-token'));
  assert.equal(f.calls.at(-1).url.searchParams.get('broadcaster_id'), channel.id);
  assert.equal(JSON.stringify(first).includes('private-app-secret'), false);
  await f.feed.publicClips(); assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(call => call.options.redirect === 'error'));
});

test('Home retains public stream cards while Snaps reads only short clips, sharing the same provider inventory', async () => {
  const f = fixture({ handler: ({ url }) => url.pathname === '/helix/streams'
    ? response({ data: [stream(), stream({ id: '9002', user_id: '202', user_login: 'mature_creator', is_mature: true })] }) : null });
  const [home, snaps] = await Promise.all([f.feed.publicPosts(), f.feed.publicClips()]);
  assert.deepEqual(home.map(post => post.id), ['twitch_9001', 'twitch_clip_RealClip-Ab12']);
  assert.equal(home[0].mediaType, 'image');
  assert.equal(home[0].sourceUrl, 'https://www.twitch.tv/followed_creator');
  assert.equal(home[0].visibility, 'public');
  assert.equal(home[0].viewsCount, 120);
  assert.equal(home[0].likesCount, 0);
  assert.equal(home[0].videoDurationSeconds, undefined, 'A live stream is not labeled as a short clip');
  assert.deepEqual(snaps.map(post => post.id), ['twitch_clip_RealClip-Ab12']);
  assert.equal(f.calls.length, 3, 'Stream cards reuse the existing bounded public discovery response');
  assert.ok(f.calls.slice(1).every(call => call.options.headers.Authorization === 'Bearer synthetic-app-token'));
  assert.equal(f.calls.some(call => /\/followed$/.test(call.url.pathname)), false);
});

test('public ingestion remains idle until both app credentials are configured and never fills a personal feed', async () => {
  for (const config of [{}, { clientId: 'client' }, { clientSecret: 'secret' }]) {
    const f = fixture({ config }); assert.deepEqual(await f.feed.publicClips(), []); assert.deepEqual(await f.feed.publicPosts(), []); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); assert.deepEqual(await f.feed.following(null), []); assert.equal(f.calls.length, 0);
});

test('Following authenticates the current member, reads their followed channels and rejects unrelated returned clips', async () => {
  const f = fixture({ handler: ({ url }) => url.pathname === '/helix/clips'
    ? response({ data: [clip(), clip({ id: 'UnfollowedClip', broadcaster_id: '777', url: 'https://clips.twitch.tv/UnfollowedClip' })] }) : null });
  const posts = await f.feed.following('member-a-token', { userId: 'account-a' });
  assert.deepEqual(posts.map(post => post.id), ['twitch_9001', 'twitch_clip_RealClip-Ab12']);
  assert.ok(f.calls.every(call => call.url.hostname === 'api.twitch.tv' && call.options.headers.Authorization === 'Bearer member-a-token'));
  assert.deepEqual(f.calls.filter(call => /\/followed$/.test(call.url.pathname)).map(call => call.url.searchParams.get('user_id')), ['888', '888']);
  assert.equal(f.calls.some(call => call.url.pathname === '/helix/streams' || call.options.method === 'POST'), false);
  assert.equal(JSON.stringify(posts).includes('member-a-token'), false);
});

test('personal cache identities include the entire token and current UFI account, not a token suffix', async () => {
  const f = fixture();
  await f.feed.following('member-a-same-suffix', { userId: 'account-a' });
  const first = f.calls.length;
  await f.feed.following('member-a-same-suffix', { userId: 'account-a' }); assert.equal(f.calls.length, first);
  await f.feed.following('member-b-same-suffix', { userId: 'account-a' }); assert.equal(f.calls.length, first * 2);
  await f.feed.following('member-a-same-suffix', { userId: 'account-b' }); assert.equal(f.calls.length, first * 3);
});

test('provider denial and throttling produce useful safe errors without stale public or personal fallback', async () => {
  for (const [status, message] of [[401, /expired or was revoked/], [403, /user:read:follows/], [429, /rate limit/], [500, /temporarily unavailable/]]) {
    const f = fixture(); await f.feed.following('member-a-token', { userId: 'account-a' });
    f.control.status = status;
    await assert.rejects(f.feed.following('member-a-token', { userId: 'account-a', bust: true }), error => {
      assert.equal(error.status, status === 500 ? 503 : status); assert.match(error.message, message);
      assert.doesNotMatch(error.message, /diagnostic|member-a-token|private-app-secret/); return true;
    });
    assert.equal(f.calls.some(call => call.url.pathname === '/helix/streams' || call.url.hostname === 'id.twitch.tv'), false);
  }
});

test('public cache expires and app authorization is renewed after revocation or configuration changes', async () => {
  const f = fixture(); await f.feed.publicClips();
  f.control.now += 60 * 60000; f.control.status = 401;
  await assert.rejects(f.feed.publicClips(), { status: 401 });
  f.control.status = null;
  const before = f.calls.filter(call => call.url.hostname === 'id.twitch.tv').length;
  await f.feed.publicClips();
  assert.equal(f.calls.filter(call => call.url.hostname === 'id.twitch.tv').length, before + 1);
  f.control.config = { clientId: 'other-client', clientSecret: 'other-secret' };
  await f.feed.publicClips();
  assert.equal(f.calls.filter(call => call.url.hostname === 'id.twitch.tv').length, before + 2);
});

test('clip discovery stays within six public or three followed channels and eight clips per channel', async () => {
  const many = fixture({ handler: ({ url }) => {
    if (url.pathname === '/helix/streams') return response({ data: Array.from({ length: 50 }, (_, n) => stream({ user_id: String(n + 1), user_login: 'channel_' + n })) });
    if (url.pathname === '/helix/channels/followed') return response({ data: Array.from({ length: 150 }, (_, n) => ({ broadcaster_id: String(n + 1), broadcaster_login: 'channel_' + n })) });
    if (url.pathname === '/helix/clips') return response({ data: Array.from({ length: 30 }, (_, n) => clip({ id: 'Clip_' + url.searchParams.get('broadcaster_id') + '_' + n,
      broadcaster_id: url.searchParams.get('broadcaster_id'), url: 'https://clips.twitch.tv/Clip_' + url.searchParams.get('broadcaster_id') + '_' + n })) });
    return null;
  } });
  const publicPosts = await many.feed.publicClips(); assert.equal(publicPosts.length, 48);
  assert.equal(many.calls.filter(call => call.url.pathname === '/helix/clips').length, 6);
  many.calls.length = 0;
  const followed = await many.feed.following('personal-member-token', { userId: 'account' });
  assert.equal(followed.filter(post => post.id.startsWith('twitch_clip_')).length, 24);
  assert.equal(many.calls.filter(call => call.url.pathname === '/helix/clips').length, 3);
});

test('Snap photos use official broadcaster metadata with one cached app-token batch and no member identity substitution', async () => {
  let authorPhoto = 'https://static-cdn.jtvnw.net/jtv_user_pictures/broadcaster.png';
  const f = fixture({ handler: ({ url }) => url.pathname === '/helix/users' && (url.searchParams.has('id') || url.searchParams.has('login'))
    ? response({ data: [{ id: '101', login: channel.login, profile_image_url: authorPhoto, email: 'private-provider-email' },
      { id: '888', login: 'connected_viewer', profile_image_url: 'https://static-cdn.jtvnw.net/jtv_user_pictures/viewer.png' }] }) : null });
  const publicPosts = await f.feed.publicPosts();
  const selected = publicPosts.filter(post => post.mediaType === 'video').map(post => ({ ...post,
    author: { ...post.author, avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/expired-broadcaster.png' } }));
  const before = f.calls.length;
  const [first, concurrent] = await Promise.all([f.feed.hydrateAvatars(selected), f.feed.hydrateAvatars(selected)]);
  assert.deepEqual(first, concurrent); assert.equal(f.calls.length, before + 1);
  assert.equal(first[0].author.avatarUrl, authorPhoto); assert.equal(first[0].author.name, channel.name);
  assert.equal(first[0].clipCreator.id, '222');
  assert.equal(f.calls.at(-1).url.pathname, '/helix/users');
  assert.deepEqual(f.calls.at(-1).url.searchParams.getAll('id'), ['101']);
  assert.equal(f.calls.at(-1).options.headers.Authorization, 'Bearer synthetic-app-token');
  assert.doesNotMatch(JSON.stringify(first), /private-provider-email|synthetic-app-token|viewer\.png/);
  const stored = selected.map(post => ({ ...post, authorId: undefined, author: { name: post.author.name, profileUrl: post.author.profileUrl } }));
  assert.equal((await f.feed.hydrateAvatars(stored))[0].author.avatarUrl, authorPhoto);
  assert.equal(f.calls.length, before + 1, 'Known login alias reuses the broadcaster ID lookup');
  authorPhoto = 'https://static-cdn.jtvnw.net/jtv_user_pictures/current-broadcaster.png';
  f.control.now += 24 * 60 * 60000;
  assert.equal((await f.feed.hydrateAvatars(selected))[0].author.avatarUrl, authorPhoto);
  assert.equal(f.calls.filter(call => call.url.pathname === '/helix/users').length, 2, 'Profile metadata refreshes only after its cached day expires');
});

test('Snap avatar failures use negative caching and fixed proven profile identities without dropping media', async () => {
  const f = fixture({ handler: ({ url }) => url.pathname === '/helix/users' && url.searchParams.has('id')
    ? response({ message: 'private-provider-error' }, 429) : null });
  const selected = [clipPost(clip(), { ...channel, profile_image_url: 'https://static-cdn.jtvnw.net/jtv_user_pictures/prior.png' }, NOW)];
  assert.deepEqual(await f.feed.hydrateAvatars(selected), selected);
  const before = f.calls.length;
  assert.deepEqual(await f.feed.hydrateAvatars(selected), selected); assert.equal(f.calls.length, before);
  const forged = [{ source: 'twitch', author: { name: channel.id, profileUrl: 'https://twitch.tv.evil.invalid/' + channel.login } }];
  assert.deepEqual(await f.feed.hydrateAvatars(forged), forged); assert.equal(f.calls.length, before);
  const missing = fixture({ config: { clientId: 'client' } });
  assert.equal(await missing.feed.hydrateAvatars(selected), selected); assert.equal(missing.calls.length, 0);
});

test('missing official Twitch photos retain supplied broadcaster photos', async () => {
  const f = fixture({ handler: ({ url }) => url.pathname === '/helix/users' && url.searchParams.has('id')
    ? response({ data: [{ id: channel.id, login: channel.login, profile_image_url: '' }] }) : null });
  const selected = [clipPost(clip(), { ...channel, profile_image_url: 'https://static-cdn.jtvnw.net/jtv_user_pictures/prior.png' }, NOW)];
  assert.deepEqual(await f.feed.hydrateAvatars(selected), selected);
  const calls = f.calls.length;
  assert.deepEqual(await f.feed.hydrateAvatars(selected), selected); assert.equal(f.calls.length, calls);
});
