const test = require('node:test');
const assert = require('node:assert/strict');
const { publicHttpsUrl, validateCameraProviders, readProviderResource, inspectLivePlaylist, verifyCameraProvider, createCameraProviderVerifier, providerCameraPost } = require('./travel-camera-providers');
const NOW = Date.parse('2026-10-24T20:00:00Z');
const fixture = (verification, overrides = {}) => ({ id: 'camera_provider_test_city', destinationId: 'GB:London', city: 'London', country: 'United Kingdom', countryCode: 'GB', title: 'City camera', operator: 'City operator', sourceUrl: 'https://camera.example.com/london', verification, ...overrides });
const playlist = (sequence, time = null) => `#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:${sequence}\n${time ? `#EXT-X-PROGRAM-DATE-TIME:${time}\n` : ''}#EXTINF:6,\nsegment1.ts\n#EXTINF:6,\nsegment2.ts\n`;
const ok = (text, headers = {}) => new Response(text, { status: 200, headers });

test('catalog validation rejects unknown cities, mismatched destination IDs and duplicate records', () => {
  const destinations = [{ city: 'London', countryCode: 'GB', slug: 'London' }];
  const entry = fixture({ kind: 'page' });
  assert.equal(validateCameraProviders([entry], destinations).length, 1);
  assert.throws(() => validateCameraProviders([entry, entry], destinations), /duplicate/);
  assert.throws(() => validateCameraProviders([{ ...entry, city: 'Paris' }], destinations), /outside/);
  assert.throws(() => validateCameraProviders([{ ...entry, destinationId: 'US:London' }], destinations), /outside/);
  assert.throws(() => validateCameraProviders([fixture({ kind: 'invented' })]), /Unsupported/);
});

test('provider fetches reject unsafe URLs and unapproved redirects before contacting their targets', async () => {
  for (const url of ['http://camera.example.com/', 'https://localhost/', 'https://127.0.0.1/', 'https://camera.example.com:444/', 'https://user:pass@camera.example.com/']) assert.throws(() => publicHttpsUrl(url));
  let calls = 0;
  await assert.rejects(readProviderResource('https://camera.example.com/london', {
    allowedHosts: new Set(['camera.example.com']), fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/' } }); },
  }), /approved/);
  assert.equal(calls, 1);
});

test('provider reads enforce byte limits and do not expose upstream response bodies in errors', async () => {
  await assert.rejects(readProviderResource('https://camera.example.com/', { fetchImpl: async () => ok('x'.repeat(101)), maxBytes: 100 }), /too large/);
  await assert.rejects(readProviderResource('https://camera.example.com/', { fetchImpl: async () => new Response('secret upstream body', { status: 503 }) }), error => error.message === 'Camera provider returned HTTP 503');
});

test('an old rolling playlist is not live until its sequence advances or a recent program timestamp is present', () => {
  const initial = inspectLivePlaylist(playlist(10), null, NOW);
  assert.equal(initial.status, 'checking');
  assert.equal(inspectLivePlaylist(playlist(10), initial.probe, NOW + 7000).status, 'checking');
  assert.equal(inspectLivePlaylist(playlist(10), initial.probe, NOW + 35000).status, 'checking', 'allows ordinary provider cache delay without declaring live');
  assert.equal(inspectLivePlaylist(playlist(10), initial.probe, NOW + 121000).status, 'unverified', 'stopped sequence does not stay checking forever');
  assert.equal(inspectLivePlaylist(playlist(11), initial.probe, NOW + 7000).status, 'live');
  assert.equal(inspectLivePlaylist(playlist(11), initial.probe, NOW + 20 * 60000).status, 'checking');
  assert.equal(inspectLivePlaylist(playlist(1, new Date(NOW - 10000).toISOString()), null, NOW).status, 'live');
  assert.equal(inspectLivePlaylist(playlist(1, '2020-01-01T00:00:00Z'), null, NOW).status, 'checking');
  assert.equal(inspectLivePlaylist(playlist(1) + '#EXT-X-ENDLIST\n', null, NOW).status, 'offline');
});

test('Skyline OFFLINE overrides its generic isLiveBroadcast metadata', async () => {
  const entry = fixture({ kind: 'skyline' }, { sourceUrl: 'https://www.skylinewebcams.com/en/webcam/city.html' });
  const result = await verifyCameraProvider(entry, { now: () => NOW, fetchImpl: async () => ok('<script>{"isLiveBroadcast":true}</script><strong>OFFLINE</strong>') });
  assert.equal(result.status, 'offline');
});

