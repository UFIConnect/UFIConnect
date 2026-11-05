'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createStudioProvider, publicMediaUrl } = require('./office-ai-studio-provider');
const env = { OPENAI_API_KEY: 'private-openai', SHOTSTACK_API_KEY: 'private-render', CLOUDINARY_CLOUD_NAME: 'fixture', CLOUDINARY_API_KEY: 'private-storage-key', CLOUDINARY_API_SECRET: 'private-storage-secret', OFFICE_STUDIO_RENDERER: 'shotstack' };
const project = { id: randomUUID(), title: 'The clockwork garden', prompt: 'An original robot plants a garden.', creativity: 'creative', producer: { brief: 'Hopeful science fiction', roles: ['Director','Continuity editor'] },
  characters: [{ name: 'Moss', appearance: 'Brass robot with a blue scarf', personality: 'Patient', voice: 'Gentle' }], kind: 'movie', renderStyle: 'narrated', durationSeconds: 3601 };
const chapter = { id: randomUUID(), index: 4, startSeconds: 480, durationSeconds: 4, previousSummary: 'Moss found a seed.' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('photos use configured image API and owned media storage without exposing credentials', async () => {
  const calls = [];
  const provider = createStudioProvider({ env, fetcher: async (url, options) => { calls.push({ url, options }); return json({ data: [{ b64_json: 'aGVsbG8=' }] }); },
    mediaStore: { image: async (encoded, id) => { assert.equal(encoded, 'aGVsbG8='); assert.equal(id, chapter.id); return 'https://res.cloudinary.com/fixture/image/upload/photo.png'; } } });
  const result = await provider.photo(project, chapter);
  assert.equal(result.status, 'completed');
  assert.equal(JSON.parse(calls[0].options.body).model, 'gpt-image-2');
  assert.match(JSON.parse(calls[0].options.body).prompt, /blue scarf/);
  assert.equal(calls[0].options.redirect, 'error');
  assert.doesNotMatch(JSON.stringify(result), /private-/);
});

test('narrated chapters preserve cast, producer and previous continuity in bounded storyboard and render jobs', async () => {
  const calls = [], jobId = randomUUID();
  const provider = createStudioProvider({ env, fetcher: async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return url.endsWith('/responses') ? json({ output_text: JSON.stringify({ summary: 'A seed takes root.', scenes: [{ narration: 'Moss plants the seed.', imagePrompt: 'Brass robot wearing a blue scarf plants a seed.' }] }) }) : json({ success: true, response: { id: jobId } });
  } });
  const result = await provider.chapter(project, chapter);
  assert.equal(result.jobId, jobId); assert.equal(result.provider, 'shotstack');
  assert.equal(calls.length, 2);
  const context = JSON.parse(calls[0].body.input);
  assert.equal(context.characterBible[0].voice, 'Gentle'); assert.equal(context.continuity.previousChapter, chapter.previousSummary);
  assert.equal(context.continuity.position, 'development');
  assert.match(calls[0].body.instructions, /exactly 1/);
  assert.equal(calls[1].body.output.range.length, 4);
  assert.equal(calls[1].body.timeline.tracks[2].clips.length, 1);
  assert.equal(result.storyboard.length, 1);
});

test('provider payment failures explain credits and ambiguous timeouts cannot be retried as known rejections', async () => {
  for (const [status, known] of [[402, true], [403, true], [408, false], [500, false]]) {
    const provider = createStudioProvider({ env, fetcher: async () => json({}, status) });
    await assert.rejects(provider.photo(project, chapter), error => {
      assert.equal(error.knownRejected, known);
      if (status === 402) assert.match(error.publicMessage, /payment or generation credits/);
      assert.doesNotMatch(error.publicMessage, /private-/); return true;
    });
  }
});

