const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createAppHarness, member } = require('./test-support/app-harness');
const implementation = require('./mastodon-oauth');

test('Mastodon server selection accepts handles and rejects unsafe destinations', () => {
  for (const input of ['mastodon.social', 'https://mastodon.social/', '@alice@mastodon.social']) assert.equal(implementation.mastodonOrigin(input), 'https://mastodon.social');
  for (const input of ['', 'http://mastodon.social', 'https://user:secret@mastodon.social', 'localhost', '127.0.0.1', 'https://mastodon.social:8443', 'https://mastodon.social/redirect?url=x', 'https://private.internal']) assert.throws(() => implementation.mastodonOrigin(input));
});

test('Mastodon requests reject blocked DNS before sending credentials', async () => {
  let sent = false;
  const service = implementation.createMastodonService({ resolveAddress: async () => { throw new Error('blocked address'); }, pinnedLookup: () => {}, request: () => {sent = true;} });
  await assert.rejects(service.json('https://example.com', '/oauth/token', {form:{client_secret:'test-secret'}}), /blocked address/);
  assert.equal(sent, false);
});

test('Mastodon OAuth connects the account without adding posts to Following or Your Feed', async () => {
  const calls = [];
  const publicPost = { id:'123',content:'<p>Public update</p>',visibility:'public',created_at:new Date().toISOString(),url:'https://social.example/@alice/123',account:{id:'42',username:'alice',acct:'alice',url:'https://social.example/@alice'},media_attachments:[] };
  const service = {
    application: async (origin, redirect) => {calls.push({origin,redirect});return {client_id:'test-client',client_secret:'test-secret'};},
    json: async (origin, path, options) => {
      calls.push({origin,path,options});
      if (path === '/oauth/token') return {access_token:'test-access'};
      if (path === '/api/v1/accounts/verify_credentials') return {id:'42'};
      if (path.startsWith('/api/v1/timelines/home')) return [publicPost,{...publicPost,id:'124',visibility:'private'}];
      return [];
    },
  };
  const app = await createAppHarness({env:{PUBLIC_API_URL:'https://api.uficonnect.org',FRONTEND_URL:'https://uficonnect.org'}, modules:{'./mastodon-oauth':{...implementation,createMastodonService:()=>service}}});
  const user = member('masto-member'); app.seedUser(user); app.seedUser(member('business-member',{plan:'business'}));
  try {
    assert.equal((await app.request('/auth/social/mastodon/start?server=mastodon.social')).status,401);
    assert.equal((await app.request('/auth/social/mastodon/start?server=mastodon.social',{userId:'business-member'})).status,403);
    const catalog = await app.request('/social/platforms',{userId:user.id});
    assert.equal(catalog.data.platforms.mastodon.configured,true);
    assert.equal(catalog.data.platforms.mastodon.forceComingSoon,false);
    assert.equal(catalog.data.platforms.mastodon.commandCenterOnly,false);
    const start = await app.request('/auth/social/mastodon/start?server=%40alice%40social.example',{userId:user.id});
    assert.equal(start.status,200);
    const url = new URL(start.data.url);
    assert.equal(url.origin,'https://social.example');
    assert.equal(url.pathname,'/oauth/authorize');
    assert.equal(url.searchParams.get('scope'),implementation.MASTODON_SCOPES);
    assert.equal(url.searchParams.get('redirect_uri'),'https://api.uficonnect.org/auth/social/mastodon/callback');
    assert.equal(start.data.url.includes('test-secret'),false);
    const state = url.searchParams.get('state');
    const cookie = start.headers.get('set-cookie').split(';')[0];
    assert.match(start.headers.get('set-cookie'), /HttpOnly/);
    assert.match(start.headers.get('set-cookie'), /Secure/);
    assert.match(start.headers.get('set-cookie'), /SameSite=Lax/);
    const entry = app.verifyOAuthState(state,'mastodon');
    assert.equal(entry.extra.origin,'https://social.example');
    assert.equal(url.searchParams.get('code_challenge'),crypto.createHash('sha256').update(entry.codeVerifier).digest('base64url'));
    const bad = await fetch(app.base+'/auth/social/mastodon/callback?state=invalid&code=123',{redirect:'manual'});
    assert.match(bad.headers.get('location'),/reason=invalid_state/);
    assert.equal(calls.some(c=>c.path==='/oauth/token'),false);
    const callbackUrl = app.base+'/auth/social/mastodon/callback?'+new URLSearchParams({state,code:'auth-code'});
    const transferred = await fetch(callbackUrl,{redirect:'manual'});
    assert.match(transferred.headers.get('location'),/reason=browser_mismatch/);
    const wrongBrowser = await fetch(callbackUrl,{redirect:'manual',headers:{cookie:'ufi_mastodon_oauth=another-browser'}});
    assert.match(wrongBrowser.headers.get('location'),/reason=browser_mismatch/);
    assert.equal(calls.some(c=>c.path==='/oauth/token'),false);
    const callback = await fetch(callbackUrl,{redirect:'manual',headers:{cookie}});
    assert.match(callback.headers.get('set-cookie'),/Expires=Thu, 01 Jan 1970/);
    assert.equal(callback.headers.get('location'),'https://uficonnect.org/connected-accounts?social_connected=mastodon');
    assert.equal(calls.find(c=>c.path==='/oauth/token').options.form.code_verifier,entry.codeVerifier);
    const connected = await app.request('/social/platforms',{userId:user.id});
    assert.equal(connected.data.connected.mastodon,true);
    assert.equal(connected.data.platforms.mastodon.siteUrl,'https://social.example');
    assert.equal(JSON.stringify(connected.data).includes('test-access'),false);
    const feed = await app.getFollowingFeedPosts(user.id, 'mastodon', {bust:true,surface:'feed'});
    assert.equal(feed.posts.length,0);
    assert.equal(calls.some(call => call.path?.startsWith('/api/v1/timelines/')),false);
    assert.equal(catalog.data.platforms.mastodon.scopes.join(' '),'read:accounts');
    user.plan = 'pro';
    const own = await app.request('/command-center/your-content?platform=mastodon',{userId:user.id});
    assert.equal(own.status,400);
    const combined = await app.request('/command-center/your-content/feed',{userId:user.id});
    assert.equal(combined.status,200);
    assert.equal(combined.data.posts.length,0);
    assert.equal(calls.some(call => call.path?.includes('/statuses')),false);
    assert.deepEqual(app.errors,[]);
  } finally {await app.close();}
});