test('Skyline checks only the live playlist, and opens its official page rather than exposing stream tokens', async () => {
  const calls = [];
  const entry = fixture({ kind: 'skyline' }, { sourceUrl: 'https://www.skylinewebcams.com/en/webcam/city.html' });
  const result = await verifyCameraProvider(entry, { now: () => NOW, previous: { lastSequence: 10, checkedAt: NOW - 10000 }, fetchImpl: async url => {
    calls.push(url);
    if (url.includes('/en/webcam/')) return ok("new Clappr.Player({nkey:'1.jpg',source:'livee.m3u8?a=temporary-public-token'});");
    assert.equal(new URL(url).hostname, 'hd-auth.skylinewebcams.com');
    return ok(playlist(11));
  } });
  assert.equal(result.status, 'live'); assert.equal(calls.length, 2);
  assert.equal(JSON.stringify(result).includes('temporary-public-token'), false);
});

test('IPCamLive requires the correct alias, enabled stream and no PIN or time-shift', async () => {
  const entry = fixture({ kind: 'ipcamlive', alias: 'test-camera' });
  const live = { alias: 'test-camera', enabled: '1', streamavailable: '1', streamid: 'active-stream', pinlockenabled: '0', timeshiftenabled: '0' };
  for (const [change, expected] of [[{}, 'live'], [{ enabled: '0' }, 'offline'], [{ streamavailable: '0' }, 'offline'], [{ alias: 'other-camera' }, 'unverified'], [{ pinlockenabled: '1' }, 'unverified'], [{ timeshiftenabled: '1' }, 'unverified']]) {
    const result = await verifyCameraProvider(entry, { fetchImpl: async () => ok(JSON.stringify({ details: { ...live, ...change } })) });
    assert.equal(result.status, expected);
  }
});

test('YouTube provider playback can be public-live without embedding, but private, ended and unverified sources stay out', () => {
  let now = NOW;
  const entry = fixture({ kind: 'youtube-provider', videoId: 'retained001' });
  const service = createCameraProviderVerifier([entry], { now: () => now, fetchImpl: async () => { throw new Error('No extra API request permitted'); } });
  service.updateYouTubeStates(new Map([['retained001', { live: true, public: true, embeddable: false }]]));
  assert.equal(service.read()[0].liveVerified, true);
  assert.equal(service.youtubeStatesFresh(), true);
  assert.equal(service.read()[0].livePlayback.url, entry.sourceUrl);
  now += 3 * 60000 + 1;
  assert.equal(service.read()[0].liveVerified, false);
  assert.equal(service.youtubeStatesFresh(), false);
  for (const state of [{ live: true, public: false }, { live: false, public: true }]) {
    service.updateYouTubeStates(new Map([['retained001', state]]));
    assert.equal(service.snapshot()[0].liveVerified, false);
  }
  service.updateYouTubeStates(null);
  assert.equal(service.snapshot()[0].providerStatus, 'unavailable');
});

test('a reachable camera page remains separate from verified live feeds', async () => {
  const service = createCameraProviderVerifier([fixture({ kind: 'page' })], { now: () => NOW, fetchImpl: async () => ok('<h1>Live camera</h1>') });
  assert.equal(service.read()[0].liveVerified, false);
  const rows = await service.settle();
  assert.equal(rows[0].providerStatus, 'unverified'); assert.equal(rows[0].liveVerified, false);
});

test('background checks are bounded, deduplicated and expire instead of presenting stale live status', async () => {
  let active = 0; let peak = 0; let calls = 0; let now = NOW;
  const release = [];
  const service = createCameraProviderVerifier(Array.from({ length: 7 }, (_, i) => fixture({ kind: 'ipcamlive', alias: `camera-${i}` }, { id: `camera_provider_test_${i}` })), { concurrency: 2, now: () => now,
    fetchImpl: async url => { active++; calls++; peak = Math.max(peak, active); await new Promise(resolve => release.push(resolve)); active--;
      return ok(JSON.stringify({ details: { alias: new URL(url).searchParams.get('alias'), enabled: '1', streamavailable: '1', streamid: 'live' } })); },
  });
  service.read(); service.read(); assert.equal(calls, 2);
  for (let step = 0; step < 7; step++) { release.splice(0).forEach(resolve => resolve()); await new Promise(resolve => setImmediate(resolve)); }
  const rows = await service.settle(); assert.equal(peak, 2); assert.equal(calls, 7); assert.ok(rows.every(row => row.liveVerified));
  now += 3 * 60000 + 1; assert.ok(service.snapshot().every(row => !row.liveVerified));
});

