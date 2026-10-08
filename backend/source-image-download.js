const https = require('node:https');
const net = require('node:net');
const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;
const SOURCE_IMAGE_TIMEOUT_MS = 10000;
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' };
function failure(message, status = 502) { return Object.assign(new Error(message), { status }); }

function imageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.length >= 16 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const boxEnd = buffer.readUInt32BE(0);
    if (boxEnd >= 16 && boxEnd <= Math.min(buffer.length, 256)) {
      for (let offset = 8; offset + 4 <= boxEnd; offset += 4) {
        if (offset !== 12 && ['avif', 'avis'].includes(buffer.toString('ascii', offset, offset + 4))) return 'image/avif';
      }
    }
  }
  return '';
}

// The caller supplies its fixed provider CDN policy. No redirects or alternate
// protocols are followed, and both response headers and bytes are verified.
function createSourceImageDownloader({ isAllowedUrl = () => false, get = https.get, maxBytes = MAX_SOURCE_IMAGE_BYTES, timeoutMs = SOURCE_IMAGE_TIMEOUT_MS } = {}) {
  maxBytes = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? Math.min(maxBytes, MAX_SOURCE_IMAGE_BYTES) : MAX_SOURCE_IMAGE_BYTES;
  timeoutMs = Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, SOURCE_IMAGE_TIMEOUT_MS) : SOURCE_IMAGE_TIMEOUT_MS;
  return async function downloadSourceImage(rawUrl, { signal } = {}) {
    let target;
    try {
      if (typeof rawUrl !== 'string' || rawUrl.length > 4096) throw new Error();
      target = new URL(rawUrl);
      if (target.protocol !== 'https:' || target.port || target.username || target.password
        || net.isIP(target.hostname.replace(/^\[|\]$/g, '')) || isAllowedUrl(target.href) !== true) throw new Error();
    } catch { throw failure('That URL cannot be downloaded.', 400); }
    if (signal?.aborted) throw failure('The image download was cancelled.', 499);
    return new Promise((resolve, reject) => {
      let request, upstream, settled = false, size = 0;
      const chunks = [];
      function finish(error, result) {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        signal?.removeEventListener('abort', cancelled);
        if (error) { upstream?.destroy(); request?.destroy(); reject(error); }
        else resolve(result);
      }
      const cancelled = () => finish(failure('The image download was cancelled.', 499));
      const deadline = setTimeout(() => finish(failure('The image download timed out.', 504)), timeoutMs);
      signal?.addEventListener('abort', cancelled, { once: true });
      try {
        request = get(target, { headers: { Accept: 'image/jpeg,image/png,image/gif,image/webp,image/avif', 'Accept-Encoding': 'identity', 'User-Agent': 'UFIConnect source image download' } }, response => {
          upstream = response;
          // A late response after cancellation must also release its socket.
          if (settled) { response.destroy(); return; }
          response.once('error', () => finish(failure('Could not fetch that image.')));
          response.once('aborted', () => finish(failure('The image download was interrupted.')));
          const type = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
          const declared = response.headers['content-length'];
          if (response.statusCode !== 200 || !Object.hasOwn(IMAGE_TYPES, type)
            || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
            finish(failure('Could not fetch a supported image.')); return;
          }
          if (declared != null && (!/^\d+$/.test(String(declared)) || Number(declared) > maxBytes)) {
            finish(failure('The image exceeds the 10 MB download limit.', 413)); return;
          }
          response.on('data', chunk => {
            if (settled) return;
            size += chunk.length;
            if (size > maxBytes) { finish(failure('The image exceeds the 10 MB download limit.', 413)); return; }
            chunks.push(chunk);
          });
          response.once('end', () => {
            if (settled) return;
            const body = Buffer.concat(chunks, size);
            if (!size || (declared != null && size !== Number(declared)) || imageType(body) !== type) {
              finish(failure('The downloaded file is not a supported image.')); return;
            }
            finish(null, { body, mimeType: type, extension: IMAGE_TYPES[type] });
          });
        });
        request.once('error', () => finish(failure('Could not fetch that image.')));
      } catch { finish(failure('Could not fetch that image.')); }
    });
  };
}

module.exports = { createSourceImageDownloader, MAX_SOURCE_IMAGE_BYTES, SOURCE_IMAGE_TIMEOUT_MS };
