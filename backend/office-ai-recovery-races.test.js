'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {createOfficeAITasks}=require('./office-ai-tasks');
const {applyRepositoryEdit,blobSha,rangeOf}=require('./office-ai-repository');
const HEAD='a'.repeat(40),CANDIDATE='b'.repeat(40),FILE='backend/example.js',BEFORE='const timeout = 30;\n',AFTER='const timeout = 90;\n';
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const tool=(name,args={})=>({content:null,tool_calls:[{id:randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const read=()=>tool('repo_read',{path:FILE});
const edit=()=>tool('repo_edit',{path:FILE,edits:[{find:'timeout = 30',replace:'timeout = 90'}]});
const health=()=>tool('office_command',{id:'health.check'});
const input=extra=>({clientRequestId:randomUUID(),target:'full-access',memory:false,message:'Check service health.',permissions:{operate:true},...extra});
async function invoke(handler,body={},id){const res={code:200,set(){return this;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await handler({body,params:{id}},res);return res;}
async function fixture(t,options={}){
  const pg=new PGlite();await pg.waitReady;t.after(()=>pg.close());let queryHook;
  const query=async(sql,params)=>{await queryHook?.(sql,params);return /pg_advisory_xact_lock/.test(sql)?{rows:[]}:pg.query(sql,params);};
  const db={query,isConnected:()=>true,withClient:fn=>fn({query})};
  const source={path:FILE,sha:blobSha(BEFORE),content:BEFORE,mode:'100644'};
  const state={models:0,operations:0,reads:0,edits:0,candidates:[]};
  const repository={repository:'fixture/recovery',configured:()=>true,redact:String,head:async()=>({sha:HEAD}),
    readFile:async()=>{state.reads++;return rangeOf(source);},
    edit:async({ref,...args},staged)=>{assert.equal(ref,HEAD);state.edits++;return applyRepositoryEdit(staged||source,args);},
    candidate:async args=>{state.candidates.push(structuredClone(args));return{sha:CANDIDATE,baseSha:HEAD,published:false};},
    checks:async()=>[{sha:CANDIDATE,status:'completed',conclusion:'success'}]};
  const service=createOfficeAITasks({db,repository,env:{},
    model:async()=>{state.models++;return state.models===1?health():{content:'Service health was checked.'};},
    getControls:()=>[{id:'health.check',label:'Check service health',target:'api',available:true,requiresConfirmation:false}],
    executeControl:async()=>{state.operations++;return{results:[{service:'api',runId:'health-race-receipt',ok:true}]};},...options});
  t.after(()=>service.stop());
  return{service,state,db,repository,hook:fn=>{queryHook=fn;},raw:async id=>(await pg.query('SELECT data,lease_id,lease_until FROM office_ai_tasks WHERE id=$1',[id])).rows[0]};
}
async function finish(service,id){for(let step=0;step<45;step++){await service.runOne(id);const current=(await invoke(service.detail,{},id)).body.task;if(['succeeded','failed','cancelled','needs_confirmation','needs_continuation'].includes(current.status))return current;}assert.fail('The task did not finish');}

test('recovery during a delayed connection refresh yields cooperatively without cancellation or overlapping execution',async t=>{
  const entered=gate(),release=gate();let refreshes=0;t.after(()=>release.resolve());
  const f=await fixture(t,{refreshConnections:async()=>{if(++refreshes===1){entered.resolve();await release.promise;}}});
  const created=(await invoke(f.service.create,input())).body.task;
  const running=f.service.runOne(created.id);await entered.promise;
  const original=await f.raw(created.id);assert.ok(original.lease_id);
  const recovered=await invoke(f.service.recover,{confirmed:true},created.id);
  assert.equal(recovered.code,202);assert.equal(recovered.body.task.status,'recovery_requested');
  assert.equal((await f.raw(created.id)).lease_id,original.lease_id);
  assert.equal(await f.service.runOne(created.id),false,'A replacement cannot overlap the worker preparing the connection');
  assert.equal(f.state.models,0);assert.equal(f.state.operations,0);
  release.resolve();await running;
  assert.equal((await f.raw(created.id)).data.status,'recovery_requested');
  await f.service.runOne(created.id);
  const handedOff=(await f.raw(created.id)).data;
  assert.equal(handedOff.status,'working');assert.deepEqual(handedOff.permissions,created.permissions);assert.equal(f.state.models,0);
  const finished=await finish(f.service,created.id);
  assert.equal(finished.status,'succeeded');assert.equal(f.state.operations,1);assert.equal(finished.commands[0].results[0].runId,'health-race-receipt');
});

test('cancellation during connection preparation never executes a model or external action',async t=>{
  const entered=gate(),release=gate();t.after(()=>release.resolve());
  const f=await fixture(t,{refreshConnections:async()=>{entered.resolve();await release.promise;}});
  const created=(await invoke(f.service.create,input())).body.task;
  const running=f.service.runOne(created.id);await entered.promise;
  assert.equal((await invoke(f.service.cancel,{},created.id)).body.task.status,'cancel_requested');
  release.resolve();await running;
  assert.equal((await f.raw(created.id)).data.status,'cancelled');
  assert.equal(f.state.models,0);assert.equal(f.state.operations,0);assert.equal(await f.service.runOne(created.id),false);
});

test('recovery rejecting the pre-execution checkpoint never marks an unstarted invocation uncertain',async t=>{
  const f=await fixture(t),created=(await invoke(f.service.create,input())).body.task;
  await f.service.runOne(created.id);
  const entered=gate(),release=gate();let blocked=false;t.after(()=>release.resolve());
  f.hook(async(sql,params)=>{
    if(blocked||!sql.includes("status NOT IN ('cancel_requested','recovery_requested')")||typeof params?.[1]!=='string')return;
    const data=JSON.parse(params[1]);if(!data.internal.pendingCalls?.[0]?.started)return;
    blocked=true;entered.resolve();await release.promise;
  });
  const running=f.service.runOne(created.id);await entered.promise;
  const before=await f.raw(created.id);
  assert.notEqual(before.data.internal.pendingCalls[0].started,true);assert.equal(f.state.operations,0);
  await invoke(f.service.recover,{confirmed:true},created.id);
  assert.equal(await f.service.runOne(created.id),false,'The existing lease remains authoritative until preparation yields');
  release.resolve();await running;
  const retained=(await f.raw(created.id)).data;
  assert.equal(retained.status,'recovery_requested');assert.notEqual(retained.internal.pendingCalls[0].started,true);
  assert.equal(retained.confirmation,null);assert.equal(f.state.operations,0);
  await f.service.runOne(created.id);
  assert.equal((await f.raw(created.id)).data.status,'working');
  const finished=await finish(f.service,created.id);
  assert.equal(finished.status,'succeeded');assert.equal(f.state.operations,1);
  assert.equal(finished.commands[0].results[0].runId,'health-race-receipt');
});

test('recovery preserves a genuinely started uncertain operation and prevents automatic replay',async t=>{
  const entered=gate(),release=gate();let executions=0;t.after(()=>release.resolve());
  const f=await fixture(t,{executeControl:async()=>{executions++;entered.resolve();await release.promise;throw Object.assign(Error('Receipt unavailable'),{status:502,outcomeUnknown:true});}});
  const created=(await invoke(f.service.create,input())).body.task;
  await f.service.runOne(created.id);
  const running=f.service.runOne(created.id);await entered.promise;
  assert.equal((await f.raw(created.id)).data.internal.pendingCalls[0].started,true);
  await invoke(f.service.recover,{confirmed:true},created.id);release.resolve();await running;
  assert.equal((await f.raw(created.id)).data.status,'recovery_requested');
  await f.service.runOne(created.id);await f.service.runOne(created.id);
  const paused=(await f.raw(created.id)).data;
  assert.equal(paused.status,'needs_confirmation');assert.equal(paused.confirmation.uncertain,true);assert.equal(executions,1);
  assert.equal((await invoke(f.service.confirm,{confirmed:true,confirmationId:paused.confirmation.id},created.id)).code,409);
  assert.equal((await invoke(f.service.recover,{confirmed:true},created.id)).code,409);
  assert.equal(await f.service.runOne(created.id),false);assert.equal(executions,1);
});

test('a rejected edit is corrected and verified before finishing the original request',async t=>{
  let turn=0,failFirst=true;
  const message='Adjust backend/example.js to use a 90-second timeout and check service health.';
  const f=await fixture(t,{model:async({messages})=>{
    turn++;
    assert.ok(messages.some(item=>item.role==='user'&&item.content===message),'The original objective remains present after the error');
    if(turn===1)return read();if(turn===2)return edit();
    if(turn===3){assert.ok(messages.some(item=>item.role==='tool'&&item.content.includes('Read the current file')));return read();}
    if(turn===4)return edit();if(turn===5)return health();
    return{content:'The timeout is now 90 seconds and the service health check passed.'};
  }});
  const originalEdit=f.repository.edit;
  f.repository.edit=async(...args)=>{if(failFirst){failFirst=false;throw Object.assign(Error('Read the current file and correct the edit.'),{status:422,publicMessage:'Read the current file and correct the edit.'});}return originalEdit(...args);};
  const created=(await invoke(f.service.create,input({message,permissions:{editCode:true,operate:true}}))).body.task;
  const finished=await finish(f.service,created.id);
  assert.equal(finished.status,'succeeded');assert.equal(finished.message,message);assert.deepEqual(finished.permissions,created.permissions);
  assert.equal(f.state.reads,2);assert.equal(f.state.edits,1);assert.equal(f.state.operations,1);
  assert.ok(finished.events.some(event=>event.kind==='repo_edit'&&event.status==='failed'));
  assert.equal(finished.changedFiles[0].after,AFTER);assert.equal(f.state.candidates[0].files[0].content,AFTER);
  assert.equal(finished.checks[0].sha,CANDIDATE);assert.equal(finished.checks[0].conclusion,'success');
  assert.equal(finished.commands[0].results[0].runId,'health-race-receipt');assert.equal(finished.commit.published,false);
});

test('a successful unrelated health check cannot substitute for the requested source-file adjustment',async t=>{
  let turn=0;
  const f=await fixture(t,{model:async({messages})=>{
    turn++;if(turn===1)return health();
    if(turn===2)return{content:'The service looks healthy; I can adjust the file next.'};
    if(turn===3){assert.ok(messages.some(item=>/SERVER REVIEW/.test(item.content||'')));return read();}
    if(turn===4)return edit();return{content:'The requested file was adjusted and verified.'};
  }});
  const created=(await invoke(f.service.create,input({message:'Adjust backend/example.js to use a 90-second timeout.',permissions:{editCode:true,operate:true}}))).body.task;
  await f.service.runOne(created.id);await f.service.runOne(created.id);await f.service.runOne(created.id);
  assert.notEqual((await f.raw(created.id)).data.status,'succeeded');assert.equal(f.state.operations,1);assert.equal(f.state.edits,0);
  const finished=await finish(f.service,created.id);
  assert.equal(finished.status,'succeeded');assert.equal(finished.changedFiles[0].after,AFTER);assert.equal(f.state.edits,1);
});
