const { isIP } = require('node:net');
const { createHash } = require('node:crypto');

const LIVE_TTL = 3 * 60 * 1000;
const FAILURE_TTL = 2 * 60 * 1000;
const PAGE_TTL = 10 * 60 * 1000;
const MAX_BYTES = 256 * 1024;
const KINDS = new Set(['page', 'youtube-provider', 'ipcamlive', 'skyline', 'earthcam', 'balticlivecam', 'livespotting', 'roundshot', 'hls', 'fresh-image']);

function publicHttpsUrl(value, allowedHosts) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
    || isIP(url.hostname) || !url.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)
    || allowedHosts && !allowedHosts.has(url.hostname)) throw new Error('Camera URL is not an approved public HTTPS address');
  return url;
}

function validateCameraProviders(catalog, destinations) {
  if (!Array.isArray(catalog) || catalog.length > 200) throw new Error('Invalid camera provider catalog');
  const ids = new Set();
  for (const entry of catalog) {
    if (!/^camera_provider_[a-z0-9_]+$/.test(entry.id || '') || ids.has(entry.id)) throw new Error('Invalid or duplicate camera provider ID');
    ids.add(entry.id);
    if (![entry.city, entry.country, entry.countryCode, entry.title, entry.operator].every(value => typeof value === 'string' && value.trim() && value.length <= 300)
      || !/^[A-Z]{2}$/.test(entry.countryCode)) throw new Error('Camera provider metadata is incomplete');
    if (destinations && !destinations.some(city => city.city === entry.city && city.countryCode === entry.countryCode
      && entry.destinationId === `${city.countryCode}:${city.slug}`)) throw new Error('Camera provider is outside the Travel city catalog');
    publicHttpsUrl(entry.sourceUrl);
    const verification = entry.verification || {};
    if (!KINDS.has(verification.kind)) throw new Error('Unsupported camera provider verifier');
    if (verification.kind === 'youtube-provider' && !/^[\w-]{11}$/.test(verification.videoId || '')) throw new Error('Invalid YouTube provider ID');
    if (verification.kind === 'ipcamlive' && !/^[a-zA-Z0-9_-]{3,80}$/.test(verification.alias || '')) throw new Error('Invalid IPCamLive alias');
    if (verification.kind === 'skyline' && publicHttpsUrl(entry.sourceUrl).hostname !== 'www.skylinewebcams.com') throw new Error('Invalid Skyline operator page');
    if (verification.kind === 'earthcam' && (publicHttpsUrl(entry.sourceUrl).hostname !== 'www.earthcam.com' || !/^[a-z0-9_-]{1,80}$/i.test(verification.cameraKey || ''))) throw new Error('Invalid EarthCam operator page');
    if (verification.kind === 'balticlivecam' && (publicHttpsUrl(entry.sourceUrl).hostname !== 'balticlivecam.com' || !Number.isSafeInteger(verification.cameraId) || verification.cameraId < 1 || !/^\/blc\/[A-Za-z0-9_-]+\/$/.test(verification.streamPath || ''))) throw new Error('Invalid Baltic Live Cam camera identity');
    if (verification.kind === 'roundshot' && (!/^[a-z0-9-]+\.roundshot\.com$/.test(publicHttpsUrl(entry.sourceUrl).hostname) || !Number.isSafeInteger(verification.cameraId) || verification.cameraId < 1 || !/^storage\d+\.roundshot\.com$/.test(verification.imageHost || ''))) throw new Error('Invalid Roundshot camera identity');
    if (verification.kind === 'livespotting' && (publicHttpsUrl(entry.sourceUrl).hostname !== 'www.livespotting.tv' || !/^[a-z0-9]{8}$/.test(verification.cameraId || ''))) throw new Error('Invalid Livespotting camera identity');
    if (['hls', 'fresh-image'].includes(verification.kind)) {
      const hosts = new Set(verification.allowedHosts || []);
      if (!hosts.size || hosts.size > 8) throw new Error('Camera status requires a bounded host allowlist');
      for (const host of hosts) publicHttpsUrl(`https://${host}/`);
      publicHttpsUrl(verification.url, hosts);
    }
  }
  return catalog;
}

