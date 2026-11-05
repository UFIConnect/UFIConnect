const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const express = require('express');
const { createSourceInteractions, parseTarget, registerSourceInteractionRoutes } = require('./source-interactions');
const { MASTODON_SCOPES, mastodonPostUrl, mastodonCanReadStatuses, mastodonCanInteract, createMastodonService } = require('./mastodon-oauth');

const remoteUrl = 'https://remote.example/@author/123';
const localStatus = { id: '987', url: remoteUrl, uri: 'https://remote.example/users/author/statuses/123', visibility: 'public', favourites_count: 4 };
const user = { id: 'ufi-member', socialTokens: { mastodon: JSON.stringify({ origin: 'https://member.example', accountId: '42', accessToken: 'member-secret', scope: MASTODON_SCOPES }) } };
function transport(responses) {
  const calls = [];
  const mastodonService = { json: async (origin, path, options) => {
    calls.push({ origin, path, options });
    const result = responses.shift();
    if (result instanceof Error) throw result;
    return result;
  } };
  return { mastodonService, calls };
}
const args = { user, source: 'mastodon', sourceUrl: remoteUrl };

test('Mastodon status links preserve canonical identity and reject profiles or unsafe links', () => {
  assert.equal(mastodonPostUrl(remoteUrl + '?ref=feed#reply'), remoteUrl);
  assert.equal(mastodonPostUrl(localStatus.uri), remoteUrl);
  assert.deepEqual(parseTarget('mastodon', remoteUrl), { id: remoteUrl, url: remoteUrl, comment: true });
  for (const url of ['https://remote.example/@author', 'http://remote.example/@author/123', 'https://user:secret@remote.example/@author/123', 'https://127.0.0.1/@author/123', 'https://private.internal/@author/123', 'https://remote.example:443/@author/123', 'https://remote.example/@author/123/another', 'https://remote.example/@author/123%2f456', 'https://remote.example\\@evil.example/@author/123']) assert.equal(mastodonPostUrl(url), null, url);
});

test('Mastodon read grants keep feeds available but cannot perform writes', async () => {
  const readonly = JSON.stringify({ scope: 'read:accounts read:statuses' });
  assert.equal(mastodonCanReadStatuses(readonly), true);
  assert.equal(mastodonCanInteract(readonly), false);
  assert.equal(mastodonCanInteract(JSON.stringify({ scope: 'read write' })), true);
  assert.equal(mastodonCanInteract(JSON.stringify({ scope: 'write:favourites' }), 'like'), false);
  const mock = transport([]), { perform } = createSourceInteractions(mock);
  await assert.rejects(perform({ ...args, user: { socialTokens: { mastodon: readonly } }, action: 'like', liked: true }), /Reconnect Mastodon/);
  assert.equal(mock.calls.length, 0);
});

test('Mastodon favourite resolves remote URL to member server ID and returns confirmed counts', async () => {
  const mock = transport([{ statuses: [localStatus] }, { ...localStatus, favourited: true, favourites_count: 5 }, { statuses: [localStatus] }, { ...localStatus, favourited: false }]);
  const { perform } = createSourceInteractions(mock);
  assert.deepEqual(await perform({ ...args, action: 'like', liked: true }), { liked: true, likesCount: 5 });
  assert.deepEqual(await perform({ ...args, action: 'like', liked: false }), { liked: false, likesCount: 4 });
  const query = new URL(mock.calls[0].path, 'https://member.example');
  assert.equal(query.searchParams.get('q'), remoteUrl);
  assert.equal(query.searchParams.get('resolve'), 'true');
  assert.equal(mock.calls[1].path, '/api/v1/statuses/987/favourite');
  assert.equal(mock.calls[3].path, '/api/v1/statuses/987/unfavourite');
  assert.deepEqual(mock.calls[1].options.form, {});
  assert.ok(mock.calls.every(call => call.origin === 'https://member.example' && call.options.token === 'member-secret'));
});

test('Mastodon rejects mismatched search results and unconfirmed writes', async () => {
  for (const status of [{ ...localStatus, url: 'https://remote.example/@author/999', uri: null }, { ...localStatus, id: '../123' }, { ...localStatus, reblog: localStatus }]) {
    const mock = transport([{ statuses: [status] }]);
    await assert.rejects(createSourceInteractions(mock).perform({ ...args, action: 'like', liked: true }), /exact post/);
    assert.equal(mock.calls.length, 1);
  }
  for (const result of [{ ...localStatus, favourited: false }, { ...localStatus, id: '123', favourited: true }, { ...localStatus, url: 'https://remote.example/@author/999', uri: null, favourited: true }]) {
    const mock = transport([{ statuses: [localStatus] }, result]);
    await assert.rejects(createSourceInteractions(mock).perform({ ...args, action: 'like', liked: true }), /did not confirm this favourite/);
  }
});

