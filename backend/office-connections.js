'use strict';

const { createTokenVault } = require('./token-vault');
const { createOfficeAISources, SOURCE_DEFINITIONS, SOURCE_IDS } = require('./office-ai-sources');
const { createOfficeExpo, EXPO_PROJECT_ID, EXPO_PROJECT_URL } = require('./office-expo');
const { cloudflareConfiguration, CLOUDFLARE_SEARCH_PROVIDERS, requestCloudflareSearch, cloudflareSearchIssue,
  verifyCloudflareInference } = require('./office-ai');
const PROVIDERS = ['github', 'render', 'cloudflare', 'expo', ...SOURCE_IDS];
const OFFICE_CLOUDFLARE_ACCOUNT = 'edc675f01dd686d29d7a2e447bc04a8b';
const KEYS = {
  expo: ['EXPO_TOKEN'],
  github: ['OFFICE_GITHUB_TOKEN', 'AUTOFIX_GITHUB_TOKEN'],
  render: ['RENDER_API_KEY', 'RENDER_HOOK_API', 'RENDER_HOOK_WEB', 'RENDER_HOOK_OFFICE', 'RENDER_HOOK_PIPELINE',
    'RENDER_SERVICE_API_ID', 'RENDER_SERVICE_WEB_ID', 'RENDER_SERVICE_OFFICE_ID', 'RENDER_SERVICE_PIPELINE_ID'],
  cloudflare: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_DEPLOY_API_TOKEN', 'OFFICE_AI_MODEL', 'OFFICE_AI_GATEWAY',
    'OFFICE_AI_SEARCH_PROVIDER', 'OFFICE_AI_RELAY_URL', 'OFFICE_AI_RELAY_SECRET'],
  ...Object.fromEntries(SOURCE_IDS.map(id => [id, [SOURCE_DEFINITIONS[id].key]])),
};
const OFFICE_CONNECTION_SCHEMA = `CREATE TABLE IF NOT EXISTS office_provider_connections (
  provider TEXT PRIMARY KEY CHECK (provider IN ('github','render','cloudflare','expo','notion','slack','linear')),
  enabled BOOLEAN NOT NULL, encrypted_config TEXT, verified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;
// Existing installations have a three-provider CHECK. Replace it atomically so
// an Office update can add sources without deleting existing encrypted records.
const OFFICE_CONNECTION_MIGRATION = `ALTER TABLE office_provider_connections
  DROP CONSTRAINT IF EXISTS office_provider_connections_provider_check,
  ADD CONSTRAINT office_provider_connections_provider_check CHECK (provider IN ('github','render','cloudflare','expo','notion','slack','linear'))`;
const problem = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });
const tokenValid = value => typeof value === 'string' && /^[\x21-\x7e]{20,4096}$/.test(value);

// A separate environment view limits saved credentials to Office requests.
// It never changes process.env or the credentials used by background agents.
function createOfficeConnections({ db, env = process.env, fetcher = fetch, now = Date.now } = {}) {
  const baseline = { ...env }, officeEnv = { ...env };
  const sources = createOfficeAISources({ env: officeEnv, fetcher, now });
  const repository = `${env.AUTOFIX_GITHUB_OWNER || 'UFIConnect'}/${(env.AUTOFIX_GITHUB_REPO || 'UFIConnect').replace(/^ufconnect$/i, 'UFIConnect')}`;
  let ready, loading, loadedAt = -Infinity, records = new Map(), savedConfigs = new Map();
  const verificationBudgets = new Map();
  async function storage() {
    if (!db?.isConnected?.()) throw problem(503, 'Office connection storage is unavailable.');
    if (!ready) ready = (async () => { await db.query(OFFICE_CONNECTION_SCHEMA); await db.query(OFFICE_CONNECTION_MIGRATION); })().catch(error => { ready = null; throw error; });
    await ready;
  }
  function apply(rows) {
    const next = { ...baseline };
    const configurations = new Map();
    const vault = createTokenVault(baseline);
    for (const row of rows) {
      if (!PROVIDERS.includes(row.provider)) continue;
      if (!row.enabled) { for (const key of KEYS[row.provider]) next[key] = ''; continue; }
      // Reject noncanonical envelopes before decryption; Node's base64 decoder
      // otherwise ignores trailing data after padding.
      if (typeof row.encrypted_config !== 'string' || !row.encrypted_config.startsWith('enc:v1:') || row.encrypted_config.length > 20000
        || Buffer.from(row.encrypted_config.slice(7), 'base64').toString('base64') !== row.encrypted_config.slice(7)) throw new Error('Invalid stored connection.');
      const config = JSON.parse(vault.open(row.encrypted_config, `office:provider:${row.provider}`));
      for (const [key, value] of Object.entries(config)) {
        if (!KEYS[row.provider].includes(key) || typeof value !== 'string') throw new Error('Invalid stored connection.');
        next[key] = value;
      }
      configurations.set(row.provider, config);
    }
    Object.assign(officeEnv, next);
    records = new Map(rows.map(row => [row.provider, { enabled: row.enabled, verifiedAt: row.verified_at, revision: row.revision }]));
    savedConfigs = configurations;
  }
  async function refresh(force = false) {
    if (!force && now() - loadedAt < 15000) return;
    if (loading) { await loading; if (!force) return; }
    loading = (async () => {
      await storage();
      const { rows } = await db.query('SELECT provider,enabled,encrypted_config,verified_at,xmin::text AS revision FROM office_provider_connections');
      apply(rows); loadedAt = now();
    })();
    try { await loading; } finally { loading = null; }
  }
  function configuration(provider, configEnv = officeEnv) {
    if (provider === 'expo') return { token: officeEnv.EXPO_TOKEN };
    if (SOURCE_DEFINITIONS[provider]) return { token: officeEnv[SOURCE_DEFINITIONS[provider].key] };
    if (provider === 'github') return { token: officeEnv.OFFICE_GITHUB_TOKEN || officeEnv.AUTOFIX_GITHUB_TOKEN };
    if (provider === 'render') return { token: officeEnv.RENDER_API_KEY };
    return { ...cloudflareConfiguration(configEnv), deploymentToken: configEnv.CLOUDFLARE_DEPLOY_API_TOKEN };
  }
  function inventory() {
    return PROVIDERS.map(provider => {
      const record = records.get(provider), config = configuration(provider);
      const configured = provider === 'cloudflare' ? config.configured : Boolean(config.token);
      return { id: provider, configured, source: record ? (record.enabled ? 'saved' : 'disconnected') : 'server',
        chatSource: SOURCE_IDS.includes(provider), sourceDescription: SOURCE_DEFINITIONS[provider]?.description,
        verifiedAt: record?.verifiedAt || null, repository: provider === 'github' ? repository : undefined,
        projectId: provider === 'expo' ? EXPO_PROJECT_ID : undefined,
        projectUrl: provider === 'expo' ? EXPO_PROJECT_URL : undefined,
        accountId: provider === 'cloudflare' ? config.account : undefined,
        mode: provider === 'cloudflare' ? config.transport : undefined,
        deploymentConfigured: provider === 'cloudflare' ? Boolean(config.deploymentToken && config.account === OFFICE_CLOUDFLARE_ACCOUNT) : undefined,
        model: provider === 'cloudflare' ? config.model : undefined,
        gateway: provider === 'cloudflare' ? config.gateway : undefined,
        searchProvider: provider === 'cloudflare' ? config.searchProvider : undefined,
        serviceIds: provider === 'render' ? Object.fromEntries(['api','pipeline','web','office'].map(role => [role, officeEnv[`RENDER_SERVICE_${role.toUpperCase()}_ID`] || ''])) : undefined };
    });
  }
  async function json(url, token, headers = {}) {
    const response = await fetcher(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'UFIConnect-Office/1.0', ...headers },
      redirect: 'error', signal: AbortSignal.timeout(12000) });
    if (!response.ok) {
      await response.body?.cancel?.().catch(() => {});
      throw problem(422, 'The provider could not verify this connection. Check the credential, account, and permissions.');
    }
    const reader = response.body?.getReader();
    let text = '';
    if (reader) {
      const decoder = new TextDecoder(); let bytes = 0;
      try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
        if (bytes > 262144) throw problem(502, 'Provider verification response was too large.'); text += decoder.decode(part.value, { stream: true }); }
        text += decoder.decode();
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } else throw problem(502, 'Provider verification response was unreadable.');
    return JSON.parse(text);
  }
  async function checkCloudflareDeployment(config) {
    if (!tokenValid(config.deploymentToken) || config.account !== OFFICE_CLOUDFLARE_ACCOUNT) {
      throw problem(400, 'Use a Workers deployment token scoped to the connected UFIConnect Cloudflare account.');
    }
    const scripts = ['uficonnect-office-ai', 'uficonnect-office-ai-site'];
    const settings = await Promise.all(scripts.map(worker => json(
      `https://api.cloudflare.com/client/v4/accounts/${config.account}/workers/scripts/${worker}/settings`, config.deploymentToken)));
    if (settings.some(item => item.success !== true || !Array.isArray(item.result?.bindings))) {
      throw problem(422, 'The Cloudflare deployment token could not read the existing Office Workers.');
    }
  }
  async function checkCloudflareAI(config) {
    if (!config.configured) throw problem(422, 'Check the Cloudflare account ID, API token, AI model, and gateway in Connections.');
    if (config.relay) {
      const status = await json(new URL('/health', config.relayUrl), config.relaySecret);
      if (status.configured !== true && status.ai !== true) throw problem(422, 'The Cloudflare AI binding is unavailable.');
      return 'Cloudflare Worker AI binding verified.';
    }
    try {
      await verifyCloudflareInference(config, fetcher, AbortSignal.timeout(15000));
      return 'Pip received a test reply through the direct Cloudflare API.';
    } catch (error) {
      if ([401, 403].includes(error.upstreamStatus)) throw problem(422, 'Cloudflare denied Pip’s test reply. Check the account and grant the API token Workers AI Read.');
      if (error.upstreamStatus === 402) throw problem(422, 'Cloudflare needs available credits for the selected AI model.');
      if (error.upstreamStatus === 429) throw problem(429, 'Cloudflare reached an AI rate or usage limit. Check the gateway limits.');
      if (error.name === 'TimeoutError') throw problem(504, 'Cloudflare’s test reply timed out. Try verifying the connection again.');
      throw problem(422, 'Pip could not get a test reply. Check the AI model, gateway ID, and Cloudflare status.');
    }
  }
  async function checkProvider(provider, config, { requireDeployment = false } = {}) {
    if (provider === 'expo') return createOfficeExpo({ env: { EXPO_TOKEN: config.token }, fetcher, now }).verify();
    if (SOURCE_IDS.includes(provider)) return sources.verify(provider, config.token);
    if (provider === 'github') {
      if (!tokenValid(config.token)) throw problem(400, 'Enter a valid GitHub token.');
      const repo = await json(`https://api.github.com/repos/${repository.split('/').map(encodeURIComponent).join('/')}`, config.token,
        { 'X-GitHub-Api-Version': '2026-03-10' });
      if (repo.full_name?.toLowerCase() !== repository.toLowerCase()) throw problem(422, 'The configured repository could not be verified.');
      // Reading metadata does not establish Contents or Actions write scope.
      return { detail: `Repository access verified for ${repository}. Contents and Actions write permissions are checked when used.`, checkedAt: new Date(now()).toISOString() };
    }
    if (provider === 'render') {
      if (!tokenValid(config.token)) throw problem(400, 'Enter a valid Render API key.');
      const services = await json('https://api.render.com/v1/services?limit=1', config.token);
      if (!Array.isArray(services)) throw problem(422, 'Render service access could not be verified.');
      return { detail: 'Render API access verified. Deployments use the configured service IDs and existing Office controls.', checkedAt: new Date(now()).toISOString() };
    }
    if (!config.configured) return checkCloudflareAI(config);
    const search = config.relay ? Promise.resolve(null) : requestCloudflareSearch(config,
      'Cloudflare developer documentation', 1, fetcher, AbortSignal.timeout(12000)).then(() => ({ verified: true }),
      error => ({ verified: false, detail: cloudflareSearchIssue(error) }));
    const deployment = config.deploymentToken ? checkCloudflareDeployment(config).then(() => true, error => {
      if (requireDeployment) throw error;
      return false;
    }) : Promise.resolve(false);
    const [aiDetail, research, deploymentVerified] = await Promise.all([checkCloudflareAI(config), search, deployment]);
    const detail = [aiDetail,
      research?.verified ? 'AI Gateway web search succeeded.' : research?.detail,
      deploymentVerified ? 'Worker deployment credential can read the existing scripts. Write access is checked during approved deployments.'
        : config.deploymentToken ? 'The Worker deployment credential could not read the existing scripts.' : '',
    ].filter(Boolean).join(' ');
    return { detail, aiVerified: true, researchVerified: research?.verified ?? null,
      deploymentVerified, checkedAt: new Date(now()).toISOString() };
  }
  async function check(provider, config, options) {
    let budget = verificationBudgets.get(provider);
    if (!budget || now() - budget.started >= 60000) {
      budget = { started: now(), requests: 0, active: 0 };
      verificationBudgets.set(provider, budget);
    }
    if (budget.active || budget.requests >= 6) throw problem(429, 'Connection checks are busy. Wait a minute before checking this provider again.');
    budget.requests++; budget.active++;
    try { return await checkProvider(provider, config, options); }
    finally { budget.active--; }
  }
  const handle = handler => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await refresh(); return await handler(req, res); }
    catch (error) { return res.status(error.publicMessage ? error.status : 503).json({ error: error.publicMessage || 'Office connection operation failed. Retry after checking service availability.' }); }
  };
  const list = handle(async (_req, res) => res.json({ connections: inventory(), storage: 'encrypted-database' }));
  const verify = handle(async (req, res) => {
    if (!PROVIDERS.includes(req.params.provider)) throw problem(404, 'Unknown provider.');
    return res.json({ provider: req.params.provider, ...(await check(req.params.provider, configuration(req.params.provider))) });
  });
  const save = handle(async (req, res) => {
    const provider = req.params.provider, body = req.body;
    if (!PROVIDERS.includes(provider)) throw problem(404, 'Unknown provider.');
    const allowed = provider === 'github' || provider === 'expo' || SOURCE_IDS.includes(provider) ? ['token'] : provider === 'render' ? ['token', 'serviceIds'] : ['token', 'deploymentToken', 'accountId', 'model', 'gateway', 'searchProvider'];
    if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > 8192 ||
        Object.keys(body).some(key => !allowed.includes(key)) || (provider === 'cloudflare'
          ? (body.token !== undefined && !tokenValid(body.token) || body.deploymentToken !== undefined && !tokenValid(body.deploymentToken) || !Object.keys(body).length)
          : !tokenValid(body.token))) throw problem(400, 'Enter a valid provider credential.');
    const config = provider === 'cloudflare' ? { ...(savedConfigs.get(provider) || {}) } : {};
    const revision = records.get(provider)?.revision ?? null;
    let verification = body;
    if (SOURCE_DEFINITIONS[provider]) config[SOURCE_DEFINITIONS[provider].key] = body.token;
    else if (provider === 'expo') config.EXPO_TOKEN = body.token;
    else if (provider === 'github') config.OFFICE_GITHUB_TOKEN = body.token;
    else if (provider === 'render') {
      config.RENDER_API_KEY = body.token;
      // Saved API credentials and service selections must not silently fall
      // back to unrelated server deploy hooks. Background hooks are unchanged.
      for (const role of ['API', 'WEB', 'OFFICE', 'PIPELINE']) config[`RENDER_HOOK_${role}`] = '';
      if (body.serviceIds !== undefined) {
        if (!body.serviceIds || typeof body.serviceIds !== 'object' || Array.isArray(body.serviceIds) || Object.keys(body.serviceIds).some(role => !['api','web','office','pipeline'].includes(role))) throw problem(400, 'Use the four supported Render service IDs.');
        for (const [role, value] of Object.entries(body.serviceIds)) {
          if (typeof value !== 'string' || value && !/^srv-[a-z0-9]{10,40}$/.test(value)) throw problem(400, 'Use Render service IDs beginning with srv-.');
          config[`RENDER_SERVICE_${role.toUpperCase()}_ID`] = value;
        }
      }
    } else {
      const current = configuration(provider);
      const account = body.accountId === undefined ? current.account : body.accountId;
      if (typeof account !== 'string' || !/^[a-f0-9]{32}$/i.test(account)
        || body.model !== undefined && (typeof body.model !== 'string' || !/^(?:@cf\/)?[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:-]{1,120}$/.test(body.model))
        || body.gateway !== undefined && (typeof body.gateway !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(body.gateway))
        || body.searchProvider !== undefined && !CLOUDFLARE_SEARCH_PROVIDERS.includes(body.searchProvider)) {
        throw problem(400, 'Check the Cloudflare account, model, gateway, and search provider values.');
      }
      const accountId = account.toLowerCase();
      if (body.deploymentToken && (accountId !== OFFICE_CLOUDFLARE_ACCOUNT || current.account && current.account !== accountId)) throw problem(400, 'The deployment token must use the existing connected Cloudflare account.');
      if (!body.token && (!current.transport || current.account && current.account !== accountId)) throw problem(400, 'Provide an AI token to connect Cloudflare or change accounts.');
      if (current.deploymentToken && current.account !== accountId) throw problem(400, 'Disconnect the existing Cloudflare connection before switching deployment accounts.');
      Object.assign(config, { CLOUDFLARE_ACCOUNT_ID: accountId,
        OFFICE_AI_MODEL: body.model || current.model, OFFICE_AI_GATEWAY: body.gateway || current.gateway,
        ...(body.searchProvider ? { OFFICE_AI_SEARCH_PROVIDER: body.searchProvider } : {}),
        ...(body.token ? { CLOUDFLARE_API_TOKEN: body.token } : {}), ...(body.deploymentToken ? { CLOUDFLARE_DEPLOY_API_TOKEN: body.deploymentToken } : {}) });
      verification = configuration(provider, { ...baseline, ...config });
    }
    const encrypted = createTokenVault(baseline).seal(JSON.stringify(config), `office:provider:${provider}`);
    const result = await check(provider, verification, { requireDeployment: provider === 'cloudflare' && Boolean(body.deploymentToken) });
    if (provider === 'cloudflare') {
      const saved = await db.query(`INSERT INTO office_provider_connections(provider,enabled,encrypted_config,verified_at) VALUES($1,true,$2,NOW())
        ON CONFLICT(provider) DO UPDATE SET enabled=true,encrypted_config=EXCLUDED.encrypted_config,verified_at=NOW(),updated_at=NOW()
        WHERE office_provider_connections.xmin::text = $3 RETURNING provider`, [provider, encrypted, revision]);
      if (!saved.rows.length) throw problem(409, 'Cloudflare settings changed during verification. Refresh connections and try again.');
    } else {
      await db.query(`INSERT INTO office_provider_connections(provider,enabled,encrypted_config,verified_at) VALUES($1,true,$2,NOW())
        ON CONFLICT(provider) DO UPDATE SET enabled=true,encrypted_config=EXCLUDED.encrypted_config,verified_at=NOW(),updated_at=NOW()`, [provider, encrypted]);
    }
    await refresh(true);
    return res.json({ connection: inventory().find(item => item.id === provider), ...result });
  });
  const disconnect = handle(async (req, res) => {
    const provider = req.params.provider;
    if (!PROVIDERS.includes(provider)) throw problem(404, 'Unknown provider.');
    if (req.body?.confirmed !== true) throw problem(400, 'Confirm disconnecting this Office provider.');
    await db.query(`INSERT INTO office_provider_connections(provider,enabled,encrypted_config) VALUES($1,false,NULL)
      ON CONFLICT(provider) DO UPDATE SET enabled=false,encrypted_config=NULL,verified_at=NULL,updated_at=NOW()`, [provider]);
    await refresh(true);
    return res.json({ connection: inventory().find(item => item.id === provider), disconnected: true });
  });
  const middleware = async (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { await refresh(); next(); }
    catch { res.status(503).json({ error: 'Office connection storage is unavailable. Retry shortly.' }); }
  };
  return { env: officeEnv, refresh, list, save, verify, disconnect, middleware };
}
module.exports = { createOfficeConnections, OFFICE_CONNECTION_SCHEMA };
