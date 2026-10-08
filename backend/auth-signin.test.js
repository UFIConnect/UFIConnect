const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createTokenVault } = require('./token-vault');
const { SIGNIN_SCHEMA, createSignIn, verifyIdentityToken, providerSettings, safeReturnTo, phoneNumber } = require('./auth-signin');
const { BUSINESS_TEAM_SCHEMA } = require('./business-teams');
const { createAppHarness } = require('./test-support/app-harness');

let signingKey, keySet, jwtSign, applePrivateKey;
test.before(async () => {
  const { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } = await import('jose');
  const keys = await generateKeyPair('RS256');
  signingKey = keys.privateKey;
  applePrivateKey = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  keySet = createLocalJWKSet({ keys: [{ ...await exportJWK(keys.publicKey), kid:'test-key', alg:'RS256' }] });
  jwtSign = async (claims, overrides = {}) => new SignJWT({ email:'person@example.invalid', email_verified:true, name:'Provider Member', nonce:'test-nonce', ...claims })
    .setProtectedHeader({ alg:'RS256', kid:'test-key' }).setIssuer(overrides.issuer || 'https://accounts.google.com')
    .setAudience(overrides.audience || 'google-client').setSubject(overrides.subject || 'provider-subject')
    .setIssuedAt().setExpirationTime(overrides.expires || '5m').sign(signingKey);
});
function response() {
  return { headers: {}, append(key,value) { (this.headers[key] ||= []).push(value); return this; }, redirect(value) { this.location=value; return this; } };
}
async function linkUser(f,email='person@example.invalid') {
  const user=(await f.pg.query("INSERT INTO users(name,email,password_hash) VALUES('Password Member',$1,'preserved-password-hash') RETURNING *",[email])).rows[0];
  const sid=crypto.randomUUID();
  await f.pg.query("INSERT INTO auth_sessions(id,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 day')",[sid,user.id]);
  return {...user,sid,ver:0,authProvider:'local'};
}
async function fixture(t, { phone=false, apple=false } = {}) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,phone TEXT DEFAULT '',title TEXT DEFAULT '',auth_provider TEXT DEFAULT 'local',auth_subject TEXT,
    auth_version INTEGER DEFAULT 0,organization TEXT,plan TEXT DEFAULT 'free',business_seats INTEGER DEFAULT 0,billing_closed BOOLEAN DEFAULT false);
    CREATE UNIQUE INDEX users_auth_subject_idx ON users(auth_provider,auth_subject) WHERE auth_subject IS NOT NULL;
    CREATE TABLE auth_sessions(id UUID PRIMARY KEY,user_id UUID,expires_at TIMESTAMPTZ);`);
  for (const sql of SIGNIN_SCHEMA) await pg.exec(sql);
  const env = { NODE_ENV:'test', JWT_SECRET:'unique-test-only-key', OAUTH_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,2).toString('base64'), YOUTUBE_CLIENT_ID:'google-client',YOUTUBE_CLIENT_SECRET:'private-google-key' };
  if(phone) Object.assign(env,{TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_AUTH_TOKEN:'private-sms-key',TWILIO_VERIFY_SERVICE_SID:'VA'+'2'.repeat(32)});
  if(apple) Object.assign(env,{APPLE_CLIENT_ID:'apple-client',APPLE_TEAM_ID:'TEAM',APPLE_KEY_ID:'KEY',APPLE_PRIVATE_KEY:applePrivateKey});
  let tail=Promise.resolve(), exchanges=0, requests=0, checks=0, approved=false, currentNonce;
  const db = { isConnected:()=>true, query:(sql,params)=>pg.query(sql,params), withClient(fn) { const result=tail.then(()=>fn({query:(sql,params)=>pg.query(sql,params)}));tail=result.catch(()=>{});return result; } };
  const fetcher = async (url,options) => {
    exchanges++;
    assert.equal(url,'https://oauth2.googleapis.com/token');
    const fields = new URLSearchParams(options.body);
    assert.ok(fields.get('code_verifier'));
    assert.equal(fields.get('redirect_uri'),'https://api.uficonnect.org/auth/social/youtube/callback');
    return {ok:true,json:async()=>({id_token:await jwtSign({nonce:currentNonce})})};
  };
  const phoneProvider={request:async()=>{requests++;return {status:'pending',sid:'VE'+'3'.repeat(32)};},verify:async(sid)=>{checks++;return {status:approved?'approved':'pending',sid};}};
  const options={db,env,vault:createTokenVault(env),callbackBase:'https://api.uficonnect.org',frontendBase:'https://uficonnect.org',fetcher,keySets:{google:keySet,apple:keySet},phoneProvider,
    issueSession:async(user)=>`session-for-${user.id}`,profileFor:async(user)=>({id:user.id,email:user.email_is_placeholder?'':user.email}),onUser:row=>row};
  const service=createSignIn(options);
  return {pg,db,env,options,service,setNonce:n=>{currentNonce=n;},approve:()=>{approved=true;},counts:()=>({exchanges,requests,checks})};
}
test('readiness is explicit; input normalization rejects redirects and invalid phone numbers', () => {
  assert.equal(providerSettings({YOUTUBE_CLIENT_ID:'id',YOUTUBE_CLIENT_SECRET:'secret'}).google.configured,true);
  assert.equal(providerSettings({YOUTUBE_CLIENT_ID:'id',YOUTUBE_CLIENT_SECRET:'secret',GOOGLE_CLIENT_ID:'dedicated'}).google.configured,false);
  assert.equal(providerSettings({TWILIO_ACCOUNT_SID:'bad',TWILIO_AUTH_TOKEN:'x',TWILIO_VERIFY_SERVICE_SID:'bad'}).phone.configured,false);
  for(const path of ['//attacker.example','/\\attacker.example','https://attacker.example','/login','/auth/callback','/x\n']) assert.equal(safeReturnTo(path),'');
  assert.equal(safeReturnTo('/jobs?view=saved'),'/jobs?view=saved');
  assert.equal(phoneNumber('+1 (555) 123-4567'),'+15551234567');
  assert.equal(phoneNumber('5551234567'),null);
});
test('provider readiness rejects blank and partial credentials without mixing Google credential pairs', () => {
  const google = { YOUTUBE_CLIENT_ID:'fallback-id',YOUTUBE_CLIENT_SECRET:'fallback-secret' };
  for (const invalid of [{YOUTUBE_CLIENT_SECRET:' \n '},{YOUTUBE_CLIENT_ID:'  '},{GOOGLE_CLIENT_ID:'dedicated'},{GOOGLE_CLIENT_SECRET:'dedicated-secret'}]) {
    assert.equal(providerSettings({...google,...invalid}).google.configured,false);
  }
  const fallback=providerSettings({...google,GOOGLE_CLIENT_ID:'  ',GOOGLE_CLIENT_SECRET:'\n '}).google;
  assert.equal(fallback.configured,true);
  assert.equal(fallback.callbackPath,'/auth/social/youtube/callback');
  const dedicated=providerSettings({...google,GOOGLE_CLIENT_ID:' dedicated ',GOOGLE_CLIENT_SECRET:' dedicated-secret '}).google;
  assert.equal(dedicated.configured,true);
  assert.equal(dedicated.clientId,'dedicated');
  assert.equal(dedicated.clientSecret,'dedicated-secret');
  assert.equal(dedicated.callbackPath,'/auth/providers/google/callback');
  const phone={TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_AUTH_TOKEN:'sms-secret',TWILIO_VERIFY_SERVICE_SID:'VA'+'2'.repeat(32)};
  for(const key of Object.keys(phone)) assert.equal(providerSettings({...phone,[key]:' \n '}).phone.configured,false);
  assert.equal(providerSettings(Object.fromEntries(Object.entries(phone).map(([key,value])=>[key,' '+value+' ']))).phone.configured,true);
});
test('Apple readiness requires a usable unencrypted PKCS8 P-256 signing key and all client identifiers', () => {
  const apple={APPLE_CLIENT_ID:'apple-client',APPLE_TEAM_ID:'TEAM',APPLE_KEY_ID:'KEY',APPLE_PRIVATE_KEY:applePrivateKey};
  assert.equal(providerSettings(apple).apple.configured,true);
  assert.equal(providerSettings({...apple,APPLE_PRIVATE_KEY:applePrivateKey.replace(/\n/g,'\\n')}).apple.configured,true);
  const wrongCurve=crypto.generateKeyPairSync('ec',{namedCurve:'secp384r1'}).privateKey.export({type:'pkcs8',format:'pem'});
  const rsa=crypto.KeyObject.from(signingKey).export({type:'pkcs8',format:'pem'});
  const sec1=crypto.createPrivateKey(applePrivateKey).export({type:'sec1',format:'pem'});
  for(const key of ['not-a-signing-key',' \n ',wrongCurve,rsa,sec1]) assert.equal(providerSettings({...apple,APPLE_PRIVATE_KEY:key}).apple.configured,false);
  for(const key of ['APPLE_CLIENT_ID','APPLE_TEAM_ID','APPLE_KEY_ID']) assert.equal(providerSettings({...apple,[key]:' \n '}).apple.configured,false);
});
test('public readiness and start guards agree before storing flows or contacting an unconfigured provider', async () => {
  const storageKey=Buffer.alloc(32,2).toString('base64');
  const db={isConnected:()=>true,query:()=>assert.fail('Unavailable sign-in must not write a flow')};
  const options={db,vault:{seal:()=>assert.fail('Unavailable sign-in must not encrypt a flow')},
    callbackBase:'https://api.uficonnect.org',frontendBase:'https://uficonnect.org',fetcher:()=>assert.fail('Unavailable sign-in must not contact a provider')};
  const service=createSignIn({...options,env:{OAUTH_TOKEN_ENCRYPTION_KEY:storageKey,GOOGLE_CLIENT_ID:'configured-id',GOOGLE_CLIENT_SECRET:' \n ',
    APPLE_CLIENT_ID:'apple-client',APPLE_TEAM_ID:'TEAM',APPLE_KEY_ID:'KEY',APPLE_PRIVATE_KEY:'malformed',
    TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_AUTH_TOKEN:' \n ',TWILIO_VERIFY_SERVICE_SID:'VA'+'2'.repeat(32)}});
  assert.deepEqual(service.publicProviders(),{providers:{google:{configured:false,enabled:false},apple:{configured:false,enabled:false},phone:{configured:false,enabled:false}}});
  for(const provider of ['google','apple']) await assert.rejects(service.start(provider,{},response()),{status:503,publicCode:'unavailable'});
  await assert.rejects(service.requestPhone({phoneNumber:'+15551234567'}),{status:503,publicCode:'unavailable'});
  for(const key of ['', ' ', 'invalid', Buffer.alloc(31,2).toString('base64'), ' '+storageKey, Buffer.alloc(32,255).toString('base64url')]) {
    const unavailable=createSignIn({...options,env:{OAUTH_TOKEN_ENCRYPTION_KEY:key,YOUTUBE_CLIENT_ID:'configured-id',YOUTUBE_CLIENT_SECRET:'private-provider-secret'}});
    assert.deepEqual(unavailable.publicProviders().providers.google,{configured:true,enabled:false});
    await assert.rejects(unavailable.start('google',{client:'native'}),{status:503,publicCode:'unavailable'});
  }
  const available=createSignIn({...options,env:{OAUTH_TOKEN_ENCRYPTION_KEY:storageKey,YOUTUBE_CLIENT_ID:'configured-id',YOUTUBE_CLIENT_SECRET:'private-provider-secret'}});
  assert.deepEqual(available.publicProviders().providers.google,{configured:true,enabled:true});
  const disconnected=createSignIn({...options,db:{...db,isConnected:()=>false},env:{OAUTH_TOKEN_ENCRYPTION_KEY:storageKey,YOUTUBE_CLIENT_ID:'configured-id',YOUTUBE_CLIENT_SECRET:'private-provider-secret'}});
  assert.deepEqual(disconnected.publicProviders().providers.google,{configured:true,enabled:false});
  await assert.rejects(disconnected.start('google'),{status:503,publicCode:'unavailable'});
});
test('signed identity tokens require the correct issuer, audience, nonce, expiry and verified email', async () => {
  const options={audience:'google-client',nonce:'test-nonce',keySet};
  assert.equal((await verifyIdentityToken('google',await jwtSign({}),options)).subject,'provider-subject');
  for(const [claims,overrides] of [[{nonce:'other'},{}],[{azp:'other-client'},{}],[{}, {audience:['google-client','another-client']}],[{email_verified:false},{}],[{email_verified:'true'},{}],[{email:''},{}],[{}, {audience:'other'}],[{}, {issuer:'https://attacker.example'}],[{}, {expires:'-1m'}]]) {
    await assert.rejects(verifyIdentityToken('google',await jwtSign(claims,overrides),options));
  }
  const apple=await jwtSign({email_verified:'true'}, {issuer:'https://appleid.apple.com',audience:'apple-client'});
  assert.equal((await verifyIdentityToken('apple',apple,{...options,audience:'apple-client'})).email,'person@example.invalid');
});
test('web OAuth binds browser cookie, keeps secrets encrypted and consumes callback exactly once', async t => {
  const f=await fixture(t), res=response();
  const start=await f.service.start('google',{mode:'signup',returnTo:'/jobs'},res);
  const url=new URL(start.url), state=url.searchParams.get('state');
  f.setNonce(url.searchParams.get('nonce'));
  assert.equal(url.searchParams.get('scope'),'openid email profile');
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.ok(!start.verifier);
  const stored=(await f.pg.query('SELECT * FROM auth_signin_flows')).rows[0];
  assert.ok(stored.payload.startsWith('enc:v1:'));
  assert.ok(!JSON.stringify(stored).includes(url.searchParams.get('nonce')));
  const req={method:'GET',query:{state,code:'provider-code'},headers:{}};
  const denied=response(); await f.service.complete('google',req,denied);
  assert.match(denied.location,/error=/);
  assert.equal(f.counts().exchanges,0);
  req.headers.cookie=res.headers['Set-Cookie'][0].split(';')[0];
  const success=response(); await f.service.complete('google',req,success);
  assert.match(success.location,/returnTo=%2Fjobs/);
  assert.equal(success.headers['Set-Cookie'].length,2);
  assert.equal((await f.pg.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n,1);
  const replay=response(); await f.service.complete('google',req,replay);
  assert.match(replay.location,/error=/);
  assert.equal(f.counts().exchanges,1);
});
test('native callback only returns one-use handoff code; verifier survives restarts and rejects interception', async t => {
  const f=await fixture(t);
  const start=await f.service.start('google',{client:'native',mode:'signup'});
  const url=new URL(start.url); f.setNonce(url.searchParams.get('nonce'));
  const result=response();await f.service.complete('google',{method:'GET',query:{state:url.searchParams.get('state'),code:'provider-code'},headers:{}},result);
  assert.match(result.location,/^uficonnect:\/\/auth\/callback#code=/);
  assert.ok(!result.location.includes('session'));
  const code=new URLSearchParams(result.location.split('#')[1]).get('code');
  await assert.rejects(f.service.finish({code,verifier:crypto.randomBytes(32).toString('base64url')},{}));
  const restarted=createSignIn(f.options);
  const session=await restarted.finish({code,verifier:start.verifier},{});
  assert.equal(session.created,true);
  assert.match(session.token,/session-for-/);
  await assert.rejects(restarted.finish({code,verifier:start.verifier},{}));
});
test('Apple form_post binds a secure cookie and signs the expected short-lived client secret', async t => {
  const f=await fixture(t,{apple:true});
  const {generateKeyPair,exportPKCS8,jwtVerify}=await import('jose');
  const clientKeys=await generateKeyPair('ES256',{extractable:true});
  f.env.APPLE_PRIVATE_KEY=await exportPKCS8(clientKeys.privateKey);
  f.env.NODE_ENV='production';
  let nonce;
  const service=createSignIn({...f.options,fetcher:async(url,options)=>{
    assert.equal(url,'https://appleid.apple.com/auth/token');
    const fields=new URLSearchParams(options.body);
    assert.equal(fields.get('redirect_uri'),'https://api.uficonnect.org/auth/providers/apple/callback');
    assert.equal(fields.has('code_verifier'),false);
    const secret=await jwtVerify(fields.get('client_secret'),clientKeys.publicKey,{algorithms:['ES256'],issuer:'TEAM',audience:'https://appleid.apple.com'});
    assert.equal(secret.payload.sub,'apple-client');
    assert.equal(secret.protectedHeader.kid,'KEY');
    assert.ok(secret.payload.exp-secret.payload.iat<=300);
    return {ok:true,json:async()=>({id_token:await jwtSign({nonce,email_verified:'true',name:undefined},{issuer:'https://appleid.apple.com',audience:'apple-client'})})};
  }});
  const startRes=response(), start=await service.start('apple',{mode:'signup'},startRes);
  const url=new URL(start.url);nonce=url.searchParams.get('nonce');
  assert.equal(url.searchParams.get('response_mode'),'form_post');
  assert.match(startRes.headers['Set-Cookie'][0],/HttpOnly.*SameSite=None; Secure/);
  const result=response();
  await service.complete('apple',{method:'POST',headers:{cookie:startRes.headers['Set-Cookie'][0].split(';')[0]},body:{state:url.searchParams.get('state'),code:'apple-code',user:JSON.stringify({name:{firstName:'Apple',lastName:'Member'},email:'untrusted@example.invalid'})}},result);
  assert.ok(result.location.includes('provider=apple'),result.location);
  const user=(await f.pg.query('SELECT * FROM users')).rows[0];
  assert.equal(user.name,'Apple Member');
  assert.equal(user.email,'person@example.invalid');
  assert.equal(user.auth_provider,'apple');
});
test('native cancellation creates no account and expired flows cannot complete', async t => {
  const f=await fixture(t),start=await f.service.start('google',{client:'native'}),url=new URL(start.url);
  const cancelled=response();await f.service.complete('google',{method:'GET',query:{state:url.searchParams.get('state'),error:'access_denied'},headers:{}},cancelled);
  assert.equal(cancelled.location,'uficonnect://auth/callback#error=cancelled');
  assert.equal(f.counts().exchanges,0);
  const expired=await f.service.start('google',{client:'native'});
  await f.pg.exec("UPDATE auth_signin_flows SET expires_at=NOW()-INTERVAL '1 second'");
  const result=response();await f.service.complete('google',{method:'GET',query:{state:new URL(expired.url).searchParams.get('state'),code:'code'},headers:{}},result);
  assert.match(result.location,/error=/);
  assert.equal((await f.pg.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n,0);
});
test('provider email collisions never link password accounts; concurrent subjects create only one user', async t => {
  const f=await fixture(t);
  await f.pg.query("INSERT INTO users(name,email,password_hash) VALUES('Local','person@example.invalid','local-hash')");
  await assert.rejects(f.service.provision({provider:'google',subject:'different',email:'person@example.invalid',name:'Claimant'}),{status:409});
  const identity={provider:'google',subject:'verified-other',email:'new@example.invalid',name:'Member'};
  const results=await Promise.all([f.service.provision(identity),f.service.provision(identity)]);
  assert.equal(results[0].row.id,results[1].row.id);
  assert.equal(results.filter(value=>value.created).length,1);
});
test('authenticated native linking preserves password login and later Google login finds the same member', async t => {
  const f=await fixture(t),member=await linkUser(f);
  const start=await f.service.start('google',{client:'native'},null,member),url=new URL(start.url);
  f.setNonce(url.searchParams.get('nonce'));
  const callback=response();await f.service.complete('google',{method:'GET',query:{state:url.searchParams.get('state'),code:'code'},headers:{}},callback);
  const code=new URLSearchParams(callback.location.split('#')[1]).get('code');
  const linked=await f.service.finish({code,verifier:start.verifier},{});
  assert.equal(linked.profile.id,member.id);
  assert.equal(linked.created,false);
  const loggedIn=await f.service.provision({provider:'google',subject:'provider-subject',email:'person@example.invalid'});
  assert.equal(loggedIn.row.id,member.id);
  assert.equal(loggedIn.row.auth_provider,'local');
  assert.equal(loggedIn.row.password_hash,'preserved-password-hash');
  const methods=await f.service.linked(member);
  assert.deepEqual(methods.methods.map(method=>method.provider),['google']);
  assert.equal(methods.passwordAvailable,true);
  await assert.rejects(f.service.start('google',{client:'native'},null,{id:member.id,ver:0}),{status:401});
});
test('provider links reject revoked sessions and identities already assigned to another account', async t => {
  const f=await fixture(t),member=await linkUser(f);
  await f.pg.query('DELETE FROM auth_sessions WHERE id=$1',[member.sid]);
  await assert.rejects(f.service.provision({provider:'google',subject:'new-subject',email:'person@example.invalid'},{mode:'link',linkContext:{id:member.id,sid:member.sid,ver:0}}),{status:401});
  const second=await linkUser(f,'second@example.invalid');
  const owner=await f.service.provision({provider:'google',subject:'owned-subject',email:'owned@example.invalid'});
  await assert.rejects(f.service.provision({provider:'google',subject:'owned-subject',email:'owned@example.invalid'},{mode:'link',linkContext:{id:second.id,sid:second.sid,ver:0}}),{status:409});
  assert.equal((await f.service.provision({provider:'google',subject:'owned-subject',email:'owned@example.invalid'})).row.id,owner.row.id);
  assert.deepEqual((await f.service.linked(second)).methods,[]);
  await f.pg.query('UPDATE users SET auth_version=1 WHERE id=$1',[second.id]);
  await assert.rejects(f.service.provision({provider:'apple',subject:'fresh-apple',email:'second@example.invalid'},{mode:'link',linkContext:{id:second.id,sid:second.sid,ver:0}}),{status:401});
});
test('verified phone linking updates the signed-in account without replacing its password', async t => {
  const f=await fixture(t,{phone:true}),member=await linkUser(f);
  const challenge=await f.service.requestPhone({phoneNumber:'+15551234567'},member);
  f.approve();
  const linked=await f.service.verifyPhone({verificationId:challenge.verificationId,code:'123456'},{});
  assert.equal(linked.profile.id,member.id);
  assert.equal(linked.created,false);
  const loggedIn=await f.service.provision({provider:'phone',subject:'+15551234567'},{mode:'login'});
  assert.equal(loggedIn.row.id,member.id);
  assert.equal(loggedIn.row.phone,'+15551234567');
  assert.equal(loggedIn.row.auth_provider,'local');
  assert.equal(loggedIn.row.password_hash,'preserved-password-hash');
  assert.equal(loggedIn.row.email,'person@example.invalid');
});
test('phone verification requires provider approval and never links an unverified profile number', async t => {
  const f=await fixture(t,{phone:true});
  await f.pg.query("INSERT INTO users(name,email,password_hash,phone) VALUES('Local','local@example.invalid','hash','+15551234567')");
  const requested=await f.service.requestPhone({phoneNumber:'+15551234567',mode:'signup',name:'Phone Member',title:'Engineer'});
  assert.equal(requested.expiresIn,600);
  assert.ok(!JSON.stringify((await f.pg.query('SELECT * FROM auth_signin_flows')).rows).includes('+15551234567'));
  await assert.rejects(f.service.verifyPhone({verificationId:requested.verificationId,code:'123456'},{}),/incorrect/);
  f.approve();
  const session=await f.service.verifyPhone({verificationId:requested.verificationId,code:'654321'},{});
  assert.equal(session.created,true);
  assert.equal(session.profile.email,'');
  const phone=(await f.pg.query("SELECT * FROM users WHERE auth_provider='phone'")).rows[0];
  assert.equal(phone.auth_subject,'+15551234567');
  assert.equal(phone.email_is_placeholder,true);
  assert.match(phone.email,/@identity\.uficonnect\.invalid$/);
  assert.ok(!phone.email.includes('555'));
  await assert.rejects(f.service.verifyPhone({verificationId:requested.verificationId,code:'654321'},{}));
  assert.equal((await f.pg.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n,2);
});
test('phone resend limits persist across workers and attempts stop before a sixth provider check', async t => {
  const f=await fixture(t,{phone:true});
  const input={phoneNumber:'+15551234567',mode:'signup',name:'Member'};
  const requested=await f.service.requestPhone(input);
  const restarted=createSignIn(f.options);
  await assert.rejects(restarted.requestPhone(input),{status:429});
  for(let i=0;i<6;i++) await assert.rejects(restarted.verifyPhone({verificationId:requested.verificationId,code:'111111'},{}));
  assert.equal(f.counts().requests,1);
  assert.equal(f.counts().checks,5);
  await f.pg.exec("UPDATE auth_phone_limits SET last_sent=NOW()-INTERVAL '2 minutes',hour_count=5");
  await assert.rejects(restarted.requestPhone(input),{status:429});
});
test('phone login requires a verified phone identity and expired codes cannot authorize', async t => {
  const f=await fixture(t,{phone:true});
  const requested=await f.service.requestPhone({phoneNumber:'+15551234567',mode:'login'});
  f.approve();
  await assert.rejects(f.service.verifyPhone({verificationId:requested.verificationId,code:'123456'},{}),{status:404});
  await f.pg.exec("UPDATE auth_phone_limits SET last_sent=NOW()-INTERVAL '2 minutes'");
  const next=await f.service.requestPhone({phoneNumber:'+15551234567',mode:'signup',name:'Member'});
  await f.pg.exec("UPDATE auth_signin_flows SET expires_at=NOW()-INTERVAL '1 second'");
  await assert.rejects(f.service.verifyPhone({verificationId:next.verificationId,code:'123456'},{}));
});
test('sign-in migrations preserve pending flows; cleanup removes expired encrypted secrets and stale limits', async t => {
  const f=await fixture(t,{phone:true});
  await f.service.start('google',{client:'native'});
  await f.service.requestPhone({phoneNumber:'+15551234567',mode:'signup',name:'Member'});
  for(const sql of SIGNIN_SCHEMA) await f.pg.exec(sql);
  assert.equal((await f.pg.query('SELECT COUNT(*)::int AS n FROM auth_signin_flows')).rows[0].n,2);
  await f.pg.exec("UPDATE auth_signin_flows SET expires_at=NOW()-INTERVAL '1 second'; UPDATE auth_phone_limits SET last_sent=NOW()-INTERVAL '3 days'");
  await f.service.prune();
  assert.equal((await f.pg.query('SELECT COUNT(*)::int AS n FROM auth_signin_flows')).rows[0].n,0);
  assert.equal((await f.pg.query('SELECT COUNT(*)::int AS n FROM auth_phone_limits')).rows[0].n,0);
});
test('real application routes restore Google sessions while Apple and phone remain unavailable', async t => {
  const f=await fixture(t);
  for(const sql of BUSINESS_TEAM_SCHEMA) await f.pg.exec(sql);
  const signin=require('./auth-signin');
  const app=await createAppHarness({env:f.env,connected:true,query:(sql,params)=>f.pg.query(sql,params.map(value=>Object.prototype.toString.call(value)==='[object Date]'?new Date(value.getTime()):value)),withClient:fn=>f.db.withClient(fn),
    modules:{'./auth-signin':{...signin,registerSignInRoutes:(server,options)=>signin.registerSignInRoutes(server,{...options,fetcher:f.options.fetcher,keySets:f.options.keySets})}}});
  t.after(()=>app.close());
  const readiness=await app.request('/auth/providers');
  assert.equal(readiness.data.providers.google.enabled,true);
  assert.equal(readiness.data.providers.apple.enabled,false);
  assert.equal(readiness.data.providers.phone.enabled,false);
  assert.equal((await app.request('/auth/phone/request',{method:'POST',body:{phoneNumber:'+15551234567'}})).status,503);
  assert.equal((await app.request('/auth/providers/google/link',{method:'POST',body:{client:'web'}})).status,401);
  const start=await app.request('/auth/providers/google/start',{method:'POST',body:{mode:'signup',client:'web'}});
  const url=new URL(start.data.url); f.setNonce(url.searchParams.get('nonce'));
  const cookies=start.headers.get('set-cookie').split(';')[0];
  // Prevent fetch from following the external frontend redirect.
  const callback=await fetch(app.base+'/auth/social/youtube/callback?'+new URLSearchParams({state:url.searchParams.get('state'),code:'code'}),{headers:{cookie:cookies},redirect:'manual'});
  assert.equal(callback.status,302);
  const sessionCookie=callback.headers.getSetCookie().find(v=>v.startsWith('ufi_session=')).split(';')[0];
  const session=await app.request('/auth/session',{headers:{cookie:sessionCookie}});
  assert.equal(session.status,200);
  assert.equal(session.data.profile.authProvider,'google');
  const linked=await app.request('/auth/providers/linked',{headers:{authorization:`Bearer ${session.data.token}`}});
  assert.equal(linked.status,200);
  assert.deepEqual(linked.data.methods.map(value=>value.provider),['google']);
  assert.equal(linked.data.passwordAvailable,false);
  const linkStart=await app.request('/auth/providers/google/link',{method:'POST',headers:{authorization:`Bearer ${session.data.token}`},body:{client:'native'}});
  assert.equal(linkStart.status,200);
  const linkUrl=new URL(linkStart.data.url); f.setNonce(linkUrl.searchParams.get('nonce'));
  const linkCallback=await fetch(app.base+'/auth/social/youtube/callback?'+new URLSearchParams({state:linkUrl.searchParams.get('state'),code:'link-code'}),{redirect:'manual'});
  assert.equal(linkCallback.status,302);
  const handoffCode=new URLSearchParams(linkCallback.headers.get('location').split('#')[1]).get('code');
  const linkFinish=await app.request('/auth/providers/finish',{method:'POST',body:{code:handoffCode,verifier:linkStart.data.verifier}});
  assert.equal(linkFinish.status,200);
  assert.equal(linkFinish.data.profile.id,session.data.profile.id);
  assert.equal(linkFinish.data.created,false);
  const security=await app.request('/profile/security',{headers:{authorization:`Bearer ${session.data.token}`}});
  assert.equal(security.data.passwordMinimumCharacters,12);
  assert.equal(security.data.passwordChangeAvailable,false);
  assert.equal(security.data.serverSessionRevocation,true);
  const localLogin=await app.request('/auth/login',{method:'POST',body:{email:session.data.profile.email,password:'not-a-user-password'}});
  assert.equal(localLogin.status,401);
  const reset=await app.request('/auth/reset-password',{method:'POST',body:{token:app.createPasswordResetToken(app.users.find(v=>v.id===session.data.profile.id)),password:'Cloud lantern maps winter'} });
  assert.equal(reset.status,400);
});
