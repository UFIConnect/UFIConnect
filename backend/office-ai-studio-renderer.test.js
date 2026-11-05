'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createNativeStudioRenderer, runEncoder, captions } = require('./office-ai-studio-renderer');

const root = 'https://res.cloudinary.com/reviewcloud/video/upload/office-studio/';
const project = { id: 'review-project', title: 'A tiny film', producer: { brief: 'Warm and curious.' }, characters: [{ name: 'Mira', appearance: 'A small blue robot' }] };
const chapter = { id: 'review-chapter', index: 0, durationSeconds: 8 };
const scene = { imagePrompt: 'A small blue robot finds a book in a quiet library.', narration: 'The little robot found a book.' };
const png = Buffer.from('89504e470d0a1a0a01020304', 'hex');
const video = Buffer.from('000000186674797069736f6d0000000069736f6d', 'hex');
const missing = async folder => assert.rejects(fs.access(folder), error => error.code === 'ENOENT');
function fixture(overrides = {}) {
  const encodes = [], fetches = [], uploads = [], voices = [];
  const options = { env: { OPENAI_API_KEY: 'fixture-image-key', CLOUDINARY_CLOUD_NAME: 'reviewcloud' }, ffmpegPath: process.execPath,
    fetcher: async (url, options) => {
      fetches.push({ url, options });
      if (url === 'https://api.openai.com/v1/images/generations') return Response.json({ data: [{ b64_json: png.toString('base64') }] });
      return new Response(video);
    },
    speech: { synthesize: async input => { voices.push(input); return { format: 'pcm', sampleRate: 24000, buffer: Buffer.alloc(48000 * 2) }; } },
    encoder: async (binary, args, cwd) => {
      encodes.push({ binary, args, cwd,
        files: await fs.readdir(cwd),
        ...(args.includes('sequence.txt') ? { sequence: await fs.readFile(path.join(cwd, 'sequence.txt'), 'utf8') }
          : { subtitles: await fs.readFile(path.join(cwd, args.find(arg => /^scene-\d+\.png$/.test(arg)).replace('.png', '.srt')), 'utf8') }) });
      await fs.writeFile(path.join(cwd, args.at(-1)), video);
    },
    upload: async (file, id) => { uploads.push({ file, id, bytes: await fs.readFile(file) }); return root + id + '.mp4'; },
    ...overrides };
  return { renderer: createNativeStudioRenderer(options), options, encodes, fetches, uploads, voices };
}

