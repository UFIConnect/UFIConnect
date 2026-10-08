'use strict';

const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');
const cloudinary = require('cloudinary').v2;
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { withActiveMembers } = require('./member-write');

const MESSAGE_FOLDER = 'uficonnect-messages';
const MESSAGE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const MESSAGE_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const MESSAGE_DOWNLOAD_TTL_SECONDS = 60;
const IMAGE_FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const VIDEO_FORMATS = new Set(['mp4', 'webm', 'mov']);
const MIME_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
const failure = (status, message) => Object.assign(new Error(message), { status });
const ownerKey = userId => createHash('sha256').update(String(userId)).digest('hex');
const ownPrefix = userId => `${MESSAGE_FOLDER}/message-${ownerKey(userId)}-`;
const ownedMessageId = publicId => typeof publicId === 'string'
  && /^uficonnect-messages\/message-[a-f0-9]{64}-[a-f0-9-]{36}$/.test(publicId);
const MESSAGE_MEDIA_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS message_media_uploads (
    public_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS message_media_owner_idx ON message_media_uploads(owner_id)`,
  `CREATE TABLE IF NOT EXISTS message_media_cleanup (
    public_id TEXT NOT NULL, media_type TEXT NOT NULL CHECK(media_type IN ('image','video','raw')),
    attempts INTEGER NOT NULL DEFAULT 0, available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retire_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(public_id,media_type))`,
  `ALTER TABLE message_media_cleanup ADD COLUMN IF NOT EXISTS retire_after TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  `ALTER TABLE message_media_cleanup DROP CONSTRAINT IF EXISTS message_media_cleanup_media_type_check`,
  `ALTER TABLE message_media_cleanup ADD CONSTRAINT message_media_cleanup_media_type_check CHECK(media_type IN ('image','video','raw'))`,
];

async function queueMessageAccountMedia(client, userId) {
  const { rows: messages } = await client.query('SELECT attachment, sender_id FROM direct_messages WHERE sender_id=$1 AND attachment IS NOT NULL', [userId]);
  const { rows: intents } = await client.query('SELECT public_id,created_at FROM message_media_uploads WHERE owner_id=$1', [userId]);
  const queued = new Map();
  for (const row of messages) {
    const attachment = storedMessageAttachment(row.attachment, row.sender_id);
    if (attachment) queued.set(`${attachment.type}:${attachment.publicId}`, { ...attachment, retireAfter: new Date().toISOString() });
  }
  for (const row of intents) {
    if (!ownedMessageId(row.public_id) || !row.public_id.startsWith(ownPrefix(userId))) continue;
    // A signed direct upload is valid for an hour. Delete immediately, then
    // revisit the owned identity until that grant and any in-flight upload end.
    const retireAfter = new Date(Math.max(Date.now(), Date.parse(row.created_at) + 2 * 60 * 60 * 1000)).toISOString();
    // Cloudinary excludes resource_type from upload signatures; keep cleanup
    // coverage for raw replays while messages themselves permit only media.
    for (const type of ['image', 'video', 'raw']) queued.set(`${type}:${row.public_id}`, { publicId: row.public_id, type, retireAfter });
  }
  if (queued.size) {
    const values = [...queued.values()];
    await client.query(`INSERT INTO message_media_cleanup(public_id,media_type,retire_after)
      SELECT * FROM unnest($1::text[],$2::text[],$3::timestamptz[])
      ON CONFLICT(public_id,media_type) DO UPDATE SET retire_after=GREATEST(message_media_cleanup.retire_after,excluded.retire_after),
        available_at=LEAST(message_media_cleanup.available_at,NOW())`,
      [values.map(item => item.publicId), values.map(item => item.type), values.map(item => item.retireAfter)]);
  }
  await client.query('DELETE FROM message_media_uploads WHERE owner_id=$1', [userId]);
}

function storedMessageAttachment(attachment, senderId) {
  if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)
      || !['image', 'video'].includes(attachment.type) || attachment.deliveryType !== 'authenticated'
      || typeof attachment.publicId !== 'string' || attachment.publicId.length > 200
      || !attachment.publicId.startsWith(ownPrefix(senderId))
      || !/^[a-f0-9-]{36}$/.test(attachment.publicId.slice(ownPrefix(senderId).length))
      || !Number.isSafeInteger(attachment.version) || attachment.version < 1
      || !(attachment.type === 'image' ? IMAGE_FORMATS : VIDEO_FORMATS).has(attachment.format)
      || !Number.isSafeInteger(attachment.bytes) || attachment.bytes <= 0
      || attachment.bytes > (attachment.type === 'image' ? MESSAGE_IMAGE_MAX_BYTES : MESSAGE_VIDEO_MAX_BYTES)) return null;
  return { type: attachment.type, deliveryType: 'authenticated', publicId: attachment.publicId,
    version: attachment.version, format: attachment.format, bytes: attachment.bytes };
}

