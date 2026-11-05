'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./test-support/app-harness');
const business = require('./business-posts');
const { snapshotJobAuthorization } = require('./job-publishing');

test('real application Jobs policy uses the existing verified provider adapter and plan boundary', async t => {
  let jobs;
  const calls = [];
  const repository = { full_name: 'member/project', private: false, permissions: { push: true } };
  const app = await createAppHarness({ env: { GITHUB_CLIENT_ID: 'synthetic-client', GITHUB_CLIENT_SECRET: 'synthetic-secret', LINKEDIN_CLIENT_ID: 'synthetic-linkedin', LINKEDIN_CLIENT_SECRET: 'synthetic-secret', TWITTER_CLIENT_ID: 'synthetic-x', TWITTER_CLIENT_SECRET: 'synthetic-secret' },
    modules: {
      './business-posts': { ...business, createBusinessPosts: options => { jobs = options; return business.createBusinessPosts(options); } },
      './publishing-http': { createPublishingHttp: () => ({ request: async (url, options = {}) => {
        calls.push({ url, ...options });
        assert.equal(new URL(url).hostname, 'api.github.com');
        const respond = (data, status = 200) => ({ status, data, headers: {} });
        const pathname = new URL(url).pathname;
        if (pathname === '/user') return respond({ id: 7, login: 'member' });
        if (pathname === '/repos/member/project') return respond(repository);
        if (pathname === '/repos/member/project/git/ref/tags/hiring') return respond({ ref: 'refs/tags/hiring', object: { sha: 'synthetic-commit' } });
        if (pathname === '/repos/member/project/releases/tags/hiring') return respond({}, 404);
        if (pathname === '/repos/member/project/releases' && options.method === 'POST') {
          assert.equal(options.headers.Authorization, 'Bearer synthetic-github-token');
          assert.equal(options.json.body, 'Complete hiring post.');
          assert.equal(options.json.name, 'Hiring');
          assert.equal(options.authorizationIdentity, undefined);
          return respond({ id: 99, tag_name: 'hiring', draft: false, author: { id: 7 }, html_url: 'https://github.com/member/project/releases/tag/hiring' }, 201);
        }
        throw Error('Unexpected synthetic publishing request');
      } }) },
    } });
  t.after(() => app.close());
  const pro = member('job-publishing-pro', { plan: 'pro', socialTokens: { github: 'synthetic-github-token', linkedin: 'synthetic-linkedin-token' } });
  app.seedUser(pro);
  const payload = { content: 'Complete hiring post.', mediaUrl: null, settings: { destinationId: 'member/project', tagName: 'hiring', title: 'Hiring' }, crossPostId: 'bp_synthetic_job', authorizationIdentity: snapshotJobAuthorization(pro, ['github']).github };
  await jobs.validateJobTargets(pro, { targets: ['github'], content: payload.content });
  const outcome = await jobs.publishJobTarget(pro, 'github', payload);
  assert.equal(outcome.status, 'posted'); assert.equal(outcome.postedUrl, 'https://github.com/member/project/releases/tag/hiring');
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.throws(() => jobs.validateJobTargets({ ...pro, plan: 'free' }, { targets: ['github'], content: payload.content }), { status: 403 });
  assert.throws(() => jobs.validateJobTargets({ ...pro, plan: 'business' }, { targets: ['github'], content: payload.content }), { status: 403 });
  assert.doesNotThrow(() => jobs.validateJobTargets({ ...pro, plan: 'business' }, { targets: ['linkedin'], content: payload.content }));
  const catalog = (await app.request('/social/platforms', { userId: pro.id })).data;
  assert.equal(Boolean(catalog.platforms.linkedin.crossPost.settingsRequired), false, 'LinkedIn does not use the Pro-only destination-template route');
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);

  // Exercise the real legacy 401 path: a replacement connection must not be
  // refreshed or used for a second send after the original request is refused.
  pro.socialTokens.twitter = 'synthetic-original-x';
  pro.socialRefreshTokens.twitter = 'synthetic-original-refresh';
  let legacySends = 0, refreshes = 0;
  app.setPostJSONWithMeta(async (url, _body, headers) => {
    assert.equal(url, 'https://api.twitter.com/2/tweets');
    assert.equal(headers.Authorization, 'Bearer synthetic-original-x');
    legacySends++;
    pro.socialTokens.twitter = 'synthetic-replacement-account-x';
    pro.socialRefreshTokens.twitter = 'synthetic-replacement-refresh';
    return { status: 401, data: { error: 'Unauthorized' } };
  });
  app.setTokenExchange(async () => { refreshes++; throw Error('No refresh may be requested by this Job'); });
  const refused = await jobs.publishJobTarget(pro, 'twitter', { content: 'Complete hiring post.', mediaUrl: null, settings: {}, crossPostId: 'bp_synthetic_x_job', authorizationIdentity: snapshotJobAuthorization(pro, ['twitter']).twitter });
  assert.equal(refused.status, 'failed'); assert.equal(refused.reconnectRequired, true);
  assert.equal(legacySends, 1); assert.equal(refreshes, 0);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});
