'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./test-support/app-harness');
const { youtubeCanUpload, youtubeGrantedScopes } = require('./publishing-oauth');
const { YOUTUBE_SCOPES } = require('./youtube-permissions');
const READ = 'https://www.googleapis.com/auth/youtube.readonly';
const UPLOAD = 'https://www.googleapis.com/auth/youtube.upload';
const ENV = { YOUTUBE_CLIENT_ID: 'fixture-youtube-client', YOUTUBE_CLIENT_SECRET: 'fixture-youtube-secret',
  PUBLIC_API_URL: 'https://api.uficonnect.org', FRONTEND_URL: 'https://uficonnect.org' };

test('YouTube recognizes upload grants and rejects explicitly declined or malformed publishing scopes', () => {
  for (const scope of ['youtube.upload', 'youtube', 'youtube.force-ssl', 'youtubepartner']) {
    assert.equal(youtubeCanUpload([`https://www.googleapis.com/auth/${scope}`]), true);
  }
  for (const value of [undefined, null, [], [READ], [UPLOAD + '.untrusted']]) assert.equal(youtubeCanUpload(value), false);
  assert.deepEqual(youtubeGrantedScopes({}, `${READ} ${UPLOAD}`, true), [READ, UPLOAD]);
  assert.deepEqual(youtubeGrantedScopes({ scope: `${READ} ${READ} ${UPLOAD}` }, '', true), [READ, UPLOAD]);
  for (const scope of [READ, '', null, {}, [UPLOAD]]) {
    assert.throws(() => youtubeGrantedScopes({ scope }, `${READ} ${UPLOAD}`, true), { oauthReason: 'publishing_permission_required' });
  }
});

test('one YouTube publishing connection requests uploads and returns to Cross-Post with truthful private permission state', { timeout: 60000 }, async t => {
  const app = await createAppHarness({ env: ENV });
  t.after(() => app.close());
  const owner = member('youtube-single-connect', { plan: 'pro', socialTokens: { youtube: 'legacy-access' }, socialRefreshTokens: { youtube: 'legacy-refresh' } });
  app.seedUser(owner);
  app.setFollowingFetcher('youtube', async () => []);
  let exchanges = 0;
  let reply = { access_token: 'upload-access', refresh_token: 'upload-refresh', scope: `${READ} ${UPLOAD}` };
  app.setTokenExchange(async (url, form) => {
    exchanges++;
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(form.redirect_uri, 'https://api.uficonnect.org/auth/social/youtube/callback');
    assert.equal(form.client_id, ENV.YOUTUBE_CLIENT_ID);
    assert.ok(form.code_verifier);
    return reply;
  });
  async function start(publishing = true) {
    const response = await app.request(`/auth/social/youtube/start?returnTo=command-center${publishing ? '&publishing=1' : ''}`, { userId: owner.id });
    assert.equal(response.status, 200);
    return { response, url: new URL(response.data.url) };
  }
  async function complete(flow, query = {}) {
    return fetch(`${app.base}/auth/social/youtube/callback?${new URLSearchParams({ state: flow.url.searchParams.get('state'), code: 'fixture-code', ...query })}`, {
      redirect: 'manual', headers: { cookie: flow.response.headers.get('set-cookie').split(';')[0] },
    });
  }
  async function catalog() {
    const result = await app.request('/social/platforms', { userId: owner.id });
    assert.equal(result.status, 200);
    const serialized = JSON.stringify(result.data);
    for (const value of ['legacy-access', 'upload-access', 'upload-refresh', 'socialGrantedScopes']) assert.equal(serialized.includes(value), false);
    return result.data.platforms.youtube;
  }
  assert.equal((await catalog()).crossPost.reconnectRequired, true, 'Legacy grants are not assumed to allow uploads');
  const flow = await start();
  assert.deepEqual(new Set(flow.url.searchParams.get('scope').split(' ')), new Set(YOUTUBE_SCOPES));
  assert.equal(flow.url.searchParams.get('access_type'), 'offline');
  assert.equal(flow.url.searchParams.get('prompt'), 'consent');
  assert.equal(flow.url.searchParams.get('include_granted_scopes'), 'true');
  assert.equal(flow.url.searchParams.get('code_challenge_method'), 'S256');
  const signed = app.verifyOAuthState(flow.url.searchParams.get('state'), 'youtube');
  assert.equal(signed.extra.publishing, true);
  assert.equal(signed.extra.requestedScopes, YOUTUBE_SCOPES.join(' '));
  const success = await complete(flow);
  assert.equal(success.headers.get('location'), 'https://uficonnect.org/command-center?tab=crosspost&social_connected=youtube');
  assert.equal(owner.socialTokens.youtube, 'upload-access');
  assert.equal(owner.socialRefreshTokens.youtube, 'upload-refresh');
  assert.deepEqual(owner.socialGrantedScopes.youtube, [READ, UPLOAD]);
  assert.equal((await catalog()).crossPost.reconnectRequired, false);
  assert.equal(JSON.stringify(app.fullProfile(owner)).includes('socialGrantedScopes'), false);

  reply = { access_token: 'declined-access', refresh_token: 'declined-refresh', scope: READ };
  const declined = await complete(await start());
  assert.equal(declined.headers.get('location'), 'https://uficonnect.org/command-center?tab=crosspost&social_error=youtube&reason=publishing_permission_required');
  assert.equal(owner.socialTokens.youtube, 'upload-access', 'Partial consent cannot overwrite the working grant');
  assert.equal(owner.socialRefreshTokens.youtube, 'upload-refresh');
  assert.deepEqual(owner.socialGrantedScopes.youtube, [READ, UPLOAD]);

  const beforeCancel = exchanges;
  const canceled = await complete(await start(), { error: 'access_denied' });
  assert.equal(canceled.headers.get('location'), 'https://uficonnect.org/command-center?tab=crosspost&social_error=youtube&reason=access_denied');
  assert.equal(exchanges, beforeCancel);

  reply = { access_token: 'read-access', scope: READ };
  const profileOnly = await complete(await start(false), { publishing: '1' });
  assert.equal(profileOnly.headers.get('location'), 'https://uficonnect.org/command-center?tab=accounts&social_connected=youtube');
  assert.deepEqual(owner.socialGrantedScopes.youtube, [READ], 'Callback query cannot forge signed publishing intent');
  assert.equal((await catalog()).crossPost.reconnectRequired, true);

  reply = { access_token: 'implicit-upload-access' };
  await complete(await start());
  assert.deepEqual(owner.socialGrantedScopes.youtube, YOUTUBE_SCOPES, 'Omitted scope uses only our signed requested grants');
  assert.equal(owner.socialRefreshTokens.youtube, 'upload-refresh');
  assert.equal((await catalog()).crossPost.reconnectRequired, false);
  assert.equal((await app.request('/social/connect/youtube', { method: 'DELETE', userId: owner.id })).status, 200);
  assert.equal(owner.socialGrantedScopes.youtube, undefined);
});

