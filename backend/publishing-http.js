'use strict';

const API_HOSTS = new Set(['api.github.com', 'gitlab.com', 'discord.com', 'id.twitch.tv', 'api.twitch.tv', 'api.figma.com', 'www.googleapis.com', 'youtube.googleapis.com', 'oauth2.googleapis.com', 'api.tumblr.com', 'public-api.wordpress.com', 'api.pinterest.com', 'dev.to', 'api.medium.com', 'api.dribbble.com']);

function checkedUrl(value, allowed) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid publishing endpoint.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !allowed(url)) throw new Error('Publishing endpoint is not allowed.');
  return url;
}

async function boundedBody(response, maxBytes) {
  if (Number(response.headers.get('content-length') || 0) > maxBytes) throw new Error('Publishing response exceeded its size limit.');
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body || []) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) throw new Error('Publishing response exceeded its size limit.');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function createPublishingHttp({ fetcher, cloudName = '' }) {
  if (typeof fetcher !== 'function') throw new Error('A publishing transport is required.');
  async function request(value, options = {}) {
    const url = checkedUrl(value, target => API_HOSTS.has(target.hostname));
    const method = String(options.method || 'GET').toUpperCase();
    const headers = { Accept: 'application/json', 'User-Agent': 'UFIconnect/1.0', ...options.headers };
    let body = options.body;
    if (options.json !== undefined) { body = JSON.stringify(options.json); headers['Content-Type'] = 'application/json'; }
    if (options.form !== undefined) { body = new URLSearchParams(options.form).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    const timeout = Math.max(1000, Math.min(Number(options.timeoutMs) || 30000, 180000));
    try {
      const response = await fetcher(url.toString(), { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeout) });
      const bytes = await boundedBody(response, 4 * 1024 * 1024);
      let data = null;
      if (bytes.length) { try { data = JSON.parse(bytes.toString('utf8')); } catch { /* Provider may return an empty/non-JSON upload acknowledgement. */ } }
      return { status: response.status, data, headers: Object.fromEntries(response.headers.entries()) };
    } catch {
      throw Object.assign(new Error(method === 'GET' ? 'The publishing provider could not be reached.' : 'The provider did not confirm delivery. Check the destination before retrying.'), { deliveryUncertain: method !== 'GET', status: 502 });
    }
  }
  async function downloadMedia(value, { kind = 'image', maxBytes } = {}) {
    if (!['image', 'video'].includes(kind) || !cloudName) throw new Error('Media must be uploaded through UFIconnect first.');
    const limit = Math.min(Number(maxBytes) || (kind === 'video' ? 64 : 10) * 1024 * 1024, (kind === 'video' ? 64 : 10) * 1024 * 1024);
    const valid = target => target.hostname === 'res.cloudinary.com' && target.pathname.startsWith(`/${cloudName}/${kind}/upload/`);
    let url = checkedUrl(value, valid);
    for (let redirect = 0; redirect <= 2; redirect++) {
      const response = await fetcher(url.toString(), { headers: { 'User-Agent': 'UFIconnect/1.0' }, redirect: 'manual', signal: AbortSignal.timeout(kind === 'video' ? 90000 : 20000) });
      if (response.status >= 300 && response.status < 400 && response.headers.get('location') && redirect < 2) {
        await response.body?.cancel();
        url = checkedUrl(new URL(response.headers.get('location'), url).toString(), valid);
        continue;
      }
      const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
      if (!response.ok || !(kind === 'image' ? /^image\/(jpeg|png|webp|gif)$/ : /^video\/(mp4|webm|quicktime|x-m4v)$/).test(contentType)) {
        await response.body?.cancel();
        throw new Error('The uploaded media could not be retrieved in a supported format.');
      }
      const body = await boundedBody(response, limit);
      if (!body.length) throw new Error('The uploaded media is empty.');
      return { body, contentType };
    }
    throw new Error('The uploaded media could not be retrieved.');
  }
  return { request, downloadMedia };
}

module.exports = { createPublishingHttp };
