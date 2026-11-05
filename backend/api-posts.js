'use strict';

const { createHash, randomUUID } = require('node:crypto');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const GROUP = 'ufi-general';
// Keep the request tombstone after a native post is deleted, so a delayed
// publishing retry cannot recreate content that a member or moderator removed.
const API_POSTS_SCHEMA = `CREATE TABLE IF NOT EXISTS ufi_api_posts (
  key_id UUID NOT NULL REFERENCES ufi_api_keys(id) ON DELETE CASCADE,
  request_id UUID NOT NULL, post_id TEXT NOT NULL UNIQUE,
  request_hash CHAR(64) NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(key_id,request_id)
)`;
const API_POSTS_VERSION_SCHEMA = [
  `CREATE OR REPLACE FUNCTION ufi_api_post_bump_version() RETURNS TRIGGER LANGUAGE plpgsql AS $body$
    BEGIN
      IF NEW.content IS DISTINCT FROM OLD.content OR NEW.title IS DISTINCT FROM OLD.title
        OR NEW.media_url IS DISTINCT FROM OLD.media_url OR NEW.media_type IS DISTINCT FROM OLD.media_type THEN
        UPDATE ufi_api_posts SET version=version+1,updated_at=NOW() WHERE post_id=NEW.id;
      END IF;
      RETURN NEW;
    END
  $body$`,
  `CREATE OR REPLACE TRIGGER ufi_api_post_version AFTER UPDATE OF content,title,media_url,media_type ON community_posts
    FOR EACH ROW EXECUTE FUNCTION ufi_api_post_bump_version()`,
];
const failure = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const publicPost = row => ({ id: row.id, authorId: row.author_id, authorName: row.author_name, groupId: row.group_id,
  title: row.title || '', content: row.content, source: 'uficonnect', sourceLabel: 'UFIConnect',
  mediaUrl: row.media_url || null, mediaType: row.media_type || null, createdAt: row.created_at,
  updatedAt: row.updated_at, version: row.version });

