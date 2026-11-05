'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {createTokenVault}=require('./token-vault');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
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
  async function history(collection,key){identity(collection,key);await storage();return(await db.query('SELECT * FROM office_ai_revisions WHERE collection=$1 AND record_key=$2 ORDER BY sequence DESC LIMIT 3',[collection,key])).rows.map(receipt);}
  async function list(collection){if(collection!=='function')throw problem(400,'Only the function library supports listing.');await storage();return(await db.query('SELECT DISTINCT ON(record_key) * FROM office_ai_revisions WHERE collection=$1 ORDER BY record_key,sequence DESC LIMIT 51',[collection])).rows.map(receipt);}
  async function read(collection,key,id){
    identity(collection,key);if(id!==undefined&&!UUID.test(id))throw problem(400,'Use a valid checkpoint identifier.');await storage();
    const rows=(await db.query(`SELECT * FROM office_ai_revisions WHERE collection=$1 AND record_key=$2${id?' AND id=$3':''} ORDER BY sequence DESC LIMIT 1`,id?[collection,key,id]:[collection,key])).rows;
    if(!rows[0])throw problem(404,'This function or rollback checkpoint does not exist.');
    const row=rows[0];let value;
    try{const plain=createTokenVault(env).open(row.encrypted_payload,`office:revision:${collection}:${key}:${row.id}`);if(createHash('sha256').update(plain).digest('hex')!==row.revision)throw Error('Revision mismatch');value=JSON.parse(plain);}
    catch{throw problem(503,'This encrypted rollback checkpoint could not be verified.');}
    return{...receipt(row),value};
  }
  async function write(collection,key,value,{expectedRevision,append=false,keep=3,summary='',metadata={}}={}){
    identity(collection,key);if(![2,3].includes(keep))throw problem(400,'Keep two checkpoints or a current function with two backups.');
    const encoded=JSON.stringify(value);if(typeof encoded!=='string'||Buffer.byteLength(encoded)>4*1024*1024)throw problem(413,'The rollback checkpoint exceeds its four-megabyte capacity.');
    await storage();const revision=createHash('sha256').update(encoded).digest('hex');
    return db.withClient(async client=>{
      await client.query('BEGIN');
      try{
        await client.query("SET LOCAL lock_timeout = '5s'");await client.query("SET LOCAL statement_timeout = '15s'");
        if(collection==='function')await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['office-revision:function-library']);
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`office-revision:${collection}:${key}`]);
        const latest=(await client.query('SELECT * FROM office_ai_revisions WHERE collection=$1 AND record_key=$2 ORDER BY sequence DESC LIMIT 1 FOR UPDATE',[collection,key])).rows[0];
        if(latest?.revision===revision){await client.query('COMMIT');return{...receipt(latest),unchanged:true};}
        if(!append&&((latest&&latest.revision!==expectedRevision)||(!latest&&expectedRevision!==undefined)))throw problem(409,'This version changed. Read its current revision before updating or restoring it.');
        if(collection==='function'&&!latest){const count=(await client.query('SELECT count(DISTINCT record_key)::integer AS count FROM office_ai_revisions WHERE collection=$1',[collection])).rows[0].count;if(count>=50)throw problem(409,'The library supports up to 50 reusable functions.');}
        const id=randomUUID(),sealed=createTokenVault(env).seal(encoded,`office:revision:${collection}:${key}:${id}`);
        const row=(await client.query('INSERT INTO office_ai_revisions(id,collection,record_key,revision,summary,metadata,encrypted_payload) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *',[id,collection,key,revision,String(summary).slice(0,240),JSON.stringify(metadata),sealed])).rows[0];
        await client.query('DELETE FROM office_ai_revisions WHERE collection=$1 AND record_key=$2 AND id NOT IN(SELECT id FROM office_ai_revisions WHERE collection=$1 AND record_key=$2 ORDER BY sequence DESC LIMIT $3)',[collection,key,keep]);
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
  return{configured,list,history,read,write,restore,remove};
}
module.exports={createOfficeAIRevisions,SCHEMA};
