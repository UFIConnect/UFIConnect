'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOfficeAIModel, DEFAULT_MODEL } = require('./office-ai');
const settings = { OFFICE_AI_RELAY_URL: 'https://office.owner.workers.dev', OFFICE_AI_RELAY_SECRET: 'relay-secret-for-tests-00000000000000000000',
  OFFICE_AI_FALLBACK_MODELS: '@cf/meta/llama-3.3-70b-instruct-fp8-fast,@cf/qwen/qwen3-30b-a3b-fp8' };
const messages = [{ role: 'user', content: 'Inspect the repository.' }];
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const result = () => json({ choices: [{ message: { content: 'Done.', reasoning_content: 'private reasoning' } }] });

test('failed inference uses configured recovery and skips the unhealthy model on the next step', async () => {
  const calls = [];
  const model = createOfficeAIModel({ env: settings, fetcher: async (_, opts) => {
    const body = JSON.parse(opts.body); calls.push(body.model);
    return body.model === DEFAULT_MODEL ? json({}, 503) : result();
  } });
  const answer = await model({ messages });
  assert.equal(answer.content, 'Done.'); assert.equal(answer.reasoning_content, undefined);
  await model({ messages });
  assert.deepEqual(calls, [DEFAULT_MODEL, '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.3-70b-instruct-fp8-fast']);
});

test('credential changes invalidate unhealthy model state', async () => {
  const env = { ...settings }; const calls = [];
  const model = createOfficeAIModel({ env, fetcher: async (_, opts) => {
    const body = JSON.parse(opts.body); calls.push(body.model);
    return calls.length === 1 ? json({}, 503) : result();
  } });
  await model({ messages }); env.OFFICE_AI_RELAY_SECRET += '-rotated'; await model({ messages });
  assert.equal(calls.at(-1), DEFAULT_MODEL);
});

test('auth, billing, context and request rejections do not fan out across recovery models', async () => {
  for (const status of [400, 401, 402, 403, 413]) {
    let calls = 0;
    const model = createOfficeAIModel({ env: settings, fetcher: async () => { calls++; return json({}, status); } });
    await assert.rejects(model({ messages }), /Cloudflare rejected/); assert.equal(calls, 1);
  }
});

test('actual relay preserves permanent inference rejections without leaking upstream messages or trying another model', async () => {
  const {default:worker}=await import('../infra/office-ai-worker/index.mjs');
  for(const status of [400,401,402,403,413]) {
    let transportCalls=0,inferenceCalls=0;
    const privateMessage='private-upstream-detail-'+settings.OFFICE_AI_RELAY_SECRET;
    const env={OFFICE_AI_RELAY_SECRET:settings.OFFICE_AI_RELAY_SECRET,AI:{run:async()=>{inferenceCalls++;throw Object.assign(Error(privateMessage),{status});}}};
    const model=createOfficeAIModel({env:settings,fetcher:async(url,options)=>{
      transportCalls++;const response=await worker.fetch(new Request(url,options),env);
      assert.equal(response.status,status);assert.equal((await response.clone().text()).includes(privateMessage),false);return response;
    }});
    await assert.rejects(model({messages}),/Cloudflare rejected/);
    assert.equal(transportCalls,1);assert.equal(inferenceCalls,1);
  }
});

test('actual relay authentication rejection never reaches inference or starts model fallback', async()=>{
  const {default:worker}=await import('../infra/office-ai-worker/index.mjs');let transportCalls=0,inferenceCalls=0;
  const model=createOfficeAIModel({env:settings,fetcher:async(url,options)=>{
    transportCalls++;return worker.fetch(new Request(url,options),{OFFICE_AI_RELAY_SECRET:'different-owner-secret-000000000000000000',AI:{run:async()=>{inferenceCalls++;return{};}}});
  }});
  await assert.rejects(model({messages}),/Cloudflare rejected/);assert.equal(transportCalls,1);assert.equal(inferenceCalls,0);
});