function createAPIPosts({ db, screenContent, validateMedia, onChanged = () => {} }) {
  let ready;
  async function storage() {
    if (!db?.isConnected?.() || typeof db.withClient !== 'function') throw failure(503, 'Publishing storage is temporarily unavailable.');
    if (!ready) ready = (async () => {
      for (const statement of [API_POSTS_SCHEMA, ...API_POSTS_VERSION_SCHEMA]) await db.query(statement);
    })().catch(error => { ready = null; throw error; });
    await ready;
  }
  function identity(key, scope) {
    if (!key || key.type !== 'data' || !UUID.test(key.id || '') || !UUID.test(key.ownerId || '') || !key.scopes?.includes(scope)) {
      throw failure(403, 'Use a platform data key with the required permission and a selected member.');
    }
  }
  async function withAuthor(key, scope, work) {
    identity(key, scope); await storage();
    return db.withClient(async client => {
      await client.query('BEGIN');
      try {
        // Member deletion takes this same author lock first. Key revocation
        // then shares the key-row lock, so neither can race a delayed write.
        const { rows: [author] } = await client.query('SELECT id,name,billing_closed FROM users WHERE id=$1 FOR UPDATE', [key.ownerId]);
        if (!author || author.billing_closed) throw failure(401, 'The API key member is unavailable.');
        const { rows: [active] } = await client.query(`SELECT id FROM ufi_api_keys
          WHERE id=$1 AND owner_id=$2 AND key_type='data' AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > NOW()) AND $3=ANY(scopes) FOR UPDATE`, [key.id, key.ownerId, scope]);
        if (!active) throw failure(401, 'The API key is invalid, expired, revoked, or no longer authorized.');
        const result = await work(client, author);
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    });
  }
  function textFields(body, editing = false) {
    const fields = editing ? ['content', 'title', 'expectedVersion'] : ['requestId', 'content', 'title', 'mediaUrl', 'mediaType'];
    if (!object(body) || Object.keys(body).some(key => !fields.includes(key)) || typeof body.content !== 'string'
      || body.content.length > 2000 || body.content.includes('\0')
      || (body.title !== undefined && (typeof body.title !== 'string' || body.title.length > 200 || /[\x00-\x1f\x7f]/.test(body.title)))) {
      throw failure(400, 'Use content of up to 2,000 characters and an optional title of up to 200 characters.');
    }
    if (!editing && !UUID.test(body.requestId || '')) throw failure(400, 'Provide a UUID requestId for safe publishing retries.');
    if (editing && (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1 || body.expectedVersion > 2147483646)) {
      throw failure(400, 'Provide the post expectedVersion from the latest API response.');
    }
    return { content: body.content.trim(), title: body.title === undefined ? undefined : body.title.trim() };
  }
  async function mediaFields(body) {
    if (body.mediaUrl == null && body.mediaType == null) return { mediaUrl: null, mediaType: null };
    if (typeof body.mediaUrl !== 'string' || !body.mediaUrl || body.mediaUrl.length > 1000 || !['image', 'video'].includes(body.mediaType)
      || typeof validateMedia !== 'function') throw failure(400, 'Use a verified UFIConnect image or video upload.');
    const media = await validateMedia({ mediaUrl: body.mediaUrl, mediaType: body.mediaType });
    if (!media || typeof media.mediaUrl !== 'string' || !media.mediaUrl || media.mediaUrl.length > 1000
      || !['image', 'video'].includes(media.mediaType)) throw failure(400, 'Use a verified UFIConnect image or video upload.');
    return media;
  }
  async function screen({ content, title, mediaUrl, mediaType }) {
    if (!content && !mediaUrl) throw failure(400, 'Content or a verified image is required.');
    if (mediaType === 'video' && !content) throw failure(400, 'Add a caption to video posts before publishing.');
    if (typeof screenContent !== 'function') throw failure(503, 'Post screening is temporarily unavailable.');
    const checked = async options => {
      const result = await screenContent({ ...options, kind: 'post' });
      if (!result?.allowed) throw failure(result?.reason === 'screening_unavailable' ? 503 : 422,
        result?.reason === 'screening_unavailable' ? 'Post screening is temporarily unavailable.' : 'This post cannot be published.');
      if (typeof result.content !== 'string' || result.content.length > options.maxLength || result.content.includes('\0')) {
        throw failure(503, 'Post screening is temporarily unavailable.');
      }
      return result.content;
    };
    const screenedTitle = title ? await checked({ content: title, maxLength: 200 }) : '';
    const screenedContent = await checked({ content, mediaUrl, mediaType, maxLength: 2000 });
    if ((!screenedContent.trim() && !mediaUrl) || (mediaType === 'video' && !screenedContent.trim())) throw failure(422, 'This post cannot be published.');
    return { title: screenedTitle, content: screenedContent };
  }
  async function requestPost(client, keyId, requestId) {
    const { rows: [row] } = await client.query(`SELECT p.*,o.request_hash,o.version,o.updated_at
      FROM ufi_api_posts o LEFT JOIN community_posts p ON p.id=o.post_id WHERE o.key_id=$1 AND o.request_id=$2`, [keyId, requestId]);
    return row;
  }
  async function ownedPost(client, key, id) {
    const { rows: [row] } = await client.query(`SELECT p.*,o.version,o.updated_at
      FROM ufi_api_posts o JOIN community_posts p ON p.id=o.post_id
      WHERE o.key_id=$1 AND p.id=$2 AND p.author_id=$3 AND p.group_id=$4 AND p.source='uficonnect'`, [key.id, id, key.ownerId, GROUP]);
    if (!row) throw failure(404, 'Post not found for this API key.');
    return row;
  }
  async function notify(post, action) { try { await onChanged(post, action); } catch { /* The native write is already committed. */ } }
  async function publish(key, body) {
    identity(key, 'posts:publish');
    const text = textFields(body), media = await mediaFields(body);
    const hash = createHash('sha256').update(JSON.stringify([text.content, text.title || '', media.mediaUrl, media.mediaType])).digest('hex');
    const existing = await withAuthor(key, 'posts:publish', client => requestPost(client, key.id, body.requestId));
    if (existing) {
      if (existing.request_hash !== hash) throw failure(409, 'This requestId was already used for different post content.');
      if (!existing.id) throw failure(410, 'The previously published post was removed. This requestId cannot republish it.');
      return { post: publicPost(existing), replayed: true };
    }
    const screened = await screen({ ...text, ...media });
    const result = await withAuthor(key, 'posts:publish', async (client, author) => {
      const previous = await requestPost(client, key.id, body.requestId);
      if (previous) {
        if (previous.request_hash !== hash) throw failure(409, 'This requestId was already used for different post content.');
        if (!previous.id) throw failure(410, 'The previously published post was removed. This requestId cannot republish it.');
        return { post: publicPost(previous), replayed: true };
      }
      const id = randomUUID();
      const { rows: [row] } = await client.query(`INSERT INTO community_posts
        (id,group_id,author_id,author_name,title,content,source,source_label,media_url,media_type)
        VALUES($1,$2,$3,$4,$5,$6,'uficonnect','UFIConnect',$7,$8) RETURNING *`,
      [id, GROUP, author.id, author.name, screened.title, screened.content, media.mediaUrl, media.mediaType]);
      const { rows: [ownership] } = await client.query(`INSERT INTO ufi_api_posts(key_id,request_id,post_id,request_hash)
        VALUES($1,$2,$3,$4) RETURNING version,updated_at`, [key.id, body.requestId, id, hash]);
      return { post: publicPost({ ...row, ...ownership }) };
    });
    if (!result.replayed) await notify(result.post, 'published');
    return result;
  }
  async function get(key, id) {
    if (typeof id !== 'string' || !UUID.test(id)) throw failure(400, 'Invalid API post reference.');
    return withAuthor(key, 'feed:read', async client => ({ post: publicPost(await ownedPost(client, key, id)) }));
  }
  async function edit(key, id, body) {
    if (typeof id !== 'string' || !UUID.test(id)) throw failure(400, 'Invalid API post reference.');
    const text = textFields(body, true);
    const previous = await withAuthor(key, 'posts:edit', client => ownedPost(client, key, id));
    if (previous.version !== body.expectedVersion) throw failure(409, 'The post has changed. Read its latest version before editing.');
    const screened = await screen({ content: text.content, title: text.title === undefined ? previous.title : text.title,
      mediaUrl: previous.media_url, mediaType: previous.media_type });
    const result = await withAuthor(key, 'posts:edit', async client => {
      const latest = await ownedPost(client, key, id);
      if (latest.version !== body.expectedVersion) throw failure(409, 'The post has changed. Read its latest version before editing.');
      // Native website/app edits use the same row and advance the version via
      // the trigger. Compare the screened snapshot as well, so a concurrent
      // native update between this read and UPDATE cannot be overwritten.
      const { rows: [row] } = await client.query(`UPDATE community_posts SET content=$2,title=$3
        WHERE id=$1 AND author_id=$4 AND group_id=$5 AND source='uficonnect'
          AND content IS NOT DISTINCT FROM $6 AND title IS NOT DISTINCT FROM $7
          AND media_url IS NOT DISTINCT FROM $8 AND media_type IS NOT DISTINCT FROM $9 RETURNING *`,
      [id, screened.content, screened.title, key.ownerId, GROUP, previous.content, previous.title, previous.media_url, previous.media_type]);
      if (!row) throw failure(409, 'The post has changed. Read its latest version before editing.');
      const { rows: [ownership] } = await client.query('SELECT version,updated_at FROM ufi_api_posts WHERE key_id=$1 AND post_id=$2', [key.id, id]);
      return { post: publicPost({ ...row, ...ownership }) };
    });
    await notify(result.post, 'edited');
    return result;
  }
  return { publish, get, edit };
}

function registerAPIPostRoutes(app, { apiKeys, ...options }) {
  const service = createAPIPosts(options);
  const route = action => async (req, res) => {
    try { const result = await action(req); res.status(req.method === 'POST' && !result.replayed ? 201 : 200).json(result); }
    catch (error) { res.status(error.status || 503).json({ error: error.publicMessage || 'Post services are temporarily unavailable.' }); }
  };
  const protect = scope => [apiKeys.privateResponse, apiKeys.requestLimit, apiKeys.authenticate(scope)];
  app.post('/api/v1/posts', ...protect('posts:publish'), route(req => service.publish(req.ufiApiKey, req.body)));
  app.get('/api/v1/posts/:id', ...protect('feed:read'), route(req => service.get(req.ufiApiKey, req.params.id)));
  app.patch('/api/v1/posts/:id', ...protect('posts:edit'), route(req => service.edit(req.ufiApiKey, req.params.id, req.body)));
  return service;
}

module.exports = { API_POSTS_SCHEMA, API_POSTS_VERSION_SCHEMA, createAPIPosts, registerAPIPostRoutes };
