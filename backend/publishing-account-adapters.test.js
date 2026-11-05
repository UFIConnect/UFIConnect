'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountPublishingAdapters, VIDEO_MAX_BYTES } = require('./publishing-account-adapters');

function fixture(routes, extra = {}) {
  const calls = [];
  const request = async (url, options = {}) => {
    calls.push({ url, ...options });
    const key = `${options.method || 'GET'} ${url}`;
    const route = routes[key];
    assert.ok(route, `Unexpected provider request: ${key}`);
    if (typeof route === 'function') return route(options);
    return { status: 200, data: {}, ...route };
  };
  return { calls, adapters: createAccountPublishingAdapters({ env: { DISCORD_CLIENT_ID: '999999', TWITCH_CLIENT_ID: 'twitch-app' }, request, ...extra }) };
}
const githubBase = {
  'GET https://api.github.com/user': { data: { id: 7, login: 'member' } },
  'GET https://api.github.com/repos/member/project': { data: { id: 3, full_name: 'member/project', private: false, permissions: { push: true } } },
  'GET https://api.github.com/repos/member/project/git/ref/tags/v1.2.3': { data: { ref: 'refs/tags/v1.2.3', object: { sha: 'abc' } } },
  'GET https://api.github.com/repos/member/project/releases/tags/v1.2.3': { status: 404 },
};
const releaseInput = { content: 'A reviewed release', mediaUrl: 'https://res.cloudinary.com/test/image/upload/a.jpg', settings: { destinationId: 'member/project', title: 'Release 1.2.3', tagName: 'v1.2.3' } };

test('GitHub verifies public write access and an existing tag before creating an actual release', async () => {
  const { adapters, calls } = fixture({ ...githubBase,
    'POST https://api.github.com/repos/member/project/releases': options => {
      assert.deepEqual(options.json, { tag_name: 'v1.2.3', name: 'Release 1.2.3', body: 'A reviewed release\n\nhttps://res.cloudinary.com/test/image/upload/a.jpg', draft: false, prerelease: false, make_latest: 'false' });
      return { status: 201, data: { id: 99, draft: false, author: { id: 7 }, tag_name: 'v1.2.3', html_url: 'https://github.com/member/project/releases/tag/v1.2.3' } };
    },
  });
  const result = await adapters.github.publish('gh-token', releaseInput);
  assert.equal(result.status, 'posted');
  assert.equal(result.providerId, '99');
  assert.equal(result.destinationId, 'member/project');
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(calls[0].headers.Authorization, 'Bearer gh-token');
});

test('GitHub blocks private repositories and duplicate releases before any write', async () => {
  for (const override of [
    { 'GET https://api.github.com/repos/member/project': { data: { full_name: 'member/project', private: true, permissions: { push: true } } } },
    { 'GET https://api.github.com/repos/member/project/releases/tags/v1.2.3': { data: { id: 2 } } },
    { 'GET https://api.github.com/repos/member/project/git/ref/tags/v1.2.3': { status: 404 } },
  ]) {
    const { adapters, calls } = fixture({ ...githubBase, ...override });
    await assert.rejects(adapters.github.publish('token', releaseInput));
    assert.equal(calls.some(call => call.method === 'POST'), false);
  }
});

test('GitHub destinations exclude unwriteable sources and return existing tags without selecting one', async () => {
  const { adapters } = fixture({ ...githubBase,
    'GET https://api.github.com/user/repos?visibility=public&affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=1': { data: [
      { full_name: 'member/project', private: false, permissions: { push: true } },
      { full_name: 'other/private', private: true, permissions: { push: true } },
      { full_name: 'other/read-only', private: false, permissions: { push: false } },
    ] },
    'GET https://api.github.com/repos/member/project/tags?per_page=100': { data: [{ name: 'v1.2.3' }] },
  });
  const result = await adapters.github.destinations('token', { destinationId: 'member/project' });
  assert.deepEqual(result.destinations, [{ id: 'member/project', label: 'member/project' }]);
  assert.deepEqual(result.fields.find(field => field.key === 'tagName').options, [{ value: 'v1.2.3', label: 'v1.2.3' }]);
  assert.ok(result.fields.every(field => !Object.hasOwn(field, 'default')));
});

