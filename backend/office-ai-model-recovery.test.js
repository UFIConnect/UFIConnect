'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOfficeAIModel, DEFAULT_MODEL } = require('./office-ai');
const settings = { OFFICE_AI_RELAY_URL: 'https://office.owner.workers.dev', OFFICE_AI_RELAY_SECRET: 'relay-secret-for-tests-00000000000000000000',
  OFFICE_AI_FALLBACK_MODELS: '@cf/meta/llama-3.3-70b-instruct-fp8-fast,@cf/qwen/qwen3-30b-a3b-fp8' };
const messages = [{ role: 'user', content: 'Inspect the repository.' }];
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const result = () => json({ choices: [{ message: { content: 'Done.', reasoning_content: 'private reasoning' } }] });

test('public task output removes complete leading thought wrappers and retains only the final answer', async () => {
  const final = 'The repository supports ten earlier draft versions.';
  for (const content of [
    `thought\n<channel|>${final}`,
    `<|channel>thought\nprivate provider analysis<channel|>${final}`,
    `thought\nprivate provider analysis<channel|>${final}`,
    `<think>private provider analysis</think>${final}`,
    `<think>private provider analysis</think>\n<|channel>thought\nmore private analysis<channel|>${final}`,
  ]) {
    const model = createOfficeAIModel({ env: settings, fetcher: async () => json({ choices: [{ message: {
      content, reasoning_content: 'separate private analysis', reasoning: 'other private analysis',
    } }] }) });
    assert.deepEqual(await model({ messages }), { role: 'assistant', content: final });
  }
});

test('thought normalization preserves ordinary prose, quoted protocol examples, and structured tool calls', async () => {
  const prose = 'A thought about the parser: use `<think>example</think>` or `<|channel>thought\\n<channel|>` as test data.';
  for (const content of [prose, 'thought\nA normal poem.', 'thought\nAn unfinished ordinary heading',
    '    const indented = true;\n', '\n  plain whitespace is meaningful here  \n']) {
    const plain = createOfficeAIModel({ env: settings, fetcher: async () => json({ choices: [{ message: { content } }] }) });
    assert.equal((await plain({ messages })).content, content);
  }
  const indentedAnswer = '    const indented = true;\n';
  const wrappedCode = createOfficeAIModel({ env: settings, fetcher: async () => json({ choices: [{ message: {
    content: `<think>private analysis</think>${indentedAnswer}`,
  } }] }) });
  assert.equal((await wrappedCode({ messages })).content, indentedAnswer);
  const tool_calls = [{ id: 'read-wrapper', type: 'function', function: { name: 'repo_read', arguments: '{"path":"README.md"}' } }];
  const tool = createOfficeAIModel({ env: settings, fetcher: async () => json({ choices: [{ message: {
    content: '<|channel>thought\nprivate unfinished analysis', tool_calls, reasoning_content: 'private field',
  } }] }) });
  assert.deepEqual(await tool({ messages }), { role: 'assistant', content: '', tool_calls });
});

test('unfinished or answerless thought output uses bounded recovery instead of becoming a public task summary', async () => {
  for (const content of ['<|channel>thought\nprivate incomplete analysis', '<think>private incomplete analysis',
    '<think>private analysis</think>', '  \n\t ', '<think>private analysis</think>  \n']) {
    let calls = 0;
    const model = createOfficeAIModel({ env: settings, fetcher: async () => ++calls === 1
      ? json({ choices: [{ message: { content } }] }) : result() });
    assert.equal((await model({ messages })).content, 'Done.');
    assert.equal(calls, 2);
  }
});

test('chat normalizes the observed thought prefix before returning or recording an assistant reply', async () => {
  const { createOfficeAI } = require('./office-ai');
  const { EventEmitter } = require('node:events');
  const final = 'Ten earlier drafts are available.';
  const recorded = [];
  const memory = { retrieve: async () => ({ entries: [] }), record: async value => recorded.push(value) };
  const service = createOfficeAI({ env: settings, memory, fetcher: async () => json({ choices: [{ message: {
    content: `<|channel>thought\nprivate analysis<channel|>thought\n<channel|>${final}`,
    reasoning_content: 'separate private analysis',
  } }] }) });
  const res = new EventEmitter(); res.set = () => res; res.status = () => res;
  res.json = value => { res.body = value; res.writableEnded = true; return res; };
  await service.chat({ body: { message: 'Explain saved drafts.', memory: true, research: false } }, res);
  assert.equal(res.body.reply, final);
  assert.equal(recorded.find(item => item.role === 'assistant')?.content, final);
  assert.equal(JSON.stringify(res.body).includes('private analysis'), false);
});

