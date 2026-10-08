'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createSourceApps, registerSourceAppRoutes, githubActivity, bookmarkCursor } = require('./source-apps');
const account = { id: 'alice', socialTokens: { github: 'ALICE_TOKEN' } };
const json = (data, headers = {}) => new Response(JSON.stringify(data), { headers });
function fixture(responses, options = {}) {
  const calls = [];
  const service = createSourceApps({ getAccount: async () => account, fetchImpl: async (url, init) => { calls.push({ url, init }); const value = responses.shift(); if (value instanceof Error) throw value; return value; }, ...options });
  return { ...service, calls };
}
test('GitHub stars are private authenticated reads with fixed origins and validated links', async () => {
  const mock = fixture([json({ login: 'alice' }), json([{ id: 1, full_name: 'team/project', html_url: 'https://github.com/team/project', description: 'Useful code' }, { id: 2, full_name: 'Unsafe', html_url: 'https://evil.example/' }], { link: '<https://api.github.com/user/starred?page=2>; rel="next"' })]);
  const result = await mock.load('alice', 'github');
  assert.equal(result.account, 'alice'); assert.equal(result.nextCursor, '2');
  assert.equal(result.items.length, 1); assert.equal(result.items[0].url, 'https://github.com/team/project');
  assert.ok(mock.calls.every(call => new URL(call.url).origin === 'https://api.github.com' && call.init.headers.Authorization === 'Bearer ALICE_TOKEN' && call.init.redirect === 'error' && !call.init.body));
  assert.ok(!JSON.stringify(result).includes('ALICE_TOKEN'));
});
test('GitHub activity counts only the authorizing actor, unique recent events and supported actions', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  const event = (id, type, extra = {}) => ({ id, type, actor: { login: 'alice' }, repo: { name: 'team/project' }, created_at: '2026-10-07T12:00:00Z', ...extra });
  const result = githubActivity([event('1', 'PushEvent'), event('2', 'PushEvent'), event('2', 'PushEvent'), event('3', 'IssuesEvent'), event('4', 'WatchEvent', { actor: { login: 'bob' } }), event('5', 'PushEvent', { created_at: '2026-08-01T12:00:00Z' }), event('6', 'PushEvent', { created_at: '2026-12-01T12:00:00Z' }), event('7', 'PushEvent', { repo: { name: '../escape' } })], 'alice', now);
  assert.deepEqual(result.actions.map(row => [row.id, row.count]), [['code', 2], ['issues', 1]]);
  assert.deepEqual(result.actions[0].items, [{ id: 'team/project', title: 'team/project', count: 2, url: 'https://github.com/team/project' }]);
  assert.match(result.scope, /100.*30 days/);
});
test('GitHub activity gets the connected identity from OAuth rather than a browser username', async () => {
  const mock = fixture([json({ login: 'alice' }), json([])]);
  const result = await mock.load('alice', 'github', '', 'activity');
  assert.equal(result.account, 'alice'); assert.deepEqual(result.actions, []);
  assert.equal(mock.calls[1].url, 'https://api.github.com/users/alice/events?per_page=100');
});
test('unsupported sources, disabled adapters, missing connections and invalid cursors never fetch', async () => {
  for (const [source, cursor, options, status] of [['indeed', '', {}, 422], ['github', '../2', {}, 400], ['github', '1001', {}, 400], ['github', '', { env: { SOURCE_GITHUB_ENABLED: 'false' } }, 403], ['github', '', { getAccount: async () => ({ socialTokens: {} }) }, 403]]) {
    const mock = fixture([], options);
    await assert.rejects(mock.load('alice', source, cursor), error => error.status === status);
    assert.equal(mock.calls.length, 0);
  }
});
test('disconnect during a provider read prevents a late private response', async () => {
  let reads = 0;
  const mock = fixture([json({ login: 'alice' }), json([])], { getAccount: async () => ++reads === 1 ? account : { socialTokens: {} } });
  await assert.rejects(mock.load('alice', 'github'), /connection changed/);
});
test('an expired OAuth token refreshes once, then uses the new token and checks current authorization', async () => {
  let token = 'OLD'; let refreshes = 0;
  const mock = fixture([new Response('', { status: 401 }), json({ login: 'alice' }), json([])], { getAccount: async () => ({ socialTokens: { github: token } }), refreshToken: async () => { refreshes++; token = 'NEW'; return token; } });
  await mock.load('alice', 'github');
  assert.equal(refreshes, 1); assert.equal(mock.calls[0].init.headers.Authorization, 'Bearer OLD'); assert.equal(mock.calls[1].init.headers.Authorization, 'Bearer NEW');
});
test('provider response bodies never become public errors', async () => {
  const mock = fixture([new Response('ALICE_TOKEN private-provider-error', { status: 403 })]);
  await assert.rejects(mock.load('alice', 'github'), error => !error.message.includes('ALICE_TOKEN') && error.status === 403);
});
test('Mastodon scopes are enforced and sensitive bookmarks preserve warnings without exposing content', async () => {
  const calls = [], token = scope => JSON.stringify({ origin: 'https://mastodon.social', accessToken: 'PRIVATE', accountId: '1', scope });
  const options = { getAccount: async () => ({ socialTokens: { mastodon: token('read:bookmarks') } }), mastodonService: { json: async (...args) => { calls.push(args); return { data: [{ id: '1', content: '<p>Private visible text</p>', sensitive: true, spoiler_text: 'Content warning', url: 'https://mastodon.social/@alice/1' }], headers: { link: '<https://mastodon.social/api/v1/bookmarks?max_id=9>; rel="next"' } }; } } };
  const result = await createSourceApps(options).load('alice', 'mastodon');
  assert.equal(result.items[0].title, 'Content warning'); assert.ok(!JSON.stringify(result).includes('Private visible text')); assert.equal(result.nextCursor, '9');
  assert.equal(calls[0][2].includeResponse, true);
  await assert.rejects(createSourceApps({ ...options, getAccount: async () => ({ socialTokens: { mastodon: token('read:statuses') } }) }).load('alice', 'mastodon'), /read access to bookmarks/);
  assert.equal(calls.length, 1);
  assert.equal(bookmarkCursor('<https://evil.example/api/v1/bookmarks?max_id=2>; rel="next"', 'https://mastodon.social'), null);
});
test('YouTube requests only authorized playlists, never viewing history or Watch Later', async () => {
  const mock = fixture([json({ items: [{ snippet: { title: 'Member channel' } }] }), json({ items: [{ id: 'PL_safe', snippet: { title: 'My videos' } }], nextPageToken: 'page2' })], { getAccount: async () => ({ socialTokens: { youtube: 'YT_TOKEN' } }) });
  const result = await mock.load('alice', 'youtube');
  assert.equal(result.account, 'Member channel'); assert.equal(result.items[0].url, 'https://www.youtube.com/playlist?list=PL_safe');
  assert.ok(mock.calls.every(call => new URL(call.url).hostname === 'www.googleapis.com' && !/history|watchlater/i.test(call.url)));
  await assert.rejects(mock.load('alice', 'youtube', '', 'activity'), error => error.status === 422);
});
test('Twitch follows use the OAuth account ID and app identity', async () => {
  const mock = fixture([json({ data: [{ id: '42', login: 'alice' }] }), json({ data: [{ broadcaster_id: '5', broadcaster_name: 'Streamer', broadcaster_login: 'streamer' }], pagination: { cursor: 'page2' } })], { env: { TWITCH_CLIENT_ID: 'APP_ID' }, getAccount: async () => ({ socialTokens: { twitch: 'TW_TOKEN' } }) });
  const result = await mock.load('alice', 'twitch');
  assert.equal(result.items[0].url, 'https://www.twitch.tv/streamer');
  assert.ok(mock.calls[1].url.includes('user_id=42')); assert.ok(mock.calls.every(call => call.init.headers['Client-Id'] === 'APP_ID'));
});
test('favorites routes require sign-in, ignore browser account identifiers and set no-store', async () => {
  const app = express(); let requestedUser;
  registerSourceAppRoutes(app, { authenticate: (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.user = { id: 'alice' }; next(); }, limiter: (_req, _res, next) => next(), getAccount: async id => { requestedUser = id; return account; }, fetchImpl: async url => json(url.endsWith('/user') ? { login: 'alice' } : []) });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/social/apps/github/favorites?userId=bob&password=IGNORED`;
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, { headers: { Authorization: 'test-session' } });
    assert.equal(response.status, 200); assert.equal(requestedUser, 'alice'); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.ok(!JSON.stringify(await response.json()).includes('IGNORED'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
