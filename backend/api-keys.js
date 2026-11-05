'use strict';

const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { rateLimit } = require('express-rate-limit');

const API_KEY_SCOPES = [
  { id: 'topics:read', label: 'Read topics', description: 'List the available UFIConnect feed topics.' },
  { id: 'feed:read', label: 'Read public feed', description: 'Read shared external-source feed posts without account personalization.' },
  { id: 'posts:publish', label: 'Publish posts', description: 'Publish posts as the selected UFIConnect member.' },
  { id: 'posts:edit', label: 'Edit published posts', description: 'Edit only the posts created by this same API key.' },
  { id: 'ai:chat', label: 'AI chat', description: 'Send messages to the UFIConnect AI chat service.' },
  { id: 'images:generate', label: 'Generate photos', description: 'Generate images and read image generation results.' },
  { id: 'videos:generate', label: 'Generate videos', description: 'Generate videos and read video generation results.' },
  { id: 'content:generate', label: 'Generate AI content', description: 'Create written content with UFIConnect AI.' },
];
const API_KEY_TYPES = [
  { id: 'data', label: 'Platform data', description: 'Choose reading, publishing, and editing permissions.', scopes: ['topics:read', 'feed:read', 'posts:publish', 'posts:edit'] },
  { id: 'ai-chat', label: 'AI chat', description: 'Use AI conversations with a separate chat key.', scopes: ['ai:chat'] },
  { id: 'media', label: 'Photo and video generation', description: 'Choose photo generation, video generation, or both.', scopes: ['images:generate', 'videos:generate'] },
  { id: 'ai-content', label: 'AI content', description: 'Generate written content with a separate content key.', scopes: ['content:generate'] },
];
const SCOPE_IDS = API_KEY_SCOPES.map(scope => scope.id);
const API_KEY_RATE_LIMIT = { requests: 120, windowSeconds: 60 };
const API_KEY_GENERATION_LIMITS = { 'ai:chat': 200, 'content:generate': 100, 'images:generate': 10, 'videos:generate': 3 };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const API_KEY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ufi_api_keys (
    id UUID PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
    key_type TEXT NOT NULL DEFAULT 'data' CHECK(key_type IN ('data','ai-chat','media','ai-content')),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    key_prefix TEXT NOT NULL, key_hash CHAR(64) NOT NULL UNIQUE,
    scopes TEXT[] NOT NULL CHECK(cardinality(scopes) BETWEEN 1 AND 4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ,
    rate_window_start TIMESTAMPTZ, rate_window_count INTEGER NOT NULL DEFAULT 0 CHECK(rate_window_count >= 0),
    CONSTRAINT ufi_api_keys_type_scopes CHECK(
      (key_type='data' AND scopes <@ ARRAY['topics:read','feed:read','posts:publish','posts:edit']::text[])
      OR (key_type='ai-chat' AND scopes=ARRAY['ai:chat']::text[])
      OR (key_type='media' AND scopes <@ ARRAY['images:generate','videos:generate']::text[])
      OR (key_type='ai-content' AND scopes=ARRAY['content:generate']::text[])),
    CONSTRAINT ufi_api_keys_write_owner CHECK(NOT(scopes && ARRAY['posts:publish','posts:edit']::text[]) OR owner_id IS NOT NULL),
    CONSTRAINT ufi_api_keys_edit_publish CHECK(NOT('posts:edit'=ANY(scopes)) OR 'posts:publish'=ANY(scopes)),
    CONSTRAINT ufi_api_keys_owner_type CHECK(owner_id IS NULL OR key_type='data')
  )`,
  `CREATE INDEX IF NOT EXISTS ufi_api_keys_created ON ufi_api_keys(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS ufi_api_key_generation_usage (
    key_id UUID NOT NULL REFERENCES ufi_api_keys(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK(scope IN ('ai:chat','content:generate','images:generate','videos:generate')),
    day DATE NOT NULL, requests INTEGER NOT NULL CHECK(requests > 0), PRIMARY KEY(key_id,scope,day)
  )`,
];
const PUBLIC_COLUMNS = `id,name,key_type AS type,owner_id AS "ownerId",key_prefix AS prefix,scopes,created_at AS "createdAt",expires_at AS "expiresAt",
  last_used_at AS "lastUsedAt",revoked_at AS "revokedAt",
  CASE WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN expires_at <= NOW() THEN 'expired' ELSE 'active' END AS status`;
const failure = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });
const digest = key => createHash('sha256').update(key).digest('hex');
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

function createAPIKeys({ db }) {
  let ready;
  async function storage() {
    if (!db?.isConnected?.()) throw failure(503, 'API key storage is temporarily unavailable.');
    if (!ready) ready = (async () => { for (const statement of API_KEY_SCHEMA) await db.query(statement); })()
      .catch(error => { ready = null; throw error; });
    await ready;
  }
  async function list() {
    await storage();
    const { rows } = await db.query(`SELECT ${PUBLIC_COLUMNS} FROM ufi_api_keys ORDER BY created_at DESC,id DESC`);
    return { keys: rows, types: API_KEY_TYPES, scopes: API_KEY_SCOPES, apiBasePath: '/api/v1', rateLimit: API_KEY_RATE_LIMIT,
      generationLimits: API_KEY_GENERATION_LIMITS };
  }
  async function create(body) {
    if (!isObject(body) || Object.keys(body).some(key => !['name', 'type', 'ownerId', 'scopes', 'expiresInDays'].includes(key))
      || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80 || /[\x00-\x1f\x7f]/.test(body.name)
      || !Array.isArray(body.scopes) || !body.scopes.length || body.scopes.length > SCOPE_IDS.length
      || body.scopes.some(scope => !SCOPE_IDS.includes(scope)) || new Set(body.scopes).size !== body.scopes.length) {
      throw failure(400, 'Choose a name of up to 80 characters and at least one supported permission.');
    }
    const type = body.type === undefined ? 'data' : body.type;
    const definition = API_KEY_TYPES.find(item => item.id === type);
    if (!definition || body.scopes.some(scope => !definition.scopes.includes(scope))) throw failure(400, 'Choose permissions belonging to the selected key type.');
    if (body.scopes.includes('posts:edit') && !body.scopes.includes('posts:publish')) throw failure(400, 'Enable publishing to edit posts created by this same API key.');
    const ownerId = body.ownerId == null ? null : body.ownerId;
    const writes = body.scopes.some(scope => ['posts:publish', 'posts:edit'].includes(scope));
    if ((writes && !ownerId) || (ownerId !== null && (typeof ownerId !== 'string' || !UUID.test(ownerId) || type !== 'data'))) {
      throw failure(400, 'Select a valid UFIConnect member to own a publishing or editing key.');
    }
    const days = body.expiresInDays === undefined ? 90 : body.expiresInDays;
    if (days !== null && ![30, 90, 365].includes(days)) throw failure(400, 'Choose an expiration of 30, 90, or 365 days, or no expiration.');
    await storage();
    const key = `ufi_live_${randomBytes(32).toString('base64url')}`;
    const { rows: [apiKey] } = await db.query(`INSERT INTO ufi_api_keys(id,name,key_type,key_prefix,key_hash,scopes,expires_at,owner_id)
      SELECT $1,$2,$3,$4,$5,$6,CASE WHEN $7::integer IS NULL THEN NULL ELSE NOW() + $7::integer * INTERVAL '1 day' END,$8::uuid
      WHERE $8::uuid IS NULL OR EXISTS(SELECT 1 FROM users WHERE id=$8::uuid AND billing_closed IS NOT TRUE)
      RETURNING ${PUBLIC_COLUMNS}`, [randomUUID(), body.name.trim(), type, key.slice(0, 17), digest(key), body.scopes, days, ownerId]);
    if (!apiKey) throw failure(400, 'The selected UFIConnect member is unavailable.');
    // The secret is returned only by creation. Neither metadata queries nor
    // application logs contain it, and the stored hash cannot recover it.
    return { key, apiKey };
  }
  async function revoke(id) {
    if (typeof id !== 'string' || !UUID.test(id)) throw failure(400, 'Invalid API key reference.');
    await storage();
    const { rows: [apiKey] } = await db.query(`UPDATE ufi_api_keys SET revoked_at=COALESCE(revoked_at,NOW()) WHERE id=$1 RETURNING ${PUBLIC_COLUMNS}`, [id]);
    if (!apiKey) throw failure(404, 'API key not found.');
    return { apiKey };
  }
  async function consume(authorization, scope) {
    if (!SCOPE_IDS.includes(scope)) throw failure(403, 'This API permission is unavailable.');
    const match = typeof authorization === 'string' && /^Bearer (ufi_live_[A-Za-z0-9_-]{43})$/i.exec(authorization);
    if (!match) throw failure(401, 'Provide a valid UFIConnect API key in the Authorization Bearer header.');
    await storage();
    const hash = digest(match[1]);
    // The authoritative primary database checks revocation, expiry, permission,
    // and the shared per-key budget in one atomic update. Multiple API workers
    // cannot each grant their own independent rate allowance.
    const { rows: [apiKey] } = await db.query(`UPDATE ufi_api_keys SET
      rate_window_start=CASE WHEN rate_window_start IS NULL OR rate_window_start <= NOW() - INTERVAL '60 seconds' THEN NOW() ELSE rate_window_start END,
      rate_window_count=CASE WHEN rate_window_start IS NULL OR rate_window_start <= NOW() - INTERVAL '60 seconds' THEN 1 ELSE rate_window_count+1 END,
      last_used_at=NOW()
      WHERE key_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) AND $2=ANY(scopes)
        AND (owner_id IS NULL OR EXISTS(SELECT 1 FROM users WHERE id=ufi_api_keys.owner_id AND billing_closed IS NOT TRUE))
        AND (rate_window_start IS NULL OR rate_window_start <= NOW() - INTERVAL '60 seconds' OR rate_window_count < $3)
      RETURNING id,key_type AS type,owner_id AS "ownerId",scopes`, [hash, scope, API_KEY_RATE_LIMIT.requests]);
    if (apiKey) return apiKey;
    const { rows: [valid] } = await db.query(`SELECT scopes FROM ufi_api_keys
      WHERE key_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
      AND (owner_id IS NULL OR EXISTS(SELECT 1 FROM users WHERE id=ufi_api_keys.owner_id AND billing_closed IS NOT TRUE))`, [hash]);
    if (!valid) throw failure(401, 'The API key is invalid, expired, or revoked.');
    if (!valid.scopes.includes(scope)) throw failure(403, `This API key requires the ${scope} permission.`);
    throw failure(429, 'This API key has reached its request limit. Try again in one minute.');
  }
  async function consumeGeneration(keyId, scope) {
    const limit = API_KEY_GENERATION_LIMITS[scope];
    if (!limit || typeof keyId !== 'string' || !UUID.test(keyId)) throw failure(403, 'This generation permission is unavailable.');
    await storage();
    const { rows: [usage] } = await db.query(`INSERT INTO ufi_api_key_generation_usage(key_id,scope,day,requests)
      SELECT id,$2,(NOW() AT TIME ZONE 'UTC')::date,1 FROM ufi_api_keys
      WHERE id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) AND $2=ANY(scopes)
      ON CONFLICT(key_id,scope,day) DO UPDATE SET requests=ufi_api_key_generation_usage.requests+1
      WHERE ufi_api_key_generation_usage.requests < $3
      RETURNING requests AS used,((day + 1)::timestamp AT TIME ZONE 'UTC') AS "resetsAt"`, [keyId, scope, limit]);
    if (usage) return { scope, limit, used: usage.used, remaining: Math.max(0, limit - usage.used), resetsAt: usage.resetsAt };
    const { rows: [valid] } = await db.query(`SELECT scopes FROM ufi_api_keys
      WHERE id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`, [keyId]);
    if (!valid) throw failure(401, 'The API key is invalid, expired, or revoked.');
    if (!valid.scopes.includes(scope)) throw failure(403, `This API key requires the ${scope} permission.`);
    throw failure(429, `This API key has reached its daily limit of ${limit} requests for ${scope}. The limit resets at midnight UTC.`);
  }
  return { list, create, revoke, consume, consumeGeneration };
}

function feedParameters(query = {}) {
  if (Object.keys(query).some(key => !['limit', 'cursor'].includes(key))) throw failure(400, 'Supported feed parameters are limit and cursor.');
  const limit = query.limit === undefined ? 20 : typeof query.limit === 'string' && /^[1-9][0-9]?$/.test(query.limit) ? Number(query.limit) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw failure(400, 'Feed limit must be between 1 and 50.');
  if (query.cursor !== undefined) {
    try {
      if (typeof query.cursor !== 'string' || !query.cursor || query.cursor.length > 8192
        || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
      const parsed = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
      if (!isObject(parsed) || Object.keys(parsed).length > 80 || Object.entries(parsed).some(([source, value]) => {
        if (!/^[a-z][a-z0-9_-]{0,63}$/.test(source)) return true;
        const timestamp = typeof value === 'string' ? value : isObject(value) && value.ts;
        return typeof timestamp !== 'string' || timestamp.length > 40 || !Number.isFinite(Date.parse(timestamp))
          || (typeof value !== 'string' && (typeof value.id !== 'string' || value.id.length > 512 || /[\x00-\x1f]/.test(value.id)));
      })) throw new Error();
    } catch { throw failure(400, 'Invalid feed cursor.'); }
  }
  return { limit, cursor: query.cursor };
}

function registerAPIKeyRoutes(app, { requireOfficeToken, topics, readFeed, ...options }) {
  const service = createAPIKeys(options);
  const privateResponse = (_req, res, next) => {
    res.set('Cache-Control', 'private, no-store'); res.set('Pragma', 'no-cache'); res.vary('Authorization'); next();
  };
  const route = (action, status = 200) => async (req, res) => {
    try { res.status(status).json(await action(req)); }
    catch (error) { res.status(error.status || 503).json({ error: error.status ? error.message : 'API key services are temporarily unavailable.' }); }
  };
  const createLimit = rateLimit({ windowMs: 60000, limit: 10, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Wait a minute before generating more API keys.' } });
  const requestLimit = rateLimit({ windowMs: 60000, limit: 240, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many API requests from this network. Try again in one minute.' } });
  const authenticate = scope => async (req, res, next) => {
    try { req.ufiApiKey = await service.consume(req.get('authorization'), scope); next(); }
    catch (error) {
      if (error.status === 401) res.set('WWW-Authenticate', 'Bearer realm="UFIConnect API"');
      if (error.status === 429) res.set('Retry-After', '60');
      res.status(error.status || 503).json({ error: error.status ? error.message : 'API authentication is temporarily unavailable.' });
    }
  };
  const generationLimit = scope => async (req, res, next) => {
    try { req.ufiGenerationUsage = await service.consumeGeneration(req.ufiApiKey?.id, scope); next(); }
    catch (error) { res.status(error.status || 503).json({ error: error.status ? error.message : 'Generation limits are temporarily unavailable.' }); }
  };
  app.get('/office/api-keys', privateResponse, requireOfficeToken, route(() => service.list()));
  app.post('/office/api-keys', privateResponse, requireOfficeToken, createLimit, route(req => service.create(req.body), 201));
  app.delete('/office/api-keys/:id', privateResponse, requireOfficeToken, route(req => service.revoke(req.params.id)));
  app.get('/api/v1/topics', privateResponse, requestLimit, authenticate('topics:read'), route(req => {
    if (Object.keys(req.query).length) throw failure(400, 'The topics endpoint does not accept query parameters.');
    return { topics: [...topics] };
  }));
  app.get('/api/v1/feed', privateResponse, requestLimit, authenticate('feed:read'), route(req => readFeed(feedParameters(req.query))));
  return { ...service, authenticate, privateResponse, requestLimit, generationLimit };
}

module.exports = { API_KEY_SCHEMA, API_KEY_SCOPES, API_KEY_TYPES, API_KEY_RATE_LIMIT, API_KEY_GENERATION_LIMITS,
  createAPIKeys, registerAPIKeyRoutes, feedParameters };
