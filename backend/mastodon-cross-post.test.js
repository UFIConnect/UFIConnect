const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createAppHarness, member } = require('./test-support/app-harness');
const mastodon = require('./mastodon-oauth');

const origin = 'https://member.example';
const published = { id: '888', url: `${origin}/@member/888`, account: { id: '42' }, visibility: 'private' };
const draft = { content: 'A useful update', crossPostId: 'xp_durable_001' };
function session(scope = mastodon.MASTODON_SCOPES) {
  return JSON.stringify({ origin, accessToken: 'synthetic-token', accountId: '42', scope });
}
async function publisher(t, options = {}) {
  const calls = [];
  const state = { maxCharacters: 500, account: { id: '42', source: { privacy: 'private' } }, created: published };
  const service = { json: async (server, path, request) => {
    calls.push({ origin: server, path, options: request });
    assert.equal(server, origin);
    if (path === '/api/v2/instance') {
      if (state.metadataError) throw state.metadataError;
      return { configuration: { statuses: { max_characters: state.maxCharacters } } };
    }
    assert.equal(request.token, 'synthetic-token');
    if (path === '/api/v1/accounts/verify_credentials') {
      if (state.accountError) throw state.accountError;
      return state.account;
    }
    assert.equal(path, '/api/v1/statuses');
    if (state.publishError) throw state.publishError;
    options.beforePublish?.(request);
    return state.created;
  } };
  const app = await createAppHarness({ ...options,
    modules: { './mastodon-oauth': { ...mastodon, createMastodonService: () => service } },
  });
  t.after(() => app.close());
  const owner = member('mastodon-publisher', { plan: 'pro', socialTokens: { mastodon: session() } });
  app.seedUser(owner);
  return { app, owner, state, calls,
    publish: extra => app.publishCrossPostTarget(owner, 'mastodon', { ...draft, ...extra }),
    writes: () => calls.filter(call => call.path === '/api/v1/statuses'),
  };
}

test('Mastodon CrossPost preserves current privacy, complete media link and durable retry identity', async t => {
  const { app, owner, state, calls, publish, writes } = await publisher(t);
  const mediaUrl = 'https://res.cloudinary.com/example/image/upload/asset.jpg';
  assert.equal((await publish({ mediaUrl })).postedUrl, published.url);
  assert.equal((await publish({ mediaUrl })).status, 'posted');
  const [first, retry] = writes();
  assert.equal(first.options.form.status, `${draft.content}\n\n${mediaUrl}`);
  assert.equal(first.options.form.visibility, 'private');
  assert.deepEqual(Object.keys(first.options.form).sort(), ['status', 'visibility']);
  const expected = crypto.createHash('sha256').update(`${owner.id}:mastodon:${draft.crossPostId}`).digest('hex');
  assert.equal(first.options.idempotencyKey, expected);
  assert.equal(retry.options.idempotencyKey, expected);
  assert.equal(calls.filter(call => call.path === '/api/v2/instance').length, 1);
  assert.equal(calls.filter(call => call.path === '/api/v1/accounts/verify_credentials').length, 2);
  for (const visibility of ['public', 'unlisted', 'direct']) {
    state.account.source = { privacy: visibility, sensitive: true };
    state.created = { ...published, visibility };
    assert.equal((await publish({ crossPostId: `xp_${visibility}` })).status, 'posted');
    assert.equal(writes().at(-1).options.form.visibility, visibility);
    assert.equal(writes().at(-1).options.form.sensitive, 'true');
    assert.notEqual(writes().at(-1).options.idempotencyKey, expected);
  }
  const catalog = await app.request('/social/platforms', { userId: owner.id });
  assert.equal(catalog.data.platforms.mastodon.crossPost.supported, true);
  assert.equal(catalog.data.platforms.mastodon.crossPost.media, 'link');
});

test('Mastodon publishing requires both account-read and status-write grants', async t => {
  const { app, owner, calls, publish } = await publisher(t);
  for (const scope of ['read:accounts read:statuses', 'write:statuses', 'read:accounts write:favourites', '']) {
    owner.socialTokens.mastodon = session(scope);
    const result = await publish();
    assert.equal(result.status, 'failed');
    assert.equal(result.reconnectRequired, true);
    assert.match(result.error, /Reconnect Mastodon/);
    const catalog = await app.request('/social/platforms', { userId: owner.id });
    assert.equal(catalog.data.platforms.mastodon.crossPost.reconnectRequired, true);
  }
  assert.equal(calls.length, 0);
  owner.socialTokens.mastodon = session('read write');
  assert.equal((await publish()).status, 'posted');
});

