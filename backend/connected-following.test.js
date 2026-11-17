'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./test-support/app-harness');
const { createConnectedTokenRefresher } = require('./connected-token-refresh');
const signingKey = JSON.stringify({ ...require('node:crypto').generateKeyPairSync('ec', { namedCurve:'P-256' }).privateKey.export({format:'jwk'}), kid:'test-key' });
const blueskySession = (accessToken, fields = {}) => JSON.stringify({ accessToken, did: 'did:plc:member',
  pdsUrl: 'https://pds.example', tokenEndpoint: 'https://auth.example/token', issuer: 'https://auth.example', ...fields });
const jwtPayload = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));

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
    const old = source === 'bluesky' ? blueskySession('expired') : 'expired';
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
  let now = Date.now();
  const app = await createAppHarness({ clock: () => now }); t.after(()=>app.close());
  const viewer=member('revoked',{socialTokens:{github:'expired'},socialRefreshTokens:{github:'revoked-refresh'}});
  app.seedUser(viewer);
  let fetches=0, renewals=0;
  app.setFollowingFetcher('github', async token => { fetches++; if (token === 'expired') throw new Error('HTTP 401'); return []; });
  app.setTokenExchange(async () => { renewals++; return { error: 'invalid_grant' }; });
  const result=await app.request('/office/feed?mode=following&passive=1',{userId:viewer.id});
  assert.equal(result.status,200); assert.equal(fetches,1);
  assert.match(result.data.sourceErrors.github,/Reconnect/);
  assert.equal(JSON.stringify(result.data).includes('revoked-refresh'),false);
  for (let minute = 0; minute < 10; minute++) {
    now += 60_000;
    await app.refreshFollowingSourceCaches();
  }
  const duringBackoff = await app.getFollowingFeedPosts(viewer.id, 'github', { bust: true });
  assert.match(duringBackoff.sourceErrors.github, /Reconnect/);
  assert.equal(fetches, 1);
  assert.equal(renewals, 1);
  // Simulate credentials reloaded after a different worker reconnects.
  viewer.socialTokens.github = 'replacement';
  viewer.socialRefreshTokens.github = 'replacement-refresh';
  await app.refreshFollowingSourceCaches();
  const afterReconnect = await app.getFollowingFeedPosts(viewer.id, 'github');
  assert.deepEqual(Object.keys(afterReconnect.sourceErrors), []);
  assert.equal(fetches, 2);
  assert.equal(renewals, 1);
});

test('Bluesky renews known expired access before reading and reuses the PDS nonce between pages', async t => {
  const app = await createAppHarness({ env: { BLUESKY_SIGNING_KEY: signingKey } });
  t.after(() => app.close());
  const viewer = member('bluesky-following', { socialTokens: { bluesky: blueskySession('expired', { expiresAt: Date.now() - 1 }) },
    socialRefreshTokens: { bluesky: 'refresh' }, socialConnectedAt: { bluesky: new Date().toISOString() } });
  app.seedUser(viewer);
  const assertions = [];
  app.setAtprotoTokenExchange(async (url, params, headers) => {
    assert.equal(url, 'https://auth.example/token');
    assert.equal(params.refresh_token, 'refresh');
    const assertion = jwtPayload(params.client_assertion);
    assert.equal(assertion.aud, 'https://auth.example');
    assert.equal(assertion.exp - assertion.iat, 60);
    assertions.push(assertion.jti);
    const proof = jwtPayload(headers.DPoP);
    if (assertions.length === 1) {
      assert.equal(proof.nonce, undefined);
      return { status: 400, headers: { 'dpop-nonce': 'auth-nonce' }, data: { error: 'use_dpop_nonce' } };
    }
    assert.equal(proof.nonce, 'auth-nonce');
    return { status: 200, data: { access_token: 'renewed', refresh_token: 'rotated', sub: 'did:plc:member', expires_in: 300 } };
  });
  const reads = [];
  app.setAtprotoGetTransport(async (url, headers) => {
    assert.equal(headers.Authorization, 'DPoP renewed');
    const { nonce } = jwtPayload(headers.DPoP);
    reads.push(nonce);
    if (reads.length === 1) return { status: 401, headers: { 'dpop-nonce': 'pds-first' }, data: { error: 'use_dpop_nonce' } };
    const cursor = new URL(url).searchParams.get('cursor');
    if (!cursor) return { status: 200, headers: { 'dpop-nonce': 'pds-next' }, data: { cursor: 'more', feed: [{ post: {
      cid: 'samplepost', uri: 'at://did:plc:author/app.bsky.feed.post/post1', author: { did: 'did:plc:author', handle: 'author.example' },
      record: { text: 'A followed author shares a useful update.', createdAt: new Date().toISOString() },
    } }] } };
    return { status: 200, headers: {}, data: { feed: [] } };
  });
  const result = await app.request('/office/feed?mode=following&passive=1', { userId: viewer.id });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.sourceErrors, {});
  assert.equal(result.data.posts[0]?.id, 'bluesky_samplepost');
  assert.deepEqual(reads, [undefined, 'pds-first', 'pds-next']);
  assert.equal(assertions.length, 2);
  assert.notEqual(assertions[0], assertions[1]);
  assert.equal(viewer.socialRefreshTokens.bluesky, 'rotated');
  assert.ok(JSON.parse(viewer.socialTokens.bluesky).expiresAt > Date.now());
});

