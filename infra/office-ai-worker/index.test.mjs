import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.mjs';
import {executeCode} from './index.mjs';
const secret = 'unit-test-secret-'.repeat(4);

test('code runs only through a fresh isolated loader with no network or parent credentials',async()=>{
 let captured;
 const env={OFFICE_AI_RELAY_SECRET:secret,LOADER:{load(config){captured=config;return{getEntrypoint(name){assert.equal(name,'Code');return{run:async input=>({result:input.a*19,logs:['calculated']})};}};}}};
 const result=await executeCode({code:'return input.a*19;',input:{a:17}},env);assert.equal(result.result,323);assert.equal(result.network,false);assert.equal(result.runtime,'Cloudflare Dynamic Worker');assert.deepEqual(captured.env,{});assert.equal(captured.globalOutbound,null);assert.equal(captured.limits.cpuMs,100);assert.ok(!captured.modules['code.js'].includes(secret));
 assert.equal((await worker.fetch(request('/execute',{code:'return 1;'},'Bearer wrong'),env)).status,401);
 assert.equal((await worker.fetch(request('/execute',{code:'return 1;'}),{OFFICE_AI_RELAY_SECRET:secret})).status,503);
 await assert.rejects(executeCode({code:'return 1;',unexpected:true},env),error=>error.status===400);
 const large={LOADER:{load:()=>({getEntrypoint:()=>({run:async()=>({result:'x'.repeat(41000),logs:[]})})})}};await assert.rejects(executeCode({code:'return 1;'},large),error=>error.status===413);
});

test('uploaded photos reach the vision binding and remote image URLs are rejected', async () => {
  let captured;
  const env = { OFFICE_AI_RELAY_SECRET: secret, AI: { async run(_model, input) { captured = input; return { response: 'A photo.' }; } } };
  const data = `data:image/jpeg;base64,${Buffer.alloc(300000, 255).toString('base64')}`;
  const body = { messages: [{ role: 'user', content: [{ type: 'text', text: 'Describe the photo.' }, { type: 'image_url', image_url: { url: data } }] }] };
  assert.equal((await worker.fetch(request('/chat', body), env)).status, 200);
  assert.equal(captured.messages[0].content[1].image_url.url, data);
  body.messages[0].content[1].image_url.url = 'https://internal.example/photo';
  assert.equal((await worker.fetch(request('/chat', body), env)).status, 400);
  body.messages[0].role = 'system';
  assert.equal((await worker.fetch(request('/chat', body), env)).status, 400);
});
function request(route, body, authorization = `Bearer ${secret}`) {
  return new Request(`https://relay.example${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
test('authentication rejects missing, incorrect and unconfigured secrets before inference', async () => {
  let calls = 0; const env = { OFFICE_AI_RELAY_SECRET: secret, AI: { run() { calls++; } } };
  for (const token of ['', 'Bearer wrong']) assert.equal((await worker.fetch(request('/chat', {}, token), env)).status, 401);
  assert.equal((await worker.fetch(request('/health'), { AI: env.AI })).status, 401);
  assert.equal(calls, 0);
});
test('chat uses bounded binding inputs and normalizes native tool calls', async () => {
  let captured;
  const env = { OFFICE_AI_RELAY_SECRET: secret, AI: { async run(...args) { captured = args; return { response: '', tool_calls: [{ name: 'office_status', arguments: { scope: 'all' } }] }; } } };
  const response = await worker.fetch(request('/chat', { model: '@cf/google/gemma-4-26b-a4b-it', messages: [{ role: 'user', content: 'Check status' }], tools: [{ type: 'function', function: { name: 'office_status', parameters: { type: 'object' } } }] }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(captured[2], { gateway: { id: 'default', skipCache: true, collectLog: false } });
  assert.equal(captured[1].stream, false);
  assert.equal((await response.json()).choices[0].message.tool_calls[0].function.arguments, '{"scope":"all"}');
});
test('invalid payloads and oversized content cannot reach binding', async () => {
  let calls = 0; const env = { OFFICE_AI_RELAY_SECRET: secret, AI: { run() { calls++; } } };
  for (const body of [{ messages: [] }, { messages: [{ role: 'unknown', content: 'x' }] }, { model: 'https://attacker.example', messages: [{ role: 'user', content: 'x' }] }, { max_tokens: 100000, messages: [{ role: 'user', content: 'x' }] }]) assert.equal((await worker.fetch(request('/chat', body), env)).status, 400);
  assert.equal((await worker.fetch(request('/chat', { messages: [{ role: 'user', content: 'a'.repeat(524289) }] }), env)).status, 413);
  assert.equal(calls, 0);
});
test('search forwards only supported fields, and provider errors do not expose secrets', async () => {
  let captured; const env = { OFFICE_AI_RELAY_SECRET: secret, AI: { async websearch(input) { captured = input; return Response.json({ results: [{ title: 'Cloudflare', url: 'https://developers.cloudflare.com/' }] }); } } };
  const response = await worker.fetch(request('/search', { query: ' current AI updates ', limit: 3, url: 'http://127.0.0.1' }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(captured, { gatewayId: 'default', query: 'current AI updates', provider: 'exa', limit: 3 });
  env.AI.websearch = async () => { throw Error(secret); };
  const failed = await worker.fetch(request('/search', { query: 'news' }), env);
  assert.equal(failed.status, 502); assert.equal((await failed.text()).includes(secret), false);
});
