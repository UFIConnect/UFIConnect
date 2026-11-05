'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createOfficeAI,createOfficeAIModel}=require('./office-ai');
const settings={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'fixture-cloudflare-token'};
const answer=()=>Response.json({choices:[{message:{role:'assistant',content:'Verified answer.'}}]});
async function invoke(handler,body){
  const res=new EventEmitter();res.statusCode=200;res.set=()=>res;
  res.status=code=>{res.statusCode=code;return res;};
  res.json=value=>{res.body=value;res.writableEnded=true;return res;};
  await handler({body,params:{}},res);return res;
}

test('memory, public research and selected workspace retrieval overlap before inference and retain their evidence',async()=>{
  let release,request,inferences=0;
  const barrier=new Promise(resolve=>{release=resolve;}),started=new Set();
  const memory={search:async()=>{started.add('memory');await barrier;return{entries:[{id:'earlier-work',kind:'note',mode:'chat',title:'Earlier decision',status:'recorded',content:'The project uses a green button.',createdAt:'2026-11-05T10:00:00Z'}]};},record:async()=>{}};
  const service=createOfficeAI({env:{...settings,OFFICE_LINEAR_TOKEN:'linear-fixture-token-for-parallel-test'},memory,fetcher:async(url,options)=>{
    if(url.startsWith('https://api.linear.app/')){
      started.add('workspace');await barrier;
      return Response.json({data:{issues:{nodes:[{identifier:'UFI-1',title:'Workspace decision',description:'Keep the green button accessible.',url:'https://linear.app/example/issue/UFI-1',state:{name:'Open'}}]}}});
    }
    if(url.endsWith('/websearch/')){
      started.add('research');await barrier;
      return Response.json({items:[{title:'Public source',url:'https://example.com/primary',description:'Public evidence for the answer.'}]});
    }
    inferences++;request=JSON.parse(options.body);return answer();
  }});
  const pending=invoke(service.chat,{message:'Compare our earlier project decision with the available evidence.',sourceIds:['linear'],research:true});
  let result;
  try{
    // One event-loop turn drains preparation's microtasks. All independent
    // branches must start while none can finish; no latency threshold is used.
    await new Promise(setImmediate);
    assert.deepEqual([...started].sort(),['memory','research','workspace']);
    assert.equal(inferences,0,'Inference waits for every selected evidence source');
  }finally{release();result=await pending;}
  assert.equal(result.statusCode,200);assert.equal(inferences,1);
  const context=JSON.parse(request.messages[1].content.split('\n').slice(1).join('\n'));
  assert.equal(context.memories[0].id,'earlier-work');
  assert.match(JSON.stringify(context),/Keep the green button accessible/);
  assert.match(JSON.stringify(context),/Public evidence for the answer/);
  assert.equal(result.body.sources.length,2);assert.equal(result.body.research.status,'verified');
  assert.deepEqual(context.sources.map(source=>source.sourceId),[1,2],'Parallel completion preserves unique citation identifiers');
  assert.deepEqual(context.sources.map(source=>source.url),result.body.sources.map(source=>source.url),'Citation order matches the displayed evidence');
  for(const name of ['preparationMs','inferenceMs','totalMs'])assert.ok(Number.isFinite(result.body.performance[name])&&result.body.performance[name]>=0);
});

test('adaptive ordinary chat skips extra thinking while complex, deep, Office and attachment requests retain it',async()=>{
  const cases=[
    {body:{message:'What is a closure?'},thinking:false},
    {body:{message:'What is a closure?',perspective:'deep'},thinking:true},
    {body:{message:'Analyze the failure and compare the security tradeoffs in detail.'},thinking:true},
    {body:{message:'Check the service observations.',mode:'office'},thinking:true},
    {body:{message:'Explain this note.',attachments:[{name:'note.txt',type:'text/plain',data:'Explain the current project decision.'}]},thinking:true},
    {body:{message:'What is a closure?'},env:{OFFICE_AI_THINKING_MODE:'thinking'},thinking:true},
  ];
  for(const row of cases){
    let request;
    const service=createOfficeAI({env:{...settings,...row.env},fetcher:async(_url,options)=>{request=JSON.parse(options.body);return answer();}});
    const result=await invoke(service.chat,{...row.body,memory:false,research:false});
    assert.equal(result.statusCode,200,row.body.message);
    assert.equal(request.chat_template_kwargs.enable_thinking,row.thinking,JSON.stringify(row));
    assert.equal(request.max_tokens,8192,'Latency policy preserves the output allowance');
  }
});

test('adaptive task thinking skips only successful routine receipts and preserves error investigation and mutation checks',async()=>{
  const user={role:'user',content:'Inspect the repository and complete the requested work.'};
  const exchange=(name,result)=>[user,{role:'assistant',content:null,tool_calls:[{id:'read-1',type:'function',function:{name,arguments:'{}'}}]},{role:'tool',tool_call_id:'read-1',content:JSON.stringify(result)}];
  const cases=[
    {messages:[user],thinking:true},
    {messages:exchange('repo_read',{path:'README.md',content:'Verified source text.'}),thinking:false},
    {messages:exchange('repo_read',{error:'The source could not be read.'}),thinking:true},
    {messages:exchange('repo_read',{ok:false}),thinking:true},
    {messages:exchange('repo_read',{status:'unknown'}),thinking:true},
    {messages:exchange('repo_edit',{path:'README.md',status:'succeeded'}),thinking:true},
    {messages:exchange('repo_read',{content:'Verified source text.'}),env:{OFFICE_AI_THINKING_MODE:'thinking'},thinking:true},
  ];
  for(const row of cases){
    let request;
    const model=createOfficeAIModel({env:{...settings,...row.env},fetcher:async(_url,options)=>{request=JSON.parse(options.body);return answer();}});
    assert.equal((await model({messages:row.messages})).content,'Verified answer.');
    assert.equal(request.chat_template_kwargs.enable_thinking,row.thinking,JSON.stringify(row));
  }
});
