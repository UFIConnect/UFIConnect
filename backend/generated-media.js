const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createHash } = require('node:crypto');
const cloudinary = require('cloudinary').v2;

function createGeneratedMediaStorage({ env = process.env, uploader = cloudinary.uploader, fetchImpl = fetch } = {}) {
  function options(userId, id, type) {
    if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
      throw Object.assign(new Error('Media storage is not configured. Please try again after storage is available.'), { status: 503 });
    }
    const owner = createHash('sha256').update(userId).digest('hex').slice(0, 24);
    return {
      cloud_name: env.CLOUDINARY_CLOUD_NAME, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET,
      public_id: `uficonnect-studio/${owner}/${id}`, resource_type: type, overwrite: false, timeout: 120000,
    };
  }
  function result(asset, type) {
    if (!asset?.secure_url?.startsWith(`https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME}/`)) {
      throw new Error('The generated media could not be stored. Please retry saving it.');
    }
    return { mediaUrl: asset.secure_url, mediaType: type, publicId: asset.public_id };
  }
  return {
    assertConfigured() { options('check', 'check', 'image'); },
    async save(userId, id, type, source) {
      // Sources come only from configured generation providers, never request-body URLs.
      if (typeof source !== 'string' || !(source.startsWith('https://') || (type === 'image' && source.startsWith('data:image/')))) {
        throw new Error('The generation provider returned an invalid media source.');
      }
      return result(await uploader.upload(source, options(userId, id, type)), type);
    },
    async saveOpenAIVideo(userId, id, jobId, apiKey) {
      if (!/^video_[A-Za-z0-9_-]{1,200}$/.test(jobId)) throw new Error('Invalid video job.');
      const config = options(userId, id, 'video');
      const signal = AbortSignal.timeout(120000);
      let url = new URL(`https://api.openai.com/v1/videos/${encodeURIComponent(jobId)}/content`);
      let response;
      for (let redirects = 0; redirects <= 2; redirects++) {
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid video download URL.');
        response = await fetchImpl(url.href, {
          redirect: 'manual', signal,
          headers: redirects === 0 ? { Authorization: `Bearer ${apiKey}` } : {},
        });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          const location = response.headers.get('location');
          if (!location || redirects === 2) throw new Error('The video download redirected too many times.');
          url = new URL(location, url);
          continue;
        }
        break;
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error(`The video could not be downloaded (HTTP ${response.status}).`);
      }
      // Stream provider bytes into durable storage without buffering a video in API memory.
      let bytes = 0;
      const limit = new Transform({ transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > 100 * 1024 * 1024 ? new Error('The video exceeds the 100 MB storage limit.') : null, chunk);
      } });
      let uploadStream;
      const uploaded = new Promise((resolve, reject) => {
        uploadStream = uploader.upload_stream({ ...config, disable_promises: true }, (error, asset) => error ? reject(error) : resolve(asset));
      });
      try {
        const [asset] = await Promise.all([
          uploaded,
          pipeline(Readable.fromWeb(response.body), limit, uploadStream, { signal }),
        ]);
        return result(asset, 'video');
      } catch (error) {
        uploadStream.destroy(error);
        throw error;
      }
    },
  };
}

module.exports = { createGeneratedMediaStorage };
