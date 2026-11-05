'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeploymentObserver } = require('./office-ai-deployments');
const sha = 'a'.repeat(40);
const env = { RENDER_API_KEY: 'test-key', ...Object.fromEntries(['API','PIPELINE','WEB','OFFICE'].map(name => [`RENDER_SERVICE_${name}_ID`, `srv-${name.toLowerCase()}`])) };
test('only live deployments for the requested commit count as complete', async () => {
  let status = 'build_in_progress'; const methods = [];
  const observe = createDeploymentObserver({ env, fetcher: async (_url, options) => { methods.push(options.method); return Response.json([{ deploy: { id: 'newer', status: 'live', commit: { id: 'b'.repeat(40) } } }, { deploy: { id: 'exact', status, commit: { id: sha } } }]); }, github: async () => ({ check_runs: [] }) });
  assert.equal((await observe({ sha }, [])).ready, false);
  status = 'live'; const result = await observe({ sha }, []);
  assert.equal(result.ready, true); assert.ok(result.deployments.every(item => item.id === 'exact' && item.sha === sha)); assert.ok(methods.every(method => method === 'GET'));
  status = 'build_failed'; assert.equal((await observe({ sha }, [])).failed, true);
});
test('Office changes also wait for the exact Cloudflare site receipt', async () => {
  let checks = [];
  const observe = createDeploymentObserver({ env, fetcher: async () => Response.json([{ deploy: { status: 'live', commit: { id: sha } } }]), github: async () => ({ check_runs: checks }) });
  assert.equal((await observe({ sha }, [{ path: 'office/src/App.jsx' }])).ready, false);
  checks = [{ id: 1, head_sha: sha, status: 'completed', conclusion: 'success', details_url: 'https://dash.cloudflare.com/account/build', output: { summary: 'uficonnect-office-ai-site version receipt' } }];
  assert.equal((await observe({ sha }, [{ path: 'office/src/App.jsx' }])).ready, true);
});
test('missing provider access cannot count as a successful deployment', async () => {
  const observe = createDeploymentObserver({ env: {}, fetcher: () => { throw Error('must not fetch'); } });
  const result = await observe({ sha }, []); assert.equal(result.ready, false); assert.equal(result.unavailable, true);
});
