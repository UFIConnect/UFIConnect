'use strict';

const { randomUUID, createHmac, createHash } = require('node:crypto');
const { createTokenVault } = require('./token-vault');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const NAME = /^[a-z][a-z0-9-]{0,47}$/;
const STATUS = /^[a-z][a-z0-9_-]{0,47}$/;
const MEMORY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS office_ai_memory (
    id UUID PRIMARY KEY, scope TEXT NOT NULL CHECK(length(scope) BETWEEN 1 AND 48),
    kind TEXT NOT NULL CHECK(kind IN ('conversation','execution','note')),
    mode TEXT NOT NULL CHECK(length(mode) BETWEEN 1 AND 48),
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    status TEXT NOT NULL DEFAULT '' CHECK(length(status)<=48),
    reference_id TEXT NOT NULL DEFAULT '' CHECK(length(reference_id)<=128),
    encrypted_payload TEXT CHECK(length(encrypted_payload)<=180000),
    search_tokens TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
  )`,
  'ALTER TABLE office_ai_memory ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ',
  'ALTER TABLE office_ai_memory ALTER COLUMN encrypted_payload DROP NOT NULL',
  'CREATE INDEX IF NOT EXISTS office_ai_memory_scope_created ON office_ai_memory(scope,created_at DESC,id DESC)',
  'CREATE INDEX IF NOT EXISTS office_ai_memory_search ON office_ai_memory USING GIN(search_tokens)',
  "CREATE UNIQUE INDEX IF NOT EXISTS office_ai_memory_reference ON office_ai_memory(scope,kind,reference_id) WHERE reference_id<>''",
];
const STOP_WORDS = new Set('a about all an and are as at be been before but by can could did do does everything for from had has have how i in is it me my of on or our please that the their them then there these they this those to was we were what when where which who why will with would you your earlier previous past remember recall memory history discussed discuss talked told said'.split(' '));
const problem = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const scopeName = value => {
  const scope = value ?? 'office';
  if (typeof scope !== 'string' || !NAME.test(scope)) throw problem(400, 'Choose a valid Office memory scope.');
  return scope;
};
const limitValue = (value, fallback) => {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > 50) throw problem(400, 'Memory requests support a limit from 1 to 50.');
  return value;
};

// Credentials are omitted before encryption, indexing, and return. The stored
// search index contains keyed hashes, never plaintext words from conversations.
function memoryRedactor(env = process.env) {
  return value => {
    const secrets = Object.entries(env).filter(([key, secret]) => /(?:token|secret|password|api.?key|encryption.?key|deploy.?hook)/i.test(key)
      && typeof secret === 'string' && secret.length >= 6).map(([, secret]) => secret).sort((a, b) => b.length - a.length);
    let result = typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '') : '';
    for (const secret of secrets) result = result.split(secret).join('[credential omitted]');
    return result
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[private key omitted]')
      .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [credential omitted]')
      .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g, '[credential omitted]')
      .replace(/\b((?:[a-z][a-z0-9_]*_)?(?:password|passwd|secret|token|api[_-]?key))\s*([:=])\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&<>]+)/gi, '$1$2 [credential omitted]')
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[credential omitted]@');
  };
}

function sanitizeMetadata(value, redact, depth = 0) {
  if (depth > 4 || value === undefined) return null;
  if (typeof value === 'string') return redact(value).slice(0, 2000);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 24).map(item => sanitizeMetadata(item, redact, depth + 1));
  if (!object(value)) return null;
  return Object.fromEntries(Object.entries(value).slice(0, 32).map(([key, item]) => [key.slice(0, 80),
    /(?:password|passwd|secret|token|authorization|credential|api.?key|private.?key|cookie)/i.test(key)
      ? '[credential omitted]' : sanitizeMetadata(item, redact, depth + 1)]));
}

function words(value) {
  return [...new Set((value.normalize('NFKC').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,63}/gu) || [])
    .filter(word => !STOP_WORDS.has(word)))].slice(0, 2048);
}

function createOfficeAIMemory({ db, env = process.env, now = Date.now } = {}) {
  let ready, revision = 0;
  const redact = memoryRedactor(env);
  const timestamp = () => new Date(now()).toISOString();
  function cryptography() {
    const encoded = env.OAUTH_TOKEN_ENCRYPTION_KEY;
    if (typeof encoded !== 'string' || !encoded || Buffer.from(encoded, 'base64').length !== 32
      || Buffer.from(encoded, 'base64').toString('base64') !== encoded) throw problem(503, 'Office memory needs its encrypted database connection.');
    const key = Buffer.from(encoded, 'base64');
    return { vault: createTokenVault(env), indexKey: createHmac('sha256', key).update('office-ai-memory-index:v1').digest() };
  }
  async function storage() {
    if (!db?.isConnected?.() || typeof db.query !== 'function') throw problem(503, 'Office memory storage is unavailable. Nothing was stored in memory.');
    const crypto = cryptography();
    if (!ready) ready = (async () => { for (const sql of MEMORY_SCHEMA) await db.query(sql); })().catch(error => { ready = null; throw error; });
    await ready;
    return crypto;
  }
  const hashWords = (value, indexKey, scope) => words(value).map(word => createHmac('sha256', indexKey).update(`${scope}\0${word}`).digest('base64url'));
  async function operation(callback) {
    try { return await callback(); }
    catch (error) {
      if (error.publicMessage) throw error;
      throw problem(503, 'Office memory is unavailable. No memory contents were returned.');
    }
  }
  function decode(row, crypto) {
    if (row.deleted_at) return { id: row.id, scope: row.scope, kind: row.kind, referenceId: row.reference_id, deleted: true };
    const encrypted = row.encrypted_payload;
    if (typeof encrypted !== 'string' || !encrypted.startsWith('enc:v1:') || encrypted.length > 180000
      || Buffer.from(encrypted.slice(7), 'base64').toString('base64') !== encrypted.slice(7)) throw problem(503, 'Office memory could not be verified. No memory contents were returned.');
    const payload = JSON.parse(crypto.vault.open(encrypted, `office:memory:${row.scope}:${row.id}`));
    if (!object(payload) || typeof payload.content !== 'string' || typeof payload.title !== 'string' || !object(payload.metadata)) throw problem(503, 'Office memory could not be verified. No memory contents were returned.');
    return { id: row.id, scope: row.scope, kind: row.kind, mode: row.mode, role: row.role, status: row.status,
      referenceId: row.reference_id, content: redact(payload.content), title: redact(payload.title),
      metadata: sanitizeMetadata(payload.metadata, redact), createdAt: new Date(row.created_at).toISOString() };
  }
  const record = (input, { scope: scopeInput } = {}) => operation(async () => {
    const scope = scopeName(scopeInput);
    if (!object(input) || !['conversation', 'execution', 'note'].includes(input.kind)
      || typeof input.content !== 'string' || !input.content.trim() || input.content.length > 64000
      || !NAME.test(input.mode || 'chat') || !['user','assistant','system'].includes(input.role || 'system')) throw problem(400, 'Provide a valid Office conversation, execution result, or memory note.');
    if (input.status !== undefined && (typeof input.status !== 'string' || input.status && !STATUS.test(input.status))) throw problem(400, 'Provide a valid memory status.');
    if (input.referenceId !== undefined && (typeof input.referenceId !== 'string' || input.referenceId.length > 128 || !/^[a-zA-Z0-9:._/-]*$/.test(input.referenceId))) throw problem(400, 'Provide a valid memory reference.');
    if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 240)) throw problem(400, 'Memory titles support up to 240 characters.');
    if (redact(input.mode || 'chat') !== (input.mode || 'chat') || redact(input.status || '') !== (input.status || '')
      || redact(input.referenceId || '') !== (input.referenceId || '')) throw problem(400, 'Do not use credentials as memory labels or references.');
    const metadata = sanitizeMetadata(input.metadata || {}, redact);
    if (!object(metadata) || Buffer.byteLength(JSON.stringify(metadata)) > 16000) throw problem(400, 'Memory metadata is too large.');
    const content = redact(input.content), title = redact(input.title || '').slice(0, 240);
    const crypto = await storage(), id = randomUUID(), createdAt = timestamp();
    const encrypted = crypto.vault.seal(JSON.stringify({ content, title, metadata }), `office:memory:${scope}:${id}`);
    const indexes = hashWords(`${title}\n${content}\n${JSON.stringify(metadata)}\n${input.mode || 'chat'}\n${input.status || ''}`, crypto.indexKey, scope);
    const { rows } = await db.query(`INSERT INTO office_ai_memory(id,scope,kind,mode,role,status,reference_id,encrypted_payload,search_tokens,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10::timestamptz) ON CONFLICT DO NOTHING RETURNING *`,
    [id, scope, input.kind, input.mode || 'chat', input.role || 'system', input.status || '', input.referenceId || '', encrypted, indexes, createdAt]);
    if (rows[0]) { revision++; return decode(rows[0], crypto); }
    const existing = await db.query('SELECT * FROM office_ai_memory WHERE scope=$1 AND kind=$2 AND reference_id=$3', [scope, input.kind, input.referenceId || '']);
    if (!existing.rows[0]) throw problem(503, 'The memory entry could not be saved.');
    return decode(existing.rows[0], crypto);
  });
  const search = (query = '', { scope: scopeInput, limit: inputLimit } = {}) => operation(async () => {
    const scope = scopeName(scopeInput), limit = limitValue(inputLimit, 8);
    if (typeof query !== 'string' || query.length > 2000) throw problem(400, 'Search memory with up to 2,000 characters.');
    const crypto = await storage(), tokens = hashWords(redact(query), crypto.indexKey, scope).slice(0, 48);
    const { rows } = tokens.length ? await db.query(`SELECT * FROM office_ai_memory WHERE scope=$1 AND deleted_at IS NULL AND search_tokens && $2::text[]
      ORDER BY (SELECT count(*) FROM unnest(search_tokens) AS token WHERE token = ANY($2::text[])) DESC,created_at DESC,id DESC LIMIT $3`, [scope, tokens, limit])
      : await db.query('SELECT * FROM office_ai_memory WHERE scope=$1 AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT $2', [scope, limit]);
    return { entries: rows.map(row => decode(row, crypto)), scope, shared: true };
  });
  const get = (id, { scope: scopeInput } = {}) => operation(async () => {
    const scope = scopeName(scopeInput);
    if (typeof id !== 'string' || !UUID.test(id)) throw problem(400, 'Provide a valid memory entry ID.');
    const crypto = await storage();
    const { rows } = await db.query('SELECT * FROM office_ai_memory WHERE scope=$1 AND id=$2 AND deleted_at IS NULL', [scope, id]);
    if (!rows[0]) throw problem(404, 'This memory entry is no longer available.');
    return decode(rows[0], crypto);
  });
  const listEntries = ({ scope: scopeInput, limit: inputLimit, before, activity = false } = {}) => operation(async () => {
    const scope = scopeName(scopeInput), limit = limitValue(inputLimit, 20);
    let cursor = null;
    if (before !== undefined && before !== null) {
      if (typeof before !== 'string' || before.length > 200 || !/^[A-Za-z0-9_-]+$/.test(before)) throw problem(400, 'Invalid memory page cursor.');
      try {
        const decoded = JSON.parse(Buffer.from(before, 'base64url').toString('utf8'));
        if (!object(decoded) || !UUID.test(decoded.id) || typeof decoded.createdAt !== 'string'
          || !Number.isFinite(Date.parse(decoded.createdAt))) throw new Error('Invalid cursor');
        cursor = decoded;
      } catch { throw problem(400, 'Invalid memory page cursor.'); }
    }
    const crypto = await storage();
    // Activity scans never decrypt chat messages, hosted files or unrelated notes.
    // Keep the same stable cursor and explicit row budget as ordinary memory reads.
    const { rows } = activity ? await db.query(`SELECT * FROM office_ai_memory WHERE scope=$1 AND deleted_at IS NULL
      AND created_at >= $2::timestamptz AND (kind='execution' OR (kind='note' AND mode='activity'))
      AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid))
      ORDER BY created_at DESC,id DESC LIMIT $5`, [scope, new Date(now() - 60 * 60000).toISOString(), cursor?.createdAt || null, cursor?.id || null, limit + 1])
      : cursor ? await db.query(`SELECT * FROM office_ai_memory WHERE scope=$1 AND deleted_at IS NULL
      AND (created_at,id)<($2::timestamptz,$3::uuid) ORDER BY created_at DESC,id DESC LIMIT $4`, [scope, cursor.createdAt, cursor.id, limit + 1])
      : await db.query('SELECT * FROM office_ai_memory WHERE scope=$1 AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT $2', [scope, limit + 1]);
    const entries = rows.slice(0, limit).map(row => decode(row, crypto)), last = entries.at(-1);
    const nextCursor = rows.length > limit && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64url') : null;
    return { entries, nextCursor, scope, shared: true };
  });
  const list = options => listEntries(options);
  const listActivity = options => listEntries({ ...options, activity: true });
  const remove = (id, { scope: scopeInput } = {}) => operation(async () => {
    const scope = scopeName(scopeInput);
    if (typeof id !== 'string' || !UUID.test(id)) throw problem(400, 'Provide a valid memory entry ID.');
    await storage();
    const { rows } = await db.query('UPDATE office_ai_memory SET encrypted_payload=NULL,search_tokens=\'{}\',deleted_at=$3::timestamptz WHERE scope=$1 AND id=$2 RETURNING id', [scope, id, timestamp()]);
    if (!rows.length) throw problem(404, 'This memory entry no longer exists.');
    revision++;
    return { deleted: true, id };
  });
  const clear = ({ scope: scopeInput, confirmed } = {}) => operation(async () => {
    const scope = scopeName(scopeInput);
    if (confirmed !== true) throw problem(400, 'Confirm clearing the shared Office memory.');
    await storage();
    const result = await db.query('UPDATE office_ai_memory SET encrypted_payload=NULL,search_tokens=\'{}\',deleted_at=$2::timestamptz WHERE scope=$1 AND deleted_at IS NULL RETURNING id', [scope, timestamp()]);
    if (result.rows.length) revision++;
    return { cleared: true, count: result.rows.length, scope };
  });
  const removeReferences = (prefix, { scope: scopeInput } = {}) => operation(async () => {
    const scope = scopeName(scopeInput);
    if (typeof prefix !== 'string' || !prefix || prefix.length > 128 || !/^[a-zA-Z0-9:._/-]+$/.test(prefix)) throw problem(400, 'Provide a valid memory reference prefix.');
    await storage();
    const result = await db.query(`UPDATE office_ai_memory SET encrypted_payload=NULL,search_tokens='{}',deleted_at=$3::timestamptz
      WHERE scope=$1 AND left(reference_id,length($2))=$2 AND deleted_at IS NULL RETURNING id`, [scope, prefix, timestamp()]);
    if (result.rows.length) revision++;
    return { deleted: true, count: result.rows.length, scope };
  });
  const importSavedConversations = ({ scope: scopeInput, limit: inputLimit, before } = {}) => operation(async () => {
    const scope = scopeName(scopeInput), limit = limitValue(inputLimit, 5);
    if (limit > 20) throw problem(400, 'Import up to 20 saved conversations per page.');
    let cursor;
    if (before !== undefined && before !== null) {
      if (typeof before !== 'string' || before.length > 200 || !/^[A-Za-z0-9_-]+$/.test(before)) throw problem(400, 'Invalid saved-history import cursor.');
      try {
        cursor = JSON.parse(Buffer.from(before, 'base64url').toString('utf8'));
        if (!object(cursor) || !UUID.test(cursor.id) || typeof cursor.updatedAt !== 'string' || !Number.isFinite(Date.parse(cursor.updatedAt))) throw new Error('Invalid cursor');
      } catch { throw problem(400, 'Invalid saved-history import cursor.'); }
    }
    const crypto = await storage();
    const exists = await db.query("SELECT to_regclass('public.office_ai_conversations') AS name");
    if (!exists.rows[0]?.name) return { imported: 0, skipped: 0, conversations: 0, nextCursor: null, scope, shared: true };
    const { rows } = cursor ? await db.query(`SELECT * FROM office_ai_conversations WHERE deleted_at IS NULL
      AND (updated_at,id)<($1::timestamptz,$2::uuid) ORDER BY updated_at DESC,id DESC LIMIT $3`, [cursor.updatedAt, cursor.id, limit + 1])
      : await db.query('SELECT * FROM office_ai_conversations WHERE deleted_at IS NULL ORDER BY updated_at DESC,id DESC LIMIT $1', [limit + 1]);
    let imported = 0, skipped = 0;
    for (const row of rows.slice(0, limit)) {
      const title = crypto.vault.open(row.encrypted_title, `office:chat-title:${row.id}`).slice(0, 240);
      const messages = JSON.parse(crypto.vault.open(row.encrypted_messages, `office:chat:${row.id}`));
      if (!Array.isArray(messages) || messages.length > 200) throw problem(503, 'A saved conversation could not be verified for memory import.');
      for (const [index, message] of messages.entries()) {
        if (!object(message) || !['user','assistant'].includes(message.role) || typeof message.content !== 'string'
          || !message.content.trim() || message.content.length > 64000) throw problem(503, 'A saved conversation could not be verified for memory import.');
        const fingerprint = createHash('sha256').update(`${message.role}\0${message.content}`).digest('hex').slice(0, 24);
        const entry = await record({ kind: 'conversation', mode: message.taskId ? 'task' : 'chat', role: message.role,
          content: message.content, title, status: message.role === 'user' ? 'requested' : 'answered',
          referenceId: `chat:${row.id}:${index}:${fingerprint}`, metadata: { source: 'saved-conversation', conversationId: row.id,
            messageId: message.id || `message-${index}`, messageIndex: index, version: row.version,
            savedAt: new Date(row.updated_at).toISOString(), originallyCreatedAt: new Date(row.created_at).toISOString(),
            ...(message.taskId ? { taskId: message.taskId } : {}),
            sources: (Array.isArray(message.sources) ? message.sources : []).slice(0, 20).map(source => ({ title: source.title, url: source.url, provider: source.provider })) } }, { scope });
        if (entry.deleted) skipped++; else imported++;
      }
    }
    const last = rows.slice(0, limit).at(-1);
    const nextCursor = rows.length > limit && last ? Buffer.from(JSON.stringify({ updatedAt: new Date(last.updated_at).toISOString(), id: last.id })).toString('base64url') : null;
    return { imported, skipped, conversations: Math.min(rows.length, limit), nextCursor, scope, shared: true };
  });
  const status = async () => {
    try { await operation(storage); return { available: true, persistent: true, shared: true, scope: 'office' }; }
    catch { return { available: false, persistent: false, shared: true, scope: 'office', reason: 'Office memory needs its encrypted database connection.' }; }
  };
  const stats = ({ scope: scopeInput } = {}) => operation(async () => {
    const scope = scopeName(scopeInput); await storage();
    const { rows } = await db.query(`SELECT
      count(*) FILTER (WHERE deleted_at IS NULL) AS records,
      count(*) FILTER (WHERE deleted_at IS NULL AND kind='conversation') AS conversations,
      count(*) FILTER (WHERE deleted_at IS NULL AND kind='execution') AS executions,
      count(*) FILTER (WHERE deleted_at IS NULL AND kind='note') AS notes,
      count(DISTINCT split_part(reference_id,':',2) || ':' || split_part(reference_id,':',3))
        FILTER (WHERE deleted_at IS NULL AND kind='note' AND mode='hosted-web' AND reference_id LIKE 'artifact:%') AS artifacts,
      count(*) FILTER (WHERE deleted_at IS NULL AND kind='note' AND mode='hosted-web' AND reference_id LIKE 'artifact:%') AS versions,
      COALESCE(sum(octet_length(encrypted_payload)) FILTER (WHERE deleted_at IS NULL),0) AS stored_bytes,
      count(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted_tombstones
      FROM office_ai_memory WHERE scope=$1`, [scope]);
    const row = rows[0];
    return { persistent: true, storage: 'encrypted-database', scope, shared: true,
      records: Number(row.records), conversations: Number(row.conversations), executions: Number(row.executions), notes: Number(row.notes),
      artifacts: Number(row.artifacts), versions: Number(row.versions), storedBytes: Number(row.stored_bytes), deletedTombstones: Number(row.deleted_tombstones) };
  });
  return { record, get, search, list, listActivity, version: () => revision, remove, clear, removeReferences, importSavedConversations, status, stats };
}

module.exports = { createOfficeAIMemory, MEMORY_SCHEMA, memoryRedactor };