test('a Bluesky authorization server outage retries after the normal refresh interval', async t => {
  let now = Date.now();
  const app = await createAppHarness({ env: { BLUESKY_SIGNING_KEY: signingKey }, clock: () => now });
  t.after(() => app.close());
  const viewer = member('bluesky-retry', { socialTokens: { bluesky: blueskySession('expired') }, socialRefreshTokens: { bluesky: 'refresh' } });
  app.seedUser(viewer);
  app.setAtprotoGetTransport(async (_url, headers) => headers.Authorization === 'DPoP expired'
    ? { status: 401, headers: {}, data: { error: 'invalid_token', message: 'private upstream response' } }
    : { status: 200, headers: {}, data: { feed: [] } });
  let renewals = 0;
  app.setAtprotoTokenExchange(async () => ++renewals === 1 ? { status: 503, data: { error: 'private service details' } }
    : { status: 200, data: { access_token: 'new', refresh_token: 'rotated' } });
  const first = await app.getFollowingFeedPosts(viewer.id, 'bluesky');
  assert.equal(first.sourceErrors.bluesky, 'Bluesky access renewal is temporarily unavailable.');
  now += 60_000;
  await app.refreshFollowingSourceCaches();
  assert.equal(renewals, 1);
  now += 4 * 60_000;
  await app.refreshFollowingSourceCaches();
  assert.equal(renewals, 2);
  assert.deepEqual(Object.keys((await app.getFollowingFeedPosts(viewer.id, 'bluesky')).sourceErrors), []);
});

test('Bluesky own-content reads and publishing reuse the account refresh flow', async t => {
  const app = await createAppHarness({ env: { BLUESKY_SIGNING_KEY: signingKey } });
  t.after(() => app.close());
  const viewer = member('bluesky-pro', { plan: 'pro', socialTokens: { bluesky: blueskySession('expired') }, socialRefreshTokens: { bluesky: 'refresh' } });
  app.seedUser(viewer);
  let renewals = 0;
  app.setAtprotoTokenExchange(async () => ({ status: 200, data: { access_token: `fresh-${++renewals}`, refresh_token: 'rotated' } }));
  app.setAtprotoGetTransport(async (url, headers) => {
    assert.equal(new URL(url).pathname, '/xrpc/app.bsky.feed.getAuthorFeed');
    if (headers.Authorization === 'DPoP expired') return { status: 401, headers: {}, data: { error: 'invalid_token' } };
    assert.equal(headers.Authorization, 'DPoP fresh-1');
    return { status: 200, headers: {}, data: { feed: [] } };
  });
  const own = await app.request('/command-center/your-content?platform=bluesky', { userId: viewer.id });
  assert.equal(own.status, 200);
  assert.equal(renewals, 1);

  viewer.socialTokens.bluesky = blueskySession('fresh-1', { expiresAt: Date.now() - 1 });
  let writes = 0;
  app.setPostJSONWithMeta(async (url, _body, headers) => {
    assert.equal(new URL(url).pathname, '/xrpc/com.atproto.repo.createRecord');
    assert.equal(headers.Authorization, 'DPoP fresh-2');
    writes++;
    return { status: 200, headers: {}, data: { uri: 'at://did:plc:member/app.bsky.feed.post/new-post' } };
  });
  const published = await app.publishCrossPostTarget(viewer, 'bluesky', { content: 'An update from my account.' });
  assert.equal(published.status, 'posted', published.error);
  assert.equal(renewals, 2);
  assert.equal(writes, 1);
});

test('Bluesky DPoP proof binds the target path without query or fragment', async t => {
  const app=await createAppHarness({env:{BLUESKY_SIGNING_KEY:signingKey}}); t.after(()=>app.close());
  const token=app.createDPoPProof('GET','https://pds.example/xrpc/app.bsky.feed.getTimeline?limit=100#ignored',{accessToken:'fixture'});
  const payload=jwtPayload(token);
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
