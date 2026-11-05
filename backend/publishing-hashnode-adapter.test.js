'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHashnodePublishingAdapter } = require('./publishing-hashnode-adapter');

const TOKEN = 'synthetic-personal-secret-do-not-return';
const PUBLICATION = '111111111111111111111111';
const OTHER_PUBLICATION = '222222222222222222222222';
const POST_ID = '333333333333333333333333';
const INPUT = { content: 'A useful engineering article.', settings: { destinationId: PUBLICATION, title: 'Engineering update' } };
const PHOTO = 'https://res.cloudinary.com/ufi/image/upload/v3/asset.png';
const connection = (nodes, next = '') => ({ edges: nodes.map(node => ({ node })), pageInfo: { hasNextPage: Boolean(next), endCursor: next || null } });
const response = (data, status = 200) => ({ status, data: { data } });
const denied = (code, status = 200) => ({ status, data: { errors: [{ message: `Do not expose ${TOKEN}`, extensions: { code } }] } });

function fixture(custom) {
  const state = { owner: 'member-1', publicationOwner: 'member-1', headless: false, role: 'EDITOR', owned: [PUBLICATION], pro: true, includePost: true, delisted: false, publishedAt: '2026-01-01T00:00:00Z' };
  const calls = [];
  const publication = publicationId => ({ id: publicationId, title: 'Engineering journal', url: 'https://member.hashnode.dev/', author: { id: state.publicationOwner }, isHeadless: state.headless });
  const post = () => ({ id: POST_ID, url: 'https://member.hashnode.dev/engineering-update', publishedAt: state.publishedAt, author: { id: state.owner }, publication: { id: PUBLICATION }, preferences: { isDelisted: state.delisted } });
  function defaultResponse(call) {
    switch (call.json.operationName) {
      case 'UfiHashnodePublications': return response({ me: { id: state.owner, name: 'Member', username: 'member', publications: connection(state.owned.map(publication)) } });
      case 'UfiHashnodeDestination': return state.pro ? response({ me: { id: state.owner }, publication: publication(call.json.variables.id) }) : denied('FORBIDDEN');
      case 'UfiHashnodeMembers': return response({ publication: { id: call.json.variables.id, members: connection([{ role: state.role, user: { id: state.owner } }]) } });
      case 'UfiHashnodePublish': return response({ publishPost: { post: post() } });
      case 'UfiHashnodePublished': return response({ publication: { id: call.json.variables.id, posts: connection(state.includePost ? [post()] : []) } });
      default: throw Error('Unexpected operation ' + call.json.operationName);
    }
  }
  const adapter = createHashnodePublishingAdapter({ env: { CLOUDINARY_CLOUD_NAME: 'ufi' }, request: async (url, options) => {
    const call = { url, ...options }; calls.push(call);
    assert.equal(url, 'https://gql-beta.hashnode.com/'); assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
    return custom?.(call, state, defaultResponse) ?? defaultResponse(call);
  } });
  return { adapter, state, calls, post, publication, writes: () => calls.filter(call => call.json.operationName === 'UfiHashnodePublish') };
}
function noSecrets(value) { assert.ok(!JSON.stringify(value).includes(TOKEN)); }

test('Hashnode lists verified owned Pro publications and exposes only safe destination fields', async () => {
  const { adapter, calls } = fixture();
  const schema = await adapter.destinations(TOKEN);
  assert.equal(schema.accountVerified, true); assert.equal(schema.allowCustomDestination, true);
  assert.deepEqual(schema.destinations, [{ id: PUBLICATION, label: 'Engineering journal', description: 'https://member.hashnode.dev/' }]);
  assert.deepEqual(schema.fields, [{ key: 'title', label: 'Article title', type: 'text', required: true, maxLength: 200 }]);
  assert.ok(calls.some(call => call.json.operationName === 'UfiHashnodeDestination'), 'Root publication query verifies provider Pro access');
  assert.equal(adapter.capability.supported, true); assert.deepEqual(adapter.capability.allowedMedia, ['text', 'image']);
  noSecrets(schema);
});

test('a verified PAT with no owned Pro publication can connect before entering an editor publication ID', async () => {
  const { adapter, state } = fixture(); state.owned = [];
  const schema = await adapter.destinations(TOKEN);
  assert.equal(schema.accountVerified, true); assert.deepEqual(schema.destinations, []);
  state.publicationOwner = 'other-owner';
  const selected = await adapter.destinations(TOKEN, { destinationId: OTHER_PUBLICATION });
  assert.equal(selected.destinations[0].id, OTHER_PUBLICATION);
  noSecrets(selected);
});

