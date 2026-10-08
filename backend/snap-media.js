'use strict';

const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');
const cloudinary = require('cloudinary').v2;
const SNAP_FOLDER = 'uficonnect-snaps';
const SNAP_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const SNAP_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const SNAP_VIDEO_MAX_SECONDS = 60;
const failure = (status, message) => Object.assign(new Error(message), { status });

// A signed response identifies an owned upload. The authenticated asset read,
// rather than browser-supplied metadata, establishes its size and duration.
function createSnapMedia({ env = process.env, api = cloudinary.api, uploader = cloudinary.uploader, now = Date.now, uuid = randomUUID } = {}) {
  function config() {
    const cloudName = String(env.CLOUDINARY_CLOUD_NAME || '');
    const apiKey = String(env.CLOUDINARY_API_KEY || '');
    const apiSecret = String(env.CLOUDINARY_API_SECRET || '');
    if (!cloudName || !apiKey || !apiSecret) throw failure(503, 'Snap uploads are not configured yet.');
    return { cloudName, apiKey, apiSecret };
  }
  function signature(userId) {
    if (!userId) throw failure(401, 'Sign in to post a Snap.');
    const { cloudName, apiKey, apiSecret } = config();
    const timestamp = Math.floor(now() / 1000);
    const publicId = `snap-${userId}-${uuid()}`;
    const signed = `folder=${SNAP_FOLDER}&public_id=${publicId}&timestamp=${timestamp}`;
    return { cloudName, apiKey, timestamp, folder: SNAP_FOLDER, publicId,
      signature: createHash('sha1').update(signed + apiSecret).digest('hex') };
  }
  async function validate(userId, body) {
    const { cloudName, apiKey, apiSecret } = config();
    const proof = body?.upload;
    if (!['image', 'video'].includes(body?.mediaType) || !proof || typeof proof !== 'object'
        || typeof proof.publicId !== 'string' || proof.publicId.length > 200
        || !proof.publicId.startsWith(`${SNAP_FOLDER}/snap-${userId}-`)
        || !/^\d{1,15}$/.test(String(proof.version)) || Number(proof.version) < 1
        || typeof proof.signature !== 'string' || !/^[a-f0-9]{40}$/.test(proof.signature)) {
      throw failure(400, 'Upload a photo or video through UFIConnect before posting your Snap.');
    }
    const expected = createHash('sha1').update(`public_id=${proof.publicId}&version=${proof.version}${apiSecret}`).digest();
    if (!timingSafeEqual(expected, Buffer.from(proof.signature, 'hex'))) {
      throw failure(400, 'This Snap upload could not be verified. Please upload it again.');
    }
    let asset;
    try {
      asset = await api.resource(proof.publicId, { cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret,
        resource_type: body.mediaType, type: 'upload', timeout: 10000 });
    } catch {
      throw failure(503, 'Snap upload verification is temporarily unavailable. Please try again.');
    }
    const formats = body.mediaType === 'video' ? ['mp4', 'webm', 'mov'] : ['jpg', 'jpeg', 'png', 'webp'];
    const limit = body.mediaType === 'video' ? SNAP_VIDEO_MAX_BYTES : SNAP_IMAGE_MAX_BYTES;
    let url;
    try { url = new URL(asset?.secure_url); } catch { /* validated below */ }
    if (asset?.public_id !== proof.publicId || String(asset?.version) !== String(proof.version)
        || asset?.resource_type !== body.mediaType || asset?.type !== 'upload'
        || !url || url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || url.port
        || url.username || url.password || !url.pathname.startsWith(`/${cloudName}/${body.mediaType}/upload/`)
        || body.mediaUrl !== asset.secure_url || !formats.includes(String(asset?.format).toLowerCase())
        || !Number.isSafeInteger(asset?.bytes) || asset.bytes <= 0) {
      throw failure(400, 'Choose a supported photo or video uploaded through UFIConnect.');
    }
    if (asset.bytes > limit) throw failure(400, body.mediaType === 'video'
      ? 'Choose a video smaller than 100 MB.' : 'Choose a photo smaller than 10 MB.');
    if (body.mediaType === 'video' && (!Number.isFinite(asset.duration) || asset.duration <= 0 || asset.duration > SNAP_VIDEO_MAX_SECONDS)) {
      throw failure(400, 'Choose a video no longer than 60 seconds.');
    }
    const thumbnail = body.mediaType === 'video' ? asset.secure_url.replace(/\.[^./?]+$/, '.jpg') : asset.secure_url;
    return { mediaUrl: asset.secure_url, mediaType: body.mediaType, publicId: asset.public_id,
      thumbnailUrl: thumbnail.replace('/upload/', '/upload/c_fill,w_200,h_300,q_auto,f_auto/'),
      bytes: asset.bytes, duration: body.mediaType === 'video' ? asset.duration : null };
  }
  async function remove(publicId, mediaType) {
    const { cloudName, apiKey, apiSecret } = config();
    if (typeof publicId !== 'string' || !publicId.startsWith(`${SNAP_FOLDER}/snap-`) || !['image', 'video'].includes(mediaType)) {
      throw failure(400, 'Invalid Snap media cleanup request.');
    }
    let result;
    try {
      result = await uploader.destroy(publicId, { cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret,
        resource_type: mediaType, type: 'upload', invalidate: true, timeout: 10000 });
    } catch { throw failure(503, 'Snap media cleanup is temporarily unavailable.'); }
    if (!['ok', 'not found'].includes(result?.result)) throw failure(503, 'Snap media cleanup could not be confirmed.');
  }
  return { signature, validate, remove };
}

module.exports = { createSnapMedia, SNAP_FOLDER, SNAP_IMAGE_MAX_BYTES, SNAP_VIDEO_MAX_BYTES, SNAP_VIDEO_MAX_SECONDS };