test('fresh camera images need a current Last-Modified timestamp and real image content', async () => {
  const entry = fixture({ kind: 'fresh-image', url: 'https://camera.example.com/current.jpg', allowedHosts: ['camera.example.com'], updateIntervalSeconds: 60 });
  const jpeg = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(200)]);
  const result = await verifyCameraProvider(entry, { now: () => NOW, fetchImpl: async () => ok(jpeg, { 'content-type': 'image/jpeg', 'last-modified': new Date(NOW - 60000).toUTCString() }) });
  assert.equal(result.status, 'live'); assert.equal(result.mediaKind, 'image');
  for (const [body, modified] of [[jpeg, 'Mon, 01 Jan 2020 00:00:00 GMT'], [jpeg, null], ['not an image'.repeat(20), new Date(NOW).toUTCString()]]) {
    const invalid = await verifyCameraProvider(entry, { now: () => NOW, fetchImpl: async () => ok(body, { 'content-type': 'image/jpeg', ...(modified ? { 'last-modified': modified } : {}) }) });
    assert.notEqual(invalid.status, 'live');
  }
});

test('camera images without Last-Modified must actually change at their published update interval', async () => {
  const entry = fixture({ kind: 'fresh-image', url: 'https://camera.example.com/current.jpg', allowedHosts: ['camera.example.com'], updateIntervalSeconds: 60 });
  let body = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(200)]); let now = NOW;
  const options = { now: () => now, fetchImpl: async () => ok(body, { 'content-type': 'image/jpeg' }) };
  const initial = await verifyCameraProvider(entry, options); assert.equal(initial.status, 'checking');
  now += 61000;
  const unchanged = await verifyCameraProvider(entry, { ...options, previous: initial.probe }); assert.notEqual(unchanged.status, 'live');
  body = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(200, 1)]);
  const changed = await verifyCameraProvider(entry, { ...options, previous: initial.probe }); assert.equal(changed.status, 'live'); assert.equal(changed.mediaKind, 'image');
});

test('provider post payload preserves its own camera identity and external playback metadata', () => {
  const row = { ...fixture({ kind: 'page' }), livePlayback: { kind: 'provider', url: 'https://camera.example.com/london', providerName: 'City operator' }, liveVerified: true };
  const post = providerCameraPost(row, 'livecamera');
  assert.equal(post.id, row.id); assert.equal(post.sourceUrl, row.sourceUrl); assert.equal(post.mediaUrl, null); assert.deepEqual(post.livePlayback, row.livePlayback);
});

test('EarthCam selects the exact city camera live stream and never uses its archive backup', async () => {
  const entry = fixture({ kind: 'earthcam', cameraKey: 'london' }, { sourceUrl: 'https://www.earthcam.com/world/england/london/' });
  const camera = { city: 'London', liveon: 'true', cam_state: '1', stream: 'https://videos-3.earthcam.com/live/camera.flv/playlist.m3u8', backup_clip: 'https://video2archives.earthcam.com/backup.mp4' };
  let calls = [];
  const check = overrides => verifyCameraProvider(entry, { now: () => NOW, previous: { lastSequence: 10, checkedAt: NOW - 10000 }, fetchImpl: async url => {
    calls.push(url);
    if (url.includes('www.earthcam.com')) return ok(`var json_base = ${JSON.stringify({ cam: { london: { ...camera, ...overrides }, paris: { city: 'Paris' } } })};`);
    assert.equal(url, camera.stream); return ok(playlist(12));
  } });
  assert.equal((await check({})).status, 'live'); assert.equal(calls.length, 2);
  for (const override of [{ city: 'Paris' }, { stream: camera.backup_clip }, { stream: '' }, { cam_state: '0' }]) {
    calls = []; assert.notEqual((await check(override)).status, 'live'); assert.equal(calls.length, 1);
  }
});

test('Baltic Live Cam verifies only the configured camera stream from its public player response', async () => {
  const entry = fixture({ kind: 'balticlivecam', cameraId: 187, streamPath: '/blc/Domu/' }, { sourceUrl: 'https://balticlivecam.com/cameras/latvia/riga/domcik/' });
  let stream = 'https://edge01.balticlivecam.com/blc/Domu/index.m3u8?token=public-temporary';
  const calls = [];
  const options = { now: () => NOW, fetchImpl: async url => { calls.push(url); return ok(url.includes('admin-ajax') ? `sources: [{ src: '${stream}', type:'application/x-mpegurl' }]` : playlist(1, new Date(NOW - 6000).toISOString())); } };
  assert.equal((await verifyCameraProvider(entry, options)).status, 'live');
  assert.ok(calls[0].includes('action=auth_token&id=187&embed=0'));
  for (const invalid of ['https://edge01.balticlivecam.com/blc/Other/index.m3u8', 'https://attacker.example.com/blc/Domu/index.m3u8']) {
    stream = invalid; calls.length = 0;
    assert.equal((await verifyCameraProvider(entry, options)).status, 'unverified'); assert.equal(calls.length, 1);
  }
});