test('Hashnode publishes exactly once with explicit title/publication and proves public listing before posted', async () => {
  const { adapter, writes, calls } = fixture();
  const result = await adapter.publish(TOKEN, { ...INPUT, content: '---\nisDelisted: true\n---\nUseful content.', mediaUrl: PHOTO, mediaType: 'image', settings: { ...INPUT.settings, publishAs: 'other-person', publishedAt: '2099-01-01', isDelisted: true } });
  assert.equal(result.status, 'posted'); assert.equal(result.publishId, POST_ID); assert.equal(result.destinationId, PUBLICATION); assert.equal(result.authorId, 'member-1');
  const input = writes()[0].json.variables.input;
  assert.equal(input.isDelisted, false); assert.equal(input.publicationId, PUBLICATION); assert.equal(input.title, INPUT.settings.title);
  assert.ok(input.contentMarkdown.startsWith('# Engineering update\n\n---'));
  assert.ok(input.contentMarkdown.endsWith(`![Image](${PHOTO})`));
  for (const key of ['publishAs', 'publishedAt', 'coAuthors', 'slug']) assert.equal(Object.hasOwn(input, key), false);
  assert.equal(writes().length, 1); assert.ok(calls.some(call => call.json.operationName === 'UfiHashnodePublished'));
  noSecrets(result);
});

test('owner/editor/admin publication roles allow direct publishing; contributors cannot write', async () => {
  for (const role of ['EDITOR', 'ADMIN', 'OWNER', 'CONTRIBUTOR', 'reader']) {
    const { adapter, state, writes } = fixture(); state.publicationOwner = 'other-owner'; state.role = role;
    if (['EDITOR', 'ADMIN', 'OWNER'].includes(role)) assert.equal((await adapter.publish(TOKEN, INPUT)).status, 'posted');
    else { await assert.rejects(adapter.publish(TOKEN, INPUT), error => error.status === 403 && !error.deliveryUncertain); assert.equal(writes().length, 0); }
  }
});

test('Pro denial and headless destinations fail before writing and cannot be enabled by local flags', async () => {
  const first = fixture(); first.state.pro = false;
  await assert.rejects(first.adapter.publish(TOKEN, INPUT), error => error.status === 403 && !error.message.includes(TOKEN));
  assert.equal(first.writes().length, 0); assert.deepEqual((await first.adapter.destinations(TOKEN)).destinations, []);
  const second = fixture(); second.state.headless = true;
  await assert.rejects(second.adapter.publish(TOKEN, INPUT), /non-headless/); assert.equal(second.writes().length, 0);
});

test('explicit destination, title and supported UFI image are required before provider writes', async () => {
  const { adapter, writes } = fixture();
  for (const input of [
    { ...INPUT, settings: {} }, { ...INPUT, settings: { ...INPUT.settings, destinationId: 'not-an-id' } },
    { ...INPUT, settings: { ...INPUT.settings, title: 'x'.repeat(201) } }, { ...INPUT, content: '' },
    { ...INPUT, mediaUrl: PHOTO, mediaType: 'video' },
    { ...INPUT, mediaUrl: 'https://res.cloudinary.com/other/image/upload/a.jpg', mediaType: 'image' },
    { ...INPUT, mediaUrl: 'https://res.cloudinary.com/ufi/image/upload/a.jpg?token=secret', mediaType: 'image' },
  ]) await assert.rejects(adapter.publish(TOKEN, input));
  assert.equal(writes().length, 0);
});

test('invalid token and GraphQL auth errors request reconnect without exposing provider messages', async () => {
  const { adapter, calls } = fixture(() => denied('UNAUTHENTICATED'));
  await assert.rejects(adapter.destinations('bad token'), error => error.reconnectRequired === true);
  assert.equal(calls.length, 0);
  await assert.rejects(adapter.destinations(TOKEN), error => error.status === 401 && error.reconnectRequired === true && !error.message.includes(TOKEN));
});

test('accepted writes with missing ID, wrong author, wrong publication or unsafe permalink are uncertain', async () => {
  for (const patch of [{ id: null }, { author: { id: 'someone-else' } }, { publication: { id: OTHER_PUBLICATION } }, { url: 'https://other.example/article' }, { url: 'https://member.hashnode.dev/article?token=secret' }]) {
    const { adapter, writes } = fixture((call, _state, defaults) => {
      const data = defaults(call);
      if (call.json.operationName === 'UfiHashnodePublish') Object.assign(data.data.data.publishPost.post, patch);
      return data;
    });
    await assert.rejects(adapter.publish(TOKEN, INPUT), error => error.deliveryUncertain === true && !error.message.includes(TOKEN));
    assert.equal(writes().length, 1);
  }
});

