const { randomUUID } = require('node:crypto');

const HISTORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS generated_content (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('draft', 'hashtags', 'image', 'video')),
    prompt TEXT NOT NULL DEFAULT '',
    input JSONB NOT NULL DEFAULT '{}',
    output JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'completed',
    provider_job_id TEXT,
    processing_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS generated_content_user_idx
    ON generated_content(user_id, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS generated_content_job_idx
    ON generated_content(user_id, provider_job_id) WHERE provider_job_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS generated_content_pending_idx
    ON generated_content(updated_at) WHERE status = 'processing' AND provider_job_id IS NOT NULL;
`;

function publicHistoryItem(row) {
  if (!row) return null;
  return {
    id: row.id, kind: row.kind, prompt: row.prompt, input: row.input, output: row.output,
    status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
    resumable: Boolean(row.provider_job_id),
  };
}

function historyCursor(row) {
  return Buffer.from(JSON.stringify([new Date(row.created_at).toISOString(), row.id])).toString('base64url');
}

function parseHistoryCursor(value) {
  if (!value) return null;
  try {
    if (typeof value !== 'string' || value.length > 300) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (!Array.isArray(cursor) || cursor.length !== 2 || !Number.isFinite(Date.parse(cursor[0]))
      || typeof cursor[1] !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(cursor[1])) throw new Error();
    return cursor;
  } catch {
    throw Object.assign(new Error('Invalid history cursor.'), { status: 400 });
  }
}

function createGeneratedContentStore(db) {
  async function query(sql, params) {
    if (!db.isConnected()) throw Object.assign(new Error('Content history is temporarily unavailable. Please retry.'), { status: 503 });
    try { return await db.query(sql, params); }
    catch { throw Object.assign(new Error('Content history could not be saved or loaded. Please retry.'), { status: 503 }); }
  }
  return {
    async create(userId, { kind, prompt, input = {}, output = {}, status = 'completed', id = randomUUID() }) {
      const { rows } = await query(`INSERT INTO generated_content (id, user_id, kind, prompt, input, output, status)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) RETURNING *`,
      [id, userId, kind, String(prompt || '').slice(0, 1000), JSON.stringify(input), JSON.stringify(output), status]);
      return rows[0];
    },
    async update(userId, id, { output, status, jobId = null }) {
      const { rows } = await query(`UPDATE generated_content SET output=$3::jsonb, status=$4,
        provider_job_id=COALESCE($5, provider_job_id), processing_until=NULL, updated_at=NOW()
        WHERE user_id=$1 AND id=$2 RETURNING *`, [userId, id, JSON.stringify(output), status, jobId]);
      if (!rows[0]) throw Object.assign(new Error('Saved content was not found.'), { status: 404 });
      return rows[0];
    },
    async get(userId, id) {
      const { rows } = await query('SELECT * FROM generated_content WHERE user_id=$1 AND id=$2', [userId, id]);
      return rows[0] || null;
    },
    async byJob(userId, jobId) {
      const { rows } = await query('SELECT * FROM generated_content WHERE user_id=$1 AND provider_job_id=$2 LIMIT 1', [userId, jobId]);
      return rows[0] || null;
    },
    async list(userId, { section = 'content', kind = '', q = '', cursor = '', limit = 20 } = {}) {
      const allowed = section === 'media' ? ['image', 'video'] : ['draft', 'hashtags'];
      if (kind && !allowed.includes(kind)) throw Object.assign(new Error('Invalid content type.'), { status: 400 });
      const after = parseHistoryCursor(cursor);
      const size = Math.max(1, Math.min(50, Number.parseInt(limit, 10) || 20));
      const { rows } = await query(`SELECT * FROM generated_content WHERE user_id=$1 AND kind=ANY($2::text[])
        AND ($3='' OR POSITION(LOWER($3) IN LOWER(prompt || ' ' || output::text)) > 0)
        AND ($4::timestamptz IS NULL OR (created_at, id) < ($4::timestamptz, $5::text))
        ORDER BY created_at DESC, id DESC LIMIT $6`,
      [userId, kind ? [kind] : allowed, String(q || '').slice(0, 200), after?.[0] || null, after?.[1] || null, size + 1]);
      const items = rows.slice(0, size);
      return { items: items.map(publicHistoryItem), nextCursor: rows.length > size ? historyCursor(items[items.length - 1]) : null };
    },
    async claim(userId, id) {
      const { rows } = await query(`UPDATE generated_content SET processing_until=NOW() + INTERVAL '3 minutes'
        WHERE user_id=$1 AND id=$2 AND status='processing'
        AND (processing_until IS NULL OR processing_until < NOW()) RETURNING *`, [userId, id]);
      return rows[0] || null;
    },
    async pending() {
      const { rows } = await query(`SELECT * FROM generated_content WHERE status='processing' AND provider_job_id IS NOT NULL
        AND (processing_until IS NULL OR processing_until < NOW())
        AND updated_at < NOW() - INTERVAL '15 seconds' ORDER BY updated_at LIMIT 2`);
      return rows;
    },
  };
}

module.exports = { HISTORY_SCHEMA, createGeneratedContentStore, publicHistoryItem, parseHistoryCursor };
