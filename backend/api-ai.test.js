'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const { registerAPIKeyRoutes } = require('./api-keys');
const { registerAPIAIRoutes } = require('./api-ai');

async function fixture(t) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec('CREATE TABLE users(id UUID PRIMARY KEY,name TEXT,billing_closed BOOLEAN NOT NULL DEFAULT false)');
  const db = { isConnected: () => true, query: (sql, params) => pg.query(sql, params) };
  const app = express(); app.use(express.json());
  const apiKeys = registerAPIKeyRoutes(app, { db, topics: [], readFeed: async () => ({posts:[]}), requireOfficeToken: (_req,_res,next) => next() });
  const calls = []; let error;
  registerAPIAIRoutes(app, { apiKeys, complete: async input => { calls.push(input); if(error) throw error; return {role:'assistant',content:'A useful answer.'}; } });
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = async (path,key,body) => {
    const response = await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})},body:JSON.stringify(body)});
    return {status:response.status,data:await response.json(),headers:response.headers};
  };
  return {pg,apiKeys,calls,request,setError:value=>{error=value;}};
}

test('chat and content use separate scoped keys and never supply Office tools or context', async t => {
  const {apiKeys,calls,request} = await fixture(t);
  const chat = await apiKeys.create({name:'Chat',type:'ai-chat',scopes:['ai:chat']});
  const content = await apiKeys.create({name:'Content',type:'ai-content',scopes:['content:generate']});
  const input = {messages:[{role:'user',content:'Explain solar panels.'}]};
  assert.equal((await request('/api/v1/chat/completions',null,input)).status,401);
  assert.equal((await request('/api/v1/chat/completions',content.key,input)).status,403);
  assert.equal(calls.length,0);
  const result = await request('/api/v1/chat/completions',chat.key,input);
  assert.equal(result.status,200);
  assert.equal(result.data.choices[0].message.content,'A useful answer.');
  assert.equal(result.data.budget.remaining,199);
  assert.match(result.headers.get('cache-control'),/no-store/);
  assert.deepEqual(calls[0].tools,[]);
  assert.equal(calls[0].messages.length,2);
  assert.doesNotMatch(JSON.stringify(calls),/office_command|memory_search|repo_read/);
  const draft = await request('/api/v1/content/generations',content.key,{kind:'caption',tone:'friendly',platform:'Instagram',prompt:'A sunrise.'});
  assert.equal(draft.status,200);
  assert.equal(draft.data.kind,'caption');
  assert.match(calls[1].messages[0].content,/caption.*friendly/);
  assert.equal((await request('/api/v1/content/generations',chat.key,{prompt:'A post'})).status,403);
});

test('invalid generation options do not call a provider or spend daily budget', async t => {
  const {apiKeys,calls,request,pg} = await fixture(t);
  const chat = await apiKeys.create({name:'Chat',type:'ai-chat',scopes:['ai:chat']});
  for(const body of [{messages:[]},{messages:[{role:'tool',content:'x'}]},{messages:[{role:'user',content:'x'}],tools:[{}]},
    {messages:[{role:'user',content:'x'}],max_tokens:9000},{messages:[{role:'user',content:'x'.repeat(32001)}]}]) {
    assert.equal((await request('/api/v1/chat/completions',chat.key,body)).status,400);
  }
  const content = await apiKeys.create({name:'Content',type:'ai-content',scopes:['content:generate']});
  assert.equal((await request('/api/v1/content/generations',content.key,{prompt:'hi',kind:'unsupported'})).status,400);
  assert.equal(calls.length,0);
  assert.equal((await pg.query('SELECT count(*)::int AS count FROM ufi_api_key_generation_usage')).rows[0].count,0);
});

test('daily exhaustion, revocation and provider failure never bypass scope or leak credentials', async t => {
  const {apiKeys,calls,request,pg,setError} = await fixture(t);
  const chat = await apiKeys.create({name:'Chat',type:'ai-chat',scopes:['ai:chat']});
  await apiKeys.consumeGeneration(chat.apiKey.id,'ai:chat');
  await pg.query('UPDATE ufi_api_key_generation_usage SET requests=200 WHERE key_id=$1',[chat.apiKey.id]);
  const input = {messages:[{role:'user',content:'Hello'}]};
  assert.equal((await request('/api/v1/chat/completions',chat.key,input)).status,429);
  assert.equal(calls.length,0);
  const other = await apiKeys.create({name:'Other chat',type:'ai-chat',scopes:['ai:chat']});
  setError(new Error('private-provider-secret'));
  const failed = await request('/api/v1/chat/completions',other.key,input);
  assert.equal(failed.status,502);
  assert.doesNotMatch(JSON.stringify(failed.data),/private-provider-secret/);
  assert.equal((await pg.query('SELECT requests FROM ufi_api_key_generation_usage WHERE key_id=$1',[other.apiKey.id])).rows[0].requests,1);
  await apiKeys.revoke(other.apiKey.id);
  assert.equal((await request('/api/v1/chat/completions',other.key,input)).status,401);
});
