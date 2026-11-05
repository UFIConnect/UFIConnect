'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {createOfficeAIRevisions}=require('./office-ai-revisions');
const {createOfficeAIFunctions}=require('./office-ai-functions');
const {createOfficeAICode}=require('./office-ai-code');
const {DATA_ANALYSIS_CODE}=require('./office-ai-data');
const {createTaskRecovery}=require('./office-ai-recovery');
const {createResearchTool}=require('./office-ai-research');
async function store(t){const pg=new PGlite();await pg.waitReady;t.after(()=>pg.close());const query=(sql,args)=>/pg_advisory_xact_lock/.test(sql)?Promise.resolve({rows:[]}):pg.query(sql,args);const db={query,isConnected:()=>true,withClient:fn=>fn({query})};const env={OAUTH_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};return{pg,db,env,revisions:createOfficeAIRevisions({db,env})};}
const definition=(n=1)=>({name:'Multiply',description:'Multiply a number',code:`return input.value*${n};`,parameters:{type:'object',properties:{value:{type:'number'}},required:['value'],additionalProperties:false}});

test('encrypted function versions keep two prior copies, reject stale updates, and restore verified content',async t=>{
 const f=await store(t),id=randomUUID(),runtime={configured:()=>true,execute:async({code,input})=>({result:{code,input},logs:[]}),tool:{}};
 const library=createOfficeAIFunctions({...f,runtime});let saved=await library.save({...definition(),id});
 assert.equal(saved.id,id);assert.notEqual(saved.versionId,id);
 for(let n=2;n<=4;n++)saved=await library.save({...definition(n),id,expectedRevision:saved.revision});
 const history=await library.history(id);assert.equal(history.length,3);assert.equal((await library.read({id})).value.code,'return input.value*4;');
 const raw=(await f.pg.query('SELECT encrypted_payload FROM office_ai_revisions')).rows;assert.ok(raw.every(row=>!row.encrypted_payload.includes('input.value')));
 await assert.rejects(library.save({...definition(5),id,expectedRevision:'a'.repeat(64)}),error=>error.status===409);
 await library.restore(id,history[2].id,saved.revision);assert.equal((await library.read({id})).value.code,'return input.value*2;');
 assert.equal((await library.history(id)).length,3);assert.equal((await library.list()).functions[0].id,id);
 assert.deepEqual((await library.run({id,input:{value:4}})).result.input,{value:4});
 await assert.rejects(library.run({id,input:{value:'4'}}),error=>error.status===400);
 const latest=await library.read({id});await library.remove(id,latest.revision);await assert.rejects(library.read({id}),error=>error.status===404);
});
test('function save replay uses a stable invocation ID, validates schema, and refuses embedded credentials',async t=>{
 const f=await store(t),runtime={configured:()=>true,tool:{}};const library=createOfficeAIFunctions({...f,runtime,env:{API_KEY:'private-credential-1234567890'}}),invocationId=randomUUID();
 const first=await library.tools.function_save.execute(definition(),{invocationId}),second=await library.tools.function_save.execute(definition(),{invocationId});assert.equal(first.id,invocationId);assert.equal(second.versionId,first.versionId);assert.equal((await library.history(first.id)).length,1);
 await assert.rejects(library.save({...definition(),code:'return "private-credential-1234567890";'}),error=>error.status===400);
 await assert.rejects(library.save({...definition(),parameters:{type:'object',properties:{items:{type:'array',items:{type:'number'}}}}}),error=>error.status===400);
 await f.pg.query('UPDATE office_ai_revisions SET revision=$1 WHERE id=$2',['a'.repeat(64),first.versionId]);
 await assert.rejects(library.read({id:first.id}),error=>error.status===503);
});
test('draft recovery keeps the current checkpoint and two older drafts while preserving external receipts',async t=>{
 const f=await store(t),recovery=createTaskRecovery(f),id=randomUUID();const task={id,status:'needs_continuation',message:'Fix this',permissions:{editCode:true},events:[],terminals:[{id:'confirmed-receipt'}],internal:{baseSha:'a'.repeat(40),files:[],messages:[],readRevisions:{},pendingCalls:[]},changedFiles:[]};
 for(let n=0;n<4;n++){task.internal.files=[{path:'backend/office-ai-example.js',content:String(n)}];await recovery.capture(task,'Draft '+n);}
 assert.equal(task.backups.length,3);const older=await recovery.snapshot(task,task.backups[2].id);assert.equal(older.value.files[0].content,'1');
 recovery.restore(task,older);assert.equal(task.internal.files[0].content,'1');assert.equal(task.terminals[0].id,'confirmed-receipt');assert.equal(task.permissions.editCode,true);assert.equal(task.continuation.reason,'rollback');
 assert.equal(recovery.retry(task,'step','code'),2000);assert.equal(recovery.retry(task,'step','code'),4000);assert.equal(recovery.retry(task,'step','code'),null);
 task.commit={sha:'b'.repeat(40),published:true};assert.throws(()=>recovery.restore(task,older),error=>error.status===409);
 task.commit=null;task.internal.pendingCalls=[{started:true}];assert.throws(()=>recovery.restore(task,older),error=>error.status===409);
});
test('trusted data helper computes CSV and JSON statistics from actual rows',async()=>{
 // Only our static authored helper is evaluated here. Model-supplied code is never evaluated on the host.
 const analyze=new Function('input',DATA_ANALYSIS_CODE);
 const csv=analyze({format:'csv',data:'name,score,team\r\n"A, One",10,red\r\nB,20,blue\r\nC,,red\r\n',groupBy:'team'});
 assert.equal(csv.rowCount,3);assert.equal(csv.sample[0].name,'A, One');assert.equal(csv.statistics.score.mean,15);assert.equal(csv.statistics.score.median,15);assert.equal(csv.statistics.score.missing,1);assert.equal(csv.statistics.score.standardDeviation,5);assert.deepEqual(csv.groups,[{value:'red',count:2},{value:'blue',count:1}]);
 const json=analyze({format:'json',data:JSON.stringify([{amount:2},{amount:4},{amount:9}])});assert.equal(json.statistics.amount.sum,15);assert.equal(json.statistics.amount.median,4);
 assert.throws(()=>analyze({format:'csv',data:'x,x\n1,2'}),/unique/);assert.throws(()=>analyze({format:'csv',data:'x,y\n"oops'}),/unclosed/);
});
test('code transport remains Cloudflare-only and requires a genuine isolated runtime receipt',async()=>{
 const env={OFFICE_AI_RELAY_URL:'https://test.workers.dev',OFFICE_AI_RELAY_SECRET:'x'.repeat(64)};let captured;
 const runtime=createOfficeAICode({env,fetcher:async(url,options)=>{captured={url,options};return Response.json({result:323,logs:[],runtime:'Cloudflare Dynamic Worker',network:false});}});
 assert.equal((await runtime.execute({code:'return input.a*19;',input:{a:17}})).result,323);assert.equal(captured.url,env.OFFICE_AI_RELAY_URL+'/execute');assert.equal(captured.options.redirect,'error');assert.equal(captured.options.headers.Authorization,'Bearer '+env.OFFICE_AI_RELAY_SECRET);
 assert.equal(createOfficeAICode({env:{...env,OFFICE_AI_RELAY_URL:'https://api.openai.com'}}).configured(),false);
 await assert.rejects(createOfficeAICode({env,fetcher:async()=>Response.json({result:323,logs:[]})}).execute({code:'return 323;'}),error=>error.status===502);
});
test('research separates inspected pages, search snippets and failed source reads',async()=>{
 const tool=createResearchTool({search:async query=>query==='bad'?Promise.reject(Error('unavailable')):{status:'verified',sources:[{url:'https://example.test/a',title:'A',description:'snippet'}]},web:{read:async url=>url.endsWith('/b')?Promise.reject(Error('blocked')):{url,content:'inspected page'}}});
 const result=await tool.execute({queries:['good','bad'],urls:['https://example.test/b']});assert.equal(result.pages.length,2);assert.equal(result.pages[0].status,'unavailable');assert.equal(result.pages[1].content,'inspected page');assert.equal(result.searches[1].status,'unavailable');assert.equal(result.snippets[0].description,'snippet');
});
