const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createYouTubeCameraChannelResolver } = require('./youtube-camera-channels');

const channelId = 'UCfVBWzBee1rnmR8AhT2Esng';
const otherChannel = 'UCn4oQ60oxfvq7aesEPYqpKw';
const originalId = 'oldCamera01';
const nextId = 'newCamera02';
const provider = (id = 'camera_provider_my_kl', channel = channelId) => ({ id, verification: { kind: 'youtube-provider', videoId: originalId, ...(channel ? { channelId: channel } : {}) } });
const live = { live: true, public: true, embeddable: false };
const ended = { live: false, public: true, embeddable: true };
const item = (videoId = nextId, channel = channelId) => ({ id: { videoId }, snippet: { channelId: channel, liveBroadcastContent: 'live' } });
const noCalls = { searchChannel() { throw new Error('Unexpected search'); }, fetchStates() { throw new Error('Unexpected verification'); } };

test('API outage cannot search, change candidate identity, or supply live proof', async () => {
  const resolver = createYouTubeCameraChannelResolver([provider()]);
  let calls = 0;
  const callbacks = { searchChannel: () => { calls++; }, fetchStates: () => { calls++; } };
  assert.equal(await resolver.resolve(null, callbacks), null);
  assert.equal(calls, 0);
  assert.deepEqual(resolver.videoIds, [originalId]);
  assert.equal(resolver.resolvedIds.get(provider().id), originalId);
});

test('a public live current ID is reused without discovery, including VM status Maps', async () => {
  const resolver = createYouTubeCameraChannelResolver([provider()]);
  const states = vm.runInNewContext(`new Map([['${originalId}', { live: true, public: true }]])`);
  const result = await resolver.resolve(states, noCalls);
  assert.equal(result.get(originalId).live, true);
  assert.notEqual(result, states);
  const exposed = resolver.resolvedIds;
  exposed.set(provider().id, 'alteredId01');
  assert.equal(resolver.resolvedIds.get(provider().id), originalId);
});

test('a restarted channel selects an exact-channel public live candidate and merges only its fresh proof', async () => {
  const resolver = createYouTubeCameraChannelResolver([provider()]);
  const states = new Map([[originalId, ended], ['unrelated01', live]]);
  const calls = [];
  const result = await resolver.resolve(states, {
    searchChannel: async (channel, options) => { calls.push({ channel, options }); return { items: [item()] }; },
    fetchStates: async ids => { calls.push({ ids }); return new Map([[nextId, live], ['unknownId01', live]]); },
  });
  assert.deepEqual(calls, [{ channel: channelId, options: { maxResults: 5 } }, { ids: [nextId] }]);
  assert.equal(resolver.resolvedIds.get(provider().id), nextId);
  assert.deepEqual(resolver.videoIds, [nextId]);
  assert.deepEqual(result.get(nextId), live);
  assert.equal(result.has('unknownId01'), false);
  assert.equal(result.get(originalId), ended);
  assert.equal(states.has(nextId), false);
  assert.equal((await resolver.resolve(new Map([[nextId, live]]), noCalls)).get(nextId), live);
});

test('selected IDs survive as candidates, but verification proof never survives an API cycle', async () => {
  const resolver = createYouTubeCameraChannelResolver([provider()]);
  await resolver.resolve(new Map(), { searchChannel: async () => ({ items: [item()] }), fetchStates: async () => new Map([[nextId, live]]) });
  const nextCycle = await resolver.resolve(new Map(), { searchChannel: async () => ({ items: [] }), fetchStates: noCalls.fetchStates });
  assert.equal(nextCycle.has(nextId), false);
  assert.equal(resolver.resolvedIds.get(provider().id), nextId);
  assert.equal(await resolver.resolve(null, noCalls), null);
});

test('only the first five search items are eligible and all must match the configured channel', async () => {
  const resolver = createYouTubeCameraChannelResolver([provider()]);
  let verifications = 0;
  const response = { items: [item(nextId, otherChannel), { ...item(), snippet: { channelId } }, item('bad'), item(nextId, null), {}, item()] };
  const result = await resolver.resolve(new Map(), { searchChannel: async () => response, fetchStates: async () => { verifications++; return new Map([[nextId, live]]); } });
  assert.equal(verifications, 0);
  assert.equal(result.size, 0);
  assert.deepEqual(resolver.videoIds, [originalId]);
});

test('private, ended, conflicting-channel and truthy nonboolean states cannot replace a camera', async () => {
  for (const invalid of [{ live: true, public: false }, ended, { ...live, channelId: otherChannel }, { live: 'true', public: true }]) {
    const resolver = createYouTubeCameraChannelResolver([provider()]);
    const result = await resolver.resolve(new Map([[originalId, ended]]), {
      searchChannel: async () => ({ items: [item()] }), fetchStates: async () => new Map([[nextId, invalid]]),
    });
    assert.equal(result.has(nextId), false);
    assert.deepEqual(resolver.videoIds, [originalId]);
  }
});

