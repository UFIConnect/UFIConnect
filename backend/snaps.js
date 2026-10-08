'use strict';

const { randomUUID } = require('node:crypto');
const sourceCatalog = require('../shared/feed-source-catalog.json');
const SNAP_LIFETIME_MS = 24 * 60 * 60 * 1000;
const SNAP_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS community_snaps (
    id TEXT PRIMARY KEY,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    caption TEXT NOT NULL DEFAULT '' CHECK (length(caption) <= 500),
    media_url TEXT NOT NULL, media_type TEXT NOT NULL CHECK (media_type IN ('image','video')),
    thumbnail_url TEXT NOT NULL, public_id TEXT NOT NULL UNIQUE,
    media_bytes INTEGER NOT NULL CHECK (media_bytes > 0),
    video_duration_seconds DOUBLE PRECISION CHECK (video_duration_seconds > 0 AND video_duration_seconds <= 60),
    visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','followers')),
    created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ, media_cleaned_at TIMESTAMPTZ,
    CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '24 hours'))`,
  `CREATE INDEX IF NOT EXISTS community_snaps_active ON community_snaps(expires_at,created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS community_snaps_author ON community_snaps(author_id,created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS snap_media_cleanup (
    public_id TEXT PRIMARY KEY, media_type TEXT NOT NULL CHECK (media_type IN ('image','video')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
];
const failure = (status, message) => Object.assign(new Error(message), { status });
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

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
        || Object.keys(body).some(key => !['caption', 'mediaUrl', 'mediaType', 'visibility', 'upload'].includes(key))
        || (body.caption != null && typeof body.caption !== 'string')
        || !['public', 'followers'].includes(body.visibility || 'public')) {
      throw failure(400, 'Choose a photo or video, caption, and Snap audience.');
    }
    const caption = (body.caption || '').trim();
    if (caption.length > 500) throw failure(400, 'Keep the Snap caption under 500 characters.');
    if (body.mediaType === 'video' && !caption) throw failure(400, 'Add a caption to your video Snap.');
    const user = await getUser(userId);
    if (!user) throw failure(401, 'Sign in again to post a Snap.');
    const media = await validateUpload(userId, body);
    const screening = await screenMemberContent({ content: caption, mediaUrl: media.mediaUrl,
      mediaType: media.mediaType, kind: 'snap', maxLength: 500 });
    if (!screening.allowed) throw failure(screening.reason === 'screening_unavailable' ? 503 : 422,
      screening.reason === 'screening_unavailable' ? 'Snap screening is temporarily unavailable. Please try again.' : 'This Snap cannot be published.');
    const createdTime = now();
    const createdAt = new Date(createdTime).toISOString();
    const expiresAt = new Date(createdTime + SNAP_LIFETIME_MS).toISOString();
    const { rows } = await query(`INSERT INTO community_snaps
      (id,author_id,caption,media_url,media_type,thumbnail_url,public_id,media_bytes,video_duration_seconds,visibility,created_at,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (public_id) DO NOTHING RETURNING *`,
    [`snap_${uuid()}`, userId, screening.content, media.mediaUrl, media.mediaType, media.thumbnailUrl,
      media.publicId, media.bytes, media.duration, body.visibility || 'public', createdAt, expiresAt]);
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
  let cleaning = null;
  async function cleanupBatch() {
    available();
    if (typeof removeMedia !== 'function') throw failure(503, 'Snap media cleanup is unavailable.');
    const timestamp = new Date(now()).toISOString();
    const { rows } = await query(`SELECT id,public_id,media_type FROM community_snaps
      WHERE (expires_at <= $1::timestamptz OR deleted_at IS NOT NULL) AND media_cleaned_at IS NULL
      ORDER BY expires_at,id LIMIT 25`, [timestamp]);
    let cleaned = 0, retrying = 0;
    for (const row of rows) {
      try {
        await removeMedia(row.public_id, row.media_type);
        await query(`UPDATE community_snaps SET media_cleaned_at=$2::timestamptz,caption='',media_url='',thumbnail_url=''
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
  return { list, create, remove, cleanup };
}
function registerSnapRoutes(app, { service, authenticate, authenticateOptional, limiter, loadExternalSnaps = async () => ({ snaps: [], sourceErrors: {} }) }) {
  const respond = (work, status = 200) => async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try { res.status(status).json(await work(req)); }
    catch (error) { res.status(error.status || 503).json({ message: error.status ? error.message : 'Snaps are temporarily unavailable. Please try again.' }); }
  };
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

module.exports = { SNAP_SCHEMA, SNAP_LIFETIME_MS, snapMode, snapSource, snapFromRow, createSnaps, registerSnapRoutes };