async function readProviderResource(value, { allowedHosts, fetchImpl, signal, maxBytes = MAX_BYTES }) {
  let url = publicHttpsUrl(value, allowedHosts);
  for (let redirects = 0; redirects <= 2; redirects++) {
    const response = await fetchImpl(url.href, {
      redirect: 'manual', signal,
      headers: { 'User-Agent': 'UFIConnect/1.0 (Travel camera availability)', Accept: 'application/json, application/vnd.apple.mpegurl, text/html;q=0.8' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get('location');
      await response.body?.cancel?.().catch(() => {});
      if (!next || redirects === 2) throw new Error('Camera provider redirect limit');
      url = publicHttpsUrl(new URL(next, url).href, allowedHosts);
      continue;
    }
    if (!response.ok) { await response.body?.cancel?.().catch(() => {}); throw new Error(`Camera provider returned HTTP ${response.status}`); }
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel?.().catch(() => {}); throw new Error('Camera provider response is too large'); }
    const chunks = []; let bytes = 0;
    if (!response.body) throw new Error('Camera provider response is empty');
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error('Camera provider response is too large');
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);
    return { text: body.toString('utf8'), url: url.href, bytes, signature: body.subarray(0, 12), bodyHash: createHash('sha256').update(body).digest('hex'),
      contentType: response.headers.get('content-type') || '', lastModified: response.headers.get('last-modified') };
  }
  throw new Error('Camera provider redirect limit');
}

