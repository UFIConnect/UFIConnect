'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createSnapMedia } = require('./snap-media');
const owner = '11111111-1111-4111-8111-111111111111';
const env = { CLOUDINARY_CLOUD_NAME: 'fixture', CLOUDINARY_API_KEY: 'test-api-key', CLOUDINARY_API_SECRET: 'test-secret' };
function proof(publicId, version = 123) {
  return { publicId, version, signature: createHash('sha1').update(`public_id=${publicId}&version=${version}${env.CLOUDINARY_API_SECRET}`).digest('hex') };
}
function assetFor(publicId, mediaType = 'image') {
  const format = mediaType === 'video' ? 'mp4' : 'jpg';
  return { public_id: publicId, version: 123, resource_type: mediaType, type: 'upload', format,
    bytes: 1000, duration: mediaType === 'video' ? 30 : undefined,
    secure_url: `https://res.cloudinary.com/fixture/${mediaType}/upload/v123/${publicId}.${format}` };
}
test('Snap upload signatures bind the owned asset; authoritative metadata enforces media limits', async t => {
  const publicId = `uficonnect-snaps/snap-${owner}-asset`;
  let asset = assetFor(publicId), calls = 0, readFails = false, destruction = 'ok';
  const media = createSnapMedia({ env, now: () => 123000, uuid: () => 'unique',
    api: { resource: async (id, options) => { calls++; assert.equal(id, publicId); assert.equal(options.resource_type, asset.resource_type); if (readFails) throw new Error('Provider secret'); return asset; } },
    uploader: { destroy: async (id, options) => { assert.equal(id, publicId); assert.equal(options.invalidate, true); return { result: destruction }; } } });
  const body = () => ({ mediaUrl: asset.secure_url, mediaType: asset.resource_type, upload: proof(publicId) });
  const signature = media.signature(owner);
  assert.equal(signature.publicId, `snap-${owner}-unique`);
  assert.equal(signature.folder, 'uficonnect-snaps');
  assert.equal(signature.signature, createHash('sha1').update(`folder=uficonnect-snaps&public_id=snap-${owner}-unique&timestamp=123${env.CLOUDINARY_API_SECRET}`).digest('hex'));
  assert.equal(Object.hasOwn(signature, 'apiSecret'), false);
  await t.test('forged proofs, another member asset and absent proof never make an API call', async () => {
    for (const value of [{ ...body(), upload: undefined }, { ...body(), upload: { ...proof(publicId), signature: '0'.repeat(40) } }, { ...body(), upload: proof('uficonnect-snaps/snap-other-asset') }]) {
      await assert.rejects(media.validate(owner, value), error => error.status === 400);
    }
    assert.equal(calls, 0);
  });
  await t.test('trusted photo is returned and an arbitrary link cannot replace it', async () => {
    assert.equal((await media.validate(owner, body())).thumbnailUrl, asset.secure_url.replace('/upload/', '/upload/c_fill,w_200,h_300,q_auto,f_auto/'));
    await assert.rejects(media.validate(owner, { ...body(), mediaUrl: 'https://evil.invalid/image.jpg' }), error => error.status === 400);
    asset = { ...asset, format: 'svg' };
    await assert.rejects(media.validate(owner, body()), error => error.status === 400);
  });
  await t.test('client metadata cannot bypass image size or video duration', async () => {
    asset = { ...assetFor(publicId), bytes: 10 * 1024 * 1024 + 1 };
    await assert.rejects(media.validate(owner, { ...body(), upload: { ...proof(publicId), bytes: 1 } }), error => error.status === 400);
    asset = assetFor(publicId, 'video');
    assert.match((await media.validate(owner, body())).thumbnailUrl, /\.jpg$/);
    for (const duration of [0, undefined, 60.1]) {
      asset.duration = duration;
      await assert.rejects(media.validate(owner, { ...body(), upload: { ...proof(publicId), duration: 1 } }), error => error.status === 400);
    }
    asset.duration = 60; asset.bytes = 100 * 1024 * 1024 + 1;
    await assert.rejects(media.validate(owner, body()), error => error.status === 400);
    asset.bytes = 1000; asset.version = 124;
    await assert.rejects(media.validate(owner, body()), error => error.status === 400);
  });
  await t.test('storage errors stay private, and cleanup requires a confirmed owned asset removal', async () => {
    asset = assetFor(publicId); readFails = true;
    await assert.rejects(media.validate(owner, body()), error => error.status === 503 && !error.message.includes('secret'));
    await media.remove(publicId, 'image'); destruction = 'not found'; await media.remove(publicId, 'image');
    destruction = 'unconfirmed'; await assert.rejects(media.remove(publicId, 'image'), error => error.status === 503);
    await assert.rejects(media.remove('uficonnect-posts/other', 'image'), error => error.status === 400);
    await assert.rejects(createSnapMedia({ env: {} }).validate(owner, body()), error => error.status === 503);
  });
});
