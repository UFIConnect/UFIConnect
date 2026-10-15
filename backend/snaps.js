'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { cleanScreeningText } = require('./content-screening');
const sourceCatalog = require('../shared/feed-source-catalog.json');
const SNAP_LIFETIME_MS = 24 * 60 * 60 * 1000;
const SNAP_FILTERS = Object.freeze(['original', 'vivid', 'warm', 'cool', 'mono']);
const SNAP_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS community_snaps (
    id TEXT PRIMARY KEY,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    caption TEXT NOT NULL DEFAULT '' CHECK (length(caption) <= 500),
    filter TEXT NOT NULL DEFAULT 'original' CHECK (filter IN ('original','vivid','warm','cool','mono')),
    text_overlay TEXT NOT NULL DEFAULT '' CHECK (length(text_overlay) <= 80),
    media_url TEXT NOT NULL, media_type TEXT NOT NULL CHECK (media_type IN ('image','video')),
    thumbnail_url TEXT NOT NULL, public_id TEXT NOT NULL UNIQUE,
    media_bytes INTEGER NOT NULL CHECK (media_bytes > 0),
    video_duration_seconds DOUBLE PRECISION CHECK (video_duration_seconds > 0 AND video_duration_seconds <= 60),
    visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','followers')),
    created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ, media_cleaned_at TIMESTAMPTZ,
    CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '24 hours'))`,
  `ALTER TABLE community_snaps ADD COLUMN IF NOT EXISTS filter TEXT NOT NULL DEFAULT 'original'
    CHECK (filter IN ('original','vivid','warm','cool','mono'))`,
  `ALTER TABLE community_snaps ADD COLUMN IF NOT EXISTS text_overlay TEXT NOT NULL DEFAULT ''
    CHECK (length(text_overlay) <= 80)`,
  `CREATE INDEX IF NOT EXISTS community_snaps_active ON community_snaps(expires_at,created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS community_snaps_author ON community_snaps(author_id,created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS snap_media_cleanup (
    public_id TEXT PRIMARY KEY, media_type TEXT NOT NULL CHECK (media_type IN ('image','video')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS snap_likes (
    snap_id TEXT NOT NULL REFERENCES community_snaps(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(snap_id,user_id))`,
  `CREATE TABLE IF NOT EXISTS snap_comments (
    id UUID PRIMARY KEY, snap_id TEXT NOT NULL REFERENCES community_snaps(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id UUID NOT NULL, request_hash TEXT NOT NULL,
    content TEXT NOT NULL CHECK(length(content) > 0 AND length(content) <= 1000),
    created_at TIMESTAMPTZ NOT NULL, UNIQUE(author_id,request_id))`,
  `CREATE INDEX IF NOT EXISTS snap_comments_page ON snap_comments(snap_id,created_at,id)`,
];
const failure = (status, message) => Object.assign(new Error(message), { status });
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// Every read and write resolves the current ephemeral audience in PostgreSQL.
// $1 = Snap ID, $2 = viewer, $3 = current time. Never authorize from a client
// snapshot or the feed cache, which can outlive expiry or a block.
const visibleSnapSql = `SELECT s.* FROM community_snaps s JOIN users u ON u.id=s.author_id
  WHERE s.id=$1 AND s.expires_at>$3::timestamptz AND s.deleted_at IS NULL AND s.media_cleaned_at IS NULL
  AND (s.visibility='public' OR s.author_id=$2::uuid OR EXISTS (
    SELECT 1 FROM follows f WHERE f.follower_id=$2::text AND f.following_id=s.author_id::text))
  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=$2::text AND b.blocked_id=s.author_id::text)
    OR (b.blocked_id=$2::text AND b.blocker_id=s.author_id::text))
  AND ((u.profile_hidden IS NOT TRUE AND COALESCE(u.role_settings->>'privacy_publicProfile','true')<>'false')
    OR s.author_id=$2::uuid OR EXISTS (SELECT 1 FROM follows f WHERE
      (f.follower_id=$2::text AND f.following_id=s.author_id::text)
      OR (f.following_id=$2::text AND f.follower_id=s.author_id::text))
    OR EXISTS (SELECT 1 FROM connections c WHERE c.status='accepted' AND
      ((c.from_id=$2::text AND c.to_id=s.author_id::text) OR (c.to_id=$2::text AND c.from_id=s.author_id::text))))
  AND NOT EXISTS (SELECT 1 FROM report_content_suppressions r WHERE r.target_type='post' AND r.target_id=s.id)`;
const visibleCommentSql = `NOT EXISTS (SELECT 1 FROM blocks b WHERE
  (b.blocker_id=$2::text AND b.blocked_id=c.author_id::text)
  OR (b.blocked_id=$2::text AND b.blocker_id=c.author_id::text))
  AND NOT EXISTS (SELECT 1 FROM report_content_suppressions r WHERE r.target_type='comment' AND r.target_id=c.id::text)`;
function commentFromRow(row) {
  return { id: row.id, author: { id: row.author_id, name: row.author_name || 'Member' },
    content: row.content, createdAt: new Date(row.created_at).toISOString() };
}

function snapMode(value) {
  if (value == null || value === 'home') return 'home';
  if (['following', 'ufi'].includes(value)) return value;
  throw failure(400, 'Choose Home, Following, or UFI Snaps.');
}
function snapSource(value, mode) {
  if (value == null) return null;
  const allowed = mode === 'ufi' ? [] : mode === 'following'
    ? Object.entries(sourceCatalog.following).filter(([, capability]) => capability === 'following').map(([source]) => source)
    : sourceCatalog.home;
  const supported = mode === 'home' ? allowed : ['uficonnect', ...allowed];
  if (typeof value !== 'string' || !supported.includes(value)) {
    throw failure(400, 'Choose a supported Snap source.');
  }
  return value;
}
function snapFromRow(row, viewerId) {
  return { id: row.id, source: 'uficonnect', sourceLabel: 'UFIConnect',
    author: { id: row.author_id, name: row.author_name || 'Member', avatarUrl: row.author_avatar || '',
      profileUrl: `/u/${encodeURIComponent(row.author_id)}` },
    mediaUrl: row.media_url, mediaType: row.media_type, thumbnailUrl: row.thumbnail_url,
    caption: row.caption, visibility: row.visibility,
    filter: SNAP_FILTERS.includes(row.filter) ? row.filter : 'original',
    overlayText: typeof row.text_overlay === 'string' ? row.text_overlay : '',
    createdAt: new Date(row.created_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString(),
    owned: row.author_id === viewerId, isExternal: false };
}
function createSnaps({ db, getUser, validateUpload, removeMedia, screenMemberContent, now = Date.now, uuid = randomUUID } = {}) {
  function available() {
    if (!db.isConnected()) throw failure(503, 'Snaps are temporarily unavailable. Please try again.');
  }
  async function query(sql, values) {
    available();
    try { return await db.query(sql, values); }
    catch { throw failure(503, 'Snaps could not be saved or loaded. Please try again.'); }
  }
  async function list({ viewerId = null, mode = 'home', limit = 100 } = {}) {
    mode = snapMode(mode);
    if (viewerId != null && !uuidPattern.test(viewerId)) throw failure(401, 'Sign in again to view your Snaps.');
    if (mode === 'following' && !viewerId) throw failure(401, 'Sign in to view Following Snaps.');
    if (mode === 'home') return [];
    const boundedLimit = Math.max(1, Math.min(200, Number.parseInt(limit, 10) || 100));
    // Resolve audience, block and hidden-profile rules from persistent records,
    // so another API worker cannot serve a stale follower or blocked author.
    const { rows } = await query(`SELECT s.*,u.name AS author_name,u.avatar_url AS author_avatar
      FROM community_snaps s JOIN users u ON u.id=s.author_id
      WHERE s.expires_at > $1::timestamptz AND s.deleted_at IS NULL AND s.media_cleaned_at IS NULL
      AND (s.visibility='public' OR s.author_id=$2::uuid OR EXISTS (
        SELECT 1 FROM follows f WHERE f.follower_id=$2::text AND f.following_id=s.author_id::text))
      AND ($3::text <> 'following' OR s.author_id=$2::uuid OR EXISTS (
        SELECT 1 FROM follows f WHERE f.follower_id=$2::text AND f.following_id=s.author_id::text))
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=$2::text AND b.blocked_id=s.author_id::text)
        OR (b.blocked_id=$2::text AND b.blocker_id=s.author_id::text))
      AND ((u.profile_hidden IS NOT TRUE AND COALESCE(u.role_settings->>'privacy_publicProfile','true') <> 'false')
        OR s.author_id=$2::uuid OR EXISTS (SELECT 1 FROM follows f WHERE
          (f.follower_id=$2::text AND f.following_id=s.author_id::text)
          OR (f.following_id=$2::text AND f.follower_id=s.author_id::text))
        OR EXISTS (SELECT 1 FROM connections c WHERE c.status='accepted' AND
          ((c.from_id=$2::text AND c.to_id=s.author_id::text) OR (c.to_id=$2::text AND c.from_id=s.author_id::text))))
      AND NOT EXISTS (SELECT 1 FROM report_content_suppressions r WHERE r.target_type='post' AND r.target_id=s.id)
      ORDER BY s.created_at DESC,s.id LIMIT $4`, [new Date(now()).toISOString(), viewerId, mode, boundedLimit]);
    return rows.map(row => snapFromRow(row, viewerId));
  }
  async function create(userId, body = {}) {
    if (!uuidPattern.test(userId || '')) throw failure(401, 'Sign in to post a Snap.');
    available();
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some(key => !['caption', 'mediaUrl', 'mediaType', 'visibility', 'upload', 'filter', 'overlayText'].includes(key))
        || (body.caption != null && typeof body.caption !== 'string')
        || (body.filter != null && !SNAP_FILTERS.includes(body.filter))
        || (body.overlayText != null && typeof body.overlayText !== 'string')
        || !['public', 'followers'].includes(body.visibility || 'public')) {
      throw failure(400, 'Choose a photo or video, caption, and Snap audience.');
    }
    const rawCaption = (body.caption || '').trim(), rawOverlay = (body.overlayText || '').trim();
    const caption = cleanScreeningText(rawCaption), overlayText = cleanScreeningText(rawOverlay);
    const filter = body.filter ?? 'original';
    if (rawCaption.length > 500 || caption.length > 500) throw failure(400, 'Keep the Snap caption under 500 characters.');
    if (rawOverlay.length > 80 || overlayText.length > 80) throw failure(400, 'Keep the Snap overlay under 80 characters.');
    if (body.mediaType === 'video' && !caption) throw failure(400, 'Add a caption to your video Snap.');
    const user = await getUser(userId);
    if (!user) throw failure(401, 'Sign in again to post a Snap.');
    const media = await validateUpload(userId, body);
    // Screen all visible text together with the media. Keeping the boundary a
    // space also prevents prohibited phrases being split across the two fields.
    const content = cleanScreeningText([caption, overlayText].filter(Boolean).join(' '));
    const screening = await screenMemberContent({ content, mediaUrl: media.mediaUrl,
      mediaType: media.mediaType, kind: 'snap', maxLength: 581 });
    if (!screening?.allowed) throw failure(!screening || screening.reason === 'screening_unavailable' ? 503 : 422,
      !screening || screening.reason === 'screening_unavailable' ? 'Snap screening is temporarily unavailable. Please try again.' : 'This Snap cannot be published.');
    // Persist precisely the normalized fields that were reviewed; never guess
    // how to split a transformed or incomplete moderation response.
    if (screening.content !== content) throw failure(503, 'Snap screening is temporarily unavailable. Please try again.');
    const createdTime = now();
    const createdAt = new Date(createdTime).toISOString();
    const expiresAt = new Date(createdTime + SNAP_LIFETIME_MS).toISOString();
    const { rows } = await query(`INSERT INTO community_snaps
      (id,author_id,caption,media_url,media_type,thumbnail_url,public_id,media_bytes,video_duration_seconds,visibility,created_at,expires_at,filter,text_overlay)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (public_id) DO NOTHING RETURNING *`,
    [`snap_${uuid()}`, userId, caption, media.mediaUrl, media.mediaType, media.thumbnailUrl,
      media.publicId, media.bytes, media.duration, body.visibility || 'public', createdAt, expiresAt, filter, overlayText]);
    if (!rows[0]) throw failure(409, 'This upload has already been published as a Snap.');
    return snapFromRow({ ...rows[0], author_name: user.name, author_avatar: user.avatarUrl }, userId);
  }
  async function remove(userId, id) {
    if (!uuidPattern.test(userId || '')) throw failure(401, 'Sign in to remove your Snap.');
    if (typeof id !== 'string' || !/^snap_[a-f0-9-]{36}$/i.test(id)) throw failure(404, 'Snap not found.');
    const { rows } = await query('UPDATE community_snaps SET deleted_at=COALESCE(deleted_at,$3::timestamptz) WHERE id=$1 AND author_id=$2::uuid RETURNING id', [id, userId, new Date(now()).toISOString()]);
    if (!rows.length) throw failure(404, 'Snap not found.');
    return { deleted: true };
  }
  function engagementIdentity(id, viewerId, write = false) {
    if ((write && !viewerId) || (viewerId != null && !uuidPattern.test(viewerId))) throw failure(401, 'Sign in to interact with this Snap.');
    if (typeof id !== 'string' || !/^snap_[a-f0-9-]{36}$/i.test(id)) throw failure(404, 'Snap not found.');
    return [id, viewerId || null, new Date(now()).toISOString()];
  }
  async function engagement(id, viewerId = null) {
    const values = engagementIdentity(id, viewerId);
    const { rows } = await query(`WITH visible AS (${visibleSnapSql})
      SELECT (SELECT COUNT(*)::int FROM snap_likes l WHERE l.snap_id=v.id) AS likes_count,
        EXISTS(SELECT 1 FROM snap_likes l WHERE l.snap_id=v.id AND l.user_id=$2::uuid) AS liked_by_me,
        (SELECT COUNT(*)::int FROM snap_comments c WHERE c.snap_id=v.id AND ${visibleCommentSql}) AS comments_count
      FROM visible v`, values);
    if (!rows[0]) throw failure(404, 'Snap not found or no longer available.');
    return { likesCount: rows[0].likes_count, likedByMe: rows[0].liked_by_me, commentsCount: rows[0].comments_count };
  }
  async function get(id, viewerId = null) {
    const { rows } = await query(`WITH visible AS (${visibleSnapSql})
      SELECT v.*,u.name AS author_name,u.avatar_url AS author_avatar FROM visible v JOIN users u ON u.id=v.author_id`,
    engagementIdentity(id, viewerId));
    if (!rows[0]) throw failure(404, 'Snap not found or no longer available.');
    return snapFromRow(rows[0], viewerId);
  }
  async function like(userId, id, body = {}) {
    const values = engagementIdentity(id, userId, true);
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.liked !== 'boolean'
        || Object.keys(body).some(key => key !== 'liked')) throw failure(400, 'Choose whether to like this Snap.');
    // Setting the desired state is naturally idempotent, including uncertain
    // retries. The authorized Snap selection is part of the mutation itself.
    if (body.liked) await query(`WITH visible AS (${visibleSnapSql})
      INSERT INTO snap_likes(snap_id,user_id,created_at) SELECT id,$2::uuid,$3::timestamptz FROM visible
      ON CONFLICT(snap_id,user_id) DO NOTHING`, values);
    else await query(`WITH visible AS (${visibleSnapSql})
      DELETE FROM snap_likes l USING visible v WHERE l.snap_id=v.id AND l.user_id=$2::uuid`, values);
    return engagement(id, userId);
  }
  async function comments(id, viewerId = null, { offset = 0, limit = 20 } = {}) {
    const values = engagementIdentity(id, viewerId);
    const start = Number(offset), size = Number(limit);
    if (!Number.isSafeInteger(start) || start < 0 || start > 10000 || !Number.isSafeInteger(size) || size < 1 || size > 50) {
      throw failure(400, 'Choose a valid comments page.');
    }
    // A left join keeps unavailable and empty separate without disclosing
    // whether an inaccessible private Snap exists.
    const { rows } = await query(`WITH visible AS (${visibleSnapSql}), eligible AS (
      SELECT c.*,u.name AS author_name FROM snap_comments c JOIN users u ON u.id=c.author_id
      JOIN visible v ON v.id=c.snap_id WHERE ${visibleCommentSql}
    ), page AS (SELECT * FROM eligible ORDER BY created_at,id LIMIT $4 OFFSET $5)
      SELECT p.*, (SELECT COUNT(*)::int FROM eligible) AS comments_count
      FROM visible v LEFT JOIN page p ON true ORDER BY p.created_at,p.id`, [...values, size + 1, start]);
    if (!rows.length) throw failure(404, 'Snap not found or no longer available.');
    const page = rows.filter(row => row.id);
    return { comments: page.slice(0, size).map(commentFromRow), commentsCount: rows[0].comments_count,
      hasMore: page.length > size, live: true, source: 'uficonnect' };
  }
  async function comment(userId, id, body = {}) {
    const values = engagementIdentity(id, userId, true);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['content', 'requestId'].includes(key))
        || typeof body.content !== 'string' || !body.content.trim() || body.content.trim().length > 1000
        || !uuidPattern.test(body.requestId || '')) throw failure(400, 'Add a comment under 1,001 characters and a valid request ID.');
    const content = body.content.trim(), hash = createHash('sha256').update(content).digest('hex');
    const requestId = body.requestId.toLowerCase();
    async function existing() {
      const { rows } = await query(`WITH visible AS (${visibleSnapSql})
        SELECT c.*,u.name AS author_name FROM snap_comments c JOIN users u ON u.id=c.author_id
        WHERE c.author_id=$2::uuid AND c.request_id=$4::uuid AND EXISTS(SELECT 1 FROM visible)
          AND ${visibleCommentSql}`,
      [id, userId, new Date(now()).toISOString(), requestId]);
      const row = rows[0];
      if (!row) return null;
      if (row.snap_id !== id || row.request_hash !== hash) throw failure(409, 'This comment request was already used. Start a new comment.');
      return row;
    }
    await engagement(id, userId);
    let row = await existing();
    if (!row) {
      const screening = await screenMemberContent({ content, kind: 'comment', maxLength: 1000 });
      if (!screening?.allowed) throw failure(screening?.reason === 'screening_unavailable' ? 503 : 422,
        screening?.reason === 'screening_unavailable' ? 'Comment screening is temporarily unavailable. Please try again.' : 'This comment cannot be published.');
      // Recheck audience/expiry after asynchronous screening. A concurrent
      // duplicate waits on the database uniqueness constraint, then reads the
      // confirmed row in a fresh statement rather than reporting two writes.
      await query(`WITH visible AS (${visibleSnapSql})
        INSERT INTO snap_comments(id,snap_id,author_id,request_id,request_hash,content,created_at)
        SELECT $4::uuid,id,$2::uuid,$5::uuid,$6,$7,$3::timestamptz FROM visible
        ON CONFLICT(author_id,request_id) DO NOTHING`,
      [values[0], values[1], new Date(now()).toISOString(), uuid(), requestId, hash, screening.content]);
      row = await existing();
      if (!row) throw failure(404, 'Snap not found or no longer available.');
    }
    const state = await engagement(id, userId);
    return { comment: commentFromRow(row), commentsCount: state.commentsCount, published: true };
  }
  let cleaning = null;
  async function cleanupBatch() {
    available();
    if (typeof removeMedia !== 'function') throw failure(503, 'Snap media cleanup is unavailable.');
    const timestamp = new Date(now()).toISOString();
    // Comments and reactions share the Snap's lifetime even if its media
    // deletion must retry or the upload-reuse tombstone remains for a week.
    for (const table of ['snap_comments', 'snap_likes']) await query(`DELETE FROM ${table} e
      USING community_snaps s WHERE e.snap_id=s.id AND (s.expires_at <= $1::timestamptz OR s.deleted_at IS NOT NULL)`, [timestamp]);
    await query(`UPDATE community_snaps SET text_overlay='',filter='original'
      WHERE (expires_at <= $1::timestamptz OR deleted_at IS NOT NULL)
      AND (text_overlay<>'' OR filter<>'original')`, [timestamp]);
    const { rows } = await query(`SELECT id,public_id,media_type FROM community_snaps
      WHERE (expires_at <= $1::timestamptz OR deleted_at IS NOT NULL) AND media_cleaned_at IS NULL
      ORDER BY expires_at,id LIMIT 25`, [timestamp]);
    let cleaned = 0, retrying = 0;
    for (const row of rows) {
      try {
        await removeMedia(row.public_id, row.media_type);
        await query(`UPDATE community_snaps SET media_cleaned_at=$2::timestamptz,caption='',text_overlay='',filter='original',media_url='',thumbnail_url=''
          WHERE id=$1 AND media_cleaned_at IS NULL`, [row.id, timestamp]);
        cleaned++;
      } catch { retrying++; }
    }
    // Keep a short tombstone with the unique asset ID so an in-flight create
    // cannot republish a just-removed asset after its metadata was verified.
    await query('DELETE FROM community_snaps WHERE media_cleaned_at < $1::timestamptz', [new Date(now() - 7 * SNAP_LIFETIME_MS).toISOString()]);
    const queued = await query('SELECT public_id,media_type FROM snap_media_cleanup ORDER BY requested_at,public_id LIMIT 25', []);
    for (const row of queued.rows) {
      try {
        await removeMedia(row.public_id, row.media_type);
        await query('DELETE FROM snap_media_cleanup WHERE public_id=$1', [row.public_id]);
        cleaned++;
      } catch { retrying++; }
    }
    return { cleaned, retrying };
  }
  function cleanup() {
    if (!cleaning) cleaning = cleanupBatch().finally(() => { cleaning = null; });
    return cleaning;
  }
  return { list, get, create, remove, cleanup, engagement, like, comments, comment };
}
function registerSnapRoutes(app, { service, authenticate, authenticateOptional, limiter, loadExternalSnaps = async () => ({ snaps: [], sourceErrors: {} }) }) {
  const respond = (work, status = 200) => async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try { res.status(status).json(await work(req)); }
    catch (error) { res.status(error.status || 503).json({ message: error.status ? error.message : 'Snaps are temporarily unavailable. Please try again.' }); }
  };
  app.get('/snaps/:id/engagement', authenticateOptional, respond(req => service.engagement(req.params.id, req.user?.id || null)));
  app.get('/snaps/:id', authenticateOptional, respond(async req => ({ snap: await service.get(req.params.id, req.user?.id || null) })));
  app.get('/snaps/:id/comments', authenticateOptional, respond(req => service.comments(req.params.id, req.user?.id || null,
    { offset: req.query.offset ?? 0, limit: req.query.limit ?? 20 })));
  app.post('/snaps/:id/like', authenticate, limiter, respond(req => service.like(req.user.id, req.params.id, req.body)));
  app.post('/snaps/:id/comments', authenticate, limiter, respond(req => service.comment(req.user.id, req.params.id, req.body), 201));
  app.get('/snaps', authenticateOptional, respond(async req => {
    const mode = snapMode(req.query.mode), viewerId = req.user?.id || null;
    if (mode === 'following' && !viewerId) throw failure(401, 'Sign in to view Following Snaps.');
    const source = snapSource(req.query.source, mode);
    const native = mode !== 'home' && (!source || source === 'uficonnect') ? await service.list({ mode, viewerId }) : [];
    let external = { snaps: [], sourceErrors: {} };
    if (mode !== 'ufi' && source !== 'uficonnect') {
      try { external = await loadExternalSnaps({ mode, viewerId, source, bust: req.query.bust === '1' }); }
      catch { external.sourceErrors = { [source || 'sources']: 'Source Snaps are temporarily unavailable. Refresh to try again.' }; }
    }
    const errors = external?.sourceErrors || {};
    const sourceErrors = source ? { ...(errors[source] ? { [source]: errors[source] } : {}),
      ...(errors.sources ? { [source]: errors.sources } : {}) } : errors;
    return { snaps: [...native, ...(Array.isArray(external?.snaps) ? external.snaps : [])]
      .filter(snap => (!source || snap.source === source)
        && (mode !== 'home' || (snap.isExternal === true && sourceCatalog.home.includes(snap.source)))), sourceErrors };
  }));
  app.post('/snaps', authenticate, limiter, respond(async req => ({ snap: await service.create(req.user.id, req.body) }), 201));
  app.delete('/snaps/:id', authenticate, limiter, respond(req => service.remove(req.user.id, req.params.id)));
}

module.exports = { SNAP_SCHEMA, SNAP_LIFETIME_MS, SNAP_FILTERS, snapMode, snapSource, snapFromRow, createSnaps, registerSnapRoutes };
