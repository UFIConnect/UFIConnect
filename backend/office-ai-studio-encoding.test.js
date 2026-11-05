'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createNativeStudioRenderer } = require('./office-ai-studio-renderer');

test('the installed native encoder produces a real playable MP4 with captions and audio without paid providers', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFioAAAAASUVORK5CYII=';
  let encoded;
  const renderer = createNativeStudioRenderer({
    env: { OPENAI_API_KEY: 'fixture-only', CLOUDINARY_CLOUD_NAME: 'fixture' },
    ffmpegPath: process.env.OFFICE_STUDIO_FFMPEG_PATH,
    fetcher: async url => {
      assert.equal(url, 'https://api.openai.com/v1/images/generations');
      return Response.json({ data: [{ b64_json: png }] });
    },
    speech: { synthesize: async () => ({ buffer: Buffer.alloc(48000), format: 'pcm', sampleRate: 24000 }) },
    upload: async file => { encoded = await fs.readFile(file); return 'https://res.cloudinary.com/fixture/video/upload/real-encoding-test.mp4'; },
  });
  const result = await renderer.render({ producer: {}, characters: [] }, { id: 'encoding-test', durationSeconds: 4 },
    { summary: 'An encoder integration fixture.', scenes: [{ imagePrompt: 'A quiet blue lake.', narration: 'The lake is calm.' }] });
  assert.equal(result.status, 'completed');
  assert.equal(result.durationSeconds, 4);
  assert.ok(encoded.length > 1000);
  assert.equal(encoded.subarray(4, 8).toString(), 'ftyp');
  assert.ok(encoded.includes(Buffer.from('avc1')), 'The file includes H.264 video');
  assert.ok(encoded.includes(Buffer.from('mp4a')), 'The file includes AAC audio');
});