const gitlabBase = {
  'GET https://gitlab.com/api/v4/user': { data: { id: 7 } },
  'GET https://gitlab.com/api/v4/projects/12': { data: { id: 12, path_with_namespace: 'member/project' } },
  'GET https://gitlab.com/api/v4/projects/12/members/all/7': { data: { id: 7, access_level: 30 } },
  'GET https://gitlab.com/api/v4/projects/12/repository/tags/v1.2.3': { data: { name: 'v1.2.3', commit: { id: 'abc' } } },
  'GET https://gitlab.com/api/v4/projects/12/releases/v1.2.3': { status: 404 },
};
test('GitLab confirms membership and existing tag; release creation never creates a ref', async () => {
  const { adapters } = fixture({ ...gitlabBase,
    'POST https://gitlab.com/api/v4/projects/12/releases': options => {
      assert.equal(Object.hasOwn(options.json, 'ref'), false);
      assert.equal(options.json.tag_name, 'v1.2.3');
      return { status: 201, data: { tag_name: 'v1.2.3', author: { id: 7 }, _links: { self: 'https://gitlab.com/member/project/-/releases/v1.2.3' } } };
    },
  });
  const result = await adapters.gitlab.publish('token', { ...releaseInput, settings: { ...releaseInput.settings, destinationId: '12' } });
  assert.equal(result.status, 'posted');
  assert.equal(result.providerId, 'v1.2.3');
});
test('GitLab denies former member or nonexistent tag without a write', async () => {
  for (const override of [
    { 'GET https://gitlab.com/api/v4/projects/12/members/all/7': { data: { id: 7, access_level: 20 } } },
    { 'GET https://gitlab.com/api/v4/projects/12/repository/tags/v1.2.3': { status: 404 } },
    { 'GET https://gitlab.com/api/v4/projects/12/releases/v1.2.3': { data: { tag_name: 'v1.2.3' } } },
  ]) {
    const { adapters, calls } = fixture({ ...gitlabBase, ...override });
    await assert.rejects(adapters.gitlab.publish('token', { ...releaseInput, settings: { ...releaseInput.settings, destinationId: '12' } }));
    assert.equal(calls.some(call => call.method === 'POST'), false);
  }
});

test('repository release receipts must identify the connected author', async () => {
  const github = fixture({ ...githubBase, 'POST https://api.github.com/repos/member/project/releases': { status: 201, data: { id: 99, draft: false, tag_name: 'v1.2.3', author: { id: 100 } } } });
  await assert.rejects(github.adapters.github.publish('token', releaseInput), error => error.deliveryUncertain === true);
  const gitlab = fixture({ ...gitlabBase, 'POST https://gitlab.com/api/v4/projects/12/releases': { status: 201, data: { tag_name: 'v1.2.3', author: { id: 100 }, _links: { self: 'https://gitlab.com/member/project/-/releases/v1.2.3' } } } });
  await assert.rejects(gitlab.adapters.gitlab.publish('token', { ...releaseInput, settings: { ...releaseInput.settings, destinationId: '12' } }), error => error.deliveryUncertain === true);
});