function inspectLivePlaylist(text, previous, now) {
  if (!/^#EXTM3U\s/m.test(text) || /#EXT-X-ENDLIST\b|#EXT-X-PLAYLIST-TYPE:VOD\b/.test(text)) return { status: 'offline' };
  const sequence = Number(text.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)\s*$/m)?.[1]);
  const target = Number(text.match(/^#EXT-X-TARGETDURATION:(\d+)\s*$/m)?.[1]);
  const segments = (text.match(/^#EXTINF:/gm) || []).length;
  if (!Number.isSafeInteger(sequence) || sequence < 0 || !Number.isFinite(target) || target < 1 || target > 120 || segments < 2) return { status: 'unverified' };
  const dates = [...text.matchAll(/^#EXT-X-PROGRAM-DATE-TIME:([^\r\n]+)/gm)].map(match => Date.parse(match[1])).filter(Number.isFinite);
  const latestDate = dates.length ? Math.max(...dates) : null;
  const lastSequence = sequence + segments - 1;
  const probe = { lastSequence, checkedAt: now, firstSeenAt: previous?.lastSequence === lastSequence ? previous.firstSeenAt || previous.checkedAt : now };
  // An old playlist without ENDLIST is not proof of a current broadcast.
  const freshTime = latestDate !== null && latestDate <= now + 30000 && now - latestDate <= LIVE_TTL;
  const advancing = previous && previous.checkedAt < now && now - previous.checkedAt <= PAGE_TTL
    && lastSequence > previous.lastSequence;
  const stalled = previous?.lastSequence === lastSequence && now - probe.firstSeenAt > Math.max(120000, target * 6000);
  return { status: freshTime || advancing ? 'live' : stalled ? 'unverified' : 'checking', probe,
    validUntil: freshTime && !advancing ? latestDate + LIVE_TTL : null,
    retryMs: Math.min(30000, Math.max(4000, target * 1000 + 500)),
    method: freshTime ? 'fresh HLS program timestamp' : advancing ? 'advancing HLS media sequence' : stalled ? 'HLS playlist stopped advancing' : 'awaiting a second HLS sequence' };
}

async function verifyHls(value, context, previous) {
  let resource = await readProviderResource(value, { ...context, maxBytes: 64 * 1024 });
  for (let depth = 0; depth < 2 && /#EXT-X-STREAM-INF:/.test(resource.text); depth++) {
    const variant = resource.text.match(/#EXT-X-STREAM-INF:[^\r\n]*\r?\n([^#\r\n][^\r\n]*)/)?.[1]?.trim();
    if (!variant) return { status: 'unverified' };
    resource = await readProviderResource(new URL(variant, resource.url).href, { ...context, maxBytes: 64 * 1024 });
  }
  return inspectLivePlaylist(resource.text, previous, context.now());
}

function publicJsonLiteral(text, variable) {
  const match = new RegExp(`\\bvar\\s+${variable}\\s*=\\s*\\{`).exec(text);
  if (!match) return null;
  const start = match.index + match[0].lastIndexOf('{');
  let depth = 0; let quoted = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quoted) { if (char === '\\') index++; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') { depth--; if (!depth) return JSON.parse(text.slice(start, index + 1)); }
  }
  return null;
}

async function verifyCameraProvider(entry, { fetchImpl = fetch, now = Date.now, previous = null, timeoutMs = 8000 } = {}) {
  const kind = entry.verification.kind;
  const pageHost = publicHttpsUrl(entry.sourceUrl).hostname;
  const context = { fetchImpl, now, signal: AbortSignal.timeout(timeoutMs) };
  if (kind === 'youtube-provider') return { status: 'unverified', method: 'YouTube status batch required' };
  if (kind === 'livespotting') {
    const { text } = await readProviderResource(`https://player.livespotting.com/v2/livesource/${entry.verification.cameraId}`, { ...context, allowedHosts: new Set(['player.livespotting.com']) });
    const camera = JSON.parse(text);
    if (camera.id !== entry.verification.cameraId || camera.city !== entry.city || !camera.source) return { status: 'unverified', method: 'Livespotting camera identity not confirmed' };
    // The provider redirects its CDN hostname to regional nodes. Permit only
    // its regional node naming pattern, still with bounded manual redirects.
    const allowedHosts = { has: host => host === 'cdn.livespotting.com' || /^ch-[a-z]{3}-n\d{1,3}\.livespotting\.com$/.test(host) };
    return verifyHls(camera.source, { ...context, allowedHosts }, previous);
  }
  if (kind === 'roundshot') {
    const base = entry.sourceUrl.replace(/\/?$/, '/');
    const settings = JSON.parse((await readProviderResource(base + 'settings.json', { ...context, allowedHosts: new Set([pageHost]) })).text);
    if (settings.id !== entry.verification.cameraId || settings.url?.replace(/\/$/, '') !== entry.sourceUrl.replace(/\/$/, '')) return { status: 'unverified', mediaKind: 'image', method: 'Roundshot camera identity not confirmed' };
    const structure = JSON.parse((await readProviderResource(base + 'structure.json', { ...context, allowedHosts: new Set([pageHost]), maxBytes: 512 * 1024 })).text);
    if (structure.cam_inactive || structure.inactive || Object.values(settings.settings || {}).some(setting => setting.cam_inactive)) return { status: 'offline', mediaKind: 'image', method: 'Roundshot operator camera status' };
    const latest = structure.images?.find(image => image.id === settings.last_image && image.status === 'finished' && !image.is_default_inactive && !image.is_best_shot);
    const url = latest?.structure?.oneeighth?.url_full;
    if (!url) return { status: 'unverified', mediaKind: 'image', method: 'Roundshot current camera image not available' };
    entry = { ...entry, verification: { kind: 'fresh-image', url, allowedHosts: [entry.verification.imageHost], maxAgeSeconds: 900 } };
  }
  if (kind === 'balticlivecam') {
    const { text } = await readProviderResource(`https://balticlivecam.com/wp-admin/admin-ajax.php?action=auth_token&id=${entry.verification.cameraId}&embed=0`, { ...context, allowedHosts: new Set(['balticlivecam.com']) });
    const src = text.match(/sources:\s*\[\s*\{\s*src:\s*['"]([^'"]+)['"]/)?.[1];
    if (!src) return { status: 'unverified', method: 'Baltic Live Cam public player unavailable' };
    const stream = publicHttpsUrl(src);
    if (!/^edge\d+\.balticlivecam\.com$/.test(stream.hostname) || !stream.pathname.startsWith(entry.verification.streamPath)) return { status: 'unverified', method: 'Baltic Live Cam camera identity not confirmed' };
    return verifyHls(stream.href, { ...context, allowedHosts: new Set([stream.hostname]) }, previous);
  }
  if (kind === 'ipcamlive') {
    const allowedHosts = new Set(['www.ipcamlive.com']);
    const { text } = await readProviderResource(`https://www.ipcamlive.com/player/getcamerastreamstate.php?alias=${encodeURIComponent(entry.verification.alias)}`, { ...context, allowedHosts });
    const details = JSON.parse(text).details;
    if (!details || String(details.alias) !== entry.verification.alias) return { status: 'unverified' };
    if (String(details.enabled) !== '1' || String(details.streamavailable) !== '1') return { status: 'offline', method: 'IPCamLive public camera status' };
    if (!details.streamid || String(details.pinlockenabled) === '1' || String(details.timeshiftenabled) === '1') return { status: 'unverified' };
    return { status: 'live', method: 'IPCamLive public camera status' };
  }
  if (kind === 'hls') return verifyHls(entry.verification.url, { ...context, allowedHosts: new Set(entry.verification.allowedHosts) }, previous);
  if (entry.verification.kind === 'fresh-image') {
    const resource = await readProviderResource(entry.verification.url, { ...context, allowedHosts: new Set(entry.verification.allowedHosts), maxBytes: 1024 * 1024 });
    const modified = Date.parse(resource.lastModified);
    const maxAge = Math.min(15 * 60, Math.max(60, Number(entry.verification.maxAgeSeconds) || 180)) * 1000;
    const signature = resource.signature;
    const image = signature.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      || signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || signature.toString('ascii', 0, 4) === 'RIFF' && signature.toString('ascii', 8, 12) === 'WEBP';
    const validImage = image && /^image\/(?:jpe?g|png|webp)(?:;|$)/i.test(resource.contentType) && resource.bytes > 100;
    const fresh = validImage && Number.isFinite(modified) && modified <= now() + 30000 && now() - modified <= maxAge;
    const intervalMs = Math.min(900000, Math.max(10000, (Number(entry.verification.updateIntervalSeconds) || 60) * 1000));
    const changing = validImage && previous?.imageHash && previous.imageHash !== resource.bodyHash
      && now() - previous.checkedAt >= Math.min(intervalMs, 60000) && now() - previous.checkedAt <= maxAge;
    const stalled = previous?.imageHash === resource.bodyHash && now() - (previous.firstSeenAt || previous.checkedAt) > maxAge;
    return { status: fresh || changing ? 'live' : validImage && !Number.isFinite(modified) && !stalled ? 'checking' : 'unverified',
      method: fresh ? 'Current operator camera image Last-Modified timestamp' : changing ? 'Operator camera image changed at its published update interval' : 'Camera image freshness not confirmed',
      probe: validImage ? { imageHash: resource.bodyHash, checkedAt: now(), firstSeenAt: previous?.imageHash === resource.bodyHash ? previous.firstSeenAt || previous.checkedAt : now() } : null,
      retryMs: intervalMs + 500, mediaKind: 'image', validUntil: fresh ? modified + maxAge : null,
      imageUpdatedAt: fresh ? new Date(modified).toISOString() : changing ? new Date(now()).toISOString() : null };
  }
  const { text } = await readProviderResource(entry.sourceUrl, { ...context, allowedHosts: new Set([pageHost]) });
  if (kind === 'earthcam') {
    const camera = publicJsonLiteral(text, 'json_base')?.cam?.[entry.verification.cameraKey];
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    if (!camera || normalize(camera.city) !== normalize(entry.city)) return { status: 'unverified', method: 'EarthCam camera identity not confirmed' };
    if (String(camera.liveon) !== 'true' || String(camera.cam_state) !== '1') return { status: 'offline', method: 'EarthCam operator camera status' };
    if (!camera.stream || /archive|backup|\.mp4(?:\/|\?|$)/i.test(camera.stream)) return { status: 'unverified' };
    const stream = publicHttpsUrl(camera.stream);
    if (!/^videos(?:-\d+)?\.earthcam\.com$/.test(stream.hostname)) return { status: 'unverified', method: 'EarthCam live host not recognized' };
    return verifyHls(stream.href, { ...context, allowedHosts: new Set([stream.hostname]) }, previous);
  }
  if (kind === 'skyline') {
    if (/<strong[^>]*>\s*OFFLINE\s*<\/strong>/i.test(text)) return { status: 'offline', method: 'Skyline operator offline status' };
    // Inspect the public player's live manifest only for availability. Playback
    // stays on Skyline; no video is embedded, downloaded, proxied or rehosted.
    const source = text.match(/new\s+Clappr\.Player\(\{[\s\S]{0,1000}?source:\s*['"](livee?\.m3u8\?[^'"\s]+)['"]/)?.[1];
    if (!source) return { status: 'unverified', method: 'Operator page available; live status not confirmed' };
    return verifyHls('https://hd-auth.skylinewebcams.com/' + source.replace(/^livee\./, 'live.'), { ...context, allowedHosts: new Set(['hd-auth.skylinewebcams.com']) }, previous);
  }
  return { status: 'unverified', method: 'Operator page available; live status not confirmed' };
}

function createCameraProviderVerifier(catalog, { fetchImpl = fetch, now = Date.now, concurrency = 3, timeoutMs = 8000 } = {}) {
  validateCameraProviders(catalog);
  const cache = new Map(); const pending = new Map(); const queue = new Map();
  let running = 0;
  function next() {
    while (running < Math.max(1, Math.min(4, concurrency)) && queue.size) {
      const [id, entry] = queue.entries().next().value; queue.delete(id); running++;
      const previous = cache.get(id)?.probe;
      const task = verifyCameraProvider(entry, { fetchImpl, now, previous, timeoutMs })
        .catch(() => ({ status: 'unavailable', method: 'Provider availability check failed' }))
        .then(result => {
          const ttl = result.status === 'live' ? LIVE_TTL : result.status === 'checking' ? result.retryMs || 10000 : result.status === 'unverified' && entry.verification.kind === 'page' ? PAGE_TTL : FAILURE_TTL;
          cache.set(id, { ...result, checkedAt: now(), expiresAt: result.validUntil ? Math.min(result.validUntil, now() + ttl) : now() + ttl });
        }).finally(() => { running--; pending.delete(id); next(); });
      pending.set(id, task);
    }
  }
  function schedule(location = null) {
    const stale = catalog.filter(entry => entry.verification.kind !== 'youtube-provider' && (!cache.has(entry.id) || cache.get(entry.id).expiresAt <= now()) && !pending.has(entry.id) && !queue.has(entry.id));
    stale.sort((a, b) => Number(b.city === location?.city && (!location?.countryCode || b.countryCode === location.countryCode)) - Number(a.city === location?.city && (!location?.countryCode || a.countryCode === location.countryCode)));
    for (const entry of stale) queue.set(entry.id, entry);
    if (location?.city && queue.size > 1) {
      const queued = [...queue.values()].sort((a, b) => Number(b.city === location.city && (!location.countryCode || b.countryCode === location.countryCode)) - Number(a.city === location.city && (!location.countryCode || a.countryCode === location.countryCode)));
      queue.clear(); for (const entry of queued) queue.set(entry.id, entry);
    }
    next();
  }
  function snapshot() {
    return catalog.map(entry => {
      const state = cache.get(entry.id); const fresh = state && state.expiresAt > now();
      const status = fresh ? state.status : pending.has(entry.id) || queue.has(entry.id) ? 'checking' : 'unverified';
      return { id: entry.id, destinationId: entry.destinationId, city: entry.city, country: entry.country, countryCode: entry.countryCode,
        title: entry.title, operator: entry.operator, sourceUrl: entry.sourceUrl,
        providerStatus: status, liveVerified: fresh && status === 'live' || false,
        liveCheckedAt: state ? new Date(state.checkedAt).toISOString() : null,
        liveVerificationMethod: state?.method || null,
        liveMediaKind: state?.mediaKind || 'video', liveImageUpdatedAt: state?.imageUpdatedAt || null,
        liveUpdateIntervalSeconds: entry.verification.kind === 'fresh-image' ? Number(entry.verification.updateIntervalSeconds) || null : null,
        livePlayback: { kind: 'provider', url: entry.sourceUrl, providerName: entry.operator },
      };
    });
  }
  function updateYouTubeStates(states) {
    for (const entry of catalog.filter(camera => camera.verification.kind === 'youtube-provider')) {
      const state = states?.get(entry.verification.videoId);
      const status = !states ? 'unavailable' : state?.live && state.public ? 'live' : 'offline';
      cache.set(entry.id, { status, checkedAt: now(), expiresAt: now() + (status === 'live' ? LIVE_TTL : FAILURE_TTL), method: 'YouTube live and public status; playback on operator' });
    }
  }
  return {
    read(location) { schedule(location); return snapshot(); }, snapshot, updateYouTubeStates,
    youtubeStatesFresh() { return catalog.filter(entry => entry.verification.kind === 'youtube-provider').every(entry => (cache.get(entry.id)?.expiresAt || 0) > now()); },
    async settle() { while (pending.size || queue.size) { next(); await Promise.all([...pending.values()]); } return snapshot(); },
    youtubeIds: catalog.filter(entry => entry.verification.kind === 'youtube-provider').map(entry => entry.verification.videoId),
  };
}

function providerCameraPost(camera, source) {
  return { ...camera, authorId: null, groupId: null, content: `${camera.title}. Watch on ${camera.operator}.`, likes: [], commentsCount: 0,
    createdAt: camera.liveCheckedAt, source, sourceLabel: 'Live Cameras', mediaType: 'video', mediaUrl: null,
    topic: 'Live Cameras', isLiveCamera: true, liveStreamTitle: camera.title, liveStreamChannel: camera.operator };
}

module.exports = { publicHttpsUrl, validateCameraProviders, readProviderResource, inspectLivePlaylist, publicJsonLiteral, verifyCameraProvider, createCameraProviderVerifier, providerCameraPost };
