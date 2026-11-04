'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOfficeAISources } = require('./office-ai-sources');
const { createOfficeAI, validateChat } = require('./office-ai');
const { EventEmitter } = require('node:events');
const TOKEN = 'workspace-credential-private-123456789';
const SLACK = `xoxp-${TOKEN}`;
const PAGE = '12345678-1234-1234-1234-123456789abc';
const env = { OFFICE_NOTION_TOKEN: TOKEN, OFFICE_SLACK_TOKEN: SLACK, OFFICE_LINEAR_TOKEN: TOKEN,
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'cloudflare-private-credential' };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function fixture() {
  const calls = [];
  return { calls, fetcher: async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, options, body });
    if (url.endsWith('/users/me')) return json({ object: 'user', id: 'bot-user' });
    if (url.endsWith('/v1/search')) return json({ results: [{ object: 'page', id: PAGE, url: `https://app.notion.com/p/${PAGE}`,
      properties: { title: { type: 'title', title: [{ plain_text: 'Launch notes' }] } } }] });
    if (url.includes('/children?')) return json({ results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: `Launch approved. ${TOKEN}` }] } }] });
    if (url.endsWith('/auth.test')) return json({ ok: true, user_id: 'U123', team_id: 'T123' });
    if (url.endsWith('/assistant.search.context')) return json({ ok: true, results: { messages: [{ channel_name: 'launch', content: 'Launch is on Friday.', permalink: 'https://example.slack.com/archives/C123/p123' }] } });
    if (url.endsWith('/graphql')) return json({ data: { viewer: { id: 'user-1' }, issues: { nodes: [{ id: 'issue-1', identifier: 'OFF-1', title: 'Launch',
      description: 'Finish review', state: { name: 'In progress' }, url: 'https://linear.app/example/issue/OFF-1/launch' }] } } });
    if (url.endsWith('/v1/chat/completions')) return json({ choices: [{ message: { content: 'Workspace launch summary [1].' } }] });
    throw Error('Unexpected URL');
  } };
}
async function chat(service, body) {
  const response = new EventEmitter(); response.statusCode = 200;
  response.set = () => response;
  response.status = value => { response.statusCode = value; return response; };
  response.json = value => { response.body = value; response.writableEnded = true; return response; };
  await service.chat({ body }, response);
  return { status: response.statusCode, body: response.body };
}

test('workspace verification checks read APIs with fixed hosts, auth headers, and no write mutations', async () => {
  const fake = fixture(), sources = createOfficeAISources({ env, fetcher: fake.fetcher });
  for (const [id, token] of [['notion', TOKEN], ['slack', SLACK], ['linear', TOKEN]]) {
    const result = await sources.verify(id, token);
    assert.match(result.detail, /verified/);
    assert.ok(!JSON.stringify(result).includes(token));
  }
  assert.equal(fake.calls.length, 5);
  for (const call of fake.calls) {
    assert.equal(call.options.redirect, 'error'); assert.ok(call.options.signal);
    assert.ok(!call.url.includes(TOKEN));
    assert.ok(!call.options.body?.includes(TOKEN));
    assert.ok(!call.options.body?.includes('mutation'));
  }
  assert.equal(fake.calls[0].options.headers['Notion-Version'], '2026-03-11');
  assert.equal(fake.calls.at(-1).options.headers.Authorization, TOKEN);
  const slack = fake.calls.find(call => call.url.endsWith('/assistant.search.context'));
  assert.deepEqual(slack.body.channel_types, ['public_channel']);
  assert.equal(slack.options.headers.Authorization, `Bearer ${SLACK}`);
  await assert.rejects(sources.verify('slack', `xoxb-${TOKEN}`), /user OAuth token/);
  assert.equal(fake.calls.length, 5);
});

