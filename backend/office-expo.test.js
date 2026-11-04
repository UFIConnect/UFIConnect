'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOfficeExpo, EXPO_PROJECT_ID, EXPO_PROJECT_URL } = require('./office-expo');
const TOKEN = 'private-expo-token-test-1234567890';
const SHA = 'a'.repeat(40), RUN = '10000000-0000-4000-8000-000000000001';
const project = () => ({ data: { app: { byId: { id: EXPO_PROJECT_ID, fullName: '@uficonnect/ufic',
  githubRepository: { githubRepositoryIdentifier: 1249535414 }, githubRepositorySettings: { baseDirectory: '/mobile' } } } } });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

test('Expo verifies the fixed project and pins builds to the checked immutable commit', async () => {
  const calls = [];
  const service = createOfficeExpo({ env: { EXPO_TOKEN: TOKEN }, fetcher: async (url, options) => {
    calls.push({ url, options });
    return json(url.endsWith('/graphql') ? project() : { data: { id: RUN, url: `${EXPO_PROJECT_URL}/workflows/${RUN}` } });
  } });
  assert.equal((await service.verify()).buildConfigured, true);
  const result = await service.build(SHA);
  assert.equal(result.status, 'queued'); assert.equal(result.sha, SHA);
  assert.equal(result.runId, RUN); assert.equal(result.provider, 'expo');
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { appId: EXPO_PROJECT_ID, gitRef: SHA, fileName: 'office-build.yml' });
  assert.ok(!JSON.stringify(result).includes(TOKEN));
  assert.ok(calls.every(({url, options}) => url.startsWith('https://api.expo.dev/') && options.redirect === 'error' && options.headers.Authorization === `Bearer ${TOKEN}`));
});

test('absent credentials, wrong projects, GraphQL errors, and mismatched repositories cannot queue builds', async () => {
  await assert.rejects(createOfficeExpo({ env: {} }).build(SHA), /Connect Expo/);
  for (const change of [app => { app.id = RUN; }, app => { app.fullName = '@other/app'; },
    app => { app.githubRepository.githubRepositoryIdentifier = 1; }, app => { app.githubRepositorySettings.baseDirectory = '/'; }]) {
    let calls = 0;
    const service = createOfficeExpo({ env: { EXPO_TOKEN: TOKEN }, fetcher: async () => { calls++; const data = project(); change(data.data.app.byId); return json(data); } });
    await assert.rejects(service.build(SHA)); assert.equal(calls, 1);
  }
  const service = createOfficeExpo({ env: { EXPO_TOKEN: TOKEN }, fetcher: async () => json({ ...project(), errors: [{ message: TOKEN }] }) });
  await assert.rejects(service.verify(), error => !error.message.includes(TOKEN));
});

test('dispatch failures expose no provider secrets and do not retry an uncertain write', async () => {
  let writes = 0;
  const service = createOfficeExpo({ env: { EXPO_TOKEN: TOKEN }, fetcher: async url => {
    if (url.endsWith('/graphql')) return json(project());
    writes++; throw Error(TOKEN);
  } });
  await assert.rejects(service.build(SHA), /unknown outcome/); assert.equal(writes, 1);
  await assert.rejects(service.build('main'), /exact app commit/); assert.equal(writes, 1);
});
