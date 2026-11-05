'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { publishingContext } = require('./publishing-context');
const { createAppHarness, member } = require('./test-support/app-harness');

test('suggestions use only currently verified choices and actual successful receipts, without supplying publication consent', () => {
  const fields = [
    { key: 'privacyStatus', required: true, type: 'select', options: [{ value: 'public' }, { value: 'private' }] },
    { key: 'madeForKids', required: true, type: 'select', options: [{ value: 'yes' }, { value: 'no' }] },
    { key: 'consent', required: true, type: 'checkbox' },
  ];
  const result = publishingContext('youtube', {
    account: { id: 'UC-owner', label: 'Actual channel', handle: '@owner', accessToken: 'private-provider-token' },
    destinations: [{ id: 'UC-owner', label: 'Actual channel' }, { id: 'UC-second', label: 'Other owned channel' }], fields,
  }, [
    { created_at: '2026-11-04T12:00:00Z', targets: [{ platform: 'youtube', status: 'posted', destinationId: 'UC-removed' }] },
    { created_at: '2026-11-03T12:00:00Z', targets: [{ platform: 'youtube', status: 'processing', destinationId: 'UC-owner' }] },
    { created_at: '2026-11-02T12:00:00Z', targets: JSON.stringify([{ platform: 'youtube', status: 'posted', destinationId: 'UC-second', privacyStatus: 'public', settings: { madeForKids: 'yes' } }]) },
  ]);
  assert.deepEqual(result.suggestedValues, { destinationId: 'UC-second' });
  assert.deepEqual(result.context.account, { id: 'UC-owner', label: 'Actual channel', handle: '@owner' });
  assert.deepEqual(result.context.usage, { source: 'uficonnect-publishing-history', lastSuccessfulAt: '2026-11-02T12:00:00.000Z' });
  assert.equal(result.context.recommendation, 'last_successful_destination');
  assert.deepEqual(result.fields, fields);
  assert.equal(result.account, undefined);
  assert.ok(!JSON.stringify(result).includes('private-provider-token'));
});

test('a sole verified choice needs no invented usage; absent or custom-only choices never inherit access from history', () => {
  const history = [{ targets: [{ platform: 'figma', status: 'posted', destinationId: 'formerly-accessible-file' }] }];
  const sole = publishingContext('figma', { destinations: [{ id: 'current-file', label: 'Verified current file' }] }, history);
  assert.deepEqual(sole.suggestedValues, { destinationId: 'current-file' });
  assert.equal(sole.context.recommendation, 'only_verified_destination');
  assert.equal(sole.context.usage, undefined);
  const none = publishingContext('figma', { destinations: [], allowCustomDestination: true }, history);
  assert.deepEqual(none.suggestedValues, {});
  assert.equal(none.context.recommendation, null);
  for (const targets of [null, 'not-json', {}, [{ platform: 'youtube', status: 'posted', destinationId: 'one' }]]) {
    const unchanged = publishingContext('github', { destinations: [{ id: 'one' }, { id: 'two' }] }, [{ targets }]);
    assert.deepEqual(unchanged.suggestedValues, {});
    assert.equal(unchanged.context.usage, undefined);
  }
});