test('Roundshot uses the exact current camera image and its real HTTP timestamp, never a best shot or local wall-clock metadata', async () => {
  const entry = fixture({ kind: 'roundshot', cameraId: 86, imageHost: 'storage4.roundshot.com' }, { sourceUrl: 'https://zuerichtourismus.roundshot.com/stadthaus/' });
  const jpeg = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(200)]);
  let settings = { id: 86, url: entry.sourceUrl, last_image: 123, settings: { en: { cam_inactive: false } } };
  let latest = { id: 123, status: 'finished', datetime: 99999999999, structure: { oneeighth: { url_full: 'https://storage4.roundshot.com/camera/current.jpg' } } };
  let modified = new Date(NOW - 60000).toUTCString();
  const options = { now: () => NOW, fetchImpl: async url => url.endsWith('settings.json') ? ok(JSON.stringify(settings)) : url.endsWith('structure.json') ? ok(JSON.stringify({ cam_inactive: false, images: [latest] })) : ok(jpeg, { 'content-type': 'image/jpeg', 'last-modified': modified }) };
  const live = await verifyCameraProvider(entry, options); assert.equal(live.status, 'live'); assert.equal(live.mediaKind, 'image');
  assert.equal(live.imageUpdatedAt, new Date(NOW - 60000).toISOString());
  modified = new Date(NOW - 16 * 60000).toUTCString(); assert.equal((await verifyCameraProvider(entry, options)).status, 'unverified');
  latest = { ...latest, is_best_shot: true }; assert.equal((await verifyCameraProvider(entry, options)).status, 'unverified');
  settings = { ...settings, id: 999 }; assert.equal((await verifyCameraProvider(entry, options)).status, 'unverified');
});

test('image live status expires when the actual image exceeds its freshness limit even before the normal cache TTL', async () => {
  let now = NOW;
  const entry = fixture({ kind: 'fresh-image', url: 'https://camera.example.com/current.jpg', allowedHosts: ['camera.example.com'], maxAgeSeconds: 900 });
  const jpeg = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(200)]);
  const service = createCameraProviderVerifier([entry], { now: () => now, fetchImpl: async () => ok(jpeg, { 'content-type': 'image/jpeg', 'last-modified': new Date(NOW - 14 * 60000).toUTCString() }) });
  service.read(); await service.settle(); assert.equal(service.snapshot()[0].liveVerified, true);
  now += 61000; assert.equal(service.snapshot()[0].liveVerified, false);
  service.read(); await service.settle(); assert.equal(service.snapshot()[0].liveVerified, false);
});

test('HLS timestamp evidence expires at its freshness bound instead of getting a second full live TTL', async () => {
  let now = NOW;
  const entry = fixture({ kind: 'hls', url: 'https://camera.example.com/live.m3u8', allowedHosts: ['camera.example.com'] });
  const service = createCameraProviderVerifier([entry], { now: () => now, fetchImpl: async () => ok(playlist(1, new Date(NOW - 179000).toISOString())) });
  service.read(); await service.settle(); assert.equal(service.snapshot()[0].liveVerified, true);
  now += 1001; assert.equal(service.snapshot()[0].liveVerified, false);
});

test('selecting a city promotes an already queued check without duplicating or interrupting the running request', async () => {
  let release; const calls = [];
  const entries = ['London', 'Oxford', 'Leeds'].map(city => fixture({ kind: 'page' }, { id: `camera_provider_test_${city.toLowerCase()}`, city, sourceUrl: `https://camera.example.com/${city}` }));
  const service = createCameraProviderVerifier(entries, { concurrency: 1, fetchImpl: async url => { calls.push(new URL(url).pathname); await new Promise(resolve => { release = resolve; }); return ok('<p>Camera</p>'); } });
  service.read(); service.read({ city: 'Leeds', countryCode: 'GB' }); assert.deepEqual(calls, ['/London']);
  release(); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(calls, ['/London', '/Leeds']);
  release(); await new Promise(resolve => setImmediate(resolve)); release(); await service.settle(); assert.deepEqual(calls, ['/London', '/Leeds', '/Oxford']);
});

