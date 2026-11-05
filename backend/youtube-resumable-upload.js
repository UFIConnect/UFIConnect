'use strict';

const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function uncertain() {
  return Object.assign(new Error('YouTube did not confirm the completed upload. Check YouTube Studio before uploading this video again.'), { status: 502, deliveryUncertain: true });
}
function sessionUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('YouTube did not create a video upload session.'); }
  if (url.protocol !== 'https:' || !['www.googleapis.com', 'youtube.googleapis.com'].includes(url.hostname)
    || url.username || url.password || url.port || url.pathname !== '/upload/youtube/v3/videos') {
    throw Error('YouTube returned an invalid upload session.');
  }
  return url.href;
}

// A session is created exactly once by the caller. Recovery only probes that
// session and sends bytes after Google's confirmed offset, preventing a second
// videos.insert when the final upload response is lost.
async function uploadYouTubeVideo({ request, url, headers, body, contentType,
  now = Date.now, sleep = pause, deadline = now() + 180000 }) {
  const destination = sessionUrl(url);
  if (!Buffer.isBuffer(body) || !body.length) throw Error('Choose a nonempty video file.');
  const total = body.length;
  const started = now();
  const stopAt = Math.min(Number.isFinite(deadline) ? deadline : started + 180000, started + 180000);
  const remaining = () => {
    const ms = stopAt - now();
    if (ms < 1000) throw uncertain();
    return Math.floor(ms);
  };
  let offset = 0, probe = false, recoveries = 0, stalls = 0;
  async function delay(response) {
    const raw = response?.headers?.['retry-after'];
    const seconds = typeof raw === 'string' && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw || '') - now();
    const ms = Math.max(500 * (2 ** Math.max(0, recoveries - 1)), Number.isFinite(seconds) ? Math.max(0, seconds) : 0);
    if (ms + 1000 >= remaining()) throw uncertain();
    await sleep(ms);
  }
  for (let attempt = 0; attempt < 12; attempt++) {
    let response;
    try {
      response = await request(destination, { method: 'PUT',
        headers: { ...headers, 'Content-Length': String(probe ? 0 : total - offset),
          ...(probe ? { 'Content-Range': `bytes */${total}` }
            : { 'Content-Type': contentType, ...(attempt ? { 'Content-Range': `bytes ${offset}-${total - 1}/${total}` } : {}) }),
        }, body: probe ? Buffer.alloc(0) : body.subarray(offset),
        timeoutMs: Math.min(probe ? 20000 : 120000, remaining()),
      }, [308, ...TRANSIENT]);
    } catch (error) {
      if ([401, 403].includes(error?.status) || (!error?.deliveryUncertain && !TRANSIENT.has(error?.status))) {
        // A failed status probe cannot undo the earlier ambiguity: Google may
        // already have created the video before its acknowledgement was lost.
        // Keep reconnection actionable without making a fresh insert safe.
        if (recoveries > 0 || probe && offset === total) {
          throw Object.assign(uncertain(), { status: Number(error?.status) || 502,
            ...(error?.reconnectRequired ? { reconnectRequired: true } : {}) });
        }
        throw error;
      }
      if (++recoveries > 3) throw uncertain();
      await delay(); probe = true; continue;
    }
    if (response.status >= 200 && response.status < 300) return response;
    if (response.status === 308) {
      const range = response.headers?.range;
      const match = typeof range === 'string' ? /^bytes=0-(\d+)$/.exec(range) : null;
      if (range !== undefined && !match) throw uncertain();
      const next = match ? Number(match[1]) + 1 : 0;
      if (!Number.isSafeInteger(next) || next < offset || next > total) throw uncertain();
      const stalled = next === offset;
      if (next === offset || next === total) {
        if (++stalls > 3) throw uncertain();
      } else stalls = 0;
      offset = next;
      probe = next === total;
      if (probe || stalled || next === 0 || response.headers?.['retry-after']) await delay(response);
      continue;
    }
    if (!TRANSIENT.has(response.status) || ++recoveries > 3) throw uncertain();
    await delay(response); probe = true;
  }
  throw uncertain();
}

module.exports = { uploadYouTubeVideo, youtubeUploadSessionUrl: sessionUrl };