test('Mastodon replies preserve visibility and warning while reusing a stable idempotency key', async () => {
  const parent = { ...localStatus, visibility: 'unlisted', sensitive: true, spoiler_text: 'Content warning' };
  const reply = { id: '888', in_reply_to_id: '987', account: { id: '42' }, url: 'https://member.example/@member/888' };
  const mock = transport([{ statuses: [parent] }, reply, { statuses: [parent] }, reply]);
  const { perform } = createSourceInteractions(mock);
  const request = { ...args, action: 'comment', content: 'A reply', requestId: 'mastodon-reply-0001' };
  assert.deepEqual(await perform(request), { commentId: '888', commentUrl: reply.url });
  await perform(request);
  assert.deepEqual(mock.calls[1].options.form, { status: 'A reply', in_reply_to_id: '987', visibility: 'unlisted', sensitive: 'true', spoiler_text: 'Content warning' });
  assert.match(mock.calls[1].options.idempotencyKey, /^[a-f0-9]{64}$/);
  assert.equal(mock.calls[1].options.idempotencyKey, mock.calls[3].options.idempotencyKey);
  assert.equal(mock.calls[1].path, '/api/v1/statuses');
});

test('Mastodon provider failures remain sanitized and reply mismatches are not success', async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    const mock = transport([Object.assign(new Error('PROVIDER-SECRET'), { status })]);
    await assert.rejects(createSourceInteractions(mock).perform({ ...args, action: 'like', liked: true }), error => error.status === ([401, 403].includes(status) ? 403 : status === 500 ? 502 : status) && !error.message.includes('SECRET'));
  }
  for (const reply of [{ id: '888', in_reply_to_id: '123', account: { id: '42' } }, { id: '888', in_reply_to_id: '987', account: { id: 'other' } }]) {
    const mock = transport([{ statuses: [localStatus] }, reply]);
    await assert.rejects(createSourceInteractions(mock).perform({ ...args, action: 'comment', content: 'Reply', requestId: 'mastodon-reply-0002' }), /did not confirm the reply/);
  }
});

test('safe Mastodon transport sends empty forms as POST, pins DNS and forwards only the idempotency header', async () => {
  let sent;
  const lookup = () => {};
  const service = createMastodonService({ resolveAddress: async hostname => { assert.equal(hostname, 'member.example'); return '93.184.216.34'; }, pinnedLookup: address => { assert.equal(address, '93.184.216.34'); return lookup; }, request: (url, options, callback) => {
    const req = new EventEmitter();
    req.end = body => { sent = { url, options, body }; queueMicrotask(() => { const res = new EventEmitter(); res.statusCode = 200; callback(res); res.emit('data', Buffer.from('{"ok":true}')); res.emit('end'); req.emit('close'); }); };
    return req;
  } });
  assert.deepEqual(await service.json('https://member.example', '/api/v1/statuses/987/favourite', { token: 'member-secret', form: {}, idempotencyKey: 'mastodon-request-001' }), { ok: true });
  assert.equal(sent.url.origin, 'https://member.example');
  assert.equal(sent.options.method, 'POST');
  assert.equal(sent.options.lookup, lookup);
  assert.equal(sent.options.agent, false);
  assert.equal(sent.options.headers['Content-Length'], 0);
  assert.equal(sent.options.headers['Idempotency-Key'], 'mastodon-request-001');
  for (const path of ['//evil.example/path', '/\\evil.example/path', 'https://evil.example/path', '/\r\nHost: evil.example']) await assert.rejects(service.json('https://member.example', path, { token: 'member-secret' }), /Invalid Mastodon API path/);
  await assert.rejects(service.json('https://member.example', '/api/v1/statuses', { form: {}, idempotencyKey: 'x\r\nEvil: header' }), /Invalid Mastodon request identity/);
});

test('Mastodon route passes reply identity through moderation and deduplicates repeated submissions', async t => {
  const mock = transport([{ statuses: [localStatus] }, { id: '888', in_reply_to_id: '987', account: { id: '42' } }]);
  const app = express(); app.use(express.json());
  registerSourceInteractionRoutes(app, { ...mock, policyEnv: {}, authenticate: (req, _res, next) => { req.user = { id: user.id }; next(); }, limiter: (_req, _res, next) => next(), getUser: async () => user,
    screenMemberContent: async ({ content }) => ({ allowed: true, content }) });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const body = { source: 'mastodon', sourceUrl: remoteUrl, action: 'comment', content: 'Reply', requestId: 'mastodon-route-0001' };
  const send = () => fetch(`http://127.0.0.1:${server.address().port}/social/interactions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 200);
  assert.equal(mock.calls.length, 2);
  assert.match(mock.calls[1].options.idempotencyKey, /^[a-f0-9]{64}$/);
});