test('Livespotting accepts only its own bounded CDN redirects and the exact city metadata', async () => {
  const entry = fixture({ kind: 'livespotting', cameraId: '8o4b2fw4' }, { city: 'Hamburg', sourceUrl: 'https://www.livespotting.tv/deutschland/hamburg/8o4b2fw4' });
  let city = 'Hamburg'; let redirect = 'https://ch-fra-n16.livespotting.com/live.m3u8';
  const options = { now: () => NOW, fetchImpl: async url => {
    if (url.includes('/v2/livesource/')) return ok(JSON.stringify({ id: '8o4b2fw4', city, source: 'https://cdn.livespotting.com/live.m3u8' }));
    if (url.includes('cdn.livespotting')) return new Response('', { status: 302, headers: { location: redirect } });
    return ok(playlist(1, new Date(NOW - 6000).toISOString()));
  } };
  assert.equal((await verifyCameraProvider(entry, options)).status, 'live');
  redirect = 'https://attacker.example.com/live.m3u8'; await assert.rejects(verifyCameraProvider(entry, options), /approved public HTTPS/);
  city = 'Berlin'; assert.equal((await verifyCameraProvider(entry, options)).status, 'unverified');
});

test('dynamic camera freshness failures retry promptly when the operator publishes a new image', async () => {
  let now = NOW; let fresh = false; let calls = 0;
  const entry = fixture({ kind: 'fresh-image', url: 'https://camera.example.com/current.jpg', allowedHosts: ['camera.example.com'] });
  const jpeg = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(200)]);
  const service = createCameraProviderVerifier([entry], { now: () => now, fetchImpl: async () => { calls++; return ok(jpeg, { 'content-type': 'image/jpg', 'last-modified': new Date(fresh ? now : NOW - 3600000).toUTCString() }); } });
  service.read(); await service.settle(); assert.equal(service.snapshot()[0].liveVerified, false);
  now += 120001; fresh = true; service.read(); await service.settle();
  assert.equal(calls, 2); assert.equal(service.snapshot()[0].liveVerified, true);
});

test('YouTube provider channel IDs require their exact format and provider kind', () => {
  for (const verification of [
    { kind: 'youtube-provider', videoId: 'retained001', channelId: 'not-a-channel' },
    { kind: 'youtube-provider', videoId: 'retained001', channelId: `UC${'a'.repeat(21)}` },
    { kind: 'youtube-provider', videoId: 'retained001', channelId: `UC${'!'.repeat(22)}` },
    { kind: 'page', channelId: `UC${'a'.repeat(22)}` },
    { kind: 'youtube-provider', videoId: 'retained001', channelId: [`UC${'a'.repeat(22)}`] },
  ]) assert.throws(() => validateCameraProviders([fixture(verification)]), /channel ID/);
  assert.doesNotThrow(() => validateCameraProviders([fixture({ kind: 'youtube-provider', videoId: 'retained001', channelId: `UC${'a'.repeat(22)}` })]));
});

test('timestamp-less camera images expire and cannot reuse an old hash as current proof', async () => {
  const entry = fixture({ kind: 'fresh-image', url: 'https://camera.example.com/current.jpg', allowedHosts: ['camera.example.com'], updateIntervalSeconds: 60, maxAgeSeconds: 180 });
  let now = NOW; let variant = 0;
  const options = { now: () => now, fetchImpl: async () => ok(Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(200, variant)]), { 'content-type': 'image/jpeg' }) };
  const initial = await verifyCameraProvider(entry, options); assert.equal(initial.status, 'checking');
  now += 61000; variant++;
  const fresh = await verifyCameraProvider(entry, { ...options, previous: initial.probe });
  assert.equal(fresh.status, 'live'); assert.equal(fresh.mediaKind, 'image');
  now += 180001; variant++;
  const expired = await verifyCameraProvider(entry, { ...options, previous: fresh.probe });
  assert.notEqual(expired.status, 'live'); assert.equal(expired.imageUpdatedAt, null);
});

test('resolved YouTube video IDs override only their specific provider entry and preserve the default lookup', () => {
  const first = fixture({ kind: 'youtube-provider', videoId: 'retained001' });
  const second = fixture({ kind: 'youtube-provider', videoId: 'retained001' }, { id: 'camera_provider_test_other' });
  const service = createCameraProviderVerifier([first, second], { now: () => NOW });
  const states = new Map([['retained001', { live: false, public: true }], ['replacement', { live: true, public: true }]]);
  service.updateYouTubeStates(states, new Map([[first.id, 'replacement']]));
  assert.deepEqual(service.snapshot().map(row => row.liveVerified), [true, false]);
  service.updateYouTubeStates(states);
  assert.deepEqual(service.snapshot().map(row => row.liveVerified), [false, false]);
});
