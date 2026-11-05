'use strict';

const { createTokenVault } = require('./token-vault');
const { createHash } = require('node:crypto');
const { SOURCE_IDS } = require('./office-ai-sources');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SCHEMA = `CREATE TABLE IF NOT EXISTS office_ai_conversations (
  id UUID PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1,
  encrypted_title TEXT, encrypted_messages TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ)`;
const problem = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, limit) : '';
const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
function sourceUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 2048 ? url.href : null; }
  catch { return null; }
}
function memoryValue(input) {
  if (!object(input)) return undefined;
  const seen = new Set();
  return { status: ['retrieved', 'empty', 'unavailable', 'disabled'].includes(input.status) ? input.status : 'unavailable',
    entries: (Array.isArray(input.entries) ? input.entries : []).slice(0, 8).flatMap(entry => {
      if (!object(entry) || !UUID.test(entry.id || '') || seen.has(entry.id.toLowerCase())
        || !['conversation', 'execution', 'note'].includes(entry.kind)) return [];
      seen.add(entry.id.toLowerCase());
      return [{ id: entry.id.toLowerCase(), title: text(entry.title, 240), kind: entry.kind,
        status: typeof entry.status === 'string' && /^[a-z][a-z0-9_-]{0,47}$/.test(entry.status) ? entry.status : '',
        referenceId: typeof entry.referenceId === 'string' && /^[a-zA-Z0-9:._/-]{0,128}$/.test(entry.referenceId) ? entry.referenceId : '',
        createdAt: date(entry.createdAt) }];
    }) };
}
function messagesValue(input) {
  if (!Array.isArray(input) || input.length > 200 || Buffer.byteLength(JSON.stringify(input)) > 300000) throw problem(413, 'A saved chat supports up to 200 messages and 300 KB. Start a new conversation.');
  return input.map((message, index) => {
    if (!object(message) || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string'
      || !message.content.trim() || message.role === 'assistant' && message.content.length > 24000) throw problem(400, 'Saved messages need a user or assistant role and nonempty text. Assistant replies support up to 24,000 characters.');
    const item = { id: text(message.id, 100) || `message-${index}`, role: message.role,
      content: text(message.content, message.role === 'user' ? message.content.length : 24000) };
    if (message.role === 'user') return item;
    if (typeof message.taskId === 'string' && UUID.test(message.taskId)) item.taskId = message.taskId.toLowerCase();
    if (date(message.generatedAt)) item.generatedAt = date(message.generatedAt);
    if (message.model) item.model = text(message.model, 160);
    if (object(message.memory)) item.memory = memoryValue(message.memory);
    if (typeof message.truncated === 'boolean') item.truncated = message.truncated;
    if (object(message.research)) item.research = {
      status: ['verified', 'official-updates', 'pages', 'empty', 'unavailable', 'disabled'].includes(message.research.status) ? message.research.status : 'disabled',
      checkedAt: date(message.research.checkedAt), note: text(message.research.note, 600),
      providers: (Array.isArray(message.research.providers) ? message.research.providers : []).slice(0, 8).map(value => text(value, 100)),
    };
    if (Array.isArray(message.connectedSources)) {
      const seen = new Set();
      item.connectedSources = message.connectedSources.slice(0, 3).flatMap(source => {
        if (!object(source) || !SOURCE_IDS.includes(source.id) || seen.has(source.id)
          || !['retrieved', 'empty', 'unavailable', 'not-connected'].includes(source.status)) return [];
        seen.add(source.id);
        return [{ id: source.id, status: source.status, count: Number.isInteger(source.count) && source.count >= 0 && source.count <= 4 ? source.count : 0,
          checkedAt: date(source.checkedAt), note: text(source.note, 600) }];
      });
    }
    item.sources = (Array.isArray(message.sources) ? message.sources : []).slice(0, 20).flatMap(source => {
      if (!object(source) || !sourceUrl(source.url)) return [];
      const url = sourceUrl(source.url), hostname = new URL(url).hostname;
      // Keep citation links and attribution for saved replies, without storing
      // raw workspace excerpts alongside the assistant's answer.
      const provider = SOURCE_IDS.includes(source.provider) ? source.provider
        : /(?:^|\.)(?:notion\.so|notion\.com|notion\.site)$/.test(hostname) ? 'notion'
          : /(?:^|\.)slack\.com$/.test(hostname) ? 'slack' : /(?:^|\.)linear\.app$/.test(hostname) ? 'linear' : null;
      return [{ title: text(source.title, 240), url, publisher: text(source.publisher, 100),
        ...(provider ? { provider } : { description: text(source.description, 1200), publishedAt: date(source.publishedAt) }) }];
    });
    item.actions = (Array.isArray(message.actions) ? message.actions : []).slice(0, 8).flatMap(action => object(action) && /^[a-z][a-z0-9.-]{1,100}$/.test(action.id) ? [{
      id: action.id, label: text(action.label, 180), description: text(action.description, 600),
      target: ['api', 'pipeline', 'both'].includes(action.target) ? action.target : 'api',
      requiresConfirmation: !!action.requiresConfirmation, available: action.available !== false,
    }] : []);
    return item;
  });
}
function titleValue(value, messages) {
  if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > 160)) throw problem(400, 'Chat titles need 1 to 160 characters.');
  return text(value || messages.find(message => message.role === 'user')?.content || 'New conversation', 160).trim();
}
function createOfficeConversations({ db, env = process.env, memory } = {}) {
  let ready, vault;
  async function storage() {
    if (!db?.isConnected?.() || typeof db.withClient !== 'function') throw problem(503, 'Chat storage is unavailable. Your conversation has not been saved.');
    vault ||= createTokenVault(env);
    if (!ready) ready = db.query(SCHEMA).catch(error => { ready = null; throw error; });
    await ready;
  }
  function summary(row) {
    return { id: row.id, version: row.version, title: vault.open(row.encrypted_title, `office:chat-title:${row.id}`),
      createdAt: date(row.created_at), updatedAt: date(row.updated_at) };
  }
  const full = row => ({ ...summary(row), messages: JSON.parse(vault.open(row.encrypted_messages, `office:chat:${row.id}`)) });
  const encode = (id, title, messages) => [vault.seal(title, `office:chat-title:${id}`), vault.seal(JSON.stringify(messages), `office:chat:${id}`)];
  // Saving a chat remains authoritative even if the optional recall index is
  // unavailable. Return its actual state without reporting a committed save as
  // failed. Stable references make retries idempotent and honor forgotten rows.
  async function remember(row, previousMessages = []) {
    if (!memory?.record) return undefined;
    let indexed = 0;
    try {
      const conversation = full(row);
      for (const [index, message] of conversation.messages.entries()) {
        const previous = previousMessages[index];
        if (previous?.role === message.role && previous?.content === message.content) continue;
        const fingerprint = createHash('sha256').update(`${message.role}\0${message.content}`).digest('hex').slice(0, 24);
        const entry = await memory.record({ kind: 'conversation', mode: message.taskId ? 'task' : 'chat', role: message.role,
          content: message.content, title: conversation.title, status: message.role === 'user' ? 'requested' : 'answered',
          referenceId: `chat:${conversation.id}:${index}:${fingerprint}`,
          metadata: { source: 'saved-conversation', conversationId: conversation.id, messageId: message.id,
            messageIndex: index, version: conversation.version, ...(message.taskId ? { taskId: message.taskId } : {}),
            sources: (message.sources || []).map(source => ({ title: source.title, url: source.url, provider: source.provider })) } });
        if (!entry.deleted) indexed++;
      }
      return { available: true, persistent: true, shared: true, indexed };
    } catch { return { available: false, persistent: false, shared: true, indexed, reason: 'The chat was saved, but its memory index is unavailable.' }; }
  }
  const validId = value => { if (!UUID.test(value || '')) throw problem(400, 'Invalid conversation ID.'); return value.toLowerCase(); };
  const version = body => { if (!Number.isInteger(body?.expectedVersion) || body.expectedVersion < 1) throw problem(400, 'Reload this conversation before saving a change.'); return body.expectedVersion; };
  const handle = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await storage(); return await fn(req, res); }
    catch (error) { return res.status(error.publicMessage ? error.status : 503).json({ error: error.publicMessage || 'Chat storage could not complete this request. Nothing was reported as saved; retry when storage is available.' }); }
  };
  const list = handle(async (_req, res) => {
    const { rows } = await db.query('SELECT id,version,encrypted_title,created_at,updated_at FROM office_ai_conversations WHERE deleted_at IS NULL ORDER BY updated_at DESC,id LIMIT 200');
    return res.json({ conversations: rows.map(summary), storage: 'encrypted-database' });
  });
  const detail = handle(async (req, res) => {
    const { rows } = await db.query('SELECT * FROM office_ai_conversations WHERE id=$1 AND deleted_at IS NULL', [validId(req.params.id)]);
    if (!rows[0]) throw problem(404, 'This conversation is no longer available.');
    return res.json({ conversation: full(rows[0]) });
  });
  const create = handle(async (req, res) => {
    const body = req.body;
    if (!object(body) || Object.keys(body).some(key => !['clientRequestId', 'title', 'messages'].includes(key))) throw problem(400, 'Provide a conversation ID, title, and messages.');
    const id = validId(body.clientRequestId), messages = messagesValue(body.messages), title = titleValue(body.title, messages);
    const result = await db.withClient(async client => {
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('office-ai-conversations-create'))");
        const existing = (await client.query('SELECT * FROM office_ai_conversations WHERE id=$1', [id])).rows[0];
        if (existing?.deleted_at) throw problem(410, 'This conversation was deleted. Start a new conversation.');
        if (existing) { await client.query('COMMIT'); return existing; }
        const count = (await client.query('SELECT COUNT(*)::integer AS count FROM office_ai_conversations WHERE deleted_at IS NULL')).rows[0].count;
        if (count >= 200) throw problem(409, 'The Office has 200 saved chats. Delete an old chat before creating another.');
        const [encryptedTitle, encryptedMessages] = encode(id, title, messages);
        const row = (await client.query('INSERT INTO office_ai_conversations(id,encrypted_title,encrypted_messages) VALUES($1,$2,$3) RETURNING *', [id, encryptedTitle, encryptedMessages])).rows[0];
        await client.query('COMMIT'); return row;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    });
    return res.status(201).json({ conversation: full(result), memory: await remember(result) });
  });
  const update = handle(async (req, res) => {
    const body = req.body, id = validId(req.params.id), expected = version(body);
    if (!object(body) || Object.keys(body).some(key => !['expectedVersion', 'title', 'messages'].includes(key)) || body.title === undefined && body.messages === undefined) throw problem(400, 'Provide a title or messages to save.');
    const row = (await db.query('SELECT * FROM office_ai_conversations WHERE id=$1 AND deleted_at IS NULL', [id])).rows[0];
    if (!row) throw problem(404, 'This conversation is no longer available.');
    if (row.version !== expected) throw problem(409, 'This conversation changed in another window. Keep your unsaved text and reload its saved version.');
    const old = full(row), messages = body.messages === undefined ? old.messages : messagesValue(body.messages);
    const title = body.title === undefined ? old.title : titleValue(body.title, messages);
    const [encryptedTitle, encryptedMessages] = encode(id, title, messages);
    const changed = (await db.query('UPDATE office_ai_conversations SET encrypted_title=$1,encrypted_messages=$2,version=version+1,updated_at=NOW() WHERE id=$3 AND version=$4 AND deleted_at IS NULL RETURNING *', [encryptedTitle, encryptedMessages, id, expected])).rows[0];
    if (!changed) throw problem(409, 'This conversation changed before your save completed. Keep your unsaved text and reload its saved version.');
    return res.json({ conversation: full(changed), memory: await remember(changed, old.messages) });
  });
  const remove = handle(async (req, res) => {
    const id = validId(req.params.id), expected = version(req.body);
    if (req.body?.confirmed !== true) throw problem(400, 'Confirm deleting this saved conversation.');
    const row = (await db.query('SELECT version,deleted_at FROM office_ai_conversations WHERE id=$1', [id])).rows[0];
    if (!row || row.deleted_at) return res.json({ deleted: true });
    const changed = (await db.query('UPDATE office_ai_conversations SET encrypted_title=NULL,encrypted_messages=NULL,deleted_at=NOW(),updated_at=NOW(),version=version+1 WHERE id=$1 AND version=$2 AND deleted_at IS NULL RETURNING id', [id, expected])).rows[0];
    if (!changed) throw problem(409, 'This conversation changed. Reload it before deleting.');
    let memoryStatus;
    if (memory?.removeReferences) {
      try { await memory.removeReferences(`chat:${id}:`); memoryStatus = { forgotten: true }; }
      catch { memoryStatus = { forgotten: false, reason: 'The saved chat was deleted. Its recall index could not be cleared; retry from Memory when storage is available.' }; }
    }
    return res.json({ deleted: true, memory: memoryStatus });
  });
  return { list, create, detail, update, remove };
}
module.exports = { createOfficeConversations, messagesValue, SCHEMA };