test('status downloads only from fixed Shotstack CDN and stores an owned copy instead of expiring job URL', async () => {
  const jobId = randomUUID(), requests = [];
  const provider = createStudioProvider({ env, mediaStore: { video: async (response, id) => { assert.equal(await response.text(), 'movie'); assert.equal(id, chapter.id); return 'https://res.cloudinary.com/fixture/video/upload/film.mp4'; } },
    fetcher: async (url, options) => { requests.push({ url, options }); return url.includes('api.shotstack.io')
      ? json({ success: true, response: { id: jobId, owner: 'verified-owner', duration: 4, status: 'done', url: 'https://attacker.invalid/never-fetch' } }) : new Response('movie'); } });
  const result = await provider.poll({ ...chapter, provider: 'shotstack', stage: 'v1', jobId });
  assert.equal(result.mediaUrl, 'https://res.cloudinary.com/fixture/video/upload/film.mp4');
  assert.equal(requests[1].url, `https://cdn.shotstack.io/au/v1/verified-owner/${jobId}.mp4`);
  assert.equal(requests[1].options.headers, undefined);
  assert.equal(requests.some(item => item.url.includes('attacker')), false);
  await assert.rejects(provider.poll({ ...chapter, provider: 'shotstack', stage: '../elsewhere', jobId }), /saved render receipt/);
});

test('incremental assembly records the actual partial prefix duration', async () => {
  const jobId = randomUUID(); let timeline;
  const provider = createStudioProvider({ env, fetcher: async (_url, options) => { timeline = JSON.parse(options.body); return json({ success: true, response: { id: jobId } }); } });
  const result = await provider.assemble(project, [{ durationSeconds: 100, mediaUrl: 'https://res.cloudinary.com/fixture/video/upload/part1.mp4' }, { durationSeconds: 120, mediaUrl: 'https://res.cloudinary.com/fixture/video/upload/part2.mp4' }]);
  assert.equal(result.durationSeconds, 220);
  assert.equal(timeline.timeline.tracks[0].clips[1].start, 100);
});

test('the built-in renderer creates films without submitting Shotstack renders', async () => {
  const nativeEnv = { ...env }; delete nativeEnv.OFFICE_STUDIO_RENDERER; delete nativeEnv.SHOTSTACK_API_KEY;
  const calls = [];
  const provider = createStudioProvider({ env: nativeEnv, fetcher: async (url) => {
    calls.push(url); assert.equal(url, 'https://api.openai.com/v1/responses');
    return json({ output_text: JSON.stringify({ summary: 'Moss plants a seed.', scenes: [{ narration: 'A new garden begins.', imagePrompt: 'A brass robot plants a seed.' }] }) });
  }, nativeRenderer: { render: async (saved, part, plan) => {
    assert.equal(saved.characters[0].name, 'Moss'); assert.equal(part.id, chapter.id); assert.equal(plan.scenes.length, 1);
    return { status: 'completed', mediaUrl: 'https://res.cloudinary.com/fixture/video/upload/native.mp4' };
  }, assemble: async (_saved, parts) => ({ status: 'completed', mediaUrl: 'https://res.cloudinary.com/fixture/video/upload/native-assembled.mp4', durationSeconds: parts.reduce((sum, item) => sum + item.durationSeconds, 0) }) } });
  assert.equal(provider.configured().renderer, 'native'); assert.equal(provider.configured().shotstack, false);
  assert.equal((await provider.chapter(project, chapter)).status, 'completed'); assert.equal(calls.length, 1);
  assert.equal((await provider.assemble(project, [chapter, chapter])).durationSeconds, 8);
  assert.equal(calls.length, 1);
});

test('media references reject local networks, credentials and non-HTTPS protocols', () => {
  for (const url of ['http://example.com/a.mp4','https://user:secret@example.com/a.mp4','https://127.0.0.1/a.mp4','https://0177.0.0.1/a.mp4','https://[::1]/a.mp4','https://app.local/a.mp4','data:image/png;base64,AA==']) assert.equal(publicMediaUrl(url), null, url);
  assert.equal(publicMediaUrl('https://res.cloudinary.com/fixture/video/upload/a.mp4'), 'https://res.cloudinary.com/fixture/video/upload/a.mp4');
});
