'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./test-support/app-harness');
const { createConnectedTokenRefresher } = require('./connected-token-refresh');
const signingKey = JSON.stringify({ ...require('node:crypto').generateKeyPairSync('ec', { namedCurve:'P-256' }).privateKey.export({format:'jwk'}), kid:'test-key' });

test('concurrent requests share renewal and reuse a token renewed by another worker', async () => {
  const user = { socialTokens: { github: 'expired' }, socialRefreshTokens: { github: 'refresh' } };
  let exchanges = 0;
  const refresh = createConnectedTokenRefresher({
    withAccount: async (id, work) => work(user),
    exchange: async () => { exchanges++; return { accessToken: 'fresh', refreshToken: 'rotated' }; },
    persist: async (u,p,a,r) => { u.socialTokens[p]=a; u.socialRefreshTokens[p]=r; },
  });
  assert.deepEqual(await Promise.all(Array.from({length:8},()=>refresh('member','github','expired'))), Array(8).fill('fresh'));
  assert.equal(exchanges,1);
  assert.equal(user.socialRefreshTokens.github,'rotated');
  assert.equal(await refresh('member','github','expired'),'fresh');
  assert.equal(exchanges,1);
  delete user.socialTokens.github;
  assert.equal(await refresh('member','github','fresh'),null);
});

for (const source of ['youtube', 'github', 'twitch', 'bluesky', 'twitter']) {
  test(`${source}: renew expired access, load recent followed posts, keep accounts isolated`, async t => {
    const app = await createAppHarness({ env: { BLUESKY_SIGNING_KEY:signingKey, [`${source.toUpperCase()}_CLIENT_ID`]:'client', [`${source.toUpperCase()}_CLIENT_SECRET`]:'secret' } });
    t.after(()=>app.close());
    const old = source === 'bluesky' ? JSON.stringify({accessToken:'expired',did:'did:plc:member',pdsUrl:'https://pds.example',tokenEndpoint:'https://auth.example/token',issuer:'https://auth.example'}) : 'expired';
    const viewer = member('connected-reader', { preferences:{interests:['Science']}, socialTokens:{[source]:old}, socialRefreshTokens:{[source]:'refresh'}, socialConnectedAt:{[source]:new Date().toISOString()} });
    app.seedUser(viewer); app.seedUser(member('unconnected-reader'));
    let renewals=0;
    app.setTokenExchange(async (url,params,headers)=>{
      renewals++; assert.equal(params.grant_type,'refresh_token'); assert.equal(params.refresh_token,'refresh');
      if (source === 'twitter') {
        assert.equal(headers.Authorization, `Basic ${Buffer.from('client:secret').toString('base64')}`);
        assert.equal(params.client_secret, undefined);
      } else {
        assert.equal(params.client_id,'client'); assert.equal(params.client_secret,'secret');
      }
      return {access_token:'fresh',refresh_token:'rotated'};
    });
    app.setAtprotoTokenExchange(async (url,params)=>{
      renewals++; assert.equal(url,'https://auth.example/token'); assert.equal(params.refresh_token,'refresh');
      assert.equal(params.grant_type,'refresh_token'); assert.ok(params.client_assertion);
      return {status:200,data:{access_token:'fresh',refresh_token:'rotated',sub:'did:plc:member'}};
    });
    const yesterday = new Date(Date.now()-86400000).toISOString();
    app.setFollowingFetcher(source,async (token,options)=>{
      const access=source==='bluesky'?JSON.parse(token).accessToken:token;
      if(access==='expired') throw new Error('HTTP 401: expired access token');
      assert.equal(access,'fresh');
      assert.ok(Date.parse(options.connectedAt)<Date.parse(yesterday),'first connection includes recent history');
      return [null,'Travel'].map((topic,index)=>({id:`followed-${source}-${index}`,source,topic,sourceUrl:`https://example.com/posts/${source}/${index}`,authorId:'followed-creator',title:'A real update from a followed creator',content:'An update from the member selected network.',createdAt:yesterday,isExternal:true}));
    });
    let result=await app.request('/office/feed?mode=following&passive=1',{userId:viewer.id});
    assert.equal(result.status,200); assert.equal(result.data.posts.length,2,JSON.stringify({response:result.data,errors:app.errors}));
    assert.deepEqual(result.data.sourceErrors,{}); assert.equal(renewals,1);
    assert.equal(viewer.socialRefreshTokens[source],'rotated');
    result=await app.request('/office/feed?mode=following&passive=1&topics=Science',{userId:viewer.id});
    assert.equal(result.data.posts.length,0,'explicit filters still apply');
    result=await app.request('/office/feed?mode=following&passive=1',{userId:'unconnected-reader'});
    assert.equal(result.data.posts.length,0);
  });
}

