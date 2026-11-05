'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOfficeCloudflareDeploy } = require('./office-ai-cloudflare');
const SHA = 'a'.repeat(40), ACCOUNT = 'edc675f01dd686d29d7a2e447bc04a8b', WORKER = 'uficonnect-office-ai';
const json = value => new Response(JSON.stringify(value));
function fixture() {
  const state = { calls: [], head: SHA, checks: true, secret: true, failUpload: false, metadata: null, loader: false };
  const env = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_DEPLOY_API_TOKEN: 'scoped-deployment-token', OFFICE_GITHUB_TOKEN: 'github-read-token' };
  const app = createOfficeCloudflareDeploy({ env, fetcher: async (url, options) => {
    state.calls.push({ url, method: options.method, authorization: options.headers.Authorization });
    const path = new URL(url).pathname;
    if (path.endsWith('/git/ref/heads/main')) return json({ object: { sha: state.head } });
    if (path.endsWith('/verify.yml/runs')) return json({ workflow_runs: state.checks ? [{ head_sha: SHA, conclusion: 'success', event: 'push' }] : [] });
    if (path.includes('/contents/')) {
      const content = path.endsWith('index.mjs') ? 'export default { fetch(){return new Response("okay")} };' : JSON.stringify({ name: WORKER, account_id: ACCOUNT, main: 'index.mjs', compatibility_date: '2026-11-03', compatibility_flags: ['nodejs_compat'], ...(state.loader?{worker_loaders:[{binding:'LOADER'}]}:{}) });
      return json({ type: 'file', encoding: 'base64', size: Buffer.byteLength(content), content: Buffer.from(content).toString('base64') });
    }
    if (path.endsWith('/settings')) return json({ success: true, result: { bindings: [{ name: 'AI', type: 'ai' }, ...(state.secret ? [{ name: 'OFFICE_AI_RELAY_SECRET', type: 'secret_text' }] : [])] } });
    if (options.method === 'PUT') {
      state.metadata = JSON.parse(await options.body.get('metadata').text());
      if (state.failUpload) throw Error('network disconnected');
      return json({ success: true, result: { id: 'worker-upload-receipt' } });
    }
    throw Error('Unexpected route ' + path);
  } });
  return { app, state, env };
}
test('Cloudflare adapter uses verified main source and preserves secrets without reading their values', async () => {
  const f = fixture(), result = await f.app.deploy({ worker: WORKER, sha: SHA });
  assert.equal(result.status, 'deployed'); assert.equal(result.sha, SHA); assert.equal(result.id, 'worker-upload-receipt');
  assert.deepEqual(f.state.metadata.keep_bindings, ['secret_text']); assert.deepEqual(f.state.metadata.bindings, [{ type: 'ai', name: 'AI' }]);
  assert.ok(!JSON.stringify(f.state.metadata).includes('scoped-deployment-token'));
  assert.ok(!f.state.calls.some(call => /\/secrets|\/domains|\/subdomain/.test(call.url)));
  assert.ok(f.state.calls.filter(call => call.url.includes('api.cloudflare.com')).every(call => call.authorization === 'Bearer scoped-deployment-token'));
  assert.ok(f.state.calls.filter(call => call.url.includes('api.github.com')).every(call => call.authorization === 'Bearer github-read-token'));
});
test('Cloudflare deployment remains unavailable with only the inference relay connection', async () => {
  const f = fixture(); delete f.env.CLOUDFLARE_DEPLOY_API_TOKEN; f.env.OFFICE_AI_RELAY_SECRET = 'existing-ai-only-secret';
  assert.equal(f.app.capabilities().available, false); await assert.rejects(f.app.deploy({ worker: WORKER, sha: SHA }), { status: 503 }); assert.equal(f.state.calls.length, 0);
});

test('Cloudflare deployments retain the code runtime loader from verified configuration',async()=>{
  const f=fixture();f.state.loader=true;await f.app.deploy({worker:WORKER,sha:SHA});assert.deepEqual(f.state.metadata.bindings,[{type:'ai',name:'AI'},{type:'worker_loader',name:'LOADER'}]);assert.deepEqual(f.state.metadata.keep_bindings,['secret_text']);
});
test('Cloudflare rejects arbitrary targets, stale commits, failed checks and missing relay auth bindings before writes', async () => {
  for (const scenario of ['target', 'stale', 'checks', 'secret']) {
    const f = fixture(); if (scenario === 'stale') f.state.head = 'b'.repeat(40); if (scenario === 'checks') f.state.checks = false; if (scenario === 'secret') f.state.secret = false;
    await assert.rejects(f.app.deploy({ worker: scenario === 'target' ? '../other-worker' : WORKER, sha: SHA }));
    assert.ok(!f.state.calls.some(call => call.method === 'PUT'));
  }
});
test('unknown Cloudflare upload outcome is marked uncertain and never retried by the adapter', async () => {
  const f = fixture(); f.state.failUpload = true;
  await assert.rejects(f.app.deploy({ worker: WORKER, sha: SHA }), error => error.outcomeUnknown === true);
  assert.equal(f.state.calls.filter(call => call.method === 'PUT').length, 1);
});
