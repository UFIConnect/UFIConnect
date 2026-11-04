'use strict';

const { createTokenVault } = require('./token-vault');
const { createOfficeAISources, SOURCE_DEFINITIONS, SOURCE_IDS } = require('./office-ai-sources');
const { createOfficeExpo, EXPO_PROJECT_ID, EXPO_PROJECT_URL } = require('./office-expo');
const PROVIDERS = ['github', 'render', 'cloudflare', 'expo', ...SOURCE_IDS];
const KEYS = {
  expo: ['EXPO_TOKEN'],
  github: ['OFFICE_GITHUB_TOKEN', 'AUTOFIX_GITHUB_TOKEN'],
  render: ['RENDER_API_KEY', 'RENDER_HOOK_API', 'RENDER_HOOK_WEB', 'RENDER_HOOK_OFFICE', 'RENDER_HOOK_PIPELINE',
    'RENDER_SERVICE_API_ID', 'RENDER_SERVICE_WEB_ID', 'RENDER_SERVICE_OFFICE_ID', 'RENDER_SERVICE_PIPELINE_ID'],
  cloudflare: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_DEPLOY_API_TOKEN', 'OFFICE_AI_MODEL', 'OFFICE_AI_GATEWAY', 'OFFICE_AI_RELAY_URL', 'OFFICE_AI_RELAY_SECRET'],
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
    records = new Map(rows.map(row => [row.provider, { enabled: row.enabled, verifiedAt: row.verified_at, updatedAt: row.updated_at }]));
    savedConfigs = configurations;
  }
  async function refresh(force = false) {
    if (!force && now() - loadedAt < 15000) return;
    if (loading) { await loading; if (!force) return; }
    loading = (async () => {
      await storage();
      const { rows } = await db.query('SELECT provider,enabled,encrypted_config,verified_at,updated_at FROM office_provider_connections');
      apply(rows); loadedAt = now();
    })();
    try { await loading; } finally { loading = null; }
  }
  function configuration(provider) {
    if (provider === 'expo') return { token: officeEnv.EXPO_TOKEN };
    if (SOURCE_DEFINITIONS[provider]) return { token: officeEnv[SOURCE_DEFINITIONS[provider].key] };
    if (provider === 'github') return { token: officeEnv.OFFICE_GITHUB_TOKEN || officeEnv.AUTOFIX_GITHUB_TOKEN };
    if (provider === 'render') return { token: officeEnv.RENDER_API_KEY };
    return { token: officeEnv.CLOUDFLARE_API_TOKEN, accountId: officeEnv.CLOUDFLARE_ACCOUNT_ID,
      relayUrl: officeEnv.OFFICE_AI_RELAY_URL, relaySecret: officeEnv.OFFICE_AI_RELAY_SECRET, deploymentToken: officeEnv.CLOUDFLARE_DEPLOY_API_TOKEN };
  }
  function inventory() {
    return PROVIDERS.map(provider => {
      const record = records.get(provider), config = configuration(provider);
      const configured = provider === 'cloudflare' ? Boolean(config.token && config.accountId || config.relayUrl && config.relaySecret) : Boolean(config.token);
      return { id: provider, configured, source: record ? (record.enabled ? 'saved' : 'disconnected') : 'server',
        chatSource: SOURCE_IDS.includes(provider), sourceDescription: SOURCE_DEFINITIONS[provider]?.description,
        verifiedAt: record?.verifiedAt || null, repository: provider === 'github' ? repository : undefined,
        projectId: provider === 'expo' ? EXPO_PROJECT_ID : undefined,
        projectUrl: provider === 'expo' ? EXPO_PROJECT_URL : undefined,
        accountId: provider === 'cloudflare' ? config.accountId || '' : undefined,
        mode: provider === 'cloudflare' ? config.token && config.accountId ? 'api-token' : config.relayUrl && config.relaySecret ? 'worker-binding' : null : undefined,
        deploymentConfigured: provider === 'cloudflare' ? Boolean(config.deploymentToken && config.accountId === 'edc675f01dd686d29d7a2e447bc04a8b') : undefined,
        model: provider === 'cloudflare' ? officeEnv.OFFICE_AI_MODEL || '@cf/google/gemma-4-26b-a4b-it' : undefined,
        gateway: provider === 'cloudflare' ? officeEnv.OFFICE_AI_GATEWAY || 'default' : undefined,
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
  async function checkProvider(provider, config) {
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
    let aiDetail;
    if (config.token) {
      if (!tokenValid(config.token) || typeof config.accountId !== 'string' || !/^[a-f0-9]{32}$/i.test(config.accountId)) throw problem(400, 'Enter a valid Cloudflare account ID and API token.');
      const models = await json(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/models/search?per_page=1`, config.token);
      if (models.success === false || !Array.isArray(models.result)) throw problem(422, 'Cloudflare Workers AI access could not be verified.');
      aiDetail = 'Cloudflare model access verified. Research additionally requires AI Gateway access and search credits.';
    } else {
      const relay = new URL(config.relayUrl || 'https://invalid.local');
      if (relay.protocol !== 'https:' || !relay.hostname.endsWith('.workers.dev') || relay.username || relay.password || relay.port || relay.search || relay.hash
        || relay.pathname !== '/' || !tokenValid(config.relaySecret) || config.relaySecret.length < 32) throw problem(422, 'Cloudflare AI is not connected.');
      const status = await json(new URL('/health', relay), config.relaySecret);
      if (status.configured !== true && status.ai !== true) throw problem(422, 'The Cloudflare AI binding is unavailable.');
      aiDetail = 'Cloudflare Worker AI binding verified. Model and research availability are checked when used.';
    }
    if (config.deploymentToken) {
      if (!tokenValid(config.deploymentToken) || config.accountId !== 'edc675f01dd686d29d7a2e447bc04a8b') throw problem(400, 'Use a Workers deployment token scoped to the connected UFIConnect Cloudflare account.');
      for (const worker of ['uficonnect-office-ai', 'uficonnect-office-ai-site']) {
        const settings = await json(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/workers/scripts/${worker}/settings`, config.deploymentToken);
        if (settings.success !== true || !settings.result || !Array.isArray(settings.result.bindings)) throw problem(422, 'The Cloudflare deployment token could not read the existing Office Workers.');
      }
    }
    return { detail: aiDetail + (config.deploymentToken ? ' Existing Worker access verified. Workers Scripts Write permission is checked when deploying.' : ''),
      aiVerified: true, deploymentVerified: Boolean(config.deploymentToken), checkedAt: new Date(now()).toISOString() };
  }
  async function check(provider, config) {
    let budget = verificationBudgets.get(provider);
    if (!budget || now() - budget.started >= 60000) {
      budget = { started: now(), requests: 0, active: 0 };
      verificationBudgets.set(provider, budget);
    }
    if (budget.active || budget.requests >= 6) throw problem(429, 'Connection checks are busy. Wait a minute before checking this provider again.');
    budget.requests++; budget.active++;
    try { return await checkProvider(provider, config); }
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
    const allowed = provider === 'github' || provider === 'expo' || SOURCE_IDS.includes(provider) ? ['token'] : provider === 'render' ? ['token', 'serviceIds'] : ['token', 'deploymentToken', 'accountId', 'model', 'gateway'];
    if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > 8192 ||
        Object.keys(body).some(key => !allowed.includes(key)) || (provider === 'cloudflare'
          ? (body.token !== undefined && !tokenValid(body.token) || body.deploymentToken !== undefined && !tokenValid(body.deploymentToken) || !body.token && !body.deploymentToken)
          : !tokenValid(body.token))) throw problem(400, 'Enter a valid provider credential.');
    const config = provider === 'cloudflare' ? { ...(savedConfigs.get(provider) || {}) } : {};
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
      if (typeof body.accountId !== 'string' || !/^[a-f0-9]{32}$/i.test(body.accountId)
        || body.model !== undefined && (typeof body.model !== 'string' || !/^(?:@cf\/)?[a-z0-9_.-]+\/[a-zA-Z0-9_.:-]{1,120}$/.test(body.model))
        || body.gateway !== undefined && (typeof body.gateway !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(body.gateway))) throw problem(400, 'Check the Cloudflare account, model, and gateway values.');
      const current = configuration(provider);
      if (body.deploymentToken && (body.accountId !== 'edc675f01dd686d29d7a2e447bc04a8b' || current.accountId && current.accountId !== body.accountId)) throw problem(400, 'The deployment token must use the existing connected Cloudflare account.');
      if (!body.token && !(current.token && current.accountId || current.relayUrl && current.relaySecret)) throw problem(400, 'Reconnect Cloudflare AI before adding a deployment-only token.');
      if (current.deploymentToken && current.accountId !== body.accountId) throw problem(400, 'Disconnect the existing Cloudflare connection before switching deployment accounts.');
      Object.assign(config, { CLOUDFLARE_ACCOUNT_ID: body.accountId,
        OFFICE_AI_MODEL: body.model || officeEnv.OFFICE_AI_MODEL || '@cf/google/gemma-4-26b-a4b-it', OFFICE_AI_GATEWAY: body.gateway || officeEnv.OFFICE_AI_GATEWAY || 'default',
        ...(body.token ? { CLOUDFLARE_API_TOKEN: body.token } : {}), ...(body.deploymentToken ? { CLOUDFLARE_DEPLOY_API_TOKEN: body.deploymentToken } : {}) });
      verification = { ...current, accountId: body.accountId, ...(body.token ? { token: body.token } : {}), ...(body.deploymentToken ? { deploymentToken: body.deploymentToken } : {}) };
    }
    const encrypted = createTokenVault(baseline).seal(JSON.stringify(config), `office:provider:${provider}`);
    const result = await check(provider, verification);
    await db.query(`INSERT INTO office_provider_connections(provider,enabled,encrypted_config,verified_at) VALUES($1,true,$2,NOW())
      ON CONFLICT(provider) DO UPDATE SET enabled=true,encrypted_config=EXCLUDED.encrypted_config,verified_at=NOW(),updated_at=NOW()`, [provider, encrypted]);
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