const discordToken = { accessToken: 'discord-member-token', webhook: { id: '111111', token: 'secret-webhook-token', channel_id: '222222', guild_id: '333333' } };
const webhookUrl = 'https://discord.com/api/v10/webhooks/111111/secret-webhook-token';
const discordBase = {
  'GET https://discord.com/api/v10/users/@me': { data: { id: '444444' } },
  [`GET ${webhookUrl}`]: { data: { id: '111111', channel_id: '222222', guild_id: '333333', application_id: '999999', type: 1, name: 'UFIConnect' } },
};
test('Discord requires webhook reauthorization and never exposes its token in destinations', async () => {
  const { adapters, calls } = fixture(discordBase);
  await assert.rejects(adapters.discord.destinations('old-profile-only-token'), error => error.reconnectRequired === true);
  assert.equal(calls.length, 0);
  const result = await adapters.discord.destinations(JSON.stringify(discordToken));
  assert.equal(result.destinations[0].id, '222222');
  assert.ok(!JSON.stringify(result).includes('secret-webhook-token'));
  assert.ok(!JSON.stringify(result).includes('discord-member-token'));
});
test('Discord validates app and destination, disables mentions and waits for a real message', async () => {
  const { adapters } = fixture({ ...discordBase,
    [`POST ${webhookUrl}?wait=true`]: options => {
      assert.deepEqual(options.json.allowed_mentions, { parse: [] });
      assert.equal(options.json.content, '@everyone A reviewed announcement');
      return { status: 200, data: { id: '555555', channel_id: '222222' } };
    },
  });
  const result = await adapters.discord.publish(discordToken, { content: '@everyone A reviewed announcement', settings: { destinationId: '222222' } });
  assert.equal(result.postedUrl, 'https://discord.com/channels/333333/222222/555555');
  await assert.rejects(adapters.discord.publish(discordToken, { content: 'Hello', settings: { destinationId: '999999' } }));
  const wrongApp = fixture({ ...discordBase, [`GET ${webhookUrl}`]: { data: { ...discordBase[`GET ${webhookUrl}`].data, application_id: '888888' } } });
  await assert.rejects(wrongApp.adapters.discord.destinations(discordToken), error => error.reconnectRequired === true);
});
test('provider exceptions cannot leak webhook secrets into errors', async () => {
  const { adapters } = fixture({ ...discordBase,
    [`GET ${webhookUrl}`]: () => { throw new Error(`Request failed ${webhookUrl}`); },
  });
  await assert.rejects(adapters.discord.destinations(discordToken), error => !error.message.includes('secret-webhook-token'));
});

const twitchBase = { 'GET https://api.twitch.tv/helix/users': { data: { data: [{ id: '123', login: 'member', display_name: 'Member' }] } } };
test('Twitch chat is restricted to the current member channel and verifies actual send status', async () => {
  const { adapters, calls } = fixture({ ...twitchBase,
    'POST https://api.twitch.tv/helix/chat/messages': options => {
      assert.equal(options.headers['Client-Id'], 'twitch-app');
      assert.deepEqual(options.json, { broadcaster_id: '123', sender_id: '123', message: 'A chat message' });
      return { status: 200, data: { data: [{ is_sent: true, message_id: 'chat-123' }] } };
    },
  });
  await assert.rejects(adapters.twitch.publish('token', { content: 'Wrong channel', settings: { destinationId: '456' } }));
  assert.equal(calls.some(call => call.method === 'POST'), false);
  assert.equal((await adapters.twitch.publish('token', { content: 'A chat message', settings: { destinationId: '123' } })).status, 'posted');
  const dropped = fixture({ ...twitchBase, 'POST https://api.twitch.tv/helix/chat/messages': { data: { data: [{ is_sent: false, message_id: '', drop_reason: { message: 'banned' } }] } } });
  await assert.rejects(dropped.adapters.twitch.publish('token', { content: 'Hello', settings: { destinationId: '123' } }), /did not send/);
});

