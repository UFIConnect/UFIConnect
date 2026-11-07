'use strict';

const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { createStudioSpeech } = require('./office-ai-studio-speech');
const fail = (message, extra = {}) => Object.assign(new Error(message), { status: 502, publicMessage: message, ...extra });
const FPS = 24;
const MAX_VIDEO_BYTES = 400 * 1024 * 1024;

async function responseBytes(response, max) {
  if (!response.body) throw fail('The media provider returned no asset.');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > max) throw fail('This asset exceeds the current render capacity.');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

function captionTime(value) {
  const ms = Math.round(value * 1000), hours = Math.floor(ms / 3600000), minutes = Math.floor(ms / 60000) % 60, seconds = Math.floor(ms / 1000) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
function captions(narration, seconds) {
  const words = narration.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().split(/\s+/), groups = [];
  for (let i = 0; i < words.length; i += 8) groups.push(words.slice(i, i + 8).join(' '));
  return groups.map((line, index) => `${index + 1}\n${captionTime(index * seconds / groups.length)} --> ${captionTime((index + 1) * seconds / groups.length)}\n${line}\n`).join('\n');
}
function runEncoder(binary, args, cwd, { spawnImpl = spawn, timeoutMs = 240000, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(fail('Video rendering was stopped.', { knownRejected: true }));
    let child;
    try { child = spawnImpl(binary, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] }); }
    catch { return reject(fail('The built-in video renderer could not start.', { beforeDispatch: true })); }
    let ended = false, errorText = '';
    const timer = setTimeout(() => { child.kill(); finish(fail('The built-in renderer reached its time limit. The saved project can be reviewed before retrying.')); }, timeoutMs);
    const finish = error => { if (ended) return; ended = true; clearTimeout(timer); signal?.removeEventListener('abort', stopped); error ? reject(error) : resolve(); };
    const stopped = () => { child.kill(); finish(fail('Video rendering was stopped.', { knownRejected: true })); };
    signal?.addEventListener('abort', stopped, { once: true });
    child.stderr?.on('data', chunk => { if (errorText.length < 16000) errorText += chunk.toString().slice(0, 16000 - errorText.length); });
    child.on('error', () => finish(fail('The built-in video renderer is unavailable. Check the server installation.', { beforeDispatch: true })));
    child.on('close', code => finish(code === 0 ? null : fail('The built-in renderer could not encode this film. The production brief is saved.')));
  });
}