test('real destination reads combine the authenticated provider identity with only the current member history', async t => {
  const calls = [], historyReaders = [];
  const history = new Map([
    ['context-owner', [{ targets: [{ platform: 'github', status: 'posted', destinationId: 'member/second' }], created_at: '2026-11-03T12:00:00Z' }]],
    ['context-other', [{ targets: [{ platform: 'github', status: 'posted', destinationId: 'not-accessible/old' }], created_at: '2026-11-04T12:00:00Z' }]],
  ]);
  const app = await createAppHarness({ connected: true,
    env: { GITHUB_CLIENT_ID: 'context-client', GITHUB_CLIENT_SECRET: 'context-secret' },
    query: async (sql, params) => {
      if (sql.startsWith('SELECT targets, created_at FROM cross_posts')) {
        assert.match(sql, /WHERE user_id=\$1 ORDER BY created_at DESC LIMIT 50$/);
        historyReaders.push(params[0]); return { rows: history.get(params[0]) || [] };
      }
      return { rows: [], rowCount: 0 };
    },
    modules: { './publishing-http': { createPublishingHttp: () => ({ request: async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET' });
      assert.ok(!options.method || options.method === 'GET');
      const owner = options.headers.Authorization === 'Bearer context-owner-token';
      if (url === 'https://api.github.com/user') return { status: 200, data: { id: owner ? 7 : 8, login: owner ? 'actual-owner' : 'actual-other', name: owner ? 'Provider Owner' : 'Provider Other' } };
      if (url.startsWith('https://api.github.com/user/repos?')) return { status: 200, data: [
        { full_name: 'member/first', private: false, permissions: { push: true } },
        { full_name: 'member/second', private: false, permissions: { push: true } },
        { full_name: 'private/hidden', private: true, permissions: { push: true } },
        { full_name: 'other/read-only', private: false, permissions: { push: false } },
      ] };
      throw Error('Unexpected provider read');
    } }) } },
  });
  t.after(() => app.close());
  for (const id of ['context-owner', 'context-other']) app.seedUser(member(id, { plan: 'pro', socialTokens: { github: id + '-token' } }));
  const owner = await app.request('/command-center/cross-post/github/destinations', { userId: 'context-owner' });
  assert.equal(owner.status, 200, JSON.stringify(owner.data));
  assert.deepEqual(owner.data.context.account, { id: '7', label: 'Provider Owner', handle: 'actual-owner' });
  assert.deepEqual(owner.data.suggestedValues, { destinationId: 'member/second' });
  assert.equal(owner.data.context.usage.source, 'uficonnect-publishing-history');
  assert.deepEqual(owner.data.destinations.map(choice => choice.id), ['member/first', 'member/second']);
  const other = await app.request('/command-center/cross-post/github/destinations', { userId: 'context-other' });
  assert.equal(other.status, 200);
  assert.deepEqual(other.data.context.account, { id: '8', label: 'Provider Other', handle: 'actual-other' });
  assert.deepEqual(other.data.suggestedValues, {});
  assert.equal(other.data.context.usage, undefined);
  assert.deepEqual(historyReaders, ['context-owner', 'context-other']);
  assert.equal(owner.headers.get('cache-control'), 'private, no-store');
  for (const response of [owner, other]) {
    assert.ok(!JSON.stringify(response.data).includes('-token'));
    assert.ok(!JSON.stringify(response.data).includes('context-secret'));
  }
  assert.equal(calls.length, 4);
});

test('unavailable history does not hide actual YouTube channel choices or invent audience and visibility settings', async t => {
  const calls = [];
  const app = await createAppHarness({ connected: true,
    query: async sql => {
      if (sql.startsWith('SELECT targets, created_at FROM cross_posts')) throw Error('Optional history unavailable');
      return { rows: [], rowCount: 0 };
    },
    modules: { './publishing-http': { createPublishingHttp: () => ({ request: async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET' });
      assert.equal(url, 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50');
      return { status: 200, data: { items: [{ id: 'UC-current', snippet: { title: 'Actual member channel' } }] } };
    } }) } },
  });
  t.after(() => app.close());
  app.seedUser(member('channel-owner', { plan: 'pro', socialTokens: { youtube: 'private-youtube-token' } }));
  const response = await app.request('/command-center/cross-post/youtube/destinations', { userId: 'channel-owner' });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.deepEqual(response.data.context.account, { id: 'UC-current', label: 'Actual member channel' });
  assert.deepEqual(response.data.suggestedValues, { destinationId: 'UC-current' });
  assert.equal(response.data.context.recommendation, 'only_verified_destination');
  assert.equal(response.data.context.usage, undefined);
  for (const key of ['privacyStatus', 'madeForKids']) {
    const field = response.data.fields.find(field => field.key === key);
    assert.equal(field.required, true); assert.equal(field.default, undefined);
    assert.equal(response.data.suggestedValues[key], undefined);
  }
  assert.equal(calls.length, 1); assert.equal(calls[0].method, 'GET');
});
