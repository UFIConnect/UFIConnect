'use strict';

const EXPO_PROJECT_ID = '230828f2-53a3-4f87-a262-f2946e821eeb';
const EXPO_PROJECT_URL = 'https://expo.dev/accounts/uficonnect/projects/ufic';
const EXPO_WORKFLOW = 'office-build.yml';
const problem = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });

function createOfficeExpo({ env = process.env, fetcher = fetch, now = Date.now } = {}) {
  async function request(path, body) {
    if (typeof env.EXPO_TOKEN !== 'string' || !/^[\x21-\x7e]{20,4096}$/.test(env.EXPO_TOKEN))
      throw problem(409, 'Connect Expo in Office Connections before building app updates.');
    const uncertain = message => Object.assign(problem(503, message), { outcomeUnknown: true });
    let response;
    try {
      response = await fetcher(`https://api.expo.dev${path}`, { method: 'POST',
        headers: { Authorization: `Bearer ${env.EXPO_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(20000) });
    } catch {
      throw path === '/graphql' ? problem(503, 'Expo could not be reached. Retry the connection check.')
        : uncertain('The Expo build request has an unknown outcome. Check Expo workflow history before retrying.');
    }
    if (!response.ok) {
      await response.body?.cancel?.().catch(() => {});
      if (path !== '/graphql' && response.status >= 500) throw uncertain('Expo returned an error with an unknown build outcome. Check workflow history before retrying.');
      throw problem(422, path === '/graphql' ? 'Expo could not verify access. Check the token and UFIConnect project permissions.'
        : 'Expo could not queue the app build. Check the connected repository, mobile directory, workflow, and token permissions.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw Object.assign(problem(502, 'Expo returned an unreadable response. Check workflow history before retrying a build.'), { outcomeUnknown: path !== '/graphql' });
    let content = '', bytes = 0;
    try {
      const decoder = new TextDecoder();
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 262144) throw Error('oversized');
        content += decoder.decode(part.value, { stream: true });
      }
      content += decoder.decode();
      return JSON.parse(content);
    } catch { throw Object.assign(problem(502, 'Expo returned an invalid response. Check workflow history before retrying a build.'), { outcomeUnknown: path !== '/graphql' }); }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async function verify() {
    const result = await request('/graphql', { query: 'query OfficeExpoProject($appId: String!) { app { byId(appId: $appId) { id fullName githubRepository { githubRepositoryIdentifier } githubRepositorySettings { baseDirectory } } } }',
      variables: { appId: EXPO_PROJECT_ID } });
    const app = result.data?.app?.byId;
    if (result.errors?.length || app?.id !== EXPO_PROJECT_ID || app.fullName !== '@uficonnect/ufic')
      throw problem(422, 'This Expo token cannot access the UFIConnect app project.');
    const buildConfigured = app.githubRepository?.githubRepositoryIdentifier === 1249535414
      && /^\/?mobile\/?$/.test(app.githubRepositorySettings?.baseDirectory || '');
    return { detail: `Expo access verified for @uficonnect/ufic. ${buildConfigured
      ? 'Office can queue iOS and Android app builds from verified code. App store submission is separate.'
      : 'In Expo, link UFIConnect/UFIConnect and set the app directory to mobile to enable builds.'}`,
      projectId: EXPO_PROJECT_ID, projectUrl: EXPO_PROJECT_URL, buildConfigured, checkedAt: new Date(now()).toISOString() };
  }
  async function build(sha) {
    if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha)) throw problem(400, 'Verify the exact app commit before building.');
    if (!(await verify()).buildConfigured) throw problem(409, 'Set the Expo repository to UFIConnect/UFIConnect and the app directory to mobile before building.');
    const response = await request('/v2/workflows/dispatch', { appId: EXPO_PROJECT_ID, gitRef: sha, fileName: EXPO_WORKFLOW });
    const run = response.data;
    if (!run || typeof run.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(run.id)
      || run.url !== `${EXPO_PROJECT_URL}/workflows/${run.id}`)
      throw Object.assign(problem(502, 'Expo did not return a valid build receipt. Check workflow history before retrying.'), { outcomeUnknown: true });
    return { workflow: EXPO_WORKFLOW, provider: 'expo', ref: sha, sha, status: 'queued', platform: 'all', profile: 'production', runId: run.id, url: run.url };
  }
  return { verify, build };
}
module.exports = { createOfficeExpo, EXPO_PROJECT_ID, EXPO_PROJECT_URL };