function createNativeStudioRenderer({ env = process.env, fetcher = globalThis.fetch, speech, ffmpegPath, upload, encoder = runEncoder } = {}) {
  const narrator = speech || createStudioSpeech({ env, fetcher });
  const binary = () => ffmpegPath || env.OFFICE_STUDIO_FFMPEG_PATH || require('ffmpeg-static');
  function credentials() { return { cloud_name: env.CLOUDINARY_CLOUD_NAME, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET, secure: true }; }
  async function uploadVideo(file, id) {
    if (upload) return upload(file, id);
    const cloud = require('cloudinary').v2;
    const result = new Promise((resolve, reject) => {
      const stream = cloud.uploader.upload_stream({ ...credentials(), resource_type: 'video', folder: 'office-studio', public_id: id, overwrite: false },
        (error, value) => error ? reject(fail('The rendered film could not be saved to media storage.')) : resolve(value.secure_url));
      pipeline(createReadStream(file), stream).catch(() => reject(fail('The rendered film could not be uploaded.')));
    });
    return result;
  }
  async function workspace(fn) {
    const parent = path.resolve(os.tmpdir()), folder = await fs.mkdtemp(path.join(parent, 'ufi-studio-'));
    try { return await fn(folder); }
    finally {
      const resolved = path.resolve(folder);
      if (path.dirname(resolved) === parent && path.basename(resolved).startsWith('ufi-studio-')) await fs.rm(resolved, { recursive: true, force: true }).catch(() => {});
    }
  }
  async function generatedImage(prompt, signal, quality = 'low') {
    const response = await fetcher('https://api.openai.com/v1/images/generations', {
      method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(150000)]) : AbortSignal.timeout(150000),
      headers: { Authorization: 'Bearer ' + env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: env.OFFICE_STUDIO_IMAGE_MODEL || 'gpt-image-2', prompt, size: '1024x1024', quality: quality === 'medium' ? 'medium' : 'low', output_format: 'png', n: 1 }),
    });
    if (!response.ok) { await response.body?.cancel?.().catch(() => {}); throw fail(response.status === 402 ? 'OpenAI needs image-generation credits before this film can render.' : `The scene image could not be generated (HTTP ${response.status}). Check image access and the prompt.`, { knownRejected: response.status >= 400 && response.status < 500 && response.status !== 408 }); }
    let result;
    try { result = JSON.parse((await responseBytes(response, 26 * 1024 * 1024)).toString('utf8')); }
    catch (error) { if (error.publicMessage) throw error; throw fail('The image provider returned an unreadable scene.'); }
    const encoded = result?.data?.[0]?.b64_json;
    if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > 24 * 1024 * 1024) throw fail('The image provider returned no usable scene.');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length < 8 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw fail('The scene image format could not be verified.');
    return bytes;
  }
  // Encoding used to be pinned to a single thread, which protected the server
  // but made every chapter slow. Threads now scale with the machine while
  // staying capped, so one render cannot consume the whole host.
  const cores = Math.max(1, (typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length) || 1);
  const threads = Math.min(4, cores), filterThreads = Math.min(2, cores);
  const ENCODER_PRESETS = {
    // Turbo trades a little compression for wall-clock speed. Quality keeps the
    // sharper previous bitrate for a final render.
    turbo: { preset: 'ultrafast', crf: '27', image: 'low' },
    quality: { preset: 'veryfast', crf: '24', image: 'medium' },
  };
  const settingsFor = mode => ({ ...ENCODER_PRESETS[mode === 'quality' ? 'quality' : 'turbo'],
    threads: ['-threads', String(threads), '-filter_threads', String(filterThreads)] });
  function mediaSource(value) {
    let url;
    try { url = new URL(value); } catch { throw fail('A saved chapter has no valid media link.', { beforeDispatch: true }); }
    const cloudName = String(env.CLOUDINARY_CLOUD_NAME || '');
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || url.username || url.password || url.port || !cloudName || !url.pathname.startsWith('/' + cloudName + '/video/upload/')) throw fail('Only this Studio\'s saved media can be assembled.', { beforeDispatch: true });
    return url.href;
  }
  async function download(url, file, budget, signal) {
    const response = await fetcher(mediaSource(url), { redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000) });
    if (!response.ok) throw fail('A saved chapter could not be downloaded for assembly.');
    // Stream chapter downloads to disk; long film assembly must not buffer films in RAM.
    const reader = response.body?.getReader(); if (!reader) throw fail('A saved chapter returned no video.');
    const handle = await fs.open(file, 'wx'); let bytes = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; budget.bytes += value.byteLength; if (bytes > MAX_VIDEO_BYTES || budget.bytes > MAX_VIDEO_BYTES) throw fail('This assembly section is too large for the current server. Completed chapters remain downloadable.'); await handle.write(Buffer.from(value)); }
    } finally { await reader.cancel().catch(() => {}); await handle.close(); }
  }
  async function join(folder, names, filename = 'film.mp4', signal) {
    await fs.writeFile(path.join(folder, 'sequence.txt'), names.map(name => `file '${name}'`).join('\n') + '\n');
    await encoder(binary(), ['-protocol_whitelist', 'file,pipe', '-f', 'concat', '-safe', '1', '-i', 'sequence.txt', '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-movflags', '+faststart', filename], folder, { signal });
    const file = path.join(folder, filename), size = (await fs.stat(file)).size;
    if (!size || size > MAX_VIDEO_BYTES) throw fail('This assembly exceeds the current server capacity. Its completed chapters are still saved.');
    return file;
  }
  return {
    async render(project, chapter, plan, { signal } = {}) {
      if (signal?.aborted) throw fail('Video rendering was stopped.', { beforeDispatch: true });
      if (!Array.isArray(plan?.scenes) || !plan.scenes.length || plan.scenes.length > 6 || !Number.isFinite(chapter.durationSeconds) || chapter.durationSeconds < 4 || chapter.durationSeconds > 120) throw fail('This chapter has an invalid storyboard.', { beforeDispatch: true });
      if (plan.scenes.some(scene => typeof scene?.imagePrompt !== 'string' || !scene.imagePrompt.trim() || scene.imagePrompt.length > 2000 || typeof scene.narration !== 'string' || !scene.narration.trim() || scene.narration.length > 4000)) throw fail('This storyboard contains an invalid scene.', { beforeDispatch: true });
      // Resolve and verify the encoder before paying for scene assets.
      let executable; try { executable = binary(); await fs.access(executable); } catch { throw fail('Install the built-in video renderer on the server before generating.', { beforeDispatch: true }); }
      const mode = project.producer?.renderMode === 'turbo' ? 'turbo' : 'quality';
      return workspace(async folder => {
        const names = [], seconds = chapter.durationSeconds / plan.scenes.length, settings = settingsFor(mode);
        // Scene preparation (paid image and narration requests) runs in
        // parallel waves instead of one scene at a time, so a chapter waits
        // for roughly one image and one narration rather than every asset
        // in turn. Each scene still validates its own audio before encoding.
        const run = async index => {
          const scene = plan.scenes[index], imageFile = `scene-${index}.png`, audioFile = `scene-${index}.pcm`, captionFile = `scene-${index}.srt`, movieFile = `scene-${index}.mp4`;
          const image = await generatedImage(`Photorealistic cinematic landscape frame from an original film, shot on 35mm with natural lighting, true-to-life skin and material texture, believable depth of field and fine film grain. Compose it as a film still with headroom and side margin so a slow camera move stays inside the picture. Follow the recurring character bible and production direction.\n${JSON.stringify({ scene: scene.imagePrompt, characters: project.characters, producer: project.producer })}`, signal, settings.image);
          await fs.writeFile(path.join(folder, imageFile), image);
          const audio = await narrator.synthesize({ text: scene.narration, instructions: 'Read the narration clearly and naturally. ' + (project.producer?.brief || '').slice(0, 1200), signal });
          if (audio.format !== 'pcm' || audio.sampleRate !== 24000 || !Buffer.isBuffer(audio.buffer) || !audio.buffer.length || audio.buffer.length % 2 || audio.buffer.length > 8 * 1024 * 1024) throw fail('The narrator returned an unsupported audio format.');
          await fs.writeFile(path.join(folder, audioFile), audio.buffer);
          await fs.writeFile(path.join(folder, captionFile), captions(scene.narration, seconds));
          return { index, audio, movieFile, captionFile };
        };
        const concurrency = Math.min(plan.scenes.length, 3);
        const prepared = [];
        for (let start = 0; start < plan.scenes.length; start += concurrency) {
          if (signal?.aborted) throw fail('Video rendering was stopped.', { knownRejected: true });
          const wave = await Promise.all(plan.scenes.slice(start, start + concurrency).map((scene, position) => {
            if (typeof scene.imagePrompt !== 'string' || !scene.imagePrompt.trim() || scene.imagePrompt.length > 2000 || typeof scene.narration !== 'string' || !scene.narration.trim() || scene.narration.length > 4000) throw fail('This storyboard contains an invalid scene.', { beforeDispatch: true });
            return run(start + position);
          }));
          prepared.push(...wave);
        }
        for (const { index, audio, movieFile, captionFile } of prepared) {
          if (signal?.aborted) throw fail('Video rendering was stopped.', { knownRejected: true });
          const scene = plan.scenes[index], audioSeconds = audio.buffer.length / 48000, tempo = Math.max(1, audioSeconds / Math.max(1, seconds - .15));
          if (tempo > 2) throw fail('The narration could not fit this scene. Shorten the narration in the production brief before retrying.');
          // Cinematic camera moves: scenes rotate through a slow push-in, a
          // pull-back, a horizontal pan and a vertical tilt so films feel
          // filmed rather than static photos. The image is oversampled to
          // 1600x900 and every pan or tilt is scaled to the live zoom margin,
          // so the moving window never leaves real picture content.
          const frames = Math.max(1, Math.round(seconds * FPS)), kind = index % 4, sign = index % 2 === 0 ? 1 : -1;
          const zoomExpr = kind === 1 ? `max(1.15-0.10*on/${frames},1.05)` : `min(1.05+0.10*on/${frames},1.15)`;
          const drift = axis => (kind === 2 && axis === 'x') || (kind === 3 && axis === 'y') ? `*(1+${(sign * 0.8).toFixed(2)}*on/${frames})` : '';
          const camera = `zoompan=z='${zoomExpr}':d=1:x='(iw-iw/zoom)/2${drift('x')}':y='(ih-ih/zoom)/2${drift('y')}':s=1280x720:fps=${FPS}`;
          const filter = `scale=1600:900:force_original_aspect_ratio=increase,crop=1600:900,${camera},subtitles=${captionFile}:force_style='FontName=Arial,FontSize=20,Outline=1,Shadow=0,MarginV=24',fade=t=in:st=0:d=0.25,fade=t=out:st=${Math.max(0, seconds - .25)}:d=0.25`;
          await encoder(executable, ['-loop', '1', '-framerate', String(FPS), '-i', `scene-${index}.png`, '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', `scene-${index}.pcm`,
            '-vf', filter, '-af', `atempo=${tempo.toFixed(5)},apad,atrim=duration=${seconds},asetpts=N/SR/TB`, '-t', String(seconds), '-r', String(FPS), '-c:v', 'libx264', '-preset', settings.preset, '-crf', settings.crf, '-pix_fmt', 'yuv420p', ...settings.threads, '-c:a', 'aac', '-b:a', '96k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', movieFile], folder, { signal });
          names.push(movieFile);
        }
        const file = names.length === 1 ? path.join(folder, names[0]) : await join(folder, names, 'film.mp4', signal);
        const bytes = (await fs.stat(file)).size;
        if (!bytes || bytes > MAX_VIDEO_BYTES) throw fail('The rendered chapter exceeds the current server capacity.');
        if (signal?.aborted) throw fail('Video rendering was stopped.', { knownRejected: true });
        const mediaUrl = await uploadVideo(file, chapter.id);
        mediaSource(mediaUrl);
        return { status: 'completed', mediaUrl, provider: 'uficonnect', renderer: 'native', durationSeconds: chapter.durationSeconds, summary: String(plan.summary || '').slice(0, 1600) };
      });
    },
    async assemble(project, chapters, { signal } = {}) {
      if (signal?.aborted) throw fail('Video assembly was stopped.', { beforeDispatch: true });
      if (!Array.isArray(chapters) || !chapters.length || chapters.length > 30) throw fail('Choose a bounded saved section to assemble.', { beforeDispatch: true });
      if (chapters.some(chapter => !Number.isSafeInteger(chapter?.durationSeconds) || chapter.durationSeconds < 4) || !Number.isSafeInteger(chapters.reduce((sum, chapter) => sum + chapter.durationSeconds, 0))) throw fail('The saved chapter durations could not be verified.', { beforeDispatch: true });
      for (const chapter of chapters) mediaSource(chapter.mediaUrl);
      return workspace(async folder => {
        const names = [], budget = { bytes: 0 };
        for (let index = 0; index < chapters.length; index++) { const name = `part-${index}.mp4`; await download(chapters[index].mediaUrl, path.join(folder, name), budget, signal); names.push(name); }
        const file = await join(folder, names, 'film.mp4', signal), durationSeconds = chapters.reduce((sum, chapter) => sum + chapter.durationSeconds, 0);
        const mediaUrl = await uploadVideo(file, project.id + '-assembly-' + (chapters.at(-1).index ?? chapters.length));
        mediaSource(mediaUrl);
        return { status: 'completed', provider: 'uficonnect', renderer: 'native', mediaUrl, durationSeconds };
      });
    },
  };
}

module.exports = { createNativeStudioRenderer, captions, runEncoder };