test('a task-only model override preserves the configured chat and vision models and exposes its safe status', async () => {
  const {createOfficeAI}=require('./office-ai');const {EventEmitter}=require('node:events');
  const env={...settings,OFFICE_AI_TASK_MODEL:'@cf/zai-org/glm-5.3'};const calls=[];
  const fetcher=async(_,options)=>{calls.push(JSON.parse(options.body).model);return result();};
  const model=createOfficeAIModel({env,fetcher});await model({messages});
  await model({messages:[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,AAAA'}}]}]});
  const service=createOfficeAI({env,fetcher});
  const status={set(){},json(value){this.body=value;return this;}};await service.status({},status);
  assert.equal(status.body.model,DEFAULT_MODEL);assert.equal(status.body.visionModel,DEFAULT_MODEL);
  assert.equal(status.body.taskModel,'@cf/zai-org/glm-5.3');assert.equal(status.body.taskModelConfigured,true);
  const res=new EventEmitter();res.set=()=>res;res.status=()=>res;res.json=value=>{res.body=value;res.writableEnded=true;return res;};
  await service.chat({body:{message:'Explain how rainbows form.',memory:false,research:false}},res);
  assert.deepEqual(calls,['@cf/zai-org/glm-5.3',DEFAULT_MODEL,DEFAULT_MODEL]);
});

test('invalid task override fails once without inference while chat remains configured', async () => {
  const {createOfficeAI}=require('./office-ai');let called=false;
  const env={...settings,OFFICE_AI_TASK_MODEL:'https://arbitrary.example/private'};
  const model=createOfficeAIModel({env,fetcher:async()=>{called=true;return result();}});
  await assert.rejects(model({messages}),error=>error.noModelFallback===true&&/OFFICE_AI_TASK_MODEL/.test(error.publicMessage));
  assert.equal(called,false);
  const status={set(){},json(value){this.body=value;return this;}};await createOfficeAI({env}).status({},status);
  assert.equal(status.body.configured,true);assert.equal(status.body.taskModel,null);assert.equal(status.body.taskModelConfigured,false);
});

test('large task contexts skip known small recovery models before a permanent context rejection', async () => {
  const calls = [];
  const model = createOfficeAIModel({ env: { ...settings, OFFICE_AI_FALLBACK_MODELS:
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast,@cf/mistralai/mistral-small-3.1-24b-instruct,@cf/zai-org/glm-5.3' },
    fetcher: async (_, options) => { const body=JSON.parse(options.body); calls.push(body.model); return body.model===DEFAULT_MODEL?json({},503):result(); } });
  const answer=await model({ messages:[{role:'user',content:'x'.repeat(200000)}] });
  assert.equal(answer.content,'Done.');assert.deepEqual(calls,[DEFAULT_MODEL,'@cf/zai-org/glm-5.3']);
});

test('recovery context envelope includes tool schemas instead of only conversation text', async () => {
  const calls=[];
  const model=createOfficeAIModel({env:{...settings,OFFICE_AI_FALLBACK_MODELS:'@cf/meta/llama-3.3-70b-instruct-fp8-fast,@cf/zai-org/glm-5.3'},
    fetcher:async(_,options)=>{const body=JSON.parse(options.body);calls.push(body.model);return body.model===DEFAULT_MODEL?json({},503):result();}});
  await model({messages,tools:[{type:'function',function:{name:'inspect',description:'d'.repeat(24000),parameters:{type:'object',properties:{},required:[]}}}]});
  assert.deepEqual(calls,[DEFAULT_MODEL,'@cf/zai-org/glm-5.3']);
});

test('known text-only models in a vision pool are skipped without sending them uploaded images', async () => {
  const calls=[];
  const model=createOfficeAIModel({env:{...settings,OFFICE_AI_VISION_FALLBACK_MODELS:'@cf/zai-org/glm-5.3,@cf/deepseek-ai/deepseek-v4.1-flash-1017'},
    fetcher:async(_,options)=>{const body=JSON.parse(options.body);calls.push(body.model);return body.model===DEFAULT_MODEL?json({},503):result();}});
  await model({messages:[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,AAAA'}}]}]});
  assert.deepEqual(calls,[DEFAULT_MODEL,'@cf/deepseek-ai/deepseek-v4.1-flash-1017']);
});

test('uploaded image bytes use a separate conservative allowance rather than literal text-token counting', async () => {
  const calls=[];
  const model=createOfficeAIModel({env:{...settings,OFFICE_AI_VISION_FALLBACK_MODELS:'@cf/meta/llama-4-scout-17b-16e-instruct'},
    fetcher:async(_,options)=>{const body=JSON.parse(options.body);calls.push(body.model);return body.model===DEFAULT_MODEL?json({},503):result();}});
  await model({messages:[{role:'user',content:[{type:'text',text:'Inspect the photo.'},{type:'image_url',image_url:{url:'data:image/png;base64,'+'A'.repeat(200000)}}]}]});
  assert.deepEqual(calls,[DEFAULT_MODEL,'@cf/meta/llama-4-scout-17b-16e-instruct']);
});

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

test('switching to vision and back preserves the failed text primary circuit', async () => {
  const primary='@cf/zai-org/glm-5.3',vision='@cf/meta/llama-4-scout-17b-16e-instruct';const calls=[];
  const env={...settings,OFFICE_AI_TASK_MODEL:primary,OFFICE_AI_FALLBACK_MODELS:DEFAULT_MODEL,
    OFFICE_AI_VISION_MODEL:vision,OFFICE_AI_VISION_FALLBACK_MODELS:'@cf/deepseek-ai/deepseek-v4.1-flash-1017'};
  const model=createOfficeAIModel({env,fetcher:async(_,options)=>{const body=JSON.parse(options.body);calls.push(body.model);return body.model===primary?json({},503):result();}});
  await model({messages});
  await model({messages:[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,AAAA'}}]}]});
  await model({messages});
  assert.deepEqual(calls,[primary,DEFAULT_MODEL,vision,DEFAULT_MODEL]);
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
