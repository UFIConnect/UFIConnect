'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createRuntimeMemoryRecovery } = require('./runtime-memory-recovery');
const MB = 1024 * 1024;

test('normal requests never collect and runtimes without explicit GC remain functional', async () => {
  let collections = 0;
  const recovery = createRuntimeMemoryRecovery({ collect: () => { collections++; } });
  assert.equal((await recovery.recover('normal')).reason, 'normal');
  assert.equal(collections, 0);
  const unavailable = createRuntimeMemoryRecovery({ collect: null });
  assert.equal((await unavailable.recover('critical')).reason, 'unavailable');
  assert.equal(unavailable.status().attempts, 0);
});

test('pressure collection is single-flight and throttled across repeated critical trims', async () => {
  let timestamp = 0, release, collections = 0;
  const recovery = createRuntimeMemoryRecovery({ now: () => timestamp, cooldownMs: 300000,
    collect: () => { collections++; return new Promise(resolve => { release = resolve; }); },
    readMemory: () => ({ rss: 350 * MB, heapUsed: (collections ? 120 : 240) * MB }) });
  const first = recovery.recover('pressure'), joined = recovery.recover('critical');
  assert.equal(first, joined);
  await Promise.resolve(); assert.equal(collections, 1);
  assert.equal(recovery.status().running, true);
  release(); const result = await first;
  assert.equal(result.recovered, true); assert.equal(result.before.heapUsedMB, 240); assert.equal(result.after.heapUsedMB, 120);
  assert.equal((await recovery.recover('critical')).reason, 'cooldown');
  timestamp = 300000;
  const next = recovery.recover('critical'); await Promise.resolve(); release(); await next;
  assert.equal(collections, 2); assert.equal(recovery.status().completed, 2);
});

test('collection errors are contained, counted and subject to the same cooldown', async () => {
  const recovery = createRuntimeMemoryRecovery({ collect: () => { throw Error('private implementation detail'); }, now: () => 0 });
  assert.deepEqual(await recovery.recover('critical'), { recovered: false, reason: 'collection-failed' });
  assert.equal(recovery.status().failures, 1); assert.equal(recovery.status().running, false);
  assert.equal((await recovery.recover('critical')).reason, 'cooldown');
  assert.equal(JSON.stringify(recovery.status()).includes('private'), false);
});

test('Node 24 asynchronous collection actually reclaims released JavaScript allocations', () => {
  const result = spawnSync(process.execPath, ['--expose-gc', '-e', `
    const {createRuntimeMemoryRecovery}=require(${JSON.stringify(require.resolve('./runtime-memory-recovery'))});
    (async()=>{
      let released=Array.from({length:180000},(_,index)=>({index,text:'x'.repeat(180)}));
      const before=process.memoryUsage().heapUsed;
      released=null;
      const recovery=createRuntimeMemoryRecovery();
      const result=await recovery.recover('critical');
      if(!result.recovered||process.memoryUsage().heapUsed>=before/2)process.exitCode=1;
    })().catch(()=>{process.exitCode=1;});
  `], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});
