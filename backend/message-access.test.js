'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {createMessageAccess}=require('./message-access');
test('message authorization sees blocks and private profile relationships changed by another worker',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`CREATE TABLE blocks(blocker_id TEXT,blocked_id TEXT);
    CREATE TABLE connections(from_id TEXT,to_id TEXT,status TEXT);
    CREATE TABLE follows(follower_id TEXT,following_id TEXT);
    CREATE TABLE direct_messages(sender_id TEXT,receiver_id TEXT);`);
  const access=createMessageAccess({db:{isConnected:()=>true,query:(...args)=>db.query(...args)},isDBId:()=>true});
  assert.deepEqual(await access.relationship('alice','bob'),{blocked:false,connected:false,canViewPrivate:false,existing:false});
  await db.query('INSERT INTO follows VALUES($1,$2)',['bob','alice']);
  assert.equal((await access.relationship('alice','bob')).canViewPrivate,true);
  await db.exec('DELETE FROM follows');
  await db.query('INSERT INTO connections VALUES($1,$2,$3)',['alice','bob','accepted']);
  assert.equal((await access.relationship('alice','bob')).connected,true);
  await db.query('INSERT INTO direct_messages VALUES($1,$2)',['bob','alice']);
  assert.equal((await access.relationship('alice','bob')).existing,true);
  await db.query('INSERT INTO blocks VALUES($1,$2)',['bob','alice']);
  assert.equal((await access.relationship('alice','bob')).blocked,true);
  assert.deepEqual([...await access.blockedIds('alice')],['bob']);
});
test('message permission storage failure cannot fall back to stale worker permissions',async()=>{
  const access=createMessageAccess({db:{isConnected:()=>false},isDBId:()=>true,localRelationship:()=>({blocked:false})});
  await assert.rejects(access.relationship('alice','bob'),error=>error.status===503);
  await assert.rejects(access.blockedIds('alice'),error=>error.status===503);
});
