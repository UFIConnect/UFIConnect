'use strict';

const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { createOfficeAIStudio, validateProject } = require('./office-ai-studio');
const { memoryRedactor } = require('./office-ai-memory');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SCOPES = Object.freeze(['photos:generate','videos:generate','content:generate']);
const TOKEN = /^pip_media_[A-Za-z0-9_-]{43}$/;
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS office_ai_studio_keys (id UUID PRIMARY KEY,name TEXT NOT NULL,prefix TEXT NOT NULL,key_hash TEXT NOT NULL UNIQUE,scopes JSONB NOT NULL,daily_generation_limit INTEGER NOT NULL,user_daily_generation_limit INTEGER NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_used_at TIMESTAMPTZ,revoked_at TIMESTAMPTZ,expires_at TIMESTAMPTZ)`,
  `CREATE TABLE IF NOT EXISTS office_ai_studio_key_usage (key_id UUID NOT NULL REFERENCES office_ai_studio_keys(id),subject_hash TEXT NOT NULL,usage_day DATE NOT NULL,operation TEXT NOT NULL,submissions INTEGER NOT NULL,PRIMARY KEY(key_id,subject_hash,usage_day,operation))`,
];
const fail = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const timestamp = value => value ? new Date(value).toISOString() : null;
const metadata = row => ({ id: row.id, name: row.name, prefix: row.prefix, scopes: row.scopes,
  dailyGenerationLimit: row.daily_generation_limit, userDailyGenerationLimit: row.user_daily_generation_limit,
  createdAt: timestamp(row.created_at), lastUsedAt: timestamp(row.last_used_at), revokedAt: timestamp(row.revoked_at), expiresAt: timestamp(row.expires_at) });

function createOfficeAIStudioKeys({ db, env = process.env, fetcher = globalThis.fetch, provider, now = Date.now,
  contentGenerator, screenPrompt } = {}) {
  let ready;
  const workspaces = new Map(), redact = memoryRedactor(env);
  const stamp = () => new Date(now()).toISOString();
  async function storage() {
    if (!db?.isConnected?.() || typeof db.query !== 'function') throw fail(503, 'Media API key storage is unavailable.');
    if (!ready) ready = (async () => { for (const sql of SCHEMA) await db.query(sql); })().catch(error => { ready = null; throw error; });
    await ready;
  }
  const handle = operation => async (req, res) => {
    res.set?.('Cache-Control', 'private, no-store');
    try { await storage(); return await operation(req, res); }
    catch (error) {
      if (res.headersSent && typeof res.destroy === 'function') return res.destroy();
      return res.status(error.publicMessage ? error.status : 503).json({ error: redact(error.publicMessage || 'The media API operation could not be completed. No Office capability was granted.') });
    }
  };
  const integration = () => ({ environmentVariable: 'PIP_STUDIO_API_KEY', apiBase: '/api/pip/studio', memberBase: '/pip/studio',
    authorization: 'Bearer', userHeader: 'x-pip-user-id', scopes: [...SCOPES], contentEndpoint: '/api/pip/studio/content-draft',
    note: 'Keep this key on the server. It permits only photos, videos and existing AI content generation. It never grants Office, code, deployment, memory, connection or agent tools. Supply the authenticated end-user identity from your server. Daily limits count submissions, including rejected or retried requests.' });
  const list = handle(async (_req, res) => {
    const { rows } = await db.query('SELECT * FROM office_ai_studio_keys ORDER BY created_at DESC LIMIT 100');
    return res.json({ keys: rows.map(metadata), integration: integration() });
  });
  const create = handle(async (req, res) => {
    const body = req.body;
    if (!object(body) || Object.keys(body).some(key => !['name','scopes','dailyGenerationLimit','userDailyGenerationLimit'].includes(key))
      || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100) throw fail(400, 'Give the media key a name and choose only supported generation scopes.');
    const scopes = body.scopes ?? [...SCOPES], daily = body.dailyGenerationLimit ?? 100, userDaily = body.userDailyGenerationLimit ?? 10;
    if (!Array.isArray(scopes) || !scopes.length || scopes.length > 3 || new Set(scopes).size !== scopes.length || scopes.some(scope => !SCOPES.includes(scope))) throw fail(400, 'Keys can grant only photo, video and existing AI content generation.');
    if (!Number.isInteger(daily) || daily < 1 || daily > 10000 || !Number.isInteger(userDaily) || userDaily < 1 || userDaily > daily) throw fail(400, 'Choose a daily key limit from 1 to 10,000 and a per-user limit within that amount.');
    const id = randomUUID(), secret = 'pip_media_' + randomBytes(32).toString('base64url');
    // Store only the hash and a short identifying prefix. The complete secret
    // exists only in this create response and the operator's chosen server.
    const { rows } = await db.query(`INSERT INTO office_ai_studio_keys (id,name,prefix,key_hash,scopes,daily_generation_limit,user_daily_generation_limit,created_at)
      SELECT $1,$2,$3,$4,$5::jsonb,$6,$7,$8 WHERE (SELECT COUNT(*) FROM office_ai_studio_keys WHERE revoked_at IS NULL)<25 RETURNING *`,
      [id, redact(body.name.trim()), secret.slice(0, 18), hash(secret), JSON.stringify(scopes), daily, userDaily, stamp()]);
    if (!rows.length) throw fail(409, 'Revoke an unused key before creating more than twenty-five active keys.');
    return res.status(201).json({ key: metadata(rows[0]), secret, integration: integration() });
  });
  const revoke = handle(async (req, res) => {
    if (!UUID.test(req.params.id || '')) throw fail(404, 'Media API key not found.');
    const { rows } = await db.query('UPDATE office_ai_studio_keys SET revoked_at=COALESCE(revoked_at,$2) WHERE id=$1 RETURNING *', [req.params.id, stamp()]);
    if (!rows.length) throw fail(404, 'Media API key not found.');
    return res.json({ key: metadata(rows[0]) });
  });
  async function authorize(secret, subject) {
    if (typeof secret !== 'string' || !TOKEN.test(secret)) throw fail(401, 'A valid media generation API key is required.');
    if (typeof subject !== 'string' || subject.length < 1 || subject.length > 200 || /[\u0000-\u001f\u007f]/.test(subject)) throw fail(400, 'Supply a stable authenticated end-user identity from your server.');
    await storage();
    const { rows } = await db.query('SELECT * FROM office_ai_studio_keys WHERE key_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>$2)', [hash(secret), stamp()]);
    if (!rows.length) throw fail(401, 'This media API key is invalid, expired or revoked.');
    const row = rows[0], subjectHash = hash(subject);
    await db.query('UPDATE office_ai_studio_keys SET last_used_at=$2 WHERE id=$1', [row.id, stamp()]);
    return { key: metadata(row), subjectHash, scope: `pip:${row.id}:${subjectHash}` };
  }
  const authentication = member => async (req, res, next) => {
    try {
      const authorization = req.headers?.authorization || '';
      const secret = member ? env.PIP_STUDIO_API_KEY : /^Bearer (\S+)$/i.exec(authorization)?.[1];
      if (member && !req.user?.id) throw fail(401, 'Sign in before generating media.');
      req.pipMedia = await authorize(secret, member ? `member:${req.user.id}` : `integration:${req.headers?.['x-pip-user-id'] || ''}`);
      if (!member && !req.headers?.['x-pip-user-id']) throw fail(400, 'The server must supply x-pip-user-id for the authenticated end user.');
      return next();
    } catch (error) { return res.status(error.publicMessage ? error.status : 503).json({ error: error.publicMessage || 'Media key authentication is unavailable.' }); }
  };
  function workspace(access) {
    if (!workspaces.has(access.scope)) {
      if (workspaces.size >= 200) workspaces.delete(workspaces.keys().next().value);
      workspaces.set(access.scope, createOfficeAIStudio({ db, env, fetcher, provider, now, scope: access.scope }));
    }
    return workspaces.get(access.scope);
  }
  async function reserve(access, operation) {
    const keyLimit = operation === 'create' ? Math.min(50000, access.key.dailyGenerationLimit * 5) : access.key.dailyGenerationLimit;
    const userLimit = operation === 'create' ? Math.min(5000, access.key.userDailyGenerationLimit * 5) : access.key.userDailyGenerationLimit;
    // Each counter increments conditionally in PostgreSQL. Concurrent callers
    // cannot exceed either bound; rejected submissions may consume an allowance.
    const { rows } = await db.query(`WITH subject_usage AS (
      INSERT INTO office_ai_studio_key_usage (key_id,subject_hash,usage_day,operation,submissions) VALUES ($1,$2,$3,$4,1)
      ON CONFLICT (key_id,subject_hash,usage_day,operation) DO UPDATE SET submissions=office_ai_studio_key_usage.submissions+1 WHERE office_ai_studio_key_usage.submissions<$5 RETURNING key_id)
      INSERT INTO office_ai_studio_key_usage (key_id,subject_hash,usage_day,operation,submissions) SELECT key_id,'*',$3,$4,1 FROM subject_usage
      ON CONFLICT (key_id,subject_hash,usage_day,operation) DO UPDATE SET submissions=office_ai_studio_key_usage.submissions+1 WHERE office_ai_studio_key_usage.submissions<$6 RETURNING key_id`,
      [access.key.id, access.subjectHash, stamp().slice(0, 10), operation, userLimit, keyLimit]);
    if (!rows.length) throw fail(429, 'This media key or end user has reached the daily submission limit. Try again after the next UTC day.');
  }
  function requireScope(access, scope) {
    if (!access?.key?.scopes?.includes(scope)) throw fail(403, 'This API key does not permit that generation type.');
  }
  async function ownedProject(service, req) {
    let result;
    const probe = { set() {}, status(value) { this.statusCode = value; return this; }, json(value) { result = value; return this; } };
    await service.detail({ params: req.params, query: {} }, probe);
    if (!result?.project) throw fail(probe.statusCode || 404, result?.error || 'Studio project not found.');
    return result.project;
  }
  const route = operation => handle(async (req, res) => {
    const access = req.pipMedia;
    if (!access) throw fail(401, 'A media generation API key is required.');
    const service = workspace(access);
    if (operation === 'create') {
      const input = validateProject(req.body);
      requireScope(access, input.kind === 'photo' ? 'photos:generate' : 'videos:generate');
      await reserve(access, 'create');
      if (screenPrompt) await screenPrompt(input.prompt);
    } else if (operation === 'list') {
      if (!access.key.scopes.some(scope => ['photos:generate','videos:generate'].includes(scope))) throw fail(403, 'This key does not permit media projects.');
    } else {
      const project = await ownedProject(service, req);
      requireScope(access, project.kind === 'photo' ? 'photos:generate' : 'videos:generate');
      if (['generate','assemble','regenerate'].includes(operation)) await reserve(access, 'generation');
    }
    if (!['list','create','detail','generate','assemble','extend','regenerate','cancel','resume','exportProject'].includes(operation)) throw fail(404, 'Unsupported media operation.');
    return service[operation](req, res);
  });
  const contentDraft = handle(async (req, res) => {
    const access = req.pipMedia; requireScope(access, 'content:generate');
    const body = req.body;
    if (!object(body) || Object.keys(body).some(key => !['topic','platform','tone'].includes(key)) || typeof body.topic !== 'string' || !body.topic.trim() || body.topic.length > 300
      || body.platform !== undefined && (typeof body.platform !== 'string' || body.platform.length > 40)
      || body.tone !== undefined && (typeof body.tone !== 'string' || body.tone.length > 40)) throw fail(400, 'Supply a caption topic up to 300 characters, with optional platform and tone.');
    if (typeof contentGenerator !== 'function') throw fail(503, 'Existing AI content generation is unavailable.');
    await reserve(access, 'generation');
    if (screenPrompt) await screenPrompt(body.topic);
    const result = await contentGenerator({ topic: redact(body.topic.trim()), platform: body.platform || 'general', tone: redact(body.tone || 'engaging and authentic') });
    if (!object(result) || !Array.isArray(result.drafts) || !result.drafts.length || result.drafts.some(draft => typeof draft !== 'string' || draft.length > 4000)) throw fail(502, 'The content generator returned no usable captions.');
    return res.json({ drafts: result.drafts.slice(0, 3).map(redact), provider: result.provider === 'openai' ? 'openai' : 'template', ...(result.fallback === true ? { fallback: true } : {}) });
  });
  return { list, create, revoke, authenticateServer: authentication(false), authenticateMember: authentication(true), route, contentDraft, authorize,
    idle: () => Promise.all([...workspaces.values()].map(studio => studio.idle())) };
}

module.exports = { createOfficeAIStudioKeys, MEDIA_KEY_SCOPES: SCOPES, MEDIA_KEY_SCHEMA: SCHEMA };
