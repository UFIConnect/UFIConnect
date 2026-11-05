'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {createTokenVault}=require('./token-vault');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const DRAFT_ROLLBACK_COPIES='unlimited';
const HISTORY_PAGE_SIZE=100;
const RECEIPT_COLUMNS='id,collection,record_key,sequence,revision,summary,metadata,created_at';
const problem=(status,message)=>Object.assign(new Error(message),{status,publicMessage:message});
const SCHEMA=`CREATE TABLE IF NOT EXISTS office_ai_revisions (
  id UUID PRIMARY KEY, collection TEXT NOT NULL, record_key UUID NOT NULL,
  sequence BIGSERIAL NOT NULL, revision CHAR(64) NOT NULL, summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb, encrypted_payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
); CREATE INDEX IF NOT EXISTS office_ai_revisions_latest ON office_ai_revisions(collection,record_key,sequence DESC)`;
const receipt=row=>({id:row.id,key:row.record_key,revision:row.revision,sequence:Number(row.sequence),summary:row.summary,
  ...row.metadata,createdAt:new Date(row.created_at).toISOString()});
function createOfficeAIRevisions({db,env=process.env}={}){
  let ready;
  const configured=()=>!!db?.isConnected?.()&&!!env.OAUTH_TOKEN_ENCRYPTION_KEY;
  async function storage(){
    if(!configured()||!db.withClient)throw problem(503,'Encrypted function and checkpoint storage is unavailable.');
    if(!ready)ready=(async()=>{for(const statement of SCHEMA.split(';').filter(value=>value.trim()))await db.query(statement);})().catch(error=>{ready=null;throw error;});await ready;
  }
  function identity(collection,key){if(!['function','task-draft'].includes(collection)||!UUID.test(key||''))throw problem(400,'Use a valid function or task identifier.');}
  async function historyPage(collection,key,{before,limit=HISTORY_PAGE_SIZE}={}){
    identity(collection,key);
    if(!Number.isInteger(limit)||limit<1||limit>HISTORY_PAGE_SIZE)throw problem(400,'Choose a rollback history page size from 1 to 100.');
    // Sequence cursors stay decimal strings, including beyond the JavaScript
    // safe integer range. Keyset pagination never skips retained checkpoints.
    if(before!==undefined&&(typeof before!=='string'||!/^\d{1,19}$/.test(before)||BigInt(before)<1n||BigInt(before)>9223372036854775807n))throw problem(400,'Use the rollback cursor returned by the previous page.');
    await storage();
    const result=await db.query(`SELECT ${RECEIPT_COLUMNS} FROM office_ai_revisions WHERE collection=$1 AND record_key=$2${before!==undefined?' AND sequence<$4::bigint':''} ORDER BY sequence DESC LIMIT $3`,[collection,key,limit+1,...(before!==undefined?[before]:[])]);
    const rows=result.rows.slice(0,limit),hasMore=result.rows.length>limit;
    const count=await db.query('SELECT count(*)::text AS count FROM office_ai_revisions WHERE collection=$1 AND record_key=$2',[collection,key]);
    return{checkpoints:rows.map(receipt),nextBefore:hasMore?String(rows.at(-1).sequence):null,hasMore,total:Number(count.rows[0].count),retention:DRAFT_ROLLBACK_COPIES};
  }
  async function history(collection,key,options){return(await historyPage(collection,key,options)).checkpoints;}
  async function list(collection){if(collection!=='function')throw problem(400,'Only the function library supports listing.');await storage();return(await db.query(`SELECT DISTINCT ON(record_key) ${RECEIPT_COLUMNS} FROM office_ai_revisions WHERE collection=$1 ORDER BY record_key,sequence DESC LIMIT 51`,[collection])).rows.map(receipt);}
  async function read(collection,key,id){
    identity(collection,key);if(id!==undefined&&!UUID.test(id))throw problem(400,'Use a valid checkpoint identifier.');await storage();
    const rows=(await db.query(`SELECT * FROM office_ai_revisions WHERE collection=$1 AND record_key=$2${id?' AND id=$3':''} ORDER BY sequence DESC LIMIT 1`,id?[collection,key,id]:[collection,key])).rows;
    if(!rows[0])throw problem(404,'This function or rollback checkpoint does not exist.');
    const row=rows[0];let value;
    try{const plain=createTokenVault(env).open(row.encrypted_payload,`office:revision:${collection}:${key}:${row.id}`);if(createHash('sha256').update(plain).digest('hex')!==row.revision)throw Error('Revision mismatch');value=JSON.parse(plain);}
    catch{throw problem(503,'This encrypted rollback checkpoint could not be verified.');}
    return{...receipt(row),value};
  }
  async function write(collection,key,value,{expectedRevision,append=false,keep='unlimited',summary='',metadata={}}={}){
    identity(collection,key);
    // Accept historical callers' finite keep argument without pruning their
    // old data. Retention is unlimited for drafts and function rollbacks.
    if(keep!=='unlimited'&&(!Number.isSafeInteger(keep)||keep<1))throw problem(400,'Use unlimited rollback retention.');
    const encoded=JSON.stringify(value);if(typeof encoded!=='string'||Buffer.byteLength(encoded)>4*1024*1024)throw problem(413,'The rollback checkpoint exceeds its four-megabyte capacity.');
    await storage();const revision=createHash('sha256').update(encoded).digest('hex');
    return db.withClient(async client=>{
      await client.query('BEGIN');
      try{
        await client.query("SET LOCAL lock_timeout = '5s'");await client.query("SET LOCAL statement_timeout = '15s'");
        if(collection==='function')await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['office-revision:function-library']);
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`office-revision:${collection}:${key}`]);
        const latest=(await client.query(`SELECT ${RECEIPT_COLUMNS} FROM office_ai_revisions WHERE collection=$1 AND record_key=$2 ORDER BY sequence DESC LIMIT 1 FOR UPDATE`,[collection,key])).rows[0];
        if(latest?.revision===revision){await client.query('COMMIT');return{...receipt(latest),unchanged:true};}
        if(!append&&((latest&&latest.revision!==expectedRevision)||(!latest&&expectedRevision!==undefined)))throw problem(409,'This version changed. Read its current revision before updating or restoring it.');
        if(collection==='function'&&!latest){const count=(await client.query('SELECT count(DISTINCT record_key)::integer AS count FROM office_ai_revisions WHERE collection=$1',[collection])).rows[0].count;if(count>=50)throw problem(409,'The library supports up to 50 reusable functions.');}
        const id=randomUUID(),sealed=createTokenVault(env).seal(encoded,`office:revision:${collection}:${key}:${id}`);
        const row=(await client.query(`INSERT INTO office_ai_revisions(id,collection,record_key,revision,summary,metadata,encrypted_payload) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING ${RECEIPT_COLUMNS}`,[id,collection,key,revision,String(summary).slice(0,240),JSON.stringify(metadata),sealed])).rows[0];
        await client.query('COMMIT');return receipt(row);
      }catch(error){await client.query('ROLLBACK');throw error;}
    });
  }
  async function restore(collection,key,id,expectedRevision){const previous=await read(collection,key,id);return write(collection,key,previous.value,{expectedRevision,summary:`Restored ${previous.summary}`,metadata:{name:previous.name,description:previous.description,parameters:previous.parameters}});}
  async function remove(key,expectedRevision){
    identity('function',key);await storage();
    return db.withClient(async client=>{await client.query('BEGIN');try{
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`office-revision:function:${key}`]);
      const latest=(await client.query("SELECT revision FROM office_ai_revisions WHERE collection='function' AND record_key=$1 ORDER BY sequence DESC LIMIT 1 FOR UPDATE",[key])).rows[0];
      if(!latest||latest.revision!==expectedRevision)throw problem(409,'The function changed. Refresh its current revision before removing it.');
      await client.query("DELETE FROM office_ai_revisions WHERE collection='function' AND record_key=$1",[key]);await client.query('COMMIT');return{deleted:true};
    }catch(error){await client.query('ROLLBACK');throw error;}});
  }
  return{configured,list,history,historyPage,read,write,restore,remove};
}
module.exports={createOfficeAIRevisions,SCHEMA,DRAFT_ROLLBACK_COPIES};