const figmaBase = {
  'GET https://api.figma.com/v1/me': { data: { id: 'member-7' } },
  'GET https://api.figma.com/v1/files/Abc123XYZ/comments': { data: { comments: [] } },
};
test('Figma verifies file comments access and current author before reporting a comment', async () => {
  const { adapters, calls } = fixture({ ...figmaBase,
    'POST https://api.figma.com/v1/files/Abc123XYZ/comments': { data: { id: 'comment-1', file_key: 'Abc123XYZ', user: { id: 'member-7' } } },
  });
  const result = await adapters.figma.publish('token', { content: 'Design handoff', settings: { destinationId: 'https://www.figma.com/design/Abc123XYZ/Design?node-id=0-1' } });
  assert.equal(result.status, 'posted');
  assert.equal(result.destinationId, 'Abc123XYZ');
  assert.equal(calls[1].url, 'https://api.figma.com/v1/files/Abc123XYZ/comments');
  const wrongAuthor = fixture({ ...figmaBase, 'POST https://api.figma.com/v1/files/Abc123XYZ/comments': { data: { id: '1', file_key: 'Abc123XYZ', user: { id: 'someone-else' } } } });
  await assert.rejects(wrongAuthor.adapters.figma.publish('token', { content: 'Hello', settings: { destinationId: 'Abc123XYZ' } }), /did not confirm/);
});
test('Figma rejects external URLs before calling any external host', async () => {
  const { adapters, calls } = fixture(figmaBase);
  await assert.rejects(adapters.figma.publish('token', { content: 'Hello', settings: { destinationId: 'https://evil.example/design/Abc123XYZ' } }));
  assert.equal(calls.some(call => !call.url.startsWith('https://api.figma.com/')), false);
  assert.equal(calls.some(call => call.method === 'POST'), false);
});

