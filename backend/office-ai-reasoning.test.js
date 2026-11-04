'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOfficeAIModel } = require('./office-ai');

const secret = 'relay-secret-for-tests-00000000000000000000';
const messages = [{ role: 'user', content: 'Check this result.' }];
const response = () => new Response(JSON.stringify({ choices: [{ message: {
  role: 'assistant', content: 'Verified.', reasoning_content: 'private reasoning',
  tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'repo_read', arguments: '{"path":"README.md"}' } }],
} }] }), { headers: { 'content-type': 'application/json' } });

test('task model enables Gemma thinking and full output budget through either transport without retaining private reasoning', async () => {
  for (const env of [
    { OFFICE_AI_RELAY_URL: 'https://office.owner.workers.dev', OFFICE_AI_RELAY_SECRET: secret },
    { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'private-test-token' },
  ]) {
    let request;
    const model = createOfficeAIModel({ env, fetcher: async (_url, options) => { request = JSON.parse(options.body); return response(); } });
    const completion = await model({ messages });
    assert.equal(request.max_tokens, 8192);
    assert.deepEqual(request.chat_template_kwargs, { enable_thinking: true });
    assert.equal(completion.content, 'Verified.');
    assert.equal(completion.tool_calls.length, 1);
    assert.equal(completion.reasoning_content, undefined);
    assert.ok(!JSON.stringify(completion).includes('private reasoning'));
    await model({ messages, maxTokens: 100000 });
    assert.equal(request.max_tokens, 8192);
  }
});

test('custom models do not receive an unsupported Gemma thinking parameter', async () => {
  let request;
  const model = createOfficeAIModel({ env: { OFFICE_AI_RELAY_URL: 'https://office.owner.workers.dev', OFFICE_AI_RELAY_SECRET: secret,
    OFFICE_AI_MODEL: '@cf/custom/other-model' }, fetcher: async (_url, options) => { request = JSON.parse(options.body); return response(); } });
  await model({ messages });
  assert.equal(request.chat_template_kwargs, undefined);
});

test('authenticated relay forwards thinking controls while rejecting arbitrary template inputs', async () => {
  const { default: worker } = await import('../infra/office-ai-worker/index.mjs');
  let inputs, calls = 0;
  const env = { OFFICE_AI_RELAY_SECRET: secret, AI: { run: async (_model, options) => { calls++; inputs = options; return { response: 'Done.' }; } } };
  const request = (options, authorized = true) => new Request('https://office.owner.workers.dev/chat', { method: 'POST',
    headers: { 'content-type': 'application/json', ...(authorized ? { authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify({ messages, max_tokens: 8192, ...options }) });
  let result = await worker.fetch(request({ chat_template_kwargs: { enable_thinking: true } }), env);
  assert.equal(result.status, 200);
  assert.deepEqual(inputs.chat_template_kwargs, { enable_thinking: true });
  assert.equal(inputs.max_tokens, 8192);
  for (const value of [true, [], null, { enable_thinking: 'true' }, { enable_thinking: true, template: 'override' }]) {
    result = await worker.fetch(request({ chat_template_kwargs: value }), env);
    assert.equal(result.status, 400);
  }
  result = await worker.fetch(request({ chat_template_kwargs: { enable_thinking: true } }, false), env);
  assert.equal(result.status, 401);
  assert.equal(calls, 1);
});
