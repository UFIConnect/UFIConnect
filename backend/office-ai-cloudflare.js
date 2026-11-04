'use strict';

const { readBounded } = require('./office-ai-terminal');
const ACCOUNT = 'edc675f01dd686d29d7a2e447bc04a8b';
const REPO = 'UFIConnect/UFIConnect';
const TARGETS = Object.freeze({
  'uficonnect-office-ai': { directory: 'infra/office-ai-worker', ai: true, url: 'https://uficonnect-office-ai.yosufkaka99.workers.dev' },
  'uficonnect-office-ai-site': { directory: 'infra/office-ai-site', ai: false, url: 'https://uficonnect.ai' },
});
const SHA = /^[a-f0-9]{40}$/;
const fail = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });

function createOfficeCloudflareDeploy({ env = process.env, fetcher = fetch } = {}) {
  const credential = () => env.CLOUDFLARE_DEPLOY_API_TOKEN || '';
  const githubToken = () => env.OFFICE_GITHUB_TOKEN || env.AUTOFIX_GITHUB_TOKEN || '';
  function capabilities() {
    const configured = Boolean(credential()) && env.CLOUDFLARE_ACCOUNT_ID === ACCOUNT;
    return { configured, available: configured, workers: Object.keys(TARGETS), accountId: ACCOUNT,
      missing: configured ? [] : ['Cloudflare deployment token scoped to Workers Scripts Write for the connected account'],
      note: 'Deploys only these two existing Workers from an exact current main commit with successful Verify checks. Keeps existing secret bindings and domain settings. The AI inference relay does not grant deployment access.' };
  }
  async function request(url, { token, method = 'GET', body, signal, cloudflare = false } = {}) {
    let response;
    try {
      response = await fetcher(url, { method, body, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: 'application/json', 'User-Agent': 'UFIConnect-Office/1.0', ...(!cloudflare ? { 'X-GitHub-Api-Version': '2026-03-10' } : {}) } });
    } catch {
      const error = fail(503, method === 'PUT' ? 'Cloudflare deployment outcome is unknown. Inspect the Worker before trying another deployment.' : 'Provider connection is unavailable.');
      if (method === 'PUT') error.outcomeUnknown = true;
      throw error;
    }
    if (!response.ok) {
      await response.body?.cancel?.().catch(() => {});
      const error = fail(response.status === 401 || response.status === 403 ? 403 : 502,
        response.status === 401 || response.status === 403 ? 'Provider denied access. Check the scoped Cloudflare deployment token and GitHub read permissions.' : 'Provider could not complete this Worker operation.');
      if (method === 'PUT' && response.status >= 500) error.outcomeUnknown = true;
      throw error;
    }
    let data;
    try { data = JSON.parse((await readBounded(response, 1048576)).text); }
    catch {
      const error = fail(502, method === 'PUT' ? 'Cloudflare upload receipt could not be read. Inspect the Worker before retrying.' : 'Provider returned an unreadable response.');
      if (method === 'PUT') error.outcomeUnknown = true;
      throw error;
    }
    if (cloudflare && data.success !== true) throw fail(502, 'Cloudflare did not confirm this Worker operation.');
    return cloudflare ? data.result : data;
  }
  const gh = (path, signal) => request(`https://api.github.com/repos/${REPO}${path}`, { token: githubToken(), signal });
  const cf = (worker, suffix = '', options = {}) => request(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${worker}${suffix}`,
    { ...options, token: credential(), cloudflare: true });
  function target(worker) {
    if (!Object.hasOwn(TARGETS, worker)) throw fail(400, 'Choose one of the two supported Office Workers.');
    if (!capabilities().configured) throw fail(503, 'Cloudflare deployment is unavailable. Add a separate scoped Workers Scripts Write token in Connections.');
    return TARGETS[worker];
  }
  async function status({ worker }, { signal } = {}) {
    target(worker); const data = await cf(worker, '/deployments', { signal });
    const deployments = Array.isArray(data) ? data : data?.deployments || [];
    return { service: worker, deployments: deployments.slice(0, 5).map(item => ({ id: item.id, createdAt: item.created_on,
      versions: (item.versions || []).map(version => ({ id: version.version_id, percentage: version.percentage })) })), url: TARGETS[worker].url };
  }
  async function deploy(args, { signal } = {}) {
    if (!args || typeof args !== 'object' || Object.keys(args).some(key => !['worker', 'sha'].includes(key)) || typeof args.sha !== 'string' || !SHA.test(args.sha)) throw fail(400, 'Provide a supported Worker and exact commit SHA.');
    const destination = target(args.worker), sha = args.sha;
    const head = await gh('/git/ref/heads/main', signal);
    if (head.object?.sha !== sha) throw fail(409, 'Worker deployment must use the current main commit.');
    const checks = await gh(`/actions/workflows/verify.yml/runs?head_sha=${sha}&status=completed&per_page=20`, signal);
    if (!(checks.workflow_runs || []).some(run => run.head_sha === sha && run.conclusion === 'success' && ['push', 'workflow_dispatch'].includes(run.event))) throw fail(409, 'Successful Verify checks for this exact commit are required before a Worker deployment.');
    async function source(name) {
      const file = await gh(`/contents/${destination.directory}/${name}?ref=${sha}`, signal);
      if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string' || file.size > 262144) throw fail(502, 'The fixed Worker source is unavailable or too large.');
      const content = Buffer.from(file.content.replace(/\s/g, ''), 'base64');
      if (content.length !== file.size || content.length > 262144) throw fail(502, 'The Worker source size did not match its receipt.');
      return content.toString('utf8');
    }
    const code = await source('index.mjs'), config = JSON.parse(await source('wrangler.jsonc'));
    if (config.name !== args.worker || config.account_id !== ACCOUNT || config.main !== 'index.mjs' || !/^\d{4}-\d{2}-\d{2}$/.test(config.compatibility_date || '')
      || config.compatibility_flags && (!Array.isArray(config.compatibility_flags) || config.compatibility_flags.some(flag => flag !== 'nodejs_compat')))
      throw fail(409, 'Worker configuration changed beyond this deployment adapter. Review its deployment setup.');
    const settings = await cf(args.worker, '/settings', { signal });
    const bindings = settings.bindings || [];
    if (!Array.isArray(bindings) || bindings.some(binding => typeof binding.type !== 'string' || typeof binding.name !== 'string')) throw fail(502, 'Existing Worker bindings could not be verified.');
    if (destination.ai && (!bindings.some(binding => binding.type === 'secret_text' && binding.name === 'OFFICE_AI_RELAY_SECRET')
      || bindings.some(binding => binding.type === 'ai' && binding.name !== 'AI'))) throw fail(409, 'Existing AI relay bindings need review before deployment.');
    // keep_bindings preserves secret values inside Cloudflare. They are never
    // read, downloaded, copied from local OAuth, or included in this upload.
    // https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/
    const metadata = { main_module: 'index.mjs', compatibility_date: config.compatibility_date,
      compatibility_flags: config.compatibility_flags || [], keep_bindings: [...new Set(bindings.map(binding => binding.type))].filter(type => !destination.ai || type !== 'ai'),
      bindings: destination.ai ? [{ type: 'ai', name: 'AI' }] : [], observability: { enabled: false },
      annotations: { 'workers/message': `Office deployment ${sha}`, 'workers/tag': sha.slice(0, 32) } };
    const latest = await gh('/git/ref/heads/main', signal);
    if (latest.object?.sha !== sha) throw fail(409, 'Main changed during deployment preparation. Start again with its current commit.');
    const form = new FormData();
    form.set('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.set('index.mjs', new Blob([code], { type: 'application/javascript+module' }), 'index.mjs');
    const result = await cf(args.worker, '', { method: 'PUT', body: form, signal });
    if (!result?.id) { const error = fail(502, 'Cloudflare accepted the upload without a usable receipt. Inspect the Worker before retrying.'); error.outcomeUnknown = true; throw error; }
    return { service: args.worker, status: 'deployed', id: String(result.id), url: destination.url, sha, receiptType: 'cloudflare-script-upload',
      note: 'Cloudflare confirmed the script upload. Domain settings and existing secrets were retained; application behavior still requires verification.' };
  }
  const tools = {
    cloudflare_deploy: { description: 'Deploy an existing Office Worker from the verified current main SHA, preserving secrets and domain settings. Requires a separately scoped Cloudflare deployment connection.', permission: 'deploy', parameters: { type: 'object', properties: { worker: { type: 'string', enum: Object.keys(TARGETS) }, sha: { type: 'string', pattern: '^[a-f0-9]{40}$' } }, required: ['worker', 'sha'], additionalProperties: false }, execute: deploy },
    cloudflare_status: { description: 'Read recent deployment receipts for one existing Office Worker.', permission: 'read', parameters: { type: 'object', properties: { worker: { type: 'string', enum: Object.keys(TARGETS) } }, required: ['worker'], additionalProperties: false }, execute: status },
  };
  return { capabilities, deploy, status, tools };
}

module.exports = { createOfficeCloudflareDeploy, OFFICE_CLOUDFLARE_TARGETS: TARGETS };