test('Mastodon rejects missing delivery identity and overlong complete text before writing', async t => {
  const { state, calls, publish, writes } = await publisher(t);
  assert.match((await publish({ crossPostId: null })).error, /history must be prepared/);
  assert.equal(calls.length, 0);
  state.maxCharacters = 80;
  const mediaUrl = 'https://example.org/media.jpg';
  const tooLong = await publish({ content: 'x'.repeat(80 - mediaUrl.length - 1), mediaUrl });
  assert.equal(tooLong.status, 'failed');
  assert.match(tooLong.error, /including its media link, within 80 characters/);
  assert.equal(writes().length, 0);
  const exact = await publish({ content: 'x'.repeat(80 - mediaUrl.length - 2), mediaUrl });
  assert.equal(exact.status, 'posted');
  assert.equal(Array.from(writes()[0].options.form.status).length, 80);
  assert.equal((await publish({ content: '💬'.repeat(80) })).status, 'posted');
  assert.equal((await publish({ content: '💬'.repeat(81) })).status, 'failed');
  assert.equal(writes().length, 2);
});

test('Mastodon fails safely when account identity or default privacy cannot be confirmed', async t => {
  const { state, publish, writes } = await publisher(t);
  for (const account of [null, { id: 'other', source: { privacy: 'private' } }, { id: '42' }, { id: '42', source: { privacy: 'invalid' } }]) {
    state.account = account;
    const result = await publish();
    assert.equal(result.status, 'failed');
    assert.equal(result.postedUrl, undefined);
    assert.match(result.error, /Reconnect Mastodon|default post privacy/);
  }
  assert.equal(writes().length, 0);
});

test('Mastodon accepts success only with its own created status ID, URL, account and privacy', async t => {
  const { state, publish } = await publisher(t);
  for (const created of [null, {}, { ...published, id: '../888' }, { ...published, url: `${origin}/@member/999` },
    { ...published, url: 'https://other.example/@member/888' }, { ...published, url: `${origin}/@member` },
    { ...published, account: { id: 'other' } }, { ...published, visibility: 'public' },
    { ...published, error: 'rejected' }, { ...published, scheduled_at: 'tomorrow' }, { ...published, reblog: published }]) {
    state.created = created;
    const result = await publish();
    assert.equal(result.status, 'failed');
    assert.equal(result.postedUrl, undefined);
    assert.match(result.error, /did not confirm a created post/);
  }
});

test('Mastodon authentication failures request reconnection for account checks and publishing', async t => {
  const { state, publish, writes } = await publisher(t);
  for (const step of ['accountError', 'publishError']) {
    for (const status of [401, 403]) {
      state[step] = Object.assign(new Error('synthetic-provider-secret'), { status });
      const result = await publish();
      assert.equal(result.status, 'failed');
      assert.equal(result.reconnectRequired, true);
      assert.match(result.error, /Reconnect Mastodon/);
      assert.equal(result.error.includes('secret'), false);
    }
    state[step] = null;
  }
  assert.equal(writes().length, 2);
  state.publishError = Object.assign(new Error('synthetic-provider-secret'), { status: 422 });
  assert.match((await publish()).error, /Mastodon rejected this post/);
});

test('CrossPost persists the delivery ID before Mastodon sends and returns independent target results', async t => {
  let savedId, failInsert = false;
  const { app, owner, writes } = await publisher(t, { connected: true,
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO cross_posts')) {
        if (failInsert) throw new Error('synthetic storage failure');
        savedId = params[0];
        assert.equal(JSON.parse(params[4])[0].status, 'processing');
      }
      return { rows: [], rowCount: 1 };
    },
    beforePublish: request => {
      assert.ok(savedId);
      assert.equal(request.idempotencyKey, crypto.createHash('sha256').update(`mastodon-publisher:mastodon:${savedId}`).digest('hex'));
    },
  });
  app.setContentScreening(async ({ content }) => ({ allowed: true, content }));
  const request = { userId: owner.id, method: 'POST', body: { content: draft.content, platforms: ['mastodon', 'facebook'] } };
  const response = await app.request('/command-center/cross-post', request);
  assert.equal(response.status, 200);
  assert.equal(response.data.id, savedId);
  assert.equal(response.data.targets[0].status, 'posted');
  assert.equal(response.data.targets[1].status, 'unsupported');
  assert.equal(response.data.historySaved, true);
  failInsert = true;
  const failed = await app.request('/command-center/cross-post', request);
  assert.equal(failed.status, 503);
  assert.match(failed.data.message, /Nothing was sent/);
  assert.equal(writes().length, 1);
});