test('native scenes use local files, synchronized captions and one stored MP4, then remove the temporary workspace', async () => {
  const h = fixture();
  const result = await h.renderer.render(project, chapter, { scenes: [scene, scene], summary: 'Mira found a book.' });
  assert.equal(result.status, 'completed'); assert.equal(result.provider, 'uficonnect'); assert.equal(result.renderer, 'native');
  assert.equal(result.durationSeconds, 8); assert.equal(result.mediaUrl, root + chapter.id + '.mp4');
  assert.equal(h.fetches.length, 2); assert.equal(h.voices.length, 2); assert.equal(h.uploads.length, 1);
  assert.equal(h.encodes.length, 3);
  for (const call of h.encodes) {
    assert.ok(!call.args.some(arg => /https?:\/\//.test(arg)));
    assert.equal(call.binary, process.execPath);
  }
  assert.match(h.encodes[0].subtitles, /00:00:00,000 --> 00:00:04,000/);
  assert.match(h.encodes[0].subtitles, /The little robot found a book\./);
  assert.ok(h.encodes[0].args.includes('s16le')); assert.ok(h.encodes[0].args.includes('libx264'));
  assert.ok(h.encodes[0].args.some(arg => /^atempo=1\.00000,apad,atrim=duration=4/.test(arg)));
  assert.deepEqual(h.encodes[2].sequence, "file 'scene-0.mp4'\nfile 'scene-1.mp4'\n");
  assert.deepEqual(h.encodes[2].args.slice(0, 2), ['-protocol_whitelist', 'file,pipe']);
  await missing(h.encodes[0].cwd);
});

test('every storyboard scene and encoder availability is checked before paying for image generation', async () => {
  for (const [plan, overrides] of [
    [{ scenes: [scene, { ...scene, narration: '' }] }, {}],
    [{ scenes: [scene] }, { ffmpegPath: path.join(__dirname, 'does-not-exist-encoder-fixture') }],
  ]) {
    const h = fixture(overrides);
    await assert.rejects(h.renderer.render(project, chapter, plan), error => error.beforeDispatch === true);
    assert.equal(h.fetches.length, 0); assert.equal(h.voices.length, 0); assert.equal(h.uploads.length, 0);
  }
});

test('temporary scene files are removed when encoding or upload fails', async () => {
  for (const failureAt of ['encode', 'upload']) {
    let folder;
    const h = fixture({
      encoder: async (_binary, args, cwd) => { folder = cwd; if (failureAt === 'encode') throw Error('Fixture encoding failure.'); await fs.writeFile(path.join(cwd, args.at(-1)), video); },
      upload: async () => { throw Error('Fixture upload failure.'); },
    });
    await assert.rejects(h.renderer.render(project, { ...chapter, durationSeconds: 4 }, { scenes: [scene] }));
    assert.ok(folder); await missing(folder);
  }
});

test('narration that is empty, malformed, or too long is never encoded as a completed scene', async () => {
  for (const audio of [
    { format: 'pcm', sampleRate: 24000, buffer: Buffer.alloc(0) },
    { format: 'pcm', sampleRate: 24000, buffer: Buffer.alloc(3) },
    { format: 'pcm', sampleRate: 24000, buffer: Buffer.alloc(48000 * 9) },
    { format: 'mp3', sampleRate: 24000, buffer: Buffer.alloc(8) },
  ]) {
    const h = fixture({ speech: { synthesize: async () => audio } });
    await assert.rejects(h.renderer.render(project, { ...chapter, durationSeconds: 4 }, { scenes: [scene] }));
    assert.equal(h.encodes.length, 0); assert.equal(h.uploads.length, 0);
  }
});

test('assembly rejects foreign media or invalid durations before downloading any saved chapter', async () => {
  for (const bad of [
    { mediaUrl: 'https://attacker.invalid/video.mp4', durationSeconds: 4 },
    { mediaUrl: 'https://res.cloudinary.com/anothercloud/video/upload/clip.mp4', durationSeconds: 4 },
    { mediaUrl: 'http://res.cloudinary.com/reviewcloud/video/upload/clip.mp4', durationSeconds: 4 },
    { mediaUrl: root + 'bad.mp4', durationSeconds: -1 },
    { mediaUrl: root + 'bad.mp4', durationSeconds: Number.NaN },
  ]) {
    const h = fixture();
    await assert.rejects(h.renderer.assemble(project, [{ mediaUrl: root + 'good.mp4', durationSeconds: 4, index: 0 }, bad]), error => error.beforeDispatch === true);
    assert.equal(h.fetches.length, 0); assert.equal(h.encodes.length, 0); assert.equal(h.uploads.length, 0);
  }
});

test('assembly downloads only the owned CDN, concatenates local files, and preserves the combined duration', async () => {
  const h = fixture();
  const result = await h.renderer.assemble(project, [{ mediaUrl: root + 'a.mp4', durationSeconds: 4, index: 0 }, { mediaUrl: root + 'b.mp4', durationSeconds: 5, index: 1 }]);
  assert.equal(result.durationSeconds, 9); assert.equal(result.status, 'completed');
  assert.equal(h.fetches.length, 2); assert.ok(h.fetches.every(call => call.options.redirect === 'error'));
  assert.deepEqual(h.encodes[0].sequence, "file 'part-0.mp4'\nfile 'part-1.mp4'\n");
  assert.ok(!h.encodes[0].args.some(arg => /https?:\/\//.test(arg)));
  assert.equal(h.uploads.length, 1); await missing(h.encodes[0].cwd);
});

test('assembly limits the combined downloaded bytes before encoding and always cancels the source reader', async () => {
  let fetches = 0, cancellations = 0, encoded = 0, uploaded = 0;
  const h = fixture({
    // Model large streamed chunks through their byte counts without allocating
    // hundreds of megabytes merely to test the aggregate admission boundary.
    fetcher: async () => {
      fetches++; let sent = false;
      return { ok: true, body: { getReader: () => ({
        async read() {
          if (sent) return { done: true };
          sent = true; const value = Buffer.from([1, 2]);
          Object.defineProperty(value, 'byteLength', { value: 220 * 1024 * 1024 });
          return { done: false, value };
        },
        async cancel() { cancellations++; },
      }) } };
    },
    encoder: async () => { encoded++; }, upload: async () => { uploaded++; return root + 'never.mp4'; },
  });
  await assert.rejects(h.renderer.assemble(project, [{ mediaUrl: root + 'a.mp4', durationSeconds: 4 }, { mediaUrl: root + 'b.mp4', durationSeconds: 4 }]), /capacity|large|limit/i);
  assert.equal(fetches, 2); assert.equal(cancellations, 2); assert.equal(encoded, 0); assert.equal(uploaded, 0);
});

test('encoder launches without a shell, blocks stdin, and omits captured stderr from public failures', async () => {
  const calls = [];
  const spawnImpl = (binary, args, options) => {
    calls.push({ binary, args, options });
    const child = new EventEmitter(); child.stderr = new PassThrough(); child.kill = () => {};
    queueMicrotask(() => { child.stderr.write('private-api-key-fixture'); child.emit('close', 1); });
    return child;
  };
  await assert.rejects(runEncoder('fixture-ffmpeg', ['-i', 'scene.png', 'out.mp4'], 'fixture-dir', { spawnImpl }), error => {
    assert.ok(!error.message.includes('private-api-key-fixture')); assert.equal(error.status, 502); return true;
  });
  assert.equal(calls[0].options.shell, false); assert.equal(calls[0].options.windowsHide, true);
  assert.deepEqual(calls[0].options.stdio, ['ignore', 'ignore', 'pipe']); assert.ok(calls[0].args.includes('-nostdin'));
});

test('caption content stays in the subtitle file and cannot alter encoder arguments', () => {
  const result = captions('A scene; $(do not run) `anything` --output /tmp/escape', 4);
  assert.match(result, /\$\(do not run\)/); assert.match(result, /00:00:04,000/);
  assert.ok(!result.includes('\u0000'));
});
