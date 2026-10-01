const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createSourceInteractions, parseTarget, registerSourceInteractionRoutes } = require('./source-interactions');

function transport(responses = []) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    const next = responses.shift() || { status: 204 };
    return new Response(next.status === 204 ? null : JSON.stringify(next.body || {}), { status: next.status || 200 });
  } };
}
const user = { id: 'member', socialTokens: { reddit: 'reddit-secret', twitter: 'x-secret', youtube: 'yt-secret', github: 'gh-secret', gitlab: 'gl-secret' } };

test('targets reject credential destinations, spoofed hosts and malformed source IDs', () => {
  for (const url of ['https://github.com.evil.test/owner/repo', 'https://github.com@evil.test/owner/repo', 'http://github.com/owner/repo', 'https://github.com:444/owner/repo', 'https://127.0.0.1/owner/repo']) assert.throws(() => parseTarget('github', url));
  assert.throws(() => parseTarget('youtube', 'https://youtube.com/watch?v=not-valid'));
  assert.equal(parseTarget('github', 'https://github.com/owner/repo').comment, false);
  assert.equal(parseTarget('github', 'https://github.com/owner/repo/pull/42').comment, true);
  assert.equal(parseTarget('gitlab', 'https://gitlab.com/group/sub/project/-/issues/9').project, 'group%2Fsub%2Fproject');
});

test('source writes require that member connection before any provider request', async () => {
  const mock = transport(); const { perform } = createSourceInteractions(mock);
  await assert.rejects(perform({ user: { socialTokens: {} }, source: 'reddit', sourceUrl: 'https://reddit.com/r/test/comments/abc/title', action: 'like', liked: true }), /Connect this source/);
  await assert.rejects(perform({ user, source: 'github', sourceUrl: 'https://github.com/org/repo', action: 'comment', content: 'Hello' }), /original source/);
  await assert.rejects(perform({ user, source: 'twitter', sourceUrl: 'https://x.com/person/status/123', action: 'comment', content: 'x'.repeat(281) }), /280/);
  assert.equal(mock.calls.length, 0);
});

test('Reddit uses submission fullname and acknowledges only real provider success', async () => {
  const mock = transport([{ status: 200, body: {} }, { status: 200, body: { json: { errors: [], data: { things: [{ data: { id: 'comment-id' } }] } } } }]);
  const { perform } = createSourceInteractions(mock);
  const args = { user, source: 'reddit', sourceUrl: 'https://www.reddit.com/r/test/comments/abc123/title' };
  assert.deepEqual(await perform({ ...args, action: 'like', liked: true }), { liked: true });
  assert.deepEqual(await perform({ ...args, action: 'comment', content: 'A thoughtful reply' }), { commentId: 'comment-id' });
  assert.equal(mock.calls[0].url, 'https://oauth.reddit.com/api/vote');
  assert.equal(new URLSearchParams(mock.calls[0].body).get('id'), 't3_abc123');
  assert.equal(new URLSearchParams(mock.calls[1].body).get('thing_id'), 't3_abc123');
  assert.equal(mock.calls[0].headers.Authorization, 'Bearer reddit-secret');
  assert.equal(mock.calls[0].redirect, 'error');
});

test('X resolves the acting member and sends likes and replies to the selected post', async () => {
  const mock = transport([{ status: 200, body: { data: { id: '77' } } }, { status: 200, body: { data: { liked: true } } }, { status: 201, body: { data: { id: '88' } } }]);
  const { perform } = createSourceInteractions(mock);
  const args = { user, source: 'twitter', sourceUrl: 'https://x.com/author/status/1234' };
  await perform({ ...args, action: 'like', liked: true });
  await perform({ ...args, action: 'comment', content: 'Thanks for sharing' });
  assert.equal(mock.calls[1].url, 'https://api.x.com/2/users/77/likes');
  assert.deepEqual(JSON.parse(mock.calls[1].body), { tweet_id: '1234' });
  assert.deepEqual(JSON.parse(mock.calls[2].body).reply, { in_reply_to_tweet_id: '1234' });
});

