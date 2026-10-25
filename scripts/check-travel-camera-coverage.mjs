// Replays independently captured provider observations through the actual feed
// implementation. Evidence times remain explicit; this never invents liveness.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [youtubeFile, providerFile, outputFile] = process.argv.slice(2);
assert.ok(youtubeFile && providerFile && outputFile, 'Usage: node scripts/check-travel-camera-coverage.mjs youtube-report.json provider-report.json output.json');
const youtube = JSON.parse(await fs.readFile(youtubeFile));
const observations = JSON.parse(await fs.readFile(providerFile));
const videos = new Map((youtube.videos || youtube.rows).map(video => [video.videoId || video.id, video]));
assert.ok(Number.isFinite(Date.parse(youtube.checkedAt)) && Number.isFinite(Date.parse(observations.checkedAt)), 'Reports must include actual check times');
const providerModule = require('../backend/travel-camera-providers');
const providerCatalog = require('../backend/travel-camera-providers.json');
const travelProviders = require('../backend/travel-providers');
const { createAppHarness } = require('../backend/test-support/app-harness');
const service = providerModule.createCameraProviderVerifier(providerCatalog.filter(entry => entry.verification.kind === 'youtube-provider'));
const observedProviders = providerCatalog.filter(entry => entry.verification.kind !== 'youtube-provider').map(entry => {
  const observed = observations.providers.find(row => row.id === entry.id);
  if (observed) { assert.equal(observed.sourceUrl, entry.sourceUrl); assert.equal(observed.city, entry.city); return observed; }
  return { ...entry, liveVerified: false, providerStatus: 'unverified', liveCheckedAt: null, livePlayback: { kind: 'provider', url: entry.sourceUrl, providerName: entry.operator } };
});
let app;
app = await createAppHarness({ env: { YOUTUBE_API_KEY: 'evidence-replay-only' }, modules: {
  './travel-camera-providers': { ...providerModule, createCameraProviderVerifier: () => ({
    read: () => [...observedProviders, ...service.snapshot()], snapshot: () => [...observedProviders, ...service.snapshot()],
    updateYouTubeStates: states => service.updateYouTubeStates(states), youtubeStatesFresh: () => service.youtubeStatesFresh(), youtubeIds: service.youtubeIds,
  }) },
  './travel-providers': { ...travelProviders, fetchTravelResource: async url => {
    if (!url.includes('/videos?')) throw new Error('Only recorded camera status is available in this replay');
    app.setYouTubeCallReady();
    return { items: new URL(url).searchParams.get('id').split(',').flatMap(id => {
      const video = videos.get(id); if (!video) return [];
      return [{ id, snippet: { title: video.title || video.snippet?.title, channelTitle: video.channelTitle || video.snippet?.channelTitle },
        status: { privacyStatus: video.public ? 'public' : 'private', embeddable: Boolean(video.embeddable) },
        liveStreamingDetails: video.live ? { actualStartTime: youtube.checkedAt } : { actualStartTime: youtube.checkedAt, actualEndTime: youtube.checkedAt } }];
    }) };
  } },
} });
try {
  app.exhaustCameraDiscoveryBudget();
  const feed = await app.getCountriesCameraFeed(null);
  const cities = app.COUNTRIES_DESTINATION_GUIDES.map(destination => {
    const matches = row => row.city === destination.city && row.countryCode === destination.countryCode;
    const cameras = feed.liveFeeds.filter(matches);
    const external = feed.travel.cameraProviders.filter(matches);
    return { destinationId: `${destination.countryCode}:${destination.slug}`, city: destination.city, country: destination.country, countryCode: destination.countryCode,
      status: cameras.length ? 'verified-at-observation' : external.some(row => row.providerStatus === 'checking') ? 'checking' : external.length ? 'operator-page-only' : 'no-verified-camera',
      inlineVideo: cameras.some(row => row.livePlayback?.kind !== 'provider'), externalVideo: cameras.some(row => row.livePlayback?.kind === 'provider' && row.liveMediaKind !== 'image'),
      cameraImage: cameras.some(row => row.liveMediaKind === 'image'),
      cameras: cameras.map(camera => ({ id: camera.id, title: camera.liveStreamTitle || camera.title, sourceUrl: camera.sourceUrl, playback: camera.livePlayback?.kind || 'youtube', mediaKind: camera.liveMediaKind || 'video',
        checkedAt: camera.livePlayback?.kind === 'provider' && providerCatalog.find(row => row.id === camera.id)?.verification.kind !== 'youtube-provider' ? camera.liveCheckedAt : youtube.checkedAt })),
      operatorPages: external.filter(row => !row.liveVerified).map(row => ({ id: row.id, url: row.sourceUrl, status: row.providerStatus, checkedAt: row.liveCheckedAt, method: row.liveVerificationMethod })),
    };
  });
  assert.equal(cities.length, 91); assert.equal(new Set(cities.map(city => city.destinationId)).size, 91);
  const sourceHashes = {};
  for (const file of ['backend/index.js', 'backend/travel-camera-streams.json', 'backend/travel-camera-providers.json', 'backend/travel-camera-providers.js', 'backend/travel-destinations.js', 'web/src/pages/Feed.jsx', 'web/src/components/TravelProviderCamera.jsx', 'web/src/components/travelCameraPlayback.mjs']) sourceHashes[file] = crypto.createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
  const verified = cities.filter(city => city.cameras.length);
  const result = { preparedAt: new Date().toISOString(), youtubeCheckedAt: youtube.checkedAt, providersCheckedAt: observations.checkedAt,
    method: 'Actual feed implementation replayed against independent public status observations. These are observation counts, not a guarantee of continuous third-party uptime.', sourceHashes,
    evidence: { youtube: path.resolve(youtubeFile), providers: path.resolve(providerFile) },
    total: 91, verifiedCities: verified.length, inlineVideoCities: cities.filter(city => city.inlineVideo).length,
    externalVideoCities: cities.filter(city => city.externalVideo).length, cameraImageCities: cities.filter(city => city.cameraImage).length,
    remaining: cities.filter(city => !city.cameras.length).map(({ city, country, status }) => ({ city, country, status })), cities };
  await fs.writeFile(outputFile, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, cities: undefined, sourceHashes: undefined, evidence: undefined }));
} finally { await app.close(); }
