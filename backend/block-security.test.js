'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {createAppHarness,member}=require('./test-support/app-harness');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';

test('failed block and unblock transactions preserve durable policy and retries cannot report a memory-only success',async t=>{
 const pg=new PGlite();t.after(()=>pg.close());
 await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY,name TEXT,email TEXT,auth_version INTEGER DEFAULT 0,billing_closed BOOLEAN DEFAULT false);
  CREATE TABLE blocks(id TEXT PRIMARY KEY,blocker_id TEXT,blocked_id TEXT,UNIQUE(blocker_id,blocked_id));
  CREATE TABLE follows(follower_id TEXT,following_id TEXT);
  CREATE TABLE connections(from_id TEXT,to_id TEXT,status TEXT);`);
 await pg.query("INSERT INTO users(id,name,email) VALUES($1,'Alice','alice@example.invalid'),($2,'Bob','bob@example.invalid')",[A,B]);
 await pg.query('INSERT INTO follows VALUES($1,$2)',[A,B]);
 await pg.query("INSERT INTO connections VALUES($1,$2,'accepted')",[A,B]);
 let failInsert=true,failDelete=false;
 const app=await createAppHarness({connected:true,query:async(sql,args)=>{
  if(sql.startsWith('SELECT id FROM auth_sessions'))return{rows:[{id:args[0]}]};
  if(sql.includes('INSERT INTO blocks')&&failInsert){failInsert=false;throw Error('fixture storage failure');}
  if(sql.includes('DELETE FROM blocks')&&failDelete){failDelete=false;throw Error('fixture storage failure');}
  return pg.query(sql,args);
 }});t.after(()=>app.close());app.seedUser(member(A));app.seedUser(member(B));
 const path='/users/'+B+'/block';
 assert.equal((await app.request(path,{method:'POST',userId:A})).status,503);
 assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM blocks')).rows[0].n,0);
 assert.equal((await app.request(path,{method:'POST',userId:A})).status,200);
 assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM blocks')).rows[0].n,1);
 assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM follows')).rows[0].n,0);
 assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM connections')).rows[0].n,0);
 failDelete=true;
 assert.equal((await app.request(path,{method:'DELETE',userId:A})).status,503);
 assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM blocks')).rows[0].n,1);
 assert.equal((await app.request(path,{method:'DELETE',userId:A})).status,200);
 assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM blocks')).rows[0].n,0);
});