// URLs and upload proofs never enter a conversation response. Access to a
// private asset is granted by the attachment route after checking both members.
function legacyMessageAttachment(attachment, cloudName = process.env.CLOUDINARY_CLOUD_NAME) {
  if (!attachment || !['image', 'video'].includes(attachment.type) || typeof attachment.url !== 'string'
      || attachment.url.length > 1000 || !/^[a-zA-Z0-9_-]+$/.test(String(cloudName || ''))) return null;
  try {
    const url = new URL(attachment.url);
    const format = url.pathname.split('.').at(-1).toLowerCase();
    return url.protocol === 'https:' && url.hostname === 'res.cloudinary.com' && !url.port && !url.username && !url.password
      && !url.search && !url.hash && url.pathname.startsWith(`/${cloudName}/${attachment.type}/upload/`)
      && url.pathname.includes(`/${MESSAGE_FOLDER}/`)
      && (attachment.type === 'image' ? IMAGE_FORMATS : VIDEO_FORMATS).has(format)
      ? { url: url.href, type: attachment.type, legacy: true } : null;
  } catch { return null; }
}

function publicMessage(message, otherId, cloudName) {
  const safe = { id: message.id, senderId: message.senderId, content: typeof message.content === 'string' ? message.content : '',
    createdAt: message.createdAt, read: !!message.read, attachment: null };
  if (message.attachment) {
    const attachment = storedMessageAttachment(message.attachment, message.senderId);
    safe.attachment = attachment ? { type: attachment.type, bytes: attachment.bytes,
      accessPath: `/messages/${encodeURIComponent(otherId)}/attachments/${encodeURIComponent(message.id)}` }
      : legacyMessageAttachment(message.attachment, cloudName) || { unavailable: true };
  }
  return safe;
}