test('YouTube token and grant metadata persist atomically, survive refresh and rehydrate without changing other providers', { timeout: 60000 }, async t => {
  const { PGlite } = require('@electric-sql/pglite');
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec('CREATE TABLE users(id uuid PRIMARY KEY,social_tokens jsonb,social_refresh_tokens jsonb,social_connected_at jsonb,social_granted_scopes jsonb)');
  const id = '11111111-1111-4111-8111-111111111111';
  await pg.query('INSERT INTO users VALUES($1,$2,$3,$4,$5)', [id, '{}', '{}', '{}', JSON.stringify({ github: ['read:user'] })]);
  let failSave = false;
  const app = await createAppHarness({ connected: true, env: ENV,
    query: (sql, params) => {
      if (failSave && sql.includes('UPDATE users SET social_tokens')) throw Error('Synthetic storage failure');
      return pg.query(sql, params);
    },
    withClient: fn => fn({ query: (sql, params) => pg.query(sql, params) }),
  });
  t.after(() => app.close());
  const owner = member(id, { plan: 'pro', socialGrantedScopes: { github: ['read:user'] } });
  app.seedUser(owner);
  await app.saveSocialToken(id, 'youtube', 'private-access', 'private-refresh', null, [READ, UPLOAD]);
  const read = async () => (await pg.query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
  const row = await read();
  assert.match(row.social_tokens.youtube, /^enc:v1:/);
  assert.match(row.social_refresh_tokens.youtube, /^enc:v1:/);
  assert.deepEqual(row.social_granted_scopes, { github: ['read:user'], youtube: [READ, UPLOAD] });
  assert.deepEqual(app.dbRowToMemUser(row).socialGrantedScopes, row.social_granted_scopes);
  failSave = true;
  await assert.rejects(app.saveSocialToken(id, 'youtube', 'failed-access', 'failed-refresh', null, [READ]), /Synthetic storage failure/);
  assert.equal(owner.socialTokens.youtube, 'private-access');
  assert.deepEqual(owner.socialGrantedScopes.youtube, [READ, UPLOAD]);
  assert.deepEqual((await read()).social_granted_scopes.youtube, [READ, UPLOAD]);
  failSave = false;
  app.setTokenExchange(async () => ({ access_token: 'refreshed-access', refresh_token: 'rotated-refresh' }));
  assert.equal(await app.refreshConnectedAccessToken(id, 'youtube', 'private-access'), 'refreshed-access');
  assert.deepEqual((await read()).social_granted_scopes.youtube, [READ, UPLOAD]);
  app.setTokenExchange(async () => ({ access_token: 'read-only-refresh', scope: READ }));
  assert.equal(await app.refreshConnectedAccessToken(id, 'youtube', 'refreshed-access'), 'read-only-refresh');
  assert.deepEqual((await read()).social_granted_scopes, { github: ['read:user'], youtube: [READ] });
  await app.removeSocialToken(id, 'youtube');
  assert.deepEqual((await read()).social_granted_scopes, { github: ['read:user'] });
});