test('delisted and future-dated receipts retain the accepted identity without claiming publication', async () => {
  const first = fixture(); first.state.delisted = true;
  const hidden = await first.adapter.publish(TOKEN, INPUT); assert.equal(hidden.status, 'handoff'); assert.equal(hidden.publishId, POST_ID);
  const second = fixture(); second.state.publishedAt = '2099-01-01T00:00:00Z';
  const future = await second.adapter.publish(TOKEN, INPUT); assert.equal(future.status, 'processing'); assert.equal(future.publishId, POST_ID);
});

test('an accepted object absent from public listing stays processing, including soft-deleted objects', async () => {
  const { adapter, state, writes } = fixture(); state.includePost = false;
  const result = await adapter.publish(TOKEN, INPUT);
  assert.equal(result.status, 'processing'); assert.equal(result.publishId, POST_ID); assert.equal(writes().length, 1);
});

test('temporary confirmation failure preserves a receipt; transport/write failures never retry', async () => {
  const first = fixture(call => { if (call.json.operationName === 'UfiHashnodePublished') throw Error(TOKEN); });
  assert.equal((await first.adapter.publish(TOKEN, INPUT)).status, 'processing'); assert.equal(first.writes().length, 1);
  const second = fixture(call => { if (call.json.operationName === 'UfiHashnodePublish') throw Error(TOKEN); });
  await assert.rejects(second.adapter.publish(TOKEN, INPUT), error => error.deliveryUncertain === true && !error.message.includes(TOKEN));
  assert.equal(second.writes().length, 1);
  const third = fixture(call => { if (call.json.operationName === 'UfiHashnodePublications') throw Error(TOKEN); });
  await assert.rejects(third.adapter.destinations(TOKEN), error => error.deliveryUncertain !== true && !error.message.includes(TOKEN));
});

test('partial GraphQL errors after creation never discard a real receipt as a retryable denial', async () => {
  const { adapter, writes } = fixture((call, _state, defaults) => {
    const result = defaults(call);
    if (call.json.operationName === 'UfiHashnodePublish') result.data.errors = [{ message: TOKEN, extensions: { code: 'FORBIDDEN' } }];
    return result;
  });
  assert.equal((await adapter.publish(TOKEN, INPUT)).status, 'posted'); assert.equal(writes().length, 1);
});

test('GraphQL rejected writes and server failures remain distinct and sanitized', async () => {
  for (const [code, uncertainWrite] of [['BAD_USER_INPUT', false], ['FORBIDDEN', false], ['INTERNAL_SERVER_ERROR', true]]) {
    const { adapter, writes } = fixture(call => call.json.operationName === 'UfiHashnodePublish' ? denied(code) : undefined);
    await assert.rejects(adapter.publish(TOKEN, INPUT), error => Boolean(error.deliveryUncertain) === uncertainWrite && !error.message.includes(TOKEN));
    assert.equal(writes().length, 1);
  }
});

test('sync binds accepted receipts to the original member and publication without writing', async () => {
  const { adapter, state, writes, calls } = fixture();
  const saved = { publishId: POST_ID, destinationId: PUBLICATION, authorId: 'member-1' };
  assert.equal((await adapter.sync(TOKEN, saved)).status, 'posted');
  state.owner = 'member-2';
  await assert.rejects(adapter.sync(TOKEN, saved), error => error.status === 401 && error.reconnectRequired === true);
  assert.equal(writes().length, 0);
  assert.equal(calls.filter(call => call.json.operationName === 'UfiHashnodePublished').length, 1);
});

test('pagination supports editor membership and rejects repeated provider cursors', async () => {
  const first = fixture((call, state) => {
    if (call.json.operationName === 'UfiHashnodeMembers' && !call.json.variables.after) return response({ publication: { id: PUBLICATION, members: connection([{ role: 'EDITOR', user: { id: 'other' } }], 'next-members') } });
    if (call.json.operationName === 'UfiHashnodeMembers') return response({ publication: { id: PUBLICATION, members: connection([{ role: 'EDITOR', user: { id: state.owner } }]) } });
  }); first.state.publicationOwner = 'other-owner';
  assert.equal((await first.adapter.publish(TOKEN, INPUT)).status, 'posted');
  assert.equal(first.calls.filter(call => call.json.operationName === 'UfiHashnodeMembers').length, 2);
  const second = fixture(call => call.json.operationName === 'UfiHashnodePublications' ? response({ me: { id: 'member-1', publications: connection([], 'same') } }) : undefined);
  await assert.rejects(second.adapter.destinations(TOKEN), /complete publication list/); assert.equal(second.writes().length, 0);
});
