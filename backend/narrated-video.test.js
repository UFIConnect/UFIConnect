const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { createNarratedVideoProvider, buildNarratedTimeline } = require('./narrated-video');

const id = '2abd5c11-0f3d-4c6d-ba20-235fc9b8e8b7';
const scenes = count => Array.from({ length: count }, () => ({
  narration: 'Discover the quiet beauty of a community garden.',
  imagePrompt: 'A sunlit community garden with leafy vegetables.',
}));
function transport(respond) {
  const calls = [];
  return { calls, request(options, callback) {
    const req = new EventEmitter(); let body = '';
    req.write = chunk => { body += chunk; }; req.setTimeout = () => {};
    req.destroy = error => req.emit('error', error);
    req.end = () => setImmediate(() => {
      calls.push({ ...options, body: body ? JSON.parse(body) : null });
      const result = respond(calls.at(-1));
      const res = Readable.from([JSON.stringify(result.body)]);
      res.statusCode = result.status || 200; callback(res);
    });
    return req;
  } };
}

test('narrated timeline has exact duration, complete scene coverage and synchronized captions', () => {
  for (const duration of [12, 30, 149, 300]) {
    const timeline = buildNarratedTimeline({ scenes: scenes(Math.ceil(duration / 20)) }, duration, 36);
    assert.equal(timeline.output.range.length, duration);
    const [captions, speech, images] = timeline.timeline.tracks;
    assert.equal(images.clips.length, Math.ceil(duration / 20));
    images.clips.forEach((clip, i) => {
      assert.equal(clip.start, speech.clips[i].start);
      assert.equal(clip.length, speech.clips[i].length);
      assert.equal(captions.clips[i].asset.src, 'alias://' + speech.clips[i].alias);
      if (i) assert.ok(Math.abs(images.clips[i - 1].start + images.clips[i - 1].length - clip.start) < 0.001);
    });
    const last = images.clips.at(-1);
    assert.ok(Math.abs(last.start + last.length - duration) < 0.001);
  }
  assert.throws(() => buildNarratedTimeline({ scenes: scenes(15) }, 301, 36));
  assert.throws(() => buildNarratedTimeline({ scenes: scenes(1) }, 300, 36), /scene count/);
  assert.throws(() => buildNarratedTimeline({ scenes: scenes(1) }, 4, 4), /fit the selected duration/);
});

test('creates one asynchronous render with scoped credentials and no retained OpenAI response', async () => {
  const network = transport(call => ({ body: call.hostname === 'api.openai.com'
    ? { output_text: JSON.stringify({ scenes: scenes(15) }) } : { success: true, response: { id } } }));
  const provider = createNarratedVideoProvider({ env: { SHOTSTACK_API_KEY: 'render-key', OPENAI_API_KEY: 'text-key' }, transport: network });
  assert.equal(provider.configured(), true);
  assert.deepEqual(await provider.create('A garden tour', 300), { id, stage: 'v1', durationSeconds: 300 });
  assert.equal(network.calls.length, 2);
  assert.equal(network.calls[0].headers.Authorization, 'Bearer text-key');
  assert.equal(network.calls[0].body.store, false);
  assert.equal(network.calls[1].headers['x-api-key'], 'render-key');
  assert.equal(network.calls[1].headers.Authorization, undefined);
  assert.equal(network.calls[1].body.output.range.length, 300);
});

test('malformed or overlong storyboards and locked lengths do not start paid renders', async () => {
  const network = transport(() => ({ body: { output_text: '{"scenes":[]}' } }));
  const provider = createNarratedVideoProvider({ env: { SHOTSTACK_API_KEY: 'render-key', OPENAI_API_KEY: 'text-key' }, transport: network });
  await assert.rejects(provider.create('A garden tour', 1800));
  assert.equal(network.calls.length, 0);
  await assert.rejects(provider.create('A garden tour', 300), /scene count/);
  assert.equal(network.calls.length, 1);
  assert.equal(createNarratedVideoProvider({ env: { SHOTSTACK_API_KEY: 'render-key' } }).configured(), false);
});

test('polling validates job identity, duration and completed media before saving', async () => {
  let result = { id, status: 'rendering' };
  const network = transport(() => ({ body: { success: true, response: result } }));
  const provider = createNarratedVideoProvider({ env: { SHOTSTACK_API_KEY: 'render-key' }, transport: network });
  assert.deepEqual(await provider.status(id), { status: 'processing' });
  result = { id, status: 'done', duration: 300, url: 'https://cdn.shotstack.io/movie.mp4' };
  assert.equal((await provider.status(id)).status, 'completed');
  result.duration = 1800;
  await assert.rejects(provider.status(id), /duration/);
  result.duration = 300; result.url = 'http://unsafe.example/movie';
  await assert.rejects(provider.status(id), /URL/);
  result.id = 'different';
  await assert.rejects(provider.status(id), /different render job/);
  result = { id, status: 'failed', error: 'secret provider detail' };
  assert.doesNotMatch((await provider.status(id)).error, /secret/);
  await assert.rejects(provider.status('../jobs'), /Invalid/);
});

module.exports = { transport };