const youtubeBase = {
  'GET https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50': { data: { items: [{ id: 'UC-member', snippet: { title: 'Member channel' } }] } },
};
const youtubeInput = { content: 'The reviewed video description', mediaType: 'video', mediaUrl: 'https://res.cloudinary.com/test/video/upload/video.mp4', settings: { destinationId: 'UC-member', title: 'Reviewed video', privacyStatus: 'unlisted', madeForKids: 'no', notifySubscribers: true } };
const startUrl = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=true';
const uploadUrl = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc';
const statusUrl = 'https://www.googleapis.com/youtube/v3/videos?part=snippet,status,processingDetails&id=video123456';
test('YouTube requires explicit settings and uploads bounded video bytes; accepted upload stays processing', async () => {
  const { adapters, calls } = fixture({ ...youtubeBase,
    [`POST ${startUrl}`]: options => {
      assert.deepEqual(options.json, { snippet: { title: 'Reviewed video', description: 'The reviewed video description' }, status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false } });
      assert.equal(options.headers['X-Upload-Content-Length'], '5');
      return { status: 200, headers: { location: uploadUrl } };
    },
    [`PUT ${uploadUrl}`]: options => {
      assert.equal(options.body.toString(), 'video');
      assert.equal(options.headers['Content-Type'], 'video/mp4');
      return { status: 201, data: { id: 'video123456', snippet: { channelId: 'UC-member' }, status: { uploadStatus: 'uploaded' } } };
    },
  }, { downloadMedia: async (url, options) => {
    assert.equal(url, youtubeInput.mediaUrl);
    assert.deepEqual(options, { kind: 'video', maxBytes: VIDEO_MAX_BYTES });
    return { body: Buffer.from('video'), contentType: 'video/mp4' };
  } });
  const fields = (await adapters.youtube.destinations('token')).fields;
  assert.ok(fields.every(field => !Object.hasOwn(field, 'default')));
  const result = await adapters.youtube.publish('token', youtubeInput);
  assert.equal(result.status, 'processing');
  assert.equal(result.privacyStatus, 'unlisted');
  assert.equal(result.destinationId, 'UC-member');
  assert.equal(calls.filter(call => call.method === 'PUT').length, 1);
});
test('YouTube refuses missing visibility, audience, destination, and non-video before writes', async () => {
  for (const input of [
    { ...youtubeInput, settings: { ...youtubeInput.settings, privacyStatus: '' } },
    { ...youtubeInput, settings: { ...youtubeInput.settings, madeForKids: '' } },
    { ...youtubeInput, settings: { ...youtubeInput.settings, destinationId: 'another-channel' } },
    { ...youtubeInput, mediaType: 'image' },
  ]) {
    const { adapters, calls } = fixture(youtubeBase);
    await assert.rejects(adapters.youtube.publish('token', input));
    assert.equal(calls.some(call => call.method === 'POST' || call.method === 'PUT'), false);
  }
});
test('YouTube never forwards an access token or video to an untrusted resumable URL', async () => {
  for (const location of ['https://evil.example/upload/youtube/v3/videos', 'http://www.googleapis.com/upload/youtube/v3/videos', 'https://www.googleapis.com.evil.example/upload/youtube/v3/videos', 'https://www.googleapis.com:444/upload/youtube/v3/videos', 'https://www.googleapis.com/other']) {
    const { adapters, calls } = fixture({ ...youtubeBase, [`POST ${startUrl}`]: { headers: { location } } }, { downloadMedia: async () => ({ body: Buffer.from('video'), contentType: 'video/mp4' }) });
    await assert.rejects(adapters.youtube.publish('token', youtubeInput), /invalid upload session/);
    assert.equal(calls.some(call => call.method === 'PUT'), false);
  }
});
test('YouTube refuses oversized media returned by downloader', async () => {
  const { adapters, calls } = fixture(youtubeBase, { downloadMedia: async () => ({ body: Buffer.alloc(VIDEO_MAX_BYTES + 1), contentType: 'video/mp4' }) });
  await assert.rejects(adapters.youtube.publish('token', youtubeInput), error => error.status === 413);
  assert.equal(calls.some(call => call.method === 'POST'), false);
});
test('YouTube sync verifies owner, processing and requested visibility', async () => {
  const target = { providerId: 'video123456', destinationId: 'UC-member', privacyStatus: 'unlisted' };
  for (const [videoStatus, processingStatus, expected] of [
    ['uploaded', 'processing', 'processing'], ['processed', 'succeeded', 'posted'], ['failed', 'failed', 'failed'],
  ]) {
    const { adapters } = fixture({ ...youtubeBase, [`GET ${statusUrl}`]: { data: { items: [{ id: 'video123456', snippet: { channelId: 'UC-member' }, status: { uploadStatus: videoStatus, privacyStatus: 'unlisted' }, processingDetails: { processingStatus } }] } } });
    assert.equal((await adapters.youtube.sync('token', target)).status, expected);
  }
  const changed = fixture({ ...youtubeBase, [`GET ${statusUrl}`]: { data: { items: [{ id: 'video123456', snippet: { channelId: 'UC-member' }, status: { uploadStatus: 'processed', privacyStatus: 'private' } }] } } });
  assert.equal((await changed.adapters.youtube.sync('token', target)).status, 'handoff');
  const foreign = fixture({ ...youtubeBase, [`GET ${statusUrl}`]: { data: { items: [{ id: 'video123456', snippet: { channelId: 'UC-someone-else' }, status: { uploadStatus: 'processed', privacyStatus: 'unlisted' } }] } } });
  await assert.rejects(foreign.adapters.youtube.sync('token', target), /another channel/);
});

test('provider denied grants request reconnection without echoing provider errors', async () => {
  const { adapters } = fixture({ 'GET https://api.twitch.tv/helix/users': { status: 403, data: { error: 'token secret should not be exposed' } } });
  await assert.rejects(adapters.twitch.destinations('token'), error => error.status === 403 && error.reconnectRequired === true && !error.message.includes('secret'));
});

test('uncertain writes retain the duplicate-prevention flag without exposing transport details', async () => {
  for (const response of [
    () => { throw Object.assign(new Error('secret-token connection reset'), { deliveryUncertain: true }); },
    { status: 503, data: { message: 'provider temporarily unavailable' } },
    { status: 200, data: { data: [{ is_sent: true }] } },
  ]) {
    const { adapters } = fixture({ ...twitchBase, 'POST https://api.twitch.tv/helix/chat/messages': response });
    await assert.rejects(adapters.twitch.publish('token', { content: 'Hello', settings: { destinationId: '123' } }), error => error.deliveryUncertain === true && !error.message.includes('secret-token'));
  }
});