test('source retrieval is bounded and creates citations from provider-owned links without exposing credentials', async () => {
  const fake = fixture(), sources = createOfficeAISources({ env, fetcher: fake.fetcher });
  const result = await sources.collect(['notion', 'slack', 'linear'], 'Summarize "Launch"', new AbortController().signal);
  assert.equal(result.sources.length, 3);
  assert.ok(result.statuses.every(status => status.status === 'retrieved' && status.count === 1));
  assert.ok(!JSON.stringify(result).includes(TOKEN));
  assert.match(result.sources.find(source => source.provider === 'notion').description, /credential omitted/);
  const notion = fake.calls.find(call => call.url.endsWith('/v1/search'));
  assert.equal(notion.body.query, 'Launch'); assert.equal(notion.body.page_size, 3);
  assert.ok(fake.calls.some(call => call.url.endsWith(`/blocks/${PAGE}/children?page_size=30`)));
  const slack = fake.calls.find(call => call.url.endsWith('/assistant.search.context'));
  assert.equal(slack.body.limit, 4); assert.equal(slack.body.include_context_messages, false);
  const linear = fake.calls.find(call => call.url.endsWith('/graphql'));
  assert.equal(linear.body.variables.filter.or[0].title.containsIgnoreCase, 'Launch');
});

test('unknown, duplicate, and non-array selections are rejected before any provider call', () => {
  for (const sourceIds of [['unknown'], ['slack', 'slack'], 'notion', [null], ['notion', 'slack', 'linear', 'github']]) {
    assert.throws(() => validateChat({ message: 'hello', sourceIds }), /supported connected sources/);
  }
  assert.deepEqual(validateChat({ message: 'hello' }).sourceIds, []);
});

test('chat retrieves only explicitly selected sources even with web research off and returns their status', async () => {
  const fake = fixture(), service = createOfficeAI({ env, fetcher: fake.fetcher });
  let response = await chat(service, { message: 'Launch', research: false });
  assert.equal(response.status, 200); assert.deepEqual(response.body.connectedSources, []);
  assert.equal(fake.calls.length, 1);
  response = await chat(service, { message: 'Launch', research: false, sourceIds: ['linear'] });
  assert.equal(response.status, 200);
  assert.equal(response.body.connectedSources[0].status, 'retrieved');
  assert.equal(response.body.research.status, 'disabled');
  assert.equal(response.body.sources[0].publisher, 'Linear');
  const inference = fake.calls.at(-1).body;
  const reference = JSON.parse(inference.messages[1].content.split('\n').slice(1).join('\n'));
  assert.equal(reference.sources[0].sourceId, 1);
  assert.equal(reference.sources[0].description, 'In progress: Finish review');
  assert.ok(!JSON.stringify(inference).includes(TOKEN));
  assert.match(inference.messages[0].content, /connected workspace excerpts.*untrusted data/);
  assert.ok(!fake.calls.some(call => /notion|slack/.test(call.url)));
});

test('disconnected and failed sources remain explicit without leaking remote errors or preventing other retrieval', async () => {
  const fake = fixture(), sources = createOfficeAISources({ env: { ...env, OFFICE_NOTION_TOKEN: '' }, fetcher: async (url, options) => {
    if (url.includes('slack')) return json({ ok: false, error: SLACK });
    return fake.fetcher(url, options);
  } });
  const result = await sources.collect(['notion', 'slack', 'linear'], 'Launch');
  assert.deepEqual(result.statuses.map(item => item.status), ['not-connected', 'unavailable', 'retrieved']);
  assert.equal(result.sources.length, 1); assert.ok(!JSON.stringify(result).includes(TOKEN));
  assert.equal(fake.calls.length, 1);
});

test('malformed page identifiers, provider errors, oversized responses, and foreign citation URLs fail safely', async () => {
  const invalid = createOfficeAISources({ env, fetcher: async () => json({ results: [{ id: '../users/me', url: 'https://evil.example' }] }) });
  assert.deepEqual((await invalid.collect(['notion'], 'Launch')).sources, []);
  const foreign = createOfficeAISources({ env, fetcher: async () => json({ ok: true, results: { messages: [{ permalink: 'https://evil.example/steal', content: 'text' }] } }) });
  assert.equal((await foreign.collect(['slack'], 'Launch')).statuses[0].status, 'empty');
  for (const body of [{ errors: [{ message: TOKEN }], data: { viewer: { id: 'x' } } }, { data: 'x'.repeat(270000) }]) {
    const sources = createOfficeAISources({ env, fetcher: async () => json(body) });
    const result = await sources.collect(['linear'], 'Launch');
    assert.equal(result.statuses[0].status, 'unavailable'); assert.ok(!JSON.stringify(result).includes(TOKEN));
    await assert.rejects(sources.verify('linear', TOKEN));
  }
});