test('YouTube rates a video and publishes a top-level comment to its channel', async () => {
  const mock = transport([{ status: 204 }, { status: 200, body: { items: [{ snippet: { channelId: 'channel-1' } }] } }, { status: 200, body: { id: 'yt-comment' } }]);
  const { perform } = createSourceInteractions(mock);
  const args = { user, source: 'youtube', sourceUrl: 'https://youtu.be/abcdefghijk' };
  await perform({ ...args, action: 'like', liked: false });
  await perform({ ...args, action: 'comment', content: 'Helpful video' });
  assert.match(mock.calls[0].url, /rating=none$/);
  assert.deepEqual(JSON.parse(mock.calls[2].body).snippet, { videoId: 'abcdefghijk', channelId: 'channel-1', topLevelComment: { snippet: { textOriginal: 'Helpful video' } } });
});

test('repository reactions are stars and comments keep issue or merge-request identity', async () => {
  const mock = transport([{ status: 204 }, { status: 201, body: { id: 901 } }, { status: 200 }, { status: 201, body: { id: 902 } }]);
  const { perform } = createSourceInteractions(mock);
  await perform({ user, source: 'github', sourceUrl: 'https://github.com/org/repo/pull/21', action: 'like', liked: true });
  await perform({ user, source: 'github', sourceUrl: 'https://github.com/org/repo/pull/21', action: 'comment', content: 'Review question' });
  await perform({ user, source: 'gitlab', sourceUrl: 'https://gitlab.com/org/sub/repo/-/merge_requests/12', action: 'like', liked: false });
  await perform({ user, source: 'gitlab', sourceUrl: 'https://gitlab.com/org/sub/repo/-/merge_requests/12', action: 'comment', content: 'Review question' });
  assert.equal(mock.calls[0].url, 'https://api.github.com/user/starred/org/repo');
  assert.equal(mock.calls[1].url, 'https://api.github.com/repos/org/repo/issues/21/comments');
  assert.equal(mock.calls[2].url, 'https://gitlab.com/api/v4/projects/org%2Fsub%2Frepo/unstar');
  assert.equal(mock.calls[3].url, 'https://gitlab.com/api/v4/projects/org%2Fsub%2Frepo/merge_requests/12/notes');
});

test('Bluesky replies preserve root identity and unlike deletes only the acting member record', async () => {
  const uri = 'at://did:plc:author/app.bsky.feed.post/abc';
  const root = { uri: 'at://did:plc:root/app.bsky.feed.post/root', cid: 'root-cid' };
  const calls = [];
  const { perform } = createSourceInteractions({
    atprotoGet: async () => ({ status: 200, data: { posts: [{ uri, cid: 'parent-cid', record: { reply: { root } }, viewer: { like: 'at://did:plc:me/app.bsky.feed.like/like123' } }] } }),
    atprotoPostJSON: async (url, body, options) => { calls.push({ url, body, options }); return { status: 200, data: { uri: 'at://did:plc:me/app.bsky.feed.post/reply' } }; },
  });
  const args = { user: { socialTokens: { bluesky: JSON.stringify({ accessToken: 'dpop-secret', did: 'did:plc:me', pdsUrl: 'https://pds.example' }) } }, source: 'bluesky', sourceUrl: 'https://bsky.app/profile/did:plc:author/post/abc' };
  await perform({ ...args, action: 'comment', content: 'A reply' });
  assert.deepEqual(calls[0].body.record.reply, { root, parent: { uri, cid: 'parent-cid' } });
  await perform({ ...args, action: 'like', liked: false });
  assert.deepEqual(calls[1].body, { repo: 'did:plc:me', collection: 'app.bsky.feed.like', rkey: 'like123' });
});

test('provider errors never become local success or expose provider bodies', async () => {
  for (const status of [401, 403, 429, 500]) {
    const mock = transport([{ status, body: { message: 'TOKEN-SECRET internal error' } }]);
    await assert.rejects(createSourceInteractions(mock).perform({ user, source: 'github', sourceUrl: 'https://github.com/org/repo', action: 'like', liked: true }), error => error.status >= 400 && !error.message.includes('TOKEN-SECRET'));
  }
});