test('failed renewal is visible and does not retry indefinitely or expose tokens', async t => {
  const app = await createAppHarness(); t.after(()=>app.close());
  const viewer=member('revoked',{socialTokens:{github:'expired'},socialRefreshTokens:{github:'revoked-refresh'}});
  app.seedUser(viewer);
  let fetches=0; app.setFollowingFetcher('github',async()=>{fetches++;throw new Error('HTTP 401');});
  app.setTokenExchange(async()=>({error:'invalid_grant'}));
  const result=await app.request('/office/feed?mode=following&passive=1',{userId:viewer.id});
  assert.equal(result.status,200); assert.equal(fetches,1);
  assert.match(result.data.sourceErrors.github,/Reconnect/);
  assert.equal(JSON.stringify(result.data).includes('revoked-refresh'),false);
});

test('Bluesky DPoP proof binds the target path without query or fragment', async t => {
  const app=await createAppHarness({env:{BLUESKY_SIGNING_KEY:signingKey}}); t.after(()=>app.close());
  const token=app.createDPoPProof('GET','https://pds.example/xrpc/app.bsky.feed.getTimeline?limit=100#ignored',{accessToken:'fixture'});
  const payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
  assert.equal(payload.htu,'https://pds.example/xrpc/app.bsky.feed.getTimeline');
  assert.equal(payload.htm,'GET'); assert.ok(payload.ath);
});

test('database renewal locks the account and preserves another provider updated by a different worker', async t => {
  const { PGlite } = require('@electric-sql/pglite');
  const { createTokenVault } = require('./token-vault');
  const db = new PGlite(); t.after(()=>db.close());
  await db.exec(`CREATE TABLE users (id uuid PRIMARY KEY, social_tokens jsonb, social_refresh_tokens jsonb, social_connected_at jsonb)`);
  const env = { OAUTH_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64'), GITHUB_CLIENT_ID:'client', GITHUB_CLIENT_SECRET:'secret' };
  const vault=createTokenVault(env); const id='5e99f0ed-793a-4f31-a2b5-9c784b54d3ab';
  const access={github:'expired',twitch:'other-worker-fresh'};
  const refresh={github:'refresh',twitch:'other-worker-rotated'};
  await db.query('INSERT INTO users VALUES ($1,$2,$3,$4)',[id,JSON.stringify(vault.encryptMap(access,id,'access')),JSON.stringify(vault.encryptMap(refresh,id,'refresh')),JSON.stringify({github:'2026-01-01T00:00:00Z'})]);
  const app=await createAppHarness({env,connected:true,query:(sql,params)=>db.query(sql,params)}); t.after(()=>app.close());
  app.seedUser(member(id,{socialTokens:{github:'expired',twitch:'stale'},socialRefreshTokens:{github:'refresh',twitch:'stale-refresh'}}));
  app.setTokenExchange(async()=>({access_token:'new-github',refresh_token:'rotated-github'}));
  assert.equal(await app.refreshConnectedAccessToken(id,'github','expired'),'new-github');
  assert.ok(app.queries.some(q=>q.sql.includes('FOR UPDATE')));
  await app.saveSocialToken(id,'youtube','new-youtube','refresh-youtube');
  const {rows:[row]}=await db.query('SELECT * FROM users WHERE id=$1',[id]);
  assert.deepEqual(vault.decryptMap(row.social_tokens,id,'access'),{github:'new-github',twitch:'other-worker-fresh',youtube:'new-youtube'});
  assert.deepEqual(vault.decryptMap(row.social_refresh_tokens,id,'refresh'),{github:'rotated-github',twitch:'other-worker-rotated',youtube:'refresh-youtube'});
  assert.equal(row.social_connected_at.github,'2026-01-01T00:00:00Z');
});