test('ten configured recovery slots have a maximum of three attempts per task step', async () => {
  let calls = 0;
  const env = { ...settings, OFFICE_AI_FALLBACK_MODELS: Array.from({length:10},(_,i)=>`@cf/custom/recovery-${i}`).join(',') };
  const model = createOfficeAIModel({ env, fetcher: async () => { calls++; return json({}, 503); } });
  await assert.rejects(model({ messages })); assert.equal(calls, 3);
  env.OFFICE_AI_FALLBACK_MODELS += ',@cf/custom/eleventh';
  await assert.rejects(model({ messages }), /up to ten/); assert.equal(calls, 3);
});

test('image context is never sent to a text-only recovery model', async () => {
  const calls = [];
  const model = createOfficeAIModel({ env: settings, fetcher: async (_,opts) => { calls.push(JSON.parse(opts.body).model); return json({},503); } });
  await assert.rejects(model({ messages:[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,AAAA'}}]}] }));
  assert.deepEqual(calls,[DEFAULT_MODEL]);
});

test('cancellation does not start fallback inference', async () => {
  const controller = new AbortController(); let calls = 0;
  const model = createOfficeAIModel({ env: settings, fetcher: async () => { calls++; controller.abort(); throw Error('aborted'); } });
  await assert.rejects(model({ messages, signal: controller.signal })); assert.equal(calls, 1);
});

test('adaptive thinking avoids extra reasoning after routine reads and retains it for planning', async () => {
  const calls = [];
  const model = createOfficeAIModel({ env: {...settings, OFFICE_AI_THINKING_MODE:'adaptive'}, fetcher: async (_,opts) => {calls.push(JSON.parse(opts.body));return result();} });
  await model({ messages });
  await model({ messages:[...messages,{role:'assistant',content:null,tool_calls:[{id:'read1',type:'function',function:{name:'repo_read',arguments:'{}'}}]},
    {role:'tool',tool_call_id:'read1',content:JSON.stringify({content:'A previously requested file.'})}] });
  assert.equal(calls[0].chat_template_kwargs.enable_thinking,true);
  assert.equal(calls[1].chat_template_kwargs.enable_thinking,false);
});

test('adaptive thinking retains reasoning when a routine read needs correction', async()=>{
  const calls=[];
  const model=createOfficeAIModel({env:{...settings,OFFICE_AI_THINKING_MODE:'adaptive'},fetcher:async(_,opts)=>{calls.push(JSON.parse(opts.body));return result();}});
  await model({messages:[...messages,{role:'assistant',content:null,tool_calls:[{id:'read1',type:'function',function:{name:'repo_read',arguments:'{}'}}]},
    {role:'tool',tool_call_id:'read1',content:JSON.stringify({error:'This revision is stale. Read the current source.',correctionsRemaining:2})}]});
  assert.equal(calls[0].chat_template_kwargs.enable_thinking,true);
});

test('adaptive thinking retains reasoning while reviewing mixed write and read receipts',async()=>{
  let sent;
  const model=createOfficeAIModel({env:{...settings,OFFICE_AI_THINKING_MODE:'adaptive'},fetcher:async(_,opts)=>{sent=JSON.parse(opts.body);return result();}});
  await model({messages:[...messages,{role:'assistant',content:null,tool_calls:[
    {id:'edit1',type:'function',function:{name:'repo_edit',arguments:'{}'}},
    {id:'read1',type:'function',function:{name:'repo_read',arguments:'{}'}}]},
    {role:'tool',tool_call_id:'edit1',content:'The edit was staged.'},
    {role:'tool',tool_call_id:'read1',content:'The next file to inspect.'}]});
  assert.equal(sent.chat_template_kwargs.enable_thinking,true);
});

test('empty model results recover before they can be mistaken for task completion', async () => {
  let calls=0;
  const model=createOfficeAIModel({env:settings,fetcher:async()=>++calls===1?json({choices:[{message:{content:null,tool_calls:[]}}]}):result()});
  assert.equal((await model({messages})).content,'Done.'); assert.equal(calls,2);
});

test('malformed tool call containers recover instead of returning an empty assistant message', async()=>{
  for(const toolCalls of ['invalid-tools',{length:1}]) {
    let calls=0;
    const model=createOfficeAIModel({env:settings,fetcher:async()=>++calls===1?json({choices:[{message:{content:null,tool_calls:toolCalls}}]}):result()});
    assert.equal((await model({messages})).content,'Done.');assert.equal(calls,2);
  }
});