test('route authenticates, screens, deduplicates and isolates member requests', async t => {
  const app = express(); app.use(express.json());
  const mock = transport(Array.from({ length: 4 }, () => ({ status: 201, body: { id: 900 } })));
  registerSourceInteractionRoutes(app, { ...mock,
    authenticate: (req, res, next) => { if (!req.headers['x-member']) return res.sendStatus(401); req.user = { id: req.headers['x-member'] }; next(); },
    limiter: (_req, _res, next) => next(), getUser: async id => ({ ...user, id }),
    screenMemberContent: async ({ content }) => ({ allowed: content !== 'blocked', content }),
  });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const payload = { source: 'github', sourceUrl: 'https://github.com/org/repo/issues/3', action: 'comment', content: 'Useful question', requestId: '12345678-1234-1234-1234-123456789012' };
  const send = (id, body = payload) => fetch(base + '/social/interactions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(id ? { 'x-member': id } : {}) }, body: JSON.stringify(body) });
  assert.equal((await send(null)).status, 401);
  assert.equal((await send('a', { ...payload, content: 'blocked' })).status, 422);
  assert.equal(mock.calls.length, 0);
  const allowed = { ...payload, requestId: '22345678-1234-1234-1234-123456789012' };
  const results = await Promise.all([send('a', allowed), send('a', allowed)]);
  assert.ok(results.every(result => result.status === 200)); assert.equal(mock.calls.length, 1);
  assert.equal((await send('a', { ...allowed, content: 'Different content' })).status, 409);
  assert.equal((await send('b', allowed)).status, 200); assert.equal(mock.calls.length, 2);
  const capabilities = await fetch(base + '/social/interaction-capabilities', { headers: { 'x-member': 'a' } });
  assert.equal(capabilities.headers.get('cache-control'), 'private, no-store');
  const body = await capabilities.text(); assert.ok(!body.includes('secret'));
});

test('runtime revocation blocks transport and supplies only a safe source fallback', async t => {
  const app = express(); app.use(express.json());
  const mock = transport();
  const env = { SOURCE_GITHUB_LIKE_ENABLED: 'false' };
  const audits = [];
  registerSourceInteractionRoutes(app, { ...mock, policyEnv: env,
    authenticate: (req, _res, next) => { req.user = { id: 'member' }; next(); },
    limiter: (_req, _res, next) => next(), getUser: async () => user,
    screenMemberContent: async ({ content }) => ({ allowed: true, content }),
    auditInteraction: async event => audits.push(event),
  });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const payload = { source: 'github', sourceUrl: 'https://github.com/org/repo', action: 'like', liked: true, requestId: 'runtime-disabled-0001' };
  const send = body => fetch(base + '/social/interactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const denied = await send(payload);
  assert.equal(denied.status, 422);
  assert.deepEqual((await denied.json()).fallback, { url: payload.sourceUrl, label: 'Star repository on GitHub' });
  assert.equal(mock.calls.length, 0);
  const malicious = await send({ ...payload, sourceUrl: 'https://github.com.evil.test/org/repo', requestId: 'runtime-disabled-0002' });
  assert.equal((await malicious.json()).fallback, undefined);
  env.SOURCE_GITHUB_LIKE_ENABLED = 'true';
  const successful = { ...payload, requestId: 'runtime-enabled-00003' };
  assert.equal((await send(successful)).status, 200);
  assert.equal((await send(successful)).status, 200);
  assert.equal(mock.calls.length, 1);
  assert.equal(audits.length, 3);
  assert.deepEqual(Object.keys(audits[2]).sort(), ['memberId', 'interactionRequestId', 'sourcePlatform', 'sourcePostId', 'actionType', 'status', 'timestamp'].sort());
  assert.equal(audits[2].sourcePostId, 'org/repo');
  assert.equal(audits[2].status, 'succeeded');
  assert.equal(JSON.stringify(audits).includes('secret'), false);
});

test('policy is checked again after comment screening and confirmed writes survive audit outage', async t => {
  const app = express(); app.use(express.json());
  const mock = transport([{ status: 201, body: { id: 99 } }]);
  const env = {};
  registerSourceInteractionRoutes(app, { ...mock, policyEnv: env,
    authenticate: (req, _res, next) => { req.user = { id: 'member' }; next(); },
    limiter: (_req, _res, next) => next(), getUser: async () => user,
    screenMemberContent: async ({ content }) => { if (content === 'revoke') env.SOURCE_GITHUB_COMMENT_ENABLED = 'false'; return { allowed: true, content }; },
    auditInteraction: async () => { throw new Error('database unavailable'); },
  });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const send = body => fetch(`http://127.0.0.1:${server.address().port}/social/interactions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const payload = { source: 'github', sourceUrl: 'https://github.com/org/repo/issues/3', action: 'comment', content: 'revoke', requestId: 'revoked-comment-0001' };
  assert.equal((await send(payload)).status, 422);
  assert.equal(mock.calls.length, 0);
  env.SOURCE_GITHUB_COMMENT_ENABLED = 'true';
  const response = await send({ ...payload, content: 'A useful comment', requestId: 'accepted-comment-0002' });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.published, true);
  assert.equal(data.auditRecorded, false);
  assert.equal(data.commentId, '99');
  assert.equal(data.likesCount, undefined);
  assert.equal(mock.calls.length, 1);
});

test('durable reservations prevent another worker from repeating a pending or completed source action', async t => {
  const reservations = new Map(), fingerprints = [];
  let sourceCalls = 0, releaseSource, announceStarted;
  const started = new Promise(resolve => { announceStarted = resolve; });
  const transportOptions = {
    policyEnv: {},
    fetchImpl: async () => { sourceCalls++; announceStarted(); await new Promise(resolve => { releaseSource = resolve; }); return new Response(null, { status: 204 }); },
    authenticate: (req, _res, next) => { req.user = { id: 'member' }; next(); },
    limiter: (_req, _res, next) => next(), getUser: async () => user,
    screenMemberContent: async ({content}) => ({allowed:true,content}),
    reserveInteraction: async ({memberId,requestId,fingerprint}) => {
      fingerprints.push(fingerprint);
      const key = `${memberId}:${requestId}`, existing = reservations.get(key);
      if (existing && existing.fingerprint !== fingerprint) return {status:409,body:{message:'Request identity conflict.'}};
      if (existing) return existing.result || {status:409,body:{message:'Pending source request.'}};
      reservations.set(key,{fingerprint}); return null;
    },
    completeInteraction: async ({memberId,requestId,result}) => { reservations.get(`${memberId}:${requestId}`).result = result; },
  };
  const startWorker = async () => {
    const app = express(); app.use(express.json()); registerSourceInteractionRoutes(app,transportOptions);
    const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}/social/interactions`;
  };
  const [workerA,workerB,workerC]=await Promise.all([startWorker(),startWorker(),startWorker()]);
  const body={source:'github',sourceUrl:'https://github.com/org/repo',action:'like',liked:true,requestId:'durable-request-0001'};
  const send=(url,payload=body)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const first=send(workerA); await started;
  assert.equal((await send(workerB)).status,409);
  assert.equal(sourceCalls,1);
  releaseSource(); const confirmed=await first; assert.equal(confirmed.status,200);
  assert.equal((await send(workerC)).status,200);
  assert.equal(sourceCalls,1);
  assert.ok(fingerprints.every(value=>/^[a-f0-9]{64}$/.test(value)));
  assert.equal((await send(workerA,{...body,liked:false})).status,409);
});

test('reservation outage fails closed and completion outage preserves confirmed success', async t => {
  let unavailable=true, sourceCalls=0;
  const app=express(); app.use(express.json());
  registerSourceInteractionRoutes(app,{
    policyEnv:{},fetchImpl:async()=>{sourceCalls++;return new Response(null,{status:204});},
    authenticate:(req,_res,next)=>{req.user={id:'member'};next();},limiter:(_req,_res,next)=>next(),getUser:async()=>user,
    screenMemberContent:async({content})=>({allowed:true,content}),
    reserveInteraction:async()=>{if(unavailable)throw new Error('DB-SECRET');return null;},
    completeInteraction:async()=>{throw new Error('DB-SECRET');},
  });
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const send=requestId=>fetch(`http://127.0.0.1:${server.address().port}/social/interactions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'github',sourceUrl:'https://github.com/org/repo',action:'like',liked:true,requestId})});
  const denied=await send('storage-unavailable-0001');assert.equal(denied.status,503);assert.equal(sourceCalls,0);assert.equal((await denied.text()).includes('SECRET'),false);
  unavailable=false;
  const response=await send('completion-unavailable-0002');assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.published,true);assert.equal(body.completionRecorded,false);assert.equal(sourceCalls,1);
});
