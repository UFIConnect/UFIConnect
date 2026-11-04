'use strict';

const { createHash } = require('node:crypto');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const WORKSPACE_SCHEMA = `CREATE TABLE IF NOT EXISTS office_ai_workspace_files (
  project_id UUID NOT NULL, file_path TEXT NOT NULL CHECK(length(file_path) BETWEEN 1 AND 240),
  content_hash CHAR(64) NOT NULL, version INTEGER NOT NULL CHECK(version>0),
  byte_count INTEGER NOT NULL CHECK(byte_count BETWEEN 0 AND 81920),
  memory_id UUID NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(project_id,file_path)
)`;
const problem = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });
const hash = value => createHash('sha256').update(value).digest('hex');
function projectValue(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw problem(400, 'Use a valid hosted task project ID.');
  return value.toLowerCase();
}
function pathValue(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || value !== value.trim() || /[\\%:#?\u0000-\u001f\u007f]/.test(value)) throw problem(400, 'Use a normalized relative file path.');
  const parts = value.split('/');
  if (parts.some(part => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(part)
    || /^(?:env|secrets?|credentials?|private[-_]?keys?|tokens?)(?:\.[A-Za-z0-9_-]+)?$/i.test(part)
    || /\.(?:pem|key|p12|pfx|keystore|jks)$/i.test(part))) throw problem(400, 'Hosted project paths cannot contain traversal, hidden files, or credential files.');
  return parts.join('/');
}
const receipt = row => ({ path: row.file_path, revision: row.content_hash, sha256: row.content_hash, version: row.version,
  bytes: row.byte_count, memoryId: row.memory_id, updatedAt: new Date(row.updated_at).toISOString(), storage: 'memory' });

// File bytes live only in the encrypted memory archive. This table keeps a
// versioned latest-file pointer, so forgetting memory also removes file access.
function createOfficeAIWorkspace({ db, env = process.env, memory } = {}) {
  let ready;
  async function storage() {
    if (!db?.isConnected?.() || typeof db.query !== 'function') throw problem(503, 'Hosted project memory is unavailable. No computer files were changed.');
    if (!env.OAUTH_TOKEN_ENCRYPTION_KEY) throw problem(503, 'Hosted project files need encrypted memory storage.');
    if (!memory?.record || !memory?.get || !memory?.status) throw problem(503, 'Hosted project memory is not connected.');
    if (!ready) ready = db.query(WORKSPACE_SCHEMA).catch(error => { ready = null; throw error; });
    await ready;
  }
  async function operation(callback) {
    try { return await callback(); }
    catch (error) {
      if (error.publicMessage) throw error;
      throw problem(503, 'The hosted project operation could not be verified. Check its files before retrying.');
    }
  }
  async function contents(row) {
    const archived = await memory.get(row.memory_id);
    const content = archived.metadata?.emptyFile === true ? '' : archived.content;
    if (archived.kind !== 'note' || archived.mode !== 'hosted-web' || archived.metadata?.projectId !== row.project_id
      || archived.metadata?.path !== row.file_path || archived.metadata?.revision !== row.content_hash
      || typeof content !== 'string' || hash(content) !== row.content_hash) throw problem(503, 'The hosted file memory could not be verified.');
    return content;
  }
  const list = projectId => operation(async () => {
    const project = projectValue(projectId); await storage();
    const { rows } = await db.query('SELECT * FROM office_ai_workspace_files WHERE project_id=$1 ORDER BY file_path LIMIT 21', [project]);
    if (rows.length > 20) throw problem(503, 'This hosted project exceeds its file capacity.');
    return { projectId: project, files: rows.map(receipt), storage: 'memory', hosted: true };
  });
  const read = (projectId, filePath) => operation(async () => {
    const project = projectValue(projectId), path = pathValue(filePath); await storage();
    const { rows } = await db.query('SELECT * FROM office_ai_workspace_files WHERE project_id=$1 AND file_path=$2', [project, path]);
    if (!rows[0]) throw problem(404, 'This hosted project file does not exist.');
    return { projectId: project, ...receipt(rows[0]), content: await contents(rows[0]), hosted: true };
  });
  const write = (projectId, input) => operation(async () => {
    const project = projectValue(projectId);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['path','content','expectedRevision'].includes(key))) throw problem(400, 'Provide a file path, contents, and its expected revision.');
    const path = pathValue(input.path);
    if (typeof input.content !== 'string' || input.content.length > 60000 || Buffer.byteLength(input.content, 'utf8') > 81920 || input.content.includes('\0')) throw problem(400, 'Hosted files support text up to 60,000 characters and 80 KiB.');
    if (input.expectedRevision !== undefined && (typeof input.expectedRevision !== 'string' || !HASH.test(input.expectedRevision))) throw problem(400, 'Use the SHA-256 revision returned by reading the hosted file.');
    await storage();
    if (typeof db.withClient !== 'function') throw problem(503, 'Hosted project writes need transactional memory storage.');
    if ((await memory.status()).available !== true) throw problem(503, 'Hosted project memory is unavailable. The file was not saved.');
    const digest = hash(input.content), bytes = Buffer.byteLength(input.content, 'utf8');
    return db.withClient(async client => {
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '15s'");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('office-ai-hosted-workspace:' || $1))", [project]);
        const existing = (await client.query('SELECT * FROM office_ai_workspace_files WHERE project_id=$1 AND file_path=$2 FOR UPDATE', [project, path])).rows[0];
        if (existing?.content_hash === digest) {
          await contents(existing); await client.query('COMMIT');
          return { projectId: project, ...receipt(existing), unchanged: true, hosted: true };
        }
        if (existing && input.expectedRevision !== existing.content_hash) throw problem(409, 'This hosted file changed. Read its current revision before updating it.');
        if (!existing && input.expectedRevision !== undefined) throw problem(409, 'This hosted file does not exist. Create it without an expected revision.');
        if (!existing) {
          const count = (await client.query('SELECT count(*)::integer AS count FROM office_ai_workspace_files WHERE project_id=$1', [project])).rows[0].count;
          if (count >= 20) throw problem(409, 'A hosted project supports up to 20 files.');
        }
        const version = (existing?.version || 0) + 1;
        const archived = await memory.record({ kind: 'note', mode: 'hosted-web', role: 'system', status: 'saved', title: path,
          content: input.content || '[Empty hosted file]', referenceId: `artifact:${project}:${hash(path).slice(0, 16)}:${version}:${digest.slice(0, 32)}`,
          metadata: { source: 'hosted-workspace', projectId: project, path, revision: digest, version,
            previousRevision: existing?.content_hash || null, bytes, emptyFile: input.content.length === 0 } });
        if (archived.deleted || !UUID.test(archived.id || '')) throw problem(409, 'This file version was forgotten from memory. Create a new version to save it again.');
        if (archived.content !== input.content && !(input.content === '' && archived.content === '[Empty hosted file]')) throw problem(400, 'The file contains credential material that cannot be stored as a project artifact. Use Connections for credentials.');
        const { rows } = await client.query(`INSERT INTO office_ai_workspace_files(project_id,file_path,content_hash,version,byte_count,memory_id)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(project_id,file_path) DO UPDATE SET content_hash=EXCLUDED.content_hash,
          version=EXCLUDED.version,byte_count=EXCLUDED.byte_count,memory_id=EXCLUDED.memory_id,updated_at=NOW() RETURNING *`, [project, path, digest, version, bytes, archived.id]);
        await client.query('COMMIT');
        return { projectId: project, ...receipt(rows[0]), hosted: true };
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    });
  });
  return { list, read, write };
}

module.exports = { createOfficeAIWorkspace, WORKSPACE_SCHEMA, pathValue };