function createMessageMedia({ env = process.env, api = cloudinary.api, utils = cloudinary.utils, uploader = cloudinary.uploader,
  now = Date.now, uuid = randomUUID, fetchImpl = fetch } = {}) {
  function config() {
    const cloudName = String(env.CLOUDINARY_CLOUD_NAME || '').trim();
    const apiKey = String(env.CLOUDINARY_API_KEY || '').trim();
    const apiSecret = String(env.CLOUDINARY_API_SECRET || '');
    if (!/^[a-zA-Z0-9_-]+$/.test(cloudName) || !apiKey || !apiSecret) {
      throw failure(503, 'Message uploads are not configured yet.');
    }
    return { cloudName, apiKey, apiSecret };
  }
  function signature(userId) {
    if (!userId) throw failure(401, 'Sign in to attach media.');
    const { cloudName, apiKey, apiSecret } = config();
    const timestamp = Math.floor(now() / 1000);
    const publicId = `message-${ownerKey(userId)}-${uuid()}`;
    const signed = `folder=${MESSAGE_FOLDER}&overwrite=false&public_id=${publicId}&timestamp=${timestamp}&type=authenticated`;
    return { cloudName, apiKey, timestamp, folder: MESSAGE_FOLDER, publicId,
      deliveryType: 'authenticated', overwrite: false,
      signature: createHash('sha1').update(signed + apiSecret).digest('hex') };
  }
  async function recordUploadIntent(db, userId, signed) {
    const publicId = `${signed.folder}/${signed.publicId}`;
    if (!ownedMessageId(publicId) || !publicId.startsWith(ownPrefix(userId))) throw failure(400, 'Invalid attachment upload.');
    await withActiveMembers(db, [userId], async client => {
      await client.query('INSERT INTO message_media_uploads(public_id,owner_id) VALUES($1,$2)', [publicId, userId]);
    });
  }
  async function validate(userId, attachment) {
    const { cloudName, apiKey, apiSecret } = config();
    const proof = attachment?.upload;
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)
        || !['image', 'video'].includes(attachment.type) || !proof || typeof proof !== 'object' || Array.isArray(proof)
        || typeof proof.publicId !== 'string' || proof.publicId.length > 200 || !proof.publicId.startsWith(ownPrefix(userId))
        || !/^[a-f0-9-]{36}$/.test(proof.publicId.slice(ownPrefix(userId).length))
        || !/^\d{1,15}$/.test(String(proof.version)) || Number(proof.version) < 1
        || typeof proof.signature !== 'string' || !/^[a-f0-9]{40}$/.test(proof.signature)) {
      throw failure(400, 'Upload a supported photo or video through UFIConnect before attaching it.');
    }
    const expected = createHash('sha1').update(`public_id=${proof.publicId}&version=${proof.version}${apiSecret}`).digest();
    if (!timingSafeEqual(expected, Buffer.from(proof.signature, 'hex'))) {
      throw failure(400, 'This attachment could not be verified. Upload it again.');
    }
    let asset;
    try {
      asset = await api.resource(proof.publicId, { cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret,
        resource_type: attachment.type, type: 'authenticated', timeout: 10000 });
    } catch { throw failure(503, 'Attachment verification is temporarily unavailable. Try again.'); }
    let url;
    try { url = new URL(asset?.secure_url); } catch { /* checked below */ }
    const candidate = { type: asset?.resource_type, deliveryType: asset?.type, publicId: asset?.public_id,
      version: Number(asset?.version), format: String(asset?.format || '').toLowerCase(), bytes: asset?.bytes };
    const stored = storedMessageAttachment(candidate, userId);
    if (!stored || asset.public_id !== proof.publicId || String(asset.version) !== String(proof.version)
        || asset.resource_type !== attachment.type || !url || url.protocol !== 'https:'
        || url.hostname !== 'res.cloudinary.com' || url.port || url.username || url.password
        || !url.pathname.startsWith(`/${cloudName}/${attachment.type}/authenticated/`)
        || url.search || url.hash || attachment.url !== asset.secure_url) {
      throw failure(400, 'Choose a supported private attachment uploaded through UFIConnect.');
    }
    return stored;
  }
  function download(attachment, senderId) {
    const stored = storedMessageAttachment(attachment, senderId);
    if (!stored) throw failure(404, 'This attachment is not available.');
    const { cloudName, apiKey, apiSecret } = config();
    const expiresAt = Math.floor(now() / 1000) + MESSAGE_DOWNLOAD_TTL_SECONDS;
    const url = utils.private_download_url(stored.publicId, stored.format, {
      cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true,
      type: 'authenticated', resource_type: stored.type, expires_at: expiresAt, attachment: false,
    });
    return { url, type: stored.type, expiresAt: new Date(expiresAt * 1000).toISOString() };
  }
  async function proxy(attachment, senderId, res) {
    const stored = storedMessageAttachment(attachment, senderId);
    if (!stored) throw failure(404, 'This attachment is not available.');
    const { cloudName } = config();
    const closed = new AbortController();
    const signal = AbortSignal.any([closed.signal, AbortSignal.timeout(10000)]);
    const onClose = () => closed.abort();
    res.on('close', onClose);
    let upstream;
    try {
      let url = new URL(download(stored, senderId).url);
      if (url.protocol !== 'https:' || url.hostname !== 'api.cloudinary.com' || url.port || url.username || url.password
          || url.pathname !== `/v1_1/${cloudName}/${stored.type}/download`) throw failure(503, 'Attachment delivery is unavailable.');
      for (let redirects = 0; redirects <= 1; redirects++) {
        upstream = await fetchImpl(url.href, { signal, redirect: 'manual', referrerPolicy: 'no-referrer' });
        if (upstream.status >= 300 && upstream.status < 400) {
          await upstream.body?.cancel();
          const location = upstream.headers.get('location');
          if (!location || redirects === 1) throw failure(503, 'Attachment delivery is unavailable.');
          url = new URL(location, url);
          if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || url.port || url.username || url.password
              || !url.pathname.startsWith(`/${cloudName}/${stored.type}/authenticated/`)) throw failure(503, 'Attachment delivery is unavailable.');
          continue;
        }
        break;
      }
      const size = Number(upstream.headers.get('content-length'));
      const contentType = String(upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!upstream.ok || !upstream.body || (size && (!Number.isSafeInteger(size) || size !== stored.bytes))
          || contentType !== MIME_TYPES[stored.format]) {
        await upstream.body?.cancel();
        throw failure(503, 'Attachment delivery is unavailable.');
      }
      let bytes = 0;
      const bounded = new Transform({
        transform(chunk, _encoding, done) {
          bytes += chunk.length;
          done(bytes > stored.bytes ? failure(503, 'Attachment delivery is unavailable.') : null, chunk);
        },
        flush(done) { done(bytes !== stored.bytes ? failure(503, 'Attachment delivery is unavailable.') : null); },
      });
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', MIME_TYPES[stored.format]);
      res.setHeader('Content-Disposition', `inline; filename="attachment.${stored.format}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      await pipeline(Readable.fromWeb(upstream.body), bounded, res, { signal });
    } catch {
      if (res.headersSent || res.destroyed) { if (!res.destroyed) res.destroy(); return; }
      throw failure(503, 'Attachment delivery is temporarily unavailable. Try again.');
    } finally {
      res.removeListener('close', onClose);
      closed.abort();
    }
  }
  let cleanupRunning = false;
  async function cleanupBatch(db, maxItems = 4) {
    const { cloudName, apiKey, apiSecret } = config();
    if (!db.isConnected()) throw failure(503, 'Message storage is temporarily unavailable.');
    // Signed upload requests expire long before this orphan window. Active
    // messages keep their assets; abandoned composers do not retain files.
    await db.withClient(async client => {
      await client.query('BEGIN');
      try {
        await client.query(`INSERT INTO message_media_cleanup(public_id,media_type)
          SELECT u.public_id,t.media_type FROM message_media_uploads u
          CROSS JOIN (VALUES ('image'),('video'),('raw')) AS t(media_type)
          WHERE u.created_at < NOW()-INTERVAL '24 hours'
            AND NOT EXISTS (SELECT 1 FROM direct_messages d WHERE d.attachment->>'publicId'=u.public_id)
          ON CONFLICT(public_id,media_type) DO NOTHING`);
        await client.query(`DELETE FROM message_media_uploads u WHERE u.created_at < NOW()-INTERVAL '24 hours'
          AND NOT EXISTS (SELECT 1 FROM direct_messages d WHERE d.attachment->>'publicId'=u.public_id)`);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    });
    for (let index = 0; index < Math.min(20, Math.max(1, maxItems)); index++) {
      const row = await db.withClient(async client => {
        await client.query('BEGIN');
        try {
          const { rows: [item] } = await client.query(`SELECT public_id,media_type FROM message_media_cleanup
            WHERE available_at<=NOW() ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1`);
          if (item) await client.query(`UPDATE message_media_cleanup SET attempts=attempts+1,available_at=NOW()+INTERVAL '2 minutes'
            WHERE public_id=$1 AND media_type=$2`, [item.public_id, item.media_type]);
          await client.query('COMMIT');
          return item;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      });
      if (!row) break;
      if (!ownedMessageId(row.public_id) || !['image', 'video', 'raw'].includes(row.media_type)) continue;
      try {
        const result = await uploader.destroy(row.public_id, { cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret,
          resource_type: row.media_type, type: 'authenticated', invalidate: true, timeout: 10000 });
        if (!['ok', 'not found'].includes(result?.result)) continue;
        await db.query('DELETE FROM message_media_cleanup WHERE public_id=$1 AND media_type=$2 AND retire_after<=NOW()', [row.public_id, row.media_type]);
        await db.query(`UPDATE message_media_cleanup SET available_at=LEAST(retire_after,NOW()+INTERVAL '10 minutes')
          WHERE public_id=$1 AND media_type=$2 AND retire_after>NOW()`, [row.public_id, row.media_type]);
      } catch { /* Keep the durable work item; a later worker retries it. */ }
    }
  }
  async function cleanup(db, maxItems = 4) {
    if (cleanupRunning) return;
    cleanupRunning = true;
    try { await cleanupBatch(db, maxItems); }
    finally { cleanupRunning = false; }
  }
  return { signature, recordUploadIntent, validate, proxy, cleanup };
}

function registerMessageAttachmentRoutes(app, { authenticate, privateResponse, limiter, db, media, getTargetUser, isBlocked }) {
  app.get('/messages/:userId/attachments/:messageId', authenticate, privateResponse, ...(limiter ? [limiter] : []), async (req, res) => {
    try {
      const uid = req.user.id;
      const otherId = req.params.userId;
      if (uid === otherId || await isBlocked(uid, otherId) || !(await getTargetUser(otherId))) {
        throw failure(404, 'This attachment is not available.');
      }
      if (!db.isConnected()) throw failure(503, 'Messaging is temporarily unavailable.');
      const { rows } = await db.query(
        `SELECT attachment, sender_id FROM direct_messages WHERE id=$1
         AND ((sender_id=$2 AND receiver_id=$3) OR (sender_id=$3 AND receiver_id=$2)) LIMIT 1`,
        [req.params.messageId, uid, otherId]);
      if (!rows[0]) throw failure(404, 'This attachment is not available.');
      await media.proxy(rows[0].attachment, rows[0].sender_id, res);
    } catch (error) {
      const status = [400, 404, 503].includes(error.status) ? error.status : 500;
      res.status(status).json({ message: status === 500 ? 'This attachment could not be loaded.' : error.message });
    }
  });
}

module.exports = { createMessageMedia, storedMessageAttachment, legacyMessageAttachment, publicMessage, registerMessageAttachmentRoutes,
  queueMessageAccountMedia, MESSAGE_MEDIA_SCHEMA, MESSAGE_FOLDER, MESSAGE_IMAGE_MAX_BYTES, MESSAGE_VIDEO_MAX_BYTES, MESSAGE_DOWNLOAD_TTL_SECONDS };