test('empty, failed and unavailable lookups cool down ten minutes before retrying', async () => {
  for (const failure of ['empty', 'search-error', 'status-error', 'status-unavailable']) {
    let time = 1000; let searches = 0;
    const resolver = createYouTubeCameraChannelResolver([provider()], { now: () => time });
    const callbacks = {
      searchChannel: async () => { searches++; if (failure === 'search-error') throw new Error('quota'); return { items: failure === 'empty' ? [] : [item()] }; },
      fetchStates: async () => { if (failure === 'status-error') throw new Error('unavailable'); return null; },
    };
    assert.equal((await resolver.resolve(new Map(), callbacks)).size, 0);
    time += 10 * 60 * 1000 - 1;
    await resolver.resolve(new Map(), callbacks);
    assert.equal(searches, 1, failure);
    time++;
    await resolver.resolve(new Map(), callbacks);
    assert.equal(searches, 2, failure);
    assert.deepEqual(resolver.videoIds, [originalId]);
  }
});

test('provider rows without an explicitly configured channel cannot trigger search', async () => {
  const resolver = createYouTubeCameraChannelResolver([provider('fixed', null), { id: 'other', verification: { kind: 'hls' } }]);
  let calls = 0;
  const result = await resolver.resolve(new Map(), { searchChannel: async () => { calls++; return { items: [item()] }; }, fetchStates: async () => { calls++; } });
  assert.equal(calls, 0);
  assert.equal(result.size, 0);
  assert.deepEqual(resolver.videoIds, [originalId]);
  assert.throws(() => createYouTubeCameraChannelResolver([provider('invalid', 'arbitrary-channel-url')]), /identity/);
  assert.throws(() => createYouTubeCameraChannelResolver([provider('invalid', [channelId])]), /identity/);
  const invalidVideo = provider(); invalidVideo.verification.videoId = [originalId];
  assert.throws(() => createYouTubeCameraChannelResolver([invalidVideo]), /identity/);
});

test('an outage that supersedes pending channel search prevents candidate verification or promotion', async () => {
  const resolver = createYouTubeCameraChannelResolver([provider()]);
  let release; let fetches = 0;
  const pending = resolver.resolve(new Map(), {
    searchChannel: () => new Promise(resolve => { release = resolve; }),
    fetchStates: async () => { fetches++; return new Map([[nextId, live]]); },
  });
  assert.equal(await resolver.resolve(null), null);
  release({ items: [item()] });
  assert.equal(await pending, null);
  assert.equal(fetches, 0);
  assert.deepEqual(resolver.videoIds, [originalId]);
});

test('a newer API cycle invalidates an older in-flight verification result', async () => {
  const resolver = createYouTubeCameraChannelResolver([provider()]);
  let release; let entered;
  const fetching = new Promise(resolve => { entered = resolve; });
  const pending = resolver.resolve(new Map([[originalId, ended]]), {
    searchChannel: async () => ({ items: [item()] }),
    fetchStates: () => new Promise(resolve => { release = resolve; entered(); }),
  });
  await fetching;
  const current = await resolver.resolve(new Map([[originalId, live]]), noCalls);
  release(new Map([[nextId, live]]));
  const previous = await pending;
  assert.equal(previous, null);
  assert.equal(current.get(originalId), live);
  assert.deepEqual(resolver.videoIds, [originalId]);
});

test('an outstanding lookup stays deduplicated even after the cooldown clock passes', async () => {
  let time = 0; let release; let calls = 0;
  const resolver = createYouTubeCameraChannelResolver([provider()], { now: () => time });
  const callbacks = {
    searchChannel: () => { calls++; return new Promise(resolve => { release = resolve; }); },
    fetchStates: noCalls.fetchStates,
  };
  const first = resolver.resolve(new Map([['otherCamera', live]]), callbacks);
  time = 20 * 60 * 1000;
  assert.equal((await resolver.resolve(new Map(), callbacks)).size, 0);
  assert.equal(calls, 1);
  release({ items: [] });
  assert.equal(await first, null, 'even unrelated proof from a superseded batch is discarded');
});

test('candidate verification receives at most five unique IDs and ignores later search rows', async () => {
  const ids = ['camera00001', 'camera00002', 'camera00003', 'camera00004', 'camera00005', 'camera00006'];
  const resolver = createYouTubeCameraChannelResolver([provider()]);
  const result = await resolver.resolve(new Map(), {
    searchChannel: async () => ({ items: ids.map(id => item(id)) }),
    fetchStates: async received => {
      assert.deepEqual(received, ids.slice(0, 5));
      return new Map([[ids[4], live], [ids[5], live]]);
    },
  });
  assert.deepEqual(resolver.videoIds, [ids[4]]);
  assert.equal(result.has(ids[5]), false);
});
